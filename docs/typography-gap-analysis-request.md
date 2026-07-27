# Imprint(Image+Text) — Micro-Typography Gap Analysis Request

## 0. Purpose of this document

This is a technical brief for an external LLM/reviewer. The system's document-level design consistency
(shared grid, shared leading/tracking across a document) is **already solved and working** — do not
propose macro-structure features (running heads, page numbers, grid systems, multi-page design-system
sharing). The remaining scope is **micro-typography**: line-breaking, justification, spacing, and other
fine-grained text-rendering quality issues within an already-correct grid/box layout.

**Hard constraint, non-negotiable**: the user provides only images + body text (and optionally a title).
The system must never require or auto-generate additional editorial content (captions, credits,
footnote text, pull-quotes, etc.) — only *layout/typography decisions* about the content the user
actually supplied. Any proposal that requires new user input fields or fabricates text is out of scope.

---

## 1. System architecture (for context)

**Stack**: Node.js backend, React frontend, Anthropic LLM (Claude) for layout planning, XeLaTeX for
final PDF rendering. No InDesign/Figma — LaTeX `textblock*` (via the `textpos` package) is the only
positioning primitive; everything is placed by absolute mm coordinates on a `\pagestyle{empty}` page.

**Pipeline** (`server/runGeneration.mjs` orchestrates):

1. Input analysis (image count/ratios, text length/density, markdown structure parsing)
2. LLM layout planning (`callLayoutLLM.js` → Claude) — the LLM outputs a `layout_plan` JSON: pages,
   each containing `elements[]` with `col_start/col_span/row_start/row_span` on a fixed grid
   (default 6 columns × 12 rows), `type: image|text`, `role`, `text_source` (references a paragraph
   by ordinal, e.g. `"paragraph_3"`), and image-specific fields (`fit`, `object_position`, `bleed`).
3. Local deterministic repair chain (no LLM call, in `callLayoutLLM.js`'s `processCandidate()`):
   - `normalizeLayoutPlan` — enum alias fixes
   - `compactOversizedTextSpans` — shrinks text boxes that are much larger than their content needs
   - `repairLayoutPlan` — fills missing field defaults
   - `repairTextOverflow` — grows `row_span`/`col_span` when text doesn't fit its box
   - `repairCollisions` — pairwise nudges to resolve overlapping elements
   - `enforceGridOccupancy` — guaranteed-convergent backstop: moves any still-overlapping element to
     a free grid cell or a new page
   - `validateAndFixLayoutMm` — final mm-level overlap check/fix
4. Validation (`validateLayoutPlan.js`) — schema/vocabulary checks, collision checks, text-capacity
   overflow checks, paragraph-order checks (later paragraphs must never appear on an earlier page than
   earlier ones), forced-full-bleed-image checks. **Only 1 LLM candidate is generated per attempt, with
   1 retry on failure; best-effort/partial rendering is explicitly disabled — a candidate that doesn't
   pass validation after repair hard-fails the whole generation.**
5. Text pagination/slicing — three separate, independently-implemented subsystems slice paragraph text
   into the boxes the plan defines (see §3 below) — this is the main area with residual quality issues.
6. `buildLatex.js` renders the final `layout_plan` → LaTeX source using role-based style commands.
7. XeLaTeX compiles to PDF.

---

## 2. Current typography implementation (ground truth, as of this request)

### 2.1 Fonts
- Single font family for everything: **Noto Sans KR** (Regular/Bold), loaded via `fontspec`+`xeCJK`.
- No serif option currently (an earlier attempt to use IBM Plex Serif for body text failed — it has no
  Hangul glyphs, so Korean text rendered as empty boxes; reverted to Noto Sans KR for both body and
  headings, distinguished only by size/weight, not typeface family).
- `xeCJK` config: `\xeCJKsetup{CJKspace = true}` (Korean word-spacing preserved, since Korean uses
  inter-eojeol spaces meaningfully, unlike Chinese/Japanese).

### 2.2 Role-based type scale (`templates/page_style_template.sty` + `src/core/layoutConstants.js`)

| Role | Size/Leading | Weight | Notes |
|---|---|---|---|
| `title` | 28pt/34pt | bold | section-opener only |
| `section_title` / `section_label` | 14pt/16pt | bold | |
| `case_title_ko` | 11pt/13pt | bold | |
| `case_title_en` | 10pt/12pt | bold | `\MakeUppercase` applied, **no added letter-spacing/tracking** |
| `case_body` | 9pt/14pt | regular | |
| `credit` | 7pt/9pt | italic | |
| `body` | 9pt/14pt | regular | |
| `page_number` | 9pt/11pt | regular | |
| `running_head` | 8pt/10pt | regular | just added |

All values are point sizes converted to mm via `PT_TO_MM = 0.3528`.

### 2.3 Alignment / justification
- **All body-role text (`body`, `case_body`) is set ragged-right (`\raggedright`), not justified.**
  This was changed recently specifically because full justification in narrow (~35–56mm) mixed
  CJK/Latin columns produced very uneven word-gaps (few justifiable spaces per line in mostly-Korean
  text with occasional Latin words/brand names → TeX stretches those few spaces heavily).
- Headings/titles: no explicit alignment set (LaTeX default, effectively full-width single lines,
  alignment not usually visually relevant at that size/short length).
- Page number / running head: `\raggedleft` or `\raggedright` depending on recto/verso (outer-edge
  alignment).

### 2.4 Hyphenation
- **Globally disabled**: `\hyphenpenalty=10000`, `\exhyphenpenalty=10000`. Added because under
  ragged-right, LaTeX's default (US English) hyphenation was breaking English words mid-word at line
  ends, which read as broken/unprofessional in an editorial context that doesn't otherwise use
  hyphenation. No CJK-specific line-breaking rules (kinsoku/word-wrap rules) are configured beyond
  `xeCJK`'s defaults.

### 2.5 Text-capacity estimation (the core "how much text fits in this box" formula)

Three independent call sites all ultimately reduce to the same formula
(`src/core/estimateTextCapacity.js::estimateTextCapacityMm` and a duplicate simplified version in
`src/core/layoutConstants.js`'s `CHAR_WIDTH_MM`/`LINE_HEIGHT_MM`):

```
charWidthMm  = fontSizePt * PT_TO_MM * boldWidthFactor * CHAR_WIDTH_CALIBRATION_FACTOR
lineHeightMm = leadingPt  * PT_TO_MM
charsPerLine = floor(boxWidthMm / charWidthMm)
lines        = floor(boxHeightMm / lineHeightMm)
capacity     = charsPerLine * lines
```

- `boldWidthFactor` = 1.1 for bold roles (title, section_title, case_title*), 1 otherwise.
- `CHAR_WIDTH_CALIBRATION_FACTOR` = **0.9**, a recently-added empirical fudge factor. It exists because
  real generation output was measured against this formula and the formula (at factor 1.0, i.e.
  treating every character as a full em-square) *consistently underestimated* real capacity — text
  rendered in fewer lines than predicted, leaving visible blank space at the bottom of boxes/columns
  before the remaining text was pushed to the next box/column. The 0.9 factor is a single global,
  script-agnostic correction, not derived from actual font metrics (e.g. Noto Sans KR's real advance
  widths) or from the actual CJK/Latin character mix of each specific paragraph.
- This formula assumes a monospace-like model (constant width per character regardless of whether it's
  Hangul, Latin, punctuation, or a space) and completely ignores kerning, and OpenType feature effects.
- **No word-boundary-aware precision**: slicing (`sliceAtWordBoundary` in `paginateGridPlan.js` /
  `ColumnFlowEngine.js`) works in raw character-count space against this estimated capacity, then backs
  up to the nearest space/newline. It has no actual line-breaking simulation — it never asks "how many
  real lines would this exact string take at this exact width," it only estimates via the formula above.

### 2.6 Text flow / pagination (three separate implementations, not unified)

1. **`paginateGridPlan.js`** (modular path, used when the document has ≥2 paragraph blocks): each
   `text` element with a `text_source` gets its capacity computed independently via the box the LLM
   assigned it, then `sliceAtWordBoundary` cuts the *referenced whole paragraph* to fit. Any leftover
   is deferred to `paragraphOverflow` and eventually appended as brand-new "overflow" pages at the very
   end of the document (not necessarily adjacent to where the paragraph started).
2. **`ColumnFlowEngine.js`** (used for `composition_strategy: column_flow_grid`, i.e. a `text_flow`
   with declared `flow_regions`): expands a flow region into column-width slots (via
   `ReservedRegionManager.js`, routing around image "reserved regions"), then flows a queue of
   paragraphs across those slots in order, splitting a paragraph across slot boundaries only when
   necessary. Recently patched so that when a slot has leftover capacity after fitting one paragraph
   whole, it slices part of the *next* paragraph in to fill the remainder (previously it would leave
   the remaining space empty and push the entire next paragraph to a new slot).
3. **`reorganizeTextOnlyPages.js`** (used only for pages with zero images and ≥1 `role: body` text
   block): reflows body text into N columns (user-chosen column count, capped by
   `MIN_READABLE_COLUMN_WIDTH_MM = 45mm`), slicing per-column via the same char/line formula.

These three do not share a single source of truth for "how much text actually fits here" beyond the
common formula in §2.5 — they are independently implemented and have independently been patched for
similar symptoms (early column breaks leaving blank space) at different times.

### 2.7 Grid / box system
- Physical page: 148×210mm (A5). Margins: top 16mm, bottom 18mm, inner 18mm, outer 14mm (i.e.
  content box ≈ 116×176mm). Grid: 6 columns × 12 rows by default (user can choose 1–6 columns via UI),
  gutter 4mm.
- All positioning is grid-cell-based (`col_start/col_span/row_start/row_span` → mm via `gridToMm.js`),
  not a continuous baseline grid — i.e. there is **no shared baseline grid guarantee**: two adjacent
  columns of body text are not guaranteed to have their lines land on the same horizontal baselines,
  since each box's line count/position is independently derived from its own top y-coordinate and its
  own capacity math, not snapped to a page-wide baseline lattice.
- Full-bleed images (`bleed: "full"`) exist and are exempted from all box/margin checks by design.

### 2.8 What is explicitly OUT of scope for this request
- Caption generation, credit-line generation, footnote/annotation content generation — **the system
  must never invent text the user didn't supply.** (A prior proposal to add photo captions below images
  was explicitly rejected by the product owner for this reason.)
- New required user input fields beyond image(s) + body text + optional title.
- Document-level structural features (running head, page numbers, multi-page grid/leading/tracking
  consistency) — these are already implemented and considered solved for this request's purposes.

---

## 3. Known/suspected micro-typography problems (candidates for the external LLM to evaluate, confirm, or reject)

Please treat these as *hypotheses to validate*, not a confirmed list — some may be non-issues in
practice, and there may be issues not listed here.

1. **Capacity-formula fidelity.** The single global 0.9 calibration factor was derived from one
   observed real-generation mismatch, not systematically measured across font/role/script-mix
   combinations. Is a flat multiplicative correction on `charWidthMm` the right model at all, or should
   capacity estimation instead simulate actual line-breaking (e.g. run the real slice through a
   deterministic width-measurement pass — is there a way to get real glyph advance widths from the
   `.ttf` files at generation time instead of guessing) to avoid this class of bug recurring under
   different content?
2. **Justification vs. ragged-right tradeoff.** Ragged-right was adopted globally to solve uneven
   justified spacing in narrow mixed-script columns. Is there a better rule — e.g. justify only when a
   paragraph is (near-)100% CJK with no Latin runs, or only above some minimum column width, or apply
   `\sloppy`/`\emergencystretch` tuning instead of abandoning justification entirely? What does
   real CJK+Latin editorial typesetting practice (e.g. how Adobe InDesign or professional Korean
   magazine typesetting handles this) actually recommend?
3. **CJK line-breaking rules (kinsoku shori).** No explicit rules are configured for forbidding a line
   from starting with closing punctuation/particles or ending with opening punctuation, beyond
   whatever `xeCJK` defaults provide. Should this be explicitly configured, and how, in XeLaTeX/xeCJK?
4. **Uppercase Latin subheads with no added tracking.** `case_title_en` applies `\MakeUppercase` but no
   letter-spacing. Editorial convention often adds tracking to all-caps text for legibility at small
   sizes — is this worth adding, and what's a reasonable default (in em or pt) for a 10pt all-caps
   subhead?
5. **No orphan/widow control.** Column/box slicing is purely character-count-based; nothing currently
   prevents a single short line (widow) at the top of a box/column or the last line of a paragraph
   being isolated awkwardly. Is this worth solving given the box-based (not continuous-flow) model, and
   how would a character-count-based slicer even approximate this without a real line-breaking engine?
6. **No baseline grid.** Independent boxes are not snapped to a shared baseline lattice, so adjacent
   columns/spreads may not visually align line-for-line even though the document already shares grid/
   leading/tracking at the macro level. Is baseline-grid snapping feasible to retrofit onto a
   grid-cell/mm-coordinate system like this one, and is it worth the complexity for editorial quality?
7. **Hyphenation fully off vs. selectively on.** Disabling hyphenation entirely avoids ugly broken
   words but can worsen ragged-right "raggedness" (very uneven line lengths) for narrow columns with
   long English words. Is full disable the right call, or should hyphenation be re-enabled with
   English-only language patterns loaded via `polyglossia`, leaving Korean untouched (Korean doesn't
   hyphenate)?
8. **No inline emphasis (bold/italic within a single text element).** Each text element renders
   entirely in one role's style command — there is no way to bold/italicize a sub-span of text within
   a paragraph. Is this in scope to solve for pure-text emphasis markers (e.g. `**bold**` in the user's
   markdown input already being parsed elsewhere in the system), given the box-based rendering model?
9. **Numeral/punctuation style.** No explicit control over lining vs. oldstyle figures, tabular vs.
   proportional numerals, or Korean-specific punctuation width handling (e.g. full-width vs half-width
   parentheses/quotes when mixed with Latin punctuation in the same line).

---

## 4. Explicit questions for the external LLM

1. Given the architecture in §1–2, which of the hypotheses in §3 are the highest-leverage fixes for
   perceived "typography quality" in a CJK(Korean)+Latin mixed, grid-based, LaTeX-rendered editorial
   system — and which should be deprioritized or rejected as low-value/high-risk?
2. For the capacity-estimation problem (§3.1): is there a concretely better approach than a flat
   calibration factor, achievable within a Node.js + XeLaTeX pipeline (i.e. without switching away from
   LaTeX rendering), such as pre-measuring actual glyph widths from the `.ttf` files, or running a
   cheap real XeLaTeX line-break dry-run to get an exact line count before committing to a slice?
3. For justification (§3.2) and CJK line-breaking (§3.3): what are the standard `xeCJK`/`polyglossia`
   configuration options (e.g. `\XeTeXlinebreaklocale`, `\XeTeXlinebreakskip`,
   `\ccflag`/kinsoku-related settings) that a system like this should be using but currently isn't, and
   what's the recommended default configuration for Korean-majority mixed-script body text?
4. Are there other categories of micro-typography issue common to LLM-driven, box/grid-based (not
   continuous-flow) layout generation for CJK+Latin editorial content that aren't listed in §3 at all?
5. Please propose a prioritized implementation plan (not a full rewrite) — a sequence of small,
   independently-testable changes to `src/core/estimateTextCapacity.js`,
   `templates/page_style_template.sty`, `src/core/text/ColumnFlowEngine.js`, and
   `src/core/paginateGridPlan.js`, given that this codebase has an existing Node.js test-suite
   convention (`node --test`) and every prior change in this project has been validated by real
   generation output plus a full regression-test run before being considered done.
