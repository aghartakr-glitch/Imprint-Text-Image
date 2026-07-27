// Spec: Advanced document structure parsing with lightweight markers
// Recognizes: blank lines, Markdown, separators, lists, quotes, labels, tags
// Infers: document structure, block roles, text layout mode
// CANONICAL: Uses parseMarkdownDocument for unified Markdown handling

import { parseMarkdownDocument } from '../text/parseMarkdownDocument.js'
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

  // CANONICAL: Use unified Markdown parser (removes markers at input stage). The document title is
  // metadata (document_structure.title below), not one of the body text_blocks/paragraphs -- only
  // body paragraphs get counted/indexed here, matching the pre-existing paragraph_count contract.
  const mdParsed = parseMarkdownDocument({ title: titleStr, text: textStr })

  const LIST_LINE_PATTERN = /^\s*(?:\d+[.)]|[-•])\s+/

  const blocks = mdParsed.text_blocks.map((block, index) => {
    const isList = block.role === 'body' && LIST_LINE_PATTERN.test(block.text.split(/\r?\n/)[0])

    // A markdown heading already carries an explicit role. If a marked line was downgraded because
    // it is too long to be a heading, keep it as body instead of re-promoting it by keyword/length.
    const isDowngradedHeadingBody = block.role === 'body' && block.downgraded_heading_level != null
    const role = isList ? 'list_item' : (block.role === 'body' && !isDowngradedHeadingBody ? inferBlockRole(block.text, index === 0) : block.role)
    const type = isList ? 'list_item' : (block.role === 'body' ? 'paragraph' : 'heading')

    return {
      id: `p${index + 1}`,
      type,
      role,
      text: block.text, // Already cleaned (no markdown markers)
      char_count: block.text.length,
      index,
      markdown_level: block.markdown_level,
      downgraded_heading_level: block.downgraded_heading_level ?? null,
      group_id: block.group_id,
      semantic_hint: analyzeSemanticContent(block.text),
    }
  })

  // Detect structure markers (for backwards compatibility)
  const markers = detectStructureMarkers(textStr)
  const hasLightweight = hasLightweightMarkers(textStr)
  const hasExplicit = hasExplicitTags(textStr)

  // Infer layout mode
  const textLayoutMode = inferTextLayoutMode(blocks, blocks.length)

  return {
    document_structure: {
      title: mdParsed.title || titleStr || null,
      sections: extractSections(blocks),
      blocks: blocks.map((b) => ({
        id: b.id,
        type: b.type,
        role: b.role,
        text: b.text.substring(0, 100) + (b.text.length > 100 ? '...' : ''),
        char_count: b.char_count,
        group_id: b.group_id,
        semantic_hint: b.semantic_hint,
      })),
    },
    paragraph_count: blocks.length,
    text_blocks: blocks, // Canonical: from parseMarkdownDocument (no markers)
    text_layout_mode: textLayoutMode,
    has_lightweight_markers: hasLightweight,
    has_explicit_tags: hasExplicit,
    merged_body_all: blocks.length === 1,
  }
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
  // A repeating entry structure shows up as two or more short label blocks (headings or
  // label-like paragraphs), regardless of what those labels say -- replaced the old
  // case_body/protest_case/brand_case role check, which only ever matched one trend report.
  const labelLikeCount = blocks.filter((b) => b.role === 'section_label' || b.role === 'label' || b.type === 'label').length
  const hasRepeatingEntries = labelLikeCount >= 2

  // Modular: many distinct sections or repeated entries
  if (hasRepeatingEntries || (hasHeadings && paragraphCount > 4) || hasList) {
    return 'modular_blocks'
  }

  // Hybrid: mixed structure with multiple sections
  if ((hasHeadings || hasQuotes) && paragraphCount >= 3) {
    return 'hybrid_flow'
  }

  // Default continuous
  return 'continuous_flow'
}

// Structural shape of a block, surfaced to the layout stage as a hint.
//
// Replaced 2026-07-27 (gap analysis P0-2): this used to scan for 'Dove', 'Sweaty Betty', 'LGBTQ+',
// 'feminism', 'activism' and report "detected: ..." -- a description of one specific document's
// subject matter that was meaningless (always empty) for every other input. The hint now describes
// the block's FORM, which is what a layout engine can actually act on.
function analyzeSemanticContent(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return ''

  const charCount = trimmed.length
  const lineCount = trimmed.split(/\r?\n/).length
  const sentenceCount = trimmed.split(/[.!?。！？…]+/).filter((s) => s.trim().length > 0).length

  if (lineCount === 1 && charCount <= 60 && sentenceCount <= 1) return 'short_label_line'
  if (charCount >= 400) return 'long_prose'
  if (sentenceCount >= 2) return 'multi_sentence_prose'
  return 'single_sentence'
}
