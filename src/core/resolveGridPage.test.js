import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveGridPage } from './resolveGridPage.js'

const imagePaths = ['/img0.jpg', '/img1.jpg']

test('places images at their grid-derived mm boxes and attaches the body text zone/slice', () => {
  const elements = [
    {
      id: 'image_1', type: 'image', role: 'equal', col_start: 1, col_span: 3, row_start: 1, row_span: 6,
    },
    {
      id: 'image_2', type: 'image', role: 'equal', col_start: 4, col_span: 3, row_start: 1, row_span: 6,
    },
    {
      id: 'body_1', type: 'text', role: 'body', col_start: 1, col_span: 6, row_start: 8, row_span: 5,
    },
  ]
  const result = resolveGridPage(elements, imagePaths, { body_1: '본문 일부' })
  assert.equal(result.images.length, 2)
  assert.equal(result.images[0].path, '/img0.jpg')
  assert.equal(result.images[1].path, '/img1.jpg')
  assert.ok(result.images[0].wMm > 0 && result.images[0].hMm > 0)
  assert.equal(result.textZone != null, true)
  assert.equal(result.textSlice, '본문 일부')
})

test('a page with only images has no text zone', () => {
  const elements = [{
    id: 'image_1', type: 'image', role: 'hero', col_start: 1, col_span: 6, row_start: 1, row_span: 12,
  }]
  const result = resolveGridPage(elements, imagePaths, {})
  assert.equal(result.textZone, null)
  assert.equal(result.textSlice, null)
  assert.equal(result.images.length, 1)
})

test('throws if an image element references an upload index that does not exist', () => {
  const elements = [{
    id: 'image_5', type: 'image', role: 'hero', col_start: 1, col_span: 6, row_start: 1, row_span: 12,
  }]
  assert.throws(() => resolveGridPage(elements, imagePaths, {}), /image_5/)
})
