import { createOccupancyGrid, findNearestFreeSlot, isFree, occupy } from './gridOccupancy.js'

function getColumns(plan) {
  return plan?.grid_spec?.columns ?? plan?.grid?.columns ?? 6
}

function getRows(plan) {
  return plan?.grid_spec?.rows ?? plan?.grid?.rows ?? 12
}

function renumberPages(pages) {
  pages.forEach((page, i) => { page.page = i + 1 })
}

function imageIndexFromId(id) {
  const match = /^image_(\d+)$/.exec(id || '')
  return match ? Number(match[1]) : null
}

function collectSeenImageIndices(plan) {
  const seen = new Set()
  ;(plan?.pages || []).forEach((page) => {
    ;(page.elements || []).forEach((el) => {
      if (el.type !== 'image') return
      const index = imageIndexFromId(el.id)
      if (Number.isInteger(index)) seen.add(index)
    })
  })
  return seen
}

function occupyExistingElements(page, columns, rows) {
  const grid = createOccupancyGrid(columns, rows)
  ;(page.elements || []).forEach((el) => {
    if (!Number.isInteger(el.col_start) || !Number.isInteger(el.col_span)) return
    if (!Number.isInteger(el.row_start) || !Number.isInteger(el.row_span)) return
    if (!isFree(grid, el.col_start, el.col_span, el.row_start, el.row_span)) return
    occupy(grid, el.col_start, el.col_span, el.row_start, el.row_span, el.id)
  })
  return grid
}

function groupTextSourcesForImage(contentGroupModel, imageId) {
  const gid = contentGroupModel?.groupByImageId?.get(imageId)
  if (gid == null || !contentGroupModel?.groupByTextSource) return new Set()
  const sources = new Set()
  contentGroupModel.groupByTextSource.forEach((groupId, source) => {
    if (groupId === gid) sources.add(source)
  })
  return sources
}

function preferredPagesForImage(plan, contentGroupModel, imageId) {
  const sources = groupTextSourcesForImage(contentGroupModel, imageId)
  if (sources.size === 0) return plan.pages || []
  const matching = (plan.pages || []).filter((page) => (page.elements || [])
    .some((el) => el.type === 'text' && sources.has(el.text_source)))
  return matching.length > 0 ? matching : (plan.pages || [])
}

function imageSpanOptions(columns, rows) {
  const wide = Math.min(columns, Math.max(2, Math.ceil(columns / 2)))
  return [
    { colSpan: wide, rowSpan: Math.min(5, rows) },
    { colSpan: Math.min(columns, Math.max(2, wide - 1)), rowSpan: Math.min(4, rows) },
    { colSpan: Math.min(columns, 2), rowSpan: Math.min(3, rows) },
    { colSpan: columns, rowSpan: Math.min(4, rows) },
  ].filter((span, index, arr) => span.colSpan >= 1 && span.rowSpan >= 1
    && arr.findIndex((other) => other.colSpan === span.colSpan && other.rowSpan === span.rowSpan) === index)
}

function placeOnExistingPage(plan, imageEl, contentGroupModel, columns, rows) {
  const pages = preferredPagesForImage(plan, contentGroupModel, imageEl.id)
  for (const page of pages) {
    const grid = occupyExistingElements(page, columns, rows)
    for (const span of imageSpanOptions(columns, rows)) {
      const slot = findNearestFreeSlot(grid, span.colSpan, span.rowSpan, 1, 1)
      if (!slot) continue
      page.elements.push({
        ...imageEl,
        col_start: slot.colStart,
        col_span: span.colSpan,
        row_start: slot.rowStart,
        row_span: span.rowSpan,
      })
      return true
    }
  }
  return false
}

function appendImagePage(plan, imageEl, columns, rows) {
  const span = imageSpanOptions(columns, rows)[0] || { colSpan: columns, rowSpan: Math.min(4, rows) }
  const pageNo = (plan.pages?.length || 0) + 1
  if (!Array.isArray(plan.pages)) plan.pages = []
  plan.pages.push({
    page: pageNo,
    elements: [{
      ...imageEl,
      col_start: 1,
      col_span: span.colSpan,
      row_start: 1,
      row_span: span.rowSpan,
    }],
  })
}

function appendForcedFullBleedPage(plan, imageEl, columns, rows) {
  const pageNo = (plan.pages?.length || 0) + 1
  if (!Array.isArray(plan.pages)) plan.pages = []
  plan.pages.push({
    page: pageNo,
    elements: [{
      ...imageEl,
      role: 'hero',
      col_start: 1,
      col_span: columns,
      row_start: 1,
      row_span: rows,
      bleed: 'full',
    }],
  })
}

export function repairMissingImages(plan, { imageCount, contentGroupModel, forcedFullBleedImages = [] } = {}) {
  if (!plan || !Number.isInteger(imageCount) || imageCount <= 0) return { plan, repaired: false, actions: [] }

  const workingPlan = JSON.parse(JSON.stringify(plan))
  if (!Array.isArray(workingPlan.pages)) workingPlan.pages = []
  const columns = getColumns(workingPlan)
  const rows = getRows(workingPlan)
  const seen = collectSeenImageIndices(workingPlan)
  const forced = new Set((forcedFullBleedImages || []).map((n) => Number(n)))
  const actions = []

  for (let index = 1; index <= imageCount; index += 1) {
    if (seen.has(index)) continue
    const imageId = `image_${index}`
    const imageEl = {
      id: imageId,
      type: 'image',
      role: 'support',
      fit: 'contain',
      object_position: 'center',
    }

    if (forced.has(index)) {
      appendForcedFullBleedPage(workingPlan, imageEl, columns, rows)
      actions.push({ image: imageId, action: 'append_forced_full_bleed_page' })
      continue
    }

    const placed = placeOnExistingPage(workingPlan, imageEl, contentGroupModel, columns, rows)
    if (!placed) appendImagePage(workingPlan, imageEl, columns, rows)
    actions.push({ image: imageId, action: placed ? 'place_missing_image_in_free_slot' : 'append_missing_image_page' })
  }

  if (actions.length > 0) renumberPages(workingPlan.pages)
  return { plan: workingPlan, repaired: actions.length > 0, actions }
}
