import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeContentStructure } from './contentStructure.js'

test('reports title and body presence/length, subtitle/section_label/page_number always false (not collected yet)', () => {
  const result = analyzeContentStructure({ title: '어떤 여름', text: '본문 내용입니다' })
  assert.equal(result.has_title, true)
  assert.equal(result.title_length_chars, 5)
  assert.equal(result.has_body, true)
  assert.equal(result.body_length_chars, 8)
  assert.equal(result.has_subtitle, false)
  assert.equal(result.has_section_label, false)
  assert.equal(result.has_page_number, false)
})

test('a blank/whitespace title counts as no title', () => {
  const result = analyzeContentStructure({ title: '   ', text: '본문' })
  assert.equal(result.has_title, false)
  assert.equal(result.title_length_chars, 0)
})
