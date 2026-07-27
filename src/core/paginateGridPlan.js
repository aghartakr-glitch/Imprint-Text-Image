// CRITICAL FIX: Each paragraph is now a MODULAR TEXT BLOCK, never merged or sequentially paginated.
// This enables images and paragraphs to interleave as intended (see PDF example: text-image-text-image).

import { gridToMm } from './gridToMm.js'
import { estimateTextCapacityMm } from './estimateTextCapacity.js'
import {
  GRID_COLUMNS, GRID_ROWS, TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM,
  PT_TO_MM, ROLE_FONT_SIZE_PT, ROLE_LEADING_PT, ROLE_BOLD_WIDTH_FACTOR, CHAR_WIDTH_CALIBRATION_FACTOR,
} from './layoutConstants.js'

export function sliceAtWordBoundary(text, capacity) {
  if (text.length <= capacity) return { slice: text, consumed: text.length }
  const hardCut = text.slice(0, capacity)
  const lastBreak = Math.max(hardCut.lastIndexOf(' '), hardCut.lastIndexOf('\n'))
  if (lastBreak <= 0) return { slice: hardCut, consumed: hardCut.length }
  const slice = hardCut.slice(0, lastBreak)
  let consumed = lastBreak
  while (consumed < text.length && /\s/.test(text[consumed])) consumed += 1
  return { slice, consumed }
}

// Build text_source → paragraph_text mapping.
// CRITICAL: Each textBlock is treated as an INDEPENDENT unit, never split across pages.
//
// The LLM references paragraphs by ordinal position as "paragraph_N" (enforced by the schema and
// validateLayoutPlan's /^(title|paragraph_\d+)$/ regex), but parseDocumentStructure assigns block
// ids in a different format ("p1", "p2", ...). Registering ONLY block.id here means a valid
// interleaved plan (text_source: "paragraph_1") never matches, so every text element gets a null
// slice and the whole body silently disappears. Fix: alias each block under BOTH its native id
// AND its positional "paragraph_{index+1}" key so either reference resolves to the same paragraph.
function buildTextSourceMap(textBlocks) {
  if (!Array.isArray(textBlocks) || textBlocks.length === 0) {
    return {}
  }
  const map = {}
  textBlocks.forEach((block, index) => {
    if (!block.text) return
    if (block.id) map[block.id] = block.text // native id, e.g. "p1"
    map[`paragraph_${index + 1}`] = block.text // ordinal alias the LLM actually emits
  })
  return map
}

function buildTextSourceBlockMap(textBlocks) {
  const map = {}
  if (!Array.isArray(textBlocks)) return map
  textBlocks.forEach((block, index) => {
    if (!block.text) return
    if (block.id) map[block.id] = block
    map[`paragraph_${index + 1}`] = block
  })
  return map
}

function sourceIndex(textSource, textBlocks) {
  const paragraphMatch = /^paragraph_(\d+)$/.exec(textSource || '')
  if (paragraphMatch) return Number(paragraphMatch[1]) - 1
  return textBlocks.findIndex((block) => block.id === textSource)
}

// Break a sequence of role-tagged segments into full-page overflow continuation pages, preserving
// each segment's role instead of flattening everything to role:'body' plain text (confirmed
// 2026-07-27: a real document's markdown headings -- e.g. "## 지역 영감 디자인" / "## COMMUNITY
// INSPIRED" -- lost all heading styling and were silently merged into one giant body paragraph,
// because every paragraph the LLM's layout_plan didn't explicitly reference used to be joined into
// a single string and rendered through one fixed role:'body' box, discarding block.role entirely).
// Segments are placed one at a time down a full-width column; a segment that doesn't fit the
// remaining room on the current page is sliced at a word boundary (never mid-word) and its
// continuation carries over to the next page, same word-boundary-safe guarantee as before.
function normalizedRoleForRendering(role) {
  if (role === 'section_title' || role === 'case_title' || role === 'case_title_ko' || role === 'case_title_en' || role === 'label') return 'section_label'
  if (role === 'title' || role === 'subtitle' || role === 'section_label' || role === 'page_number' || role === 'continuation_body') return role
  return 'body'
}

function estimateTextHeightMm(text, role = 'body', widthMm = TEXT_BOX_WIDTH_MM) {
  const renderRole = normalizedRoleForRendering(role)
  const fontSizePt = ROLE_FONT_SIZE_PT[renderRole] ?? ROLE_FONT_SIZE_PT.body
  const leadingPt = ROLE_LEADING_PT[renderRole] ?? ROLE_LEADING_PT.body
  const boldFactor = ROLE_BOLD_WIDTH_FACTOR[renderRole] ?? 1
  const charWidthMm = fontSizePt * PT_TO_MM * boldFactor * CHAR_WIDTH_CALIBRATION_FACTOR
  const lineHeightMm = leadingPt * PT_TO_MM
  const charsPerLine = Math.max(1, Math.floor(widthMm / Math.max(charWidthMm, 0.1)))
  const visualLines = String(text || '').split('\n').reduce((sum, line) => {
    if (line.trim().length === 0) return sum + 1
    return sum + Math.max(1, Math.ceil(line.length / charsPerLine))
  }, 0)
  return Math.max(lineHeightMm, visualLines * lineHeightMm)
}

// Overflow pages are not LLM-composed grid pages. They are a faithful reading-order continuation
// of the user's source structure, so place them by real text height instead of coarse 12-row grid
// units. This preserves the user's newline semantics: no blank line = compact line/heading flow;
// blank line/new group = visible paragraph gap.
function buildOverflowPages(segments, gridSpec) {
  const pages = []
  let elementIndex = 0
  let yCursor = 0
  let currentPageElements = []
  let currentPageSlices = {}
  let lastGroupId = null

  const sameGroupGapMm = 1.2
  const newGroupGapMm = 5

  function flushPage() {
    if (currentPageElements.length > 0) {
      pages.push({ elements: currentPageElements, textSlicesByElementId: currentPageSlices })
    }
    currentPageElements = []
    currentPageSlices = {}
    yCursor = 0
    lastGroupId = null
  }

  const queue = segments
    .filter((seg) => seg.text && seg.text.length > 0)
    .map((seg) => ({ role: normalizedRoleForRendering(seg.role || 'body'), text: seg.text, group_id: seg.group_id }))

  function groupHeight(startIndex, groupId) {
    let height = 0
    let prev = null
    for (let i = startIndex; i < queue.length && queue[i].group_id === groupId; i += 1) {
      if (prev != null) height += sameGroupGapMm
      height += estimateTextHeightMm(queue[i].text, queue[i].role)
      prev = queue[i]
    }
    return height
  }

  while (queue.length > 0) {
    const seg = queue[0]
    const gapMm = currentPageElements.length === 0 ? 0 : (seg.group_id != null && seg.group_id === lastGroupId ? sameGroupGapMm : newGroupGapMm)
    const neededGroupHeight = seg.group_id != null ? groupHeight(0, seg.group_id) : estimateTextHeightMm(seg.text, seg.role)

    if (currentPageElements.length > 0 && seg.group_id !== lastGroupId && yCursor + gapMm + neededGroupHeight <= TEXT_BOX_HEIGHT_MM) {
      // fits as a full group here; continue normally
    } else if (currentPageElements.length > 0 && seg.group_id !== lastGroupId && neededGroupHeight <= TEXT_BOX_HEIGHT_MM && yCursor + gapMm + neededGroupHeight > TEXT_BOX_HEIGHT_MM) {
      flushPage()
      continue
    }

    const yMm = yCursor + gapMm
    const remainingHeight = TEXT_BOX_HEIGHT_MM - yMm
    if (remainingHeight <= 0) {
      flushPage()
      continue
    }

    const desiredHeight = estimateTextHeightMm(seg.text, seg.role)
    const hMm = Math.min(desiredHeight, remainingHeight)
    const capacity = estimateTextCapacityMm(TEXT_BOX_WIDTH_MM, hMm, seg.role)
    const { slice, consumed } = desiredHeight <= remainingHeight
      ? { slice: seg.text, consumed: seg.text.length }
      : sliceAtWordBoundary(seg.text, Math.max(1, capacity))

    if (!slice) {
      flushPage()
      continue
    }

    const id = `body_overflow_${elementIndex}`
    elementIndex += 1
    currentPageElements.push({
      id,
      type: 'text',
      role: seg.role,
      box_mm: { xMm: 0, yMm, wMm: TEXT_BOX_WIDTH_MM, hMm },
    })
    currentPageSlices[id] = slice
    yCursor = yMm + hMm
    lastGroupId = seg.group_id

    const restText = seg.text.slice(consumed)
    if (restText.length > 0) queue[0] = { ...seg, text: restText }
    else queue.shift()
  }

  flushPage()
  return pages
}
// Two content models, one guarantee: no paragraph is ever silently dropped.
//  - Modular (>=2 text blocks): each element's text_source gets the WHOLE referenced paragraph
//    (no sequential slicing), so images and paragraphs interleave. Any paragraph the plan forgets
//    to reference is appended as overflow continuation pages instead of vanishing.
//  - Legacy/continuous (<2 blocks, or no textBlocks): the plan's body boxes are filled in reading
//    order up to each box's capacity, and the remainder continues onto overflow pages.
export function paginateGridPlan(plan, text, textBlocks, gridSpec) {
  const textSourceMap = buildTextSourceMap(textBlocks)
  const textSourceBlockMap = buildTextSourceBlockMap(textBlocks)
  const blocks = Array.isArray(textBlocks) ? textBlocks.filter((b) => b.text) : []

  // DEBUG: Check if textBlocks contain markdown markers
  if (blocks.length > 0) {
    const markerSamples = blocks
      .filter((b) => b.text && b.text.match(/^\s*#+\s/))
      .slice(0, 3)
      .map((b) => b.text.substring(0, 50))
    if (markerSamples.length > 0) {
      console.warn('[paginateGridPlan DEBUG] ⚠️ textBlocks contain markdown markers:')
      markerSamples.forEach((sample) => console.warn(`  - "${sample}..."'`))
    }
  }

  const hasTextSourcePlan = (plan.pages || []).some((p) => (p.elements || []).some((el) => el.type === 'text' && el.text_source))
  const hasModularLayout = blocks.length >= 2 || (blocks.length >= 1 && hasTextSourcePlan)
  console.log(`[paginateGridPlan] blocks.length=${blocks.length}, hasModularLayout=${hasModularLayout}`)

  if (hasModularLayout) {
    const referencedIndices = new Set()
    const consumedByTextSource = {}
    const planPages = plan.pages.map((page) => {
      const textSlicesByElementId = {}
      const elements = page.elements.map((el) => {
        if (el.type !== 'text') return el
        let slice = null
        let renderRole = normalizedRoleForRendering(el.role)
        const sourceBlock = el.text_source ? textSourceBlockMap[el.text_source] : null
        if (sourceBlock?.role) renderRole = normalizedRoleForRendering(sourceBlock.role)

        if (el.text_source && textSourceMap[el.text_source]) {
          const fullText = textSourceMap[el.text_source]
          const start = consumedByTextSource[el.text_source] || 0
          const remaining = fullText.slice(start)

          if (remaining.length > 0) {
            if (renderRole !== 'body' && renderRole !== 'continuation_body') {
              slice = remaining
              consumedByTextSource[el.text_source] = fullText.length
            } else {
              const elementForCapacity = { ...el, role: renderRole }
              const box = gridToMm(elementForCapacity, gridSpec)
              const capacity = estimateTextCapacityMm(box.wMm, box.hMm, renderRole)
              const { slice: fitted, consumed } = sliceAtWordBoundary(remaining, Math.max(1, capacity))
              const trailing = remaining.slice(consumed)
              const shouldAbsorbTinyTail = trailing.trim().length > 0
                && trailing.trim().length <= 18
                && fitted.trim().length >= 40
              slice = shouldAbsorbTinyTail ? remaining : fitted
              consumedByTextSource[el.text_source] = start + (shouldAbsorbTinyTail ? remaining.length : consumed)
            }
          }

          const idx = sourceIndex(el.text_source, blocks)
          if (idx >= 0) referencedIndices.add(idx)
        }
        textSlicesByElementId[el.id] = slice
        return { ...el, role: renderRole }
      })
      return { elements, textSlicesByElementId }
    })
    // Collect leftovers in the original source order. Keeping all unreferenced headings first and
    // all body overflow tails second detached headings from the body lines the user wrote directly
    // beneath them, so preserve each block's own position in the markdown stream.
    const leftoverSegments = blocks
      .map((block, index) => {
        const source = `paragraph_${index + 1}`
        const consumed = consumedByTextSource[source] ?? consumedByTextSource[block.id] ?? 0
        if (referencedIndices.has(index) && consumed >= block.text.length) return null
        return {
          role: referencedIndices.has(index) ? normalizedRoleForRendering(block.role || 'body') : (block.role || 'body'),
          text: referencedIndices.has(index) ? block.text.slice(consumed) : block.text,
          group_id: block.group_id,
        }
      })
      .filter((seg) => seg && seg.text && seg.text.length > 0)

    return [...planPages, ...buildOverflowPages(leftoverSegments, gridSpec)]
  }

  // Legacy continuous flow: fill body boxes in order, then overflow the remainder.
  let remaining = text
  const planPages = plan.pages.map((page) => {
    const textSlicesByElementId = {}
    page.elements.forEach((el) => {
      if (el.type !== 'text') return
      if (el.role !== 'body' || remaining.length === 0) {
        textSlicesByElementId[el.id] = null
        return
      }
      const box = gridToMm(el, gridSpec)
      const capacity = estimateTextCapacityMm(box.wMm, box.hMm, el.role)
      const { slice, consumed } = sliceAtWordBoundary(remaining, Math.max(1, capacity))
      remaining = remaining.slice(consumed)
      textSlicesByElementId[el.id] = slice
    })
    return { elements: page.elements, textSlicesByElementId }
  })

  return [...planPages, ...buildOverflowPages([{ role: 'body', text: remaining }], gridSpec)]
}
