import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectLayoutFamily, LAYOUT_FAMILIES } from './selectLayoutFamily.js'

test('LAYOUT_FAMILIES contains 12 family names', () => {
  assert.equal(LAYOUT_FAMILIES.length, 12)
  assert.ok(LAYOUT_FAMILIES.includes('macro_opener_split'))
  assert.ok(LAYOUT_FAMILIES.includes('case_study_cards_grid'))
})

test('selectLayoutFamily: title + intro + 1 image → macro_opener_split (spread mode)', () => {
  const result = selectLayoutFamily({
    imageCount: 1,
    textDensity: 'medium',
    contentStructure: { has_intro: true, has_body: false, has_cases: false, has_numbered: false },
    imageTextRelation: { relation: 'one_hero_image_with_intro' },
    gridMode: 'strict',
    hasTitle: true,
    outputUnit: 'spread',
  })
  assert.equal(result.family, 'macro_opener_split')
})

test('selectLayoutFamily: 4 images + 4 cases → case_study_cards_grid', () => {
  const result = selectLayoutFamily({
    imageCount: 4,
    textDensity: 'short',
    contentStructure: { has_intro: false, has_body: false, has_cases: true, has_numbered: false },
    imageTextRelation: { relation: 'case_study_cards' },
    gridMode: 'strict',
    hasTitle: false,
    outputUnit: null,
  })
  assert.equal(result.family, 'case_study_cards_grid')
})

test('selectLayoutFamily: 3 images + 3 numbered → numbered_story_hero_support', () => {
  const result = selectLayoutFamily({
    imageCount: 3,
    textDensity: 'medium',
    contentStructure: { has_intro: false, has_body: false, has_cases: false, has_numbered: true },
    imageTextRelation: { relation: 'numbered_image_text_pairs' },
    gridMode: 'strict',
    hasTitle: false,
    outputUnit: null,
  })
  assert.equal(result.family, 'numbered_story_hero_support')
})

test('selectLayoutFamily: 5+ images + short text + flexible → cmf_stories_masonry', () => {
  const result = selectLayoutFamily({
    imageCount: 6,
    textDensity: 'short',
    contentStructure: { has_intro: false, has_body: true, has_cases: false, has_numbered: false },
    imageTextRelation: { relation: 'gallery_with_related_text' },
    gridMode: 'flexible',
    hasTitle: false,
    outputUnit: null,
  })
  assert.equal(result.family, 'cmf_stories_masonry')
})

test('selectLayoutFamily: long text + 1-2 images + flexible → image_text_interlock', () => {
  const result = selectLayoutFamily({
    imageCount: 2,
    textDensity: 'long',
    contentStructure: { has_intro: false, has_body: true },
    imageTextRelation: { relation: 'mood_image_supports_body' },
    gridMode: 'flexible',
    hasTitle: false,
    outputUnit: null,
  })
  assert.equal(result.family, 'image_text_interlock')
})

test('selectLayoutFamily: 1 image + long text → mood_image_supports_body', () => {
  const result = selectLayoutFamily({
    imageCount: 1,
    textDensity: 'long',
    contentStructure: { has_intro: false, has_body: true },
    imageTextRelation: { relation: 'mood_image_supports_body' },
    gridMode: 'strict',
    hasTitle: false,
    outputUnit: null,
  })
  assert.equal(result.family, 'long_text_column_flow') // Note: different from image_text_interlock due to grid mode
})

test('selectLayoutFamily: 2-3 images + medium text + spread → gallery_page_text_page', () => {
  const result = selectLayoutFamily({
    imageCount: 2,
    textDensity: 'medium',
    contentStructure: { has_intro: false, has_body: true },
    imageTextRelation: { relation: 'independent_images_body_text' },
    gridMode: 'strict',
    hasTitle: false,
    outputUnit: 'spread',
  })
  assert.equal(result.family, 'gallery_page_text_page')
})

test('selectLayoutFamily: 3+ images general case → distributed_images_across_pages', () => {
  const result = selectLayoutFamily({
    imageCount: 4,
    textDensity: 'medium',
    contentStructure: { has_intro: false, has_body: true },
    imageTextRelation: { relation: 'independent_images_body_text' },
    gridMode: 'flexible',
    hasTitle: false,
    outputUnit: null,
  })
  assert.equal(result.family, 'distributed_images_across_pages')
})
