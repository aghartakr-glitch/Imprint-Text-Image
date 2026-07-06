import {
  TEXT_BOX_WIDTH_MM,
  TEXT_BOX_HEIGHT_MM,
  CHAR_WIDTH_MM,
  LINE_HEIGHT_MM,
  IMAGE_TEXT_GAP_MM,
} from './layoutConstants.js'

function textCapacity(widthMm, heightMm) {
  const charsPerLine = Math.floor(widthMm / CHAR_WIDTH_MM)
  const lines = Math.floor(heightMm / LINE_HEIGHT_MM)
  return Math.max(0, charsPerLine * lines)
}

function pageTextCapacity(pageSpec) {
  if (pageSpec.type === 'text-only') {
    return textCapacity(TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM)
  }
  if (pageSpec.type === 'image-top-text-bottom') {
    const remainingHeight = TEXT_BOX_HEIGHT_MM - pageSpec.imageHeightMm - IMAGE_TEXT_GAP_MM
    return textCapacity(TEXT_BOX_WIDTH_MM, remainingHeight)
  }
  if (pageSpec.type === 'image-grid-margin') {
    const remainingHeight = TEXT_BOX_HEIGHT_MM - pageSpec.gridHeightMm - IMAGE_TEXT_GAP_MM
    return textCapacity(TEXT_BOX_WIDTH_MM, remainingHeight)
  }
  return 0
}

export function paginateContent({ pattern, text, imageCount }) {
  const pages = []
  let remainingText = text

  for (const pageSpec of pattern.pages) {
    const capacity = pageTextCapacity(pageSpec)
    const textSlice = capacity > 0 && remainingText.length > 0 ? remainingText.slice(0, capacity) : null
    if (textSlice) remainingText = remainingText.slice(textSlice.length)
    pages.push({ ...pageSpec, textSlice })
  }

  while (remainingText.length > 0) {
    const overflowSpec = { type: pattern.overflowPageType }
    const capacity = pageTextCapacity(overflowSpec)
    if (capacity <= 0) throw new Error('오버플로우 페이지 타입의 텍스트 수용량이 0입니다')
    const textSlice = remainingText.slice(0, capacity)
    remainingText = remainingText.slice(capacity)
    pages.push({ ...overflowSpec, textSlice })
  }

  return pages
}
