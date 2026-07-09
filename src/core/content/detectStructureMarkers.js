// Spec: Detect lightweight structure markers in document
// Markdown headings, separators, lists, quotes, labels, explicit tags

export const STRUCTURE_MARKERS = {
  HEADING_1: /^#\s+(.+)$/m,
  HEADING_2: /^##\s+(.+)$/m,
  HEADING_3: /^###\s+(.+)$/m,
  SEPARATOR_DASH: /^---+$/m,
  SEPARATOR_EQUALS: /^===+$/m,
  SEPARATOR_SLASH: /^\/\/\/+$/m,
  LIST_NUMBERED: /^\d+[\.\)]\s+(.+)$/m,
  LIST_BULLET: /^[-•]\s+(.+)$/m,
  QUOTE_BLOCK: /^>\s+(.+)$/m,
  EXPLICIT_TAG: /^\[(INTRO|CONTEXT|CASE|CONCLUSION|QUOTE)\]$/i,
}

export function detectStructureMarkers(text) {
  const lines = text.split('\n')
  const markers = []

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) return

    // Heading
    const heading1 = trimmed.match(/^#\s+(.+)$/)
    if (heading1) {
      markers.push({
        type: 'heading_1',
        line: index,
        text: heading1[1],
        role: 'title',
      })
      return
    }

    const heading2 = trimmed.match(/^##\s+(.+)$/)
    if (heading2) {
      markers.push({
        type: 'heading_2',
        line: index,
        text: heading2[1],
        role: 'section_title',
      })
      return
    }

    const heading3 = trimmed.match(/^###\s+(.+)$/)
    if (heading3) {
      markers.push({
        type: 'heading_3',
        line: index,
        text: heading3[1],
        role: 'subsection_title',
      })
      return
    }

    // Separators (only on their own line)
    if (/^---+$/.test(trimmed) || /^===+$/.test(trimmed) || /^\/\/\/+$/.test(trimmed)) {
      markers.push({
        type: 'separator',
        line: index,
      })
      return
    }

    // List items
    const numbered = trimmed.match(/^\d+[\.\)]\s+(.+)$/)
    if (numbered) {
      markers.push({
        type: 'list_numbered',
        line: index,
        text: numbered[1],
      })
      return
    }

    const bullet = trimmed.match(/^[-•]\s+(.+)$/)
    if (bullet) {
      markers.push({
        type: 'list_bullet',
        line: index,
        text: bullet[1],
      })
      return
    }

    // Quote blocks
    const quote = trimmed.match(/^>\s+(.+)$/)
    if (quote) {
      markers.push({
        type: 'quote_block',
        line: index,
        text: quote[1],
      })
      return
    }

    // Explicit tags
    const tag = trimmed.match(/^\[(INTRO|CONTEXT|CASE|CONCLUSION|QUOTE)\]$/i)
    if (tag) {
      markers.push({
        type: 'explicit_tag',
        line: index,
        tag: tag[1].toUpperCase(),
      })
      return
    }

    // Short label (potential case title or section label)
    // Heuristic: short line (< 60 chars) followed by longer paragraph
    if (trimmed.length < 60 && trimmed.length > 3) {
      // Check if next non-empty line exists and is longer
      const nextNonEmpty = lines
        .slice(index + 1)
        .find((l) => l.trim().length > 0)
      if (nextNonEmpty && nextNonEmpty.trim().length > 60) {
        markers.push({
          type: 'short_label',
          line: index,
          text: trimmed,
          potential_role: 'case_title_or_label',
        })
      }
    }
  })

  return markers
}

export function hasLightweightMarkers(text) {
  const markers = detectStructureMarkers(text)
  const withoutTags = markers.filter((m) => m.type !== 'explicit_tag')
  return withoutTags.length > 0
}

export function hasExplicitTags(text) {
  const markers = detectStructureMarkers(text)
  return markers.some((m) => m.type === 'explicit_tag')
}
