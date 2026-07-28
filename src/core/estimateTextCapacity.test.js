import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateTextCapacityMm, estimateTextCapacity, validateLayoutTextCapacity } from './estimateTextCapacity.js'

test('a zero-size box has zero capacity', () => {
  assert.equal(estimateTextCapacityMm(0, 0), 0)
})

test('capacity grows with box width and height', () => {
  const small = estimateTextCapacityMm(30, 30)
  const large = estimateTextCapacityMm(100, 100)
  assert.ok(large > small)
})

test('estimateTextCapacity converts a grid element to mm first', () => {
  const capacity = estimateTextCapacity({
    col_start: 1, col_span: 6, row_start: 1, row_span: 12,
  })
  assert.ok(capacity > 0)
})

// Regression: the pages.forEach callback destructured (pageIdx, page) instead of (page, pageIdx),
// so `page.textBlocks` was always read off a numeric index and validateLayoutTextCapacity silently
// returned zero issues for every plan, ever -- a paragraph far too long for its box would overflow
// unnoticed and visually bleed into whatever sat below it (confirmed 2026-07-10: text bleeding into
// an image in a real generated PDF).
test('flags a text_source element whose referenced paragraph overflows its box', () => {
  const plan = {
    grid_spec: {
      columns: 4, rows: 12, gutter_mm: 4,
    },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'p1_body', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 1, row_start: 1, row_span: 1,
        },
      ],
    }],
  }
  const textBlocks = [{ id: 'p1', text: 'x'.repeat(2000), char_count: 2000 }]

  const issues = validateLayoutTextCapacity(plan, textBlocks)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].elementId, 'p1_body')
  assert.equal(issues[0].page, 1)
})

// Regression: a real generation gave a role:'title' element (rendered at 28pt/34pt via
// \TitleText, not the 9pt/14pt body font) a box sized as if it were body text. The box was tall
// enough for ~2 lines of 9pt text but too short for even one 28pt line, so the title overflowed
// down into the element below it (confirmed 2026-07-16: "Macro-trend" visually overlapped "HEAR MY
// VOICE"). Capacity for a title-role box must be computed against the title font, not body.
test('a title-role box sized for body text is correctly flagged as too small for the title font', () => {
  const bodyCapacity = estimateTextCapacityMm(55.5, 10.08, 'body')
  const titleCapacity = estimateTextCapacityMm(55.5, 10.08, 'title')
  assert.ok(bodyCapacity > 0, 'sanity check: this box comfortably fits a couple lines of body text')
  assert.equal(titleCapacity, 0, 'the same box fits zero lines of the much larger title font')
})

test('flags a title-role element whose box is sized for body text but rendered much larger', () => {
  const plan = {
    grid_spec: { columns: 2, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'title_1', type: 'text', role: 'title', text_source: 'paragraph_1', col_start: 1, col_span: 1, row_start: 1, row_span: 1,
        },
      ],
    }],
  }
  const textBlocks = [{ id: 'p1', text: 'Macro-trend', char_count: 11 }]

  const issues = validateLayoutTextCapacity(plan, textBlocks)
  assert.equal(issues.length, 1, 'a 1-row box is too short for even one line of 28pt title text')
})

test('does not flag a text_source element that fits comfortably within its box', () => {
  const plan = {
    grid_spec: {
      columns: 4, rows: 12, gutter_mm: 4,
    },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'p1_body', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 4, row_start: 1, row_span: 12,
        },
      ],
    }],
  }
  const textBlocks = [{ id: 'p1', text: 'short paragraph', char_count: 15 }]

  const issues = validateLayoutTextCapacity(plan, textBlocks)
  assert.deepEqual(issues, [])
})

test('B5 grid_spec uses the larger B5 text box for overflow validation', () => {
  const textBlocks = [{ id: 'p1', text: '가'.repeat(1566), char_count: 1566 }]
  const basePlan = {
    grid_spec: {
      columns: 6, rows: 12, gutter_mm: 4, margin_preset: 'recommended',
    },
    pages: [{
      page: 1,
      elements: [{
        id: 'body', type: 'text', role: 'body', text_source: 'p1', col_start: 1, col_span: 6, row_start: 1, row_span: 12,
      }],
    }],
  }

  const a5Issues = validateLayoutTextCapacity({
    ...basePlan,
    grid_spec: { ...basePlan.grid_spec, page_size: 'A5' },
  }, textBlocks)
  const b5Issues = validateLayoutTextCapacity({
    ...basePlan,
    grid_spec: { ...basePlan.grid_spec, page_size: 'B5' },
  }, textBlocks)

  assert.equal(a5Issues.length, 1)
  assert.deepEqual(b5Issues, [])
})
test('allows overlong body text_source to continue when body overflow policy is enabled', () => {
  const plan = {
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    grid_spec: {
      columns: 6, rows: 12, gutter_mm: 4, page_size: 'A5', margin_preset: 'recommended',
    },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'body_start', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 3, row_start: 1, row_span: 12,
        },
      ],
    }],
  }
  const textBlocks = [{ id: 'p1', role: 'body', text: '가'.repeat(1566), char_count: 1566 }]

  const issues = validateLayoutTextCapacity(plan, textBlocks)
  assert.deepEqual(issues, [])
})

test('still flags overlong headings even when body overflow policy is enabled', () => {
  const plan = {
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    grid_spec: {
      columns: 6, rows: 12, gutter_mm: 4, page_size: 'A5', margin_preset: 'recommended',
    },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'heading_tight', type: 'text', role: 'section_label', text_source: 'paragraph_1', col_start: 1, col_span: 1, row_start: 1, row_span: 1,
        },
      ],
    }],
  }
  const textBlocks = [{ id: 'p1', role: 'section_label', text: 'VERY LONG HEADING '.repeat(20), char_count: 360 }]

  const issues = validateLayoutTextCapacity(plan, textBlocks)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].elementId, 'heading_tight')
})
