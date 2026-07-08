import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideOutputUnit } from './outputUnit.js'

test('an explicit user preference always wins', () => {
  assert.equal(decideOutputUnit({ imageCount: 5, textDensity: 'long', preferredOutputUnit: 'single_page' }).outputUnit, 'single_page')
  assert.equal(decideOutputUnit({ imageCount: 1, textDensity: 'short', preferredOutputUnit: 'spread' }).outputUnit, 'spread')
})

test('3+ images prefers spread', () => {
  assert.equal(decideOutputUnit({ imageCount: 3, textDensity: 'short' }).outputUnit, 'spread')
})

test('medium/long text prefers spread', () => {
  assert.equal(decideOutputUnit({ imageCount: 1, textDensity: 'medium' }).outputUnit, 'spread')
  assert.equal(decideOutputUnit({ imageCount: 2, textDensity: 'long' }).outputUnit, 'spread')
})

test('1-2 images + short text defaults to single_page', () => {
  assert.equal(decideOutputUnit({ imageCount: 1, textDensity: 'short' }).outputUnit, 'single_page')
  assert.equal(decideOutputUnit({ imageCount: 2, textDensity: 'short' }).outputUnit, 'single_page')
})
