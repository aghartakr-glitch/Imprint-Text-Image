import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateBestLayout } from './generateBestLayout.js'

const imagePaths = ['/img0.jpg']

function onePagePlan() {
  return {
    style: 'Editorial',
    layout_family: 'image-first',
    base_pattern_reference: 'single_page_with_text_below',
    layout_intent: 'test',
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
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    reason: 'test',
  }
}

test('resolves a one-page grid plan into images + text zone + slice, and carries plan metadata through', () => {
  const result = generateBestLayout({
    imagePaths, text: '가나다라마바사아자차카', layoutPlan: onePagePlan(), fontsDir: '/fonts',
  })
  assert.equal(result.style, 'Editorial')
  assert.equal(result.layoutFamily, 'image-first')
  assert.equal(result.basePatternReference, 'single_page_with_text_below')
  assert.equal(result.resolvedPages[0].images.length, 1)
  assert.equal(result.resolvedPages[0].textSlice, '가나다라마바사아자차카')
  assert.match(result.mainTex, /\\documentclass/)
  assert.match(result.styleTex, /page_style/)
})

test('a non-empty title prepends a title-page with no image, before the plan\'s own pages', () => {
  const withTitle = generateBestLayout({
    imagePaths, text: '본문', layoutPlan: onePagePlan(), fontsDir: '/fonts', title: '어떤 여름',
  })
  assert.equal(withTitle.resolvedPages[0].type, 'title-page')
  assert.equal(withTitle.resolvedPages[0].title, '어떤 여름')
  assert.equal(withTitle.resolvedPages[0].images.length, 0)
  assert.equal(withTitle.resolvedPages[1].images.length, 1)
  assert.match(withTitle.mainTex, /\\TitleText\{어떤 여름\}/)
})

test('an empty/whitespace-only title behaves exactly like no title at all', () => {
  const noTitle = generateBestLayout({
    imagePaths, text: '본문', layoutPlan: onePagePlan(), fontsDir: '/fonts',
  })
  const blankTitle = generateBestLayout({
    imagePaths, text: '본문', layoutPlan: onePagePlan(), fontsDir: '/fonts', title: '   ',
  })
  assert.equal(blankTitle.pageCount, noTitle.pageCount)
  assert.notEqual(blankTitle.resolvedPages[0].type, 'title-page')
})

test('long text produces more pages than short text via overflow continuation pages', () => {
  const short = generateBestLayout({
    imagePaths, text: '가나다', layoutPlan: onePagePlan(), fontsDir: '/fonts',
  })
  const long = generateBestLayout({
    imagePaths, text: '가'.repeat(6000), layoutPlan: onePagePlan(), fontsDir: '/fonts',
  })
  assert.ok(long.pageCount > short.pageCount)
})
