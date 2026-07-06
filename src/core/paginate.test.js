import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paginateContent } from './paginate.js'
import { TEXT_BOX_WIDTH_MM, CHAR_WIDTH_MM, LINE_HEIGHT_MM } from './layoutConstants.js'

test('short text fits entirely on the fixed preset pages, no overflow pages added', () => {
  const pattern = {
    overflowPageType: 'text-only',
    pages: [{ type: 'text-only' }],
  }
  const pages = paginateContent({ pattern, text: '가나다', imageCount: 1 })
  assert.equal(pages.length, 1)
  assert.equal(pages[0].textSlice, '가나다')
})

test('image-top-text-bottom page only gets the text that fits below the image', () => {
  const pattern = {
    overflowPageType: 'text-only',
    pages: [{ type: 'image-top-text-bottom', imageIndices: [0], imageHeightMm: 100 }],
  }
  // capacity for this page's text zone should be small enough that a long text overflows
  const longText = '가'.repeat(5000)
  const pages = paginateContent({ pattern, text: longText, imageCount: 1 })
  assert.ok(pages.length > 1, 'must add overflow text-only pages')
  assert.equal(pages[0].type, 'image-top-text-bottom')
  assert.ok(pages[0].textSlice.length < longText.length)
  assert.equal(pages.at(-1).type, 'text-only')
  const rebuilt = pages.map((p) => p.textSlice).join('')
  assert.equal(rebuilt, longText, 'no characters dropped across pages')
})

test('pages with zero text capacity (full-bleed-image) carry no textSlice', () => {
  const pattern = {
    overflowPageType: 'text-only',
    pages: [{ type: 'full-bleed-image', imageIndices: [0] }],
  }
  const pages = paginateContent({ pattern, text: '', imageCount: 1 })
  assert.equal(pages[0].textSlice, null)
})

test('char/line capacity math matches layout constants', () => {
  const pattern = { overflowPageType: 'text-only', pages: [{ type: 'text-only' }] }
  const charsPerLine = Math.floor(TEXT_BOX_WIDTH_MM / CHAR_WIDTH_MM)
  const lines = Math.floor((210 - 16 - 18) / LINE_HEIGHT_MM)
  const capacity = charsPerLine * lines
  const exact = '가'.repeat(capacity)
  const pages = paginateContent({ pattern, text: exact, imageCount: 1 })
  assert.equal(pages.length, 1)
  assert.equal(pages[0].textSlice.length, capacity)
})
