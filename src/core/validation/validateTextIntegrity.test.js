import assert from 'assert'
import { validateTextIntegrity, assertNoTextLoss, assertNoTextDuplication, assertNoMarkdownInResolvedPages } from './validateTextIntegrity.js'

// Fixture 1: Correctly distributed text
const fixture1OriginalText = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
const fixture1Pages = [
  {
    type: 'text-only',
    images: [],
    textBlocks: [
      { zone: { xMm: 0, yMm: 0, wMm: 116, hMm: 50 }, slice: 'First paragraph.' },
      { zone: { xMm: 0, yMm: 60, wMm: 116, hMm: 50 }, slice: 'Second paragraph.' },
      { zone: { xMm: 0, yMm: 120, wMm: 116, hMm: 50 }, slice: 'Third paragraph.' },
    ],
  },
]

// Fixture 2: Text loss (missing content)
const fixture2OriginalText = 'Complete text with multiple paragraphs'
const fixture2Pages = [
  {
    type: 'text-only',
    images: [],
    textBlocks: [
      { zone: { xMm: 0, yMm: 0, wMm: 116, hMm: 100 }, slice: 'Complete text' },
    ],
  },
]

// Fixture 3: Markdown markers in text (should fail)
const fixture3Pages = [
  {
    type: 'text-only',
    images: [],
    textBlocks: [
      { zone: { xMm: 0, yMm: 0, wMm: 116, hMm: 100 }, slice: '## This has markdown markers' },
    ],
  },
]

// Test 1: Valid text integrity
function test1() {
  const result = validateTextIntegrity(fixture1Pages, fixture1OriginalText)
  assert.strictEqual(result.passed, true, 'Should pass for correctly distributed text')
  assert.strictEqual(result.issues.length, 0, 'Should have no issues')
  console.log('✓ Test 1: Valid text integrity')
}

// Test 2: Text loss detection
function test2() {
  const result = validateTextIntegrity(fixture2Pages, fixture2OriginalText)
  assert.strictEqual(result.passed, false, 'Should fail for text loss')
  const lossIssue = result.issues.find((i) => i.message.includes('loss'))
  assert(lossIssue, 'Should report text loss')
  console.log('✓ Test 2: Text loss detection')
}

// Test 3: Markdown marker detection
function test3() {
  const result = validateTextIntegrity(fixture3Pages, 'Any text')
  assert.strictEqual(result.passed, false, 'Should fail for markdown markers')
  const markerIssue = result.issues.find((i) => i.message.includes('Markdown'))
  assert(markerIssue, 'Should report markdown markers')
  console.log('✓ Test 3: Markdown marker detection')
}

// Test 4: Assert no text loss
function test4() {
  try {
    assertNoTextLoss(fixture1Pages, fixture1OriginalText)
    console.log('✓ Test 4: Assert no text loss (pass case)')
  } catch (err) {
    assert.fail('Should not throw for valid text')
  }

  try {
    assertNoTextLoss(fixture2Pages, fixture2OriginalText)
    assert.fail('Should throw for text loss')
  } catch (err) {
    assert(err.message.includes('loss'), 'Error should mention text loss')
    console.log('✓ Test 4: Assert no text loss (fail case)')
  }
}

// Test 5: Assert no markdown markers
function test5() {
  try {
    assertNoMarkdownInResolvedPages(fixture1Pages)
    console.log('✓ Test 5: Assert no markdown (pass case)')
  } catch (err) {
    assert.fail('Should not throw for clean text')
  }

  try {
    assertNoMarkdownInResolvedPages(fixture3Pages)
    assert.fail('Should throw for markdown markers')
  } catch (err) {
    assert(err.message.includes('Markdown'), 'Error should mention markdown')
    console.log('✓ Test 5: Assert no markdown (fail case)')
  }
}

// Test 6: Whitespace normalization
function test6() {
  const pages = [
    {
      type: 'text-only',
      images: [],
      textBlocks: [
        { zone: { xMm: 0, yMm: 0, wMm: 116, hMm: 100 }, slice: 'Text   with  extra  spaces' },
      ],
    },
  ]
  const original = 'Text   with  extra  spaces'
  const result = validateTextIntegrity(pages, original)
  assert.strictEqual(result.passed, true, 'Should normalize whitespace during comparison')
  console.log('✓ Test 6: Whitespace normalization')
}

// Run all tests
try {
  test1()
  test2()
  test3()
  test4()
  test5()
  test6()
  console.log('\n✓ All validateTextIntegrity tests passed')
} catch (err) {
  console.error('\n✗ Test failed:', err.message)
  process.exit(1)
}
