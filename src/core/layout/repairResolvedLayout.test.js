import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repairResolvedLayout } from './repairResolvedLayout.js'
import { validateResolvedLayout } from '../validation/validateResolvedLayout.js'

test('a text block overlapping an image is pushed below it, not merely clamped', () => {
  const resolvedPages = [{
    images: [{ id: 'image_1', xMm: 0, yMm: 0, wMm: 116, hMm: 60 }],
    textBlocks: [{ id: 'p2_text', zone: { xMm: 0, yMm: 40, wMm: 116, hMm: 40 } }],
  }]

  const before = validateResolvedLayout(resolvedPages)
  assert.equal(before.passed, false)

  const { pages, actions } = repairResolvedLayout({ resolvedPages, contentWidthMm: 116, contentHeightMm: 176 })
  const after = validateResolvedLayout(pages)

  assert.equal(after.passed, true, JSON.stringify(after.error_issues))
  assert.ok(actions.some((a) => a.type === 'push_down_textblock'))
  assert.ok(pages[0].textBlocks[0].zone.yMm >= 60 + 4, 'text should sit at least the 4mm text-image gap below the image bottom')
})

test('reproduces the real failure: 3 text blocks each overlapping an image on their page, all repaired', () => {
  // Shape mirrors the actual generation log: multiple pages, one image + one text block each,
  // where every text block starts at the same y as its page's image (a real overlap).
  const resolvedPages = [
    {
      images: [{ id: 'image_1', xMm: 0, yMm: 0, wMm: 56, hMm: 80 }],
      textBlocks: [{ id: 'p2_text', zone: { xMm: 0, yMm: 0, wMm: 56, hMm: 60 } }],
    },
    {
      images: [{ id: 'image_2', xMm: 0, yMm: 0, wMm: 56, hMm: 80 }],
      textBlocks: [
        { id: 'p3_text', zone: { xMm: 0, yMm: 10, wMm: 56, hMm: 50 } },
        { id: 'p4_text', zone: { xMm: 60, yMm: 0, wMm: 56, hMm: 30 } },
      ],
    },
  ]

  const before = validateResolvedLayout(resolvedPages)
  assert.equal(before.passed, false)
  assert.ok(before.error_issues.some((i) => i.type === 'text_image_overlap'))

  const { pages } = repairResolvedLayout({ resolvedPages, contentWidthMm: 116, contentHeightMm: 176 })
  const after = validateResolvedLayout(pages)

  assert.equal(after.passed, true, JSON.stringify(after.error_issues))
})

test('a block that cannot fit below without exceeding page height is reported as unresolved, not silently overlapping', () => {
  const resolvedPages = [{
    images: [{ id: 'image_1', xMm: 0, yMm: 0, wMm: 116, hMm: 170 }],
    textBlocks: [{ id: 'p1_text', zone: { xMm: 0, yMm: 100, wMm: 116, hMm: 50 } }],
  }]

  const { pages, unresolvedIssues } = repairResolvedLayout({ resolvedPages, contentWidthMm: 116, contentHeightMm: 176 })

  assert.ok(unresolvedIssues.length > 0)
  // Left in its original (still-overlapping) position rather than fabricating an invalid fix.
  assert.equal(pages[0].textBlocks[0].zone.yMm, 100)
})

test('non-overlapping elements are left untouched (no spurious actions)', () => {
  const resolvedPages = [{
    images: [{ id: 'image_1', xMm: 0, yMm: 0, wMm: 116, hMm: 60 }],
    textBlocks: [{ id: 'p1_text', zone: { xMm: 0, yMm: 70, wMm: 116, hMm: 50 } }],
  }]

  const { pages, actions } = repairResolvedLayout({ resolvedPages, contentWidthMm: 116, contentHeightMm: 176 })

  assert.equal(actions.length, 0)
  assert.equal(pages[0].textBlocks[0].zone.yMm, 70)
})

test('two images overlapping each other are repositioned vertically', () => {
  const resolvedPages = [{
    images: [
      { id: 'image_1', xMm: 0, yMm: 0, wMm: 116, hMm: 80 },
      { id: 'image_2', xMm: 0, yMm: 40, wMm: 116, hMm: 80 },  // overlaps first image vertically
    ],
    textBlocks: [],
  }]

  const before = validateResolvedLayout(resolvedPages)
  assert.equal(before.passed, false)

  const { pages } = repairResolvedLayout({ resolvedPages, contentWidthMm: 116, contentHeightMm: 176 })
  const after = validateResolvedLayout(pages)

  assert.equal(after.passed, true, JSON.stringify(after.error_issues))
  // Second image should be pushed below first (80 + 3mm gap = 83mm minimum)
  assert.ok(pages[0].images[1].yMm >= 83, 'image_2 should sit at least 3mm below image_1')
})
