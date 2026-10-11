/**
 * Host half of dsh-model-seat.
 *
 * It carries no behavior of its own, but it DOES own the settings section this plugin exposes: the
 * settings runtime projects every volatile() field of a plugin's Config into an editable form, and
 * the browser receives the accepted values through ctx.configForms. The browser half renders the
 * page and applies the values; nothing here needs to run.
 */
/**
 * Resolve the schema factory from the harness's own resolution base.
 *
 * A bare `import '@deepseek-ai/schemastery'` only works when something has already put the package
 * beside this file — true for a link: install, false the moment anyone installs the plugin from git,
 * where the import dies with ERR_MODULE_NOT_FOUND and takes the whole host half down with it. Anchor
 * createRequire on the harness's entry script instead, the way dsh-claude-style does.
 *
 * Returns null rather than throwing when nothing resolves: the browser half carries the same defaults
 * and this plugin has no host-side behaviour to lose.
 */
async function resolveSchemaFactory() {
  try {
    const { createRequire } = await import('node:module')
    const anchor = typeof process.argv[1] === 'string' && process.argv[1] !== '' ? process.argv[1] : process.execPath
    const factory = createRequire(anchor)('@deepseek-ai/schemastery')
    if (factory !== null && factory !== undefined && typeof factory.object === 'function') return factory
  } catch (error) {
    /* Falls through to the plain import. */
  }
  try {
    const resolved = await import('@deepseek-ai/schemastery')
    const factory = resolved?.default ?? resolved?.Schema ?? null
    return factory !== null && factory !== undefined && typeof factory.object === 'function' ? factory : null
  } catch (error) {
    return null
  }
}

const z = await resolveSchemaFactory()

/** Every appearance colour is a plain #rrggbb string. */
const HEX = /^#[0-9a-fA-F]{6}$/

/** A colour field with a schema default, marked editable. */
function color(fallback) {
  return z.string().pattern(HEX).default(fallback).volatile()
}

/**
 * Appearance settings for the composer model seat.
 *
 * Volatile fields must sit on a flat object path, so this schema stays one level deep on purpose.
 */
const schema = z === null ? null : z.object({
  /* Trigger */
  triggerLogo: z.boolean().default(true).volatile(),
  triggerLogoColor: color('#ffffff'),
  triggerTint: color('#343436'),
  triggerOpacity: z.number().min(0).max(100).default(100).volatile(),
  /* Defaultless on purpose: unset keeps the theme's own label colours, and the page's
   * "restore defaults" button clears them back to that. */
  triggerLabelColor: z.string().pattern(HEX).volatile(),
  triggerEffortColor: z.string().pattern(HEX).volatile(),
  /* Composer seat contents */
  showSearch: z.boolean().default(true).volatile(),
  /* Popover surface: one material preset plus an optional colour that overrides its fill. */
  menuMaterial: z.string().default('none').volatile(),
  /* Scales whichever parameters a material owns; inert for "none". */
  menuMaterialStrength: z.number().min(0).max(100).default(50).volatile(),
  menuTint: color('#343436'),
  /* Only the preset-less and transparent materials expose this; acrylic and mica pin their own. */
  menuOpacity: z.number().min(0).max(100).default(100).volatile(),
  /* Model list */
  listLogo: z.boolean().default(true).volatile(),
  listNote: z.boolean().default(true).volatile(),
  /* Reasoning slider */
  sliderGradient: z.boolean().default(true).volatile(),
  sliderSolid: color('#4f8ef7'),
  sliderFrom: color('#38bdf8'),
  sliderTo: color('#a855f7'),
})

/** Undefined when no schema factory could be resolved; the browser half then keeps its defaults. */
export const Config = schema === null ? undefined : schema

/** Host plugin body — the page and its effects live entirely in the browser half. */
export function apply() {}
