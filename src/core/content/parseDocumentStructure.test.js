import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDocumentStructure } from './parseDocumentStructure.js'

test('parseDocumentStructure: lightweight markers recognized', () => {
  const result = parseDocumentStructure({
    title: 'HEAR MY VOICE 목소리를 내다',
    text: `# Introduction

Paragraph one about trends.

## Community Activism

카네기 홀에서의 시위는 역사입니다.

### Dove Campaign

도브의 #NoDigitalDistortion 캠페인`,
  })

  assert.equal(result.has_lightweight_markers, true)
  assert.ok(result.document_structure.sections.length > 0)
})

test('parseDocumentStructure: blank lines separate paragraphs', () => {
  const result = parseDocumentStructure({
    title: 'Test',
    text: `First paragraph here.

Second paragraph over here.

Third paragraph below.`,
  })

  assert.equal(result.paragraph_count, 3)
  assert.equal(result.text_blocks.length, 3)
})

test('parseDocumentStructure: infers roles from keywords', () => {
  const result = parseDocumentStructure({
    title: 'Test',
    text: `메가 트렌드에 대해 이야기합니다.

Z세대는 다릅니다.

카네기 홀에서의 시위.

도브의 캠페인입니다.`,
  })

  const roles = result.text_blocks.map((b) => b.role)
  assert.ok(roles.includes('intro_definition') || roles.includes('context'))
  assert.ok(roles.includes('audience_value'))
  assert.ok(roles.includes('protest_case'))
  assert.ok(roles.includes('brand_case'))
})

test('parseDocumentStructure: does not merge body_all by default', () => {
  const result = parseDocumentStructure({
    title: 'Test',
    text: `Paragraph 1.

Paragraph 2.

Paragraph 3.`,
  })

  assert.equal(result.merged_body_all, false)
  assert.equal(result.text_blocks.length, 3)
})

test('parseDocumentStructure: detects lists', () => {
  const result = parseDocumentStructure({
    title: 'Test',
    text: `Overview paragraph.

1. First item
2. Second item
3. Third item`,
  })

  const listBlocks = result.text_blocks.filter((b) => b.type === 'list_item')
  assert.ok(listBlocks.length > 0)
})

test('parseDocumentStructure: infers text layout mode', () => {
  const result = parseDocumentStructure({
    title: 'Test',
    text: `# Introduction

Intro text.

## Case 1

Case paragraph with keywords.

## Case 2

Another case paragraph.`,
  })

  assert.ok(['hybrid_flow', 'modular_blocks'].includes(result.text_layout_mode))
})

test('parseDocumentStructure: handles empty text', () => {
  const result = parseDocumentStructure({
    title: 'Test',
    text: '',
  })

  assert.equal(result.paragraph_count, 0)
  assert.equal(result.text_blocks.length, 0)
})
