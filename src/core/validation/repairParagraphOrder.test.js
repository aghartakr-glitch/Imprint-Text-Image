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

// Regression: this case used to bail out entirely (repaired: false) just because an image was
// present anywhere in the plan, even though the violation here is purely a page-ORDERING problem
// -- no element needs to move relative to the page it's already on. Confirmed 2026-07-27: this was
// the exact recurring "문단 순서 위반" failure on real image+text generations, with no repair ever
// applied for them.
test('reorders whole pages (images stay with their co-located text) to fix a paragraph-order violation in an image layout', () => {
  const imageEl = {
    id: 'image_1', type: 'image', role: 'hero', col_start: 1, col_span: 4, row_start: 1, row_span: 6, fit: 'contain', object_position: 'center', bleed: 'full',
  }
  const plan = planWithParagraphs([
    { page: 1, elements: [imageEl, text('p3', 'paragraph_3', 1, 7)] },
    { page: 2, elements: [text('p1', 'paragraph_1', 2)] },
    { page: 3, elements: [text('p2', 'paragraph_2', 3)] },
  ])

  const { plan: repaired, repaired: didRepair, actions } = repairParagraphOrder(plan)

  assert.equal(didRepair, true)
  assert.ok(actions.some((action) => action.action === 'reorder_pages_by_paragraph_order'))
  // Page 1 (image + paragraph_3) must stay intact as one unit -- moved as a whole, not split.
  const pageWithImage = repaired.pages.find((p) => p.elements.some((el) => el.id === 'image_1'))
  assert.ok(pageWithImage.elements.some((el) => el.text_source === 'paragraph_3'))

  const after = validateLayoutPlan(repaired, {
    imageCount: 1,
    textBlocks: [
      { id: 'p1', text: 'one', char_count: 3 },
      { id: 'p2', text: 'two', char_count: 3 },
      { id: 'p3', text: 'three', char_count: 5 },
    ],
  })
  assert.ok(!after.issues.some((issue) => issue.includes('문단 순서 위반')), JSON.stringify(after.issues))
})

// A page-order permutation can't fix every violation: if one page mixes a non-contiguous spread of
// paragraph indices (here {1, 4}) that interleaves with another page's range ({2, 3}), no ordering
// of whole pages produces a globally non-decreasing sequence without splitting a page's elements
// apart -- which this repair must never do for image layouts. This case is expected to remain
// unrepaired so the caller's fallback path can pick a different candidate instead.
test('still skips when whole-page reordering cannot resolve an interleaved-range violation', () => {
  const imageEl = {
    id: 'image_1', type: 'image', role: 'hero', col_start: 1, col_span: 4, row_start: 1, row_span: 6, fit: 'contain', object_position: 'center', bleed: 'full',
  }
  const plan = planWithParagraphs([
    { page: 1, elements: [imageEl, text('p1', 'paragraph_1', 1, 7), text('p4', 'paragraph_4', 1, 8)] },
    { page: 2, elements: [text('p2', 'paragraph_2', 2), text('p3', 'paragraph_3', 2, 3)] },
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

