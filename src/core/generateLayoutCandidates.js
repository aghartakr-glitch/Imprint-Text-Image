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

// Prompt caching (opt-in, OFF by default): SYSTEM_PROMPT is 100% static across every call in this
// module (initial candidate call, retry call, and across separate generations by the same user
// within Anthropic's cache TTL), so it's a good caching candidate -- but this has never been
// exercised against the real API (this repo's policy for this change was "no real API calls"), so
// it must not silently change the default request shape. Pass { enablePromptCaching: true } to opt
// in once this has been verified against a real account; until then every caller gets the exact
// same plain-string `system` request it always has.
function buildSystemParam(enablePromptCaching) {
  if (!enablePromptCaching) return SYSTEM_PROMPT
  return [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }]
}

async function callModel(client, userPromptContent, options = {}) {
  const costBudget = options.costBudget ?? createLayoutCostBudget()
  const systemParam = buildSystemParam(options.enablePromptCaching)
  const planned = await costBudget.planRequest({
    client,
    model: MODEL,
    system: systemParam,
    userPromptContent,
    desiredOutputTokens: options.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
    minOutputTokens: options.minOutputTokens ?? MIN_OUTPUT_TOKENS,
  })
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: planned.maxOutputTokens,
    system: systemParam,
    messages: [{ role: 'user', content: userPromptContent }],
  })
  costBudget.recordUsage(planned, response.usage)

  // Check for truncation FIRST, before any text processing -- the Anthropic API reports this
  // directly via stop_reason: 'max_tokens' means the response was cut off mid-generation, so the
  // JSON is not malformed, it is genuinely incomplete (data is missing, not just wrongly escaped).
  // No string-repair heuristic below can ever fix this correctly (confirmed 2026-07-27: two
  // different real generations hit this and were mis-diagnosed by generic parse-error messages --
  // "Expected double-quoted property name" and "Unterminated string in JSON at position 19031,
  // line 713" -- both consistent with the response simply running out of token budget on a large,
  // many-page document, not a formatting quirk). Fail fast with a distinct, actionable error
  // instead of spending time on repair attempts that can't succeed and produce a misleading
  // generic "JSON parse error" message.
  if (response.stop_reason === 'max_tokens') {
    throw new JsonTruncatedError(
      `LLM 응답이 max_tokens(${planned.maxOutputTokens}) 제한으로 잘렸습니다 (JSON 오류가 아니라 응답이 도중에 끊긴 것입니다). `
      + '문서가 너무 크거나(페이지/이미지/텍스트가 많음) 후보 수가 많을 때 발생합니다.',
      { maxOutputTokens: planned.maxOutputTokens, usage: response.usage },
    )
  }

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

  return parseJsonWithRepairs(text)
}

// Ordered pipeline of independent, narrowly-scoped repair strategies for known classes of
// near-valid-but-not-quite JSON the model has been observed to emit. Each strategy is tried only
// when its associated error message pattern matches (cheap: avoids running string-walking repairs
// that can't possibly apply), and only ever RE-PARSES its own repaired text -- a strategy that
// doesn't change the text (e.g. nothing to repair) is skipped rather than retried pointlessly.
// Genuine truncation (stop_reason: 'max_tokens') is intercepted before this function is ever
// called (see callModel above) -- everything reaching here is assumed to be a complete response
// that simply isn't syntactically valid JSON yet.
const REPAIR_STRATEGIES = [
  {
    name: 'control-char-sanitization',
    // A raw (unescaped) newline/tab inside a JSON string value is invalid per the JSON spec and
    // makes JSON.parse throw "Unterminated string in JSON at position N, line M" -- the LLM
    // sometimes emits literal line breaks inside long Korean text fields (reason/layout_intent/etc)
    // instead of the required \n escape (confirmed 2026-07-10). Tried unconditionally (cheap, and
    // matches on multiple different resulting error messages depending on what follows the raw
    // newline), not gated on a specific error message pattern.
    matches: () => true,
    repair: escapeRawControlCharsInStrings,
  },
  {
    name: 'trailing-comma-removal',
    // "Expected double-quoted property name" (or "Unexpected token '}'"/"']'" in older V8) means a
    // trailing comma was left before a closing `}`/`]` -- valid in JS object/array literals but not
    // in JSON (confirmed 2026-07-27: real generation failure at a page/element array boundary).
    matches: (message) => /Expected double-quoted property name|Unexpected token '?[}\]]/.test(message),
    repair: removeTrailingCommas,
  },
  {
    name: 'balanced-value-extraction',
    // "Unexpected non-whitespace character after JSON" means a syntactically complete JSON value
    // was parsed successfully but trailing content follows (the model appended commentary, or
    // emitted a second JSON blob after the first).
    matches: (message) => /Unexpected non-whitespace character after JSON/.test(message),
    repair: extractFirstBalancedJsonValue,
  },
]

function parseJsonWithRepairs(text) {
  try {
    return JSON.parse(text)
  } catch (firstErr) {
    for (const strategy of REPAIR_STRATEGIES) {
      if (!strategy.matches(firstErr.message)) continue // eslint-disable-line no-continue
      const repaired = strategy.repair(text)
      if (repaired == null || repaired === text) continue // eslint-disable-line no-continue -- nothing to try
      try {
        return JSON.parse(repaired)
      } catch (repairErr) {
        console.error(`[JSON Parse Error after ${strategy.name}]`, repairErr.message)
      }
    }

    // Log position of error for debugging
    console.error(`[JSON Parse Error at position ${firstErr.message.match(/position (\d+)/) ? firstErr.message.match(/position (\d+)/)[1] : '?'}]`)
    console.error('[LLM Raw Response]', text.substring(0, 500) + '...')
    console.error('[LLM Raw Response full length]', text.length)
    throw firstErr
  }
}

// Distinct error type for genuine output-token truncation (see the stop_reason check above) so
// callers can tell "the response was too big for the token budget" apart from "the response was a
// complete but malformed JSON blob" -- the two need different fixes (raise max_tokens / shrink the
// document vs. a parsing bug) and were previously indistinguishable generic Error instances.
export class JsonTruncatedError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'JsonTruncatedError'
    this.details = details
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

// Walks the text tracking string/escape state (so a literal ",}" inside a string value is never
// touched) and drops any comma that is followed by nothing but whitespace and then a `}` or `]` --
// a trailing comma, valid in a JS object/array literal but not in JSON.
export function removeTrailingCommas(text) {
  let result = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      result += ch
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
      result += ch
      continue
    }
    if (ch === ',') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j += 1
      if (text[j] === '}' || text[j] === ']') continue // eslint-disable-line no-continue -- drop this comma
    }
    result += ch
  }
  return result
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
