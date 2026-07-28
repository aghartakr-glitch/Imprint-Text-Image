// Authoritative content-group model: which images and which paragraphs form one editorial unit.
//
// Added 2026-07-27 (gap analysis P0-1). Until now the layout plan treated images and text as
// independent boxes sharing a grid -- an image element had no field expressing which text it
// belonged to, and text only knew its own paragraph index. Grouping existed solely as advisory
// prose in the prompt, so nothing could enforce it and nothing downstream could reason about it.
//
// A content group is the unit the spec calls 콘텐츠 그룹: an image plus the heading/body/caption the
// user wrote for it. It is derived from FORMATTING ONLY (the blank-line boundaries the user
// authored, via group_id from parseMarkdownDocument), so it behaves identically for a novel, a
// catalogue, a report, or a magazine.
//
// This module is the single source of truth. Validation deliberately reads group membership from
// here rather than from a field in the LLM's output, so a plan cannot evade cohesion checks by
// omitting or mislabelling group_id.

function isBodyLikeRole(role) {
  return role === 'body' || role === 'continuation_body' || role === 'quote' || role === 'list_item'
}

// Stopwords/noise a filename commonly carries that would otherwise "match" almost any paragraph
// (uploader-added numbering prefixes like "2_2.", the original file extension, generic photo
// jargon). Kept short and Korean/English-neutral -- this is a hint mechanism, not a parser, so a
// missed stopword only costs a slightly weaker signal, never a wrong match (see the "unambiguous
// only" guard in hintImageGroupsFromFilenames below).
const FILENAME_STOPWORDS = new Set(['jpg', 'jpeg', 'png', 'webp', 'img', 'image', '사진', '이미지'])
const MIN_FILENAME_WORD_LENGTH = 2

// Splits a filename into the meaningful words a user would have typed to describe its content,
// discarding the upload-time numbering prefix (server/index.mjs writes "<timestamp>_<n>_<n>.
// <original name>.<ext>") and the extension, then breaking on anything that isn't a letter/digit
// in any script (so both "데사우_바우하우스_건물" and "Dessau Bauhaus Building" split into words).
function wordsFromFilename(filename) {
  if (!filename) return []
  const base = String(filename)
    .replace(/\.[a-zA-Z0-9]{2,5}$/, '') // drop extension
    .replace(/^\d+(_\d+){1,3}\.?/, '') // drop "<timestamp>_<n>_<n>." upload prefix, if present
  return base
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= MIN_FILENAME_WORD_LENGTH && !FILENAME_STOPWORDS.has(w))
}

// A+C from the 2026-07-28 briefing: filenames are a HINT layered on top of the existing
// document-order/length assignment, never a replacement for it. An image is pre-assigned to a
// group only when its filename words point at exactly one group unambiguously (a clear top score,
// no tie) -- anything uncertain is left for the existing algorithm below to place by position, so
// a user who didn't bother naming files (or named them generically) sees identical behavior to
// before this feature existed.
function hintImageGroupsFromFilenames(candidates, imageNames, imageCount) {
  const hints = new Map() // imageIndex (0-based) -> candidate group object
  if (!Array.isArray(imageNames) || imageNames.length === 0) return hints

  const groupTexts = candidates.map((g) => (g.text || '').toLowerCase())

  for (let i = 0; i < imageCount; i += 1) {
    const words = wordsFromFilename(imageNames[i])
    if (words.length === 0) continue

    const scores = candidates.map((_, gi) => words.filter((w) => groupTexts[gi].includes(w)).length)
    const maxScore = Math.max(...scores, 0)
    if (maxScore === 0) continue
    const topIndices = scores.reduce((acc, s, gi) => (s === maxScore ? [...acc, gi] : acc), [])
    if (topIndices.length !== 1) continue // ambiguous (tie) -- leave it to the positional algorithm

    hints.set(i, candidates[topIndices[0]])
  }
  return hints
}

/**
 * @param {object[]} textBlocks - blocks from parseDocumentStructure (carry group_id, role, char_count, text)
 * @param {number} imageCount - number of uploaded images
 * @param {string[]} [imageNames] - original filenames, index-aligned with image_1..image_N (optional hint signal)
 * @returns {{groups: object[], groupByTextSource: Map<string,number>, groupByImageId: Map<string,number>}}
 */
export function buildContentGroups({ textBlocks = [], imageCount = 0, imageNames = [] } = {}) {
  const blocks = Array.isArray(textBlocks) ? textBlocks : []

  // Collapse blocks into ordered groups keyed by the author's blank-line boundaries.
  const groups = []
  const indexByKey = new Map()
  blocks.forEach((block, index) => {
    const key = block.group_id != null ? `g${block.group_id}` : `b${index}`
    if (!indexByKey.has(key)) {
      indexByKey.set(key, groups.length)
      groups.push({
        group: groups.length,
        text_sources: [],
        images: [],
        char_count: 0,
        has_body: false,
        first_index: index,
        text: '',
      })
    }
    const group = groups[indexByKey.get(key)]
    group.text_sources.push(`paragraph_${index + 1}`)
    group.char_count += Number.isFinite(block.char_count) ? block.char_count : (block.text || '').length
    group.text += `${group.text ? ' ' : ''}${block.text || ''}`
    if (isBodyLikeRole(block.role)) group.has_body = true
  })

  // Distribute images across groups. Prefer groups that carry prose -- an image anchored to a lone
  // heading sits next to a label instead of the passage it illustrates. If the document is nothing
  // but headings, fall back to all groups so images are still placed.
  const anchorable = groups.filter((g) => g.has_body)
  const candidates = anchorable.length > 0 ? anchorable : groups

  if (candidates.length > 0 && imageCount > 0) {
    // Filename hint pass (2026-07-28): an image whose filename words unambiguously point at one
    // group is assigned to it directly. Everything else -- unnamed images, generic filenames,
    // ties -- falls through to the original document-order/length algorithm below completely
    // unchanged, so a document with no filename signal behaves exactly as before this feature.
    const hints = hintImageGroupsFromFilenames(candidates, imageNames, imageCount)
    const hintedImageIndices = new Set(hints.keys())
    hints.forEach((group, imageIndex) => group.images.push(`image_${imageIndex + 1}`))

    const remainingImageIndices = []
    for (let i = 0; i < imageCount; i += 1) {
      if (!hintedImageIndices.has(i)) remainingImageIndices.push(i)
    }
    // Every group gets its first image before any group gets a second: a group a hint already
    // served must not "cut in line" ahead of an unserved group in the one-per-group pass below,
    // so that pass only considers groups still at zero images. Hinted groups remain eligible for
    // the SURPLUS pass afterwards (a long section can legitimately hold more than one image),
    // using the full candidate list exactly like the original surplus logic always did.
    const unservedCandidates = candidates.filter((g) => g.images.length === 0)

    if (remainingImageIndices.length > 0 && unservedCandidates.length > 0) {
      if (remainingImageIndices.length >= unservedCandidates.length) {
        // One image per still-unserved group in document order, then surplus images to the
        // longest groups (considering every candidate, hinted or not).
        unservedCandidates.forEach((group, i) => group.images.push(`image_${remainingImageIndices[i] + 1}`))
        const byLength = [...candidates].sort((a, b) => b.char_count - a.char_count)
        for (let n = unservedCandidates.length; n < remainingImageIndices.length; n += 1) {
          byLength[(n - unservedCandidates.length) % byLength.length].images.push(`image_${remainingImageIndices[n] + 1}`)
        }
      } else {
        // Fewer remaining images than unserved groups: the longest unserved groups earn them,
        // assigned in document order so lower-numbered images appear before higher-numbered ones.
        const chosen = [...unservedCandidates]
          .sort((a, b) => (b.char_count - a.char_count) || (a.first_index - b.first_index))
          .slice(0, remainingImageIndices.length)
          .sort((a, b) => a.first_index - b.first_index)
        chosen.forEach((group, i) => group.images.push(`image_${remainingImageIndices[i] + 1}`))
      }
    }
  }

  const groupByTextSource = new Map()
  const groupByImageId = new Map()
  groups.forEach((group) => {
    group.text_sources.forEach((source) => groupByTextSource.set(source, group.group))
    group.images.forEach((imageId) => groupByImageId.set(imageId, group.group))
  })

  return { groups, groupByTextSource, groupByImageId }
}

// Compact form for the prompt: drops bookkeeping fields the model does not need to see, and omits
// groups with no image so the model is not told about relationships that do not exist.
export function summarizeContentGroupsForPrompt(groups) {
  return (groups || []).map((g) => ({
    group: g.group,
    text_sources: g.text_sources,
    ...(g.images.length > 0 ? { images: g.images } : {}),
  }))
}
