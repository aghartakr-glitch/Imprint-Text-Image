import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveGridSettings, resolveTextFlow, resolveImageBehavior, resolveVariationLevel,
} from './GridPresetManager.js'

test('columns=4 resolves to the four_column_editorial preset', () => {
  const { grid_spec: gridSpec } = resolveGridSettings({ columns: 4 })
  assert.equal(gridSpec.preset, 'four_column_editorial')
  assert.equal(gridSpec.columns, 4)
})

test('A4 always resolves to 16 rows regardless of column count; A5/B5 resolve to 12', () => {
  assert.equal(resolveGridSettings({ pageSize: 'A4', columns: 3 }).grid_spec.rows, 16)
  assert.equal(resolveGridSettings({ pageSize: 'A4', columns: 6 }).grid_spec.rows, 16)
  assert.equal(resolveGridSettings({ pageSize: 'A5', columns: 4 }).grid_spec.rows, 12)
  assert.equal(resolveGridSettings({ pageSize: 'B5', columns: 2 }).grid_spec.rows, 12)
})

test('gutter follows the columns table and narrows/widens with margin_preset', () => {
  assert.equal(resolveGridSettings({ columns: 2 }).grid_spec.gutter_mm, 5)
  assert.equal(resolveGridSettings({ columns: 6 }).grid_spec.gutter_mm, 3)
  assert.equal(resolveGridSettings({ columns: 4, marginPreset: 'narrow' }).grid_spec.gutter_mm, 3)
  assert.equal(resolveGridSettings({ columns: 4, marginPreset: 'wide' }).grid_spec.gutter_mm, 5)
})

test('resolveTextFlow: 3+ paragraphs forces column_flow even with short text', () => {
  assert.equal(resolveTextFlow({ textDensity: 'short', paragraphCount: 3 }), 'column_flow')
})

test('resolveTextFlow: long text without many paragraphs is still column_flow', () => {
  assert.equal(resolveTextFlow({ textDensity: 'long', paragraphCount: 1 }), 'column_flow')
})

test('resolveTextFlow: short/medium with few paragraphs is block_flow', () => {
  assert.equal(resolveTextFlow({ textDensity: 'short', paragraphCount: 1 }), 'block_flow')
  assert.equal(resolveTextFlow({ textDensity: 'medium', paragraphCount: 2 }), 'block_flow')
})

test('resolveImageBehavior: 3+ images is distributed, 1 image without long text is full_width, else anchored', () => {
  assert.equal(resolveImageBehavior({ imageCount: 4, textDensity: 'short' }), 'distributed')
  assert.equal(resolveImageBehavior({ imageCount: 1, textDensity: 'short' }), 'full_width')
  assert.equal(resolveImageBehavior({ imageCount: 1, textDensity: 'long' }), 'anchored')
  assert.equal(resolveImageBehavior({ imageCount: 2, textDensity: 'short' }), 'anchored')
})

test('resolveVariationLevel: strict is always low; flexible varies with images/text', () => {
  assert.equal(resolveVariationLevel({ gridMode: 'strict', textDensity: 'long', imageCount: 6 }), 'low')
  assert.equal(resolveVariationLevel({ gridMode: 'flexible', textDensity: 'short', imageCount: 1 }), 'low')
  assert.equal(resolveVariationLevel({ gridMode: 'flexible', textDensity: 'medium', imageCount: 1 }), 'medium')
  assert.equal(resolveVariationLevel({ gridMode: 'flexible', textDensity: 'short', imageCount: 4 }), 'high')
})

test('resolveGridSettings bundles resolution_reason strings for every resolved field', () => {
  const { resolved_grid_settings: resolved } = resolveGridSettings(
    {
      pageSize: 'A5', marginPreset: 'recommended', columns: 4, gridMode: 'flexible',
    },
    { textDensity: 'long', paragraphCount: 4, imageCount: 1 },
  )
  assert.equal(resolved.text_flow, 'column_flow')
  assert.equal(resolved.image_behavior, 'anchored')
  assert.equal(resolved.variation_level, 'medium')
  assert.ok(resolved.resolution_reason.rows && resolved.resolution_reason.gutter && resolved.resolution_reason.text_flow)
})

test('unknown page_size/margin_preset ("custom") falls back to A5/recommended defaults', () => {
  const { page_width_mm: widthMm, margins_mm: margins } = resolveGridSettings({ pageSize: 'custom', marginPreset: 'custom', columns: 3 })
  assert.equal(widthMm, 148)
  assert.equal(margins.top, 16)
})
