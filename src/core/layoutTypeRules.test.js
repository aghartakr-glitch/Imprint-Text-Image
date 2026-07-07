import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectLayoutTypeByRules } from './layoutTypeRules.js'

test('이미지 1장 + 본문 short -> image-first', () => {
  assert.equal(selectLayoutTypeByRules({ imageCount: 1, textLength: 500 }), 'image-first')
})

test('이미지 1장 + 본문 medium/long -> text-first', () => {
  assert.equal(selectLayoutTypeByRules({ imageCount: 1, textLength: 2000 }), 'text-first')
  assert.equal(selectLayoutTypeByRules({ imageCount: 1, textLength: 4000 }), 'text-first')
})

test('이미지 2~3장 + 본문 short -> image-first', () => {
  assert.equal(selectLayoutTypeByRules({ imageCount: 2, textLength: 500 }), 'image-first')
  assert.equal(selectLayoutTypeByRules({ imageCount: 3, textLength: 1200 }), 'image-first')
})

test('이미지 2~4장 + 본문 medium -> balanced', () => {
  assert.equal(selectLayoutTypeByRules({ imageCount: 2, textLength: 2000 }), 'balanced')
  assert.equal(selectLayoutTypeByRules({ imageCount: 4, textLength: 3500 }), 'balanced')
})

test('이미지 5~6장 + 본문 long -> balanced', () => {
  assert.equal(selectLayoutTypeByRules({ imageCount: 5, textLength: 4000 }), 'balanced')
  assert.equal(selectLayoutTypeByRules({ imageCount: 6, textLength: 50000 }), 'balanced')
})

test('본문 long인데 위 특수 규칙에 안 걸리면 text-first 우선', () => {
  assert.equal(selectLayoutTypeByRules({ imageCount: 2, textLength: 4000 }), 'text-first')
  assert.equal(selectLayoutTypeByRules({ imageCount: 3, textLength: 4000 }), 'text-first')
})

test('이미지 3~6장 + short/medium 나머지는 balanced', () => {
  assert.equal(selectLayoutTypeByRules({ imageCount: 4, textLength: 500 }), 'balanced')
  assert.equal(selectLayoutTypeByRules({ imageCount: 5, textLength: 2000 }), 'balanced')
  assert.equal(selectLayoutTypeByRules({ imageCount: 6, textLength: 1000 }), 'balanced')
})
