import Anthropic from '@anthropic-ai/sdk'
import { SYSTEM_PROMPT, buildUserPrompt } from './buildLayoutPrompt.js'
import { buildRetryPrompt } from './buildRetryPrompt.js'
import { createLayoutCostBudget } from './layoutCostBudget.js'

const MODEL = 'claude-sonnet-4-6'

function extractText(response) {
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
}

// Output tokens cost 5x input tokens (Claude Sonnet pricing), so this cap is the single biggest
// cost lever. runGeneration.mjs now requests only 1 candidate (down from 3), so this only needs
// to fit one candidate -- 1200 comfortably covers even a 2-page gallery+text plan with 6 images.
// If a response is ever genuinely truncated, JSON.parse throws and the caller (callLayoutLLM.js)
// retries/falls back -- there is no silent-corruption risk from capping this.
const MAX_OUTPUT_TOKENS = 1200
const MIN_OUTPUT_TOKENS = 500

async function callModel(client, userPromptContent, options = {}) {
  const costBudget = options.costBudget ?? createLayoutCostBudget()
  const planned = await costBudget.planRequest({
    client,
    model: MODEL,
    system: SYSTEM_PROMPT,
    userPromptContent,
    desiredOutputTokens: options.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
    minOutputTokens: options.minOutputTokens ?? MIN_OUTPUT_TOKENS,
  })
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: planned.maxOutputTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPromptContent }],
  })
  costBudget.recordUsage(planned, response.usage)
  return JSON.parse(extractText(response).trim())
}

// Spec section 8: one LLM call asking for N distinct candidate layout_plans in a single JSON
// response (N is set by the caller via promptContext.internalCandidateCount; runGeneration.mjs
// currently uses 1 to minimize API cost -- see its own comment for the trade-off). Returns the
// raw `candidates` array (unvalidated; callLayoutLLM.js validates/repairs/scores each one).
export async function generateLayoutCandidates(promptContext, options = {}) {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey })
  const userPrompt = buildUserPrompt(promptContext)
  const parsed = await callModel(client, userPrompt, options)
  if (!Array.isArray(parsed.candidates) || parsed.candidates.length === 0) {
    throw new Error('candidates 배열이 비어 있거나 없습니다')
  }
  return parsed.candidates
}

// Spec section 17: a focused single-candidate re-ask carrying the previous failure forward.
export async function retryLayoutCandidate({ inputMetadata, failedLayoutPlan, validationErrors }, options = {}) {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey })
  const retryPrompt = buildRetryPrompt({ inputMetadata, failedLayoutPlan, validationErrors })
  return callModel(client, retryPrompt, options)
}
