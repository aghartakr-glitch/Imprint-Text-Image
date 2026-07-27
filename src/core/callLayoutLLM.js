import Anthropic from '@anthropic-ai/sdk'
import { generateLayoutCandidates } from './generateLayoutCandidates.js'
import { validateLayoutPlan } from './validateLayoutPlan.js'
import { normalizeLayoutPlan } from './normalizeLayoutPlan.js'
import { repairLayoutPlan } from './repairLayoutPlan.js'
import { repairTextOverflow } from './validation/repairTextOverflow.js'
import { repairParagraphOrder } from './validation/repairParagraphOrder.js'
import { compactOversizedTextSpans } from './validation/compactOversizedTextSpans.js'
import { repairCollisions } from './validation/repairCollisions.js'
import { enforceGridOccupancy } from './validation/enforceGridOccupancy.js'
import { validateAndFixLayoutMm } from './validation/validateAndFixLayoutMm.js'
import { createLayoutCostBudget, LayoutCostBudgetExceeded } from './layoutCostBudget.js'
import { writeDebugStage, summarizePlan } from '../../server/debugDump.mjs'

// A compact per-element digest (id/type/text_source/grid position) instead of the full plan --
// enough for the model to locate what it placed without re-sending every field (style, reasoning,
// design_sequence, etc.) it already got right.
function summarizeFailedPlan(plan) {
  const pages = Array.isArray(plan?.pages) ? plan.pages : []
  return {
    composition_strategy: plan?.composition_strategy,
    grid_spec: plan?.grid_spec,
    pages: pages.map((page) => ({
      page: page.page,
      elements: (page.elements || []).map((el) => ({
        id: el.id,
        type: el.type,
        text_source: el.text_source,
        col_start: el.col_start,
        col_span: el.col_span,
        row_start: el.row_start,
        row_span: el.row_span,
      })),
    })),
  }
}

// Local, API-free repair chain, applied in order so each step feeds the next:
//   1. field defaults (fit/role/overflow_policy)          -- repairLayoutPlan
//   2. grow text boxes that overflow their paragraph       -- repairTextOverflow
//   3. shift any now-overlapping elements apart            -- repairCollisions
// Steps 1 and 2 are applied unconditionally (they only ever make the plan more correct); step 3 is
// kept only if the final plan actually passes validation. This lets the LLM be imperfect about box
// sizing/positioning -- the common, deterministic geometry failures get fixed here with no API call.
function processCandidate(rawPlan, index, imageCount, textBlocks, forcedFullBleedImages, allowUnforcedFullBleed) {
  const candidateId = rawPlan?.candidate_id || `candidate_${index + 1}`
  // CRITICAL: normalize enum aliases (e.g. margin_preset "default" -> "recommended") BEFORE the
  // first validation pass, so a schema-legal-in-spirit value never triggers a rejection/retry.
  let candidatePlan = normalizeLayoutPlan(rawPlan)

  // Runs unconditionally, before validation, not gated behind "!candidateResult.passed" like the
  // rest of this chain -- a plan with wastefully oversized text boxes (a single 9-character
  // heading given a 70mm-tall box, confirmed 2026-07-16) passes validation just fine, since nothing
  // there flags a box as too generous, only too small. Only ever shrinks, so it's safe to always
  // attempt: it can't turn a fitting plan into a broken one.
  const { plan: compactedPlan, repaired: didCompact } = compactOversizedTextSpans(candidatePlan, textBlocks)
  if (didCompact) candidatePlan = compactedPlan

  let candidateResult = validateLayoutPlan(candidatePlan, { imageCount, textBlocks, forcedFullBleedImages, allowUnforcedFullBleed })
  let repaired = didCompact

  // Debug instrumentation (first candidate only): capture exactly what the LLM returned, and what
  // normalization changed, before any repair touches it. Pure logging -- no effect on the pipeline.
  if (index === 0) {
    writeDebugStage('01-raw-llm-candidate.json', rawPlan)
    writeDebugStage('01-raw-llm-candidate-summary.json', summarizePlan(rawPlan, 'raw'))
    writeDebugStage('02-normalized-candidate.json', candidatePlan)
    writeDebugStage('02-normalized-candidate-summary.json', summarizePlan(candidatePlan, 'normalized'))
  }

  if (!candidateResult.passed) {
    const { plan: defaultsRepaired, repaired: didRepairDefaults } = repairLayoutPlan(candidatePlan)
    if (didRepairDefaults) candidatePlan = defaultsRepaired

    const { plan: overflowRepaired, repaired: didRepairOverflow } = repairTextOverflow(candidatePlan, textBlocks)
    if (didRepairOverflow) candidatePlan = overflowRepaired

    const { plan: orderRepaired, repaired: didRepairOrder } = repairParagraphOrder(candidatePlan)
    if (didRepairOrder) candidatePlan = orderRepaired

    if (didRepairDefaults || didRepairOverflow || didRepairOrder) {
      candidateResult = validateLayoutPlan(candidatePlan, { imageCount, textBlocks, forcedFullBleedImages, allowUnforcedFullBleed })
      repaired = true
    }

    if (!candidateResult.passed) {
      const { plan: collisionsRepaired, repaired: didRepairCollisions } = repairCollisions(candidatePlan)
      if (didRepairCollisions) {
        const revalidated = validateLayoutPlan(collisionsRepaired, { imageCount, textBlocks, forcedFullBleedImages, allowUnforcedFullBleed })
        // Keep the collision-repaired plan/result whenever it strictly reduces the outstanding
        // issue count, even if it doesn't fully pass -- the plan/result this function returns must
        // always reflect the best state actually achieved, never revert to a stale pre-repair
        // snapshot just because the LAST repair step alone didn't finish the job.
        if (revalidated.issues.length < candidateResult.issues.length) {
          candidatePlan = collisionsRepaired
          candidateResult = revalidated
        }
        repaired = true
      }
    }

    // Final, guaranteed-complete backstop: repairCollisions nudges pairwise and can fail to
    // converge when 3+ elements mutually overlap (confirmed 2026-07-10: real reports of 4-way
    // tangles surviving the pairwise pass). enforceGridOccupancy cannot fail to converge -- it
    // deterministically places every element into a unique free grid cell or a new page, so any
    // overlap still present at this point is eliminated by construction, not by iterative nudging.
    if (!candidateResult.passed) {
      const { plan: occupancyRepaired, repaired: didEnforceOccupancy } = enforceGridOccupancy(candidatePlan)
      if (didEnforceOccupancy) {
        const revalidated = validateLayoutPlan(occupancyRepaired, { imageCount, textBlocks, forcedFullBleedImages, allowUnforcedFullBleed })
        // Compare on collision-issue count specifically, not the raw total. enforceGridOccupancy
        // can push an element onto a new page to free up its cell, which can shift a paragraph's
        // first-appearance page and trip the (unrelated) paragraph-order check -- if that pushes
        // the raw total issue count back up to a tie or worse, the old strict "total issues
        // strictly fewer" comparison discarded a repair that had, in fact, eliminated every
        // overlap it guarantees to eliminate (confirmed 2026-07-27: intermittent hard-fail
        // generations reporting only 겹칩니다/collision messages, on documents complex enough that
        // this backstop should have resolved them). Collisions are the one category this repair
        // step is guaranteed to fix, so judge it on that category.
        const collisionCount = (result) => result.issues.filter((i) => i.includes('겹칩니다')).length
        const oldCollisions = collisionCount(candidateResult)
        const newCollisions = collisionCount(revalidated)
        if (newCollisions < oldCollisions || revalidated.issues.length < candidateResult.issues.length) {
          candidatePlan = occupancyRepaired
          candidateResult = revalidated
        }
        repaired = true
      }
    }

    if (!candidateResult.passed) {
      const { plan: orderRepaired, repaired: didRepairOrder } = repairParagraphOrder(candidatePlan)
      if (didRepairOrder) {
        const revalidated = validateLayoutPlan(orderRepaired, { imageCount, textBlocks, forcedFullBleedImages, allowUnforcedFullBleed })
        if (revalidated.issues.length < candidateResult.issues.length) {
          candidatePlan = orderRepaired
          candidateResult = revalidated
        }
        repaired = true
      }
    }

    // Final mm-coordinate overlap check: grid-based checks can miss actual mm-level overlaps
    // (e.g. image and text both fit in their grid cells but their mm coordinates still overlap).
    // This direct mm-level check detects and fixes those cases by moving text blocks.
    const { plan: mmFixed, fixed: didFixMm } = validateAndFixLayoutMm(candidatePlan)
    if (didFixMm) {
      const revalidated = validateLayoutPlan(mmFixed, { imageCount, textBlocks, forcedFullBleedImages, allowUnforcedFullBleed })
      if (revalidated.issues.length < candidateResult.issues.length) {
        candidatePlan = mmFixed
        candidateResult = revalidated
      }
      repaired = true
    }
  }

  return {
    candidateId, plan: candidatePlan, validation: candidateResult, repaired,
  }
}

// Up to two real LLM attempts per generation. Cheap local repair (fit/role/overflow_policy
// defaults, then collision geometry shifts -- no API call) applies first; only if that still
// doesn't produce a valid candidate does this spend a second real API call, feeding the model its
// own failed plan plus the exact validation issues (buildLayoutPrompt's previousAttemptFeedback)
// so it can target the specific problem instead of blindly regenerating from scratch. If the retry
// also fails -- for any reason: bad JSON, failed validation, or the cost budget refusing the call
// -- this returns fallbackUsed=true and leaves the deterministic fallback plan to the caller
// (runGeneration.mjs). Never throws.
export async function callLayoutLLM({ promptContext, imageCount, textBlocks }, options = {}) {
  const forcedFullBleedImages = promptContext?.userLayoutSettings?.forced_full_bleed_images ?? []
  const allowUnforcedFullBleed = promptContext?.userLayoutSettings?.allow_unforced_full_bleed !== false
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY
  const mockMode = options.mockMode ?? process.env.MOCK_MODE === 'true'

  console.log(`[DEBUG] callLayoutLLM mockMode=${mockMode}, process.env.MOCK_MODE=${process.env.MOCK_MODE}, options.mockMode=${options.mockMode}`)

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
      content_understanding: null,
      image_analysis: [],
      inferred_image_text_relations: [],
      reference_principles: null,
      layout_strategy_reasoning: null,
    }
  }

  if (!apiKey) {
    return {
      candidates: [], rejectedCandidates: [], source: 'fallback', retryCount: 0, fallbackUsed: true, fallbackReason: 'API 키 없음',
    }
  }

  const client = options.client ?? new Anthropic({ apiKey })
  const costBudget = options.costBudget ?? createLayoutCostBudget({ maxSpendUsd: options.maxSpendUsd })

  // Phase 5-3: LLM now returns full reasoning output (content_understanding, image_analysis, etc.)
  // NOT just candidates array
  let llmOutput
  try {
    llmOutput = await generateLayoutCandidates(promptContext, { client, costBudget })
  } catch (err) {
    // Distinct message for genuine output-token truncation (JsonTruncatedError) vs. a cost-budget
    // refusal vs. an actually-malformed response -- these need different fixes (raise max_tokens /
    // shrink the document, wait for budget, or a real parsing bug) and were previously all folded
    // into one generic "JSON 파싱 실패" message that misdiagnosed truncation as a parsing bug
    // (confirmed 2026-07-27: two separate real generations hit this exact confusion).
    let fallbackReason
    if (err instanceof LayoutCostBudgetExceeded) {
      fallbackReason = err.message
    } else if (err?.name === 'JsonTruncatedError') {
      fallbackReason = `LLM 응답 잘림: ${err.message}`
    } else {
      fallbackReason = `LLM 요청/JSON 파싱 실패: ${String(err?.message ?? err)}`
    }
    return {
      candidates: [], rejectedCandidates: [], source: 'fallback', retryCount: 0, fallbackUsed: true, fallbackReason, costBudget: costBudget.summary(),
      // Phase 5-3: Include empty content understanding fields for consistency
      content_understanding: null,
      image_analysis: [],
      inferred_image_text_relations: [],
      reference_principles: null,
      layout_strategy_reasoning: null,
    }
  }

  // Extract candidates from llmOutput
  const rawCandidates = llmOutput.candidates || []
  let processed = rawCandidates.map((rawPlan, i) => processCandidate(rawPlan, i, imageCount, textBlocks, forcedFullBleedImages, allowUnforcedFullBleed))
  let validCandidates = processed.filter((c) => c.validation.passed)
  let rejectedCandidates = processed.filter((c) => !c.validation.passed)
  let retryCount = 0

  // A second real API call here would silently double the spend for a single generation with no
  // visibility to the user (confirmed 2026-07-10: this is exactly the invisible-cost complaint that
  // prompted removing it). It's also far less necessary now: enforceGridOccupancy guarantees any
  // geometry issue (the vast majority of what used to trigger a retry) is resolved locally with zero
  // API cost, and bestEffortCandidate below already renders the least-broken candidate instead of
  // hard-failing when something genuinely unrepairable slips through (e.g. an invalid enum value).
  // Opt in explicitly per call via { allowRetry: true } if a future caller wants it back.
  if (validCandidates.length === 0 && processed.length > 0 && options.allowRetry) {
    retryCount = 1
    try {
      // Ask for exactly 1 corrected candidate (not the usual 3) and summarize the failed plan
      // instead of echoing it back verbatim -- both shrink the retry's prompt/expected-output size,
      // which lowers the risk of the response getting cut off mid-JSON by the output token limit
      // (confirmed 2026-07-10: a full previous-plan echo plus a fresh 3-candidate request produced
      // a truncated, unparseable retry response).
      const retryContext = {
        ...promptContext,
        internalCandidateCount: 1,
        previousAttemptFeedback: {
          failedPlanSummary: summarizeFailedPlan(processed[0].plan),
          validationIssues: processed[0].validation.issues,
        },
      }
      const retryOutput = await generateLayoutCandidates(retryContext, { client, costBudget })
      const retryProcessed = (retryOutput.candidates || [])
        .map((rawPlan, i) => processCandidate(rawPlan, i, imageCount, textBlocks, forcedFullBleedImages, allowUnforcedFullBleed))
      const retryValid = retryProcessed.filter((c) => c.validation.passed)

      if (retryValid.length > 0) {
        llmOutput = retryOutput
        processed = retryProcessed
        validCandidates = retryValid
        rejectedCandidates = retryProcessed.filter((c) => !c.validation.passed)
      } else {
        rejectedCandidates = [...rejectedCandidates, ...retryProcessed]
      }
    } catch {
      // Retry attempt itself failing (bad JSON, budget exhausted) doesn't change the outcome --
      // fall through to the fallback-used path below with the original rejection reasons.
    }
  }

  if (validCandidates.length > 0) {
    return {
      candidates: validCandidates,
      rejectedCandidates,
      source: 'llm',
      retryCount,
      fallbackUsed: false,
      costBudget: costBudget.summary(),
      // Phase 5-3: Include content understanding from LLM output
      content_understanding: llmOutput.content_understanding,
      image_analysis: llmOutput.image_analysis,
      inferred_image_text_relations: llmOutput.inferred_image_text_relations,
      reference_principles: llmOutput.reference_principles,
      layout_strategy_reasoning: llmOutput.layout_strategy_reasoning,
    }
  }

  const issues = processed.flatMap((c) => c.validation.issues)

  // No candidate reached a clean pass, but every candidate here IS real LLM reasoning (content
  // understanding, image analysis, composition decisions) that went through the full local repair
  // chain -- it's not a rule-based/fixed template. Refusing to output anything just because a
  // handful of geometry issues survived repair wastes the API spend that already happened for
  // nothing the user can see. Surface the least-broken candidate as a best-effort result instead of
  // hard-failing; the caller decides whether to render it (flagged) rather than show zero output.
  const bestEffort = processed.length > 0
    ? processed.reduce((best, c) => (c.validation.issues.length < best.validation.issues.length ? c : best))
    : null

  return {
    candidates: [],
    rejectedCandidates: processed,
    bestEffortCandidate: bestEffort,
    source: 'fallback',
    retryCount,
    fallbackUsed: true,
    fallbackReason: `후보 검증 실패 (재시도 ${retryCount}회 시도 후에도 실패): ${issues.slice(0, 5).join('; ')}`,
    costBudget: costBudget.summary(),
    // Phase 5-3: Include content understanding for logging
    content_understanding: llmOutput?.content_understanding || null,
    image_analysis: llmOutput?.image_analysis || [],
    inferred_image_text_relations: llmOutput?.inferred_image_text_relations || [],
    reference_principles: llmOutput?.reference_principles || null,
    layout_strategy_reasoning: llmOutput?.layout_strategy_reasoning || null,
  }
}
