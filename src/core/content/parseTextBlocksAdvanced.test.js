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

  // Check roles
  assert.equal(result.text_blocks[0].role, 'intro_definition', '첫 문단은 intro_definition')
  assert.equal(result.text_blocks[1].role, 'trend_context', '메가 트렌드 포함 문단은 trend_context')
  assert.equal(result.text_blocks[2].role, 'audience_value', 'Z세대 포함 문단은 audience_value')
  assert.equal(result.text_blocks[3].role, 'protest_case', '시위 포함 문단은 protest_case')
  assert.equal(result.text_blocks[4].role, 'brand_case', 'Dove 포함 문단은 brand_case')
  assert.equal(result.text_blocks[5].role, 'brand_case', 'Sweaty Betty 포함 문단은 brand_case')

  // Check brand names
  assert.equal(result.text_blocks[4].brand, 'Dove', 'Dove 문단에 brand 속성 있어야 함')
  assert.equal(result.text_blocks[5].brand, 'Sweaty Betty', 'Sweaty Betty 문단에 brand 속성 있어야 함')

  // Check modular detection
  assert.equal(result.has_modular_blocks, true, '모듈식 블록 감지되어야 함')
  assert.equal(result.has_case_like_paragraphs, true, '케이스 같은 문단 감지되어야 함')

  // Check char counts
  result.text_blocks.forEach((block) => {
    assert.ok(block.char_count > 0, `각 문단의 char_count는 양수여야 함`)
  })

  assert.ok(result.total_chars > 0, 'total_chars는 양수여야 함')
})

test('parseTextBlocksAdvanced: role detection works with keyword variations', () => {
  const result = parseTextBlocksAdvanced({
    title: 'Test',
    text: `Introduction paragraph.

매크로 트렌드에 대해 말하자면.

Gen Z is different.

LGBTQ+ rights matter.

Dove is amazing.`,
  })

  assert.equal(result.text_blocks[1].role, 'trend_context', '매크로 트렌드 감지')
  assert.equal(result.text_blocks[2].role, 'audience_value', 'Gen Z 감지')
  assert.equal(result.text_blocks[3].role, 'protest_case', 'LGBTQ+ 감지')
  assert.equal(result.text_blocks[4].role, 'brand_case', 'Dove 감지')
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
