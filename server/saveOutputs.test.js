import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createRunFolder, saveInputCopies, writeBestLayoutSources, writeGenerationLog,
} from './saveOutputs.mjs'

test('createRunFolder makes a timestamped run dir with input/images inside it', () => {
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const { runId, runDir } = createRunFolder(outputsRoot, { date: new Date(2026, 6, 6, 10, 30), seq: 1 })
  assert.equal(runId, '2026-07-06_1030_001')
  assert.ok(existsSync(join(runDir, 'input', 'images')))
  rmSync(outputsRoot, { recursive: true, force: true })
})

test('createRunFolder with no seq auto-increments instead of colliding on repeated calls in the same minute', () => {
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const date = new Date(2026, 6, 6, 10, 30)
  const first = createRunFolder(outputsRoot, { date })
  const second = createRunFolder(outputsRoot, { date })
  const third = createRunFolder(outputsRoot, { date })
  assert.equal(first.runId, '2026-07-06_1030_001')
  assert.equal(second.runId, '2026-07-06_1030_002')
  assert.equal(third.runId, '2026-07-06_1030_003')
  assert.ok(existsSync(join(second.runDir, 'input', 'images')))
  rmSync(outputsRoot, { recursive: true, force: true })
})

test('saveInputCopies copies images and writes the text file verbatim', () => {
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const srcDir = mkdtempSync(join(tmpdir(), 'imprint-it-src-'))
  const imgPath = join(srcDir, 'photo.jpg')
  writeFileSync(imgPath, Buffer.from([0xff, 0xd8, 0xff]))

  const { runDir } = createRunFolder(outputsRoot, { date: new Date(2026, 6, 6, 10, 30), seq: 1 })
  const { imageNames } = saveInputCopies(runDir, { imagePaths: [imgPath], text: '본문 텍스트' })

  assert.deepEqual(imageNames, ['photo.jpg'])
  assert.ok(existsSync(join(runDir, 'input', 'images', 'photo.jpg')))
  assert.equal(readFileSync(join(runDir, 'input', 'input-text.txt'), 'utf-8'), '본문 텍스트')

  rmSync(outputsRoot, { recursive: true, force: true })
  rmSync(srcDir, { recursive: true, force: true })
})

test('createRunFolder throws instead of silently reusing an existing run folder', () => {
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const date = new Date(2026, 6, 6, 10, 30)
  createRunFolder(outputsRoot, { date, seq: 1 })
  assert.throws(() => createRunFolder(outputsRoot, { date, seq: 1 }), /이미 존재하는/)
  rmSync(outputsRoot, { recursive: true, force: true })
})

test('saveInputCopies disambiguates duplicate basenames instead of overwriting', () => {
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const srcDir = mkdtempSync(join(tmpdir(), 'imprint-it-src-'))
  const subDir = join(srcDir, 'sub')
  mkdirSync(subDir)
  const file1 = join(srcDir, 'photo.jpg')
  const file2 = join(subDir, 'photo.jpg')
  writeFileSync(file1, Buffer.from([0x01]))
  writeFileSync(file2, Buffer.from([0x02]))

  const { runDir } = createRunFolder(outputsRoot, { date: new Date(2026, 6, 6, 10, 31), seq: 1 })
  const { imageNames } = saveInputCopies(runDir, { imagePaths: [file1, file2], text: 'x' })

  assert.deepEqual(imageNames, ['photo.jpg', 'photo-2.jpg'])
  assert.deepEqual([...readFileSync(join(runDir, 'input', 'images', 'photo.jpg'))], [0x01])
  assert.deepEqual([...readFileSync(join(runDir, 'input', 'images', 'photo-2.jpg'))], [0x02])

  rmSync(outputsRoot, { recursive: true, force: true })
  rmSync(srcDir, { recursive: true, force: true })
})

test('writeBestLayoutSources writes main.tex, page_style.sty, layout.json into best-layout/', () => {
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const { runDir } = createRunFolder(outputsRoot, { date: new Date(2026, 6, 6, 10, 30), seq: 1 })

  const dir = writeBestLayoutSources(runDir, {
    mainTex: '\\documentclass{article}',
    styleTex: '\\ProvidesPackage{page_style}',
    layout: { patternId: 'a-1img-full-bleed', pageCount: 2 },
  })

  assert.equal(dir, join(runDir, 'best-layout'))
  assert.equal(readFileSync(join(dir, 'main.tex'), 'utf-8'), '\\documentclass{article}')
  assert.match(readFileSync(join(dir, 'page_style.sty'), 'utf-8'), /ProvidesPackage/)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf-8')), { patternId: 'a-1img-full-bleed', pageCount: 2 })

  rmSync(outputsRoot, { recursive: true, force: true })
})

test('writeGenerationLog writes the log object as pretty JSON', () => {
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const { runDir } = createRunFolder(outputsRoot, { date: new Date(2026, 6, 6, 10, 30), seq: 1 })
  writeGenerationLog(runDir, { project: 'Imprint(Image+Text)', created_at: '2026-07-06_1030_001' })
  const parsed = JSON.parse(readFileSync(join(runDir, 'generation-log.json'), 'utf-8'))
  assert.equal(parsed.project, 'Imprint(Image+Text)')
  rmSync(outputsRoot, { recursive: true, force: true })
})
