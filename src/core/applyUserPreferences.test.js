import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveUserPreferenceContext } from './applyUserPreferences.js'

test('merges interpreted_preference objects from every feedback entry', () => {
  const context = deriveUserPreferenceContext([
    { interpreted_preference: { text_position_preference: 'lower', spacing_preference: 'more_whitespace' } },
    { interpreted_preference: { image_scale_preference: 'larger' } },
  ])
  assert.deepEqual(context, {
    text_position_preference: 'lower', spacing_preference: 'more_whitespace', image_scale_preference: 'larger',
  })
})

test('later entries win on conflicting keys', () => {
  const context = deriveUserPreferenceContext([
    { interpreted_preference: { layout_family_preference: 'balanced' } },
    { interpreted_preference: { layout_family_preference: 'image-first' } },
  ])
  assert.equal(context.layout_family_preference, 'image-first')
})

test('an empty feedback list produces an empty context', () => {
  assert.deepEqual(deriveUserPreferenceContext([]), {})
})
