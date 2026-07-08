import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SYSTEM_PROMPT, buildUserPrompt } from './buildLayoutPrompt.js'

test('SYSTEM_PROMPT states the grid contract and forbidden actions', () => {
  assert.match(SYSTEM_PROMPT, /6 columns and 12 rows/)
  assert.match(SYSTEM_PROMPT, /Do not overlap text and image boxes/)
  assert.match(SYSTEM_PROMPT, /Return JSON only/)
})

test('buildUserPrompt embeds input metadata, pattern library, and few-shot samples', () => {
  const prompt = buildUserPrompt({
    inputMetadata: { image_count: 2, text_length_chars: 500 },
    patternLibrarySummary: [{ pattern_id: 'two_equal_images' }],
    fewShotSamples: [{ pattern_id: 'two_equal_images', why_this_layout_works: 'test reason' }],
  })
  assert.match(prompt, /"image_count": 2/)
  assert.match(prompt, /two_equal_images/)
  assert.match(prompt, /test reason/)
  assert.doesNotMatch(prompt, /previous layout_plan failed validation/)
})

test('buildUserPrompt includes prior validation errors when retrying', () => {
  const prompt = buildUserPrompt({
    inputMetadata: { image_count: 1 },
    patternLibrarySummary: [],
    fewShotSamples: [],
    validationErrors: ['이미지 2개가 겹칩니다'],
  })
  assert.match(prompt, /previous layout_plan failed validation/)
  assert.match(prompt, /이미지 2개가 겹칩니다/)
})
