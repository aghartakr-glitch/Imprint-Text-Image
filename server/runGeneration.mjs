// server/runGeneration.mjs
import { analyzeInput } from '../src/core/analyzeInput.js'
import { inferStyle } from '../src/core/llmStyle.js'
import { generateCandidate } from '../src/core/generateCandidate.js'
import { compileMainTex, compileSpreadPreview } from './compile.mjs'
import {
  createRunFolder, saveInputCopies, writeCandidateSources, writeGenerationLog,
} from './saveOutputs.mjs'
import { FONTS_DIR, OUTPUTS_DIR } from './env.mjs'

const CANDIDATES = ['A', 'B', 'C']
const CANDIDATE_MEANINGS = { A: 'image-first', B: 'balanced', C: 'text-first' }

export async function runGeneration({
  imagePaths, text, outputsRoot = OUTPUTS_DIR, fontsDir = FONTS_DIR, date, seq, llmOptions = {},
}) {
  const analysis = analyzeInput({ imagePaths, text })
  const styleResult = await inferStyle(
    {
      imageCount: analysis.imageCount,
      textLength: analysis.textLength,
      imageAspectRatios: analysis.images.map((i) => i.aspectRatio),
    },
    llmOptions,
  )

  const { runId, runDir } = createRunFolder(outputsRoot, { date, seq })
  const { imageNames } = saveInputCopies(runDir, { imagePaths, text })

  const candidateResults = {}
  for (const candidate of CANDIDATES) {
    const generated = generateCandidate({
      imageCount: analysis.imageCount,
      imagePaths,
      text,
      candidate,
      style: styleResult.style,
      fontsDir,
    })
    const dir = writeCandidateSources(runDir, candidate, {
      mainTex: generated.mainTex,
      styleTex: generated.styleTex,
      layout: { patternId: generated.patternId, pageCount: generated.pageCount, pages: generated.resolvedPages },
    })
    const compileResult = await compileMainTex(dir)
    const spreadResult = compileResult.ok
      ? await compileSpreadPreview(dir)
      : { ok: false, reason: '개별 페이지 컴파일 실패로 스프레드 생략' }
    candidateResults[candidate] = {
      dir, patternId: generated.patternId, pageCount: generated.pageCount, compile: compileResult, spread: spreadResult,
    }
  }

  const log = {
    project: 'Imprint(Image+Text)',
    created_at: runId,
    input: {
      image_count: analysis.imageCount,
      image_names: imageNames,
      text_length: analysis.textLength,
      page_size: 'A5',
      orientation: 'portrait',
      caption: false,
      image_fit: 'contain',
      text_overlay: false,
    },
    layout_settings: {
      candidates: CANDIDATES,
      candidate_meanings: CANDIDATE_MEANINGS,
      style_inference: styleResult.style,
      style_inference_source: styleResult.source,
      style_inference_reason: styleResult.reason ?? styleResult.fallbackReason ?? null,
      body_font: 'IBM Plex Serif (Noto Serif KR 정적 폰트 부재로 대체)',
      heading_font: 'Noto Sans KR',
      body_font_size_pt: 9,
      body_leading_pt: 14,
      margins_mm: { top: 16, bottom: 18, inner: 18, outer: 14 },
    },
    overflow_policy: { auto_shrink: false, move_to_next_page: true, move_to_next_spread: true },
    outputs: Object.fromEntries(CANDIDATES.map((c) => [
      `candidate_${c.toLowerCase()}`,
      {
        folder: `${candidateResults[c].dir.split(/[\\/]/).pop()}/`,
        pattern_id: candidateResults[c].patternId,
        page_count: candidateResults[c].pageCount,
        compile_ok: candidateResults[c].compile.ok,
        spread_ok: candidateResults[c].spread.ok,
      },
    ])),
  }
  writeGenerationLog(runDir, log)

  return {
    runId, runDir, styleResult, candidateResults, log,
  }
}
