import { paginateGridPlan } from './paginateGridPlan.js'
import { resolveGridPage } from './resolveGridPage.js'
import { TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM } from './layoutConstants.js'

// Spec section 9.2: converts an already-validated grid layout_plan into the actual page
// structure -- mm boxes, real image files assigned to image slots, body text distributed across
// text slots (with continuation pages for overflow), and an optional title-page prepended. This
// is *not* the final refined/LaTeX-ready object yet (see refineLayout.js for that step).
export function reconstructLayout({
  layoutPlan, imagePaths, text, title,
}) {
  // A grid_spec on the plan marks it as a column-flow grid plan (see fallbackLayoutPlan.js's
  // buildGridFallbackPlan): its body-role elements already carry their final pre-sliced `text`
  // (computed by ColumnFlowEngine against the user's chosen column count and image reserved
  // regions), so re-running paginateGridPlan's own word-boundary slicing against the *original*
  // full text here would re-slice text that was already consumed, duplicating it. Every other
  // plan shape (LLM-generated, or the legacy fixed 6x12 fallback) has no grid_spec and keeps
  // going through paginateGridPlan exactly as before.
  const paginated = layoutPlan.grid_spec
    ? layoutPlan.pages.map((p) => ({
      elements: p.elements,
      textSlicesByElementId: Object.fromEntries(
        p.elements.filter((el) => el.type === 'text' && el.role === 'body').map((el) => [el.id, el.text ?? null]),
      ),
    }))
    : paginateGridPlan(layoutPlan, text)
  const gridSpec = layoutPlan.grid_spec
    ? {
      columns: layoutPlan.grid_spec.columns, rows: layoutPlan.grid_spec.rows, gutterMm: layoutPlan.grid_spec.gutter_mm,
    }
    : undefined
  const gridResolvedPages = paginated.map((p) => resolveGridPage(p.elements, imagePaths, p.textSlicesByElementId, gridSpec))

  const hasTitle = typeof title === 'string' && title.trim().length > 0
  const titlePage = hasTitle
    ? {
      type: 'title-page',
      images: [],
      textZone: {
        xMm: 0, yMm: 0, wMm: TEXT_BOX_WIDTH_MM, hMm: TEXT_BOX_HEIGHT_MM,
      },
      textSlice: null,
      title: title.trim(),
    }
    : null

  return titlePage ? [titlePage, ...gridResolvedPages] : gridResolvedPages
}
