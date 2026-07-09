import Anthropic from '@anthropic-ai/sdk'
import { SYSTEM_PROMPT, buildUserPrompt } from './buildLayoutPrompt.js'
import { buildRetryPrompt } from './buildRetryPrompt.js'
import { createLayoutCostBudget } from './layoutCostBudget.js'

const MODEL = 'claude-sonnet-4-6'

function extractText(response) {
  if (!response?.content || !Array.isArray(response.content)) {
    throw new Error(`Invalid response structure: response.content is ${typeof response?.content}`)
  }
  const textParts = response.content.filter((b) => b.type === 'text').map((b) => b.text)
  if (!Array.isArray(textParts)) {
    throw new Error('Failed to extract text parts from response')
  }
  return textParts.join('')
}

// Phase 5-3's 7-step reasoning output (content_understanding + image_analysis +
// inferred_image_text_relations + reference_principles + grid_interpretation +
// layout_strategy_reasoning + >=3 candidates with full pages/layout_signature) is much larger
// than the old candidates-only output. 1600 tokens truncated real responses mid-string at ~2700
// chars (confirmed 2026-07-09). 8000 gives real headroom for the full structured output.
const MAX_OUTPUT_TOKENS = 8000
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

  // Extract and clean JSON (remove markdown code blocks if present)
  let text = extractText(response).trim()

  // Remove markdown code blocks: ```json...``` or ```...```
  const codeBlockMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/)
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim()
  }

  console.log('[LLM Response cleaned]', text.substring(0, 100) + '...')

  try {
    return JSON.parse(text)
  } catch (parseErr) {
    // Log position of error for debugging
    console.error(`[JSON Parse Error at position ${parseErr.message.match(/position (\d+)/) ? parseErr.message.match(/position (\d+)/)[1] : '?'}]`)
    console.error('[LLM Raw Response]', text.substring(0, 500) + '...')
    throw parseErr
  }
}

// Phase 5-3: LLM performs 7-step content understanding + layout reasoning
// Returns full reasoning output including content_understanding, image_analysis, layout_strategy, etc.
// NOT just the candidates array (old approach).
export async function generateLayoutCandidates(promptContext, options = {}) {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey })
  const userPrompt = buildUserPrompt(promptContext)
  const parsed = await callModel(client, userPrompt, options)

  // Validate structure
  if (!Array.isArray(parsed.candidates) || parsed.candidates.length === 0) {
    throw new Error('LLM 응답에 candidates 배열이 없거나 비어있습니다')
  }

  // Phase 5-3: Return full LLM output (content understanding + candidates)
  // NOT just candidates[]
  return {
    content_understanding: parsed.content_understanding || null,
    image_analysis: parsed.image_analysis || [],
    inferred_image_text_relations: parsed.inferred_image_text_relations || [],
    reference_principles: parsed.reference_principles || null,
    grid_interpretation: parsed.grid_interpretation || null,
    layout_strategy_reasoning: parsed.layout_strategy_reasoning || null,
    candidates: parsed.candidates,
  }
}

// Spec section 17: a focused single-candidate re-ask carrying the previous failure forward.
export async function retryLayoutCandidate({ inputMetadata, failedLayoutPlan, validationErrors }, options = {}) {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey })
  const retryPrompt = buildRetryPrompt({ inputMetadata, failedLayoutPlan, validationErrors })
  return callModel(client, retryPrompt, options)
}
