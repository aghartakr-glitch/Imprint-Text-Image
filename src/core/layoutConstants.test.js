import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PAGE_WIDTH_MM, PAGE_HEIGHT_MM, MARGIN_TOP_MM, MARGIN_BOTTOM_MM,
  MARGIN_INNER_MM, MARGIN_OUTER_MM, TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM,
  CHAR_WIDTH_MM, LINE_HEIGHT_MM,
} from './layoutConstants.js'

test('page and text-box dimensions match PRD 4.6', () => {
  assert.equal(PAGE_WIDTH_MM, 148)
  assert.equal(PAGE_HEIGHT_MM, 210)
  assert.equal(MARGIN_TOP_MM, 16)
  assert.equal(MARGIN_BOTTOM_MM, 18)
  assert.equal(MARGIN_INNER_MM, 18)
  assert.equal(MARGIN_OUTER_MM, 14)
  assert.equal(TEXT_BOX_WIDTH_MM, 148 - 18 - 14)
  assert.equal(TEXT_BOX_HEIGHT_MM, 210 - 16 - 18)
})

test('char/line size derived from 9pt/14pt typography', () => {
  assert.ok(Math.abs(CHAR_WIDTH_MM - 9 * 0.3528) < 1e-9)
  assert.ok(Math.abs(LINE_HEIGHT_MM - 14 * 0.3528) < 1e-9)
})
