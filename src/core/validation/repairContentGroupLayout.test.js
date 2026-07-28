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

test('a text-only group can continue into the next band without repeating its heading', () => {
  // char_count chosen so the leftover chunk after splitting is comfortably over the "worth a page
  // of its own" threshold (see the next test for the small-leftover case), without also exceeding
  // the first chunk's own real capacity (the proportional split estimate isn't exact page-to-page).
  const textBlocks = [
    { id: 'p1', role: 'section_label', char_count: 12, group_id: 0 },
    { id: 'p2', role: 'body', char_count: 1800, group_id: 0 },
    { id: 'p3', role: 'section_label', char_count: 12, group_id: 1 },
    { id: 'p4', role: 'body', char_count: 260, group_id: 1 },
  ]
  const contentGroupModel = buildContentGroups({ textBlocks, imageCount: 0 })
  const plan = planWith([{ page: 1, elements: [] }])

  const { plan: repacked } = repairContentGroupLayout(plan, contentGroupModel, textBlocks)
  const p2Placements = repacked.pages
    .flatMap((p) => p.elements.map((el) => ({ page: p.page, el })))
    .filter((p) => p.el.text_source === 'paragraph_2')
  const p1Placements = repacked.pages
    .flatMap((p) => p.elements)
    .filter((el) => el.text_source === 'paragraph_1')

  assert.equal(p1Placements.length, 1)
  assert.ok(p2Placements.length >= 2)
  assert.ok(p2Placements.every((p) => Number.isFinite(p.el.__charCount)))
  assert.equal(p2Placements.reduce((sum, p) => sum + p.el.__charCount, 0), 1800)

  const after = validateLayoutPlan(repacked, { imageCount: 0, textBlocks, contentGroupModel })
  assert.equal(after.issues.length, 0, JSON.stringify(after.issues))
})

// Regression (2026-07-28, real generation): a body paragraph split near a page boundary left a
// tiny leftover sentence ("조절하는 능동적인 구성 요소로 사용되었다.") alone on an otherwise blank
// page. Splitting must not create a leftover chunk too small to be worth a page of its own --
// the whole paragraph should move together instead.
test('a body paragraph whose leftover after splitting would be tiny is kept whole rather than orphaning a fragment', () => {
  // Empirically, 540 chars here produces a natural leftover under the 60-char worthwhile
  // threshold once the first chunk's available rows are accounted for -- before this fix, that
  // leftover became its own tiny fragment on a fresh page (the real report: "조절하는 능동적인
  // 구성 요소로 사용되었다." landing alone on an otherwise blank page).
  const textBlocks = [
    { id: 'p1', role: 'section_label', char_count: 12, group_id: 0 },
    { id: 'p2', role: 'body', char_count: 540, group_id: 0 },
  ]
  const contentGroupModel = buildContentGroups({ textBlocks, imageCount: 0 })
  const plan = planWith([{ page: 1, elements: [] }])

  const { plan: repacked } = repairContentGroupLayout(plan, contentGroupModel, textBlocks)
  const placements = repacked.pages
    .flatMap((page) => page.elements.map((el) => ({ page: page.page, el })))
    .filter((p) => p.el.text_source === 'paragraph_2')

  // The whole paragraph must land in one place -- no tiny orphaned fragment split off.
  assert.equal(placements.length, 1, `expected the whole paragraph to move together, got ${placements.length} pieces`)

  const after = validateLayoutPlan(repacked, { imageCount: 0, textBlocks, contentGroupModel })
  assert.equal(after.issues.length, 0, JSON.stringify(after.issues))
})

test('a title with an overwide word is promoted to a full-width band', () => {
  const textBlocks = [
    { id: 'p1', role: 'title', text: 'LASZLO MOHOLY-NAGY', char_count: 19, group_id: 0 },
    { id: 'p2', role: 'section_label', text: 'Expanded vision', char_count: 15, group_id: 0 },
    { id: 'p3', role: 'body', text: 'Short body text for the group.', char_count: 30, group_id: 0 },
  ]
  const contentGroupModel = buildContentGroups({ textBlocks, imageCount: 0 })
  const plan = planWith([{ page: 1, elements: [] }])

  const { plan: repacked } = repairContentGroupLayout(plan, contentGroupModel, textBlocks)
  const title = repacked.pages.flatMap((p) => p.elements).find((el) => el.text_source === 'paragraph_1')
  assert.equal(title.col_span, 6)
  assert.ok(title.box_mm.hMm < 13, 'full-width title should render as a one-line tight box')

  const after = validateLayoutPlan(repacked, { imageCount: 0, textBlocks, contentGroupModel })
  assert.equal(after.issues.length, 0, JSON.stringify(after.issues))
})

test('full-width long Latin titles reserve wrapped-line height before subtitles', () => {
  const textBlocks = [
    { id: 'p1', role: 'title', text: 'THE LEGACY OF BAUHAUS', char_count: 21, group_id: 0 },
    { id: 'p2', role: 'section_label', text: 'Modern design legacy', char_count: 20, group_id: 0 },
    { id: 'p3', role: 'body', text: 'Short body text.', char_count: 16, group_id: 0 },
  ]
  const contentGroupModel = buildContentGroups({ textBlocks, imageCount: 0 })
  const plan = {
    ...planWith([{ page: 1, elements: [] }]),
    grid: { columns: 1, rows: 12 },
    grid_spec: { columns: 1, rows: 12, gutter_mm: 4 },
  }

  const { plan: repacked } = repairContentGroupLayout(plan, contentGroupModel, textBlocks)
  const title = repacked.pages.flatMap((p) => p.elements).find((el) => el.text_source === 'paragraph_1')
  const subtitle = repacked.pages.flatMap((p) => p.elements).find((el) => el.text_source === 'paragraph_2')

  assert.equal(title.col_span, 1)
  assert.ok(title.box_mm.wMm > 100)
  assert.ok(title.box_mm.hMm > 25, 'full-width THE LEGACY OF BAUHAUS should reserve two title lines')
  assert.ok(subtitle.box_mm.yMm >= title.box_mm.yMm + title.box_mm.hMm)

  const after = validateLayoutPlan(repacked, { imageCount: 0, textBlocks, contentGroupModel })
  assert.equal(after.issues.length, 0, JSON.stringify(after.issues))
})

test('wrapped title boxes reserve enough height for every rendered line', () => {
  const textBlocks = [
    { id: 'p1', role: 'title', text: 'GRAPHIC DESIGN', char_count: 14, group_id: 0 },
    { id: 'p2', role: 'section_label', text: 'Formation of Bauhaus graphic design', char_count: 36, group_id: 0 },
    { id: 'p3', role: 'body', text: 'Short body text.', char_count: 16, group_id: 0 },
    { id: 'p4', role: 'title', text: 'THE LEGACY OF BAUHAUS', char_count: 21, group_id: 1 },
    { id: 'p5', role: 'section_label', text: 'Modern design legacy', char_count: 20, group_id: 1 },
    { id: 'p6', role: 'body', text: 'Short body text.', char_count: 16, group_id: 1 },
  ]
  const contentGroupModel = buildContentGroups({ textBlocks, imageCount: 0 })
  const plan = planWith([{ page: 1, elements: [] }])

  const { plan: repacked } = repairContentGroupLayout(plan, contentGroupModel, textBlocks)
  const elements = repacked.pages.flatMap((p) => p.elements)
  const graphic = elements.find((el) => el.text_source === 'paragraph_1')
  const legacy = elements.find((el) => el.text_source === 'paragraph_4')
  const graphicSubtitle = elements.find((el) => el.text_source === 'paragraph_2')
  const legacySubtitle = elements.find((el) => el.text_source === 'paragraph_5')

  assert.ok(graphic.box_mm.hMm > 20, 'GRAPHIC DESIGN should reserve two title lines in a half-width band')
  assert.ok(legacy.box_mm.hMm > 35, 'THE LEGACY OF BAUHAUS should reserve three title lines in a half-width band')
  assert.ok(graphicSubtitle.box_mm.yMm >= graphic.box_mm.yMm + graphic.box_mm.hMm)
  assert.ok(legacySubtitle.box_mm.yMm >= legacy.box_mm.yMm + legacy.box_mm.hMm)

  const after = validateLayoutPlan(repacked, { imageCount: 0, textBlocks, contentGroupModel })
  assert.equal(after.issues.length, 0, JSON.stringify(after.issues))
})

test('narrow Korean section headings reserve wrapped-line height before body', () => {
  const heading = '\uAE30\uD558\uD559\uC801 \uD615\uD0DC\uC640 \uC81C\uD55C\uB41C \uC0C9\uCC44'
  const textBlocks = [
    { id: 'p1', role: 'section_label', text: heading, char_count: heading.length, group_id: 0 },
    { id: 'p2', role: 'body', text: 'Short body text.', char_count: 16, group_id: 0 },
  ]
  const contentGroupModel = buildContentGroups({ textBlocks, imageCount: 0 })
  const plan = planWith([{ page: 1, elements: [] }])

  const { plan: repacked } = repairContentGroupLayout(plan, contentGroupModel, textBlocks)
  const headingEl = repacked.pages.flatMap((p) => p.elements).find((el) => el.text_source === 'paragraph_1')
  const bodyEl = repacked.pages.flatMap((p) => p.elements).find((el) => el.text_source === 'paragraph_2')

  assert.equal(headingEl.col_span, 3)
  assert.ok(headingEl.box_mm.hMm > 13, 'narrow Korean heading should reserve two section-label lines')
  assert.ok(bodyEl.box_mm.yMm >= headingEl.box_mm.yMm + headingEl.box_mm.hMm)

  const after = validateLayoutPlan(repacked, { imageCount: 0, textBlocks, contentGroupModel })
  assert.equal(after.issues.length, 0, JSON.stringify(after.issues))
})

test('same-tier one-line headings get the same tight height', () => {
  const longHeading = '\uD3EC\uD1A0\uADF8\uB7A8\uACFC \uC0C8\uB85C\uC6B4 \uC0AC\uC9C4'
  const shortHeading = '\uD0C0\uC774\uD3EC\uD3EC\uD1A0'
  const textBlocks = [
    { id: 'p1', role: 'section_label', text: longHeading, char_count: longHeading.length, group_id: 0 },
    { id: 'p2', role: 'body', text: 'Short body text.', char_count: 16, group_id: 0 },
    { id: 'p3', role: 'section_label', text: shortHeading, char_count: shortHeading.length, group_id: 1 },
    { id: 'p4', role: 'body', text: 'Short body text.', char_count: 16, group_id: 1 },
  ]
  const contentGroupModel = buildContentGroups({ textBlocks, imageCount: 0 })
  const plan = planWith([{ page: 1, elements: [] }])

  const { plan: repacked } = repairContentGroupLayout(plan, contentGroupModel, textBlocks)
  const elements = repacked.pages.flatMap((p) => p.elements)
  const longEl = elements.find((el) => el.text_source === 'paragraph_1')
  const shortEl = elements.find((el) => el.text_source === 'paragraph_3')

  assert.ok(longEl.box_mm.hMm < 7, 'long Korean heading should still be measured as one line')
  assert.equal(longEl.box_mm.hMm, shortEl.box_mm.hMm)

  const after = validateLayoutPlan(repacked, { imageCount: 0, textBlocks, contentGroupModel })
  assert.equal(after.issues.length, 0, JSON.stringify(after.issues))
})

test('forced full-bleed landscape images reuse the remaining page rows for their text group', () => {
  const textBlocks = [
    { id: 'p1', role: 'title', char_count: 10, group_id: 0 },
    { id: 'p2', role: 'body', char_count: 180, group_id: 0 },
  ]
  const contentGroupModel = buildContentGroups({ textBlocks, imageCount: 1 })
  const plan = planWith([{ page: 1, elements: [img('image_1', { col_start: 1, col_span: 6, row_start: 1, row_span: 12, bleed: 'full' })] }])

  const { plan: repacked } = repairContentGroupLayout(plan, contentGroupModel, textBlocks, [1], { imageAspectRatios: [1.5] })
  assert.equal(repacked.pages.length, 1)
  const elements = repacked.pages[0].elements
  const image = elements.find((el) => el.id === 'image_1')
  const title = elements.find((el) => el.text_source === 'paragraph_1')
  const body = elements.find((el) => el.text_source === 'paragraph_2')

  assert.equal(image.bleed, 'full')
  assert.ok(image.row_span < 12, 'landscape contain image should leave rows below it')
  assert.ok(title.row_start > image.row_span)
  assert.ok(body.row_start > title.row_start)

  const after = validateLayoutPlan(repacked, { imageCount: 1, textBlocks, contentGroupModel, forcedFullBleedImages: [1], allowUnforcedFullBleed: false })
  assert.equal(after.issues.length, 0, JSON.stringify(after.issues))
})

// Regression (2026-07-28, real generation failure): "❌ 콘텐츠 그룹 침범: 그룹 7의 요소 head_p12가
// 그룹 8이 차지한 영역 안에 배치되었습니다". Root cause: when a text-only group's body paragraph is
// too long for the current band, splitTextOnlyGroupForRows() splits it into a "fits here" chunk and
// a "remaining" chunk. The remaining chunk used to continue into the NEXT column band on the SAME
// page (bandIndex += 1) -- e.g. a body's first half at the bottom of band 0 and its second half at
// the top of band 1. The cohesion validator computes each group's occupied area as one bounding
// rectangle over all its elements, so that diagonal split makes the body's group span the full page
// width and height, which then falsely reports an unrelated group's elements elsewhere on the same
// page (e.g. a title+subtitle in band 0) as "intruding" into the body's bounding box, even though
// nothing actually overlaps on screen. Fixed by always giving a continued group's remaining chunk a
// fresh page instead of a different band on the same page.
test('a group whose body continues into another band never causes a false intrusion against a sibling group on the same page', () => {
  const textBlocks = [
    { id: 'p1', role: 'title', char_count: 12, group_id: 0 },
    { id: 'p2', role: 'section_label', char_count: 20, group_id: 0 },
    { id: 'p3', role: 'body', char_count: 450, group_id: 1 },
  ]
  const contentGroupModel = buildContentGroups({ textBlocks, imageCount: 0 })
  const plan = {
    ...planWith([{ page: 1, elements: [] }]),
    grid: { columns: 4, rows: 12 },
    grid_spec: { columns: 4, rows: 12, gutter_mm: 5.5 },
  }

  const { plan: repacked } = repairContentGroupLayout(plan, contentGroupModel, textBlocks)

  // The long body must not appear twice on the same page in two different bands.
  const bodyPlacementsByPage = new Map()
  repacked.pages.forEach((page) => {
    const count = page.elements.filter((el) => el.text_source === 'paragraph_3').length
    if (count > 0) bodyPlacementsByPage.set(page.page, count)
  })
  bodyPlacementsByPage.forEach((count, page) => {
    assert.equal(count, 1, `page ${page} must not hold two chunks of the same continued body`)
  })

  const after = validateLayoutPlan(repacked, { imageCount: 0, textBlocks, contentGroupModel })
  assert.equal(after.issues.length, 0, JSON.stringify(after.issues))
})

// Regression (2026-07-28, real generation + explicit user decision "텍스트 우선"): a body
// paragraph in the same content group as an image was too long to fit even at full page width
// (1566 chars needing 1320 chars' worth of room at the maximum possible box) -- previously this
// had NO recovery path at all (splitting was refused outright for any group with an inline image),
// so validation hard-failed. Text must never be cut off, so this case is now allowed to split: the
// image and a fitting first chunk of the body share page 1, and the rest of the body continues
// onto a fresh page 2, with no text lost and no duplication.
test('an image-bearing group whose body is too long for any single page splits instead of failing, and cohesion is not falsely flagged', () => {
  const textBlocks = [{ id: 'p1', role: 'body', char_count: 1566, group_id: 0 }]
  const contentGroupModel = {
    groups: [{
      group: 0, text_sources: ['paragraph_1'], images: ['image_1'], char_count: 1566, has_body: true,
    }],
    groupByTextSource: new Map([['paragraph_1', 0]]),
    groupByImageId: new Map([['image_1', 0]]),
  }
  const plan = {
    ...planWith([{ page: 1, elements: [] }]),
    grid: { columns: 3, rows: 12 },
    grid_spec: { columns: 3, rows: 12, gutter_mm: 6 },
  }

  const { plan: repacked, repaired } = repairContentGroupLayout(plan, contentGroupModel, textBlocks)
  assert.equal(repaired, true)

  const placements = repacked.pages
    .flatMap((page) => page.elements.map((el) => ({ page: page.page, el })))
    .filter((p) => p.el.text_source === 'paragraph_1')
  assert.equal(placements.length, 2, 'the body should split into exactly two chunks')
  assert.equal(
    placements.reduce((sum, p) => sum + p.el.__charCount, 0),
    1566,
    'no characters lost or duplicated across the split',
  )

  const imagePlacement = repacked.pages
    .flatMap((page) => page.elements.map((el) => ({ page: page.page, el })))
    .find((p) => p.el.type === 'image')
  const firstChunkPage = placements.find((p) => p.el.__charCount < 1566).page
  assert.equal(imagePlacement.page, firstChunkPage, 'the image must share a page with the start of the text, not be stranded alone')

  const after = validateLayoutPlan(repacked, { imageCount: 1, textBlocks, contentGroupModel })
  assert.equal(after.issues.length, 0, JSON.stringify(after.issues))
})

// An image-bearing group that simply doesn't fit the CURRENT narrow band -- but WOULD fit on one
// page once promoted to full width -- must still promote instead of splitting. Splitting must only
// be a last resort when even full-page width isn't enough, so ordinary cohesion is preserved in
// the common case.
test('an image-bearing group that fits at full width is promoted whole, never split, when the narrow band alone is not enough', () => {
  const textBlocks = [{ id: 'p1', role: 'body', char_count: 400, group_id: 0 }]
  const contentGroupModel = {
    groups: [{
      group: 0, text_sources: ['paragraph_1'], images: ['image_1'], char_count: 400, has_body: true,
    }],
    groupByTextSource: new Map([['paragraph_1', 0]]),
    groupByImageId: new Map([['image_1', 0]]),
  }
  const plan = {
    ...planWith([{ page: 1, elements: [] }]),
    grid: { columns: 4, rows: 12 },
    grid_spec: { columns: 4, rows: 12, gutter_mm: 5.5 },
  }

  const { plan: repacked } = repairContentGroupLayout(plan, contentGroupModel, textBlocks)
  const placements = repacked.pages
    .flatMap((page) => page.elements)
    .filter((el) => el.text_source === 'paragraph_1')
  assert.equal(placements.length, 1, 'a group that fits at full width must not be split')

  const after = validateLayoutPlan(repacked, { imageCount: 1, textBlocks, contentGroupModel })
  assert.equal(after.issues.length, 0, JSON.stringify(after.issues))
})

test('returns unchanged when there is no group model to work from', () => {
  const plan = splitPlan()
  const result = repairContentGroupLayout(plan, null, textBlocksFixture())
  assert.equal(result.repaired, false)
  assert.equal(result.plan, plan)
})

test('three-column text groups choose a wider two-column measure for heading plus short body', () => {
  const textBlocks = [
    { id: 'p1', role: 'section_label', text: 'Context', char_count: 7, group_id: 0 },
    { id: 'p2', role: 'body', text: 'Short explanatory body.'.repeat(8), char_count: 190, group_id: 0 },
  ]
  const contentGroupModel = buildContentGroups({ textBlocks, imageCount: 0 })
  const plan = {
    ...planWith([{ page: 1, elements: [] }]),
    grid: { columns: 3, rows: 16 },
    grid_spec: { columns: 3, rows: 16, gutter_mm: 6, page_size: 'A4', margin_preset: 'recommended' },
  }

  const { plan: repacked } = repairContentGroupLayout(plan, contentGroupModel, textBlocks)
  const placed = repacked.pages.flatMap((p) => p.elements)
  const heading = placed.find((el) => el.text_source === 'paragraph_1')
  const body = placed.find((el) => el.text_source === 'paragraph_2')

  assert.equal(heading.col_span, 2)
  assert.equal(body.col_span, 2)

  const after = validateLayoutPlan(repacked, { imageCount: 0, textBlocks, contentGroupModel })
  assert.equal(after.issues.length, 0, JSON.stringify(after.issues))
})

test('five-column image text groups choose a three-column editorial measure', () => {
  const textBlocks = [
    { id: 'p1', role: 'section_label', text: 'Image story', char_count: 11, group_id: 0 },
    { id: 'p2', role: 'body', text: 'Short body text.', char_count: 16, group_id: 0 },
  ]
  const contentGroupModel = buildContentGroups({ textBlocks, imageCount: 1 })
  const plan = {
    ...planWith([{ page: 1, elements: [] }]),
    grid: { columns: 5, rows: 16 },
    grid_spec: { columns: 5, rows: 16, gutter_mm: 5, page_size: 'A4', margin_preset: 'recommended' },
  }

  const { plan: repacked } = repairContentGroupLayout(plan, contentGroupModel, textBlocks)
  const placed = repacked.pages.flatMap((p) => p.elements)
  const image = placed.find((el) => el.id === 'image_1')
  const heading = placed.find((el) => el.text_source === 'paragraph_1')
  const body = placed.find((el) => el.text_source === 'paragraph_2')

  assert.equal(image.col_span, 3)
  assert.equal(heading.col_span, 3)
  assert.equal(body.col_span, 3)

  const after = validateLayoutPlan(repacked, { imageCount: 1, textBlocks, contentGroupModel })
  assert.equal(after.issues.length, 0, JSON.stringify(after.issues))
})
