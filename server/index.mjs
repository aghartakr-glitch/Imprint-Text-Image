// server/index.mjs
import { createServer } from 'node:http'
import {
  createReadStream, createWriteStream, existsSync, mkdirSync, statSync,
} from 'node:fs'
import { join, extname } from 'node:path'
import Busboy from 'busboy'
import { runGeneration } from './runGeneration.mjs'
import { ROOT, OUTPUTS_DIR } from './env.mjs'

const DEFAULT_UPLOADS_DIR = join(ROOT, 'uploads')
const MIME_TYPES = {
  '.pdf': 'application/pdf', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function handleGenerate(req, res, { uploadsDir, outputsDir, mockMode }) {
  mkdirSync(uploadsDir, { recursive: true })
  // limits.files is set to 7 (one above the intended cap of 6), not 6: busboy silently stops
  // emitting 'file' events once the limit is reached (no error, no event), which would make our
  // own `fileCount > 6` rejection below dead code. Raising the busboy limit by 1 lets a 7th file
  // actually reach the 'file' handler so the manual check can see it and reject it.
  let bb
  try {
    // Busboy's constructor throws *synchronously* (before any listener can be attached) for
    // things like a Content-Type of "multipart/form-data" with no boundary= parameter, or a
    // missing/malformed Content-Type entirely. Without this try/catch, that throw is an uncaught
    // exception that crashes the whole Node process on a single bad request.
    bb = Busboy({ headers: req.headers, limits: { files: 7, fileSize: 30 * 1024 * 1024 } })
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: `잘못된 업로드 요청입니다: ${String(err.message || err)}` })
  }
  const imagePaths = []
  const writePromises = []
  let text = ''
  let fileCount = 0
  let rejected = null
  // busboy can fire 'error' and then still fire 'close' (behavior varies by version/error type),
  // so guard against sending a second response by only letting the first respond() call through.
  let responded = false

  function respond(status, body) {
    if (responded) return
    responded = true
    sendJson(res, status, body)
  }

  bb.on('field', (name, value) => {
    if (name === 'text') text = value
  })

  bb.on('file', (name, stream, info) => {
    // busboy invokes this listener synchronously as part of its own internal event emission for
    // this file part. Any synchronous throw inside this body does NOT propagate back to `bb`'s own
    // 'error' event (so the bb.on('error', ...) handler below never sees it) — instead it becomes
    // an unhandled exception that crashes the whole Node process. Wrapping the whole body in
    // try/catch, draining the stream, and recording `rejected` mirrors how the file-count-limit
    // case above already degrades gracefully instead of crashing.
    try {
      fileCount += 1
      if (fileCount > 6) {
        rejected = '이미지는 최대 6장까지 업로드할 수 있습니다'
        stream.resume()
        return
      }
      // A multipart file part with an empty/missing filename (filename="") makes info.filename
      // falsy; calling .replace on it directly throws a synchronous TypeError.
      const originalName = info.filename || 'unnamed'
      const safeName = `${Date.now()}_${fileCount}_${originalName.replace(/[^\w.\-가-힣]/g, '_')}`
      const dest = join(uploadsDir, safeName)
      imagePaths.push(dest)
      const writeStream = createWriteStream(dest)
      writePromises.push(new Promise((resolve, reject) => {
        writeStream.on('finish', resolve)
        writeStream.on('error', reject)
        stream.on('error', reject)
      }))
      // busboy truncates the stream (rather than erroring) once fileSize is hit and emits 'limit'
      // on the per-file stream. Without this, an oversized upload silently saves a truncated file
      // and returns 200 ok:true.
      stream.on('limit', () => {
        rejected = '이미지 파일이 너무 큽니다(최대 30MB)'
      })
      stream.pipe(writeStream)
    } catch (err) {
      rejected = '파일 업로드 처리 중 오류가 발생했습니다: ' + String(err.message || err)
      stream.resume()
    }
  })

  // A malformed multipart body (bad boundary, truncated body, etc.) makes busboy emit 'error'.
  // Without this listener, that error is unhandled and crashes the whole Node process, taking
  // down every other concurrent request with it.
  bb.on('error', (err) => {
    respond(400, { ok: false, error: '잘못된 요청 본문입니다: ' + String(err.message || err) })
    req.unpipe(bb)
    req.resume()
  })

  bb.on('close', async () => {
    if (rejected) return respond(400, { ok: false, error: rejected })
    try {
      await Promise.all(writePromises)
    } catch (err) {
      return respond(500, { ok: false, error: String(err.message || err) })
    }
    if (imagePaths.length < 1) return respond(400, { ok: false, error: '이미지를 1장 이상 업로드해야 합니다' })
    if (!text.trim()) return respond(400, { ok: false, error: '본문 텍스트를 입력해야 합니다' })
    try {
      const result = await runGeneration({
        imagePaths, text, outputsRoot: outputsDir, llmOptions: { mockMode },
      })
      respond(200, {
        ok: true,
        runId: result.runId,
        style: result.styleResult.style,
        candidates: Object.fromEntries(Object.entries(result.candidateResults).map(([key, value]) => {
          if (value.error) {
            return [key, { ok: false, error: value.error }]
          }
          return [key, {
            ok: true,
            pagesPdf: `/outputs/${result.runId}/${value.dir.split(/[\\/]/).pop()}/pages.pdf`,
            spreadPdf: `/outputs/${result.runId}/${value.dir.split(/[\\/]/).pop()}/spread-preview.pdf`,
            compileOk: value.compile.ok,
            spreadOk: value.spread.ok,
          }]
        })),
      })
    } catch (err) {
      respond(500, { ok: false, error: String(err.message || err) })
    }
  })

  req.pipe(bb)
}

function serveStatic(req, res, urlPath, outputsDir) {
  let relative
  try {
    // decodeURIComponent throws a synchronous URIError on malformed percent-encoding (e.g. a lone
    // "%" or "%zz"). Without this try/catch, a single malformed GET /outputs/... URL is an
    // uncaught exception that crashes the whole Node process.
    relative = decodeURIComponent(urlPath.replace(/^\/outputs\//, '').split('?')[0])
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: '잘못된 경로: ' + String(err.message || err) })
  }
  if (relative.includes('..')) return sendJson(res, 400, { ok: false, error: '잘못된 경로' })
  const filePath = join(outputsDir, relative)
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return sendJson(res, 404, { ok: false, error: '파일 없음' })
  const ext = extname(filePath)
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' })
  createReadStream(filePath).pipe(res)
}

export function createApp({ uploadsDir = DEFAULT_UPLOADS_DIR, outputsDir = OUTPUTS_DIR } = {}) {
  return createServer((req, res) => {
    // Systematic safety net: this catch is a backstop for *synchronous* throws anywhere in the
    // routing dispatch below (including inside handleGenerate/serveStatic's synchronous setup
    // code), so that any future unguarded throw we haven't specifically anticipated results in a
    // clean 500 JSON response instead of crashing the whole Node process. It does NOT catch
    // errors from asynchronous callbacks (e.g. busboy's 'error'/'file' events, stream events) —
    // those happen after this try/catch has already returned, so they still need their own
    // handling (see the busboy-specific error handling inside handleGenerate).
    try {
      if (req.method === 'POST' && req.url.startsWith('/api/generate')) {
        const mockMode = req.url.includes('mock=1') || process.env.MOCK_MODE === 'true'
        return handleGenerate(req, res, { uploadsDir, outputsDir, mockMode })
      }
      if (req.method === 'GET' && req.url.startsWith('/outputs/')) {
        return serveStatic(req, res, req.url, outputsDir)
      }
      // Any other request (including a would-be "/outputs/../../etc/passwd" traversal —
      // browsers/fetch normalize dot-segments client-side, so by the time it arrives here
      // it no longer even has the /outputs/ prefix) doesn't match this server's known
      // surface (POST /api/generate, GET /outputs/*). This is a genuinely unmatched route
      // (e.g. a stray /favicon.ico request), so respond with a normal 404 rather than 400 —
      // 400 should mean "malformed request", not "route doesn't exist".
      return sendJson(res, 404, { ok: false, error: 'Not found' })
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: `서버 오류: ${String(err.message || err)}` })
      }
      return undefined
    }
  })
}

const isMain = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
if (isMain) {
  const app = createApp()
  const port = process.env.PORT ? Number(process.env.PORT) : 8788
  app.listen(port, () => {
    console.log(`Imprint(Image+Text) server listening on http://localhost:${port}`)
  })
}
