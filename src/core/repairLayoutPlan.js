// Fixes only the handful of "obviously missing, obviously safe default" gaps the spec calls
// out explicitly. Anything else (overlaps, missing images, wrong grid, bad enum values) is left
// untouched — those need a real LLM retry or a fallback, not a guess.
export function repairLayoutPlan(plan) {
  const repairs = []
  const repaired = structuredClone(plan)

  if (repaired && typeof repaired === 'object') {
    if (!repaired.overflow_policy) {
      repaired.overflow_policy = {}
    }
    if (repaired.overflow_policy.body_overflow == null) {
      repaired.overflow_policy.body_overflow = 'continue_to_next_page'
      repairs.push('overflow_policy.body_overflow 누락 -> continue_to_next_page로 채움')
    }

    const pages = Array.isArray(repaired.pages) ? repaired.pages : []
    pages.forEach((page) => {
      const elements = Array.isArray(page.elements) ? page.elements : []
      elements.forEach((el) => {
        if (el.type === 'image' && el.fit == null) {
          el.fit = 'contain'
          repairs.push(`요소 ${el.id}: fit 누락 -> contain으로 채움`)
        }
        if (el.role == null) {
          el.role = el.type === 'image' ? 'support' : 'body'
          repairs.push(`요소 ${el.id}: role 누락 -> ${el.role}로 채움`)
        }
      })
    })
  }

  return { plan: repaired, repaired: repairs.length > 0, repairs }
}
