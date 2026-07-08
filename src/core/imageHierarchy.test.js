import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildImageMetadata, estimateImageHierarchy } from './imageHierarchy.js'

function img(width, height) {
  return {
    width, height, aspectRatio: width / height, orientation: width / height >= 1.2 ? 'landscape' : (width / height >= 0.85 ? 'square' : 'portrait'),
  }
}

test('buildImageMetadata computes relative resolution_score against the largest image', () => {
  const metadata = buildImageMetadata([img(1800, 1200), img(900, 1200)])
  assert.equal(metadata[0].resolution_score, 1)
  assert.ok(metadata[1].resolution_score < 1)
  assert.equal(metadata[0].id, 'image_1')
})

test('a single image is always the hero', () => {
  const metadata = buildImageMetadata([img(1000, 1000)])
  const { imageHierarchy, imageMetadata } = estimateImageHierarchy(metadata)
  assert.equal(imageHierarchy, 'single_hero')
  assert.equal(imageMetadata[0].estimated_role, 'hero')
})

test('two images with similar ratio and similar resolution are treated as equal', () => {
  const metadata = buildImageMetadata([img(1200, 1200), img(1150, 1200)])
  const { imageHierarchy, imageMetadata } = estimateImageHierarchy(metadata)
  assert.equal(imageHierarchy, 'equal_pair')
  assert.ok(imageMetadata.every((m) => m.estimated_role === 'equal'))
})

test('a clear high-resolution outlier among two images becomes hero_support', () => {
  const metadata = buildImageMetadata([img(3000, 2000), img(300, 200)])
  const { imageHierarchy, imageMetadata } = estimateImageHierarchy(metadata)
  assert.equal(imageHierarchy, 'hero_support')
  assert.equal(imageMetadata[0].estimated_role, 'hero')
  assert.equal(imageMetadata[1].estimated_role, 'support')
})

test('3+ images with similar ratios become a grid gallery', () => {
  const metadata = buildImageMetadata([img(1000, 1000), img(1000, 1000), img(1000, 1000)])
  const { imageHierarchy } = estimateImageHierarchy(metadata)
  assert.equal(imageHierarchy, 'grid_gallery')
})

test('explicit user_priority=hero on exactly one image overrides the automatic estimate', () => {
  const metadata = buildImageMetadata([img(1000, 1000), img(1000, 1000)], [null, 'hero'])
  const { imageHierarchy, imageMetadata } = estimateImageHierarchy(metadata)
  assert.equal(imageHierarchy, 'hero_support')
  assert.equal(imageMetadata[1].estimated_role, 'hero')
  assert.equal(imageMetadata[0].estimated_role, 'support')
})
