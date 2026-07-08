import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SYSTEM_PROMPT, buildUserPrompt } from './buildLayoutPrompt.js'

test('SYSTEM_PROMPT states the grid contract, extended v0.4 decisions, and forbidden actions', () => {
  assert.match(SYSTEM_PROMPT, /6 columns and 12 rows/)
  assert.match(SYSTEM_PROMPT, /Do not overlap any two elements/)
  assert.match(SYSTEM_PROMPT, /output_unit/)
  assert.match(SYSTEM_PROMPT, /layout_purpose/)
  assert.match(SYSTEM_PROMPT, /image_hierarchy/)
  assert.match(SYSTEM_PROMPT, /composition_strategy/)
  assert.match(SYSTEM_PROMPT, /exactly the requested number of internal candidate layout_plans/)
  assert.match(SYSTEM_PROMPT, /Return JSON only/)
})

test('buildUserPrompt embeds input metadata, content structure, image metadata, pattern library, and retrieved references', () => {
  const prompt = buildUserPrompt({
    inputMetadata: { image_count: 2, text_length_chars: 500 },
    contentStructure: { has_title: true, title_length_chars: 5 },
    imageMetadata: [{ id: 'image_1', estimated_role: 'hero' }],
    patternLibrarySummary: [{ pattern_id: 'two_equal_images' }],
    retrievedReferences: [{ pattern_id: 'two_equal_images', why_this_layout_works: 'test reason' }],
  })
  assert.match(prompt, /"image_count":2/)
  assert.match(prompt, /"has_title":true/)
  assert.match(prompt, /"estimated_role":"hero"/)
  assert.match(prompt, /two_equal_images/)
  assert.match(prompt, /test reason/)
  assert.match(prompt, /"candidates":\[/)
})

test('buildUserPrompt includes user_controls and user_preference_context only when meaningfully set', () => {
  const withControls = buildUserPrompt({
    inputMetadata: { image_count: 1 },
    userControls: { preferred_output_unit: 'spread', preferred_layout_family: 'auto' },
  })
  assert.match(withControls, /User controls/)
  assert.match(withControls, /preferred_output_unit/)

  const allAuto = buildUserPrompt({
    inputMetadata: { image_count: 1 },
    userControls: { preferred_output_unit: 'auto', preferred_layout_family: 'auto' },
  })
  assert.doesNotMatch(allAuto, /User controls/)

  const withPreference = buildUserPrompt({
    inputMetadata: { image_count: 1 },
    userPreferenceContext: { image_scale_preference: 'larger' },
  })
  assert.match(withPreference, /User preference context/)
  assert.match(withPreference, /image_scale_preference/)
})

test('requests exactly the given number of internal candidates', () => {
  const prompt = buildUserPrompt({ inputMetadata: { image_count: 1 }, internalCandidateCount: 3 })
  assert.match(prompt, /exactly 3 distinct candidate layout_plans/)
  assert.match(prompt, /array of exactly 3 items/)
})
