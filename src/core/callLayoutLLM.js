import Anthropic from '@anthropic-ai/sdk'
import { generateLayoutCandidates, retryLayoutCandidate } from './generateLayoutCandidates.js'
import { validateLayoutPlan } from './validateLayoutPlan.js'
import { repairLayoutPlan } from './repairLayoutPlan.js'
import { createLayoutCostBudget, LayoutCostBudgetExceeded } from './layoutCostBudget.js'

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

// Spec section 8.3: ask the LLM for N candidates in one (expensive, full-context) call, validate/
// repair each individually (repair is local and free, never an API call). If none end up valid,
// retry -- but a retry uses buildRetryPrompt's *lean* single-candidate prompt (just the input
// metadata + the one failed plan + its errors), NOT another full re-ask with the entire pattern
// library/retrieved references/schema example resent. That distinction is the whole point of
// having a separate retry template (spec section 17): re-sending the full prompt on every retry
// was silently tripling the per-generation cost on any validation failure. Never throws: returns
// fallbackUsed=true with an empty candidates array when nothing works, leaving the deterministic
// fallback plan to the caller (runGeneration.mjs).
export async function callLayoutLLM({ promptContext, imageCount }, options = {}) {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY
  const mockMode = options.mockMode ?? process.env.MOCK_MODE === 'true'

  if (!apiKey || mockMode) {
    return {
      candidates: [], rejectedCandidates: [], source: 'fallback', retryCount: 0, fallbackUsed: true, fallbackReason: 'mock 모드 또는 API 키 없음',
    }
  }

  const client = options.client ?? new Anthropic({ apiKey })
  const costBudget = options.costBudget ?? createLayoutCostBudget({ maxSpendUsd: options.maxSpendUsd })
  let lastIssues = ['알 수 없는 오류']
  let lastFailedPlan = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let rawCandidates
    try {
      if (attempt === 0) {
        rawCandidates = await generateLayoutCandidates(promptContext, { client, costBudget })
      } else {
        // Lean retry: one small prompt (input metadata + previous failure), not the full context.
        const retried = await retryLayoutCandidate(
          { inputMetadata: promptContext.inputMetadata, failedLayoutPlan: lastFailedPlan, validationErrors: lastIssues },
          { client, costBudget },
        )
        rawCandidates = [retried]
      }
    } catch (err) {
      lastIssues = [`LLM 요청/JSON 파싱 실패: ${String(err?.message ?? err)}`]
      if (err instanceof LayoutCostBudgetExceeded) {
        return {
          candidates: [],
          rejectedCandidates: [],
          source: 'fallback',
          retryCount: attempt,
          fallbackUsed: true,
          fallbackReason: err.message,
          costBudget: costBudget.summary(),
        }
      }
      if (attempt >= MAX_RETRIES) {
        return {
          candidates: [], rejectedCandidates: [], source: 'fallback', retryCount: attempt, fallbackUsed: true, fallbackReason: lastIssues[0], costBudget: costBudget.summary(),
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
        costBudget: costBudget.summary(),
      }
    }

    lastIssues = processed.flatMap((c) => c.validation.issues)
    lastFailedPlan = processed[0]?.plan ?? rawCandidates[0] ?? null
    if (attempt >= MAX_RETRIES) {
      return {
        candidates: [],
        rejectedCandidates: processed,
        source: 'fallback',
        retryCount: attempt,
        fallbackUsed: true,
        fallbackReason: `모든 후보 검증 실패 (재시도 ${attempt}회 후): ${lastIssues.slice(0, 5).join('; ')}`,
        costBudget: costBudget.summary(),
      }
    }
  }

  // Unreachable (the loop above always returns), kept only as a defensive last resort.
  return {
    candidates: [], rejectedCandidates: [], source: 'fallback', retryCount: MAX_RETRIES, fallbackUsed: true, fallbackReason: '알 수 없는 오류',
  }
}
