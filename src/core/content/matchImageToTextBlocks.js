// Spec: Match images to text blocks based on semantic content roles and count

export function matchImageToTextBlocks({ imageCount, textBlocks }) {
  if (!textBlocks || textBlocks.length === 0 || imageCount === 0) {
    return {
      image_text_pairs: [],
      hero_image: null,
      unmatched_images: imageCount,
      unmatched_text_blocks: textBlocks?.map((b) => b.id) || [],
    }
  }

  // Extract case and protest paragraphs
  const caseBlocks = textBlocks.filter((b) => b.role === 'brand_case')
  const protestBlocks = textBlocks.filter((b) => b.role === 'protest_case')
  const introBlocks = textBlocks.filter((b) =>
    ['intro_definition', 'trend_context', 'audience_value'].includes(b.role)
  )

  const imagePairs = []
  const usedTextBlockIds = new Set()
  let heroImageId = null
  let heroTextBlockIds = []

  // Strategy 1: Match case paragraphs with images (one-to-one)
  const caseImagesToUse = Math.min(caseBlocks.length, imageCount)
  for (let i = 0; i < caseImagesToUse; i++) {
    imagePairs.push({
      image_id: `image_${i + 1}`,
      text_block_ids: [caseBlocks[i].id],
      relation: `brand_campaign_case_${caseBlocks[i].brand || 'generic'}`,
    })
    usedTextBlockIds.add(caseBlocks[i].id)
  }

  // Strategy 2: Match protest paragraphs with remaining images
  const protestImagesToUse = Math.min(
    protestBlocks.length,
    imageCount - caseImagesToUse
  )
  for (let i = 0; i < protestImagesToUse; i++) {
    const imageIndex = caseImagesToUse + i + 1
    imagePairs.push({
      image_id: `image_${imageIndex}`,
      text_block_ids: [protestBlocks[i].id],
      relation: 'protest_case',
    })
    usedTextBlockIds.add(protestBlocks[i].id)
  }

  // Strategy 3: Set up hero image with intro blocks
  const heroImageIndex = caseImagesToUse + protestImagesToUse + 1
  if (heroImageIndex <= imageCount) {
    heroImageId = `image_${heroImageIndex}`
    heroTextBlockIds = introBlocks.map((b) => b.id)
    introBlocks.forEach((b) => usedTextBlockIds.add(b.id))
  }

  // Unmatched text blocks
  const unmatchedBlockIds = textBlocks
    .filter((b) => !usedTextBlockIds.has(b.id))
    .map((b) => b.id)

  return {
    image_text_pairs: imagePairs,
    hero_image: heroImageId ? {
      image_id: heroImageId,
      text_block_ids: heroTextBlockIds,
      relation: 'macro_opener',
    } : null,
    unmatched_images: Math.max(0, imageCount - imagePairs.length - (heroImageId ? 1 : 0)),
    unmatched_text_blocks: unmatchedBlockIds,
  }
}
