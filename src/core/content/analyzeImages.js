// Image analysis for editorial layout planning.
//
// Rewritten 2026-07-27 (gap analysis P0-2c). The previous version inferred SUBJECT MATTER from
// aspect ratio alone -- a landscape image wider than 1.5 was labelled 'crowd_or_protest', a portrait
// became 'portrait_or_person', a square became 'abstract_or_mood'. Those labels were then handed to
// the LLM as if they described the picture. For anything but the one trend report they were simply
// wrong: an exhibition catalogue's wide artwork shot and a product catalogue's wide packshot were
// both announced to the model as protest photography.
//
// Nothing here can actually see the image, so this module now reports only what the file genuinely
// tells us -- proportions and order -- and stops guessing content. Placement decisions that used to
// key off the invented visual_type come from the image's content group instead (see
// matchImageToTextBlocks.js).

// Shape affects layout (a tall image cannot fill a wide slot without heavy cropping), so orientation
// is retained -- it is measured, not inferred.
function orientationOf(aspectRatio) {
  if (aspectRatio > 1.2) return 'landscape'
  if (aspectRatio < 0.8) return 'portrait'
  return 'square'
}

// How far from square, used downstream to judge how much a slot's proportions may deviate before the
// image has to be cropped hard. Purely geometric.
function extremityOf(aspectRatio) {
  const ratio = aspectRatio >= 1 ? aspectRatio : 1 / aspectRatio
  if (ratio >= 2.2) return 'extreme'
  if (ratio >= 1.5) return 'strong'
  return 'moderate'
}

export function analyzeImages({ imageMetadata = [] }) {
  if (!Array.isArray(imageMetadata) || imageMetadata.length === 0) {
    return { image_analysis: [] }
  }

  const image_analysis = imageMetadata.map((img, idx) => {
    const aspectRatio = img.aspectRatio || 1.0

    return {
      id: img.id || `image_${idx + 1}`,
      orientation: orientationOf(aspectRatio),
      aspect_ratio: aspectRatio,
      shape_extremity: extremityOf(aspectRatio),
      // Position in the user's upload order -- the only ordering signal that actually exists. A
      // caller may choose to treat the first image as the lead image, but that is a layout
      // convention applied downstream, not a claim about what the image depicts.
      order_index: idx + 1,
      filename_hints: img.filename ? [img.filename] : [],
    }
  })

  return { image_analysis }
}
