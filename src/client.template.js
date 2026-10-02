/**
 * dsh-model-seat — browser half (source template; tools/build.mjs turns this
 * into client.js, the file the client loader evaluates).
 *
 * It shadows the built-in composer model seat ('conversation.input.model') at a lower
 * priority and renders its own presentation over the SAME per-session ModelDirectory:
 *   - the trigger leads with the current model's brand mark;
 *   - the popover lists models grouped by provider, each row leading with its brand mark;
 *   - reasoning effort becomes a discrete slider (no top-level glow).
 */
window.__ModuleLoader__.load({
  id: 'dsh-model-seat',
  factory: function (require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const MenuSurface = primitives.MenuSurface
    const SettingsForm = primitives.SettingsForm
    const SettingsFormModel = primitives.SettingsFormModel
    const h = React.createElement

/* @MODEL_LOGOS@ */

    /** Neutral mark for a provider we have no artwork for: a four-point spark. */
    const GENERIC_MARK = 'M12 1.6 14.35 9.65 22.4 12 14.35 14.35 12 22.4 9.65 14.35 1.6 12 9.65 9.65Z'

    /**
     * Rail bleed in px, equal to the thumb radius: the rail runs this far past both ends
     * of the tick range, so the first/last ticks and the thumb sit inside the rail
     * instead of hanging over its edge. CSS mirrors this value as -13px.
     */
    const TRACK_BLEED = 13

    /** Host entry id of this plugin — also the settings namespace its Config is served under. */
    const ENTRY_ID = 'model-seat'

    /** Every colour setting is a plain #rrggbb string. */
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

    /**
     * Fallbacks mirror the host schema defaults, so the seat still renders correctly on a
     * deployment that never composed the settings service.
     */
    const APPEARANCE_FALLBACK = {
      triggerLogo: true,
      triggerLogoColor: '#ffffff',
      triggerTint: '#343436',
      triggerOpacity: 100,
      /* Empty keeps the theme's own label colours. */
      triggerLabelColor: '',
      triggerEffortColor: '',
      showSearch: true,
      /* Popover surface: a material preset plus an optional colour that overrides its fill. */
      menuMaterial: 'none',
      menuMaterialStrength: 50,
      menuTint: '#343436',
      menuOpacity: 92,
      listLogo: true,
      listNote: true,
      sliderGradient: true,
      sliderSolid: '#4f8ef7',
      sliderFrom: '#38bdf8',
      sliderTo: '#a855f7',
    }

    /* ---- field conversion specs: one text control each, as the shared form model expects ---- */

    /**
     * Popover surface presets.
     *
     * DSH's own menu surface is *already* blurred and translucent, so a preset that only added
     * another backdrop-filter changed nothing visible — which is why acrylic and mica looked
     * inert. A preset has to own the fill outright *and* change the filter decisively.
     *
     * A separate "transparent" preset used to sit beside "none"; once the fill follows the colour
     * and opacity sliders the two were indistinguishable, so it was one option too many.
     *
     * - none: nothing of its own; the fill follows the colour and opacity sliders.
     * - acrylic / mica: pin their own fill and filter, scaled by the strength slider, which is why
     *   the plain opacity slider is disabled for them rather than silently ignored.
     */
    const MATERIAL_PRESETS = {
      none: { locked: false },
      acrylic: { locked: true },
      mica: { locked: true },
    }
    const MATERIAL_KEYS = ['none', 'acrylic', 'mica']

    /**
     * The surface recipe for a preset at a given strength (0-100).
     *
     * Strength means how much *material* you get, not how dense the fill is: a stronger material
     * lets more of what sits behind it show through, and blurs it harder. The first cut ran the
     * other way — the fill thickened as the slider rose, so 0 looked like the strongest setting
     * and 100 looked like "none". Hence the subtraction below.
     *
     * Mica is the Windows 11 window material: a heavily blurred tint that only hints at what is
     * behind it. Large blur, thinning fill.
     */
    const materialRecipe = function (key, strength) {
      const amount = Math.max(0, Math.min(100, Number(strength))) / 100
      if (key === 'acrylic') {
        return {
          /* 0 -> 80% (nearly solid, barely a material), 100 -> 22% (clearly frosted). */
          fillOpacity: 80 - amount * 58,
          filter: 'blur(' + Math.round(10 + amount * 26) + 'px) saturate(' + Math.round(130 + amount * 90) + '%)',
        }
      }
      if (key === 'mica') {
        return {
          /* 0 -> 96% , 100 -> 62%: a much wider sweep than before, so the slider is felt. */
          fillOpacity: 96 - amount * 34,
          filter: 'blur(' + Math.round(40 + amount * 60) + 'px) saturate(' + Math.round(115 + amount * 50) + '%)',
        }
      }
      return { fillOpacity: null, filter: '' }
    }

    const boolSpec = function (field) {
      return {
        field: field,
        /* An unset field formats as blank so the reader falls back to the schema default. */
        format: function (value) { return value === undefined ? '' : value === true ? 'true' : 'false' },
        parse: function (text) {
          const trimmed = String(text).trim()
          /* Blank is how "restore defaults" clears a field. */
          if (trimmed === '') return { kind: 'clear' }
          return { kind: 'set', value: trimmed === 'true' }
        },
      }
    }

    const materialSpec = function (field) {
      return {
        field: field,
        format: function (value) { return typeof value === 'string' && MATERIAL_KEYS.indexOf(value) >= 0 ? value : 'none' },
        parse: function (text) {
          const trimmed = String(text).trim()
          if (trimmed === '') return { kind: 'clear' }
          return MATERIAL_KEYS.indexOf(trimmed) >= 0 ? { kind: 'set', value: trimmed } : undefined
        },
      }
    }

    const colorSpec = function (field) {
      return {
        field: field,
        format: function (value) { return typeof value === 'string' && HEX_COLOR.test(value) ? value : '' },
        parse: function (text) {
          const trimmed = String(text).trim()
          if (trimmed === '') return { kind: 'clear' }
          return HEX_COLOR.test(trimmed) ? { kind: 'set', value: trimmed } : undefined
        },
      }
    }

    const opacitySpec = function (field) {
      return {
        field: field,
        format: function (value) { return typeof value === 'number' ? String(value) : '' },
        parse: function (text) {
          const trimmed = String(text).trim()
          if (trimmed === '') return { kind: 'clear' }
          const parsed = Number(trimmed)
          return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? { kind: 'set', value: parsed } : undefined
        },
      }
    }

    /** '#rrggbb' -> [r, g, b]. */
    const channelsOf = function (hex) {
      const value = parseInt(hex.slice(1), 16)
      return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
    }

    /**
     * A concrete colour at the requested opacity.
     *
     * The tint is composed here rather than with CSS color-mix(): a color-mix() whose percentage
     * slot holds a var() does not apply at all (every color-mix inside DSH itself uses a literal),
     * which silently dropped the whole declaration — no resting background, and nothing for :hover
     * to step up from.
     */
    const tintAt = function (hex, percent) {
      const rgb = channelsOf(hex)
      /* Rounded to two decimals: the raw quotient produced values like 0.27799999999999997, which
       * then went straight into the CSS. */
      const alpha = Number((Math.max(0, Math.min(100, percent)) / 100).toFixed(2))
      return 'rgb(' + rgb[0] + ' ' + rgb[1] + ' ' + rgb[2] + ' / ' + alpha + ')'
    }

    /**
     * Move a colour toward another by a fixed per-channel step, in whichever direction the two lie.
     *
     * The step is clamped rather than proportional: a proportional blend scales with how far apart
     * the colours happen to be, so the same setting looked subtle on one palette and glaring on
     * another — the hover jumped from #2c2c2e to #4d5056 on dark. A fixed step reads as the same
     * gentle lift everywhere.
     */
    const liftToward = function (from, to, step) {
      const a = channelsOf(from)
      const b = channelsOf(to)
      const parts = [0, 1, 2].map(function (index) {
        const delta = b[index] - a[index]
        const moved = a[index] + Math.max(-step, Math.min(step, delta))
        return ('0' + Math.max(0, Math.min(255, moved)).toString(16)).slice(-2)
      })
      return '#' + parts.join('')
    }

    /**
     * The theme foreground as a concrete #rrggbb, so "follow the theme" still yields a value this
     * script can do arithmetic on. Falls back to a mid grey when nothing readable is available.
     */
    const themeForeground = function () {
      if (typeof window === 'undefined' || typeof document === 'undefined' || typeof window.getComputedStyle !== 'function') return '#8b93a1'
      let raw = ''
      try {
        /* getPropertyValue() on a custom property yields its token stream (often another var()),
         * not a resolved colour. A probe element's computed colour is what var() substitution
         * actually produced, which is the value this maths needs. */
        const probe = document.createElement('span')
        probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;color:var(--dsw-alias-label-primary)'
        document.body.appendChild(probe)
        raw = window.getComputedStyle(probe).color.trim()
        probe.remove()
      } catch (error) {
        return '#8b93a1'
      }
      if (HEX_COLOR.test(raw)) return raw
      const match = /^rgba?\(([^)]+)\)$/.exec(raw)
      if (match !== null) {
        const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number)
        if (parts.length >= 3 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && Number.isFinite(parts[2])) {
          const byte = function (value) { return ('0' + Math.round(Math.max(0, Math.min(255, value))).toString(16)).slice(-2) }
          return '#' + byte(parts[0]) + byte(parts[1]) + byte(parts[2])
        }
      }
      return '#8b93a1'
    }

    /**
     * Read the form snapshot into values the seat can apply directly. Drafts count, so an edit
     * previews on the same paint that stages it; anything unreadable falls back to the default.
     */
    const readAppearance = function (state) {
      const textOf = function (name) {
        const entry = state === undefined || state === null ? undefined : state[name]
        return entry === undefined || entry === null || entry.text === undefined ? '' : String(entry.text)
      }
      const boolOf = function (name) {
        const raw = textOf(name)
        return raw === '' ? APPEARANCE_FALLBACK[name] : raw === 'true'
      }
      const colorOf = function (name) {
        const raw = textOf(name)
        return HEX_COLOR.test(raw) ? raw : APPEARANCE_FALLBACK[name]
      }
      const opacityOf = function (name) {
        const text = textOf(name)
        /* An unset field reads as blank, and Number('') is 0 — treat blank as "use the default". */
        if (text === '') return APPEARANCE_FALLBACK[name]
        const raw = Number(text)
        return Number.isFinite(raw) ? clamp(raw, 0, 100) : APPEARANCE_FALLBACK[name]
      }
      const materialOf = function (name) {
        const raw = textOf(name)
        return MATERIAL_KEYS.indexOf(raw) >= 0 ? raw : APPEARANCE_FALLBACK[name]
      }
      return {
        triggerLogo: boolOf('triggerLogo'),
        triggerLogoColor: colorOf('triggerLogoColor'),
        triggerTint: colorOf('triggerTint'),
        triggerOpacity: opacityOf('triggerOpacity'),
        triggerLabelColor: colorOf('triggerLabelColor'),
        triggerEffortColor: colorOf('triggerEffortColor'),
        showSearch: boolOf('showSearch'),
        menuMaterial: materialOf('menuMaterial'),
        menuMaterialStrength: opacityOf('menuMaterialStrength'),
        menuTint: colorOf('menuTint'),
        menuOpacity: opacityOf('menuOpacity'),
        listLogo: boolOf('listLogo'),
        listNote: boolOf('listNote'),
        sliderGradient: boolOf('sliderGradient'),
        sliderSolid: colorOf('sliderSolid'),
        sliderFrom: colorOf('sliderFrom'),
        sliderTo: colorOf('sliderTo'),
      }
    }

    /**
     * One short Chinese line per model row. The Host only ships copy for its own two
     * DeepSeek models (and in English), while every third-party provider arrives bare, so
     * the list reads its own note: an exact override first, a Chinese description the user
     * wrote themselves next, then a role phrase derived from the id suffix.
     */
    const MODEL_NOTES = {
      'deepseek-v4-flash': '快速经济，适合常规与并行任务',
      'deepseek-v4-pro': '编码与推理更强，适合复杂任务',
      'deepseek-chat': '通用对话，适合日常问答与写作',
      'deepseek-reasoner': '深度推理，擅长数学与代码',
    }

    /** id token -> role phrase, most specific first. */
    const ROLE_NOTES = [
      ['ultraspeed', '极速版，延迟最低，适合交互密集'],
      ['highspeed', '高速版，吞吐优先，适合高并发'],
      ['flash', '轻快版，响应更快，适合日常批量'],
      ['turbo', '加速版，为速度优化，兼顾能力'],
      ['mini', '轻量版，体积小、成本低'],
      ['lite', '轻量版，体积小、成本低'],
      ['max', '旗舰版，能力上限最高'],
      ['pro', '增强版，能力更强，适合复杂任务'],
      ['plus', '增强版，能力更强，适合复杂任务'],
    ]

    /** Neutral line for a model whose id carries no role suffix. */
    const DEFAULT_NOTE = '标准版，能力与成本均衡'

    const hasHan = function (value) {
      return /[\u3400-\u9fff]/.test(value)
    }

    /** Resolve the short Chinese line shown under one model name. */
    const noteFor = function (model) {
      const id = String(model === undefined || model.id === undefined ? '' : model.id).toLowerCase()
      const exact = MODEL_NOTES[id]
      if (exact !== undefined) return exact
      const host = model.description
      if (typeof host === 'string' && host !== '' && hasHan(host)) return host
      const tokens = id.split(/[^a-z0-9]+/)
      for (let index = 0; index < ROLE_NOTES.length; index += 1) {
        if (tokens.indexOf(ROLE_NOTES[index][0]) >= 0) return ROLE_NOTES[index][1]
      }
      return DEFAULT_NOTE
    }

    /**
     * Brand recognition. Provider id wins over model id because a provider names its
     * vendor directly, while a model id is the fallback signal; the last pass catches
     * vendor names glued into a longer token (for example "mimo" or "chatglm").
     */
    const BRAND_RULES = [
      ['deepseek', ['deepseek', 'deep-seek']],
      ['glm', ['glm', 'zhipu', 'zai', 'chatglm', 'glmv', 'bigmodel']],
      ['xiaomi', ['xiaomi', 'mimo', 'redmi']],
      ['openai', ['openai', 'gpt', 'chatgpt', 'codex', 'davinci']],
      ['claude', ['anthropic', 'claude', 'sonnet', 'opus', 'haiku']],
      ['gemini', ['google', 'gemini', 'gemma', 'palm', 'vertex']],
      ['xai', ['xai', 'grok']],
      ['qwen', ['qwen', 'tongyi', 'dashscope', 'qwq', 'bailian']],
      ['kimi', ['kimi', 'moonshot']],
      ['minimax', ['minimax', 'abab', 'hailuo']],
      ['mistral', ['mistral', 'codestral', 'magistral', 'devstral', 'pixtral']],
      ['meta', ['meta', 'llama']],
      ['nvidia', ['nvidia', 'nemotron']],
      ['perplexity', ['perplexity', 'sonar']],
      ['groq', ['groq']],
      ['cohere', ['cohere']],
      ['openrouter', ['openrouter']],
      ['ollama', ['ollama']],
      ['huggingface', ['huggingface']],
      ['together', ['together']],
      ['siliconcloud', ['siliconcloud', 'siliconflow']],
      ['stepfun', ['stepfun']],
      ['baidu', ['baidu', 'ernie', 'wenxin']],
      ['doubao', ['doubao', 'bytedance', 'volcengine', 'seed']],
      ['hunyuan', ['hunyuan', 'tencent']],
      ['yi', ['yi', 'zero-one', '01ai']],
      ['spark', ['spark', 'iflytek', 'xinghuo']],
      ['baichuan', ['baichuan']],
      ['azure', ['azure']],
      ['microsoft', ['microsoft', 'copilot']],
      ['bedrock', ['bedrock', 'amazon', 'aws', 'nova']],
      ['snowflake', ['snowflake']],
      ['replicate', ['replicate']],
      ['cloudflare', ['cloudflare', 'workers-ai']],
      ['ai21', ['ai21', 'jamba']],
      ['alibaba', ['alibaba', 'aliyun']],
      ['databricks', ['databricks', 'dbrx']],
      ['ibm', ['ibm', 'granite', 'watson']],
      ['modelscope', ['modelscope']],
    ]

    const clamp = function (value, min, max) {
      return Math.max(min, Math.min(max, value))
    }

    const tokensOf = function (value) {
      return String(value === undefined || value === null ? '' : value)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
    }

    /** Resolve the brand mark for one provider/model pair, or undefined when unknown. */
    const brandOf = function (providerId, modelId) {
      const provider = String(providerId === undefined || providerId === null ? '' : providerId).toLowerCase()
      const model = String(modelId === undefined || modelId === null ? '' : modelId).toLowerCase()
      const providerTokens = new Set(tokensOf(provider))
      const modelTokens = new Set(tokensOf(model))
      let index = 0
      for (index = 0; index < BRAND_RULES.length; index += 1) {
        const keys = BRAND_RULES[index][1]
        for (let k = 0; k < keys.length; k += 1) if (providerTokens.has(keys[k])) return BRAND_RULES[index][0]
      }
      for (index = 0; index < BRAND_RULES.length; index += 1) {
        const keys = BRAND_RULES[index][1]
        for (let k = 0; k < keys.length; k += 1) if (modelTokens.has(keys[k])) return BRAND_RULES[index][0]
      }
      for (index = 0; index < BRAND_RULES.length; index += 1) {
        const keys = BRAND_RULES[index][1]
        for (let k = 0; k < keys.length; k += 1) {
          const key = keys[k]
          if (key.length >= 4 && (provider.indexOf(key) >= 0 || model.indexOf(key) >= 0)) return BRAND_RULES[index][0]
        }
      }
      return undefined
    }

    /** One brand mark (or the neutral spark) as an inline, currentColor-filled SVG. */
    function BrandMark(props) {
      const brand = brandOf(props.provider, props.model)
      const entry = brand === undefined ? undefined : LOGOS[brand]
      const paths = entry === undefined ? [GENERIC_MARK] : entry[0]
      const evenOdd = entry === undefined ? 0 : entry[1]
      const viewBox = entry === undefined || entry[2] === undefined ? '0 0 24 24' : entry[2]
      const children = []
      for (let index = 0; index < paths.length; index += 1) {
        const attrs = { key: index, d: paths[index], fill: 'currentColor' }
        if (evenOdd === 1) attrs.fillRule = 'evenodd'
        children.push(h('path', attrs))
      }
      return h('svg', {
        className: props.className,
        viewBox: viewBox,
        'aria-hidden': 'true',
        focusable: 'false',
        'data-brand': brand === undefined ? 'generic' : brand,
      }, children)
    }

    function Chevron(props) {
      return h('svg', {
        className: 'dml-chevron',
        'data-open': props.open === true,
        viewBox: '0 0 24 24',
        'aria-hidden': 'true',
        focusable: 'false',
      }, h('path', {
        d: 'm7 9.5 5 5 5-5',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: '2',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    function CheckMark() {
      return h('svg', {
        className: 'dml-option-check',
        viewBox: '0 0 24 24',
        'aria-hidden': 'true',
        focusable: 'false',
      }, h('path', {
        d: 'M4.8 12.6 9.6 17.4 19.2 6.6',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: '2.2',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    /** The round thumb's pointer-tracking discrete slider, without any maximum-level glow. */
    function EffortSlider(props) {
      const efforts = props.efforts
      const disabled = props.disabled === true
      /* Falling back to the defaults keeps the slider renderable on its own. */
      const look = props.look === undefined || props.look === null ? readAppearance(undefined) : props.look
      const rangeRef = React.useRef(null)
      const draggingRef = React.useRef(false)
      const [dragging, setDragging] = React.useState(false)
      const [trackWidth, setTrackWidth] = React.useState(0)
      const lastIndex = Math.max(1, efforts.length - 1)
      const shownIndex = clamp(Math.round(props.index), 0, lastIndex)

      /* Measured range width; the optimistic default only covers the first paint. */
      const track = trackWidth > 0 ? trackWidth : 220

      const ratioFor = function (value) {
        return efforts.length <= 1 ? 0 : clamp(value / lastIndex, 0, 1)
      }

      const positionForIndex = function (value) {
        return (ratioFor(value) * 100) + '%'
      }

      /* The fill starts at the rail's left edge and ends on the active tick's centre. */
      const fillWidthFor = function (value) {
        return (TRACK_BLEED + ratioFor(value) * track) + 'px'
      }

      React.useLayoutEffect(function () {
        const range = rangeRef.current
        if (range === null) return undefined
        const measure = function () {
          const width = range.getBoundingClientRect().width
          if (width <= 0) return
          setTrackWidth(function (previous) { return Math.abs(previous - width) < 0.5 ? previous : width })
        }
        measure()
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(measure)
          observer.observe(range)
          return function () { observer.disconnect() }
        }
        window.addEventListener('resize', measure)
        return function () { window.removeEventListener('resize', measure) }
      }, [])

      const positionFor = function (clientX) {
        const range = rangeRef.current
        if (range === null || efforts.length <= 1) return 0
        const rect = range.getBoundingClientRect()
        return clamp((clientX - rect.left) / Math.max(1, rect.width) * lastIndex, 0, lastIndex)
      }

      const snap = function (position) {
        return clamp(Math.round(position), 0, lastIndex)
      }

      const onPointerDown = function (event) {
        if (disabled) return
        event.preventDefault()
        event.stopPropagation()
        if (event.currentTarget.setPointerCapture !== undefined) event.currentTarget.setPointerCapture(event.pointerId)
        draggingRef.current = true
        setDragging(true)
        props.onChange(snap(positionFor(event.clientX)))
      }

      const onPointerMove = function (event) {
        if (!draggingRef.current) return
        props.onChange(snap(positionFor(event.clientX)))
      }

      const finishPointer = function (event) {
        if (!draggingRef.current) return
        const next = snap(positionFor(event.clientX))
        draggingRef.current = false
        setDragging(false)
        props.onChange(next)
        props.onCommit(next)
        if (event.currentTarget.hasPointerCapture !== undefined && event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }

      const commit = function (next) {
        const target = clamp(next, 0, lastIndex)
        if (target === shownIndex) return
        props.onChange(target)
        props.onCommit(target)
      }

      const onKeyDown = function (event) {
        if (disabled) return
        let next = null
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = shownIndex + 1
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = shownIndex - 1
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = lastIndex
        if (next === null) return
        event.preventDefault()
        event.stopPropagation()
        commit(next)
      }

      const children = [
        h('span', { key: 'rail', className: 'dml-slider-rail' }),
        h('span', {
          key: 'fill',
          className: 'dml-slider-fill',
          style: Object.assign(
            { width: fillWidthFor(shownIndex) },
            look.sliderGradient
              ? {
                  /* The gradient spans the whole rail and the fill merely reveals it, so the
                   * visible colour reports the level rather than being squeezed into the fill. */
                  backgroundImage: 'linear-gradient(90deg, ' + look.sliderFrom + ' 0%, ' + look.sliderTo + ' 100%)',
                  backgroundSize: (track + TRACK_BLEED * 2) + 'px 100%',
                }
              : {
                  backgroundImage: 'none',
                  backgroundColor: look.sliderSolid,
                },
          ),
        }),
      ]
      for (let index = 0; index < efforts.length; index += 1) {
        children.push(h('span', {
          key: 'tick-' + efforts[index].id,
          className: 'dml-slider-tick',
          'data-active': index <= shownIndex,
          'data-major': index === shownIndex,
          style: { left: positionForIndex(index) },
          title: efforts[index].description,
        }))
      }
      children.push(h('span', { key: 'thumb', className: 'dml-slider-thumb', style: { left: positionForIndex(shownIndex) } }))

      return h('div', {
        className: 'dml-slider',
        'data-dragging': dragging,
        role: 'slider',
        tabIndex: disabled ? -1 : 0,
        'aria-label': props.label,
        'aria-valuemin': 0,
        'aria-valuemax': lastIndex,
        'aria-valuenow': shownIndex,
        'aria-valuetext': efforts[shownIndex] === undefined ? '' : efforts[shownIndex].name,
        'aria-disabled': disabled,
        onPointerDown: onPointerDown,
        onPointerMove: onPointerMove,
        onPointerUp: finishPointer,
        onPointerCancel: finishPointer,
        onKeyDown: onKeyDown,
      }, h('div', { className: 'dml-slider-range', ref: rangeRef }, children))
    }

    const MEASURE_STYLE = { visibility: 'hidden', left: 0, top: 0 }

    /**
     * The plugin's own appearance settings. Both the seat and the settings page read this one store,
     * so an edit previews on the seat while the page is still open: drafts are part of the snapshot
     * (`field.text`), and the same gesture persists them through the shared configuration form.
     */
    /** A store that never changes: what the seat reads when no settings runtime is composed. */
    function createStaticAppearanceStore() {
      const projected = {
        shell: { available: false, writable: false, dirty: false, invalid: false, saving: false, failed: false },
      }
      const names = Object.keys(APPEARANCE_FALLBACK)
      for (let index = 0; index < names.length; index += 1) {
        projected[names[index]] = { text: '', overridden: false, invalid: false }
      }
      return {
        getSnapshot: function () { return projected },
        subscribe: function () { return function () {} },
      }
    }

    function createAppearanceFeature(ctx) {
      const forms = ctx.configForms
      /* The seat must keep working on a deployment that never composed the settings service;
       * it then simply renders the schema defaults and reports the form as unavailable. */
      if (forms === undefined || forms === null || typeof forms.get !== 'function') {
        return {
          store: createStaticAppearanceStore(),
          set: function () {},
          commit: function () {},
          discard: function () {},
          reset: function () {},
          dispose: function () {},
        }
      }
      const scope = forms.get(ENTRY_ID)
      const model = new SettingsFormModel(scope, [
        boolSpec('triggerLogo'),
        colorSpec('triggerLogoColor'),
        colorSpec('triggerTint'),
        opacitySpec('triggerOpacity'),
        colorSpec('triggerLabelColor'),
        colorSpec('triggerEffortColor'),
        boolSpec('showSearch'),
        materialSpec('menuMaterial'),
        opacitySpec('menuMaterialStrength'),
        colorSpec('menuTint'),
        opacitySpec('menuOpacity'),
        boolSpec('listLogo'),
        boolSpec('listNote'),
        boolSpec('sliderGradient'),
        colorSpec('sliderSolid'),
        colorSpec('sliderFrom'),
        colorSpec('sliderTo'),
      ])
      const store = model.bind(function () {
        const projected = { shell: model.shell() }
        const names = Object.keys(APPEARANCE_FALLBACK)
        for (let index = 0; index < names.length; index += 1) projected[names[index]] = model.field(names[index])
        return projected
      })
      return {
        store: store,
        /** Stage one field; the seat repaints from the draft immediately. */
        set: function (field, text) {
          model.actions().edit(field, text)
        },
        /** Persist every staged field to the Host settings document. */
        commit: function () {
          model.actions().save()
        },
        /**
         * Drop every staged edit. The shared form calls this from its unmount effect, so it must
         * be a function: passing undefined here crashed the whole Settings seat on close.
         */
        discard: function () {
          model.actions().discard()
        },
        /** Clear every override in one write, so the schema defaults (and the theme) apply again. */
        reset: function () {
          const names = Object.keys(APPEARANCE_FALLBACK)
          for (let index = 0; index < names.length; index += 1) model.actions().edit(names[index], '')
          model.actions().save()
        },
        dispose: function () {
          model.dispose()
        },
      }
    }

    /** One labelled row: copy on the left, control on the right. */
    function SettingRow(props) {
      return h('div', { className: 'dml-set-row' }, [
        h('div', { key: 'copy', className: 'dml-set-copy' }, [
          h('span', { key: 'label', className: 'dml-set-label' }, props.label),
          props.hint === undefined ? null : h('span', { key: 'hint', className: 'dml-set-hint' }, props.hint),
        ]),
        h('div', { key: 'control', className: 'dml-set-control' }, props.children),
      ])
    }

    /** A switch in the settings panel's own idiom. */
    function SettingSwitch(props) {
      return h('button', {
        type: 'button',
        role: 'switch',
        className: 'dml-set-switch',
        'aria-checked': props.checked === true,
        'aria-label': props.label,
        disabled: props.disabled === true,
        onClick: function () { props.onChange(props.checked !== true) },
      }, h('span', { className: 'dml-set-switch-knob' }))
    }

    /** A colour well with its hex readback; the well is the control, the hex is the receipt. */
    function SettingColor(props) {
      return h('div', { className: 'dml-set-color' }, [
        h('input', {
          key: 'well',
          type: 'color',
          className: 'dml-set-color-well',
          value: props.value,
          'aria-label': props.label,
          disabled: props.disabled === true,
          onChange: function (event) { props.onChange(event.target.value) },
        }),
        h('code', { key: 'hex', className: 'dml-set-color-hex' }, props.value.toUpperCase()),
      ])
    }

    /** A small segmented control for a fixed set of presets. */
    function SettingChoice(props) {
      return h('div', {
        className: 'dml-set-choice',
        role: 'radiogroup',
        'aria-label': props.label,
      }, props.options.map(function (option) {
        return h('button', {
          key: option.value,
          type: 'button',
          role: 'radio',
          className: 'dml-set-choice-item',
          'aria-checked': option.value === props.value,
          disabled: props.disabled === true,
          onClick: function () {
            if (option.value !== props.value) props.onChange(option.value)
          },
        }, option.label)
      }))
    }

    /** One option group inside the settings page. */
    function SettingGroup(props) {
      return h('section', { className: 'dml-set-group' }, [
        h('h4', { key: 'title', className: 'dml-set-group-title' }, props.title),
        h('div', { key: 'rows', className: 'dml-set-rows' }, props.children),
      ])
    }

    /**
     * The `settings.section` page for this plugin.
     *
     * Every control writes straight through: a switch or colour commits on the same gesture, while
     * a range drag stages (live preview on the seat) and commits when the drag ends.
     */
    function SettingsPanel(props) {
      const t = props.t
      const state = React.useSyncExternalStore(
        React.useCallback(function (listener) { return props.appearance.subscribe(listener) }, [props.appearance]),
        React.useCallback(function () { return props.appearance.getSnapshot() }, [props.appearance]),
      )
      const look = readAppearance(state)
      const shell = state !== undefined && state !== null && state.shell !== undefined
        ? state.shell
        : { available: false, writable: false, dirty: false, invalid: false, saving: false, failed: false }
      const writable = shell.writable === true

      /* The page renders its own shell now, so dropping staged drafts on unmount is its own job:
       * the shared form used to do it, and losing that would leave edits staged after leaving. */
      React.useEffect(function () {
        return function () { props.appearanceActions.discard() }
      }, [props.appearanceActions])

      /* The opacity slider only applies to the presets that do not pin their own fill. The seat
       * computes this too; the settings page needs its own copy (referencing the seat's would be a
       * ReferenceError, which is exactly what blanked this page). */
      const material = MATERIAL_PRESETS[look.menuMaterial] === undefined ? MATERIAL_PRESETS.none : MATERIAL_PRESETS[look.menuMaterial]
      const opacityLocked = material.locked === true
      /* The two sliders are complementary: "none" owns its density via opacity, the materials own
       * theirs via strength. Exactly one of them is live at a time. */
      const strengthLocked = material.locked !== true

      const stage = function (field, text) { props.appearanceActions.set(field, text) }
      const commit = function (field, text) {
        props.appearanceActions.set(field, text)
        props.appearanceActions.commit()
      }

      return h('div', { className: 'dml-set-form' }, [
        shell.available === false
          ? h('p', { key: 'unavailable', className: 'dml-set-note' }, t('setUnavailable'))
          : null,
        shell.writable === false
          ? h('p', { key: 'readonly', className: 'dml-set-note' }, t('setReadOnly'))
          : null,
        h(SettingGroup, { key: 'trigger', title: t('setGroupTrigger') }, [
          h(SettingRow, { key: 'logo', label: t('setTriggerLogo'), hint: t('setTriggerLogoHint') },
            h(SettingSwitch, {
              label: t('setTriggerLogo'),
              checked: look.triggerLogo,
              disabled: !writable,
              onChange: function (next) { commit('triggerLogo', next ? 'true' : 'false') },
            })),
          h(SettingRow, { key: 'logoColor', label: t('setTriggerLogoColor'), hint: t('setTriggerLogoColorHint') },
            h(SettingColor, {
              label: t('setTriggerLogoColor'),
              value: look.triggerLogoColor,
              /* Meaningless while the mark itself is hidden, so it reads as unavailable. */
              disabled: !writable || look.triggerLogo !== true,
              onChange: function (next) { commit('triggerLogoColor', next) },
            })),
          h(SettingRow, { key: 'tint', label: t('setTriggerBackground'), hint: t('setTriggerBackgroundHint') },
            h(SettingColor, {
              label: t('setTriggerBackground'),
              value: look.triggerTint === '' ? '#8b93a1' : look.triggerTint,
              disabled: !writable,
              onChange: function (next) { commit('triggerTint', next) },
            })),
          h(SettingRow, { key: 'labelColor', label: t('setTriggerLabelColor'), hint: t('setTriggerLabelColorHint') },
            h(SettingColor, {
              label: t('setTriggerLabelColor'),
              value: look.triggerLabelColor === '' ? '#8b93a1' : look.triggerLabelColor,
              disabled: !writable,
              onChange: function (next) { commit('triggerLabelColor', next) },
            })),
          h(SettingRow, { key: 'effortColor', label: t('setTriggerEffortColor'), hint: t('setTriggerEffortColorHint') },
            h(SettingColor, {
              label: t('setTriggerEffortColor'),
              value: look.triggerEffortColor === '' ? '#8b93a1' : look.triggerEffortColor,
              disabled: !writable,
              onChange: function (next) { commit('triggerEffortColor', next) },
            })),
          h(SettingRow, { key: 'opacity', label: t('setTriggerOpacity'), hint: t('setTriggerOpacityHint') },
            h('div', { className: 'dml-set-range' }, [
              h('input', {
                key: 'slider',
                type: 'range',
                min: 0,
                max: 100,
                step: 1,
                className: 'dml-set-range-input',
                value: look.triggerOpacity,
                'aria-label': t('setTriggerOpacity'),
                disabled: !writable,
                onInput: function (event) { stage('triggerOpacity', event.target.value) },
                onChange: function (event) { commit('triggerOpacity', event.target.value) },
              }),
              h('span', { key: 'value', className: 'dml-set-range-value' }, look.triggerOpacity + '%'),
            ])),
        ]),
        h(SettingGroup, { key: 'menu', title: t('setGroupMenu') }, [
          h(SettingRow, { key: 'material', label: t('setMenuMaterial'), hint: t('setMenuMaterialHint') },
            h(SettingChoice, {
              label: t('setMenuMaterial'),
              value: look.menuMaterial,
              disabled: !writable,
              options: [
                { value: 'none', label: t('materialNone') },
                { value: 'acrylic', label: t('materialAcrylic') },
                { value: 'mica', label: t('materialMica') },
              ],
              onChange: function (next) { commit('menuMaterial', next) },
            })),
          h(SettingRow, { key: 'tint', label: t('setMenuTint'), hint: t('setMenuTintHint') },
            h(SettingColor, {
              label: t('setMenuTint'),
              value: look.menuTint === '' ? '#8b93a1' : look.menuTint,
              disabled: !writable,
              onChange: function (next) { commit('menuTint', next) },
            })),
          h(SettingRow, { key: 'opacity', label: t('setMenuOpacity'), hint: opacityLocked ? t('setMenuOpacityLocked') : t('setMenuOpacityHint') },
            h('div', { className: 'dml-set-range' }, [
              h('input', {
                key: 'slider',
                type: 'range',
                min: 0,
                max: 100,
                step: 1,
                className: 'dml-set-range-input',
                value: look.menuOpacity,
                'aria-label': t('setMenuOpacity'),
                disabled: !writable || opacityLocked,
                onInput: function (event) { stage('menuOpacity', event.target.value) },
                onChange: function (event) { commit('menuOpacity', event.target.value) },
              }),
              h('span', { key: 'value', className: 'dml-set-range-value' }, look.menuOpacity + '%'),
            ])),
          h(SettingRow, { key: 'strength', label: t('setMenuMaterialStrength'), hint: strengthLocked ? t('setMenuMaterialStrengthLocked') : t('setMenuMaterialStrengthHint') },
            h('div', { className: 'dml-set-range' }, [
              h('input', {
                key: 'slider',
                type: 'range',
                min: 0,
                max: 100,
                step: 1,
                className: 'dml-set-range-input',
                value: look.menuMaterialStrength,
                'aria-label': t('setMenuMaterialStrength'),
                disabled: !writable || strengthLocked,
                onInput: function (event) { stage('menuMaterialStrength', event.target.value) },
                onChange: function (event) { commit('menuMaterialStrength', event.target.value) },
              }),
              h('span', { key: 'value', className: 'dml-set-range-value' }, look.menuMaterialStrength + '%'),
            ])),
        ]),
        h(SettingGroup, { key: 'list', title: t('setGroupList') }, [
          h(SettingRow, { key: 'search', label: t('setShowSearch'), hint: t('setShowSearchHint') },
            h(SettingSwitch, {
              label: t('setShowSearch'),
              checked: look.showSearch,
              disabled: !writable,
              onChange: function (next) { commit('showSearch', next ? 'true' : 'false') },
            })),
          h(SettingRow, { key: 'logo', label: t('setListLogo'), hint: t('setListLogoHint') },
            h(SettingSwitch, {
              label: t('setListLogo'),
              checked: look.listLogo,
              disabled: !writable,
              onChange: function (next) { commit('listLogo', next ? 'true' : 'false') },
            })),
          h(SettingRow, { key: 'note', label: t('setListNote'), hint: t('setListNoteHint') },
            h(SettingSwitch, {
              label: t('setListNote'),
              checked: look.listNote,
              disabled: !writable,
              onChange: function (next) { commit('listNote', next ? 'true' : 'false') },
            })),
        ]),
        h(SettingGroup, { key: 'slider', title: t('setGroupSlider') }, [
          h(SettingRow, { key: 'gradient', label: t('setSliderGradient'), hint: t('setSliderGradientHint') },
            h(SettingSwitch, {
              label: t('setSliderGradient'),
              checked: look.sliderGradient,
              disabled: !writable,
              onChange: function (next) { commit('sliderGradient', next ? 'true' : 'false') },
            })),
          h(SettingRow, { key: 'solid', label: t('setSliderSolid'), hint: t('setSliderSolidHint') },
            h(SettingColor, {
              label: t('setSliderSolid'),
              value: look.sliderSolid,
              disabled: !writable,
              onChange: function (next) { commit('sliderSolid', next) },
            })),
          h(SettingRow, { key: 'from', label: t('setSliderFrom') },
            h(SettingColor, {
              label: t('setSliderFrom'),
              value: look.sliderFrom,
              disabled: !writable,
              onChange: function (next) { commit('sliderFrom', next) },
            })),
          h(SettingRow, { key: 'to', label: t('setSliderTo') },
            h(SettingColor, {
              label: t('setSliderTo'),
              value: look.sliderTo,
              disabled: !writable,
              onChange: function (next) { commit('sliderTo', next) },
            })),
        ]),
        h('div', { key: 'actions', className: 'dml-set-actions' }, [
          shell.failed === true
            ? h('span', { key: 'failed', className: 'dml-set-failed' }, t('setSaveFailed'))
            : null,
          h('button', {
            key: 'reset',
            type: 'button',
            className: 'dml-set-button dml-set-button--reset',
            /* Not tied to the draft state: it clears what is *stored*, so it is meaningful even
             * with nothing staged — which is why it looked permanently disabled before. */
            disabled: !writable,
            onClick: function () { props.appearanceActions.reset() },
          }, t('setReset')),
          h('button', {
            key: 'save',
            type: 'button',
            className: 'dml-set-button dml-set-button--save',
            disabled: !writable || shell.dirty !== true || shell.invalid === true,
            onClick: function () { props.appearanceActions.commit() },
          }, shell.saving === true ? t('setSaving') : t('setSave')),
        ]),
      ])
    }

    /**
     * The settings page renders INSIDE the shell's own 'sidebar.settings' seat, so an exception in
     * this subtree takes the whole Settings entry down with it — the seat disappears and cannot be
     * reopened until the app restarts. Guard the page: a failure here must cost at most the page.
     */
    class SettingsPanelBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      render() {
        /* Say something rather than rendering nothing: a silent null is indistinguishable from a
         * page that simply has no content, which is how a scoped reference error once shipped as a
         * completely blank settings panel. */
        if (this.state.failed !== true) return this.props.children
        return h('p', { className: 'dml-set-crashed' }, this.props.message)
      }
    }

    /** The guarded page the shell actually registers. */
    function GuardedSettingsPanel(props) {
      return h(SettingsPanelBoundary, { message: props.t('setCrashed') }, h(SettingsPanel, props))
    }

    /** The composer model seat: logo trigger plus the grouped model list and effort slider. */
    function ModelSeat(props) {
      const available = props.available !== false
      const directory = props.directory
      const load = props.load
      const select = props.select
      const t = props.t

      const subscribe = React.useCallback(function (listener) { return directory.subscribe(listener) }, [directory])
      const read = React.useCallback(function () { return directory.getSnapshot() }, [directory])
      const state = React.useSyncExternalStore(subscribe, read)

      /* Appearance lives in the plugin's own settings section; drafts count, so the seat previews
       * every edit while the settings page is still open. */
      const subscribeLook = React.useCallback(function (listener) { return props.appearance.subscribe(listener) }, [props.appearance])
      const readLook = React.useCallback(function () { return props.appearance.getSnapshot() }, [props.appearance])
      const look = readAppearance(React.useSyncExternalStore(subscribeLook, readLook))
      /* Unset means "follow the theme", resolved to a concrete colour here. */
      const themeTint = themeForeground()
      const triggerTint = look.triggerTint === '' ? themeTint : look.triggerTint
      /* Hover shifts the colour toward the theme foreground as well as raising the opacity: with
       * opacity already at 100% there is no headroom left, and an opacity-only hover would show
       * no change at all. The blend stays small on purpose — a hover should read as a lift, not
       * as a different colour. */
      const triggerTintHover = liftToward(triggerTint, themeTint, 12)

      const [open, setOpen] = React.useState(false)
      const [pos, setPos] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [preview, setPreview] = React.useState(null)
      const [query, setQuery] = React.useState('')
      /**
       * Natural height of the unfiltered card. The list is the only flexible band, so without
       * this the whole card would collapse and re-grow while the user types in the filter.
       */
      const [panelHeight, setPanelHeight] = React.useState(0)

      const rootRef = React.useRef(null)
      const triggerRef = React.useRef(null)
      const menuRef = React.useRef(null)
      const searchRef = React.useRef(null)

      React.useEffect(function () {
        if (available) load()
      }, [available, load])

      /* Opening the seat hands the caret to the filter, so a long catalogue is one keystroke away. */
      React.useEffect(function () {
        if (!open) return
        const node = searchRef.current
        if (node !== null && typeof node.focus === 'function') node.focus()
      }, [open])

      const groups = React.useMemo(function () {
        const list = state !== undefined && state !== null && Array.isArray(state.groups) ? state.groups.slice() : []
        const rank = function (id) {
          return id === 'deepseek-account' ? 0 : id === 'deepseek-official' ? 1 : 2
        }
        return list.sort(function (left, right) { return rank(left.id) - rank(right.id) })
      }, [state])

      const needle = query.trim().toLowerCase()

      /* Filtering keeps the grouped shape; a group survives only through its matching models. */
      const shownGroups = React.useMemo(function () {
        const shown = []
        for (let index = 0; index < groups.length; index += 1) {
          const group = groups[index]
          const models = Array.isArray(group.models) ? group.models : []
          const kept = []
          for (let m = 0; m < models.length; m += 1) {
            const model = models[m]
            if (needle === '') {
              kept.push(model)
              continue
            }
            const haystack = String(model.id) + ' ' + String(model.name === undefined ? '' : model.name) + ' ' + group.id + ' ' + String(group.name === undefined ? '' : group.name)
            if (haystack.toLowerCase().indexOf(needle) >= 0) kept.push(model)
          }
          if (kept.length > 0) shown.push({ group: group, models: kept })
        }
        return shown
      }, [groups, needle])

      const current = state === undefined || state === null ? null : state.current ?? null
      const status = state === undefined || state === null ? 'loading' : state.status
      const failures = state !== undefined && state !== null && Array.isArray(state.failures) ? state.failures : []

      const currentEntry = React.useMemo(function () {
        if (current === null) return undefined
        for (let index = 0; index < groups.length; index += 1) {
          const group = groups[index]
          if (group.id !== current.provider) continue
          const models = Array.isArray(group.models) ? group.models : []
          for (let m = 0; m < models.length; m += 1) {
            if (models[m].id === current.model) return { group: group, model: models[m] }
          }
        }
        return undefined
      }, [groups, current])

      const reasoning = currentEntry === undefined ? undefined : currentEntry.model.reasoning
      const efforts = reasoning !== undefined && Array.isArray(reasoning.efforts) ? reasoning.efforts : []
      const effectiveEffort = current === null ? undefined : current.reasoningEffort ?? reasoning?.defaultEffort
      const selectedIndex = Math.max(0, efforts.findIndex(function (item) { return item.id === effectiveEffort }))
      const shownIndex = preview === null ? selectedIndex : clamp(preview, 0, Math.max(0, efforts.length - 1))
      const shownEffort = efforts[shownIndex]
      const busyNow = busy || props.locked === true

      const closeMenu = React.useCallback(function (restoreFocus) {
        setOpen(false)
        setPreview(null)
        setError(null)
        /* The filter is per-visit: reopening starts from the full catalogue. */
        setQuery('')
        if (restoreFocus === true) {
          const node = triggerRef.current
          if (node !== null) window.requestAnimationFrame(function () { node.focus() })
        }
      }, [])

      React.useEffect(function () {
        if (!open) return undefined
        const onPointerDown = function (event) {
          const target = event.target
          if (!(target instanceof Node)) return
          if (rootRef.current !== null && rootRef.current.contains(target)) return
          if (menuRef.current !== null && menuRef.current.contains(target)) return
          closeMenu(false)
        }
        document.addEventListener('mousedown', onPointerDown, true)
        return function () { document.removeEventListener('mousedown', onPointerDown, true) }
      }, [open, closeMenu])

      React.useLayoutEffect(function () {
        if (!open) {
          setPos(null)
          setPanelHeight(0)
          return undefined
        }
        const place = function () {
          const trigger = triggerRef.current
          const menu = menuRef.current
          if (trigger === null || menu === null) return
          const rect = trigger.getBoundingClientRect()
          const width = menu.offsetWidth
          const height = menu.offsetHeight
          if (width === 0 || height === 0) return
          /* Place runs on open and on catalogue changes — never on a keystroke — and keeps the
           * largest height seen, so filtering can only shrink the list, not the card. */
          setPanelHeight(function (previous) { return height > previous ? height : previous })
          const margin = 12
          const gap = 8
          const maxLeft = Math.max(margin, window.innerWidth - width - margin)
          const maxTop = Math.max(margin, window.innerHeight - height - margin)
          /* Centred on the trigger: the seat is what the panel belongs to, so aligning to its
           * right edge left the panel visibly hanging off to one side. */
          const left = clamp(rect.left + rect.width / 2 - width / 2, margin, maxLeft)
          let top = rect.top - gap - height
          if (top < margin) top = rect.bottom + gap
          setPos({ left: left, top: clamp(top, margin, maxTop) })
        }
        place()
        window.addEventListener('scroll', place, true)
        window.addEventListener('resize', place)
        return function () {
          window.removeEventListener('scroll', place, true)
          window.removeEventListener('resize', place)
        }
      }, [open, state])

      const submit = function (selection, closeAfter) {
        setBusy(true)
        setError(null)
        Promise.resolve(select(selection)).then(function (result) {
          if (result !== undefined && result !== null && result.ok === false) {
            const cause = result.error
            if (cause !== undefined && cause !== null && cause.code === 'session/writer-held') setError(t('errorBusy'))
            else setError(t('errorAction', { message: String((cause === undefined || cause === null ? '' : cause.code + ': ' + cause.message)) }))
            return
          }
          if (closeAfter === true) closeMenu(true)
        }).catch(function (cause) {
          setError(t('errorAction', { message: String(cause !== undefined && cause !== null && cause.message !== undefined ? cause.message : cause) }))
        }).then(function () {
          setBusy(false)
        })
      }

      const chooseModel = function (group, model) {
        if (busyNow) return
        const nextReasoning = model.reasoning
        const nextEfforts = nextReasoning !== undefined && Array.isArray(nextReasoning.efforts) ? nextReasoning.efforts : []
        let effortId
        for (let index = 0; index < nextEfforts.length; index += 1) {
          if (nextEfforts[index].id === effectiveEffort) effortId = effectiveEffort
        }
        if (effortId === undefined && nextReasoning !== undefined && nextReasoning.defaultEffort !== undefined) effortId = nextReasoning.defaultEffort
        if (effortId === undefined && nextEfforts.length > 0) effortId = nextEfforts[Math.floor(nextEfforts.length / 2)].id
        const selection = { provider: group.id, model: model.id }
        if (effortId !== undefined) selection.reasoningEffort = effortId
        /* Stay open. The seat is one stop for both halves of the choice, so the slider that just
         * switched to this model stays reachable without reopening the card. The pick itself is
         * committed immediately: closing the card applies nothing, it only dismisses. */
        submit(selection, false)
      }

      const commitEffort = function (index) {
        const effort = efforts[index]
        if (effort === undefined || busyNow || current === null) return
        if (effort.id === effectiveEffort) {
          setPreview(null)
          return
        }
        setPreview(null)
        submit({ provider: current.provider, model: current.model, reasoningEffort: effort.id }, false)
      }

      /** Esc clears the filter before it closes the seat; arrows step from the box into the list. */
      const onSearchKeyDown = function (event) {
        if (event.key === 'Escape' && query !== '') {
          event.preventDefault()
          event.stopPropagation()
          setQuery('')
          return
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        const menu = menuRef.current
        if (menu === null) return
        const items = Array.prototype.slice.call(menu.querySelectorAll('[data-dml-item]:not([aria-disabled="true"])'))
        if (items.length === 0) return
        event.preventDefault()
        const node = event.key === 'ArrowDown' ? items[0] : items[items.length - 1]
        if (node !== undefined && typeof node.focus === 'function') node.focus()
      }

      const onMenuKeyDown = function (event) {
        if (event.key === 'Escape') {
          event.preventDefault()
          closeMenu(true)
          return
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        const menu = menuRef.current
        if (menu === null) return
        const items = Array.prototype.slice.call(menu.querySelectorAll('[data-dml-item]:not([aria-disabled="true"])'))
        if (items.length === 0) return
        const active = items.indexOf(document.activeElement)
        const step = event.key === 'ArrowDown' ? 1 : -1
        const next = active === -1 ? (step === 1 ? 0 : items.length - 1) : (active + step + items.length) % items.length
        event.preventDefault()
        items[next].focus()
      }

      if (!available) return null

      const modelLabel = currentEntry !== undefined
        ? currentEntry.model.name ?? current.model
        : current === null
          ? (status === 'loading' ? t('loadingModel') : t('unsupportedModel'))
          : current.provider + '/' + current.model
      const effortLabel = reasoning === undefined ? undefined : shownEffort === undefined ? undefined : shownEffort.name
      const ariaLabel = effortLabel === undefined
        ? t('triggerAria', { model: modelLabel })
        : t('triggerAriaEffort', { model: modelLabel, effort: effortLabel })

      /**
       * A refresh caused by a pick (or by the Host republishing the catalogue) must not inject a
       * status line into a populated list: that shoves every row down and bounces the whole card.
       * The notice only appears where there is genuinely nothing to displace.
       */
      const showLoadingNotice = status === 'loading' && shownGroups.length === 0 && needle === ''

      const rows = []
      for (let index = 0; index < shownGroups.length; index += 1) {
        const entry = shownGroups[index]
        const group = entry.group
        const models = entry.models
        const options = []
        for (let m = 0; m < models.length; m += 1) {
          const model = models[m]
          const selected = current !== null && current.provider === group.id && current.model === model.id
          const name = model.name ?? model.id
          const note = noteFor(model)
          options.push(h('button', {
            key: group.id + '/' + model.id,
            type: 'button',
            role: 'option',
            'aria-selected': selected,
            'data-dml-item': 'true',
            className: 'dml-option',
            /* The note is clamped to one line, so hovering anywhere on the row (and on the
             * note itself) echoes it in full. */
            title: name + '\n' + note,
            /* Deliberately NOT the native `disabled`: a commit only lasts a beat, but the UA
             * styling for a disabled button greys out the mark and the name for that instant.
             * Interaction is gated in the handler instead, so the row never changes its looks. */
            'aria-disabled': busyNow,
            onClick: function () { chooseModel(group, model) },
          }, [
            look.listLogo ? h(BrandMark, { key: 'mark', provider: group.id, model: model.id, className: 'dml-option-brand' }) : null,
            h('span', { key: 'copy', className: 'dml-option-copy' }, [
              h('span', { key: 'name', className: 'dml-option-name' }, name),
              look.listNote ? h('span', { key: 'note', className: 'dml-option-note', title: note }, note) : null,
            ]),
            selected ? h('span', { key: 'check', className: 'dml-option-slot' }, h(CheckMark, {})) : h('span', { key: 'check', className: 'dml-option-slot' }),
          ]))
        }
        if (options.length === 0) continue
        rows.push(h('section', { key: group.id, className: 'dml-group' }, [
          h('div', { key: 'title', className: 'dml-group-title' }, group.id === 'deepseek-account' ? t('account') : group.name ?? group.id),
          h('div', { key: 'list', className: 'dml-group-list', role: 'listbox', 'aria-label': group.name ?? group.id }, options),
        ]))
      }

      for (let index = 0; index < failures.length; index += 1) {
        const failure = failures[index]
        rows.push(h('div', { key: 'failure-' + failure.id, className: 'dml-warn' }, [
          h('span', { key: 'text' }, t('providerFailed', {
            name: failure.id === 'deepseek-account' ? t('account') : failure.name ?? failure.id,
            message: failure.message ?? '',
          })),
          h('button', { key: 'retry', type: 'button', className: 'dml-retry', onClick: function () { load() } }, t('retry')),
        ]))
      }

      const panel = efforts.length > 1
        ? h('div', { className: 'dml-effort' }, [
            h('div', { key: 'head', className: 'dml-effort-head' }, [
              h('span', { key: 'label' }, t('effort')),
              h('strong', { key: 'value', className: 'dml-effort-value' }, shownEffort === undefined ? t('effortDefault') : shownEffort.name),
            ]),
            h('div', { key: 'scale', className: 'dml-effort-scale', 'aria-hidden': 'true' }, [
              h('span', { key: 'low' }, t('efficient')),
              h('span', { key: 'high' }, t('capable')),
            ]),
            h(EffortSlider, {
              key: 'slider',
              efforts: efforts,
              index: shownIndex,
              disabled: busyNow,
              label: t('effort'),
              look: look,
              onChange: function (index) { setPreview(index) },
              onCommit: commitEffort,
            }),
          ])
        : reasoning === undefined
          ? null
          : h('div', { className: 'dml-effort' }, h('div', { className: 'dml-effort-single' }, t('effortUnsupported')))

      /* The material preset supplies the backdrop filter (and, when transparent, the fill); a
       * configured colour overrides the fill but keeps the filter, so the two never fight. */
      const material = MATERIAL_PRESETS[look.menuMaterial] === undefined ? MATERIAL_PRESETS.none : MATERIAL_PRESETS[look.menuMaterial]
      const recipe = materialRecipe(look.menuMaterial, look.menuMaterialStrength)
      const menuTintSource = look.menuTint === '' ? APPEARANCE_FALLBACK.menuTint : look.menuTint
      /* A preset owns its own fill density; without one the opacity slider decides. */
      const menuFill = tintAt(menuTintSource, recipe.fillOpacity === null ? look.menuOpacity : recipe.fillOpacity)
      const opacityLocked = material.locked === true
      /* max-height still wins over the floor when the viewport is short. */
      const panelStyle = Object.assign(
        {},
        pos === null ? MEASURE_STYLE : pos,
        pos !== null && panelHeight > 0 ? { height: panelHeight + 'px' } : {},
        /* MenuSurface paints its own material layer from these two custom properties. */
        menuFill === '' ? {} : { '--dsw-menu-surface-fill': menuFill },
        recipe.filter === '' ? {} : { '--dsw-menu-backdrop-filter': recipe.filter },
      )

      const menu = h(MenuSurface, {
        ref: menuRef,
        className: 'dml-menu',
        style: panelStyle,
        role: 'dialog',
        'aria-label': t('menu'),
        'aria-busy': busy,
        onKeyDown: onMenuKeyDown,
      }, [
        look.showSearch ? h('div', { key: 'search', className: 'dml-search' }, [
          h('svg', {
            key: 'icon',
            className: 'dml-search-icon',
            viewBox: '0 0 24 24',
            'aria-hidden': 'true',
            focusable: 'false',
          }, [
            h('circle', { key: 'ring', cx: '10.5', cy: '10.5', r: '6.5', fill: 'none', stroke: 'currentColor', strokeWidth: '1.8' }),
            h('path', { key: 'handle', d: 'm15.6 15.6 4.3 4.3', fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round' }),
          ]),
          h('input', {
            key: 'input',
            ref: searchRef,
            className: 'dml-search-input',
            type: 'text',
            value: query,
            placeholder: t('searchPlaceholder'),
            'aria-label': t('search'),
            autoComplete: 'off',
            spellCheck: 'false',
            onChange: function (event) { setQuery(event.target.value) },
            onKeyDown: onSearchKeyDown,
          }),
          query === '' ? null : h('button', {
            key: 'clear',
            type: 'button',
            className: 'dml-search-clear',
            'aria-label': t('clearSearch'),
            title: t('clearSearch'),
            onMouseDown: function (event) { event.preventDefault() },
            onClick: function () {
              setQuery('')
              const node = searchRef.current
              if (node !== null && typeof node.focus === 'function') node.focus()
            },
          }, h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
            h('path', { d: 'm7.5 7.5 9 9M16.5 7.5l-9 9', fill: 'none', stroke: 'currentColor', strokeWidth: '2.2', strokeLinecap: 'round' }))),
        ]) : null,
        h('div', { key: 'list', className: 'dml-list' }, [
          showLoadingNotice ? h('div', { key: 'loading', className: 'dml-status' }, t('loading')) : null,
          rows,
          needle !== '' && shownGroups.length === 0 ? h('div', { key: 'noMatch', className: 'dml-status' }, t('noMatch')) : null,
          status === 'ready' && groups.length === 0 ? h('div', { key: 'empty', className: 'dml-status' }, t('empty')) : null,
        ]),
        error === null ? null : h('div', { key: 'error', className: 'dml-error', role: 'status' }, error),
        panel === null ? null : h('div', { key: 'panel', className: 'dml-panel' }, panel),
      ])

      return h('div', {
        className: 'dml-root',
        ref: rootRef,
        onKeyDown: function (event) {
          if (event.key === 'Escape' && open) {
            event.preventDefault()
            closeMenu(true)
          }
        },
      }, [
        h('button', {
          key: 'trigger',
          ref: triggerRef,
          type: 'button',
          className: 'dml-trigger',
          'data-busy': busy,
          style: Object.assign({
            '--dml-trigger-bg': tintAt(triggerTint, look.triggerOpacity),
            /* A hover that merely nudges the resting tint is invisible; this is a clear step up. */
            '--dml-trigger-bg-hover': tintAt(triggerTintHover, Math.min(100, look.triggerOpacity + 18)),
          },
          { '--dml-trigger-logo': look.triggerLogoColor },
          /* Unset text colours keep the theme's own; set ones are applied verbatim. */
          look.triggerLabelColor === '' ? {} : { '--dml-trigger-label': look.triggerLabelColor },
          look.triggerEffortColor === '' ? {} : { '--dml-trigger-effort': look.triggerEffortColor }),
          'aria-label': ariaLabel,
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          title: ariaLabel,
          /* A held session really disables the trigger; a settling commit only gates it. */
          disabled: props.locked === true,
          'aria-disabled': busyNow,
          onClick: function () {
            if (busyNow) return
            if (open) closeMenu(false)
            else {
              setError(null)
              setOpen(true)
              load()
            }
          },
        }, [
          look.triggerLogo
            ? h(BrandMark, { key: 'mark', provider: current === null ? undefined : current.provider, model: current === null ? undefined : current.model, className: 'dml-brand' })
            : null,
          h('span', { key: 'label', className: 'dml-trigger-label' }, modelLabel),
          effortLabel === undefined ? null : h('span', { key: 'effort', className: 'dml-trigger-effort' }, effortLabel),
          h(Chevron, { key: 'chevron', open: open }),
        ]),
        open ? ReactDOM.createPortal(menu, document.body) : null,
      ])
    }

    /** Localized copy for this seat. */
    const zh = {
      label: '选择模型',
      menu: '模型与推理等级',
      effort: '推理等级',
      efficient: '更高效',
      capable: '更智能',
      loading: '正在刷新模型列表…',
      empty: '没有可用的模型。',
      search: '搜索模型',
      searchPlaceholder: '搜索模型…',
      clearSearch: '清除搜索',
      noMatch: '没有匹配的模型',
      loadingModel: '正在加载模型…',
      unsupportedModel: '请选择模型',
      effortUnsupported: '当前模型未提供推理等级',
      effortDefault: '默认',
      account: 'DeepSeek 账号',
      providerFailed: '{name} 加载失败：{message}',
      retry: '重新加载',
      errorBusy: '当前会话已被占用，可能是其它正在运行的 DSH 导致的，请退出其它 DSH 后重试。',
      errorAction: '模型设置失败：{message}',
      triggerAria: '选择模型，当前 {model}',
      triggerAriaEffort: '选择模型，当前 {model}，推理等级 {effort}',
      setSection: '模型选择器外观',
      setGroupTrigger: '对话输入框的模型位',
      setTriggerLogo: '显示模型图标',
      setTriggerLogoHint: '在模型名前面显示当前模型的品牌图标。',
      setTriggerBackground: '背景色',
      setTriggerBackgroundHint: '模型位的底色。默认跟随主题前景色（暗色主题下即变亮），选了颜色就固定使用。',
      setTriggerOpacity: '背景不透明度',
      setTriggerOpacityHint: '0% 完全透明，100% 完全不透明。',
      setCrashed: '这一页加载失败了，请把这个情况反馈一下。',
      setTriggerLogoColor: '模型图标颜色',
      setTriggerLogoColorHint: '仅在「显示模型图标」开启时可调。',
      setMenuOpacityLocked: '已由材质接管，切到「无」才能调节。',
      setTriggerLabelColor: '模型名称颜色',
      setTriggerLabelColorHint: '留空即跟随主题；点下面的「恢复默认」可以清回跟随主题。',
      setTriggerEffortColor: '推理等级颜色',
      setTriggerEffortColorHint: '留空即跟随主题。',
      setShowSearch: '显示搜索框',
      setShowSearchHint: '关闭后打开面板直接看到完整模型列表。',
      setGroupMenu: '弹出面板',
      setMenuMaterial: '背景材质',
      setMenuMaterialHint: '「无」用下面的不透明度调浓度；亚克力和云母有自己的浓度滑块。',
      setMenuTint: '背景颜色',
      setMenuTintHint: '设置后覆盖材质自带的底色。',
      setMenuOpacity: '背景不透明度',
      setMenuOpacityHint: '「无」时由它决定面板底色的通透程度，调到 0 就完全透明。',
      setMenuMaterialStrength: '材质强度',
      setMenuMaterialStrengthHint: '材质强度：越高底色越透、模糊越重。',
      setMenuMaterialStrengthLocked: '先在上面选择「亚克力」或「云母」。',
      materialNone: '无',
      materialAcrylic: '亚克力',
      materialMica: '云母',
      setReset: '恢复默认',
      setGroupList: '模型列表',
      setListLogo: '显示模型图标',
      setListLogoHint: '在每一行模型名前面显示品牌图标。',
      setListNote: '显示模型说明',
      setListNoteHint: '在模型名下方显示一行中文简介。',
      setGroupSlider: '推理等级滑块',
      setSliderGradient: '启用渐变',
      setSliderGradientHint: '开启后按档位从起始色渐变到结束色。',
      setSliderSolid: '单色',
      setSliderSolidHint: '关闭渐变时使用的颜色。',
      setSliderFrom: '渐变起始色',
      setSliderTo: '渐变结束色',
      setUnavailable: '设置暂不可用。',
      setReadOnly: '当前配置不可写。',
      setSaveFailed: '保存失败，请重试。',
      setSave: '保存',
      setSaving: '保存中…',
    }

    const en = {
      label: 'Choose a model',
      menu: 'Model and reasoning effort',
      effort: 'Reasoning effort',
      efficient: 'Faster',
      capable: 'Smarter',
      loading: 'Refreshing models…',
      empty: 'No models available.',
      search: 'Search models',
      searchPlaceholder: 'Search models…',
      clearSearch: 'Clear search',
      noMatch: 'No matching model',
      loadingModel: 'Loading models…',
      unsupportedModel: 'Select model',
      effortUnsupported: 'This model provides no reasoning effort levels',
      effortDefault: 'Default',
      account: 'DeepSeek Account',
      providerFailed: '{name} failed to load: {message}',
      retry: 'Reload',
      errorBusy: 'This session is already in use, possibly by another running DSH instance. Quit the others and try again.',
      errorAction: 'Could not apply the model selection: {message}',
      triggerAria: 'Choose a model, currently {model}',
      triggerAriaEffort: 'Choose a model, currently {model}, reasoning effort {effort}',
      setSection: 'Model selector appearance',
      setGroupTrigger: 'Composer model seat',
      setTriggerLogo: 'Show the model mark',
      setTriggerLogoHint: 'Draw the current model brand mark ahead of its name.',
      setTriggerBackground: 'Background colour',
      setTriggerBackgroundHint: 'The tint separating the seat from the composer card. Defaults to the theme foreground; picking a colour pins it.',
      setTriggerOpacity: 'Background opacity',
      setTriggerOpacityHint: '0% is fully transparent, 100% is fully opaque.',
      setCrashed: 'This page failed to load — please report it.',
      setTriggerLogoColor: 'Model mark colour',
      setTriggerLogoColorHint: 'Available only while "Show the model mark" is on.',
      setMenuOpacityLocked: 'The material owns this; switch to "None" to adjust it.',
      setTriggerLabelColor: 'Model name colour',
      setTriggerLabelColorHint: 'Leave unset to follow the theme; "Restore defaults" clears it back.',
      setTriggerEffortColor: 'Effort label colour',
      setTriggerEffortColorHint: 'Leave unset to follow the theme.',
      setShowSearch: 'Show the search box',
      setShowSearchHint: 'Turned off, the popover opens straight onto the full list.',
      setGroupMenu: 'Popover surface',
      setMenuMaterial: 'Background material',
      setMenuMaterialHint: '"None" uses the opacity slider below; acrylic and mica have their own strength slider.',
      setMenuTint: 'Background colour',
      setMenuTintHint: 'Overrides the fill the material would use.',
      setMenuOpacity: 'Background opacity',
      setMenuOpacityHint: 'Under "None" this decides how much of the fill shows; 0 is fully see-through.',
      setMenuMaterialStrength: 'Material strength',
      setMenuMaterialStrengthHint: 'How much material you get: higher lets more show through and blurs it harder.',
      setMenuMaterialStrengthLocked: 'Pick "Acrylic" or "Mica" above first.',
      materialNone: 'None',
      materialAcrylic: 'Acrylic',
      materialMica: 'Mica',
      setReset: 'Restore defaults',
      setGroupList: 'Model list',
      setListLogo: 'Show model marks',
      setListLogoHint: 'Draw a brand mark ahead of every model row.',
      setListNote: 'Show model notes',
      setListNoteHint: 'Show the one-line note under each model name.',
      setGroupSlider: 'Reasoning slider',
      setSliderGradient: 'Use a gradient',
      setSliderGradientHint: 'Ramp from the start colour to the end colour by level.',
      setSliderSolid: 'Solid colour',
      setSliderSolidHint: 'Used when the gradient is off.',
      setSliderFrom: 'Gradient start',
      setSliderTo: 'Gradient end',
      setUnavailable: 'Settings are unavailable.',
      setReadOnly: 'This configuration is not writable.',
      setSaveFailed: 'Could not save. Try again.',
      setSave: 'Save',
      setSaving: 'Saving…',
    }

    const CSS = [
      '.dml-root{position:relative;display:flex;min-width:0;max-width:min(100%,360px);align-items:center}',
      /* The seat sits on the composer card, so it carries its own tint — a touch brighter than
       * the card in dark themes (and a touch deeper in light ones) via the theme foreground. */
      '.dml-trigger{box-sizing:border-box;display:flex;min-width:0;max-width:100%;height:28px;align-items:center;gap:6px;padding:0 5px 0 8px;border:0;border-radius:8px;background:var(--dml-trigger-bg,transparent);color:var(--dsw-alias-label-secondary,#4f5867);font:inherit;font-size:13px;font-weight:400;line-height:20px;cursor:pointer;transition:background-color .14s ease}',
      '.dml-trigger:hover:not(:disabled){background:var(--dml-trigger-bg-hover,var(--dml-trigger-bg,transparent))}',
      '.dml-trigger:focus-visible{outline:0;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4d6bfe))}',
      '.dml-trigger:disabled{color:var(--dsw-alias-label-dimmed,#a1a7b1);cursor:default}',
      /* A settling commit gates the trigger without restyling it. */
      '.dml-trigger[aria-disabled="true"]:not(:disabled){cursor:progress}',
      '.dml-brand{display:block;flex:none;width:16px;height:16px;color:var(--dsw-alias-label-primary,#17191d)}',
      '.dml-trigger:disabled .dml-brand{color:currentColor}',
      '.dml-trigger .dml-brand{color:var(--dml-trigger-logo,#fff)}',
      '.dml-trigger-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dml-trigger-label,inherit)}',
      '.dml-trigger-effort{flex:none;color:var(--dml-trigger-effort,var(--dsw-alias-label-caption,#8b93a1));font-size:12px}',
      '.dml-chevron{flex:none;width:14px;height:14px;color:var(--dsw-alias-label-caption,#8b93a1);transition:transform .15s ease}',
      '.dml-chevron[data-open="true"]{transform:rotate(180deg)}',
      '.dml-menu{position:fixed;z-index:1100;box-sizing:border-box;display:flex;max-height:min(460px,calc(100vh - 88px));width:min(275px,calc(100vw - 24px));flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l1,#0000000a);box-shadow:var(--dsw-elevation-prominent,0 12px 32px rgb(15 23 42 / 16%));color:var(--dsw-alias-label-primary,#17191d);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);}',
      /* Same breathing room as the model rows below it: the menu's own 6px padding plus 6px here. */
      '.dml-search{display:flex;align-items:center;gap:7px;height:34px;margin:6px 6px 4px;padding:0 10px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover,#2631480f);transition:box-shadow .14s ease}',
      '.dml-search:focus-within{box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2,rgb(0 0 0 / 10%))}',
      '.dml-search-icon{flex:none;width:14px;height:14px;color:var(--dsw-alias-label-tertiary,#8b93a1)}',
      '.dml-search-input{min-width:0;flex:1;border:0;background:transparent;color:var(--dsw-alias-label-primary,#17191d);font:inherit;font-size:13px;line-height:20px;outline:0;padding:0}',
      '.dml-search-input::placeholder{color:var(--dsw-alias-label-tertiary,#8b93a1)}',
      '.dml-search-clear{display:grid;flex:none;place-items:center;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary,#8b93a1);cursor:pointer}',
      '.dml-search-clear:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:var(--dsw-alias-label-primary,#17191d)}',
      '.dml-search-clear svg{display:block;width:12px;height:12px}',
      /* The list opens with the same hairline the effort panel uses to separate itself. */
      '.dml-list{display:flex;min-height:0;flex:1 1 auto;flex-direction:column;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;border-top:1px solid var(--dsw-alias-border-l1,#0000000a);padding:6px 6px 4px}',
      '.dml-group{display:flex;flex-direction:column;gap:1px}',
      '.dml-group-list{display:flex;flex-direction:column;gap:1px}',
      '.dml-group-title{padding:8px 8px 4px;color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:11px;font-weight:500;line-height:16px}',
      '.dml-option{box-sizing:border-box;display:flex;width:100%;min-height:34px;align-items:center;gap:9px;padding:5px 8px;border:0;border-radius:9px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.dml-option:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#2631480f)}',
      '.dml-option[aria-selected="true"]{background:var(--dsw-alias-interactive-bg-hover,#2631480f)}',
      '.dml-option:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:-2px}',
      /* Only the cursor changes while a commit settles. Greying the row out made the brand mark
       * and the name blink for that instant, while the note (which owns its own colour) stayed put. */
      '.dml-option[aria-disabled="true"]{cursor:progress}',
      '.dml-option-brand{display:block;flex:none;width:18px;height:18px;color:var(--dsw-alias-label-primary,#17191d)}',
      '.dml-option-copy{display:flex;min-width:0;flex:1;flex-direction:column}',
      '.dml-option-name{overflow:hidden;font-size:13px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}',
      '.dml-option-note{margin-top:1px;overflow:hidden;color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}',
      '.dml-option-slot{display:flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center;color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.dml-option-check{display:block;width:14px;height:14px}',
      '.dml-status{padding:10px 8px;color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:12px;line-height:18px}',
      '.dml-warn{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:4px 2px;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover-danger,#fff1f2);color:var(--dsw-alias-state-error-primary,#d92d48);font-size:11px;line-height:15px}',
      '.dml-retry{flex:none;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:11px;cursor:pointer;padding:2px 6px}',
      '.dml-retry:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f)}',
      '.dml-error{margin:0 6px 6px;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover-danger,#fff1f2);color:var(--dsw-alias-state-error-primary,#d92d48);font-size:11px;line-height:15px}',
      '.dml-panel{flex:none}',
      '.dml-effort{padding:10px 12px 6px;border-top:1px solid var(--dsw-alias-border-l1,#0000000a)}',
      '.dml-effort-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;color:var(--dsw-alias-label-secondary,#5b6472);font-size:11px;line-height:16px}',
      '.dml-effort-value{color:var(--dsw-alias-state-business-primary,#4d6bfe);font-size:12px;font-weight:600}',
      '.dml-effort-scale{display:flex;align-items:center;justify-content:space-between;margin:6px 2px 0;color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:10px;line-height:14px}',
      '.dml-effort-single{padding:6px 0 8px;color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:11px}',
      '.dml-slider{height:34px;margin:2px 0 0;touch-action:none;cursor:grab;outline:0}',
      '.dml-slider:active,.dml-slider[data-dragging="true"]{cursor:grabbing}',
      '.dml-slider-range{position:relative;height:34px;margin:0 13px}',
      '.dml-slider-rail{position:absolute;top:50%;left:-13px;right:-13px;height:20px;transform:translateY(-50%);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#eceef1);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2,rgb(0 0 0 / 10%)),inset 0 1px 2px rgb(25 30 40 / 6%)}',
      '.dml-slider-fill{position:absolute;z-index:1;top:50%;left:-13px;height:20px;transform:translateY(-50%);border-radius:10px;background-image:linear-gradient(90deg,#38bdf8 0%,#4f8ef7 34%,#7c5cf0 68%,#a855f7 92%,#a855f7 100%);background-repeat:no-repeat;background-position:left center;transition:width .2s cubic-bezier(.2,.8,.3,1)}',
      '.dml-slider-tick{position:absolute;z-index:2;top:50%;width:4px;height:4px;border-radius:50%;transform:translate(-50%,-50%);background:var(--dsw-alias-label-primary,#17191d);opacity:.3;transition:background-color .16s ease,opacity .16s ease,width .16s ease,height .16s ease}',
      '.dml-slider-tick[data-active="true"]{background:#fff;opacity:.62}',
      '.dml-slider-tick[data-major="true"]{width:7px;height:7px;background:#fff;opacity:1;box-shadow:0 0 0 1px rgb(15 23 42 / 18%)}',
      '.dml-slider-thumb{position:absolute;z-index:3;top:50%;width:26px;height:26px;transform:translate(-50%,-50%);border:1px solid rgb(15 23 42 / 12%);border-radius:50%;background:#fff;box-shadow:0 1px 2px rgb(20 30 50 / 12%),0 3px 8px rgb(20 30 50 / 8%);transition:left .18s cubic-bezier(.2,.9,.25,1),box-shadow .18s ease,transform .18s ease}',
      '.dml-slider:hover .dml-slider-thumb{box-shadow:0 1px 2px rgb(20 30 50 / 16%),0 4px 10px rgb(20 30 50 / 10%);transform:translate(-50%,-50%) scale(1.04)}',
      '.dml-slider:focus-visible .dml-slider-rail{box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2,rgb(0 0 0 / 10%)),0 0 0 3px rgb(77 107 254 / 22%)}',
      /* ---- settings page ---- */
      '.dml-set-group{margin:0 0 18px}',
      '.dml-set-group-title{margin:0 0 8px;color:var(--dsw-alias-label-primary,#17191d);font-size:13px;font-weight:600;line-height:1.5}',
      '.dml-set-rows{display:flex;flex-direction:column;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#17191d) 4%,transparent)}',
      '.dml-set-row{display:flex;min-height:48px;align-items:center;justify-content:space-between;gap:16px;padding:8px 12px}',
      '.dml-set-row+.dml-set-row{border-top:1px solid var(--dsw-alias-border-l1,#0000000a)}',
      '.dml-set-copy{display:flex;min-width:0;flex:1;flex-direction:column;gap:2px}',
      '.dml-set-label{color:var(--dsw-alias-label-primary,#17191d);font-size:13px;line-height:18px}',
      '.dml-set-hint{color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:11px;line-height:15px}',
      '.dml-set-control{display:flex;flex:none;align-items:center;gap:8px}',
      '.dml-set-switch{box-sizing:border-box;position:relative;width:36px;height:20px;padding:0;border:0;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#17191d) 18%,transparent);cursor:pointer;transition:background-color .16s ease}',
      '.dml-set-switch[aria-checked="true"]{background:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.dml-set-switch:disabled{cursor:default;opacity:.5}',
      '.dml-set-switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:2px}',
      '.dml-set-switch-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgb(20 30 50 / 20%);transition:transform .16s cubic-bezier(.2,.9,.25,1)}',
      '.dml-set-switch[aria-checked="true"] .dml-set-switch-knob{transform:translateX(16px)}',
      '.dml-set-color{display:flex;align-items:center;gap:8px}',
      '.dml-set-color-well{box-sizing:border-box;width:28px;height:28px;padding:0;border:1px solid var(--dsw-alias-border-l2,rgb(0 0 0 / 12%));border-radius:8px;background:transparent;cursor:pointer}',
      '.dml-set-color-well:disabled{cursor:default;opacity:.5}',
      '.dml-set-color-hex{color:var(--dsw-alias-label-tertiary,#8b93a1);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;letter-spacing:.04em}',
      '.dml-set-choice{display:flex;gap:2px;padding:2px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#17191d) 6%,transparent)}',
      '.dml-set-choice-item{padding:4px 10px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#5b6472);font:inherit;font-size:12px;line-height:18px;cursor:pointer}',
      '.dml-set-choice-item[aria-checked="true"]{background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#17191d);box-shadow:0 1px 2px rgb(20 30 50 / 10%)}',
      '.dml-set-choice-item:disabled{cursor:default;opacity:.5}',
      '.dml-set-choice-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:1px}',
      '.dml-set-crashed{margin:0;padding:14px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d92d48) 10%,transparent);color:var(--dsw-alias-state-error-primary,#d92d48);font-size:13px;line-height:20px}',
      '.dml-set-note{margin:0 0 14px;color:var(--dsw-alias-label-secondary,#5b6472);font-size:12px;line-height:18px}',
      '.dml-set-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 8%))}',
      '.dml-set-failed{margin-right:auto;color:var(--dsw-alias-state-error-primary,#d92d48);font-size:12px}',
      '.dml-set-button{padding:6px 18px;border:0;border-radius:8px;font:inherit;font-size:13px;line-height:20px;cursor:pointer}',
      '.dml-set-button:disabled{cursor:default;opacity:.45}',
      '.dml-set-button--save{background:var(--dsw-alias-state-business-primary,#4d6bfe);color:#fff}',
      '.dml-set-button--reset{padding:5px 17px;border:1px solid var(--dsw-alias-border-l2,rgb(0 0 0 / 14%));background:transparent;color:var(--dsw-alias-label-secondary,#5b6472)}',
      '.dml-set-button--reset:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary,#17191d) 6%,transparent);color:var(--dsw-alias-label-primary,#17191d)}',
      '.dml-set-range{display:flex;align-items:center;gap:10px}',
      '.dml-set-range-input{width:120px;accent-color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.dml-set-range-value{min-width:34px;color:var(--dsw-alias-label-secondary,#5b6472);font-size:12px;font-variant-numeric:tabular-nums;text-align:right}',
      '@media (prefers-reduced-motion:reduce){.dml-chevron,.dml-slider-fill,.dml-slider-thumb,.dml-slider-tick,.dml-set-switch,.dml-set-switch-knob{transition:none}}',
    ].join('')

    /** Dictionary namespace owned by this plugin. */
    const NS = 'model-seat'

    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en })
      }, 'model-seat: dictionaries')

      ctx.effect(function () {
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-model-seat'
        style.dataset.pluginCss = 'dsh-model-seat/client.css'
        style.textContent = CSS
        document.head.appendChild(style)
        return function () { style.remove() }
      }, 'model-seat: styles')

      /* Appearance settings: one shared form behind both the seat and the settings page. */
      const appearance = createAppearanceFeature(ctx)
      ctx.effect(function () {
        return function () { appearance.dispose() }
      }, 'model-seat: appearance form')

      /* The page itself, in the settings shell's own navigation. */
      ctx.inject(['slots', 'locale'], function (scope) {
        const t = scope.locale.bind(NS)
        scope.slots.inject('settings.section', function () {
          return scope.slots.register({
            name: 'settings.section',
            id: 'model-seat',
            order: 60,
            label: function () { return t('setSection') },
            locale: NS,
            inject: function () {
              return { appearance: appearance.store, appearanceActions: appearance }
            },
          }, GuardedSettingsPanel)
        })
      })

      ctx.inject(['slots', 'locale', 'modelDirectories', 'sessions', 'remote', 'remote.session'], function (scope) {
        const t = scope.locale.bind(NS)
        const models = scope.modelDirectories
        const sessions = scope.sessions
        scope.slots.inject('conversation.input.model', function () {
          return scope.slots.register({
            name: 'conversation.input.model',
            priority: -1000,
            label: function () { return t('label') },
            locale: NS,
            inject: function (sessionId) {
              const directory = models.directoryFor(sessionId)
              const available = sessions === undefined || typeof sessions.subagentAddress !== 'function'
                ? true
                : sessions.subagentAddress(sessionId) === undefined
              return {
                available: available,
                directory: directory.store,
                appearance: appearance.store,
                load: function () {
                  if (available) directory.load().catch(function () {})
                },
                select: function (selection) {
                  return available ? directory.select(selection) : Promise.resolve(undefined)
                },
              }
            },
          }, ModelSeat)
        })
      })
    }

    return {
      /* The seat's framework share resolves the session toolkit, which reaches remote.session —
       * the same injection the shipped seat and dsh-reasoning-effort declare. */
      inject: ['slots', 'locale', 'configForms', 'modelDirectories', 'sessions', 'remote', 'remote.session'],
      apply: apply,
    }
  },
})
