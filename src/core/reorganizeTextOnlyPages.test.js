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

// Test 5: Multiple short blocks are packed vertically before opening a new column
function test5() {
  const result = reorganizeTextOnlyPages(fixture3, { columns: 2 })
  assert.strictEqual(result[0].textBlocks.length, 3, 'Should preserve all text blocks')
  const block0 = result[0].textBlocks[0]
  const block2 = result[0].textBlocks[2]
  assert.strictEqual(block0.zone.xMm, 0, 'First block should start at x=0')
  assert.strictEqual(block2.zone.xMm, 0, 'Short blocks should keep filling the first column while vertical space remains')
  assert.ok(block2.zone.yMm > block0.zone.yMm, 'Later short blocks should stack below earlier blocks')
  console.log('✓ Test 5: Multiple short blocks pack vertically before opening a new column')
}

// Test 6: Column spacing (gutter), and that a requested column count is honored exactly -- no
// readable-width downgrade. (Per user decision 2026-08-04: a user picking N columns must always
// get N columns; readability at narrow widths is their call, not this function's to override.)
function test6() {
  const result = reorganizeTextOnlyPages(fixture1, { columns: 1 })
  const expectedWidth = TEXT_BOX_WIDTH_MM // 1 column, no gutter to subtract
  const block = result[0].textBlocks[0]
  assert.strictEqual(block.zone.wMm, expectedWidth, `1-column width should be ${expectedWidth}`)
  console.log('✓ Test 6: Column spacing correct')
}

// Test 6b: columns=3 on A5's ~116mm content width used to be silently downgraded to 2 columns
// because 36mm fell under the old 45mm readable-width floor. It must now come back as exactly 3.
function test6b() {
  const result = reorganizeTextOnlyPages(fixture1, { columns: 3 })
  const expectedWidth = (TEXT_BOX_WIDTH_MM - 4 * 2) / 3
  const block = result[0].textBlocks[0]
  assert.strictEqual(block.zone.wMm, expectedWidth, `columns=3 should produce ${expectedWidth}mm columns, not be downgraded to 2`)
  console.log('✓ Test 6b: a requested column count is never silently downgraded')
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

// Test 8: a high grid column setting (chosen for image alignment) is honored exactly, even though
// it produces narrow columns -- readability used to silently override this (confirmed 2026-07-16:
// columns=5 produced 23.2mm columns), but per user decision (2026-08-04) the requested column
// count always wins; the user explicitly asked for it.
function test8() {
  const result = reorganizeTextOnlyPages(fixture1, { columns: 5 })
  const expectedWidth = (TEXT_BOX_WIDTH_MM - 4 * 4) / 5
  const block = result[0].textBlocks[0]
  assert.strictEqual(block.zone.wMm, expectedWidth, `columns=5 should produce ${expectedWidth}mm columns, not be capped wider`)
  console.log('✓ Test 8: a high column count is never silently capped')
}

// Test 9: a low column setting that was never affected by the old cap still behaves the same
function test9() {
  const result = reorganizeTextOnlyPages(fixture1, { columns: 2 })
  const block = result[0].textBlocks[0]
  assert.strictEqual(block.zone.wMm, (TEXT_BOX_WIDTH_MM - 4) / 2, 'columns=2 should be unaffected either way')
  console.log('✓ Test 9: a column count that was already readable is left unchanged')
}

// Test 10: heading-role blocks are reflowed with role-aware height, not body metrics.
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
  const expectedWidth = (TEXT_BOX_WIDTH_MM - 4 * 4) / 5
  assert.ok(headingBlocks.every((b) => b.zone.wMm === expectedWidth), `headings should use the requested column width (${expectedWidth}mm), not a readability-capped one`)
  assert.ok(headingBlocks.every((b) => b.zone.hMm >= 3), 'headings should reserve role-aware height')
  console.log('✓ Test 10: heading-role blocks reflow with role-aware height')
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


// Test 12: mixed heading/body pages reflow together, preserving order and adjacency.
function test12() {
  const page = {
    type: 'layout-plan-page',
    images: [],
    textBlocks: [
      { zone: { xMm: 0, yMm: 0, wMm: 116, hMm: 8 }, slice: 'DESIGN', role: 'section_label', id: 'h1', group_id: 1 },
      { zone: { xMm: 0, yMm: 11, wMm: 116, hMm: 30 }, slice: '제목 바로 아래에 붙어 있어야 하는 본문입니다.', role: 'body', id: 'b1', group_id: 1 },
    ],
  }
  const result = reorganizeTextOnlyPages([page], { columns: 2 })
  assert.strictEqual(result.length, 1, 'mixed pages should remain a single page when content fits')
  assert.deepStrictEqual(result[0].textBlocks.map((b) => b.id), ['h1', 'b1'])
  assert.ok(result[0].textBlocks[1].zone.yMm > result[0].textBlocks[0].zone.yMm, 'body should stay after heading')
  console.log('✓ Test 12: mixed heading/body text-only pages reflow together')
}

// Test 13: consecutive image-only pages are interrupted by the next available text-only page.
function test13() {
  const pages = [
    { type: 'image-only', images: [{ path: '/1.jpg' }], textBlocks: [] },
    { type: 'image-only', images: [{ path: '/2.jpg' }], textBlocks: [] },
    { type: 'text-only', images: [], textBlocks: [{ zone: { xMm: 0, yMm: 0, wMm: 116, hMm: 30 }, slice: 'Text should interrupt image clustering.', role: 'body', id: 'b1' }] },
  ]
  const result = reorganizeTextOnlyPages(pages, { columns: 2 })
  assert.strictEqual(result[0].images.length, 1)
  assert.strictEqual(result[1].images.length, 0)
  assert.strictEqual(result[2].images.length, 1)
  console.log('✓ Test 13: consecutive image-only pages are interrupted by text')
}
// Run all tests
try {
  test1()
  test2()
  test3()
  test4()
  test5()
  test6()
  test6b()
  test7()
  test8()
  test9()
  test10()
  test11()
  test12()
  test13()
  console.log('\n✓ All reorganizeTextOnlyPages tests passed')
} catch (err) {
  console.error('\n✗ Test failed:', err.message)
  process.exit(1)
}
