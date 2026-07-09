// Spec section 7: Select the most suitable layout family (12 options) based on:
// - image count and aspect ratios
// - content structure (intro, body, cases, numbered items)
// - image-text relationships
// - user's grid mode (strict vs flexible)

export const LAYOUT_FAMILIES = [
  'macro_opener_split',               // Title + large opening spread
  'title_body_image_same_page',       // Title, body, image together
  'image_right_text_left',            // Image right, text left
  'image_left_text_right',            // Image left, text right
  'numbered_story_hero_support',      // 3 images, numbered items
  'case_study_cards_grid',            // 4 images, 4 case studies
  'cmf_stories_masonry',              // Many images, varied sizes
  'color_palette_with_images',        // Images showcase colors/patterns
  'gallery_page_text_page',           // Image gallery page + text page
  'long_text_column_flow',            // Long text flows in multi-column
  'image_text_interlock',             // Images and text interweave
  'distributed_images_across_pages',  // Images spread across multiple pages
]

export function selectLayoutFamily({
  imageCount,
  textDensity,          // 'short', 'medium', 'long'
  contentStructure,     // from parseContentStructure
  imageTextRelation,    // from mapImageTextRelations
  gridMode,             // 'strict' or 'flexible'
  hasTitle,
  outputUnit,           // 'single_page' or 'spread'
}) {
  const {
    has_intro: hasIntro,
    has_numbered: hasNumbered,
    has_cases: hasCases,
  } = contentStructure

  const { relation } = imageTextRelation

  // Title + intro + 1 strong image → macro opener or title_body_image_same_page
  if (hasTitle && hasIntro && imageCount === 1 && textDensity !== 'long') {
    if (outputUnit === 'spread') {
      return {
        family: 'macro_opener_split',
        reason: 'Title + intro + hero image = macro opener spread',
      }
    }
    return {
      family: 'title_body_image_same_page',
      reason: 'Title + image + body fit single page',
    }
  }

  // 4 images + 4 case studies
  if (imageCount === 4 && hasCases && relation === 'case_study_cards') {
    return {
      family: 'case_study_cards_grid',
      reason: '4 images + 4 case studies = card layout',
    }
  }

  // 3 images + 3 numbered items
  if (imageCount === 3 && hasNumbered && relation === 'numbered_image_text_pairs') {
    return {
      family: 'numbered_story_hero_support',
      reason: '3 images + 3 numbered items = hero/support layout',
    }
  }

  // Many images, short descriptions → masonry
  if (imageCount >= 5 && textDensity === 'short' && relation === 'gallery_with_related_text') {
    if (gridMode === 'flexible') {
      return {
        family: 'cmf_stories_masonry',
        reason: 'Many images + flexible mode = masonry layout',
      }
    }
    return {
      family: 'distributed_images_across_pages',
      reason: 'Many images + strict mode = distributed across pages',
    }
  }

  // Long text + few images → column flow or interlock
  if (textDensity === 'long' && imageCount <= 2) {
    if (gridMode === 'flexible') {
      return {
        family: 'image_text_interlock',
        reason: 'Long text + flexible = images interlock with text',
      }
    }
    return {
      family: 'long_text_column_flow',
      reason: 'Long text + strict = column flow with images',
    }
  }

  // 1 image + long text → mood image supports body
  if (imageCount === 1 && textDensity === 'long') {
    return {
      family: 'mood_image_supports_body',
      reason: '1 image mood-sets for long body text',
    }
  }

  // 1 image + short/medium text → left/right split
  if (imageCount === 1 && textDensity !== 'long') {
    if (gridMode === 'flexible') {
      return {
        family: 'image_left_text_right',
        reason: '1 image + text = left-right split (flexible)',
      }
    }
    return {
      family: 'image_right_text_left',
      reason: '1 image + text = left-right split (strict)',
    }
  }

  // 2-3 images + medium text → gallery with text
  if ((imageCount === 2 || imageCount === 3) && textDensity === 'medium') {
    if (outputUnit === 'spread') {
      return {
        family: 'gallery_page_text_page',
        reason: `${imageCount} images gallery + text page = spread`,
      }
    }
    return {
      family: 'image_text_interlock',
      reason: `${imageCount} images + medium text = interlock`,
    }
  }

  // 3+ images, general case → distributed or gallery
  if (imageCount >= 3) {
    if (outputUnit === 'spread') {
      return {
        family: 'gallery_page_text_page',
        reason: `${imageCount} images = gallery spread layout`,
      }
    }
    if (gridMode === 'flexible') {
      return {
        family: 'distributed_images_across_pages',
        reason: `${imageCount} images distributed across flexible grid`,
      }
    }
    return {
      family: 'gallery_page_text_page',
      reason: `${imageCount} images = gallery layout`,
    }
  }

  // Fallback
  return {
    family: 'title_body_image_same_page',
    reason: 'Default layout family',
  }
}
