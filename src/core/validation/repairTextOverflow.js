// Deterministic, API-free text-overflow repair: the LLM reliably picks good *positions* but is bad
// at sizing a box to hold a given paragraph's characters (confirmed 2026-07-10: real candidates
// overflowed body boxes by 1.1x-3.5x). Rather than reject and re-ask the model to guess better
// numbers, grow the box until its capacity clears the character count:
//   1. grow row_span first (least disruptive -- doesn't touch neighboring columns)
//   2. if that runs into the bottom of the grid before fitting, widen col_span too
//   3. if even the full remaining page (current column, full grid height, up to full width)
//      can't hold it, move the element wholesale onto a fresh page with the full page height
//      available, rather than leaving it overflowing in place
// Any new overlap this creates is left for repairCollisions to shift apart afterward (it runs
// after this step in callLayoutLLM.js's repair chain). Never touches the text itself -- text is
// never shrunk, summarized, or dropped.
import { gridToMm } from '../gridToMm.js'
import { estimateTextCapacityMm } from '../estimateTextCapacity.js'

const OVERFLOW_TOLERANCE = 1.05 // must match validateLayoutTextCapacity's ratio threshold

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

function capacityFor(el, colSpan, rowSpan, gridOptions) {
  const box = gridToMm({ ...el, col_span: colSpan, row_span: rowSpan }, gridOptions)
  return estimateTextCapacityMm(box.wMm, box.hMm, el.role)
}

// Searches col_span x row_span combinations reachable from the element's current position,
// preferring to grow height alone first (checked at the element's current col_span before any
// column is added) and only widening once row growth alone is exhausted.
function findFittingSpan(el, charCount, columns, rows, gridOptions) {
  const maxColSpan = columns - el.col_start + 1
  const maxRowSpan = rows - el.row_start + 1
  for (let colSpan = el.col_span; colSpan <= maxColSpan; colSpan += 1) {
    for (let rowSpan = el.row_span; rowSpan <= maxRowSpan; rowSpan += 1) {
      const capacity = capacityFor(el, colSpan, rowSpan, gridOptions)
      if (capacity > 0 && charCount / capacity <= OVERFLOW_TOLERANCE) return { colSpan, rowSpan }
    }
  }
  return null
}

// Last resort: a fresh page gives the element the full grid height from row 1, so only col_span
// needs to grow (up to the full grid width) to find a fit.
function findFullPageSpan(el, charCount, columns, rows, gridOptions) {
  for (let colSpan = el.col_span; colSpan <= columns; colSpan += 1) {
    const capacity = capacityFor({ ...el, col_start: 1 }, colSpan, rows, gridOptions)
    if (capacity > 0 && charCount / capacity <= OVERFLOW_TOLERANCE) return { colSpan, rowSpan: rows }
  }
  return null
}

function renumberPages(pages) {
  pages.forEach((page, i) => { page.page = i + 1 })
}

export function repairTextOverflow(plan, textBlocks = []) {
  if (!plan || !Array.isArray(plan.pages)) return { plan, repaired: false, actions: [] }

  const columns = plan.grid_spec?.columns ?? plan.grid?.columns ?? 6
  const rows = plan.grid_spec?.rows ?? plan.grid?.rows ?? 12
  const gridSpec = plan.grid_spec || plan.grid
  const gridOptions = gridSpec?.columns && gridSpec?.rows
    ? { columns: gridSpec.columns, rows: gridSpec.rows, gutterMm: gridSpec.gutter_mm }
    : undefined
  const charCountMap = buildCharCountMap(textBlocks)

  const workingPlan = JSON.parse(JSON.stringify(plan))
  const actions = []

  for (let pageIndex = 0; pageIndex < workingPlan.pages.length; pageIndex += 1) {
    const page = workingPlan.pages[pageIndex]
    const elements = Array.isArray(page.elements) ? page.elements : []

    elements.forEach((el) => {
      if (el.type !== 'text') return

      let charCount = null
      if (el.text_source && charCountMap[el.text_source] != null) charCount = charCountMap[el.text_source]
      else if (typeof el.text === 'string') charCount = el.text.length
      if (charCount == null) return

      const currentCapacity = capacityFor(el, el.col_span, el.row_span, gridOptions)
      if (currentCapacity > 0 && charCount / currentCapacity <= OVERFLOW_TOLERANCE) return // already fits

      const fit = findFittingSpan(el, charCount, columns, rows, gridOptions)
      if (fit) {
        actions.push({
          page: page.page,
          element: el.id,
          action: 'expand_span',
          from: { col_span: el.col_span, row_span: el.row_span },
          to: fit,
          reason: `텍스트(${charCount}자)가 박스를 초과하여 span 확장`,
        })
        el.col_span = fit.colSpan
        el.row_span = fit.rowSpan
        return
      }

      // Not even the full remaining space on this page (from the element's own column, down to
      // the grid bottom, widened up to the full grid) can hold it -- move to a fresh page with
      // the full page height available instead of leaving it overflowing in place.
      const fallback = findFullPageSpan(el, charCount, columns, rows, gridOptions)
      if (fallback) {
        page.elements = page.elements.filter((e) => e !== el)
        let nextPage = workingPlan.pages[pageIndex + 1]
        if (!nextPage) {
          nextPage = { page: page.page + 1, elements: [] }
          workingPlan.pages.splice(pageIndex + 1, 0, nextPage)
        }
        nextPage.elements.push({
          ...el, col_start: 1, col_span: fallback.colSpan, row_start: 1, row_span: fallback.rowSpan,
        })
        renumberPages(workingPlan.pages)
        actions.push({
          page: page.page,
          element: el.id,
          action: 'move_to_next_page',
          reason: `텍스트(${charCount}자)가 이 페이지에서 들어갈 공간이 없어 다음 페이지로 이동`,
        })
      }
      // If even the full-page fallback can't fit, the paragraph is simply too long for any single
      // page at any span -- leave it as-is. Validation will still (correctly) flag it; this repair
      // never truncates, shrinks, or drops text to force a fit.
    })
  }

  return { plan: workingPlan, repaired: actions.length > 0, actions }
}
