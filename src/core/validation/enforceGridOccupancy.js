// Final, guaranteed-complete overlap elimination pass. Unlike repairCollisions.js (which nudges
// pairwise -- cheap, preserves the LLM's near-original intent, but can fail to converge when 3+
// elements mutually overlap), this pass CANNOT leave a page with any remaining overlap: it walks
// every element in a fixed priority order, claiming its requested cell rectangle if free, or
// deterministically finding the nearest free rectangle of the same size on the same page, or (if
// none exists on the page) moving it to a new page. Every element ends up somewhere, unique cells
// only, by construction -- there is no case this can fail to resolve short of a paragraph too long
// to fit on any single page (which repairTextOverflow already leaves for validation to flag).
import { createOccupancyGrid, isFree, occupy, findNearestFreeSlot } from './gridOccupancy.js'

const ROLE_PRIORITY = {
  image: 0,
  section_label: 1,
  title: 1,
  body: 2,
  caption: 3,
}

function priorityOf(el) {
  if (el.type === 'image') return ROLE_PRIORITY.image
  return ROLE_PRIORITY[el.role] ?? 2
}

function getGridColumns(plan) {
  return plan.grid_spec?.columns ?? plan.grid?.columns ?? 6
}

function getGridRows(plan) {
  return plan.grid_spec?.rows ?? plan.grid?.rows ?? 12
}

function renumberPages(pages) {
  pages.forEach((page, i) => { page.page = i + 1 })
}

export function enforceGridOccupancy(plan) {
  if (!plan || !Array.isArray(plan.pages)) return { plan, repaired: false, actions: [] }

  const columns = getGridColumns(plan)
  const rows = getGridRows(plan)
  const workingPlan = JSON.parse(JSON.stringify(plan))
  const actions = []
  let anyRepaired = false

  // Process pages in array order; new pages appended by an overflow move are processed in their
  // own turn since the outer loop re-reads workingPlan.pages.length each iteration.
  for (let pageIndex = 0; pageIndex < workingPlan.pages.length; pageIndex += 1) {
    const page = workingPlan.pages[pageIndex]
    const elements = Array.isArray(page.elements) ? page.elements : []

    // Stable priority order: images anchor first, then labels/titles, then body, then captions --
    // matches editorial convention (image position drives the page, text fills around it) and
    // means body text is what gets relocated on conflict, not the image the reader expects to see
    // where the LLM put it.
    const ordered = [...elements].sort((a, b) => priorityOf(a) - priorityOf(b))
    const grid = createOccupancyGrid(columns, rows)

    ordered.forEach((el) => {
      const { col_start: colStart, col_span: colSpan, row_start: rowStart, row_span: rowSpan } = el

      if (isFree(grid, colStart, colSpan, rowStart, rowSpan)) {
        occupy(grid, colStart, colSpan, rowStart, rowSpan, el.id)
        return
      }

      const slot = findNearestFreeSlot(grid, colSpan, rowSpan, colStart, rowStart)
      if (slot) {
        occupy(grid, slot.colStart, colSpan, slot.rowStart, rowSpan, el.id)
        if (slot.colStart !== colStart || slot.rowStart !== rowStart) {
          actions.push({
            page: page.page,
            element: el.id,
            from: { col_start: colStart, row_start: rowStart },
            to: { col_start: slot.colStart, row_start: slot.rowStart },
            reason: '다른 요소와의 칸 충돌로 같은 페이지의 빈 칸으로 재배치',
          })
          el.col_start = slot.colStart
          el.row_start = slot.rowStart
          anyRepaired = true
        }
        return
      }

      // No free rectangle of this size exists anywhere on the current page -- move to a fresh page
      // (existing next page if present, otherwise a newly created one) at the top-left, which is
      // guaranteed free on an empty page as long as the element's own span fits the grid at all.
      page.elements = page.elements.filter((e) => e !== el)
      let nextPage = workingPlan.pages[pageIndex + 1]
      if (!nextPage) {
        nextPage = { page: page.page + 1, elements: [] }
        workingPlan.pages.splice(pageIndex + 1, 0, nextPage)
      }
      nextPage.elements.push({ ...el, col_start: 1, row_start: 1 })
      renumberPages(workingPlan.pages)
      actions.push({
        page: page.page,
        element: el.id,
        reason: '같은 페이지에 빈 칸이 없어 다음 페이지로 이동',
      })
      anyRepaired = true
    })
  }

  return { plan: workingPlan, repaired: anyRepaired, actions }
}
