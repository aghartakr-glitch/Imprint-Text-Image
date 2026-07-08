import { gridToMm } from './gridToMm.js'

// Converts one already-validated layout_plan page's elements (grid units) + the text already
// assigned to its body box into the resolvedPage shape buildLatex.js already knows how to
// render: { images: [...], textZone, textSlice }. If a page has more than one body-role text
// element, only the first is rendered (every fallback/expected LLM plan uses exactly one).
export function resolveGridPage(elements, imagePaths, textSlicesByElementId = {}) {
  const images = []
  let textZone = null
  let textSlice = null

  elements.forEach((el) => {
    const box = gridToMm(el)
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
    } else if (el.type === 'text' && el.role === 'body' && textZone == null) {
      textZone = box
      textSlice = textSlicesByElementId[el.id] ?? null
    }
  })

  return {
    type: 'layout-plan-page', images, textZone, textSlice,
  }
}
