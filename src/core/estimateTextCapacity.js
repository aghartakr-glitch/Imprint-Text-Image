import { gridToMm } from './gridToMm.js'
import {
  capacityForValidation,
  estimateTextCapacityMm as sharedEstimateTextCapacityMm,
  measuredLengthForValidation,
} from './textMeasure.js'
import { resolvePageGeometry } from './layoutConstants.js'

// Capacity depends on which font the role actually renders in (see buildLatex.js's
// styleCommandForRole) -- a 'title' element renders at 28pt/34pt via \TitleText, not the 9pt/14pt
// body font, so estimating its capacity with body metrics computes a box far too small for even
// one line (confirmed 2026-07-16: a "Macro-trend" title box was sized for ~2 lines of 9pt text,
// but \TitleText's single line alone needs more height than that, so it overflowed down into the
// element below it). Defaults to 'body' so every existing caller that doesn't pass a role keeps
// its previous behavior unchanged.
export function estimateTextCapacityMm(wMm, hMm, role = 'body') {
  return sharedEstimateTextCapacityMm(wMm, hMm, role)
}

export function estimateTextCapacity(gridElement) {
  const box = gridToMm(gridElement)
  return estimateTextCapacityMm(box.wMm, box.hMm, gridElement?.role)
}

// Phase 5-2: Validate if text overflows given box dimensions
// Returns: { overflow: boolean, capacity: number, textLength: number, ratio: number }
export function validateTextOverflow(textContent, gridElement) {
  if (!textContent || !gridElement) {
    return { overflow: false, capacity: 0, textLength: 0, ratio: 0 }
  }

  const capacity = estimateTextCapacity(gridElement)
  const textLength = (textContent || '').length

  // Text overflows if length exceeds capacity by more than 5% (small margin for formatting)
  const ratio = textLength / Math.max(1, capacity)
  const overflow = ratio > 1.05

  return { overflow, capacity, textLength, ratio }
}

// Builds a text_source -> char_count lookup ("paragraph_N" alias, mirroring the same aliasing
// paginateGridPlan.js's buildTextSourceMap uses) so overflow can be checked against a plan's raw
// grid-unit elements (col_start/col_span/row_start/row_span + text_source) BEFORE the plan is ever
// reconstructed into mm zones/slices.
function buildCharCountMap(textBlocks) {
  const map = {}
  if (!Array.isArray(textBlocks)) return map
  textBlocks.forEach((block, index) => {
    const charCount = Number.isFinite(block.char_count) ? block.char_count : (block.text ? block.text.length : null)
    if (charCount == null) return
    if (block.id) map[block.id] = charCount
    map[`paragraph_${index + 1}`] = charCount
  })
  return map
}

function buildTextMap(textBlocks) {
  const map = {}
  if (!Array.isArray(textBlocks)) return map
  textBlocks.forEach((block, index) => {
    if (typeof block.text !== 'string') return
    if (block.id) map[block.id] = block.text
    map[`paragraph_${index + 1}`] = block.text
  })
  return map
}

function buildTextBlockMap(textBlocks) {
  const map = {}
  if (!Array.isArray(textBlocks)) return map
  textBlocks.forEach((block, index) => {
    if (!block) return
    if (block.id) map[block.id] = block
    map[`paragraph_${index + 1}`] = block
  })
  return map
}

function isBodyLikeRole(role) {
  return role === 'body' || role === 'continuation_body' || role == null
}

function allowsBodyContinuation(plan) {
  return plan?.overflow_policy?.body_overflow === 'continue_to_next_page'
    || plan?.text_flow?.overflow_policy?.body_overflow === 'continue_to_next_page'
}

// Phase 5-2: Validate all text elements in a layout don't overflow their declared grid box.
// Runs on the RAW candidate (col_start/col_span/row_start/row_span + text_source), the same shape
// validateLayoutPlan validates everything else against -- checking after-the-fact against the
// resolved mm layout.json (page.textBlocks[].zone/slice) is too late, since reconstructLayout has
// already committed to those exact boxes by then and PDF rendering will overflow them silently
// (confirmed 2026-07-09: a paragraph_source element's full, unsliced text routinely exceeds its
// box and visually bleeds into whatever image or text sits below it).
export function validateLayoutTextCapacity(plan, textBlocks = []) {
  const issues = []
  const pages = Array.isArray(plan.pages) ? plan.pages : []
  const gridSpec = plan.grid_spec || plan.grid
  // boxWidthMm/boxHeightMm from the plan's own page_size/margin_preset (2026-07-28) -- this is the
  // function that produces the "텍스트 오버플로우" error message itself. Without this, EVERY
  // capacity check here silently measured against A5's 116x178mm content box regardless of the
  // plan's actual page_size, so a real B5/A4 layout that fit its own real, larger page was
  // rejected as "overflowing" a box that was never going to be used (confirmed 2026-07-28 from a
  // real generation with grid_spec.page_size: "B5").
  const pageGeometry = resolvePageGeometry(gridSpec?.page_size, gridSpec?.margin_preset)
  const gridOptions = gridSpec?.columns && gridSpec?.rows
    ? {
      columns: gridSpec.columns,
      rows: gridSpec.rows,
      gutterMm: gridSpec.gutter_mm,
      boxWidthMm: pageGeometry.textBoxWidthMm,
      boxHeightMm: pageGeometry.textBoxHeightMm,
    }
    : undefined
  const charCountMap = buildCharCountMap(textBlocks)
  const textMap = buildTextMap(textBlocks)
  const textBlockMap = buildTextBlockMap(textBlocks)
  const canContinueBody = allowsBodyContinuation(plan)

  pages.forEach((page) => {
    const elements = Array.isArray(page.elements) ? page.elements : []
    elements.forEach((el) => {
      if (el.type !== 'text') return

      let textLength = null
      if (Number.isFinite(el.__charCount)) {
        textLength = el.__charCount
      } else if (el.text_source && charCountMap[el.text_source] != null) {
        textLength = charCountMap[el.text_source]
      } else if (typeof el.text === 'string') {
        textLength = el.text.length
      }
      if (textLength == null) return

      // Note: validateTextOverflow (and estimateTextCapacity) expect a raw grid-unit element and
      // run it through gridToMm themselves -- `box` here is already in mm, so capacity must be
      // computed directly via estimateTextCapacityMm rather than passing `box` back through
      // validateTextOverflow (which would re-run gridToMm on {wMm, hMm}, treating them as a
      // nonexistent col_start/row_start and silently producing NaN).
      const box = gridToMm(el, gridOptions)
      const sourceText = el.__text || (el.text_source ? textMap[el.text_source] : null) || el.text || ''
      const capacity = capacityForValidation({ text: sourceText, charCount: textLength, role: el.role, wMm: box.wMm, hMm: box.hMm })
      const measuredLength = measuredLengthForValidation({ text: sourceText, charCount: textLength, role: el.role })
      const ratio = measuredLength / Math.max(1, capacity)
      if (ratio > 1.05) {
        const sourceRole = el.text_source ? textBlockMap[el.text_source]?.role : null
        const renderRole = sourceRole || el.role
        const isContinuableBodySource = el.text_source && isBodyLikeRole(renderRole)
        // Body text_source elements are rendered by paginateGridPlan as a flow: the first box gets
        // the slice that fits, and the remaining text continues onto later boxes/pages. Rejecting
        // the raw candidate just because the *whole* paragraph does not fit this starter box wastes
        // a paid LLM result even though the renderer has a deterministic no-loss continuation path.
        // Keep headings/labels strict, and still reject 1-row body starters elsewhere in
        // validateLayoutPlan because they create useless one-word fragments.
        if (canContinueBody && isContinuableBodySource && el.row_span > 1 && capacity > 0) return
        issues.push({
          elementId: el.id,
          page: page.page,
          textLength: measuredLength,
          capacity,
          ratio: ratio.toFixed(2),
          reason: `텍스트 오버플로우 (길이 ${measuredLength.toFixed ? measuredLength.toFixed(1) : measuredLength}u / 용량 ${capacity}u, 비율 ${ratio.toFixed(2)}x, 박스 ${box.wMm.toFixed(1)}×${box.hMm.toFixed(1)}mm)`
        })
      }
    })
  })

  return issues
}
