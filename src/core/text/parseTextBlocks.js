// Spec section 5.3: splits the user's raw body text into ordered paragraph blocks (blank-line
// delimited) instead of treating it as one opaque string. This is what lets ColumnFlowEngine.js
// keep paragraphs intact while flowing them across columns/pages, and is also what a future
// case_study_cards_grid-style layout would pair one paragraph per image with.
const TITLE_CANDIDATE_MAX_CHARS = 40

export function parseTextBlocks({ title, text }) {
  const rawParagraphs = (text ?? '')
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

  const blocks = []
  let bodyParagraphs = rawParagraphs

  const explicitTitle = typeof title === 'string' && title.trim().length > 0 ? title.trim() : null
  if (explicitTitle) {
    blocks.push({ id: 'title_1', role: 'title', text: explicitTitle })
  } else if (
    rawParagraphs.length > 1
    && rawParagraphs[0].length <= TITLE_CANDIDATE_MAX_CHARS
    && !rawParagraphs[0].includes('.')
  ) {
    // No explicit title field given, but the first paragraph reads like a short standalone
    // heading (short, no sentence-ending period) separated from the rest by a blank line.
    blocks.push({ id: 'title_1', role: 'title', text: rawParagraphs[0] })
    bodyParagraphs = rawParagraphs.slice(1)
  }

  bodyParagraphs.forEach((p, i) => {
    blocks.push({
      id: `body_${i + 1}`, role: 'body', paragraph_index: i + 1, text: p,
    })
  })

  return { text_blocks: blocks }
}
