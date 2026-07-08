import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFallbackLayoutPlan, buildGridFallbackPlan } from './fallbackLayoutPlan.js'
import { resolveGridSettings } from './grid/GridPresetManager.js'

function noOverlap(elements) {
  for (let i = 0; i < elements.length; i += 1) {
    for (let j = i + 1; j < elements.length; j += 1) {
      const a = elements[i]
      const b = elements[j]
      const colOverlap = a.col_start <= b.col_start + b.col_span - 1 && b.col_start <= a.col_start + a.col_span - 1
      const rowOverlap = a.row_start <= b.row_start + b.row_span - 1 && b.row_start <= a.row_start + a.row_span - 1
      if (colOverlap && rowOverlap) return false
    }
  }
  return true
}

function insideGrid(elements, columns, rows) {
  return elements.every((el) => el.col_start >= 1 && el.col_start + el.col_span - 1 <= columns
    && el.row_start >= 1 && el.row_start + el.row_span - 1 <= rows)
}

test('buildFallbackLayoutPlan delegates to buildGridFallbackPlan when gridSettings is supplied', () => {
  const gridSettings = resolveGridSettings({ columns: 4, gridMode: 'strict' }, { textDensity: 'short', imageCount: 1 })
  const plan = buildFallbackLayoutPlan({
    imageCount: 1, textDensity: 'short', text: '짧은 본문입니다.', gridSettings,
  })
  assert.equal(plan.composition_strategy, 'column_flow_grid')
  assert.ok(plan.grid_spec)
})

test('1 image, top-right anchored, short text: text wraps around the image, no overlaps, every char preserved', () => {
  const gridSettings = resolveGridSettings({ columns: 4, gridMode: 'flexible' }, { textDensity: 'long', imageCount: 1 })
  const text = Array.from({ length: 300 }, (_, i) => `단락문장${i}`).join(' ')
  const plan = buildGridFallbackPlan({
    imageCount: 1, textDensity: 'long', text, gridSettings,
  })
  const allEls = plan.pages.flatMap((p) => p.elements)
  assert.ok(noOverlap(plan.pages[0].elements), 'page 1 elements must not overlap')
  assert.ok(insideGrid(allEls, plan.grid.columns, plan.grid.rows))
  assert.equal(allEls.filter((el) => el.type === 'image').length, 1)
  const rebuilt = allEls.filter((el) => el.type === 'text').map((el) => el.text).join(' ').replace(/\s+/g, ' ').trim()
  assert.equal(rebuilt, text)
})

test('2 images + short text: both placed once, text fits without overlapping the images', () => {
  const gridSettings = resolveGridSettings({ columns: 3 }, { textDensity: 'short', imageCount: 2 })
  const plan = buildGridFallbackPlan({
    imageCount: 2, textDensity: 'short', text: '짧은 설명 텍스트입니다. 두 이미지를 비교합니다.', gridSettings,
  })
  const page1 = plan.pages[0].elements
  assert.equal(page1.filter((el) => el.type === 'image').length, 2)
  assert.ok(noOverlap(page1))
  assert.equal(plan.reserved_regions.length, 2)
})

test('4 images gallery + long text: all 4 images placed once, text continues onto further pages, nothing lost', () => {
  const gridSettings = resolveGridSettings({ columns: 4 }, { textDensity: 'long', imageCount: 4 })
  const words = Array.from({ length: 2000 }, (_, i) => `word${i}`)
  const text = words.join(' ')
  const plan = buildGridFallbackPlan({
    imageCount: 4, textDensity: 'long', text, gridSettings,
  })
  const allEls = plan.pages.flatMap((p) => p.elements)
  assert.equal(allEls.filter((el) => el.type === 'image').length, 4)
  assert.ok(plan.pages.length > 1, 'long text should overflow onto continuation pages')
  const rebuiltWords = allEls.filter((el) => el.type === 'text').map((el) => el.text).join(' ').split(/\s+/).filter(Boolean)
  assert.deepEqual(rebuiltWords, words)
})

test('pure text with no explicit title but an auto-detected heading paragraph: no text is silently dropped', () => {
  const gridSettings = resolveGridSettings({ columns: 4 }, { textDensity: 'medium', imageCount: 1 })
  const text = '짧은 제목\n\n본문 문단 하나.\n\n본문 문단 둘.'
  const plan = buildGridFallbackPlan({
    imageCount: 1, textDensity: 'medium', text, title: '', gridSettings,
  })
  const allText = plan.pages.flatMap((p) => p.elements).filter((el) => el.type === 'text').map((el) => el.text).join(' ')
  assert.ok(allText.includes('짧은 제목'), 'auto-detected title text must still appear somewhere, not vanish')
  assert.ok(allText.includes('본문 문단 하나'))
  assert.ok(allText.includes('본문 문단 둘'))
})

test('grid_spec records the resolved column count from the user setting (not hardcoded 6)', () => {
  const gridSettings = resolveGridSettings({ columns: 2 }, { textDensity: 'short', imageCount: 1 })
  const plan = buildGridFallbackPlan({
    imageCount: 1, textDensity: 'short', text: '짧은 본문.', gridSettings,
  })
  assert.equal(plan.grid.columns, 2)
  assert.equal(plan.grid_spec.columns, 2)
})
