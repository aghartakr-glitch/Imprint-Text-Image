// server/runGeneration.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { runGeneration } from './runGeneration.mjs'
import { FONTS_DIR } from './env.mjs'

const run = promisify(exec)

async function getPdfPageCount(pdfPath) {
  const { stdout } = await run(`pdfinfo "${pdfPath}"`)
  const match = stdout.match(/^Pages:\s+(\d+)/m)
  if (!match) throw new Error(`pdfinfo 출력에서 페이지 수를 찾을 수 없습니다: ${stdout}`)
  return Number(match[1])
}

// A real, fully valid 1x1 PNG (not just a header) so XeLaTeX's \includegraphics can embed it.
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

test('runGeneration produces exactly ONE real, compiled best-layout result via grid layout_plan (mock mode = deterministic fallback)', async () => {
  const srcDir = mkdtempSync(join(tmpdir(), 'imprint-it-src-'))
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const imgPath = join(srcDir, 'photo.png')
  writeFileSync(imgPath, Buffer.from(TINY_PNG_BASE64, 'base64'))

  const result = await runGeneration({
    imagePaths: [imgPath, imgPath],
    text: '가나다라마바사아자차카파타하'.repeat(50),
    outputsRoot,
    fontsDir: FONTS_DIR,
    date: new Date(2026, 6, 6, 10, 30),
    seq: 1,
    llmOptions: { mockMode: true },
  })

  assert.equal(result.llmResult.fallbackUsed, true) // mock mode always uses the deterministic fallback
  assert.ok(['image-first', 'balanced', 'text-first'].includes(result.layoutFamily))
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
  assert.equal(result.log.layout_settings.selection_mode, 'llm_constrained_layout_plan')
  assert.equal(result.log.layout_settings.base_pattern_reference, result.basePatternReference)
  assert.equal(result.log.outputs.best_layout, 'best-layout/')
  assert.equal(result.log.validation.passed, true)
  assert.equal(result.log.validation.fallback_used, true)
  assert.deepEqual(result.log.input.image_orientations, ['square', 'square'])

  rmSync(srcDir, { recursive: true, force: true })
  rmSync(outputsRoot, { recursive: true, force: true })
})

test('a title adds one real compiled title-page (Noto Sans KR) ahead of the normal pages', async () => {
  const srcDir = mkdtempSync(join(tmpdir(), 'imprint-it-src-'))
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const imgPath = join(srcDir, 'photo.png')
  writeFileSync(imgPath, Buffer.from(TINY_PNG_BASE64, 'base64'))

  const withoutTitle = await runGeneration({
    imagePaths: [imgPath],
    text: '가나다',
    outputsRoot,
    fontsDir: FONTS_DIR,
    date: new Date(2026, 6, 6, 12, 0),
    seq: 1,
    llmOptions: { mockMode: true },
  })
  const withTitle = await runGeneration({
    imagePaths: [imgPath],
    text: '가나다',
    title: '어떤 여름',
    outputsRoot,
    fontsDir: FONTS_DIR,
    date: new Date(2026, 6, 6, 12, 1),
    seq: 1,
    llmOptions: { mockMode: true },
  })

  assert.equal(withTitle.compile.ok, true, `compile with title failed: ${JSON.stringify(withTitle.compile)}`)
  const realPageCount = await getPdfPageCount(join(withTitle.dir, 'pages.pdf'))
  assert.equal(realPageCount, withTitle.pageCount)
  assert.equal(withTitle.pageCount, withoutTitle.pageCount + 1, 'adding a title should add exactly one page')

  assert.equal(withTitle.log.input.title, '어떤 여름')
  assert.equal(withoutTitle.log.input.title, null)

  rmSync(srcDir, { recursive: true, force: true })
  rmSync(outputsRoot, { recursive: true, force: true })
})
