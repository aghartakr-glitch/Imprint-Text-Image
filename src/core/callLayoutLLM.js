import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { SYSTEM_PROMPT, buildUserPrompt } from './buildLayoutPrompt.js'
import { validateLayoutPlan } from './validateLayoutPlan.js'
import { repairLayoutPlan } from './repairLayoutPlan.js'
import { buildFallbackLayoutPlan } from './fallbackLayoutPlan.js'
import { sampleFewShot } from './layoutDataset.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PATTERN_LIBRARY_PATH = join(__dirname, '..', 'data', 'imprint_pattern_library_v0.2.json')
const MODEL = 'claude-sonnet-4-6'
const MAX_RETRIES = 2 // total attempts = 1 initial + up to 2 retries, per spec section 10

let cachedPatternLibrary = null
function loadPatternLibrarySummary() {
  if (!cachedPatternLibrary) {
    cachedPatternLibrary = JSON.parse(readFileSync(PATTERN_LIBRARY_PATH, 'utf-8')).patterns
  }
  return cachedPatternLibrary
}

function extractText(response) {
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
}

function buildFallbackResult({
  imageCount, textDensity, reason, retryCount,
}) {
  return {
    plan: buildFallbackLayoutPlan({ imageCount, textDensity }),
    source: 'fallback',
    retryCount,
    fallbackUsed: true,
    repairAttempted: false,
    validation: { passed: true, issues: [] },
    fallbackReason: reason,
  }
}

// Orchestrates the full spec section 10 flow: call the LLM, validate the plan, attempt a safe
// repair if it fails, retry with the validation errors fed back (max MAX_RETRIES times), and
// fall back to a deterministic plan if nothing else works. Never throws -- always returns a
// usable layout_plan plus a full audit trail for generation-log.json.
export async function callLayoutLLM({ inputMetadata, imageCount, textDensity }, options = {}) {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY
  const mockMode = options.mockMode ?? process.env.MOCK_MODE === 'true'

  if (!apiKey || mockMode) {
    return buildFallbackResult({
      imageCount, textDensity, reason: 'mock 모드 또는 API 키 없음', retryCount: 0,
    })
  }

  const client = options.client ?? new Anthropic({ apiKey })
  const patternLibrarySummary = loadPatternLibrarySummary()
  const fewShotSamples = sampleFewShot()

  let validationErrors = null
  let repairAttempted = false

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let rawPlan
    try {
      const userPrompt = buildUserPrompt({
        inputMetadata, patternLibrarySummary, fewShotSamples, validationErrors,
      })
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      })
      rawPlan = JSON.parse(extractText(response).trim())
    } catch (err) {
      validationErrors = [`LLM 요청/JSON 파싱 실패: ${String(err?.message ?? err)}`]
      if (attempt >= MAX_RETRIES) {
        return buildFallbackResult({
          imageCount, textDensity, reason: validationErrors[0], retryCount: attempt,
        })
      }
      continue // eslint-disable-line no-continue
    }

    let result = validateLayoutPlan(rawPlan, { imageCount })
    let planToUse = rawPlan

    if (!result.passed) {
      const { plan: repaired, repaired: didRepair } = repairLayoutPlan(rawPlan)
      if (didRepair) {
        repairAttempted = true
        const revalidated = validateLayoutPlan(repaired, { imageCount })
        if (revalidated.passed) {
          planToUse = repaired
          result = revalidated
        }
      }
    }

    if (result.passed) {
      return {
        plan: planToUse,
        source: attempt === 0 ? 'llm' : 'llm-retry',
        retryCount: attempt,
        fallbackUsed: false,
        repairAttempted,
        validation: result,
      }
    }

    validationErrors = result.issues
    if (attempt >= MAX_RETRIES) {
      return buildFallbackResult({
        imageCount,
        textDensity,
        reason: `검증 실패 (재시도 ${attempt}회 후): ${result.issues.join('; ')}`,
        retryCount: attempt,
      })
    }
  }

  // Unreachable (the loop above always returns), kept only as a defensive last resort.
  return buildFallbackResult({
    imageCount, textDensity, reason: '알 수 없는 오류', retryCount: MAX_RETRIES,
  })
}
