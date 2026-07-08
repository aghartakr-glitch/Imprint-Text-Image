import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadDatasetSamples, sampleFewShot } from './layoutDataset.js'

test('loadDatasetSamples parses the CSV into records with the expected columns', () => {
  const records = loadDatasetSamples()
  assert.ok(records.length > 100, `expected a large dataset, got ${records.length} rows`)
  assert.ok('pattern_id' in records[0])
  assert.ok('layout_family' in records[0])
  assert.ok('why_this_layout_works' in records[0])
})

test('sampleFewShot returns a small, capped, deduplicated-by-pattern sample', () => {
  const sample = sampleFewShot({ perPattern: 1, maxTotal: 12 })
  assert.ok(sample.length > 0 && sample.length <= 12)
  const patternIds = sample.map((s) => s.pattern_id)
  assert.equal(new Set(patternIds).size, patternIds.length, 'should not repeat the same pattern_id')
})
