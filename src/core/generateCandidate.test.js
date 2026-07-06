import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateCandidate } from './generateCandidate.js'

const imagePaths = ['/img0.jpg']

test('candidate A for 1 image starts with a full-bleed image page then text', () => {
  const result = generateCandidate({
    imageCount: 1,
    imagePaths,
    text: '가나다라마바사아자차카',
    candidate: 'A',
    style: 'Editorial',
    fontsDir: '/fonts',
  })
  assert.equal(result.patternId, 'a-1img-full-bleed')
  assert.equal(result.resolvedPages[0].type, 'full-bleed-image')
  assert.equal(result.resolvedPages[1].type, 'text-only')
  assert.match(result.mainTex, /\\documentclass/)
  assert.match(result.styleTex, /page_style/)
})

test('style scales the image height for image-top-text-bottom pages (candidate B)', () => {
  const editorial = generateCandidate({
    imageCount: 1, imagePaths, text: '', candidate: 'B', style: 'Editorial', fontsDir: '/fonts',
  })
  const exhibition = generateCandidate({
    imageCount: 1, imagePaths, text: '', candidate: 'B', style: 'Exhibition Catalog', fontsDir: '/fonts',
  })
  const editorialImg = editorial.resolvedPages[0].images[0]
  const exhibitionImg = exhibition.resolvedPages[0].images[0]
  assert.ok(exhibitionImg.hMm > editorialImg.hMm, 'Exhibition Catalog should render a larger image than Editorial')
})

test('long text produces more pages than short text for the same candidate', () => {
  const short = generateCandidate({
    imageCount: 1, imagePaths, text: '가나다', candidate: 'C', style: 'Magazine', fontsDir: '/fonts',
  })
  const long = generateCandidate({
    imageCount: 1, imagePaths, text: '가'.repeat(6000), candidate: 'C', style: 'Magazine', fontsDir: '/fonts',
  })
  assert.ok(long.pageCount > short.pageCount)
})
