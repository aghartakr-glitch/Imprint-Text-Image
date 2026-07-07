// server/compile.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileMainTex, compileSpreadPreview, hasXelatex } from './compile.mjs'

test('hasXelatex reports true on this machine (TeX Live 2026 installed)', async () => {
  assert.equal(await hasXelatex(), true)
})

test('compileMainTex turns main.tex into pages.pdf and cleans up aux files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'imprint-it-compile-'))
  writeFileSync(join(dir, 'main.tex'), '\\documentclass{article}\n\\begin{document}Hello\\end{document}\n', 'utf-8')

  const result = await compileMainTex(dir)

  assert.equal(result.ok, true)
  assert.ok(existsSync(join(dir, 'pages.pdf')))
  assert.ok(!existsSync(join(dir, 'main.pdf')), 'main.pdf should be renamed to pages.pdf')
  assert.ok(!existsSync(join(dir, 'main.aux')), 'aux files should be cleaned up')

  rmSync(dir, { recursive: true, force: true })
})

test('compileSpreadPreview wraps pages.pdf into a 296x210mm spread PDF', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'imprint-it-spread-'))
  writeFileSync(join(dir, 'main.tex'), '\\documentclass{article}\n\\begin{document}Hello\\end{document}\n', 'utf-8')
  await compileMainTex(dir)

  const result = await compileSpreadPreview(dir)

  assert.equal(result.ok, true)
  assert.ok(existsSync(join(dir, 'spread-preview.pdf')))
  assert.ok(!existsSync(join(dir, '_spread_wrapper.tex')), 'temp wrapper tex should be removed')

  rmSync(dir, { recursive: true, force: true })
})

test('compileMainTex fails gracefully when main.tex is missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'imprint-it-missing-'))
  await assert.rejects(() => compileMainTex(dir), /main\.tex 없음/)
  rmSync(dir, { recursive: true, force: true })
})
