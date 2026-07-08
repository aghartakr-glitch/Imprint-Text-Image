import { gridToMm } from '../gridToMm.js'
import { estimateTextCapacityMm } from '../estimateTextCapacity.js'
import { expandFlowRegionToSlots } from '../layout/ReservedRegionManager.js'

// Same word-boundary logic as paginateGridPlan.js's overflow handling: never cut a slice
// mid-word, and never leave a leading space on the next slice.
function sliceAtWordBoundary(text, capacity) {
  if (text.length <= capacity) return { slice: text, consumed: text.length }
  const hardCut = text.slice(0, capacity)
  const lastBreak = Math.max(hardCut.lastIndexOf(' '), hardCut.lastIndexOf('\n'))
  if (lastBreak <= 0) return { slice: hardCut, consumed: hardCut.length }
  const slice = hardCut.slice(0, lastBreak)
  let consumed = lastBreak
  while (consumed < text.length && /\s/.test(text[consumed])) consumed += 1
  return { slice, consumed }
}

function slotCapacity(slot, gridSpec) {
  const box = gridToMm(slot, {
    boxWidthMm: gridSpec.boxWidthMm, boxHeightMm: gridSpec.boxHeightMm, columns: gridSpec.columns, rows: gridSpec.rows, gutterMm: gridSpec.gutterMm,
  })
  return estimateTextCapacityMm(box.wMm, box.hMm)
}

// Spec section 5.2/7: flows paragraph-aware, word-boundary-safe body text across a sequence of
// column slots (one flow_region expanded to per-column free segments via ReservedRegionManager),
// then across whatever additional flow_regions the caller supplies for later pages. Paragraphs
// are never merged or reordered; a paragraph that doesn't fully fit in one slot continues into
// the next slot exactly where it left off (still word-boundary safe). Never shrinks font size or
// leading, never truncates -- if every supplied slot fills up, the caller must add more pages
// (see makeContinuationFlowRegion below).
export function flowTextAcrossColumns({
  textBlocks, flowRegions, reservedRegionsByPage = {}, gridSpec,
}) {
  const bodyParagraphs = textBlocks.filter((b) => b.role === 'body').map((b) => b.text)
  let remaining = bodyParagraphs.join('\n\n')

  const filledSlots = []
  let flowRegionIndex = 0
  let slotQueue = []

  function ensureSlot() {
    while (slotQueue.length === 0) {
      if (flowRegionIndex >= flowRegions.length) return null
      const region = flowRegions[flowRegionIndex]
      flowRegionIndex += 1
      slotQueue = expandFlowRegionToSlots(region, reservedRegionsByPage[region.page ?? 1] ?? [])
    }
    return slotQueue.shift()
  }

  while (remaining.length > 0) {
    const slot = ensureSlot()
    if (!slot) break // out of supplied slots; caller must add continuation flow_regions
    const capacity = slotCapacity(slot, gridSpec)
    if (capacity <= 0) continue // eslint-disable-line no-continue
    const { slice, consumed } = sliceAtWordBoundary(remaining, capacity)
    remaining = remaining.slice(consumed)
    filledSlots.push({ ...slot, textSlice: slice })
  }

  return { filledSlots, remainingText: remaining }
}

// Builds a full-column-width continuation flow_region for the next page once every supplied slot
// is exhausted but text remains -- matches overflow_policy "continue_to_next_column_then_page".
export function makeContinuationFlowRegion({ page, gridSpec }) {
  return {
    page, col_start: 1, col_span: gridSpec.columns, row_start: 1, row_span: gridSpec.rows, flow_columns: gridSpec.columns,
  }
}
