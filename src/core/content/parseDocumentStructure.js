// Spec: Advanced document structure parsing with lightweight markers
// Recognizes: blank lines, Markdown, separators, lists, quotes, labels, tags
// Infers: document structure, block roles, text layout mode

import { detectStructureMarkers, hasLightweightMarkers, hasExplicitTags } from './detectStructureMarkers.js'
import { inferBlockRole } from './inferBlockRole.js'

export function parseDocumentStructure({ title, text }) {
  const titleStr = typeof title === 'string' ? title.trim() : ''
  const textStr = typeof text === 'string' ? text : ''

  if (!textStr) {
    return {
      document_structure: {
        title: titleStr || null,
        sections: [],
        blocks: [],
      },
      paragraph_count: 0,
      text_blocks: [],
      text_layout_mode: 'continuous_flow',
      has_lightweight_markers: false,
      has_explicit_tags: false,
      merged_body_all: false,
    }
  }

  // Detect structure markers
  const markers = detectStructureMarkers(textStr)
  const hasLightweight = hasLightweightMarkers(textStr)
  const hasExplicit = hasExplicitTags(textStr)

  // Split by blank lines to get paragraphs
  const paragraphs = textStr
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

  // Build blocks from paragraphs and markers
  const blocks = buildBlocks(paragraphs, markers, textStr)

  // Infer layout mode
  const textLayoutMode = inferTextLayoutMode(blocks, paragraphs.length)

  return {
    document_structure: {
      title: titleStr || null,
      sections: extractSections(blocks),
      blocks: blocks.map((b) => ({
        id: b.id,
        type: b.type,
        role: b.role,
        text: b.text.substring(0, 100) + (b.text.length > 100 ? '...' : ''),
        char_count: b.char_count,
        semantic_hint: b.semantic_hint,
      })),
    },
    paragraph_count: paragraphs.length,
    text_blocks: blocks,
    text_layout_mode: textLayoutMode,
    has_lightweight_markers: hasLightweight,
    has_explicit_tags: hasExplicit,
    merged_body_all: paragraphs.length === 1 || (hasLightweight && blocks.length === 1),
  }
}

function buildBlocks(paragraphs, markers, fullText) {
  const blocks = []
  const markersByContent = indexMarkersByContent(markers, paragraphs, fullText)

  paragraphs.forEach((paragraph, index) => {
    const paraMarkers = markersByContent[index] || []

    // Check for explicit tags
    const explicitTag = paraMarkers.find((m) => m.type === 'explicit_tag')

    // Check for structure types
    const isHeading = paraMarkers.some((m) => m.type?.startsWith('heading_'))
    const isList = paraMarkers.some((m) => m.type?.startsWith('list_'))
    const isQuote = paraMarkers.some((m) => m.type === 'quote_block')
    const isLabel = paraMarkers.some((m) => m.type === 'short_label')

    let type = 'paragraph'
    let role = 'body'

    if (isHeading) {
      type = 'heading'
      role = paraMarkers.find((m) => m.type?.startsWith('heading_'))?.role || 'section_title'
    } else if (isList) {
      type = 'list_item'
      role = 'list_item'
    } else if (isQuote) {
      type = 'quote'
      role = 'quote'
    } else if (isLabel) {
      type = 'label'
      role = 'label'
    } else if (explicitTag) {
      type = 'paragraph'
      role = explicitTag.tag.toLowerCase()
    } else {
      // Infer role from content
      role = inferBlockRole(paragraph, index === 0)
    }

    const block = {
      id: `p${index + 1}`,
      type,
      role,
      text: paragraph,
      char_count: paragraph.length,
      index,
      semantic_hint: analyzeSemanticContent(paragraph),
    }

    blocks.push(block)
  })

  return blocks
}

function indexMarkersByContent(markers, paragraphs, fullText) {
  const index = {}

  markers.forEach((marker) => {
    // Try to match marker line to paragraph index
    const markerLine = marker.line
    let charCount = 0
    let paraIndex = 0

    for (let i = 0; i < paragraphs.length; i++) {
      const paraStartInFull = fullText.indexOf(paragraphs[i])
      const paraLineCount = paragraphs[i].split('\n').length
      const paraEndLine = fullText.substring(0, paraStartInFull + paragraphs[i].length).split('\n').length - 1

      if (markerLine >= charCount && markerLine <= charCount + paraLineCount) {
        paraIndex = i
        break
      }
      charCount += paraLineCount + 1 // +1 for blank line
    }

    if (!index[paraIndex]) {
      index[paraIndex] = []
    }
    index[paraIndex].push(marker)
  })

  return index
}

function extractSections(blocks) {
  const sections = []
  let currentSection = null

  blocks.forEach((block) => {
    if (block.type === 'heading') {
      if (block.role === 'section_title' || block.role === 'title') {
        currentSection = {
          title: block.text,
          blocks: [],
        }
        sections.push(currentSection)
      }
    } else if (currentSection) {
      currentSection.blocks.push(block.id)
    }
  })

  return sections
}

function inferTextLayoutMode(blocks, paragraphCount) {
  // If only one paragraph or continuous text, use continuous_flow
  if (paragraphCount <= 1 || !blocks || blocks.length <= 1) {
    return 'continuous_flow'
  }

  // Count different block types
  const hasHeadings = blocks.some((b) => b.type === 'heading')
  const hasList = blocks.some((b) => b.type === 'list_item')
  const hasQuotes = blocks.some((b) => b.type === 'quote')
  const hasCases = blocks.some((b) => b.role === 'case_body' || b.role === 'protest_case' || b.role === 'brand_case')
  const hasLabels = blocks.some((b) => b.type === 'label')

  // Modular: many distinct sections or cases
  if (hasCases || hasLabels || (hasHeadings && paragraphCount > 4) || hasList) {
    return 'modular_blocks'
  }

  // Hybrid: intro + cases
  const hasIntro = blocks.some((b) => b.role === 'intro_definition' || b.role === 'overview')
  if (hasIntro && hasCases) {
    return 'hybrid_flow'
  }

  // Hybrid: mixed structure with multiple sections
  if ((hasHeadings || hasQuotes) && paragraphCount >= 3) {
    return 'hybrid_flow'
  }

  // Default continuous
  return 'continuous_flow'
}

function analyzeSemanticContent(text) {
  const keywords = [
    'trend', 'context', 'audience', 'case', 'protest', 'brand',
    'Dove', 'Sweaty Betty', 'LGBTQ+', 'feminism', 'activism',
  ]

  const foundKeywords = keywords.filter((kw) =>
    text.toLowerCase().includes(kw.toLowerCase())
  )

  if (foundKeywords.length > 0) {
    return `detected: ${foundKeywords.join(', ')}`
  }

  return ''
}
