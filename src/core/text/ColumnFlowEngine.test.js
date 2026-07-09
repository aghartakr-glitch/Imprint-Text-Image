import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flowTextAcrossColumns, makeContinuationFlowRegion } from './ColumnFlowEngine.js'
import { TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM } from '../layoutConstants.js'

const GRID_SPEC = {
  columns: 4, rows: 12, gutterMm: 4, boxWidthMm: TEXT_BOX_WIDTH_MM, boxHeightMm: TEXT_BOX_HEIGHT_MM,
}

function textBlocksFrom(paragraphs) {
  return paragraphs.map((text, i) => ({
    id: `body_${i + 1}`, role: 'body', paragraph_index: i + 1, text,
  }))
}

test('short text fits in the first column slot, no remaining text', () => {
  const flowRegion = {
    page: 1, col_start: 1, col_span: 4, row_start: 1, row_span: 12,
  }
  const { filledSlots, remainingText } = flowTextAcrossColumns({
    textBlocks: textBlocksFrom(['짧은 본문입니다.']),
    flowRegions: [flowRegion],
    gridSpec: GRID_SPEC,
  })
  assert.equal(remainingText, '')
  assert.equal(filledSlots.length, 1)
  assert.equal(filledSlots[0].col_start, 1)
  assert.equal(filledSlots[0].textSlice, '짧은 본문입니다.')
})

test('a single flow_region becomes ONE wide slot spanning its full column width, not one narrow slot per column', () => {
  // Grid columns are an alignment unit, not a mandate to slice text into 1-column slivers: a
  // 4-column-wide flow_region must produce one 4-column-wide slot (readable paragraph width), so
  // oversized text that doesn't fit becomes remainingText for the caller to place in the next
  // flow_region/page, instead of being force-fit by fragmenting into 4 narrow columns.
  const words = Array.from({ length: 400 }, (_, i) => `word${i}`)
  const flowRegion = {
    page: 1, col_start: 1, col_span: 4, row_start: 1, row_span: 12,
  }
  const { filledSlots, remainingText } = flowTextAcrossColumns({
    textBlocks: textBlocksFrom([words.join(' ')]),
    flowRegions: [flowRegion],
    gridSpec: GRID_SPEC,
  })
  assert.equal(filledSlots.length, 1)
  assert.equal(filledSlots[0].col_start, 1)
  assert.equal(filledSlots[0].col_span, 4)
  assert.ok(remainingText.length > 0, 'text too long for one slot must overflow to remainingText, not be crammed into narrow columns')
  // no slice ends mid-word
  const lastWord = filledSlots[0].textSlice.trim().split(/\s+/).pop()
  assert.ok(words.includes(lastWord), `slot ends mid-word: "${lastWord}"`)
})

test('text continues across multiple flow_regions in order, still word-boundary safe', () => {
  const words = Array.from({ length: 400 }, (_, i) => `word${i}`)
  const flowRegions = [
    {
      page: 1, col_start: 1, col_span: 2, row_start: 1, row_span: 12,
    },
    {
      page: 1, col_start: 3, col_span: 2, row_start: 1, row_span: 12,
    },
  ]
  const { filledSlots, remainingText } = flowTextAcrossColumns({
    textBlocks: textBlocksFrom([words.join(' ')]),
    flowRegions,
    gridSpec: GRID_SPEC,
  })
  assert.equal(filledSlots.length, 2)
  assert.deepEqual(filledSlots.map((s) => s.col_start), [1, 3])
  filledSlots.forEach((slot) => {
    const lastWord = slot.textSlice.trim().split(/\s+/).pop()
    assert.ok(words.includes(lastWord) || lastWord === '', `slot col ${slot.col_start} ends mid-word: "${lastWord}"`)
  })
  assert.ok(remainingText.length > 0)
})

test('text avoids a reserved region: the blocked column only gets text in its free row range', () => {
  const flowRegion = {
    page: 1, col_start: 1, col_span: 2, row_start: 1, row_span: 12,
  }
  const reservedRegionsByPage = { 1: [{
    page: 1, col_start: 1, col_span: 1, row_start: 1, row_span: 7,
  }] }
  const { filledSlots } = flowTextAcrossColumns({
    textBlocks: textBlocksFrom(['본문 텍스트입니다.']),
    flowRegions: [flowRegion],
    reservedRegionsByPage,
    gridSpec: GRID_SPEC,
  })
  // col 1 rows 1-7 are reserved, so the first available slot must either be col 1's remaining
  // rows 8-12, or col 2's full height -- never overlapping rows 1-7 of col 1
  filledSlots.forEach((slot) => {
    if (slot.col_start === 1) assert.equal(slot.row_start, 8)
  })
})

test('when every supplied flow_region slot is exhausted, remainingText is returned for the caller to add continuation pages', () => {
  const longText = Array.from({ length: 3000 }, (_, i) => `word${i}`).join(' ')
  const flowRegion = {
    page: 1, col_start: 1, col_span: 1, row_start: 1, row_span: 2,
  } // tiny region, guaranteed to overflow
  const { remainingText } = flowTextAcrossColumns({
    textBlocks: textBlocksFrom([longText]),
    flowRegions: [flowRegion],
    gridSpec: GRID_SPEC,
  })
  assert.ok(remainingText.length > 0)
})

test('makeContinuationFlowRegion spans the full grid width/height for the given page', () => {
  const region = makeContinuationFlowRegion({ page: 2, gridSpec: GRID_SPEC })
  assert.equal(region.page, 2)
  assert.equal(region.col_start, 1)
  assert.equal(region.col_span, 4)
  assert.equal(region.row_span, 12)
})
