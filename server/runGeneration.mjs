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
import { resolveGridSettings } from '../src/core/grid/GridPresetManager.js'
import { parseTextBlocks } from '../src/core/text/parseTextBlocks.js'
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
  const contentStructure = analyzeContentStructure({ title, text })

  // Grid Preset + Column Flow supplement: resolve the user's 4 grid settings (page_size,
  // margin_preset, columns, grid_mode) plus content signals into the full grid_spec/
  // resolved_grid_settings this generation will use if the LLM path is unavailable and the
  // deterministic column-flow fallback runs (see buildGridFallbackPlan in fallbackLayoutPlan.js).
  const paragraphCount = parseTextBlocks({ title, text }).text_blocks.filter((b) => b.role === 'body').length
  const gridSettings = resolveGridSettings(userLayoutSettings, {
    textDensity, paragraphCount, imageCount: analysis.imageCount,
  })

  const imageMetadataRaw = buildImageMetadata(analysis.images)
  const { imageMetadata, imageHierarchy: estimatedImageHierarchy } = estimateImageHierarchy(imageMetadataRaw)

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
    imageMetadata,
    patternLibrarySummary,
    retrievedReferences,
    userControls,
    userPreferenceContext,
    // Cost lever: 1 candidate per call instead of 3 (spec's original ask) -- cuts output tokens
    // to roughly a third. The reconstruct/refine/estimate/select pipeline still runs on whatever
    // candidates come back, so this is a pure cost/quality-diversity trade-off, not an
    // architecture change; bump this back up if candidate diversity turns out to matter more
    // than the extra API cost.
    internalCandidateCount: 1,
  }

  // 7-10. LLM Layout Candidate Generator + Layout Validator (validate/repair/retry inside)
  const llmResult = await callLayoutLLM({ promptContext, imageCount: analysis.imageCount }, llmOptions)

  const recentLayouts = loadRecentLayouts(diversityHistoryPath)

  const candidatePool = llmResult.candidates.length > 0
    ? llmResult.candidates
    : [{
      candidateId: 'fallback_1',
      plan: buildFallbackLayoutPlan({
        imageCount: analysis.imageCount, textDensity, imageAspectRatios: imageRatios, textLength: analysis.textLength, text, title, gridSettings,
      }),
      validation: { passed: true, issues: [] },
      repaired: false,
    }]

  // 11-13. Layout Reconstructor -> Layout Refiner -> Layout Estimator, for every candidate
  const scoredCandidates = candidatePool.map((c) => {
    const reconstructed = reconstructLayout({
      layoutPlan: c.plan, imagePaths, text, title,
    })
    const { resolvedPages, refinements } = refineLayout(reconstructed, { imagePaths, imageAspectRatios: imageRatios })
    const repetitionPenaltyApplied = shouldApplyRepetitionPenalty(recentLayouts, c.plan.composition_strategy)
    const { layout_quality_score: qualityScore } = estimateLayoutQuality({
      plan: c.plan, resolvedPages, refinements, repetitionPenaltyApplied,
    })
    return {
      candidateId: c.candidateId,
      plan: c.plan,
      validation: c.validation,
      repaired: c.repaired,
      resolvedPages,
      refinements,
      qualityScore,
      repetitionPenaltyApplied,
    }
  })

  // 14. Best Layout Selector
  const { selected, ranked } = selectBestLayout(scoredCandidates)
  recordLayoutUsage(diversityHistoryPath, {
    layoutFamily: selected.plan.layout_family, compositionStrategy: selected.plan.composition_strategy,
  })
  const diversityControlLog = buildDiversityControlLog(recentLayouts, selected.repetitionPenaltyApplied)

  const { runId, runDir } = createRunFolder(outputsRoot, { date, seq })
  const { imageNames } = saveInputCopies(runDir, { imagePaths, text })

  // 15. LaTeX Renderer
  const mainTex = buildMainTex({ resolvedPages: selected.resolvedPages })
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
      content_structure: contentStructure,
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
    validation: {
      passed: selected.validation.passed && compileResult.ok && spreadResult.ok,
      issues,
      repair_attempted: selected.repaired,
      llm_retry_count: llmResult.retryCount,
      fallback_used: llmResult.fallbackUsed,
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
    overflow_policy: { auto_shrink: false, truncate_text: false, move_to_next_page: true },
    outputs: { best_layout: `${bestLayoutDir.split(/[\\/]/).pop()}/` },
  }
  writeGenerationLog(runDir, log)

  return {
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
  }
}
