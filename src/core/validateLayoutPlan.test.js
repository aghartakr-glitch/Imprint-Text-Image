import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateLayoutPlan } from './validateLayoutPlan.js'

function validPlan(overrides = {}) {
  return {
    style: 'Editorial',
    output_unit: 'single_page',
    layout_family: 'balanced',
    layout_purpose: 'case_analysis',
    image_hierarchy: 'equal_pair',
    image_text_relation: 'text_explains_image',
    composition_strategy: 'image_above_text',
    base_pattern_reference: 'two_images_top_text_bottom',
    layout_intent: 'test',
    design_sequence: [{
      step: 1, decision_type: 'layout_family', value: 'balanced', reason: 'test',
    }],
    grid: { columns: 6, rows: 12 },
    pages: [
      {
        page: 1,
        elements: [
          {
            id: 'image_1', type: 'image', role: 'equal', page: 1, col_start: 1, col_span: 3, row_start: 1, row_span: 5, fit: 'contain', object_position: 'center',
          },
          {
            id: 'image_2', type: 'image', role: 'equal', page: 1, col_start: 4, col_span: 3, row_start: 1, row_span: 5, fit: 'contain', object_position: 'center',
          },
          {
            id: 'body_1', type: 'text', role: 'body', page: 1, col_start: 2, col_span: 4, row_start: 7, row_span: 4,
          },
        ],
      },
    ],
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    reason: 'test',
    ...overrides,
  }
}

test('a well-formed plan passes with no issues', () => {
  const result = validateLayoutPlan(validPlan(), { imageCount: 2 })
  assert.equal(result.passed, true)
  assert.deepEqual(result.issues, [])
})

test('rejects an out-of-vocabulary style', () => {
  const result = validateLayoutPlan(validPlan({ style: 'Noir' }), { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('style')))
})

test('rejects an out-of-vocabulary layout_family', () => {
  const result = validateLayoutPlan(validPlan({ layout_family: 'centered' }), { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('layout_family')))
})

test('rejects an out-of-vocabulary output_unit', () => {
  const result = validateLayoutPlan(validPlan({ output_unit: 'double_spread' }), { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('output_unit')))
})

test('rejects an out-of-vocabulary layout_purpose/image_hierarchy/image_text_relation/composition_strategy', () => {
  assert.equal(validateLayoutPlan(validPlan({ layout_purpose: 'random' }), { imageCount: 2 }).passed, false)
  assert.equal(validateLayoutPlan(validPlan({ image_hierarchy: 'random' }), { imageCount: 2 }).passed, false)
  assert.equal(validateLayoutPlan(validPlan({ image_text_relation: 'random' }), { imageCount: 2 }).passed, false)
  assert.equal(validateLayoutPlan(validPlan({ composition_strategy: 'random' }), { imageCount: 2 }).passed, false)
})

test('rejects a missing/empty design_sequence', () => {
  const result = validateLayoutPlan(validPlan({ design_sequence: [] }), { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('design_sequence')))
})

test('rejects wrong grid dimensions', () => {
  const result = validateLayoutPlan(validPlan({ grid: { columns: 4, rows: 12 } }), { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('columns')))
})

test('rejects an element whose col range spills past the grid', () => {
  const plan = validPlan()
  plan.pages[0].elements[0].col_span = 6 // col_start 1 + col_span 6 - 1 = 6, ok; bump col_start instead
  plan.pages[0].elements[0].col_start = 5
  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('col 범위')))
})

test('rejects an element whose row range spills past the grid', () => {
  const plan = validPlan()
  plan.pages[0].elements[0].row_start = 10
  plan.pages[0].elements[0].row_span = 5
  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('row 범위')))
})

test('rejects two elements that overlap on the same page', () => {
  const plan = validPlan()
  plan.pages[0].elements[1] = { ...plan.pages[0].elements[1], col_start: 1, col_span: 3 } // now identical box to image_1
  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('겹칩니다')))
})

test('rejects an image element whose fit is not contain', () => {
  const plan = validPlan()
  plan.pages[0].elements[0].fit = 'cover'
  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('fit')))
})

test('rejects an out-of-vocabulary object_position', () => {
  const plan = validPlan()
  plan.pages[0].elements[0].object_position = 'diagonally'
  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('object_position')))
})

test('rejects a caption-role text element (caption is not in the allowed text role vocabulary)', () => {
  const plan = validPlan()
  plan.pages[0].elements.push({
    id: 'caption_1', type: 'text', role: 'caption', page: 1, col_start: 1, col_span: 1, row_start: 12, row_span: 1,
  })
  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('caption_1의 role')))
})

test('rejects a plan with no body text element', () => {
  const plan = validPlan()
  plan.pages[0].elements = plan.pages[0].elements.filter((e) => e.role !== 'body')
  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('본문 텍스트 영역')))
})

test('rejects a plan missing one of the uploaded images', () => {
  const result = validateLayoutPlan(validPlan(), { imageCount: 3 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('image_3')))
})

test('rejects a wrong overflow_policy.body_overflow value', () => {
  const plan = validPlan({ overflow_policy: { body_overflow: 'shrink_text' } })
  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('overflow_policy')))
})
