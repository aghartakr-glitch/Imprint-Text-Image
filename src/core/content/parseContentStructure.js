// Structural summary of the body text, used by layout-family selection and text-flow mode.
//
// Rewritten 2026-07-27 (gap analysis P0-2). Roles used to come from keyword regexes tied to one
// trend report (도브/Dove, 스웨티 베티, 카네기/시위/LGBTQ, Z세대, and literally /^DESIGN CASE
// STUDIES$/ plus a credit list of "Nike N7|Deepti Khatri|Lippa Nessa"). Any other document matched
// none of them and fell through to 'unknown', so every consumer keyed on those roles silently got
// nothing.
//
// Roles here are now derived from FORM only: line count, character length, capitalisation, and
// script. The vocabulary is deliberately kept compatible with what downstream code already reads
// (case_title_*, credit, body) so this is a behaviour fix rather than a schema change.

// A single short line is a label of some kind, not running prose.
const SHORT_LINE_MAX_CHARS = 60
// Korean headings run shorter than Latin ones at the same visual weight.
const KOREAN_HEADING_MAX_CHARS = 40
// A credit/caption line is shorter still and carries no sentence punctuation.
const CREDIT_MAX_CHARS = 30

const SENTENCE_TERMINATORS = /[.!?。！？…]\s*$/
const CONTAINS_HANGUL = /[가-힣]/
// Latin text with no lowercase letters -- an all-caps line reads as a display heading in editorial
// typography regardless of what it says.
const LATIN_ALL_CAPS = /^[^a-z]*$/

function inferParagraphRole(text) {
  const trimmed = text.trim()
  if (!trimmed) return 'body'

  const isSingleLine = trimmed.split('\n').length === 1
  const charCount = trimmed.length

  if (isSingleLine && charCount <= SHORT_LINE_MAX_CHARS && !SENTENCE_TERMINATORS.test(trimmed)) {
    // Very short, unpunctuated, no Hangul -> a source/credit line ("Nike N7", "Patagonia").
    // Detected by shape alone, so it works for any brand, artist, or institution name.
    if (charCount <= CREDIT_MAX_CHARS && !CONTAINS_HANGUL.test(trimmed) && /[A-Za-z0-9]/.test(trimmed)) {
      return 'credit'
    }
    if (!CONTAINS_HANGUL.test(trimmed) && LATIN_ALL_CAPS.test(trimmed) && /[A-Z]/.test(trimmed)) {
      return 'case_title_en'
    }
    if (CONTAINS_HANGUL.test(trimmed) && charCount <= KOREAN_HEADING_MAX_CHARS) {
      return 'case_title_ko'
    }
    return 'case_title_ko'
  }

  return 'body'
}

export function parseContentStructure({ title, text }) {
  const titleStr = typeof title === 'string' ? title.trim() : ''
  const textStr = typeof text === 'string' ? text : ''

  // Split by blank lines (one or more) to detect paragraph boundaries
  const rawParagraphs = textStr
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

  const paragraph_count = rawParagraphs.length

  const text_blocks = rawParagraphs.map((para, idx) => ({
    id: `paragraph_${idx + 1}`,
    type: 'paragraph',
    role: inferParagraphRole(para),
    text: para,
    char_count: para.length,
  }))

  // Layout mode from structural density: a document with several distinct short-label blocks, or
  // simply many blocks, is modular; a handful of blocks is hybrid; one or two is continuous.
  let text_layout_mode = 'continuous_flow'
  if (paragraph_count >= 2) {
    const labelBlockCount = text_blocks.filter((b) => b.role !== 'body').length
    if (labelBlockCount >= 2 || paragraph_count >= 5) {
      text_layout_mode = 'modular_blocks'
    } else if (paragraph_count >= 3) {
      text_layout_mode = 'hybrid_flow'
    }
  }

  // Backward compatibility: also return old structure
  let introBody = null
  let bodyParagraphs = rawParagraphs
  const INTRO_MAX_CHARS = 150
  if (rawParagraphs.length > 1 && rawParagraphs[0].length < INTRO_MAX_CHARS && !rawParagraphs[0].endsWith('.')) {
    introBody = rawParagraphs[0]
    bodyParagraphs = rawParagraphs.slice(1)
  }

  return {
    // New structure (primary)
    paragraph_count,
    text_blocks,
    text_layout_mode,
    merged_body_all: false, // Explicitly mark: NOT merged

    // Old structure (backward compatibility)
    title: titleStr || null,
    intro_body: introBody,
    body_paragraphs: bodyParagraphs,
    has_intro: !!introBody,
    has_body: bodyParagraphs.length > 0,
    // "Case-like" now means: repeated short-label blocks introducing longer prose -- the structural
    // signature of a case-study/catalogue-entry document, with no dependence on subject matter.
    has_case_like_paragraphs: text_blocks.filter((b) => b.role === 'case_title_ko' || b.role === 'case_title_en').length >= 2,
    total_paragraphs: paragraph_count,
  }
}
