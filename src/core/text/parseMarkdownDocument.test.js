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

// Run all tests
try {
  test1()
  test2()
  test3()
  test4()
  test5()
  test6()
  console.log('\n✓ All parseMarkdownDocument tests passed')
} catch (err) {
  console.error('\n✗ Test failed:', err.message)
  process.exit(1)
}
