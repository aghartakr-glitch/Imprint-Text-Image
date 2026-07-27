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

// Replaces 'infers roles from keywords' (2026-07-27, gap analysis P0-2). Roles must come from form,
// never from subject matter, so this asserts the same document shape produces the same roles
// whatever the words are -- the property the brand-keyword version could not satisfy.
test('parseDocumentStructure: infers roles from form, identically across unrelated subject matter', () => {
  const shape = (a, b, c) => `${a}\n\n${b}\n\n${c}`

  const trendReport = parseDocumentStructure({
    title: 'Test',
    text: shape(
      '커뮤니티 액티비즘',
      '스웨티 베티는 스포츠 액티비스트와 협업하여 새로운 스포츠 히잡을 선보였습니다. 활동적인 움직임에도 흐트러지지 않도록 설계했습니다.',
      '기호 문양',
    ),
  })
  const novel = parseDocumentStructure({
    title: 'Test',
    text: shape(
      '첫 번째 밤',
      '그는 오래된 계단을 천천히 내려갔다. 아래층에서 들려오는 소리는 점점 또렷해지고 있었다. 문 앞에서 잠시 멈춰 섰다.',
      '두 번째 밤',
    ),
  })

  assert.deepEqual(
    trendReport.text_blocks.map((b) => b.role),
    novel.text_blocks.map((b) => b.role),
    '같은 형식이면 내용과 무관하게 같은 역할이 나와야 함',
  )
  // A short unpunctuated line is a label; the multi-sentence paragraph is body.
  assert.equal(novel.text_blocks[0].role, 'section_label')
  assert.equal(novel.text_blocks[1].role, 'body')
  assert.equal(novel.text_blocks[2].role, 'section_label')
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
test('parseDocumentStructure: long ### lines are body, not inferred back into section_label', () => {
  const result = parseDocumentStructure({
    title: 'Test',
    text: `## 맥락에 맞는 컬러
## CONTEXT RELEVANT COLOR
### 건강기능식품 브랜드 Feel Menopause는 패키지 디자인에 대담한 핑크색을 사용하여 여성들에게 자신감과 힘을 부여하는 이미지를 전달합니다.`,
  })

  assert.equal(result.text_blocks[0].role, 'section_label')
  assert.equal(result.text_blocks[1].role, 'section_label')
  assert.equal(result.text_blocks[2].role, 'body')
  assert.equal(result.text_blocks[2].downgraded_heading_level, 3)
  assert.equal(result.text_blocks[2].group_id, 0)
})
