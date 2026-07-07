// server/runGeneration.candidateFailure.test.js
//
// Verifies the failure-isolation fix in runGeneration.mjs: if generateCandidate() throws
// synchronously for one candidate (e.g. a template/pattern-lookup error), the other candidates
// must still be attempted and generation-log.json must still be written.
//
// Why a module mock instead of a "natural" input-driven trigger:
// generateCandidate() is symmetric across candidates A/B/C for any given imageCount - every
// pattern preset (templates/pattern-presets/*.json) defines all three candidates, so there is no
// imageCount/imagePaths/text combination that makes exactly one candidate's real code path throw
// while the other two succeed. Forcing an isolated, deterministic failure therefore requires
// intercepting the call for one candidate. Node's built-in `t.mock.module` (stable behind
// --experimental-test-module-mocks) lets us do this without adding any test-only seams to the
// orchestrator: we mock '../src/core/generateCandidate.js' so that calling it with
// candidate === 'B' throws, while candidate A and C calls are delegated straight through to the
// real implementation. This exercises the real orchestrator code in runGeneration.mjs unchanged,
// with a single, deterministic, real failure point (a thrown Error) instead of an unrealistic
// end-to-end mock.
//
// This must live in its own file: the mock has to be installed *before* runGeneration.mjs (and
// its dependency chain) is first imported, and node's test runner gives each matched test file
// its own process/module graph, so a static top-level import elsewhere in this file (or another
// test file already having loaded the real module) can't leak in and defeat the mock.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A real, fully valid 1x1 PNG (not just a header) so XeLaTeX's \includegraphics can embed it.
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

test('runGeneration isolates one candidate throwing: others still run and the log is still written', async (t) => {
  const { generateCandidate: realGenerateCandidate } = await import('../src/core/generateCandidate.js')

  t.mock.module('../src/core/generateCandidate.js', {
    namedExports: {
      generateCandidate: (args) => {
        if (args.candidate === 'B') {
          throw new Error('injected failure for candidate B (test)')
        }
        return realGenerateCandidate(args)
      },
    },
  })

  const { runGeneration } = await import('./runGeneration.mjs')
  const { FONTS_DIR } = await import('./env.mjs')

  const srcDir = mkdtempSync(join(tmpdir(), 'imprint-it-src-'))
  const outputsRoot = mkdtempSync(join(tmpdir(), 'imprint-it-outputs-'))
  const imgPath = join(srcDir, 'photo.png')
  writeFileSync(imgPath, Buffer.from(TINY_PNG_BASE64, 'base64'))

  const result = await runGeneration({
    imagePaths: [imgPath, imgPath],
    text: '가나다라마바사아자차카파타하'.repeat(50),
    outputsRoot,
    fontsDir: FONTS_DIR,
    date: new Date(2026, 6, 6, 11, 0),
    seq: 1,
    llmOptions: { mockMode: true },
  })

  // Candidate B failed and is recorded as an error, not silently dropped and not looking like success.
  assert.ok(result.candidateResults.B.error, 'candidate B should carry an error field')
  assert.match(result.candidateResults.B.error, /injected failure for candidate B/)
  assert.equal(result.candidateResults.B.compile, undefined)

  // Candidates A and C were not blocked by B's failure and completed for real.
  for (const candidate of ['A', 'C']) {
    const r = result.candidateResults[candidate]
    assert.equal(r.error, undefined, `candidate ${candidate} should not have an error`)
    assert.equal(r.compile.ok, true, `candidate ${candidate} compile failed: ${JSON.stringify(r.compile)}`)
    assert.equal(r.spread.ok, true, `candidate ${candidate} spread failed: ${JSON.stringify(r.spread)}`)
    assert.ok(existsSync(join(r.dir, 'main.tex')))
  }

  // The run folder has no candidate-b directory at all (writeCandidateSources never ran for it).
  assert.ok(!existsSync(join(outputsRoot, result.runId, 'candidate-b_balanced')))

  // writeGenerationLog still ran despite the mid-loop throw.
  assert.ok(existsSync(join(result.runDir, 'generation-log.json')))
  const log = JSON.parse(readFileSync(join(result.runDir, 'generation-log.json'), 'utf-8'))
  assert.ok(log.outputs.candidate_b.error, 'log should record candidate B error')
  assert.match(log.outputs.candidate_b.error, /injected failure for candidate B/)
  assert.equal(log.outputs.candidate_a.compile_ok, true)
  assert.equal(log.outputs.candidate_c.compile_ok, true)

  rmSync(srcDir, { recursive: true, force: true })
  rmSync(outputsRoot, { recursive: true, force: true })
})
