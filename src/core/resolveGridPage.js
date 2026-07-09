import { gridToMm } from './gridToMm.js'

// Converts one already-validated layout_plan page's elements (grid units) + the text already
// assigned to its body box into the resolvedPage shape buildLatex.js already knows how to
// render: { images: [...], textZone, textSlice }. If a page has more than one body-role text
// element, only the first is rendered (every fallback/expected LLM plan uses exactly one).
// gridSpec (columns/rows/gutterMm/boxWidthMm/boxHeightMm) is optional and forwarded to gridToMm
// as-is -- omitted, gridToMm falls back to its own defaults (the fixed 6x12 A5 grid), preserving
// every existing caller. When given (grid-based fallback plans with a variable column count), it
// makes each element's mm box reflect the user's actual chosen grid instead of the fixed one.
export function resolveGridPage(elements, imagePaths, textSlicesByElementId = {}, gridSpec) {
  const images = []
  const textBlocks = []

  elements.forEach((el) => {
    const box = gridToMm(el, gridSpec)
    if (el.type === 'image') {
      const match = /^image_(\d+)$/.exec(el.id || '')
      const idx = match ? Number(match[1]) - 1 : -1
      const path = imagePaths[idx]
      if (!path) {
        throw new Error(`이미지 요소 ${el.id}에 대응하는 업로드 이미지가 없습니다`)
      }
      images.push({
        path, ...box, fullBleed: false, objectPosition: el.object_position || 'center',
      })
    } else if (el.type === 'text') {
      // CRITICAL FIX: Process ALL text roles, not just 'body'.
      // This enables section_title, case_title_ko, case_body, overview, etc. to render.
      // Each text element is independent, allowing images and text to interleave.
      textBlocks.push({
        zone: box,
        slice: textSlicesByElementId[el.id] ?? null,
        role: el.role,  // ← Pass role for LaTeX styling
        id: el.id,
        text_source: el.text_source,
      })
    }
  })

  return {
    type: 'layout-plan-page',
    images,
    textZone: textBlocks[0]?.zone ?? null,
    textSlice: textBlocks[0]?.slice ?? null,
    textBlocks,
  }
}
