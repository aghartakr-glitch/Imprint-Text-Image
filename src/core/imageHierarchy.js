// Section 6: builds image_metadata (per-image facts the LLM can reason about) and estimates a
// default image_hierarchy when the user hasn't specified priorities -- the LLM can still deviate,
// but this gives it (and the deterministic fallback) a sensible starting point instead of nothing.

function computeResolutionScores(images) {
  const pixelCounts = images.map((img) => img.width * img.height)
  const maxPixels = Math.max(...pixelCounts)
  return pixelCounts.map((p) => (maxPixels > 0 ? Math.round((p / maxPixels) * 100) / 100 : 1))
}

export function buildImageMetadata(images, userPriorities = []) {
  const resolutionScores = computeResolutionScores(images)
  return images.map((img, i) => ({
    id: `image_${i + 1}`,
    ratio: img.aspectRatio,
    orientation: img.orientation,
    width_px: img.width,
    height_px: img.height,
    resolution_score: resolutionScores[i],
    user_priority: userPriorities[i] ?? null,
    estimated_role: null, // filled in by estimateImageHierarchy
  }))
}

// Ratios within this much of each other are treated as "similar" (a loose editorial heuristic,
// not a precise threshold from the spec, which only describes the rule qualitatively).
const SIMILAR_RATIO_TOLERANCE = 0.35
const HIGH_RES_OUTLIER_MIN = 0.85
const LOW_RES_THRESHOLD = 0.6

function withRoles(imageMetadata, roleFn, imageHierarchy) {
  return {
    imageMetadata: imageMetadata.map((m, i) => ({ ...m, estimated_role: roleFn(m, i) })),
    imageHierarchy,
  }
}

export function estimateImageHierarchy(imageMetadata) {
  const n = imageMetadata.length

  const userHeroes = imageMetadata.map((m, i) => (m.user_priority === 'hero' ? i : -1)).filter((i) => i >= 0)
  if (userHeroes.length === 1) {
    const heroIdx = userHeroes[0]
    return withRoles(imageMetadata, (_m, i) => (i === heroIdx ? 'hero' : 'support'), n === 1 ? 'single_hero' : 'hero_support')
  }

  if (n === 1) {
    return withRoles(imageMetadata, () => 'hero', 'single_hero')
  }

  const ratios = imageMetadata.map((m) => m.ratio)
  const similarRatios = (Math.max(...ratios) - Math.min(...ratios)) <= SIMILAR_RATIO_TOLERANCE

  const resolutions = imageMetadata.map((m) => m.resolution_score)
  const maxRes = Math.max(...resolutions)
  const topResIndices = resolutions.map((r, i) => (r >= maxRes - 1e-9 ? i : -1)).filter((i) => i >= 0)
  const hasClearHighResOutlier = topResIndices.length === 1
    && maxRes >= HIGH_RES_OUTLIER_MIN
    && resolutions.some((r) => r < LOW_RES_THRESHOLD)

  if (n === 2) {
    if (similarRatios && !hasClearHighResOutlier) {
      return withRoles(imageMetadata, () => 'equal', 'equal_pair')
    }
    const heroIdx = topResIndices[0] ?? resolutions.indexOf(maxRes)
    return withRoles(imageMetadata, (_m, i) => (i === heroIdx ? 'hero' : 'support'), 'hero_support')
  }

  // n >= 3
  if (similarRatios && !hasClearHighResOutlier) {
    return withRoles(imageMetadata, () => 'gallery', 'grid_gallery')
  }
  const heroIdx = topResIndices[0] ?? resolutions.indexOf(maxRes)
  return withRoles(imageMetadata, (_m, i) => (i === heroIdx ? 'hero' : 'support'), 'hero_support')
}
