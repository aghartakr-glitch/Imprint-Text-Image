import {
  TEXT_BOX_WIDTH_MM,
  TEXT_BOX_HEIGHT_MM,
  PAGE_WIDTH_MM,
  PAGE_HEIGHT_MM,
  IMAGE_TEXT_GAP_MM,
} from './layoutConstants.js'
import { computeGridBoxes } from './gridLayout.js'
import { resolveImageIndices } from './patternLibrary.js'

export function resolvePageLayout(pageSpec, imageCount, imagePaths) {
  if (pageSpec.type === 'text-only') {
    return {
      type: 'text-only',
      images: [],
      textZone: { xMm: 0, yMm: 0, wMm: TEXT_BOX_WIDTH_MM, hMm: TEXT_BOX_HEIGHT_MM },
      textSlice: pageSpec.textSlice,
    }
  }

  if (pageSpec.type === 'full-bleed-image') {
    const idx = resolveImageIndices(pageSpec.imageIndices, imageCount)
    return {
      type: 'full-bleed-image',
      images: idx.map((i) => ({
        path: imagePaths[i],
        xMm: 0,
        yMm: 0,
        wMm: PAGE_WIDTH_MM,
        hMm: PAGE_HEIGHT_MM,
        fullBleed: true,
      })),
      textZone: null,
      textSlice: null,
    }
  }

  if (pageSpec.type === 'image-top-text-bottom') {
    const idx = resolveImageIndices(pageSpec.imageIndices, imageCount)
    const remainingHeight = TEXT_BOX_HEIGHT_MM - pageSpec.imageHeightMm - IMAGE_TEXT_GAP_MM
    return {
      type: 'image-top-text-bottom',
      images: idx.map((i) => ({
        path: imagePaths[i],
        xMm: 0,
        yMm: 0,
        wMm: TEXT_BOX_WIDTH_MM,
        hMm: pageSpec.imageHeightMm,
        fullBleed: false,
      })),
      textZone: pageSpec.textSlice
        ? {
            xMm: 0,
            yMm: pageSpec.imageHeightMm + IMAGE_TEXT_GAP_MM,
            wMm: TEXT_BOX_WIDTH_MM,
            hMm: remainingHeight,
          }
        : null,
      textSlice: pageSpec.textSlice,
    }
  }

  if (pageSpec.type === 'image-grid') {
    const idx = resolveImageIndices(pageSpec.imageIndices, imageCount)
    const boxes = computeGridBoxes(idx.length, { xMm: 0, yMm: 0, wMm: PAGE_WIDTH_MM, hMm: PAGE_HEIGHT_MM })
    return {
      type: 'image-grid',
      images: idx.map((i, n) => ({ path: imagePaths[i], ...boxes[n], fullBleed: true })),
      textZone: null,
      textSlice: null,
    }
  }

  if (pageSpec.type === 'image-grid-margin') {
    const idx = resolveImageIndices(pageSpec.imageIndices, imageCount)
    const boxes = computeGridBoxes(idx.length, { xMm: 0, yMm: 0, wMm: TEXT_BOX_WIDTH_MM, hMm: pageSpec.gridHeightMm })
    const remainingHeight = TEXT_BOX_HEIGHT_MM - pageSpec.gridHeightMm - IMAGE_TEXT_GAP_MM
    return {
      type: 'image-grid-margin',
      images: idx.map((i, n) => ({ path: imagePaths[i], ...boxes[n], fullBleed: false })),
      textZone: pageSpec.textSlice
        ? {
            xMm: 0,
            yMm: pageSpec.gridHeightMm + IMAGE_TEXT_GAP_MM,
            wMm: TEXT_BOX_WIDTH_MM,
            hMm: remainingHeight,
          }
        : null,
      textSlice: pageSpec.textSlice,
    }
  }

  throw new Error(`알 수 없는 페이지 타입: ${pageSpec.type}`)
}
