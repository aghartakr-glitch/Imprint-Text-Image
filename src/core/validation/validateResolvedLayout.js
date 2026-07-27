import {
  TEXT_IMAGE_MIN_GAP_MM, TEXT_TEXT_MIN_GAP_MM, IMAGE_IMAGE_MIN_GAP_MM,
  TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM,
} from "../layoutConstants.js"

// Previously hardcoded duplicates (116/176) of TEXT_BOX_WIDTH_MM/TEXT_BOX_HEIGHT_MM -- when
// MARGIN_BOTTOM_MM changed from 18mm to 16mm (equalizing it with MARGIN_TOP_MM), the real content
// height became 178mm but this file's own copy stayed at the old 176mm, so every generation with a
// text box using the newly-available extra 2mm failed with a false "exceeds bottom boundary" error
// (confirmed 2026-07-27: "TextBlock exceeds bottom boundary (y+h=177.8 > 176)"). Import the single
// source of truth instead of duplicating it, so this can't drift again.
const CONTENT_WIDTH_MM = TEXT_BOX_WIDTH_MM
const CONTENT_HEIGHT_MM = TEXT_BOX_HEIGHT_MM

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

function normalizedTextForDuplicateCheck(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function isBodyRole(role) {
  return (role || 'body') === 'body' || role === 'continuation_body'
}

export function validateResolvedLayout(resolvedPages) {
  const issues = []
  const textSourcePlacements = new Map()

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

        // Full-bleed images are supposed to exceed the margin-constrained content box (they span
        // the literal physical page) -- checking them against CONTENT_WIDTH/HEIGHT_MM here would
        // always fail by design, so they're exempt from this bounds check.
        if (!img.fullBleed) {
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
        }
      })
    }

    // Check text blocks for valid dimensions and bounds
    if (Array.isArray(page.textBlocks)) {
      page.textBlocks.forEach((tb, tbIdx) => {
        if (!tb.zone) return

        const elementId = tb.id || `text_${tbIdx + 1}`
        const { xMm, yMm, wMm, hMm } = tb.zone

        if (tb.text_source) {
          if (!textSourcePlacements.has(tb.text_source)) textSourcePlacements.set(tb.text_source, [])
          textSourcePlacements.get(tb.text_source).push({
            page: pageIdx + 1,
            elementId,
            role: tb.role,
            slice: normalizedTextForDuplicateCheck(tb.slice),
          })
        }

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

      // Check text-image overlaps (full-bleed images are exempt -- by contract they're the only
      // element on their page, so there's no text to compare against)
      if (Array.isArray(page.images)) {
        page.images.filter((img) => !img.fullBleed).forEach((img, imgIdx) => {
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

    // Check image-image overlaps (full-bleed images are exempt -- by contract they're the only
    // image on their page)
    if (Array.isArray(page.images)) {
      const nonBleedImages = page.images.filter((img) => !img.fullBleed)
      for (let i = 0; i < nonBleedImages.length; i += 1) {
        for (let j = i + 1; j < nonBleedImages.length; j += 1) {
          const img1 = { x: nonBleedImages[i].xMm, y: nonBleedImages[i].yMm, w: nonBleedImages[i].wMm, h: nonBleedImages[i].hMm }
          const img2 = { x: nonBleedImages[j].xMm, y: nonBleedImages[j].yMm, w: nonBleedImages[j].wMm, h: nonBleedImages[j].hMm }

          const id1 = nonBleedImages[i].id || `image_${i + 1}`
          const id2 = nonBleedImages[j].id || `image_${j + 1}`

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

  textSourcePlacements.forEach((placements, source) => {
    if (placements.length <= 1) return
    const bodyLike = placements.every((p) => isBodyRole(p.role))
    if (!bodyLike) {
      issues.push({
        type: 'duplicate_text_source',
        page: placements[1].page,
        element_id: placements[1].elementId,
        other_element_id: placements[0].elementId,
        message: `resolved duplicated heading/label text_source ${source}`,
      })
      return
    }

    const nonEmptySlices = placements.map((p) => p.slice).filter(Boolean)
    const uniqueSlices = new Set(nonEmptySlices)
    if (placements.length > 2 || uniqueSlices.size < nonEmptySlices.length) {
      issues.push({
        type: 'duplicate_text_source',
        page: placements[1].page,
        element_id: placements[1].elementId,
        other_element_id: placements[0].elementId,
        message: `resolved duplicated body text_source ${source}`,
      })
    }
  })

  // Only severity: 'error' issues (out_of_bounds, overlaps, invalid_dimension)
  const errorIssues = issues.filter(i =>
    ['out_of_bounds', 'text_text_overlap', 'text_image_overlap', 'image_image_overlap', 'invalid_dimension', 'duplicate_text_source'].includes(i.type)
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
      // Full-bleed images are supposed to exceed the margin-constrained content box (they span the
      // literal physical page by design) -- exempt them here too, matching validateResolvedLayout's
      // bounds check above (confirmed 2026-07-27: enabling full-bleed frequency/forced full-bleed
      // made every generation with a full-bleed image fail this final assertion, since this
      // function never got the same fullBleed exemption).
      page.images.filter((img) => !img.fullBleed).forEach((img, imgIdx) => {
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
