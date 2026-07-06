import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyzeInput } from './analyzeInput.js'

function makeFakePng(width, height) {
  const buf = Buffer.alloc(33)
  buf.write('\x89PNG\r\n\x1a\n', 0, 'binary')
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12, 'ascii')
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  buf.writeUInt8(8, 24)
  buf.writeUInt8(6, 25)
  buf.writeUInt8(0, 26)
  buf.writeUInt8(0, 27)
  buf.writeUInt8(0, 28)
  buf.writeUInt32BE(0, 29)
  return buf
}

test('analyzeInput reads width/height/aspect ratio per image and text length', () => {
  const dir = mkdtempSync(join(tmpdir(), 'imprint-it-'))
  const p1 = join(dir, 'a.png')
  const p2 = join(dir, 'b.png')
  writeFileSync(p1, makeFakePng(200, 100))
  writeFileSync(p2, makeFakePng(100, 100))

  const result = analyzeInput({ imagePaths: [p1, p2], text: '가 나 다' })

  assert.equal(result.imageCount, 2)
  assert.equal(result.images[0].width, 200)
  assert.equal(result.images[0].height, 100)
  assert.equal(result.images[0].aspectRatio, 2)
  assert.equal(result.images[1].aspectRatio, 1)
  assert.equal(result.textLength, 5)
  assert.equal(result.textLengthNoSpaces, 3)

  rmSync(dir, { recursive: true, force: true })
})

test('analyzeInput rejects 0 images or more than 6', () => {
  assert.throws(() => analyzeInput({ imagePaths: [], text: 'x' }), /1~6/)
  const seven = Array(7).fill('unused.png')
  assert.throws(() => analyzeInput({ imagePaths: seven, text: 'x' }), /1~6/)
})
