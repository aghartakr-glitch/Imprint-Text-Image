import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callLayoutLLM } from './callLayoutLLM.js'

function textResponse(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] }
}

function validPlan(id, overrides = {}) {
  return {
    candidate_id: id,
    style: 'Editorial',
    output_unit: 'single_page',
    layout_family: 'balanced',
    layout_purpose: 'case_analysis',
    image_hierarchy: 'equal_pair',
    image_text_relation: 'text_explains_image',
    composition_strategy: 'image_above_text',
    base_pattern_reference: 'two_equal_images',
    layout_intent: 'test',
    design_sequence: [{
      step: 1, decision_type: 'layout_family', value: 'balanced', reason: 'test',
    }],
    grid: { columns: 6, rows: 12 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'image_1', type: 'image', role: 'equal', page: 1, col_start: 1, col_span: 6, row_start: 1, row_span: 6, fit: 'contain',
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

test('no API key and not mock mode returns fallbackUsed=true with no candidates (never throws)', async () => {
  const result = await callLayoutLLM(
    { promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 },
    { apiKey: undefined, mockMode: false },
  )
  assert.equal(result.fallbackUsed, true)
  assert.deepEqual(result.candidates, [])
  assert.equal(result.retryCount, 0)
})

test('mockMode=true skips the API even with a key present', async () => {
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: true })
  assert.equal(result.fallbackUsed, true)
})

test('all 3 candidates valid on the first try are all returned, none rejected', async () => {
  const client = queueClient([{
    response: textResponse({ candidates: [validPlan('candidate_1'), validPlan('candidate_2'), validPlan('candidate_3')] }),
  }])
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: false, client })
  assert.equal(result.candidates.length, 3)
  assert.equal(result.rejectedCandidates.length, 0)
  assert.equal(result.source, 'llm')
  assert.equal(result.retryCount, 0)
  assert.equal(result.fallbackUsed, false)
  assert.equal(client.calls.length, 1)
})

test('a candidate missing only fit/role is repaired and kept; a genuinely broken one is rejected', async () => {
  const missingFit = validPlan('candidate_1')
  delete missingFit.pages[0].elements[0].fit

  const overlapping = validPlan('candidate_2')
  overlapping.pages[0].elements[1] = { ...overlapping.pages[0].elements[1], col_start: 1, col_span: 6, row_start: 1, row_span: 6 }

  const client = queueClient([{ response: textResponse({ candidates: [missingFit, overlapping, validPlan('candidate_3')] }) }])
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: false, client })

  assert.equal(result.candidates.length, 2) // candidate_1 (repaired) + candidate_3
  assert.equal(result.rejectedCandidates.length, 1) // candidate_2
  const repairedOne = result.candidates.find((c) => c.candidateId === 'candidate_1')
  assert.equal(repairedOne.repaired, true)
  assert.equal(repairedOne.plan.pages[0].elements[0].fit, 'contain')
})

test('if every candidate fails on attempt 1 but all pass on attempt 2, it recovers via retry', async () => {
  const broken = validPlan('candidate_1')
  broken.style = 'Noir'
  const client = queueClient([
    { response: textResponse({ candidates: [broken] }) },
    { response: textResponse({ candidates: [validPlan('candidate_1'), validPlan('candidate_2')] }) },
  ])
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: false, client })
  assert.equal(result.source, 'llm-retry')
  assert.equal(result.retryCount, 1)
  assert.equal(result.candidates.length, 2)
  assert.equal(client.calls.length, 2)
})

test('malformed JSON on attempt 1 recovers via retry on attempt 2', async () => {
  const client = queueClient([
    { response: { content: [{ type: 'text', text: 'not json' }] } },
    { response: textResponse({ candidates: [validPlan('candidate_1')] }) },
  ])
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: false, client })
  assert.equal(result.source, 'llm-retry')
  assert.equal(result.retryCount, 1)
})

test('all 3 attempts failing (1 initial + 2 retries) falls back with no candidates', async () => {
  const broken = validPlan('candidate_1')
  broken.style = 'Noir'
  const client = queueClient([{ response: textResponse({ candidates: [broken] }) }])
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: false, client })
  assert.equal(result.fallbackUsed, true)
  assert.equal(result.retryCount, 2)
  assert.equal(result.candidates.length, 0)
  assert.equal(client.calls.length, 3)
  assert.ok(result.fallbackReason.length > 0)
})
