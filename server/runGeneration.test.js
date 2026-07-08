// server/runGeneration.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { runGeneration } from './runGeneration.mjs'
import { FONTS_DIR } from './env.mjs'


const runFile = promisify(execFile)
const PDFINFO_BIN = process.env.PDFINFO_BIN ?? 'C:\\texlive\\2026\\bin\\windows\\pdfinfo.exe'

async function getPdfPageCount(pdfPath) {
  const { stdout } = await runFile(PDFINFO_BIN, [pdfPath])
  const match = stdout.match(/^Pages:\s+(\d+)/m)
  if (!match) throw new Error(`pdfinfo 출력에서 페이지 수를 찾을 수 없습니다: ${stdout}`)
  return Number(match[1])
}

// A real, fully valid 1x1 PNG (not just a header) so XeLaTeX's \includegraphics can embed it.
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function isolatedLogPaths() {
  const dir = mkdtempSync(join(tmpdir(), 'imprint-it-logs-'))
  return {
    diversityHistoryPath: join(dir, 'recent-layouts.json'),
    userFeedbackPath: join(dir, 'user-layout-preferences.json'),
    dir,
  }
}

test('runGeneration produces exactly ONE real, compiled best-layout result via the v0.4 pipeline (mock mode = deterministic fallback)', async () => {
  const srcDir = mkdtempSync(join(tmpdir(), 'imprint-it-src-'))
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const { diversityHistoryPath, userFeedbackPath, dir: logsDir } = isolatedLogPaths()
  const imgPath = join(srcDir, 'photo.png')
  writeFileSync(imgPath, Buffer.from(TINY_PNG_BASE64, 'base64'))

  const result = await runGeneration({
    imagePaths: [imgPath, imgPath],
    text: '가나다라마바사아자차카파타하'.repeat(50),
    outputsRoot,
    fontsDir: FONTS_DIR,
    date: new Date(2026, 6, 8, 10, 30),
    seq: 1,
    llmOptions: { mockMode: true },
    diversityHistoryPath,
    userFeedbackPath,
  })

  assert.equal(result.llmResult.fallbackUsed, true) // mock mode always uses the deterministic fallback
  assert.ok(['image-first', 'balanced', 'text-first'].includes(result.layoutFamily))
  assert.ok(['single_page', 'spread'].includes(result.outputUnit))
  assert.equal(result.compile.ok, true, `compile failed: ${JSON.stringify(result.compile)}`)
  assert.equal(result.spread.ok, true, `spread failed: ${JSON.stringify(result.spread)}`)
  assert.ok(existsSync(join(result.dir, 'pages.pdf')))
  assert.ok(existsSync(join(result.dir, 'spread-preview.pdf')))
  assert.ok(existsSync(join(result.dir, 'main.tex')))
  assert.ok(existsSync(join(result.dir, 'layout.json')))
  assert.ok(result.dir.includes('best-layout'))

  // Regression guard: overlay textblocks (textpos [absolute,overlay]) contribute nothing to the
  // main vertical list, so \newpage alone can silently collapse multiple logical pages into one
  // physical PDF page. Verify the *real* compiled PDF has the expected physical page count.
  const realPageCount = await getPdfPageCount(join(result.dir, 'pages.pdf'))
  assert.equal(realPageCount, result.pageCount)
  assert.ok(result.pageCount > 1, `test fixture should exercise a multi-page layout (got pageCount=${result.pageCount})`)

  assert.ok(existsSync(join(result.runDir, 'generation-log.json')))
  assert.ok(existsSync(join(result.runDir, 'input', 'input-text.txt')))
  assert.equal(result.log.generation_log_version, '0.4')
  assert.equal(result.log.layout_settings.base_pattern_reference, result.basePatternReference)
  assert.equal(result.log.outputs.best_layout, 'best-layout/')
  assert.equal(result.log.validation.passed, true)
  assert.equal(result.log.validation.fallback_used, true)
  assert.ok(Array.isArray(result.log.design_sequence) && result.log.design_sequence.length > 0)
  assert.ok(Array.isArray(result.log.internal_candidates) && result.log.internal_candidates.length >= 1)
  assert.equal(result.log.selected_candidate.candidate_id, result.selected.candidateId)
  assert.deepEqual(result.log.input.image_orientations, ['square', 'square'])
  assert.ok(result.log.diversity_control)
  assert.ok('user_preference_context' in result.log)

  rmSync(srcDir, { recursive: true, force: true })
  rmSync(outputsRoot, { recursive: true, force: true })
  rmSync(logsDir, { recursive: true, force: true })
})

test('a title adds one real compiled title-page (Noto Sans KR) ahead of the normal pages', async () => {
  const srcDir = mkdtempSync(join(tmpdir(), 'imprint-it-src-'))
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const { diversityHistoryPath, userFeedbackPath, dir: logsDir } = isolatedLogPaths()
  const imgPath = join(srcDir, 'photo.png')
  writeFileSync(imgPath, Buffer.from(TINY_PNG_BASE64, 'base64'))

  const withoutTitle = await runGeneration({
    imagePaths: [imgPath],
    text: '가나다',
    outputsRoot,
    fontsDir: FONTS_DIR,
    date: new Date(2026, 6, 8, 12, 0),
    seq: 1,
    llmOptions: { mockMode: true },
    diversityHistoryPath,
    userFeedbackPath,
  })
  const withTitle = await runGeneration({
    imagePaths: [imgPath],
    text: '가나다',
    title: '어떤 여름',
    outputsRoot,
    fontsDir: FONTS_DIR,
    date: new Date(2026, 6, 8, 12, 1),
    seq: 1,
    llmOptions: { mockMode: true },
    diversityHistoryPath,
    userFeedbackPath,
  })

  assert.equal(withTitle.compile.ok, true, `compile with title failed: ${JSON.stringify(withTitle.compile)}`)
  const realPageCount = await getPdfPageCount(join(withTitle.dir, 'pages.pdf'))
  assert.equal(realPageCount, withTitle.pageCount)
  assert.equal(withTitle.pageCount, withoutTitle.pageCount + 1, 'adding a title should add exactly one page')

  assert.equal(withTitle.log.input.title, '어떤 여름')
  assert.equal(withoutTitle.log.input.title, null)

  rmSync(srcDir, { recursive: true, force: true })
  rmSync(outputsRoot, { recursive: true, force: true })
  rmSync(logsDir, { recursive: true, force: true })
})

test('diversity control: repeating the same mock-fallback shape 4 times triggers a repetition penalty on the 4th (checked against the prior 3 recorded runs)', async () => {
  const srcDir = mkdtempSync(join(tmpdir(), 'imprint-it-src-'))
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const { diversityHistoryPath, userFeedbackPath, dir: logsDir } = isolatedLogPaths()
  const imgPath = join(srcDir, 'photo.png')
  writeFileSync(imgPath, Buffer.from(TINY_PNG_BASE64, 'base64'))

  let last
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    last = await runGeneration({
      imagePaths: [imgPath],
      text: '가나다',
      outputsRoot,
      fontsDir: FONTS_DIR,
      date: new Date(2026, 6, 8, 13, i),
      seq: 1,
      llmOptions: { mockMode: true },
      diversityHistoryPath,
      userFeedbackPath,
    })
  }

  assert.equal(last.log.diversity_control.repetition_penalty_applied, true)

  rmSync(srcDir, { recursive: true, force: true })
  rmSync(outputsRoot, { recursive: true, force: true })
  rmSync(logsDir, { recursive: true, force: true })
})
