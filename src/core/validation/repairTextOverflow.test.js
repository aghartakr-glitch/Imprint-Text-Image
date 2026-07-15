import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repairTextOverflow } from './repairTextOverflow.js'
import { validateLayoutTextCapacity } from '../estimateTextCapacity.js'

// Regression: the LLM reliably under-sizes body boxes (a paragraph 1.1x-1.3x too big for its box).
// Instead of rejecting, grow the box's row_span until it fits.
test('grows an overflowing text box until its paragraph fits (mild overflow, row growth alone suffices)', () => {
  const plan = {
    grid_spec: { columns: 4, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'p2_body', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 2, row_start: 1, row_span: 2,
        },
      ],
    }],
  }
  const textBlocks = [{ id: 'p1', text: 'x'.repeat(177), char_count: 177 }]

  const before = validateLayoutTextCapacity(plan, textBlocks)
  assert.ok(before.length > 0, 'precondition: the box should overflow before repair')

  const { plan: repaired, repaired: didRepair, actions } = repairTextOverflow(plan, textBlocks)
  assert.equal(didRepair, true)
  assert.ok(actions.length > 0)
  assert.ok(repaired.pages[0].elements[0].row_span > 2, 'row_span should have grown')
  assert.equal(repaired.pages[0].elements[0].col_span, 2, 'row growth alone was enough -- col_span should not change')

  const after = validateLayoutTextCapacity(repaired, textBlocks)
  assert.deepEqual(after, [])
})

// Regression fixture matching the exact real report: a 300-character paragraph in a box that only
// has capacity 85 (3.53x overflow) positioned near the bottom of the grid, where row_span alone
// (capped by the grid bottom) cannot reach enough capacity -- col_span must widen too.
test('widens col_span when row growth alone cannot reach the required capacity (severe overflow near the grid bottom)', () => {
  const plan = {
    grid_spec: { columns: 4, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'p5_body', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 2, row_start: 9, row_span: 2,
        },
      ],
    }],
  }
  const textBlocks = [{ id: 'p1', text: 'x'.repeat(300), char_count: 300 }]

  const before = validateLayoutTextCapacity(plan, textBlocks)
  assert.equal(before[0]?.capacity, 85, 'precondition: matches the exact 300ch/85cap overflow from the real report')

  const { plan: repaired, repaired: didRepair, actions } = repairTextOverflow(plan, textBlocks)
  assert.equal(didRepair, true)
  const el = repaired.pages[0].elements[0]
  assert.ok(el.col_span > 2, 'row growth alone cannot reach capacity here -- col_span must have widened')
  assert.equal(actions[0].action, 'expand_span')

  const after = validateLayoutTextCapacity(repaired, textBlocks)
  assert.deepEqual(after, [])
})

// Second real-report fixture: 192ch / 136cap (1.41x).
test('fits a 192-character paragraph that overflows a 136-capacity box', () => {
  const plan = {
    grid_spec: { columns: 4, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'p9_body', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 2, row_start: 1, row_span: 3,
        },
      ],
    }],
  }
  const textBlocks = [{ id: 'p1', text: 'x'.repeat(192), char_count: 192 }]

  const before = validateLayoutTextCapacity(plan, textBlocks)
  assert.equal(before[0]?.capacity, 136, 'precondition: matches the exact 192ch/136cap overflow from the real report')

  const { plan: repaired, repaired: didRepair } = repairTextOverflow(plan, textBlocks)
  assert.equal(didRepair, true)
  assert.deepEqual(validateLayoutTextCapacity(repaired, textBlocks), [])
})

test('leaves a box unchanged when its paragraph already fits', () => {
  const plan = {
    grid_spec: { columns: 4, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'p1_body', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 4, row_start: 1, row_span: 12,
        },
      ],
    }],
  }
  const textBlocks = [{ id: 'p1', text: 'short', char_count: 5 }]

  const { repaired, actions } = repairTextOverflow(plan, textBlocks)
  assert.equal(repaired, false)
  assert.deepEqual(actions, [])
})

// When neither growing row_span (capped by the grid bottom) nor widening col_span (capped by the
// grid's column count) can fit the text on the CURRENT page, move it wholesale to a fresh page
// where it gets the full page height to work with.
test('moves an element to a new page when nothing on the current page can hold it, but a fresh page can', () => {
  const plan = {
    grid_spec: { columns: 4, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'p_near_bottom', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 2, row_start: 11, row_span: 1,
        },
      ],
    }],
  }
  const textBlocks = [{ id: 'p1', text: 'x'.repeat(200), char_count: 200 }]

  const { plan: repaired, repaired: didRepair, actions } = repairTextOverflow(plan, textBlocks)
  assert.equal(didRepair, true)
  assert.equal(actions[0].action, 'move_to_next_page')
  assert.equal(repaired.pages.length, 2)
  assert.deepEqual(repaired.pages[0].elements, [])
  const moved = repaired.pages[1].elements.find((el) => el.id === 'p_near_bottom')
  assert.ok(moved)
  assert.equal(moved.row_start, 1)
  assert.deepEqual(validateLayoutTextCapacity(repaired, textBlocks), [])
})

// A paragraph too long to fit on any single page at any span, in any position, is left alone --
// repair must never truncate, shrink, or drop text just to force a fit.
test('leaves an impossibly long paragraph unchanged rather than truncating it', () => {
  const plan = {
    grid_spec: { columns: 4, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'p1_body', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 1, row_start: 11, row_span: 1,
        },
      ],
    }],
  }
  const textBlocks = [{ id: 'p1', text: 'x'.repeat(5000), char_count: 5000 }]

  const { plan: repaired, repaired: didRepair } = repairTextOverflow(plan, textBlocks)
  assert.equal(didRepair, false)
  assert.equal(repaired.pages.length, 1, 'must not create a page it cannot actually solve the problem on')
  const el = repaired.pages[0].elements[0]
  assert.equal(el.text_source, 'paragraph_1')
  assert.ok(el.row_start + el.row_span - 1 <= 12, 'element must never extend past the grid bottom')
})
