// parseMarkdownDocument.js
// Single canonical Markdown parser for the entire pipeline
// CRITICAL: Removes heading markers at INPUT stage, before layout.json creation
// Outputs: textBlocks with role, cleanedText (no markers), markdown_level

export function parseMarkdownDocument({ title, text }) {
  const titleStr = (typeof title === 'string' ? title.trim() : '').trim()
  const textStr = (typeof text === 'string' ? text : '').trim()

  // Phase 1: Parse title if present
  const titleBlock = titleStr ? parseMarkdownLine(titleStr) : null

  // Phase 2: Parse body text by line-break boundaries
  // Each line that starts with # is a heading; otherwise paragraph continuation
  const textBlocks = []
  if (textStr) {
    const lines = textStr.split('\n')
    let currentParagraph = []
    let currentParagraphRole = 'body'

    lines.forEach((line, lineIdx) => {
      const trimmed = line.trim()

      // Blank line = paragraph boundary
      if (!trimmed) {
        if (currentParagraph.length > 0) {
          textBlocks.push({
            role: currentParagraphRole,
            text: currentParagraph.join('\n').trim(),
            markdown_level: null, // Already stripped
          })
          currentParagraph = []
          currentParagraphRole = 'body'
        }
        return
      }

      // Try to parse heading syntax (^### TEXT)
      const parsed = parseMarkdownLine(trimmed)

      if (parsed.type === 'heading') {
        // Flush current paragraph if exists
        if (currentParagraph.length > 0) {
          textBlocks.push({
            role: currentParagraphRole,
            text: currentParagraph.join('\n').trim(),
            markdown_level: null,
          })
          currentParagraph = []
        }

        // Add heading as its own block
        const role = roleFromMarkdownLevel(parsed.markdown_level)
        textBlocks.push({
          role,
          text: parsed.text, // Already cleaned (markers removed)
          markdown_level: parsed.markdown_level,
        })
        currentParagraphRole = 'body'
      } else {
        // Body text line
        currentParagraph.push(trimmed)
      }
    })

    // Flush remaining paragraph
    if (currentParagraph.length > 0) {
      textBlocks.push({
        role: currentParagraphRole,
        text: currentParagraph.join('\n').trim(),
        markdown_level: null,
      })
    }
  }

  return {
    title: titleBlock?.text || titleStr || null, // Already cleaned
    title_role: titleBlock?.type === 'heading' ? roleFromMarkdownLevel(titleBlock.markdown_level) : 'title',
    title_markdown_level: titleBlock?.markdown_level || null,
    text_blocks: textBlocks, // Each has: role, text (cleaned), markdown_level
    block_count: textBlocks.length,
  }
}

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
    text: match[2].trim(), // Already cleaned: markers removed
  }
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
    .map((line) => {
      // Remove heading marker only at line start: ^### ... → ...
      // Preserves inline # like #NoDigitalDistortion
      return line.replace(/^\s*#{1,6}\s+/, '')
    })
    .join('\n')
    .trim()
}

// Validate that text is clean (no leading # markers)
export function assertNoMarkdownMarkers(text) {
  if (!text) return true
  const lines = String(text).split('\n')
  const marked = lines.filter((line) => /^\s*#{1,6}\s+/.test(line))
  if (marked.length > 0) {
    throw new Error(`Text contains markdown markers (should have been cleaned): ${marked.slice(0, 3).join('; ')}`)
  }
  return true
}
