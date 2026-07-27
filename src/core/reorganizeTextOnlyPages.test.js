import assert from 'assert'
import { reorganizeTextOnlyPages } from './reorganizeTextOnlyPages.js'
import { TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM, MIN_READABLE_COLUMN_WIDTH_MM } from './layoutConstants.js'

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
  const expectedColWidth = (TEXT_BOX_WIDTH_MM - 4 * 1) / 2 // gutter-aware: (width - gutter*(cols-1)) / cols
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
  const colWidth = (TEXT_BOX_WIDTH_MM - 4 * 1) / 2 // gutter-aware
  const expectedBlock2X = 1 * (colWidth + 4) // col 1: position = col_index * (width + gutter)
  assert.strictEqual(block0.zone.xMm, 0, 'First block should start at x=0')
  assert.strictEqual(block2.zone.xMm, expectedBlock2X, `Third block should be in second column at x=${expectedBlock2X}`)
  console.log('✓ Test 5: Multiple blocks distributed across columns')
}

// Test 6: Column spacing (gutter). columns=1 is never affected by the readable-width cap, so this
// isolates the gutter-aware width formula from the cap tested separately in test8/test9. (A
// columns=3 request used to be asserted here, but raising MIN_READABLE_COLUMN_WIDTH_MM to 45mm
// means 3 columns' 36mm width is now correctly capped down to 2 columns -- that capping behavior
// belongs to test8/test9, not this gutter-math test.)
function test6() {
  const result = reorganizeTextOnlyPages(fixture1, { columns: 1 })
  const expectedWidth = TEXT_BOX_WIDTH_MM // 1 column, no gutter to subtract
  const block = result[0].textBlocks[0]
  assert.strictEqual(block.zone.wMm, expectedWidth, `1-column width should be ${expectedWidth}`)
  console.log('✓ Test 6: Column spacing correct')
}

// Test 7: No column's right edge exceeds the content box, even when text spans every column
// (regression check for the 2026-07-16 132mm-right-edge bug)
function test7() {
  const longText = 'text word '.repeat(400)
  const wideFixture = [{
    type: 'text-only',
    images: [],
    textBlocks: [{ zone: { xMm: 0, yMm: 0, wMm: TEXT_BOX_WIDTH_MM, hMm: TEXT_BOX_HEIGHT_MM }, slice: longText, role: 'body' }],
  }]
  const result = reorganizeTextOnlyPages(wideFixture, { columns: 5 })
  result.forEach((p) => {
    p.textBlocks.forEach((b) => {
      assert.ok(b.zone.xMm + b.zone.wMm <= TEXT_BOX_WIDTH_MM + 1e-9, `column right edge ${b.zone.xMm + b.zone.wMm} exceeds ${TEXT_BOX_WIDTH_MM}`)
      assert.ok(b.zone.yMm + b.zone.hMm <= TEXT_BOX_HEIGHT_MM + 1e-9, `block bottom ${b.zone.yMm + b.zone.hMm} exceeds ${TEXT_BOX_HEIGHT_MM}`)
    })
  })
  console.log('✓ Test 7: no block exceeds content box even when text spans every column and page')
}

// Test 8: a high grid column setting (chosen for image alignment) doesn't force body text into
// unreadably narrow columns (confirmed 2026-07-16: columns=5 produced 23.2mm columns, ~7 Korean
// characters per line)
function test8() {
  const result = reorganizeTextOnlyPages(fixture1, { columns: 5 })
  const block = result[0].textBlocks[0]
  assert.ok(block.zone.wMm >= MIN_READABLE_COLUMN_WIDTH_MM, `column width ${block.zone.wMm} should be at least ${MIN_READABLE_COLUMN_WIDTH_MM}mm`)
  console.log('✓ Test 8: high column count is capped so body text stays readable width')
}

// Test 9: a low column setting that was never too narrow passes through unchanged
function test9() {
  const result = reorganizeTextOnlyPages(fixture1, { columns: 2 })
  const block = result[0].textBlocks[0]
  assert.strictEqual(block.zone.wMm, (TEXT_BOX_WIDTH_MM - 4) / 2, 'columns=2 should be unaffected by the readable-width cap')
  console.log('✓ Test 9: a column count that was already readable is left unchanged')
}

// Test 10: heading-role blocks are left untouched (position/size), only role: 'body' is reflowed
// (confirmed 2026-07-16: reflowing a section_label block with 9pt body-text capacity math gave it
// a box too narrow for its actual bold 14pt rendering, which then visually overflowed into the
// next column)
function test10() {
  const page = {
    type: 'layout-plan-page',
    images: [],
    textBlocks: [
      { zone: { xMm: 0, yMm: 0, wMm: 20, hMm: 19.76 }, slice: 'DESIGN CASE STUDIES', role: 'section_label', id: 'p10' },
      { zone: { xMm: 24, yMm: 0, wMm: 20, hMm: 9.88 }, slice: '커뮤니티 액티비즘', role: 'section_label', id: 'p11' },
      { zone: { xMm: 72, yMm: 0, wMm: 20, hMm: 19.76 }, slice: '스웨티 베티는 스포츠 액티비스트 리파 네사', role: 'body', id: 'p13' },
    ],
  }
  const result = reorganizeTextOnlyPages([page], { columns: 5 })
  const headingBlocks = result[0].textBlocks.filter((b) => b.role === 'section_label')
  assert.deepEqual(headingBlocks.find((b) => b.id === 'p10').zone, { xMm: 0, yMm: 0, wMm: 20, hMm: 19.76 }, 'heading zone should be untouched')
  assert.deepEqual(headingBlocks.find((b) => b.id === 'p11').zone, { xMm: 24, yMm: 0, wMm: 20, hMm: 9.88 }, 'heading zone should be untouched')
  console.log('✓ Test 10: heading-role blocks keep their original position/size, unreflowed')
}

// Test 11: reflowed body text never overlaps an untouched heading block on the same page
function test11() {
  const page = {
    type: 'layout-plan-page',
    images: [],
    textBlocks: [
      { zone: { xMm: 0, yMm: 0, wMm: 20, hMm: 19.76 }, slice: 'DESIGN CASE STUDIES', role: 'section_label', id: 'p10' },
      { zone: { xMm: 24, yMm: 0, wMm: 20, hMm: 9.88 }, slice: '커뮤니티 액티비즘', role: 'section_label', id: 'p11' },
      { zone: { xMm: 48, yMm: 0, wMm: 20, hMm: 14.82 }, slice: 'COMMUNITY ACTIVISM', role: 'section_label', id: 'p12' },
      { zone: { xMm: 72, yMm: 0, wMm: 20, hMm: 19.76 }, slice: '스웨티 베티는 스포츠 액티비스트 리파 네사', role: 'body', id: 'p13' },
    ],
  }
  const result = reorganizeTextOnlyPages([page], { columns: 5 })
  const headings = result[0].textBlocks.filter((b) => b.role === 'section_label')
  const bodies = result[0].textBlocks.filter((b) => b.role === 'body')
  const overlaps = (a, b) => a.xMm < b.xMm + b.wMm && a.xMm + a.wMm > b.xMm && a.yMm < b.yMm + b.hMm && a.yMm + a.hMm > b.yMm
  headings.forEach((h) => {
    bodies.forEach((b) => {
      assert.ok(!overlaps(h.zone, b.zone), `reflowed body ${b.id} should not overlap heading ${h.id}`)
    })
  })
  console.log('✓ Test 11: reflowed body text never overlaps an untouched heading')
}


// Test 12: mixed heading/body overflow pages preserve source order and are not body-only reflowed
function test12() {
  const page = {
    type: 'layout-plan-page',
    images: [],
    textBlocks: [
      { zone: { xMm: 0, yMm: 0, wMm: 116, hMm: 8 }, slice: 'DESIGN', role: 'section_label', id: 'h1' },
      { zone: { xMm: 0, yMm: 11, wMm: 116, hMm: 30 }, slice: '제목 바로 아래에 붙어 있어야 하는 본문입니다.', role: 'body', id: 'b1' },
    ],
  }
  const result = reorganizeTextOnlyPages([page], { columns: 2 })
  assert.strictEqual(result.length, 1, 'mixed pages should remain a single page')
  assert.deepStrictEqual(result[0].textBlocks, page.textBlocks, 'mixed heading/body pages should not be reflowed into detached body columns')
  console.log('✓ Test 12: mixed heading/body text-only pages preserve source order')
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
  console.log('\n✓ All reorganizeTextOnlyPages tests passed')
} catch (err) {
  console.error('\n✗ Test failed:', err.message)
  process.exit(1)
}
