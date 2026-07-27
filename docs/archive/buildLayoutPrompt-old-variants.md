# Removed: buildLayoutPrompt_backup.js, buildLayoutPrompt_v2.js

Removed on 2026-07-27 as part of the LLM cost-reduction cleanup pass.

Both files were superseded, unreferenced copies of `src/core/buildLayoutPrompt.js` (dated
2026-07-09; the current `buildLayoutPrompt.js` had since diverged significantly). Verified before
deletion:
- No `import`/`require` of either file anywhere in `src/` or `server/` (including test files).
- The only active prompt source is `src/core/buildLayoutPrompt.js`, used by
  `src/core/generateLayoutCandidates.js`.

Kept only as a note (not the file contents) so a future reader isn't confused by references to a
"_backup"/"_v2" prompt file that no longer exists on disk. If the historical content is ever needed,
it's recoverable from git history (`git log --all --full-history -- src/core/buildLayoutPrompt_backup.js`).
