// Spec Phase 3.5: Orchestrator for specialized layout builders
// Tries to build a layout from the suggested family; returns null if not applicable

import { buildCaseStudyCardsGrid } from './caseStudyCardsGrid.js'
import { buildNumberedStoryHeroSupport } from './numberedStoryHeroSupport.js'
import { buildCmfStoriesMasonry } from './cmfStoriesMasonry.js'
import { buildMacroOpenerSplit } from './macroOpenerSplit.js'

export function tryBuildSpecializedLayout({
  suggestedLayoutFamily,
  imageCount,
  textDensity,
  hasTitle,
  contentStructure,
  userGridSettings,
}) {
  // Each builder returns null if not applicable; return first that matches
  if (suggestedLayoutFamily?.family === 'case_study_cards_grid') {
    const plan = buildCaseStudyCardsGrid({ imageCount, contentStructure, userGridSettings })
    if (plan) return plan
  }

  if (suggestedLayoutFamily?.family === 'numbered_story_hero_support') {
    const plan = buildNumberedStoryHeroSupport({ imageCount, contentStructure, userGridSettings })
    if (plan) return plan
  }

  if (suggestedLayoutFamily?.family === 'cmf_stories_masonry') {
    const plan = buildCmfStoriesMasonry({ imageCount, textDensity, contentStructure, userGridSettings })
    if (plan) return plan
  }

  if (suggestedLayoutFamily?.family === 'macro_opener_split') {
    const plan = buildMacroOpenerSplit({ hasTitle, imageCount, contentStructure, userGridSettings })
    if (plan) return plan
  }

  return null // No specialized builder matched
}
