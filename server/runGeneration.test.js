// server/runGeneration.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGeneration } from './runGeneration.mjs'
import { FONTS_DIR } from './env.mjs'

// A real, fully valid 1x1 PNG (not just a header) so XeLaTeX's \includegraphics can embed it.
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

test('runGeneration produces 3 real, compiled candidates in mock style mode', async () => {
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

  assert.equal(result.styleResult.source, 'rule-based')
  for (const candidate of ['A', 'B', 'C']) {
    const r = result.candidateResults[candidate]
    assert.equal(r.compile.ok, true, `candidate ${candidate} compile failed: ${JSON.stringify(r.compile)}`)
    assert.equal(r.spread.ok, true, `candidate ${candidate} spread failed: ${JSON.stringify(r.spread)}`)
    assert.ok(existsSync(join(r.dir, 'pages.pdf')))
    assert.ok(existsSync(join(r.dir, 'spread-preview.pdf')))
    assert.ok(existsSync(join(r.dir, 'main.tex')))
    assert.ok(existsSync(join(r.dir, 'layout.json')))
  }
  assert.ok(existsSync(join(result.runDir, 'generation-log.json')))
  assert.ok(existsSync(join(result.runDir, 'input', 'input-text.txt')))

  rmSync(srcDir, { recursive: true, force: true })
  rmSync(outputsRoot, { recursive: true, force: true })
})
