import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateLayoutQuality } from './estimateLayoutQuality.js'

function cleanPlan(overrides = {}) {
  return {
    layout_family: 'balanced',
    image_hierarchy: 'equal_pair',
    image_text_relation: 'text_explains_image',
    pages: [{
      page: 1,
      elements: [
        {
          id: 'image_1', type: 'image', role: 'equal', col_start: 1, col_span: 3, row_start: 1, row_span: 5,
        },
        {
          id: 'image_2', type: 'image', role: 'equal', col_start: 4, col_span: 3, row_start: 1, row_span: 5,
        },
        {
          id: 'body_1', type: 'text', role: 'body', col_start: 1, col_span: 6, row_start: 7, row_span: 4,
        },
      ],
    }],
    ...overrides,
  }
}

test('a clean plan with no issues scores a full 5', () => {
  const result = estimateLayoutQuality({ plan: cleanPlan(), resolvedPages: [] })
  assert.equal(result.layout_quality_score.total, 5)
  assert.deepEqual(result.layout_quality_score.deductions, [])
})

test('hero_support hierarchy with no hero-role image element gets a hierarchy deduction', () => {
  const plan = cleanPlan({ image_hierarchy: 'hero_support' })
  const result = estimateLayoutQuality({ plan, resolvedPages: [] })
  assert.equal(result.layout_quality_score.hierarchy, 0.5)
  assert.ok(result.layout_quality_score.deductions.some((d) => d.reason.includes('weak hierarchy')))
})

test('hero_support hierarchy WITH a hero-role image element scores full hierarchy', () => {
  const plan = cleanPlan({ image_hierarchy: 'hero_support' })
  plan.pages[0].elements[0].role = 'hero'
  const result = estimateLayoutQuality({ plan, resolvedPages: [] })
  assert.equal(result.layout_quality_score.hierarchy, 1)
})

test('two or more tiny images get a whitespace deduction', () => {
  const plan = cleanPlan()
  plan.pages[0].elements[0] = {
    id: 'image_1', type: 'image', col_start: 1, col_span: 1, row_start: 1, row_span: 1,
  }
  plan.pages[0].elements[1] = {
    id: 'image_2', type: 'image', col_start: 2, col_span: 1, row_start: 1, row_span: 1,
  }
  const result = estimateLayoutQuality({ plan, resolvedPages: [] })
  assert.equal(result.layout_quality_score.whitespace, 0.5)
})

test('mismatched image_text_relation vs layout_family is deducted', () => {
  const plan = cleanPlan({ layout_family: 'text-first', image_text_relation: 'image_sets_mood' })
  const result = estimateLayoutQuality({ plan, resolvedPages: [] })
  assert.equal(result.layout_quality_score.image_text_relation, 0.5)
})

test('a repetition penalty deducts from visual_balance', () => {
  const result = estimateLayoutQuality({ plan: cleanPlan(), resolvedPages: [], repetitionPenaltyApplied: true })
  assert.equal(result.layout_quality_score.visual_balance, 0.5)
})

test('a narrow-text-box refinement note deducts readability', () => {
  const result = estimateLayoutQuality({
    plan: cleanPlan(), resolvedPages: [], refinements: { notes: ['page 1: 본문 텍스트 영역이 너무 좁습니다 (10.0x10.0mm)'] },
  })
  assert.equal(result.layout_quality_score.readability, 0.5)
})
