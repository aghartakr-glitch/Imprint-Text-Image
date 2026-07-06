// src/core/llmStyle.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferStyle } from './llmStyle.js'

test('no API key and not mock mode still returns a rule-based result (never throws)', async () => {
  const result = await inferStyle(
    { imageCount: 1, textLength: 3000, imageAspectRatios: [1.5] },
    { apiKey: undefined, mockMode: false },
  )
  assert.equal(result.style, 'Editorial')
  assert.equal(result.source, 'rule-based')
})

test('mockMode=true skips the API even if a key is present', async () => {
  const result = await inferStyle(
    { imageCount: 5, textLength: 100, imageAspectRatios: [1, 1, 1, 1, 1] },
    { apiKey: 'sk-fake', mockMode: true },
  )
  assert.equal(result.style, 'Magazine')
  assert.equal(result.source, 'rule-based')
})

test('valid LLM JSON response is used as-is', async () => {
  const fakeClient = {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: '{"style": "Magazine", "reason": "테스트 응답"}' }],
      }),
    },
  }
  const result = await inferStyle(
    { imageCount: 3, textLength: 800, imageAspectRatios: [1, 1.2, 0.9] },
    { apiKey: 'sk-fake', mockMode: false, client: fakeClient },
  )
  assert.equal(result.style, 'Magazine')
  assert.equal(result.source, 'llm')
})

test('malformed LLM response falls back to rules instead of throwing', async () => {
  const fakeClient = {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: 'not json' }] }),
    },
  }
  const result = await inferStyle(
    { imageCount: 1, textLength: 3000, imageAspectRatios: [1] },
    { apiKey: 'sk-fake', mockMode: false, client: fakeClient },
  )
  assert.equal(result.source, 'rule-based-fallback')
  assert.equal(result.style, 'Editorial')
})

test('LLM response with an out-of-vocabulary style falls back to rules', async () => {
  const fakeClient = {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: '{"style": "Noir", "reason": "x"}' }],
      }),
    },
  }
  const result = await inferStyle(
    { imageCount: 5, textLength: 100, imageAspectRatios: [1] },
    { apiKey: 'sk-fake', mockMode: false, client: fakeClient },
  )
  assert.equal(result.source, 'rule-based-fallback')
  assert.equal(result.style, 'Magazine')
})
