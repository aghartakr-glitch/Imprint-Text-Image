import Anthropic from '@anthropic-ai/sdk'
import { generateLayoutCandidates } from './generateLayoutCandidates.js'
import { validateLayoutPlan } from './validateLayoutPlan.js'
import { repairLayoutPlan } from './repairLayoutPlan.js'
import { createLayoutCostBudget, LayoutCostBudgetExceeded } from './layoutCostBudget.js'

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

// One real LLM attempt per generation -- no retries. A validation-failure retry still costs a
// full second API call, and if that retry *also* fails (which happens), the user has now paid
// for two wasted attempts on top of the free fallback that gets used anyway. Cheap local repair
// (fit/role/overflow_policy defaults, no API call) still applies before giving up. If the single
// attempt doesn't produce a valid candidate -- for any reason: bad JSON, failed validation, or the
// cost budget itself refusing the call -- this returns fallbackUsed=true immediately and leaves
// the deterministic fallback plan to the caller (runGeneration.mjs). Never throws.
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

  let rawCandidates
  try {
    rawCandidates = await generateLayoutCandidates(promptContext, { client, costBudget })
  } catch (err) {
    const fallbackReason = err instanceof LayoutCostBudgetExceeded
      ? err.message
      : `LLM 요청/JSON 파싱 실패: ${String(err?.message ?? err)}`
    return {
      candidates: [], rejectedCandidates: [], source: 'fallback', retryCount: 0, fallbackUsed: true, fallbackReason, costBudget: costBudget.summary(),
    }
  }

  const processed = rawCandidates.map((rawPlan, i) => processCandidate(rawPlan, i, imageCount))
  const validCandidates = processed.filter((c) => c.validation.passed)
  const rejectedCandidates = processed.filter((c) => !c.validation.passed)

  if (validCandidates.length > 0) {
    return {
      candidates: validCandidates, rejectedCandidates, source: 'llm', retryCount: 0, fallbackUsed: false, costBudget: costBudget.summary(),
    }
  }

  const issues = processed.flatMap((c) => c.validation.issues)
  return {
    candidates: [],
    rejectedCandidates: processed,
    source: 'fallback',
    retryCount: 0,
    fallbackUsed: true,
    fallbackReason: `후보 검증 실패 (재시도 없음, 비용 절약을 위해 바로 폴백): ${issues.slice(0, 5).join('; ')}`,
    costBudget: costBudget.summary(),
  }
}
