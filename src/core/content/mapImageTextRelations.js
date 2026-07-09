// Spec section 6: Map relationships between images and text blocks so layouts don't randomly
// separate related content. Understands patterns like "one hero image with intro text" or
// "4 images each paired with a case study description".

export const IMAGE_TEXT_RELATIONS = [
  'independent_images_body_text',  // Multiple unrelated images + body text
  'one_hero_image_with_intro',     // 1 strong image + short intro paragraph
  'numbered_image_text_pairs',     // 3 images + 3 numbered items, 1:1 mapping
  'case_study_cards',              // 4 images + 4 case study descriptions, 1:1 mapping
  'gallery_with_related_text',     // Many images + one related body text
  'mood_image_supports_body',      // 1-2 images mood-setting for longer body text
  'distributed_story_images',      // Multiple images spaced through long text
]

export function mapImageTextRelations({
  imageCount,
  contentStructure,
}) {
  const {
    has_intro: hasIntro,
    intro_body: introBody,
    has_body: hasBody,
    has_numbered: hasNumbered,
    has_cases: hasCases,
    numbered_items: numberedItems,
    case_study_items: caseStudyItems,
    body_paragraphs: bodyParagraphs,
  } = contentStructure

  // Case study cards: 4 images + 4 case study items
  if (imageCount === 4 && hasCases && caseStudyItems?.length === 4) {
    return {
      relation: 'case_study_cards',
      pairings: caseStudyItems.map((item, i) => ({
        image_index: i + 1,
        content_type: 'case_study_item',
        case_study_item: item,
      })),
      reasoning: '4 images matched with 4 case study descriptions for 1:1 layout',
    }
  }

  // Numbered story: 3 images + 3 numbered items
  if (imageCount === 3 && hasNumbered && numberedItems?.length === 3) {
    return {
      relation: 'numbered_image_text_pairs',
      pairings: numberedItems.map((item, i) => ({
        image_index: i + 1,
        content_type: 'numbered_item',
        numbered_item: item,
      })),
      reasoning: '3 images matched with 3 numbered items for 1:1 layout',
    }
  }

  // One hero image with intro
  if (imageCount === 1 && hasIntro && introBody) {
    return {
      relation: 'one_hero_image_with_intro',
      pairings: [{
        image_index: 1,
        content_type: 'intro_text',
        text: introBody,
      }],
      remaining_text: bodyParagraphs?.join('\n\n') || '',
      reasoning: '1 hero image paired with intro paragraph; body text separate',
    }
  }

  // Mood image supporting body
  if ((imageCount === 1 || imageCount === 2) && hasBody && !hasIntro && !hasNumbered && !hasCases) {
    return {
      relation: 'mood_image_supports_body',
      pairings: Array.from({ length: imageCount }, (_, i) => ({
        image_index: i + 1,
        content_type: 'mood_image',
      })),
      body_text: bodyParagraphs?.join('\n\n') || '',
      reasoning: `${imageCount} image(s) support longer body text; visual+textual narrative`,
    }
  }

  // Gallery with related text
  if (imageCount >= 3 && hasBody && !hasCases && !hasNumbered) {
    return {
      relation: 'gallery_with_related_text',
      pairings: Array.from({ length: imageCount }, (_, i) => ({
        image_index: i + 1,
        content_type: 'gallery_image',
      })),
      body_text: bodyParagraphs?.join('\n\n') || '',
      intro_text: introBody || null,
      reasoning: `${imageCount} images form a gallery; related by shared body narrative`,
    }
  }

  // Fallback: independent images + body text
  return {
    relation: 'independent_images_body_text',
    pairings: Array.from({ length: imageCount }, (_, i) => ({
      image_index: i + 1,
      content_type: 'independent_image',
    })),
    body_text: bodyParagraphs?.join('\n\n') || '',
    intro_text: introBody || null,
    reasoning: 'No direct image-text relationships detected; independent layout',
  }
}
