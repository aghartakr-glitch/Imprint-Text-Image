// Spec section 10: after reconstruction, refine the result before it becomes LaTeX. The one
// concrete geometric fix here is real: `fit: contain` alone leaves a non-matching-aspect-ratio
// image hugging the top-left corner of its box (plain LaTeX \includegraphics behavior) --
// object_position tells us where to actually center/align it within the box. Other checks below
// are advisory (logged into `refinements.notes`, surfaced in generation-log.json) rather than
// auto-corrective, since silently resizing/moving a validated grid box risks reintroducing the
// overlaps/out-of-bounds errors validateLayoutPlan already rejected.
import { TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM, TEXT_IMAGE_MIN_GAP_MM } from './layoutConstants.js'

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

function getTextBlocksForPage(page) {
  return Array.isArray(page.textBlocks) && page.textBlocks.length > 0
    ? page.textBlocks
    : (page.textZone ? [{ zone: page.textZone, slice: page.textSlice }] : [])
}

function fitImageInBoxAt(ratio, xMm, yMm, wMm, hMm) {
  const boxRatio = wMm / hMm
  if (ratio > boxRatio) {
    const h = wMm / ratio
    return { xMm, yMm: yMm + (hMm - h) / 2, wMm, hMm: h }
  }
  const w = hMm * ratio
  return { xMm: xMm + (wMm - w) / 2, yMm, wMm: w, hMm }
}

function upscaleSparseSpreadImages(pages, { imagePaths = [], imageAspectRatios = [] } = {}) {
  let adjusted = false
  const nextPages = pages.map((page) => ({
    ...page,
    images: Array.isArray(page.images) ? page.images.map((img) => ({ ...img })) : [],
  }))

  for (let spreadStart = 0; spreadStart < nextPages.length; spreadStart += 2) {
    if (!nextPages[spreadStart + 1]) continue
    const spreadItems = []
    for (let pageOffset = 0; pageOffset < 2; pageOffset += 1) {
      const pageIndex = spreadStart + pageOffset
      const page = nextPages[pageIndex]
      if (!page) continue
      page.images.forEach((img, imageIndex) => {
        if (!img.fullBleed) spreadItems.push({ pageIndex, imageIndex, img })
      })
    }

    if (spreadItems.length !== 1) continue
    const item = spreadItems[0]
    const img = item.img
    const currentArea = img.wMm * img.hMm
    const minSparseArea = 2200
    if (currentArea >= minSparseArea) continue

    const imagePathIndex = imagePaths.indexOf(img.path)
    const ratio = imagePathIndex >= 0 ? imageAspectRatios[imagePathIndex] : (img.wMm / img.hMm)
    if (!Number.isFinite(ratio) || ratio <= 0) continue

    const page = nextPages[item.pageIndex]
    const occupiedBottom = [
      ...page.images.filter((_, idx) => idx !== item.imageIndex && !page.images[idx].fullBleed)
        .map((other) => other.yMm + other.hMm),
      ...getTextBlocksForPage(page).filter((tb) => tb.zone)
        .map((tb) => tb.zone.yMm + tb.zone.hMm),
    ].reduce((max, bottom) => Math.max(max, bottom), 0)

    const yMm = occupiedBottom > 0 ? occupiedBottom + TEXT_IMAGE_MIN_GAP_MM : 0
    const availableHeight = TEXT_BOX_HEIGHT_MM - yMm
    if (availableHeight < 35) continue

    const fitted = fitImageInBoxAt(ratio, 0, yMm, TEXT_BOX_WIDTH_MM, availableHeight)
    const nextArea = fitted.wMm * fitted.hMm
    if (nextArea <= currentArea * 1.35) continue

    page.images[item.imageIndex] = { ...img, ...fitted }
    adjusted = true
  }

  return { pages: nextPages, adjusted }
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

    const pageTextBlocks = getTextBlocksForPage(page)
    const hasAnyText = pageTextBlocks.some((tb) => tb.slice)

    if (images.length === 0 && !hasAnyText && page.type !== 'title-page') {
      notes.push(`page ${pageIndex + 1}: 콘텐츠가 비어 있습니다`)
    }
    const MIN_READABLE_TEXT_ZONE_MM2 = 20 * 20
    pageTextBlocks.forEach((tb) => {
      if (tb.zone && tb.zone.wMm * tb.zone.hMm < MIN_READABLE_TEXT_ZONE_MM2) {
        notes.push(`page ${pageIndex + 1}: 본문 텍스트 영역이 너무 좁습니다 (${tb.zone.wMm.toFixed(1)}x${tb.zone.hMm.toFixed(1)}mm)`)
      }
    })

    return { ...page, images }
  })

  const sparseImageResult = upscaleSparseSpreadImages(refinedPages, { imagePaths, imageAspectRatios })

  return {
    resolvedPages: sparseImageResult.pages,
    refinements: {
      object_position_adjusted: objectPositionAdjusted,
      sparse_spread_images_upscaled: sparseImageResult.adjusted,
      continuation_pages_added: resolvedPages.filter((p) => p.images.length === 0 && p.textZone).length,
      notes,
    },
  }
}
