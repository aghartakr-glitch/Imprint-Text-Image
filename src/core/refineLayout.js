// Spec section 10: after reconstruction, refine the result before it becomes LaTeX.
//
// Image fitting is conditional. Explicit fit:"cover" images still receive cover-crop metadata,
// but the default/editorial fallback is contain: do not crop a portrait or product image just
// because the grid cell has a different aspect ratio. Content-group repair emits contain images by
// default, preserving the source image unless a layout explicitly asks for cover.
import {
  COLUMN_GUTTER_MM,
  TEXT_BOX_WIDTH_MM,
  TEXT_BOX_HEIGHT_MM,
  TEXT_IMAGE_MIN_GAP_MM,
} from './layoutConstants.js'

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

function containBoxWithin(xMm, yMm, maxWMm, maxHMm, ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return { xMm, yMm, wMm: maxWMm, hMm: maxHMm }
  const maxRatio = maxWMm / maxHMm
  if (ratio > maxRatio) {
    return { xMm, yMm, wMm: maxWMm, hMm: maxWMm / ratio }
  }
  return { xMm, yMm, wMm: maxHMm * ratio, hMm: maxHMm }
}

function shouldCoverCrop(img) {
  return img.fit === 'cover' || img.renderFit === 'cover' || img.crop === true
}

function readImageRatio(img, imagePaths, imageAspectRatios) {
  const idx = imagePaths.indexOf(img.path)
  const ratio = idx >= 0 ? imageAspectRatios[idx] : null
  if (Number.isFinite(ratio) && ratio > 0) return ratio
  const fallback = img.wMm / img.hMm
  return Number.isFinite(fallback) && fallback > 0 ? fallback : null
}

function getTextBlocksForPage(page) {
  return Array.isArray(page.textBlocks) && page.textBlocks.length > 0
    ? page.textBlocks
    : (page.textZone ? [{ zone: page.textZone, slice: page.textSlice }] : [])
}

function setTextBlocksForPage(page, textBlocks) {
  if (Array.isArray(page.textBlocks) && page.textBlocks.length > 0) return { ...page, textBlocks }
  if (textBlocks.length === 1) return { ...page, textZone: textBlocks[0].zone, textSlice: textBlocks[0].slice }
  return { ...page, textBlocks }
}

function columnWidthMm(boxWidthMm, columns, gutterMm) {
  if (!Number.isFinite(columns) || columns <= 1) return boxWidthMm
  return (boxWidthMm - gutterMm * (columns - 1)) / columns
}

function spanWidthMm(columns, span, boxWidthMm, gutterMm) {
  const colWidth = columnWidthMm(boxWidthMm, columns, gutterMm)
  return colWidth * span + gutterMm * Math.max(0, span - 1)
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

function boxesOverlap(a, b, gapMm = 0) {
  return rangesOverlap(a.xMm - gapMm, a.xMm + a.wMm + gapMm, b.xMm, b.xMm + b.wMm)
    && rangesOverlap(a.yMm - gapMm, a.yMm + a.hMm + gapMm, b.yMm, b.yMm + b.hMm)
}

function isBodyLikeTextBlock(tb) {
  return !tb.role || tb.role === 'body' || tb.role === 'case_body' || tb.role === 'paragraph'
}

function promoteColumnTrappedImages(pages, {
  imagePaths = [],
  imageAspectRatios = [],
  boxWidthMm = TEXT_BOX_WIDTH_MM,
  boxHeightMm = TEXT_BOX_HEIGHT_MM,
  columns = 3,
  gutterMm = COLUMN_GUTTER_MM,
} = {}) {
  if (!Number.isFinite(columns) || columns < 2) return { pages, adjusted: false }

  let adjusted = false
  const oneCol = columnWidthMm(boxWidthMm, columns, gutterMm)
  const oneColMax = oneCol * 1.2

  const nextPages = pages.map((page) => {
    const images = Array.isArray(page.images) ? page.images.map((img) => ({ ...img })) : []
    const regularImages = images
      .map((img, imageIndex) => ({ img, imageIndex }))
      .filter(({ img }) => !img.fullBleed)
    const textBlocks = getTextBlocksForPage(page)
      .map((tb) => ({ ...tb, zone: tb.zone ? { ...tb.zone } : tb.zone }))
      .filter((tb) => tb.zone)

    if (regularImages.length !== 1 || textBlocks.length === 0) return { ...page, images }

    const { img, imageIndex } = regularImages[0]
    if (img.wMm > oneColMax) return { ...page, images }

    const bodyBlocks = textBlocks.filter(isBodyLikeTextBlock)
    if (bodyBlocks.length === 0) return { ...page, images }

    const ratio = readImageRatio(img, imagePaths, imageAspectRatios)
    if (!ratio) return { ...page, images }

    const otherTextBlocks = textBlocks.filter((tb) => !isBodyLikeTextBlock(tb))
    const headingAreaBottom = otherTextBlocks.reduce((max, tb) => Math.max(max, tb.zone.yMm + tb.zone.hMm), 0)
    const availableTop = headingAreaBottom > 0 ? headingAreaBottom + TEXT_IMAGE_MIN_GAP_MM : 0

    const preferredImageSpan = columns >= 5 ? 3 : (columns >= 3 ? 2 : 1)
    const imageSpan = Math.max(1, Math.min(columns - 1, preferredImageSpan))
    const textSpan = columns - imageSpan
    if (textSpan < 1) return { ...page, images }

    const imageMaxW = spanWidthMm(columns, imageSpan, boxWidthMm, gutterMm)
    const textX = imageMaxW + gutterMm
    const textW = boxWidthMm - textX
    if (textW < oneCol * 0.85) return { ...page, images }

    const imageMaxH = boxHeightMm - availableTop
    if (imageMaxH < 45) return { ...page, images }

    const imageBox = containBoxWithin(0, availableTop, imageMaxW, imageMaxH, ratio)
    if (imageBox.wMm * imageBox.hMm <= img.wMm * img.hMm * 1.25) return { ...page, images }

    const promotedImageBox = { ...imageBox, xMm: 0, yMm: availableTop }
    const sideTextBox = {
      xMm: textX,
      yMm: availableTop,
      wMm: textW,
      hMm: boxHeightMm - availableTop,
    }

    if (otherTextBlocks.some((tb) => boxesOverlap(sideTextBox, tb.zone, TEXT_IMAGE_MIN_GAP_MM))) {
      return { ...page, images }
    }

    images[imageIndex] = {
      ...img,
      ...promotedImageBox,
      fit: img.fit || 'contain',
      cover: undefined,
    }

    const bodyHeight = sideTextBox.hMm / bodyBlocks.length
    let bodyIndex = 0
    const movedTextBlocks = textBlocks.map((tb) => {
      if (!isBodyLikeTextBlock(tb)) return tb
      const yMm = sideTextBox.yMm + bodyIndex * bodyHeight
      bodyIndex += 1
      return {
        ...tb,
        zone: {
          xMm: sideTextBox.xMm,
          yMm,
          wMm: sideTextBox.wMm,
          hMm: bodyHeight - (bodyIndex < bodyBlocks.length ? TEXT_IMAGE_MIN_GAP_MM : 0),
        },
      }
    })

    adjusted = true
    return setTextBlocksForPage({ ...page, images }, movedTextBlocks)
  })

  return { pages: nextPages, adjusted }
}

function upscaleSparseSpreadImages(pages, {
  imagePaths = [], imageAspectRatios = [], boxWidthMm = TEXT_BOX_WIDTH_MM, boxHeightMm = TEXT_BOX_HEIGHT_MM,
} = {}) {
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

    const ratio = readImageRatio(img, imagePaths, imageAspectRatios)
    if (!Number.isFinite(ratio) || ratio <= 0) continue

    const page = nextPages[item.pageIndex]
    const occupiedBottom = [
      ...page.images.filter((_, idx) => idx !== item.imageIndex && !page.images[idx].fullBleed)
        .map((other) => other.yMm + other.hMm),
      ...getTextBlocksForPage(page).filter((tb) => tb.zone)
        .map((tb) => tb.zone.yMm + tb.zone.hMm),
    ].reduce((max, bottom) => Math.max(max, bottom), 0)

    const yMm = occupiedBottom > 0 ? occupiedBottom + TEXT_IMAGE_MIN_GAP_MM : 0
    const availableHeight = boxHeightMm - yMm
    if (availableHeight < 35) continue

    const contained = containBoxWithin(0, yMm, boxWidthMm, availableHeight, ratio)
    const nextArea = contained.wMm * contained.hMm
    if (nextArea <= currentArea * 1.35) continue

    page.images[item.imageIndex] = {
      ...img,
      ...contained,
      fit: img.fit || 'contain',
    }
    adjusted = true
  }

  return { pages: nextPages, adjusted }
}

export function refineLayout(resolvedPages, {
  imagePaths = [],
  imageAspectRatios = [],
  boxWidthMm = TEXT_BOX_WIDTH_MM,
  boxHeightMm = TEXT_BOX_HEIGHT_MM,
  columns = 3,
  gutterMm = COLUMN_GUTTER_MM,
} = {}) {
  const notes = []
  let objectPositionAdjusted = false

  const refinedPages = resolvedPages.map((page, pageIndex) => {
    const pageImages = Array.isArray(page.images) ? page.images : []
    const images = pageImages.map((img) => {
      const ratio = readImageRatio(img, imagePaths, imageAspectRatios)
      // Full-bleed images are no longer special-cased to always cover-crop (2026-08-04, reverted
      // per user feedback: cropping a landscape photo's top/bottom to fill a full-bleed page's
      // empty space is unwanted -- fit to width and leave the gap). They now go through the exact
      // same path as any other image: cover-crop only when the plan explicitly set fit:'cover'.
      if (!ratio || !shouldCoverCrop(img)) return { ...img, fit: img.fit || 'contain' }
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

  const promotedImageResult = promoteColumnTrappedImages(refinedPages, {
    imagePaths,
    imageAspectRatios,
    boxWidthMm,
    boxHeightMm,
    columns,
    gutterMm,
  })

  const sparseImageResult = upscaleSparseSpreadImages(promotedImageResult.pages, { imagePaths, imageAspectRatios, boxWidthMm, boxHeightMm })

  return {
    resolvedPages: sparseImageResult.pages,
    refinements: {
      object_position_adjusted: objectPositionAdjusted,
      column_trapped_images_promoted: promotedImageResult.adjusted,
      sparse_spread_images_upscaled: sparseImageResult.adjusted,
      continuation_pages_added: resolvedPages.filter((p) => p.images.length === 0 && p.textZone).length,
      notes,
    },
  }
}
