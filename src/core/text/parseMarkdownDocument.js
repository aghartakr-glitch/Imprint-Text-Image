// parseMarkdownDocument.js
// Single canonical Markdown parser for the entire pipeline
// CRITICAL: Removes heading markers at INPUT stage, before layout.json creation
// Outputs: textBlocks with role, cleanedText (no markers), markdown_level

// A source/credit line ("Sweaty Betty", "Nike N7", "João Marcos Moreira") that the user typed on
// its own line at the END of a paragraph, with no blank line separating it. Split out as its own
// block so the layout stage can set it against its image instead of leaving it dangling at the end
// of the body copy (2026-07-27: the user asked for these to sit on the image's bottom-right).
// Detected by SHAPE only -- short, no sentence-ending punctuation, and not the paragraph's only
// line -- so it works for any brand, artist, or institution in any language.
const CREDIT_MAX_LENGTH = 34
const SENTENCE_END = /[.!?。！？…]\s*$/

// The break before a credit is whichever the user typed: a real newline, or the <br> the spec
// defines as "line break inside the same text box" (confirmed 2026-07-27 against the real input --
// every credit arrived as "...디자인했습니다.<br>Sweaty Betty", so a newline-only check found none).
const LINE_BREAK = /\n|<br\s*\/?>/i

function splitTrailingCreditLine(paragraphText) {
  const parts = paragraphText.split(new RegExp(LINE_BREAK.source, 'gi'))
  if (parts.length < 2) return null
  const last = parts[parts.length - 1].trim()
  if (!last || last.length > CREDIT_MAX_LENGTH || SENTENCE_END.test(last)) return null

  // Require the preceding content to actually be prose, so a two-line heading is never split apart.
  // The head is rebuilt from the original string (not re-joined from parts) so any other <br> the
  // user placed mid-paragraph survives exactly as typed.
  const lastBreak = paragraphText.search(new RegExp(`(?:${LINE_BREAK.source})(?![\\s\\S]*(?:${LINE_BREAK.source}))`, 'i'))
  if (lastBreak < 0) return null
  const head = paragraphText.slice(0, lastBreak).trim()
  if (head.length < CREDIT_MAX_LENGTH * 2) return null
  return { head, credit: last }
}

export function parseMarkdownDocument({ title, text }) {
  const titleStr = (typeof title === 'string' ? title.trim() : '').trim()
  const textStr = (typeof text === 'string' ? text : '').trim()

  // Phase 1: Parse title if present
  const titleBlock = titleStr ? parseMarkdownLine(titleStr) : null

  // Phase 2: Parse body text by line-break boundaries
  // Each line that starts with # is a heading; otherwise paragraph continuation
  //
  // group_id: blocks the user wrote with NO blank line between them (e.g. a "## Korean title" line
  // immediately followed by "## English title" immediately followed by "### body", all on
  // consecutive lines) share the same group_id -- a blank line is the ONLY thing that starts a new
  // group. This makes the user's deliberate "no blank line = these belong together" intent
  // explicit and machine-readable, instead of being silently discarded (confirmed 2026-07-27: every
  // heading was previously split into its own fully independent block regardless of blank-line
  // adjacency, so nothing downstream could tell a heading and the paragraph the user glued directly
  // beneath it apart from a heading and paragraph the user separated with a blank line on purpose).
  const textBlocks = []
  if (textStr) {
    const lines = textStr.split('\n')
    let currentParagraph = []
    let currentParagraphRole = 'body'
    let currentParagraphDowngradedHeadingLevel = null
    let groupId = 0

    // Single flush point for a completed paragraph, so the trailing-credit split applies wherever a
    // paragraph ends (blank line, following heading, or end of input) rather than only in one of
    // the three places this used to be duplicated.
    const flushParagraph = () => {
      if (currentParagraph.length === 0) return
      const text = currentParagraph.join('\n').trim()
      const split = currentParagraphRole === 'body' ? splitTrailingCreditLine(text) : null
      if (split) {
        textBlocks.push({
          role: currentParagraphRole,
          text: split.head,
          markdown_level: null,
          downgraded_heading_level: currentParagraphDowngradedHeadingLevel,
          group_id: groupId,
        })
        textBlocks.push({
          role: 'caption',
          text: split.credit,
          markdown_level: null,
          downgraded_heading_level: null,
          group_id: groupId,
        })
      } else {
        textBlocks.push({
          role: currentParagraphRole,
          text,
          markdown_level: null,
          downgraded_heading_level: currentParagraphDowngradedHeadingLevel,
          group_id: groupId,
        })
      }
      currentParagraph = []
      currentParagraphDowngradedHeadingLevel = null
    }

    lines.forEach((line, lineIdx) => {
      const trimmed = line.trim()

      // Blank line = paragraph boundary AND group boundary
      if (!trimmed) {
        flushParagraph()
        currentParagraphRole = 'body'
        groupId += 1
        return
      }

      // Try to parse heading syntax (^### TEXT)
      const parsed = parseMarkdownLine(trimmed)

      if (parsed.type === 'heading') {
        // Flush current paragraph if exists (still the same group -- no blank line was hit)
        flushParagraph()

        // Add heading as its own block
        const role = roleFromMarkdownLevel(parsed.markdown_level)
        textBlocks.push({
          role,
          text: parsed.text, // Already cleaned (markers removed)
          markdown_level: parsed.markdown_level,
          downgraded_heading_level: parsed.downgraded_heading_level ?? null,
          group_id: groupId,
        })
        currentParagraphRole = 'body'
      } else {
        // Body text line (parsed.text, not trimmed -- a marker that was downgraded to paragraph
        // because it was too long to be a real heading still needs the marker itself stripped)
        currentParagraph.push(parsed.text)
        if (parsed.downgraded_heading_level != null && currentParagraphDowngradedHeadingLevel == null) {
          currentParagraphDowngradedHeadingLevel = parsed.downgraded_heading_level
        }
      }
    })

    // Flush remaining paragraph
    flushParagraph()
  }

  return {
    title: titleBlock?.text || titleStr || null, // Already cleaned
    title_role: titleBlock?.type === 'heading' ? roleFromMarkdownLevel(titleBlock.markdown_level) : 'title',
    title_markdown_level: titleBlock?.markdown_level || null,
    text_blocks: textBlocks, // Each has: role, text (cleaned), markdown_level
    block_count: textBlocks.length,
  }
}

// Bracket markers ([제목]/[소제목]) are a code-safe alternative to #: unlike #, they never collide
// with comments, hashtags, or preprocessor directives that might appear in a user's pasted body
// text, since no programming language treats a literal "[제목]"/"[소제목]" line prefix as syntax.
const BRACKET_MARKER_LEVELS = { 제목: 1, 소제목: 2 }

// Headings are short labels by definition. A marked line running past this length is virtually
// never an actual heading -- it's body text the user happened to prefix with a marker (confirmed
// 2026-07-16: multi-sentence paragraphs like "[1] 카네기 국제평화재단...시위에 동참합니다." were
// marked with ### and rendered as bold section titles, cut off mid-sentence). Past this length,
// the marker is still stripped but the line is treated as an ordinary paragraph line instead.
const HEADING_MAX_LENGTH = 40

export function parseMarkdownLine(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed) return null

  const bracketMatch = trimmed.match(/^\[(제목|소제목)\]\s+(.+)$/)
  if (bracketMatch) {
    const text = bracketMatch[2].trim()
    if (text.length <= HEADING_MAX_LENGTH) {
      return { type: 'heading', markdown_level: BRACKET_MARKER_LEVELS[bracketMatch[1]], text }
    }
    return { type: 'paragraph', markdown_level: null, downgraded_heading_level: BRACKET_MARKER_LEVELS[bracketMatch[1]], text }
  }

  // Match: 1-6 # followed by space and text
  const match = trimmed.match(/^(#{1,6})\s+(.+)$/)

  if (!match) {
    return {
      type: 'paragraph',
      markdown_level: null,
      text: trimmed,
    }
  }

  const text = match[2].trim() // Already cleaned: markers removed
  if (text.length <= HEADING_MAX_LENGTH) {
    return { type: 'heading', markdown_level: match[1].length, text }
  }
  return { type: 'paragraph', markdown_level: null, downgraded_heading_level: match[1].length, text }
}

export function roleFromMarkdownLevel(level) {
  if (!level) return 'body'
  if (level === 1) return 'title'
  if (level === 2) return 'section_label'
  if (level === 3) return 'case_title_ko'
  if (level >= 4) return 'label'
  return 'body'
}

// Safety net: strips any remaining markdown markers (should never be needed if pipeline is clean)
export function stripMarkdownHeadingMarkers(text) {
  if (!text) return ''

  return String(text)
    .split(/\r?\n/)
    .map((line) => line
      // Remove heading marker only at line start: ^### ... → ...
      // Preserves inline # like #NoDigitalDistortion
      .replace(/^\s*#{1,6}\s+/, '')
      // Remove bracket marker only at line start: ^[제목]/[소제목] ... → ...
      .replace(/^\s*\[(제목|소제목)\]\s+/, ''))
    .join('\n')
    .trim()
}

// Validate that text is clean (no leading # or [제목]/[소제목] markers)
export function assertNoMarkdownMarkers(text) {
  if (!text) return true
  const lines = String(text).split('\n')
  const marked = lines.filter((line) => /^\s*#{1,6}\s+/.test(line) || /^\s*\[(제목|소제목)\]\s+/.test(line))
  if (marked.length > 0) {
    throw new Error(`Text contains markdown markers (should have been cleaned): ${marked.slice(0, 3).join('; ')}`)
  }
  return true
}
