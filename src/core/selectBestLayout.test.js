import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectBestLayout } from './selectBestLayout.js'

function candidate(id, total, overrides = {}) {
  return {
    candidateId: id,
    repaired: false,
    qualityScore: {
      total, readability: 1, visual_balance: 1, hierarchy: 1, whitespace: 1, image_text_relation: 1,
    },
    ...overrides,
  }
}

test('picks the highest total score', () => {
  const { selected } = selectBestLayout([candidate('a', 3.5), candidate('b', 4.5), candidate('c', 2)])
  assert.equal(selected.candidateId, 'b')
})

test('on a tie, prefers the candidate that needed no repair', () => {
  const { selected } = selectBestLayout([
    candidate('repaired', 4, { repaired: true }),
    candidate('clean', 4, { repaired: false }),
  ])
  assert.equal(selected.candidateId, 'clean')
})

test('on a further tie, prefers better readability (proxy for text capacity)', () => {
  const { selected } = selectBestLayout([
    candidate('low-read', 4, { qualityScore: { total: 4, readability: 0.5, visual_balance: 1, hierarchy: 1, whitespace: 1, image_text_relation: 1 } }),
    candidate('high-read', 4, { qualityScore: { total: 4, readability: 1, visual_balance: 1, hierarchy: 1, whitespace: 1, image_text_relation: 1 } }),
  ])
  assert.equal(selected.candidateId, 'high-read')
})

test('ranked list is sorted best-first', () => {
  const { ranked } = selectBestLayout([candidate('a', 3), candidate('b', 5), candidate('c', 4)])
  assert.deepEqual(ranked.map((r) => r.candidateId), ['b', 'c', 'a'])
})

test('throws for an empty candidate list', () => {
  assert.throws(() => selectBestLayout([]))
})
