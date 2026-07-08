import Anthropic from '@anthropic-ai/sdk'
import { generateLayoutCandidates } from './generateLayoutCandidates.js'
import { validateLayoutPlan } from './validateLayoutPlan.js'
import { repairLayoutPlan } from './repairLayoutPlan.js'

const MAX_RETRIES = 2 // total attempts = 1 initial + up to 2 retries, per spec section 10/17

function processCandidate(rawPlan, index, imageCount) {
  const candidateId = rawPlan?.candidate_id || `candidate_${index + 1}`
  let result = validateLayoutPlan(rawPlan, { imageCount })
  let planToUse = rawPlan
  let repaired = false

  if (!result.passed) {
    const { plan: repairedPlan, repaired: didRepair } = repairLayoutPlan(rawPlan)
    if (didRepair) {
      const revalidated = validateLayoutPlan(repairedPlan, { imageCount })
      if (revalidated.passed) {
        planToUse = repairedPlan
        result = revalidated
        repaired = true
      }
    }
  }

  return {
    candidateId, plan: planToUse, validation: result, repaired,
  }
}

// Spec section 8.3: ask the LLM for N candidates in one call, validate/repair each individually
// (never a per-candidate API retry -- repair is local and free), and only re-ask the LLM (as a
// full batch regeneration, up to MAX_RETRIES times) if *none* of the candidates end up valid.
// Never throws: returns fallbackUsed=true with an empty candidates array when nothing works,
// leaving the deterministic fallback plan to the caller (runGeneration.mjs), which is also
// responsible for reconstructing/refining/scoring -- this module's job stops at "valid plans or
// not."
export async function callLayoutLLM({ promptContext, imageCount }, options = {}) {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY
  const mockMode = options.mockMode ?? process.env.MOCK_MODE === 'true'

  if (!apiKey || mockMode) {
    return {
      candidates: [], rejectedCandidates: [], source: 'fallback', retryCount: 0, fallbackUsed: true, fallbackReason: 'mock 모드 또는 API 키 없음',
    }
  }

  const client = options.client ?? new Anthropic({ apiKey })
  let lastIssues = ['알 수 없는 오류']

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let rawCandidates
    try {
      rawCandidates = await generateLayoutCandidates(promptContext, { client })
    } catch (err) {
      lastIssues = [`LLM 요청/JSON 파싱 실패: ${String(err?.message ?? err)}`]
      if (attempt >= MAX_RETRIES) {
        return {
          candidates: [], rejectedCandidates: [], source: 'fallback', retryCount: attempt, fallbackUsed: true, fallbackReason: lastIssues[0],
        }
      }
      continue // eslint-disable-line no-continue
    }

    const processed = rawCandidates.map((rawPlan, i) => processCandidate(rawPlan, i, imageCount))
    const validCandidates = processed.filter((c) => c.validation.passed)
    const rejectedCandidates = processed.filter((c) => !c.validation.passed)

    if (validCandidates.length > 0) {
      return {
        candidates: validCandidates,
        rejectedCandidates,
        source: attempt === 0 ? 'llm' : 'llm-retry',
        retryCount: attempt,
        fallbackUsed: false,
      }
    }

    lastIssues = processed.flatMap((c) => c.validation.issues)
    if (attempt >= MAX_RETRIES) {
      return {
        candidates: [],
        rejectedCandidates: processed,
        source: 'fallback',
        retryCount: attempt,
        fallbackUsed: true,
        fallbackReason: `모든 후보 검증 실패 (재시도 ${attempt}회 후): ${lastIssues.slice(0, 5).join('; ')}`,
      }
    }
  }

  // Unreachable (the loop above always returns), kept only as a defensive last resort.
  return {
    candidates: [], rejectedCandidates: [], source: 'fallback', retryCount: MAX_RETRIES, fallbackUsed: true, fallbackReason: '알 수 없는 오류',
  }
}
