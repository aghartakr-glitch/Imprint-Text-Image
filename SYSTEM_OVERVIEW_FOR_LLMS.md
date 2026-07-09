# Imprint(Image+Text) — System Overview for LLMs

## 🎯 Purpose

Imprint is an **automated editorial PDF layout generator** that takes user-provided images + text and generates professional A5-sized editorial magazine spreads using intelligent layout reasoning + deterministic fallbacks.

**Input:** Images (1-6) + body text (short/medium/long) + optional title + optional grid preferences
**Output:** Compiled PDF with optimized image placement, multi-column text flow, and editorial styling

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (React + Vite SPA)                                 │
│ - Image upload (drag-drop, max 6 × 30MB)                   │
│ - Text input (supports paragraph breaks via Enter)          │
│ - Grid settings: page_size, margin_preset, columns, grid_mode │
│ POST /api/generate → multipart form data                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│ Node.js Backend (HTTP + Busboy multipart parsing)           │
│ server/index.mjs + server/runGeneration.mjs                │
│ - Validates input (1-6 images, non-empty text)             │
│ - Parses user grid settings → GridPresetManager            │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│ Core Generation Pipeline (Sequential)                       │
│                                                              │
│ 1. INPUT ANALYSIS                                           │
│    - analyzeInput: image dimensions, aspect ratios, count   │
│    - analyzeContentStructure: paragraph count, text length  │
│    - textDensityFromLength: classify as short/medium/long   │
│                                                              │
│ 2. METADATA PREPARATION                                     │
│    - buildImageMetadata, estimateImageHierarchy            │
│    - decideOutputUnit: single_page or spread               │
│    - retrieveLayoutReferences: fetch similar examples       │
│    - deriveUserPreferenceContext: past edit history        │
│                                                              │
│ 3. LLM CANDIDATE GENERATION (Path A: Try First)            │
│    - callLayoutLLM: call Claude API 1× only (no retries)   │
│    - Generates 1 candidate with: grid placement,            │
│      image roles, composition strategy, design intent       │
│    - validateLayoutPlan: check schema compliance            │
│    - repairLayoutPlan: fill missing fit/role defaults       │
│    - Cost budget: max 0.03 USD per generation               │
│    → If fails or API unavailable: proceed to Path B         │
│                                                              │
│ 4. FALLBACK DETERMINISTIC PLAN (Path B: Guaranteed)        │
│    - buildFallbackLayoutPlan: rule-based layout selection   │
│    - When gridSettings present: uses buildGridFallbackPlan  │
│      (new multi-column flow engine)                         │
│    - Respects: columns, page_size, grid_mode, margins       │
│    - Flows text around image reserved_regions              │
│    - Always succeeds, always produces valid grid plan       │
│                                                              │
│ 5. RECONSTRUCTION & REFINEMENT                              │
│    - reconstructLayout: convert grid plan → pages with mm   │
│    - refineLayout: fit images within boxes per aspect ratio │
│    - Checks: readability, visual balance, coverage          │
│                                                              │
│ 6. QUALITY ESTIMATION & SELECTION                           │
│    - estimateLayoutQuality: score on readability/balance    │
│    - selectBestLayout: pick best from candidates            │
│    - recordLayoutUsage: update diversity tracking           │
│                                                              │
│ 7. LaTeX RENDERING                                          │
│    - buildMainTex + buildStyleTex: generate .tex files      │
│    - Uses XeLaTeX for Hangul (Korean) font support          │
│    - textpos package for absolute positioning               │
│                                                              │
│ 8. COMPILATION & PREVIEW                                    │
│    - xelatex (compile main PDF)                            │
│    - pdftops + pdfcrop (generate spread-preview)           │
│    - Outputs: pages.pdf + spread-preview.pdf                │
│                                                              │
│ 9. LOGGING & ARTIFACT GENERATION                            │
│    - writeGenerationLog: generation-log.json with full      │
│      input, decisions, resolution reasons, grid plan        │
│    - writeBestLayoutSources: layout.json + .tex sources     │
│    - Input copies: uploaded images + text snapshot          │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│ Output (JSON Response)                                      │
│ - runId: timestamp-based identifier                        │
│ - PDFs: pages.pdf (full doc), spread-preview.pdf           │
│ - Metadata: layout family, composition strategy, quality   │
│ - Artifacts: generation-log.json for debugging             │
└──────────────────────────────────────────────────────────────┘
```

---

## 📋 Key Modules & Responsibilities

### Input Analysis Layer
- **analyzeInput.js** — Read images, compute dimensions, aspect ratios
- **contentStructure.js** — Parse text structure (title, body, sections)
- **textDensity.js** — Classify text length: short ≤1200ch, medium ≤3500ch, long >3500ch
- **imageHierarchy.js** — Determine image roles: hero, support, equal, gallery, page_gallery

### User Preferences & Settings
- **GridPresetManager.js** — Convert 4 user settings (page_size/margin_preset/columns/grid_mode) → full grid_spec (rows, gutter, text_flow, image_behavior, variation_level)
- **parseTextBlocks.js** — Split raw text into paragraphs by blank lines, auto-detect title from first short paragraph
- **applyUserPreferences.js** — Apply past user feedback (soft guidance only)

### Layout Generation
- **callLayoutLLM.js** — Single API call to Claude for layout candidates (no retries, cost-conscious)
- **buildLayoutPrompt.js** — Construct system + user prompt with input metadata, references, user grid hints
- **generateLayoutCandidates.js** — Parse LLM's JSON response into structured candidate objects
- **buildFallbackLayoutPlan.js** — Rule-based fallback with multiple variants; uses **buildGridFallbackPlan** when gridSettings supplied
  - **buildGridFallbackPlan** — NEW: respects user column count, flows text around image reserved_regions

### Multi-Column Text Flow Engine (NEW)
- **ColumnFlowEngine.js** — Flows paragraphs across column slots, respects word boundaries, avoids reserved regions
- **ReservedRegionManager.js** — Marks cells occupied by images, computes free row segments per column
- **GridPresetManager.js** (mentioned above) — Resolves user settings into grid_spec

### Validation & Repair
- **validateLayoutPlan.js** — Check grid placement, element overlap, image fit, design vocabulary
- **repairLayoutPlan.js** — Fill missing fit/role/overflow defaults (local repair, no API call)

### Layout Refinement
- **reconstructLayout.js** — Convert grid plan (col/row units) → resolved pages with mm-based boxes
- **refineLayout.js** — Fit images within boxes per aspect ratio, check readability
- **estimateLayoutQuality.js** — Score on readability, visual balance, hierarchy, whitespace
- **selectBestLayout.js** — Choose best candidate from pool

### LaTeX Generation
- **buildLatex.js** — Generate main.tex + style.sty with image placement, text blocks, fonts
- **gridToMm.js** — Convert grid coordinates (col_start/row_start/col_span/row_span) → mm boxes
- **estimateTextCapacity.js** — Calculate characters that fit in a box (font 9pt, leading 14pt)
- **paginateGridPlan.js** — Distribute text across body boxes, create overflow pages, slice at word boundaries

### Design Space & Vocabulary
- **designSpace.js** — Allowed values for layout_family, layout_purpose, image_hierarchy, composition_strategy, etc.
- **imprint_pattern_library_v0.2.json** — Reference patterns (grid_2x2_with_text, hero_image_plus_secondary, etc.)

### Diversity & Tracking
- **diversityControl.js** — Track recent layouts, apply repetition penalty to avoid same layout twice in a row
- **logUserFeedback.js** — Store user edits (not yet used — no editing UI)

### Output Management
- **saveOutputs.mjs** — Create run folder structure, save input copies, write generation-log.json, write layout.json
- **compile.mjs** — Invoke xelatex (main PDF) + pdftops/pdfcrop (spread preview)

---

## 🎨 Layout Grid System

**Fixed Grid:** 6 columns × 12 rows (can be overridden)
- **Page size:** A5 portrait (148mm × 210mm)
- **Margins:** top 16mm, bottom 18mm, inner 18mm, outer 14mm (asymmetric for recto/verso)
- **Text box:** 116mm × 176mm (area inside margins)
- **Font:** 9pt body, 14pt leading (Noto Sans KR for Hangul support)

**Elements:** Placed via `{ col_start, col_span, row_start, row_span }` (1-based indices)
- Convert to mm: `gridToMm()` computes box dimensions, accounting for gutter
- **Gutter:** typically 4mm (adjustable per grid_mode)

**User Grid Customization (NEW):**
```javascript
{
  page_size: 'A5' | 'A4' | 'B5' | 'custom',
  margin_preset: 'recommended' | 'narrow' | 'wide' | 'custom',
  columns: 2 | 3 | 4 | 6,
  grid_mode: 'strict' | 'flexible'
}
// → GridPresetManager resolves to:
{
  rows: 12 or 16,
  gutter_mm: 3–5,
  text_flow: 'block_flow' | 'column_flow',
  image_behavior: 'full_width' | 'anchored' | 'distributed',
  variation_level: 'low' | 'medium' | 'high'
}
```

---

## 📤 LLM Interface (Claude-Specific, Extensible)

### Input to LLM (buildLayoutPrompt.js)
```json
{
  "input_metadata": {
    "image_count": 4,
    "image_ratios": [1.5, 1.0, 1.2, 0.8],
    "text_length_chars": 2500,
    "text_density": "medium",
    "has_title": true
  },
  "user_layout_settings": {
    "columns": 4,
    "grid_mode": "flexible"
  },
  "image_metadata": [...],
  "retrieved_references": [...]
}
```

### Output from LLM (Expected)
```json
{
  "candidates": [{
    "candidate_id": "candidate_1",
    "style": "Editorial",
    "output_unit": "single_page",
    "layout_family": "balanced",
    "composition_strategy": "column_flow_grid",
    "image_hierarchy": "grid_gallery",
    "grid_spec": {
      "columns": 4,
      "rows": 12,
      "gutter_mm": 4
    },
    "grid": { "columns": 4, "rows": 12 },
    "reserved_regions": [
      { "page": 1, "col_start": 1, "col_span": 2, "row_start": 1, "row_span": 5 }
    ],
    "text_flow": {
      "mode": "column_flow",
      "overflow_policy": { "body_overflow": "continue_to_next_page" }
    },
    "pages": [{
      "page": 1,
      "elements": [
        {
          "id": "image_1",
          "type": "image",
          "role": "hero",
          "col_start": 1,
          "col_span": 2,
          "row_start": 1,
          "row_span": 5,
          "fit": "contain",
          "object_position": "center"
        },
        {
          "id": "body_1",
          "type": "text",
          "role": "body",
          "col_start": 1,
          "col_span": 4,
          "row_start": 7,
          "row_span": 6
        }
      ]
    }],
    "overflow_policy": { "body_overflow": "continue_to_next_page" },
    "design_sequence": [
      { "step": 1, "decision_type": "layout_family", "value": "balanced", "reason": "balanced priority" }
    ],
    "reason": "short reason, max 8 words"
  }]
}
```

---

## 💰 Cost Management

**Hard constraint:** `MAX_LAYOUT_LLM_SPEND_USD = 0.03` per generation
- **Strategy:** Single API call, no retries (each retry consumes the budget)
- **Fallback:** Guaranteed free deterministic plan if LLM fails or unavailable
- **Token estimation:** Conservative input estimate to stay within budget
- **Output control:** Compact schema example (1 candidate, no prose)

**Token costs (approx):**
- Input: ~7000–8500 tokens (varies with image count, prompt length)
- Output: ~500 tokens requested (1 candidate)
- Model: claude-sonnet-4-6 (~$0.003/1K input, ~$0.015/1K output)

---

## 🔄 Data Flow (Step-by-Step)

1. **User uploads:** images + text + (optional) title + (optional) grid settings via web UI
2. **Frontend:** Constructs multipart form, POST to `/api/generate`
3. **Server (index.mjs):** Busboy parses files, JSON fields; validates; calls `runGeneration()`
4. **runGeneration.mjs:**
   - Analyzes input (images, text density, content structure)
   - Resolves grid settings via GridPresetManager
   - **Branch A:** Tries LLM
     - Constructs prompt via buildLayoutPrompt.js
     - Calls Claude API (1×, no retries)
     - Validates + repairs candidate
     - If success: use it; if fail: proceed to Branch B
   - **Branch B:** Builds fallback deterministic plan
     - If gridSettings: use buildGridFallbackPlan (new multi-column engine)
     - Else: use legacy fixed-variant fallback
   - Reconstructs layout (grid → mm), refines, estimates quality
   - Selects best candidate (only 1 in LLM path, but quality checks apply)
   - Generates LaTeX via buildMainTex + buildStyleTex
5. **XeLaTeX compilation:**
   - Invokes xelatex on main.tex
   - Outputs pages.pdf (full document)
   - Generates spread-preview.pdf (side-by-side pages)
6. **Logging & response:**
   - Writes generation-log.json (all decisions, reasons, grid plan)
   - Returns JSON response with URLs to PDFs
7. **User downloads:** pages.pdf for printing

---

## 🧪 Testing & Validation

**Unit tests:** 200+ tests via Node's built-in test runner
```bash
npm test
```

**Coverage areas:**
- Grid math (gridToMm, gridToMm inverse)
- Text parsing (parseTextBlocks, word-boundary slicing)
- Grid presets (GridPresetManager resolution)
- Reserved regions (cell occupancy, free segment computation)
- Column flow (text distribution, overflow handling)
- Layout validation (overlap, bounds, design space vocabulary)
- LaTeX generation (escaping, template filling)
- Fallback variants (deterministic, reproducible)

**Manual verification:**
- Mock-mode generation: `llmOptions: { mockMode: true }` skips LLM, uses fallback
- Real compile: XeLaTeX must succeed, PDFs must render
- Grid visualization: DEBUG_GRID env var (not yet implemented)

---

## 🚀 Running the System

### Development Server
```bash
npm run dev
# Starts frontend at http://localhost:5173
# Backend listens on http://localhost:8788
```

### Production Build
```bash
npm run build
# Frontend: dist/ folder
# Backend: ready at server/index.mjs
```

### Direct Backend Call
```javascript
import { runGeneration } from './server/runGeneration.mjs'

const result = await runGeneration({
  imagePaths: ['img1.jpg', 'img2.jpg'],
  text: 'Body text here...',
  title: 'Optional Title',
  userLayoutSettings: {
    page_size: 'A5',
    margin_preset: 'recommended',
    columns: 4,
    grid_mode: 'flexible'
  },
  llmOptions: { 
    mockMode: false,  // set true to skip API
    apiKey: 'sk-...'  // or use process.env.ANTHROPIC_API_KEY
  }
})
// Returns: { runId, dir, compile, spread, selected, log, ... }
```

---

## 🔧 Configuration & Constants

**layoutConstants.js:**
```javascript
export const GRID_COLUMNS = 6          // default
export const GRID_ROWS = 12            // for A5
export const PAGE_WIDTH_MM = 148
export const PAGE_HEIGHT_MM = 210
export const BODY_FONT_SIZE_PT = 9
export const BODY_LEADING_PT = 14
export const CHAR_WIDTH_MM = 3.15      // computed
export const LINE_HEIGHT_MM = 4.94     // computed
export const TEXT_BOX_WIDTH_MM = 116   // page_width - margins
export const TEXT_BOX_HEIGHT_MM = 176  // page_height - margins
```

**Cost budget (layoutCostBudget.js):**
```javascript
export const MAX_LAYOUT_LLM_SPEND_USD = 0.03
```

**Text density thresholds (textDensity.js):**
```javascript
export const TEXT_DENSITY_SHORT_MAX = 1200
export const TEXT_DENSITY_MEDIUM_MAX = 3500
// > 3500 = 'long'
```

---

## 🎓 Design Principles

1. **Deterministic fallback first** — System never fails; LLM is optimization, not requirement
2. **No text shrinking** — Font size (9pt) and leading (14pt) are fixed; overflow handled by adding pages
3. **Word-boundary safety** — Text slices always end at word/newline boundary, never mid-word
4. **Grid-based, not mm-based** — LLM/fallback work in col/row units; conversion to mm is deterministic
5. **User control** — 4 user settings (page_size/margin/columns/mode) drive layout decisions
6. **Cost consciousness** — Single API call, no retries; fallback is free
7. **Reproducibility** — Same input always produces same fallback output (deterministic hash-based variant selection)
8. **Editorial intent** — Design vocabulary (composition_strategy, image_hierarchy, etc.) reflects editorial reasoning

---

## 🔮 Extensibility Points

**For other LLMs to integrate:**
1. Replace `callLayoutLLM.js`'s Anthropic API client with your LLM's API
2. Update `buildLayoutPrompt.js` system prompt for your model's understanding
3. Ensure LLM outputs valid layout_plan JSON matching `validateLayoutPlan` schema
4. `validateLayoutPlan` already validates all new grid_spec/reserved_regions/text_flow fields

**To add new layout strategies:**
1. Add to `DESIGN_SPACE.compositionStrategies` (designSpace.js)
2. Implement in `buildFallbackLayoutPlan.js` as a new variant function
3. Add tests in `fallbackLayoutPlan.test.js`

**To support new page sizes:**
1. Add to `PAGE_SIZES_MM` (GridPresetManager.js)
2. Adjust `TEXT_BOX_WIDTH_MM` / `TEXT_BOX_HEIGHT_MM` (layoutConstants.js)
3. Recalculate `GRID_ROWS` for new aspect ratio

---

## 📚 Key Files for LLM Integration

| File | Purpose |
|------|---------|
| `src/core/buildLayoutPrompt.js` | System + user prompt construction |
| `src/core/validateLayoutPlan.js` | Schema validation (check this for required fields) |
| `src/core/designSpace.js` | Allowed design vocabulary |
| `server/runGeneration.mjs` | Main orchestration entry point |
| `src/core/buildFallbackLayoutPlan.js` | Fallback logic (reference for understanding intent) |
| `src/core/text/ColumnFlowEngine.js` | Multi-column flow engine |
| `src/core/grid/GridPresetManager.js` | Grid preset resolution |

---

## 🎯 Critical Constraints

1. **Image count:** 1–6 only
2. **Page size:** A5 (148×210mm) primary; A4, B5 supported
3. **Text roles:** title, subtitle, body, section_label, page_number, continuation_body
4. **Image fit:** always `contain` (never crop/cover)
5. **Overflow:** always `continue_to_next_page` (never shrink/truncate)
6. **Grid:** User can choose 2/3/4/6 columns; rows auto-determined by page_size
7. **Fonts:** Body + Heading use Noto Sans KR (for Hangul); serif not supported
8. **No captions:** Image caption elements are forbidden

---

## 📞 When to Use Fallback vs. LLM

| Scenario | Path |
|----------|------|
| LLM available, API key present, budget OK | Try LLM first |
| LLM fails validation, cost remaining | Try LLM once more (no retries) |
| LLM fails or cost exhausted | Use deterministic fallback |
| Mock mode (`llmOptions.mockMode=true`) | Force fallback (free) |
| User provides gridSettings | Fallback uses buildGridFallbackPlan (multi-column) |
| No gridSettings provided | Fallback uses legacy fixed variants (6×12 single box) |

---

**System Version:** 0.4 (Grid Preset + Column Flow supplement integrated)  
**Last Updated:** 2026-07-09  
**Language:** Node.js + React (backend + frontend)  
**Repository:** https://github.com/aghartakr-glitch/Imprint-Text-Image (master branch)
