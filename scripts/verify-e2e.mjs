// scripts/verify-e2e.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const imageDir = process.argv[2] ?? 'scratch/placeholder-images'
const port = process.env.PORT ?? 8788
const files = ['placeholder-1-landscape.png', 'placeholder-2-portrait.png', 'placeholder-3-square.png']

const dummyText = '가나다라마바사아자차카파타하. '.repeat(400) // long enough to force overflow pages

const form = new FormData()
for (const name of files) {
  form.append('images', new Blob([readFileSync(join(imageDir, name))], { type: 'image/png' }), name)
}
form.append('text', dummyText)

const response = await fetch(`http://localhost:${port}/api/generate`, { method: 'POST', body: form })
const body = await response.json()

if (!body.ok) {
  console.error('FAIL:', body.error)
  process.exit(1)
}

console.log(`runId: ${body.runId}`)
console.log(`style: ${body.style}`)
for (const [key, cand] of Object.entries(body.candidates)) {
  if (cand.ok === false) {
    console.log(`  candidate ${key}: ok=false error=${cand.error}`)
    console.error(`FAIL: candidate ${key} failed: ${cand.error}`)
    process.exit(1)
  }
  console.log(`  candidate ${key}: compileOk=${cand.compileOk} spreadOk=${cand.spreadOk} pagesPdf=${cand.pagesPdf}`)
  if (!cand.compileOk || !cand.spreadOk) {
    console.error(`FAIL: candidate ${key} did not fully compile`)
    process.exit(1)
  }
}
console.log('PASS: all 3 candidates compiled with both PDFs')
