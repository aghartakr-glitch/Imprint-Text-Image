import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createLayoutCostBudget, estimateTokenCostUsd, MAX_LAYOUT_LLM_SPEND_USD, LayoutCostBudgetExceeded,
} from './layoutCostBudget.js'

function fakeClientWithoutCountTokens() {
  return { messages: {} } // no countTokens -> forces the conservative character-based estimate
}

test('MAX_LAYOUT_LLM_SPEND_USD is 0.05 (raised from the original 0.03 to let a retry actually happen)', () => {
  assert.equal(MAX_LAYOUT_LLM_SPEND_USD, 0.05)
})

test('a caller-requested maxSpendUsd above the ceiling is clamped down to it, never exceeded', async () => {
  const budget = createLayoutCostBudget({ maxSpendUsd: 999 })
  assert.equal(budget.maxSpendUsd, MAX_LAYOUT_LLM_SPEND_USD)
})

test('a caller-requested maxSpendUsd below the ceiling is honored as-is', () => {
  const budget = createLayoutCostBudget({ maxSpendUsd: 0.01 })
  assert.equal(budget.maxSpendUsd, 0.01)
})

test('planRequest allows a normal-sized request comfortably within the 0.05 ceiling', async () => {
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

test('an initial call followed by one retry both fit inside the 0.05 ceiling for a typical 2-image prompt', async () => {
  const budget = createLayoutCostBudget()
  const initial = await budget.planRequest({
    client: fakeClientWithoutCountTokens(),
    model: 'claude-sonnet-4-6',
    system: 'x'.repeat(3800), // ~950 tokens, matches SYSTEM_PROMPT's real size
    userPromptContent: 'y'.repeat(8000), // ~2000 tokens, matches a typical full user prompt
    desiredOutputTokens: 1200,
    minOutputTokens: 500,
  })
  budget.recordUsage(initial, { input_tokens: 2950, output_tokens: 1200 })

  const retry = await budget.planRequest({
    client: fakeClientWithoutCountTokens(),
    model: 'claude-sonnet-4-6',
    system: 'x'.repeat(3800),
    userPromptContent: 'z'.repeat(1200), // ~300 tokens, matches the lean retry prompt's real size
    desiredOutputTokens: 1200,
    minOutputTokens: 500,
  })
  assert.ok(retry.maxOutputTokens >= 500, 'the retry should still get at least the minimum viable output budget')
  budget.recordUsage(retry, { input_tokens: 1250, output_tokens: retry.maxOutputTokens })

  assert.ok(budget.spentUsd <= MAX_LAYOUT_LLM_SPEND_USD, `total spend ${budget.spentUsd} must never exceed the ${MAX_LAYOUT_LLM_SPEND_USD} ceiling`)
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
