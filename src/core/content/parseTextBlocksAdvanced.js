// Paragraph-level blocks with structural roles and metadata.
//
// Rewritten 2026-07-27 (gap analysis P0-2). Roles were previously assigned by matching hardcoded
// brand and topic keywords from one trend report ('도브'/'Dove', '스웨티 베티'/'Sweaty Betty',
// '카네기', '시위', 'LGBTQ+', 'Z세대'), and blocks even carried an extracted `brand` field that
// could only ever be "Dove" or "Sweaty Betty". For any other document every paragraph after the
// first fell through to 'body', so has_case_like_paragraphs / has_modular_blocks were always false
// and the layout stage lost the signal that the document has a repeating entry structure.
//
// Roles are now derived from FORM only: position, length, and whether the line reads as a sentence.

// A short, unpunctuated single line is a label introducing what follows, not running prose.
const LABEL_MAX_CHARS = 60
const SENTENCE_TERMINATORS = /[.!?。！？…]\s*$/

function detectParagraphRole(text, index) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return 'body'

  const isSingleLine = trimmed.split('\n').length === 1
  if (isSingleLine && trimmed.length <= LABEL_MAX_CHARS && !SENTENCE_TERMINATORS.test(trimmed)) {
    return 'entry_label'
  }

  // The opening paragraph of a document conventionally carries introductory weight. This is a
  // position fact, not a claim about the text's meaning, so it is safe for any genre.
  if (index === 0) return 'lead'

  return 'body'
}

export function parseTextBlocksAdvanced({ title, text }) {
  const titleStr = typeof title === 'string' ? title.trim() : ''
  const textStr = typeof text === 'string' ? text : ''

  // Split by blank lines (one or more newlines with optional whitespace)
  const paragraphs = textStr
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

  if (paragraphs.length === 0) {
    return {
      text_blocks: [],
      paragraph_count: 0,
      has_modular_blocks: false,
      has_case_like_paragraphs: false,
      total_chars: 0,
    }
  }

  const textBlocks = paragraphs.map((paragraph, index) => ({
    id: `paragraph_${index + 1}`,
    role: detectParagraphRole(paragraph, index),
    text: paragraph,
    char_count: paragraph.length,
    index,
  }))

  // A document with two or more short label blocks has a repeating entry structure (case studies,
  // catalogue entries, numbered items, chapter headers) -- the structural signature that used to be
  // detected by brand keywords, now detected by shape.
  const labelCount = textBlocks.filter((b) => b.role === 'entry_label').length
  const hasCaseLikeParagraphs = labelCount >= 2
  const hasModularBlocks = textBlocks.length >= 3 && hasCaseLikeParagraphs

  const totalChars = textBlocks.reduce((sum, b) => sum + b.char_count, 0)

  return {
    text_blocks: textBlocks,
    paragraph_count: paragraphs.length,
    has_modular_blocks: hasModularBlocks,
    has_case_like_paragraphs: hasCaseLikeParagraphs,
    total_chars: totalChars,
  }
}
