import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeGridBoxes } from './gridLayout.js'

test('1 image fills the whole bounding box', () => {
  const boxes = computeGridBoxes(1, { xMm: 0, yMm: 0, wMm: 100, hMm: 50 })
  assert.equal(boxes.length, 1)
  assert.deepEqual(boxes[0], { xMm: 0, yMm: 0, wMm: 100, hMm: 50 })
})

test('4 images form a 2x2 grid with gaps', () => {
  const boxes = computeGridBoxes(4, { xMm: 0, yMm: 0, wMm: 100, hMm: 100 }, 4)
  assert.equal(boxes.length, 4)
  // row height = (100 - 4) / 2 = 48; col width = (100 - 4) / 2 = 48
  assert.deepEqual(boxes[0], { xMm: 0, yMm: 0, wMm: 48, hMm: 48 })
  assert.deepEqual(boxes[1], { xMm: 52, yMm: 0, wMm: 48, hMm: 48 })
  assert.deepEqual(boxes[2], { xMm: 0, yMm: 52, wMm: 48, hMm: 48 })
  assert.deepEqual(boxes[3], { xMm: 52, yMm: 52, wMm: 48, hMm: 48 })
})

test('6 images form 2 rows of 3', () => {
  const boxes = computeGridBoxes(6, { xMm: 0, yMm: 0, wMm: 90, hMm: 60 }, 0)
  assert.equal(boxes.length, 6)
  assert.equal(boxes[0].wMm, 30)
  assert.equal(boxes[3].yMm, 30)
})

test('unsupported count throws', () => {
  assert.throws(() => computeGridBoxes(7, { xMm: 0, yMm: 0, wMm: 10, hMm: 10 }), /지원하지 않는/)
})
