import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repairGeometryPlan } from './repairGeometryPlan.js'
import { validateCollisions } from '../validation/validateCollisions.js'

test('a colliding pair gets shifted down until the gap is satisfied', () => {
  const plan = {
    grid_spec: { columns: 4, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'a', type: 'text', col_start: 1, col_span: 4, row_start: 1, row_span: 4,
        },
        {
          id: 'b', type: 'text', col_start: 1, col_span: 4, row_start: 4, row_span: 4,
        }, // overlaps a by construction
      ],
    }],
  }
  const before = validateCollisions(plan, { useExpandedBbox: true })
  assert.ok(before.issues.some((i) => i.severity === 'error'))

  const { plan: repaired, repaired: didRepair } = repairGeometryPlan(plan, before.issues)
  assert.equal(didRepair, true)

  const after = validateCollisions(repaired, { useExpandedBbox: true })
  assert.deepEqual(after.issues.filter((i) => i.severity === 'error'), [])
})

test('an element pushed past the bottom of the grid overflows to a new page instead of being dropped', () => {
  const plan = {
    grid_spec: { columns: 4, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'a', type: 'text', col_start: 1, col_span: 4, row_start: 1, row_span: 10,
        },
        {
          id: 'b', type: 'text', col_start: 1, col_span: 4, row_start: 10, row_span: 3,
        },
      ],
    }],
  }
  const before = validateCollisions(plan, { useExpandedBbox: true })
  const { plan: repaired } = repairGeometryPlan(plan, before.issues)

  const allIds = repaired.pages.flatMap((p) => p.elements.map((el) => el.id))
  assert.deepEqual([...allIds].sort(), ['a', 'b'])
  assert.ok(repaired.pages.length >= 2, 'expected the overflowed element to land on a new page')
})
