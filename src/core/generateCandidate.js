import { getCandidatePattern } from './patternLibrary.js'
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

export function generateCandidate({ imageCount, imagePaths, text, candidate, style, fontsDir }) {
  const basePattern = getCandidatePattern(imageCount, candidate)
  const pattern = applyStyleScale(basePattern, style)
  const paginatedPages = paginateContent({ pattern, text, imageCount })
  const resolvedPages = paginatedPages.map((page) => resolvePageLayout(page, imageCount, imagePaths))

  return {
    patternId: basePattern.patternId,
    pageCount: resolvedPages.length,
    resolvedPages,
    mainTex: buildMainTex({ resolvedPages }),
    styleTex: buildStyleTex({ fontsDir }),
  }
}
