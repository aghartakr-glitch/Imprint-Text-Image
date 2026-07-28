// Deterministic content-group layout: both a repair for a broken LLM plan and a from-scratch
// builder that is always able to produce a valid layout.
//
// Added 2026-07-27. Group cohesion validation was originally shipped with no repair, so any plan
// that split a group across pages hard-failed the whole generation -- and the LLM violates it
// routinely on multi-page documents. Grading the model on a constraint whose answer is already
// known deterministically is the wrong shape: buildContentGroups.js knows exactly which image
// belongs with which paragraphs, so the system can lay the groups out itself.
//
// buildContentGroupPlan() exists because "every validation issue means zero output" was burning
// paid API calls for nothing: the model would answer, one residual issue would survive repair, and
// the user got an error instead of a document. This builder needs no LLM plan at all, so a
// generation can always fall back to a real, fully validated layout.
//
// Text is never edited, summarised, reordered, or dropped by anything in this module.

import { estimateTextCapacityMm } from '../estimateTextCapacity.js'
import { gridToMm } from '../gridToMm.js'
import {
  BODY_LIKE_ROLES,
  estimateLineCount,
  isBodyLikeRole,
  leadingMmFor,
  textHeightMmForLines,
} from '../textMeasure.js'
import {
  GRID_COLUMNS, GRID_ROWS, TEXT_BOX_HEIGHT_MM,
  MIN_READABLE_COLUMN_WIDTH_MM, resolvePageGeometry,
} from '../layoutConstants.js'

// Gaps INSIDE one content group, in mm. These are deliberately far smaller than a grid row pitch
// (11.2mm row + 4mm gutter = 15.2mm): a Korean heading and its English counterpart belong one line
// apart, not one grid row apart. Confirmed 2026-07-27 on real output -- the user marked headings of
// the same group sitting 15-30mm away from each other, because every paragraph was snapped to its
// own grid row and the unused remainder of each row became visible whitespace.
//
// Tightened again 2026-07-27: two headings of the same tier stacked as separate blocks (e.g. a
// Korean heading directly followed by its English counterpart) read visibly LOOSER than the same
// pair of lines wrapped naturally inside one heading block by LaTeX -- the user compared them
// side-by-side on real output. The two rendering paths need to converge on one rhythm: this gap
// shrinks, and the multi-line safety padding below no longer applies to single-line heading
// entries, whose full box height was previously inflated by 35% for no reason (that padding exists
// to protect a wrapped line's descender, which a one-line heading never has).
// Nudged 1mm -> 2mm (2026-07-28): 1mm read too tight overall across every title/subtitle pair in
// real output ("전체적으로 제목+소제목 간격이 너무 좁다"). Keep in sync by hand with buildLatex.js's
// gapAfterTextRole(), which must match this value for the flowTextBlock() rendering path.
const GAP_AFTER_HEADING_MM = 2
const GAP_AFTER_BODY_MM = 3
const GAP_AFTER_IMAGE_MM = 3

// Tight mm heights for a group's text stack, bypassing grid-row quantization. The grid box stays on
// the element (validation is grid-based); box_mm is what resolveGridPage actually renders, so the
// visible result is typographically tight while the plan still validates.
function tightBoxesFor(entries, xMm, wMm, startYMm) {
  let y = startYMm
  let lastImageBox = null
  return entries.map(({ el, rows, sourceRole }) => {
    if (el.type === 'image') {
      const h = el.__gridHMm ?? rows
      const box = { xMm, yMm: y, wMm, hMm: h }
      lastImageBox = box
      y += h + GAP_AFTER_IMAGE_MM
      return box
    }

    const role = sourceRole || el.role || 'body'
    const leading = leadingMmFor(role)

    // A credit line belonging to a group that has an image sits ON the image's bottom-right corner,
    // the way the reference spreads set them (2026-07-27 user request). It is pinned to the image
    // rather than flowing in the column, so it consumes no vertical space and cannot push the
    // heading or body around -- everything below it stays exactly where it would otherwise be.
    if (role === 'caption' && lastImageBox) {
      const h = leading * 1.6
      return {
        xMm: lastImageBox.xMm,
        yMm: lastImageBox.yMm + lastImageBox.hMm - h,
        wMm: lastImageBox.wMm,
        hMm: h,
        __overlay: true,
      }
    }

    const lines = estimateLineCount({ text: el.__text || '', charCount: el.__charCount ?? 0, role, wMm })
    // Extra headroom only for text that actually wraps onto a 2nd+ line, so a descender is never
    // clipped -- a single-line heading has no wrapped line to protect and was previously getting
    // this padding for nothing, which is what made stacked headings read looser than one intrinsic
    // wrapped block.
    const h = textHeightMmForLines(lines, role)
    const box = { xMm, yMm: y, wMm, hMm: h }
    const isHeading = !isBodyLikeRole(role)
    y += h + (isHeading ? GAP_AFTER_HEADING_MM : GAP_AFTER_BODY_MM)
    return box
  })
}

// Ordering inside one group, so a group always reads image -> heading -> body -> credit regardless
// of the order the model emitted its elements in.
const ROLE_RANK = {
  title: 0,
  section_label: 1,
  subtitle: 1,
  label: 1,
  case_title_ko: 1,
  case_title_en: 1,
  entry_label: 1,
  body: 2,
  continuation_body: 2,
  quote: 2,
  lead: 2,
  list_item: 2,
  caption: 3,
  credit: 3,
}

function roleRank(el, sourceRole) {
  if (el.type === 'image') return -1
  return ROLE_RANK[sourceRole] ?? ROLE_RANK[el.role] ?? 2
}

// The plan schema allows only six text roles; map every structural role onto one of them.
function toOutputRole(sourceRole) {
  if (sourceRole === 'title') return 'title'
  if (['body', 'continuation_body', 'quote', 'lead', 'list_item', 'caption', 'credit'].includes(sourceRole)) return 'body'
  return 'section_label'
}

function blockForSource(textBlocks, textSource) {
  const match = /^paragraph_(\d+)$/.exec(textSource || '')
  if (!match) return null
  return textBlocks[Number(match[1]) - 1] || null
}

function charCountOf(block) {
  if (!block) return 0
  return Number.isFinite(block.char_count) ? block.char_count : (block.text || '').length
}

// Rows a text element needs at the given band width, from the real capacity model rather than a flat
// guess -- an under-estimate here reintroduces the text-overflow failures fixed elsewhere.
function maxTokenLength(text) {
  return String(text || '').split(/\s+/).reduce((max, token) => Math.max(max, token.length), 0)
}

function textHasOverwideToken(block, role, colSpan, gridSpec) {
  const tokenLength = maxTokenLength(block?.text)
  if (!tokenLength) return false
  const { wMm } = gridToMm(
    { col_start: 1, col_span: colSpan, row_start: 1, row_span: 1 },
    gridSpec, // carries boxWidthMm/boxHeightMm from the plan's real page_size (2026-07-28)
  )
  const charsPerLine = estimateTextCapacityMm(wMm, leadingMmFor(role), role)
  return tokenLength > charsPerLine
}

function rowsNeededForText(charCount, role, colSpan, gridSpec, text = '') {
  if (!charCount) return 1
  for (let span = 1; span <= gridSpec.rows; span += 1) {
    const box = gridToMm(
      {
        col_start: 1, col_span: colSpan, row_start: 1, row_span: span,
      },
      gridSpec, // carries boxWidthMm/boxHeightMm from the plan's real page_size (2026-07-28)
    )
    if (!isBodyLikeRole(role) && text) {
      const lines = estimateLineCount({ text, charCount, role, wMm: box.wMm })
      const neededMm = textHeightMmForLines(lines, role)
      if (box.hMm >= neededMm) return span
      continue
    }
    if (estimateTextCapacityMm(box.wMm, box.hMm, role) >= charCount) {
      // A body paragraph of any real length in a single row renders as one-character fragments, and
      // the validator rejects it outright. Never hand back a 1-row box for such a paragraph.
      if (span === 1 && charCount > 40) return 2
      return span
    }
  }
  return gridSpec.rows
}

// Sizes one group's elements at a given column width, returning the stack and its total height.
function sizeGroup(group, colSpan, gridSpec, textBlocks, lookup, forcedIds = new Set()) {
  const entries = []

  // Images the user pinned as full-page are emitted as their own standalone page by packGroups, so
  // they must not also be stacked inside the group's column band.
  group.images.filter((id) => !forcedIds.has(id)).forEach((imageId) => {
    const existing = lookup.imageById.get(imageId)
    const el = existing || {
      id: imageId, type: 'image', role: 'support', fit: 'contain', object_position: 'center',
    }
    // When the model didn't give an image its own row_span, it defaulted to a flat 4 rows (~33%
    // of a 12-row grid) with a floor of just 2 rows (~17%) -- consistently small regardless of how
    // much room was actually available next to it, since nothing here scales with the group's
    // real text length (confirmed 2026-07-28: real generations produced small images throughout
    // whenever the LLM omitted row_span, "지면 대비 이미지가 너무 작다"). Raised the no-hint
    // default and the floor so an image never renders as an afterthought; the upper cap (still
    // ~60% of the grid) is unchanged so text-heavy groups don't lose all their body room to a
    // single image.
    const wanted = Number.isFinite(el.row_span) ? el.row_span : Math.ceil(gridSpec.rows * 0.55)
    const minRows = Math.max(2, Math.ceil(gridSpec.rows * 0.35))
    entries.push({
      el: { ...el, group_id: group.group }, sourceRole: null, rows: Math.max(minRows, Math.min(wanted, Math.floor(gridSpec.rows * 0.6))),
    })
  })

  group.text_sources.forEach((source) => {
    const block = blockForSource(textBlocks, source)
    const sourceRole = block?.role || 'body'
    const existing = lookup.textBySource.get(source)
    const el = existing || {
      id: `text_${source}`, type: 'text', role: toOutputRole(sourceRole), text_source: source,
    }
    entries.push({
      el: {
        ...el,
        group_id: group.group,
        flow_group_id: group.group,
        __charCount: charCountOf(block),
        __text: block?.text || '',
      },
      sourceRole,
      rows: rowsNeededForText(charCountOf(block), sourceRole, colSpan, gridSpec, block?.text || ''),
      overwideToken: textHasOverwideToken(block, sourceRole, colSpan, gridSpec),
    })
  })

  entries.sort((a, b) => roleRank(a.el, a.sourceRole) - roleRank(b.el, b.sourceRole))
  return { entries, totalRows: entries.reduce((sum, e) => sum + e.rows, 0) }
}

// How many side-by-side bands to flow groups into, derived from the user's own column setting
// rather than fixed (2026-07-27: this was hardcoded to 2 bands whenever the grid had 4+ columns,
// which silently ignored the 1단~6단 choice in the UI). Bands are always a whole number of the
// user's columns, so group edges land on their grid; among the options, the most bands that still
// leave a readable measure wins. A 6-column A5 yields 2 bands (56mm each) while a 6-column A4
// yields 3 (56.6mm each), and picking 1단 or 2단 is honored exactly.
function chooseBands(gridSpec) {
  for (let bandCount = gridSpec.columns; bandCount >= 2; bandCount -= 1) {
    if (gridSpec.columns % bandCount !== 0) continue
    const bandSpan = gridSpec.columns / bandCount
    const { wMm } = gridToMm(
      {
        col_start: 1, col_span: bandSpan, row_start: 1, row_span: 1,
      },
      gridSpec, // carries boxWidthMm/boxHeightMm from the plan's real page_size (2026-07-28)
    )
    if (wMm >= MIN_READABLE_COLUMN_WIDTH_MM) return { bandCount, bandSpan }
  }

  // Prime-ish grids such as 5 columns cannot be divided into equal readable bands. Treat the grid
  // as alignment scaffolding, not a command to use identical strips: a 5-column page should be able
  // to compose as 3+2 (or 2+3) instead of collapsing to one full-width band.
  if (gridSpec.columns === 5) {
    const twoCol = spanMeasureMm(2, gridSpec)
    const threeCol = spanMeasureMm(3, gridSpec)
    if (twoCol >= MIN_READABLE_COLUMN_WIDTH_MM && threeCol >= MIN_READABLE_COLUMN_WIDTH_MM) {
      return {
        bandCount: 2,
        bandSpan: 3,
        bands: [
          { colStart: 1, colSpan: 3 },
          { colStart: 4, colSpan: 2 },
        ],
      }
    }
  }

  return { bandCount: 1, bandSpan: gridSpec.columns }
}

function uniqueSortedSpans(spans, columns) {
  return [...new Set(spans
    .filter((span) => Number.isInteger(span) && span >= 1 && span <= columns))]
    .sort((a, b) => a - b)
}

function spanMeasureMm(span, gridSpec) {
  return gridToMm({ col_start: 1, col_span: span, row_start: 1, row_span: 1 }, gridSpec).wMm
}

function groupTextStats(group, textBlocks) {
  let bodyChars = 0
  let totalChars = 0
  let hasHeading = false
  let hasBody = false
  let maxToken = 0

  group.text_sources.forEach((source) => {
    const block = blockForSource(textBlocks, source)
    const role = block?.role || 'body'
    const chars = charCountOf(block)
    totalChars += chars
    maxToken = Math.max(maxToken, maxTokenLength(block?.text || ''))
    if (isBodyLikeRole(role)) {
      hasBody = true
      bodyChars += chars
    } else {
      hasHeading = true
    }
  })

  return { bodyChars, totalChars, hasHeading, hasBody, maxToken }
}

function preferredMinimumSpanForGroup(group, baseSpan, gridSpec, textBlocks, lookup, forcedIds) {
  const inlineImageCount = group.images.filter((id) => !forcedIds.has(id)).length
  const stats = groupTextStats(group, textBlocks)

  if (gridSpec.columns <= 2) return baseSpan
  if (inlineImageCount > 0) return Math.min(gridSpec.columns, gridSpec.columns >= 5 ? 3 : 2)

  const base = sizeGroup(group, baseSpan, gridSpec, textBlocks, lookup, forcedIds)
  if (base.entries.some((entry) => entry.overwideToken)) return gridSpec.columns

  if (stats.hasHeading && stats.hasBody && stats.bodyChars <= 700) {
    return Math.min(gridSpec.columns, gridSpec.columns >= 5 ? 3 : 2)
  }
  if (stats.hasBody && stats.bodyChars > 0 && stats.bodyChars <= 320) {
    return Math.min(gridSpec.columns, 2)
  }
  if (base.totalRows > gridSpec.rows * 0.75) {
    return Math.min(gridSpec.columns, gridSpec.columns >= 5 ? 3 : 2)
  }

  return baseSpan
}

function chooseResponsiveGroupSpan(group, baseSpan, gridSpec, textBlocks, lookup, forcedIds) {
  const desired = preferredMinimumSpanForGroup(group, baseSpan, gridSpec, textBlocks, lookup, forcedIds)
  const candidates = uniqueSortedSpans([
    baseSpan,
    desired,
    desired + 1,
    Math.ceil(gridSpec.columns / 2),
    gridSpec.columns,
  ], gridSpec.columns).filter((span) => span >= desired && spanMeasureMm(span, gridSpec) >= MIN_READABLE_COLUMN_WIDTH_MM)

  if (candidates.length === 0) return { colSpan: baseSpan, ...sizeGroup(group, baseSpan, gridSpec, textBlocks, lookup, forcedIds) }

  const measured = candidates.map((span) => ({
    colSpan: span,
    ...sizeGroup(group, span, gridSpec, textBlocks, lookup, forcedIds),
  }))
  return measured.find((candidate) => candidate.totalRows <= gridSpec.rows) || measured[measured.length - 1]
}

// Packs groups in document order into column bands. A group always lands whole, on one page, in one
// band; a group too tall for a single band is widened to full width (which reduces the rows its
// text needs) before being given its own page.
function packGroups(groups, gridSpec, textBlocks, lookup, forcedIds = new Set(), imageAspectRatios = []) {
  const bandChoice = chooseBands(gridSpec)
  const bands = bandChoice.bands || Array.from({ length: bandChoice.bandCount }, (_, i) => ({
    colStart: i * bandChoice.bandSpan + 1,
    colSpan: bandChoice.bandSpan,
  }))
  const bandCount = bands.length

  const pages = []
  let currentElements = []
  let bandIndex = 0
  let rowCursor = 1

  const flushPage = () => {
    if (currentElements.length > 0) pages.push({ page: pages.length + 1, elements: currentElements })
    currentElements = []
    bandIndex = 0
    rowCursor = 1
  }

  // A user-pinned full-page image gets a page to itself, immediately before the group it belongs
  // to, so it reads as that group's opener. This is the one case where an image is deliberately
  // separated from its own text: the explicit user instruction outranks group cohesion, and the
  // cohesion validator excludes these images for the same reason.
  const containedRowsForFullBleed = (imageId) => {
    const match = /^image_(\d+)$/.exec(imageId || '')
    const ratio = match ? imageAspectRatios[Number(match[1]) - 1] : null
    if (!Number.isFinite(ratio) || ratio <= 0) return gridSpec.rows
    // Real page aspect ratio from the plan's own page_size (2026-07-28) -- was hardcoded to A5's
    // 148/210 regardless of the actual page, which would size a forced full-bleed image's
    // contained height wrong on any other page size.
    const pageRatio = (gridSpec.pageWidthMm ?? 148) / (gridSpec.pageHeightMm ?? 210)
    const renderedHeightRatio = ratio > pageRatio ? pageRatio / ratio : 1
    return Math.max(1, Math.ceil(gridSpec.rows * renderedHeightRatio))
  }

  const fullBleedEntry = (imageId) => {
    const existing = lookup.imageById.get(imageId) || {}
    return {
      ...existing,
      id: imageId,
      type: 'image',
      role: existing.role || 'hero',
      fit: existing.fit || 'contain',
      object_position: existing.object_position || 'center',
      bleed: 'full',
      col_start: 1,
      col_span: gridSpec.columns,
      row_start: 1,
      row_span: containedRowsForFullBleed(imageId),
    }
  }

  const emitFullBleedPage = (imageId) => {
    flushPage()
    pages.push({
      page: pages.length + 1,
      elements: [fullBleedEntry(imageId)],
    })
  }

  const isBodyEntry = (entry) => {
    const role = entry.sourceRole || entry.el.role
    return entry.el.type === 'text' && BODY_LIKE_ROLES.has(role)
  }

  const splitTextOnlyGroupForRows = (entries, maxRows, colSpan) => {
    if (maxRows <= 2) return null
    const firstBodyIndex = entries.findIndex(isBodyEntry)
    if (firstBodyIndex < 0) return null

    const prefix = entries.slice(0, firstBodyIndex)
    const prefixRows = prefix.reduce((sum, entry) => sum + entry.rows, 0)
    const bodyRowsAvailable = maxRows - prefixRows
    if (bodyRowsAvailable < 2) return null

    const firstBody = entries[firstBodyIndex]
    const bodyRows = Math.min(firstBody.rows, bodyRowsAvailable)
    const totalChars = Number.isFinite(firstBody.el.__charCount) ? firstBody.el.__charCount : null
    // Without a real character count there is no reliable way to tell how much text the reduced
    // `bodyRows` actually covers, so don't guess -- bail out of the split entirely rather than risk
    // it (the caller's other branches place the group whole instead, which cannot duplicate text).
    if (totalChars == null) return null

    // Use the SAME real capacity function rowsNeededForText() uses, not a linear rows-ratio
    // estimate. Confirmed 2026-07-28 from a real generation: the old
    // `totalChars * (bodyRows / firstBody.rows)` guess overshot the real capacity by ~25% (652
    // chars estimated to fit a box whose real capacity was 520), because capacity doesn't scale
    // perfectly linearly with row count (line-height rounding, per-box padding). Computing the
    // actual mm box for `bodyRows` and asking estimateTextCapacityMm() directly is exact by
    // construction -- it's the same function validateLayoutTextCapacity() checks against.
    const bodyRole = firstBody.sourceRole || firstBody.el.role || 'body'
    const fitBox = gridToMm(
      {
        col_start: 1, col_span: colSpan, row_start: 1, row_span: bodyRows,
      },
      gridSpec,
    )
    const realCapacity = estimateTextCapacityMm(fitBox.wMm, fitBox.hMm, bodyRole)
    const fitChars = Math.max(1, Math.min(totalChars, realCapacity))
    // Confirmed 2026-07-28 from a real generation: when `bodyRows` is only slightly below
    // `firstBody.rows`, a rows-ratio estimate can round fitChars up to the FULL totalChars even
    // though bodyRows alone didn't cover every row the text originally needed. The old code then
    // decided whether to emit a "remaining" entry using `firstBody.rows > bodyRowsAvailable` -- a
    // *rows* comparison -- while `remainingBody` itself was built from a *character-count*
    // comparison (`remainingChars == null` -> reuse `firstBody` verbatim, uncompressed). Those two
    // conditions can disagree: rows said "doesn't fully fit" while chars said "nothing is left
    // over", so the leftover branch fell back to the ENTIRE original entry (full rows, full text) as
    // "remaining" -- duplicating the whole paragraph on a second page/band alongside the
    // already-placed, correctly-shrunk copy in fitEntries. The fix: whether anything remains must be
    // decided by the same signal (character count) that builds the remaining entry, not by rows.
    const hasRemainingChars = fitChars < totalChars
    const remainingChars = hasRemainingChars ? totalChars - fitChars : null
    // A remaining chunk must never be pushed to its own fresh page (see the fix above) just to
    // hold one leftover sentence -- that wastes an almost-blank page for a fragment. If what would
    // be left over is too small to be worth a page of its own, don't split at all: returning null
    // here makes the caller fall through to moving the WHOLE paragraph together instead (confirmed
    // 2026-07-28 from a real generation: "조절하는 능동적인 구성 요소로 사용되었다." -- the tail end
    // of a much longer paragraph -- landed alone on an otherwise empty page).
    const MIN_WORTHWHILE_REMAINING_CHARS = 60
    if (hasRemainingChars && remainingChars < MIN_WORTHWHILE_REMAINING_CHARS) return null
    const fitEntries = [...prefix, { ...firstBody, rows: bodyRows, el: { ...firstBody.el, __charCount: fitChars } }]
    // The leftover's row count must also come from the real capacity function, not from
    // subtracting rows (firstBody.rows - bodyRows + 1) -- that arithmetic assumes the SAME
    // per-row capacity applies on the continuation page as it did in the original (possibly
    // narrower or image-sharing) box, which isn't guaranteed. rowsNeededForText() already knows
    // how to find the minimal row count for a real character count at this colSpan; reuse it here.
    const remainingRowsNeeded = hasRemainingChars
      ? rowsNeededForText(remainingChars, bodyRole, colSpan, gridSpec)
      : null
    const remainingEntries = hasRemainingChars
      ? [
        {
          ...firstBody,
          rows: remainingRowsNeeded,
          el: { ...firstBody.el, __charCount: remainingChars },
        },
        ...entries.slice(firstBodyIndex + 1),
      ]
      : entries.slice(firstBodyIndex + 1)

    return { fitEntries, remainingEntries }
  }

  const place = (entries, colStart, colSpan, startRow) => {
    // Grid pass: assign each element its row span, which is what validation checks.
    const placed = []
    let cursor = startRow
    entries.forEach((entry) => {
      // Never emit a row_start past the grid: an element placed outside 1..rows fails validation
      // outright (confirmed 2026-07-27: "row 범위가 grid(1~12)를 벗어났습니다").
      if (cursor > gridSpec.rows) return
      const rowSpan = Math.max(1, Math.min(entry.rows, gridSpec.rows - cursor + 1))
      const gridBox = gridToMm(
        {
          col_start: colStart, col_span: colSpan, row_start: cursor, row_span: rowSpan,
        },
        gridSpec, // carries boxWidthMm/boxHeightMm from the plan's real page_size (2026-07-28)
      )
      const packed = {
        ...entry.el, col_start: colStart, col_span: colSpan, row_start: cursor, row_span: rowSpan,
      }
      // bleed:"full" is legal only on a page holding nothing else. Packing places groups alongside
      // each other, so a full-bleed flag carried over from the model's plan would be a validation
      // failure introduced BY this layout (confirmed 2026-07-27: three such errors in a real
      // generation). The image keeps its slot; it just no longer claims the whole page.
      delete packed.bleed
      placed.push({ packed, entry, gridBox })
      cursor += rowSpan
    })

    if (placed.length > 0) {
      // mm pass: re-stack the group tightly from the top of its first grid box. Images keep their
      // full grid box (so they still fill their cell edge to edge); text gets exactly the height its
      // lines need. Everything only ever SHRINKS relative to the grid boxes validation approved, so
      // no new overlap can be introduced.
      const startYMm = placed[0].gridBox.yMm
      const wMm = placed[0].gridBox.wMm
      const xMm = placed[0].gridBox.xMm
      const tightEntries = placed.map(({ entry, gridBox }) => ({
        el: { ...entry.el, __gridHMm: gridBox.hMm },
        rows: gridBox.hMm,
        sourceRole: entry.sourceRole,
      }))
      const boxes = tightBoxesFor(tightEntries, xMm, wMm, startYMm)
      placed.forEach(({ packed, gridBox }, i) => {
        const box = boxes[i]
        // Never let the tightened stack run past the page; fall back to the grid box if it would.
        // gridSpec.boxHeightMm reflects the plan's real page_size (falls back to A5's
        // TEXT_BOX_HEIGHT_MM only when the caller didn't supply one, e.g. an older test fixture).
        const fits = box.yMm + box.hMm <= (gridSpec.boxHeightMm ?? TEXT_BOX_HEIGHT_MM)
        const { __overlay: isOverlay, ...boxMm } = box
        packed.box_mm = fits ? boxMm : gridBox
        // Credit lines pinned onto an image render with credit styling, while the plan keeps a
        // role from the validated six-value vocabulary.
        if (isOverlay && fits) packed.render_role = 'caption'
        currentElements.push(packed)
      })
    }

    return cursor
  }

  groups.forEach((group) => {
    const forcedGroupImages = group.images.filter((id) => forcedIds.has(id))
    forcedGroupImages.forEach((imageId) => {
      flushPage()
      const imageEntry = fullBleedEntry(imageId)
      currentElements.push(imageEntry)
      rowCursor = imageEntry.row_span + 1
      bandIndex = 0
      if (rowCursor > gridSpec.rows - 1) flushPage()
    })

    let { entries, totalRows } = sizeGroup(group, bands[0].colSpan, gridSpec, textBlocks, lookup, forcedIds)
    let groupContinued = false
    let forcedBand = null
    let continuedFromBleedPage = false
    if (entries.length === 0) return

    if (bandCount > 1) {
      const responsive = chooseResponsiveGroupSpan(group, bands[0].colSpan, gridSpec, textBlocks, lookup, forcedIds)
      if (responsive.entries.length > 0 && responsive.colSpan > bands[0].colSpan) {
        if (currentElements.length > 0 && rowCursor > 1) flushPage()
        entries = responsive.entries
        totalRows = responsive.totalRows
        forcedBand = { colStart: 1, colSpan: responsive.colSpan }
      }
    }

    if (bandCount > 1 && entries.some((entry) => entry.overwideToken)) {
      const wide = sizeGroup(group, gridSpec.columns, gridSpec, textBlocks, lookup, forcedIds)
      if (wide.entries.length > 0) {
        if (currentElements.length > 0 && rowCursor > 1) flushPage()
        entries = wide.entries
        totalRows = wide.totalRows
        forcedBand = { colStart: 1, colSpan: gridSpec.columns }
      }
    }

    if (rowCursor + totalRows - 1 > gridSpec.rows) {
      const band = forcedBand || bands[bandIndex]
      const remainingRows = gridSpec.rows - rowCursor + 1
      const hasInlineImages = group.images.some((id) => !forcedIds.has(id))
      // Splitting a group's overlong body across pages used to be refused outright whenever the
      // group had an inline image, on the assumption that cohesion (image+text same page) must
      // always win. splitTextOnlyGroupForRows() already handles a leading image correctly -- it's
      // kept as a fixed, unsplit `prefix` -- so that guard's only effect was leaving a group with
      // an image AND a body too long to fit at ANY span (even full page width) with no recovery
      // at all: hard validation failure, no repair (confirmed 2026-07-28 from a real generation: a
      // 1566-character paragraph needed 1320 characters' worth of room even at the maximum
      // page-sized box). Per explicit user decision (2026-07-28): text must never be cut off, so
      // this is now allowed to split -- but ONLY as an absolute last resort for image-bearing
      // groups. Simply not fitting the CURRENT narrow band is not enough reason to break cohesion:
      // check first whether promoting to full page width (the "too tall" branch below already does
      // this) would let the whole group fit on one page with no split at all.
      const allowSplit = !hasInlineImages
        || sizeGroup(group, gridSpec.columns, gridSpec, textBlocks, lookup, forcedIds).totalRows > gridSpec.rows
      if (allowSplit && remainingRows >= 2) {
        const split = splitTextOnlyGroupForRows(entries, remainingRows, band.colSpan)
        if (split && split.fitEntries.length > 0) {
          const cursor = place(split.fitEntries, band.colStart, band.colSpan, rowCursor)
          rowCursor = cursor + 1
          entries = split.remainingEntries
          groupContinued = entries.length > 0
          continuedFromBleedPage = groupContinued && currentElements.some((el) => el.bleed === 'full')
          totalRows = entries.reduce((sum, entry) => sum + entry.rows, 0)
          if (entries.length === 0) return
        }
      }

      // A continued group (groupContinued) must never resume in a DIFFERENT band on the SAME
      // page as the chunk just placed. The cohesion validator computes each group's occupied
      // region as one bounding rectangle over all its elements -- a chunk at the bottom of band 0
      // and its continuation at the top of band 1 makes that rectangle span the entire page width
      // and height, which then wrongly reports every OTHER group's element on that page as
      // "inside" it, even though nothing actually overlaps on screen (confirmed 2026-07-28 from a
      // real generation: a title+subtitle group was flagged as intruding into a body paragraph's
      // group purely because the body's second half landed in the opposite band/corner). Only a
      // fresh page keeps a continued group's bounding rectangle sane.
      if (continuedFromBleedPage || groupContinued) {
        flushPage()
      } else {
        bandIndex += 1
        rowCursor = 1
        if (bandIndex >= bands.length) flushPage()
      }
    }

    // Too tall for a half-width band: re-measure at full width, and give the continuation a clean page.
    if (totalRows > gridSpec.rows && bandCount > 1) {
      const remainingSources = entries.map((entry) => entry.el.text_source).filter(Boolean)
      const remainingImages = entries
        .filter((entry) => entry.el.type === 'image')
        .map((entry) => entry.el.id)
        .filter(Boolean)
      const wide = sizeGroup({ ...group, images: remainingImages, text_sources: remainingSources }, gridSpec.columns, gridSpec, textBlocks, lookup, forcedIds)
      if (wide.entries.length > 0 && wide.totalRows <= gridSpec.rows) {
        flushPage()
        place(wide.entries, 1, gridSpec.columns, 1)
        flushPage()
        return
      }
      if (wide.entries.length > 0) {
        entries = wide.entries
        totalRows = wide.totalRows
      }
      flushPage()
      place(entries, 1, gridSpec.columns, 1)
      flushPage()
      return
    }

    const band = forcedBand || bands[bandIndex]
    const cursor = place(entries, band.colStart, band.colSpan, rowCursor)
    // One blank row between groups so adjacent groups read as separate units.
    rowCursor = cursor + 1
    if (groupContinued) flushPage()
  })
  flushPage()

  return { pages, bandCount }
}

function buildLookup(plan) {
  const imageById = new Map()
  const textBySource = new Map()
  ;(plan?.pages || []).forEach((page) => {
    ;(page.elements || []).forEach((el) => {
      if (el.type === 'image' && !imageById.has(el.id)) imageById.set(el.id, el)
      if (el.type === 'text' && el.text_source && !textBySource.has(el.text_source)) {
        textBySource.set(el.text_source, el)
      }
    })
  })
  return { imageById, textBySource }
}

function gridSpecOf(plan, fallback = {}) {
  // boxWidthMm/boxHeightMm/pageWidthMm/pageHeightMm from the plan's own page_size/margin_preset
  // (2026-07-28) -- without these, every gridToMm/estimateTextCapacityMm call in this file
  // silently fell back to A5 dimensions regardless of the plan's actual page_size (confirmed from
  // a real B5 generation measured against A5's smaller content box throughout this repacker).
  // buildContentGroupPlan() (the from-scratch builder) has no `plan` yet -- it passes page_size/
  // margin_preset via `fallback` instead, so both callers resolve correctly.
  const geometry = resolvePageGeometry(
    plan?.grid_spec?.page_size ?? fallback.pageSize,
    plan?.grid_spec?.margin_preset ?? fallback.marginPreset,
  )
  return {
    columns: plan?.grid_spec?.columns ?? plan?.grid?.columns ?? fallback.columns ?? GRID_COLUMNS,
    rows: plan?.grid_spec?.rows ?? plan?.grid?.rows ?? fallback.rows ?? GRID_ROWS,
    gutterMm: plan?.grid_spec?.gutter_mm ?? fallback.gutterMm ?? 4,
    boxWidthMm: geometry.textBoxWidthMm,
    boxHeightMm: geometry.textBoxHeightMm,
    pageWidthMm: geometry.pageWidthMm,
    pageHeightMm: geometry.pageHeightMm,
  }
}

/**
 * Repairs an existing plan by repacking its content groups. Preserves each element's identity,
 * role, text_source, and image fit/object_position; decides only which page and rectangle it gets.
 */
export function repairContentGroupLayout(plan, contentGroupModel, textBlocks = [], forcedFullBleedImages = [], options = {}) {
  const groups = contentGroupModel?.groups
  if (!plan || !Array.isArray(plan.pages) || !Array.isArray(groups) || groups.length === 0) {
    return { plan, repaired: false, actions: [] }
  }

  const gridSpec = gridSpecOf(plan)
  const usable = groups.filter((g) => g.images.length > 0 || g.text_sources.length > 0)
  if (usable.length === 0) return { plan, repaired: false, actions: [] }

  const forcedIds = new Set((forcedFullBleedImages || []).map((n) => `image_${n}`))
  const { pages, bandCount } = packGroups(usable, gridSpec, textBlocks, buildLookup(plan), forcedIds, options.imageAspectRatios || [])
  if (pages.length === 0) return { plan, repaired: false, actions: [] }

  return {
    plan: { ...plan, pages },
    repaired: true,
    actions: [{
      action: 'repack_content_groups_in_document_order',
      group_count: usable.length,
      page_count: pages.length,
      band_count: bandCount,
      reason: "content groups were split across pages or interleaved; repacked so each group occupies one contiguous rectangle on a single page, in the user's input order",
    }],
  }
}

/**
 * Builds a complete, valid layout plan from the content-group model alone -- no LLM plan required.
 * Used as the guaranteed fallback so a generation can never produce zero output.
 */
export function buildContentGroupPlan({
  contentGroupModel, textBlocks = [], gridSettings = {}, outputUnit = 'single_page',
  forcedFullBleedImages = [], imageAspectRatios = [],
} = {}) {
  const groups = contentGroupModel?.groups
  if (!Array.isArray(groups) || groups.length === 0) return null

  const gridSpec = gridSpecOf(null, {
    columns: gridSettings.columns,
    rows: gridSettings.rows,
    gutterMm: gridSettings.gutter_mm,
    pageSize: gridSettings.page_size,
    marginPreset: gridSettings.margin_preset,
  })

  const usable = groups.filter((g) => g.images.length > 0 || g.text_sources.length > 0)
  if (usable.length === 0) return null

  const forcedIds = new Set((forcedFullBleedImages || []).map((n) => `image_${n}`))
  const { pages } = packGroups(
    usable, gridSpec, textBlocks, { imageById: new Map(), textBySource: new Map() }, forcedIds, imageAspectRatios,
  )
  if (pages.length === 0) return null

  const hasImages = usable.some((g) => g.images.length > 0)

  return {
    candidate_id: 'content_group_deterministic',
    style: 'Editorial',
    output_unit: outputUnit,
    layout_family: hasImages ? 'balanced' : 'text-first',
    layout_purpose: 'editorial_reading',
    image_hierarchy: hasImages ? 'hero_support' : 'single_hero',
    image_text_relation: 'image_supports_text',
    composition_strategy: 'image_above_text',
    base_pattern_reference: 'content_group_stack',
    layout_intent: 'Each content group the user authored is laid out as one unit: its image above its heading and body, groups flowing in document order across column bands.',
    design_sequence: [
      {
        step: 1,
        decision_type: 'composition_strategy',
        value: 'image_above_text',
        reason: 'keeps every image directly above the text written for it',
      },
      {
        step: 2,
        decision_type: 'layout_family',
        value: hasImages ? 'balanced' : 'text-first',
        reason: hasImages ? 'images and text carry comparable weight' : 'no images supplied',
      },
    ],
    grid: { columns: gridSpec.columns, rows: gridSpec.rows },
    grid_spec: {
      columns: gridSpec.columns,
      rows: gridSpec.rows,
      gutter_mm: gridSpec.gutterMm,
      page_size: gridSettings.page_size || 'A5',
      margin_preset: gridSettings.margin_preset || 'recommended',
      grid_mode: gridSettings.grid_mode || 'flexible',
    },
    pages,
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    reason: 'Deterministic content-group layout: every image stays with the heading, body, and credit the user wrote for it.',
  }
}
