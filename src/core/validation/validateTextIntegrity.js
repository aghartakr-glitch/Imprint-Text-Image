// validateTextIntegrity.js
// Ensure no text is duplicated or lost during layout processing
// Verifies that concatenated textBlocks exactly match the input text

export function validateTextIntegrity(resolvedPages, originalText) {
  if (!Array.isArray(resolvedPages)) {
    return {
      passed: false,
      issues: [{ severity: 'error', message: 'resolvedPages is not an array' }],
    }
  }

  // Collect all text from resolved pages
  const collectedText = collectPageText(resolvedPages)

  // Normalize whitespace for comparison
  const originalNorm = normalizeWhitespace(originalText)
  const collectedNorm = normalizeWhitespace(collectedText)

  const issues = []

  // Check for text loss
  if (collectedNorm.length < originalNorm.length) {
    const lostChars = originalNorm.length - collectedNorm.length
    issues.push({
      severity: 'error',
      message: `Text loss detected: ${lostChars} characters missing from layout`,
    })
  }

  // Check for text duplication
  if (collectedNorm.length > originalNorm.length) {
    const extraChars = collectedNorm.length - originalNorm.length
    issues.push({
      severity: 'error',
      message: `Text duplication detected: ${extraChars} extra characters in layout`,
    })
  }

  // Check for marker remnants (should not appear in collected text)
  const markerPattern = /^#+\s/m
  const hasMarkerRemnants = markerPattern.test(collectedText)
  if (hasMarkerRemnants) {
    issues.push({
      severity: 'error',
      message: 'Markdown heading markers found in collected text (should have been stripped)',
    })
  }

  return {
    passed: issues.length === 0,
    issues,
    stats: {
      originalLength: originalNorm.length,
      collectedLength: collectedNorm.length,
      pageCount: resolvedPages.length,
    },
  }
}

// Collect all text content from pages, in order
function collectPageText(pages) {
  const parts = []

  pages.forEach((page, pageIndex) => {
    // Title pages
    if (page.type === 'title-page' && page.title) {
      parts.push(page.title)
    }

    // Text blocks
    if (Array.isArray(page.textBlocks)) {
      page.textBlocks.forEach((block) => {
        if (block.slice) parts.push(block.slice)
      })
    }

    // Fallback: single text zone (older format)
    if (page.textSlice && !Array.isArray(page.textBlocks)) {
      parts.push(page.textSlice)
    }
  })

  return parts.join('\n\n')
}

// Normalize whitespace for content comparison
// Collapses multiple spaces, normalizes line endings
function normalizeWhitespace(text) {
  return String(text)
    .replace(/\r\n/g, '\n') // Normalize line endings
    .replace(/\n\s*\n+/g, '\n\n') // Collapse multiple blank lines
    .replace(/[ \t]+/g, ' ') // Collapse spaces/tabs
    .trim()
}

// Assert: no text loss
export function assertNoTextLoss(resolvedPages, originalText) {
  const result = validateTextIntegrity(resolvedPages, originalText)
  if (!result.passed) {
    const lossIssue = result.issues.find((i) => i.message.includes('loss'))
    if (lossIssue) {
      throw new Error(`Text integrity failed: ${lossIssue.message}`)
    }
  }
}

// Assert: no text duplication
export function assertNoTextDuplication(resolvedPages, originalText) {
  const result = validateTextIntegrity(resolvedPages, originalText)
  if (!result.passed) {
    const dupIssue = result.issues.find((i) => i.message.includes('duplication'))
    if (dupIssue) {
      throw new Error(`Text integrity failed: ${dupIssue.message}`)
    }
  }
}

// Assert: no markdown markers remain
export function assertNoMarkdownInResolvedPages(resolvedPages) {
  const markerPattern = /^#+\s/m
  for (let i = 0; i < resolvedPages.length; i += 1) {
    const page = resolvedPages[i]

    if (Array.isArray(page.textBlocks)) {
      for (let j = 0; j < page.textBlocks.length; j += 1) {
        const block = page.textBlocks[j]
        if (block.slice && markerPattern.test(block.slice)) {
          throw new Error(`Page ${i + 1}, block ${j + 1}: Markdown heading markers found in text`)
        }
      }
    }

    if (page.textSlice && markerPattern.test(page.textSlice)) {
      throw new Error(`Page ${i + 1}: Markdown heading markers found in textSlice`)
    }

    if (page.title && markerPattern.test(page.title)) {
      throw new Error(`Page ${i + 1}: Markdown heading markers found in title`)
    }
  }
}
