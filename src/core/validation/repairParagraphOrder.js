// Deterministic, API-free paragraph-order repair. If the LLM places later paragraphs on
// earlier pages than prior paragraphs, validation must fail because the user-authored reading
// sequence was inverted. Text-only layouts can be rebuilt into source order, but image layouts
// are left invalid so fallback can choose a candidate that still keeps images and related text
// together. It never edits or fabricates text; it only changes layout placement.

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

export function repairParagraphOrder(plan) {
  if (!hasParagraphOrderViolation(plan)) return { plan, repaired: false, actions: [] }
  if (hasImageElement(plan)) {
    return {
      plan,
      repaired: false,
      skipped: true,
      actions: [{
        action: 'skip_paragraph_order_repair_for_image_layout',
        reason: 'rebuilding text pages would separate images from their related text',
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
