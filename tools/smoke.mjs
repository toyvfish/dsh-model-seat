/**
 * Offline smoke test for the generated client.js: a miniature renderer stands in for
 * React so the seat (trigger, popover, model rows, effort slider) can be exercised in
 * plain Node without react-dom or a DOM.
 *
 *   node tools/smoke.mjs
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/* ---------- miniature React ---------- */
let records = new WeakMap()
let stack = []
/* Queued layout effects: they run once the whole tree is mounted, i.e. after refs are bound. */
let pendingEffects = []

const sameDeps = function (left, right) {
  if (left === undefined || right === undefined) return false
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false
  return true
}

const useState = function (initial) {
  const record = stack[stack.length - 1]
  const index = record.index
  record.index += 1
  if (!(index in record.hooks)) record.hooks[index] = typeof initial === 'function' ? initial() : initial
  const setter = function (next) {
    record.hooks[index] = typeof next === 'function' ? next(record.hooks[index]) : next
  }
  return [record.hooks[index], setter]
}

const React = {
  /* Minimal base so the plugin's error boundary can be instantiated. */
  Component: class {
    constructor(props) {
      this.props = props === undefined ? {} : props
      this.state = {}
    }
    setState(next) {
      this.state = Object.assign({}, this.state, typeof next === 'function' ? next(this.state) : next)
    }
  },
  createElement: function (type, props) {
    const children = Array.prototype.slice.call(arguments, 2)
    const resolved = props === null || props === undefined ? {} : props
    /* Real React exposes children on props, and class components read this.props.children —
     * the error boundary does, so without this it renders null and looks "blank". */
    if (resolved.children === undefined) resolved.children = children
    return { type: type, props: resolved, children: children }
  },
  useState: useState,
  useRef: function (initial) {
    const record = stack[stack.length - 1]
    const index = record.index
    record.index += 1
    if (!(index in record.hooks)) record.hooks[index] = { current: initial }
    return record.hooks[index]
  },
  /* Dependency arrays are honoured, so a component that filters on state re-derives. */
  useMemo: function (factory, deps) {
    const record = stack[stack.length - 1]
    const index = record.index
    record.index += 1
    const entry = record.hooks[index]
    if (entry === undefined || !sameDeps(entry.deps, deps)) record.hooks[index] = { deps: deps, value: factory() }
    return record.hooks[index].value
  },
  useCallback: function (fn, deps) {
    const record = stack[stack.length - 1]
    const index = record.index
    record.index += 1
    const entry = record.hooks[index]
    if (entry === undefined || !sameDeps(entry.deps, deps)) record.hooks[index] = { deps: deps, value: fn }
    return record.hooks[index].value
  },
  /* Passive effects stay inert; layout effects run, so placement/measure code is exercised. */
  useEffect: function () {
    const record = stack[stack.length - 1]
    record.index += 1
  },
  useLayoutEffect: function (effect, deps) {
    const record = stack[stack.length - 1]
    const index = record.index
    record.index += 1
    const entry = record.hooks[index]
    if (entry === undefined || !sameDeps(entry.deps, deps)) {
      record.hooks[index] = { deps: deps }
      pendingEffects.push(effect)
    }
  },
  useSyncExternalStore: function (subscribe, getSnapshot) {
    const record = stack[stack.length - 1]
    record.index += 1
    return getSnapshot()
  },
}

function runComponent(fn, props) {
  let record = records.get(fn)
  if (record === undefined) {
    record = { hooks: [], index: 0 }
    records.set(fn, record)
  }
  record.index = 0
  stack.push(record)
  try {
    return fn(props)
  } finally {
    stack.pop()
  }
}

/** Stand-ins for the two nodes the seat measures: the popover surface and the trigger button. */
const fakeNodeFor = function (type) {
  if (type === 'MenuSurface') {
    return {
      offsetWidth: 275,
      offsetHeight: 420,
      getBoundingClientRect: function () { return { left: 0, top: 0, right: 275, bottom: 420, width: 275, height: 420 } },
      querySelectorAll: function () { return [] },
      querySelector: function () { return null },
      contains: function () { return false },
    }
  }
  return {
    offsetWidth: 250,
    offsetHeight: 28,
    getBoundingClientRect: function () { return { left: 700, top: 1000, right: 950, bottom: 1028, width: 250, height: 28 } },
    focus: function () {},
    contains: function () { return false },
  }
}

/** Flatten an element tree, running every function component. */
function flatten(node, out) {
  if (node === null || node === undefined || node === false || node === true) return out
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out)
    return out
  }
  if (typeof node === 'string' || typeof node === 'number') {
    out.push({ kind: 'text', text: String(node) })
    return out
  }
  const props = node.props
  const children = node.children.length > 0 ? node.children : props.children === undefined ? [] : [props.children]
  if (typeof node.type === 'function') {
    const isClass = node.type.prototype !== undefined && typeof node.type.prototype.render === 'function'
    if (isClass) {
      const instance = new node.type(props)
      instance.props = props
      flatten(instance.render(), out)
      return out
    }
    flatten(runComponent(node.type, props), out)
    return out
  }
  const entry = { kind: 'element', type: node.type, props: props, children: [] }
  if (props.ref !== undefined && typeof props.ref === 'object' && props.ref !== null && 'current' in props.ref) {
    props.ref.current = fakeNodeFor(node.type)
  }
  out.push(entry)
  for (const child of children) flatten(child, entry.children)
  return out
}

/** Shared failure counter: every assertion block below adds to it. */
let failures = 0

function findAll(nodes, predicate) {
  const hits = []
  const walk = function (list) {
    for (const node of list) {
      if (node.kind === 'element' && predicate(node)) hits.push(node)
      if (node.children !== undefined) walk(node.children)
    }
  }
  walk(nodes)
  return hits
}

function allText(nodes) {
  let text = ''
  const walk = function (list) {
    for (const item of list) {
      if (item.kind === 'text') text += item.text + ' '
      if (item.children !== undefined) walk(item.children)
    }
  }
  walk(nodes)
  return text
}

function textOf(node) {
  let text = ''
  const walk = function (list) {
    for (const item of list) {
      if (item.kind === 'text') text += item.text
      if (item.children !== undefined) walk(item.children)
    }
  }
  walk(node.children)
  return text
}

/* ---------- load the plugin bundle ---------- */
let definition = null
globalThis.window = {
  __ModuleLoader__: { load: function (def) { definition = def } },
  requestAnimationFrame: function (fn) { fn() },
  addEventListener: function () {},
  removeEventListener: function () {},
  innerWidth: 1280,
  innerHeight: 800,
}

globalThis.document = {
  head: { appendChild: function () {} },
  body: {},
  createElement: function () { return { dataset: {}, style: {}, remove: function () {} } },
  addEventListener: function () {},
  removeEventListener: function () {},
  querySelector: function () { return null },
}

const source = await readFile(join(root, 'client.js'), 'utf8')
const url = pathToFileURL(join(root, 'client.js')).href + '?v=' + Date.now()
await import(url)

if (definition === null) throw new Error('client.js did not register itself with __ModuleLoader__')

const primitives = {
  MenuSurface: 'MenuSurface',
  SettingsForm: 'SettingsForm',
  SettingsFormModel: FakeSettingsFormModel,
}

/**
 * Miniature stand-in for the shared settings form model: resolves each field from the Host value
 * through its spec formatter, and honours staged drafts exactly like the real one does.
 */
function FakeSettingsFormModel(scope, specs) {
  this.scope = scope
  this.specs = new Map(specs.map(function (spec) { return [spec.field, spec] }))
  this.staged = new Map()
  this.listeners = new Set()
}
FakeSettingsFormModel.prototype.shell = function () {
  return { available: true, writable: true, dirty: this.staged.size > 0, invalid: false, saving: false, failed: false }
}
FakeSettingsFormModel.prototype.field = function (name) {
  const spec = this.specs.get(name)
  const staged = this.staged.get(name)
  if (staged !== undefined) return { text: staged, overridden: true, invalid: false }
  return { text: spec.format(this.scope.getSnapshot().value[name]), overridden: false, invalid: false }
}
FakeSettingsFormModel.prototype.actions = function () {
  const self = this
  return {
    edit: function (field, text) { self.staged.set(field, text) },
    save: function () { self.staged.clear() },
    discard: function () { self.staged.clear() },
  }
}
FakeSettingsFormModel.prototype.bind = function (project) {
  const listeners = new Set()
  /* Re-project on every read: the miniature renderer has no store notification, so a fresh
   * projection is what makes a mutated Host value visible on the next render. */
  return {
    getSnapshot: function () { return project() },
    subscribe: function (listener) {
      listeners.add(listener)
      return function () { listeners.delete(listener) }
    },
  }
}
FakeSettingsFormModel.prototype.dispose = function () {}
const reactDom = { createPortal: function (node) { return { type: '__portal__', props: {}, children: [node] } } }
const exports_ = definition.factory(function (spec) {
  if (spec === 'react') return React
  if (spec === 'react-dom') return reactDom
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error('unexpected require: ' + spec)
})

if (typeof exports_.apply !== 'function') throw new Error('apply is not exported')
if (!Array.isArray(exports_.inject)) throw new Error('inject is not exported')

/* ---------- mock host services ---------- */
const registrations = []
const slots = {
  inject: function (key, factory) { return factory() },
  register: function (options, component) {
    registrations.push({ options: options, component: component })
    return function () {}
  },
}
const dictionary = {
  account: 'DeepSeek 账号',
  errorBusy: 'busy',
  errorAction: 'failed',
  triggerAria: '选择模型，当前 {model}',
  triggerAriaEffort: '选择模型，当前 {model}，推理等级 {effort}',
  providerFailed: '{name} 加载失败：{message}',
  noMatch: '没有匹配的模型',
  loading: '正在刷新模型列表…',
  search: '搜索模型',
  searchPlaceholder: '搜索模型…',
  clearSearch: '清除搜索',
}
const locale = {
  register: function () { return function () {} },
  bind: function () {
    return function (key, params) {
      let template = dictionary[key] === undefined ? key : dictionary[key]
      if (params !== undefined) {
        for (const name of Object.keys(params)) template = template.replace('{' + name + '}', String(params[name]))
      }
      return template
    }
  },
}

let snapshot = null
const selections = []
const directory = {
  subscribe: function () { return function () {} },
  getSnapshot: function () { return snapshot },
}
const modelDirectories = {
  directoryFor: function () {
    return {
      store: directory,
      load: function () { return Promise.resolve() },
      select: function (selection) {
        selections.push(selection)
        return Promise.resolve({ ok: true })
      },
    }
  },
}
const sessions = { subagentAddress: function () { return undefined } }

/* The Host settings document this plugin's section resolves against; tests mutate it. */
const appearanceHost = {}
const configFormScope = {
  subscribe: function () { return function () {} },
  getSnapshot: function () { return { status: 'ready', writable: true, revision: 1, value: appearanceHost } },
  mutate: function () { return Promise.resolve(true) },
}
const configForms = { get: function () { return configFormScope } }

const ctx = {
  effect: function (fn) { fn(); return function () {} },
  locale: locale,
  configForms: configForms,
  inject: function (keys, callback) {
    callback({ locale: locale, slots: slots, configForms: configForms, modelDirectories: modelDirectories, sessions: sessions })
  },
}
exports_.apply(ctx)

const seatRegistration = registrations.filter(function (item) { return item.options.name === 'conversation.input.model' })[0]
const sectionRegistration = registrations.filter(function (item) { return item.options.name === 'settings.section' })[0]
if (seatRegistration === undefined) throw new Error('the seat slot was not registered')
if (sectionRegistration === undefined) throw new Error('the settings page was not registered')
if (!(seatRegistration.options.priority < 0)) throw new Error('registration must outrank the built-in seat')
if (sectionRegistration.options.id !== 'model-seat') throw new Error('unexpected settings section id: ' + sectionRegistration.options.id)
if (typeof sectionRegistration.options.label !== 'function') throw new Error('the settings section needs a label')
console.log('ok    registered the seat and the settings section')

/* The shared SettingsForm calls props.onDiscard() from its unmount effect. Undefined there threw
 * while the page unmounted, and the exception took the whole sidebar Settings seat down with it. */
const panelFace = sectionRegistration.options.inject()
const discardKind = panelFace.appearanceActions === undefined ? 'no-face' : typeof panelFace.appearanceActions.discard
const commitKind = panelFace.appearanceActions === undefined ? 'no-face' : typeof panelFace.appearanceActions.commit
console.log('settings form callbacks -> onDiscard: ' + discardKind + ', onSave: ' + commitKind)
if (discardKind !== 'function') { failures += 1; console.log('FAIL  the settings page must pass onDiscard (the form calls it on unmount)') }
if (commitKind !== 'function') { failures += 1; console.log('FAIL  the settings page must pass onSave') }

/* ---------- the settings page must actually render ---------- */
/* It is registered as a slot entry and nothing above ever rendered it. A reference error inside the
 * page — it used a variable that only existed in the seat's scope — blanked the whole panel in the
 * field while every assertion in this file still passed. Render it for real. */
function renderPanel() {
  const face = sectionRegistration.options.inject()
  const props = Object.assign({ t: locale.bind() }, face)
  pendingEffects = []
  const tree = flatten(runComponent(sectionRegistration.component, props), [])
  const queued = pendingEffects
  pendingEffects = []
  for (const effect of queued) effect()
  return tree
}

const panelTree = renderPanel()
const panelGroups = findAll(panelTree, function (node) { return String(node.props.className) === 'dml-set-group' })
const panelSwitches = findAll(panelTree, function (node) { return String(node.props.className) === 'dml-set-switch' })
const panelColours = findAll(panelTree, function (node) { return String(node.props.className) === 'dml-set-color' })
const panelSave = findAll(panelTree, function (node) { return node.props.className === 'dml-set-button dml-set-button--save' })
const panelReset = findAll(panelTree, function (node) { return node.props.className === 'dml-set-button dml-set-button--reset' })
console.log('settings page -> groups ' + panelGroups.length + ', switches ' + panelSwitches.length + ', colours ' + panelColours.length + ', save ' + panelSave.length + ', reset ' + panelReset.length)
if (panelGroups.length < 4) { failures += 1; console.log('FAIL  the settings page must render every group') }
if (panelColours.length < 8) { failures += 1; console.log('FAIL  the settings page must render its colour controls') }
if (panelSwitches.length < 5) { failures += 1; console.log('FAIL  the settings page must render its switches') }
if (panelSave.length !== 1 || panelReset.length !== 1) { failures += 1; console.log('FAIL  the settings page must render both action buttons') }
/* The boundary now says so instead of rendering nothing, so a failure has a visible shape. */
const panelCrashed = findAll(panelTree, function (node) { return String(node.props.className) === 'dml-set-crashed' })
if (panelCrashed.length > 0) { failures += 1; console.log('FAIL  the settings page fell back to its crash notice') }

/* The opacity slider must follow the material, which is the whole point of the lock. Two sliders
 * share this class — the seat background one and the popover one — so locate it by its label; an
 * earlier version of this check grabbed the first one and tested the wrong control. */
const menuOpacityLabel = locale.bind()('setMenuOpacity')
const menuSlider = function (tree) {
  return findAll(tree, function (node) {
    return String(node.props.className) === 'dml-set-range-input' && node.props['aria-label'] === menuOpacityLabel
  })[0]
}
appearanceHost.menuMaterial = 'acrylic'
const lockedRange = menuSlider(renderPanel())
const lockedDisabled = lockedRange === undefined ? 'missing' : String(lockedRange.props.disabled)
appearanceHost.menuMaterial = 'none'
const freeRange = menuSlider(renderPanel())
const freeDisabled = freeRange === undefined ? 'missing' : String(freeRange.props.disabled)
console.log('popover opacity slider disabled -> acrylic ' + lockedDisabled + ', none ' + freeDisabled)
if (lockedDisabled !== 'true') { failures += 1; console.log('FAIL  acrylic and mica must disable the opacity slider') }
if (freeDisabled === 'true') { failures += 1; console.log('FAIL  the materials must leave the opacity slider usable under none') }

/* The two sliders are complementary: exactly one is live, depending on the material. */
const strengthLabel = locale.bind()('setMenuMaterialStrength')
const sliderByLabel = function (tree, label) {
  return findAll(tree, function (node) {
    return String(node.props.className) === 'dml-set-range-input' && node.props['aria-label'] === label
  })[0]
}
appearanceHost.menuMaterial = 'none'
const strengthOff = String(sliderByLabel(renderPanel(), strengthLabel).props.disabled)
appearanceHost.menuMaterial = 'acrylic'
const strengthOn = String(sliderByLabel(renderPanel(), strengthLabel).props.disabled)
appearanceHost.menuMaterial = 'none'
console.log('material strength slider disabled -> none ' + strengthOff + ', acrylic ' + strengthOn)
if (strengthOff !== 'true') { failures += 1; console.log('FAIL  the strength slider must be unusable under none') }
if (strengthOn === 'true') { failures += 1; console.log('FAIL  the strength slider must be usable for a material') }

/* restore defaults clears what is *stored*, so it must not be hostage to the draft state — tied to
 * the dirty flag it sat permanently greyed out, which is exactly what was reported. */
const resetButton = findAll(panelTree, function (node) { return node.props.className === 'dml-set-button dml-set-button--reset' })[0]
console.log('restore defaults -> disabled ' + String(resetButton.props.disabled))
if (resetButton.props.disabled === true) { failures += 1; console.log('FAIL  restore defaults must be clickable without staged edits') }
const resetCss = 'dml-set-button--reset{padding:5px 17px;border:1px solid'
if (source.indexOf(resetCss) < 0) { failures += 1; console.log('FAIL  restore defaults must be a bordered transparent button') }

/* The popover belongs to the seat, so it hangs centred on it rather than off one edge. */
const centreNeedle = 'rect.left + rect.width / 2 - width / 2'
if (source.indexOf(centreNeedle) < 0) { failures += 1; console.log('FAIL  the popover must be centred on the trigger') }
const registration = seatRegistration

function makeSnapshot(provider, modelId, effortId, description) {
  return {
    status: 'ready',
    error: null,
    failures: [],
    current: { provider: provider, model: modelId, reasoningEffort: effortId },
    groups: [
      {
        id: provider,
        name: provider,
        models: [{
          id: modelId,
          name: modelId,
          ...(description === undefined ? {} : { description: description }),
          reasoning: {
            defaultEffort: 'medium',
            efforts: [
              { id: 'off', name: 'Off' },
              { id: 'low', name: 'Low' },
              { id: 'medium', name: 'Medium' },
              { id: 'high', name: 'High' },
              { id: 'max', name: 'Max' },
            ],
          },
        }],
      },
      { id: 'deepseek-account', name: 'DeepSeek Account', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }] },
    ],
  }
}

function renderSeat() {
  const face = registration.options.inject('session-1')
  const props = Object.assign({ locked: false, t: locale.bind() }, face)
  pendingEffects = []
  const tree = flatten(runComponent(registration.component, props), [])
  const queued = pendingEffects
  pendingEffects = []
  for (const effect of queued) effect()
  return tree
}

/* ---------- brand recognition ---------- */
const cases = [
  ['deepseek-official', 'deepseek-flash', 'deepseek'],
  ['deepseek-account', 'deepseek-v4-pro', 'deepseek'],
  ['xiaomi', 'mimo-v2.6-pro', 'xiaomi'],
  ['zai', 'glm-4.7', 'glm'],
  ['zhipu', 'glm-5.2', 'glm'],
  ['openai', 'gpt-5', 'openai'],
  ['anthropic', 'claude-sonnet-4', 'claude'],
  ['google', 'gemini-3-pro', 'gemini'],
  ['xai', 'grok-4', 'xai'],
  ['dashscope', 'qwen3-max', 'qwen'],
  ['moonshot', 'kimi-k2', 'kimi'],
  ['minimax', 'abab-7', 'minimax'],
  ['mistral', 'mistral-large', 'mistral'],
  ['meta', 'llama-4-scout', 'meta'],
  ['volcengine', 'doubao-seed-2', 'doubao'],
  ['openrouter', 'some-upstream-model', 'openrouter'],
  ['mystery-vendor', 'unknown-model-9', 'generic'],
]

for (const entry of cases) {
  snapshot = makeSnapshot(entry[0], entry[1], 'medium')
  records = new WeakMap()
  const tree = renderSeat()
  const marks = findAll(tree, function (node) { return node.type === 'svg' && node.props['data-brand'] !== undefined })
  const brand = marks.length === 0 ? '(none)' : marks[0].props['data-brand']
  const ok = brand === entry[2]
  if (!ok) failures += 1
  console.log((ok ? 'ok  ' : 'FAIL') + '  ' + entry[0] + '/' + entry[1] + ' -> ' + brand + (ok ? '' : ' (expected ' + entry[2] + ')'))
}

/* ---------- the popover: model rows carry marks, effort is a slider ---------- */
snapshot = makeSnapshot('zai', 'glm-4.7', 'medium')
records = new WeakMap()
let tree = renderSeat()
const trigger = findAll(tree, function (node) { return node.props.className === 'dml-trigger' })[0]
if (trigger === undefined) throw new Error('trigger not rendered')
const triggerText = textOf(trigger)
console.log('trigger text: ' + JSON.stringify(triggerText))
if (!triggerText.includes('glm-4.7')) { failures += 1; console.log('FAIL  trigger does not show the model name') }
if (!triggerText.includes('Medium')) { failures += 1; console.log('FAIL  trigger does not show the effort label') }

// open the seat the way a click would
trigger.props.onClick()
tree = renderSeat()
if (findAll(tree, function (node) { return node.props.className === 'dml-menu' }).length !== 1) {
  failures += 1
  throw new Error('clicking the trigger did not open the popover')
}
const menu = findAll(tree, function (node) { return node.props.className === 'dml-menu' })[0]
if (menu === undefined) { failures += 1; console.log('FAIL  popover did not render when open') } else {
  const rows = findAll(tree, function (node) { return node.props.className === 'dml-option' })
  console.log('model rows: ' + rows.length)
  if (rows.length !== 2) { failures += 1; console.log('FAIL  expected 2 model rows') }
  for (const row of rows) {
    const mark = findAll([row], function (node) { return node.type === 'svg' && node.props['data-brand'] !== undefined })[0]
    if (mark === undefined) { failures += 1; console.log('FAIL  a model row has no brand mark') }
  }
  const slider = findAll(tree, function (node) { return node.props.className === 'dml-slider' })[0]
  if (slider === undefined) { failures += 1; console.log('FAIL  effort slider missing') } else {
    console.log('slider: role=' + slider.props.role + ' max=' + slider.props['aria-valuemax'] + ' now=' + slider.props['aria-valuenow'] + ' text=' + slider.props['aria-valuetext'])
    if (slider.props.role !== 'slider') { failures += 1; console.log('FAIL  slider role missing') }
    if (slider.props['aria-valuemax'] !== 4) { failures += 1; console.log('FAIL  slider should expose 5 discrete steps') }
    // keyboard commit to the top step
    slider.props.onKeyDown({ key: 'End', preventDefault: function () {}, stopPropagation: function () {} })
    console.log('after End key, select() calls: ' + JSON.stringify(selections))
    if (selections.length !== 1 || selections[0].reasoningEffort !== 'max') {
      failures += 1
      console.log('FAIL  End key did not commit the top effort')
    }
  }
}

/* ---------- native viewBox per brand: the GLM mark is 64x64, the rest are 24x24 ---------- */
snapshot = makeSnapshot('zai', 'glm-4.7', 'medium')
records = new WeakMap()
tree = renderSeat()
const glmMark = findAll(tree, function (node) { return node.type === 'svg' && node.props['data-brand'] === 'glm' })[0]
if (glmMark === undefined) { failures += 1; console.log('FAIL  the glm brand mark did not render') } else {
  console.log('glm mark viewBox: ' + glmMark.props.viewBox)
  if (glmMark.props.viewBox !== '0 0 64 64') { failures += 1; console.log('FAIL  glm mark must keep its native 64x64 viewBox') }
}
snapshot = makeSnapshot('deepseek-official', 'deepseek-flash', 'medium')
records = new WeakMap()
tree = renderSeat()
const dsMark = findAll(tree, function (node) { return node.type === 'svg' && node.props['data-brand'] === 'deepseek' })[0]
if (dsMark === undefined || dsMark.props.viewBox !== '0 0 24 24') { failures += 1; console.log('FAIL  deepseek mark should stay on 0 0 24 24') }
else console.log('deepseek mark viewBox: ' + dsMark.props.viewBox)

/* ---------- every model row carries one short Chinese note, echoed on hover ---------- */
const noteCases = [
  ['xiaomi', 'mimo-v2.6-pro-ultraspeed', '极速版，延迟最低，适合交互密集'],
  ['zai', 'glm-5.3-flash', '轻快版，响应更快，适合日常批量'],
  ['zai', 'glm-4.7', '标准版，能力与成本均衡'],
  ['deepseek-official', 'deepseek-v4-pro', '编码与推理更强，适合复杂任务'],
]
let englishLeak = false
for (const entry of noteCases) {
  snapshot = makeSnapshot(entry[0], entry[1], 'medium', 'English host copy that must not win')
  records = new WeakMap()
  tree = renderSeat()
  findAll(tree, function (node) { return node.props.className === 'dml-trigger' })[0].props.onClick()
  tree = renderSeat()
  const rows = findAll(tree, function (node) { return node.props.className === 'dml-option' })
  const row = rows.filter(function (candidate) { return textOf(candidate).indexOf(entry[1]) >= 0 })[0]
  const noteNode = row === undefined ? undefined : findAll([row], function (node) { return node.props.className === 'dml-option-note' })[0]
  const text = noteNode === undefined ? '' : textOf(noteNode)
  const hover = noteNode === undefined ? '' : String(noteNode.props.title)
  const rowHover = row === undefined ? '' : String(row.props.title)
  const ok = text === entry[2] && hover === entry[2] && rowHover.indexOf(entry[2]) >= 0
  if (!ok) failures += 1
  console.log((ok ? 'ok  ' : 'FAIL') + '  ' + entry[0] + '/' + entry[1] + ' -> ' + JSON.stringify(text) + (ok ? '' : ' (expected ' + JSON.stringify(entry[2]) + ')'))
  if (allText(tree).indexOf('English host copy') >= 0) englishLeak = true
}
const englishRejected = !englishLeak
console.log('english host copy replaced: ' + englishRejected)
if (!englishRejected) { failures += 1; console.log('FAIL  english host copy must not survive into the list') }

/* a Chinese description the user wrote wins over the derived note */
snapshot = makeSnapshot('custom-vendor', 'custom-x1', 'medium', '我自己写的中文说明')
records = new WeakMap()
tree = renderSeat()
findAll(tree, function (node) { return node.props.className === 'dml-trigger' })[0].props.onClick()
tree = renderSeat()
const customRow = findAll(tree, function (node) { return node.props.className === 'dml-option' })
  .filter(function (candidate) { return textOf(candidate).indexOf('custom-x1') >= 0 })[0]
const customNote = customRow === undefined ? '' : textOf(customRow)
const customOk = customNote.indexOf('我自己写的中文说明') >= 0
console.log((customOk ? 'ok  ' : 'FAIL') + '  user-authored Chinese description is kept')
if (!customOk) { failures += 1; console.log('FAIL  a Chinese description must win over the derived note') }

/* ---------- the search box filters the catalogue ---------- */
const effortLadder = {
  defaultEffort: 'medium',
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'low', name: 'Low' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max' },
  ],
}
const manyModels = {
  status: 'ready',
  error: null,
  failures: [],
  current: { provider: 'zai', model: 'glm-4.7', reasoningEffort: 'medium' },
  groups: [
    { id: 'deepseek-official', name: 'DeepSeek', models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning: effortLadder },
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', reasoning: effortLadder },
    ] },
    { id: 'zai', name: 'zai', models: [
      { id: 'glm-4.7', name: 'GLM-4.7', reasoning: effortLadder },
      { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', reasoning: effortLadder },
    ] },
  ],
}
const countRows = function (nodes) {
  return findAll(nodes, function (node) { return node.props.className === 'dml-option' }).length
}
const menuHeightOf = function (nodes) {
  const menu = findAll(nodes, function (node) { return node.props.className === 'dml-menu' })[0]
  return menu === undefined ? '' : String(menu.props.style.height === undefined ? '' : menu.props.style.height)
}
snapshot = manyModels
records = new WeakMap()
let searchTree = renderSeat()
findAll(searchTree, function (node) { return node.props.className === 'dml-trigger' })[0].props.onClick()
searchTree = renderSeat()
searchTree = renderSeat()
const typeSearch = function (value) {
  const inputs = findAll(searchTree, function (node) { return node.props.className === 'dml-search-input' })
  if (inputs.length !== 1) throw new Error('expected exactly one search input, got ' + inputs.length)
  inputs[0].props.onChange({ target: { value: value } })
  searchTree = renderSeat()
  return countRows(searchTree)
}
if (countRows(searchTree) !== 4) { failures += 1; console.log('FAIL  expected 4 rows before filtering') }
else console.log('ok    search box present, 4 rows before filtering')
const heightAtOpen = menuHeightOf(searchTree)
console.log('ok    popover adopts its natural height: ' + JSON.stringify(heightAtOpen))
if (heightAtOpen !== '420px') { failures += 1; console.log('FAIL  the popover should take the measured natural height') }
const byName = typeSearch('glm')
const heightAfterFilter = menuHeightOf(searchTree)
console.log('popover height while filtering: ' + JSON.stringify(heightAfterFilter))
if (heightAfterFilter !== heightAtOpen) { failures += 1; console.log('FAIL  filtering must not resize the popover') }
const bySuffix = typeSearch('flash')
const byProvider = typeSearch('zai')
console.log('rows -> "glm": ' + byName + ', "flash": ' + bySuffix + ', provider "zai": ' + byProvider)
if (byName !== 2 || bySuffix !== 2 || byProvider !== 2) { failures += 1; console.log('FAIL  filtering by model name / suffix / provider id must all narrow to 2 rows') }
const noneRows = typeSearch('zzz')
const noMatchCopy = allText(searchTree).indexOf('没有匹配的模型') >= 0
console.log('rows for "zzz": ' + noneRows + ', no-match copy: ' + noMatchCopy)
if (noneRows !== 0 || !noMatchCopy) { failures += 1; console.log('FAIL  an unmatched query must show the empty-filter copy') }
const restored = typeSearch('')
console.log('rows after clearing the filter: ' + restored)
if (restored !== 4) { failures += 1; console.log('FAIL  clearing the filter must restore every row') }

/* ---------- a background refresh must not shove the list ---------- */
snapshot = Object.assign({}, manyModels, { status: 'loading' })
records = new WeakMap()
let refreshTree = renderSeat()
findAll(refreshTree, function (node) { return node.props.className === 'dml-trigger' })[0].props.onClick()
refreshTree = renderSeat()
refreshTree = renderSeat()
const rowsWhileRefreshing = countRows(refreshTree)
const noticeLeaked = allText(refreshTree).indexOf('正在刷新模型列表') >= 0
console.log('refreshing with content -> rows: ' + rowsWhileRefreshing + ', status line: ' + noticeLeaked)
if (noticeLeaked) { failures += 1; console.log('FAIL  a refresh must not inject a status line into a populated list') }
if (rowsWhileRefreshing !== 4) { failures += 1; console.log('FAIL  rows must stay put while the catalogue refreshes') }

/* an empty catalogue still reports that it is loading */
snapshot = { status: 'loading', error: null, failures: [], current: null, groups: [] }
records = new WeakMap()
let emptyTree = renderSeat()
findAll(emptyTree, function (node) { return node.props.className === 'dml-trigger' })[0].props.onClick()
emptyTree = renderSeat()
emptyTree = renderSeat()
const emptyNotice = allText(emptyTree).indexOf('正在刷新模型列表') >= 0
console.log((emptyNotice ? 'ok  ' : 'FAIL') + '  an empty catalogue still shows the loading notice')
if (!emptyNotice) { failures += 1; console.log('FAIL  an empty catalogue must still report loading') }

/* ---------- picking a model keeps the seat open so effort stays one click away ---------- */
const menuCount = function (nodes) {
  return findAll(nodes, function (node) { return node.props.className === 'dml-menu' }).length
}
snapshot = manyModels
records = new WeakMap()
selections.length = 0
let seat = renderSeat()
findAll(seat, function (node) { return node.props.className === 'dml-trigger' })[0].props.onClick()
seat = renderSeat()
seat = renderSeat()
if (menuCount(seat) !== 1) throw new Error('seat should be open before the pick')
const pickedRow = findAll(seat, function (node) { return node.props.className === 'dml-option' })
  .filter(function (row) { return textOf(row).indexOf('GLM-5.3-Flash') >= 0 })[0]
if (pickedRow === undefined) throw new Error('target model row missing')
pickedRow.props.onClick()
/* While the commit settles, the row must keep its looks: the native `disabled` attribute would
 * make the UA grey out the brand mark and the model name for that instant. */
const settlingTree = renderSeat()
const settlingRow = findAll(settlingTree, function (node) { return node.props.className === 'dml-option' })
  .filter(function (row) { return textOf(row).indexOf('GLM-5.3-Flash') >= 0 })[0]
const settlingTrigger = findAll(settlingTree, function (node) { return node.props.className === 'dml-trigger' })[0]
const nativeDisabled = settlingRow === undefined ? 'row-missing' : String(settlingRow.props.disabled)
const ariaDisabled = settlingRow === undefined ? 'n/a' : String(settlingRow.props['aria-disabled'])
console.log('settling row -> native disabled: ' + nativeDisabled + ', aria-disabled: ' + ariaDisabled)
if (settlingRow === undefined) { failures += 1; console.log('FAIL  the picked row disappeared while settling') }
else {
  if (settlingRow.props.disabled !== undefined) { failures += 1; console.log('FAIL  a settling row must not use native disabled (it greys out the mark and the name)') }
  if (settlingRow.props['aria-disabled'] !== true) { failures += 1; console.log('FAIL  a settling row should still advertise busy via aria-disabled') }
}
if (settlingTrigger !== undefined && settlingTrigger.props.disabled !== false) { failures += 1; console.log('FAIL  a settling commit must not natively disable the trigger') }
/* The commit's busy flag clears from a promise chain; drain it before asserting. */
await new Promise(function (resolve) { setTimeout(resolve, 0) })
seat = renderSeat()
const stayedOpen = menuCount(seat) === 1
console.log((stayedOpen ? 'ok  ' : 'FAIL') + '  the seat stays open after picking a model')
if (!stayedOpen) { failures += 1; console.log('FAIL  picking a model must not dismiss the seat') }
console.log('    select() after the pick: ' + JSON.stringify(selections))
const committedAtOnce = selections.length === 1 && selections[0].provider === 'zai' && selections[0].model === 'glm-5.3-flash'
console.log((committedAtOnce ? 'ok  ' : 'FAIL') + '  the pick commits on click (dismissal applies nothing)')
if (!committedAtOnce) { failures += 1; console.log('FAIL  the pick must commit on click, not on dismiss') }
if (selections.length > 0 && selections[0].reasoningEffort !== 'medium') {
  failures += 1
  console.log('FAIL  the current effort should carry over when the new model supports it')
} else console.log('ok    the effort carries over to the new model')
/* the store now reports the new model; the slider must serve it without reopening */
snapshot = Object.assign({}, manyModels, { current: { provider: 'zai', model: 'glm-5.3-flash', reasoningEffort: 'medium' } })
seat = renderSeat()
const seatSlider = findAll(seat, function (node) { return node.props.className === 'dml-slider' })[0]
if (seatSlider === undefined) { failures += 1; console.log('FAIL  the slider should be serving the newly picked model') } else {
  seatSlider.props.onKeyDown({ key: 'End', preventDefault: function () {}, stopPropagation: function () {} })
  console.log('    select() after the effort change: ' + JSON.stringify(selections))
  const sameSession = selections.length === 2 && selections[1].model === 'glm-5.3-flash' && selections[1].reasoningEffort === 'max'
  console.log((sameSession ? 'ok  ' : 'FAIL') + '  effort is adjustable inside the same open seat')
  if (!sameSession) { failures += 1; console.log('FAIL  the effort change must reuse the same seat') }
}
const beforeDismiss = selections.length
findAll(seat, function (node) { return node.props.className === 'dml-trigger' })[0].props.onClick()
seat = renderSeat()
if (menuCount(seat) !== 0) { failures += 1; console.log('FAIL  clicking the trigger should dismiss the seat') }
if (selections.length !== beforeDismiss) { failures += 1; console.log('FAIL  dismissing must not commit anything by itself') }
else console.log('ok    dismissing only dismisses')

/* ---------- geometry and palette of the reworked slider ---------- */
snapshot = makeSnapshot('zai', 'glm-4.7', 'medium')
records = new WeakMap()
tree = renderSeat()
findAll(tree, function (node) { return node.props.className === 'dml-trigger' })[0].props.onClick()
tree = renderSeat()
const fillNode = findAll(tree, function (node) { return node.props.className === 'dml-slider-fill' })[0]
const fillStyle = fillNode === undefined ? {} : fillNode.props.style
console.log('fill style: ' + JSON.stringify(fillStyle))
if (!/^[0-9.]+px$/.test(String(fillStyle.width))) { failures += 1; console.log('FAIL  fill width must be an absolute px length (rail bleed + ratio)') }
if (!/^[0-9.]+px 100%$/.test(String(fillStyle.backgroundSize))) { failures += 1; console.log('FAIL  the gradient must span the whole rail') }
const endsInside = source.includes(".dml-slider-rail{position:absolute;top:50%;left:-13px;right:-13px;")
  && source.includes(".dml-slider-range{position:relative;height:34px;margin:0 13px}")
console.log('rail bleeds 13px past the tick range: ' + endsInside)
if (!endsInside) { failures += 1; console.log('FAIL  the rail must extend past both end ticks') }
const width = source.includes('width:min(275px,calc(100vw - 24px))')
console.log('popover width 275px (85% of 324px): ' + width)
if (!width) { failures += 1; console.log('FAIL  popover width must be 275px') }
const ramp = source.includes('#38bdf8') && source.includes('#a855f7')
console.log('effort ramp runs low colour -> purple: ' + ramp)
if (!ramp) { failures += 1; console.log('FAIL  the effort gradient must run from the low colour to purple') }

/* ---------- every appearance setting reaches the seat ---------- */
const countByClass = function (nodes, className) {
  return findAll(nodes, function (node) { return node.props.className === className }).length
}
const appearanceFace = registration.options.inject('session-1').appearance
if (appearanceFace === undefined) throw new Error('the seat face must carry the appearance store')
for (const key of Object.keys(appearanceHost)) delete appearanceHost[key]

snapshot = manyModels
records = new WeakMap()
let lookTree = renderSeat()
findAll(lookTree, function (node) { return node.props.className === 'dml-trigger' })[0].props.onClick()
lookTree = renderSeat()
const defaultsOk = countByClass(lookTree, 'dml-brand') === 1
  && countByClass(lookTree, 'dml-option-brand') === 4
  && countByClass(lookTree, 'dml-option-note') === 4
console.log('defaults -> trigger mark ' + countByClass(lookTree, 'dml-brand') + ', row marks ' + countByClass(lookTree, 'dml-option-brand') + ', notes ' + countByClass(lookTree, 'dml-option-note'))
if (!defaultsOk) { failures += 1; console.log('FAIL  every mark and note should show by default') }

/* The resting and hover tints must both be concrete colours composed in JS. Handing the job to CSS
 * color-mix() with a var() percentage silently drops the declaration — no background, no hover. */
const defaultTrigger = findAll(lookTree, function (node) { return node.props.className === 'dml-trigger' })[0]
const defaultBg = String(defaultTrigger.props.style['--dml-trigger-bg'])
const defaultBgHover = String(defaultTrigger.props.style['--dml-trigger-bg-hover'])
const alphaOf = function (value) {
  const found = /\/\s*([0-9.]+)\)$/.exec(value)
  return found === null ? NaN : Number(found[1])
}
console.log('default trigger bg -> ' + defaultBg + '   hover -> ' + defaultBgHover)
if (!/^rgb\(\d+ \d+ \d+ \/ [0-9.]+\)$/.test(defaultBg)) {
  failures += 1
  console.log('FAIL  the resting tint must be a concrete rgb() value computed in JS')
}
if (!/^rgb\(\d+ \d+ \d+ \/ [0-9.]+\)$/.test(defaultBgHover)) {
  failures += 1
  console.log('FAIL  the hover tint must be a concrete rgb() value computed in JS')
}
/* The shipped opacity is already 100%, so there is no alpha headroom left: the hover can only
 * come from the colour, and that is what has to differ. */
if (defaultBg === defaultBgHover) {
  failures += 1
  console.log('FAIL  hover must differ from the resting tint even at full opacity')
}

appearanceHost.listLogo = false
appearanceHost.listNote = false
lookTree = renderSeat()
const listOff = countByClass(lookTree, 'dml-option-brand') === 0 && countByClass(lookTree, 'dml-option-note') === 0
console.log('list marks/notes off -> ' + countByClass(lookTree, 'dml-option-brand') + '/' + countByClass(lookTree, 'dml-option-note'))
if (!listOff) { failures += 1; console.log('FAIL  listLogo/listNote=false must drop every row mark and note') }

appearanceHost.triggerLogo = false
appearanceHost.triggerTint = '#ff0000'
appearanceHost.triggerOpacity = 30
lookTree = renderSeat()
const lookTrigger = findAll(lookTree, function (node) { return node.props.className === 'dml-trigger' })[0]
const triggerOk = countByClass(lookTree, 'dml-brand') === 0
  && String(lookTrigger.props.style['--dml-trigger-bg']) === 'rgb(255 0 0 / 0.3)'
console.log('trigger -> mark ' + countByClass(lookTree, 'dml-brand') + ', style ' + JSON.stringify(lookTrigger.props.style))
if (triggerOk !== true) { failures += 1; console.log('FAIL  the trigger mark and background must follow the settings') }

/* The reported failure, reproduced: a user had saved opacity 100%, so "raise the opacity on hover"
 * had no headroom left and hovering changed nothing. Hover must differ regardless. */
appearanceHost.triggerTint = '#2c2c2e'
appearanceHost.triggerOpacity = 100
lookTree = renderSeat()
const maxedTrigger = findAll(lookTree, function (node) { return node.props.className === 'dml-trigger' })[0]
const maxedBg = String(maxedTrigger.props.style['--dml-trigger-bg'])
const maxedHover = String(maxedTrigger.props.style['--dml-trigger-bg-hover'])
console.log('opacity 100% -> bg ' + maxedBg + '   hover ' + maxedHover)
if (maxedBg === maxedHover) {
  failures += 1
  console.log('FAIL  hover must differ even when the opacity is already maxed out')
}
/* ...but it has to stay a lift. A proportional blend jumped 33 channels here and looked glaring,
 * so the step is fixed and this bound keeps it that way. */
const meanChannel = function (value) {
  const found = /^rgb\((\d+) (\d+) (\d+)/.exec(value)
  return found === null ? NaN : (Number(found[1]) + Number(found[2]) + Number(found[3])) / 3
}
const hoverLift = meanChannel(maxedHover) - meanChannel(maxedBg)
console.log('maxed hover lift -> ' + hoverLift.toFixed(1) + ' channels (want a gentle 4-20)')
if (!(hoverLift >= 4 && hoverLift <= 20)) {
  failures += 1
  console.log('FAIL  the hover lift must be clearly visible but gentle')
}

appearanceHost.sliderGradient = false
appearanceHost.sliderSolid = '#123456'
lookTree = renderSeat()
const solidFill = findAll(lookTree, function (node) { return node.props.className === 'dml-slider-fill' })[0]
console.log('slider solid -> ' + JSON.stringify(solidFill.props.style))
if (solidFill.props.style.backgroundColor !== '#123456') { failures += 1; console.log('FAIL  gradient off must paint the configured solid colour') }

appearanceHost.sliderGradient = true
appearanceHost.sliderFrom = '#111111'
appearanceHost.sliderTo = '#222222'
lookTree = renderSeat()
const rampFill = findAll(lookTree, function (node) { return node.props.className === 'dml-slider-fill' })[0]
const rampImage = String(rampFill.props.style.backgroundImage)
console.log('slider ramp -> ' + rampImage)
if (!(rampImage.indexOf('#111111') >= 0 && rampImage.indexOf('#222222') >= 0)) { failures += 1; console.log('FAIL  the gradient must use both configured colours') }

/* ---------- text colours, search visibility and the popover surface ---------- */
appearanceHost.triggerLabelColor = '#ff0000'
appearanceHost.triggerEffortColor = '#00ff00'
appearanceHost.showSearch = false
appearanceHost.menuMaterial = 'acrylic'
appearanceHost.menuMaterialStrength = 20
appearanceHost.menuTint = '#123456'
appearanceHost.menuOpacity = 80
lookTree = renderSeat()
const styledTrigger = findAll(lookTree, function (node) { return node.props.className === 'dml-trigger' })[0]
const styledMenu = findAll(lookTree, function (node) { return node.props.className === 'dml-menu' })[0]
const styledSearch = findAll(lookTree, function (node) { return node.props.className === 'dml-search' })
console.log('text colours -> label ' + styledTrigger.props.style['--dml-trigger-label'] + ', effort ' + styledTrigger.props.style['--dml-trigger-effort'])
if (styledTrigger.props.style['--dml-trigger-label'] !== '#ff0000') { failures += 1; console.log('FAIL  the model name colour must reach the trigger') }
if (styledTrigger.props.style['--dml-trigger-effort'] !== '#00ff00') { failures += 1; console.log('FAIL  the effort colour must reach the trigger') }
console.log('search box rows when hidden -> ' + styledSearch.length)
if (styledSearch.length !== 0) { failures += 1; console.log('FAIL  showSearch=false must drop the search box') }
const menuFill = String(styledMenu.props.style['--dsw-menu-surface-fill'])
const menuFilter = String(styledMenu.props.style['--dsw-menu-backdrop-filter'])
console.log('acrylic@20 -> fill ' + menuFill + ', filter ' + menuFilter)
if (menuFilter.indexOf('blur') < 0) { failures += 1; console.log('FAIL  the acrylic preset must supply a backdrop blur') }

/* Strength means "how much material", so raising it must thin the fill and deepen the blur. The
 * first cut had it backwards: the fill thickened as the slider rose, so 0 looked like the strongest
 * setting and 100 looked like "none". */
appearanceHost.menuMaterialStrength = 90
lookTree = renderSeat()
const strongMenu = findAll(lookTree, function (node) { return node.props.className === 'dml-menu' })[0]
const strongFill = String(strongMenu.props.style['--dsw-menu-surface-fill'])
const strongFilter = String(strongMenu.props.style['--dsw-menu-backdrop-filter'])
console.log('acrylic strength 20 -> 90 : fill ' + menuFill + ' -> ' + strongFill + ', filter ' + menuFilter + ' -> ' + strongFilter)
if (!(alphaOf(strongFill) < alphaOf(menuFill))) { failures += 1; console.log('FAIL  raising the material strength must let more through, not less') }
/* Every term flips together. Fixing only the fill left the blur running the other way, so the top
 * of the slider came out hazier than the old bottom ever was — the two ends have to swap wholesale. */
const blurOf = function (value) {
  const found = /blur\((\d+)px\)/.exec(value)
  return found === null ? NaN : Number(found[1])
}
console.log('blur at strength 20 vs 90 -> ' + blurOf(menuFilter) + 'px vs ' + blurOf(strongFilter) + 'px')
if (!(blurOf(strongFilter) < blurOf(menuFilter))) {
  failures += 1
  console.log('FAIL  the blur must thin as the strength rises, together with the fill')
}
if (strongFilter === menuFilter) { failures += 1; console.log('FAIL  the strength slider must change the filter at all') }

/* Mica sweeps the same way, over a wider range, so the slider is actually felt. */
appearanceHost.menuMaterial = 'mica'
appearanceHost.menuMaterialStrength = 10
lookTree = renderSeat()
const weakMica = findAll(lookTree, function (node) { return node.props.className === 'dml-menu' })[0]
const weakMicaFill = String(weakMica.props.style['--dsw-menu-surface-fill'])
appearanceHost.menuMaterialStrength = 90
lookTree = renderSeat()
const micaMenu = findAll(lookTree, function (node) { return node.props.className === 'dml-menu' })[0]
const micaFill = String(micaMenu.props.style['--dsw-menu-surface-fill'])
const micaFilter = String(micaMenu.props.style['--dsw-menu-backdrop-filter'])
console.log('mica strength 10 -> 90 : fill ' + weakMicaFill + ' -> ' + micaFill + ', filter ' + micaFilter)
if (!(alphaOf(micaFill) < alphaOf(weakMicaFill))) { failures += 1; console.log('FAIL  raising the mica strength must let more through') }
if (!(alphaOf(weakMicaFill) >= 0.9)) { failures += 1; console.log('FAIL  mica at low strength should be nearly solid') }
if (micaFilter.indexOf('blur') < 0) { failures += 1; console.log('FAIL  mica must carry a large blur') }

/* And zero must be the weakest setting, not the strongest: nearly solid, barely any blur. */
appearanceHost.menuMaterial = 'acrylic'
appearanceHost.menuMaterialStrength = 0
lookTree = renderSeat()
const zeroMenu = findAll(lookTree, function (node) { return node.props.className === 'dml-menu' })[0]
console.log('acrylic at strength 0 -> fill ' + String(zeroMenu.props.style['--dsw-menu-surface-fill']) + ', filter ' + String(zeroMenu.props.style['--dsw-menu-backdrop-filter']))
if (!(alphaOf(String(zeroMenu.props.style['--dsw-menu-surface-fill'])) >= 0.75)) { failures += 1; console.log('FAIL  strength 0 must be nearly solid, not the strongest setting') }

/* "None" leaves the density to the opacity slider — the job the removed "transparent" preset had,
 * and the reason removing it costs nothing. */
appearanceHost.menuMaterial = 'none'
appearanceHost.menuOpacity = 40
appearanceHost.showSearch = true
lookTree = renderSeat()
const clearMenu = findAll(lookTree, function (node) { return node.props.className === 'dml-menu' })[0]
const clearFill = String(clearMenu.props.style['--dsw-menu-surface-fill'])
console.log('none with opacity 40 -> fill ' + clearFill + ', search rows ' + findAll(lookTree, function (node) { return node.props.className === 'dml-search' }).length)
if (clearFill !== 'rgb(18 52 86 / 0.4)') { failures += 1; console.log('FAIL  "none" must let the opacity slider drive the fill') }
if (findAll(lookTree, function (node) { return node.props.className === 'dml-search' }).length !== 1) { failures += 1; console.log('FAIL  the search box must come back when showSearch is true') }

/* The mark colour only means anything while the mark itself is shown. */
appearanceHost.menuMaterial = 'none'
appearanceHost.triggerLogo = false
lookTree = renderSeat()
const marksWhenOff = findAll(lookTree, function (node) { return node.props.className === 'dml-brand' }).length
console.log('trigger marks with the mark switched off -> ' + marksWhenOff)
if (marksWhenOff !== 0) { failures += 1; console.log('FAIL  hiding the mark must drop it from the trigger') }
appearanceHost.triggerLogo = true
lookTree = renderSeat()
const logoColour = String(findAll(lookTree, function (node) { return node.props.className === 'dml-trigger' })[0].props.style['--dml-trigger-logo'])
console.log('trigger mark colour -> ' + logoColour)
if (logoColour !== '#ffffff') { failures += 1; console.log('FAIL  the mark colour must reach the trigger (default white)') }

/* restore-defaults must be a real action, not an absent callback */
const resetKind = typeof panelFace.appearanceActions.reset
console.log('restore defaults action -> ' + resetKind)
if (resetKind !== 'function') { failures += 1; console.log('FAIL  the settings page needs a working restore-defaults action') }

/* ---------- settings action row ---------- */
/* The page renders its own shell so the two buttons can share one row: restore-defaults sits to
 * the left of save, which stays flush right. */
const actionsAt = source.indexOf("className: 'dml-set-actions'")
const resetAt = source.indexOf('dml-set-button--reset')
const saveAt = source.indexOf('dml-set-button--save')
console.log('action row -> container@' + actionsAt + ', reset@' + resetAt + ', save@' + saveAt)
if (!(actionsAt > 0 && resetAt > actionsAt && saveAt > resetAt)) {
  failures += 1
  console.log('FAIL  restore-defaults must sit to the left of save in one action row')
}
if (source.indexOf("'.dml-set-actions{display:flex;align-items:center;justify-content:flex-end") < 0) {
  failures += 1
  console.log('FAIL  the action row must be flushed right')
}
if (source.indexOf("t('setResetHint')") >= 0) {
  failures += 1
  console.log('FAIL  the restore button must not carry a hint line any more')
}
if (source.indexOf("className: 'dml-set-button dml-set-button--save'") < 0
  || source.indexOf("className: 'dml-set-button dml-set-button--reset'") < 0) {
  failures += 1
  console.log('FAIL  both action buttons must share one style, with a different colour for reset')
}

/* ---------- no glow at the maximum step ---------- */
const css = source
for (const banned of ['max-flash', 'max-pulse', 'max-sweep', 'data-max']) {
  if (css.includes(banned)) { failures += 1; console.log('FAIL  maximum-level glow artefact still present: ' + banned) }
}
console.log('glow artefacts: none')

console.log(failures === 0 ? '\nSMOKE OK' : '\nSMOKE FAILED (' + failures + ')')
process.exit(failures === 0 ? 0 : 1)
