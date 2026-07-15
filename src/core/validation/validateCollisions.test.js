import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateCollisions } from './validateCollisions.js'

// Regression: issues.page was reading a.page (element-level, always undefined) instead of the
// containing page object's own page number, so every collision message printed "(page undefined)".
test('collision issues report the actual page number, not undefined', () => {
  const plan = {
    grid_spec: { columns: 4, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 4,
      elements: [
        {
          id: 'p17_label', type: 'text', col_start: 1, col_span: 4, row_start: 1, row_span: 4,
        },
        {
          id: 'p19_credit', type: 'text', col_start: 1, col_span: 4, row_start: 2, row_span: 4,
        }, // overlaps p17_label by construction
      ],
    }],
  }

  const { issues } = validateCollisions(plan, { useExpandedBbox: true })
  const errorIssues = issues.filter((i) => i.severity === 'error')

  assert.ok(errorIssues.length > 0, 'expected at least one collision issue')
  errorIssues.forEach((issue) => {
    assert.equal(issue.page, 4)
  })
})
