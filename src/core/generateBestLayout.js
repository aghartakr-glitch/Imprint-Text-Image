import { getPatternById } from './patternLibrary.js'
import { paginateContent } from './paginate.js'
import { resolvePageLayout } from './resolvePageLayout.js'
import { buildMainTex, buildStyleTex } from './buildLatex.js'
import { scaleImageHeight } from './styleAdjustment.js'

function applyStyleScale(pattern, style) {
  return {
    ...pattern,
    pages: pattern.pages.map((page) => {
      if (page.imageHeightMm != null) {
        return { ...page, imageHeightMm: scaleImageHeight(page.imageHeightMm, style) }
      }
      if (page.gridHeightMm != null) {
        return { ...page, gridHeightMm: scaleImageHeight(page.gridHeightMm, style) }
      }
      return page
    }),
  }
}

// Builds the single, chosen-by-selectLayout best layout (no A/B/C candidates): a pattern is
// picked by `patternId` (already validated against the available options), style only scales
// image sizes up/down, and an optional title becomes its own pure-typography opener page.
export function generateBestLayout({
  imageCount, imagePaths, text, patternId, style, fontsDir, title,
}) {
  const basePattern = getPatternById(imageCount, patternId)
  const pattern = applyStyleScale(basePattern, style)
  const paginatedPages = paginateContent({ pattern, text, imageCount })

  const hasTitle = typeof title === 'string' && title.trim().length > 0
  const allPages = hasTitle
    ? [{ type: 'title-page', title: title.trim() }, ...paginatedPages]
    : paginatedPages

  const resolvedPages = allPages.map((page) => resolvePageLayout(page, imageCount, imagePaths))

  return {
    patternId: basePattern.patternId,
    layoutType: basePattern.layoutType,
    pageCount: resolvedPages.length,
    resolvedPages,
    mainTex: buildMainTex({ resolvedPages }),
    styleTex: buildStyleTex({ fontsDir }),
  }
}
