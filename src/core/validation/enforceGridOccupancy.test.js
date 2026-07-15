import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enforceGridOccupancy } from './enforceGridOccupancy.js'
import { validateCollisions } from './validateCollisions.js'

function assertNoOverlaps(plan) {
  const { issues } = validateCollisions(plan, { useExpandedBbox: false })
  const overlaps = issues.filter((i) => i.severity === 'error' && i.type?.includes('overlap'))
  assert.deepEqual(overlaps, [], `expected zero overlaps, got: ${JSON.stringify(overlaps)}`)
}

test('leaves a plan with no overlaps completely unchanged', () => {
  const plan = {
    grid_spec: { columns: 4, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        { id: 'a', type: 'text', role: 'body', col_start: 1, col_span: 2, row_start: 1, row_span: 4 },
        { id: 'b', type: 'text', role: 'body', col_start: 3, col_span: 2, row_start: 1, row_span: 4 },
      ],
    }],
  }
  const { repaired, plan: result } = enforceGridOccupancy(plan)
  assert.equal(repaired, false)
  assert.deepEqual(result, plan)
})

// Regression: the exact real-world 4-way tangle (image_2, p4_body, p5_body, p8_label all mutually
// overlapping) that previously needed multiple whack-a-mole passes. This pass must resolve it in
// one shot, guaranteed, since it's a deterministic placement rather than iterative nudging.
test('resolves a 4-way mutual overlap tangle completely, in one pass', () => {
  const plan = {
    grid_spec: { columns: 6, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 2,
      elements: [
        { id: 'image_2', type: 'image', role: 'support', col_start: 1, col_span: 3, row_start: 1, row_span: 5 },
        { id: 'p4_body', type: 'text', role: 'body', col_start: 2, col_span: 3, row_start: 2, row_span: 4 },
        { id: 'p5_body', type: 'text', role: 'body', col_start: 1, col_span: 3, row_start: 4, row_span: 4 },
        { id: 'p8_label', type: 'text', role: 'section_label', col_start: 2, col_span: 3, row_start: 3, row_span: 3 },
      ],
    }],
  }
  const { repaired, plan: result, actions } = enforceGridOccupancy(plan)
  assert.equal(repaired, true)
  assert.ok(actions.length > 0)
  assertNoOverlaps(result)
  // Every original element must still be present somewhere (none silently dropped)
  const allIds = result.pages.flatMap((p) => p.elements.map((el) => el.id))
  assert.deepEqual(new Set(allIds), new Set(['image_2', 'p4_body', 'p5_body', 'p8_label']))
})

// Even trickier: 6 elements crammed onto a small grid where not everything fits on one page --
// some must overflow to a new page, and the ones that do must not collide with anything already
// there (or with each other) once they land.
test('overflows excess elements to a new page without any collision, when the page is genuinely too small', () => {
  const plan = {
    grid_spec: { columns: 2, rows: 4, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        { id: 'a', type: 'text', role: 'body', col_start: 1, col_span: 2, row_start: 1, row_span: 4 },
        { id: 'b', type: 'text', role: 'body', col_start: 1, col_span: 2, row_start: 1, row_span: 4 },
        { id: 'c', type: 'text', role: 'body', col_start: 1, col_span: 2, row_start: 1, row_span: 4 },
      ],
    }],
  }
  const { repaired, plan: result } = enforceGridOccupancy(plan)
  assert.equal(repaired, true)
  assertNoOverlaps(result)
  const allIds = result.pages.flatMap((p) => p.elements.map((el) => el.id))
  assert.deepEqual(new Set(allIds), new Set(['a', 'b', 'c']))
  // Confirms real overflow happened (more than 1 page needed for 3 full-page-sized elements)
  assert.ok(result.pages.length >= 2)
})

// Priority order: when an image and text conflict, the text (lower priority) is the one that
// should move, not the image -- editorial convention is the image anchors the page.
test('moves conflicting text out of the way rather than the image', () => {
  const plan = {
    grid_spec: { columns: 4, rows: 8, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        { id: 'photo', type: 'image', role: 'hero', col_start: 1, col_span: 2, row_start: 1, row_span: 6 },
        { id: 'caption', type: 'text', role: 'body', col_start: 1, col_span: 2, row_start: 3, row_span: 3 },
      ],
    }],
  }
  const { plan: result } = enforceGridOccupancy(plan)
  const photo = result.pages[0].elements.find((el) => el.id === 'photo')
  assert.equal(photo.col_start, 1)
  assert.equal(photo.row_start, 1)
  assertNoOverlaps(result)
})
