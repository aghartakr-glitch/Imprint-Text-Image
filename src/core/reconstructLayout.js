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
  const paginated = paginateGridPlan(layoutPlan, text)
  const gridResolvedPages = paginated.map((p) => resolveGridPage(p.elements, imagePaths, p.textSlicesByElementId))

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
