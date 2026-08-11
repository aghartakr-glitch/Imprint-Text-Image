import { test } from 'node:test'
import assert from 'node:assert/strict'
import { refineLayout } from './refineLayout.js'

function pageWithImage(box, objectPosition, fit = 'cover') {
  return {
    type: 'layout-plan-page',
    images: [{
      path: '/img0.jpg', ...box, fullBleed: false, objectPosition, fit,
    }],
    textZone: null,
    textSlice: null,
  }
}

// Cover-crop is now opt-in. Explicit fit:"cover" images keep the box and crop the spill; default
// fit:"contain" images preserve the whole source image without crop metadata.
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



test('a contain image keeps the planned box without cover-crop metadata', () => {
  const box = { xMm: 10, yMm: 10, wMm: 60, hMm: 60 }
  const result = refineLayout([pageWithImage(box, 'center', 'contain')], { imagePaths: ['/img0.jpg'], imageAspectRatios: [0.5] })
  const img = result.resolvedPages[0].images[0]
  assert.equal(img.xMm, 10)
  assert.equal(img.yMm, 10)
  assert.equal(img.wMm, 60)
  assert.equal(img.hMm, 60)
  assert.equal(img.cover, undefined)
  assert.equal(result.refinements.object_position_adjusted, false)
})


// Reverted 2026-08-04 per user feedback: cover-cropping a full-bleed image to fill both
// dimensions cuts off part of a landscape photo just to eliminate empty space -- unwanted. A
// full-bleed image without an explicit fit:'cover' must render uncropped (plain contain), same as
// any other image; buildLatex.js's keepaspectratio then picks the binding dimension from the
// photo's own aspect ratio, leaving a gap on the other axis instead of cropping it away.
test('a full-bleed image without explicit fit:cover is left uncropped (contain, not cover)', () => {
  const page = {
    type: 'full-bleed', images: [{
      path: '/img0.jpg', xMm: 0, yMm: 0, wMm: 148, hMm: 210, fullBleed: true,
    }], textZone: null, textSlice: null,
  }
  const result = refineLayout([page], { imagePaths: ['/img0.jpg'], imageAspectRatios: [1.5] })
  const img = result.resolvedPages[0].images[0]
  // Box untouched: a full-bleed image still spans the whole page.
  assert.equal(img.xMm, 0)
  assert.equal(img.yMm, 0)
  assert.equal(img.wMm, 148)
  assert.equal(img.hMm, 210)
  assert.equal(img.fit, 'contain')
  assert.equal(img.cover, undefined, 'must not be cover-cropped without an explicit fit:cover')
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

  const result = refineLayout(pages, { imagePaths: ['/img0.jpg'], imageAspectRatios: [1.5], columns: 1 })
  const img = result.resolvedPages[1].images[0]
  assert.ok(img.wMm * img.hMm > 30 * 20 * 1.35, 'image should be materially larger than the thumbnail placement')
  assert.ok(img.yMm >= 124, 'image should stay below the existing text with the text-image gap')
  assert.equal(img.cover, undefined)
  assert.ok(Math.abs((img.wMm / img.hMm) - 1.5) < 1e-9, 'upscaled sparse image should preserve source ratio')
  assert.equal(result.refinements.sparse_spread_images_upscaled, true)
})
test('a one-column contain image with nearby body text is promoted to a multi-column editorial image', () => {
  const pages = [{
    type: 'layout-plan-page',
    images: [{ path: '/img0.jpg', xMm: 0, yMm: 0, wMm: 55.333, hMm: 95.625, fullBleed: false, fit: 'contain' }],
    textBlocks: [{
      id: 'body',
      role: 'body',
      zone: { xMm: 0, yMm: 101.625, wMm: 55.333, hMm: 100 },
      slice: '본문'.repeat(80),
    }],
  }]

  const result = refineLayout(pages, {
    imagePaths: ['/img0.jpg'],
    imageAspectRatios: [0.58],
    boxWidthMm: 178,
    boxHeightMm: 265,
    columns: 3,
    gutterMm: 6,
  })

  const page = result.resolvedPages[0]
  const img = page.images[0]
  const body = page.textBlocks[0]

  assert.ok(img.wMm > 100, 'image should be promoted beyond a single 3-column track')
  assert.ok(img.hMm > 170, 'portrait image should remain visible instead of a small tile')
  assert.equal(img.cover, undefined)
  assert.equal(img.fit, 'contain')
  assert.ok(Math.abs((img.wMm / img.hMm) - 0.58) < 0.01, 'promoted image should preserve source ratio')
  assert.ok(body.zone.xMm > img.xMm + img.wMm, 'body should move into the remaining side column')
  assert.ok(body.zone.hMm > 250, 'body should use the page height beside the image')
  assert.equal(result.refinements.column_trapped_images_promoted, true)
})

test('a one-column image in a five-column grid is promoted to a three-column image with two columns for body text', () => {
  const pages = [{
    type: 'layout-plan-page',
    images: [{ path: '/img0.jpg', xMm: 0, yMm: 0, wMm: 31.6, hMm: 54.6, fullBleed: false, fit: 'contain' }],
    textBlocks: [{
      id: 'body',
      role: 'body',
      zone: { xMm: 0, yMm: 60, wMm: 31.6, hMm: 100 },
      slice: '본문'.repeat(80),
    }],
  }]

  const result = refineLayout(pages, {
    imagePaths: ['/img0.jpg'],
    imageAspectRatios: [0.58],
    boxWidthMm: 178,
    boxHeightMm: 265,
    columns: 5,
    gutterMm: 5,
  })

  const page = result.resolvedPages[0]
  const img = page.images[0]
  const body = page.textBlocks[0]

  assert.ok(img.wMm > 100, '5-column image should span about three columns, not stay in one narrow column')
  assert.ok(body.zone.wMm > 60, 'body should receive the remaining two-column reading measure')
  assert.ok(body.zone.xMm > img.xMm + img.wMm, 'body should sit beside the promoted image')
  assert.equal(result.refinements.column_trapped_images_promoted, true)
})
