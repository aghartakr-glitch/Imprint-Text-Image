import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callLayoutLLM } from './callLayoutLLM.js'

function textResponse(obj, usage = { input_tokens: 100, output_tokens: 50 }) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }], usage }
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

test('mockMode=true skips the API even with a key present and returns a usable mock candidate', async () => {
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: true })
  assert.equal(result.fallbackUsed, false)
  assert.equal(result.source, 'mock')
  assert.equal(result.candidates.length, 1)
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

test('a validation failure on the one and only attempt falls back immediately -- no retry API call is ever made', async () => {
  const broken = validPlan('candidate_1')
  broken.style = 'Noir'
  const client = queueClient([{ response: textResponse({ candidates: [broken] }) }])
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: false, client })
  assert.equal(result.fallbackUsed, true)
  assert.equal(result.retryCount, 0)
  assert.equal(result.candidates.length, 0)
  assert.equal(client.calls.length, 1, 'must not make a second (retry) API call')
  assert.ok(result.fallbackReason.length > 0)
})

test('malformed JSON on the one attempt falls back immediately, no retry call', async () => {
  const client = queueClient([{ response: { content: [{ type: 'text', text: 'not json' }], usage: { input_tokens: 100, output_tokens: 50 } } }])
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: false, client })
  assert.equal(result.fallbackUsed, true)
  assert.equal(result.retryCount, 0)
  assert.equal(client.calls.length, 1)
})

test('cost budget refuses the single call outright if even its minimum output would exceed the 0.03 USD ceiling', async () => {
  const budget = { planRequest: async () => { throw new (await import('./layoutCostBudget.js')).LayoutCostBudgetExceeded('LLM 비용 예산 $0.03 초과 방지를 위해 API 호출을 중단했습니다.') }, summary: () => ({ max_spend_usd: 0.03, spent_usd: 0, remaining_usd: 0.03, calls: [] }) }
  const client = queueClient([{ response: textResponse({ candidates: [validPlan('candidate_1')] }) }])
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: false, client, costBudget: budget })
  assert.equal(result.fallbackUsed, true)
  assert.match(result.fallbackReason, /\$0\.03/)
  assert.equal(client.calls.length, 0, 'the call must never reach the API once the budget check refuses it')
})

function groupsPlan(id, overrides = {}) {
  return {
    candidate_id: id,
    style: 'Editorial',
    output_unit: 'spread',
    layout_family: 'modular-editorial',
    layout_purpose: 'case_analysis',
    image_hierarchy: 'hero_support',
    image_text_relation: 'text_explains_image',
    composition_strategy: 'image_text_case_blocks',
    design_sequence: [{
      step: 1, decision_type: 'composition_strategy', value: 'image_text_case_blocks', reason: 'test',
    }],
    groups: [
      {
        group_id: 'g1', type: 'opener', image_ids: ['image_1'], text_sources: ['paragraph_1'], preferred_image_span: 2, preferred_text_span: 2, priority: 'high',
      },
      {
        group_id: 'g2', type: 'case_block', image_ids: ['image_2'], text_sources: ['paragraph_2'], preferred_image_span: 3, preferred_text_span: 1, priority: 'medium',
      },
    ],
    reading_flow: ['g1', 'g2'],
    reason: 'test',
    ...overrides,
  }
}

test('a groups-based (new schema) candidate is packed into real geometry and passes validation end to end', async () => {
  const client = queueClient([{ response: textResponse({ candidates: [groupsPlan('candidate_1'), groupsPlan('candidate_2'), groupsPlan('candidate_3')] }) }])
  const promptContext = {
    inputMetadata: { image_count: 2 },
    userGridHint: { columns: 4, rows: 12, gutter_mm: 4 },
    textBlocks: [
      { id: 'p1', role: 'overview', char_count: 200 },
      { id: 'p2', role: 'context', char_count: 220 },
    ],
    imageMetadata: [
      { id: 'image_1', ratio: 1.2 },
      { id: 'image_2', ratio: 0.9 },
    ],
  }
  const result = await callLayoutLLM({ promptContext, imageCount: 2 }, { apiKey: 'sk-fake', mockMode: false, client })
  assert.equal(result.fallbackUsed, false)
  assert.equal(result.candidates.length, 3)
  const firstPlan = result.candidates[0].plan
  const allImages = firstPlan.pages.flatMap((p) => p.elements.filter((el) => el.type === 'image').map((el) => el.id))
  assert.deepEqual([...allImages].sort(), ['image_1', 'image_2'])
})
