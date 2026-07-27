// server/runGeneration.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeInput } from '../src/core/analyzeInput.js'
import { analyzeContentStructure } from '../src/core/contentStructure.js'
import { buildImageMetadata, estimateImageHierarchy } from '../src/core/imageHierarchy.js'
import { decideOutputUnit } from '../src/core/outputUnit.js'
import { textDensityFromLength } from '../src/core/textDensity.js'
import { retrieveLayoutReferences } from '../src/core/retrieveLayoutReferences.js'
import { callLayoutLLM } from '../src/core/callLayoutLLM.js'
import { buildFallbackLayoutPlan } from '../src/core/fallbackLayoutPlan.js'
import { validateLayoutPlan } from '../src/core/validateLayoutPlan.js'
import { resolveGridSettings } from '../src/core/grid/GridPresetManager.js'
import { parseTextBlocks } from '../src/core/text/parseTextBlocks.js'
import { parseDocumentStructure } from '../src/core/content/parseDocumentStructure.js'
import { parseContentStructure } from '../src/core/content/parseContentStructure.js'
import { parseTextBlocksAdvanced } from '../src/core/content/parseTextBlocksAdvanced.js'
import { analyzeImages } from '../src/core/content/analyzeImages.js'
import { inferImageTextRelations } from '../src/core/content/inferImageTextRelations.js'
import { matchImageToTextBlocks } from '../src/core/content/matchImageToTextBlocks.js'
import { mapImageTextRelations } from '../src/core/content/mapImageTextRelations.js'
import { validateCollisions } from '../src/core/validation/validateCollisions.js'
import { validateResolvedLayout, assertResolvedPagesInsideBounds } from '../src/core/validation/validateResolvedLayout.js'
import { assertNoMarkdownInResolvedPages } from '../src/core/validation/validateTextIntegrity.js'
import { repairResolvedLayout } from '../src/core/layout/repairResolvedLayout.js'
import { reorganizeTextOnlyPages } from '../src/core/reorganizeTextOnlyPages.js'
import { selectLayoutFamily } from '../src/core/layout/selectLayoutFamily.js'
import { selectTextFlowMode } from '../src/core/layout/selectTextFlowMode.js'
import { tryBuildSpecializedLayout } from '../src/core/layout/builders/index.js'
import { analyzeSpanVariation } from '../src/core/layout/spanVariation.js'
import { reconstructLayout } from '../src/core/reconstructLayout.js'
import { refineLayout } from '../src/core/refineLayout.js'
import { estimateLayoutQuality } from '../src/core/estimateLayoutQuality.js'
import { selectBestLayout } from '../src/core/selectBestLayout.js'
import {
  loadRecentLayouts, shouldApplyRepetitionPenalty, recordLayoutUsage, buildDiversityControlLog,
} from '../src/core/diversityControl.js'
import { loadUserFeedback } from '../src/core/logUserFeedback.js'
import { deriveUserPreferenceContext } from '../src/core/applyUserPreferences.js'
import { buildMainTex, buildStyleTex } from '../src/core/buildLatex.js'
import { compileMainTex, compileSpreadPreview } from './compile.mjs'
import {
  createRunFolder, saveInputCopies, writeBestLayoutSources, writeGenerationLog,
} from './saveOutputs.mjs'
import {
  FONTS_DIR, OUTPUTS_DIR, LOGS_DIR, ROOT,
} from './env.mjs'
import {
  writeDebugStage, summarizeResolvedPages, coordinateTable, overlapReport,
} from './debugDump.mjs'
import {
  BODY_FONT_SIZE_PT, BODY_LEADING_PT, GRID_COLUMNS, GRID_ROWS,
} from '../src/core/layoutConstants.js'

// Compact form sent to the LLM on every call -- the full imprint_pattern_library_v0.2.json (with
// long "when_to_use" prose per pattern) stays as human-readable documentation on disk, but every
// extra character here is tokens billed on every single generation.
let cachedPatternLibrary = null
function loadPatternLibrarySummary() {
  if (!cachedPatternLibrary) {
    const path = join(ROOT, 'src', 'data', 'imprint_pattern_library_v0.2.json')
    const patterns = JSON.parse(readFileSync(path, 'utf-8')).patterns
    cachedPatternLibrary = patterns.map((p) => ({
      pattern_id: p.pattern_id,
      layout_family: p.layout_family,
      image_count: p.typical_image_count,
      text_density: p.typical_text_density,
    }))
  }
  return cachedPatternLibrary
}

// Truncation early-warning: rough token-per-element estimate, calibrated against the one real
// failure this project has actually observed (a 15-page, multi-image document whose response was
// cut off by max_tokens=8000 at JSON position ~19000/line 713). Deliberately simple and
// conservative -- this is a heuristic pre-flight estimate, not a token-accurate count (getting an
// exact count would require calling the API's own count_tokens endpoint on a full simulated
// response, which doesn't exist before generation). Exported so the threshold/formula can be
// unit-tested and recalibrated independently as more real generations are observed.
export const ESTIMATED_TOKENS_PER_IMAGE_ELEMENT = 120
export const ESTIMATED_TOKENS_PER_TEXT_ELEMENT = 150
export const ESTIMATED_TOKENS_BASE = 800
// Leaves headroom below the real 8000-token ceiling (generateLayoutCandidates.js's
// MAX_OUTPUT_TOKENS) -- this is a WARNING threshold, not the hard cap itself, so it fires before
// the request is even sent rather than after paying for a truncated response.
export const LARGE_DOCUMENT_TOKEN_WARNING_THRESHOLD = 7000

export function estimateRequiredOutputTokens({ imageCount = 0, paragraphCount = 0 }) {
  return ESTIMATED_TOKENS_BASE
    + imageCount * ESTIMATED_TOKENS_PER_IMAGE_ELEMENT
    + paragraphCount * ESTIMATED_TOKENS_PER_TEXT_ELEMENT
}

// Cost reduction: whether to skip the LLM call entirely because the deterministic specialized
// builder already produced a validated candidate. Pulled out as a small pure function (no access to
// module state) so the decision logic can be unit-tested directly, without needing to coax the full
// runGeneration pipeline into triggering one of the specialized builders end-to-end. Conservative by
// default: only skips when the caller explicitly opts in via userLayoutSettings.cost_saving_mode or
// the LAYOUT_SKIP_LLM_ON_SPECIALIZED env var, AND a specialized candidate actually exists.
export function shouldSkipLlmForSpecializedLayout({ hasSpecializedCandidate, userLayoutSettings, env = {} }) {
  if (!hasSpecializedCandidate) return false
  return userLayoutSettings?.cost_saving_mode === true || env.LAYOUT_SKIP_LLM_ON_SPECIALIZED === 'true'
}

// Spec v0.4 section 22 full pipeline: Input Analyzer -> Design Space Mapper -> Reference
// Retriever -> LLM Layout Candidate Generator -> Layout Validator (inside callLayoutLLM) ->
// Layout Reconstructor -> Layout Refiner -> Layout Estimator -> Best Layout Selector -> LaTeX
// Renderer. User Feedback Logger is storage-only plumbing (see logUserFeedback.js) since there is
// no editing UI yet to actually generate feedback.
export async function runGeneration({
  imagePaths, text, title, outputsRoot = OUTPUTS_DIR, fontsDir = FONTS_DIR, date, seq, llmOptions = {},
  userControls = {}, userLayoutSettings = {}, diversityHistoryPath = join(LOGS_DIR, 'recent-layouts.json'),
  userFeedbackPath = join(LOGS_DIR, 'user-layout-preferences.json'),
}) {
  // 1-2. Input Analyzer
  const analysis = analyzeInput({ imagePaths, text })
  const imageRatios = analysis.images.map((i) => i.aspectRatio)
  const imageOrientations = analysis.images.map((i) => i.orientation)
  const textDensity = textDensityFromLength(analysis.textLength)
  const hasTitle = typeof title === 'string' && title.trim().length > 0

  // Primary: Advanced document structure parsing (recognizes Markdown, separators, etc.)
  const documentStructure = parseDocumentStructure({ title, text })
  const textBlocksAdvanced = documentStructure.text_blocks || []
  const textLayoutMode = documentStructure.text_layout_mode || 'continuous_flow'

  // DEBUG: Check if text_blocks have markdown markers
  if (textBlocksAdvanced.length > 0) {
    const hasMarkers = textBlocksAdvanced.some((b) => b.text && b.text.match(/^\s*#+\s/))
    if (hasMarkers) {
      console.warn('[runGeneration DEBUG] ⚠️ parseDocumentStructure returned text_blocks with markdown markers:')
      textBlocksAdvanced
        .filter((b) => b.text && b.text.match(/^\s*#+\s/))
        .slice(0, 3)
        .forEach((b) => console.warn(`  - role=${b.role}, text="${b.text.substring(0, 60)}"...`))
    }
  }

  // Fallback to old structure analyzer for compatibility
  const contentStructure = parseContentStructure({ title, text })

  // Also keep advanced text block parsing for multi-role analysis
  const textBlocksAnalysis = parseTextBlocksAdvanced({ title, text })

  // Match images to text blocks based on semantic roles
  const imageTextMatching = matchImageToTextBlocks({
    imageCount: analysis.imageCount,
    textBlocks: textBlocksAnalysis.text_blocks,
  })

  // Determine text flow mode (continuous, modular, or hybrid)
  const textFlowModeSelection = selectTextFlowMode({
    textBlockCount: textBlocksAnalysis.paragraph_count,
    imageCount: analysis.imageCount,
    hasCaseLikeBlocks: textBlocksAnalysis.has_case_like_paragraphs,
    hasHeroImage: !!imageTextMatching.hero_image,
    gridMode: userLayoutSettings.grid_mode || 'strict',
    textDensity,
  })

  // Map image-text relationships (used by both LLM and fallback)
  const imageTextRelation = mapImageTextRelations({
    imageCount: analysis.imageCount,
    contentStructure,
  })

  // Select suggested layout family (advisory for LLM, used by fallback)
  const suggestedLayoutFamily = selectLayoutFamily({
    imageCount: analysis.imageCount,
    textDensity,
    contentStructure,
    imageTextRelation,
    gridMode: userLayoutSettings.grid_mode || 'strict',
    hasTitle,
    outputUnit: null, // Will be decided by LLM
  })

  // Grid Preset + Column Flow supplement: resolve the user's 4 grid settings (page_size,
  // margin_preset, columns, grid_mode) plus content signals into the full grid_spec/
  // resolved_grid_settings this generation will use if the LLM path is unavailable and the
  // deterministic column-flow fallback runs (see buildGridFallbackPlan in fallbackLayoutPlan.js).
  const paragraphCount = parseTextBlocks({ title, text }).text_blocks.filter((b) => b.role === 'body').length
  const gridSettings = resolveGridSettings(userLayoutSettings, {
    textDensity, paragraphCount, imageCount: analysis.imageCount,
  })

  // Truncation early-warning (confirmed 2026-07-27: a real 15-page, multi-image generation was cut
  // off mid-response by the 8000-token output ceiling). Estimate the likely required output size
  // BEFORE spending an API call -- if it's predicted to exceed the real ceiling, fail fast with an
  // actionable message instead of paying for a call that's very likely to truncate anyway (per this
  // session's cost-protection directive: never spend on a call already known likely to fail).
  const estimatedOutputTokens = estimateRequiredOutputTokens({ imageCount: analysis.imageCount, paragraphCount })
  if (estimatedOutputTokens > LARGE_DOCUMENT_TOKEN_WARNING_THRESHOLD) {
    const warningMsg = `문서가 너무 커서 LLM 응답이 도중에 잘릴 가능성이 높습니다 (예상 출력 ${estimatedOutputTokens}토큰 > 안전 기준 ${LARGE_DOCUMENT_TOKEN_WARNING_THRESHOLD}토큰, 이미지 ${analysis.imageCount}장 / 문단 ${paragraphCount}개). API 호출 전에 미리 감지되어 비용이 청구되지 않았습니다.`
    console.warn(`[GENERATION SKIPPED] ${warningMsg}`)
    return {
      ok: false,
      error: warningMsg,
      large_document_warning: true,
      estimated_output_tokens: estimatedOutputTokens,
      threshold: LARGE_DOCUMENT_TOKEN_WARNING_THRESHOLD,
      suggested_action: '이미지 수를 줄이거나 본문을 여러 번에 나눠 생성해 주세요. (또는 사용자 설정으로 이 검사를 조정할 수 있습니다.)',
    }
  }

  const imageMetadataRaw = buildImageMetadata(analysis.images)
  const { imageMetadata, imageHierarchy: estimatedImageHierarchy } = estimateImageHierarchy(imageMetadataRaw)

  // Analyze image visual characteristics and infer image-text relations
  const { image_analysis } = analyzeImages({ imageMetadata })
  const { inferred_image_text_relations } = inferImageTextRelations({
    textBlocks: contentStructure.text_blocks || [],
    imageAnalysis: image_analysis,
  })

  // 3. output_unit decision (advisory default; the LLM makes its own final call within this guidance)
  const { outputUnit, source: outputUnitSource } = decideOutputUnit({
    imageCount: analysis.imageCount, textDensity, preferredOutputUnit: userControls.preferred_output_unit,
  })

  const inputMetadata = {
    image_count: analysis.imageCount,
    image_orientations: imageOrientations,
    image_ratios: imageRatios,
    text_length_chars: analysis.textLength,
    text_density: textDensity,
    has_title: hasTitle,
    output_unit_default: outputUnit,
    output_unit_default_source: outputUnitSource,
  }

  // 4. Reference Retriever
  const retrievedReferences = retrieveLayoutReferences({
    imageCount: analysis.imageCount, textDensity, outputUnit, layoutFamily: null, imageOrientations,
  })
  // 5. pattern library knowledge base
  const patternLibrarySummary = loadPatternLibrarySummary()

  // 6. user preference context from stored feedback (soft guidance only)
  const feedbackEntries = loadUserFeedback(userFeedbackPath)
  const userPreferenceContext = deriveUserPreferenceContext(feedbackEntries)

  const promptContext = {
    inputMetadata,
    contentStructure,
    documentStructure: documentStructure.document_structure,
    textBlocks: textBlocksAdvanced, // Use advanced parser's blocks (with roles detected from structure)
    textLayoutMode: textLayoutMode, // continuous_flow, modular_blocks, or hybrid_flow
    imageAnalysis: image_analysis, // Visual characteristics of each image
    inferredImageTextRelations: inferred_image_text_relations, // Semantic matching between text and images
    imageTextMatching,
    textFlowMode: textFlowModeSelection.mode,
    imageTextRelation,
    suggestedLayoutFamily,
    imageMetadata,
    patternLibrarySummary,
    retrievedReferences,
    userControls,
    userLayoutSettings,
    userGridHint: gridSettings.resolved_grid_settings,
    userPreferenceContext,
    // Generate 1 candidate by default (~1/3 the API cost of the old 3-candidate default). The
    // grid-occupancy backstop (enforceGridOccupancy.js) now guarantees any candidate's geometry
    // converges to zero overlap deterministically, so a single candidate no longer needs to be
    // "the best of 3" to be usable -- most of what 3-candidate diversity bought was insurance
    // against a badly-overlapping candidate, which is no longer a real risk. Set
    // LAYOUT_CANDIDATE_COUNT=3 (or any number) to restore multi-candidate diversity if desired.
    internalCandidateCount: Number(process.env.LAYOUT_CANDIDATE_COUNT) || 1,
  }

  // Cost reduction: try the deterministic specialized builder BEFORE spending an LLM call, not
  // after. If it produces a validated layout and cost-saving mode is on, skip the LLM call
  // entirely -- there's no reason to pay for a Claude call whose output would just be compared
  // against (and possibly discarded in favor of) a plan the deterministic builder already produced
  // for free. Default policy is conservative: unless the user explicitly opts in
  // (userLayoutSettings.cost_saving_mode or LAYOUT_SKIP_LLM_ON_SPECIALIZED=true), behavior is
  // unchanged -- the specialized plan is still built early, but the LLM is still called and both
  // are compared as before.
  const specializedLayoutPlan = tryBuildSpecializedLayout({
    suggestedLayoutFamily,
    imageCount: analysis.imageCount,
    textDensity,
    hasTitle,
    contentStructure,
    userGridSettings: gridSettings.resolved_grid_settings,
  })
  const specializedValidation = specializedLayoutPlan
    ? validateLayoutPlan(specializedLayoutPlan, {
      imageCount: analysis.imageCount,
      textBlocks: textBlocksAdvanced,
      forcedFullBleedImages: userLayoutSettings.forced_full_bleed_images ?? [],
      allowUnforcedFullBleed: userLayoutSettings.allow_unforced_full_bleed !== false,
    })
    : null
  const specializedCandidate = (specializedLayoutPlan && specializedValidation?.passed)
    ? {
      candidateId: specializedLayoutPlan.candidate_id,
      plan: specializedLayoutPlan,
      validation: specializedValidation,
      repaired: false,
    }
    : null

  const skipLlmWhenSpecializedPasses = shouldSkipLlmForSpecializedLayout({
    hasSpecializedCandidate: Boolean(specializedCandidate),
    userLayoutSettings,
    env: process.env,
  })

  // 7-10. LLM Layout Candidate Generator + Layout Validator (validate/repair/retry inside) --
  // skipped entirely when cost-saving mode already has a validated deterministic candidate.
  const llmResult = skipLlmWhenSpecializedPasses
    ? {
      candidates: [], rejectedCandidates: [], source: 'specialized-skip-llm', retryCount: 0, fallbackUsed: false,
      content_understanding: null, image_analysis: [], inferred_image_text_relations: [], reference_principles: null, layout_strategy_reasoning: null,
    }
    : await callLayoutLLM({ promptContext, imageCount: analysis.imageCount, textBlocks: textBlocksAdvanced }, llmOptions)

  // LLM succeeded (or was skipped) - candidates available
  const candidatePool = llmResult.candidates || []
  const recentLayouts = loadRecentLayouts(diversityHistoryPath)

  // Add the specialized layout as a candidate (already built/validated above, at zero extra API
  // cost). This must happen BEFORE the fallbackUsed hard-fail check below: specializedCandidate
  // already passed the exact same validateLayoutPlan check the LLM's own candidates go through --
  // it is not a "best-effort"/unvalidated render, so there is no reason to discard it and force a
  // paid retry just because the LLM's candidate separately failed (confirmed 2026-07-27: a real
  // generation had a valid specializedCandidate available but still hard-failed here, wasting the
  // API spend that had already happened for a document that could have rendered for free).
  if (specializedCandidate) {
    candidatePool.push(specializedCandidate)
  }

  // CRITICAL: best-effort rendering is banned (user directive) -- if NEITHER the LLM NOR the
  // deterministic specialized builder produced a validated candidate, fail hard rather than
  // fabricate output from a plan that failed raw validation.
  const bestEffortUsed = false
  if (llmResult.fallbackUsed && candidatePool.length === 0) {
    const errorMsg = `LLM-based layout reasoning failed: ${llmResult.fallbackReason || 'no candidate passed validation'}. Best-effort rendering is disabled; layout generation requires a fully validated candidate.`
    console.error(`[GENERATION FAILED] ${errorMsg}`)
    return {
      ok: false,
      error: errorMsg,
      fallback_used: true,
      fallback_reason: llmResult.fallbackReason,
      llm_reasoning_available: false,
      suggested_action: 'Check LLM API, cost budget, or schema parsing. Best-effort/rule-based fallback is disabled.',
    }
  }

  // Validate candidates are available (should not happen if LLM succeeded above)
  if (candidatePool.length === 0) {
    const errorMsg = 'LLM produced valid response but no candidates are in candidatePool. This is an internal error.'
    console.error(`[GENERATION FAILED] ${errorMsg}`)
    return {
      ok: false,
      error: errorMsg,
      llm_reasoning_available: true,
      llm_candidates_count: llmResult.candidates?.length || 0,
    }
  }

  // Phase 5: Filter to only validation-passed candidates before scoring. Best-effort (rendering a
  // candidate that failed raw validation) is banned -- every candidate must pass validation.
  const validatedCandidates = candidatePool.filter((c) => c.validation.passed)
  if (validatedCandidates.length === 0) {
    const validationFailures = candidatePool.map((c) => ({
      candidate: c.candidateId,
      issues: c.validation.issues.slice(0, 3).join('; '),
    }))
    const errorMsg = `All layout candidates failed validation: ${JSON.stringify(validationFailures)}`
    console.error(`[GENERATION FAILED] ${errorMsg}`)
    return {
      ok: false,
      error: errorMsg,
      validationFailures,
    }
  }

  // 11-13. Layout Reconstructor -> Layout Refiner -> Layout Estimator, for every validated candidate
  // CRITICAL: Filter out candidates that fail resolved layout validation (hard-block)
  const scoredCandidates = validatedCandidates.map((c, candidateIdx) => {
    const debugThisCandidate = candidateIdx === 0 // instrumentation only follows the first candidate

    // Ground truth for the "did images vanish mid-pipeline" check below: how many image elements
    // the (normalized) candidate plan itself declared, before any reconstruction/refinement.
    const rawImageElementCount = (c.plan.pages || []).reduce(
      (sum, p) => sum + (p.elements || []).filter((el) => el.type === 'image').length, 0,
    )

    const reconstructed = reconstructLayout({
      layoutPlan: c.plan, imagePaths, text, title, textBlocks: textBlocksAdvanced,
    })
    if (debugThisCandidate) {
      writeDebugStage('03-reconstructed-pages.json', reconstructed)
      writeDebugStage('03-reconstructed-summary.json', summarizeResolvedPages(reconstructed, 'reconstructed'))
    }
    if (rawImageElementCount > 0 && summarizeResolvedPages(reconstructed, 'reconstructed').image_count === 0) {
      throw new Error(`IMAGE_LOST_DURING_RECONSTRUCTION: candidate plan had ${rawImageElementCount} image element(s), 0 remain after reconstructLayout`)
    }

    const { resolvedPages: refinedPages, refinements } = refineLayout(reconstructed, { imagePaths, imageAspectRatios: imageRatios })
    if (debugThisCandidate) {
      writeDebugStage('04-refined-pages.json', refinedPages)
      writeDebugStage('04-refined-summary.json', summarizeResolvedPages(refinedPages, 'refined'))
    }
    if (rawImageElementCount > 0 && summarizeResolvedPages(refinedPages, 'refined').image_count === 0) {
      throw new Error(`IMAGE_LOST_DURING_REFINEMENT: candidate plan had ${rawImageElementCount} image element(s), 0 remain after refineLayout`)
    }

    // Image widths already reflect each image's grid col_span (set by gridToMm during
    // reconstructLayout/refineLayout) -- no separate distribution/rescaling pass needed, and
    // rescaling here would silently discard the LLM's per-image column choice (confirmed
    // 2026-07-10: a large_100 rescale to full page width overrode a col_span=3 hero image,
    // pushing it into an adjacent column's text and failing collision validation).
    // Reorganize text-only pages into multi-column layouts
    let finalResolvedPages = reorganizeTextOnlyPages(refinedPages, userLayoutSettings)
    // Snapshot the pre-repair state (repair reassigns finalResolvedPages below, so this is the only
    // chance to capture what validation actually saw on the first pass).
    const preRepairPages = finalResolvedPages

    // Validation gate: check resolved mm-coordinates after distribution scaling
    console.log('[STEP] first resolved validation start')
    let resolvedValidation = validateResolvedLayout(finalResolvedPages)
    console.log('[STEP] first resolved validation', resolvedValidation.passed ? 'PASSED' : `FAILED (${resolvedValidation.error_issues?.length || 0} errors)`)

    const firstValidationIssues = resolvedValidation.error_issues ? [...resolvedValidation.error_issues] : []
    let repairActions = []
    let repairUnresolvedIssues = []
    let secondValidationIssues = null

    if (!resolvedValidation.passed) {
      console.log(`[STEP] repair started for candidate_id=${c.candidateId}`)

      // Try to repair
      const repairResult = repairResolvedLayout({
        resolvedPages: finalResolvedPages,
      })

      console.log(`[STEP] repair actions: ${repairResult.actions.length}`)
      repairActions = repairResult.actions
      repairUnresolvedIssues = repairResult.unresolvedIssues

      // CRITICAL: Always use repaired pages, not original
      finalResolvedPages = repairResult.pages

      if (repairResult.unresolvedIssues.length > 0) {
        console.log(`[STEP] repair unresolved issues: ${repairResult.unresolvedIssues.length}`)
      }

      if (rawImageElementCount > 0 && summarizeResolvedPages(finalResolvedPages, 'repaired').image_count === 0) {
        throw new Error(`IMAGE_LOST_DURING_REPAIR: candidate plan had ${rawImageElementCount} image element(s), 0 remain after repairResolvedLayout`)
      }

      if (debugThisCandidate) {
        writeDebugStage('05-repaired-pages.json', finalResolvedPages)
        writeDebugStage('05-repaired-summary.json', summarizeResolvedPages(finalResolvedPages, 'repaired'))
      }

      // Re-validate after repair
      console.log('[STEP] second resolved validation start')
      resolvedValidation = validateResolvedLayout(finalResolvedPages)
      console.log('[STEP] second resolved validation', resolvedValidation.passed ? 'PASSED' : `FAILED (${resolvedValidation.error_issues?.length || 0} errors)`)
      secondValidationIssues = resolvedValidation.error_issues ? [...resolvedValidation.error_issues] : []

      if (!resolvedValidation.passed) {
        // Still failing after repair - log and reject
        console.error(`[RESOLVED VALIDATION FAILED AFTER REPAIR] candidate_id=${c.candidateId}`)
        if (resolvedValidation.error_issues && resolvedValidation.error_issues.length > 0) {
          console.error(`  Remaining issues: ${resolvedValidation.error_issues.length}`)
          resolvedValidation.error_issues.slice(0, 3).forEach((issue) => {
            console.error(`    - Page ${issue.page}: ${issue.type} (${issue.element_id}): ${issue.message}`)
          })
        }
        if (debugThisCandidate) writeDebugStage('06-validation-report.json', buildValidationReport())
        // Return undefined candidate
        return null
      }

      console.log(`[RESOLVED VALIDATION PASSED AFTER REPAIR] candidate_id=${c.candidateId}`)
    } else if (debugThisCandidate) {
      // Passed on the first try -- no repair stage ran, so 05 is identical to 04's post-scaling state.
      writeDebugStage('05-repaired-pages.json', finalResolvedPages)
      writeDebugStage('05-repaired-summary.json', summarizeResolvedPages(finalResolvedPages, 'repaired (no repair needed)'))
    }

    function buildValidationReport() {
      const coordsBeforeRepair = coordinateTable(preRepairPages)
      const coordsAfterRepair = coordinateTable(finalResolvedPages)
      return {
        stage_counts: {
          raw: 'see 01-raw-llm-candidate-summary.json',
          normalized: 'see 02-normalized-candidate-summary.json',
          reconstructed: summarizeResolvedPages(reconstructed, 'reconstructed'),
          refined: summarizeResolvedPages(refinedPages, 'refined'),
          repaired: summarizeResolvedPages(finalResolvedPages, 'repaired'),
        },
        first_validation: {
          passed: firstValidationIssues.length === 0,
          issue_count: firstValidationIssues.length,
          issues: firstValidationIssues,
          coordinate_table: coordsBeforeRepair,
          overlaps: overlapReport(coordsBeforeRepair),
        },
        repair: {
          actions_count: repairActions.length,
          actions: repairActions,
          unresolved_count: repairUnresolvedIssues.length,
          unresolved_issues: repairUnresolvedIssues,
        },
        second_validation: secondValidationIssues === null ? null : {
          passed: secondValidationIssues.length === 0,
          issue_count: secondValidationIssues.length,
          issues: secondValidationIssues,
          coordinate_table: coordsAfterRepair,
          overlaps: overlapReport(coordsAfterRepair),
        },
      }
    }

    if (debugThisCandidate && resolvedValidation.passed) {
      writeDebugStage('06-validation-report.json', buildValidationReport())
    }

    const repetitionPenaltyApplied = shouldApplyRepetitionPenalty(recentLayouts, c.plan.composition_strategy)
    const { layout_quality_score: qualityScore } = estimateLayoutQuality({
      plan: c.plan, resolvedPages: finalResolvedPages, refinements, repetitionPenaltyApplied,
      validationIssues: c.validation.issues,
      inferredImageTextRelations: inferred_image_text_relations,
    })
    return {
      candidateId: c.candidateId,
      plan: c.plan,
      validation: c.validation,
      repaired: c.repaired,
      resolvedPages: finalResolvedPages,
      refinements,
      qualityScore,
      repetitionPenaltyApplied,
      repairActions,
      resolved_validation: resolvedValidation,
    }
  }).filter(c => c !== null) // Remove candidates that failed resolved layout validation

  // 14. Best Layout Selector
  // CRITICAL: Fail hard if all candidates were rejected by resolved layout validation
  if (scoredCandidates.length === 0) {
    const errorMsg = 'All layout candidates failed resolved layout validation (page boundary/collision checks)'
    console.error(`[GENERATION FAILED] ${errorMsg}`)
    return {
      ok: false,
      error: errorMsg,
      validationFailures: [],
    }
  }

  const { selected, ranked } = selectBestLayout(scoredCandidates)
  recordLayoutUsage(diversityHistoryPath, {
    layoutFamily: selected.plan.layout_family, compositionStrategy: selected.plan.composition_strategy,
  })
  const diversityControlLog = buildDiversityControlLog(recentLayouts, selected.repetitionPenaltyApplied)

  const { runId, runDir } = createRunFolder(outputsRoot, { date, seq })
  const { imageNames } = saveInputCopies(runDir, { imagePaths, text })

  // 15. LaTeX Renderer
  // CRITICAL: Final validation before LaTeX generation
  const finalPages = selected.resolvedPages

  // Assert: no pages exceed bounds
  const boundaryIssues = assertResolvedPagesInsideBounds(finalPages)
  if (boundaryIssues.length > 0) {
    const errorMsg = `Final boundary check failed:\n${boundaryIssues.join('\n')}`
    console.error(`[GENERATION FAILED] ${errorMsg}`)
    return {
      ok: false,
      error: errorMsg,
      validationFailures: boundaryIssues,
    }
  }

  // Assert: no markdown markers in final pages
  try {
    assertNoMarkdownInResolvedPages(finalPages)
  } catch (err) {
    console.error(`[GENERATION FAILED] ${err.message}`)
    return {
      ok: false,
      error: err.message,
      validationFailures: [],
    }
  }

  const mainTex = buildMainTex({ resolvedPages: finalPages, runningHeadText: userLayoutSettings.running_head_text })
  const styleTex = buildStyleTex({ fontsDir })

  const bestLayoutDir = writeBestLayoutSources(runDir, {
    mainTex,
    styleTex,
    layout: {
      style: selected.plan.style,
      outputUnit: selected.plan.output_unit,
      layoutFamily: selected.plan.layout_family,
      layoutPurpose: selected.plan.layout_purpose,
      imageHierarchy: selected.plan.image_hierarchy,
      imageTextRelation: selected.plan.image_text_relation,
      compositionStrategy: selected.plan.composition_strategy,
      basePatternReference: selected.plan.base_pattern_reference,
      designSequence: selected.plan.design_sequence,
      pageCount: selected.resolvedPages.length,
      pages: selected.resolvedPages,
    },
  })

  const compileResult = await compileMainTex(bestLayoutDir)
  const spreadResult = compileResult.ok
    ? await compileSpreadPreview(bestLayoutDir)
    : { ok: false, reason: '개별 페이지 컴파일 실패로 스프레드 생략' }

  const issues = [...selected.validation.issues]
  if (!compileResult.ok) issues.push(compileResult.reason ?? '컴파일 실패')
  if (!spreadResult.ok) issues.push(spreadResult.reason ?? '스프레드 생성 실패')

  // 16. generation-log.json (spec section 18)
  const log = {
    generation_log_version: '0.4',
    project: 'Imprint(Image+Text)',
    created_at: runId,
    input: {
      title: hasTitle ? title.trim() : null,
      image_count: analysis.imageCount,
      image_names: imageNames,
      image_ratios: imageRatios,
      image_orientations: imageOrientations,
      text_length: analysis.textLength,
      text_density: textDensity,
      paragraph_count: documentStructure.paragraph_count,
      has_modular_blocks: documentStructure.document_structure?.sections?.length > 0,
      has_case_like_paragraphs: textBlocksAnalysis.has_case_like_paragraphs,
      text_blocks: textBlocksAdvanced.map((b) => ({
        id: b.id,
        role: b.role,
        type: b.type,
        char_count: b.char_count,
      })),
      document_structure: documentStructure.document_structure,
      text_layout_mode: textLayoutMode,
      has_lightweight_markers: documentStructure.has_lightweight_markers,
      has_explicit_tags: documentStructure.has_explicit_tags,
      merged_body_all: documentStructure.merged_body_all,
      image_analysis,
      inferred_image_text_relations,
      image_text_matching: imageTextMatching,
      content_structure: contentStructure,
      image_text_relation: imageTextRelation.relation,
      suggested_layout_family: suggestedLayoutFamily.family,
      image_metadata: imageMetadata,
      estimated_image_hierarchy: estimatedImageHierarchy,
    },
    retrieved_references: retrievedReferences,
    user_controls: userControls,
    user_layout_settings: userLayoutSettings,
    resolved_grid_settings: gridSettings.resolved_grid_settings,
    user_preference_context: userPreferenceContext,
    internal_candidates: scoredCandidates.map((c) => ({
      candidate_id: c.candidateId,
      validation_passed: c.validation.passed,
      repaired: c.repaired,
      quality_score: c.qualityScore.total,
      rejected: c.candidateId !== selected.candidateId,
      reason: c.plan.reason ?? null,
    })).concat((llmResult.rejectedCandidates ?? []).map((c) => ({
      candidate_id: c.candidateId,
      validation_passed: false,
      repaired: c.repaired,
      quality_score: 0,
      rejected: true,
      rejection_reason: c.validation.issues.join('; '),
    }))),
    selected_candidate: {
      candidate_id: selected.candidateId,
      source: selected.candidateId.startsWith('builtin_') ? 'specialized_layout_builder' : 'llm',
      style: selected.plan.style,
      output_unit: selected.plan.output_unit,
      layout_family: selected.plan.layout_family,
      layout_purpose: selected.plan.layout_purpose,
      composition_strategy: selected.plan.composition_strategy,
      image_text_relation: selected.plan.image_text_relation,
      base_pattern_reference: selected.plan.base_pattern_reference,
      quality_score: selected.qualityScore.total,
    },
    design_sequence: selected.plan.design_sequence,
    layout_settings: {
      selection_mode: 'llm_constrained_layout_plan_v0.4',
      style: selected.plan.style,
      output_unit: selected.plan.output_unit,
      layout_family: selected.plan.layout_family,
      layout_purpose: selected.plan.layout_purpose,
      image_hierarchy: selected.plan.image_hierarchy,
      image_text_relation: selected.plan.image_text_relation,
      composition_strategy: selected.plan.composition_strategy,
      base_pattern_reference: selected.plan.base_pattern_reference,
      layout_intent: selected.plan.layout_intent,
      body_font_size_pt: BODY_FONT_SIZE_PT,
      body_leading_pt: BODY_LEADING_PT,
      grid: { columns: GRID_COLUMNS, rows: GRID_ROWS },
    },
    llm_cost_budget: llmResult.costBudget ?? null,
    // Phase 5-3: Full LLM layout reasoning (content understanding + strategy reasoning)
    llm_layout_reasoning: {
      llm_reasoning_performed: !llmResult.fallbackUsed,
      content_understanding: llmResult.content_understanding || null,
      image_analysis: llmResult.image_analysis || [],
      inferred_image_text_relations: llmResult.inferred_image_text_relations || [],
      reference_principles: llmResult.reference_principles || null,
      grid_interpretation: llmResult.grid_interpretation || null,
      layout_strategy_reasoning: llmResult.layout_strategy_reasoning || null,
      candidate_count: llmResult.candidates?.length || 0,
    },
    generation_path: {
      llm_called: llmResult.fallbackUsed !== undefined,
      llm_succeeded: llmResult.candidates && llmResult.candidates.length > 0,
      llm_reasoning_based: !llmResult.fallbackUsed && (llmResult.content_understanding !== null),
      fallback_used: llmResult.fallbackUsed,
      fallback_reason: llmResult.fallbackReason || null,
      selected_from: selected.candidateId.startsWith('builtin_') ? 'specialized_layout' : 'llm',
    },
    validation: {
      passed: selected.validation.passed && compileResult.ok && spreadResult.ok,
      issues,
      repair_attempted: selected.repaired,
      llm_retry_count: llmResult.retryCount,
      fallback_used: llmResult.fallbackUsed,
      fallback_error_code: null,
    },
    refinement: {
      text_capacity_checked: true,
      continuation_pages_added: selected.refinements.continuation_pages_added,
      object_position_adjusted: selected.refinements.object_position_adjusted,
      visual_balance_adjusted: selected.refinements.notes.length > 0,
      notes: selected.refinements.notes,
    },
    diversity_control: diversityControlLog,
    // Only present when the deterministic column-flow fallback (buildGridFallbackPlan) was
    // actually selected -- LLM-generated candidates still use the fixed 6x12 grid (task 42).
    grid_plan: selected.plan.grid_spec ? {
      grid_spec: selected.plan.grid_spec,
      layout_variation: selected.plan.layout_variation,
      reserved_regions: selected.plan.reserved_regions,
      text_flow: selected.plan.text_flow,
      mm_layout: selected.resolvedPages,
    } : null,
    // Reports whether the grid's columns were actually used as a flexible alignment structure
    // (elements spanning 1-4 columns as content demands) or degraded into a rigid forced-N-column
    // text wall -- see spanVariation.js.
    grid_interpretation: selected.plan.grid_spec
      ? (({ forcedRigidColumns, imagesNeverSpanMultiple, ...rest }) => rest)(analyzeSpanVariation(selected.plan))
      : null,
    // Phase 5: Extended grid & collision validation fields
    phase5_layout_analysis: selected.plan.grid_spec ? (() => {
      const spanAnalysis = analyzeSpanVariation(selected.plan)
      return {
        default_grid_mode: 'flexible_modular_grid',
        column_flow_grid_used: selected.plan.composition_strategy === 'column_flow_grid',
        column_flow_grid_reason: selected.plan.composition_strategy === 'column_flow_grid' ? selected.plan.reason ?? 'fallback' : null,
        grid_interpretation: 'modular_alignment_structure',
        text_span_patterns: spanAnalysis.text_span_patterns || [],
        image_span_patterns: spanAnalysis.image_span_patterns || [],
        span_variation_used: spanAnalysis.span_variation_used,
        text_span_variation_used: spanAnalysis.text_span_variation_used,
        image_span_variation_used: spanAnalysis.image_span_variation_used,
        column_gutter_mm: 4,
        text_inner_padding_mm: 2,
        text_image_min_gap_mm: 4,
        text_text_min_gap_mm: 3,
        image_image_min_gap_mm: 3,
        section_title_margin_mm: 5,
        expanded_collision_validation: {
          passed: !issues.filter((i) => i.includes('expanded_bbox_overlap')).length,
          issues: issues.filter((i) => i.includes('expanded_bbox_overlap') || i.includes('insufficient_gap')),
        },
        rejected_because_rigid_column_flow: selected.plan.composition_strategy === 'column_flow_grid' && spanAnalysis.forcedRigidColumns,
      }
    })() : null,
    overflow_policy: { auto_shrink: false, truncate_text: false, move_to_next_page: true },
    outputs: { best_layout: `${bestLayoutDir.split(/[\\/]/).pop()}/` },
  }
  writeGenerationLog(runDir, log)

  return {
    ok: true,
    runId,
    runDir,
    llmResult,
    selected,
    ranked,
    dir: bestLayoutDir,
    style: selected.plan.style,
    outputUnit: selected.plan.output_unit,
    layoutFamily: selected.plan.layout_family,
    basePatternReference: selected.plan.base_pattern_reference,
    pageCount: selected.resolvedPages.length,
    compile: compileResult,
    spread: spreadResult,
    log,
    bestEffortUsed,
    bestEffortWarning: bestEffortUsed
      ? `일부 요소가 완벽하게 배치되지 않았을 수 있습니다 (남은 문제: ${selected.validation.issues.slice(0, 2).join('; ')})`
      : null,
  }
}
