import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repairCollisions } from './repairCollisions.js'
import { validateCollisions } from './validateCollisions.js'

// Regression: two text elements overlapping (the real reported failure -- p7_sweaty vs p8_section
// on page 3) previously had no repair path at all; repairCollisions.js existed but only handled
// text/image pairs and was never wired into the pipeline.
test('shifts an overlapping trailing text element down until the pair clears the gap', () => {
  const plan = {
    grid_spec: { columns: 4, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 3,
      elements: [
        {
          id: 'p7_sweaty', type: 'text', role: 'body', col_start: 1, col_span: 4, row_start: 1, row_span: 4,
        },
        {
          id: 'p8_section', type: 'text', role: 'body', col_start: 1, col_span: 4, row_start: 3, row_span: 4,
        },
      ],
    }],
  }
  const before = validateCollisions(plan, { useExpandedBbox: true })
  assert.ok(before.issues.some((i) => i.severity === 'error'))

  const { plan: repaired, repaired: didRepair, actions } = repairCollisions(plan)
  assert.equal(didRepair, true)
  assert.ok(actions.length > 0)

  const after = validateCollisions(repaired, { useExpandedBbox: true })
  assert.deepEqual(after.issues.filter((i) => i.severity === 'error'), [])
})

test('does nothing to a plan with no collisions', () => {
  const plan = {
    grid_spec: { columns: 4, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'a', type: 'text', role: 'body', col_start: 1, col_span: 4, row_start: 1, row_span: 4,
        },
        {
          id: 'b', type: 'text', role: 'body', col_start: 1, col_span: 4, row_start: 6, row_span: 4,
        },
      ],
    }],
  }
  const { plan: result, repaired } = repairCollisions(plan)
  assert.equal(repaired, false)
  assert.deepEqual(result, plan)
})

test('moves the trailing element to a new page when shifting down would overflow the grid', () => {
  const plan = {
    grid_spec: { columns: 4, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'a', type: 'text', role: 'body', col_start: 1, col_span: 4, row_start: 1, row_span: 10,
        },
        {
          id: 'b', type: 'text', role: 'body', col_start: 1, col_span: 4, row_start: 9, row_span: 4,
        },
      ],
    }],
  }
  const { plan: repaired, repaired: didRepair, actions } = repairCollisions(plan)
  assert.equal(didRepair, true)
  assert.ok(actions.length > 0)

  assert.equal(repaired.pages.length, 2)
  assert.deepEqual(repaired.pages[0].elements.map((el) => el.id), ['a'])
  const movedB = repaired.pages[1].elements.find((el) => el.id === 'b')
  assert.ok(movedB)
  assert.equal(movedB.row_start, 1)

  const after = validateCollisions(repaired, { useExpandedBbox: true })
  assert.deepEqual(after.issues.filter((i) => i.severity === 'error'), [])
})

// Regression fixture: text overlapping an image (like Patagonia photo with caption), with free
// space to the side. Text should shift horizontally (left or right) instead of only downward --
// more readable and preserves vertical space.
test('shifts overlapping text horizontally (left/right of image) instead of down when space available', () => {
  const plan = {
    grid_spec: { columns: 8, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'image_patagonia', type: 'image', role: 'hero', col_start: 4, col_span: 2, row_start: 3, row_span: 6, fit: 'contain',
        },
        {
          id: 'p_caption', type: 'text', role: 'caption', col_start: 3, col_span: 2, row_start: 4, row_span: 2,
        }, // Overlaps image (cols 3-4 overlap with image's cols 4-5)
      ],
    }],
  }
  const before = validateCollisions(plan, { useExpandedBbox: true })
  assert.ok(before.issues.some((i) => i.severity === 'error'), 'precondition: text-image collision')

  const { plan: repaired, repaired: didRepair, actions } = repairCollisions(plan)
  assert.equal(didRepair, true)

  const textAfter = repaired.pages[0].elements.find((el) => el.id === 'p_caption')
  // Text should shift left (cols 1-2) since that's available; right would be cols 7-8 which also fits
  assert.ok(textAfter.col_start === 1 || textAfter.col_start >= 7, 'text should shift left or right of image')

  const after = validateCollisions(repaired, { useExpandedBbox: true })
  assert.deepEqual(after.issues.filter((i) => i.severity === 'error'), [])
  assert.ok(actions.some((a) => a.reason?.includes('왼쪽') || a.reason?.includes('오른쪽')), 'action should log horizontal shift')
})

// Regression fixture: two text blocks overlapping (like p3_body ↔ p4_body). Previously only shifted
// down, causing cascading overflow to next pages. Now tries horizontal placement first.
test('shifts overlapping text-text elements horizontally when vertical space is tight', () => {
  const plan = {
    grid_spec: { columns: 8, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'p3_body', type: 'text', role: 'body', col_start: 1, col_span: 2, row_start: 1, row_span: 3,
        },
        {
          id: 'p4_body', type: 'text', role: 'body', col_start: 2, col_span: 2, row_start: 2, row_span: 3,
        }, // Overlaps p3 (col 2 overlap)
      ],
    }],
  }
  const before = validateCollisions(plan, { useExpandedBbox: true })
  assert.ok(before.issues.some((i) => i.severity === 'error'), 'precondition: text-text collision')

  const { plan: repaired, repaired: didRepair, actions } = repairCollisions(plan)
  assert.equal(didRepair, true)

  const p4After = repaired.pages[0].elements.find((el) => el.id === 'p4_body')
  // p4 should shift horizontally (right to cols 4-5) instead of just down
  assert.ok(p4After.col_start >= 4, 'p4 should shift right, not just down')

  const after = validateCollisions(repaired, { useExpandedBbox: true })
  assert.deepEqual(after.issues.filter((i) => i.severity === 'error'), [])
})

