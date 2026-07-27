// Deterministic content-group packer: the guaranteed-convergence backstop for group cohesion.
//
// Added 2026-07-27. Group cohesion validation (validateLayoutPlan.js) was shipped without any
// repair, so a plan that violated it simply hard-failed the whole generation -- and the LLM violates
// it routinely on multi-page documents (confirmed against two consecutive real generations:
// "그룹 2의 이미지와 관련 텍스트가 서로 다른 페이지(1, 2)", plus group-order inversions). Asking the
// model to satisfy the constraint and rejecting it when it does not is the wrong shape: WHICH image
// belongs with WHICH text is already known deterministically (buildContentGroups.js), so the system
// should place groups itself rather than grade the model on guessing.
//
// This packer is to group cohesion what enforceGridOccupancy is to overlaps: it cannot fail to
// converge, because it lays every group out from scratch in document order rather than nudging an
// existing arrangement. It runs only after cheaper repairs have failed, so a plan the model got
// right is never flattened by it.
//
// What it preserves from the LLM's plan: each element's identity, role, type, text_source, image
// fit/object_position, and the group's internal ordering. What it decides: which page each group
// lands on, and the rectangle it occupies. Text is never edited, summarised, or dropped.

import { estimateTextCapacityMm } from '../estimateTextCapacity.js'
import { gridToMm } from '../gridToMm.js'
import { GRID_COLUMNS, GRID_ROWS } from '../layoutConstants.js'

// Ordering inside one group, so a group always reads image -> heading -> body -> credit regardless
// of the order the model emitted its elements in.
const ROLE_RANK = {
  title: 0,
  section_label: 1,
  subtitle: 1,
  label: 1,
  body: 2,
  continuation_body: 2,
  quote: 2,
  caption: 3,
  credit: 3,
}

function roleRank(el) {
  if (el.type === 'image') return -1
  return ROLE_RANK[el.role] ?? 2
}

// Rows a text element needs at the given band width, from the real capacity model rather than a
// flat guess -- an under-estimate here would reintroduce the text-overflow failures this pipeline
// already fixed elsewhere.
function rowsNeededForText(el, charCount, colSpan, gridSpec) {
  if (!charCount) return 1
  const columns = gridSpec.columns
  const rows = gridSpec.rows
  for (let span = 1; span <= rows; span += 1) {
    const box = gridToMm(
      {
        col_start: 1, col_span: colSpan, row_start: 1, row_span: span,
      },
      { columns, rows, gutterMm: gridSpec.gutterMm },
    )
    if (estimateTextCapacityMm(box.wMm, box.hMm, el.role || 'body') >= charCount) return span
  }
  return rows
}

function charCountOf(textBlocks, textSource) {
  const match = /^paragraph_(\d+)$/.exec(textSource || '')
  if (!match) return 0
  const block = textBlocks[Number(match[1]) - 1]
  if (!block) return 0
  return Number.isFinite(block.char_count) ? block.char_count : (block.text || '').length
}

/**
 * @param {object} plan - the layout plan to repair
 * @param {object} contentGroupModel - from buildContentGroups(); the authority on membership
 * @param {object[]} textBlocks - for character counts
 * @returns {{plan: object, repaired: boolean, actions: object[]}}
 */
export function repairContentGroupLayout(plan, contentGroupModel, textBlocks = []) {
  const groups = contentGroupModel?.groups
  if (!plan || !Array.isArray(plan.pages) || !Array.isArray(groups) || groups.length === 0) {
    return { plan, repaired: false, actions: [] }
  }

  const gridSpec = {
    columns: plan.grid_spec?.columns ?? plan.grid?.columns ?? GRID_COLUMNS,
    rows: plan.grid_spec?.rows ?? plan.grid?.rows ?? GRID_ROWS,
    gutterMm: plan.grid_spec?.gutter_mm ?? 4,
  }

  // Index every existing element so the packer reuses the model's own elements (preserving ids,
  // roles, fit, object_position) instead of fabricating new ones.
  const elementByTextSource = new Map()
  const elementByImageId = new Map()
  plan.pages.forEach((page) => {
    ;(page.elements || []).forEach((el) => {
      if (el.type === 'image' && !elementByImageId.has(el.id)) elementByImageId.set(el.id, el)
      if (el.type === 'text' && el.text_source && !elementByTextSource.has(el.text_source)) {
        elementByTextSource.set(el.text_source, el)
      }
    })
  })

  // Two bands side by side when the grid is wide enough, otherwise a single full-width column.
  // Two bands is what produces the editorial "cards across a spread" rhythm; one band is right for
  // narrow grids where a half-width measure would be unreadable.
  const bandCount = gridSpec.columns >= 4 ? 2 : 1
  const bandSpan = Math.floor(gridSpec.columns / bandCount)
  const bands = Array.from({ length: bandCount }, (_, i) => ({
    colStart: i * bandSpan + 1,
    colSpan: bandSpan,
  }))

  // Build each group's element stack with its row requirement.
  const packedGroups = groups.map((group) => {
    const elements = []
    group.images.forEach((imageId) => {
      const existing = elementByImageId.get(imageId)
      elements.push(existing || {
        id: imageId, type: 'image', role: 'support', fit: 'contain', object_position: 'center',
      })
    })
    group.text_sources.forEach((source) => {
      const existing = elementByTextSource.get(source)
      elements.push(existing || {
        id: `text_${source}`, type: 'text', role: 'body', text_source: source,
      })
    })
    elements.sort((a, b) => roleRank(a) - roleRank(b))

    const sized = elements.map((el) => {
      if (el.type === 'image') {
        // Keep the model's chosen image height where it is sane; it encodes the visual emphasis the
        // model intended. Clamp so one oversized image cannot consume a whole page by itself.
        const wanted = Number.isFinite(el.row_span) ? el.row_span : 4
        return { el, rows: Math.max(2, Math.min(wanted, Math.floor(gridSpec.rows * 0.6))) }
      }
      return {
        el,
        rows: rowsNeededForText(el, charCountOf(textBlocks, el.text_source), bandSpan, gridSpec),
      }
    })

    return { group, sized, totalRows: sized.reduce((sum, s) => sum + s.rows, 0) }
  }).filter((g) => g.sized.length > 0)

  if (packedGroups.length === 0) return { plan, repaired: false, actions: [] }

  // Pack groups in document order: fill band 1 top-to-bottom, then band 2, then a new page.
  const pages = []
  let currentElements = []
  let bandIndex = 0
  let rowCursor = 1

  const flushPage = () => {
    if (currentElements.length > 0) pages.push({ page: pages.length + 1, elements: currentElements })
    currentElements = []
    bandIndex = 0
    rowCursor = 1
  }

  packedGroups.forEach(({ sized, totalRows }) => {
    // A group taller than a full band gets its own page and is allowed to overflow the row budget
    // rather than being split -- splitting is exactly what this repair exists to prevent.
    const groupRows = Math.min(totalRows, gridSpec.rows)

    if (rowCursor + groupRows - 1 > gridSpec.rows) {
      bandIndex += 1
      rowCursor = 1
      if (bandIndex >= bands.length) {
        flushPage()
      }
    }

    const band = bands[bandIndex]
    let cursor = rowCursor
    sized.forEach(({ el, rows }) => {
      const rowSpan = Math.max(1, Math.min(rows, gridSpec.rows - cursor + 1))
      currentElements.push({
        ...el,
        col_start: band.colStart,
        col_span: band.colSpan,
        row_start: cursor,
        row_span: rowSpan,
      })
      cursor += rowSpan
    })
    // One blank row between groups so adjacent groups read as separate units.
    rowCursor = Math.min(cursor + 1, gridSpec.rows + 1)
  })
  flushPage()

  if (pages.length === 0) return { plan, repaired: false, actions: [] }

  return {
    plan: { ...plan, pages },
    repaired: true,
    actions: [{
      action: 'repack_content_groups_in_document_order',
      group_count: packedGroups.length,
      page_count: pages.length,
      band_count: bandCount,
      reason: 'content groups were split across pages or interleaved; repacked so each group occupies one contiguous rectangle on a single page, in the user\'s input order',
    }],
  }
}
