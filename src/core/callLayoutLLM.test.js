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

test('mockMode=true skips the API even with a key present', async () => {
  const client = queueClient([{ throws: 'API must not be called in mock mode' }])
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: true, client })
  assert.equal(result.source, 'mock')
  assert.equal(result.fallbackUsed, false)
  assert.equal(client.calls.length, 0, 'mock mode must not reach the API')
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

  // An overlapping pair is now geometry-repairable (shift down, or overflow to a new page), so it
  // no longer represents "genuinely broken" -- use an invalid enum value instead, which none of the
  // local repair steps (defaults/overflow/collisions) touch.
  const invalidEnum = validPlan('candidate_2')
  invalidEnum.style = 'Noir'

  const client = queueClient([{ response: textResponse({ candidates: [missingFit, invalidEnum, validPlan('candidate_3')] }) }])
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: false, client })

  assert.equal(result.candidates.length, 2) // candidate_1 (repaired) + candidate_3
  assert.equal(result.rejectedCandidates.length, 1) // candidate_2
  const repairedOne = result.candidates.find((c) => c.candidateId === 'candidate_1')
  assert.equal(repairedOne.repaired, true)
  assert.equal(repairedOne.plan.pages[0].elements[0].fit, 'contain')
})

test('by default, a validation failure on the first attempt does NOT retry -- one API call only', async () => {
  const broken = validPlan('candidate_1')
  broken.style = 'Noir'
  const client = queueClient([{ response: textResponse({ candidates: [broken] }) }])
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: false, client })
  assert.equal(result.fallbackUsed, true)
  assert.equal(result.retryCount, 0)
  assert.equal(client.calls.length, 1, 'retry must be opt-in, not automatic -- no invisible second charge')
})

test('with allowRetry:true, a validation failure on the first attempt triggers exactly one feedback retry, which succeeds', async () => {
  const broken = validPlan('candidate_1')
  broken.style = 'Noir'
  const client = queueClient([
    { response: textResponse({ candidates: [broken] }) },
    { response: textResponse({ candidates: [validPlan('candidate_1')] }) },
  ])
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: false, client, allowRetry: true })
  assert.equal(result.fallbackUsed, false)
  assert.equal(result.retryCount, 1)
  assert.equal(result.candidates.length, 1)
  assert.equal(client.calls.length, 2, 'must make exactly one retry API call, not zero and not more than one')
})

test('with allowRetry:true, a validation failure on both the first attempt and the retry falls back after exactly one retry', async () => {
  const broken = validPlan('candidate_1')
  broken.style = 'Noir'
  const stillBroken = validPlan('candidate_1')
  stillBroken.style = 'Noir'
  const client = queueClient([
    { response: textResponse({ candidates: [broken] }) },
    { response: textResponse({ candidates: [stillBroken] }) },
  ])
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: false, client, allowRetry: true })
  assert.equal(result.fallbackUsed, true)
  assert.equal(result.retryCount, 1)
  assert.equal(result.candidates.length, 0)
  assert.equal(client.calls.length, 2, 'must not retry more than once')
  assert.ok(result.fallbackReason.length > 0)
})

test('malformed JSON on the one attempt falls back immediately, no retry call', async () => {
  const client = queueClient([{ response: { content: [{ type: 'text', text: 'not json' }], usage: { input_tokens: 100, output_tokens: 50 } } }])
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: false, client })
  assert.equal(result.fallbackUsed, true)
  assert.equal(result.retryCount, 0)
  assert.equal(client.calls.length, 1)
})

// Regression: confirmed 2026-07-27 -- a genuinely truncated response (stop_reason: 'max_tokens')
// used to be reported to the caller as "LLM 요청/JSON 파싱 실패: Unterminated string in JSON at
// position ...", indistinguishable from an actual malformed-JSON bug. It must be reported with its
// own distinct, actionable message instead.
test('a truncated (stop_reason: max_tokens) response is reported with a distinct "LLM 응답 잘림" message, not a generic parse-failure message', async () => {
  const client = queueClient([{
    response: {
      content: [{ type: 'text', text: '{"candidates":[{"candidate_id":"candidate_1","reason":"cut off mid' }],
      usage: { input_tokens: 100, output_tokens: 8000 },
      stop_reason: 'max_tokens',
    },
  }])
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: false, client })
  assert.equal(result.fallbackUsed, true)
  assert.match(result.fallbackReason, /^LLM 응답 잘림:/)
  assert.match(result.fallbackReason, /max_tokens/)
})

test('cost budget refuses the single call outright if even its minimum output would exceed the 0.03 USD ceiling', async () => {
  const budget = { planRequest: async () => { throw new (await import('./layoutCostBudget.js')).LayoutCostBudgetExceeded('LLM 비용 예산 $0.03 초과 방지를 위해 API 호출을 중단했습니다.') }, summary: () => ({ max_spend_usd: 0.03, spent_usd: 0, remaining_usd: 0.03, calls: [] }) }
  const client = queueClient([{ response: textResponse({ candidates: [validPlan('candidate_1')] }) }])
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: false, client, costBudget: budget })
  assert.equal(result.fallbackUsed, true)
  assert.match(result.fallbackReason, /\$0\.03/)
  assert.equal(client.calls.length, 0, 'the call must never reach the API once the budget check refuses it')
})

// Integration fixture reproducing the exact real-world failure report in full: three separate
// collisions (text-text x2, text-image x1) plus two text-capacity overflows (300ch/85cap,
// 192ch/136cap -- the literal numbers from the report) on ONE candidate. Proves the local repair
// chain (repairLayoutPlan -> repairTextOverflow -> repairCollisions) resolves all five issues
// together with zero LLM retries, before ever touching the real API again.
test('a single candidate combining 3 collisions + 2 severe text overflows is fully repaired locally, with zero retries', async () => {
  const plan = {
    candidate_id: 'candidate_1',
    style: 'Editorial',
    output_unit: 'spread',
    layout_family: 'balanced',
    layout_purpose: 'editorial_reading',
    image_hierarchy: 'hero_support',
    image_text_relation: 'image_sets_mood',
    composition_strategy: 'image_left_text_right',
    base_pattern_reference: 'x',
    layout_intent: 'x',
    design_sequence: [{
      step: 1, decision_type: 'x', value: 'x', reason: 'x',
    }],
    grid: { columns: 4, rows: 12 },
    grid_spec: {
      columns: 4, rows: 12, gutter_mm: 4, page_size: 'A5', grid_mode: 'flexible',
    },
    pages: [
      {
        page: 1,
        elements: [
          {
            id: 'p3_body', type: 'text', role: 'body', text_source: 'paragraph_3', col_start: 1, col_span: 2, row_start: 1, row_span: 4,
          },
          // Overlaps p3_body (rows 3-4) AND overflows its own box: 300ch in a col_span2/row_span2
          // box (capacity 85) -- the exact 3.53x ratio from the report.
          {
            id: 'p5_body', type: 'text', role: 'body', text_source: 'paragraph_5', col_start: 1, col_span: 2, row_start: 3, row_span: 2,
          },
        ],
      },
      {
        page: 2,
        elements: [
          {
            id: 'p7_body', type: 'text', role: 'body', text_source: 'paragraph_7', col_start: 1, col_span: 4, row_start: 1, row_span: 4,
          },
          // Overlaps p7_body (rows 3-4).
          {
            id: 'p8_label', type: 'text', role: 'section_label', text_source: 'paragraph_8', col_start: 1, col_span: 4, row_start: 3, row_span: 4,
          },
        ],
      },
      {
        page: 3,
        elements: [
          {
            id: 'image_1', type: 'image', role: 'support', col_start: 1, col_span: 2, row_start: 1, row_span: 6, fit: 'contain',
          },
          // Overlaps image_1 (rows 5-6).
          {
            id: 'p19_label', type: 'text', role: 'section_label', text_source: 'paragraph_19', col_start: 1, col_span: 2, row_start: 5, row_span: 4,
          },
          // No overlap with the above (different columns), but 192ch in a col_span2/row_span3 box
          // (capacity 136) -- the exact 1.41x ratio from the report.
          {
            id: 'p9_body', type: 'text', role: 'body', text_source: 'paragraph_9', col_start: 3, col_span: 2, row_start: 1, row_span: 3,
          },
        ],
      },
    ],
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    reason: 'x',
  }
  const textBlocks = [
    { id: 'p3', char_count: 40 },
    { id: 'p5', char_count: 300 },
    { id: 'p7', char_count: 40 },
    { id: 'p8', char_count: 20 },
    { id: 'p9', char_count: 192 },
    { id: 'p19', char_count: 20 },
  ]
  // paragraph_N is positional (Nth paragraph, 1-indexed), so pad indices 1-2, 4, 6, and 10-18 that
  // this fixture doesn't reference with harmless empty blocks.
  const paddedTextBlocks = Array.from({ length: 19 }, (_, i) => textBlocks.find((b) => Number(b.id.slice(1)) === i + 1) || { char_count: 1 })

  const client = queueClient([{ response: textResponse({ candidates: [plan] }) }])
  const result = await callLayoutLLM(
    { promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1, textBlocks: paddedTextBlocks },
    { apiKey: 'sk-fake', mockMode: false, client },
  )

  assert.equal(result.fallbackUsed, false, `expected local repair to fully resolve the candidate; got: ${JSON.stringify(result.rejectedCandidates?.[0]?.validation?.issues)}`)
  assert.equal(result.retryCount, 0, 'all five issues must be resolved by local repair alone, with no LLM retry')
  assert.equal(client.calls.length, 1, 'must not call the API a second time')
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].validation.passed, true)
})

test('a paragraph-order inversion is repaired locally, with zero retries', async () => {
  const plan = {
    candidate_id: 'candidate_1',
    style: 'Editorial',
    output_unit: 'spread',
    layout_family: 'balanced',
    layout_purpose: 'editorial_reading',
    image_hierarchy: 'hero_support',
    image_text_relation: 'text_explains_image',
    composition_strategy: 'image_left_text_right',
    base_pattern_reference: 'x',
    layout_intent: 'x',
    design_sequence: [{ step: 1, decision_type: 'x', value: 'x', reason: 'x' }],
    grid: { columns: 4, rows: 12 },
    grid_spec: { columns: 4, rows: 12, gutter_mm: 4, page_size: 'A5', grid_mode: 'flexible' },
    pages: [
      { page: 1, elements: [{ id: 'p6_body', type: 'text', role: 'body', text_source: 'paragraph_6', col_start: 1, col_span: 4, row_start: 1, row_span: 4 }] },
      { page: 2, elements: [{ id: 'p7_body', type: 'text', role: 'body', text_source: 'paragraph_7', col_start: 1, col_span: 4, row_start: 1, row_span: 4 }] },
      { page: 3, elements: [{ id: 'p5_body', type: 'text', role: 'body', text_source: 'paragraph_5', col_start: 1, col_span: 4, row_start: 1, row_span: 4 }] },
    ],
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    reason: 'x',
  }
  const textBlocks = Array.from({ length: 7 }, () => ({ char_count: 20 }))
  const client = queueClient([{ response: textResponse({ candidates: [plan] }) }])

  const result = await callLayoutLLM(
    { promptContext: { inputMetadata: { image_count: 0 } }, imageCount: 0, textBlocks },
    { apiKey: 'sk-fake', mockMode: false, client },
  )

  assert.equal(result.fallbackUsed, false, JSON.stringify(result.rejectedCandidates?.[0]?.validation?.issues))
  assert.equal(result.retryCount, 0, 'paragraph order must be fixed locally, without a paid retry')
  assert.equal(client.calls.length, 1)
  assert.deepEqual(
    result.candidates[0].plan.pages.flatMap((page) => page.elements).map((el) => el.text_source),
    ['paragraph_5', 'paragraph_6', 'paragraph_7'],
  )
})

// Regression: this used to bail out (fallbackUsed: true) purely because an image was anywhere in
// the plan. repairParagraphOrder now reorders whole pages (never splitting an image from its
// co-located text) when that alone resolves the violation, so this case is repaired for free.
test('a paragraph-order inversion in an image layout is repaired via whole-page reordering, with zero retries', async () => {
  const plan = {
    candidate_id: 'candidate_1',
    style: 'Editorial',
    output_unit: 'spread',
    layout_family: 'balanced',
    layout_purpose: 'case_analysis',
    image_hierarchy: 'hero_support',
    image_text_relation: 'text_explains_image',
    composition_strategy: 'image_left_text_right',
    base_pattern_reference: 'x',
    layout_intent: 'x',
    design_sequence: [{ step: 1, decision_type: 'x', value: 'x', reason: 'x' }],
    grid: { columns: 4, rows: 12 },
    grid_spec: { columns: 4, rows: 12, gutter_mm: 4, page_size: 'A5', grid_mode: 'flexible' },
    pages: [
      { page: 1, elements: [{ id: 'image_1', type: 'image', role: 'hero', col_start: 1, col_span: 4, row_start: 1, row_span: 12, fit: 'contain', object_position: 'center', bleed: 'full' }] },
      { page: 2, elements: [{ id: 'p2_body', type: 'text', role: 'body', text_source: 'paragraph_2', col_start: 1, col_span: 4, row_start: 1, row_span: 4 }] },
      { page: 3, elements: [{ id: 'p1_body', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 4, row_start: 1, row_span: 4 }] },
    ],
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    reason: 'x',
  }
  const client = queueClient([{ response: textResponse({ candidates: [plan] }) }])

  const result = await callLayoutLLM(
    { promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1, textBlocks: [{ char_count: 20 }, { char_count: 20 }] },
    { apiKey: 'sk-fake', mockMode: false, client },
  )

  assert.equal(result.fallbackUsed, false)
  assert.equal(result.candidates.length, 1)
  assert.equal(result.retryCount, 0)
  assert.equal(result.candidates[0].validation.passed, true)
})
// Regression: when every candidate keeps failing validation even after repair + retry, the caller
// used to get zero candidates and had to hard-fail with no output -- wasting the API spend that
// already happened for genuinely LLM-reasoned (not template) candidates that just have a residual
// geometry issue. Surface the least-broken one as bestEffortCandidate so the caller can render it.
test('surfaces the least-broken candidate as bestEffortCandidate when nothing fully passes', async () => {
  const worseCandidate = validPlan('candidate_1')
  worseCandidate.style = 'Noir' // unrepairable enum issue -- 1 issue
  const betterAttemptStillBroken = validPlan('candidate_1')
  betterAttemptStillBroken.style = 'Noir' // still broken after retry too -- 1 issue

  const client = queueClient([
    { response: textResponse({ candidates: [worseCandidate] }) },
    { response: textResponse({ candidates: [betterAttemptStillBroken] }) },
  ])
  const result = await callLayoutLLM({ promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1 }, { apiKey: 'sk-fake', mockMode: false, client })

  assert.equal(result.fallbackUsed, true)
  assert.ok(result.bestEffortCandidate, 'must surface a best-effort candidate instead of nothing')
  assert.equal(result.bestEffortCandidate.validation.passed, false)
  assert.ok(result.bestEffortCandidate.plan, 'best-effort candidate must include a renderable plan')
})

// Regression: reproduces the exact real-world 4-way overlap tangle (image_2, p4_body, p5_body,
// p8_label all mutually colliding on one page) end-to-end through callLayoutLLM, proving the new
// enforceGridOccupancy backstop resolves it with zero LLM retries -- no more whack-a-mole where
// fixing one pair's overlap surfaces a new one elsewhere.
test('a 4-way mutual overlap tangle is fully resolved locally via the grid-occupancy backstop, with zero retries', async () => {
  const plan = {
    candidate_id: 'candidate_1',
    style: 'Editorial',
    output_unit: 'spread',
    layout_family: 'balanced',
    layout_purpose: 'editorial_reading',
    image_hierarchy: 'hero_support',
    image_text_relation: 'image_sets_mood',
    composition_strategy: 'image_left_text_right',
    base_pattern_reference: 'x',
    layout_intent: 'x',
    design_sequence: [{
      step: 1, decision_type: 'x', value: 'x', reason: 'x',
    }],
    grid: { columns: 6, rows: 12 },
    grid_spec: {
      columns: 6, rows: 12, gutter_mm: 4, page_size: 'A5', grid_mode: 'flexible',
    },
    pages: [
      {
        page: 1,
        elements: [
          {
            id: 'image_1', type: 'image', role: 'support', col_start: 1, col_span: 3, row_start: 1, row_span: 5, fit: 'contain',
          },
          {
            id: 'p1_body', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 2, col_span: 3, row_start: 2, row_span: 4,
          },
          {
            id: 'p2_body', type: 'text', role: 'body', text_source: 'paragraph_2', col_start: 1, col_span: 3, row_start: 4, row_span: 4,
          },
          {
            id: 'p3_label', type: 'text', role: 'section_label', text_source: 'paragraph_3', col_start: 2, col_span: 3, row_start: 3, row_span: 3,
          },
        ],
      },
    ],
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    reason: 'x',
  }
  const textBlocks = [
    { id: 'p1', char_count: 40 },
    { id: 'p2', char_count: 40 },
    { id: 'p3', char_count: 20 },
  ]

  const client = queueClient([{ response: textResponse({ candidates: [plan] }) }])
  const result = await callLayoutLLM(
    { promptContext: { inputMetadata: { image_count: 1 } }, imageCount: 1, textBlocks },
    { apiKey: 'sk-fake', mockMode: false, client },
  )

  assert.equal(result.fallbackUsed, false, `expected the grid-occupancy backstop to fully resolve the tangle; got: ${JSON.stringify(result.rejectedCandidates?.[0]?.validation?.issues)}`)
  assert.equal(result.retryCount, 0, 'must resolve locally, no LLM retry needed')
  assert.equal(client.calls.length, 1)
  assert.equal(result.candidates[0].validation.passed, true)
})
