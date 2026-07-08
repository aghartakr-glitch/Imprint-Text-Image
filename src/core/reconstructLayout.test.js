import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconstructLayout } from './reconstructLayout.js'

function onePagePlan() {
  return {
    grid: { columns: 6, rows: 12 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'image_1', type: 'image', role: 'hero', col_start: 1, col_span: 6, row_start: 1, row_span: 6, fit: 'contain',
        },
        {
          id: 'body_1', type: 'text', role: 'body', col_start: 1, col_span: 6, row_start: 8, row_span: 5,
        },
      ],
    }],
  }
}

test('reconstructs a plan with no title into resolved pages with images + text assigned', () => {
  const pages = reconstructLayout({
    layoutPlan: onePagePlan(), imagePaths: ['/img0.jpg'], text: '가나다',
  })
  assert.equal(pages.length, 1)
  assert.equal(pages[0].images.length, 1)
  assert.equal(pages[0].textSlice, '가나다')
})

test('prepends a title-page when a title is given', () => {
  const pages = reconstructLayout({
    layoutPlan: onePagePlan(), imagePaths: ['/img0.jpg'], text: '가나다', title: '어떤 여름',
  })
  assert.equal(pages.length, 2)
  assert.equal(pages[0].type, 'title-page')
  assert.equal(pages[0].title, '어떤 여름')
  assert.equal(pages[1].images.length, 1)
})
