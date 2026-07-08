import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
} from 'node:fs'
import { dirname } from 'node:path'

// Spec section 16: storage plumbing for online editing feedback. NOTE: this system's UI is
// currently read-only (it shows the generated PDF, it does not let the user drag/resize
// elements), so nothing calls logUserFeedback() yet in production -- these functions exist so
// that whenever an editing UI is built, wiring it to the preference loop is just a function call,
// not a new storage design. applyUserPreferences.js (deriveUserPreferenceContext) reads whatever
// this has accumulated.
export function loadUserFeedback(feedbackPath) {
  if (!existsSync(feedbackPath)) return []
  try {
    const parsed = JSON.parse(readFileSync(feedbackPath, 'utf-8'))
    return Array.isArray(parsed?.user_preference_feedback) ? parsed.user_preference_feedback : []
  } catch {
    return []
  }
}

export function logUserFeedback(feedbackPath, entry) {
  const existing = loadUserFeedback(feedbackPath)
  const updated = [...existing, { created_at: entry.created_at ?? new Date().toISOString(), ...entry }]
  mkdirSync(dirname(feedbackPath), { recursive: true })
  writeFileSync(feedbackPath, JSON.stringify({ user_preference_feedback: updated }, null, 2), 'utf-8')
  return updated
}

export function resetUserFeedback(feedbackPath) {
  mkdirSync(dirname(feedbackPath), { recursive: true })
  writeFileSync(feedbackPath, JSON.stringify({ user_preference_feedback: [] }, null, 2), 'utf-8')
}
