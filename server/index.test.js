// server/index.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from './index.mjs'

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function startServer(app) {
  return new Promise((resolve) => {
    app.listen(0, () => resolve(app.address().port))
  })
}

test('POST /api/generate accepts multipart images+text, returns 3 candidate PDF URLs (mock style mode)', async () => {
  const outputsDir = mkdtempSync(join(tmpdir(), 'imprint-it-http-outputs-'))
  const uploadsDir = mkdtempSync(join(tmpdir(), 'imprint-it-http-uploads-'))
  const app = createApp({ outputsDir, uploadsDir })
  const port = await startServer(app)

  const form = new FormData()
  form.append('text', '가나다라마바사아자차카파타하'.repeat(30))
  form.append('images', new Blob([Buffer.from(TINY_PNG_BASE64, 'base64')], { type: 'image/png' }), 'photo.png')

  const response = await fetch(`http://localhost:${port}/api/generate?mock=1`, { method: 'POST', body: form })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.ok(body.candidates.A.pagesPdf.startsWith('/outputs/'))
  assert.ok(body.candidates.B.spreadPdf.endsWith('spread-preview.pdf'))

  app.close()
  rmSync(outputsDir, { recursive: true, force: true })
  rmSync(uploadsDir, { recursive: true, force: true })
})

// Note: fetch() normalizes "../" client-side, so this request actually reaches the server as
// GET /etc/passwd (no /outputs/ prefix) and is rejected by the generic catch-all route below,
// not by serveStatic's own path-traversal guard. See the percent-encoded-slash test further down
// for a request that genuinely exercises serveStatic's `relative.includes('..')` check.
test('GET /outputs/ rejects path traversal with 400', async () => {
  const outputsDir = mkdtempSync(join(tmpdir(), 'imprint-it-http-outputs-'))
  const app = createApp({ outputsDir, uploadsDir: outputsDir })
  const port = await startServer(app)

  const response = await fetch(`http://localhost:${port}/outputs/../../etc/passwd`)
  assert.equal(response.status, 400)

  app.close()
  rmSync(outputsDir, { recursive: true, force: true })
})

test('GET /outputs/ rejects path traversal that reaches serveStatic (percent-encoded slash)', async () => {
  const outputsDir = mkdtempSync(join(tmpdir(), 'imprint-it-http-outputs-'))
  const app = createApp({ outputsDir, uploadsDir: outputsDir })
  const port = await startServer(app)

  // fetch() normalizes literal "../" client-side, so a plain "/outputs/../../etc/passwd" never
  // reaches serveStatic's own ".." guard (see the other traversal test above, which only hits the
  // generic catch-all). A percent-encoded slash survives fetch's normalization, so this URL keeps
  // the /outputs/ prefix and actually exercises serveStatic's relative.includes('..') check.
  const response = await fetch(`http://localhost:${port}/outputs/..%2f..%2fetc/passwd`)
  assert.equal(response.status, 400)

  app.close()
  rmSync(outputsDir, { recursive: true, force: true })
})

test('GET /outputs/ 404s for a missing file', async () => {
  const outputsDir = mkdtempSync(join(tmpdir(), 'imprint-it-http-outputs-'))
  const app = createApp({ outputsDir, uploadsDir: outputsDir })
  const port = await startServer(app)

  const response = await fetch(`http://localhost:${port}/outputs/does-not-exist.pdf`)
  assert.equal(response.status, 404)

  app.close()
  rmSync(outputsDir, { recursive: true, force: true })
})
