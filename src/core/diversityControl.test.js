import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadRecentLayouts, shouldApplyRepetitionPenalty, recordLayoutUsage, buildDiversityControlLog,
} from './diversityControl.js'

test('loadRecentLayouts returns an empty array when the history file does not exist yet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'imprint-it-diversity-'))
  const historyPath = join(dir, 'nested', 'recent-layouts.json')
  assert.deepEqual(loadRecentLayouts(historyPath), [])
  rmSync(dir, { recursive: true, force: true })
})

test('recordLayoutUsage appends and persists, creating parent directories as needed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'imprint-it-diversity-'))
  const historyPath = join(dir, 'nested', 'recent-layouts.json')
  recordLayoutUsage(historyPath, { layoutFamily: 'balanced', compositionStrategy: 'image_above_text' })
  const loaded = loadRecentLayouts(historyPath)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].compositionStrategy, 'image_above_text')
  rmSync(dir, { recursive: true, force: true })
})

test('shouldApplyRepetitionPenalty triggers once the same strategy appears 3+ times in the last 5', () => {
  const history = [
    { layoutFamily: 'balanced', compositionStrategy: 'image_above_text' },
    { layoutFamily: 'balanced', compositionStrategy: 'image_above_text' },
    { layoutFamily: 'image-first', compositionStrategy: 'full_image' },
  ]
  assert.equal(shouldApplyRepetitionPenalty(history, 'image_above_text'), false) // only 2 so far
  const history2 = [...history, { layoutFamily: 'balanced', compositionStrategy: 'image_above_text' }]
  assert.equal(shouldApplyRepetitionPenalty(history2, 'image_above_text'), true) // now 3
})

test('shouldApplyRepetitionPenalty only looks at the most recent window, not all history', () => {
  const oldRepeats = Array(10).fill({ layoutFamily: 'balanced', compositionStrategy: 'image_above_text' })
  const recentDifferent = [
    { layoutFamily: 'image-first', compositionStrategy: 'full_image' },
    { layoutFamily: 'image-first', compositionStrategy: 'full_image' },
    { layoutFamily: 'image-first', compositionStrategy: 'full_image' },
    { layoutFamily: 'image-first', compositionStrategy: 'full_image' },
    { layoutFamily: 'image-first', compositionStrategy: 'full_image' },
  ]
  assert.equal(shouldApplyRepetitionPenalty([...oldRepeats, ...recentDifferent], 'image_above_text'), false)
})

test('buildDiversityControlLog summarizes the recent window for generation-log.json', () => {
  const history = [
    { layoutFamily: 'balanced', compositionStrategy: 'image_above_text' },
    { layoutFamily: 'balanced', compositionStrategy: 'image_above_text' },
    { layoutFamily: 'image-first', compositionStrategy: 'full_image' },
  ]
  const log = buildDiversityControlLog(history, true)
  assert.deepEqual(log.recent_layout_families, ['balanced', 'balanced', 'image-first'])
  assert.deepEqual(log.recent_composition_strategies, ['image_above_text', 'image_above_text', 'full_image'])
  assert.equal(log.repetition_penalty_applied, true)
})
