import {
  TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM, COLUMN_GUTTER_MM, CHAR_WIDTH_MM, LINE_HEIGHT_MM,
} from './layoutConstants.js'
import { sliceAtWordBoundary } from './paginateGridPlan.js'
import { isBodyLikeRole, textHeightMm } from './textMeasure.js'

const BLOCK_GAP_MM = 3

// Reorganize text-only pages into multi-column layouts. May return MORE pages than it was given
// (a single page can spill into several once its text is re-fit into narrower columns), so callers
// must treat the return value as the full replacement page list, not a 1:1 map.
export function reorganizeTextOnlyPages(resolvedPages, userLayoutSettings = {}, { contentWidthMm = TEXT_BOX_WIDTH_MM, contentHeightMm = TEXT_BOX_HEIGHT_MM } = {}) {
  const output = []
  let textOnlyRun = []

  function flushTextOnlyRun() {
    if (textOnlyRun.length === 0) return
    output.push(...createMultiColumnTextLayoutForRun(textOnlyRun, userLayoutSettings, { contentWidthMm, contentHeightMm }))
    textOnlyRun = []
  }

  resolvedPages.forEach((page) => {
    const isTextOnly = Array.isArray(page.images) && page.images.length === 0 && Array.isArray(page.textBlocks) && page.textBlocks.length > 0
    if (isTextOnly) {
      textOnlyRun.push(page)
      return
    }
    flushTextOnlyRun()
    output.push(page)
  })
  flushTextOnlyRun()

  return breakConsecutiveImageOnlyPages(output)
}

function isImageOnlyPage(page) {
  return Array.isArray(page.images) && page.images.length > 0 && (!Array.isArray(page.textBlocks) || page.textBlocks.length === 0)
}

function isPureTextPage(page) {
  return Array.isArray(page.images) && page.images.length === 0 && Array.isArray(page.textBlocks) && page.textBlocks.length > 0
}

function breakConsecutiveImageOnlyPages(pages) {
  const arranged = [...pages]
  for (let i = 0; i < arranged.length - 1; i += 1) {
    if (!isImageOnlyPage(arranged[i]) || !isImageOnlyPage(arranged[i + 1])) continue
    const textIdx = arranged.findIndex((page, index) => index > i + 1 && isPureTextPage(page))
    if (textIdx < 0) continue
    const [textPage] = arranged.splice(textIdx, 1)
    arranged.splice(i + 1, 0, textPage)
  }
  return arranged
}
// Only role: 'body' blocks are re-flowed into columns here. This function's character-capacity
// math (CHAR_WIDTH_MM/LINE_HEIGHT_MM) assumes 9pt body text; heading-style roles (section_label,
// case_title_ko, etc.) render much larger and bold via buildLatex.js's styleCommandForRole, so
// a box sized by this function's math is too narrow for them and the text visually overflows into
// the next column (confirmed 2026-07-16: a 20mm column sized for 9pt text held bold 14pt
// "COMMUNITY ACTIVISM", which doesn't fit and spilled into the neighboring column). Heading blocks
// keep whatever position/size the LLM's own grid placement already gave them.
function isReflowableBody(block) {
  return (block.role || 'body') === 'body'
}

// Inverse of estimateTextCapacityMm: how tall a box at this column width needs to be to hold N
// characters (rounded up to a whole number of lines).
function heightForChars(charCount, columnWidthMm) {
  const charsPerLine = Math.max(1, Math.floor(columnWidthMm / CHAR_WIDTH_MM))
  const lines = Math.max(1, Math.ceil(charCount / charsPerLine))
  return lines * LINE_HEIGHT_MM
}

// How many characters fit in this much vertical space at this column width.
function charsForHeight(heightMm, columnWidthMm) {
  const charsPerLine = Math.max(1, Math.floor(columnWidthMm / CHAR_WIDTH_MM))
  const lines = Math.max(0, Math.floor(heightMm / LINE_HEIGHT_MM))
  return charsPerLine * lines
}

// Used to always silently downgrade to whatever column count fit MIN_READABLE_COLUMN_WIDTH_MM,
// which meant a user picking 3+ columns on A5 (~116mm content width) got 2 columns back with no
// explanation -- their explicit choice was second-guessed. Per user decision (2026-08-04): always
// honor the requested column count; readability at narrow widths is the user's call, not this
// function's to override.
function resolveReadableColumnCount(userLayoutSettings = {}, _contentWidthMm = TEXT_BOX_WIDTH_MM) {
  let columnCount = userLayoutSettings.columns || 2
  if (columnCount < 1) columnCount = 1
  if (columnCount > 6) columnCount = 6
  return columnCount
}

function gapBetweenBlocks(prev, next) {
  if (!prev) return 0
  const prevGroup = prev.flow_group_id ?? prev.group_id
  const nextGroup = next.flow_group_id ?? next.group_id
  return prevGroup != null && nextGroup != null && prevGroup === nextGroup ? 1.2 : BLOCK_GAP_MM
}

function createMultiColumnTextLayoutForRun(pages, userLayoutSettings = {}, { contentWidthMm = TEXT_BOX_WIDTH_MM, contentHeightMm = TEXT_BOX_HEIGHT_MM } = {}) {
  const allBlocks = pages.flatMap((page) => page.textBlocks || []).filter((block) => block.slice)
  if (allBlocks.length === 0) return pages

  const templatePage = pages[0]
  const columnCount = resolveReadableColumnCount(userLayoutSettings, contentWidthMm)
  const gutter = COLUMN_GUTTER_MM
  const columnWidth = (contentWidthMm - gutter * (columnCount - 1)) / columnCount
  const outputPages = []
  let currentBlocks = []
  let colIdx = 0
  let yMm = 0
  let prevPlaced = null

  function flushPage() {
    if (currentBlocks.length > 0) {
      outputPages.push({ ...templatePage, images: [], textBlocks: currentBlocks })
    }
    currentBlocks = []
    colIdx = 0
    yMm = 0
    prevPlaced = null
  }

  function advanceColumn() {
    colIdx += 1
    yMm = 0
    prevPlaced = null
    if (colIdx >= columnCount) flushPage()
  }

  function placeBlock(block, slice, hMm) {
    const placed = {
      ...block,
      zone: {
        xMm: colIdx * (columnWidth + gutter),
        yMm,
        wMm: columnWidth,
        hMm,
      },
      slice,
    }
    currentBlocks.push(placed)
    yMm += hMm
    prevPlaced = placed
  }

  allBlocks.forEach((block) => {
    const role = block.role || 'body'
    let remaining = block.slice || ''
    if (!remaining) return

    while (remaining.length > 0) {
      const gap = gapBetweenBlocks(prevPlaced, block)
      if (yMm + gap >= contentHeightMm) advanceColumn()
      else yMm += gap

      if (!isBodyLikeRole(role)) {
        const hMm = textHeightMm({ text: remaining, charCount: remaining.length, role, wMm: columnWidth })
        if (currentBlocks.length > 0 && yMm + hMm > contentHeightMm) {
          yMm -= gap
          advanceColumn()
          continue
        }
        placeBlock(block, remaining, Math.min(hMm, contentHeightMm))
        remaining = ''
        continue
      }

      const availableHeight = contentHeightMm - yMm
      if (availableHeight < LINE_HEIGHT_MM) {
        yMm -= gap
        advanceColumn()
        continue
      }
      const capacity = Math.max(1, charsForHeight(availableHeight, columnWidth))
      const { slice, consumed } = sliceAtWordBoundary(remaining, capacity)
      if (!slice) {
        yMm -= gap
        advanceColumn()
        continue
      }
      const hMm = Math.min(textHeightMm({ text: slice, charCount: slice.length, role, wMm: columnWidth }), availableHeight)
      placeBlock(block, slice, hMm)
      remaining = remaining.slice(consumed)
    }
  })

  flushPage()
  return outputPages.length > 0 ? outputPages : pages
}
function createMultiColumnTextLayout(page, userLayoutSettings = {}, { contentWidthMm = TEXT_BOX_WIDTH_MM, contentHeightMm = TEXT_BOX_HEIGHT_MM } = {}) {
  // Heading-style roles (section_label, case_title_ko, title, etc.) keep whatever position/size
  // the LLM's own grid placement already gave them -- only body text gets re-flowed here.
  const nonBodyBlocks = page.textBlocks.filter((b) => !isReflowableBody(b))
  const bodyBlocks = page.textBlocks.filter(isReflowableBody)

  if (bodyBlocks.length === 0) {
    return [page]
  }


  // Body text starts below the lowest untouched heading, not at yMm=0 -- otherwise a reflowed
  // body column can land directly on top of a heading block occupying the same column (confirmed
  // 2026-07-16: a body block reflowed to column 0 collided with a "DESIGN CASE STUDIES" heading
  // already sitting at column 0). Only the first output page carries the headings, so later spill
  // pages (pure continued body text) start at the top as normal.
  const headingBottomMm = nonBodyBlocks.length > 0
    ? Math.max(...nonBodyBlocks.map((b) => b.zone.yMm + b.zone.hMm)) + BLOCK_GAP_MM
    : 0

  const columnCount = resolveReadableColumnCount(userLayoutSettings, contentWidthMm)
  const gutter = COLUMN_GUTTER_MM

  // Gutter-aware: columnCount columns plus (columnCount-1) gutters must fit inside
  // TEXT_BOX_WIDTH_MM, otherwise the last column's right edge sails past the margin (confirmed
  // 2026-07-16: columns=5 put column 4's right edge at 132mm against a 116mm content box).
  const columnWidth = (contentWidthMm - gutter * (columnCount - 1)) / columnCount
  const pageHeight = contentHeightMm
  const blockPerColumn = Math.ceil(bodyBlocks.length / columnCount)

  const outputPages = []
  // The untouched heading blocks belong on the original page only -- the first page produced
  // here carries them alongside the first batch of reflowed body text; any later spill page
  // (the body didn't fit in this page's columns) carries only continued body text.
  let currentBlocks = [...nonBodyBlocks]

  function flushPage() {
    if (currentBlocks.length > 0) outputPages.push({ ...page, textBlocks: currentBlocks })
    currentBlocks = []
  }

  // Only the first output page carries the untouched headings, so only its columns need to start
  // below them; every later spill page is pure body text and starts at the top.
  function freshColumnYMm() {
    return outputPages.length === 0 ? headingBottomMm : 0
  }

  // Each group of (up to) blockPerColumn source blocks is assigned its own column slot. A single
  // block's text may still need more vertical room than one column holds at the new, narrower
  // width -- this is exactly the bug that let text run off the physical page: a box's height,
  // computed for a much wider box, was being reused verbatim after narrowing it into a column
  // (confirmed 2026-07-16: a body_overflow block sized for a 116mm-wide box was placed into a
  // 23.2mm column with its old 176mm height untouched, so ~5x too little height for the same
  // text). When a block doesn't fit, keep slicing it at word boundaries into subsequent columns,
  // and once a page's columns are all used, spill onto a new page instead of overflowing.
  for (let groupIdx = 0; groupIdx < columnCount; groupIdx += 1) {
    const startIdx = groupIdx * blockPerColumn
    if (startIdx >= bodyBlocks.length) break
    const endIdx = Math.min(startIdx + blockPerColumn, bodyBlocks.length)
    const blocksForThisGroup = bodyBlocks.slice(startIdx, endIdx)

    let colIdx = groupIdx
    let yMm = freshColumnYMm()

    blocksForThisGroup.forEach((block) => {
      let remaining = block.slice || ''
      if (remaining.length === 0) return

      while (remaining.length > 0) {
        let availableHeight = pageHeight - yMm
        if (availableHeight < LINE_HEIGHT_MM) {
          colIdx += 1
          if (colIdx >= columnCount) {
            flushPage()
            colIdx = 0
          }
          yMm = freshColumnYMm()
          availableHeight = pageHeight - yMm
        }

        const capacity = Math.max(1, charsForHeight(availableHeight, columnWidth))
        const { slice, consumed } = sliceAtWordBoundary(remaining, capacity)
        const usedHeight = heightForChars(slice.length, columnWidth)

        currentBlocks.push({
          ...block,
          zone: {
            xMm: colIdx * (columnWidth + gutter), yMm, wMm: columnWidth, hMm: usedHeight,
          },
          slice,
        })

        yMm += usedHeight + BLOCK_GAP_MM
        remaining = remaining.slice(consumed)
      }
    })
  }

  flushPage()
  return outputPages.length > 0 ? outputPages : [{ ...page, textBlocks: nonBodyBlocks }]
}
