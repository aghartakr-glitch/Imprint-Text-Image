import { CHAR_WIDTH_MM, LINE_HEIGHT_MM } from './layoutConstants.js'
import { gridToMm } from './gridToMm.js'

// Never touches font size or leading (body_font_size_pt=9 / body_leading_pt=14 stay fixed) --
// this only estimates how many characters fit, so overflow can be routed to more pages instead.
export function estimateTextCapacityMm(wMm, hMm) {
  const charsPerLine = Math.floor(wMm / CHAR_WIDTH_MM)
  const lines = Math.floor(hMm / LINE_HEIGHT_MM)
  return Math.max(0, charsPerLine * lines)
}

export function estimateTextCapacity(gridElement) {
  const box = gridToMm(gridElement)
  return estimateTextCapacityMm(box.wMm, box.hMm)
}
