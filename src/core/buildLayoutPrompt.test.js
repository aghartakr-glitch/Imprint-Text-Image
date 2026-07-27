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

// Regression guard: an earlier version of the schema example used "|"-separated option lists as
// the example VALUE for enum fields (e.g. style: "Editorial | Magazine | Exhibition Catalog").
// A real generation copied that placeholder text verbatim into its response and failed validation
// ("알 수 없는 style: Editorial | Magazine | Exhibition Catalog"), wasting a paid API call. The
// example must only ever show one concrete, valid value per field.
test('the schema example never shows a "|"-separated option list as a field value (the bug that got copied verbatim)', () => {
  const prompt = buildUserPrompt({ inputMetadata: { image_count: 1 } })
  assert.doesNotMatch(prompt, /"style":"[^"]*\|[^"]*"/)
  assert.doesNotMatch(prompt, /"output_unit":"[^"]*\|[^"]*"/)
  assert.doesNotMatch(prompt, /"layout_family":"[^"]*\|[^"]*"/)
  assert.doesNotMatch(prompt, /"layout_purpose":"[^"]*\|[^"]*"/)
  assert.doesNotMatch(prompt, /"image_hierarchy":"[^"]*\|[^"]*"/)
  assert.doesNotMatch(prompt, /"image_text_relation":"[^"]*\|[^"]*"/)
  assert.doesNotMatch(prompt, /"composition_strategy":"[^"]*\|[^"]*"/)
  assert.match(prompt, /"style":"Editorial"/)
})

// Cost reduction: requesting 1 candidate (the default) should not pay for guidance text about
// candidates 2/3 that the model has nothing to apply it to.
test('requesting 1 candidate omits candidate 2/3 diversity profile guidance', () => {
  const prompt = buildUserPrompt({ inputMetadata: { image_count: 1 }, internalCandidateCount: 1 })
  assert.doesNotMatch(prompt, /GROUPED CASES/)
  assert.doesNotMatch(prompt, /DIVERSE ASYMMETRICAL/)
  assert.doesNotMatch(prompt, /CRITICAL CANDIDATE DIVERSITY/)
  assert.match(prompt, /STABLE EDITORIAL/, 'the single default profile should still be present')
})

// Cost reduction: optional context sections that are empty/absent must not add dead prompt weight
// (an empty array/object still costs tokens to serialize and read as "[]"/"{}").
test('empty or absent optional context sections are omitted entirely, not sent as empty JSON', () => {
  const prompt = buildUserPrompt({
    inputMetadata: { image_count: 1 },
    imageMetadata: [],
    patternLibrarySummary: [],
    retrievedReferences: [],
    imageTextMatching: {},
    suggestedLayoutFamily: {},
  })
  assert.doesNotMatch(prompt, /Image metadata/)
  assert.doesNotMatch(prompt, /Layout knowledge base/)
  assert.doesNotMatch(prompt, /Retrieved reference examples/)
  assert.doesNotMatch(prompt, /Image-text relationships/)
  assert.doesNotMatch(prompt, /Suggested layout family/)
})

// Regression: confirmed 2026-07-27 -- blocks the user glued together with no blank line (e.g. a
// Korean heading + English heading + its body, all on consecutive lines) must be visible to the
// LLM as belonging together, or it has no way to know not to split them across pages/insert other
// content between them.
test("buildUserPrompt includes each text block's group_id and the group-cohesion rule", () => {
  const prompt = buildUserPrompt({
    inputMetadata: { image_count: 1 },
    textBlocks: [
      { id: 'p1', role: 'section_label', char_count: 5, group_id: 0 },
      { id: 'p2', role: 'body', char_count: 40, group_id: 0 },
    ],
  })
  assert.match(prompt, /"group_id":0/)
  assert.match(prompt, /MUST be placed on the SAME page/)
})

// Cost reduction: retrieved references beyond MAX_REFERENCES_FOR_PROMPT (3) are dropped -- extra
// examples add token cost without meaningfully improving guidance quality.
test('retrieved references are capped at 3, even when more are supplied', () => {
  const references = Array.from({ length: 6 }, (_, i) => ({ pattern_id: `pattern_${i + 1}` }))
  const prompt = buildUserPrompt({ inputMetadata: { image_count: 1 }, retrievedReferences: references })
  assert.match(prompt, /pattern_1/)
  assert.match(prompt, /pattern_2/)
  assert.match(prompt, /pattern_3/)
  assert.doesNotMatch(prompt, /pattern_4/)
  assert.doesNotMatch(prompt, /pattern_5/)
  assert.doesNotMatch(prompt, /pattern_6/)
})
