// Image analysis for editorial layout planning.
// Infers visual characteristics, likely role, and matching hints from image metadata.

export function analyzeImages({ imageMetadata = [] }) {
  if (!Array.isArray(imageMetadata) || imageMetadata.length === 0) {
    return { image_analysis: [] }
  }

  const image_analysis = imageMetadata.map((img, idx) => {
    const aspectRatio = img.aspectRatio || 1.0
    const orientation = aspectRatio > 1.2 ? 'landscape' : aspectRatio < 0.8 ? 'portrait' : 'square'

    // Heuristic visual type detection (in real app, would use ML/vision API)
    let visual_type = 'unknown'
    if (orientation === 'landscape' && aspectRatio > 1.5) {
      // Wide landscape often used for crowds, protests, broad scenes
      visual_type = 'crowd_or_protest'
    } else if (orientation === 'portrait') {
      visual_type = 'portrait_or_person'
    } else if (orientation === 'square') {
      // Square could be product, mood, installation
      visual_type = 'abstract_or_mood'
    }

    // Infer possible role based on image characteristics
    let possible_role = 'support_image'
    if (idx === 0) {
      possible_role = 'hero_image' // First image is often hero
    } else if (imageMetadata.length <= 2) {
      possible_role = 'mood_image'
    } else if (visual_type === 'crowd_or_protest') {
      possible_role = 'case_image'
    }

    return {
      id: img.id || `image_${idx + 1}`,
      orientation,
      aspect_ratio: aspectRatio,
      visual_type,
      possible_role,
      detected_keywords: [], // Would be populated by actual analysis
      filename_hints: img.filename ? [img.filename] : [],
      order_index: idx + 1,
    }
  })

  return { image_analysis }
}
