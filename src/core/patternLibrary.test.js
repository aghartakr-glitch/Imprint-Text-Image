import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getCandidatePattern, resolveImageIndices } from './patternLibrary.js'

test('resolveImageIndices expands "all" and passes arrays through', () => {
  assert.deepEqual(resolveImageIndices('all', 3), [0, 1, 2])
  assert.deepEqual(resolveImageIndices([1], 5), [1])
})

test('getCandidatePattern picks the right bucket for image count', () => {
  const p1 = getCandidatePattern(1, 'A')
  assert.equal(p1.patternId, 'a-1img-full-bleed')

  const p2 = getCandidatePattern(2, 'B')
  assert.equal(p2.patternId, 'b-2img-top-text-bottom-pair')

  const p4 = getCandidatePattern(4, 'C')
  assert.equal(p4.patternId, 'c-3-4img-text-first-grid')

  const p6 = getCandidatePattern(6, 'A')
  assert.equal(p6.patternId, 'a-5-6img-grid-full-bleed')
})

test('getCandidatePattern throws for out-of-range image count', () => {
  assert.throws(() => getCandidatePattern(0, 'A'), /이미지 개수/)
  assert.throws(() => getCandidatePattern(7, 'A'), /이미지 개수/)
})

test('getCandidatePattern throws for unknown candidate letter', () => {
  assert.throws(() => getCandidatePattern(1, 'D'), /후보/)
})
