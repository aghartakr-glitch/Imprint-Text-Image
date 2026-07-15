// Deterministic, API-free collision repair: no LLM retry, just geometry. For every text/text,
// text/image, or image/image pair validateCollisions flags as overlapping, shift the element that
// starts lower straight down until the pair clears the required mm gap. Never touches column
// position (col_start/col_span) -- that's an editorial decision the LLM made, not something repair
// should second-guess. When there isn't room left on the page to shift the trailing element down
// far enough, it is moved onto the next page (existing or newly created) at row_start=1 instead of
// being silently overflowed, clipped, or left colliding.
import { validateCollisions } from './validateCollisions.js'

const MAX_PASSES = 8
const REPAIR_ROW_GAP = 1 // extra empty grid row left below the anchor after a repair shift
const REPAIR_COL_GAP = 1 // extra empty grid column left beside the anchor after a horizontal shift

function getGridColumns(plan) {
  return plan.grid_spec?.columns ?? plan.grid?.columns ?? 6
}

function getGridRows(plan) {
  return plan.grid_spec?.rows ?? plan.grid?.rows ?? 12
}

function renumberPages(pages) {
  pages.forEach((page, i) => { page.page = i + 1 })
}

// Attempt to move a text element horizontally to avoid collision with an image. Tries right
// first (image's right edge + gap), then left (image's left edge - text width - gap). Returns
// {success: true/false, direction: 'left'|'right'|null} so caller can log the action.
function tryHorizontalShift(mover, anchor, columns) {
  if (mover.type !== 'text' || anchor.type !== 'image') return { success: false }

  // Try right: place text at (image.col_start + image.col_span + gap)
  const rightStart = anchor.col_start + anchor.col_span + REPAIR_COL_GAP
  if (rightStart + mover.col_span - 1 <= columns) {
    mover.col_start = rightStart
    return { success: true, direction: 'right' }
  }

  // Try left: place text at (image.col_start - mover.col_span - gap)
  const leftEnd = anchor.col_start - REPAIR_COL_GAP - 1
  const leftStart = leftEnd - mover.col_span + 1
  if (leftStart >= 1) {
    mover.col_start = leftStart
    return { success: true, direction: 'left' }
  }

  return { success: false }
}

// Attempt to move a text element horizontally to avoid collision with another text element.
// Tries to place mover to the right of anchor first, then to the left.
function tryTextTextHorizontalShift(mover, anchor, columns) {
  if (mover.type !== 'text' || anchor.type !== 'text') return { success: false }

  // Try right: place text to the right of anchor (anchor.col_start + anchor.col_span + gap)
  const rightStart = anchor.col_start + anchor.col_span + REPAIR_COL_GAP
  if (rightStart + mover.col_span - 1 <= columns) {
    mover.col_start = rightStart
    return { success: true, direction: 'right' }
  }

  // Try left: place text to the left of anchor (anchor.col_start - mover.col_span - gap)
  const leftEnd = anchor.col_start - REPAIR_COL_GAP - 1
  const leftStart = leftEnd - mover.col_span + 1
  if (leftStart >= 1) {
    mover.col_start = leftStart
    return { success: true, direction: 'left' }
  }

  return { success: false }
}

function moveToNextPage(pages, pageIndex, element) {
  const currentPage = pages[pageIndex]
  currentPage.elements = currentPage.elements.filter((el) => el !== element)

  let nextPage = pages[pageIndex + 1]
  if (!nextPage) {
    nextPage = { page: currentPage.page + 1, elements: [] }
    pages.splice(pageIndex + 1, 0, nextPage)
  }
  nextPage.elements.push({ ...element, row_start: 1 })
  renumberPages(pages)
}

export function repairCollisions(plan, { maxPasses = MAX_PASSES } = {}) {
  if (!plan || !Array.isArray(plan.pages)) return { plan, repaired: false, actions: [] }

  const rows = getGridRows(plan)
  const columns = getGridColumns(plan)
  const workingPlan = JSON.parse(JSON.stringify(plan))
  const actions = []
  let anyRepaired = false

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const { issues } = validateCollisions(workingPlan, { useExpandedBbox: true })
    const overlaps = issues.filter((i) => i.severity === 'error' && i.type?.startsWith('expanded_bbox_overlap'))
    if (overlaps.length === 0) break

    let changed = false
    for (const issue of overlaps) {
      const pageIndex = workingPlan.pages.findIndex((p) => p.page === issue.page)
      if (pageIndex === -1) continue
      const page = workingPlan.pages[pageIndex]
      const elA = page.elements.find((el) => el.id === issue.element_a)
      const elB = page.elements.find((el) => el.id === issue.element_b)
      if (!elA || !elB) continue

      // Special handling for text-image and text-text collisions: try horizontal shift first
      // (move one element left or right) before falling back to vertical shift. This avoids
      // awkward downward cascades where elements get pushed to the next page when they could
      // fit side-by-side.
      const isTextImageCollision = (elA.type === 'text' && elB.type === 'image') || (elA.type === 'image' && elB.type === 'text')
      const isTextTextCollision = elA.type === 'text' && elB.type === 'text'

      if (isTextImageCollision) {
        const [anchor, mover] = elA.type === 'image' ? [elA, elB] : [elB, elA]
        const hShift = tryHorizontalShift(mover, anchor, columns)
        if (hShift.success) {
          changed = true
          anyRepaired = true
          actions.push({
            page: issue.page,
            element: mover.id,
            moved_to_col_start: mover.col_start,
            reason: `${anchor.id}와의 충돌 해소를 위해 ${hShift.direction === 'right' ? '오른쪽' : '왼쪽'}으로 이동`,
          })
          continue // skip vertical shift; next pass will revalidate
        }
      } else if (isTextTextCollision) {
        // For text-text: try to shift the trailing element (lower row_start) horizontally first.
        // Keep the leading element's position, only move the one that comes later.
        const [anchor, mover] = elA.row_start <= elB.row_start ? [elA, elB] : [elB, elA]
        const hShift = tryTextTextHorizontalShift(mover, anchor, columns)
        if (hShift.success) {
          changed = true
          anyRepaired = true
          actions.push({
            page: issue.page,
            element: mover.id,
            moved_to_col_start: mover.col_start,
            reason: `${anchor.id}와의 충돌 해소를 위해 ${hShift.direction === 'right' ? '오른쪽' : '왼쪽'}으로 이동`,
          })
          continue // skip vertical shift; next pass will revalidate
        }
      }

      // Fallback: vertical shift (down or to next page). Keep the "earlier" element (higher row_start)
      // anchored, and only move the trailing one.
      const [anchor, mover] = elA.row_start <= elB.row_start ? [elA, elB] : [elB, elA]
      const newRowStart = anchor.row_start + anchor.row_span - 1 + REPAIR_ROW_GAP + 1
      if (newRowStart <= mover.row_start) continue // would not actually move it further down

      if (newRowStart + mover.row_span - 1 <= rows) {
        mover.row_start = newRowStart
        changed = true
        anyRepaired = true
        actions.push({
          page: issue.page, element: mover.id, moved_to_row_start: newRowStart, reason: `${anchor.id}와의 충돌 해소를 위해 아래로 이동`,
        })
      } else {
        moveToNextPage(workingPlan.pages, pageIndex, mover)
        changed = true
        anyRepaired = true
        actions.push({
          page: issue.page, element: mover.id, reason: `${anchor.id}와의 충돌 해소를 위해 다음 페이지로 이동 (같은 페이지에 공간 부족)`,
        })
        break // page indices/numbers just shifted -- restart with a fresh validateCollisions pass
      }
    }
    if (!changed) break
  }

  return { plan: workingPlan, repaired: anyRepaired, actions }
}
