import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePageLayout } from './resolvePageLayout.js'
import { TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM, PAGE_WIDTH_MM, PAGE_HEIGHT_MM, IMAGE_TEXT_GAP_MM } from './layoutConstants.js'

const imagePaths = ['/a.jpg', '/b.jpg']

test('title-page fills the full text box, no images, carries the title string', () => {
  const layout = resolvePageLayout({ type: 'title-page', title: '어떤 여름' }, 1, imagePaths)
  assert.equal(layout.images.length, 0)
  assert.deepEqual(layout.textZone, { xMm: 0, yMm: 0, wMm: TEXT_BOX_WIDTH_MM, hMm: TEXT_BOX_HEIGHT_MM })
  assert.equal(layout.textSlice, null)
  assert.equal(layout.title, '어떤 여름')
})

test('text-only page fills the full text box, no images', () => {
  const layout = resolvePageLayout({ type: 'text-only', textSlice: '가나다' }, 1, imagePaths)
  assert.equal(layout.images.length, 0)
  assert.deepEqual(layout.textZone, { xMm: 0, yMm: 0, wMm: TEXT_BOX_WIDTH_MM, hMm: TEXT_BOX_HEIGHT_MM })
  assert.equal(layout.textSlice, '가나다')
})

test('full-bleed-image page spans the whole physical page, ignoring margins', () => {
  const layout = resolvePageLayout({ type: 'full-bleed-image', imageIndices: [0], textSlice: null }, 1, imagePaths)
  assert.equal(layout.images.length, 1)
  assert.deepEqual(layout.images[0], { path: '/a.jpg', xMm: 0, yMm: 0, wMm: PAGE_WIDTH_MM, hMm: PAGE_HEIGHT_MM, fullBleed: true })
  assert.equal(layout.textZone, null)
})

test('image-top-text-bottom splits the margin box into image + text zone with a gap', () => {
  const layout = resolvePageLayout(
    { type: 'image-top-text-bottom', imageIndices: [1], imageHeightMm: 90, textSlice: '본문' },
    2,
    imagePaths,
  )
  assert.deepEqual(layout.images[0], { path: '/b.jpg', xMm: 0, yMm: 0, wMm: TEXT_BOX_WIDTH_MM, hMm: 90, fullBleed: false })
  assert.equal(layout.textZone.yMm, 90 + IMAGE_TEXT_GAP_MM)
  assert.equal(layout.textZone.hMm, TEXT_BOX_HEIGHT_MM - 90 - IMAGE_TEXT_GAP_MM)
})

test('image-top-text-bottom with no textSlice omits the text zone', () => {
  const layout = resolvePageLayout(
    { type: 'image-top-text-bottom', imageIndices: [0], imageHeightMm: 90, textSlice: null },
    1,
    imagePaths,
  )
  assert.equal(layout.textZone, null)
})

test('image-grid resolves "all" to every image, full-bleed on the page', () => {
  const layout = resolvePageLayout({ type: 'image-grid', imageIndices: 'all', textSlice: null }, 2, imagePaths)
  assert.equal(layout.images.length, 2)
  assert.ok(layout.images.every((img) => img.fullBleed === true))
})

test('image-grid-margin arranges images inside the margin box with text below', () => {
  const layout = resolvePageLayout(
    { type: 'image-grid-margin', imageIndices: 'all', gridHeightMm: 120, textSlice: '본문' },
    2,
    imagePaths,
  )
  assert.equal(layout.images.length, 2)
  assert.ok(layout.images.every((img) => img.fullBleed === false))
  assert.equal(layout.textZone.yMm, 120 + IMAGE_TEXT_GAP_MM)
})

test('unknown page type throws descriptive error', () => {
  assert.throws(
    () => resolvePageLayout({ type: 'invalid-type' }, 1, imagePaths),
    /알 수 없는 페이지 타입/,
  )
})
