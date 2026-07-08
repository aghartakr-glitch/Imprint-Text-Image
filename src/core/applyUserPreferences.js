// Spec section 16.3: folds accumulated feedback entries into one soft-preference context object
// for the next prompt. Later entries win on conflicting keys (most-recent editing intent should
// dominate an older, possibly-abandoned one). Never overrides fixed constraints or validation --
// buildLayoutPrompt.js only ever presents this as a "soft guidance" section (see its own tests).
export function deriveUserPreferenceContext(feedbackEntries) {
  return feedbackEntries.reduce((context, entry) => ({
    ...context,
    ...(entry.interpreted_preference ?? {}),
  }), {})
}
