import {
  TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM,
  COLUMN_GUTTER_MM,
} from './layoutConstants.js'

// Reorganize text-only pages into multi-column layouts
export function reorganizeTextOnlyPages(resolvedPages, userLayoutSettings = {}) {
  return resolvedPages.map((page) => {
    // Only process pages with no images
    if (Array.isArray(page.images) && page.images.length === 0 && Array.isArray(page.textBlocks) && page.textBlocks.length > 0) {
      return createMultiColumnTextLayout(page, userLayoutSettings)
    }
    return page
  })
}

function createMultiColumnTextLayout(page, userLayoutSettings = {}) {
  // Determine column count: use user setting, or auto-detect based on text density
  let columnCount = userLayoutSettings.columns || 2

  // Validate column count
  if (columnCount < 1) columnCount = 1
  if (columnCount > 6) columnCount = 6

  const columnWidth = TEXT_BOX_WIDTH_MM / columnCount
  const gutter = COLUMN_GUTTER_MM

  const newTextBlocks = []

  // Distribute text blocks across columns
  const blockPerColumn = Math.ceil(page.textBlocks.length / columnCount)

  for (let col = 0; col < columnCount; col++) {
    const startIdx = col * blockPerColumn
    const endIdx = Math.min(startIdx + blockPerColumn, page.textBlocks.length)

    if (startIdx >= page.textBlocks.length) break

    const blocksForThisColumn = page.textBlocks.slice(startIdx, endIdx)
    const xMm = col * (columnWidth + gutter)

    let currentYMm = 0 // Start at top of text box (margins already accounted for by caller)

    blocksForThisColumn.forEach((block, blockIdx) => {
      const originalZone = block.zone || { hMm: 0 }
      const blockHeight = originalZone.hMm || 20 // Default height if not set
      const spacingBetweenBlocks = 3 // mm gap between blocks

      newTextBlocks.push({
        ...block,
        zone: {
          xMm,
          yMm: currentYMm,
          wMm: columnWidth,
          hMm: blockHeight,
        },
      })

      currentYMm += blockHeight + spacingBetweenBlocks
    })
  }

  return {
    ...page,
    textBlocks: newTextBlocks,
  }
}
