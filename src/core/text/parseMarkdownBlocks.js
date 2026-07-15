// Parse Markdown heading syntax and map to semantic roles
// Removes heading markers while preserving semantics

export function parseMarkdownLine(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed) return null

  // Match: 1-6 # followed by space and text
  const match = trimmed.match(/^(#{1,6})\s+(.+)$/)

  if (!match) {
    return {
      type: 'paragraph',
      markdown_level: null,
      text: trimmed,
    }
  }

  return {
    type: 'heading',
    markdown_level: match[1].length,
    text: match[2].trim(),
  }
}

export function roleFromMarkdownLevel(level, context = {}) {
  if (level === 1) return 'title'
  if (level === 2) return 'section_label'
  if (level === 3) return 'case_title_ko'
  if (level >= 4) return 'label'
  return 'body'
}

export function stripMarkdownHeadingMarkers(text) {
  if (!text) return ''

  return String(text)
    .split(/\r?\n/)
    .map((line) => {
      // Remove heading marker only at line start: ^### ... → ...
      // Preserves inline # like #NoDigitalDistortion
      return line.replace(/^\s*#{1,6}\s+/, '')
    })
    .join('\n')
    .trim()
}

// Handle special case: multiple headings on same line
// Input:  ### Korean ### ENGLISH Body text
// Output: [{ text: "Korean", level: 3 }, { text: "ENGLISH", level: 3 }, { text: "Body text", type: "paragraph" }]
export function parseMultiHeadingLine(line) {
  const trimmed = String(line || '').trim()

  // Pattern: ### Title1 ### TITLE2 Body
  // This is non-standard Markdown, but appears in user input
  const multiHeadingMatch = trimmed.match(/^(#{1,6})\s+([^#]+?)\s+(#{1,6})\s+([A-Z][A-Z\s\-]*?)\s+(.+)$/)

  if (multiHeadingMatch) {
    const level1 = multiHeadingMatch[1].length
    const text1 = multiHeadingMatch[2].trim()
    const level2 = multiHeadingMatch[3].length
    const text2 = multiHeadingMatch[4].trim()
    const bodyText = multiHeadingMatch[5].trim()

    return [
      { type: 'heading', markdown_level: level1, text: text1 },
      { type: 'heading', markdown_level: level2, text: text2 },
      { type: 'paragraph', markdown_level: null, text: bodyText },
    ]
  }

  // Single heading
  const singleMatch = parseMarkdownLine(line)
  return singleMatch ? [singleMatch] : null
}
