import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateLayoutCandidates, retryLayoutCandidate, extractFirstBalancedJsonValue } from './generateLayoutCandidates.js'

function textResponse(obj, usage = { input_tokens: 100, output_tokens: 50 }) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }], usage }
}

test('generateLayoutCandidates returns the parsed candidates array', async () => {
  const client = {
    messages: {
      create: async () => textResponse({ candidates: [{ candidate_id: 'candidate_1' }, { candidate_id: 'candidate_2' }] }),
    },
  }
  const mockCostBudget = {
    planRequest: async () => ({ maxOutputTokens: 1600, minOutputTokens: 500 }),
    recordUsage: () => {},
    summary: () => ({ estimated: '$0.001' }),
  }
  const candidates = await generateLayoutCandidates({ inputMetadata: { image_count: 1 } }, { client, costBudget: mockCostBudget })
  assert.equal(candidates.length, 2)
  assert.equal(candidates[0].candidate_id, 'candidate_1')
})

test('generateLayoutCandidates throws (not silently returns []) when candidates is missing or empty', async () => {
  const emptyClient = { messages: { create: async () => textResponse({ candidates: [] }) } };
  await assert.rejects(() => generateLayoutCandidates({ inputMetadata: {} }, { client: emptyClient }))

  const missingClient = { messages: { create: async () => textResponse({ style: 'Editorial' }) } };
  await assert.rejects(() => generateLayoutCandidates({ inputMetadata: {} }, { client: missingClient }))
})

test('retryLayoutCandidate sends the retry-specific prompt and returns one parsed plan', async () => {
  let capturedPrompt = null
  const client = {
    messages: {
      create: async (req) => {
        capturedPrompt = req.messages[0].content
        return textResponse({ style: 'Editorial', pages: [] })
      },
    },
  }
  const plan = await retryLayoutCandidate(
    { inputMetadata: { image_count: 1 }, failedLayoutPlan: { style: 'bad' }, validationErrors: ['오류'] },
    { client },
  )
  assert.equal(plan.style, 'Editorial')
  assert.match(capturedPrompt, /Your previous layout_plan failed validation/)
  assert.match(capturedPrompt, /오류/)
})

// Regression: the LLM occasionally emits a literal (unescaped) line break inside a long Korean
// text field (e.g. "reason") instead of the required \n escape sequence. Per the JSON spec this is
// invalid and JSON.parse throws "Bad control character"/"Unterminated string" -- previously this
// meant the entire response (including otherwise-valid candidates) was discarded and the whole
// generation failed (confirmed 2026-07-10: real report showed exactly this "Unterminated string in
// JSON at position 20409, line 285"). Now the parser sanitizes raw control characters found inside
// JSON strings before giving up.
test('recovers from a raw (unescaped) newline inside a JSON string value', async () => {
  const brokenJsonText = '{"candidates":[{"candidate_id":"c1","reason":"first line\nsecond line"}]}'
  const client = {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: brokenJsonText }], usage: { input_tokens: 100, output_tokens: 50 } }),
    },
  }
  const mockCostBudget = {
    planRequest: async () => ({ maxOutputTokens: 1600, minOutputTokens: 500 }),
    recordUsage: () => {},
    summary: () => ({ estimated: '$0.001' }),
  }
  const result = await generateLayoutCandidates({ inputMetadata: { image_count: 1 } }, { client, costBudget: mockCostBudget })
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].candidate_id, 'c1')
  assert.equal(result.candidates[0].reason, 'first line\nsecond line')
})

// Regression: "Unexpected non-whitespace character after JSON" -- the LLM occasionally appends
// trailing prose (or a duplicated second JSON blob) after an otherwise complete, valid JSON value.
// Confirmed 2026-07-10 real report: "[JSON Parse Error at position 2619] Unexpected non-whitespace
// character after JSON at position 2619 (line 1 column 2620)". Previously this discarded an
// otherwise-valid candidate and failed the whole generation. extractFirstBalancedJsonValue scans
// for the first balanced top-level {...} / [...] (tracking string/escape state) and the parser
// retries against just that substring.
test('extractFirstBalancedJsonValue strips trailing prose after valid JSON', () => {
  const text = '{"candidates":[{"id":"a"}]}\n\nHope this helps!'
  assert.deepEqual(JSON.parse(extractFirstBalancedJsonValue(text)), { candidates: [{ id: 'a' }] })
})

test('extractFirstBalancedJsonValue keeps only the first of two concatenated JSON blobs', () => {
  const text = '{"candidates":[{"id":"a"}]}{"candidates":[{"id":"b"}]}'
  assert.deepEqual(JSON.parse(extractFirstBalancedJsonValue(text)), { candidates: [{ id: 'a' }] })
})

test('extractFirstBalancedJsonValue ignores braces/brackets inside string values', () => {
  const text = '{"reason":"use { and [ chars } freely ] inside strings"}  trailing junk'
  assert.equal(JSON.parse(extractFirstBalancedJsonValue(text)).reason, 'use { and [ chars } freely ] inside strings')
})

test('extractFirstBalancedJsonValue handles escaped quotes without ending the string early', () => {
  const text = '{"note":"she said \\"hi { there\\""}  extra text after'
  assert.equal(JSON.parse(extractFirstBalancedJsonValue(text)).note, 'she said "hi { there"')
})

test('extractFirstBalancedJsonValue returns null for genuinely truncated JSON (no false positive)', () => {
  assert.equal(extractFirstBalancedJsonValue('{"candidates":[{"id":"a"'), null)
})

test('generateLayoutCandidates recovers when the LLM appends trailing prose after valid JSON', async () => {
  const brokenJsonText = '{"candidates":[{"candidate_id":"c1"}]}\n\nHope this layout works well for you!'
  const client = {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: brokenJsonText }], usage: { input_tokens: 100, output_tokens: 50 } }),
    },
  }
  const mockCostBudget = {
    planRequest: async () => ({ maxOutputTokens: 1600, minOutputTokens: 500 }),
    recordUsage: () => {},
    summary: () => ({ estimated: '$0.001' }),
  }
  const result = await generateLayoutCandidates({ inputMetadata: { image_count: 1 } }, { client, costBudget: mockCostBudget })
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].candidate_id, 'c1')
})
