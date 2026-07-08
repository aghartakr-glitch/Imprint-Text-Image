// Spec section 10: after reconstruction, refine the result before it becomes LaTeX. The one
// concrete geometric fix here is real: `fit: contain` alone leaves a non-matching-aspect-ratio
// image hugging the top-left corner of its box (plain LaTeX \includegraphics behavior) --
// object_position tells us where to actually center/align it within the box. Other checks below
// are advisory (logged into `refinements.notes`, surfaced in generation-log.json) rather than
// auto-corrective, since silently resizing/moving a validated grid box risks reintroducing the
// overlaps/out-of-bounds errors validateLayoutPlan already rejected.
function fitImageWithinBox(img, ratio) {
  const boxRatio = img.wMm / img.hMm
  const widthConstrained = ratio > boxRatio
  const containedW = widthConstrained ? img.wMm : img.hMm * ratio
  const containedH = widthConstrained ? img.wMm / ratio : img.hMm

  const objectPosition = img.objectPosition || 'center'
  let offsetX = (img.wMm - containedW) / 2
  let offsetY = (img.hMm - containedH) / 2
  if (objectPosition === 'top') offsetY = 0
  if (objectPosition === 'bottom') offsetY = img.hMm - containedH
  if (objectPosition === 'left') offsetX = 0
  if (objectPosition === 'right') offsetX = img.wMm - containedW

  return {
    ...img, xMm: img.xMm + offsetX, yMm: img.yMm + offsetY, wMm: containedW, hMm: containedH,
  }
}

export function refineLayout(resolvedPages, { imagePaths = [], imageAspectRatios = [] } = {}) {
  const notes = []
  let objectPositionAdjusted = false

  const refinedPages = resolvedPages.map((page, pageIndex) => {
    const images = page.images.map((img) => {
      if (img.fullBleed) return img
      const idx = imagePaths.indexOf(img.path)
      const ratio = idx >= 0 ? imageAspectRatios[idx] : null
      if (!ratio) return img
      objectPositionAdjusted = true
      return fitImageWithinBox(img, ratio)
    })

    const textBlocksForPage = Array.isArray(page.textBlocks) && page.textBlocks.length > 0
      ? page.textBlocks
      : (page.textZone ? [{ zone: page.textZone, slice: page.textSlice }] : [])
    const hasAnyText = textBlocksForPage.some((tb) => tb.slice)

    if (images.length === 0 && !hasAnyText && page.type !== 'title-page') {
      notes.push(`page ${pageIndex + 1}: 콘텐츠가 비어 있습니다`)
    }
    const MIN_READABLE_TEXT_ZONE_MM2 = 20 * 20
    textBlocksForPage.forEach((tb) => {
      if (tb.zone && tb.zone.wMm * tb.zone.hMm < MIN_READABLE_TEXT_ZONE_MM2) {
        notes.push(`page ${pageIndex + 1}: 본문 텍스트 영역이 너무 좁습니다 (${tb.zone.wMm.toFixed(1)}x${tb.zone.hMm.toFixed(1)}mm)`)
      }
    })

    return { ...page, images }
  })

  return {
    resolvedPages: refinedPages,
    refinements: {
      object_position_adjusted: objectPositionAdjusted,
      continuation_pages_added: resolvedPages.filter((p) => p.images.length === 0 && p.textZone).length,
      notes,
    },
  }
}
