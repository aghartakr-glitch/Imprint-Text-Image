# LLM Cost Reduction — Plan & Implementation Log

Date: 2026-07-27. Scope: reduce Anthropic API call count / input tokens / output tokens without
degrading layout quality. **No real API calls were made while implementing or verifying this work**
(user directive) — every change below was verified via `node --test` against mock/fake Anthropic
clients (`{ messages: { create: async () => ... } }`) or `llmOptions: { mockMode: true }`, never a
real API key.

## 1. Cost flow as it existed before this pass

**Where API calls happen** (`src/core/generateLayoutCandidates.js`):
- `generateLayoutCandidates()` → 1 call (the normal path).
- `retryLayoutCandidate()` → 1 more call, but only reachable from `callLayoutLLM.js` when
  `options.allowRetry === true` AND the first candidate fails validation after the full local repair
  chain. `server/index.mjs` always passes `allowRetry: true`, so in practice: **1 call normally, 2
  calls when the first candidate needs a retry.**
- Model: `claude-sonnet-4-6`. `MAX_OUTPUT_TOKENS = 8000` (this comment already exists in the file:
  sized for "many images (10+) and long text... 4-6 pages" — real generations observed in this
  project during other work this session ran to **14-15 pages**, so this ceiling is not padding, it
  reflects genuinely large real output).

**Prompt sections** (`src/core/buildLayoutPrompt.js`, before this pass):
- `SYSTEM_PROMPT`: fixed, ~3000+ chars, sent on every call unconditionally.
- `buildUserPrompt()`: input metadata, content structure, document structure, text blocks, image
  analysis, inferred image-text relations, image-text matching, suggested layout family, image
  metadata, pattern library summary, retrieved references (previously **unbounded**), user
  layout/control settings, user preference context, full-bleed settings, a 3-candidate diversity
  profile block (previously sent in full even when only 1 candidate was requested), a compact JSON
  schema example, and a validation-reminders block.
- **Confirmed duplication**: image-text proximity rules and paragraph-role placement guidance were
  each written out twice — once in `SYSTEM_PROMPT` ("Placement Guidance" / "Image-Text Proximity")
  and again in `buildUserPrompt()`'s Task section ("PARAGRAPH ROLE-BASED PLACEMENT" /
  "INFERRED RELATIONSHIPS TO PRESERVE"). Same content, same words in most lines.

**Retry conditions** (`src/core/callLayoutLLM.js`): only when `validCandidates.length === 0` after
the full local, API-free repair chain (`repairLayoutPlan` → `repairTextOverflow` →
`repairCollisions` → `enforceGridOccupancy` → `validateAndFixLayoutMm`) AND `options.allowRetry` is
true. The retry sends a *summarized* failed plan (`summarizeFailedPlan`, geometry only) plus the
exact validation issues, not the full original prompt again — already reasonably lean.

**Output fields actually consumed downstream vs. log-only**:
- Used by later pipeline stages: `candidates[].pages`, `.grid_spec`, `.composition_strategy`,
  `.style`, `.output_unit`, `.layout_family`, `.overflow_policy`, `.text_flow`, `.reserved_regions`.
- Log-only (never read by any runtime decision, only surfaced in `generation-log.json` /
  API response for the user): `content_understanding`, `image_analysis` (LLM's own re-analysis;
  note a *separate*, already-computed `image_analysis` from `analyzeImages.js` is what's actually
  used for placement), `reference_principles`, `layout_strategy_reasoning`, and each candidate's
  free-text `reason` field. `design_sequence` is log-only for rendering purposes but the prompt
  *requires* the LLM to produce it as part of "reason like an editorial designer" — removing it
  entirely risks removing the scratch-space that produces better `pages[]` output, so it was kept,
  only capped in length (already capped at "8 words or fewer" / "5-7 steps" before this pass).

## 2. Changes implemented

### 2.1 Deterministic-first ordering (server/runGeneration.mjs)
`tryBuildSpecializedLayout()` now runs and validates **before** `callLayoutLLM()`, not after. A new
pure, independently unit-tested function decides whether to skip the LLM call entirely:

```js
export function shouldSkipLlmForSpecializedLayout({ hasSpecializedCandidate, userLayoutSettings, env = {} }) {
  if (!hasSpecializedCandidate) return false
  return userLayoutSettings?.cost_saving_mode === true || env.LAYOUT_SKIP_LLM_ON_SPECIALIZED === 'true'
}
```

- Default (no opt-in): identical behavior to before — LLM is always called, specialized candidate is
  still added to the pool for comparison, same as the old code.
- `userLayoutSettings.cost_saving_mode === true` OR `LAYOUT_SKIP_LLM_ON_SPECIALIZED=true`: if the
  specialized builder produces a plan that passes `validateLayoutPlan`, the LLM call is skipped
  entirely (`llmResult` is a synthetic empty-candidates, `fallbackUsed:false` object) and generation
  proceeds with only the specialized candidate.
- If the specialized builder returns `null` or its plan fails validation, `cost_saving_mode` has no
  effect — the LLM is called normally (fallback path preserved, per the "specialized 실패 시 LLM으로
  fallback" requirement).

Tests added (`server/runGeneration.test.js`): 3 new unit tests directly on
`shouldSkipLlmForSpecializedLayout` (skip-when-opted-in-and-available, no-skip-by-default,
no-skip-when-no-specialized-candidate). A full end-to-end integration test that forces one of the
4 specialized builders (`case_study_cards_grid`, `numbered_story_hero_support`,
`cmf_stories_masonry`, `macro_opener_split`) to actually fire through `runGeneration()` was not
added in this pass — doing so needs real input crafted to match each builder's specific trigger
conditions in `selectLayoutFamily.js`, which is a separate, larger investigation; the unit-level
coverage above verifies the cost-relevant *decision logic* precisely, which is the part this task is
about.

### 2.2 Prompt trimming (`src/core/buildLayoutPrompt.js`)
- **Removed duplicated sections**: `buildUserPrompt()`'s Task block no longer repeats
  "INFERRED RELATIONSHIPS TO PRESERVE" / "PARAGRAPH ROLE-BASED PLACEMENT" — that guidance already
  exists in `SYSTEM_PROMPT`'s "Image-Text Proximity" / "Placement Guidance" sections, referenced by
  a one-line pointer instead.
- **Empty/weak optional sections omitted, not sent as empty JSON**: `imageTextMatching`,
  `suggestedLayoutFamily`, `imageMetadata`, `patternLibrarySummary`, `retrievedReferences` are now
  only included when they have actual content (previously some were sent unconditionally, e.g. an
  empty `[]`/`{}` still cost tokens to serialize and for the model to read).
- **`retrievedReferences` capped** at `MAX_REFERENCES_FOR_PROMPT = 3` (was unbounded).
- **Candidate diversity guidance already conditional on candidate count** (pre-existing code, kept
  as-is: `internalCandidateCount === 1` sends only the single "STABLE EDITORIAL" profile, not all 3).
- **Not done**: rewriting long "CONSEQUENCE: ..." sentences into terse rule-codes (the user's step
  3.2 example). These sentences correspond to rules that have each individually been the subject of
  a real validation-failure bug fix earlier in this project (paragraph order, image-text proximity,
  text overflow, collisions) — per this task's own "레이아웃 품질 규칙을 비용 때문에 제거하지 말 것"
  constraint and the inability to test wording changes against a real model in this pass, rewording
  these was judged higher-risk than the token savings justify. Flagged as a candidate for a future,
  separately-tested pass.

Tests added (`src/core/buildLayoutPrompt.test.js`): 3 new tests — 1-candidate diversity guidance
omission (pre-existing behavior, now explicitly covered), empty-section omission, reference cap.

### 2.3 Prompt caching (opt-in, `src/core/generateLayoutCandidates.js`)
`SYSTEM_PROMPT` can now be sent as a `cache_control`-tagged content block instead of a plain string:

```js
function buildSystemParam(enablePromptCaching) {
  if (!enablePromptCaching) return SYSTEM_PROMPT
  return [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }]
}
```

- **Default is unchanged** (`enablePromptCaching` defaults to falsy) — `system` stays the exact same
  plain string it always was.
- Pass `{ enablePromptCaching: true }` in `llmOptions` to opt in.
- **Not verified against the real Anthropic API** in this pass (no API calls allowed). Verified only
  that (a) the default path is byte-for-byte unchanged, and (b) the opt-in path produces the shape
  Anthropic's documented prompt-caching API expects
  (`https://platform.claude.com/docs/en/build-with-claude/prompt-caching`), via a fake-client test
  capturing the exact request object. **Before enabling this by default, a real (small, cheap) test
  call should confirm the installed `@anthropic-ai/sdk` version accepts this request shape and that
  `response.usage` includes cache-related fields as expected.**

### 2.4 Cost/token instrumentation
Not extended in this pass. `layoutCostBudget.js` already tracks, per call:
`estimatedInputTokens` (+ source: real `count_tokens` API result vs. conservative string-length
fallback), `maxOutputTokens`, `plannedCostUsd`, `actualInputTokens`/`actualOutputTokens` (from
`response.usage` when available), `chargedCostUsd`, and a running `spentUsd`/`remainingUsd` against
`maxSpendUsd`, all surfaced via `costBudget.summary()`. The user's step-5 wishlist
(`candidate_count`, `retry_allowed`, `retry_count`, `prompt_sections_included`, `skipped_sections`,
`cache_enabled`) is a reasonable next increment on top of this existing structure but wasn't added
here to keep this pass focused on the changes that actually reduce spend rather than only observe
it — recommended as a fast follow-up.

### 2.5 Output token cap vs. candidate count
**Not changed.** The user's suggested `internalCandidateCount === 1 ? 2500 : 4000` was not applied:
`MAX_OUTPUT_TOKENS` is currently `8000` (not `4000` as assumed in the request), and this project's
own real generations (observed directly during other work this session, unrelated to this task) have
run to 14-15 pages for a single candidate — comfortably able to need output well past 2500 tokens for
the `pages[]` JSON alone, independent of candidate count. Lowering this without a real-API truncation
test (explicitly barred for this task) risks exactly the regression the user's own step 6 warns
against ("JSON truncation이 생기면 안 된다... 비용 절감보다 안정성이 우선"). Left as a flagged,
not-yet-actioned item pending a live-tested follow-up with the exact scenarios the user listed (long
text, 6 images, spread output, full_bleed, modular text blocks).

### 2.6 Dead code removal
`src/core/buildLayoutPrompt_backup.js` and `src/core/buildLayoutPrompt_v2.js` deleted — confirmed
zero references anywhere in `src/` or `server/` (including tests) before deletion. Noted in
`docs/archive/buildLayoutPrompt-old-variants.md`.

## 3. Test summary

All verification was `node --test`, no real API calls:
- `src/core/buildLayoutPrompt.test.js`: 8 tests (was 5), 7 pass / 1 pre-existing unrelated failure.
- `src/core/generateLayoutCandidates.test.js`: +2 new caching-flag tests, both pass; 1 pre-existing
  unrelated failure unchanged.
- `server/runGeneration.test.js`: +3 new unit tests for the skip-LLM decision, all pass; 1
  pre-existing unrelated failure (real XeLaTeX compile assertion, unaffected by this change) unchanged.
- Full `src/core/**/*.test.js` suite: 313 tests, 305 pass, 8 fail — the same 8 pre-existing failures
  present before this pass began (verified by name, not just count).

## 4. Deliberately not done in this pass (with reasons)

| Item | Reason |
|---|---|
| Rewriting long rule sentences into terse codes (step 3.2) | Each corresponds to a previously-real validation bug; wording risk not worth the token savings without live-model testing |
| Output token cap reduction (step 6) | Real observed documents need far more than the user's suggested 2500-token floor; no way to safely verify without real API calls |
| Full cost-budget instrumentation expansion (step 5) | Existing instrumentation already covers the load-bearing fields; extending the schema is additive and low-risk, but out of scope for this pass's focus on actual spend reduction |
| Enabling prompt caching by default | Implemented but kept opt-in pending a real-API verification call the user would need to run themselves |
