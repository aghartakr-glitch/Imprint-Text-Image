// server/debugDump.mjs
// Pure instrumentation: writes intermediate pipeline state to debug/*.json so a real failure can
// be diagnosed from actual captured data instead of guessing from the final output. No behavior
// change to the generation pipeline itself -- every function here only reads and writes files.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.mjs'

const DEBUG_DIR = join(ROOT, 'debug')

export function writeDebugStage(filename, data) {
  if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true })
  writeFileSync(join(DEBUG_DIR, filename), JSON.stringify(data, null, 2), 'utf-8')
}

// Counts for a raw/normalized LLM layout_plan (plan.pages[].elements[], grid-unit shape).
export function summarizePlan(plan, stage) {
  const pages = plan?.pages || []
  const imageIds = []
  const textIds = []
  pages.forEach((p) => {
    (p.elements || []).forEach((el) => {
      if (el.type === 'image') imageIds.push(el.id)
      if (el.type === 'text') textIds.push(el.id)
    })
  })
  return {
    stage, page_count: pages.length, image_count: imageIds.length, text_block_count: textIds.length, image_ids: imageIds, text_block_ids: textIds,
  }
}

// Counts for a resolvedPages array (page.images[], page.textBlocks[] or page.textZone/textSlice, mm shape).
export function summarizeResolvedPages(resolvedPages, stage) {
  const pages = resolvedPages || []
  const imageIds = []
  const textIds = []
  pages.forEach((p) => {
    (p.images || []).forEach((img, i) => imageIds.push(img.id || `image_${i + 1}`))
    if (Array.isArray(p.textBlocks)) {
      p.textBlocks.forEach((tb, i) => textIds.push(tb.id || `text_${i + 1}`))
    } else if (p.textZone) {
      textIds.push('textZone')
    }
  })
  return {
    stage, page_count: pages.length, image_count: imageIds.length, text_block_count: textIds.length, image_ids: imageIds, text_block_ids: textIds,
  }
}

// Flat coordinate table (page, type, id, x, y, w, h, right, bottom) for a resolvedPages array.
export function coordinateTable(resolvedPages) {
  const rows = []
  ;(resolvedPages || []).forEach((page, pageIdx) => {
    (page.images || []).forEach((img, i) => {
      rows.push({
        page: pageIdx + 1, type: 'image', id: img.id || `image_${i + 1}`, x: img.xMm, y: img.yMm, w: img.wMm, h: img.hMm, right: img.xMm + img.wMm, bottom: img.yMm + img.hMm,
      })
    })
    if (Array.isArray(page.textBlocks)) {
      page.textBlocks.forEach((tb, i) => {
        if (!tb.zone) return
        rows.push({
          page: pageIdx + 1, type: 'text', id: tb.id || `text_${i + 1}`, x: tb.zone.xMm, y: tb.zone.yMm, w: tb.zone.wMm, h: tb.zone.hMm, right: tb.zone.xMm + tb.zone.wMm, bottom: tb.zone.yMm + tb.zone.hMm,
        })
      })
    } else if (page.textZone) {
      rows.push({
        page: pageIdx + 1, type: 'text', id: 'textZone', x: page.textZone.xMm, y: page.textZone.yMm, w: page.textZone.wMm, h: page.textZone.hMm, right: page.textZone.xMm + page.textZone.wMm, bottom: page.textZone.yMm + page.textZone.hMm,
      })
    }
  })
  return rows
}

// Numeric overlap proof (width/height/area) for every same-page pair in a coordinate table.
export function overlapReport(coordTable) {
  const overlaps = []
  for (let i = 0; i < coordTable.length; i += 1) {
    for (let j = i + 1; j < coordTable.length; j += 1) {
      const a = coordTable[i]
      const b = coordTable[j]
      if (a.page !== b.page) continue
      const overlapWidth = Math.min(a.right, b.right) - Math.max(a.x, b.x)
      const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y)
      if (overlapWidth > 0 && overlapHeight > 0) {
        overlaps.push({
          page: a.page, element_a: a.id, element_b: b.id, overlap_width_mm: overlapWidth, overlap_height_mm: overlapHeight, overlap_area_mm2: overlapWidth * overlapHeight,
        })
      }
    }
  }
  return overlaps
}
