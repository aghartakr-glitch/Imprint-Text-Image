// server/index.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
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
// GET /etc/passwd (no /outputs/ prefix). That's not a /outputs/ request at all — it's a genuinely
// unmatched route, so it's rejected by the generic catch-all with 404 (not by serveStatic's own
// path-traversal guard, and not 400 — 400 would wrongly imply the request was malformed rather
// than simply not matching any known route). See the percent-encoded-slash test further down for
// a request that genuinely exercises serveStatic's `relative.includes('..')` check.
test('GET /outputs/../../etc/passwd (normalized away by fetch) 404s as an unmatched route', async () => {
  const outputsDir = mkdtempSync(join(tmpdir(), 'imprint-it-http-outputs-'))
  const app = createApp({ outputsDir, uploadsDir: outputsDir })
  const port = await startServer(app)

  const response = await fetch(`http://localhost:${port}/outputs/../../etc/passwd`)
  assert.equal(response.status, 404)

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

// Regression test for the unhandled-busboy-error DoS: a malformed multipart body used to throw
// an uncaught exception from inside busboy's parser and crash the whole Node process, taking down
// every other in-flight request with it. Built with a raw http.request (not fetch+FormData, which
// always produces a well-formed body) so the multipart data busboy receives is genuinely broken.
test('malformed multipart body returns an error response instead of crashing the server', async () => {
  const outputsDir = mkdtempSync(join(tmpdir(), 'imprint-it-http-outputs-'))
  const uploadsDir = mkdtempSync(join(tmpdir(), 'imprint-it-http-uploads-'))
  const app = createApp({ outputsDir, uploadsDir })
  const port = await startServer(app)

  // Declares boundary "x" but the body never contains a valid "--x" boundary sequence/headers,
  // so busboy's parser chokes on it and emits an 'error' event while parsing.
  const garbageBody = 'this is not valid multipart data at all\r\nno boundaries, no headers, just noise\r\n'.repeat(50)

  const malformedStatus = await new Promise((resolve, reject) => {
    const req = request({
      hostname: 'localhost',
      port,
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=x',
        'Content-Length': Buffer.byteLength(garbageBody),
      },
    }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', reject)
    req.end(garbageBody)
  })

  // Accept any 4xx (the important thing is the server responded at all, rather than the
  // connection dying or the process crashing) but expect the documented 400 path specifically.
  assert.ok(malformedStatus >= 400 && malformedStatus < 500, `expected a 4xx response, got ${malformedStatus}`)

  // Prove the server process/instance is still alive and serving requests after the malformed one.
  const followUp = await fetch(`http://localhost:${port}/outputs/does-not-exist.pdf`)
  assert.equal(followUp.status, 404)

  app.close()
  rmSync(outputsDir, { recursive: true, force: true })
  rmSync(uploadsDir, { recursive: true, force: true })
})

test('POST /api/generate rejects a 7th image over the 6-file limit', async () => {
  const outputsDir = mkdtempSync(join(tmpdir(), 'imprint-it-http-outputs-'))
  const uploadsDir = mkdtempSync(join(tmpdir(), 'imprint-it-http-uploads-'))
  const app = createApp({ outputsDir, uploadsDir })
  const port = await startServer(app)

  const form = new FormData()
  form.append('text', '가나다라마바사아자차카파타하'.repeat(30))
  for (let i = 0; i < 7; i += 1) {
    form.append('images', new Blob([Buffer.from(TINY_PNG_BASE64, 'base64')], { type: 'image/png' }), `photo${i}.png`)
  }

  const response = await fetch(`http://localhost:${port}/api/generate?mock=1`, { method: 'POST', body: form })
  const body = await response.json()

  assert.equal(response.status, 400)
  assert.match(body.error, /최대 6장/)

  app.close()
  rmSync(outputsDir, { recursive: true, force: true })
  rmSync(uploadsDir, { recursive: true, force: true })
})
