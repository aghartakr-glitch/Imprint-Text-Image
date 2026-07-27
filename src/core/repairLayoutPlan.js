// Fixes only the handful of "obviously missing, obviously safe default" gaps the spec calls
// out explicitly. Anything else (overlaps, missing images, wrong grid, bad enum values) is left
// untouched — those need a real LLM retry or a fallback, not a guess.
export function repairLayoutPlan(plan, { forcedFullBleedImages = [] } = {}) {
  const repairs = []
  const repaired = structuredClone(plan)
  // Images the user explicitly pinned as full-page. Their bleed flag must never be stripped -- for
  // those, a page sharing other elements is a placement problem to solve elsewhere, not a stray flag.
  const forcedIds = new Set((forcedFullBleedImages || []).map((n) => `image_${n}`))

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
        // bleed:"full" means "this image alone fills the entire page", so it is only legal when the
        // page holds nothing else. The model frequently marks an image full-bleed while also placing
        // text and other images on that page (confirmed 2026-07-27: three such errors in one real
        // generation, which hard-failed the whole run because nothing repaired it). Dropping the
        // flag is always safe -- the image keeps the grid slot it was given and simply stops
        // claiming the whole page -- so this is a defaults-level fix, not a layout decision.
        if (el.bleed === 'full' && elements.length > 1 && !forcedIds.has(el.id)) {
          delete el.bleed
          repairs.push(`요소 ${el.id}: 페이지에 다른 요소가 있어 bleed:"full" 해제`)
        }
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
