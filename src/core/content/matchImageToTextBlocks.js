// Pairs images with text blocks using document STRUCTURE only -- never content meaning.
//
// Rewritten 2026-07-27 (gap analysis P0-2b). The previous implementation paired images only with
// blocks whose role was 'brand_case' / 'protest_case' / 'intro_definition' / 'trend_context' /
// 'audience_value' -- roles that only ever existed for one specific trend report, assigned by
// keyword matching on brand names. For every other document those filters returned empty arrays, so
// this function returned ZERO image-text pairs. That is the direct root cause of the reported
// symptom "images and text never form a natural relationship": nothing downstream had any signal
// about which image belonged with which text, so the LLM placed images and text as independent
// boxes on a grid.
//
// The replacement pairs by CONTENT GROUP -- the blank-line-separated clusters the user authored
// (group_id from parseMarkdownDocument). A content group is exactly the editorial unit an image
// belongs to (heading + body, or artwork info + caption), and it is derived from formatting, so it
// works identically for a novel, an exhibition catalogue, a report, or a magazine.

// A group worth anchoring an image to must carry actual prose, not just a bare heading -- pairing an
// image with a lone section title would put the image next to a label instead of the passage it
// illustrates.
function isBodyLikeRole(role) {
  return role === 'body' || role === 'continuation_body' || role === 'quote' || role === 'list_item'
}

// Collapses text blocks into ordered content groups. Falls back to treating each block as its own
// group when group_id is absent, so callers that pass legacy block arrays still get sane pairing.
function buildContentGroups(textBlocks) {
  const groups = []
  const byId = new Map()

  textBlocks.forEach((block, index) => {
    const key = block.group_id != null ? `g${block.group_id}` : `b${index}`
    if (!byId.has(key)) {
      const group = {
        key, blockIds: [], firstIndex: index, charCount: 0, hasBody: false,
      }
      byId.set(key, group)
      groups.push(group)
    }
    const group = byId.get(key)
    group.blockIds.push(block.id)
    group.charCount += Number.isFinite(block.char_count) ? block.char_count : (block.text || '').length
    if (isBodyLikeRole(block.role)) group.hasBody = true
  })

  return groups
}

export function matchImageToTextBlocks({ imageCount, textBlocks }) {
  const blocks = Array.isArray(textBlocks) ? textBlocks : []
  if (blocks.length === 0 || !imageCount || imageCount <= 0) {
    return {
      image_text_pairs: [],
      hero_image: null,
      unmatched_images: imageCount || 0,
      unmatched_text_blocks: blocks.map((b) => b.id),
    }
  }

  const allGroups = buildContentGroups(blocks)
  // Prefer groups carrying prose; if the document is nothing but headings, fall back to all groups
  // rather than returning no pairs at all.
  const anchorGroups = allGroups.filter((g) => g.hasBody)
  const candidates = anchorGroups.length > 0 ? anchorGroups : allGroups

  const pairs = []
  const usedBlockIds = new Set()

  if (imageCount >= candidates.length) {
    // At least one image per group: distribute in document order, then hand any surplus images to
    // the longest groups (most prose = most room to sit an extra image beside).
    candidates.forEach((group, i) => {
      pairs.push({
        image_id: `image_${i + 1}`,
        text_block_ids: [...group.blockIds],
        group_key: group.key,
        relation: 'illustrates_content_group',
      })
      group.blockIds.forEach((id) => usedBlockIds.add(id))
    })

    const surplusOrder = [...candidates]
      .map((group, i) => ({ group, i }))
      .sort((a, b) => b.group.charCount - a.group.charCount)

    for (let n = candidates.length; n < imageCount; n += 1) {
      const target = surplusOrder[(n - candidates.length) % surplusOrder.length]
      pairs.push({
        image_id: `image_${n + 1}`,
        text_block_ids: [...target.group.blockIds],
        group_key: target.group.key,
        relation: 'additional_view_of_content_group',
      })
    }
  } else {
    // Fewer images than groups: give them to the longest groups (an image earns its place next to
    // the passage that needs it most), but emit the pairs back in document order so downstream
    // consumers see image_1 before image_2.
    const chosen = [...candidates]
      .sort((a, b) => (b.charCount - a.charCount) || (a.firstIndex - b.firstIndex))
      .slice(0, imageCount)
      .sort((a, b) => a.firstIndex - b.firstIndex)

    chosen.forEach((group, i) => {
      pairs.push({
        image_id: `image_${i + 1}`,
        text_block_ids: [...group.blockIds],
        group_key: group.key,
        relation: 'illustrates_content_group',
      })
      group.blockIds.forEach((id) => usedBlockIds.add(id))
    })
  }

  // The hero is the first image, reported separately because layout-family selection treats "is
  // there a lead image" as a distinct signal. It stays paired with its group above -- this is a
  // label on an existing pair, not an extra image taken out of circulation.
  const heroPair = pairs[0] || null

  return {
    image_text_pairs: pairs,
    hero_image: heroPair
      ? {
        image_id: heroPair.image_id,
        text_block_ids: heroPair.text_block_ids,
        relation: 'leads_content_group',
      }
      : null,
    unmatched_images: Math.max(0, imageCount - pairs.length),
    unmatched_text_blocks: blocks.filter((b) => !usedBlockIds.has(b.id)).map((b) => b.id),
  }
}
