// Form-based role inference for body paragraphs.
//
// Rewritten 2026-07-27 (gap analysis P0-2). The previous implementation matched hardcoded keywords
// from one specific trend report -- brand names ('도브'/'Dove', '스웨티 베티'/'Sweaty Betty'),
// topic words ('초양극화', 'LGBTQ+', '카네기'), and audience terms ('Z세대', '밀레니얼') -- and
// mapped them to content-specific roles (brand_case, protest_case, audience_value,
// intro_definition). Any other document (a novel, an exhibition catalogue, a research report) matched
// none of them, so every downstream consumer that keyed off those roles silently got nothing. In
// particular matchImageToTextBlocks.js filtered exclusively on brand_case/protest_case/intro_*, so
// image-text pairing produced ZERO pairs for all non-trend-report input -- the direct cause of the
// "images and text never form a relationship" symptom.
//
// This version uses only FORM signals, never meaning: length, terminal punctuation, quotation
// wrapping, and position. Markdown headings never reach here (parseMarkdownDocument already assigns
// their role from the heading level); this only classifies the remaining body paragraphs.

// A label-like line is short AND does not read as a sentence. Both conditions are required: a short
// but properly punctuated line ("그는 떠났다.") is a real one-sentence paragraph in a novel, not a
// label, and must stay body so it is typeset as running text.
const LABEL_MAX_LENGTH = 40

// Terminal punctuation across the scripts this system targets (Latin + CJK full-width forms).
const SENTENCE_TERMINATORS = /[.!?。！？…]\s*$/

// A quotation-only paragraph (pull quote / epigraph). Requires the whole block to be wrapped, so an
// ordinary paragraph that merely contains a quoted phrase is unaffected.
const WRAPPED_IN_QUOTES = /^\s*["'"'«『「](.|\n)*["'"'»』」]\s*$/

export function inferBlockRole(text, isFirstBlock = false) {
  if (!text) return 'body'

  const trimmed = String(text).trim()
  if (!trimmed) return 'body'

  if (WRAPPED_IN_QUOTES.test(trimmed) && trimmed.length <= 200) {
    return 'quote'
  }

  // Short, unpunctuated line -> a label/standfirst rather than running text. isFirstBlock is
  // deliberately NOT special-cased into an "intro" role: whether the opening paragraph deserves
  // visual emphasis is a genre/layout decision, not a property of the text, and the old
  // intro_definition role existed only to feed the hardcoded matcher.
  if (trimmed.length <= LABEL_MAX_LENGTH && !SENTENCE_TERMINATORS.test(trimmed)) {
    return 'section_label'
  }

  return 'body'
}

// Style hints keyed by the form-based role vocabulary this module now emits, plus the heading roles
// parseMarkdownDocument assigns. Unknown roles fall back to body styling rather than throwing, so a
// new role added upstream degrades gracefully instead of breaking rendering.
export function getBlockStylingHints(role) {
  const hints = {
    title: { style: 'title_text', emphasis: 'high' },
    section_label: { style: 'label_text', emphasis: 'high' },
    case_title_ko: { style: 'case_title_text', emphasis: 'high' },
    label: { style: 'label_text', emphasis: 'medium' },
    quote: { style: 'quote_text', emphasis: 'high' },
    caption: { style: 'caption_text', emphasis: 'low' },
    list_item: { style: 'body_text', emphasis: 'low' },
    body: { style: 'body_text', emphasis: 'low' },
  }

  return hints[role] || { style: 'body_text', emphasis: 'low' }
}
