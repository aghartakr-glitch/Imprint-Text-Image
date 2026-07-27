import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTextBlocksAdvanced } from './parseTextBlocksAdvanced.js'

test('parseTextBlocksAdvanced: HEAR MY VOICE test case (6 paragraphs)', () => {
  const testText = `
The voice has power. Social activism and corporate responsibility increasingly intersect. Brands that authentically engage with social causes build deeper connections with their audiences.

메가 트렌드와 함께, 기업은 사회적 영향력을 고려해야 합니다. This macro trend shapes modern marketing.

Z세대는 기업의 가치관을 추적합니다. They demand transparency and authentic commitment.

1960년 카네기 홀에서의 시위는 역사적인 순간이었습니다. This protest case demonstrates the power of collective voice against institutional barriers.

Dove의 #NoDigitalDistortion 캠페인은 미의 기준에 도전합니다. Their commitment to authentic beauty resonates across generations.

Sweaty Betty의 'Wear The Damn Shorts' 캠페인은 여성의 자유로움을 표현합니다. This bold statement celebrates confidence without compromise.
  `.trim()

  const result = parseTextBlocksAdvanced({
    title: 'HEAR MY VOICE 목소리를 내다',
    text: testText,
  })

  // Check paragraph count
  assert.equal(result.paragraph_count, 6, '정확히 6개 문단이어야 함')

  // Check text blocks array
  assert.equal(result.text_blocks.length, 6, '6개의 text block이 생성되어야 함')

  // Check IDs
  result.text_blocks.forEach((block, i) => {
    assert.equal(block.id, `paragraph_${i + 1}`, `ID는 paragraph_${i + 1}이어야 함`)
  })

  // Roles are now structural (2026-07-27, gap analysis P0-2): the first paragraph is the lead by
  // POSITION, and every other full-sentence paragraph is body. Brand/topic keyword roles
  // (trend_context / audience_value / protest_case / brand_case) and the extracted `brand` field
  // are gone -- they only ever matched this one document.
  assert.equal(result.text_blocks[0].role, 'lead', '첫 문단은 위치상 lead')
  result.text_blocks.slice(1).forEach((block, i) => {
    assert.equal(block.role, 'body', `${i + 2}번째 문단은 body (키워드로 역할을 추측하지 않음)`)
  })
  result.text_blocks.forEach((block) => {
    assert.equal(block.brand, undefined, 'brand 필드는 더 이상 존재하지 않아야 함')
  })

  // These are full-sentence prose paragraphs with no short label lines, so there is no repeating
  // entry structure to detect -- correctly false now, where the old keyword matcher said true.
  assert.equal(result.has_case_like_paragraphs, false)
  assert.equal(result.has_modular_blocks, false)

  // Check char counts
  result.text_blocks.forEach((block) => {
    assert.ok(block.char_count > 0, `각 문단의 char_count는 양수여야 함`)
  })

  assert.ok(result.total_chars > 0, 'total_chars는 양수여야 함')
})

// Replaces the old keyword-variation test. The point of the rewrite is that role detection is
// content-independent, so this now checks that a document from a completely different genre (an
// exhibition catalogue: short entry labels followed by prose) gets a usable structure -- which the
// brand-keyword version could never do.
test('detects a repeating entry structure from short label lines, in any genre', () => {
  const result = parseTextBlocksAdvanced({
    title: 'Test',
    text: `이 도록은 2026년 봄 전시의 출품작을 수록한다. 각 작품은 재료와 제작 연도를 함께 기재했다.

기호 문양

조각가는 석회암 표면에 고대 문양을 새겨 넣었다. 표면의 결을 살리기 위해 연마를 최소화했다.

영적 형태

브라질 출신 디자이너가 화강암과 목재를 결합해 만든 연작이다. 전통적인 석조 기법을 현대적으로 재해석했다.`,
  })

  assert.equal(result.text_blocks[0].role, 'lead', '첫 문단은 lead')
  assert.equal(result.text_blocks[1].role, 'entry_label', '짧은 무구두점 한 줄은 entry_label')
  assert.equal(result.text_blocks[2].role, 'body')
  assert.equal(result.text_blocks[3].role, 'entry_label')
  assert.equal(result.text_blocks[4].role, 'body')

  assert.equal(result.has_case_like_paragraphs, true, '반복 항목 구조가 감지되어야 함')
  assert.equal(result.has_modular_blocks, true)
})

test('parseTextBlocksAdvanced: empty text returns empty blocks', () => {
  const result = parseTextBlocksAdvanced({
    title: 'Test',
    text: '',
  })

  assert.equal(result.paragraph_count, 0)
  assert.equal(result.text_blocks.length, 0)
  assert.equal(result.has_modular_blocks, false)
})
