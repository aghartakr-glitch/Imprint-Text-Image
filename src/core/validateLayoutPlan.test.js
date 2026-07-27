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
            id: 'body_1', type: 'text', role: 'body', page: 1, col_start: 2, col_span: 4, row_start: 7, row_span: 4, text_source: 'paragraph_1',
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


test('rejects layouts that front-load all images before any text', () => {
  const plan = validPlan({
    output_unit: 'spread',
    pages: [
      {
        page: 1,
        elements: [
          { id: 'image_1', type: 'image', role: 'hero', col_start: 1, col_span: 6, row_start: 1, row_span: 12, fit: 'contain', object_position: 'center' },
        ],
      },
      {
        page: 2,
        elements: [
          { id: 'image_2', type: 'image', role: 'support', col_start: 1, col_span: 6, row_start: 1, row_span: 12, fit: 'contain', object_position: 'center' },
        ],
      },
      {
        page: 3,
        elements: [
          { id: 'body_1', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 6, row_start: 1, row_span: 6 },
        ],
      },
    ],
  })

  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('이미지-텍스트 분리')), `expected image-text separation issue, got: ${JSON.stringify(result.issues)}`)
})


test('rejects duplicated heading text_source placements', () => {
  const plan = validPlan({
    pages: [{
      page: 1,
      elements: [
        { id: 'heading_a', type: 'text', role: 'section_label', page: 1, col_start: 1, col_span: 6, row_start: 1, row_span: 1, text_source: 'paragraph_1' },
        { id: 'heading_b', type: 'text', role: 'section_label', page: 1, col_start: 1, col_span: 6, row_start: 3, row_span: 1, text_source: 'paragraph_1' },
        { id: 'body_1', type: 'text', role: 'body', page: 1, col_start: 1, col_span: 6, row_start: 5, row_span: 4, text_source: 'paragraph_2' },
      ],
    }],
  })

  const result = validateLayoutPlan(plan, {
    imageCount: 0,
    textBlocks: [
      { id: 'p1', role: 'section_label', text: '???? ????', char_count: 9 },
      { id: 'p2', role: 'body', text: '?????.', char_count: 5 },
    ],
  })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('duplicate text_source')), JSON.stringify(result.issues))
})

test('rejects long body text_source in a 1-row fragment box', () => {
  const plan = validPlan({
    pages: [{
      page: 1,
      elements: [
        { id: 'body_tiny', type: 'text', role: 'body', page: 1, col_start: 1, col_span: 2, row_start: 1, row_span: 1, text_source: 'paragraph_1' },
      ],
    }],
  })

  const result = validateLayoutPlan(plan, {
    imageCount: 0,
    textBlocks: [{ id: 'p1', role: 'body', text: '???? 2025 N7 ?? ? ?? ???? ??? ???? ???? ?? ???? ?????.', char_count: 57 }],
  })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('1-row box')), JSON.stringify(result.issues))
})

test('rejects a content group when only its headings are placed', () => {
  const plan = validPlan({
    pages: [{
      page: 1,
      elements: [
        { id: 'g1_title', type: 'text', role: 'section_label', page: 1, col_start: 1, col_span: 6, row_start: 1, row_span: 1, text_source: 'paragraph_1' },
        { id: 'g1_subtitle', type: 'text', role: 'section_label', page: 1, col_start: 1, col_span: 6, row_start: 2, row_span: 1, text_source: 'paragraph_2' },
        { id: 'g2_body', type: 'text', role: 'body', page: 1, col_start: 1, col_span: 6, row_start: 4, row_span: 3, text_source: 'paragraph_4' },
      ],
    }],
  })

  const result = validateLayoutPlan(plan, {
    imageCount: 0,
    textBlocks: [
      { id: 'p1', role: 'section_label', text: 'Case A', char_count: 6, group_id: 1 },
      { id: 'p2', role: 'section_label', text: 'CASE A', char_count: 6, group_id: 1 },
      { id: 'p3', role: 'body', text: 'Body A belongs with Case A.', char_count: 27, group_id: 1 },
      { id: 'p4', role: 'body', text: 'Body B.', char_count: 7, group_id: 2 },
    ],
  })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('content group 1 is split')), JSON.stringify(result.issues))
})

test('rejects interleaving another content group inside a group', () => {
  const plan = validPlan({
    pages: [{
      page: 1,
      elements: [
        { id: 'g1_title', type: 'text', role: 'section_label', page: 1, col_start: 1, col_span: 6, row_start: 1, row_span: 1, text_source: 'paragraph_1' },
        { id: 'g2_title', type: 'text', role: 'section_label', page: 1, col_start: 1, col_span: 6, row_start: 2, row_span: 1, text_source: 'paragraph_3' },
        { id: 'g2_body', type: 'text', role: 'body', page: 1, col_start: 1, col_span: 6, row_start: 3, row_span: 2, text_source: 'paragraph_4' },
        { id: 'g1_body', type: 'text', role: 'body', page: 1, col_start: 1, col_span: 6, row_start: 6, row_span: 2, text_source: 'paragraph_2' },
      ],
    }],
  })

  const result = validateLayoutPlan(plan, {
    imageCount: 0,
    textBlocks: [
      { id: 'p1', role: 'section_label', text: 'Case A', char_count: 6, group_id: 1 },
      { id: 'p2', role: 'body', text: 'Body A.', char_count: 7, group_id: 1 },
      { id: 'p3', role: 'section_label', text: 'Case B', char_count: 6, group_id: 2 },
      { id: 'p4', role: 'body', text: 'Body B.', char_count: 7, group_id: 2 },
    ],
  })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('interleaved')), JSON.stringify(result.issues))
})

test('accepts contiguous content groups in markdown order', () => {
  const plan = validPlan({
    pages: [{
      page: 1,
      elements: [
        { id: 'g1_title', type: 'text', role: 'section_label', page: 1, col_start: 1, col_span: 6, row_start: 1, row_span: 1, text_source: 'paragraph_1' },
        { id: 'g1_subtitle', type: 'text', role: 'section_label', page: 1, col_start: 1, col_span: 6, row_start: 2, row_span: 1, text_source: 'paragraph_2' },
        { id: 'g1_body', type: 'text', role: 'body', page: 1, col_start: 1, col_span: 6, row_start: 3, row_span: 2, text_source: 'paragraph_3' },
        { id: 'g2_body', type: 'text', role: 'body', page: 1, col_start: 1, col_span: 6, row_start: 6, row_span: 2, text_source: 'paragraph_4' },
      ],
    }],
  })

  const result = validateLayoutPlan(plan, {
    imageCount: 0,
    textBlocks: [
      { id: 'p1', role: 'section_label', text: 'Case A', char_count: 6, group_id: 1 },
      { id: 'p2', role: 'section_label', text: 'CASE A', char_count: 6, group_id: 1 },
      { id: 'p3', role: 'body', text: 'Body A.', char_count: 7, group_id: 1 },
      { id: 'p4', role: 'body', text: 'Body B.', char_count: 7, group_id: 2 },
    ],
  })
  assert.equal(result.passed, true, JSON.stringify(result.issues))
})

test('rejects content groups placed out of markdown order', () => {
  const plan = validPlan({
    pages: [{
      page: 1,
      elements: [
        { id: 'g2_title', type: 'text', role: 'section_label', page: 1, col_start: 1, col_span: 6, row_start: 1, row_span: 1, text_source: 'paragraph_3' },
        { id: 'g2_body', type: 'text', role: 'body', page: 1, col_start: 1, col_span: 6, row_start: 2, row_span: 2, text_source: 'paragraph_4' },
        { id: 'g1_title', type: 'text', role: 'section_label', page: 1, col_start: 1, col_span: 6, row_start: 5, row_span: 1, text_source: 'paragraph_1' },
        { id: 'g1_body', type: 'text', role: 'body', page: 1, col_start: 1, col_span: 6, row_start: 6, row_span: 2, text_source: 'paragraph_2' },
      ],
    }],
  })

  const result = validateLayoutPlan(plan, {
    imageCount: 0,
    textBlocks: [
      { id: 'p1', role: 'section_label', text: 'Case A', char_count: 6, group_id: 1 },
      { id: 'p2', role: 'body', text: 'Body A.', char_count: 7, group_id: 1 },
      { id: 'p3', role: 'section_label', text: 'Case B', char_count: 6, group_id: 2 },
      { id: 'p4', role: 'body', text: 'Body B.', char_count: 7, group_id: 2 },
    ],
  })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('content group order violation')), JSON.stringify(result.issues))
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

test('accepts bleed:"full" on an image that is the only element on its page', () => {
  const plan = validPlan({
    pages: [{
      page: 1,
      elements: [{
        id: 'image_1', type: 'image', role: 'hero', page: 1, col_start: 1, col_span: 6, row_start: 1, row_span: 12, fit: 'contain', bleed: 'full',
      }],
    }, {
      page: 2,
      elements: [{
        id: 'body_1', type: 'text', role: 'body', page: 2, col_start: 1, col_span: 6, row_start: 1, row_span: 12, text_source: 'paragraph_1',
      }],
    }],
  })
  const result = validateLayoutPlan(plan, { imageCount: 1 })
  assert.equal(result.passed, true, JSON.stringify(result.issues))
})

test('rejects unchecked full-bleed images when only checked images may be full-page', () => {
  const plan = validPlan({
    pages: [{
      page: 1,
      elements: [{
        id: 'image_1', type: 'image', role: 'hero', page: 1, col_start: 1, col_span: 6, row_start: 1, row_span: 12, fit: 'contain', bleed: 'full',
      }],
    }, {
      page: 2,
      elements: [{
        id: 'body_1', type: 'text', role: 'body', page: 2, col_start: 1, col_span: 6, row_start: 1, row_span: 12, text_source: 'paragraph_1',
      }],
    }],
  })
  const result = validateLayoutPlan(plan, { imageCount: 1, forcedFullBleedImages: [], allowUnforcedFullBleed: false })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('체크하지 않은 이미지 image_1')))
})

test('accepts checked full-bleed images when only checked images may be full-page', () => {
  const plan = validPlan({
    pages: [{
      page: 1,
      elements: [{
        id: 'image_1', type: 'image', role: 'hero', page: 1, col_start: 1, col_span: 6, row_start: 1, row_span: 12, fit: 'contain', bleed: 'full',
      }],
    }, {
      page: 2,
      elements: [{
        id: 'body_1', type: 'text', role: 'body', page: 2, col_start: 1, col_span: 6, row_start: 1, row_span: 12, text_source: 'paragraph_1',
      }],
    }],
  })
  const result = validateLayoutPlan(plan, { imageCount: 1, forcedFullBleedImages: [1], allowUnforcedFullBleed: false })
  assert.equal(result.passed, true, JSON.stringify(result.issues))
})
test('rejects bleed:"full" combined with another element on the same page', () => {
  const plan = validPlan()
  plan.pages[0].elements[0].bleed = 'full'
  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('다른 요소가 없을 때만')))
})

test('rejects an out-of-vocabulary bleed value', () => {
  const plan = validPlan()
  plan.pages[0].elements[0].bleed = 'partial'
  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('bleed')))
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

test('accepts a plan with grid_spec, reserved_regions, text_flow, and layout_variation', () => {
  const plan = validPlan({
    grid: { columns: 4, rows: 12 },  // Must match grid_spec.columns
    grid_spec: { columns: 4, rows: 12, gutter_mm: 4, page_size: 'A5', grid_mode: 'flexible' },
    reserved_regions: [{ page: 1, col_start: 1, col_span: 1, row_start: 1, row_span: 5 }],
    text_flow: {
      mode: 'column_flow',
      flow_regions: [{ page: 1, col_start: 1, col_span: 4, row_start: 1, row_span: 12 }],
      overflow_policy: { body_overflow: 'continue_to_next_page' },
    },
    layout_variation: 'column_flow_grid',
  })
  // Adjust elements to fit within 4-column grid
  plan.pages[0].elements[0] = {  // image_1
    id: 'image_1', type: 'image', role: 'equal', page: 1, col_start: 1, col_span: 2, row_start: 1, row_span: 5, fit: 'contain', object_position: 'center',
  }
  plan.pages[0].elements[1] = {  // image_2
    id: 'image_2', type: 'image', role: 'equal', page: 1, col_start: 3, col_span: 2, row_start: 1, row_span: 5, fit: 'contain', object_position: 'center',
  }
  plan.pages[0].elements[2] = {  // body_1
    id: 'body_1', type: 'text', role: 'body', page: 1, col_start: 1, col_span: 4, row_start: 7, row_span: 4, text_source: 'paragraph_1',
  }

  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, true, `issues: ${JSON.stringify(result.issues)}`)
})

// Regression: a symmetrical two-column magazine spread (every text block at the same non-1
// col_span) was being hard-rejected as "insufficient span variation", identical to the genuinely
// broken case of every text block forced to col_span=1. Only the latter is an actual bug.
test('does not reject a plan where every text block uses the same non-1 col_span', () => {
  const plan = validPlan({
    grid: { columns: 4, rows: 12 },
    grid_spec: {
      columns: 4, rows: 12, gutter_mm: 4, page_size: 'A5', grid_mode: 'flexible',
    },
  })
  plan.pages[0].elements[0] = {
    id: 'image_1', type: 'image', role: 'equal', page: 1, col_start: 1, col_span: 1, row_start: 1, row_span: 5, fit: 'contain', object_position: 'center',
  }
  plan.pages[0].elements[1] = {
    id: 'image_2', type: 'image', role: 'equal', page: 1, col_start: 2, col_span: 3, row_start: 1, row_span: 5, fit: 'contain', object_position: 'center',
  }
  plan.pages[0].elements[2] = {
    id: 'body_1', type: 'text', role: 'body', page: 1, col_start: 1, col_span: 2, row_start: 7, row_span: 4, text_source: 'paragraph_1',
  }
  plan.pages[0].elements.push({
    id: 'body_2', type: 'text', role: 'body', page: 1, col_start: 3, col_span: 2, row_start: 7, row_span: 4, text_source: 'paragraph_2',
  })

  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.ok(!result.issues.some((i) => i.includes('span 다양화') || i.includes('강제 배치')), `unexpected span issues: ${JSON.stringify(result.issues)}`)
})

test('still rejects every text block forced to col_span=1 on a 3+ column grid', () => {
  const plan = validPlan({
    grid: { columns: 4, rows: 12 },
    grid_spec: {
      columns: 4, rows: 12, gutter_mm: 4, page_size: 'A5', grid_mode: 'flexible',
    },
  })
  plan.pages[0].elements[0] = {
    id: 'image_1', type: 'image', role: 'equal', page: 1, col_start: 1, col_span: 1, row_start: 1, row_span: 5, fit: 'contain', object_position: 'center',
  }
  plan.pages[0].elements[1] = {
    id: 'image_2', type: 'image', role: 'equal', page: 1, col_start: 2, col_span: 3, row_start: 1, row_span: 5, fit: 'contain', object_position: 'center',
  }
  plan.pages[0].elements[2] = {
    id: 'body_1', type: 'text', role: 'body', page: 1, col_start: 1, col_span: 1, row_start: 7, row_span: 4, text_source: 'paragraph_1',
  }
  plan.pages[0].elements.push({
    id: 'body_2', type: 'text', role: 'body', page: 1, col_start: 2, col_span: 1, row_start: 7, row_span: 4, text_source: 'paragraph_2',
  })

  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('강제 배치')))
})

test('rejects invalid grid_spec.columns (must be positive integer)', () => {
  const plan = validPlan({ grid_spec: { columns: 0, rows: 12 } })
  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('columns')))
})

test('rejects invalid grid_spec.page_size', () => {
  const plan = validPlan({ grid_spec: { columns: 4, rows: 12, page_size: 'A3' } })
  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('page_size')))
})

test('rejects invalid grid_spec.grid_mode', () => {
  const plan = validPlan({ grid_spec: { columns: 4, rows: 12, grid_mode: 'random' } })
  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('grid_mode')))
})

test('rejects reserved_region elements that exceed grid_spec bounds', () => {
  const plan = validPlan({
    grid_spec: { columns: 4, rows: 12 },
    reserved_regions: [{ page: 1, col_start: 3, col_span: 3, row_start: 1, row_span: 5 }],
  })
  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('col 범위')))
})

test('rejects empty layout_variation string', () => {
  const plan = validPlan({ layout_variation: '' })
  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('layout_variation')))
})

test('rejects invalid text_flow.mode', () => {
  const plan = validPlan({ text_flow: { mode: 'invalid_mode' } })
  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('text_flow.mode')))
})

test('rejects text_flow.overflow_policy with wrong body_overflow value', () => {
  const plan = validPlan({
    text_flow: {
      mode: 'column_flow',
      overflow_policy: { body_overflow: 'shrink' },
    },
  })
  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('overflow_policy')))
})

// Regression: same-span images used to be a hard rejection ("이미지 span 다양화 부족"), discarding
// an otherwise fully valid candidate over a pure design-taste observation (same span is a
// legitimate choice for an equal comparison/before-after pair/case series). Confirmed 2026-07-10:
// a real generation failed entirely on exactly this message with zero geometry/schema problems.
// It must now be a non-blocking warning.
test('same-span images produce a warning, not a rejection', () => {
  const plan = validPlan({ grid_spec: { columns: 6, rows: 12, margin_preset: 'recommended', gutter_mm: 4 } })
  const result = validateLayoutPlan(plan, { imageCount: 2 })
  assert.equal(result.passed, true)
  assert.deepEqual(result.issues, [])
  assert.ok(result.warnings.some((w) => w.includes('span 다양화')), `expected a span-variation warning, got: ${JSON.stringify(result.warnings)}`)
})

// Paragraph order: confirmed 2026-07-27 real-run bug where "DESIGN CASE STUDIES"/"커뮤니티 액티비즘"
// content (drawn from later paragraphs in the user's input) was placed on an earlier page than
// paragraphs that preceded them in the input, breaking the reading order the user authored.
test('rejects a plan where a later paragraph appears on an earlier page than an earlier paragraph', () => {
  const plan = validPlan({
    pages: [
      {
        page: 1,
        elements: [
          {
            id: 'body_1', type: 'text', role: 'body', page: 1, col_start: 1, col_span: 6, row_start: 1, row_span: 4, text_source: 'paragraph_3',
          },
        ],
      },
      {
        page: 2,
        elements: [
          {
            id: 'body_2', type: 'text', role: 'body', page: 2, col_start: 1, col_span: 6, row_start: 1, row_span: 4, text_source: 'paragraph_1',
          },
        ],
      },
    ],
  })
  const result = validateLayoutPlan(plan, { imageCount: 0 })
  assert.equal(result.passed, false)
  assert.ok(result.issues.some((i) => i.includes('문단 순서 위반')), `expected a paragraph-order issue, got: ${JSON.stringify(result.issues)}`)
})

test('a plan where paragraphs stay in ascending order across pages passes the order check', () => {
  const plan = validPlan({
    pages: [
      {
        page: 1,
        elements: [
          {
            id: 'body_1', type: 'text', role: 'body', page: 1, col_start: 1, col_span: 6, row_start: 1, row_span: 4, text_source: 'paragraph_1',
          },
          {
            id: 'body_2', type: 'text', role: 'body', page: 1, col_start: 1, col_span: 6, row_start: 6, row_span: 4, text_source: 'paragraph_2',
          },
        ],
      },
      {
        page: 2,
        elements: [
          {
            id: 'body_3', type: 'text', role: 'body', page: 2, col_start: 1, col_span: 6, row_start: 1, row_span: 4, text_source: 'paragraph_3',
          },
        ],
      },
    ],
  })
  const result = validateLayoutPlan(plan, { imageCount: 0 })
  assert.ok(!result.issues.some((i) => i.includes('문단 순서 위반')), `unexpected paragraph-order issue: ${JSON.stringify(result.issues)}`)
})
