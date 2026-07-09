import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectTextFlowMode, TEXT_FLOW_MODES } from './selectTextFlowMode.js'

test('TEXT_FLOW_MODES contains 3 modes', () => {
  assert.equal(TEXT_FLOW_MODES.length, 3)
  assert.ok(TEXT_FLOW_MODES.includes('continuous_flow'))
  assert.ok(TEXT_FLOW_MODES.includes('modular_blocks'))
  assert.ok(TEXT_FLOW_MODES.includes('hybrid_flow'))
})

test('selectTextFlowMode: 6 paragraphs + 4 images + cases (4 >= 6-2) → modular_blocks', () => {
  const result = selectTextFlowMode({
    textBlockCount: 6,
    imageCount: 4,
    hasCaseLikeBlocks: true,
    hasHeroImage: true,
    gridMode: 'flexible',
    textDensity: 'medium',
  })

  // With 4 images for 6 paragraphs, modular matching is feasible (4 >= 6-2)
  assert.equal(result.mode, 'modular_blocks')
})

test('selectTextFlowMode: 8 paragraphs + 4 images + cases + hero → hybrid_flow', () => {
  const result = selectTextFlowMode({
    textBlockCount: 8,
    imageCount: 4,
    hasCaseLikeBlocks: true,
    hasHeroImage: true,
    gridMode: 'flexible',
    textDensity: 'medium',
  })

  // With 8 paragraphs but only 4 images, not enough for 1:1, so hybrid
  assert.equal(result.mode, 'hybrid_flow')
})

test('selectTextFlowMode: 3 case blocks + 3 images (1:1) → modular_blocks', () => {
  const result = selectTextFlowMode({
    textBlockCount: 3,
    imageCount: 3,
    hasCaseLikeBlocks: true,
    hasHeroImage: false,
    gridMode: 'strict',
    textDensity: 'short',
  })

  assert.equal(result.mode, 'modular_blocks')
})

test('selectTextFlowMode: 1 long essay + 2 images → continuous_flow', () => {
  const result = selectTextFlowMode({
    textBlockCount: 1,
    imageCount: 2,
    hasCaseLikeBlocks: false,
    hasHeroImage: false,
    gridMode: 'strict',
    textDensity: 'long',
  })

  assert.equal(result.mode, 'continuous_flow')
})

test('selectTextFlowMode: flexible grid + 4 blocks + 2 images → hybrid_flow', () => {
  const result = selectTextFlowMode({
    textBlockCount: 4,
    imageCount: 2,
    hasCaseLikeBlocks: false,
    hasHeroImage: false,
    gridMode: 'flexible',
    textDensity: 'medium',
  })

  assert.equal(result.mode, 'hybrid_flow')
})
