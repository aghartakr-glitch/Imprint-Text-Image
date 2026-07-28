// repairResolvedLayout.js
// Repairs invalid resolved mm-coordinates before final validation
// Handles: out-of-bounds, overlaps, invalid dimensions

import { TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM } from '../layoutConstants.js'

// Previously hardcoded (116/176) instead of importing -- see validateResolvedLayout.js's identical
// fix for why a hardcoded duplicate of these values silently drifts out of sync with real margin
// changes (confirmed 2026-07-27: MARGIN_BOTTOM_MM 18mm->16mm changed the real content height to
// 178mm while this file's copy stayed at 176mm).
const DEFAULT_CONTENT_WIDTH_MM = TEXT_BOX_WIDTH_MM
const DEFAULT_CONTENT_HEIGHT_MM = TEXT_BOX_HEIGHT_MM

export function repairResolvedLayout({
  resolvedPages,
  contentWidthMm = DEFAULT_CONTENT_WIDTH_MM,
  contentHeightMm = DEFAULT_CONTENT_HEIGHT_MM,
  minTextImageGapMm = 4,
  minTextTextGapMm = 3,
  minImageImageGapMm = 3,
}) {
  if (!Array.isArray(resolvedPages)) {
    return {
      pages: [],
      actions: [],
      unresolvedIssues: ['resolvedPages is not an array']
    }
  }

  const repairedPages = []
  const actions = []
  const unresolvedIssues = []
  const continuationPages = []

  function moveTextBlockToContinuationPage(tb, fromPage, reason) {
    if (!tb.zone) return
    if (tb.zone.wMm > contentWidthMm || tb.zone.hMm > contentHeightMm) {
      unresolvedIssues.push(`Page ${fromPage}: textBlock ${tb.id || 'textblock'} is too large for a continuation page (w=${tb.zone.wMm.toFixed(1)}, h=${tb.zone.hMm.toFixed(1)})`)
      return
    }

    const moved = {
      ...tb,
      zone: {
        ...tb.zone,
        xMm: 0,
        yMm: 0,
      },
    }
    continuationPages.push({
      type: 'layout-plan-page',
      images: [],
      textZone: moved.zone,
      textSlice: moved.slice ?? null,
      textBlocks: [moved],
    })
    actions.push({
      type: 'move_textblock_to_continuation_page',
      page: fromPage,
      element_id: tb.id || 'textblock',
      from: { xMm: tb.zone.xMm, yMm: tb.zone.yMm },
      to: { xMm: 0, yMm: 0, page: 'new-continuation' },
      reason,
    })
  }

  resolvedPages.forEach((page, pageIdx) => {
    const repairedPage = {
      ...page,
      images: page.images ? [...page.images] : [],
      textBlocks: page.textBlocks ? page.textBlocks.map(tb => ({ ...tb, zone: { ...tb.zone } })) : []
    }

    // Phase A: Fix invalid numbers
    repairedPage.images = repairedPage.images.filter((img) => {
      if (!Number.isFinite(img.xMm) || !Number.isFinite(img.yMm) || !Number.isFinite(img.wMm) || !Number.isFinite(img.hMm)) {
        unresolvedIssues.push(`Page ${pageIdx + 1}: image has NaN dimensions`)
        return false
      }
      if (img.wMm <= 0 || img.hMm <= 0) {
        unresolvedIssues.push(`Page ${pageIdx + 1}: image has zero/negative dimensions`)
        return false
      }
      return true
    })

    repairedPage.textBlocks = repairedPage.textBlocks.filter((tb) => {
      if (!tb.zone) return true
      if (!Number.isFinite(tb.zone.xMm) || !Number.isFinite(tb.zone.yMm) || !Number.isFinite(tb.zone.wMm) || !Number.isFinite(tb.zone.hMm)) {
        unresolvedIssues.push(`Page ${pageIdx + 1}: textBlock has NaN dimensions`)
        return false
      }
      if (tb.zone.wMm <= 0 || tb.zone.hMm <= 0) {
        unresolvedIssues.push(`Page ${pageIdx + 1}: textBlock has zero/negative dimensions`)
        return false
      }
      return true
    })

    // Phase B: Clamp out-of-bounds elements (full-bleed images are intentionally outside the
    // content box -- spanning the literal physical page -- so clamping them back in would undo
    // the whole point of bleed:"full")
    repairedPage.images.forEach((img) => {
      if (img.fullBleed) return
      const originalX = img.xMm
      const originalY = img.yMm

      // Clamp to content area
      img.xMm = Math.max(0, Math.min(img.xMm, contentWidthMm - img.wMm))
      img.yMm = Math.max(0, Math.min(img.yMm, contentHeightMm - img.hMm))

      if (originalX !== img.xMm || originalY !== img.yMm) {
        actions.push({
          type: 'clamp_image',
          page: pageIdx + 1,
          element_id: img.id || 'image',
          from: { xMm: originalX, yMm: originalY },
          to: { xMm: img.xMm, yMm: img.yMm }
        })
      }
    })

    repairedPage.textBlocks.forEach((tb) => {
      if (!tb.zone) return

      const originalX = tb.zone.xMm
      const originalY = tb.zone.yMm

      // Clamp to content area
      tb.zone.xMm = Math.max(0, Math.min(tb.zone.xMm, contentWidthMm - tb.zone.wMm))
      tb.zone.yMm = Math.max(0, Math.min(tb.zone.yMm, contentHeightMm - tb.zone.hMm))

      if (originalX !== tb.zone.xMm || originalY !== tb.zone.yMm) {
        actions.push({
          type: 'clamp_textblock',
          page: pageIdx + 1,
          element_id: tb.id || 'textblock',
          from: { xMm: originalX, yMm: originalY },
          to: { xMm: tb.zone.xMm, yMm: tb.zone.yMm }
        })
      }
    })

    // Handle the singular textZone/textSlice shape (title-page-like pages with no textBlocks
    // array). Position-only NaN (wMm/hMm are real numbers but xMm/yMm are not) is safely repaired
    // by placing the zone at the content origin -- these pages carry a single zone with nothing
    // else on the page to collide with. If the size itself is NaN there is nothing safe to guess,
    // so it's left unresolved rather than fabricating a box (the caller's validation will then
    // reject the candidate rather than silently rendering broken geometry).
    if (repairedPage.textZone && !Array.isArray(page.textBlocks)) {
      const zone = { ...repairedPage.textZone }
      const sizeValid = Number.isFinite(zone.wMm) && Number.isFinite(zone.hMm) && zone.wMm > 0 && zone.hMm > 0
      const positionValid = Number.isFinite(zone.xMm) && Number.isFinite(zone.yMm)

      if (!sizeValid) {
        unresolvedIssues.push(`Page ${pageIdx + 1}: textZone has invalid size (wMm=${zone.wMm}, hMm=${zone.hMm})`)
      } else if (!positionValid) {
        const from = { xMm: zone.xMm, yMm: zone.yMm }
        zone.xMm = 0
        zone.yMm = 0
        repairedPage.textZone = zone
        actions.push({
          type: 'reposition_textzone',
          page: pageIdx + 1,
          element_id: 'textZone',
          from,
          to: { xMm: 0, yMm: 0 }
        })
      }
    }

    // Phase C: resolve all overlaps (image-image, text-image, text-text) by repositioning elements
    // in order. First reposition images (push down if they overlap earlier images), then text
    // blocks (push down below images + other text). If an element can't fit below without exceeding
    // page height, it's reported as unresolved rather than silently overlapping.
    const fixedBoxes = []

    // Step 1: Reposition images to resolve image-image overlaps (full-bleed images are exempt --
    // by contract they're the only image on their page, and shouldn't be nudged or used as a
    // collision reference for anything else)
    repairedPage.images.forEach((img, imgIdx) => {
      if (img.fullBleed) return
      const overlapping = fixedBoxes.filter((box) => boxesOverlap(
        { xMm: img.xMm, yMm: img.yMm, wMm: img.wMm, hMm: img.hMm },
        box
      ))

      if (overlapping.length > 0) {
        const originalY = img.yMm
        const newY = Math.max(...overlapping.map((box) => box.yMm + box.hMm)) + minImageImageGapMm
        if (newY + img.hMm > contentHeightMm) {
          unresolvedIssues.push(`Page ${pageIdx + 1}: image ${img.id || `image_${imgIdx + 1}`} cannot fit below other images within page height`)
        } else {
          img.yMm = newY
          actions.push({
            type: 'push_down_image',
            page: pageIdx + 1,
            element_id: img.id || `image_${imgIdx + 1}`,
            from: { xMm: img.xMm, yMm: originalY },
            to: { xMm: img.xMm, yMm: newY },
          })
        }
      }

      fixedBoxes.push({
        xMm: img.xMm, yMm: img.yMm, wMm: img.wMm, hMm: img.hMm, isImage: true,
      })
    })

    // Step 2: Reposition text blocks to resolve text-image and text-text overlaps

    const keptTextBlocks = []

    repairedPage.textBlocks.forEach((tb) => {
      if (!tb.zone) return

      const requiredGapAgainst = (otherIsImage) => (otherIsImage ? minTextImageGapMm : minTextTextGapMm)

      // A caption is deliberately pinned as an overlay chip on its own image's corner (see the
      // matching exemption in validateResolvedLayout.js) -- it's meant to overlap that image, so
      // only its overlap against OTHER text blocks is a real collision worth repairing. Without
      // this, the block below pushed the caption off the image and straight into the next flow
      // text block instead (confirmed 2026-07-28 from a real generation failure).
      const candidateBoxes = tb.role === 'caption'
        ? fixedBoxes.filter((box) => !box.isImage)
        : fixedBoxes

      // Find every already-placed box (images + earlier text blocks) this block currently overlaps.
      const overlapping = candidateBoxes.filter((other) => boxesOverlap(tb.zone, other))

      if (overlapping.length === 0) {
        fixedBoxes.push({
          xMm: tb.zone.xMm, yMm: tb.zone.yMm, wMm: tb.zone.wMm, hMm: tb.zone.hMm,
        })
        keptTextBlocks.push(tb)
        return
      }

      const originalY = tb.zone.yMm
      // Push below the lowest bottom edge among everything it overlaps, using the largest of the
      // gap requirements that apply (text-image 4mm vs text-text 3mm).
      const requiredGap = Math.max(...overlapping.map((box) => requiredGapAgainst(Boolean(box.isImage))))
      const newY = Math.max(...overlapping.map((box) => box.yMm + box.hMm)) + requiredGap

      if (newY + tb.zone.hMm > contentHeightMm) {
        moveTextBlockToContinuationPage(
          tb,
          pageIdx + 1,
          `Cannot push below overlaps within page height (would need y=${newY.toFixed(1)}, h=${tb.zone.hMm.toFixed(1)})`,
        )
        return
      } else {
        tb.zone.yMm = newY
        actions.push({
          type: 'push_down_textblock',
          page: pageIdx + 1,
          element_id: tb.id || 'textblock',
          from: { xMm: tb.zone.xMm, yMm: originalY },
          to: { xMm: tb.zone.xMm, yMm: newY },
        })
      }

      fixedBoxes.push({
        xMm: tb.zone.xMm, yMm: tb.zone.yMm, wMm: tb.zone.wMm, hMm: tb.zone.hMm,
      })
      keptTextBlocks.push(tb)
    })

    repairedPage.textBlocks = keptTextBlocks

    repairedPages.push(repairedPage)
  })

  const pagesBeforeEmptyRemoval = [...repairedPages, ...continuationPages]
  const pages = pagesBeforeEmptyRemoval.filter((page, index) => {
    if (hasRenderableContent(page)) return true
    actions.push({
      type: 'remove_empty_page',
      page: index + 1,
      reason: 'page has no images, text blocks, or textSlice',
    })
    return false
  })

  return {
    pages,
    actions,
    unresolvedIssues
  }
}

function hasRenderableContent(page) {
  const hasImages = Array.isArray(page.images) && page.images.length > 0
  const hasTextBlocks = Array.isArray(page.textBlocks) && page.textBlocks.some((tb) => tb && (tb.slice || tb.zone))
  const hasTextSlice = typeof page.textSlice === 'string' && page.textSlice.trim().length > 0
  return hasImages || hasTextBlocks || hasTextSlice
}

function boxesOverlap(a, b) {
  return (
    a.xMm < b.xMm + b.wMm &&
    a.xMm + a.wMm > b.xMm &&
    a.yMm < b.yMm + b.hMm &&
    a.yMm + a.hMm > b.yMm
  )
}
