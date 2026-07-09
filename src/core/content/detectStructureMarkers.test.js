import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectStructureMarkers, hasLightweightMarkers, hasExplicitTags } from './detectStructureMarkers.js'

test('detectStructureMarkers: recognizes Markdown headings', () => {
  const markers = detectStructureMarkers(`# Title

## Section

### Subsection`)

  const headings = markers.filter((m) => m.type?.startsWith('heading_'))
  assert.equal(headings.length, 3)
})

test('detectStructureMarkers: recognizes separators', () => {
  const markers = detectStructureMarkers(`Text

---

More text`)

  const separators = markers.filter((m) => m.type === 'separator')
  assert.equal(separators.length, 1)
})

test('detectStructureMarkers: recognizes lists', () => {
  const markers = detectStructureMarkers(`Intro

1. First
2. Second
3. Third`)

  const lists = markers.filter((m) => m.type?.startsWith('list_'))
  assert.equal(lists.length, 3)
})

test('detectStructureMarkers: recognizes quote blocks', () => {
  const markers = detectStructureMarkers(`Text

> This is a quote
> More quote`)

  const quotes = markers.filter((m) => m.type === 'quote_block')
  assert.equal(quotes.length, 2)
})

test('detectStructureMarkers: recognizes explicit tags', () => {
  const markers = detectStructureMarkers(`[INTRO]

Text here

[CASE]

More text`)

  const tags = markers.filter((m) => m.type === 'explicit_tag')
  assert.equal(tags.length, 2)
})

test('hasLightweightMarkers: returns true for headings', () => {
  const result = hasLightweightMarkers(`# Title

Content`)
  assert.equal(result, true)
})

test('hasLightweightMarkers: returns false for plain text', () => {
  const result = hasLightweightMarkers(`Plain text here.

Another paragraph.`)
  assert.equal(result, false)
})

test('hasExplicitTags: detects tags', () => {
  const result = hasExplicitTags(`[INTRO]

Content`)
  assert.equal(result, true)
})

test('hasExplicitTags: returns false without tags', () => {
  const result = hasExplicitTags(`# Title

Content`)
  assert.equal(result, false)
})
