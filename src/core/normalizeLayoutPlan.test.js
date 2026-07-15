import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLayoutPlan } from './normalizeLayoutPlan.js'

test('margin_preset "default" is normalized to "recommended"', () => {
  const plan = { grid_spec: { margin_preset: 'default' } }
  const normalized = normalizeLayoutPlan(plan)
  assert.equal(normalized.grid_spec.margin_preset, 'recommended')
})

test('margin_preset "normal" and "standard" are also normalized to "recommended"', () => {
  assert.equal(normalizeLayoutPlan({ grid_spec: { margin_preset: 'normal' } }).grid_spec.margin_preset, 'recommended')
  assert.equal(normalizeLayoutPlan({ grid_spec: { margin_preset: 'standard' } }).grid_spec.margin_preset, 'recommended')
})

test('already-legal margin_preset values (narrow/wide/custom/recommended) pass through unchanged', () => {
  assert.equal(normalizeLayoutPlan({ grid_spec: { margin_preset: 'narrow' } }).grid_spec.margin_preset, 'narrow')
  assert.equal(normalizeLayoutPlan({ grid_spec: { margin_preset: 'wide' } }).grid_spec.margin_preset, 'wide')
  assert.equal(normalizeLayoutPlan({ grid_spec: { margin_preset: 'custom' } }).grid_spec.margin_preset, 'custom')
  assert.equal(normalizeLayoutPlan({ grid_spec: { margin_preset: 'recommended' } }).grid_spec.margin_preset, 'recommended')
})

test('a genuinely invalid margin_preset value ("banana") is left untouched so validateLayoutPlan still rejects it', () => {
  const normalized = normalizeLayoutPlan({ grid_spec: { margin_preset: 'banana' } })
  assert.equal(normalized.grid_spec.margin_preset, 'banana')
})

test('is case-insensitive and trims whitespace', () => {
  assert.equal(normalizeLayoutPlan({ grid_spec: { margin_preset: ' Default ' } }).grid_spec.margin_preset, 'recommended')
})

test('does not mutate the original plan object', () => {
  const plan = { grid_spec: { margin_preset: 'default' } }
  normalizeLayoutPlan(plan)
  assert.equal(plan.grid_spec.margin_preset, 'default')
})

test('plans without grid_spec pass through unchanged', () => {
  const plan = { style: 'Editorial' }
  const normalized = normalizeLayoutPlan(plan)
  assert.deepEqual(normalized, plan)
})
