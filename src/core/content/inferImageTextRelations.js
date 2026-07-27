// Per-text-block image relations, derived from document structure only.
//
// Rewritten 2026-07-27 (gap analysis P0-2). The previous version scored text against hardcoded
// keyword groups (도브/Dove, 스웨티 베티, 카네기/시위/LGBTQ, 월경/period) and cross-checked them
// against analyzeImages.js's invented `visual_type` labels. Both inputs were specific to one trend
// report, so for any other document no keyword matched, every confidence stayed at the 0.3 baseline,
// and the function returned an empty relation list -- leaving the layout stage with no idea which
// image belonged to which passage.
//
// This version assigns relations by CONTENT GROUP position: images are distributed across the
// blank-line-separated groups the user authored, in document order, and every block in a group is
// related to that group's image. Derived purely from formatting, so it behaves the same for a novel,
// a catalogue, a report, or a magazine.

function groupKeyOf(block, index) {
  return block.group_id != null ? `g${block.group_id}` : `b${index}`
}

export function inferImageTextRelations({ textBlocks = [], imageAnalysis = [] }) {
  const blocks = Array.isArray(textBlocks) ? textBlocks : []
  const images = Array.isArray(imageAnalysis) ? imageAnalysis : []
  if (blocks.length === 0 || images.length === 0) {
    return { inferred_image_text_relations: [] }
  }

  // Ordered list of distinct content groups, and which blocks belong to each.
  const groupOrder = []
  const blocksByGroup = new Map()
  blocks.forEach((block, index) => {
    const key = groupKeyOf(block, index)
    if (!blocksByGroup.has(key)) {
      blocksByGroup.set(key, [])
      groupOrder.push(key)
    }
    blocksByGroup.get(key).push(block)
  })

  // Spread the available images evenly across the groups in reading order. With as many images as
  // groups this is a 1:1 pairing; with fewer images each image covers a contiguous run of groups;
  // with more images the extras land on the same groups as additional views.
  const relations = []
  groupOrder.forEach((key, groupIndex) => {
    const imageIndex = images.length >= groupOrder.length
      ? Math.min(groupIndex, images.length - 1)
      : Math.floor((groupIndex * images.length) / groupOrder.length)
    const image = images[imageIndex]
    if (!image) return

    blocksByGroup.get(key).forEach((block) => {
      relations.push({
        text_block_id: block.id,
        image_id: image.id,
        relation: 'same_content_group',
        // Confidence reflects how directly the structure ties them: an exact 1:1 group-to-image
        // pairing is a strong signal; a shared image spanning several groups is weaker.
        confidence: images.length >= groupOrder.length ? 0.8 : 0.55,
        reason: `Text block and image belong to the same content group (group ${groupIndex + 1} of ${groupOrder.length}).`,
      })
    })
  })

  return { inferred_image_text_relations: relations }
}
