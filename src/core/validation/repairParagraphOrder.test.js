import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repairParagraphOrder } from './repairParagraphOrder.js'
import { validateLayoutPlan } from '../validateLayoutPlan.js'

function planWithParagraphs(pages) {
  return {
    style: 'Editorial',
    output_unit: 'spread',
    layout_family: 'balanced',
    layout_purpose: 'case_analysis',
    image_hierarchy: 'hero_support',
    image_text_relation: 'text_explains_image',
    composition_strategy: 'image_left_text_right',
    design_sequence: [{ step: 1, decision_type: 'paragraph_order', value: 'repair', reason: 'test' }],
    grid_spec: { page_size: 'A5', columns: 4, rows: 12, margin_preset: 'recommended', gutter_mm: 4, grid_mode: 'flexible' },
    grid: { columns: 4, rows: 12 },
    pages,
    overflow_policy: { body_overflow: 'continue_to_next_page' },
  }
}

function text(id, textSource, page, rowStart = 1) {
  return {
    id,
    type: 'text',
    role: 'body',
    text_source: textSource,
    page,
    col_start: 1,
    col_span: 4,
    row_start: rowStart,
    row_span: 1,
  }
}

test('repairs paragraph first-page inversions by rebuilding text pages in source order', () => {
  const plan = planWithParagraphs([
    { page: 1, elements: [text('p3', 'paragraph_3', 1)] },
    { page: 2, elements: [text('p1', 'paragraph_1', 2)] },
    { page: 3, elements: [text('p2', 'paragraph_2', 3)] },
  ])

  const before = validateLayoutPlan(plan, { imageCount: 0, textBlocks: [
    { id: 'p1', text: 'one', char_count: 3 },
    { id: 'p2', text: 'two', char_count: 3 },
    { id: 'p3', text: 'three', char_count: 5 },
  ] })
  assert.equal(before.passed, false)
  assert.ok(before.issues.some((issue) => issue.includes('paragraph_3') && issue.includes('page 1')))

  const { plan: repaired, repaired: didRepair, actions } = repairParagraphOrder(plan)
  const after = validateLayoutPlan(repaired, { imageCount: 0, textBlocks: [
    { id: 'p1', text: 'one', char_count: 3 },
    { id: 'p2', text: 'two', char_count: 3 },
    { id: 'p3', text: 'three', char_count: 5 },
  ] })

  assert.equal(didRepair, true)
  assert.equal(after.passed, true, JSON.stringify(after.issues))
  assert.deepEqual(
    repaired.pages.flatMap((page) => page.elements).map((el) => el.text_source),
    ['paragraph_1', 'paragraph_2', 'paragraph_3'],
  )
  assert.ok(actions.some((action) => action.action === 'rebuild_text_pages_in_paragraph_order'))
})

test('skips paragraph-order rebuilding when images are present because it would separate image-text pairs', () => {
  const plan = planWithParagraphs([
    { page: 1, elements: [{ id: 'image_1', type: 'image', role: 'hero', col_start: 1, col_span: 4, row_start: 1, row_span: 12, fit: 'contain', object_position: 'center', bleed: 'full' }] },
    { page: 2, elements: [text('p2_a', 'paragraph_2', 2)] },
    { page: 3, elements: [text('p1', 'paragraph_1', 3), text('p2_b', 'paragraph_2', 3, 3)] },
  ])

  const result = repairParagraphOrder(plan)

  assert.equal(result.repaired, false)
  assert.equal(result.skipped, true)
  assert.equal(result.plan, plan)
  assert.ok(result.actions.some((action) => action.action === 'skip_paragraph_order_repair_for_image_layout'))
})

test('leaves already ordered plans unchanged', () => {
  const plan = planWithParagraphs([
    { page: 1, elements: [text('p1', 'paragraph_1', 1)] },
    { page: 2, elements: [text('p2', 'paragraph_2', 2)] },
  ])

  const result = repairParagraphOrder(plan)
  assert.equal(result.repaired, false)
  assert.equal(result.plan, plan)
})

