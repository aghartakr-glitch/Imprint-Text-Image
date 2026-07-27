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

/**
 * @param {object[]} textBlocks - blocks from parseDocumentStructure (carry group_id, role, char_count)
 * @param {number} imageCount - number of uploaded images
 * @returns {{groups: object[], groupByTextSource: Map<string,number>, groupByImageId: Map<string,number>}}
 */
export function buildContentGroups({ textBlocks = [], imageCount = 0 } = {}) {
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
      })
    }
    const group = groups[indexByKey.get(key)]
    group.text_sources.push(`paragraph_${index + 1}`)
    group.char_count += Number.isFinite(block.char_count) ? block.char_count : (block.text || '').length
    if (isBodyLikeRole(block.role)) group.has_body = true
  })

  // Distribute images across groups. Prefer groups that carry prose -- an image anchored to a lone
  // heading sits next to a label instead of the passage it illustrates. If the document is nothing
  // but headings, fall back to all groups so images are still placed.
  const anchorable = groups.filter((g) => g.has_body)
  const candidates = anchorable.length > 0 ? anchorable : groups

  if (candidates.length > 0 && imageCount > 0) {
    if (imageCount >= candidates.length) {
      // One image per group in document order, then surplus images to the longest groups.
      candidates.forEach((group, i) => group.images.push(`image_${i + 1}`))
      const byLength = [...candidates].sort((a, b) => b.char_count - a.char_count)
      for (let n = candidates.length; n < imageCount; n += 1) {
        byLength[(n - candidates.length) % byLength.length].images.push(`image_${n + 1}`)
      }
    } else {
      // Fewer images than groups: the longest groups earn them, assigned in document order so
      // image_1 appears before image_2 in the finished document.
      const chosen = [...candidates]
        .sort((a, b) => (b.char_count - a.char_count) || (a.first_index - b.first_index))
        .slice(0, imageCount)
        .sort((a, b) => a.first_index - b.first_index)
      chosen.forEach((group, i) => group.images.push(`image_${i + 1}`))
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
