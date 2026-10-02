
const { createRequire } = require('node:module')
const { homedir } = require('node:os')
const { readFileSync, readdirSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')
const profile = process.env.DSH_PROFILE_DIR || join(homedir(), '.dsh', 'profiles', 'default')
const req = createRequire(join(profile, 'noop.js'))
const specifier = 'dsh-model-seat'
function tryResolve(sub) {
  try { return req.resolve(specifier + sub) } catch (error) { return 'ERR: ' + error.code }
}
console.log('package.json ->', tryResolve('/package.json'))
const enPath = tryResolve('/locale/en.json')
console.log('locale/en.json ->', enPath)
const manifest = JSON.parse(readFileSync(tryResolve('/package.json'), 'utf8'))
let dictionaries = new Map()
if (!String(enPath).startsWith('ERR')) {
  for (const name of readdirSync(dirname(enPath))) {
    if (!name.endsWith('.json')) continue
    const parsed = JSON.parse(readFileSync(join(dirname(enPath), name), 'utf8'))
    const meta = parsed.meta || {}
    dictionaries.set(name.slice(0, -5).toLowerCase(), { title: meta.title, description: meta.description })
  }
}
console.log('dictionaries ->', JSON.stringify([...dictionaries]))
function localizedText(field, fallback) {
  const entries = [...dictionaries].flatMap(([lang, fields]) => fields[field] === undefined ? [] : [[lang, fields[field]]])
  if (entries.length === 0) return fallback
  return Object.assign({ en: fallback }, Object.fromEntries(entries))
}
console.log('title  ->', JSON.stringify(localizedText('title', manifest.name)))
console.log('desc   ->', JSON.stringify(localizedText('description', manifest.description)))
