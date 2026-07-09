// Collision repair: attempt to fix text-image overlaps by repositioning text blocks.
// Strategy: move text to empty grid regions, expand row_span, or move to next page.

export function repairCollisions(plan, collisionIssues, { maxRepairAttempts = 3 } = {}) {
  if (!Array.isArray(collisionIssues) || collisionIssues.length === 0) {
    return { plan, repaired: false, actions: [] }
  }

  const actions = []
  let repairedPlan = JSON.parse(JSON.stringify(plan)) // Deep clone
  let attemptCount = 0

  // Simple repair: move text elements down (increase row_start)
  const overlapIssues = collisionIssues.filter((i) => i.type?.includes('overlap'))

  overlapIssues.forEach((issue) => {
    if (attemptCount >= maxRepairAttempts) return

    const page = repairedPlan.pages?.find((p) => p.page === issue.page || repairedPlan.pages.indexOf(p) + 1 === issue.page)
    if (!page) return

    const textEl = page.elements?.find((el) => el.id === issue.element_a)
    const imageEl = page.elements?.find((el) => el.id === issue.element_b)

    if (!textEl || !imageEl) return

    // If text overlaps image, try moving text down
    if (textEl.type === 'text' && imageEl.type === 'image') {
      const imageBottom = imageEl.row_start + imageEl.row_span - 1
      const minGap = 1

      // Move text below image
      if (textEl.row_start <= imageBottom) {
        const newRowStart = imageBottom + minGap + 1
        if (newRowStart + textEl.row_span - 1 <= 12) { // Assume 12 rows
          textEl.row_start = newRowStart
          actions.push({
            issue: issue.type,
            action: 'move_text_block',
            target: textEl.id,
            from: { row_start: imageEl.row_start + imageEl.row_span },
            to: { row_start: newRowStart },
            reason: 'Moved text below image to avoid overlap',
          })
          attemptCount += 1
          return
        }
      }

      // If moving down doesn't work, try moving to next page
      if (repairedPlan.pages.length > 1) {
        const nextPageIdx = repairedPlan.pages.indexOf(page) + 1
        if (nextPageIdx < repairedPlan.pages.length) {
          const nextPage = repairedPlan.pages[nextPageIdx]
          page.elements = page.elements.filter((el) => el.id !== textEl.id)
          nextPage.elements.push({ ...textEl, row_start: 1 }) // Place at top of next page
          actions.push({
            issue: issue.type,
            action: 'move_to_next_page',
            target: textEl.id,
            from: { page: issue.page },
            to: { page: issue.page + 1 },
            reason: 'Moved text to next page to avoid overlap',
          })
          attemptCount += 1
        }
      }
    }
  })

  return {
    plan: repairedPlan,
    repaired: actions.length > 0,
    actions,
  }
}
