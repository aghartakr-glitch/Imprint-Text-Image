// A full-bleed image on a portrait page (bleed:'full', fit:'contain') only fills the whole page
// edge-to-edge when its own aspect ratio matches the page's. A landscape photo on a portrait page
// binds by width and leaves a real, empty gap below it -- per user decision (2026-08-05), that gap
// should hold real body text carried over from the next page, not sit empty.
//
// Deliberately conservative about WHICH block it touches:
//   - the next page keeps at least one block (or an image) after the move, so it never goes empty
//     (an empty page trips validateResolvedLayout's empty_page check)
//   - the block's role is body/continuation_body (a heading opening a new section must never get
//     stranded on the previous page, ahead of its own group)
// But NOT conservative about HOW MUCH of it moves: per user feedback (2026-08-05), refusing to
// touch a block just because it doesn't fit whole would mean this only ever fires by luck on
// short paragraphs -- reuses sliceAtWordBoundary (the same word-boundary-safe cut
// paginateGridPlan.js's own overflow handling uses) to fill the gap as full as it goes and leave
// the true remainder as a continuation_body block on the next page, exactly like any other
// overflow split in this pipeline.
import { estimateTextCapacityMm } from '../estimateTextCapacity.js'
import { sliceAtWordBoundary } from '../paginateGridPlan.js'

const MIN_GAP_MM = 30
const GAP_TOP_MARGIN_MM = 6
const GAP_BOTTOM_MARGIN_MM = 6
const MIN_WORTHWHILE_FIT_CHARS = 40 // below this, a sliver isn't worth splitting off

function readImageRatio(img, imagePaths, imageAspectRatios) {
  const idx = imagePaths.indexOf(img.path)
  const ratio = idx >= 0 ? imageAspectRatios[idx] : null
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null
}

export function fillFullBleedGaps(pages, { imagePaths = [], imageAspectRatios = [], geometry } = {}) {
  if (!Array.isArray(pages)) return pages

  return pages.map((page, i) => {
    if (!Array.isArray(page.images) || page.images.length !== 1) return page
    const [img] = page.images
    if (!img.fullBleed) return page
    if ((Array.isArray(page.textBlocks) && page.textBlocks.length > 0) || page.textZone) return page

    const ratio = readImageRatio(img, imagePaths, imageAspectRatios)
    if (!ratio) return page

    const pageWMm = img.wMm
    const pageHMm = img.hMm
    const pageRatio = pageWMm / pageHMm
    if (ratio <= pageRatio) return page // taller-than-page image binds by height -- no vertical gap

    const renderedHMm = pageWMm / ratio
    const gapMm = pageHMm - renderedHMm
    if (gapMm < MIN_GAP_MM) return page

    const next = pages[i + 1]
    if (!next || !Array.isArray(next.textBlocks) || next.textBlocks.length === 0) return page
    const [firstBlock, ...restBlocks] = next.textBlocks
    if (!firstBlock || (firstBlock.role !== 'body' && firstBlock.role !== 'continuation_body')) return page

    const marginMm = geometry?.marginOuterMm ?? 14
    const zoneWMm = Math.max(10, pageWMm - marginMm * 2)
    const zoneHMm = gapMm - GAP_TOP_MARGIN_MM - GAP_BOTTOM_MARGIN_MM
    if (zoneHMm < 15) return page

    const fullSlice = firstBlock.slice || ''
    if (fullSlice.length === 0) return page
    const capacity = estimateTextCapacityMm(zoneWMm, zoneHMm, firstBlock.role)
    const { slice: fitted, consumed } = sliceAtWordBoundary(fullSlice, Math.max(1, capacity))
    if (!fitted || fitted.trim().length < MIN_WORTHWHILE_FIT_CHARS) return page // not worth splitting off

    const remaining = fullSlice.slice(consumed)
    if (remaining.length === 0) {
      // Whole block moved -- must not leave the next page empty.
      const nextStillHasContent = restBlocks.length > 0 || (Array.isArray(next.images) && next.images.length > 0)
      if (!nextStillHasContent) return page
      next.textBlocks = restBlocks
    } else {
      next.textBlocks = [
        { ...firstBlock, slice: remaining, role: firstBlock.role === 'body' ? 'continuation_body' : firstBlock.role },
        ...restBlocks,
      ]
    }

    return {
      ...page,
      textBlocks: [{
        ...firstBlock,
        slice: fitted,
        zone: {
          xMm: marginMm, yMm: renderedHMm + GAP_TOP_MARGIN_MM, wMm: zoneWMm, hMm: zoneHMm,
        },
      }],
    }
  })
}
