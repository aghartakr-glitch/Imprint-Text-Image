import { test } from 'node:test'
import assert from 'node:assert/strict'
import { refineLayout } from './refineLayout.js'

function pageWithImage(box, objectPosition) {
  return {
    type: 'layout-plan-page',
    images: [{
      path: '/img0.jpg', ...box, fullBleed: false, objectPosition,
    }],
    textZone: null,
    textSlice: null,
  }
}

// Cover-crop semantics (2026-07-27, user decision): the image box stays EXACTLY the planned grid
// box -- aspect ratio is preserved by rendering oversize and cropping the spill, never by shrinking
// the box. The previous letterbox-contain behavior shrank and centered the image, which produced
// ragged tops/bottoms between side-by-side images and a phantom "indent" before portrait images
// (both circled by the user on real output).
test('a wide image (ratio 2) in a square box keeps the box and crops the horizontal spill evenly', () => {
  const box = {
    xMm: 10, yMm: 10, wMm: 60, hMm: 60,
  }
  const result = refineLayout([pageWithImage(box, 'center')], { imagePaths: ['/img0.jpg'], imageAspectRatios: [2] })
  const img = result.resolvedPages[0].images[0]
  // Box untouched: edges stay on the grid lines.
  assert.equal(img.xMm, 10)
  assert.equal(img.yMm, 10)
  assert.equal(img.wMm, 60)
  assert.equal(img.hMm, 60)
  // Rendered at 60mm tall * ratio 2 = 120mm wide; 60mm of spill split evenly left/right.
  assert.ok(Math.abs(img.cover.renderWMm - 120) < 1e-9)
  assert.ok(Math.abs(img.cover.trimLeftMm - 30) < 1e-9)
  assert.ok(Math.abs(img.cover.trimRightMm - 30) < 1e-9)
  assert.equal(img.cover.trimTopMm, 0)
  assert.equal(img.cover.trimBottomMm, 0)
  assert.equal(result.refinements.object_position_adjusted, true)
})

test('object_position=top keeps the top of a tall image and crops only the bottom', () => {
  const box = {
    xMm: 10, yMm: 10, wMm: 60, hMm: 60,
  }
  const result = refineLayout([pageWithImage(box, 'top')], { imagePaths: ['/img0.jpg'], imageAspectRatios: [0.5] })
  const img = result.resolvedPages[0].images[0]
  // Rendered at 60mm wide / ratio 0.5 = 120mm tall; all 60mm of spill cropped from the bottom.
  assert.ok(Math.abs(img.cover.renderHMm - 120) < 1e-9)
  assert.equal(img.cover.trimTopMm, 0)
  assert.ok(Math.abs(img.cover.trimBottomMm - 60) < 1e-9)
})

test('a full-bleed image (e.g. title-page has none, but any fullBleed image) is left untouched', () => {
  const page = {
    type: 'full-bleed', images: [{
      path: '/img0.jpg', xMm: 0, yMm: 0, wMm: 148, hMm: 210, fullBleed: true,
    }], textZone: null, textSlice: null,
  }
  const result = refineLayout([page], { imagePaths: ['/img0.jpg'], imageAspectRatios: [1.5] })
  assert.deepEqual(result.resolvedPages[0].images[0], page.images[0])
})

test('flags a page with no images and no text as empty', () => {
  const emptyPage = {
    type: 'layout-plan-page', images: [], textZone: null, textSlice: null,
  }
  const result = refineLayout([emptyPage], {})
  assert.ok(result.refinements.notes.some((n) => n.includes('비어 있습니다')))
})

test('a title-page with no images/text is not flagged as empty (it has its own title text)', () => {
  const titlePage = {
    type: 'title-page', images: [], textZone: { xMm: 0, yMm: 0, wMm: 100, hMm: 100 }, textSlice: null, title: '제목',
  }
  const result = refineLayout([titlePage], {})
  assert.equal(result.refinements.notes.length, 0)
})

test('a tiny single image in a spread is enlarged into available page whitespace', () => {
  const pages = [
    { type: 'layout-plan-page', images: [], textBlocks: [] },
    {
      type: 'layout-plan-page',
      images: [{ path: '/img0.jpg', xMm: 40, yMm: 150, wMm: 30, hMm: 20, fullBleed: false, objectPosition: 'center' }],
      textBlocks: [{ id: 'body', zone: { xMm: 0, yMm: 0, wMm: 116, hMm: 120 }, slice: '본문', role: 'body' }],
    },
  ]

  const result = refineLayout(pages, { imagePaths: ['/img0.jpg'], imageAspectRatios: [1.5] })
  const img = result.resolvedPages[1].images[0]
  assert.ok(img.wMm * img.hMm > 30 * 20 * 1.35, 'image should be materially larger than the thumbnail placement')
  assert.ok(img.yMm >= 124, 'image should stay below the existing text with the text-image gap')
  assert.equal(result.refinements.sparse_spread_images_upscaled, true)
})