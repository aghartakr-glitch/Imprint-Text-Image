import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateLayoutCandidates, retryLayoutCandidate, extractFirstBalancedJsonValue, removeTrailingCommas, JsonTruncatedError,
} from './generateLayoutCandidates.js'

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

// Cost reduction (prompt caching, opt-in): default behavior must be byte-for-byte unchanged --
// `system` stays the plain SYSTEM_PROMPT string unless the caller explicitly opts in.
test('generateLayoutCandidates sends system as a plain string by default (prompt caching off)', async () => {
  let capturedSystem = null
  const client = {
    messages: {
      create: async (req) => {
        capturedSystem = req.system
        return textResponse({ candidates: [{ candidate_id: 'candidate_1' }] })
      },
    },
  }
  const mockCostBudget = {
    planRequest: async () => ({ maxOutputTokens: 1600, minOutputTokens: 500 }),
    recordUsage: () => {},
    summary: () => ({ estimated: '$0.001' }),
  }
  await generateLayoutCandidates({ inputMetadata: { image_count: 1 } }, { client, costBudget: mockCostBudget })
  assert.equal(typeof capturedSystem, 'string')
})

test('generateLayoutCandidates sends system as a cache_control-tagged block when enablePromptCaching is true', async () => {
  let capturedSystem = null
  const client = {
    messages: {
      create: async (req) => {
        capturedSystem = req.system
        return textResponse({ candidates: [{ candidate_id: 'candidate_1' }] })
      },
    },
  }
  const mockCostBudget = {
    planRequest: async () => ({ maxOutputTokens: 1600, minOutputTokens: 500 }),
    recordUsage: () => {},
    summary: () => ({ estimated: '$0.001' }),
  }
  await generateLayoutCandidates(
    { inputMetadata: { image_count: 1 } },
    { client, costBudget: mockCostBudget, enablePromptCaching: true },
  )
  assert.ok(Array.isArray(capturedSystem))
  assert.equal(capturedSystem[0].type, 'text')
  assert.deepEqual(capturedSystem[0].cache_control, { type: 'ephemeral' })
})

// Regression: confirmed 2026-07-27 real generation failure -- "Expected double-quoted property
// name in JSON at position ..." from a trailing comma the model left before a closing }/] (valid in
// a JS literal, invalid JSON), which previously had no repair path and hard-failed the generation.
test('removeTrailingCommas drops a comma immediately before a closing brace/bracket, leaves string content untouched', () => {
  const input = '{"a":1,"b":[1,2,3,],"c":{"d":1,},"note":"trailing, comma, inside string, not touched,"}'
  const fixed = removeTrailingCommas(input)
  assert.doesNotThrow(() => JSON.parse(fixed))
  const parsed = JSON.parse(fixed)
  assert.deepEqual(parsed.b, [1, 2, 3])
  assert.deepEqual(parsed.c, { d: 1 })
  assert.equal(parsed.note, 'trailing, comma, inside string, not touched,')
})

test('generateLayoutCandidates recovers from a real LLM response with a trailing comma before a closing bracket', async () => {
  // Deliberately malformed: a trailing comma after the last element of "candidates", exactly the
  // shape of bug that produced "Expected double-quoted property name in JSON at position 18561".
  const malformedJson = '{"candidates":[{"candidate_id":"candidate_1","pages":[{"page":1,"elements":[],},],},]}'
  const client = {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: malformedJson }], usage: { input_tokens: 100, output_tokens: 50 } }),
    },
  }
  const mockCostBudget = {
    planRequest: async () => ({ maxOutputTokens: 1600, minOutputTokens: 500 }),
    recordUsage: () => {},
    summary: () => ({ estimated: '$0.001' }),
  }
  const result = await generateLayoutCandidates({ inputMetadata: { image_count: 1 } }, { client, costBudget: mockCostBudget })
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].candidate_id, 'candidate_1')
})

// Regression: confirmed 2026-07-27 -- a response cut off by max_tokens (stop_reason: 'max_tokens')
// used to fall through to the generic JSON-repair chain and fail with a misleading parse-error
// message ("Unterminated string in JSON at position 19031, line 713") that looked like a formatting
// bug, when the real cause was the response simply running out of token budget. This must be
// detected up front, before any parse/repair attempt, and raised as a distinct error type.
test('a response with stop_reason "max_tokens" throws JsonTruncatedError before any parse attempt, even with unparseable text', async () => {
  const client = {
    messages: {
      create: async () => ({
        // Deliberately unterminated JSON string, mimicking a real truncated response.
        content: [{ type: 'text', text: '{"candidates":[{"candidate_id":"candidate_1","reason":"cut off mid' }],
        usage: { input_tokens: 100, output_tokens: 8000 },
        stop_reason: 'max_tokens',
      }),
    },
  }
  const mockCostBudget = {
    planRequest: async () => ({ maxOutputTokens: 8000, minOutputTokens: 500 }),
    recordUsage: () => {},
    summary: () => ({ estimated: '$0.001' }),
  }
  await assert.rejects(
    () => generateLayoutCandidates({ inputMetadata: { image_count: 1 } }, { client, costBudget: mockCostBudget }),
    (err) => {
      assert.ok(err instanceof JsonTruncatedError, `expected JsonTruncatedError, got ${err.constructor.name}: ${err.message}`)
      assert.match(err.message, /max_tokens/)
      return true
    },
  )
})

test('a response with stop_reason "end_turn" is parsed normally, not treated as truncated', async () => {
  const client = {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ candidates: [{ candidate_id: 'candidate_1' }] }) }],
        usage: { input_tokens: 100, output_tokens: 50 },
        stop_reason: 'end_turn',
      }),
    },
  }
  const mockCostBudget = {
    planRequest: async () => ({ maxOutputTokens: 8000, minOutputTokens: 500 }),
    recordUsage: () => {},
    summary: () => ({ estimated: '$0.001' }),
  }
  const result = await generateLayoutCandidates({ inputMetadata: { image_count: 1 } }, { client, costBudget: mockCostBudget })
  assert.equal(result.candidates[0].candidate_id, 'candidate_1')
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
