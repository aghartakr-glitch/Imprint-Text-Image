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
import { GRID_COLUMNS, GRID_ROWS } from '../layoutConstants.js'

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
function rowsNeededForText(charCount, role, colSpan, gridSpec) {
  if (!charCount) return 1
  for (let span = 1; span <= gridSpec.rows; span += 1) {
    const box = gridToMm(
      {
        col_start: 1, col_span: colSpan, row_start: 1, row_span: span,
      },
      { columns: gridSpec.columns, rows: gridSpec.rows, gutterMm: gridSpec.gutterMm },
    )
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
    const wanted = Number.isFinite(el.row_span) ? el.row_span : 4
    entries.push({
      el, sourceRole: null, rows: Math.max(2, Math.min(wanted, Math.floor(gridSpec.rows * 0.6))),
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
      el,
      sourceRole,
      rows: rowsNeededForText(charCountOf(block), sourceRole, colSpan, gridSpec),
    })
  })

  entries.sort((a, b) => roleRank(a.el, a.sourceRole) - roleRank(b.el, b.sourceRole))
  return { entries, totalRows: entries.reduce((sum, e) => sum + e.rows, 0) }
}

// Packs groups in document order into column bands. A group always lands whole, on one page, in one
// band; a group too tall for a half-width band is widened to full width (which roughly halves the
// rows its text needs) before being given its own page.
function packGroups(groups, gridSpec, textBlocks, lookup, forcedIds = new Set()) {
  const bandCount = gridSpec.columns >= 4 ? 2 : 1
  const bandSpan = Math.floor(gridSpec.columns / bandCount)
  const bands = Array.from({ length: bandCount }, (_, i) => ({
    colStart: i * bandSpan + 1,
    colSpan: bandSpan,
  }))

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
  const emitFullBleedPage = (imageId) => {
    flushPage()
    const existing = lookup.imageById.get(imageId) || {}
    pages.push({
      page: pages.length + 1,
      elements: [{
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
        row_span: gridSpec.rows,
      }],
    })
  }

  const place = (entries, colStart, colSpan, startRow) => {
    let cursor = startRow
    entries.forEach(({ el, rows }) => {
      // Never emit a row_start past the grid: an element placed outside 1..rows fails validation
      // outright (confirmed 2026-07-27: "row 범위가 grid(1~12)를 벗어났습니다").
      if (cursor > gridSpec.rows) return
      const rowSpan = Math.max(1, Math.min(rows, gridSpec.rows - cursor + 1))
      const packed = {
        ...el, col_start: colStart, col_span: colSpan, row_start: cursor, row_span: rowSpan,
      }
      // bleed:"full" is legal only on a page holding nothing else. Packing places groups alongside
      // each other, so a full-bleed flag carried over from the model's plan would be a validation
      // failure introduced BY this layout (confirmed 2026-07-27: three such errors in a real
      // generation). The image keeps its slot; it just no longer claims the whole page.
      delete packed.bleed
      currentElements.push(packed)
      cursor += rowSpan
    })
    return cursor
  }

  groups.forEach((group) => {
    group.images.filter((id) => forcedIds.has(id)).forEach(emitFullBleedPage)

    let { entries, totalRows } = sizeGroup(group, bands[0].colSpan, gridSpec, textBlocks, lookup, forcedIds)
    if (entries.length === 0) return

    // Too tall for a half-width band: re-measure at full width, and give it a clean page.
    if (totalRows > gridSpec.rows && bandCount > 1) {
      const wide = sizeGroup(group, gridSpec.columns, gridSpec, textBlocks, lookup, forcedIds)
      if (wide.totalRows <= gridSpec.rows) {
        flushPage()
        place(wide.entries, 1, gridSpec.columns, 1)
        flushPage()
        return
      }
      entries = wide.entries
      totalRows = wide.totalRows
      flushPage()
      place(entries, 1, gridSpec.columns, 1)
      flushPage()
      return
    }

    if (rowCursor + totalRows - 1 > gridSpec.rows) {
      bandIndex += 1
      rowCursor = 1
      if (bandIndex >= bands.length) flushPage()
    }

    const band = bands[bandIndex]
    const cursor = place(entries, band.colStart, band.colSpan, rowCursor)
    // One blank row between groups so adjacent groups read as separate units.
    rowCursor = cursor + 1
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
  return {
    columns: plan?.grid_spec?.columns ?? plan?.grid?.columns ?? fallback.columns ?? GRID_COLUMNS,
    rows: plan?.grid_spec?.rows ?? plan?.grid?.rows ?? fallback.rows ?? GRID_ROWS,
    gutterMm: plan?.grid_spec?.gutter_mm ?? fallback.gutterMm ?? 4,
  }
}

/**
 * Repairs an existing plan by repacking its content groups. Preserves each element's identity,
 * role, text_source, and image fit/object_position; decides only which page and rectangle it gets.
 */
export function repairContentGroupLayout(plan, contentGroupModel, textBlocks = [], forcedFullBleedImages = []) {
  const groups = contentGroupModel?.groups
  if (!plan || !Array.isArray(plan.pages) || !Array.isArray(groups) || groups.length === 0) {
    return { plan, repaired: false, actions: [] }
  }

  const gridSpec = gridSpecOf(plan)
  const usable = groups.filter((g) => g.images.length > 0 || g.text_sources.length > 0)
  if (usable.length === 0) return { plan, repaired: false, actions: [] }

  const forcedIds = new Set((forcedFullBleedImages || []).map((n) => `image_${n}`))
  const { pages, bandCount } = packGroups(usable, gridSpec, textBlocks, buildLookup(plan), forcedIds)
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
  forcedFullBleedImages = [],
} = {}) {
  const groups = contentGroupModel?.groups
  if (!Array.isArray(groups) || groups.length === 0) return null

  const gridSpec = gridSpecOf(null, {
    columns: gridSettings.columns,
    rows: gridSettings.rows,
    gutterMm: gridSettings.gutter_mm,
  })

  const usable = groups.filter((g) => g.images.length > 0 || g.text_sources.length > 0)
  if (usable.length === 0) return null

  const forcedIds = new Set((forcedFullBleedImages || []).map((n) => `image_${n}`))
  const { pages } = packGroups(
    usable, gridSpec, textBlocks, { imageById: new Map(), textBySource: new Map() }, forcedIds,
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
