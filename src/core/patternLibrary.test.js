import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAvailablePatterns, getPatternById, resolveImageIndices } from './patternLibrary.js'

test('resolveImageIndices expands "all" and passes arrays through', () => {
  assert.deepEqual(resolveImageIndices('all', 3), [0, 1, 2])
  assert.deepEqual(resolveImageIndices([1], 5), [1])
})

test('getAvailablePatterns returns exactly 3 options (image-first/balanced/text-first) per bucket', () => {
  const options = getAvailablePatterns(4)
  assert.equal(options.length, 3)
  const layoutTypes = options.map((o) => o.layoutType).sort()
  assert.deepEqual(layoutTypes, ['balanced', 'image-first', 'text-first'])
  assert.ok(options.every((o) => typeof o.patternId === 'string' && o.patternId.length > 0))
})

test('getAvailablePatterns throws for out-of-range image count', () => {
  assert.throws(() => getAvailablePatterns(0), /이미지 개수/)
  assert.throws(() => getAvailablePatterns(7), /이미지 개수/)
})

test('getPatternById finds the right pattern in the right bucket', () => {
  const p1 = getPatternById(1, 'a-1img-full-bleed')
  assert.equal(p1.layoutType, 'image-first')

  const p2 = getPatternById(2, 'b-2img-top-text-bottom-pair')
  assert.equal(p2.layoutType, 'balanced')

  const p4 = getPatternById(4, 'c-3-4img-text-first-grid')
  assert.equal(p4.layoutType, 'text-first')

  const p6 = getPatternById(6, 'a-5-6img-grid-full-bleed')
  assert.equal(p6.layoutType, 'image-first')
})

test('getPatternById throws for out-of-range image count', () => {
  assert.throws(() => getPatternById(0, 'a-1img-full-bleed'), /이미지 개수/)
  assert.throws(() => getPatternById(7, 'a-1img-full-bleed'), /이미지 개수/)
})

test('getPatternById throws for an unknown pattern id in the correct bucket', () => {
  assert.throws(() => getPatternById(1, 'does-not-exist'), /패턴을 찾을 수 없습니다/)
})
