import Anthropic from '@anthropic-ai/sdk'
import { generateLayoutCandidates } from './generateLayoutCandidates.js'
import { validateLayoutPlan } from './validateLayoutPlan.js'
import { repairLayoutPlan } from './repairLayoutPlan.js'
import { normalizeLayoutIntent, packEditorialLayout } from './layout/packEditorialLayout.js'
import { repairGeometryPlan } from './layout/repairGeometryPlan.js'
import { createLayoutCostBudget, LayoutCostBudgetExceeded } from './layoutCostBudget.js'

// New flow: LLM output (editorial intent: groups + reading_flow) -> normalize -> deterministic
// geometry packing -> validate -> local geometry repair (never another API call) -> validate
// again. If a candidate still fails after packing+repair, that is a GEOMETRY failure, not an LLM
// reasoning failure -- the LLM successfully produced groups, the local packer just couldn't fit
// them within collision/gap/capacity constraints. Callers (runGeneration.mjs) use
// `groupsAvailable` to tell the two failure modes apart instead of lumping everything into
// "LLM reasoning failed".
function processCandidate(rawPlan, index, imageCount, promptContext) {
  const candidateId = rawPlan?.candidate_id || `candidate_${index + 1}`
  const groupsAvailable = Array.isArray(rawPlan?.groups) && rawPlan.groups.length > 0
  const hasExplicitGeometry = Array.isArray(rawPlan?.pages) && rawPlan.pages.length > 0
    && rawPlan.pages.every((p) => Array.isArray(p.elements))

  // normalizeLayoutIntent always fills groups: [] when absent, which would otherwise make an
  // already-fully-specified old-schema candidate (pages[].elements[], no groups) look like a
  // group-based one and get needlessly (and destructively) re-packed from an empty groups array.
  // Only normalize+pack when the candidate actually needs packing.
  const packedPlan = (hasExplicitGeometry && !groupsAvailable)
    ? rawPlan
    : packEditorialLayout({
      candidate: normalizeLayoutIntent(rawPlan),
      gridSpec: promptContext?.userGridHint,
      textBlocks: promptContext?.textBlocks,
      imageMetadata: promptContext?.imageMetadata,
      imageCount,
    })

  let result = validateLayoutPlan(packedPlan, { imageCount })
  let planToUse = packedPlan
  let repaired = false

  if (!result.passed) {
    // Local geometry repair (shift/overflow to next page) -- zero API cost, tries first.
    const { plan: geometryRepaired, repaired: didGeometryRepair } = repairGeometryPlan(packedPlan, result.issues)
    let revalidated = didGeometryRepair ? validateLayoutPlan(geometryRepaired, { imageCount }) : result
    let candidateAfterRepair = didGeometryRepair ? geometryRepaired : packedPlan

    // Field-level repair (fit/role/overflow_policy defaults) as a second, cheap local pass.
    if (!revalidated.passed) {
      const { plan: fieldRepaired, repaired: didFieldRepair } = repairLayoutPlan(candidateAfterRepair)
      if (didFieldRepair) {
        const revalidated2 = validateLayoutPlan(fieldRepaired, { imageCount })
        if (revalidated2.passed) {
          candidateAfterRepair = fieldRepaired
          revalidated = revalidated2
        }
      }
    }

    if (revalidated.passed) {
      planToUse = candidateAfterRepair
      result = revalidated
      repaired = true
    } else {
      result = revalidated
      planToUse = candidateAfterRepair
    }
  }

  return {
    candidateId, plan: planToUse, validation: result, repaired, groupsAvailable,
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

  // Mock mode: return mock candidates without calling LLM
  if (mockMode) {
    console.log('[Mock Mode] Returning mock layout candidates')
    return {
      candidates: [
        {
          candidateId: 'mock_candidate_1',
          plan: {
            candidate_id: 'mock_candidate_1',
            composition_strategy: 'flexible_modular_grid',
            layout_family: 'image-first',
            image_hierarchy: 'mixed',
            layout_signature: { images_per_page: [2, 2, 0], text_spans: [2, 3, 4], strategy: 'mock' },
            pages: [],
            reasoning: 'Mock candidate for testing',
          },
          validation: { passed: true, issues: [] },
          repaired: false,
        },
      ],
      rejectedCandidates: [],
      source: 'mock',
      retryCount: 0,
      fallbackUsed: false,
      errorType: null,
      content_understanding: null,
      image_analysis: [],
      inferred_image_text_relations: [],
      reference_principles: null,
      layout_strategy_reasoning: null,
    }
  }

  if (!apiKey) {
    return {
      candidates: [], rejectedCandidates: [], source: 'fallback', retryCount: 0, fallbackUsed: true, errorType: 'LLM_NO_API_KEY', fallbackReason: 'API 키 없음',
    }
  }

  const client = options.client ?? new Anthropic({ apiKey })
  const costBudget = options.costBudget ?? createLayoutCostBudget({ maxSpendUsd: options.maxSpendUsd })

  let llmOutput
  try {
    llmOutput = await generateLayoutCandidates(promptContext, { client, costBudget })
  } catch (err) {
    const isBudget = err instanceof LayoutCostBudgetExceeded
    const fallbackReason = isBudget
      ? err.message
      : `LLM 요청/JSON 파싱 실패: ${String(err?.message ?? err)}`
    return {
      candidates: [],
      rejectedCandidates: [],
      source: 'fallback',
      retryCount: 0,
      fallbackUsed: true,
      errorType: isBudget ? 'LLM_COST_BUDGET_EXCEEDED' : 'LLM_JSON_PARSE_FAILED',
      fallbackReason,
      costBudget: costBudget.summary(),
      content_understanding: null,
      image_analysis: [],
      inferred_image_text_relations: [],
      reference_principles: null,
      layout_strategy_reasoning: null,
    }
  }

  const rawCandidates = llmOutput.candidates || []
  if (rawCandidates.length === 0) {
    return {
      candidates: [],
      rejectedCandidates: [],
      source: 'fallback',
      retryCount: 0,
      fallbackUsed: true,
      errorType: 'LLM_REASONING_MISSING',
      fallbackReason: 'LLM 응답에 candidates 배열이 없거나 비어있습니다',
      costBudget: costBudget.summary(),
    }
  }

  const processed = rawCandidates.map((rawPlan, i) => processCandidate(rawPlan, i, imageCount, promptContext))
  const validCandidates = processed.filter((c) => c.validation.passed)
  const rejectedCandidates = processed.filter((c) => !c.validation.passed)

  if (validCandidates.length > 0) {
    return {
      candidates: validCandidates,
      rejectedCandidates,
      source: 'llm',
      retryCount: 0,
      fallbackUsed: false,
      errorType: null,
      content_understanding: llmOutput.content_understanding,
      image_analysis: llmOutput.image_analysis,
      inferred_image_text_relations: llmOutput.inferred_image_text_relations,
      reference_principles: llmOutput.reference_principles,
      layout_strategy_reasoning: llmOutput.layout_strategy_reasoning,
    }
  }

  // Every candidate had groups (LLM reasoning succeeded) but still failed after packing+repair --
  // this is a geometry failure, not an LLM reasoning failure.
  const allHadGroups = processed.every((c) => c.groupsAvailable)
  const issues = processed.flatMap((c) => c.validation.issues)
  return {
    candidates: [],
    rejectedCandidates: processed,
    source: 'fallback',
    retryCount: 0,
    fallbackUsed: true,
    errorType: allHadGroups ? 'GEOMETRY_PACKING_FAILED' : 'LLM_SCHEMA_FAILED',
    fallbackReason: `${allHadGroups ? '지오메트리 패킹 실패' : '후보 스키마 검증 실패'} (재시도 없음, 로컬 repair 이후에도 실패): ${issues.slice(0, 5).join('; ')}`,
    costBudget: costBudget.summary(),
    content_understanding: llmOutput?.content_understanding || null,
    image_analysis: llmOutput?.image_analysis || [],
    inferred_image_text_relations: llmOutput?.inferred_image_text_relations || [],
    reference_principles: llmOutput?.reference_principles || null,
    layout_strategy_reasoning: llmOutput?.layout_strategy_reasoning || null,
  }
}
