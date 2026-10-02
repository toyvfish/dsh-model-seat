/** Verify the host Config schema parses and reports the expected fields. */
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
/* Resolve through the local DSH profile without hard-coding a machine path. */
const profile = process.env.DSH_PROFILE_DIR || join(homedir(), '.dsh', 'profiles', 'default')
const require = createRequire(join(profile, 'noop.js'))
const entry = require.resolve('dsh-model-seat')
const mod = await import(pathToFileURL(entry).href)
const config = mod.Config({})
const keys = Object.keys(config)
console.log('fields(' + keys.length + '): ' + keys.join(' '))
const expected = ['triggerLogo', 'triggerLogoColor', 'triggerTint', 'triggerOpacity', 'triggerLabelColor', 'triggerEffortColor', 'showSearch', 'menuMaterial', 'menuMaterialStrength', 'menuTint', 'menuOpacity', 'listLogo', 'listNote', 'sliderGradient', 'sliderSolid', 'sliderFrom', 'sliderTo']
const missing = expected.filter(function (key) { return !keys.includes(key) })
console.log(missing.length === 0 ? 'ALL EXPECTED FIELDS PRESENT' : 'MISSING: ' + missing.join(' '))
console.log('menuMaterial default:', JSON.stringify(config.menuMaterial))
