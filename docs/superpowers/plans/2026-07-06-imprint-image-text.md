# Imprint(Image+Text) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent local web app that turns 1-6 images + body text into three LaTeX-compiled A5 editorial spread candidates (image-first / balanced / text-first), each as an individual-page PDF and a spread-preview PDF, saved with a full log.

**Architecture:** React+Vite frontend talks to a Node http backend (`server/`). Pure, unit-tested core logic lives in `src/core/` (input analysis, style inference, pattern-library lookup, deterministic pagination, LaTeX string assembly). LaTeX compiles via XeLaTeX+xeCJK; the spread PDF is derived from the individual-page PDF via `pdfpages` `nup=2x1`. Style inference calls Claude, with a deterministic rule-based fallback so the app always works without an API key.

**Tech Stack:** Node 24 (native `node --test`, ESM), React 18 + Vite 5, `image-size`, `@anthropic-ai/sdk`, `busboy` (multipart upload), XeLaTeX (TeX Live 2026, already installed), `pdftoppm`/`pdfpages`.

**Reference spec:** `docs/superpowers/specs/2026-07-06-imprint-image-text-design.md` and `PRD.md` in this repo.

---

## Task 0: Project scaffold, fonts, gitignore

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `assets/fonts/IBMPlexSerif-Regular.ttf` (copied)
- Create: `assets/fonts/IBMPlexSerif-Bold.ttf` (copied)
- Create: `assets/fonts/NotoSansKR-Regular.ttf` (copied)
- Create: `assets/fonts/NotoSansKR-Bold.ttf` (copied)
- Create: `uploads/.gitkeep`, `outputs/.gitkeep`, `logs/.gitkeep`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "imprint-image-text",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "scripts": {
    "dev": "vite --port 5175",
    "server": "node --env-file-if-exists=.env.local server/index.mjs",
    "dev:all": "concurrently -n vite,server \"npm:dev\" \"npm:server\"",
    "test": "node --test src/core"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0",
    "busboy": "^1.6.0",
    "image-size": "^1.1.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "concurrently": "^9.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "vite": "^5.4.0"
  }
}
```

Note: `--env-file-if-exists` (Node 21.7+/22+) loads `.env.local` into `process.env` for the server process without needing a `dotenv` dependency; this Node install is v24 so it's available. `npm test` doesn't need it since core/server tests never require a real `ANTHROPIC_API_KEY` (mock/injected client only).

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
uploads/*
!uploads/.gitkeep
outputs/*
!outputs/.gitkeep
logs/*
!logs/.gitkeep
scratch/
.env.local
*.aux
*.log
*.synctex.gz
dist/
```

- [ ] **Step 3: Create `.env.example`**

```
ANTHROPIC_API_KEY=
MOCK_MODE=false
```

- [ ] **Step 4: Create placeholder-keep files**

```bash
touch uploads/.gitkeep outputs/.gitkeep logs/.gitkeep
```

- [ ] **Step 5: Copy font files from sibling projects (read-only source, do not modify originals)**

```bash
mkdir -p assets/fonts
cp "$HOME/Desktop/Imprint(Cover)/Fonts/Korean/IBM 명조 - IBM_Plex_Serif/IBMPlexSerif-Regular.ttf" assets/fonts/
cp "$HOME/Desktop/Imprint(Cover)/Fonts/Korean/IBM 명조 - IBM_Plex_Serif/IBMPlexSerif-Bold.ttf" assets/fonts/
cp /c/Windows/Fonts/NotoSansKR-Regular.ttf assets/fonts/
cp /c/Windows/Fonts/NotoSansKR-Bold.ttf assets/fonts/
ls assets/fonts/
```
Expected: 4 files listed (`IBMPlexSerif-Regular.ttf`, `IBMPlexSerif-Bold.ttf`, `NotoSansKR-Regular.ttf`, `NotoSansKR-Bold.ttf`).

- [ ] **Step 6: Install dependencies**

```bash
npm install
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example assets/fonts uploads/.gitkeep outputs/.gitkeep logs/.gitkeep
git commit -m "Scaffold project: package.json, fonts, gitignore"
```

---

## Task 1: Layout constants

**Files:**
- Create: `src/core/layoutConstants.js`
- Test: `src/core/layoutConstants.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/core/layoutConstants.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PAGE_WIDTH_MM, PAGE_HEIGHT_MM, MARGIN_TOP_MM, MARGIN_BOTTOM_MM,
  MARGIN_INNER_MM, MARGIN_OUTER_MM, TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM,
  CHAR_WIDTH_MM, LINE_HEIGHT_MM,
} from './layoutConstants.js'

test('page and text-box dimensions match PRD 4.6', () => {
  assert.equal(PAGE_WIDTH_MM, 148)
  assert.equal(PAGE_HEIGHT_MM, 210)
  assert.equal(MARGIN_TOP_MM, 16)
  assert.equal(MARGIN_BOTTOM_MM, 18)
  assert.equal(MARGIN_INNER_MM, 18)
  assert.equal(MARGIN_OUTER_MM, 14)
  assert.equal(TEXT_BOX_WIDTH_MM, 148 - 18 - 14)
  assert.equal(TEXT_BOX_HEIGHT_MM, 210 - 16 - 18)
})

test('char/line size derived from 9pt/14pt typography', () => {
  assert.ok(Math.abs(CHAR_WIDTH_MM - 9 * 0.3528) < 1e-9)
  assert.ok(Math.abs(LINE_HEIGHT_MM - 14 * 0.3528) < 1e-9)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/core/layoutConstants.test.js`
Expected: FAIL (`Cannot find module './layoutConstants.js'`)

- [ ] **Step 3: Write implementation**

```js
// src/core/layoutConstants.js
export const PAGE_WIDTH_MM = 148
export const PAGE_HEIGHT_MM = 210

export const MARGIN_TOP_MM = 16
export const MARGIN_BOTTOM_MM = 18
export const MARGIN_INNER_MM = 18
export const MARGIN_OUTER_MM = 14

export const TEXT_BOX_WIDTH_MM = PAGE_WIDTH_MM - MARGIN_INNER_MM - MARGIN_OUTER_MM
export const TEXT_BOX_HEIGHT_MM = PAGE_HEIGHT_MM - MARGIN_TOP_MM - MARGIN_BOTTOM_MM

export const BODY_FONT_SIZE_PT = 9
export const BODY_LEADING_PT = 14
export const PT_TO_MM = 0.3528

export const CHAR_WIDTH_MM = BODY_FONT_SIZE_PT * PT_TO_MM
export const LINE_HEIGHT_MM = BODY_LEADING_PT * PT_TO_MM

export const IMAGE_TEXT_GAP_MM = 6
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/core/layoutConstants.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/layoutConstants.js src/core/layoutConstants.test.js
git commit -m "Add layout constants (page size, margins, typography)"
```

---

## Task 2: Input analysis (image count/ratio, text length)

**Files:**
- Create: `src/core/analyzeInput.js`
- Test: `src/core/analyzeInput.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/core/analyzeInput.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/core/analyzeInput.test.js`
Expected: FAIL (`Cannot find module './analyzeInput.js'`)

- [ ] **Step 3: Write implementation**

```js
// src/core/analyzeInput.js
import { readFileSync } from 'node:fs'
import sizeOf from 'image-size'

export function analyzeInput({ imagePaths, text }) {
  if (!Array.isArray(imagePaths) || imagePaths.length < 1 || imagePaths.length > 6) {
    throw new Error(`이미지는 1~6장이어야 합니다 (받은 개수: ${imagePaths?.length ?? 0})`)
  }

  const images = imagePaths.map((path) => {
    const buffer = readFileSync(path)
    const dim = sizeOf(buffer)
    if (!dim.width || !dim.height) {
      throw new Error(`이미지 크기를 읽을 수 없습니다: ${path}`)
    }
    return {
      path,
      width: dim.width,
      height: dim.height,
      aspectRatio: dim.width / dim.height,
    }
  })

  return {
    imageCount: images.length,
    images,
    textLength: text.length,
    textLengthNoSpaces: text.replace(/\s/g, '').length,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/core/analyzeInput.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/analyzeInput.js src/core/analyzeInput.test.js
git commit -m "Add analyzeInput: image dims/ratio + text length"
```

---

## Task 3: Grid layout math (N images -> row/col boxes)

**Files:**
- Create: `src/core/gridLayout.js`
- Test: `src/core/gridLayout.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/core/gridLayout.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeGridBoxes } from './gridLayout.js'

test('1 image fills the whole bounding box', () => {
  const boxes = computeGridBoxes(1, { xMm: 0, yMm: 0, wMm: 100, hMm: 50 })
  assert.equal(boxes.length, 1)
  assert.deepEqual(boxes[0], { xMm: 0, yMm: 0, wMm: 100, hMm: 50 })
})

test('4 images form a 2x2 grid with gaps', () => {
  const boxes = computeGridBoxes(4, { xMm: 0, yMm: 0, wMm: 100, hMm: 100 }, 4)
  assert.equal(boxes.length, 4)
  // row height = (100 - 4) / 2 = 48; col width = (100 - 4) / 2 = 48
  assert.deepEqual(boxes[0], { xMm: 0, yMm: 0, wMm: 48, hMm: 48 })
  assert.deepEqual(boxes[1], { xMm: 52, yMm: 0, wMm: 48, hMm: 48 })
  assert.deepEqual(boxes[2], { xMm: 0, yMm: 52, wMm: 48, hMm: 48 })
  assert.deepEqual(boxes[3], { xMm: 52, yMm: 52, wMm: 48, hMm: 48 })
})

test('6 images form 2 rows of 3', () => {
  const boxes = computeGridBoxes(6, { xMm: 0, yMm: 0, wMm: 90, hMm: 60 }, 0)
  assert.equal(boxes.length, 6)
  assert.equal(boxes[0].wMm, 30)
  assert.equal(boxes[3].yMm, 30)
})

test('unsupported count throws', () => {
  assert.throws(() => computeGridBoxes(7, { xMm: 0, yMm: 0, wMm: 10, hMm: 10 }), /지원하지 않는/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/core/gridLayout.test.js`
Expected: FAIL (`Cannot find module './gridLayout.js'`)

- [ ] **Step 3: Write implementation**

```js
// src/core/gridLayout.js
const ROW_LAYOUTS = {
  1: [1],
  2: [2],
  3: [3],
  4: [2, 2],
  5: [3, 2],
  6: [3, 3],
}

export function computeGridBoxes(count, boundingBox, gapMm = 4) {
  const rows = ROW_LAYOUTS[count]
  if (!rows) throw new Error(`지원하지 않는 이미지 개수: ${count}`)

  const { xMm, yMm, wMm, hMm } = boundingBox
  const rowCount = rows.length
  const rowHeightMm = (hMm - gapMm * (rowCount - 1)) / rowCount

  const boxes = []
  rows.forEach((colCount, rowIndex) => {
    const rowY = yMm + rowIndex * (rowHeightMm + gapMm)
    const colWidthMm = (wMm - gapMm * (colCount - 1)) / colCount
    for (let col = 0; col < colCount; col += 1) {
      boxes.push({
        xMm: xMm + col * (colWidthMm + gapMm),
        yMm: rowY,
        wMm: colWidthMm,
        hMm: rowHeightMm,
      })
    }
  })
  return boxes
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/core/gridLayout.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/gridLayout.js src/core/gridLayout.test.js
git commit -m "Add grid layout math for multi-image pages"
```

---

## Task 4: Pattern preset library (JSON + loader)

**Files:**
- Create: `templates/pattern-presets/1-image.json`
- Create: `templates/pattern-presets/2-image.json`
- Create: `templates/pattern-presets/3-4-image.json`
- Create: `templates/pattern-presets/5-6-image.json`
- Create: `src/core/patternLibrary.js`
- Test: `src/core/patternLibrary.test.js`

- [ ] **Step 1: Create the four preset JSON files**

```json
// templates/pattern-presets/1-image.json
{
  "imageCountMin": 1,
  "imageCountMax": 1,
  "overflowPageType": "text-only",
  "candidates": {
    "A": {
      "patternId": "a-1img-full-bleed",
      "pages": [
        { "type": "full-bleed-image", "imageIndices": [0] },
        { "type": "text-only" }
      ]
    },
    "B": {
      "patternId": "b-1img-top-text-bottom",
      "pages": [
        { "type": "image-top-text-bottom", "imageIndices": [0], "imageHeightMm": 100 }
      ]
    },
    "C": {
      "patternId": "c-1img-text-first",
      "pages": [
        { "type": "text-only" },
        { "type": "image-top-text-bottom", "imageIndices": [0], "imageHeightMm": 60 }
      ]
    }
  }
}
```

```json
// templates/pattern-presets/2-image.json
{
  "imageCountMin": 2,
  "imageCountMax": 2,
  "overflowPageType": "text-only",
  "candidates": {
    "A": {
      "patternId": "a-2img-full-bleed-pair",
      "pages": [
        { "type": "full-bleed-image", "imageIndices": [0] },
        { "type": "full-bleed-image", "imageIndices": [1] },
        { "type": "text-only" }
      ]
    },
    "B": {
      "patternId": "b-2img-top-text-bottom-pair",
      "pages": [
        { "type": "image-top-text-bottom", "imageIndices": [0], "imageHeightMm": 90 },
        { "type": "image-top-text-bottom", "imageIndices": [1], "imageHeightMm": 90 }
      ]
    },
    "C": {
      "patternId": "c-2img-text-first",
      "pages": [
        { "type": "text-only" },
        { "type": "image-top-text-bottom", "imageIndices": [0], "imageHeightMm": 55 },
        { "type": "image-top-text-bottom", "imageIndices": [1], "imageHeightMm": 55 }
      ]
    }
  }
}
```

```json
// templates/pattern-presets/3-4-image.json
{
  "imageCountMin": 3,
  "imageCountMax": 4,
  "overflowPageType": "text-only",
  "candidates": {
    "A": {
      "patternId": "a-3-4img-grid-full-bleed",
      "pages": [
        { "type": "image-grid", "imageIndices": "all" },
        { "type": "text-only" }
      ]
    },
    "B": {
      "patternId": "b-3-4img-grid-margin-then-text",
      "pages": [
        { "type": "image-grid-margin", "imageIndices": "all", "gridHeightMm": 120 },
        { "type": "text-only" }
      ]
    },
    "C": {
      "patternId": "c-3-4img-text-first-grid",
      "pages": [
        { "type": "text-only" },
        { "type": "image-grid-margin", "imageIndices": "all", "gridHeightMm": 80 }
      ]
    }
  }
}
```

```json
// templates/pattern-presets/5-6-image.json
{
  "imageCountMin": 5,
  "imageCountMax": 6,
  "overflowPageType": "text-only",
  "candidates": {
    "A": {
      "patternId": "a-5-6img-grid-full-bleed",
      "pages": [
        { "type": "image-grid", "imageIndices": "all" },
        { "type": "text-only" }
      ]
    },
    "B": {
      "patternId": "b-5-6img-grid-margin-then-text",
      "pages": [
        { "type": "image-grid-margin", "imageIndices": "all", "gridHeightMm": 130 },
        { "type": "text-only" }
      ]
    },
    "C": {
      "patternId": "c-5-6img-text-first-grid",
      "pages": [
        { "type": "text-only" },
        { "type": "image-grid-margin", "imageIndices": "all", "gridHeightMm": 90 }
      ]
    }
  }
}
```

- [ ] **Step 2: Write the failing test**

```js
// src/core/patternLibrary.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getCandidatePattern, resolveImageIndices } from './patternLibrary.js'

test('resolveImageIndices expands "all" and passes arrays through', () => {
  assert.deepEqual(resolveImageIndices('all', 3), [0, 1, 2])
  assert.deepEqual(resolveImageIndices([1], 5), [1])
})

test('getCandidatePattern picks the right bucket for image count', () => {
  const p1 = getCandidatePattern(1, 'A')
  assert.equal(p1.patternId, 'a-1img-full-bleed')

  const p2 = getCandidatePattern(2, 'B')
  assert.equal(p2.patternId, 'b-2img-top-text-bottom-pair')

  const p4 = getCandidatePattern(4, 'C')
  assert.equal(p4.patternId, 'c-3-4img-text-first-grid')

  const p6 = getCandidatePattern(6, 'A')
  assert.equal(p6.patternId, 'a-5-6img-grid-full-bleed')
})

test('getCandidatePattern throws for out-of-range image count', () => {
  assert.throws(() => getCandidatePattern(0, 'A'), /이미지 개수/)
  assert.throws(() => getCandidatePattern(7, 'A'), /이미지 개수/)
})

test('getCandidatePattern throws for unknown candidate letter', () => {
  assert.throws(() => getCandidatePattern(1, 'D'), /후보/)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test src/core/patternLibrary.test.js`
Expected: FAIL (`Cannot find module './patternLibrary.js'`)

- [ ] **Step 4: Write implementation**

```js
// src/core/patternLibrary.js
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PRESET_DIR = join(__dirname, '..', '..', 'templates', 'pattern-presets')
const PRESET_FILES = ['1-image.json', '2-image.json', '3-4-image.json', '5-6-image.json']

function loadPresets() {
  return PRESET_FILES.map((file) => JSON.parse(readFileSync(join(PRESET_DIR, file), 'utf-8')))
}

export function resolveImageIndices(spec, imageCount) {
  if (spec === 'all') return Array.from({ length: imageCount }, (_, i) => i)
  if (Array.isArray(spec)) return spec
  throw new Error(`잘못된 imageIndices 지정: ${JSON.stringify(spec)}`)
}

export function getCandidatePattern(imageCount, candidate, presets = loadPresets()) {
  const preset = presets.find((p) => imageCount >= p.imageCountMin && imageCount <= p.imageCountMax)
  if (!preset) throw new Error(`이미지 개수(${imageCount})에 맞는 패턴을 찾을 수 없습니다`)
  const pattern = preset.candidates[candidate]
  if (!pattern) throw new Error(`후보(${candidate})에 대한 패턴이 없습니다`)
  return { ...pattern, overflowPageType: preset.overflowPageType }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test src/core/patternLibrary.test.js`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add templates/pattern-presets src/core/patternLibrary.js src/core/patternLibrary.test.js
git commit -m "Add pattern preset library (image-count bucket x candidate A/B/C)"
```

---

## Task 5: Deterministic pagination (text flow, no shrinking)

**Files:**
- Create: `src/core/paginate.js`
- Test: `src/core/paginate.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/core/paginate.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paginateContent } from './paginate.js'
import { TEXT_BOX_WIDTH_MM, CHAR_WIDTH_MM, LINE_HEIGHT_MM } from './layoutConstants.js'

test('short text fits entirely on the fixed preset pages, no overflow pages added', () => {
  const pattern = {
    overflowPageType: 'text-only',
    pages: [{ type: 'text-only' }],
  }
  const pages = paginateContent({ pattern, text: '가나다', imageCount: 1 })
  assert.equal(pages.length, 1)
  assert.equal(pages[0].textSlice, '가나다')
})

test('image-top-text-bottom page only gets the text that fits below the image', () => {
  const pattern = {
    overflowPageType: 'text-only',
    pages: [{ type: 'image-top-text-bottom', imageIndices: [0], imageHeightMm: 100 }],
  }
  // capacity for this page's text zone should be small enough that a long text overflows
  const longText = '가'.repeat(5000)
  const pages = paginateContent({ pattern, text: longText, imageCount: 1 })
  assert.ok(pages.length > 1, 'must add overflow text-only pages')
  assert.equal(pages[0].type, 'image-top-text-bottom')
  assert.ok(pages[0].textSlice.length < longText.length)
  assert.equal(pages.at(-1).type, 'text-only')
  const rebuilt = pages.map((p) => p.textSlice).join('')
  assert.equal(rebuilt, longText, 'no characters dropped across pages')
})

test('pages with zero text capacity (full-bleed-image) carry no textSlice', () => {
  const pattern = {
    overflowPageType: 'text-only',
    pages: [{ type: 'full-bleed-image', imageIndices: [0] }],
  }
  const pages = paginateContent({ pattern, text: '', imageCount: 1 })
  assert.equal(pages[0].textSlice, null)
})

test('char/line capacity math matches layout constants', () => {
  const pattern = { overflowPageType: 'text-only', pages: [{ type: 'text-only' }] }
  const charsPerLine = Math.floor(TEXT_BOX_WIDTH_MM / CHAR_WIDTH_MM)
  const lines = Math.floor((210 - 16 - 18) / LINE_HEIGHT_MM)
  const capacity = charsPerLine * lines
  const exact = '가'.repeat(capacity)
  const pages = paginateContent({ pattern, text: exact, imageCount: 1 })
  assert.equal(pages.length, 1)
  assert.equal(pages[0].textSlice.length, capacity)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/core/paginate.test.js`
Expected: FAIL (`Cannot find module './paginate.js'`)

- [ ] **Step 3: Write implementation**

```js
// src/core/paginate.js
import {
  TEXT_BOX_WIDTH_MM,
  TEXT_BOX_HEIGHT_MM,
  CHAR_WIDTH_MM,
  LINE_HEIGHT_MM,
  IMAGE_TEXT_GAP_MM,
} from './layoutConstants.js'

function textCapacity(widthMm, heightMm) {
  const charsPerLine = Math.floor(widthMm / CHAR_WIDTH_MM)
  const lines = Math.floor(heightMm / LINE_HEIGHT_MM)
  return Math.max(0, charsPerLine * lines)
}

function pageTextCapacity(pageSpec) {
  if (pageSpec.type === 'text-only') {
    return textCapacity(TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM)
  }
  if (pageSpec.type === 'image-top-text-bottom') {
    const remainingHeight = TEXT_BOX_HEIGHT_MM - pageSpec.imageHeightMm - IMAGE_TEXT_GAP_MM
    return textCapacity(TEXT_BOX_WIDTH_MM, remainingHeight)
  }
  if (pageSpec.type === 'image-grid-margin') {
    const remainingHeight = TEXT_BOX_HEIGHT_MM - pageSpec.gridHeightMm - IMAGE_TEXT_GAP_MM
    return textCapacity(TEXT_BOX_WIDTH_MM, remainingHeight)
  }
  return 0
}

export function paginateContent({ pattern, text, imageCount }) {
  const pages = []
  let remainingText = text

  for (const pageSpec of pattern.pages) {
    const capacity = pageTextCapacity(pageSpec)
    const textSlice = capacity > 0 && remainingText.length > 0 ? remainingText.slice(0, capacity) : null
    if (textSlice) remainingText = remainingText.slice(textSlice.length)
    pages.push({ ...pageSpec, textSlice })
  }

  while (remainingText.length > 0) {
    const overflowSpec = { type: pattern.overflowPageType }
    const capacity = pageTextCapacity(overflowSpec)
    if (capacity <= 0) throw new Error('오버플로우 페이지 타입의 텍스트 수용량이 0입니다')
    const textSlice = remainingText.slice(0, capacity)
    remainingText = remainingText.slice(capacity)
    pages.push({ ...overflowSpec, textSlice })
  }

  return pages
}
```

Note: `imageCount` is accepted for interface symmetry with `resolvePageLayout` (Task 6) but unused here — pagination only cares about text capacity, not which images fill a page.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/core/paginate.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/paginate.js src/core/paginate.test.js
git commit -m "Add deterministic pagination: no shrink, overflow to next page"
```

---

## Task 6: Resolve page layout (mm boxes for images/text per page)

**Files:**
- Create: `src/core/resolvePageLayout.js`
- Test: `src/core/resolvePageLayout.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/core/resolvePageLayout.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePageLayout } from './resolvePageLayout.js'
import { TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM, PAGE_WIDTH_MM, PAGE_HEIGHT_MM, IMAGE_TEXT_GAP_MM } from './layoutConstants.js'

const imagePaths = ['/a.jpg', '/b.jpg']

test('text-only page fills the full text box, no images', () => {
  const layout = resolvePageLayout({ type: 'text-only', textSlice: '가나다' }, 1, imagePaths)
  assert.equal(layout.images.length, 0)
  assert.deepEqual(layout.textZone, { xMm: 0, yMm: 0, wMm: TEXT_BOX_WIDTH_MM, hMm: TEXT_BOX_HEIGHT_MM })
  assert.equal(layout.textSlice, '가나다')
})

test('full-bleed-image page spans the whole physical page, ignoring margins', () => {
  const layout = resolvePageLayout({ type: 'full-bleed-image', imageIndices: [0], textSlice: null }, 1, imagePaths)
  assert.equal(layout.images.length, 1)
  assert.deepEqual(layout.images[0], { path: '/a.jpg', xMm: 0, yMm: 0, wMm: PAGE_WIDTH_MM, hMm: PAGE_HEIGHT_MM, fullBleed: true })
  assert.equal(layout.textZone, null)
})

test('image-top-text-bottom splits the margin box into image + text zone with a gap', () => {
  const layout = resolvePageLayout(
    { type: 'image-top-text-bottom', imageIndices: [1], imageHeightMm: 90, textSlice: '본문' },
    2,
    imagePaths,
  )
  assert.deepEqual(layout.images[0], { path: '/b.jpg', xMm: 0, yMm: 0, wMm: TEXT_BOX_WIDTH_MM, hMm: 90, fullBleed: false })
  assert.equal(layout.textZone.yMm, 90 + IMAGE_TEXT_GAP_MM)
  assert.equal(layout.textZone.hMm, TEXT_BOX_HEIGHT_MM - 90 - IMAGE_TEXT_GAP_MM)
})

test('image-top-text-bottom with no textSlice omits the text zone', () => {
  const layout = resolvePageLayout(
    { type: 'image-top-text-bottom', imageIndices: [0], imageHeightMm: 90, textSlice: null },
    1,
    imagePaths,
  )
  assert.equal(layout.textZone, null)
})

test('image-grid resolves "all" to every image, full-bleed on the page', () => {
  const layout = resolvePageLayout({ type: 'image-grid', imageIndices: 'all', textSlice: null }, 2, imagePaths)
  assert.equal(layout.images.length, 2)
  assert.ok(layout.images.every((img) => img.fullBleed === true))
})

test('image-grid-margin arranges images inside the margin box with text below', () => {
  const layout = resolvePageLayout(
    { type: 'image-grid-margin', imageIndices: 'all', gridHeightMm: 120, textSlice: '본문' },
    2,
    imagePaths,
  )
  assert.equal(layout.images.length, 2)
  assert.ok(layout.images.every((img) => img.fullBleed === false))
  assert.equal(layout.textZone.yMm, 120 + IMAGE_TEXT_GAP_MM)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/core/resolvePageLayout.test.js`
Expected: FAIL (`Cannot find module './resolvePageLayout.js'`)

- [ ] **Step 3: Write implementation**

```js
// src/core/resolvePageLayout.js
import {
  TEXT_BOX_WIDTH_MM,
  TEXT_BOX_HEIGHT_MM,
  PAGE_WIDTH_MM,
  PAGE_HEIGHT_MM,
  IMAGE_TEXT_GAP_MM,
} from './layoutConstants.js'
import { computeGridBoxes } from './gridLayout.js'
import { resolveImageIndices } from './patternLibrary.js'

export function resolvePageLayout(pageSpec, imageCount, imagePaths) {
  if (pageSpec.type === 'text-only') {
    return {
      type: 'text-only',
      images: [],
      textZone: { xMm: 0, yMm: 0, wMm: TEXT_BOX_WIDTH_MM, hMm: TEXT_BOX_HEIGHT_MM },
      textSlice: pageSpec.textSlice,
    }
  }

  if (pageSpec.type === 'full-bleed-image') {
    const idx = resolveImageIndices(pageSpec.imageIndices, imageCount)
    return {
      type: 'full-bleed-image',
      images: idx.map((i) => ({
        path: imagePaths[i], xMm: 0, yMm: 0, wMm: PAGE_WIDTH_MM, hMm: PAGE_HEIGHT_MM, fullBleed: true,
      })),
      textZone: null,
      textSlice: null,
    }
  }

  if (pageSpec.type === 'image-top-text-bottom') {
    const idx = resolveImageIndices(pageSpec.imageIndices, imageCount)
    const remainingHeight = TEXT_BOX_HEIGHT_MM - pageSpec.imageHeightMm - IMAGE_TEXT_GAP_MM
    return {
      type: 'image-top-text-bottom',
      images: idx.map((i) => ({
        path: imagePaths[i], xMm: 0, yMm: 0, wMm: TEXT_BOX_WIDTH_MM, hMm: pageSpec.imageHeightMm, fullBleed: false,
      })),
      textZone: pageSpec.textSlice
        ? { xMm: 0, yMm: pageSpec.imageHeightMm + IMAGE_TEXT_GAP_MM, wMm: TEXT_BOX_WIDTH_MM, hMm: remainingHeight }
        : null,
      textSlice: pageSpec.textSlice,
    }
  }

  if (pageSpec.type === 'image-grid') {
    const idx = resolveImageIndices(pageSpec.imageIndices, imageCount)
    const boxes = computeGridBoxes(idx.length, { xMm: 0, yMm: 0, wMm: PAGE_WIDTH_MM, hMm: PAGE_HEIGHT_MM })
    return {
      type: 'image-grid',
      images: idx.map((i, n) => ({ path: imagePaths[i], ...boxes[n], fullBleed: true })),
      textZone: null,
      textSlice: null,
    }
  }

  if (pageSpec.type === 'image-grid-margin') {
    const idx = resolveImageIndices(pageSpec.imageIndices, imageCount)
    const boxes = computeGridBoxes(idx.length, { xMm: 0, yMm: 0, wMm: TEXT_BOX_WIDTH_MM, hMm: pageSpec.gridHeightMm })
    const remainingHeight = TEXT_BOX_HEIGHT_MM - pageSpec.gridHeightMm - IMAGE_TEXT_GAP_MM
    return {
      type: 'image-grid-margin',
      images: idx.map((i, n) => ({ path: imagePaths[i], ...boxes[n], fullBleed: false })),
      textZone: pageSpec.textSlice
        ? { xMm: 0, yMm: pageSpec.gridHeightMm + IMAGE_TEXT_GAP_MM, wMm: TEXT_BOX_WIDTH_MM, hMm: remainingHeight }
        : null,
      textSlice: pageSpec.textSlice,
    }
  }

  throw new Error(`알 수 없는 페이지 타입: ${pageSpec.type}`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/core/resolvePageLayout.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/resolvePageLayout.js src/core/resolvePageLayout.test.js
git commit -m "Add resolvePageLayout: mm boxes for images/text per page type"
```

---

## Task 7: Rule-based style fallback + style-driven image scaling

**Files:**
- Create: `src/core/styleRules.js`
- Create: `src/core/styleAdjustment.js`
- Test: `src/core/styleRules.test.js`
- Test: `src/core/styleAdjustment.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// src/core/styleRules.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferStyleByRules } from './styleRules.js'

test('few images + long text -> Editorial', () => {
  const result = inferStyleByRules({ imageCount: 1, textLength: 3000 })
  assert.equal(result.style, 'Editorial')
})

test('many images -> Magazine', () => {
  const result = inferStyleByRules({ imageCount: 5, textLength: 500 })
  assert.equal(result.style, 'Magazine')
})

test('moderate images + short text -> Exhibition Catalog', () => {
  const result = inferStyleByRules({ imageCount: 3, textLength: 400 })
  assert.equal(result.style, 'Exhibition Catalog')
})
```

```js
// src/core/styleAdjustment.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scaleImageHeight } from './styleAdjustment.js'

test('Editorial shrinks images, Exhibition Catalog enlarges them', () => {
  assert.equal(scaleImageHeight(100, 'Editorial'), 85)
  assert.equal(scaleImageHeight(100, 'Magazine'), 100)
  assert.equal(scaleImageHeight(100, 'Exhibition Catalog'), 115)
})

test('unknown style falls back to scale 1.0', () => {
  assert.equal(scaleImageHeight(100, 'Unknown'), 100)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/core/styleRules.test.js src/core/styleAdjustment.test.js`
Expected: FAIL (modules not found)

- [ ] **Step 3: Write implementations**

```js
// src/core/styleRules.js
export function inferStyleByRules({ imageCount, textLength }) {
  if (imageCount <= 2 && textLength >= 2000) {
    return { style: 'Editorial', reason: '이미지 수가 적고 본문이 길어 텍스트 중심 판형이 적합' }
  }
  if (imageCount >= 4) {
    return { style: 'Magazine', reason: '이미지 수가 많아 리듬감 있는 배치가 적합' }
  }
  return { style: 'Exhibition Catalog', reason: '이미지가 크게 쓰이는 도록형 인상이 적합' }
}
```

```js
// src/core/styleAdjustment.js
const STYLE_IMAGE_SCALE = {
  Editorial: 0.85,
  Magazine: 1.0,
  'Exhibition Catalog': 1.15,
}

export function scaleImageHeight(baseHeightMm, style) {
  const scale = STYLE_IMAGE_SCALE[style] ?? 1.0
  return Math.round(baseHeightMm * scale * 10) / 10
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/core/styleRules.test.js src/core/styleAdjustment.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/styleRules.js src/core/styleAdjustment.js src/core/styleRules.test.js src/core/styleAdjustment.test.js
git commit -m "Add rule-based style fallback and style-to-image-scale mapping"
```

---

## Task 8: LLM style inference (Claude, with rule-based fallback)

**Files:**
- Create: `src/core/llmStyle.js`
- Test: `src/core/llmStyle.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/core/llmStyle.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferStyle } from './llmStyle.js'

test('no API key and not mock mode still returns a rule-based result (never throws)', async () => {
  const result = await inferStyle(
    { imageCount: 1, textLength: 3000, imageAspectRatios: [1.5] },
    { apiKey: undefined, mockMode: false },
  )
  assert.equal(result.style, 'Editorial')
  assert.equal(result.source, 'rule-based')
})

test('mockMode=true skips the API even if a key is present', async () => {
  const result = await inferStyle(
    { imageCount: 5, textLength: 100, imageAspectRatios: [1, 1, 1, 1, 1] },
    { apiKey: 'sk-fake', mockMode: true },
  )
  assert.equal(result.style, 'Magazine')
  assert.equal(result.source, 'rule-based')
})

test('valid LLM JSON response is used as-is', async () => {
  const fakeClient = {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: '{"style": "Magazine", "reason": "테스트 응답"}' }],
      }),
    },
  }
  const result = await inferStyle(
    { imageCount: 3, textLength: 800, imageAspectRatios: [1, 1.2, 0.9] },
    { apiKey: 'sk-fake', mockMode: false, client: fakeClient },
  )
  assert.equal(result.style, 'Magazine')
  assert.equal(result.source, 'llm')
})

test('malformed LLM response falls back to rules instead of throwing', async () => {
  const fakeClient = {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: 'not json' }] }),
    },
  }
  const result = await inferStyle(
    { imageCount: 1, textLength: 3000, imageAspectRatios: [1] },
    { apiKey: 'sk-fake', mockMode: false, client: fakeClient },
  )
  assert.equal(result.source, 'rule-based-fallback')
  assert.equal(result.style, 'Editorial')
})

test('LLM response with an out-of-vocabulary style falls back to rules', async () => {
  const fakeClient = {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: '{"style": "Noir", "reason": "x"}' }],
      }),
    },
  }
  const result = await inferStyle(
    { imageCount: 5, textLength: 100, imageAspectRatios: [1] },
    { apiKey: 'sk-fake', mockMode: false, client: fakeClient },
  )
  assert.equal(result.source, 'rule-based-fallback')
  assert.equal(result.style, 'Magazine')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/core/llmStyle.test.js`
Expected: FAIL (`Cannot find module './llmStyle.js'`)

- [ ] **Step 3: Write implementation**

```js
// src/core/llmStyle.js
import Anthropic from '@anthropic-ai/sdk'
import { inferStyleByRules } from './styleRules.js'

const VALID_STYLES = ['Editorial', 'Magazine', 'Exhibition Catalog']
const MODEL = 'claude-sonnet-4-6'

export async function inferStyle({ imageCount, textLength, imageAspectRatios }, options = {}) {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY
  const mockMode = options.mockMode ?? process.env.MOCK_MODE === 'true'

  if (!apiKey || mockMode) {
    const fallback = inferStyleByRules({ imageCount, textLength })
    return { ...fallback, source: 'rule-based', model: null }
  }

  try {
    const client = options.client ?? new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `다음 편집 조판 입력을 보고 스타일을 하나만 골라 JSON으로만 답하세요.
이미지 개수: ${imageCount}
이미지 가로세로비: ${imageAspectRatios.join(', ')}
본문 글자 수: ${textLength}
가능한 스타일: Editorial, Magazine, Exhibition Catalog
형식: {"style": "...", "reason": "..."}`,
      }],
    })

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
    const parsed = JSON.parse(text.trim())
    if (!VALID_STYLES.includes(parsed.style)) {
      throw new Error(`알 수 없는 스타일: ${parsed.style}`)
    }
    return { style: parsed.style, reason: parsed.reason ?? '', source: 'llm', model: MODEL }
  } catch (err) {
    const fallback = inferStyleByRules({ imageCount, textLength })
    return {
      ...fallback,
      source: 'rule-based-fallback',
      model: null,
      fallbackReason: String(err?.message ?? err),
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/core/llmStyle.test.js`
Expected: PASS (5 tests). No real network calls are made — the client is either absent (rule path) or injected as `fakeClient`.

- [ ] **Step 5: Commit**

```bash
git add src/core/llmStyle.js src/core/llmStyle.test.js
git commit -m "Add LLM style inference with rule-based fallback (mockable client)"
```

---

## Task 9: LaTeX templates + buildLatex (string assembly)

**Files:**
- Create: `templates/page_style_template.sty`
- Create: `templates/main_template.tex`
- Create: `src/core/buildLatex.js`
- Test: `src/core/buildLatex.test.js`

- [ ] **Step 1: Create the `.sty` template**

```latex
% templates/page_style_template.sty
\ProvidesPackage{page_style}[2026/07/06 Imprint Image+Text Page Style]

\RequirePackage{fontspec}
\RequirePackage{xeCJK}
\RequirePackage{geometry}
\RequirePackage[absolute,overlay]{textpos}
\RequirePackage{graphicx}

% 한국어는 어절 단위 공백이 의미를 가지므로 xeCJK의 공백 무시 기본값을 꺼야 한다.
\xeCJKsetup{CJKspace = true}

\geometry{
  paperwidth={{PAGE_WIDTH}}mm,
  paperheight={{PAGE_HEIGHT}}mm,
  top={{MARGIN_TOP}}mm,
  bottom={{MARGIN_BOTTOM}}mm,
  inner={{MARGIN_INNER}}mm,
  outer={{MARGIN_OUTER}}mm,
}
\setlength{\TPHorizModule}{1mm}
\setlength{\TPVertModule}{1mm}

% 본문 세리프: PRD 지정 Noto Serif KR은 이 PC에 정적 폰트가 없어(가변폰트만 존재,
% xdvipdfmx 임베드 실패 이력) IBM Plex Serif로 대체한다.
\setmainfont{{{BODY_FONT_FILE_EN}}}[
  Path = {{{FONTS_DIR}}/}, Extension = .{{BODY_FONT_FILE_EXT}}, BoldFont = {{{BODY_FONT_FILE_BOLD}}},
]
\setCJKmainfont{{{BODY_FONT_FILE_KR}}}[
  Path = {{{FONTS_DIR}}/}, Extension = .{{BODY_FONT_FILE_EXT}}, BoldFont = {{{BODY_FONT_FILE_KR_BOLD}}},
]

\newcommand{\BodyText}[1]{\fontsize{{{BODY_FONT_SIZE}}pt}{{{BODY_LEADING}}pt}\selectfont #1\par}

\pagestyle{empty}
\endinput
```

- [ ] **Step 2: Create the `main.tex` template**

```latex
% templates/main_template.tex
% !TEX program = xelatex
\documentclass[twoside]{article}
\usepackage{page_style}

\begin{document}
{{BODY_LATEX}}
\end{document}
```

- [ ] **Step 3: Write the failing test**

```js
// src/core/buildLatex.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStyleTex, buildMainTex, buildPagesLatex } from './buildLatex.js'

test('buildStyleTex fills in geometry and font placeholders, leaves no {{...}} tokens', () => {
  const tex = buildStyleTex({ fontsDir: '/abs/path/assets/fonts' })
  assert.match(tex, /paperwidth=148mm/)
  assert.match(tex, /paperheight=210mm/)
  assert.match(tex, /inner=18mm/)
  assert.match(tex, /outer=14mm/)
  assert.match(tex, /Path = \{\/abs\/path\/assets\/fonts\/\}/)
  assert.doesNotMatch(tex, /\{\{[A-Z_]+\}\}/)
})

test('buildPagesLatex emits one textblock per image and \\newpage between pages', () => {
  const resolvedPages = [
    {
      type: 'full-bleed-image',
      images: [{ path: '/a.jpg', xMm: 0, yMm: 0, wMm: 148, hMm: 210, fullBleed: true }],
      textZone: null,
      textSlice: null,
    },
    {
      type: 'text-only',
      images: [],
      textZone: { xMm: 0, yMm: 0, wMm: 116, hMm: 176 },
      textSlice: '가나다',
    },
  ]
  const body = buildPagesLatex(resolvedPages)
  assert.match(body, /includegraphics\[width=148mm,height=210mm,keepaspectratio\]\{\/a\.jpg\}/)
  assert.match(body, /\\newpage/)
  assert.match(body, /\\BodyText\{가나다\}/)
})

test('buildPagesLatex escapes LaTeX special characters in body text', () => {
  const resolvedPages = [{
    type: 'text-only',
    images: [],
    textZone: { xMm: 0, yMm: 0, wMm: 116, hMm: 176 },
    textSlice: '100% 완료 & 확인_됨 #1',
  }]
  const body = buildPagesLatex(resolvedPages)
  assert.match(body, /100\\% 완료 \\& 확인\\_됨 \\#1/)
})

test('buildMainTex embeds the page body into the document template', () => {
  const resolvedPages = [{ type: 'text-only', images: [], textZone: { xMm: 0, yMm: 0, wMm: 116, hMm: 176 }, textSlice: '본문' }]
  const tex = buildMainTex({ resolvedPages })
  assert.match(tex, /\\documentclass\[twoside\]\{article\}/)
  assert.match(tex, /\\BodyText\{본문\}/)
  assert.doesNotMatch(tex, /\{\{BODY_LATEX\}\}/)
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test src/core/buildLatex.test.js`
Expected: FAIL (`Cannot find module './buildLatex.js'`)

- [ ] **Step 5: Write implementation**

```js
// src/core/buildLatex.js
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  PAGE_WIDTH_MM, PAGE_HEIGHT_MM, MARGIN_TOP_MM, MARGIN_BOTTOM_MM,
  MARGIN_INNER_MM, MARGIN_OUTER_MM,
  BODY_FONT_SIZE_PT, BODY_LEADING_PT,
} from './layoutConstants.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_DIR = join(__dirname, '..', '..', 'templates')

function fillTemplate(template, values) {
  let out = template
  for (const [key, val] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(String(val))
  }
  return out
}

export function buildStyleTex({ fontsDir }) {
  const template = readFileSync(join(TEMPLATE_DIR, 'page_style_template.sty'), 'utf-8')
  return fillTemplate(template, {
    PAGE_WIDTH: PAGE_WIDTH_MM,
    PAGE_HEIGHT: PAGE_HEIGHT_MM,
    MARGIN_TOP: MARGIN_TOP_MM,
    MARGIN_BOTTOM: MARGIN_BOTTOM_MM,
    MARGIN_INNER: MARGIN_INNER_MM,
    MARGIN_OUTER: MARGIN_OUTER_MM,
    FONTS_DIR: fontsDir,
    BODY_FONT_FILE_EN: 'IBMPlexSerif-Regular',
    BODY_FONT_FILE_KR: 'IBMPlexSerif-Regular',
    BODY_FONT_FILE_BOLD: 'IBMPlexSerif-Bold',
    BODY_FONT_FILE_KR_BOLD: 'IBMPlexSerif-Bold',
    BODY_FONT_FILE_EXT: 'ttf',
    BODY_FONT_SIZE: BODY_FONT_SIZE_PT,
    BODY_LEADING: BODY_LEADING_PT,
  })
}

function leftMarginForPage(pageNumber) {
  // Recto (odd, right-hand page): spine on the left -> inner margin is the left margin.
  // Verso (even, left-hand page): spine on the right -> outer margin is the left margin.
  return pageNumber % 2 === 1 ? MARGIN_INNER_MM : MARGIN_OUTER_MM
}

function escapeLatex(text) {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([{}#%&_$])/g, '\\$1')
    .replace(/\n\s*\n/g, '\\par ')
    .replace(/\n/g, ' ')
}

function imageBlock(image, pageNumber) {
  const xMm = image.fullBleed ? image.xMm : leftMarginForPage(pageNumber) + image.xMm
  const yMm = image.fullBleed ? image.yMm : MARGIN_TOP_MM + image.yMm
  const path = image.path.replace(/\\/g, '/')
  return `\\begin{textblock}{${image.wMm}}(${xMm},${yMm})\n`
    + `  \\includegraphics[width=${image.wMm}mm,height=${image.hMm}mm,keepaspectratio]{${path}}\n`
    + '\\end{textblock}'
}

function textBlock(textZone, pageNumber, textSlice) {
  const xMm = leftMarginForPage(pageNumber) + textZone.xMm
  const yMm = MARGIN_TOP_MM + textZone.yMm
  return `\\begin{textblock}{${textZone.wMm}}(${xMm},${yMm})\n`
    + `  \\BodyText{${escapeLatex(textSlice)}}\n`
    + '\\end{textblock}'
}

export function buildPagesLatex(resolvedPages) {
  return resolvedPages
    .map((page, i) => {
      const pageNumber = i + 1
      const parts = page.images.map((img) => imageBlock(img, pageNumber))
      if (page.textZone && page.textSlice) {
        parts.push(textBlock(page.textZone, pageNumber, page.textSlice))
      }
      return parts.join('\n')
    })
    .join('\n\\newpage\n')
}

export function buildMainTex({ resolvedPages }) {
  const template = readFileSync(join(TEMPLATE_DIR, 'main_template.tex'), 'utf-8')
  return fillTemplate(template, { BODY_LATEX: buildPagesLatex(resolvedPages) })
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test src/core/buildLatex.test.js`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add templates/page_style_template.sty templates/main_template.tex src/core/buildLatex.js src/core/buildLatex.test.js
git commit -m "Add LaTeX templates and buildLatex string assembly"
```

---

## Task 10: generateCandidate (wires pattern -> paginate -> resolve -> LaTeX)

**Files:**
- Create: `src/core/generateCandidate.js`
- Test: `src/core/generateCandidate.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/core/generateCandidate.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateCandidate } from './generateCandidate.js'

const imagePaths = ['/img0.jpg']

test('candidate A for 1 image starts with a full-bleed image page then text', () => {
  const result = generateCandidate({
    imageCount: 1,
    imagePaths,
    text: '가나다라마바사아자차카',
    candidate: 'A',
    style: 'Editorial',
    fontsDir: '/fonts',
  })
  assert.equal(result.patternId, 'a-1img-full-bleed')
  assert.equal(result.resolvedPages[0].type, 'full-bleed-image')
  assert.equal(result.resolvedPages[1].type, 'text-only')
  assert.match(result.mainTex, /\\documentclass/)
  assert.match(result.styleTex, /page_style/)
})

test('style scales the image height for image-top-text-bottom pages (candidate B)', () => {
  const editorial = generateCandidate({
    imageCount: 1, imagePaths, text: '', candidate: 'B', style: 'Editorial', fontsDir: '/fonts',
  })
  const exhibition = generateCandidate({
    imageCount: 1, imagePaths, text: '', candidate: 'B', style: 'Exhibition Catalog', fontsDir: '/fonts',
  })
  const editorialImg = editorial.resolvedPages[0].images[0]
  const exhibitionImg = exhibition.resolvedPages[0].images[0]
  assert.ok(exhibitionImg.hMm > editorialImg.hMm, 'Exhibition Catalog should render a larger image than Editorial')
})

test('long text produces more pages than short text for the same candidate', () => {
  const short = generateCandidate({
    imageCount: 1, imagePaths, text: '가나다', candidate: 'C', style: 'Magazine', fontsDir: '/fonts',
  })
  const long = generateCandidate({
    imageCount: 1, imagePaths, text: '가'.repeat(6000), candidate: 'C', style: 'Magazine', fontsDir: '/fonts',
  })
  assert.ok(long.pageCount > short.pageCount)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/core/generateCandidate.test.js`
Expected: FAIL (`Cannot find module './generateCandidate.js'`)

- [ ] **Step 3: Write implementation**

```js
// src/core/generateCandidate.js
import { getCandidatePattern } from './patternLibrary.js'
import { paginateContent } from './paginate.js'
import { resolvePageLayout } from './resolvePageLayout.js'
import { buildMainTex, buildStyleTex } from './buildLatex.js'
import { scaleImageHeight } from './styleAdjustment.js'

function applyStyleScale(pattern, style) {
  return {
    ...pattern,
    pages: pattern.pages.map((page) => {
      if (page.imageHeightMm != null) {
        return { ...page, imageHeightMm: scaleImageHeight(page.imageHeightMm, style) }
      }
      if (page.gridHeightMm != null) {
        return { ...page, gridHeightMm: scaleImageHeight(page.gridHeightMm, style) }
      }
      return page
    }),
  }
}

export function generateCandidate({ imageCount, imagePaths, text, candidate, style, fontsDir }) {
  const basePattern = getCandidatePattern(imageCount, candidate)
  const pattern = applyStyleScale(basePattern, style)
  const paginatedPages = paginateContent({ pattern, text, imageCount })
  const resolvedPages = paginatedPages.map((page) => resolvePageLayout(page, imageCount, imagePaths))

  return {
    patternId: basePattern.patternId,
    pageCount: resolvedPages.length,
    resolvedPages,
    mainTex: buildMainTex({ resolvedPages }),
    styleTex: buildStyleTex({ fontsDir }),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/core/generateCandidate.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/generateCandidate.js src/core/generateCandidate.test.js
git commit -m "Add generateCandidate: wires pattern/paginate/layout/LaTeX for one candidate"
```

---

## Task 11: XeLaTeX compile + spread-preview generation

This is the first module that shells out to real tools (`xelatex`). XeLaTeX + TeX Live 2026 is already installed on this machine, so the test compiles a real (trivial, font-independent) document rather than mocking the process — that's the only way to catch real compile-flag mistakes.

**Files:**
- Create: `server/compile.mjs`
- Test: `server/compile.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/compile.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileMainTex, compileSpreadPreview, hasXelatex } from './compile.mjs'

test('hasXelatex reports true on this machine (TeX Live 2026 installed)', async () => {
  assert.equal(await hasXelatex(), true)
})

test('compileMainTex turns main.tex into pages.pdf and cleans up aux files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'imprint-it-compile-'))
  writeFileSync(join(dir, 'main.tex'), '\\documentclass{article}\n\\begin{document}Hello\\end{document}\n', 'utf-8')

  const result = await compileMainTex(dir)

  assert.equal(result.ok, true)
  assert.ok(existsSync(join(dir, 'pages.pdf')))
  assert.ok(!existsSync(join(dir, 'main.pdf')), 'main.pdf should be renamed to pages.pdf')
  assert.ok(!existsSync(join(dir, 'main.aux')), 'aux files should be cleaned up')

  rmSync(dir, { recursive: true, force: true })
})

test('compileSpreadPreview wraps pages.pdf into a 296x210mm spread PDF', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'imprint-it-spread-'))
  writeFileSync(join(dir, 'main.tex'), '\\documentclass{article}\n\\begin{document}Hello\\end{document}\n', 'utf-8')
  await compileMainTex(dir)

  const result = await compileSpreadPreview(dir)

  assert.equal(result.ok, true)
  assert.ok(existsSync(join(dir, 'spread-preview.pdf')))
  assert.ok(!existsSync(join(dir, '_spread_wrapper.tex')), 'temp wrapper tex should be removed')

  rmSync(dir, { recursive: true, force: true })
})

test('compileMainTex fails gracefully when main.tex is missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'imprint-it-missing-'))
  await assert.rejects(() => compileMainTex(dir), /main\.tex 없음/)
  rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/compile.test.js`
Expected: FAIL (`Cannot find module './compile.mjs'`)

- [ ] **Step 3: Write implementation**

```js
// server/compile.mjs
import { exec } from 'node:child_process'
import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(exec)

export async function hasXelatex() {
  try {
    await run(process.platform === 'win32' ? 'where xelatex' : 'which xelatex')
    return true
  } catch {
    return false
  }
}

function cleanupAuxFiles(dir, basename) {
  for (const ext of ['aux', 'log', 'synctex.gz', 'out']) {
    const p = join(dir, `${basename}.${ext}`)
    if (existsSync(p)) unlinkSync(p)
  }
}

export async function compileMainTex(candidateDir) {
  const tex = join(candidateDir, 'main.tex')
  if (!existsSync(tex)) throw new Error(`main.tex 없음: ${candidateDir}`)
  if (!(await hasXelatex())) {
    return { ok: false, reason: 'xelatex 미설치', hint: 'TeX(XeLaTeX)를 설치하면 PDF가 생성됩니다.' }
  }
  try {
    const { stdout } = await run(
      'xelatex -interaction=nonstopmode -halt-on-error "main.tex"',
      { cwd: candidateDir, timeout: 120000 },
    )
    const producedPdf = join(candidateDir, 'main.pdf')
    if (!existsSync(producedPdf)) {
      return { ok: false, reason: '컴파일은 됐으나 PDF 없음', log: stdout.slice(-1500) }
    }
    const pagesPdf = join(candidateDir, 'pages.pdf')
    renameSync(producedPdf, pagesPdf)
    cleanupAuxFiles(candidateDir, 'main')
    return { ok: true, pdf: pagesPdf, log: stdout.slice(-800) }
  } catch (e) {
    return { ok: false, reason: '컴파일 오류', log: String(e.stdout || e.message).slice(-1500) }
  }
}

export async function compileSpreadPreview(candidateDir) {
  const pagesPdf = join(candidateDir, 'pages.pdf')
  if (!existsSync(pagesPdf)) throw new Error(`pages.pdf 없음: ${candidateDir}`)
  if (!(await hasXelatex())) {
    return { ok: false, reason: 'xelatex 미설치', hint: 'TeX(XeLaTeX)를 설치하면 PDF가 생성됩니다.' }
  }
  const wrapperBasename = '_spread_wrapper'
  const wrapperTex = '\\documentclass{article}\n'
    + '\\usepackage[paperwidth=296mm,paperheight=210mm,margin=0mm]{geometry}\n'
    + '\\usepackage{pdfpages}\n'
    + '\\begin{document}\n'
    + '\\includepdf[pages=-,nup=2x1]{pages.pdf}\n'
    + '\\end{document}\n'
  writeFileSync(join(candidateDir, `${wrapperBasename}.tex`), wrapperTex, 'utf-8')

  try {
    const { stdout } = await run(
      `xelatex -interaction=nonstopmode -halt-on-error "${wrapperBasename}.tex"`,
      { cwd: candidateDir, timeout: 120000 },
    )
    const producedPdf = join(candidateDir, `${wrapperBasename}.pdf`)
    if (!existsSync(producedPdf)) {
      return { ok: false, reason: '스프레드 PDF 생성 실패', log: stdout.slice(-1500) }
    }
    const spreadPdf = join(candidateDir, 'spread-preview.pdf')
    renameSync(producedPdf, spreadPdf)
    return { ok: true, pdf: spreadPdf }
  } catch (e) {
    return { ok: false, reason: '스프레드 컴파일 오류', log: String(e.stdout || e.message).slice(-1500) }
  } finally {
    cleanupAuxFiles(candidateDir, wrapperBasename)
    const wrapperTexPath = join(candidateDir, `${wrapperBasename}.tex`)
    if (existsSync(wrapperTexPath)) unlinkSync(wrapperTexPath)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/compile.test.js`
Expected: PASS (4 tests). This actually invokes `xelatex` twice per candidate test — allow up to ~30s for the full file to run.

- [ ] **Step 5: Commit**

```bash
git add server/compile.mjs server/compile.test.js
git commit -m "Add XeLaTeX compile + pdfpages nup=2x1 spread-preview generation"
```

---

## Task 12: Output folder + generation-log writer

**Files:**
- Create: `server/saveOutputs.mjs`
- Test: `server/saveOutputs.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/saveOutputs.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createRunFolder, saveInputCopies, candidateFolderName, writeCandidateSources, writeGenerationLog,
} from './saveOutputs.mjs'

test('createRunFolder makes a timestamped run dir with input/images inside it', () => {
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const { runId, runDir } = createRunFolder(outputsRoot, { date: new Date(2026, 6, 6, 10, 30), seq: 1 })
  assert.equal(runId, '2026-07-06_1030_001')
  assert.ok(existsSync(join(runDir, 'input', 'images')))
  rmSync(outputsRoot, { recursive: true, force: true })
})

test('saveInputCopies copies images and writes the text file verbatim', () => {
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const srcDir = mkdtempSync(join(tmpdir(), 'imprint-it-src-'))
  const imgPath = join(srcDir, 'photo.jpg')
  writeFileSync(imgPath, Buffer.from([0xff, 0xd8, 0xff]))

  const { runDir } = createRunFolder(outputsRoot, { date: new Date(2026, 6, 6, 10, 30), seq: 1 })
  const { imageNames } = saveInputCopies(runDir, { imagePaths: [imgPath], text: '본문 텍스트' })

  assert.deepEqual(imageNames, ['photo.jpg'])
  assert.ok(existsSync(join(runDir, 'input', 'images', 'photo.jpg')))
  assert.equal(readFileSync(join(runDir, 'input', 'input-text.txt'), 'utf-8'), '본문 텍스트')

  rmSync(outputsRoot, { recursive: true, force: true })
  rmSync(srcDir, { recursive: true, force: true })
})

test('candidateFolderName maps A/B/C to PRD folder names and rejects anything else', () => {
  assert.equal(candidateFolderName('A'), 'candidate-a_image-first')
  assert.equal(candidateFolderName('B'), 'candidate-b_balanced')
  assert.equal(candidateFolderName('C'), 'candidate-c_text-first')
  assert.throws(() => candidateFolderName('D'), /알 수 없는 후보/)
})

test('writeCandidateSources writes main.tex, page_style.sty, layout.json', () => {
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const { runDir } = createRunFolder(outputsRoot, { date: new Date(2026, 6, 6, 10, 30), seq: 1 })

  const dir = writeCandidateSources(runDir, 'A', {
    mainTex: '\\documentclass{article}',
    styleTex: '\\ProvidesPackage{page_style}',
    layout: { patternId: 'a-1img-full-bleed', pageCount: 2 },
  })

  assert.equal(dir, join(runDir, 'candidate-a_image-first'))
  assert.equal(readFileSync(join(dir, 'main.tex'), 'utf-8'), '\\documentclass{article}')
  assert.match(readFileSync(join(dir, 'page_style.sty'), 'utf-8'), /ProvidesPackage/)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf-8')), { patternId: 'a-1img-full-bleed', pageCount: 2 })

  rmSync(outputsRoot, { recursive: true, force: true })
})

test('writeGenerationLog writes the log object as pretty JSON', () => {
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const { runDir } = createRunFolder(outputsRoot, { date: new Date(2026, 6, 6, 10, 30), seq: 1 })
  writeGenerationLog(runDir, { project: 'Imprint(Image+Text)', created_at: '2026-07-06_1030_001' })
  const parsed = JSON.parse(readFileSync(join(runDir, 'generation-log.json'), 'utf-8'))
  assert.equal(parsed.project, 'Imprint(Image+Text)')
  rmSync(outputsRoot, { recursive: true, force: true })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/saveOutputs.test.js`
Expected: FAIL (`Cannot find module './saveOutputs.mjs'`)

- [ ] **Step 3: Write implementation**

```js
// server/saveOutputs.mjs
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'

function timestampFolderName(date = new Date(), seq = 1) {
  const pad = (n) => String(n).padStart(2, '0')
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const hh = pad(date.getHours())
  const mm = pad(date.getMinutes())
  return `${y}-${m}-${d}_${hh}${mm}_${String(seq).padStart(3, '0')}`
}

export function createRunFolder(outputsRoot, { date, seq } = {}) {
  const runId = timestampFolderName(date, seq)
  const runDir = join(outputsRoot, runId)
  mkdirSync(join(runDir, 'input', 'images'), { recursive: true })
  return { runId, runDir }
}

export function saveInputCopies(runDir, { imagePaths, text }) {
  const imageNames = imagePaths.map((p) => basename(p))
  imagePaths.forEach((p, i) => {
    copyFileSync(p, join(runDir, 'input', 'images', imageNames[i]))
  })
  writeFileSync(join(runDir, 'input', 'input-text.txt'), text, 'utf-8')
  return { imageNames }
}

const CANDIDATE_FOLDER_NAMES = {
  A: 'candidate-a_image-first',
  B: 'candidate-b_balanced',
  C: 'candidate-c_text-first',
}

export function candidateFolderName(candidate) {
  const name = CANDIDATE_FOLDER_NAMES[candidate]
  if (!name) throw new Error(`알 수 없는 후보: ${candidate}`)
  return name
}

export function writeCandidateSources(runDir, candidate, { mainTex, styleTex, layout }) {
  const dir = join(runDir, candidateFolderName(candidate))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'main.tex'), mainTex, 'utf-8')
  writeFileSync(join(dir, 'page_style.sty'), styleTex, 'utf-8')
  writeFileSync(join(dir, 'layout.json'), JSON.stringify(layout, null, 2), 'utf-8')
  return dir
}

export function writeGenerationLog(runDir, log) {
  writeFileSync(join(runDir, 'generation-log.json'), JSON.stringify(log, null, 2), 'utf-8')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/saveOutputs.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/saveOutputs.mjs server/saveOutputs.test.js
git commit -m "Add output folder + generation-log.json writer (PRD section 7 structure)"
```

---

## Task 13: Full orchestration (runGeneration) — end-to-end integration test

This wires every previous task together and is the first point where the whole PRD success criterion #8 ("최종 PDF가 LaTeX 기반으로 컴파일된다") gets verified for real, with real fonts and real XeLaTeX, using `MOCK_MODE` so no Claude API calls happen during this test run.

**Files:**
- Create: `server/env.mjs`
- Create: `server/runGeneration.mjs`
- Test: `server/runGeneration.test.js`

- [ ] **Step 1: Create `server/env.mjs` (shared path constants)**

```js
// server/env.mjs
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(__dirname, '..')
export const FONTS_DIR = join(ROOT, 'assets', 'fonts')
export const OUTPUTS_DIR = join(ROOT, 'outputs')
```

- [ ] **Step 2: Write the failing test**

```js
// server/runGeneration.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGeneration } from './runGeneration.mjs'
import { FONTS_DIR } from './env.mjs'

// A real, fully valid 1x1 PNG (not just a header) so XeLaTeX's \includegraphics can embed it.
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

test('runGeneration produces 3 real, compiled candidates in mock style mode', async () => {
  const srcDir = mkdtempSync(join(tmpdir(), 'imprint-it-src-'))
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const imgPath = join(srcDir, 'photo.png')
  writeFileSync(imgPath, Buffer.from(TINY_PNG_BASE64, 'base64'))

  const result = await runGeneration({
    imagePaths: [imgPath, imgPath],
    text: '가나다라마바사아자차카파타하'.repeat(50),
    outputsRoot,
    fontsDir: FONTS_DIR,
    date: new Date(2026, 6, 6, 10, 30),
    seq: 1,
    llmOptions: { mockMode: true },
  })

  assert.equal(result.styleResult.source, 'rule-based')
  for (const candidate of ['A', 'B', 'C']) {
    const r = result.candidateResults[candidate]
    assert.equal(r.compile.ok, true, `candidate ${candidate} compile failed: ${JSON.stringify(r.compile)}`)
    assert.equal(r.spread.ok, true, `candidate ${candidate} spread failed: ${JSON.stringify(r.spread)}`)
    assert.ok(existsSync(join(r.dir, 'pages.pdf')))
    assert.ok(existsSync(join(r.dir, 'spread-preview.pdf')))
    assert.ok(existsSync(join(r.dir, 'main.tex')))
    assert.ok(existsSync(join(r.dir, 'layout.json')))
  }
  assert.ok(existsSync(join(result.runDir, 'generation-log.json')))
  assert.ok(existsSync(join(result.runDir, 'input', 'input-text.txt')))

  rmSync(srcDir, { recursive: true, force: true })
  rmSync(outputsRoot, { recursive: true, force: true })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test server/runGeneration.test.js`
Expected: FAIL (`Cannot find module './runGeneration.mjs'`)

- [ ] **Step 4: Write implementation**

```js
// server/runGeneration.mjs
import { analyzeInput } from '../src/core/analyzeInput.js'
import { inferStyle } from '../src/core/llmStyle.js'
import { generateCandidate } from '../src/core/generateCandidate.js'
import { compileMainTex, compileSpreadPreview } from './compile.mjs'
import {
  createRunFolder, saveInputCopies, writeCandidateSources, writeGenerationLog,
} from './saveOutputs.mjs'
import { FONTS_DIR, OUTPUTS_DIR } from './env.mjs'

const CANDIDATES = ['A', 'B', 'C']
const CANDIDATE_MEANINGS = { A: 'image-first', B: 'balanced', C: 'text-first' }

export async function runGeneration({
  imagePaths, text, outputsRoot = OUTPUTS_DIR, fontsDir = FONTS_DIR, date, seq, llmOptions = {},
}) {
  const analysis = analyzeInput({ imagePaths, text })
  const styleResult = await inferStyle(
    {
      imageCount: analysis.imageCount,
      textLength: analysis.textLength,
      imageAspectRatios: analysis.images.map((i) => i.aspectRatio),
    },
    llmOptions,
  )

  const { runId, runDir } = createRunFolder(outputsRoot, { date, seq })
  const { imageNames } = saveInputCopies(runDir, { imagePaths, text })

  const candidateResults = {}
  for (const candidate of CANDIDATES) {
    const generated = generateCandidate({
      imageCount: analysis.imageCount,
      imagePaths,
      text,
      candidate,
      style: styleResult.style,
      fontsDir,
    })
    const dir = writeCandidateSources(runDir, candidate, {
      mainTex: generated.mainTex,
      styleTex: generated.styleTex,
      layout: { patternId: generated.patternId, pageCount: generated.pageCount, pages: generated.resolvedPages },
    })
    const compileResult = await compileMainTex(dir)
    const spreadResult = compileResult.ok
      ? await compileSpreadPreview(dir)
      : { ok: false, reason: '개별 페이지 컴파일 실패로 스프레드 생략' }
    candidateResults[candidate] = {
      dir, patternId: generated.patternId, pageCount: generated.pageCount, compile: compileResult, spread: spreadResult,
    }
  }

  const log = {
    project: 'Imprint(Image+Text)',
    created_at: runId,
    input: {
      image_count: analysis.imageCount,
      image_names: imageNames,
      text_length: analysis.textLength,
      page_size: 'A5',
      orientation: 'portrait',
      caption: false,
      image_fit: 'contain',
      text_overlay: false,
    },
    layout_settings: {
      candidates: CANDIDATES,
      candidate_meanings: CANDIDATE_MEANINGS,
      style_inference: styleResult.style,
      style_inference_source: styleResult.source,
      style_inference_reason: styleResult.reason ?? styleResult.fallbackReason ?? null,
      body_font: 'IBM Plex Serif (Noto Serif KR 정적 폰트 부재로 대체)',
      heading_font: 'Noto Sans KR',
      body_font_size_pt: 9,
      body_leading_pt: 14,
      margins_mm: { top: 16, bottom: 18, inner: 18, outer: 14 },
    },
    overflow_policy: { auto_shrink: false, move_to_next_page: true, move_to_next_spread: true },
    outputs: Object.fromEntries(CANDIDATES.map((c) => [
      `candidate_${c.toLowerCase()}`,
      {
        folder: `${candidateResults[c].dir.split(/[\\/]/).pop()}/`,
        pattern_id: candidateResults[c].patternId,
        page_count: candidateResults[c].pageCount,
        compile_ok: candidateResults[c].compile.ok,
        spread_ok: candidateResults[c].spread.ok,
      },
    ])),
  }
  writeGenerationLog(runDir, log)

  return {
    runId, runDir, styleResult, candidateResults, log,
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test server/runGeneration.test.js`
Expected: PASS (1 test). This runs 6 real `xelatex` invocations (3 candidates x main+spread) — allow up to a minute.

- [ ] **Step 6: Commit**

```bash
git add server/env.mjs server/runGeneration.mjs server/runGeneration.test.js
git commit -m "Add full orchestration: analyze -> style -> 3 candidates -> compile -> save + log"
```

---

## Task 14: HTTP server (upload + generate + static PDF serving)

**Files:**
- Create: `server/index.mjs`
- Test: `server/index.test.js`

- [ ] **Step 1: Write the failing test**

```js
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

test('GET /outputs/ rejects path traversal with 400', async () => {
  const outputsDir = mkdtempSync(join(tmpdir(), 'imprint-it-http-outputs-'))
  const app = createApp({ outputsDir, uploadsDir: outputsDir })
  const port = await startServer(app)

  const response = await fetch(`http://localhost:${port}/outputs/../../etc/passwd`)
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
```

Note: the `?mock=1` query flag is read by the server and forces `runGeneration`'s `llmOptions.mockMode = true` for that single request — this lets tests and the UI's "빠른 미리보기" path avoid real API calls without relying on a shared process-wide env var.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/index.test.js`
Expected: FAIL (`Cannot find module './index.mjs'`)

- [ ] **Step 3: Write implementation**

```js
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
  const bb = Busboy({ headers: req.headers, limits: { files: 6, fileSize: 30 * 1024 * 1024 } })
  const imagePaths = []
  let text = ''
  let fileCount = 0
  let rejected = null

  bb.on('field', (name, value) => {
    if (name === 'text') text = value
  })

  bb.on('file', (name, stream, info) => {
    fileCount += 1
    if (fileCount > 6) {
      rejected = '이미지는 최대 6장까지 업로드할 수 있습니다'
      stream.resume()
      return
    }
    const safeName = `${Date.now()}_${fileCount}_${info.filename.replace(/[^\w.\-가-힣]/g, '_')}`
    const dest = join(uploadsDir, safeName)
    imagePaths.push(dest)
    stream.pipe(createWriteStream(dest))
  })

  bb.on('close', async () => {
    if (rejected) return sendJson(res, 400, { ok: false, error: rejected })
    if (imagePaths.length < 1) return sendJson(res, 400, { ok: false, error: '이미지를 1장 이상 업로드해야 합니다' })
    if (!text.trim()) return sendJson(res, 400, { ok: false, error: '본문 텍스트를 입력해야 합니다' })
    try {
      const result = await runGeneration({
        imagePaths, text, outputsRoot: outputsDir, llmOptions: { mockMode },
      })
      sendJson(res, 200, {
        ok: true,
        runId: result.runId,
        style: result.styleResult.style,
        candidates: Object.fromEntries(Object.entries(result.candidateResults).map(([key, value]) => [key, {
          pagesPdf: `/outputs/${result.runId}/${value.dir.split(/[\\/]/).pop()}/pages.pdf`,
          spreadPdf: `/outputs/${result.runId}/${value.dir.split(/[\\/]/).pop()}/spread-preview.pdf`,
          compileOk: value.compile.ok,
          spreadOk: value.spread.ok,
        }])),
      })
    } catch (err) {
      sendJson(res, 500, { ok: false, error: String(err.message || err) })
    }
  })

  req.pipe(bb)
}

function serveStatic(req, res, urlPath, outputsDir) {
  const relative = decodeURIComponent(urlPath.replace(/^\/outputs\//, ''))
  if (relative.includes('..')) return sendJson(res, 400, { ok: false, error: '잘못된 경로' })
  const filePath = join(outputsDir, relative)
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return sendJson(res, 404, { ok: false, error: '파일 없음' })
  const ext = extname(filePath)
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' })
  createReadStream(filePath).pipe(res)
}

export function createApp({ uploadsDir = DEFAULT_UPLOADS_DIR, outputsDir = OUTPUTS_DIR } = {}) {
  return createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/generate')) {
      const mockMode = req.url.includes('mock=1') || process.env.MOCK_MODE === 'true'
      return handleGenerate(req, res, { uploadsDir, outputsDir, mockMode })
    }
    if (req.method === 'GET' && req.url.startsWith('/outputs/')) {
      return serveStatic(req, res, req.url, outputsDir)
    }
    sendJson(res, 404, { ok: false, error: 'Not found' })
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/index.test.js`
Expected: PASS (3 tests). The first test runs 6 real `xelatex` invocations — allow up to a minute.

- [ ] **Step 5: Commit**

```bash
git add server/index.mjs server/index.test.js
git commit -m "Add HTTP server: multipart upload, generate endpoint, static PDF serving"
```

---

## Task 15: Frontend (React + Vite SPA)

No automated tests for this task — it's verified manually with the preview tools in Task 17. This is the minimum UI PRD 8.1 asks for: image upload, text input, Generate button, and a results view with folder/PDF links.

**Files:**
- Create: `index.html`
- Create: `vite.config.js`
- Create: `src/frontend/main.jsx`
- Create: `src/frontend/App.jsx`

- [ ] **Step 1: Create `vite.config.js`**

```js
// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': 'http://localhost:8788',
      '/outputs': 'http://localhost:8788',
    },
  },
})
```

- [ ] **Step 2: Create `index.html`**

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <title>Imprint(Image+Text)</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/frontend/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `src/frontend/main.jsx`**

```jsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(<App />)
```

- [ ] **Step 4: Create `src/frontend/App.jsx`**

```jsx
import React, { useState } from 'react'

const CANDIDATE_LABELS = { A: '이미지 중심', B: '균형', C: '텍스트 중심' }

export default function App() {
  const [images, setImages] = useState([])
  const [text, setText] = useState('')
  const [status, setStatus] = useState('idle')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  function handleImageChange(e) {
    setImages(Array.from(e.target.files).slice(0, 6))
  }

  async function handleGenerate() {
    if (images.length < 1) {
      setError('이미지를 1장 이상 선택하세요.')
      return
    }
    if (!text.trim()) {
      setError('본문 텍스트를 입력하세요.')
      return
    }
    setError(null)
    setStatus('generating')
    setResult(null)

    const form = new FormData()
    images.forEach((file) => form.append('images', file))
    form.append('text', text)

    try {
      const response = await fetch('/api/generate', { method: 'POST', body: form })
      const body = await response.json()
      if (!body.ok) {
        setError(body.error || '생성에 실패했습니다.')
        setStatus('idle')
        return
      }
      setResult(body)
      setStatus('done')
    } catch (err) {
      setError(String(err.message || err))
      setStatus('idle')
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '2rem auto', fontFamily: 'sans-serif' }}>
      <h1>Imprint(Image+Text)</h1>
      <p>이미지 1~6장과 본문 텍스트를 넣으면 편집디자인형 스프레드 후보 3종을 만듭니다.</p>

      <div style={{ marginBottom: '1rem' }}>
        <label>
          이미지 (최대 6장)
          <input type="file" accept="image/*" multiple onChange={handleImageChange} />
        </label>
        <p>{images.length}장 선택됨</p>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label>
          본문 텍스트
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} style={{ width: '100%' }} />
        </label>
      </div>

      <button type="button" onClick={handleGenerate} disabled={status === 'generating'}>
        {status === 'generating' ? '생성 중...' : 'Generate'}
      </button>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {result && (
        <div style={{ marginTop: '2rem' }}>
          <p>추정 스타일: {result.style}</p>
          <p>결과 폴더: outputs/{result.runId}/</p>
          {Object.entries(result.candidates).map(([key, cand]) => (
            <div key={key} style={{ marginBottom: '1.5rem' }}>
              <h2>Candidate {key} — {CANDIDATE_LABELS[key]}</h2>
              {cand.compileOk ? (
                <p>
                  <a href={cand.pagesPdf} target="_blank" rel="noreferrer">낱장 PDF 열기</a>
                  {' | '}
                  <a href={cand.spreadPdf} target="_blank" rel="noreferrer">스프레드 미리보기 열기</a>
                </p>
              ) : (
                <p style={{ color: 'red' }}>컴파일 실패 — 로그를 확인하세요.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add index.html vite.config.js src/frontend
git commit -m "Add React+Vite frontend: upload form, generate button, results view"
```

---

## Task 16: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# Imprint(Image+Text)

이미지 1~6장 + 본문 텍스트를 A5 편집디자인형 스프레드 3종(이미지 중심/균형/텍스트 중심)으로 만드는 독립 시스템.
`Imprint`(본문 텍스트 전용), `Imprint(Cover)`(표지)의 자매 시스템이며, 두 프로젝트의 코드는 이 저장소에서 읽기 전용으로만 참고했다.

## 실행 방법

```bash
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY를 넣으면 LLM 기반 스타일 추정, 없으면 규칙 기반 폴백
npm run dev:all              # Vite(5175) + 백엔드(8788) 동시 실행
```

브라우저에서 http://localhost:5175 접속 후 이미지 1~6장과 본문 텍스트를 넣고 Generate를 누르면
`outputs/<타임스탬프>/`에 후보 A/B/C별 `pages.pdf`, `spread-preview.pdf`, `main.tex`, `layout.json`과
`generation-log.json`이 생성된다.

`MOCK_MODE=true`로 실행하면 실제 Claude API를 호출하지 않고 규칙 기반 스타일 추정만 사용한다(검증/반복 테스트용).

## 테스트

```bash
npm test
```

`src/core/`의 순수 로직은 목(mock) 기반, `server/`의 컴파일·오케스트레이션 테스트는 실제 XeLaTeX를 호출한다.

## 폴더 구조

```
Imprint(Image+Text)/
├─ src/core/          입력 분석, 스타일 추정, 패턴 선택, 페이지네이션, LaTeX 조립 (순수 함수)
├─ server/             HTTP 서버, XeLaTeX 컴파일, 출력 폴더/로그 저장, 전체 오케스트레이션
├─ src/frontend/        React UI (업로드 폼, Generate 버튼, 결과 보기)
├─ templates/           .tex/.sty 템플릿 + 패턴 프리셋 JSON
├─ assets/fonts/        IBM Plex Serif(본문 세리프 대체), Noto Sans KR(제목/구조용)
├─ uploads/             업로드된 원본 이미지(임시)
├─ outputs/             생성 결과 (타임스탬프 폴더별)
└─ docs/superpowers/    설계 스펙 + 구현 계획 문서
```

## 폰트에 대한 참고

PRD는 본문 세리프로 "Noto Serif KR"을 지정하지만, 이 폰트는 정적(static) 빌드가 없고
가변폰트(variable font)만 배포되어 XeLaTeX(xdvipdfmx)에서 임베드에 실패한다. 대신 정적 빌드가
있는 **IBM Plex Serif**를 본문 세리프로 사용한다. 자세한 배경은
`docs/superpowers/specs/2026-07-06-imprint-image-text-design.md` 3장 참고.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Add README with run instructions and folder structure"
```

---

## Task 17: Placeholder test images + API-level end-to-end verification

This exercises the full PRD 9.1 success path (#2–#8): real images of different aspect ratios, real body text, all 3 candidates compiled, both PDFs produced per candidate, output folder + log saved. It calls the running server's `/api/generate` directly (the same code path the browser UI uses) so we get a real end-to-end proof without fighting browser file-input automation.

**Files:**
- Create: `scripts/make-placeholder-images.mjs`
- Create: `scripts/verify-e2e.mjs`

- [ ] **Step 1: Write `scripts/make-placeholder-images.mjs`**

Generates real, valid, differently-proportioned solid-color PNGs (not just header fakes) using only Node's built-in `zlib` — no image library dependency needed for placeholders.

```js
// scripts/make-placeholder-images.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

function crc32(buf) {
  if (!crc32.table) {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      table[n] = c >>> 0
    }
    crc32.table = table
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) crc = crc32.table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

function makeSolidPng(width, height, [r, g, b]) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)
  ihdr.writeUInt8(2, 9)

  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1)
    raw[rowStart] = 0
    for (let x = 0; x < width; x += 1) {
      const px = rowStart + 1 + x * 3
      raw[px] = r
      raw[px + 1] = g
      raw[px + 2] = b
    }
  }
  const idat = deflateSync(raw)

  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

const outDir = process.argv[2] ?? 'scratch/placeholder-images'
mkdirSync(outDir, { recursive: true })

const specs = [
  { name: 'placeholder-1-landscape.png', width: 800, height: 500, color: [200, 120, 90] },
  { name: 'placeholder-2-portrait.png', width: 500, height: 750, color: [90, 130, 180] },
  { name: 'placeholder-3-square.png', width: 600, height: 600, color: [120, 170, 110] },
  { name: 'placeholder-4-wide.png', width: 900, height: 400, color: [180, 170, 90] },
]

for (const spec of specs) {
  writeFileSync(join(outDir, spec.name), makeSolidPng(spec.width, spec.height, spec.color))
  console.log(`wrote ${spec.name} (${spec.width}x${spec.height})`)
}
```

- [ ] **Step 2: Run it**

```bash
node scripts/make-placeholder-images.mjs scratch/placeholder-images
```
Expected: 4 lines printed (`wrote placeholder-1-landscape.png (800x500)`, etc.), 4 files created under `scratch/placeholder-images/`.

- [ ] **Step 3: Write `scripts/verify-e2e.mjs` (hits the real running server)**

```js
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
  console.log(`  candidate ${key}: compileOk=${cand.compileOk} spreadOk=${cand.spreadOk} pagesPdf=${cand.pagesPdf}`)
  if (!cand.compileOk || !cand.spreadOk) {
    console.error(`FAIL: candidate ${key} did not fully compile`)
    process.exit(1)
  }
}
console.log('PASS: all 3 candidates compiled with both PDFs')
```

- [ ] **Step 4: Run the real end-to-end check**

```bash
node server/index.mjs &
sleep 1
node scripts/verify-e2e.mjs scratch/placeholder-images
```

Expected output ends with:
```
PASS: all 3 candidates compiled with both PDFs
```

Then stop the background server (`kill %1` or close the terminal), and inspect the actual files:

```bash
ls "outputs/"
ls "outputs/<the runId printed above>/candidate-a_image-first/"
cat "outputs/<the runId printed above>/generation-log.json"
```
Expected: `pages.pdf`, `spread-preview.pdf`, `main.tex`, `layout.json` all present in each `candidate-*` folder, and `generation-log.json` shows `image_count: 3`, a `style_inference` value, and per-candidate `compile_ok`/`spread_ok` both `true`.

- [ ] **Step 5: Commit**

```bash
git add scripts/make-placeholder-images.mjs scripts/verify-e2e.mjs
git commit -m "Add placeholder-image generator and API-level end-to-end verification script"
```

---

## Task 18: Browser smoke check (UI renders and can reach the backend)

File inputs can't be reliably driven through browser-automation `fill`-style tools, so Task 17 already proved the real generate/compile/save pipeline via a direct API call. This task only confirms the page itself renders correctly and is wired to the backend — the last piece PRD 8.1 asks for ("최소 UI 요소").

**Files:** none (manual verification only)

- [ ] **Step 1: Start the backend in the background**

```bash
node server/index.mjs &
```
Expected: log line `Imprint(Image+Text) server listening on http://localhost:8788`.

- [ ] **Step 2: Start the Vite dev server with the preview tool**

Use `preview_start` (Claude Preview MCP tool) pointed at this project directory, running `npm run dev`. Confirm it reports the dev server is up on port 5175.

- [ ] **Step 3: Snapshot the page**

Use `preview_snapshot` on `http://localhost:5175`. Confirm the snapshot includes:
- Heading text "Imprint(Image+Text)"
- A file input element
- A textarea
- A "Generate" button

- [ ] **Step 4: Fill the textarea and confirm the Generate button is clickable**

Use `preview_fill` to put sample text into the textarea, then `preview_click` on Generate. Since no image file is selected, expect the client-side validation message "이미지를 1장 이상 선택하세요." to appear (via `preview_console_logs` or a follow-up `preview_snapshot`) — this confirms the button's handler runs and talks to React state correctly, without needing to automate the file picker.

- [ ] **Step 5: Screenshot as proof**

Use `preview_screenshot` and share it. Then stop the background server:

```bash
kill %1
```

- [ ] **Step 6: No commit needed (manual verification task, no files changed)**

---

## Plan Complete

At this point every PRD 9.1 success criterion has a concrete task behind it:
1. Independent project folder, no edits to `Imprint`/`Imprint(Cover)` — Task 0 + repo location.
2. 1–6 images + body text input — Task 2 (analysis), Task 14/15 (upload path).
3. A5 portrait, 2-page-spread-based output — Task 1 (constants), Task 9/11 (LaTeX + spread compile).
4. Candidate A/B/C — Task 4 (patterns), Task 10 (generateCandidate).
5. `pages.pdf` + `spread-preview.pdf` per candidate — Task 11.
6. No auto-shrink, overflow to next page/spread — Task 5.
7. Output folder + log auto-saved — Task 12, Task 13.
8. LaTeX-based PDF compile — Task 11, Task 13.
9. Looks like a real editorial spread (image/text balance, candidate personality) — Task 4's differentiated presets + Task 7's style-driven scaling, checked visually in Task 17/18.

