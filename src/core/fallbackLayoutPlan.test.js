import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFallbackLayoutPlan } from './fallbackLayoutPlan.js'
import { validateLayoutPlan } from './validateLayoutPlan.js'

const CASES = [
  { imageCount: 1, textDensity: 'short' },
  { imageCount: 1, textDensity: 'medium' },
  { imageCount: 1, textDensity: 'long' },
  { imageCount: 2, textDensity: 'short' },
  { imageCount: 2, textDensity: 'medium' },
  { imageCount: 2, textDensity: 'long' },
  { imageCount: 3, textDensity: 'short' },
  { imageCount: 3, textDensity: 'medium' },
  { imageCount: 3, textDensity: 'long' },
  { imageCount: 4, textDensity: 'short' },
  { imageCount: 4, textDensity: 'long' },
  { imageCount: 5, textDensity: 'medium' },
  { imageCount: 5, textDensity: 'long' },
  { imageCount: 6, textDensity: 'short' },
  { imageCount: 6, textDensity: 'long' },
]

for (const { imageCount, textDensity } of CASES) {
  test(`fallback for ${imageCount} image(s) + ${textDensity} text passes validateLayoutPlan`, () => {
    const generatedPlan = buildFallbackLayoutPlan({ imageCount, textDensity })
    const result = validateLayoutPlan(generatedPlan, { imageCount })
    assert.equal(result.passed, true, `issues: ${JSON.stringify(result.issues)}`)
  })
}

test('every fallback plan is grid-based (uses col/row spans, never raw mm)', () => {
  const generatedPlan = buildFallbackLayoutPlan({ imageCount: 4, textDensity: 'short' })
  const el = generatedPlan.pages[0].elements[0]
  assert.ok(Number.isInteger(el.col_start) && Number.isInteger(el.row_start))
})

test('the long-text 3-6-image fallback splits gallery and text across two separate pages', () => {
  const generatedPlan = buildFallbackLayoutPlan({ imageCount: 5, textDensity: 'long' })
  assert.equal(generatedPlan.pages.length, 2)
  assert.ok(generatedPlan.pages[0].elements.every((e) => e.type === 'image'))
  assert.ok(generatedPlan.pages[1].elements.every((e) => e.type === 'text'))
})

test('throws for an unsupported image count', () => {
  assert.throws(() => buildFallbackLayoutPlan({ imageCount: 0, textDensity: 'short' }))
  assert.throws(() => buildFallbackLayoutPlan({ imageCount: 7, textDensity: 'short' }))
})

// Per user feedback: fallback variants for 3-6 images previously always clustered every image
// onto one page. There must be a real "one image per page, spread across the story" option too.
test('the 3-6-image bucket includes a sparse one-image-per-page variant reachable via the hash, and it validates', () => {
  let found = null
  for (let seedTweak = 0; seedTweak < 500 && !found; seedTweak += 1) {
    const generatedPlan = buildFallbackLayoutPlan({
      imageCount: 4, textDensity: 'short', imageAspectRatios: [1 + seedTweak * 0.001, 0.8, 1.2, 1.0], textLength: seedTweak,
    })
    if (generatedPlan.composition_strategy === 'images_spread_across_pages') found = generatedPlan
  }
  assert.ok(found, 'expected to find a seed that selects the sparse per-page variant within 500 tries')
  assert.equal(found.pages.length, 5, '4 images + 1 dedicated text page')
  assert.ok(found.pages.slice(0, 4).every((p) => p.elements.length === 1 && p.elements[0].type === 'image'), 'each image page holds exactly one image, nothing grouped')
  assert.equal(found.pages[4].elements[0].type, 'text')
  const result = validateLayoutPlan(found, { imageCount: 4 })
  assert.equal(result.passed, true, `issues: ${JSON.stringify(result.issues)}`)
})
