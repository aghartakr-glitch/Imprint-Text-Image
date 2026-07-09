import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapImageTextRelations, IMAGE_TEXT_RELATIONS } from './mapImageTextRelations.js'

test('IMAGE_TEXT_RELATIONS contains all 7 types', () => {
  assert.equal(IMAGE_TEXT_RELATIONS.length, 7)
  assert.ok(IMAGE_TEXT_RELATIONS.includes('independent_images_body_text'))
  assert.ok(IMAGE_TEXT_RELATIONS.includes('case_study_cards'))
  assert.ok(IMAGE_TEXT_RELATIONS.includes('numbered_image_text_pairs'))
})

test('mapImageTextRelations detects case_study_cards (4 images + 4 cases)', () => {
  const result = mapImageTextRelations({
    imageCount: 4,
    contentStructure: {
      case_study_items: [
        { title_ko: '1', title_en: 'ONE', body: 'desc1' },
        { title_ko: '2', title_en: 'TWO', body: 'desc2' },
        { title_ko: '3', title_en: 'THREE', body: 'desc3' },
        { title_ko: '4', title_en: 'FOUR', body: 'desc4' },
      ],
      has_cases: true,
    },
  })
  assert.equal(result.relation, 'case_study_cards')
  assert.equal(result.pairings.length, 4)
  assert.equal(result.pairings[0].image_index, 1)
  assert.equal(result.pairings[0].content_type, 'case_study_item')
})

test('mapImageTextRelations detects numbered_image_text_pairs (3 images + 3 numbered)', () => {
  const result = mapImageTextRelations({
    imageCount: 3,
    contentStructure: {
      numbered_items: [
        { number: 1, text: 'Item 1' },
        { number: 2, text: 'Item 2' },
        { number: 3, text: 'Item 3' },
      ],
      has_numbered: true,
    },
  })
  assert.equal(result.relation, 'numbered_image_text_pairs')
  assert.equal(result.pairings.length, 3)
  assert.equal(result.pairings[1].numbered_item.number, 2)
})

test('mapImageTextRelations detects one_hero_image_with_intro', () => {
  const result = mapImageTextRelations({
    imageCount: 1,
    contentStructure: {
      has_intro: true,
      intro_body: 'Brief intro text here.',
      body_paragraphs: ['Long body paragraph.'],
      has_body: true,
    },
  })
  assert.equal(result.relation, 'one_hero_image_with_intro')
  assert.equal(result.pairings[0].image_index, 1)
  assert.equal(result.pairings[0].content_type, 'intro_text')
})

test('mapImageTextRelations detects mood_image_supports_body (1-2 images + body, no intro/cases/numbered)', () => {
  const result = mapImageTextRelations({
    imageCount: 2,
    contentStructure: {
      has_body: true,
      body_paragraphs: ['Paragraph 1', 'Paragraph 2'],
      has_intro: false,
      has_numbered: false,
      has_cases: false,
    },
  })
  assert.equal(result.relation, 'mood_image_supports_body')
  assert.equal(result.pairings.length, 2)
})

test('mapImageTextRelations detects gallery_with_related_text (3+ images + body)', () => {
  const result = mapImageTextRelations({
    imageCount: 5,
    contentStructure: {
      has_body: true,
      body_paragraphs: ['Long text', 'More text'],
      has_numbered: false,
      has_cases: false,
    },
  })
  assert.equal(result.relation, 'gallery_with_related_text')
  assert.equal(result.pairings.length, 5)
})

test('mapImageTextRelations falls back to independent_images_body_text', () => {
  const result = mapImageTextRelations({
    imageCount: 2,
    contentStructure: { has_body: false },
  })
  assert.equal(result.relation, 'independent_images_body_text')
  assert.equal(result.pairings.length, 2)
})
