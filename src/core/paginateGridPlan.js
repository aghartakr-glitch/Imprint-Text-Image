import { CHAR_WIDTH_MM, LINE_HEIGHT_MM } from './layoutConstants.js'
import { gridToMm } from './gridToMm.js'

function textCapacity(wMm, hMm) {
  const charsPerLine = Math.floor(wMm / CHAR_WIDTH_MM)
  const lines = Math.floor(hMm / LINE_HEIGHT_MM)
  return Math.max(0, charsPerLine * lines)
}

// A full-page text-only box used for continuation pages once body text overflows every body box
// the plan itself defined. Matches overflow_policy.body_overflow: continue_to_next_page.
const OVERFLOW_BODY_ELEMENT = {
  id: 'body_overflow', type: 'text', role: 'body', col_start: 1, col_span: 6, row_start: 1, row_span: 12,
}

// Distributes the full body text across the plan's own body-role text boxes (one per page, in
// page order), then appends as many full-page continuation pages as needed for whatever text
// doesn't fit -- deterministic pagination, never shrinking font size or leading. Returns an array
// of { elements, textSlicesByElementId } ready for resolveGridPage.
export function paginateGridPlan(plan, text) {
  let remainingText = text

  const planPages = plan.pages.map((page) => {
    const bodyEl = page.elements.find((el) => el.type === 'text' && el.role === 'body')
    const textSlicesByElementId = {}
    if (bodyEl) {
      const box = gridToMm(bodyEl)
      const capacity = textCapacity(box.wMm, box.hMm)
      const slice = capacity > 0 && remainingText.length > 0 ? remainingText.slice(0, capacity) : null
      if (slice) remainingText = remainingText.slice(slice.length)
      textSlicesByElementId[bodyEl.id] = slice
    }
    return { elements: page.elements, textSlicesByElementId }
  })

  const overflowPages = []
  while (remainingText.length > 0) {
    const box = gridToMm(OVERFLOW_BODY_ELEMENT)
    const capacity = textCapacity(box.wMm, box.hMm)
    if (capacity <= 0) throw new Error('오버플로우 텍스트 페이지의 수용량이 0입니다')
    const slice = remainingText.slice(0, capacity)
    remainingText = remainingText.slice(capacity)
    overflowPages.push({
      elements: [OVERFLOW_BODY_ELEMENT],
      textSlicesByElementId: { [OVERFLOW_BODY_ELEMENT.id]: slice },
    })
  }

  return [...planPages, ...overflowPages]
}
