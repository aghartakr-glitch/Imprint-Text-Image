import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateCollisions } from './validateCollisions.js'

test('elements without their own .page field never produce "page undefined" in issues', () => {
  const plan = {
    grid_spec: { columns: 4, rows: 12 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'image_1', type: 'image', col_start: 1, col_span: 2, row_start: 1, row_span: 4, fit: 'contain',
        },
        {
          id: 'p1', type: 'text', col_start: 1, col_span: 2, row_start: 1, row_span: 4,
        }, // deliberately overlapping to force an issue
      ],
    }],
  }
  const result = validateCollisions(plan, { useExpandedBbox: true })
  assert.ok(result.issues.length > 0, 'expected at least one collision issue')
  result.issues.forEach((issue) => {
    assert.notEqual(issue.page, undefined, `issue.page should never be undefined, got: ${JSON.stringify(issue)}`)
    assert.equal(issue.page, 1)
  })
})

test('a 4-column grid correctly respects the active grid_spec.columns instead of a hardcoded 6', () => {
  // On a 4-column A5 page (148mm wide), two 2-column elements side by side should NOT collide.
  const plan = {
    grid_spec: { columns: 4, rows: 12 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'image_1', type: 'image', col_start: 1, col_span: 2, row_start: 1, row_span: 4, fit: 'contain',
        },
        {
          id: 'p1', type: 'text', col_start: 3, col_span: 2, row_start: 1, row_span: 4,
        },
      ],
    }],
  }
  const result = validateCollisions(plan, { useExpandedBbox: true })
  assert.deepEqual(result.issues.filter((i) => i.severity === 'error'), [])
})

test('two elements vertically stacked with a 1-row gap do not collide (1-indexed coordinate fix)', () => {
  const plan = {
    grid_spec: { columns: 4, rows: 12 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'a', type: 'text', col_start: 1, col_span: 4, row_start: 1, row_span: 5,
        },
        {
          id: 'b', type: 'text', col_start: 1, col_span: 4, row_start: 7, row_span: 5,
        },
      ],
    }],
  }
  const result = validateCollisions(plan, { useExpandedBbox: true })
  assert.deepEqual(result.issues.filter((i) => i.severity === 'error'), [])
})
