// server/runGeneration.mjs
import { analyzeInput } from '../src/core/analyzeInput.js'
import { selectLayout } from '../src/core/selectLayout.js'
import { generateBestLayout } from '../src/core/generateBestLayout.js'
import { getAvailablePatterns } from '../src/core/patternLibrary.js'
import { textDensityFromLength } from '../src/core/textDensity.js'
import { compileMainTex, compileSpreadPreview } from './compile.mjs'
import {
  createRunFolder, saveInputCopies, writeBestLayoutSources, writeGenerationLog,
} from './saveOutputs.mjs'
import { FONTS_DIR, OUTPUTS_DIR } from './env.mjs'
import {
  BODY_FONT_SIZE_PT, BODY_LEADING_PT, MARGIN_TOP_MM, MARGIN_BOTTOM_MM, MARGIN_INNER_MM, MARGIN_OUTER_MM,
} from '../src/core/layoutConstants.js'

// Single-best-layout system: no Candidate A/B/C. The LLM (or its rule-based fallback) picks
// exactly one style + layout_type + pattern_id from the pattern library; the code turns that
// one choice into pages/LaTeX/PDF. See docs/superpowers/specs for the full rationale.
export async function runGeneration({
  imagePaths, text, title, outputsRoot = OUTPUTS_DIR, fontsDir = FONTS_DIR, date, seq, llmOptions = {},
}) {
  const analysis = analyzeInput({ imagePaths, text })
  const imageAspectRatios = analysis.images.map((i) => i.aspectRatio)
  const textDensity = textDensityFromLength(analysis.textLength)
  const availablePatterns = getAvailablePatterns(analysis.imageCount)

  const selection = await selectLayout(
    {
      imageCount: analysis.imageCount,
      textLength: analysis.textLength,
      imageAspectRatios,
      availablePatterns,
    },
    llmOptions,
  )

  const { runId, runDir } = createRunFolder(outputsRoot, { date, seq })
  const { imageNames } = saveInputCopies(runDir, { imagePaths, text })

  const generated = generateBestLayout({
    imageCount: analysis.imageCount,
    imagePaths,
    text,
    patternId: selection.patternId,
    style: selection.style,
    fontsDir,
    title,
  })

  const bestLayoutDir = writeBestLayoutSources(runDir, {
    mainTex: generated.mainTex,
    styleTex: generated.styleTex,
    layout: {
      patternId: generated.patternId,
      layoutType: generated.layoutType,
      pageCount: generated.pageCount,
      pages: generated.resolvedPages,
    },
  })

  const compileResult = await compileMainTex(bestLayoutDir)
  const spreadResult = compileResult.ok
    ? await compileSpreadPreview(bestLayoutDir)
    : { ok: false, reason: '개별 페이지 컴파일 실패로 스프레드 생략' }

  const issues = []
  if (!compileResult.ok) issues.push(compileResult.reason ?? '컴파일 실패')
  if (!spreadResult.ok) issues.push(spreadResult.reason ?? '스프레드 생성 실패')

  const log = {
    project: 'Imprint(Image+Text)',
    created_at: runId,
    input: {
      title: typeof title === 'string' && title.trim() ? title.trim() : null,
      image_count: analysis.imageCount,
      image_names: imageNames,
      image_ratios: imageAspectRatios,
      text_length: analysis.textLength,
      text_density: textDensity,
      page_size: 'A5',
      orientation: 'portrait',
      caption: false,
      image_fit: 'contain',
      text_overlay: false,
    },
    layout_settings: {
      selection_mode: 'best_only',
      selected_layout_type: selection.layoutType,
      selected_style: selection.style,
      selected_pattern_id: selection.patternId,
      selection_reason: selection.reason,
      selection_source: selection.source,
      body_font: 'Noto Sans KR (Noto Serif KR/대체 세리프 모두 정적 폰트 문제로 사용 불가해 대체)',
      heading_font: 'Noto Sans KR',
      body_font_size_pt: BODY_FONT_SIZE_PT,
      body_leading_pt: BODY_LEADING_PT,
      margins_mm: {
        top: MARGIN_TOP_MM, bottom: MARGIN_BOTTOM_MM, inner: MARGIN_INNER_MM, outer: MARGIN_OUTER_MM,
      },
    },
    overflow_policy: { auto_shrink: false, truncate_text: false, move_to_next_page: true, move_to_next_spread: true },
    validation: { passed: compileResult.ok && spreadResult.ok, issues },
    outputs: { best_layout: `${bestLayoutDir.split(/[\\/]/).pop()}/` },
  }
  writeGenerationLog(runDir, log)

  return {
    runId,
    runDir,
    selection,
    dir: bestLayoutDir,
    patternId: generated.patternId,
    layoutType: generated.layoutType,
    pageCount: generated.pageCount,
    compile: compileResult,
    spread: spreadResult,
    log,
  }
}
