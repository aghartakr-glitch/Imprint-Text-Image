// server/compile.mjs
import { exec } from 'node:child_process'
import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(exec)

export async function hasXelatex() {
  try {
    await run(process.platform === 'win32' ? 'where xelatex' : 'which xelatex')
    return true
  } catch {
    return false
  }
}

function cleanupAuxFiles(dir, basename) {
  for (const ext of ['aux', 'log', 'synctex.gz', 'out']) {
    const p = join(dir, `${basename}.${ext}`)
    if (existsSync(p)) unlinkSync(p)
  }
}

export async function compileMainTex(candidateDir) {
  const tex = join(candidateDir, 'main.tex')
  if (!existsSync(tex)) throw new Error(`main.tex 없음: ${candidateDir}`)
  if (!(await hasXelatex())) {
    return { ok: false, reason: 'xelatex 미설치', hint: 'TeX(XeLaTeX)를 설치하면 PDF가 생성됩니다.' }
  }
  try {
    const { stdout } = await run(
      'xelatex -interaction=nonstopmode -halt-on-error "main.tex"',
      { cwd: candidateDir, timeout: 120000 },
    )
    const producedPdf = join(candidateDir, 'main.pdf')
    if (!existsSync(producedPdf)) {
      return { ok: false, reason: '컴파일은 됐으나 PDF 없음', log: stdout.slice(-1500) }
    }
    const pagesPdf = join(candidateDir, 'pages.pdf')
    renameSync(producedPdf, pagesPdf)
    cleanupAuxFiles(candidateDir, 'main')
    return { ok: true, pdf: pagesPdf, log: stdout.slice(-800) }
  } catch (e) {
    return { ok: false, reason: '컴파일 오류', log: String(e.stdout || e.message).slice(-1500) }
  }
}

export async function compileSpreadPreview(candidateDir) {
  const pagesPdf = join(candidateDir, 'pages.pdf')
  if (!existsSync(pagesPdf)) throw new Error(`pages.pdf 없음: ${candidateDir}`)
  if (!(await hasXelatex())) {
    return { ok: false, reason: 'xelatex 미설치', hint: 'TeX(XeLaTeX)를 설치하면 PDF가 생성됩니다.' }
  }
  const wrapperBasename = '_spread_wrapper'
  const wrapperTex = '\\documentclass{article}\n'
    + '\\usepackage[paperwidth=296mm,paperheight=210mm,margin=0mm]{geometry}\n'
    + '\\usepackage{pdfpages}\n'
    + '\\begin{document}\n'
    + '\\includepdf[pages=-,nup=2x1]{pages.pdf}\n'
    + '\\end{document}\n'
  writeFileSync(join(candidateDir, `${wrapperBasename}.tex`), wrapperTex, 'utf-8')

  try {
    const { stdout } = await run(
      `xelatex -interaction=nonstopmode -halt-on-error "${wrapperBasename}.tex"`,
      { cwd: candidateDir, timeout: 120000 },
    )
    const producedPdf = join(candidateDir, `${wrapperBasename}.pdf`)
    if (!existsSync(producedPdf)) {
      return { ok: false, reason: '스프레드 PDF 생성 실패', log: stdout.slice(-1500) }
    }
    const spreadPdf = join(candidateDir, 'spread-preview.pdf')
    renameSync(producedPdf, spreadPdf)
    return { ok: true, pdf: spreadPdf }
  } catch (e) {
    return { ok: false, reason: '스프레드 컴파일 오류', log: String(e.stdout || e.message).slice(-1500) }
  } finally {
    cleanupAuxFiles(candidateDir, wrapperBasename)
    const wrapperTexPath = join(candidateDir, `${wrapperBasename}.tex`)
    if (existsSync(wrapperTexPath)) unlinkSync(wrapperTexPath)
  }
}
