// Spec section 5.3: Rich content structure parsing for editorial layouts.
// Identifies meaningful content groups (intro, paragraphs, case studies, numbered items)
// so the LLM can make better layout decisions than treating everything as one body block.

function detectCaseStudyPattern(lines) {
  // Pattern: Korean short title + English uppercase title + body text
  // Example: "편집디자인\nEDITORIAL DESIGN\n본문..."
  const caseItems = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]?.trim() || ''
    if (!line) {
      i += 1
      continue
    }

    const isKorean = /[\u ac00-힯]/.test(line)
    const nextLine = lines[i + 1]?.trim() || ''
    const isEnglishTitle = /^[A-Z\s]+$/.test(nextLine) && nextLine.length > 0 && nextLine.length < 50

    if (isKorean && isEnglishTitle) {
      // Found a potential case study header
      const titleKo = line
      const titleEn = nextLine
      let body = ''
      let j = i + 2
      while (j < lines.length && lines[j]?.trim()) {
        body += (body ? '\n' : '') + lines[j].trim()
        j += 1
      }
      if (body) {
        caseItems.push({ title_ko: titleKo, title_en: titleEn, body })
        i = j
      } else {
        i += 1
      }
    } else {
      i += 1
    }
  }
  return caseItems.length > 1 ? caseItems : null
}

function detectNumberedItems(lines) {
  // Pattern: "1. Text" or "1) Text" or similar
  const numberedItems = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]?.trim() || ''
    const match = line.match(/^(\d+)[\.\)]\s*(.+)$/)
    if (match) {
      const num = Number(match[1])
      let body = match[2]
      let j = i + 1
      while (j < lines.length && lines[j]?.trim() && !lines[j]?.trim().match(/^(\d+)[\.\)]/)) {
        body += '\n' + lines[j].trim()
        j += 1
      }
      numberedItems.push({ number: num, text: body })
      i = j
    } else {
      i += 1
    }
  }
  return numberedItems.length > 0 && numberedItems[0].number === 1 ? numberedItems : null
}

export function parseContentStructure({ title, text }) {
  const titleStr = typeof title === 'string' ? title.trim() : ''
  const textStr = typeof text === 'string' ? text : ''

  // Split by blank lines into paragraphs
  const paragraphs = textStr
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

  // Auto-detect intro paragraph (short first paragraph, no period)
  let introBody = null
  let bodyParagraphs = paragraphs
  const INTRO_MAX_CHARS = 150
  if (paragraphs.length > 1 && paragraphs[0].length < INTRO_MAX_CHARS && !paragraphs[0].endsWith('.')) {
    introBody = paragraphs[0]
    bodyParagraphs = paragraphs.slice(1)
  }

  // Try to detect case studies (Korean + English title pairs)
  const caseStudies = detectCaseStudyPattern(paragraphs)

  // Try to detect numbered items
  const numberedItems = detectNumberedItems(paragraphs)

  // If we found cases or numbers, body is already categorized
  let finalBodyParagraphs = bodyParagraphs
  if (caseStudies || numberedItems) {
    finalBodyParagraphs = []
  }

  return {
    title: titleStr || null,
    intro_body: introBody,
    body_paragraphs: finalBodyParagraphs,
    numbered_items: numberedItems,
    case_study_items: caseStudies,
    has_intro: !!introBody,
    has_body: finalBodyParagraphs.length > 0,
    has_numbered: !!numberedItems,
    has_cases: !!caseStudies,
    total_paragraphs: paragraphs.length,
  }
}
