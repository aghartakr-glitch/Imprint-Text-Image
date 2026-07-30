import { gridToMm, gridToMmFullBleed } from './gridToMm.js'

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
    if (el.type === 'image') {
      const isFullBleed = el.bleed === 'full'
      const box = isFullBleed ? gridToMmFullBleed(gridSpec?.pageWidthMm, gridSpec?.pageHeightMm) : gridToMm(el, gridSpec)
      const match = /^image_(\d+)$/.exec(el.id || '')
      const idx = match ? Number(match[1]) - 1 : -1
      const path = imagePaths[idx]
      if (!path) {
        throw new Error(`이미지 요소 ${el.id}에 대응하는 업로드 이미지가 없습니다`)
      }
      images.push({
        path,
        ...box,
        fullBleed: isFullBleed,
        objectPosition: el.object_position || 'center',
        // Full-bleed pages are supposed to fill the physical page edge-to-edge -- that's what
        // "bleed: full" means in print. The LLM's own candidates set fit:"contain" on these
        // (never "cover"), and resolveGridPage previously dropped el.fit entirely, so every
        // full-bleed image rendered letterboxed (whichever dimension the image's own aspect ratio
        // happened to fill first), leaving visible white margins instead of a true bleed. Force
        // cover-crop for full-bleed regardless of what the plan says; non-full-bleed images keep
        // whatever fit the plan specified (default to the prior contain behavior).
        fit: isFullBleed ? 'cover' : (el.fit || 'contain'),
      })
    } else if (el.type === 'text') {
      const box = el.box_mm || gridToMm(el, gridSpec)
      // CRITICAL FIX: Process ALL text roles, not just 'body'.
      // This enables section_title, case_title_ko, case_body, overview, etc. to render.
      // Each text element is independent, allowing images and text to interleave.
      textBlocks.push({
        zone: box,
        slice: textSlicesByElementId[el.id] ?? null,
        // render_role carries a finer typographic role than the plan's own vocabulary allows. The
        // plan's `role` must stay inside the six validated values, but a credit/caption line needs
        // credit styling, not body styling -- so the layout stage sets render_role and the plan
        // keeps a legal role for validation.
        role: el.render_role || el.role,
        id: el.id,
        text_source: el.text_source,
        group_id: el.group_id,
        flow_group_id: el.flow_group_id,
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
