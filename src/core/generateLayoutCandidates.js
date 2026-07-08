import Anthropic from '@anthropic-ai/sdk'
import { SYSTEM_PROMPT, buildUserPrompt } from './buildLayoutPrompt.js'
import { buildRetryPrompt } from './buildRetryPrompt.js'

const MODEL = 'claude-sonnet-4-6'

function extractText(response) {
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
}

async function callModel(client, userPromptContent) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPromptContent }],
  })
  return JSON.parse(extractText(response).trim())
}

// Spec section 8: one LLM call asking for N (default 3) distinct candidate layout_plans in a
// single JSON response -- not N separate calls. Returns the raw `candidates` array (unvalidated;
// callLayoutLLM.js is responsible for validating/repairing/scoring each one).
export async function generateLayoutCandidates(promptContext, options = {}) {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey })
  const userPrompt = buildUserPrompt(promptContext)
  const parsed = await callModel(client, userPrompt)
  if (!Array.isArray(parsed.candidates) || parsed.candidates.length === 0) {
    throw new Error('candidates 배열이 비어 있거나 없습니다')
  }
  return parsed.candidates
}

// Spec section 17: a focused single-candidate re-ask carrying the previous failure forward.
export async function retryLayoutCandidate({ inputMetadata, failedLayoutPlan, validationErrors }, options = {}) {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey })
  const retryPrompt = buildRetryPrompt({ inputMetadata, failedLayoutPlan, validationErrors })
  return callModel(client, retryPrompt)
}
