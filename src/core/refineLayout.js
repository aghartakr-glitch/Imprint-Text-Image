// Spec section 10: after reconstruction, refine the result before it becomes LaTeX.
//
// Image fitting is COVER-CROP (2026-07-27, user decision): an image fills its grid box exactly --
// aspect ratio preserved, the overflowing dimension cropped, object_position choosing which part
// survives the crop. The previous behavior was letterbox-contain with centering: the image shrank
// inside its box and was then centered, which produced two visible defects the user circled on real
// output -- side-by-side images with ragged, unequal tops/bottoms (each centered vertically to a
// different fitted height), and a mysterious "indent" before portrait images (horizontal centering
// pushed a 42.9mm-wide fit 6.5mm into its 56mm column). Filling the box removes both causes
// outright: every image edge lands exactly on its grid lines.
import { TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM, TEXT_IMAGE_MIN_GAP_MM } from './layoutConstants.js'

// Keeps the grid box exactly as planned and attaches the render/crop numbers buildLatex.js needs to
// draw the image covering it: render at `renderWMm` wide (aspect preserved), then trim
// left/bottom/right/top by the given amounts so exactly the box survives.
function coverImageInBox(img, ratio) {
  const boxRatio = img.wMm / img.hMm
  const objectPosition = img.objectPosition || 'center'

  if (ratio > boxRatio) {
    // Image is proportionally wider than the box: match heights, crop the horizontal overflow.
    const renderWMm = img.hMm * ratio
    const overflowX = renderWMm - img.wMm
    let trimLeftMm = overflowX / 2
    if (objectPosition === 'left') trimLeftMm = 0
    if (objectPosition === 'right') trimLeftMm = overflowX
    return {
      ...img,
      cover: {
        renderWMm,
        renderHMm: img.hMm,
        trimLeftMm,
        trimRightMm: overflowX - trimLeftMm,
        trimTopMm: 0,
        trimBottomMm: 0,
      },
    }
  }

  // Image is proportionally taller than the box: match widths, crop the vertical overflow.
  const renderHMm = img.wMm / ratio
  const overflowY = renderHMm - img.hMm
  let trimTopMm = overflowY / 2
  if (objectPosition === 'top') trimTopMm = 0
  if (objectPosition === 'bottom') trimTopMm = overflowY
  return {
    ...img,
    cover: {
      renderWMm: img.wMm,
      renderHMm,
      trimLeftMm: 0,
      trimRightMm: 0,
      trimTopMm,
      trimBottomMm: overflowY - trimTopMm,
    },
  }
}

function getTextBlocksForPage(page) {
  return Array.isArray(page.textBlocks) && page.textBlocks.length > 0
    ? page.textBlocks
    : (page.textZone ? [{ zone: page.textZone, slice: page.textSlice }] : [])
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

    // Cover-crop into the full remaining area: the enlarged image takes the whole available box
    // (edges on the grid), with the overflowing dimension cropped, same as every other image.
    const nextArea = TEXT_BOX_WIDTH_MM * availableHeight
    if (nextArea <= currentArea * 1.35) continue

    page.images[item.imageIndex] = coverImageInBox({
      ...img, xMm: 0, yMm, wMm: TEXT_BOX_WIDTH_MM, hMm: availableHeight,
    }, ratio)
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
      return coverImageInBox(img, ratio)
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
