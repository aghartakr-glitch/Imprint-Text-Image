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
//
// CRITICAL: paragraphs stay atomic units. A previous version joined every paragraph into one
// giant string (`paragraphs.join('\n\n')`) before slicing by raw character capacity per slot --
// that ignores paragraph boundaries entirely and chops mid-sentence/mid-heading wherever a column
// happens to run out of room (confirmed in a real run: "DESIGN CASE STUDIES" and "사례들을" were
// each split across two columns). Each paragraph is now placed into a slot as a whole; only when a
// single paragraph is itself larger than the slot's remaining capacity does it continue into the
// next slot (still word-boundary safe, never combined with a different paragraph's text in the
// same slot).
export function flowTextAcrossColumns({
  textBlocks, flowRegions, reservedRegionsByPage = {}, gridSpec,
}) {
  const paragraphQueue = textBlocks.filter((b) => b.role === 'body').map((b) => b.text)

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

  while (paragraphQueue.length > 0) {
    const slot = ensureSlot()
    if (!slot) break // out of supplied slots; caller must add continuation flow_regions
    const capacity = slotCapacity(slot, gridSpec)
    if (capacity <= 0) continue // eslint-disable-line no-continue

    let slotText = ''
    let remainingCapacity = capacity
    // Pack as many WHOLE paragraphs as fit (with a blank-line separator between them).
    while (paragraphQueue.length > 0) {
      const next = paragraphQueue[0]
      const sepLen = slotText.length > 0 ? 2 : 0 // "\n\n"
      if (next.length + sepLen <= remainingCapacity) {
        slotText += (slotText.length > 0 ? '\n\n' : '') + next
        remainingCapacity -= next.length + sepLen
        paragraphQueue.shift()
      } else {
        break
      }
    }
    // If the slot is still empty, one oversized paragraph must be split across slots -- slice
    // only that paragraph at a word boundary, never mixing it with any other paragraph's text.
    if (slotText.length === 0 && paragraphQueue.length > 0) {
      const { slice, consumed } = sliceAtWordBoundary(paragraphQueue[0], capacity)
      slotText = slice
      const restOfParagraph = paragraphQueue[0].slice(consumed)
      paragraphQueue[0] = restOfParagraph
      if (restOfParagraph.length === 0) paragraphQueue.shift()
    }
    if (slotText.length === 0) continue // eslint-disable-line no-continue -- capacity too small even for one word; try next slot
    filledSlots.push({ ...slot, textSlice: slotText })
  }

  return { filledSlots, remainingText: paragraphQueue.join('\n\n') }
}

// Builds a full-column-width continuation flow_region for the next page once every supplied slot
// is exhausted but text remains -- matches overflow_policy "continue_to_next_column_then_page".
export function makeContinuationFlowRegion({ page, gridSpec }) {
  return {
    page, col_start: 1, col_span: gridSpec.columns, row_start: 1, row_span: gridSpec.rows, flow_columns: gridSpec.columns,
  }
}
