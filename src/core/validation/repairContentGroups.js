function isBodyLikeRole(role) {
  return role === 'body' || role === 'continuation_body'
}

function getSourceInfo(textBlocks = []) {
  const bySource = new Map()
  const byGroup = new Map()
  if (!Array.isArray(textBlocks)) return { bySource, byGroup }

  textBlocks.forEach((block, index) => {
    if (!block) return
    const source = 'paragraph_' + (index + 1)
    const info = {
      source,
      index,
      group_id: block.group_id,
      role: block.role || 'body',
      char_count: Number.isFinite(block.char_count) ? block.char_count : (block.text || '').length,
    }
    bySource.set(source, info)
    if (block.group_id != null) {
      if (!byGroup.has(block.group_id)) byGroup.set(block.group_id, [])
      byGroup.get(block.group_id).push(info)
    }
  })

  byGroup.forEach((items) => items.sort((a, b) => a.index - b.index))
  return { bySource, byGroup }
}

function sourceRoleToElementRole(role) {
  if (isBodyLikeRole(role)) return 'body'
  return 'section_label'
}

function collectPlacements(plan, sourceInfoBySource) {
  const placements = []
  ;(plan.pages || []).forEach((page, pageIdx) => {
    ;(page.elements || []).forEach((el, elIdx) => {
      if (el.type !== 'text') return
      const source = el.text_source
      const info = sourceInfoBySource.get(source)
      if (!info) return
      placements.push({
        pageIdx,
        elIdx,
        page,
        el,
        source,
        info,
        group_id: info.group_id,
        order: (page.page ?? pageIdx + 1) * 10000 + (el.row_start ?? 0) * 100 + (el.col_start ?? 0),
      })
    })
  })
  return placements
}

function hasInterleaving(groupPlacements, allPlacements) {
  if (groupPlacements.length <= 1) return false
  const groupId = groupPlacements[0].group_id
  const minOrder = Math.min(...groupPlacements.map((p) => p.order))
  const maxOrder = Math.max(...groupPlacements.map((p) => p.order))
  return allPlacements.some((p) => p.group_id !== groupId && p.order > minOrder && p.order < maxOrder)
}

function makeElementForSource(sourceInfo, template, rowStart, sequence, columns, rows) {
  const role = sourceRoleToElementRole(sourceInfo.role)
  const wantedRowSpan = role === 'body'
    ? Math.max(2, Math.min(4, Math.ceil((sourceInfo.char_count || 80) / 110)))
    : 1
  const rowSpan = Math.max(1, Math.min(wantedRowSpan, rows - rowStart + 1))
  const baseId = (template?.id || ('text_' + sourceInfo.source + '_group_repair_' + sequence))
    .replace(/(?:_paragraph_\d+_group_repair)+$/g, '')
  return {
    ...template,
    id: baseId + '_' + sourceInfo.source + '_group_repair',
    type: 'text',
    role,
    text_source: sourceInfo.source,
    col_start: 1,
    col_span: columns,
    row_start: rowStart,
    row_span: rowSpan,
  }
}

function renumberPages(plan) {
  ;(plan.pages || []).forEach((page, index) => { page.page = index + 1 })
}

export function repairContentGroups(plan, textBlocks = []) {
  if (!plan || !Array.isArray(plan.pages) || !Array.isArray(textBlocks) || textBlocks.length === 0) {
    return { plan, repaired: false, actions: [] }
  }

  const { bySource, byGroup } = getSourceInfo(textBlocks)
  if (byGroup.size === 0) return { plan, repaired: false, actions: [] }

  const workingPlan = JSON.parse(JSON.stringify(plan))
  const actions = []
  const columns = workingPlan.grid_spec?.columns ?? workingPlan.grid?.columns ?? 6
  const rows = workingPlan.grid_spec?.rows ?? workingPlan.grid?.rows ?? 12

  const seenNonBodySources = new Set()
  workingPlan.pages.forEach((page) => {
    page.elements = (page.elements || []).filter((el) => {
      if (el.type !== 'text' || !el.text_source) return true
      const info = bySource.get(el.text_source)
      if (!info || isBodyLikeRole(info.role)) return true
      if (seenNonBodySources.has(el.text_source)) {
        actions.push({ action: 'remove_duplicate_heading_source', text_source: el.text_source })
        return false
      }
      seenNonBodySources.add(el.text_source)
      return true
    })
  })

  let placements = collectPlacements(workingPlan, bySource)

  byGroup.forEach((expectedSources, groupId) => {
    if (expectedSources.length <= 1) return
    const groupPlacements = placements.filter((p) => p.group_id === groupId)
    if (groupPlacements.length === 0) return

    const pagesUsed = new Set(groupPlacements.map((p) => p.pageIdx))
    const placedSourceSet = new Set(groupPlacements.map((p) => p.source))
    const hasHeading = expectedSources.some((info) => !isBodyLikeRole(info.role))
    const hasBody = expectedSources.some((info) => isBodyLikeRole(info.role))
    const isSplit = pagesUsed.size > 1
      || hasInterleaving(groupPlacements, placements)
      || (hasHeading && hasBody && expectedSources.some((info) => !placedSourceSet.has(info.source)))

    if (!isSplit) return

    const firstPlacement = groupPlacements.slice().sort((a, b) => a.order - b.order)[0]
    const targetPageIdx = firstPlacement.pageIdx
    const templateBySource = new Map()
    groupPlacements.forEach((placement) => {
      if (!templateBySource.has(placement.source)) templateBySource.set(placement.source, placement.el)
    })
    const fallbackTemplate = groupPlacements[0].el

    workingPlan.pages.forEach((page) => {
      page.elements = (page.elements || []).filter((el) => {
        const info = bySource.get(el.text_source)
        return !(el.type === 'text' && info?.group_id === groupId)
      })
    })

    let row = 1
    const repairedElements = expectedSources.map((sourceInfo, index) => {
      const template = templateBySource.get(sourceInfo.source) || fallbackTemplate
      const el = makeElementForSource(sourceInfo, template, row, index, columns, rows)
      row += el.row_span + (isBodyLikeRole(sourceInfo.role) ? 1 : 0)
      if (row > rows) row = rows + 1
      return el
    })

    const dedicatedPage = {
      page: 0,
      elements: repairedElements,
    }
    workingPlan.pages.splice(Math.min(targetPageIdx + 1, workingPlan.pages.length), 0, dedicatedPage)

    actions.push({
      action: 'rebuild_content_group_on_dedicated_page',
      group_id: groupId,
      after_page: targetPageIdx + 1,
      text_sources: expectedSources.map((info) => info.source),
    })

    placements = collectPlacements(workingPlan, bySource)
  })

  workingPlan.pages = workingPlan.pages.filter((page) => Array.isArray(page.elements) && page.elements.length > 0)
  renumberPages(workingPlan)

  return {
    plan: workingPlan,
    repaired: actions.length > 0,
    actions,
  }
}
