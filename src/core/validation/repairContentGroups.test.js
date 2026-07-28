import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repairContentGroups } from './repairContentGroups.js'
import { validateLayoutPlan } from '../validateLayoutPlan.js'

function basePlan(elements) {
  return {
    style: 'Editorial',
    output_unit: 'single_page',
    layout_family: 'balanced',
    layout_purpose: 'case_analysis',
    image_hierarchy: 'equal_pair',
    image_text_relation: 'text_explains_image',
    composition_strategy: 'image_above_text',
    design_sequence: [{ step: 1, decision_type: 'layout_family', value: 'balanced', reason: 'test' }],
    grid: { columns: 6, rows: 12 },
    pages: elements,
    overflow_policy: { body_overflow: 'continue_to_next_page' },
  }
}

const textBlocks = [
  { id: 'p1', role: 'section_label', text: 'Case A', char_count: 6, group_id: 1 },
  { id: 'p2', role: 'section_label', text: 'CASE A', char_count: 6, group_id: 1 },
  { id: 'p3', role: 'body', text: 'Body A text.', char_count: 12, group_id: 1 },
  { id: 'p4', role: 'section_label', text: 'Case B', char_count: 6, group_id: 2 },
  { id: 'p5', role: 'section_label', text: 'CASE B', char_count: 6, group_id: 2 },
  { id: 'p6', role: 'body', text: 'Body B text belongs with Case B.', char_count: 32, group_id: 2 },
]

test('removes duplicate heading sources and rebuilds split content groups', () => {
  const plan = basePlan([
    {
      page: 1,
      elements: [
        { id: 'g1_title', type: 'text', role: 'section_label', col_start: 1, col_span: 6, row_start: 1, row_span: 1, text_source: 'paragraph_1' },
        { id: 'g1_subtitle', type: 'text', role: 'section_label', col_start: 1, col_span: 6, row_start: 2, row_span: 1, text_source: 'paragraph_2' },
        { id: 'g1_body', type: 'text', role: 'body', col_start: 1, col_span: 6, row_start: 3, row_span: 2, text_source: 'paragraph_3' },
      ],
    },
    {
      page: 2,
      elements: [
        { id: 'g2_title_a', type: 'text', role: 'section_label', col_start: 1, col_span: 6, row_start: 1, row_span: 1, text_source: 'paragraph_4' },
        { id: 'g2_title_b', type: 'text', role: 'section_label', col_start: 1, col_span: 6, row_start: 3, row_span: 1, text_source: 'paragraph_4' },
      ],
    },
    {
      page: 3,
      elements: [
        { id: 'g2_body', type: 'text', role: 'body', col_start: 1, col_span: 6, row_start: 1, row_span: 2, text_source: 'paragraph_6' },
      ],
    },
  ])

  assert.equal(validateLayoutPlan(plan, { imageCount: 0, textBlocks }).passed, false)
  const { plan: repaired, repaired: didRepair } = repairContentGroups(plan, textBlocks)
  assert.equal(didRepair, true)
  const result = validateLayoutPlan(repaired, { imageCount: 0, textBlocks })
  assert.equal(result.passed, true, JSON.stringify(result.issues))
  const allSources = repaired.pages.flatMap((page) => page.elements.map((el) => el.text_source).filter(Boolean))
  assert.equal(allSources.filter((source) => source === 'paragraph_4').length, 1)
  assert.ok(allSources.includes('paragraph_5'))
})


test('rebuilds a split group in nearby free space without colliding with images', () => {
  const plan = basePlan([
    {
      page: 1,
      elements: [
        { id: 'image_1', type: 'image', role: 'hero', col_start: 1, col_span: 6, row_start: 1, row_span: 8, fit: 'contain', object_position: 'center' },
        { id: 'g2_title_a', type: 'text', role: 'section_label', col_start: 1, col_span: 6, row_start: 2, row_span: 1, text_source: 'paragraph_4' },
      ],
    },
    {
      page: 2,
      elements: [
        { id: 'g2_body', type: 'text', role: 'body', col_start: 1, col_span: 6, row_start: 11, row_span: 2, text_source: 'paragraph_6' },
      ],
    },
  ])

  const { plan: repaired, repaired: didRepair } = repairContentGroups(plan, textBlocks)
  assert.equal(didRepair, true)
  const result = validateLayoutPlan(repaired, { imageCount: 1, textBlocks })
  assert.equal(result.passed, true, JSON.stringify(result.issues))
  const groupPage = repaired.pages.find((page) => page.elements.some((el) => el.text_source === 'paragraph_4'))
  assert.ok(groupPage)
  assert.equal(groupPage.elements.some((el) => el.text_source === 'paragraph_5'), true)
  assert.equal(groupPage.elements.some((el) => el.text_source === 'paragraph_6'), true)
})


test('uses a dedicated page only when nearby pages have no free space', () => {
  const plan = basePlan([
    {
      page: 1,
      elements: [
        { id: 'image_1', type: 'image', role: 'hero', col_start: 1, col_span: 6, row_start: 1, row_span: 12, fit: 'contain', object_position: 'center' },
        { id: 'g2_title_a', type: 'text', role: 'section_label', col_start: 1, col_span: 6, row_start: 1, row_span: 1, text_source: 'paragraph_4' },
      ],
    },
    {
      page: 2,
      elements: [
        { id: 'image_2', type: 'image', role: 'hero', col_start: 1, col_span: 6, row_start: 1, row_span: 12, fit: 'contain', object_position: 'center' },
        { id: 'g2_body', type: 'text', role: 'body', col_start: 1, col_span: 6, row_start: 11, row_span: 2, text_source: 'paragraph_6' },
      ],
    },
  ])

  const { plan: repaired, repaired: didRepair, actions } = repairContentGroups(plan, textBlocks)
  assert.equal(didRepair, true)
  assert.ok(actions.some((action) => action.action === 'rebuild_content_group_on_dedicated_page'))
  const result = validateLayoutPlan(repaired, { imageCount: 2, textBlocks })
  assert.equal(result.passed, true, JSON.stringify(result.issues))
})
