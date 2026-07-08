import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadUserFeedback, logUserFeedback, resetUserFeedback } from './logUserFeedback.js'

test('loadUserFeedback returns [] when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'imprint-it-feedback-'))
  assert.deepEqual(loadUserFeedback(join(dir, 'nested', 'prefs.json')), [])
  rmSync(dir, { recursive: true, force: true })
})

test('logUserFeedback appends an entry and persists it, creating parent dirs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'imprint-it-feedback-'))
  const feedbackPath = join(dir, 'nested', 'user-layout-preferences.json')
  logUserFeedback(feedbackPath, {
    edit_type: 'move_text_down',
    target_element: 'body_1',
    before: { row_start: 6 },
    after: { row_start: 8 },
    interpreted_preference: { text_position_preference: 'lower' },
  })
  const loaded = loadUserFeedback(feedbackPath)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].edit_type, 'move_text_down')
  assert.ok(loaded[0].created_at)
  rmSync(dir, { recursive: true, force: true })
})

test('resetUserFeedback clears all stored entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'imprint-it-feedback-'))
  const feedbackPath = join(dir, 'user-layout-preferences.json')
  logUserFeedback(feedbackPath, { edit_type: 'scale_image_up', target_element: 'image_1' })
  resetUserFeedback(feedbackPath)
  assert.deepEqual(loadUserFeedback(feedbackPath), [])
  rmSync(dir, { recursive: true, force: true })
})
