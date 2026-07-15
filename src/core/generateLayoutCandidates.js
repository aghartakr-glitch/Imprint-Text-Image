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

// Complex layouts with many images (10+) and long text require more output headroom to avoid
// JSON truncation. 8000 tokens provides safety margin for full layout generation with 4-6 pages.
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

  // Remove markdown code fences: ```json ... ``` or ``` ... ```. Strips the leading and trailing
  // fence independently (rather than one regex anchored end-to-end) so a response truncated by the
  // output token limit -- which has an opening ```json fence but never reaches a closing ``` --
  // still gets its leading fence stripped, surfacing the real "Unexpected end of JSON input" /
  // "Unterminated string" parse error instead of a confusing "Unexpected token '`'" from the
  // untouched fence (confirmed 2026-07-10: this masked a genuine truncation as a markdown-parsing
  // failure).
  text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()

  console.log('[LLM Response cleaned]', text.substring(0, 100) + '...')

  try {
    return JSON.parse(text)
  } catch (parseErr) {
    // A raw (unescaped) newline/tab inside a JSON string value is invalid per the JSON spec and
    // makes JSON.parse throw "Unterminated string in JSON at position N, line M" -- the LLM
    // sometimes emits literal line breaks inside long Korean text fields (reason/layout_intent/etc)
    // instead of the required \n escape (confirmed 2026-07-10: valid-looking JSON failed to parse
    // with the error pointing many "lines" into what should have been single-line JSON). Repair by
    // walking the text and escaping any raw control character found while inside a string, then
    // retry the parse once before giving up.
    const sanitized = escapeRawControlCharsInStrings(text)
    if (sanitized !== text) {
      try {
        return JSON.parse(sanitized)
      } catch (secondErr) {
        console.error('[JSON Parse Error after control-char sanitization]', secondErr.message)
      }
    }

    // "Unexpected non-whitespace character after JSON" means a syntactically complete JSON value
    // was parsed successfully but trailing content follows (the model appended commentary, or
    // emitted a second JSON blob after the first). Extract just the first balanced top-level
    // object/array (tracking string/escape state so braces inside string values don't confuse the
    // scan) and parse that instead of the whole response.
    if (/Unexpected non-whitespace character after JSON/.test(parseErr.message)) {
      const extracted = extractFirstBalancedJsonValue(text)
      if (extracted && extracted !== text) {
        try {
          return JSON.parse(extracted)
        } catch (thirdErr) {
          console.error('[JSON Parse Error after balanced-value extraction]', thirdErr.message)
        }
      }
    }

    // Log position of error for debugging
    console.error(`[JSON Parse Error at position ${parseErr.message.match(/position (\d+)/) ? parseErr.message.match(/position (\d+)/)[1] : '?'}]`)
    console.error('[LLM Raw Response]', text.substring(0, 500) + '...')
    console.error('[LLM Raw Response full length]', text.length)
    throw parseErr
  }
}

// Scans from the first `{` or `[`, tracking nesting depth and string/escape state, and returns the
// substring ending at the matching closing bracket for that first top-level value -- discarding
// anything the model appended afterward (trailing prose, a duplicated second JSON blob, etc).
// Returns null if no balanced value is found (e.g. genuinely truncated mid-object).
export function extractFirstBalancedJsonValue(text) {
  const startIdx = text.search(/[{[]/)
  if (startIdx === -1) return null

  const openChar = text[startIdx]
  const closeChar = openChar === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = startIdx; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === openChar) {
      depth += 1
    } else if (ch === closeChar) {
      depth -= 1
      if (depth === 0) {
        return text.slice(startIdx, i + 1)
      }
    }
  }
  return null
}

// Walks the text tracking whether we're inside a JSON string (toggling on unescaped `"`, skipping
// escaped characters), and replaces any raw newline/carriage-return/tab found while inside a string
// with its escaped form. Characters outside strings (the actual JSON structure/whitespace) are left
// untouched.
function escapeRawControlCharsInStrings(text) {
  let result = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        result += ch
        escaped = false
      } else if (ch === '\\') {
        result += ch
        escaped = true
      } else if (ch === '"') {
        result += ch
        inString = false
      } else if (ch === '\n') {
        result += '\\n'
      } else if (ch === '\r') {
        result += '\\r'
      } else if (ch === '\t') {
        result += '\\t'
      } else {
        result += ch
      }
    } else if (ch === '"') {
      result += ch
      inString = true
    } else {
      result += ch
    }
  }
  return result
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
