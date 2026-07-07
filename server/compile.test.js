// server/compile.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanupAuxFiles, compileMainTex, compileSpreadPreview, hasXelatex } from './compile.mjs'

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
  assert.ok(typeof result.log === 'string' && result.log.length > 0, 'log should be a non-empty string')

  rmSync(dir, { recursive: true, force: true })
})

test('cleanupAuxFiles swallows per-file unlink failures instead of throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'imprint-it-cleanup-'))

  // Force one of the "files" cleanupAuxFiles tries to remove to actually be a
  // directory. unlinkSync on a directory throws (EPERM/EISDIR), which is the
  // same failure shape a locked/in-use file would produce. A real OS-level
  // file lock is impractical to simulate reliably in a test, but this exercises
  // the exact code path: existsSync(p) is true, unlinkSync(p) throws, and the
  // per-file try/catch must swallow it without aborting the loop.
  mkdirSync(join(dir, 'main.aux'))
  writeFileSync(join(dir, 'main.log'), 'dummy log content', 'utf-8')
  writeFileSync(join(dir, 'main.out'), 'dummy out content', 'utf-8')

  assert.doesNotThrow(() => cleanupAuxFiles(dir, 'main'))

  // The unlinkable "aux" directory is left behind (best-effort, not fatal)...
  assert.ok(existsSync(join(dir, 'main.aux')), 'the locked/unremovable entry is left in place')
  // ...but the loop still proceeded to clean up the other, removable files.
  assert.ok(!existsSync(join(dir, 'main.log')), 'other aux files should still be cleaned up')
  assert.ok(!existsSync(join(dir, 'main.out')), 'other aux files should still be cleaned up')

  rmSync(dir, { recursive: true, force: true })
})

test('compileMainTex still succeeds when aux files were already removed before cleanup runs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'imprint-it-compile-precleaned-'))
  writeFileSync(join(dir, 'main.tex'), '\\documentclass{article}\n\\begin{document}Hello\\end{document}\n', 'utf-8')

  const result = await compileMainTex(dir)

  assert.equal(result.ok, true, 'compile should succeed even though cleanupAuxFiles runs against files that may not all exist')
  assert.ok(existsSync(join(dir, 'pages.pdf')))
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
