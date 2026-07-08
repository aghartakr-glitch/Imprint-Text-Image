import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTextBlocks } from './parseTextBlocks.js'

test('an explicit title becomes title_1, and every blank-line-delimited paragraph becomes its own body block in order', () => {
  const { text_blocks: blocks } = parseTextBlocks({
    title: '어떤 여름',
    text: '첫 번째 문단입니다.\n\n두 번째 문단입니다.\n\n세 번째 문단입니다.',
  })
  assert.equal(blocks.length, 4)
  assert.deepEqual(blocks[0], { id: 'title_1', role: 'title', text: '어떤 여름' })
  assert.equal(blocks[1].id, 'body_1')
  assert.equal(blocks[1].paragraph_index, 1)
  assert.equal(blocks[1].text, '첫 번째 문단입니다.')
  assert.equal(blocks[2].paragraph_index, 2)
  assert.equal(blocks[3].paragraph_index, 3)
})

test('no explicit title, but a short standalone first paragraph is promoted to title_1', () => {
  const { text_blocks: blocks } = parseTextBlocks({
    text: 'HEAR MY VOICE 목소리를 내다\n\n카네기 국제평화재단에 따르면 다양한 시위가 있었습니다.\n\n도브의 최근 캠페인은 이렇습니다.',
  })
  assert.equal(blocks[0].role, 'title')
  assert.equal(blocks[0].text, 'HEAR MY VOICE 목소리를 내다')
  assert.equal(blocks.filter((b) => b.role === 'body').length, 2)
})

test('a single paragraph with no title is never mistaken for a title (needs a following paragraph)', () => {
  const { text_blocks: blocks } = parseTextBlocks({ text: '짧은 본문' })
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].role, 'body')
})

test('a long first paragraph (contains a period) is not treated as a title candidate', () => {
  const { text_blocks: blocks } = parseTextBlocks({
    text: '이것은 문장으로 끝나는 첫 문단입니다.\n\n두 번째 문단입니다.',
  })
  assert.equal(blocks.every((b) => b.role === 'body'), true)
  assert.equal(blocks.length, 2)
})

test('empty text produces no blocks', () => {
  assert.deepEqual(parseTextBlocks({ text: '' }).text_blocks, [])
})

test('paragraph order is always preserved regardless of length', () => {
  // Each paragraph ends with a period so none of them look like a title candidate.
  const { text_blocks: blocks } = parseTextBlocks({ text: 'A.\n\nBB.\n\nCCC.\n\nDDDD.' })
  const bodies = blocks.filter((b) => b.role === 'body')
  assert.deepEqual(bodies.map((b) => b.text), ['A.', 'BB.', 'CCC.', 'DDDD.'])
  assert.deepEqual(bodies.map((b) => b.paragraph_index), [1, 2, 3, 4])
})
