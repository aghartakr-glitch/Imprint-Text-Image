import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateLayoutCandidates, retryLayoutCandidate } from './generateLayoutCandidates.js'

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
