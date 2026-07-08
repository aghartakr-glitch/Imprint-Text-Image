import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callLayoutLLM } from './callLayoutLLM.js'

const INPUT_METADATA = { image_count: 2, image_ratios: [1.2, 0.9], text_length_chars: 500, estimated_text_density: 'short' }

function textResponse(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] }
}

function validPlanFor2Images(overrides = {}) {
  return {
    style: 'Editorial',
    layout_family: 'balanced',
    base_pattern_reference: 'two_equal_images',
    layout_intent: 'test',
    grid: { columns: 6, rows: 12 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'image_1', type: 'image', role: 'equal', page: 1, col_start: 1, col_span: 3, row_start: 1, row_span: 6, fit: 'contain',
        },
        {
          id: 'image_2', type: 'image', role: 'equal', page: 1, col_start: 4, col_span: 3, row_start: 1, row_span: 6, fit: 'contain',
        },
        {
          id: 'body_1', type: 'text', role: 'body', page: 1, col_start: 1, col_span: 6, row_start: 8, row_span: 5,
        },
      ],
    }],
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    reason: 'test',
    ...overrides,
  }
}

function queueClient(responses) {
  const calls = []
  let i = 0
  return {
    calls,
    messages: {
      create: async (req) => {
        calls.push(req)
        const next = responses[Math.min(i, responses.length - 1)]
        i += 1
        if (next.throws) throw new Error(next.throws)
        return next.response
      },
    },
  }
}

test('no API key and not mock mode returns a deterministic fallback (never throws)', async () => {
  const result = await callLayoutLLM(
    { inputMetadata: INPUT_METADATA, imageCount: 2, textDensity: 'short' },
    { apiKey: undefined, mockMode: false },
  )
  assert.equal(result.fallbackUsed, true)
  assert.equal(result.retryCount, 0)
  assert.equal(result.validation.passed, true)
})

test('mockMode=true uses fallback even with an API key present', async () => {
  const result = await callLayoutLLM(
    { inputMetadata: INPUT_METADATA, imageCount: 2, textDensity: 'short' },
    { apiKey: 'sk-fake', mockMode: true },
  )
  assert.equal(result.fallbackUsed, true)
})

test('a valid plan on the first try is used as-is, no retry, no repair', async () => {
  const client = queueClient([{ response: textResponse(validPlanFor2Images()) }])
  const result = await callLayoutLLM(
    { inputMetadata: INPUT_METADATA, imageCount: 2, textDensity: 'short' },
    { apiKey: 'sk-fake', mockMode: false, client },
  )
  assert.equal(result.source, 'llm')
  assert.equal(result.retryCount, 0)
  assert.equal(result.fallbackUsed, false)
  assert.equal(result.repairAttempted, false)
  assert.equal(client.calls.length, 1)
})

test('a plan missing only fit/role is auto-repaired without a retry', async () => {
  const plan = validPlanFor2Images()
  delete plan.pages[0].elements[0].fit
  const client = queueClient([{ response: textResponse(plan) }])
  const result = await callLayoutLLM(
    { inputMetadata: INPUT_METADATA, imageCount: 2, textDensity: 'short' },
    { apiKey: 'sk-fake', mockMode: false, client },
  )
  assert.equal(result.repairAttempted, true)
  assert.equal(result.fallbackUsed, false)
  assert.equal(result.retryCount, 0)
  assert.equal(result.plan.pages[0].elements[0].fit, 'contain')
  assert.equal(client.calls.length, 1)
})

test('an unrepairable overlap on attempt 1, fixed on attempt 2, succeeds via retry', async () => {
  const overlapping = validPlanFor2Images()
  overlapping.pages[0].elements[1] = { ...overlapping.pages[0].elements[1], col_start: 1, col_span: 3 }
  const fixed = validPlanFor2Images()

  const client = queueClient([
    { response: textResponse(overlapping) },
    { response: textResponse(fixed) },
  ])
  const result = await callLayoutLLM(
    { inputMetadata: INPUT_METADATA, imageCount: 2, textDensity: 'short' },
    { apiKey: 'sk-fake', mockMode: false, client },
  )
  assert.equal(result.source, 'llm-retry')
  assert.equal(result.retryCount, 1)
  assert.equal(result.fallbackUsed, false)
  assert.equal(client.calls.length, 2)
  // the retry prompt should carry the previous validation errors forward
  assert.match(client.calls[1].messages[0].content, /previous layout_plan failed validation/)
})

test('malformed JSON on the first attempt recovers via retry', async () => {
  const client = queueClient([
    { response: { content: [{ type: 'text', text: 'not json at all' }] } },
    { response: textResponse(validPlanFor2Images()) },
  ])
  const result = await callLayoutLLM(
    { inputMetadata: INPUT_METADATA, imageCount: 2, textDensity: 'short' },
    { apiKey: 'sk-fake', mockMode: false, client },
  )
  assert.equal(result.source, 'llm-retry')
  assert.equal(result.retryCount, 1)
  assert.equal(client.calls.length, 2)
})

test('all 3 attempts (1 initial + 2 retries) failing falls back to the deterministic plan', async () => {
  const stillOverlapping = validPlanFor2Images()
  stillOverlapping.pages[0].elements[1] = { ...stillOverlapping.pages[0].elements[1], col_start: 1, col_span: 3 }
  const client = queueClient([{ response: textResponse(stillOverlapping) }])
  const result = await callLayoutLLM(
    { inputMetadata: INPUT_METADATA, imageCount: 2, textDensity: 'short' },
    { apiKey: 'sk-fake', mockMode: false, client },
  )
  assert.equal(result.fallbackUsed, true)
  assert.equal(result.retryCount, 2)
  assert.equal(client.calls.length, 3)
  assert.equal(result.validation.passed, true) // the fallback plan itself is always valid
})
