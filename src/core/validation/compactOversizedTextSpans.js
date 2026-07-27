// Deterministic, API-free spacing repair: the LLM reliably OVER-sizes text boxes far beyond what
// their actual content needs (confirmed 2026-07-16: a single 9-character heading "커뮤니티 액티비즘"
// was given a 70mm-tall box, leaving a huge dead gap before the next element stacked below it in
// the same column). Shrinks each text element's row_span down to the minimum its actual content
// needs, then pulls everything below it in the same column (identical col_start/col_span) up to
// close the gap. Only ever shrinks -- growing an undersized box is repairTextOverflow's job, run
// separately earlier in the chain.
import { gridToMm } from '../gridToMm.js'
import { estimateTextCapacityMm } from '../estimateTextCapacity.js'

const FIT_TOLERANCE = 1.05 // must match repairTextOverflow's OVERFLOW_TOLERANCE

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

function capacityFor(el, rowSpan, gridOptions) {
  const box = gridToMm({ ...el, row_span: rowSpan }, gridOptions)
  return estimateTextCapacityMm(box.wMm, box.hMm, el.role)
}

// Smallest row_span (>=1) whose capacity still comfortably holds charCount, searching up from 1.
// Falls back to the element's current row_span if nothing smaller actually fits (never shrinks
// into an overflow).
function minimumRowSpan(el, charCount, gridOptions) {
  for (let rowSpan = 1; rowSpan <= el.row_span; rowSpan += 1) {
    const capacity = capacityFor(el, rowSpan, gridOptions)
    if (capacity > 0 && charCount / capacity <= FIT_TOLERANCE) return rowSpan
  }
  return el.row_span
}

export function compactOversizedTextSpans(plan, textBlocks = []) {
  if (!plan || !Array.isArray(plan.pages)) return { plan, repaired: false, actions: [] }

  const gridSpec = plan.grid_spec || plan.grid
  const gridOptions = gridSpec?.columns && gridSpec?.rows
    ? { columns: gridSpec.columns, rows: gridSpec.rows, gutterMm: gridSpec.gutter_mm }
    : undefined
  const charCountMap = buildCharCountMap(textBlocks)

  const workingPlan = JSON.parse(JSON.stringify(plan))
  const actions = []

  workingPlan.pages.forEach((page) => {
    const elements = Array.isArray(page.elements) ? page.elements : []

    // Group text elements sharing the exact same horizontal placement -- they're the ones meant to
    // read as one stacked column. Images and elements with no resolvable text are left untouched
    // (not compacted, not shifted), since their footprint isn't a function of text content.
    const groups = new Map()
    elements.forEach((el) => {
      if (el.type !== 'text') return
      let charCount = null
      if (el.text_source && charCountMap[el.text_source] != null) charCount = charCountMap[el.text_source]
      else if (typeof el.text === 'string') charCount = el.text.length
      if (charCount == null) return

      const key = `${el.col_start}:${el.col_span}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push({ el, charCount })
    })

    groups.forEach((group) => {
      group.sort((a, b) => a.el.row_start - b.el.row_start)
      let shift = 0
      group.forEach(({ el, charCount }) => {
        const originalRowStart = el.row_start
        const originalRowSpan = el.row_span
        el.row_start = originalRowStart - shift

        const minSpan = minimumRowSpan(el, charCount, gridOptions)
        if (minSpan < originalRowSpan) {
          const freed = originalRowSpan - minSpan
          el.row_span = minSpan
          shift += freed
          actions.push({
            page: page.page,
            element: el.id,
            action: 'compact_span',
            from: { row_start: originalRowStart, row_span: originalRowSpan },
            to: { row_start: el.row_start, row_span: minSpan },
            reason: `텍스트가 배정된 공간의 일부만 사용하여 row_span 축소 (${originalRowSpan} → ${minSpan})`,
          })
        }
      })
    })
  })

  return { plan: workingPlan, repaired: actions.length > 0, actions }
}
