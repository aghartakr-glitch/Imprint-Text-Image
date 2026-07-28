import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repairMissingImages } from './repairMissingImages.js'
import { validateLayoutPlan } from '../validateLayoutPlan.js'

function basePlan() {
  return {
    style: 'Editorial',
    output_unit: 'spread',
    layout_family: 'balanced',
    layout_purpose: 'case_analysis',
    image_hierarchy: 'hero_support',
    image_text_relation: 'text_explains_image',
    composition_strategy: 'image_above_text',
    design_sequence: [{ step: 1, decision_type: 'layout', value: 'balanced', reason: 'test' }],
    grid: { columns: 6, rows: 12 },
    grid_spec: { columns: 6, rows: 12, gutter_mm: 4, page_size: 'A5', margin_preset: 'recommended' },
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    pages: [
      {
        page: 1,
        elements: [
          { id: 'image_1', type: 'image', role: 'support', fit: 'contain', object_position: 'center', col_start: 1, col_span: 2, row_start: 1, row_span: 3 },
          { id: 'image_2', type: 'image', role: 'support', fit: 'contain', object_position: 'center', col_start: 3, col_span: 2, row_start: 1, row_span: 3 },
          { id: 'image_3', type: 'image', role: 'support', fit: 'contain', object_position: 'center', col_start: 5, col_span: 2, row_start: 1, row_span: 3 },
          { id: 'body_1', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 6, row_start: 5, row_span: 4 },
        ],
      },
      {
        page: 2,
        elements: [
          { id: 'image_4', type: 'image', role: 'support', fit: 'contain', object_position: 'center', col_start: 1, col_span: 3, row_start: 1, row_span: 4 },
        ],
      },
    ],
  }
}

const textBlocks = [{ id: 'p1', role: 'body', text: '본문입니다.', char_count: 5 }]

test('adds a missing uploaded image in a free slot so validation no longer hard-fails', () => {
  const plan = basePlan()
  const before = validateLayoutPlan(plan, { imageCount: 5, textBlocks })
  assert.ok(before.issues.some((issue) => issue.includes('image_5')), JSON.stringify(before.issues))

  const { plan: repaired, repaired: didRepair, actions } = repairMissingImages(plan, { imageCount: 5 })
  assert.equal(didRepair, true)
  assert.deepEqual(actions.map((action) => action.image), ['image_5'])

  const imageIds = repaired.pages.flatMap((page) => page.elements).filter((el) => el.type === 'image').map((el) => el.id).sort()
  assert.deepEqual(imageIds, ['image_1', 'image_2', 'image_3', 'image_4', 'image_5'])

  const after = validateLayoutPlan(repaired, { imageCount: 5, textBlocks })
  assert.equal(after.issues.length, 0, JSON.stringify(after.issues))
})

test('adds a missing forced full-bleed image as a standalone full page', () => {
  const plan = { ...basePlan(), pages: [{ page: 1, elements: [basePlan().pages[0].elements[3]] }] }

  const { plan: repaired, repaired: didRepair } = repairMissingImages(plan, {
    imageCount: 1,
    forcedFullBleedImages: [1],
  })

  assert.equal(didRepair, true)
  const image = repaired.pages.flatMap((page) => page.elements).find((el) => el.id === 'image_1')
  assert.equal(image.bleed, 'full')
  assert.equal(image.col_span, 6)
  assert.equal(image.row_span, 12)
})
