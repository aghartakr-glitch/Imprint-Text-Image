import { test } from 'node:test'
import assert from 'node:assert/strict'
import { packEditorialLayout, normalizeLayoutIntent } from './packEditorialLayout.js'
import { validateLayoutPlan } from '../validateLayoutPlan.js'

const textBlocks = [
  { id: 'p1', role: 'overview', char_count: 220 },
  { id: 'p2', role: 'context', char_count: 180 },
  { id: 'p3', role: 'protest_case', char_count: 260 },
  { id: 'p4', role: 'brand_case_dove', char_count: 150 },
  { id: 'p5', role: 'brand_case_sweaty_betty', char_count: 200 },
]

const imageMetadata = [
  { id: 'image_1', ratio: 0.8 },
  { id: 'image_2', ratio: 1.3 },
  { id: 'image_3', ratio: 1.0 },
  { id: 'image_4', ratio: 0.75 },
]

// The exact candidate.groups shape from the spec's example JSON.
const rawCandidate = {
  candidate_id: 'candidate_1',
  style: 'Editorial',
  output_unit: 'spread',
  layout_family: 'modular-editorial',
  layout_purpose: 'case_analysis',
  image_hierarchy: 'hero_support',
  image_text_relation: 'text_explains_image',
  composition_strategy: 'image_text_case_blocks',
  base_pattern_reference: 'test',
  design_sequence: [{
    step: 1, decision_type: 'composition_strategy', value: 'image_text_case_blocks', reason: 'groups related content',
  }],
  groups: [
    {
      group_id: 'intro_group', type: 'opener', image_ids: ['image_1'], text_sources: ['paragraph_1', 'paragraph_2'], preferred_image_span: 2, preferred_text_span: 2, priority: 'high',
    },
    {
      group_id: 'protest_case', type: 'case_block', image_ids: ['image_2'], text_sources: ['paragraph_3'], preferred_image_span: 2, preferred_text_span: 2, priority: 'medium',
    },
    {
      group_id: 'brand_case', type: 'case_block', image_ids: ['image_3', 'image_4'], text_sources: ['paragraph_4', 'paragraph_5'], preferred_image_span: 1, preferred_text_span: 3, priority: 'medium',
    },
  ],
  reading_flow: ['intro_group', 'protest_case', 'brand_case'],
  reason: 'groups related images and text',
}

test('packEditorialLayout converts groups[] into pages[].elements[]', () => {
  const normalized = normalizeLayoutIntent(rawCandidate)
  const packed = packEditorialLayout({
    candidate: normalized, gridSpec: { columns: 4, rows: 12 }, textBlocks, imageMetadata, imageCount: 4,
  })
  assert.ok(Array.isArray(packed.pages) && packed.pages.length > 0)
  packed.pages.forEach((p) => assert.ok(Array.isArray(p.elements) && p.elements.length > 0))
})

test('every uploaded image (1-4) appears exactly once across all pages', () => {
  const normalized = normalizeLayoutIntent(rawCandidate)
  const packed = packEditorialLayout({
    candidate: normalized, gridSpec: { columns: 4, rows: 12 }, textBlocks, imageMetadata, imageCount: 4,
  })
  const allImages = packed.pages.flatMap((p) => p.elements.filter((el) => el.type === 'image').map((el) => el.id))
  assert.deepEqual([...allImages].sort(), ['image_1', 'image_2', 'image_3', 'image_4'])
})

test('every referenced paragraph_N appears exactly once as a text_source', () => {
  const normalized = normalizeLayoutIntent(rawCandidate)
  const packed = packEditorialLayout({
    candidate: normalized, gridSpec: { columns: 4, rows: 12 }, textBlocks, imageMetadata, imageCount: 4,
  })
  const allSources = packed.pages.flatMap((p) => p.elements.filter((el) => el.type === 'text').map((el) => el.text_source))
  assert.deepEqual([...allSources].sort(), ['paragraph_1', 'paragraph_2', 'paragraph_3', 'paragraph_4', 'paragraph_5'])
})

test('a text-image group with a high-confidence relation stays on the same page', () => {
  const normalized = normalizeLayoutIntent(rawCandidate)
  const packed = packEditorialLayout({
    candidate: normalized, gridSpec: { columns: 4, rows: 12 }, textBlocks, imageMetadata, imageCount: 4,
  })
  const pageOf = (id, type) => packed.pages.find((p) => p.elements.some((el) => el.id === id && (type ? el.type === type : true)))?.page
  const image2Page = pageOf('image_2', 'image')
  const p3Element = packed.pages.flatMap((p) => p.elements.map((el) => ({ ...el, page: p.page }))).find((el) => el.text_source === 'paragraph_3')
  assert.equal(image2Page, p3Element.page)
})

test('packed output from the spec example passes the real validateLayoutPlan with zero API calls', () => {
  const normalized = normalizeLayoutIntent(rawCandidate)
  const packed = packEditorialLayout({
    candidate: normalized, gridSpec: { columns: 4, rows: 12 }, textBlocks, imageMetadata, imageCount: 4,
  })
  const full = {
    ...packed,
    layout_purpose: 'case_analysis',
    image_text_relation: 'text_explains_image',
    overflow_policy: { body_overflow: 'continue_to_next_page' },
  }
  const result = validateLayoutPlan(full, { imageCount: 4 })
  assert.deepEqual(result.issues, [])
  assert.equal(result.passed, true)
})

test('a candidate that already has explicit pages[].elements[] (old schema, no groups) is passed through unchanged', () => {
  const explicit = {
    candidate_id: 'c1',
    pages: [{ page: 1, elements: [{ id: 'image_1', type: 'image' }] }],
  }
  const result = packEditorialLayout({
    candidate: explicit, gridSpec: { columns: 4, rows: 12 }, textBlocks: [], imageMetadata: [], imageCount: 1,
  })
  assert.deepEqual(result, explicit)
})
