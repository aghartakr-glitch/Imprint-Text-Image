import { TEXT_IMAGE_MIN_GAP_MM, TEXT_TEXT_MIN_GAP_MM, IMAGE_IMAGE_MIN_GAP_MM } from "../layoutConstants.js"

const CONTENT_WIDTH_MM = 116
const CONTENT_HEIGHT_MM = 176

function rectsOverlap(r1, r2) {
  return (
    r1.x < r2.x + r2.w &&
    r1.x + r1.w > r2.x &&
    r1.y < r2.y + r2.h &&
    r1.y + r1.h > r2.y
  )
}

function getGap(r1, r2) {
  let hGap = Infinity
  let vGap = Infinity

  if (r1.x > r2.x + r2.w) hGap = r1.x - (r2.x + r2.w)
  else if (r2.x > r1.x + r1.w) hGap = r2.x - (r1.x + r1.w)

  if (r1.y > r2.y + r2.h) vGap = r1.y - (r2.y + r2.h)
  else if (r2.y > r1.y + r1.h) vGap = r2.y - (r1.y + r1.h)

  return Math.min(hGap, vGap)
}

export function validateResolvedLayout(resolvedPages) {
  const issues = []

  if (!Array.isArray(resolvedPages)) {
    issues.push({
      type: 'invalid_input',
      message: 'resolvedPages is not an array'
    })
    return { passed: false, issues }
  }

  resolvedPages.forEach((page, pageIdx) => {
    // Check images for valid dimensions and bounds
    if (Array.isArray(page.images)) {
      page.images.forEach((img, imgIdx) => {
        const elementId = img.id || `image_${imgIdx + 1}`

        // Check for invalid dimensions
        if (!Number.isFinite(img.xMm) || !Number.isFinite(img.yMm) || !Number.isFinite(img.wMm) || !Number.isFinite(img.hMm)) {
          issues.push({
            type: 'invalid_dimension',
            page: pageIdx + 1,
            element_id: elementId,
            box: { xMm: img.xMm, yMm: img.yMm, wMm: img.wMm, hMm: img.hMm },
            message: `Image has NaN dimensions`
          })
        }

        // Check bounds
        if (img.xMm + img.wMm > CONTENT_WIDTH_MM) {
          issues.push({
            type: 'out_of_bounds',
            page: pageIdx + 1,
            element_id: elementId,
            box: { xMm: img.xMm, yMm: img.yMm, wMm: img.wMm, hMm: img.hMm },
            message: `Image exceeds right boundary (x+w=${img.xMm + img.wMm} > ${CONTENT_WIDTH_MM})`
          })
        }

        if (img.yMm + img.hMm > CONTENT_HEIGHT_MM) {
          issues.push({
            type: 'out_of_bounds',
            page: pageIdx + 1,
            element_id: elementId,
            box: { xMm: img.xMm, yMm: img.yMm, wMm: img.wMm, hMm: img.hMm },
            message: `Image exceeds bottom boundary (y+h=${img.yMm + img.hMm} > ${CONTENT_HEIGHT_MM})`
          })
        }
      })
    }

    // Check text blocks for valid dimensions and bounds
    if (Array.isArray(page.textBlocks)) {
      page.textBlocks.forEach((tb, tbIdx) => {
        if (!tb.zone) return

        const elementId = tb.id || `text_${tbIdx + 1}`
        const { xMm, yMm, wMm, hMm } = tb.zone

        // Check for invalid dimensions
        if (!Number.isFinite(xMm) || !Number.isFinite(yMm) || !Number.isFinite(wMm) || !Number.isFinite(hMm)) {
          issues.push({
            type: 'invalid_dimension',
            page: pageIdx + 1,
            element_id: elementId,
            box: { xMm, yMm, wMm, hMm },
            message: `TextBlock has NaN dimensions`
          })
        }

        // Check bounds
        if (xMm + wMm > CONTENT_WIDTH_MM) {
          issues.push({
            type: 'out_of_bounds',
            page: pageIdx + 1,
            element_id: elementId,
            box: { xMm, yMm, wMm, hMm },
            message: `TextBlock exceeds right boundary (x+w=${xMm + wMm} > ${CONTENT_WIDTH_MM})`
          })
        }

        if (yMm + hMm > CONTENT_HEIGHT_MM) {
          issues.push({
            type: 'out_of_bounds',
            page: pageIdx + 1,
            element_id: elementId,
            box: { xMm, yMm, wMm, hMm },
            message: `TextBlock exceeds bottom boundary (y+h=${yMm + hMm} > ${CONTENT_HEIGHT_MM})`
          })
        }
      })

      // Check text-image overlaps
      if (Array.isArray(page.images)) {
        page.images.forEach((img, imgIdx) => {
          const imgBox = { x: img.xMm, y: img.yMm, w: img.wMm, h: img.hMm }
          const imgId = img.id || `image_${imgIdx + 1}`

          page.textBlocks.forEach((tb, tbIdx) => {
            if (!tb.zone) return

            const textBox = { x: tb.zone.xMm, y: tb.zone.yMm, w: tb.zone.wMm, h: tb.zone.hMm }
            const textId = tb.id || `text_${tbIdx + 1}`

            if (rectsOverlap(textBox, imgBox)) {
              issues.push({
                type: 'text_image_overlap',
                page: pageIdx + 1,
                element_id: textId,
                other_element_id: imgId,
                box: textBox,
                message: `Text block overlaps image`
              })
            } else {
              const gap = getGap(textBox, imgBox)
              if (gap >= 0 && gap < TEXT_IMAGE_MIN_GAP_MM) {
                issues.push({
                  type: 'text_image_insufficient_gap',
                  page: pageIdx + 1,
                  element_id: textId,
                  other_element_id: imgId,
                  box: textBox,
                  message: `Insufficient gap between text and image: ${gap.toFixed(2)}mm < ${TEXT_IMAGE_MIN_GAP_MM}mm`
                })
              }
            }
          })
        })
      }

      // Check text-text overlaps
      for (let i = 0; i < page.textBlocks.length; i += 1) {
        if (!page.textBlocks[i].zone) continue

        for (let j = i + 1; j < page.textBlocks.length; j += 1) {
          if (!page.textBlocks[j].zone) continue

          const box1 = {
            x: page.textBlocks[i].zone.xMm,
            y: page.textBlocks[i].zone.yMm,
            w: page.textBlocks[i].zone.wMm,
            h: page.textBlocks[i].zone.hMm
          }
          const box2 = {
            x: page.textBlocks[j].zone.xMm,
            y: page.textBlocks[j].zone.yMm,
            w: page.textBlocks[j].zone.wMm,
            h: page.textBlocks[j].zone.hMm
          }

          const id1 = page.textBlocks[i].id || `text_${i + 1}`
          const id2 = page.textBlocks[j].id || `text_${j + 1}`

          if (rectsOverlap(box1, box2)) {
            issues.push({
              type: 'text_text_overlap',
              page: pageIdx + 1,
              element_id: id1,
              other_element_id: id2,
              box: box1,
              message: `Text blocks overlap`
            })
          } else {
            const gap = getGap(box1, box2)
            if (gap >= 0 && gap < TEXT_TEXT_MIN_GAP_MM) {
              issues.push({
                type: 'text_text_insufficient_gap',
                page: pageIdx + 1,
                element_id: id1,
                other_element_id: id2,
                box: box1,
                message: `Insufficient gap between text blocks: ${gap.toFixed(2)}mm < ${TEXT_TEXT_MIN_GAP_MM}mm`
              })
            }
          }
        }
      }
    }

    // Check the singular textZone/textSlice shape (e.g. title-page and single-body-block pages,
    // resolved via resolveGridPage's `textZone: textBlocks[0]?.zone`). This shape carries no
    // `textBlocks` array, so the checks above never run on it -- it needs its own dimension/bounds
    // check or a broken box here sails through undetected (confirmed 2026-07-10: a real generation
    // produced textZone boxes with undefined xMm/yMm that reached buildMainTex as literal NaN
    // coordinates in main.tex, because nothing validated this page shape at all).
    if (page.textZone && !Array.isArray(page.textBlocks)) {
      const elementId = 'textZone'
      const { xMm, yMm, wMm, hMm } = page.textZone

      if (!Number.isFinite(xMm) || !Number.isFinite(yMm) || !Number.isFinite(wMm) || !Number.isFinite(hMm)) {
        issues.push({
          type: 'invalid_dimension',
          page: pageIdx + 1,
          element_id: elementId,
          box: { xMm, yMm, wMm, hMm },
          message: `textZone has NaN dimensions`
        })
      } else {
        if (xMm + wMm > CONTENT_WIDTH_MM) {
          issues.push({
            type: 'out_of_bounds',
            page: pageIdx + 1,
            element_id: elementId,
            box: { xMm, yMm, wMm, hMm },
            message: `textZone exceeds right boundary (x+w=${xMm + wMm} > ${CONTENT_WIDTH_MM})`
          })
        }
        if (yMm + hMm > CONTENT_HEIGHT_MM) {
          issues.push({
            type: 'out_of_bounds',
            page: pageIdx + 1,
            element_id: elementId,
            box: { xMm, yMm, wMm, hMm },
            message: `textZone exceeds bottom boundary (y+h=${yMm + hMm} > ${CONTENT_HEIGHT_MM})`
          })
        }
      }
    }

    // Check image-image overlaps
    if (Array.isArray(page.images)) {
      for (let i = 0; i < page.images.length; i += 1) {
        for (let j = i + 1; j < page.images.length; j += 1) {
          const img1 = { x: page.images[i].xMm, y: page.images[i].yMm, w: page.images[i].wMm, h: page.images[i].hMm }
          const img2 = { x: page.images[j].xMm, y: page.images[j].yMm, w: page.images[j].wMm, h: page.images[j].hMm }

          const id1 = page.images[i].id || `image_${i + 1}`
          const id2 = page.images[j].id || `image_${j + 1}`

          if (rectsOverlap(img1, img2)) {
            issues.push({
              type: 'image_image_overlap',
              page: pageIdx + 1,
              element_id: id1,
              other_element_id: id2,
              box: img1,
              message: `Images overlap`
            })
          } else {
            const gap = getGap(img1, img2)
            if (gap >= 0 && gap < IMAGE_IMAGE_MIN_GAP_MM) {
              issues.push({
                type: 'image_image_insufficient_gap',
                page: pageIdx + 1,
                element_id: id1,
                other_element_id: id2,
                box: img1,
                message: `Insufficient gap between images: ${gap.toFixed(2)}mm < ${IMAGE_IMAGE_MIN_GAP_MM}mm`
              })
            }
          }
        }
      }
    }
  })

  // Only severity: 'error' issues (out_of_bounds, overlaps, invalid_dimension)
  const errorIssues = issues.filter(i =>
    ['out_of_bounds', 'text_text_overlap', 'text_image_overlap', 'image_image_overlap', 'invalid_dimension'].includes(i.type)
  )

  return {
    passed: errorIssues.length === 0,
    issues,
    error_issues: errorIssues
  }
}

export function assertResolvedPagesInsideBounds(resolvedPages) {
  const issues = []

  resolvedPages.forEach((page, pageIdx) => {
    if (Array.isArray(page.images)) {
      page.images.forEach((img, imgIdx) => {
        if (img.xMm + img.wMm > CONTENT_WIDTH_MM) {
          issues.push(`Page ${pageIdx + 1}, image ${imgIdx}: exceeds right boundary`)
        }
        if (img.yMm + img.hMm > CONTENT_HEIGHT_MM) {
          issues.push(`Page ${pageIdx + 1}, image ${imgIdx}: exceeds bottom boundary`)
        }
      })
    }

    if (Array.isArray(page.textBlocks)) {
      page.textBlocks.forEach((block, blockIdx) => {
        if (!block.zone) return
        if (block.zone.xMm + block.zone.wMm > CONTENT_WIDTH_MM) {
          issues.push(`Page ${pageIdx + 1}, text block ${blockIdx}: exceeds right boundary`)
        }
        if (block.zone.yMm + block.zone.hMm > CONTENT_HEIGHT_MM) {
          issues.push(`Page ${pageIdx + 1}, text block ${blockIdx}: exceeds bottom boundary`)
        }
      })
    }

    if (page.textZone && !Array.isArray(page.textBlocks)) {
      if (page.textZone.xMm + page.textZone.wMm > CONTENT_WIDTH_MM) {
        issues.push(`Page ${pageIdx + 1}, textZone: exceeds right boundary`)
      }
      if (page.textZone.yMm + page.textZone.hMm > CONTENT_HEIGHT_MM) {
        issues.push(`Page ${pageIdx + 1}, textZone: exceeds bottom boundary`)
      }
    }
  })

  return issues
}
