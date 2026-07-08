import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRetryPrompt } from './buildRetryPrompt.js'

test('embeds original input metadata, the failed plan, and the validation errors', () => {
  const prompt = buildRetryPrompt({
    inputMetadata: { image_count: 2 },
    failedLayoutPlan: { style: 'Editorial', pages: [] },
    validationErrors: ['이미지 2개가 겹칩니다'],
  })
  assert.match(prompt, /Your previous layout_plan failed validation/)
  assert.match(prompt, /"image_count":2/)
  assert.match(prompt, /"style":"Editorial"/)
  assert.match(prompt, /이미지 2개가 겹칩니다/)
  assert.match(prompt, /Return corrected JSON only/)
})

test('restates every fixed constraint so the LLM cannot drift on retry', () => {
  const prompt = buildRetryPrompt({ inputMetadata: {}, failedLayoutPlan: {}, validationErrors: [] })
  assert.match(prompt, /body font size 9pt/)
  assert.match(prompt, /body leading 14pt/)
  assert.match(prompt, /6 columns x 12 rows grid/)
  assert.match(prompt, /no image distortion/)
})
