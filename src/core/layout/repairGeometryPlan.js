// Local, zero-API-cost geometry repair. Runs after packEditorialLayout + validateLayoutPlan when
// validation still finds collisions/gaps/capacity problems -- shifts elements down or overflow to
// the next page instead of asking the LLM to retry (LLM calls cost money; this doesn't).
// Never touches text content, font size, leading, or image content -- only col/row geometry.
import { GRID_COLUMNS, GRID_ROWS } from '../layoutConstants.js'
import { validateCollisions } from '../validation/validateCollisions.js'

const ROW_GAP_UNITS = 1

function cloneplan(plan) {
  return {
    ...plan,
    pages: plan.pages.map((p) => ({ ...p, elements: p.elements.map((el) => ({ ...el })) })),
  }
}

// Shifts every element on `page` that starts at or after `fromRow` down by `by` rows. If this
// would push an element past the bottom of the grid, it's moved to the next page instead
// (appended, keeping its col position and row_start reset to 1).
function shiftDown(page, fromRow, by, rows, overflowPage) {
  const kept = []
  page.elements.forEach((el) => {
    if (el.row_start >= fromRow) {
      const newStart = el.row_start + by
      if (newStart + el.row_span - 1 > rows) {
        overflowPage.elements.push({ ...el, row_start: 1 })
        return
      }
      kept.push({ ...el, row_start: newStart })
    } else {
      kept.push(el)
    }
  })
  page.elements = kept
}

// One repair pass: for every reported collision issue, push the later (lower row_start) element
// and everything below it down until the gap is satisfied. Runs entirely locally.
export function repairGeometryPlan(plan, issues = []) {
  const activeColumns = plan.grid_spec?.columns ?? plan.grid?.columns ?? GRID_COLUMNS
  const activeRows = plan.grid_spec?.rows ?? plan.grid?.rows ?? GRID_ROWS
  let working = cloneplan(plan)
  let repaired = false

  const collisionResult = validateCollisions(working, {
    gridMode: working.grid_spec?.grid_mode || 'strict', useExpandedBbox: true,
  })
  const errors = collisionResult.issues.filter((i) => i.severity === 'error')

  errors.forEach((issue) => {
    const page = working.pages.find((p, idx) => (p.page ?? idx + 1) === issue.page)
    if (!page) return
    const a = page.elements.find((el) => el.id === issue.element_a)
    const b = page.elements.find((el) => el.id === issue.element_b)
    if (!a || !b) return
    const lower = a.row_start <= b.row_start ? b : a
    const overflowPage = working.pages[working.pages.length - 1].page === (issue.page + 1)
      ? working.pages[working.pages.length - 1]
      : (() => {
        const np = { page: (issue.page || working.pages.length) + 1, elements: [] }
        working.pages.push(np)
        return np
      })()
    shiftDown(page, lower.row_start, ROW_GAP_UNITS + 1, activeRows, overflowPage)
    repaired = true
  })

  // Drop any page that ended up empty after elements were moved off it.
  working.pages = working.pages.filter((p) => p.elements.length > 0)
  working.pages.forEach((p, idx) => { p.page = idx + 1 })

  return { plan: working, repaired }
}
