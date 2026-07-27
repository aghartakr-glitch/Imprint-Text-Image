import assert from 'assert'
import { parseMarkdownDocument, stripMarkdownHeadingMarkers } from './parseMarkdownDocument.js'

// Test Fixture 1: Markdown with title and headings
const fixture1 = {
  title: '# Main Title',
  text: `## Section One
Some body text here.

### Subsection
More text.

Body paragraph after heading.`,
}

// Test Fixture 2: Multi-heading line (Korean + English)
const fixture2 = {
  title: null,
  text: `### 커뮤니티 액티비즘
### COMMUNITY ACTIVISM
Body text describing the activism section.`,
}

// Test Fixture 3: Text with no markdown
const fixture3 = {
  title: '제목',
  text: `첫 번째 문단입니다.

두 번째 문단입니다.`,
}

// Test 1: Parse title with markdown
function test1() {
  const result = parseMarkdownDocument({ title: '# Main Title', text: '' })
  assert.strictEqual(result.title, 'Main Title', 'Title should strip # marker')
  assert.strictEqual(result.title_role, 'title', 'Title should have role=title')
  console.log('✓ Test 1: Parse title with markdown')
}

// Test 2: Parse body with multiple headings
function test2() {
  const result = parseMarkdownDocument(fixture1)
  assert(Array.isArray(result.text_blocks), 'Should return array of text_blocks')
  assert(result.text_blocks.length >= 3, 'Should have at least 3 blocks (two headings + body)')

  const headingBlocks = result.text_blocks.filter((b) => b.role !== 'body')
  assert(headingBlocks.length >= 2, 'Should have at least 2 heading blocks')

  const bodyBlocks = result.text_blocks.filter((b) => b.role === 'body')
  assert(bodyBlocks.length >= 1, 'Should have at least 1 body block')

  // Verify no markers remain in text
  result.text_blocks.forEach((block) => {
    assert(!block.text.startsWith('#'), `Block text should not start with #: "${block.text.substring(0, 30)}"`)
  })

  console.log('✓ Test 2: Parse body with multiple headings')
}

// Test 3: Verify markers are stripped
function test3() {
  const input = '## Heading with ### nested'
  const result = stripMarkdownHeadingMarkers(input)
  assert(!result.startsWith('##'), 'Should remove leading ##')
  assert.strictEqual(result, 'Heading with ### nested', 'Should preserve inline ###')
  console.log('✓ Test 3: Markers stripped correctly')
}

// Test 4: No markdown input
function test4() {
  const result = parseMarkdownDocument(fixture3)
  const hasMarkers = result.text_blocks.some((b) => b.text.match(/^#+\s/))
  assert(!hasMarkers, 'Plain text should have no markdown markers')
  console.log('✓ Test 4: Plain text parsing')
}

// Test 5: Block count matches paragraph count
function test5() {
  const result = parseMarkdownDocument(fixture1)
  assert.strictEqual(result.block_count, result.text_blocks.length, 'block_count should match array length')
  console.log('✓ Test 5: Block count verification')
}

// Test 6: Markdown level mapping
function test6() {
  const result = parseMarkdownDocument({ title: null, text: `# H1
## H2
### H3` })
  const roles = result.text_blocks.map((b) => b.role)
  assert(roles.includes('title'), 'Should have title role for h1')
  assert(roles.includes('section_label'), 'Should have section_label role for h2')
  assert(roles.includes('case_title_ko'), 'Should have case_title_ko role for h3')
  console.log('✓ Test 6: Markdown level mapping')
}

// Test 7: Bracket markers ([제목]/[소제목]) are a code-safe alternative to #
function test7() {
  const result = parseMarkdownDocument({
    title: null,
    text: `[제목] 메인 타이틀

[소제목] 첫 번째 섹션
본문 내용입니다.`,
  })
  assert.strictEqual(result.text_blocks[0].role, 'title', '[제목] should map to role=title')
  assert.strictEqual(result.text_blocks[0].text, '메인 타이틀', '[제목] marker should be stripped')
  assert.strictEqual(result.text_blocks[1].role, 'section_label', '[소제목] should map to role=section_label')
  assert.strictEqual(result.text_blocks[1].text, '첫 번째 섹션', '[소제목] marker should be stripped')
  assert.strictEqual(result.text_blocks[2].role, 'body')
  console.log('✓ Test 7: [제목]/[소제목] bracket markers parsed correctly')
}

// Test 8: bracket markers work in the title field too, and # still works alongside them
function test8() {
  const titleResult = parseMarkdownDocument({ title: '[제목] 브래킷 제목', text: '' })
  assert.strictEqual(titleResult.title, '브래킷 제목')
  assert.strictEqual(titleResult.title_role, 'title')

  const hashStillWorks = parseMarkdownDocument({ title: null, text: '## 기존 문법도 유지' })
  assert.strictEqual(hashStillWorks.text_blocks[0].role, 'section_label')
  console.log('✓ Test 8: bracket markers in title field, # syntax unaffected')
}

// Test 9: A marker on a long, multi-sentence paragraph is downgraded to body (not bolded as a
// heading and cut off mid-sentence -- confirmed 2026-07-16 real report)
function test9() {
  const longParagraph = '[1] 카네기 국제평화재단(Carnegie Endowment for International Peace)에 따르면, 지난 12개월간 전 세계 73개국 이상에서 규모 있는 시위가 발생했습니다.'
  const result = parseMarkdownDocument({ title: null, text: `### ${longParagraph}` })
  assert.strictEqual(result.text_blocks.length, 1)
  assert.strictEqual(result.text_blocks[0].role, 'body', 'a long marked paragraph should downgrade to body, not stay a heading')
  assert.strictEqual(result.text_blocks[0].text, longParagraph, 'the ### marker should still be stripped even when downgraded')
  console.log('✓ Test 9: long marked paragraph downgrades to body, marker still stripped')
}

// Test 10: A short marker still produces a real heading (regression guard for test 9's fix)
function test10() {
  const result = parseMarkdownDocument({ title: null, text: '### HEAR MY VOICE' })
  assert.strictEqual(result.text_blocks[0].role, 'case_title_ko')
  assert.strictEqual(result.text_blocks[0].text, 'HEAR MY VOICE')
  console.log('✓ Test 10: short heading marker still works')
}

// Test 11: a paragraph typed across multiple physical lines, marked only on its first line,
// stays merged as ONE block instead of splitting into a heading + separate body paragraph
function test11() {
  const result = parseMarkdownDocument({
    title: null,
    text: '### 메가트렌드에서 파생된 매크로트렌드는 소비자들이 글로벌 변화에 반응하며 나타나는 새로운 태도와 행동과 가치 변화들을 의미합니다. 이렇게 변화하는 이슈들을 라이프스타일, 소비문화 관점으로 범주화하여 조사합니다.\n메가 트렌드인 초양극화에 대응합니다.',
  })
  assert.strictEqual(result.text_blocks.length, 1, 'both lines should merge into a single body block')
  assert.ok(result.text_blocks[0].text.includes('메가 트렌드인 초양극화에 대응합니다'))
  console.log('✓ Test 11: multi-line paragraph with a marker only on its first line stays merged')
}

// Test 12: consecutive lines with NO blank line between them (Korean heading + English heading +
// body, exactly the user's real input pattern) share one group_id; a blank line starts a new group.
function test12() {
  const result = parseMarkdownDocument({
    title: null,
    text: `## 손으로 빚은 자유
## CRAFTED LIBERATION
### RK Collective는 버려진 스카프를 재탄생시킵니다.

## 맥락에 맞는 컬러
## CONTEXT RELEVANT COLOR
### 건강기능식품 브랜드 이야기입니다.`,
  })
  assert.strictEqual(result.text_blocks.length, 6)
  const groupIds = result.text_blocks.map((b) => b.group_id)
  assert.deepStrictEqual(groupIds, [0, 0, 0, 1, 1, 1], 'first group (no blank lines) shares group_id 0; second group (after the blank line) shares group_id 1')
  console.log('✓ Test 12: blocks glued with no blank line share one group_id; a blank line starts a new group')
}

// Run all tests
try {
  test1()
  test2()
  test3()
  test4()
  test5()
  test6()
  test7()
  test8()
  test9()
  test10()
  test11()
  test12()
  console.log('\n✓ All parseMarkdownDocument tests passed')
} catch (err) {
  console.error('\n✗ Test failed:', err.message)
  process.exit(1)
}
