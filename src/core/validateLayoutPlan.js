import { GRID_COLUMNS, GRID_ROWS } from './layoutConstants.js'
import { DESIGN_SPACE } from './designSpace.js'
import { validateCollisions } from './validation/validateCollisions.js'
import { analyzeSpanVariation } from './layout/spanVariation.js'
import { validateLayoutTextCapacity } from './estimateTextCapacity.js'

const VALID_STYLES = ['Editorial', 'Magazine', 'Exhibition Catalog']

// Phase 5-2: Layout signature for diversity validation
// Captures essential layout characteristics to detect if multiple candidates are actually different
// 주의: layout.json의 실제 구조는 page.elements가 아니라 page.images[], page.textBlocks[] 사용
function getLayoutSignature(plan) {
  const pages = Array.isArray(plan.pages) ? plan.pages : []

  // Extract image positions as simple key (실제 구조: page.images[])
  const imagePositions = pages.flatMap((p, pageIdx) =>
    (p.images ?? [])
      .map((img, imgIdx) => {
        // xMm, yMm, wMm, hMm 기반 그리드 위치 추정 (대략적)
        const colStart = Math.ceil(img.xMm / 29) // 대략 6열 / 116mm = 19.3mm per col
        const colSpan = Math.ceil(img.wMm / 19.3)
        const rowStart = Math.ceil(img.yMm / 14.67) // 12행 / 176mm = 14.67mm per row
        const rowSpan = Math.ceil(img.hMm / 14.67)
        return `p${pageIdx}:c${colStart}s${colSpan}r${rowStart}s${rowSpan}`
      })
  )

  // Extract image count
  const imageCount = pages.flatMap((p) => p.images ?? []).length

  // Extract text block count (textBlocks[])
  const textCount = pages.flatMap((p) => (p.textBlocks ?? []).filter((b) => b.slice)).length

  return {
    compositionStrategy: plan.compositionStrategy,
    pageCount: pages.length,
    imagePositions: imagePositions.sort(),
    imageCount,
    textCount,
  }
}

// Detect if layout uses rigid zigzag alternating pattern (image-left/text-right, then opposite)
// 주의: 실제 구조는 page.images[] 사용
function isZigzagPattern(plan) {
  const pages = Array.isArray(plan.pages) ? plan.pages : []
  if (pages.length < 2) return false

  let prevImageOnLeft = null
  let zigzagCount = 0

  for (const page of pages) {
    const images = page.images ?? []

    for (const img of images) {
      // xMm 좌표로 좌/우 판단 (116mm 너비 기준 58mm 중점)
      const imgOnLeft = img.xMm < 58
      if (prevImageOnLeft !== null && imgOnLeft !== prevImageOnLeft) {
        zigzagCount += 1
      }
      prevImageOnLeft = imgOnLeft
    }
  }

  // If images alternate left/right 2+ times, it's zigzag
  return zigzagCount >= 2
}

// Calculate similarity between two signatures (0-1, higher = more similar)
function getSignatureSimilarity(sig1, sig2) {
  let matches = 0
  let total = 0

  // Check composition strategy
  total += 1
  if (sig1.compositionStrategy === sig2.compositionStrategy) matches += 1

  // Check page count
  total += 1
  if (sig1.pageCount === sig2.pageCount) matches += 1

  // Check image count
  total += 1
  if (sig1.imageCount === sig2.imageCount) matches += 1

  // Check if image positions are identical (most important)
  total += 2
  if (JSON.stringify(sig1.imagePositions) === JSON.stringify(sig2.imagePositions)) {
    matches += 2
  }

  // Check if image span patterns are different (good sign of diversity)
  total += 1
  if (JSON.stringify(sig1.imageSpans) !== JSON.stringify(sig2.imageSpans)) {
    matches += 0 // Different spans = good (don't penalize)
  } else {
    matches += 1 // Same spans = less diverse
  }

  return matches / total
}

function colRangeOverlap(a, b) {
  return a.col_start <= b.col_start + b.col_span - 1 && b.col_start <= a.col_start + a.col_span - 1
}
function rowRangeOverlap(a, b) {
  return a.row_start <= b.row_start + b.row_span - 1 && b.row_start <= a.row_start + a.row_span - 1
}

function checkEnum(value, allowed, fieldName, issues, required = true) {
  if (value == null && !required) return
  if (!allowed.includes(value)) issues.push(`알 수 없는 ${fieldName}: ${value}`)
}

function isBodyLikeRole(role) {
  return role === 'body' || role === 'continuation_body'
}

// Two elements sit in the same reading flow only when they occupy the exact same column band --
// one stacked directly above the other. Overlapping-but-different bands (col 1-3 vs col 3-4) are
// side-by-side columns whose relative reading order is not recoverable from coordinates.
function sameColumnBand(a, b) {
  return a.col_start === b.col_start && a.col_span === b.col_span
}

function placementOrder(placement) {
  const el = placement.el || {}
  return (placement.page ?? 0) * 10000 + (el.row_start ?? 0) * 100 + (el.col_start ?? 0)
}

// Every check from spec v0.3 section 9 plus the v0.4 supplement's extended schema fields
// (output_unit, layout_purpose, image_hierarchy, image_text_relation, composition_strategy,
// object_position, design_sequence) plus the grid-preset supplement fields (grid_spec,
// reserved_regions, text_flow, layout_variation), all validated against designSpace.js's
// vocabulary. "JSON parses" isn't checked here -- that's the caller's job via JSON.parse.
export function validateLayoutPlan(plan, {
  imageCount, textBlocks, contentGroupModel, forcedFullBleedImages = [], allowUnforcedFullBleed = true,
} = {}) {
  const issues = []
  // Design-quality observations that should NOT block rendering (a candidate with only warnings
  // still has passed:true). Kept separate from `issues` so a real-but-fixable geometry/schema
  // problem is never confused with a taste preference (confirmed 2026-07-10: "이미지 span 다양화
  // 부족" and the already-⚠️-prefixed column_flow_grid notices were both being pushed into
  // `issues`, so `passed: issues.length === 0` silently rejected the entire candidate over pure
  // design variety, discarding an otherwise fully valid, already-paid-for LLM response).
  const warnings = []

  if (!plan || typeof plan !== 'object') {
    return { passed: false, issues: ['layout_plan이 객체가 아닙니다'], warnings: [] }
  }

  // Compute active grid dimensions: if plan has grid_spec, use it; otherwise fall back to defaults
  const activeColumns = plan.grid_spec?.columns ?? GRID_COLUMNS
  const activeRows = plan.grid_spec?.rows ?? GRID_ROWS

  checkEnum(plan.style, VALID_STYLES, 'style', issues)
  checkEnum(plan.layout_family, DESIGN_SPACE.layoutFamilies, 'layout_family', issues)
  checkEnum(plan.output_unit, DESIGN_SPACE.outputUnits, 'output_unit', issues)
  checkEnum(plan.layout_purpose, DESIGN_SPACE.layoutPurposes, 'layout_purpose', issues)
  checkEnum(plan.image_hierarchy, DESIGN_SPACE.imageHierarchies, 'image_hierarchy', issues)
  checkEnum(plan.image_text_relation, DESIGN_SPACE.imageTextRelations, 'image_text_relation', issues)
  checkEnum(plan.composition_strategy, DESIGN_SPACE.compositionStrategies, 'composition_strategy', issues)

  // 🔴 CRITICAL: Forbid gallery_page_text_page (separates all images from all text)
  // Must use interleaving strategies for modular layouts
  if (plan.composition_strategy === 'gallery_page_text_page') {
    issues.push('❌ gallery_page_text_page는 금지됨: 모든 이미지를 한 페이지, 모든 글을 다른 페이지에 배치하므로 이미지-텍스트 interleaving 불가능. 대신 column_flow_grid, image_left_text_right, text_left_image_right, 또는 images_spread_across_pages를 사용하세요.')
  }

  if (!Array.isArray(plan.design_sequence) || plan.design_sequence.length === 0) {
    issues.push('design_sequence가 비어 있거나 배열이 아닙니다')
  }

  // Validate grid.columns/rows match the active grid (either from grid_spec or defaults)
  if (!plan.grid || plan.grid.columns !== activeColumns) {
    issues.push(`grid.columns는 ${activeColumns}이어야 합니다 (받은 값: ${plan.grid?.columns})`)
  }
  if (!plan.grid || plan.grid.rows !== activeRows) {
    issues.push(`grid.rows는 ${activeRows}이어야 합니다 (받은 값: ${plan.grid?.rows})`)
  }

  const pages = Array.isArray(plan.pages) ? plan.pages : []
  if (pages.length === 0) {
    issues.push('pages 배열이 비어 있습니다')
  }

  const seenImageIndices = new Set()
  const seenFullBleedImageIndices = new Set()
  let hasBodyText = false
  const imagePageIndices = []
  const textPageIndices = []
  const textSourcePlacements = new Map()
  const textBlockBySource = new Map()
  const sourceInfoBySource = new Map()
  const sourcesByGroup = new Map()
  if (Array.isArray(textBlocks)) {
    textBlocks.forEach((block, index) => {
      if (!block) return
      const source = `paragraph_${index + 1}`
      const info = {
        source,
        block,
        index,
        group_id: block.group_id,
        role: block.role || 'body',
      }
      if (block.id) textBlockBySource.set(block.id, block)
      textBlockBySource.set(source, block)
      sourceInfoBySource.set(source, info)
      if (block.group_id != null) {
        if (!sourcesByGroup.has(block.group_id)) sourcesByGroup.set(block.group_id, [])
        sourcesByGroup.get(block.group_id).push(info)
      }
    })
  }
  let spanAnalysis = null

  pages.forEach((page) => {
    const elements = Array.isArray(page.elements) ? page.elements : []

    elements.forEach((el) => {
      if (!Number.isInteger(el.col_start) || !Number.isInteger(el.col_span) || el.col_span < 1) {
        issues.push(`요소 ${el.id}: col_start/col_span 값이 잘못되었습니다`)
      } else if (el.col_start < 1 || el.col_start + el.col_span - 1 > activeColumns) {
        issues.push(`요소 ${el.id}: col 범위가 grid(1~${activeColumns})를 벗어났습니다`)
      }
      if (!Number.isInteger(el.row_start) || !Number.isInteger(el.row_span) || el.row_span < 1) {
        issues.push(`요소 ${el.id}: row_start/row_span 값이 잘못되었습니다`)
      } else if (el.row_start < 1 || el.row_start + el.row_span - 1 > activeRows) {
        issues.push(`요소 ${el.id}: row 범위가 grid(1~${activeRows})를 벗어났습니다`)
      }

      if (el.type === 'image') {
        imagePageIndices.push(page.page ?? pages.indexOf(page) + 1)
        if (el.fit !== 'contain') {
          issues.push(`요소 ${el.id}: 이미지의 fit은 항상 contain이어야 합니다 (받은 값: ${el.fit})`)
        }
        if (el.role) checkEnum(el.role, DESIGN_SPACE.imageRoles, `요소 ${el.id}의 role`, issues)
        if (el.object_position) checkEnum(el.object_position, DESIGN_SPACE.objectPositions, `요소 ${el.id}의 object_position`, issues)
        if (el.bleed != null && el.bleed !== 'full') {
          issues.push(`요소 ${el.id}: bleed는 "full"이거나 아예 없어야 합니다 (받은 값: ${el.bleed})`)
        }
        if (el.bleed === 'full' && elements.length > 1) {
          issues.push(`요소 ${el.id}: bleed:"full"(전면 이미지)은 해당 페이지에 다른 요소가 없을 때만 사용할 수 있습니다 (page ${page.page}에 요소 ${elements.length}개 존재)`)
        }
        const match = /^image_(\d+)$/.exec(el.id || '')
        if (match) {
          seenImageIndices.add(Number(match[1]))
          if (el.bleed === 'full') seenFullBleedImageIndices.add(Number(match[1]))
        }
      }

      if (el.type === 'text') {
        textPageIndices.push(page.page ?? pages.indexOf(page) + 1)
        if (el.role != null) checkEnum(el.role, DESIGN_SPACE.textRoles, `요소 ${el.id}의 role`, issues)

        // Three legitimate ways a text element carries its content:
        //  1. text_source: "paragraph_N"/"title" — modular reference resolved by paginateGridPlan.
        //  2. text: "..."                        — pre-sliced content (grid/column-flow fallback).
        //  3. neither                            — legacy continuous-flow body; paginateGridPlan
        //                                          flows the whole body into it via overflow.
        // Only guard against the one genuinely broken form: text_source present but malformed
        // (e.g. "body_all", which used to merge every paragraph into a single undifferentiated blob).
        if (el.text_source != null) {
          if (el.text_source === 'body_all') {
            issues.push(`element ${el.id}: text_source must reference a specific paragraph_N, not body_all`)
          } else if (!/^(title|paragraph_\d+)$/.test(el.text_source)) {
            issues.push(`element ${el.id}: invalid text_source "${el.text_source}"; expected title or paragraph_N`)
          }

          if (!textSourcePlacements.has(el.text_source)) textSourcePlacements.set(el.text_source, [])
          textSourcePlacements.get(el.text_source).push({ el, page: page.page ?? pages.indexOf(page) + 1 })

          const sourceBlock = textBlockBySource.get(el.text_source)
          const sourceRole = sourceBlock?.role || el.role
          const sourceLength = Number.isFinite(sourceBlock?.char_count) ? sourceBlock.char_count : sourceBlock?.text?.length
          if (isBodyLikeRole(sourceRole) && sourceLength > 40 && el.row_span <= 1) {
            issues.push(`element ${el.id}: long body ${el.text_source} (${sourceLength} chars) is placed in a 1-row box, which causes single-character text fragments. Use at least 2-3 rows or a wider body box.`)
          }
        }

        if (el.role === 'body') hasBodyText = true
      }
    })

    for (let i = 0; i < elements.length; i += 1) {
      for (let j = i + 1; j < elements.length; j += 1) {
        const a = elements[i]
        const b = elements[j]
        if (colRangeOverlap(a, b) && rowRangeOverlap(a, b)) {
          issues.push(`요소 ${a.id}와 ${b.id}가 겹칩니다 (page ${page.page})`)
        }
      }
    }
  })

  textSourcePlacements.forEach((placements, source) => {
    if (placements.length <= 1) return
    const sourceBlock = textBlockBySource.get(source)
    const sourceRole = sourceBlock?.role || placements[0]?.el?.role
    const isBodyLike = isBodyLikeRole(sourceRole)
    if (!isBodyLike) {
      issues.push(`duplicate text_source: ${source} is placed ${placements.length} times. Heading/label sources must be placed once.`)
      return
    }
    if (placements.length > 2) {
      issues.push(`over-split body text_source: ${source} is split into ${placements.length} boxes. Use at most two body columns and do not repeat the same source.`)
    }
  })

  const placementsByGroup = new Map()
  textSourcePlacements.forEach((placements, source) => {
    const info = sourceInfoBySource.get(source)
    if (!info || info.group_id == null) return
    placements.forEach((placement) => {
      if (!placementsByGroup.has(info.group_id)) placementsByGroup.set(info.group_id, [])
      placementsByGroup.get(info.group_id).push({
        ...placement,
        source,
        info,
        order: placementOrder(placement),
      })
    })
  })

  placementsByGroup.forEach((placements, groupId) => {
    const expectedSources = sourcesByGroup.get(groupId) || []
    if (expectedSources.length <= 1 || placements.length === 0) return

    const placedSources = new Set(placements.map((p) => p.source))
    const hasHeading = expectedSources.some((info) => !isBodyLikeRole(info.role))
    const hasBody = expectedSources.some((info) => isBodyLikeRole(info.role))
    if (hasHeading && hasBody) {
      const missingSources = expectedSources.filter((info) => !placedSources.has(info.source))
      if (missingSources.length > 0) {
        issues.push(`content group ${groupId} is split: placed ${[...placedSources].join(', ')} but omitted ${missingSources.map((info) => info.source).join(', ')}. Blocks with the same group_id must move together as one content unit.`)
      }
    }

    // Downgraded to a warning (not a hard `issues` failure) 2026-07-27: the automatic repair for
    // this case (repairContentGroups) had real bugs of its own (wrong box heights, misordered
    // pages -- confirmed against real generations), and was disabled rather than shipped broken.
    // Until it's rebuilt, treating this as fatal means any document where the LLM doesn't follow
    // the (advisory-only) group_id prompt instruction hard-fails a paid generation for a cosmetic
    // grouping issue, not a rendering-breaking one. Group_id enforcement for content the deterministic
    // overflow pagination places itself (paginateGridPlan.js) is unaffected -- this only relaxes
    // content the LLM places directly.
    const pagesUsed = new Set(placements.map((p) => p.page))
    if (pagesUsed.size > 1) {
      warnings.push(`⚠️ content group ${groupId} spans multiple pages (${[...pagesUsed].join(', ')}). Same group_id means one content unit; keep its title, subtitle, and body on the same page.`)
    }

    // Within-group order check, restricted to unambiguously comparable placements (rewritten
    // 2026-07-27, second pass). Reading order in a multi-column editorial layout cannot be
    // recovered from grid coordinates in general: the eye reads the left column top-to-bottom,
    // then the right column, so a later block legitimately sits at a LOWER row than an earlier
    // one. The only pair whose relative reading order is certain is two blocks occupying the
    // SAME column band (identical col_start and col_span) on the same page -- one stacked
    // directly above the other. Merely overlapping columns is not enough (confirmed 2026-07-27
    // against a real plan: a left-column block spanning col 1-3 and a right-column block at
    // col 3-4 share column 3 without being in the same reading flow at all).
    const inversionMessages = new Set()
    placements.forEach((a) => {
      placements.forEach((b) => {
        if (a.info.index >= b.info.index) return
        if (a.page > b.page) {
          inversionMessages.add(`content group ${groupId} order is inverted near ${b.source}. Keep blocks in the user's markdown order within each group_id.`)
          return
        }
        if (a.page !== b.page || !sameColumnBand(a.el, b.el)) return
        if ((b.el.row_start ?? 0) < (a.el.row_start ?? 0)) {
          inversionMessages.add(`content group ${groupId} order is inverted near ${b.source}. Keep blocks in the user's markdown order within each group_id.`)
        }
      })
    })
    inversionMessages.forEach((msg) => issues.push(msg))
  })

  // Interleaving check, restricted to a single column band (rewritten 2026-07-27, second pass).
  // The first rewrite grouped a page's blocks into "flows" by transitive column-range overlap,
  // but transitivity merges a whole page back into one flow as soon as one block is a little too
  // wide: confirmed 2026-07-27 against the real failing plan, a left-column block at col 1-3 and
  // a right-column block at col 3-4 share column 3, which chained every block on the page into a
  // single flow and reproduced the very row-major false positives the rewrite was meant to fix.
  // Only blocks in the exact same column band are stacked in one reading flow, so interleaving is
  // now evaluated per (page, col_start, col_span) band -- a foreign group wedged between two
  // blocks of another group in the same band is a genuine, unambiguous violation.
  const bandKey = (p) => `${p.page}|${p.el.col_start}|${p.el.col_span}`
  const placementsByBand = new Map()
  placementsByGroup.forEach((placements, groupId) => {
    placements.forEach((p) => {
      const key = bandKey(p)
      if (!placementsByBand.has(key)) placementsByBand.set(key, [])
      placementsByBand.get(key).push({ ...p, groupId })
    })
  })
  const interleaveMessages = new Set()
  placementsByBand.forEach((band) => {
    band.sort((a, b) => (a.el.row_start ?? 0) - (b.el.row_start ?? 0))
    const indicesByGroup = new Map()
    band.forEach((p, idx) => {
      if (!indicesByGroup.has(p.groupId)) indicesByGroup.set(p.groupId, [])
      indicesByGroup.get(p.groupId).push(idx)
    })
    indicesByGroup.forEach((indices, groupId) => {
      const minIdx = Math.min(...indices)
      const maxIdx = Math.max(...indices)
      for (let k = minIdx + 1; k < maxIdx; k += 1) {
        if (band[k].groupId !== groupId) {
          interleaveMessages.add(`content group ${groupId} is interleaved with group ${band[k].groupId}. A blank-line-separated group may not be inserted between blocks of another group.`)
        }
      }
    })
    // Vertical order within one band is unambiguous, so a higher-numbered group starting above a
    // lower-numbered group in the same band inverts the user's input order.
    const bandGroupFirstIndices = [...indicesByGroup.entries()]
      .map(([gid, indices]) => ({ gid, firstIdx: Math.min(...indices) }))
      .sort((a, b) => Number(a.gid) - Number(b.gid))
    let maxBandFirstIdx = -Infinity
    bandGroupFirstIndices.forEach(({ gid, firstIdx }) => {
      if (firstIdx < maxBandFirstIdx) {
        interleaveMessages.add(`content group order violation: group ${gid} appears before an earlier group. Keep blank-line-separated content groups in the user's input order.`)
      }
      maxBandFirstIdx = Math.max(maxBandFirstIdx, firstIdx)
    })
  })
  interleaveMessages.forEach((msg) => issues.push(msg))

  // Cross-group input-order check, page-granularity only (rewritten 2026-07-27). Comparing
  // groups' first placements by the global row-major order had the same multi-column false
  // positive as above (a later group legitimately starting at the top of a right-hand column
  // "appeared before" an earlier group's left-column body). Page order is the only unambiguous
  // cross-column sequence, so only a group starting on a strictly EARLIER page than a
  // lower-numbered group is a violation.
  const groupFirstPages = [...placementsByGroup.entries()]
    .map(([groupId, placements]) => ({
      groupId,
      firstPage: Math.min(...placements.map((p) => p.page)),
    }))
    .sort((a, b) => Number(a.groupId) - Number(b.groupId))
  let maxGroupFirstPage = -Infinity
  groupFirstPages.forEach(({ groupId, firstPage }) => {
    if (firstPage < maxGroupFirstPage) {
      issues.push(`content group order violation: group ${groupId} appears before an earlier group. Keep blank-line-separated content groups in the user's input order.`)
    }
    maxGroupFirstPage = Math.max(maxGroupFirstPage, firstPage)
  })

  // ---------------------------------------------------------------------------------------------
  // Content-group cohesion (gap analysis P0-1, added 2026-07-27).
  //
  // A content group is one editorial unit: an image plus the heading/body/caption the user wrote
  // for it. Until now images were not part of any group at all -- the plan schema had no field
  // linking an image to its text -- so nothing stopped the model from placing an image on one page
  // and the passage it illustrates on another, or wedging an unrelated element between them. That
  // is the "images and text never form a relationship" symptom.
  //
  // Group membership is read from contentGroupModel (derived server-side from the user's blank-line
  // boundaries), NOT from any field in the plan, so a candidate cannot dodge this by omitting or
  // mislabelling group_id.
  //
  // Two rules, both purely geometric so they carry no reading-order ambiguity:
  //   1. every element of a group sits on the same page
  //   2. no element of another group intrudes into a group's bounding box
  // Rule 2 is what actually makes a group read as one object: it forbids a foreign image or
  // paragraph from landing inside the rectangle the group occupies.
  const groupByTextSource = contentGroupModel?.groupByTextSource
  const groupByImageId = contentGroupModel?.groupByImageId
  if (groupByTextSource && groupByImageId && (groupByTextSource.size > 0 || groupByImageId.size > 0)) {
    // An image the user pinned as a full-page opener is REQUIRED to sit alone on its page, which
    // directly contradicts group cohesion. The explicit user instruction wins, so those images are
    // excluded from group membership here rather than being reported as separated from their text
    // (confirmed 2026-07-27: pinning images 1/3/5 made every layout unsatisfiable, including the
    // deterministic fallback, so the generation returned nothing at all).
    const forcedImageIds = new Set((forcedFullBleedImages || []).map((n) => `image_${n}`))
    const groupIdOfElement = (el) => {
      if (el.type === 'image') {
        if (forcedImageIds.has(el.id)) return undefined
        return groupByImageId.get(el.id)
      }
      if (el.type === 'text' && el.text_source) return groupByTextSource.get(el.text_source)
      return undefined
    }

    // Where each group's elements ended up, page by page.
    const placementsByGroupId = new Map()
    pages.forEach((page, pageIdx) => {
      ;(page.elements || []).forEach((el) => {
        const gid = groupIdOfElement(el)
        if (gid == null) return
        if (!placementsByGroupId.has(gid)) placementsByGroupId.set(gid, [])
        placementsByGroupId.get(gid).push({ el, page: page.page ?? pageIdx + 1 })
      })
    })

    placementsByGroupId.forEach((placements, gid) => {
      if (placements.length <= 1) return

      // Rule 1: one group, one page. A group split across pages is only reported when it actually
      // contains an image -- text-only group splitting is already covered by the group_id checks
      // above (and is downgraded there while its repair is rebuilt), whereas an image separated
      // from its own caption/heading is the specific failure this section exists to catch.
      const pagesUsed = [...new Set(placements.map((p) => p.page))]
      const hasImage = placements.some((p) => p.el.type === 'image')
      if (pagesUsed.length > 1 && hasImage) {
        issues.push(`❌ 콘텐츠 그룹 분리: 그룹 ${gid}의 이미지와 관련 텍스트가 서로 다른 페이지(${pagesUsed.join(', ')})에 배치되었습니다. 이미지와 그 이미지에 대한 제목·본문·출처는 같은 페이지에 함께 두세요.`)
      }

      // Rule 2: nothing foreign inside the group's rectangle, evaluated per page.
      pagesUsed.forEach((pageNo) => {
        const onPage = placements.filter((p) => p.page === pageNo)
        if (onPage.length <= 1) return
        const box = {
          col_start: Math.min(...onPage.map((p) => p.el.col_start)),
          col_end: Math.max(...onPage.map((p) => p.el.col_start + p.el.col_span - 1)),
          row_start: Math.min(...onPage.map((p) => p.el.row_start)),
          row_end: Math.max(...onPage.map((p) => p.el.row_start + p.el.row_span - 1)),
        }
        const pageObj = pages.find((pg, i) => (pg.page ?? i + 1) === pageNo)
        ;(pageObj?.elements || []).forEach((el) => {
          const otherGid = groupIdOfElement(el)
          if (otherGid == null || otherGid === gid) return
          const overlaps = el.col_start <= box.col_end
            && el.col_start + el.col_span - 1 >= box.col_start
            && el.row_start <= box.row_end
            && el.row_start + el.row_span - 1 >= box.row_start
          if (overlaps) {
            issues.push(`❌ 콘텐츠 그룹 침범: 그룹 ${otherGid}의 요소 ${el.id}가 그룹 ${gid}이 차지한 영역 안에 배치되었습니다 (page ${pageNo}). 서로 다른 콘텐츠 그룹은 영역이 겹치지 않게 분리하세요.`)
          }
        })
      })
    })
  }

  if (!hasBodyText) {
    issues.push('본문 텍스트 영역(role: body)이 존재하지 않습니다')
  }

  if ((imageCount ?? seenImageIndices.size) >= 2 && imagePageIndices.length > 0 && textPageIndices.length > 0) {
    const lastImagePage = Math.max(...imagePageIndices)
    const firstTextPage = Math.min(...textPageIndices)
    if (lastImagePage < firstTextPage) {
      issues.push(`❌ 이미지-텍스트 분리: 모든 이미지가 page ${lastImagePage} 이전에 끝나고 텍스트는 page ${firstTextPage}부터 시작합니다. 이미지와 관련 텍스트를 같은 페이지 또는 같은 스프레드에 섞어 배치하세요.`)
    }
  }

  // Paragraph order check: the user split their input into paragraphs in a specific sequence on
  // purpose. A later paragraph_N appearing on an EARLIER page than an earlier paragraph_M (M < N)
  // means the LLM reordered content to chase image proximity, breaking the reading flow the user
  // authored (confirmed 2026-07-27: section content the user wrote near the end of the input
  // appeared on an earlier page than paragraphs that preceded it). This only checks page-level
  // ordering (not exact position within a page), since flow_regions/columns can legitimately
  // interleave a paragraph's own continuation across a page without inverting intent.
  const paragraphFirstPage = new Map()
  pages.forEach((page, pageIdx) => {
    const elements = Array.isArray(page.elements) ? page.elements : []
    elements.forEach((el) => {
      const match = el.text_source && /^paragraph_(\d+)$/.exec(el.text_source)
      if (!match) return
      const n = Number(match[1])
      if (!paragraphFirstPage.has(n)) paragraphFirstPage.set(n, pageIdx)
    })
  })
  let maxPageSoFar = -1
  ;[...paragraphFirstPage.keys()].sort((a, b) => a - b).forEach((n) => {
    const firstPage = paragraphFirstPage.get(n)
    if (firstPage < maxPageSoFar) {
      issues.push(`❌ 문단 순서 위반: paragraph_${n}이 앞선 문단들(최대 page ${maxPageSoFar + 1})보다 이른 page ${firstPage + 1}에 배치되었습니다. 사용자가 입력한 문단 순서를 유지하세요.`)
    }
    maxPageSoFar = Math.max(maxPageSoFar, firstPage)
  })

  if (Number.isInteger(imageCount)) {
    for (let n = 1; n <= imageCount; n += 1) {
      if (!seenImageIndices.has(n)) issues.push(`업로드된 이미지 image_${n}이 배치되지 않았습니다`)
    }
  }

  // User-forced full-bleed images (userLayoutSettings.forced_full_bleed_images): the user
  // explicitly requested specific uploaded images always render as a full-page opener, not a
  // probabilistic LLM choice. Unlike the frequency hint (which the LLM may or may not follow),
  // this is a hard requirement -- an image the user pinned that didn't get "bleed": "full" fails
  // validation just like an unplaced image does.
  if (Array.isArray(forcedFullBleedImages)) {
    const forcedSet = new Set(forcedFullBleedImages.map((n) => Number(n)))
    forcedFullBleedImages.forEach((n) => {
      if (!seenFullBleedImageIndices.has(Number(n))) {
        issues.push(`❌ 사용자가 풀페이지로 지정한 이미지 image_${n}이 "bleed": "full"로 배치되지 않았습니다. 해당 이미지를 다른 요소 없이 단독으로 페이지 전체를 채우도록 배치하세요.`)
      }
    })
    if (allowUnforcedFullBleed === false) {
      seenFullBleedImageIndices.forEach((n) => {
        if (!forcedSet.has(Number(n))) {
          issues.push(`❌ 체크하지 않은 이미지 image_${n}이 풀페이지로 배치되었습니다. 체크한 이미지만 "bleed": "full"을 사용할 수 있습니다.`)
        }
      })
    }
  }

  if (plan.overflow_policy?.body_overflow !== 'continue_to_next_page') {
    issues.push(`overflow_policy.body_overflow는 continue_to_next_page여야 합니다 (받은 값: ${plan.overflow_policy?.body_overflow})`)
  }

  // Grid-preset supplement fields (all optional, but if present must be self-consistent).
  if (plan.grid_spec) {
    const gs = plan.grid_spec
    if (!Number.isInteger(gs.columns) || gs.columns < 1) {
      issues.push(`grid_spec.columns는 양의 정수여야 합니다 (받은 값: ${gs.columns})`)
    }
    if (!Number.isInteger(gs.rows) || gs.rows < 1) {
      issues.push(`grid_spec.rows는 양의 정수여야 합니다 (받은 값: ${gs.rows})`)
    }
    if (typeof gs.gutter_mm !== 'number' || gs.gutter_mm < 0) {
      issues.push(`grid_spec.gutter_mm는 음이 아닌 숫자여야 합니다 (받은 값: ${gs.gutter_mm})`)
    }
    if (gs.page_size && !['A5', 'A4', 'B5', 'custom'].includes(gs.page_size)) {
      issues.push(`grid_spec.page_size는 A5|A4|B5|custom 중 하나여야 합니다 (받은 값: ${gs.page_size})`)
    }
    if (gs.margin_preset && !['recommended', 'narrow', 'wide', 'custom'].includes(gs.margin_preset)) {
      issues.push(`grid_spec.margin_preset는 recommended|narrow|wide|custom 중 하나여야 합니다 (받은 값: ${gs.margin_preset})`)
    }
    if (gs.grid_mode && !['strict', 'flexible'].includes(gs.grid_mode)) {
      issues.push(`grid_spec.grid_mode는 strict|flexible 중 하나여야 합니다 (받은 값: ${gs.grid_mode})`)
    }
  }

  if (Array.isArray(plan.reserved_regions)) {
    plan.reserved_regions.forEach((region, i) => {
      if (!Number.isInteger(region.col_start) || !Number.isInteger(region.col_span) || region.col_span < 1) {
        issues.push(`reserved_regions[${i}]: col_start/col_span 값이 잘못되었습니다`)
      }
      if (!Number.isInteger(region.row_start) || !Number.isInteger(region.row_span) || region.row_span < 1) {
        issues.push(`reserved_regions[${i}]: row_start/row_span 값이 잘못되었습니다`)
      }
      // Check reserved regions against active grid (user's grid_spec or defaults)
      if (region.col_start < 1 || region.col_start + region.col_span - 1 > activeColumns) {
        issues.push(`reserved_regions[${i}]: col 범위가 grid(1~${activeColumns})를 벗어났습니다`)
      }
      if (region.row_start < 1 || region.row_start + region.row_span - 1 > activeRows) {
        issues.push(`reserved_regions[${i}]: row 범위가 grid(1~${activeRows})를 벗어났습니다`)
      }
    })
  }

  if (typeof plan.layout_variation === 'string' && plan.layout_variation.length === 0) {
    issues.push('layout_variation는 비어 있지 않은 문자열이어야 합니다')
  }

  if (plan.text_flow) {
    const tf = plan.text_flow
    if (tf.mode && !['block_flow', 'column_flow', 'none'].includes(tf.mode)) {
      issues.push(`text_flow.mode는 block_flow|column_flow|none 중 하나여야 합니다 (받은 값: ${tf.mode})`)
    }
    if (Array.isArray(tf.flow_regions)) {
      tf.flow_regions.forEach((region, i) => {
        if (!Number.isInteger(region.col_start) || !Number.isInteger(region.col_span) || region.col_span < 1) {
          issues.push(`text_flow.flow_regions[${i}]: col 값이 잘못되었습니다`)
        }
        if (!Number.isInteger(region.row_start) || !Number.isInteger(region.row_span) || region.row_span < 1) {
          issues.push(`text_flow.flow_regions[${i}]: row 값이 잘못되었습니다`)
        }
      })
    }
    if (tf.overflow_policy?.body_overflow && tf.overflow_policy.body_overflow !== 'continue_to_next_page') {
      issues.push(`text_flow.overflow_policy.body_overflow는 continue_to_next_page여야 합니다 (받은 값: ${tf.overflow_policy.body_overflow})`)
    }
  }

  // Phase 5: Grid specification and span variation checks (after pages are analyzed)
  if (plan.grid_spec) {
    spanAnalysis = analyzeSpanVariation(plan)
    if (spanAnalysis.forcedRigidColumns) {
      issues.push(`❌ 모든 텍스트가 동일한(또는 1-column) 폭으로 강제 배치됨 (columns=${plan.grid_spec.columns}): grid는 이미지/텍스트의 span(1~${plan.grid_spec.columns}열)을 정하는 정렬 기준일 뿐, 모든 요소를 1열 폭으로 채우라는 뜻이 아닙니다. 문단마다 다른 col_span(2열, 3열 등)을 사용하세요.`)
    }

    // Design-quality observation, not a blocker: same-span images can be a deliberate editorial
    // choice (equal comparison, before/after pair, a case series meant to read as one visual
    // rhythm) rather than a mistake, so this is a warning rather than a rejection.
    const imageCountSeen = seenImageIndices.size
    if (imageCountSeen >= 2 && !spanAnalysis.image_span_variation_used) {
      warnings.push(`⚠️ 이미지 span 다양화 부족: ${imageCountSeen}장의 이미지가 모두 같은 크기로 배치됨. 1-column, 2-column, 3-column 등을 혼합하면 더 좋습니다.`)
    }

    // Phase 5: Warn if column_flow_grid is used (fallback only)
    if (plan.composition_strategy === 'column_flow_grid') {
      warnings.push(`⚠️  Phase 5: column_flow_grid는 fallback입니다. image_text_case_blocks, asymmetrical 등을 우선 사용하세요.`)
    }
  }

  // Phase 5-2: Detect rigid zigzag alternating pattern
  if (plan.composition_strategy !== 'column_flow_grid' && isZigzagPattern(plan)) {
    issues.push(`❌ Phase 5-2: 고정된 지그재그 패턴 감지: 이미지가 왼쪽-오른쪽으로 반복 교대로 배치됨. 더 유연한 배치를 사용하세요.`)
  }

  // Phase 5-2: Strong warning for column_flow_grid (should be rare/fallback only)
  if (plan.composition_strategy === 'column_flow_grid' && imageCount >= 1) {
    warnings.push(`⚠️  Phase 5-2: column_flow_grid는 fallback입니다. image_text_case_blocks 등을 우선 사용하세요.`)
  }

  // Phase 5-2: Text capacity validation (detect overflow)
  const textCapacityIssues = validateLayoutTextCapacity(plan, textBlocks)
  textCapacityIssues.forEach((issue) => {
    issues.push(`❌ 텍스트 오버플로우: ${issue.elementId} (page ${issue.page}): ${issue.reason}`)
  })

  // Collision validation: text-image overlap, gap checks. validateCollisions returns structured
  // objects ({ type, severity, reason, ... }); every other check here pushes a plain string. Only
  // blocking errors are surfaced (as strings, to keep `issues` a flat string list the callers/tests
  // expect); severity:'warning' gap notices are advisory and intentionally non-blocking.
  const collisionResult = validateCollisions(plan, {
    gridMode: plan.grid_spec?.grid_mode || 'strict',
    useExpandedBbox: true,  // Phase 5: Use expanded bounding box for strict collision check
  })
  collisionResult.issues
    .filter((i) => i.severity === 'error')
    .forEach((i) => issues.push(`요소 충돌(${i.type}): ${i.element_a} ↔ ${i.element_b} (page ${i.page}) — ${i.reason}`))

  // A plan is valid only when it has zero issues. Previously this filtered on `i.severity === 'error'`,
  // but every check above pushes a *string* (no .severity), so that filter silently passed EVERY
  // plan — disabling the entire validation layer (bad enums, unplaced images, missing paragraphs,
  // forbidden composition strategies all sailed through as passed:true). Now string issues block.
  return {
    passed: issues.length === 0, issues, warnings, layoutSignature: getLayoutSignature(plan),
  }
}
