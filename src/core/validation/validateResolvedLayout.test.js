import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertResolvedPagesInsideBounds, validateResolvedLayout } from './validateResolvedLayout.js'
import { TEXT_BOX_WIDTH_MM as CONTENT_WIDTH_MM, TEXT_BOX_HEIGHT_MM as CONTENT_HEIGHT_MM } from '../layoutConstants.js'

// Regression: a full-bleed image spans the literal physical page by design, which always exceeds
// the margin-constrained CONTENT_WIDTH/HEIGHT_MM box -- this final assertion used to check every
// image unconditionally, so enabling full-bleed (frequency hint or forced_full_bleed_images) made
// every generation with a full-bleed image fail with "Final boundary check failed" (confirmed
// 2026-07-27, real user-reported error blocking Generate).
test('a full-bleed image is exempt from the boundary check even though it exceeds the content box', () => {
  const resolvedPages = [{
    images: [{
      xMm: 0, yMm: 0, wMm: CONTENT_WIDTH_MM + 32, hMm: CONTENT_HEIGHT_MM + 34, fullBleed: true,
    }],
  }]
  const issues = assertResolvedPagesInsideBounds(resolvedPages)
  assert.deepEqual(issues, [])
})

test('a non-full-bleed image that exceeds the content box is still caught', () => {
  const resolvedPages = [{
    images: [{
      xMm: 0, yMm: 0, wMm: CONTENT_WIDTH_MM + 10, hMm: 20, fullBleed: false,
    }],
  }]
  const issues = assertResolvedPagesInsideBounds(resolvedPages)
  assert.equal(issues.length, 1)
  assert.ok(issues[0].includes('exceeds right boundary'))
})

test('a text block that exceeds the content box is still caught', () => {
  const resolvedPages = [{
    textBlocks: [{ zone: { xMm: 0, yMm: 0, wMm: 20, hMm: CONTENT_HEIGHT_MM + 5 } }],
  }]
  const issues = assertResolvedPagesInsideBounds(resolvedPages)
  assert.equal(issues.length, 1)
  assert.ok(issues[0].includes('exceeds bottom boundary'))
})

test('a well-formed page produces no issues', () => {
  const resolvedPages = [{
    images: [{
      xMm: 0, yMm: 0, wMm: 50, hMm: 50, fullBleed: false,
    }],
    textBlocks: [{ zone: { xMm: 0, yMm: 60, wMm: 50, hMm: 30 } }],
  }]
  const issues = assertResolvedPagesInsideBounds(resolvedPages)
  assert.deepEqual(issues, [])
})


test('rejects duplicated resolved heading text_source', () => {
  const result = validateResolvedLayout([{
    textBlocks: [
      { id: 'h1', role: 'section_label', text_source: 'paragraph_2', slice: 'COMMUNITY ACTIVISM', zone: { xMm: 0, yMm: 0, wMm: 50, hMm: 10 } },
      { id: 'h2', role: 'section_label', text_source: 'paragraph_2', slice: 'COMMUNITY ACTIVISM', zone: { xMm: 0, yMm: 20, wMm: 50, hMm: 10 } },
    ],
  }])

  assert.equal(result.passed, false)
  assert.ok(result.error_issues.some((i) => i.type === 'duplicate_text_source'))
})

test('rejects duplicated resolved body slice for the same text_source', () => {
  const body = 'Nike N7 collection body text.'
  const result = validateResolvedLayout([{
    textBlocks: [
      { id: 'b1', role: 'body', text_source: 'paragraph_10', slice: body, zone: { xMm: 0, yMm: 0, wMm: 50, hMm: 40 } },
      { id: 'b2', role: 'body', text_source: 'paragraph_10', slice: body, zone: { xMm: 60, yMm: 0, wMm: 50, hMm: 40 } },
    ],
  }])

  assert.equal(result.passed, false)
  assert.ok(result.error_issues.some((i) => i.type === 'duplicate_text_source'))
})

test('allows resolved body continuation slices for the same text_source when they are distinct', () => {
  const result = validateResolvedLayout([{
    textBlocks: [
      { id: 'b1', role: 'body', text_source: 'paragraph_10', slice: 'first half of the body', zone: { xMm: 0, yMm: 0, wMm: 50, hMm: 40 } },
      { id: 'b2', role: 'body', text_source: 'paragraph_10', slice: 'second half of the body', zone: { xMm: 60, yMm: 0, wMm: 50, hMm: 40 } },
    ],
  }])

  assert.equal(result.passed, true, JSON.stringify(result.error_issues))
})
