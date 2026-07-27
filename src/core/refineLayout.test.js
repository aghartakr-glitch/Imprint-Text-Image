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

test('a wide image (ratio 2) in a tall box gets centered vertically, width fills the box', () => {
  const box = {
    xMm: 10, yMm: 10, wMm: 60, hMm: 60,
  }
  const result = refineLayout([pageWithImage(box, 'center')], { imagePaths: ['/img0.jpg'], imageAspectRatios: [2] })
  const img = result.resolvedPages[0].images[0]
  assert.equal(img.wMm, 60)
  assert.ok(Math.abs(img.hMm - 30) < 1e-9) // 60 / ratio(2) = 30
  assert.ok(Math.abs(img.yMm - (10 + 15)) < 1e-9) // vertically centered within the 60mm-tall box
  assert.equal(result.refinements.object_position_adjusted, true)
})

test('object_position=top pins the image to the top of the box instead of centering', () => {
  const box = {
    xMm: 10, yMm: 10, wMm: 60, hMm: 60,
  }
  const result = refineLayout([pageWithImage(box, 'top')], { imagePaths: ['/img0.jpg'], imageAspectRatios: [2] })
  const img = result.resolvedPages[0].images[0]
  assert.equal(img.yMm, 10) // no vertical offset
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