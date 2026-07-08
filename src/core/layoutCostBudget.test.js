import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createLayoutCostBudget, estimateTokenCostUsd, MAX_LAYOUT_LLM_SPEND_USD, LayoutCostBudgetExceeded,
} from './layoutCostBudget.js'

function fakeClientWithoutCountTokens() {
  return { messages: {} } // no countTokens -> forces the conservative character-based estimate
}

function fakeClientWithCountTokens(inputTokens) {
  return { messages: { countTokens: async () => ({ input_tokens: inputTokens }) } }
}

test('MAX_LAYOUT_LLM_SPEND_USD is 0.03 (callLayoutLLM.js makes at most one real API call per generation, no retries)', () => {
  assert.equal(MAX_LAYOUT_LLM_SPEND_USD, 0.03)
})

test('a caller-requested maxSpendUsd above the ceiling is clamped down to it, never exceeded', async () => {
  const budget = createLayoutCostBudget({ maxSpendUsd: 999 })
  assert.equal(budget.maxSpendUsd, MAX_LAYOUT_LLM_SPEND_USD)
})

test('a caller-requested maxSpendUsd below the ceiling is honored as-is', () => {
  const budget = createLayoutCostBudget({ maxSpendUsd: 0.01 })
  assert.equal(budget.maxSpendUsd, 0.01)
})

test('planRequest allows a normal-sized request comfortably within the 0.03 ceiling', async () => {
  const budget = createLayoutCostBudget()
  // The no-countTokens fallback path is deliberately pessimistic (roughly 1 char ~= 1 "token",
  // not the real ~4 chars/token) -- "spending less is better than surprise spend" per its own
  // comment -- so use short strings here rather than assuming real tokenization ratios.
  const planned = await budget.planRequest({
    client: fakeClientWithoutCountTokens(),
    model: 'claude-sonnet-4-6',
    system: 'x'.repeat(400),
    userPromptContent: 'y'.repeat(800),
    desiredOutputTokens: 1200,
    minOutputTokens: 500,
  })
  assert.equal(planned.maxOutputTokens, 1200)
  assert.ok(planned.plannedCostUsd < MAX_LAYOUT_LLM_SPEND_USD)
})

test('planRequest throws LayoutCostBudgetExceeded when even the minimum output would blow the budget', async () => {
  const budget = createLayoutCostBudget({ maxSpendUsd: 0.001 }) // tiny budget
  await assert.rejects(
    () => budget.planRequest({
      client: fakeClientWithoutCountTokens(),
      model: 'claude-sonnet-4-6',
      system: 'x'.repeat(4000),
      userPromptContent: 'y'.repeat(8000),
      desiredOutputTokens: 1200,
      minOutputTokens: 500,
    }),
    LayoutCostBudgetExceeded,
  )
})

test('a single typical generation call (real prompt size, real token count) fits comfortably inside the 0.03 ceiling', async () => {
  // callLayoutLLM.js makes exactly one real API call per generation now (no retries), so this is
  // the actual, only call that ever happens in production. Uses the real countTokens path (not
  // the pessimistic character-count fallback) since that's what a real Anthropic client provides.
  const budget = createLayoutCostBudget()
  const planned = await budget.planRequest({
    client: fakeClientWithCountTokens(2950), // matches SYSTEM_PROMPT + a typical full user prompt
    model: 'claude-sonnet-4-6',
    system: 'x'.repeat(3800),
    userPromptContent: 'y'.repeat(8000),
    desiredOutputTokens: 1200,
    minOutputTokens: 500,
  })
  assert.equal(planned.maxOutputTokens, 1200, 'a typical prompt should get the full desired output budget, not a reduced one')
  budget.recordUsage(planned, { input_tokens: 2950, output_tokens: 1200 })
  assert.ok(budget.spentUsd <= MAX_LAYOUT_LLM_SPEND_USD, `total spend ${budget.spentUsd} must never exceed the ${MAX_LAYOUT_LLM_SPEND_USD} ceiling`)
})

test('the budget module still enforces its ceiling across multiple sequential calls in general (a generic capability, even though callLayoutLLM.js only ever makes one call)', async () => {
  const budget = createLayoutCostBudget({ maxSpendUsd: 0.01 })
  const first = await budget.planRequest({
    client: fakeClientWithoutCountTokens(),
    model: 'claude-sonnet-4-6',
    system: 'x'.repeat(400),
    userPromptContent: 'y'.repeat(400),
    desiredOutputTokens: 300,
    minOutputTokens: 100,
  })
  budget.recordUsage(first, { input_tokens: 800, output_tokens: 300 })

  await assert.rejects(
    () => budget.planRequest({
      client: fakeClientWithoutCountTokens(),
      model: 'claude-sonnet-4-6',
      system: 'x'.repeat(400),
      userPromptContent: 'y'.repeat(400),
      desiredOutputTokens: 300,
      minOutputTokens: 100,
    }),
    LayoutCostBudgetExceeded,
    'a second call should be refused once the first has used up most of a tight budget',
  )
})

test('recordUsage throws if actual usage would push total spend past the ceiling', async () => {
  const budget = createLayoutCostBudget({ maxSpendUsd: 0.01 })
  const planned = await budget.planRequest({
    client: fakeClientWithoutCountTokens(),
    model: 'claude-sonnet-4-6',
    system: 'x'.repeat(400),
    userPromptContent: 'y'.repeat(400),
    desiredOutputTokens: 500,
    minOutputTokens: 100,
  })
  assert.throws(() => budget.recordUsage(planned, { input_tokens: 100000, output_tokens: 100000 }), LayoutCostBudgetExceeded)
})

test('estimateTokenCostUsd matches the documented per-million pricing', () => {
  assert.equal(estimateTokenCostUsd({ inputTokens: 1_000_000, outputTokens: 0 }), 3)
  assert.equal(estimateTokenCostUsd({ inputTokens: 0, outputTokens: 1_000_000 }), 15)
})

test('summary() reports max/spent/remaining and never lets remaining go negative', () => {
  const budget = createLayoutCostBudget({ maxSpendUsd: 0.01 })
  const summary = budget.summary()
  assert.equal(summary.max_spend_usd, 0.01)
  assert.equal(summary.spent_usd, 0)
  assert.equal(summary.remaining_usd, 0.01)
})
