import { paginateGridPlan } from './paginateGridPlan.js'
import { resolveGridPage } from './resolveGridPage.js'
import { TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM, resolvePageGeometry } from './layoutConstants.js'
import { stripMarkdownHeadingMarkers } from './text/parseMarkdownDocument.js'

// Spec section 9.2: converts an already-validated grid layout_plan into the actual page
// structure -- mm boxes, real image files assigned to image slots, body text distributed across
// text slots (with continuation pages for overflow), and an optional title-page prepended. This
// is *not* the final refined/LaTeX-ready object yet (see refineLayout.js for that step).
// The deterministic column-flow fallback (buildGridFallbackPlan) pre-slices body text directly
// onto each element as literal `el.text`. Real LLM candidates never do this -- they reference
// paragraphs indirectly via `el.text_source` (e.g. "paragraph_2") and expect paginateGridPlan to
// resolve that against the actual textBlocks. buildLayoutPrompt.js requires every LLM candidate to
// also include grid_spec/reserved_regions/text_flow for documentation purposes, so grid_spec
// presence alone can no longer distinguish the two shapes (confirmed 2026-07-09: a real LLM
// candidate carrying grid_spec+text_source elements was misrouted into the literal-text branch,
// which read `el.text` -- undefined for every element -- producing an all-image, zero-text PDF).
function planUsesTextSource(layoutPlan) {
  return (layoutPlan.pages || []).some((p) => (p.elements || []).some((el) => el.type === 'text' && el.text_source))
}

export function reconstructLayout({
  layoutPlan, imagePaths, text, title, textBlocks,
}) {
  // DEBUG: Log incoming textBlocks
  if (Array.isArray(textBlocks) && textBlocks.length > 0) {
    const hasMarkers = textBlocks.some((b) => b.text && b.text.match(/^\s*#+\s/))
    if (hasMarkers) {
      console.warn('[reconstructLayout DEBUG] ⚠️ Incoming textBlocks have markdown markers:')
      textBlocks
        .filter((b) => b.text && b.text.match(/^\s*#+\s/))
        .slice(0, 3)
        .forEach((b) => console.warn(`  - id=${b.id}, text="${b.text.substring(0, 60)}"...`))
    }
  }

  // Computed before paginateGridPlan runs -- it must slice text against the SAME grid dimensions
  // resolveGridPage will render into below, or the two disagree on box size (confirmed 2026-07-16:
  // paginateGridPlan was estimating text capacity against the hardcoded default 6-column/12-row
  // grid while resolveGridPage rendered the plan's actual grid_spec, so a heading could be sliced
  // down to a handful of characters sized for a much smaller assumed box, then rendered into a
  // completely different, often much larger, real box -- the truncation looked arbitrary because
  // it was computed against a box that was never actually used for rendering).
  // boxWidthMm/boxHeightMm come from the plan's OWN page_size/margin_preset (2026-07-28) -- gridToMm
  // otherwise silently falls back to its A5 defaults for every page size, which is exactly how a
  // real B5 generation got measured against A5's smaller content box everywhere downstream
  // (confirmed from a real "grid_spec.page_size: B5" candidate: a paragraph that fit fine on B5's
  // real, larger page was rejected as "overflowing" a box the layout was never going to use).
  const pageGeometry = layoutPlan.grid_spec
    ? resolvePageGeometry(layoutPlan.grid_spec.page_size, layoutPlan.grid_spec.margin_preset)
    : null
  const gridSpec = layoutPlan.grid_spec
    ? {
      columns: layoutPlan.grid_spec.columns,
      rows: layoutPlan.grid_spec.rows,
      gutterMm: layoutPlan.grid_spec.gutter_mm,
      boxWidthMm: pageGeometry.textBoxWidthMm,
      boxHeightMm: pageGeometry.textBoxHeightMm,
      pageWidthMm: pageGeometry.pageWidthMm,
      pageHeightMm: pageGeometry.pageHeightMm,
    }
    : undefined

  const isColumnFlowFallbackPlan = Boolean(layoutPlan.grid_spec) && !planUsesTextSource(layoutPlan)
  const paginated = isColumnFlowFallbackPlan
    ? layoutPlan.pages.map((p) => ({
      elements: p.elements,
      textSlicesByElementId: Object.fromEntries(
        p.elements.filter((el) => el.type === 'text' && el.role === 'body').map((el) => [el.id, el.text ?? null]),
      ),
    }))
    : paginateGridPlan(layoutPlan, text, textBlocks, gridSpec)
  const gridResolvedPages = paginated.map((p) => resolveGridPage(p.elements, imagePaths, p.textSlicesByElementId, gridSpec))

  // Check if plan includes a title element placed by the LLM; if so, it's already in gridResolvedPages
  // and we don't need to prepend a separate title page.
  const hasTitle = typeof title === 'string' && title.trim().length > 0
  const planIncludesTitle = layoutPlan.pages?.some((page) =>
    page.elements?.some((el) => el.type === 'text' && el.role === 'title'),
  )

  // Only create a fallback title-only page if:
  // 1. User provided a title
  // 2. LLM did NOT place a title element in the plan (shouldn't happen if LLM respected the spec)
  // This is a safety net; the LLM should place title in the layout_plan, not expect auto-creation.
  if (hasTitle && !planIncludesTitle) {
    const fallbackTitlePage = {
      type: 'title-page',
      images: [],
      textZone: {
        xMm: 0, yMm: 0, wMm: pageGeometry?.textBoxWidthMm ?? TEXT_BOX_WIDTH_MM, hMm: pageGeometry?.textBoxHeightMm ?? TEXT_BOX_HEIGHT_MM,
      },
      textSlice: null,
      title: stripMarkdownHeadingMarkers(title.trim()),
    }
    return [fallbackTitlePage, ...gridResolvedPages]
  }

  return gridResolvedPages
}
