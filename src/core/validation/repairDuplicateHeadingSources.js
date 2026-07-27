// Removes duplicate placements of a non-body (heading/label) text_source, keeping only its first
// occurrence in page/row/col order. Heading/label text is meant to appear exactly once -- unlike
// body text, which can legitimately split across a couple of columns, a duplicated heading is
// always a plan mistake, not a valid layout choice. Isolated from repairContentGroups.js (which
// also attempted to re-place scattered group members and had real placement bugs, confirmed
// 2026-07-27) -- this only ever deletes an element, never repositions one, so it cannot introduce a
// new overlap/overflow the way that rebuild logic did.
export function repairDuplicateHeadingSources(plan, textBlocks = []) {
  if (!plan || !Array.isArray(plan.pages) || !Array.isArray(textBlocks) || textBlocks.length === 0) {
    return { plan, repaired: false }
  }

  const roleBySource = new Map()
  textBlocks.forEach((block, index) => {
    if (!block) return
    roleBySource.set(`paragraph_${index + 1}`, block.role || 'body')
  })

  const isBodyLikeRole = (role) => role === 'body' || role === 'continuation_body'

  const workingPlan = JSON.parse(JSON.stringify(plan))
  let repaired = false
  const seen = new Set()

  workingPlan.pages.forEach((page) => {
    page.elements = (page.elements || []).filter((el) => {
      if (el.type !== 'text' || !el.text_source) return true
      const role = roleBySource.get(el.text_source)
      if (role === undefined || isBodyLikeRole(role)) return true
      if (seen.has(el.text_source)) {
        repaired = true
        return false
      }
      seen.add(el.text_source)
      return true
    })
  })

  return { plan: workingPlan, repaired }
}
