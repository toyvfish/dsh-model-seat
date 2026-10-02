/**
 * Build step: inline every brand mark in assets/logos/*.svg into client.js, so the
 * browser module stays a single self-contained file with no extra fetches.
 *
 *   node tools/build.mjs
 *
 * The template lives in src/client.template.js; the generated artifact is client.js
 * (the file the client loader actually evaluates — never edit it by hand).
 */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const logoDir = join(root, 'assets', 'logos')
const PLACEHOLDER = '/* @MODEL_LOGOS@ */'

const files = (await readdir(logoDir)).filter(function (name) { return name.endsWith('.svg') }).sort()
const rows = []
for (const file of files) {
  /* File names are author-facing; brand ids are always lower case. */
  const brand = file.slice(0, -4).toLowerCase()
  const svg = await readFile(join(logoDir, file), 'utf8')
  const paths = []
  const matcher = /<path[^>]*\sd="([^"]+)"/g
  let hit = matcher.exec(svg)
  while (hit !== null) {
    paths.push(hit[1])
    hit = matcher.exec(svg)
  }
  if (paths.length === 0) throw new Error('no <path d> found in ' + file)
  const evenOdd = /fill-rule="evenodd"/i.test(svg) ? 1 : 0
  /* Marks are authored at whatever size their vendor drew them; keep the native box. */
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? '0 0 24 24'
  rows.push('      ' + JSON.stringify(brand) + ': [' + JSON.stringify(paths) + ', ' + evenOdd + ', ' + JSON.stringify(viewBox) + '],')
}
if (rows.length === 0) throw new Error('assets/logos is empty')

const table = ['    /** brand id -> [path data, even-odd flag, native viewBox] */', '    const LOGOS = {', ...rows, '    }'].join('\n')

const template = await readFile(join(root, 'src', 'client.template.js'), 'utf8')
if (!template.includes(PLACEHOLDER)) throw new Error('placeholder missing from src/client.template.js')
const output = template.replace(PLACEHOLDER, table)
await writeFile(join(root, 'client.js'), output, 'utf8')

const bytes = Buffer.byteLength(output, 'utf8')
console.log('client.js written: ' + rows.length + ' brand marks, ' + bytes + ' bytes')
