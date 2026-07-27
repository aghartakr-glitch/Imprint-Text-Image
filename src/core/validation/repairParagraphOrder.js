// Deterministic, API-free paragraph-order repair. If the LLM places later paragraphs on
// earlier pages than prior paragraphs, validation must fail because the user-authored reading
// sequence was inverted. It never edits or fabricates text; it only changes layout placement.

function paragraphIndex(textSource) {
  const match = /^paragraph_(\d+)$/.exec(textSource || '')
  return match ? Number(match[1]) : null
}

function hasParagraphOrderViolation(plan) {
  if (!plan || !Array.isArray(plan.pages)) return false
  const firstPageByParagraph = new Map()
  plan.pages.forEach((page, pageIdx) => {
    const elements = Array.isArray(page.elements) ? page.elements : []
    elements.forEach((el) => {
      const n = paragraphIndex(el.text_source)
      if (n == null) return
      if (!firstPageByParagraph.has(n)) firstPageByParagraph.set(n, pageIdx)
    })
  })

  let maxPageSoFar = -1
  return [...firstPageByParagraph.keys()].sort((a, b) => a - b).some((n) => {
    const firstPage = firstPageByParagraph.get(n)
    const violated = firstPage < maxPageSoFar
    maxPageSoFar = Math.max(maxPageSoFar, firstPage)
    return violated
  })
}

function hasImageElement(plan) {
  return Array.isArray(plan?.pages) && plan.pages.some((page) => (
    Array.isArray(page.elements) && page.elements.some((el) => el.type === 'image')
  ))
}

function renumberPages(pages) {
  pages.forEach((page, i) => { page.page = i + 1 })
}

// Whole-page reordering: each page's own elements (image + any co-located text) are never
// separated or edited -- only the ORDER of pages is changed, by sorting on each page's earliest
// paragraph reference. A page with no text reference of its own (a pure-image page) has no
// paragraph key to sort by; it is anchored to the nearest preceding text-bearing page's key (or,
// if it's before any text-bearing page, to the nearest following one) so it stays next to the
// same neighbor it started next to, rather than drifting to an arbitrary position.
function reorderPagesByParagraphOrder(plan) {
  const workingPlan = JSON.parse(JSON.stringify(plan))
  const pages = workingPlan.pages

  const rawKeys = pages.map((page) => {
    const indices = (page.elements || [])
      .map((el) => paragraphIndex(el.text_source))
      .filter((n) => n != null)
    return indices.length > 0 ? Math.min(...indices) : null
  })

  const keys = rawKeys.slice()
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i] != null) continue
    const prevKey = [...keys.slice(0, i)].reverse().find((k) => k != null)
    const nextIdx = keys.findIndex((k, j) => j > i && k != null)
    const nextKey = nextIdx === -1 ? null : keys[nextIdx]
    if (prevKey != null) {
      keys[i] = prevKey + 0.5
    } else if (nextKey != null) {
      keys[i] = nextKey - 0.5
    } else {
      keys[i] = i // no text anywhere in the plan -- keep original order
    }
  }

  const order = pages.map((_, i) => i).sort((a, b) => (keys[a] - keys[b]) || (a - b))
  workingPlan.pages = order.map((i) => pages[i])
  renumberPages(workingPlan.pages)
  return workingPlan
}

export function repairParagraphOrder(plan) {
  if (!hasParagraphOrderViolation(plan)) return { plan, repaired: false, actions: [] }

  if (hasImageElement(plan)) {
    const reordered = reorderPagesByParagraphOrder(plan)
    if (hasParagraphOrderViolation(reordered)) {
      // Some elements are split across multiple pages under the same paragraph index (e.g. an
      // overflowed body continuing onto a later page) in a way whole-page reordering can't
      // resolve without separating an image from its co-located text -- leave the plan
      // untouched so the caller's fallback path can pick a different candidate instead.
      return {
        plan,
        repaired: false,
        skipped: true,
        actions: [{
          action: 'skip_paragraph_order_repair_for_image_layout',
          reason: 'whole-page reordering did not fully resolve the violation without separating an image from its co-located text',
        }],
      }
    }
    return {
      plan: reordered,
      repaired: true,
      actions: [{
        action: 'reorder_pages_by_paragraph_order',
        reason: 'pages were reordered as whole units (images stay with their co-located text) to match paragraph_N reading order',
      }],
    }
  }

  const columns = plan.grid_spec?.columns ?? plan.grid?.columns ?? 6
  const rows = plan.grid_spec?.rows ?? plan.grid?.rows ?? 12
  const workingPlan = JSON.parse(JSON.stringify(plan))
  const seenTextSources = new Set()
  const orderedTextElements = []

  const pagesWithoutParagraphText = workingPlan.pages
    .map((page) => {
      const keptElements = []
      ;(page.elements || []).forEach((el) => {
        const n = paragraphIndex(el.text_source)
        if (el.type === 'text' && n != null) {
          if (!seenTextSources.has(el.text_source)) {
            seenTextSources.add(el.text_source)
            orderedTextElements.push({ ...el, __paragraphIndex: n })
          }
          return
        }
        keptElements.push(el)
      })
      return { ...page, elements: keptElements }
    })
    .filter((page) => Array.isArray(page.elements) && page.elements.length > 0)

  orderedTextElements.sort((a, b) => a.__paragraphIndex - b.__paragraphIndex)

  const textPages = orderedTextElements.map((el) => {
    const { __paragraphIndex, ...cleanEl } = el
    return {
      page: 0,
      elements: [{
        ...cleanEl,
        col_start: 1,
        col_span: columns,
        row_start: 1,
        row_span: rows,
      }],
    }
  })

  workingPlan.pages = [...pagesWithoutParagraphText, ...textPages]
  renumberPages(workingPlan.pages)

  return {
    plan: workingPlan,
    repaired: true,
    actions: [{
      action: 'rebuild_text_pages_in_paragraph_order',
      moved_text_blocks: orderedTextElements.length,
      reason: 'paragraph_N first appearances were out of reading order',
    }],
  }
}
