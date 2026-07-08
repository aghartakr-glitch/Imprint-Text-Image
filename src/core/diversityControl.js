import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
} from 'node:fs'
import { dirname } from 'node:path'

// Spec section 14: penalize (never fully block) a composition_strategy that shows up too often
// in recent generations. History is a small append-only JSON file, not a database -- this system
// runs on a single machine for one user, so file-based state is enough.
const RECENT_WINDOW = 5
const REPETITION_THRESHOLD = 3
const MAX_HISTORY_LENGTH = 50

export function loadRecentLayouts(historyPath) {
  if (!existsSync(historyPath)) return []
  try {
    const parsed = JSON.parse(readFileSync(historyPath, 'utf-8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function shouldApplyRepetitionPenalty(recentLayouts, compositionStrategy) {
  const lastN = recentLayouts.slice(-RECENT_WINDOW)
  const count = lastN.filter((entry) => entry.compositionStrategy === compositionStrategy).length
  return count >= REPETITION_THRESHOLD
}

export function recordLayoutUsage(historyPath, { layoutFamily, compositionStrategy }) {
  const history = loadRecentLayouts(historyPath)
  const updated = [...history, { layoutFamily, compositionStrategy }].slice(-MAX_HISTORY_LENGTH)
  mkdirSync(dirname(historyPath), { recursive: true })
  writeFileSync(historyPath, JSON.stringify(updated, null, 2), 'utf-8')
  return updated
}

export function buildDiversityControlLog(recentLayouts, repetitionPenaltyApplied) {
  const lastN = recentLayouts.slice(-RECENT_WINDOW)
  return {
    recent_layout_families: lastN.map((e) => e.layoutFamily),
    recent_composition_strategies: lastN.map((e) => e.compositionStrategy),
    repetition_penalty_applied: repetitionPenaltyApplied,
  }
}
