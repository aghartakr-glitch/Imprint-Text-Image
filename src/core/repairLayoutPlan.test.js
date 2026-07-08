import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repairLayoutPlan } from './repairLayoutPlan.js'

function planWithGaps() {
  return {
    style: 'Editorial',
    layout_family: 'balanced',
    grid: { columns: 6, rows: 12 },
    pages: [
      {
        page: 1,
        elements: [
          {
            id: 'image_1', type: 'image', page: 1, col_start: 1, col_span: 3, row_start: 1, row_span: 5,
          },
          {
            id: 'body_1', type: 'text', page: 1, col_start: 1, col_span: 6, row_start: 7, row_span: 4,
          },
        ],
      },
    ],
  }
}

test('fills missing image fit with contain', () => {
  const { plan, repaired, repairs } = repairLayoutPlan(planWithGaps())
  assert.equal(repaired, true)
  assert.equal(plan.pages[0].elements[0].fit, 'contain')
  assert.ok(repairs.some((r) => r.includes('fit')))
})

test('fills missing role with a sensible default per element type', () => {
  const { plan } = repairLayoutPlan(planWithGaps())
  assert.equal(plan.pages[0].elements[0].role, 'support')
  assert.equal(plan.pages[0].elements[1].role, 'body')
})

test('fills missing overflow_policy.body_overflow with continue_to_next_page', () => {
  const { plan, repairs } = repairLayoutPlan(planWithGaps())
  assert.equal(plan.overflow_policy.body_overflow, 'continue_to_next_page')
  assert.ok(repairs.some((r) => r.includes('overflow_policy')))
})

test('does not touch a plan that has no gaps (repaired=false)', () => {
  const complete = planWithGaps()
  complete.overflow_policy = { body_overflow: 'continue_to_next_page' }
  complete.pages[0].elements[0].fit = 'contain'
  complete.pages[0].elements[0].role = 'hero'
  complete.pages[0].elements[1].role = 'body'
  const { repaired, repairs } = repairLayoutPlan(complete)
  assert.equal(repaired, false)
  assert.deepEqual(repairs, [])
})

test('does NOT touch a wrong (non-missing) fit value -- that needs real revalidation, not repair', () => {
  const plan = planWithGaps()
  plan.pages[0].elements[0].fit = 'cover'
  const { plan: result } = repairLayoutPlan(plan)
  assert.equal(result.pages[0].elements[0].fit, 'cover')
})

test('does not mutate the original plan object', () => {
  const original = planWithGaps()
  repairLayoutPlan(original)
  assert.equal(original.pages[0].elements[0].fit, undefined)
})
