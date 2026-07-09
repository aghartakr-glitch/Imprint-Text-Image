import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchImageToTextBlocks } from './matchImageToTextBlocks.js'

test('matchImageToTextBlocks: 4 images + 3 cases + protest + intro → hero opener', () => {
  const textBlocks = [
    { id: 'paragraph_1', role: 'intro_definition' },
    { id: 'paragraph_2', role: 'trend_context' },
    { id: 'paragraph_3', role: 'audience_value' },
    { id: 'paragraph_4', role: 'protest_case' },
    { id: 'paragraph_5', role: 'brand_case', brand: 'Dove' },
    { id: 'paragraph_6', role: 'brand_case', brand: 'Sweaty Betty' },
  ]

  const result = matchImageToTextBlocks({
    imageCount: 4,
    textBlocks,
  })

  // Should match 2 case blocks + 1 protest block with images
  assert.equal(result.image_text_pairs.length, 3, '3개의 image-text pairs가 생성되어야 함')
  assert.ok(result.image_text_pairs.some((p) => p.text_block_ids.includes('paragraph_5')), 'Dove case matched')
  assert.ok(result.image_text_pairs.some((p) => p.text_block_ids.includes('paragraph_6')), 'Sweaty Betty case matched')

  // Protest case should get an image
  assert.ok(
    result.image_text_pairs.some(
      (p) => p.text_block_ids.includes('paragraph_4')
    ),
    'Protest case should be matched with image'
  )

  // Hero image should have intro blocks
  assert.ok(result.hero_image, 'Hero image should be assigned')
  assert.ok(result.hero_image.text_block_ids.includes('paragraph_1'))
  assert.ok(result.hero_image.text_block_ids.includes('paragraph_2'))
})

test('matchImageToTextBlocks: no case/protest blocks only matches hero', () => {
  const textBlocks = [
    { id: 'paragraph_1', role: 'body' },
    { id: 'paragraph_2', role: 'body' },
  ]

  const result = matchImageToTextBlocks({
    imageCount: 1,
    textBlocks,
  })

  // No case/protest matching, but intro/hero logic may still apply
  assert.equal(result.image_text_pairs.length, 0, 'No case/protest pairs')
})

test('matchImageToTextBlocks: tracks unmatched items', () => {
  const textBlocks = [
    { id: 'paragraph_1', role: 'intro_definition' },
    { id: 'paragraph_2', role: 'body' },
    { id: 'paragraph_3', role: 'body' },
  ]

  const result = matchImageToTextBlocks({
    imageCount: 1,
    textBlocks,
  })

  // Unmatched text blocks should include body paragraphs
  assert.ok(result.unmatched_text_blocks.includes('paragraph_2'))
  assert.ok(result.unmatched_text_blocks.includes('paragraph_3'))
})
