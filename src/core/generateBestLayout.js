import { paginateGridPlan } from './paginateGridPlan.js'
import { resolveGridPage } from './resolveGridPage.js'
import { buildMainTex, buildStyleTex } from './buildLatex.js'
import { TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM } from './layoutConstants.js'

// Turns an already-decided, already-validated grid layout_plan (from callLayoutLLM) into the
// single best-layout result: paginate the body text across the plan's own body boxes plus any
// overflow continuation pages, resolve every page to mm, and build the LaTeX sources. An
// optional title becomes its own pure-typography opener page, exactly as before -- this part of
// the pipeline is unrelated to the LLM's grid decision.
export function generateBestLayout({
  imagePaths, text, layoutPlan, fontsDir, title,
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

  const resolvedPages = titlePage ? [titlePage, ...gridResolvedPages] : gridResolvedPages

  return {
    style: layoutPlan.style,
    layoutFamily: layoutPlan.layout_family,
    basePatternReference: layoutPlan.base_pattern_reference,
    layoutIntent: layoutPlan.layout_intent,
    pageCount: resolvedPages.length,
    resolvedPages,
    mainTex: buildMainTex({ resolvedPages }),
    styleTex: buildStyleTex({ fontsDir }),
  }
}
