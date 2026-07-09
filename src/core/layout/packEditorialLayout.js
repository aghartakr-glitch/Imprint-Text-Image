// Deterministic layout packer: converts an LLM candidate's editorial INTENT (groups,
// reading_flow, preferred spans) into concrete grid geometry (pages[].elements[] with
// col_start/col_span/row_start/row_span). This is the "code does geometry, LLM does editorial
// reasoning" half of the redesign -- the LLM is never asked to hand-compute row_start/row_span/
// collision-free coordinates; this module does that deterministically instead.
//
// Backward compatible: if a candidate already has fully-specified pages[].elements[] (the old
// schema) and no groups[], it is passed through unchanged -- packing only kicks in for
// group-based candidates.
import {
  PAGE_WIDTH_MM, PAGE_HEIGHT_MM, GRID_COLUMNS, GRID_ROWS, GRID_GUTTER_MM,
  CHAR_WIDTH_MM, LINE_HEIGHT_MM,
} from '../layoutConstants.js'

const ROW_GAP_UNITS = 1 // minimum empty rows left between vertically stacked bands (no row gutter exists otherwise)
const DEFAULT_IMAGE_RATIO = 1.33 // width/height fallback when metadata is missing

function planHasExplicitGeometry(plan) {
  const pages = Array.isArray(plan.pages) ? plan.pages : []
  return pages.length > 0 && pages.every((p) => Array.isArray(p.elements))
}

function resolveTextSourceIndex(textSource) {
  const match = /^paragraph_(\d+)$/.exec(textSource || '')
  return match ? Number(match[1]) : null
}

function resolveTextBlock(textBlocks, textSource) {
  if (textSource === 'title') return { char_count: 40, role: 'title' }
  const n = resolveTextSourceIndex(textSource)
  if (n == null) return null
  const block = (textBlocks || [])[n - 1]
  if (!block) return null
  const roleHint = String(block.role || '').toLowerCase()
  const role = /title|section|header|label/.test(roleHint) ? 'section_label' : 'body'
  return { char_count: block.char_count || (block.text ? block.text.length : 80), role }
}

function resolveImageRatio(imageMetadata, imageId) {
  const meta = (imageMetadata || []).find((m) => m.id === imageId || m.id === imageId?.replace(/^image_/, 'image_'))
  const ratio = meta?.ratio ?? meta?.aspect_ratio
  return Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_IMAGE_RATIO
}

function colSpanToMm(colSpan, columns) {
  const colWidth = PAGE_WIDTH_MM / columns
  return colSpan * colWidth + (colSpan - 1) * GRID_GUTTER_MM
}

function rowHeightMm(rows) {
  return PAGE_HEIGHT_MM / rows
}

// How many grid rows a text block needs to hold charCount characters at colSpan width.
function computeTextRowSpan(charCount, colSpan, columns, rows) {
  const wMm = colSpanToMm(colSpan, columns)
  const charsPerLine = Math.max(1, Math.floor(wMm / CHAR_WIDTH_MM))
  const lines = Math.max(1, Math.ceil(charCount / charsPerLine))
  const hMm = lines * LINE_HEIGHT_MM
  return Math.max(1, Math.min(rows, Math.ceil(hMm / rowHeightMm(rows))))
}

// How many grid rows an image needs to preserve its aspect ratio at colSpan width.
function computeImageRowSpan(ratio, colSpan, columns, rows) {
  const wMm = colSpanToMm(colSpan, columns)
  const hMm = wMm / ratio
  return Math.max(1, Math.min(rows, Math.ceil(hMm / rowHeightMm(rows))))
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

// Packs one group into a vertical "band" starting at row cursorRow, returning the elements
// produced and the total row_span the band consumed (for cursor advancement).
function packGroup(group, {
  columns, rows, textBlocks, imageMetadata, cursorRow, idPrefix,
}) {
  const imageIds = Array.isArray(group.image_ids) ? group.image_ids : []
  const textSources = Array.isArray(group.text_sources) ? group.text_sources : []
  const elements = []

  const preferredImageSpan = clamp(Number(group.preferred_image_span) || 2, 1, columns)
  const preferredTextSpan = clamp(Number(group.preferred_text_span) || (columns - preferredImageSpan) || columns, 1, columns)

  const sideBySide = imageIds.length > 0 && textSources.length > 0
    && preferredImageSpan + preferredTextSpan <= columns

  if (sideBySide) {
    const imgColSpan = preferredImageSpan
    const textColSpan = clamp(preferredTextSpan, 1, columns - imgColSpan)
    const imgColStart = 1
    const textColStart = imgColSpan + 1

    let imgRow = cursorRow
    imageIds.forEach((imageId, i) => {
      const ratio = resolveImageRatio(imageMetadata, imageId)
      const rowSpan = computeImageRowSpan(ratio, imgColSpan, columns, rows)
      elements.push({
        id: imageId, type: 'image', role: i === 0 ? 'hero' : 'support', col_start: imgColStart, col_span: imgColSpan, row_start: imgRow, row_span: rowSpan, fit: 'contain', object_position: 'center',
      })
      imgRow += rowSpan + ROW_GAP_UNITS
    })

    let textRow = cursorRow
    textSources.forEach((textSource, i) => {
      const resolved = resolveTextBlock(textBlocks, textSource)
      if (!resolved) return
      const rowSpan = computeTextRowSpan(resolved.char_count, textColSpan, columns, rows)
      elements.push({
        id: `${idPrefix}_t${i + 1}`, type: 'text', role: resolved.role, text_source: textSource, col_start: textColStart, col_span: textColSpan, row_start: textRow, row_span: rowSpan,
      })
      textRow += rowSpan + ROW_GAP_UNITS
    })

    const imgBandEnd = imgRow - ROW_GAP_UNITS
    const textBandEnd = textRow - ROW_GAP_UNITS
    const bandRowSpan = Math.max(imgBandEnd, textBandEnd) - cursorRow + 1
    return { elements, bandRowSpan: clamp(bandRowSpan, 1, rows) }
  }

  // Stacked (full-width) fallback: images first, then texts, each full-width bands.
  let row = cursorRow
  imageIds.forEach((imageId, i) => {
    const ratio = resolveImageRatio(imageMetadata, imageId)
    const colSpan = clamp(preferredImageSpan, 1, columns)
    const rowSpan = computeImageRowSpan(ratio, colSpan, columns, rows)
    elements.push({
      id: imageId, type: 'image', role: i === 0 ? 'hero' : 'support', col_start: 1, col_span: colSpan, row_start: row, row_span: rowSpan, fit: 'contain', object_position: 'center',
    })
    row += rowSpan + ROW_GAP_UNITS
  })
  textSources.forEach((textSource, i) => {
    const resolved = resolveTextBlock(textBlocks, textSource)
    if (!resolved) return
    const colSpan = clamp(preferredTextSpan, 1, columns)
    const rowSpan = computeTextRowSpan(resolved.char_count, colSpan, columns, rows)
    elements.push({
      id: `${idPrefix}_t${i + 1}`, type: 'text', role: resolved.role, text_source: textSource, col_start: 1, col_span: colSpan, row_start: row, row_span: rowSpan,
    })
    row += rowSpan + ROW_GAP_UNITS
  })

  const bandRowSpan = row - ROW_GAP_UNITS - cursorRow + 1
  return { elements, bandRowSpan: clamp(bandRowSpan, 1, rows) }
}

// Ensures every uploaded image and every source paragraph is referenced by at least one group --
// appends trailing single-item groups for anything the LLM's groups[] left out, so nothing is
// ever silently dropped (a hard requirement carried over from the original spec).
function fillCoverageGaps(groups, { imageCount, textBlocks }) {
  const coveredImages = new Set(groups.flatMap((g) => g.image_ids || []))
  const coveredText = new Set(groups.flatMap((g) => g.text_sources || []))
  const extra = []

  for (let n = 1; n <= (imageCount || 0); n += 1) {
    const id = `image_${n}`
    if (!coveredImages.has(id)) {
      extra.push({
        group_id: `auto_image_${n}`, type: 'case_block', image_ids: [id], text_sources: [], preferred_image_span: 2, preferred_text_span: 2,
      })
    }
  }
  ;(textBlocks || []).forEach((_, i) => {
    const source = `paragraph_${i + 1}`
    if (!coveredText.has(source)) {
      extra.push({
        group_id: `auto_text_${i + 1}`, type: 'case_block', image_ids: [], text_sources: [source], preferred_image_span: 0, preferred_text_span: 3,
      })
    }
  })

  return [...groups, ...extra]
}

// Light normalization before packing: guarantees groups/reading_flow are arrays and required
// enum-ish fields have safe fallbacks, so packEditorialLayout never has to null-check the raw
// LLM output. Does not compute any geometry.
export function normalizeLayoutIntent(rawPlan) {
  if (!rawPlan || typeof rawPlan !== 'object') return rawPlan
  return {
    ...rawPlan,
    groups: Array.isArray(rawPlan.groups) ? rawPlan.groups : [],
    reading_flow: Array.isArray(rawPlan.reading_flow) ? rawPlan.reading_flow : [],
  }
}

// Main entry: converts candidate.groups (+ reading_flow) into candidate.pages[].elements[].
// Passes through unchanged if the candidate already has fully-specified geometry.
export function packEditorialLayout({
  candidate, gridSpec, textBlocks, imageMetadata, imageCount,
}) {
  if (!candidate || typeof candidate !== 'object') return candidate
  if (planHasExplicitGeometry(candidate) && !Array.isArray(candidate.groups)) return candidate

  const columns = gridSpec?.columns ?? candidate.grid?.columns ?? GRID_COLUMNS
  const rows = gridSpec?.rows ?? candidate.grid?.rows ?? GRID_ROWS

  const rawGroups = Array.isArray(candidate.groups) ? candidate.groups : []
  const groups = fillCoverageGaps(rawGroups, { imageCount, textBlocks })

  const orderIds = Array.isArray(candidate.reading_flow) && candidate.reading_flow.length > 0
    ? candidate.reading_flow
    : groups.map((g) => g.group_id)
  const byId = new Map(groups.map((g) => [g.group_id, g]))
  const orderedGroups = [
    ...orderIds.map((id) => byId.get(id)).filter(Boolean),
    ...groups.filter((g) => !orderIds.includes(g.group_id)),
  ]

  const pages = []
  let currentElements = []
  let cursorRow = 1
  let pageNumber = 1

  function pushPage() {
    if (currentElements.length > 0) {
      pages.push({ page: pageNumber, elements: currentElements })
      pageNumber += 1
    }
    currentElements = []
    cursorRow = 1
  }

  orderedGroups.forEach((group, gi) => {
    const { elements, bandRowSpan } = packGroup(group, {
      columns, rows, textBlocks, imageMetadata, cursorRow, idPrefix: group.group_id || `g${gi}`,
    })

    if (cursorRow + bandRowSpan - 1 > rows) {
      pushPage()
      const retry = packGroup(group, {
        columns, rows, textBlocks, imageMetadata, cursorRow, idPrefix: group.group_id || `g${gi}`,
      })
      currentElements = currentElements.concat(retry.elements)
      cursorRow += retry.bandRowSpan + ROW_GAP_UNITS
      return
    }

    currentElements = currentElements.concat(elements)
    cursorRow += bandRowSpan + ROW_GAP_UNITS
  })
  pushPage()

  return {
    ...candidate,
    grid: { columns, rows },
    grid_spec: gridSpec ? { gutter_mm: GRID_GUTTER_MM, ...gridSpec, columns, rows } : candidate.grid_spec,
    pages,
    overflow_policy: candidate.overflow_policy || { body_overflow: 'continue_to_next_page' },
  }
}
