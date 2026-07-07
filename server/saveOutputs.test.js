import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createRunFolder, saveInputCopies, candidateFolderName, writeCandidateSources, writeGenerationLog,
} from './saveOutputs.mjs'

test('createRunFolder makes a timestamped run dir with input/images inside it', () => {
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const { runId, runDir } = createRunFolder(outputsRoot, { date: new Date(2026, 6, 6, 10, 30), seq: 1 })
  assert.equal(runId, '2026-07-06_1030_001')
  assert.ok(existsSync(join(runDir, 'input', 'images')))
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

test('candidateFolderName maps A/B/C to PRD folder names and rejects anything else', () => {
  assert.equal(candidateFolderName('A'), 'candidate-a_image-first')
  assert.equal(candidateFolderName('B'), 'candidate-b_balanced')
  assert.equal(candidateFolderName('C'), 'candidate-c_text-first')
  assert.throws(() => candidateFolderName('D'), /알 수 없는 후보/)
})

test('writeCandidateSources writes main.tex, page_style.sty, layout.json', () => {
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const { runDir } = createRunFolder(outputsRoot, { date: new Date(2026, 6, 6, 10, 30), seq: 1 })

  const dir = writeCandidateSources(runDir, 'A', {
    mainTex: '\\documentclass{article}',
    styleTex: '\\ProvidesPackage{page_style}',
    layout: { patternId: 'a-1img-full-bleed', pageCount: 2 },
  })

  assert.equal(dir, join(runDir, 'candidate-a_image-first'))
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
