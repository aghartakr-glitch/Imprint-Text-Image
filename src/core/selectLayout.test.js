import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectLayout } from './selectLayout.js'

const AVAILABLE_PATTERNS = [
  { patternId: 'a-1img-full-bleed', layoutType: 'image-first' },
  { patternId: 'b-1img-top-text-bottom', layoutType: 'balanced' },
  { patternId: 'c-1img-text-first', layoutType: 'text-first' },
]

test('no API key and not mock mode still returns a rule-based single layout (never throws)', async () => {
  const result = await selectLayout(
    {
      imageCount: 1, textLength: 3000, imageAspectRatios: [1.5], availablePatterns: AVAILABLE_PATTERNS,
    },
    { apiKey: undefined, mockMode: false },
  )
  assert.equal(result.layoutType, 'text-first')
  assert.equal(result.patternId, 'c-1img-text-first')
  assert.equal(result.source, 'rule-based')
})

test('mockMode=true skips the API even if a key is present', async () => {
  const result = await selectLayout(
    {
      imageCount: 1, textLength: 500, imageAspectRatios: [1.5], availablePatterns: AVAILABLE_PATTERNS,
    },
    { apiKey: 'sk-fake', mockMode: true },
  )
  assert.equal(result.layoutType, 'image-first')
  assert.equal(result.source, 'rule-based')
})

test('a valid LLM response (style + layout_type + matching pattern_id + reason) is used as-is', async () => {
  const fakeClient = {
    messages: {
      create: async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify({
            style: 'Magazine', layout_type: 'balanced', pattern_id: 'b-1img-top-text-bottom', reason: '테스트 이유',
          }),
        }],
      }),
    },
  }
  const result = await selectLayout(
    {
      imageCount: 1, textLength: 800, imageAspectRatios: [1], availablePatterns: AVAILABLE_PATTERNS,
    },
    { apiKey: 'sk-fake', mockMode: false, client: fakeClient },
  )
  assert.equal(result.style, 'Magazine')
  assert.equal(result.layoutType, 'balanced')
  assert.equal(result.patternId, 'b-1img-top-text-bottom')
  assert.equal(result.reason, '테스트 이유')
  assert.equal(result.source, 'llm')
})

test('malformed (non-JSON) LLM response falls back to rules instead of throwing', async () => {
  const fakeClient = { messages: { create: async () => ({ content: [{ type: 'text', text: 'not json' }] }) } }
  const result = await selectLayout(
    {
      imageCount: 1, textLength: 3000, imageAspectRatios: [1], availablePatterns: AVAILABLE_PATTERNS,
    },
    { apiKey: 'sk-fake', mockMode: false, client: fakeClient },
  )
  assert.equal(result.source, 'rule-based-fallback')
  assert.equal(result.layoutType, 'text-first')
  assert.match(result.fallbackReason, /JSON/i)
})

test('an out-of-vocabulary style falls back to rules', async () => {
  const fakeClient = {
    messages: {
      create: async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify({
            style: 'Noir', layout_type: 'balanced', pattern_id: 'b-1img-top-text-bottom', reason: 'x',
          }),
        }],
      }),
    },
  }
  const result = await selectLayout(
    {
      imageCount: 1, textLength: 500, imageAspectRatios: [1], availablePatterns: AVAILABLE_PATTERNS,
    },
    { apiKey: 'sk-fake', mockMode: false, client: fakeClient },
  )
  assert.equal(result.source, 'rule-based-fallback')
  assert.match(result.fallbackReason, /스타일/)
})

test('an out-of-vocabulary layout_type falls back to rules', async () => {
  const fakeClient = {
    messages: {
      create: async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify({
            style: 'Magazine', layout_type: 'centered', pattern_id: 'b-1img-top-text-bottom', reason: 'x',
          }),
        }],
      }),
    },
  }
  const result = await selectLayout(
    {
      imageCount: 1, textLength: 500, imageAspectRatios: [1], availablePatterns: AVAILABLE_PATTERNS,
    },
    { apiKey: 'sk-fake', mockMode: false, client: fakeClient },
  )
  assert.equal(result.source, 'rule-based-fallback')
  assert.match(result.fallbackReason, /layout_type/)
})

test('a pattern_id not present in available_patterns falls back to rules', async () => {
  const fakeClient = {
    messages: {
      create: async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify({
            style: 'Magazine', layout_type: 'balanced', pattern_id: 'invented-pattern-id', reason: 'x',
          }),
        }],
      }),
    },
  }
  const result = await selectLayout(
    {
      imageCount: 1, textLength: 500, imageAspectRatios: [1], availablePatterns: AVAILABLE_PATTERNS,
    },
    { apiKey: 'sk-fake', mockMode: false, client: fakeClient },
  )
  assert.equal(result.source, 'rule-based-fallback')
  assert.match(result.fallbackReason, /available_patterns/)
})

test('a pattern_id whose real layoutType disagrees with the response layout_type falls back to rules', async () => {
  const fakeClient = {
    messages: {
      create: async () => ({
        content: [{
          type: 'text',
          // pattern_id is a real, valid image-first pattern, but the response claims layout_type "balanced"
          text: JSON.stringify({
            style: 'Magazine', layout_type: 'balanced', pattern_id: 'a-1img-full-bleed', reason: 'x',
          }),
        }],
      }),
    },
  }
  const result = await selectLayout(
    {
      imageCount: 1, textLength: 500, imageAspectRatios: [1], availablePatterns: AVAILABLE_PATTERNS,
    },
    { apiKey: 'sk-fake', mockMode: false, client: fakeClient },
  )
  assert.equal(result.source, 'rule-based-fallback')
  assert.match(result.fallbackReason, /layout_type/)
})

test('a missing/empty reason falls back to rules', async () => {
  const fakeClient = {
    messages: {
      create: async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify({ style: 'Magazine', layout_type: 'balanced', pattern_id: 'b-1img-top-text-bottom' }),
        }],
      }),
    },
  }
  const result = await selectLayout(
    {
      imageCount: 1, textLength: 500, imageAspectRatios: [1], availablePatterns: AVAILABLE_PATTERNS,
    },
    { apiKey: 'sk-fake', mockMode: false, client: fakeClient },
  )
  assert.equal(result.source, 'rule-based-fallback')
  assert.match(result.fallbackReason, /reason/)
})
