import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildContentGroups, summarizeContentGroupsForPrompt } from './buildContentGroups.js'

function block(id, groupId, role = 'body', charCount = 200) {
  return {
    id, group_id: groupId, role, char_count: charCount,
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
