// server/env.mjs
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(__dirname, '..')
export const FONTS_DIR = join(ROOT, 'assets', 'fonts')
export const OUTPUTS_DIR = join(ROOT, 'outputs')
export const LOGS_DIR = join(ROOT, 'logs')
