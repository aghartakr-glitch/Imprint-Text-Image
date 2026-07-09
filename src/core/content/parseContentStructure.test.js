import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseContentStructure } from './parseContentStructure.js'

test('parseContentStructure detects intro paragraph (short, no period)', () => {
  const result = parseContentStructure({
    title: '제목',
    text: 'A brief intro without a period\n\nBigger body paragraph. With period.',
  })
  assert.equal(result.has_intro, true)
  assert.equal(result.intro_body, 'A brief intro without a period')
  assert.equal(result.has_body, true)
  assert.equal(result.body_paragraphs.length, 1)
})

test('parseContentStructure treats 150+ char first paragraph as body, not intro', () => {
  const longText = 'x'.repeat(151) // Over 150 char threshold
  const result = parseContentStructure({
    title: '제목',
    text: `${longText}\n\nSecond paragraph.`,
  })
  assert.equal(result.has_intro, false)
  assert.equal(result.has_body, true)
  assert.equal(result.body_paragraphs.length, 2)
})

test('parseContentStructure detects case study pattern (Korean + English title)', () => {
  const result = parseContentStructure({
    title: '사례연구',
    text: `편집디자인
EDITORIAL DESIGN
첫 번째 사례

타이포그래피
TYPOGRAPHY
두 번째 사례`,
  })
  assert.equal(result.has_cases, true)
  assert.equal(result.case_study_items?.length, 2)
})

test('parseContentStructure detects numbered items pattern', () => {
  const result = parseContentStructure({
    title: '진행절차',
    text: `1. First step
2. Second step
3. Third step`,
  })
  assert.equal(result.has_numbered, true)
  assert.equal(result.numbered_items?.length, 3)
})

test('parseContentStructure returns empty body when cases/numbered detected', () => {
  const result = parseContentStructure({
    title: '사례',
    text: `편집디자인
EDITORIAL DESIGN
본문

타이포그래피
TYPOGRAPHY
다른 본문`,
  })
  assert.equal(result.has_cases, true)
  assert.equal(result.body_paragraphs?.length, 0)
})

test('parseContentStructure handles empty/null title gracefully', () => {
  const result = parseContentStructure({
    title: null,
    text: 'Some body text here.',
  })
  assert.equal(result.title, null)
  assert.equal(result.total_paragraphs, 1)
})
