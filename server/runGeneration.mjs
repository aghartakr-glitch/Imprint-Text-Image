// server/runGeneration.mjs
import { analyzeInput } from '../src/core/analyzeInput.js'
import { callLayoutLLM } from '../src/core/callLayoutLLM.js'
import { generateBestLayout } from '../src/core/generateBestLayout.js'
import { textDensityFromLength } from '../src/core/textDensity.js'
import { compileMainTex, compileSpreadPreview } from './compile.mjs'
import {
  createRunFolder, saveInputCopies, writeBestLayoutSources, writeGenerationLog,
} from './saveOutputs.mjs'
import { FONTS_DIR, OUTPUTS_DIR } from './env.mjs'
import {
  BODY_FONT_SIZE_PT, BODY_LEADING_PT, GRID_COLUMNS, GRID_ROWS,
} from '../src/core/layoutConstants.js'

// Grid-based LLM layout planning system (v0.3): no fixed pattern-library lookup, no Candidate
// A/B/C. The LLM (or its deterministic fallback) reasons about the actual input and produces one
// grid-based layout_plan; the code validates/repairs/retries it, then converts that one decision
// into pages/LaTeX/PDF. See imprint_llm_layout_planner_prompt_v0.2.md and PRD.md 0-2 for the spec.
export async function runGeneration({
  imagePaths, text, title, outputsRoot = OUTPUTS_DIR, fontsDir = FONTS_DIR, date, seq, llmOptions = {},
}) {
  const analysis = analyzeInput({ imagePaths, text })
  const imageRatios = analysis.images.map((i) => i.aspectRatio)
  const imageOrientations = analysis.images.map((i) => i.orientation)
  const textDensity = textDensityFromLength(analysis.textLength)
  const hasTitle = typeof title === 'string' && title.trim().length > 0

  const inputMetadata = {
    image_count: analysis.imageCount,
    image_orientations: imageOrientations,
    image_ratios: imageRatios,
    text_length_chars: analysis.textLength,
    text_density: textDensity,
    has_title: hasTitle,
  }

  const llmResult = await callLayoutLLM(
    { inputMetadata, imageCount: analysis.imageCount, textDensity },
    llmOptions,
  )

  const { runId, runDir } = createRunFolder(outputsRoot, { date, seq })
  const { imageNames } = saveInputCopies(runDir, { imagePaths, text })

  const generated = generateBestLayout({
    imagePaths, text, layoutPlan: llmResult.plan, fontsDir, title,
  })

  const bestLayoutDir = writeBestLayoutSources(runDir, {
    mainTex: generated.mainTex,
    styleTex: generated.styleTex,
    layout: {
      style: generated.style,
      layoutFamily: generated.layoutFamily,
      basePatternReference: generated.basePatternReference,
      pageCount: generated.pageCount,
      pages: generated.resolvedPages,
    },
  })

  const compileResult = await compileMainTex(bestLayoutDir)
  const spreadResult = compileResult.ok
    ? await compileSpreadPreview(bestLayoutDir)
    : { ok: false, reason: '개별 페이지 컴파일 실패로 스프레드 생략' }

  const issues = [...llmResult.validation.issues]
  if (!compileResult.ok) issues.push(compileResult.reason ?? '컴파일 실패')
  if (!spreadResult.ok) issues.push(spreadResult.reason ?? '스프레드 생성 실패')

  const log = {
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
    },
    layout_settings: {
      selection_mode: 'llm_constrained_layout_plan',
      style: llmResult.plan.style,
      layout_family: llmResult.plan.layout_family,
      base_pattern_reference: llmResult.plan.base_pattern_reference,
      layout_intent: llmResult.plan.layout_intent,
      body_font_size_pt: BODY_FONT_SIZE_PT,
      body_leading_pt: BODY_LEADING_PT,
      grid: { columns: GRID_COLUMNS, rows: GRID_ROWS },
    },
    validation: {
      passed: llmResult.validation.passed && compileResult.ok && spreadResult.ok,
      issues,
      repair_attempted: llmResult.repairAttempted,
      llm_retry_count: llmResult.retryCount,
      fallback_used: llmResult.fallbackUsed,
    },
    overflow_policy: { auto_shrink: false, truncate_text: false, move_to_next_page: true },
    outputs: { best_layout: `${bestLayoutDir.split(/[\\/]/).pop()}/` },
  }
  writeGenerationLog(runDir, log)

  return {
    runId,
    runDir,
    llmResult,
    dir: bestLayoutDir,
    style: generated.style,
    layoutFamily: generated.layoutFamily,
    basePatternReference: generated.basePatternReference,
    pageCount: generated.pageCount,
    compile: compileResult,
    spread: spreadResult,
    log,
  }
}
