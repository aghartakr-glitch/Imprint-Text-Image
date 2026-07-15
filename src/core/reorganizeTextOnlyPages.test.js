import assert from 'assert'
import { reorganizeTextOnlyPages } from './reorganizeTextOnlyPages.js'
import { TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM } from './layoutConstants.js'

// Fixture 1: Single text block, convert to 2-column
const fixture1 = [
  {
    type: 'text-only',
    images: [],
    textBlocks: [
      {
        zone: { xMm: 0, yMm: 0, wMm: TEXT_BOX_WIDTH_MM, hMm: TEXT_BOX_HEIGHT_MM },
        slice: 'This is a long text that should be distributed across two columns.',
        role: 'body',
      },
    ],
  },
]

// Fixture 2: Pages with images (should not be reorganized)
const fixture2 = [
  {
    type: 'image-text',
    images: [{ xMm: 0, yMm: 0, wMm: 50, hMm: 100, path: '/test.jpg' }],
    textBlocks: [
      {
        zone: { xMm: 0, yMm: 110, wMm: TEXT_BOX_WIDTH_MM, hMm: 50 },
        slice: 'Text below image',
        role: 'body',
      },
    ],
  },
]

// Fixture 3: Multiple text blocks on text-only page
const fixture3 = [
  {
    type: 'text-only',
    images: [],
    textBlocks: [
      {
        zone: { xMm: 0, yMm: 0, wMm: TEXT_BOX_WIDTH_MM, hMm: 50 },
        slice: 'Block 1',
        role: 'body',
      },
      {
        zone: { xMm: 0, yMm: 60, wMm: TEXT_BOX_WIDTH_MM, hMm: 50 },
        slice: 'Block 2',
        role: 'body',
      },
      {
        zone: { xMm: 0, yMm: 120, wMm: TEXT_BOX_WIDTH_MM, hMm: 50 },
        slice: 'Block 3',
        role: 'body',
      },
    ],
  },
]

// Test 1: Text-only page converted to multi-column
function test1() {
  const result = reorganizeTextOnlyPages(fixture1, { columns: 2 })
  assert.strictEqual(result.length, 1, 'Should have 1 page')
  assert.strictEqual(result[0].textBlocks.length, 1, 'Should have 1 text block (layout width unchanged)')
  const block = result[0].textBlocks[0]
  const expectedColWidth = TEXT_BOX_WIDTH_MM / 2
  assert.strictEqual(block.zone.wMm, expectedColWidth, `Column width should be ${expectedColWidth}`)
  console.log('✓ Test 1: Multi-column layout created')
}

// Test 2: Pages with images not reorganized
function test2() {
  const result = reorganizeTextOnlyPages(fixture2, { columns: 2 })
  assert.strictEqual(result.length, 1, 'Should have 1 page')
  assert.strictEqual(result[0].textBlocks[0].zone.wMm, TEXT_BOX_WIDTH_MM, 'Should keep original width for image pages')
  console.log('✓ Test 2: Image pages not reorganized')
}

// Test 3: No width overflow (critical 176mm bug check)
function test3() {
  const result = reorganizeTextOnlyPages(fixture1, { columns: 2 })
  const block = result[0].textBlocks[0]
  assert(block.zone.wMm <= TEXT_BOX_WIDTH_MM, `Width should not exceed TEXT_BOX_WIDTH_MM (116mm), got ${block.zone.wMm}`)
  assert(block.zone.wMm !== TEXT_BOX_HEIGHT_MM, `Width should not be TEXT_BOX_HEIGHT_MM (176mm), got ${block.zone.wMm}`)
  console.log('✓ Test 3: No width overflow (176mm bug check)')
}

// Test 4: Column count validation
function test4() {
  const result = reorganizeTextOnlyPages(fixture1, { columns: 0 }) // Invalid, should default to 1
  const block = result[0].textBlocks[0]
  assert(block.zone.wMm <= TEXT_BOX_WIDTH_MM, 'Should handle invalid column count')
  console.log('✓ Test 4: Column count validation')
}

// Test 5: Multiple blocks distributed across columns
function test5() {
  const result = reorganizeTextOnlyPages(fixture3, { columns: 2 })
  assert.strictEqual(result[0].textBlocks.length, 3, 'Should preserve all text blocks')
  // With 3 blocks and 2 columns: ceil(3/2) = 2 blocks per column
  // Column 0: blocks 0-1; Column 1: block 2
  const block0 = result[0].textBlocks[0]
  const block2 = result[0].textBlocks[2] // Third block should be in second column
  const colWidth = TEXT_BOX_WIDTH_MM / 2
  const expectedBlock2X = 1 * (colWidth + 4) // col 1: position = col_index * (width + gutter)
  assert.strictEqual(block0.zone.xMm, 0, 'First block should start at x=0')
  assert.strictEqual(block2.zone.xMm, expectedBlock2X, `Third block should be in second column at x=${expectedBlock2X}`)
  console.log('✓ Test 5: Multiple blocks distributed across columns')
}

// Test 6: Column spacing (gutter)
function test6() {
  const result = reorganizeTextOnlyPages(fixture1, { columns: 3 })
  const colWidth = TEXT_BOX_WIDTH_MM / 3
  const block = result[0].textBlocks[0]
  const expectedWidth = colWidth
  assert.strictEqual(block.zone.wMm, expectedWidth, `3-column width should be ${expectedWidth}`)
  console.log('✓ Test 6: Column spacing correct')
}

// Run all tests
try {
  test1()
  test2()
  test3()
  test4()
  test5()
  test6()
  console.log('\n✓ All reorganizeTextOnlyPages tests passed')
} catch (err) {
  console.error('\n✗ Test failed:', err.message)
  process.exit(1)
}
