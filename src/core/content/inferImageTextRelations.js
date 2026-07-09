// Infer relationships between images and text blocks based on semantic matching.
// This enables grid-based layouts where related visuals and text are kept proximate.

const KEYWORD_GROUPS = {
  protest_case: [/카네기|시위|LGBTQ|프라이드|Pride|social movement|목소리|연대|activism/i],
  brand_case_dove: [/도브|Dove|NoDigitalDistortion|Turn Your Back|Bold Glamour|디지털 왜곡/i],
  brand_case_sweaty_betty: [/스웨티 베티|Sweaty Betty|Wear The Damn Shorts|반바지|스포츠/i],
  product_case: [/제품|패키지|월경|period|I bleed red|상품|디자인/i],
  mood_or_opener: [/메가트렌드|매크로트렌드|행동주의|의미|변화|반응|나타나/i],
}

function getTextBlockKeywords(text) {
  const keywords = []
  for (const [group, patterns] of Object.entries(KEYWORD_GROUPS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        keywords.push(group)
        break
      }
    }
  }
  return keywords
}

function computeConfidence(textKeywords, imageVisualType) {
  // Heuristic confidence: if keywords match image visual type
  let confidence = 0.3 // baseline

  if (textKeywords.includes('protest_case') && imageVisualType === 'crowd_or_protest') {
    confidence = 0.85
  } else if (textKeywords.includes('brand_case_dove') && imageVisualType === 'brand_campaign') {
    confidence = 0.80
  } else if (textKeywords.includes('product_case') && imageVisualType === 'product_or_package') {
    confidence = 0.80
  } else if (textKeywords.length > 0 && imageVisualType !== 'unknown') {
    confidence = 0.55
  }

  return confidence
}

export function inferImageTextRelations({
  textBlocks = [],
  imageAnalysis = [],
}) {
  if (textBlocks.length === 0 || imageAnalysis.length === 0) {
    return { inferred_image_text_relations: [] }
  }

  const relations = []

  // For each text block, find the best matching image
  textBlocks.forEach((textBlock) => {
    const textKeywords = getTextBlockKeywords(textBlock.text)
    if (textKeywords.length === 0) return // Skip blocks with no keywords

    // Find best matching image
    let bestMatch = null
    let bestConfidence = 0.3

    imageAnalysis.forEach((img) => {
      const confidence = computeConfidence(textKeywords, img.visual_type)
      if (confidence > bestConfidence) {
        bestConfidence = confidence
        bestMatch = img
      }
    })

    if (bestMatch && bestConfidence >= 0.5) {
      // Determine relation type
      let relationText = textKeywords[0] || 'weak_match'
      if (relationText === 'protest_case') {
        relationText = 'protest_case'
      } else if (relationText.includes('brand_case')) {
        relationText = 'brand_campaign_case'
      } else if (relationText === 'product_case') {
        relationText = 'product_case'
      }

      relations.push({
        text_block_id: textBlock.id,
        image_id: bestMatch.id,
        relation: relationText,
        confidence: bestConfidence,
        reason: `Text mentions ${textKeywords[0]} and image visual type is ${bestMatch.visual_type}.`,
      })
    }
  })

  return { inferred_image_text_relations: relations }
}
