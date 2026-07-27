import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchImageToTextBlocks } from './matchImageToTextBlocks.js'

// Rewritten 2026-07-27 alongside the module itself (gap analysis P0-2b). The previous tests asserted
// the hardcoded behaviour: blocks had to carry roles like 'brand_case' (with brand: 'Dove') or
// 'protest_case' to be paired at all, and a document of plain body paragraphs was EXPECTED to
// produce zero pairs. That expectation was the bug -- it is exactly what happened for every novel,
// catalogue, and report, leaving images and text unrelated. Pairing is now by content group.

function block(id, groupId, role = 'body', charCount = 200) {
  return {
    id, group_id: groupId, role, char_count: charCount,
  }
}

test('pairs each content group with an image when counts match, in document order', () => {
  const textBlocks = [
    block('paragraph_1', 0, 'section_label', 10),
    block('paragraph_2', 0, 'body', 300),
    block('paragraph_3', 1, 'section_label', 10),
    block('paragraph_4', 1, 'body', 300),
  ]

  const result = matchImageToTextBlocks({ imageCount: 2, textBlocks })

  assert.equal(result.image_text_pairs.length, 2)
  // Group 0 (its heading AND its body) goes with image_1; group 1 with image_2.
  assert.deepEqual(result.image_text_pairs[0].text_block_ids, ['paragraph_1', 'paragraph_2'])
  assert.equal(result.image_text_pairs[0].image_id, 'image_1')
  assert.deepEqual(result.image_text_pairs[1].text_block_ids, ['paragraph_3', 'paragraph_4'])
  assert.equal(result.image_text_pairs[1].image_id, 'image_2')
  assert.equal(result.unmatched_images, 0)
  assert.deepEqual(result.unmatched_text_blocks, [])
})

// The critical regression: plain body paragraphs with no special roles used to produce ZERO pairs.
test('plain body paragraphs with no special roles still get paired (the old zero-pair bug)', () => {
  const textBlocks = [
    block('paragraph_1', 0, 'body', 400),
    block('paragraph_2', 1, 'body', 400),
  ]

  const result = matchImageToTextBlocks({ imageCount: 2, textBlocks })

  assert.equal(result.image_text_pairs.length, 2, 'a novel-style document must still pair images with text')
  assert.ok(result.hero_image, 'a lead image must be identified')
})

test('with fewer images than groups, the longest groups get them, reported in document order', () => {
  const textBlocks = [
    block('paragraph_1', 0, 'body', 50),
    block('paragraph_2', 1, 'body', 900),
    block('paragraph_3', 2, 'body', 600),
  ]

  const result = matchImageToTextBlocks({ imageCount: 2, textBlocks })

  assert.equal(result.image_text_pairs.length, 2)
  // Groups 1 (900 chars) and 2 (600 chars) win over group 0 (50), but are emitted in reading order.
  assert.deepEqual(result.image_text_pairs.map((p) => p.text_block_ids[0]), ['paragraph_2', 'paragraph_3'])
  assert.ok(result.unmatched_text_blocks.includes('paragraph_1'))
})

test('with more images than groups, every group is covered and no image is left unassigned', () => {
  const textBlocks = [
    block('paragraph_1', 0, 'body', 300),
    block('paragraph_2', 1, 'body', 800),
  ]

  const result = matchImageToTextBlocks({ imageCount: 5, textBlocks })

  assert.equal(result.image_text_pairs.length, 5)
  assert.equal(result.unmatched_images, 0)
  const covered = new Set(result.image_text_pairs.flatMap((p) => p.text_block_ids))
  assert.ok(covered.has('paragraph_1') && covered.has('paragraph_2'))
})

test('a heading-only group is not chosen as an image anchor while a prose group exists', () => {
  const textBlocks = [
    block('paragraph_1', 0, 'section_label', 12),
    block('paragraph_2', 1, 'body', 500),
  ]

  const result = matchImageToTextBlocks({ imageCount: 1, textBlocks })

  assert.equal(result.image_text_pairs.length, 1)
  assert.deepEqual(result.image_text_pairs[0].text_block_ids, ['paragraph_2'])
})

test('no images or no text yields no pairs', () => {
  assert.equal(matchImageToTextBlocks({ imageCount: 0, textBlocks: [block('paragraph_1', 0)] }).image_text_pairs.length, 0)
  assert.equal(matchImageToTextBlocks({ imageCount: 3, textBlocks: [] }).image_text_pairs.length, 0)
  assert.equal(matchImageToTextBlocks({ imageCount: 3, textBlocks: [] }).unmatched_images, 3)
})
