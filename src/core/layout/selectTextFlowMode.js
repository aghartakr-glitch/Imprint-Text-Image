// Spec: Determine text flow mode based on content structure, image count, and block composition

export const TEXT_FLOW_MODES = [
  'continuous_flow',   // Long essay without clear image-text pairing
  'modular_blocks',    // Case studies, separate blocks with images
  'hybrid_flow',       // Mixed: opener + images + modular content + column flow
]

export function selectTextFlowMode({
  textBlockCount,
  imageCount,
  hasCaseLikeBlocks,
  hasHeroImage,
  gridMode,
  textDensity,
}) {
  // If no modular structure, default to continuous flow
  if (!hasCaseLikeBlocks && textBlockCount <= 2) {
    return {
      mode: 'continuous_flow',
      reason: 'Few paragraphs, no case structure',
    }
  }

  // Modular blocks: case/protest paragraphs + images
  if (hasCaseLikeBlocks && imageCount >= textBlockCount - 2) {
    return {
      mode: 'modular_blocks',
      reason: 'Case-like blocks matched with images 1:1',
    }
  }

  // Hybrid: intro + hero + cases + remaining text in columns
  if (
    hasCaseLikeBlocks
    && imageCount >= 2
    && textBlockCount >= 3
    && hasHeroImage
  ) {
    return {
      mode: 'hybrid_flow',
      reason: 'Hero opener + case blocks + column flow for remaining text',
    }
  }

  // Flexible grid allows hybrid more easily
  if (gridMode === 'flexible' && textBlockCount >= 3 && imageCount >= 2) {
    return {
      mode: 'hybrid_flow',
      reason: 'Flexible grid with multiple blocks and images',
    }
  }

  // Long text with few images → continuous
  if (textDensity === 'long' && imageCount <= 2) {
    return {
      mode: 'continuous_flow',
      reason: 'Long text with limited image support',
    }
  }

  // Default to hybrid if medium complexity
  if (textBlockCount >= 3 && imageCount >= 2) {
    return {
      mode: 'hybrid_flow',
      reason: 'Multiple blocks and images → hybrid default',
    }
  }

  return {
    mode: 'continuous_flow',
    reason: 'Default flow mode',
  }
}
