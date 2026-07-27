import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repairContentGroupLayout } from './repairContentGroupLayout.js'
import { buildContentGroups } from '../content/buildContentGroups.js'
import { validateLayoutPlan } from '../validateLayoutPlan.js'

function textBlocksFixture() {
  return [
    { id: 'p1', role: 'section_label', char_count: 12, group_id: 0 },
    { id: 'p2', role: 'body', char_count: 260, group_id: 0 },
    { id: 'p3', role: 'section_label', char_count: 12, group_id: 1 },
    { id: 'p4', role: 'body', char_count: 260, group_id: 1 },
  ]
}

function planWith(pages) {
  return {
    style: 'Editorial',
    output_unit: 'spread',
    layout_family: 'balanced',
    layout_purpose: 'case_analysis',
    image_hierarchy: 'hero_support',
    image_text_relation: 'text_explains_image',
    composition_strategy: 'image_above_text',
    design_sequence: [{
      step: 1, decision_type: 'x', value: 'x', reason: 'x',
    }],
    grid: { columns: 6, rows: 12 },
    grid_spec: { columns: 6, rows: 12, gutter_mm: 4 },
    pages,
    overflow_policy: { body_overflow: 'continue_to_next_page' },
  }
}

const img = (id, o) => ({
  id, type: 'image', role: 'support', fit: 'contain', object_position: 'center', ...o,
})
const txt = (id, src, role, o) => ({
  id, type: 'text', role, text_source: src, ...o,
})

// The reported real failure: an image on one page, the text of its own group on another.
function splitPlan() {
  return planWith([
    {
      page: 1,
      elements: [
        img('image_1', {
          col_start: 1, col_span: 6, row_start: 1, row_span: 8,
        }),
        txt('t3', 'paragraph_3', 'section_label', {
          col_start: 1, col_span: 6, row_start: 9, row_span: 1,
        }),
      ],
    },
    {
      page: 2,
      elements: [
        txt('t1', 'paragraph_1', 'section_label', {
          col_start: 1, col_span: 6, row_start: 1, row_span: 1,
        }),
        txt('t2', 'paragraph_2', 'body', {
          col_start: 1, col_span: 6, row_start: 2, row_span: 4,
        }),
        img('image_2', {
          col_start: 1, col_span: 6, row_start: 7, row_span: 5,
        }),
        txt('t4', 'paragraph_4', 'body', {
          col_start: 1, col_span: 6, row_start: 12, row_span: 1,
        }),
      ],
    },
  ])
}

test('repacking eliminates every content-group violation the validator reported', () => {
  const textBlocks = textBlocksFixture()
  const contentGroupModel = buildContentGroups({ textBlocks, imageCount: 2 })
  const plan = splitPlan()

  const before = validateLayoutPlan(plan, { imageCount: 2, textBlocks, contentGroupModel })
  const groupIssues = (r) => r.issues.filter((i) => i.includes('콘텐츠 그룹') || i.includes('content group'))
  assert.ok(groupIssues(before).length > 0, 'fixture must actually violate cohesion')

  const { plan: repacked, repaired } = repairContentGroupLayout(plan, contentGroupModel, textBlocks)
  assert.equal(repaired, true)

  const after = validateLayoutPlan(repacked, { imageCount: 2, textBlocks, contentGroupModel })
  assert.equal(groupIssues(after).length, 0, JSON.stringify(groupIssues(after)))
})

test('every element of a group lands on one page, in one column band', () => {
  const textBlocks = textBlocksFixture()
  const contentGroupModel = buildContentGroups({ textBlocks, imageCount: 2 })
  const { plan: repacked } = repairContentGroupLayout(splitPlan(), contentGroupModel, textBlocks)

  const placementsByGroup = new Map()
  repacked.pages.forEach((page) => {
    page.elements.forEach((el) => {
      const gid = el.type === 'image'
        ? contentGroupModel.groupByImageId.get(el.id)
        : contentGroupModel.groupByTextSource.get(el.text_source)
      if (gid == null) return
      if (!placementsByGroup.has(gid)) placementsByGroup.set(gid, [])
      placementsByGroup.get(gid).push({ page: page.page, el })
    })
  })

  assert.ok(placementsByGroup.size >= 2)
  placementsByGroup.forEach((placements, gid) => {
    assert.equal(new Set(placements.map((p) => p.page)).size, 1, `group ${gid} must occupy a single page`)
    assert.equal(new Set(placements.map((p) => p.el.col_start)).size, 1, `group ${gid} must share one column band`)
  })
})

test('no text is dropped or invented: every paragraph appears exactly once', () => {
  const textBlocks = textBlocksFixture()
  const contentGroupModel = buildContentGroups({ textBlocks, imageCount: 2 })
  const { plan: repacked } = repairContentGroupLayout(splitPlan(), contentGroupModel, textBlocks)

  const sources = repacked.pages
    .flatMap((p) => p.elements)
    .filter((el) => el.type === 'text')
    .map((el) => el.text_source)
    .sort()
  assert.deepEqual(sources, ['paragraph_1', 'paragraph_2', 'paragraph_3', 'paragraph_4'])

  const images = repacked.pages.flatMap((p) => p.elements).filter((el) => el.type === 'image').map((el) => el.id).sort()
  assert.deepEqual(images, ['image_1', 'image_2'])
})

test('an image keeps its fit and object_position through repacking', () => {
  const textBlocks = textBlocksFixture()
  const contentGroupModel = buildContentGroups({ textBlocks, imageCount: 2 })
  const { plan: repacked } = repairContentGroupLayout(splitPlan(), contentGroupModel, textBlocks)

  const image = repacked.pages.flatMap((p) => p.elements).find((el) => el.id === 'image_1')
  assert.equal(image.fit, 'contain')
  assert.equal(image.object_position, 'center')
})

test('within a group the image precedes its heading, which precedes its body', () => {
  const textBlocks = textBlocksFixture()
  const contentGroupModel = buildContentGroups({ textBlocks, imageCount: 2 })
  const { plan: repacked } = repairContentGroupLayout(splitPlan(), contentGroupModel, textBlocks)

  const group0 = repacked.pages
    .flatMap((p) => p.elements)
    .filter((el) => (el.type === 'image'
      ? contentGroupModel.groupByImageId.get(el.id) === 0
      : contentGroupModel.groupByTextSource.get(el.text_source) === 0))
    .sort((a, b) => a.row_start - b.row_start)

  assert.equal(group0[0].type, 'image')
  assert.equal(group0[1].role, 'section_label')
  assert.equal(group0[2].role, 'body')
})

test('returns unchanged when there is no group model to work from', () => {
  const plan = splitPlan()
  const result = repairContentGroupLayout(plan, null, textBlocksFixture())
  assert.equal(result.repaired, false)
  assert.equal(result.plan, plan)
})
