import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildContentGroups, summarizeContentGroupsForPrompt } from './buildContentGroups.js'

function block(id, groupId, role = 'body', charCount = 200, text = '') {
  return {
    id, group_id: groupId, role, char_count: charCount, text,
  }
}

test('one group per blank-line cluster, with its paragraphs listed in order', () => {
  const { groups } = buildContentGroups({
    textBlocks: [
      block('p1', 0, 'section_label', 10),
      block('p2', 0, 'body', 300),
      block('p3', 1, 'body', 300),
    ],
    imageCount: 0,
  })

  assert.equal(groups.length, 2)
  assert.deepEqual(groups[0].text_sources, ['paragraph_1', 'paragraph_2'])
  assert.deepEqual(groups[1].text_sources, ['paragraph_3'])
})

test('images are distributed one per group, in document order', () => {
  const { groups, groupByImageId, groupByTextSource } = buildContentGroups({
    textBlocks: [block('p1', 0, 'body', 300), block('p2', 1, 'body', 300)],
    imageCount: 2,
  })

  assert.deepEqual(groups[0].images, ['image_1'])
  assert.deepEqual(groups[1].images, ['image_2'])
  assert.equal(groupByImageId.get('image_1'), 0)
  assert.equal(groupByImageId.get('image_2'), 1)
  assert.equal(groupByTextSource.get('paragraph_1'), 0)
  assert.equal(groupByTextSource.get('paragraph_2'), 1)
})

// The whole point of the module: an image must always land in the same group as the text written
// for it, whatever the document is about.
test('a heading-only group is skipped as an image anchor while a prose group exists', () => {
  const { groups } = buildContentGroups({
    textBlocks: [block('p1', 0, 'section_label', 12), block('p2', 1, 'body', 500)],
    imageCount: 1,
  })

  assert.deepEqual(groups[0].images, [], 'a lone heading must not be the anchor')
  assert.deepEqual(groups[1].images, ['image_1'])
})

test('an odd surplus image goes to the longest group, and every image is assigned', () => {
  const { groups, groupByImageId } = buildContentGroups({
    textBlocks: [block('p1', 0, 'body', 100), block('p2', 1, 'body', 900)],
    imageCount: 3,
  })

  const assigned = groups.flatMap((g) => g.images)
  assert.equal(assigned.length, 3)
  assert.equal(new Set(assigned).size, 3, 'no image assigned twice')
  // Both groups get one image, then the single surplus goes to the far longer group 1.
  assert.deepEqual(groups[0].images, ['image_1'])
  assert.deepEqual(groups[1].images, ['image_2', 'image_3'])
  assert.equal(groupByImageId.get('image_1'), 0)
})

test('an even surplus is shared out rather than piled onto one group', () => {
  const { groups } = buildContentGroups({
    textBlocks: [block('p1', 0, 'body', 100), block('p2', 1, 'body', 900)],
    imageCount: 4,
  })

  const assigned = groups.flatMap((g) => g.images)
  assert.equal(assigned.length, 4)
  assert.equal(new Set(assigned).size, 4, 'no image assigned twice')
  assert.equal(groups[0].images.length, 2)
  assert.equal(groups[1].images.length, 2)
})

test('fewer images than groups: the longest groups win, assigned in document order', () => {
  const { groups } = buildContentGroups({
    textBlocks: [block('p1', 0, 'body', 50), block('p2', 1, 'body', 900), block('p3', 2, 'body', 600)],
    imageCount: 2,
  })

  assert.deepEqual(groups[0].images, [])
  assert.deepEqual(groups[1].images, ['image_1'])
  assert.deepEqual(groups[2].images, ['image_2'])
})

test('no images yields groups with no image references', () => {
  const { groups } = buildContentGroups({ textBlocks: [block('p1', 0)], imageCount: 0 })
  assert.deepEqual(groups[0].images, [])
  assert.deepEqual(summarizeContentGroupsForPrompt(groups), [{ group: 0, text_sources: ['paragraph_1'] }])
})

test('empty input is handled without throwing', () => {
  const { groups, groupByImageId } = buildContentGroups({ textBlocks: [], imageCount: 3 })
  assert.deepEqual(groups, [])
  assert.equal(groupByImageId.size, 0)
})

// Filename hint (2026-07-28): an image whose filename words unambiguously point at one group
// overrides plain document order, so a user who names files to match content can pull an image
// out of its default (positional) slot into the right one.
test('a filename hint overrides document order when it points at exactly one group', () => {
  const { groups } = buildContentGroups({
    textBlocks: [
      block('p1', 0, 'body', 300, '데사우 바우하우스 건물의 외관을 다룬다.'),
      block('p2', 1, 'body', 300, '발터 그로피우스의 생애를 다룬다.'),
    ],
    imageCount: 2,
    // image_1's filename matches group 1 (그로피우스), image_2's filename matches group 0 (건물) --
    // the reverse of what plain document order (image_1 -> group0, image_2 -> group1) would give.
    imageNames: ['1_1.그로피우스_인물사진.jpg', '2_2.바우하우스_건물_외관.jpg'],
  })

  assert.deepEqual(groups[0].images, ['image_2'], 'the building photo should follow the building paragraph')
  assert.deepEqual(groups[1].images, ['image_1'], 'the portrait should follow the Gropius paragraph')
})

test('an ambiguous filename (matches multiple groups, or none) falls back to document order', () => {
  const { groups } = buildContentGroups({
    textBlocks: [
      block('p1', 0, 'body', 300, '바우하우스는 건축과 디자인을 다룬다.'),
      block('p2', 1, 'body', 300, '바우하우스는 예술 교육 운동이었다.'),
    ],
    imageCount: 2,
    // "바우하우스" appears in both paragraphs (tie), "무제" appears in neither -- both are
    // unresolvable hints, so plain document order applies to both.
    imageNames: ['1_1.바우하우스.jpg', '2_2.무제.jpg'],
  })

  assert.deepEqual(groups[0].images, ['image_1'])
  assert.deepEqual(groups[1].images, ['image_2'])
})

test('a hinted group can still receive a surplus image, and every image is still assigned exactly once', () => {
  const { groups } = buildContentGroups({
    textBlocks: [
      block('p1', 0, 'body', 100, '짧은 소개 문단.'),
      block('p2', 1, 'body', 900, '아주 긴 본문 문단이 이어진다.'),
    ],
    imageCount: 3,
    imageNames: ['1_1.본문_사진.jpg', '', ''], // only image_1 is hinted ("본문" only appears in group 1's text)
  })

  const assigned = groups.flatMap((g) => g.images)
  assert.equal(assigned.length, 3)
  assert.equal(new Set(assigned).size, 3, 'no image assigned twice')
  assert.ok(groups[1].images.includes('image_1'), 'the hinted image must land in its matched group')
  assert.ok(groups[0].images.length >= 1, 'the other group must still get its own image, not be skipped')
})

test('no imageNames provided behaves identically to before the hint feature existed', () => {
  const { groups } = buildContentGroups({
    textBlocks: [block('p1', 0, 'body', 300), block('p2', 1, 'body', 300)],
    imageCount: 2,
  })
  assert.deepEqual(groups[0].images, ['image_1'])
  assert.deepEqual(groups[1].images, ['image_2'])
})
