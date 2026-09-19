// tokens.css 两块(浅色 :root / 暗色 :root[data-theme="dark"])的机器检查(DARK-MODE-SPEC §7)。
// ① 浅色块里每个写了颜色值的令牌,暗色块里都有值(或者是两边同值、登记在 SAME_IN_BOTH 里)——
//    加了浅色令牌忘了配暗色,暗色下它就是一块浅色补丁,浏览器不会报任何错。
// ② 关键的「字 × 底」对比度按暗色稿断言(稿的生成脚本 darkOf(DIRS.d2) 对同样的对都断言过 ≥4.5 / ≥3)。
//    改暗色值的人会先在这里红,而不是等用户说「看不清」。
// ③ 在线头像身份色(Avatar.vue 的 PALETTE):白字 ≥4.5、不用紫(M4)。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')
const CSS = readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** 取选择器后面那一对花括号里的 `--x: v;`(两块里都没有嵌套花括号)。 */
function block(selector: string): Record<string, string> {
  const at = CSS.indexOf(selector + ' {')
  if (at < 0) throw new Error('tokens.css 里找不到 ' + selector)
  const body = CSS.slice(CSS.indexOf('{', at) + 1, CSS.indexOf('}', at))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1].slice(2)] = m[2].trim()
  return out
}
const LIGHT = block(':root')
const DARK_ONLY = block(':root[data-theme="dark"]')
const DARK = { ...LIGHT, ...DARK_ONLY }

// ── 色彩计算(与稿的生成脚本同一套:oklch → sRGB,半透明先叠到底上,WCAG 相对亮度) ──
type RGBA = [number, number, number, number]
const clamp = (x: number) => Math.min(1, Math.max(0, x))
const enc = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)
const dec = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
function oklch(L: number, C: number, H: number): [number, number, number] {
  const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map((x) => Math.round(clamp(enc(x)) * 255)) as [number, number, number]
}
function parse(v: string, map: Record<string, string>, depth = 0): RGBA {
  v = v.trim()
  const vm = v.match(/^var\(--([a-z0-9-]+)\)$/)
  if (vm) {
    if (depth > 8 || !(vm[1] in map)) throw new Error('解析不了 ' + v)
    return parse(map[vm[1]], map, depth + 1)
  }
  if (v === 'transparent') return [0, 0, 0, 0]
  let m = v.match(/^#([0-9a-f]{6})$/i)
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)).concat(1) as RGBA
  m = v.match(/^rgba?\(([^)]+)\)$/)
  if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1] }
  m = v.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/)
  if (m) return [...oklch(+m[1], +m[2], +m[3]), 1]
  throw new Error('解析不了 ' + v)
}
const over = ([r, g, b, a]: RGBA, bg: number[]) => [r, g, b].map((c, i) => Math.round(a * c + (1 - a) * bg[i]))
const lum = ([r, g, b]: number[]) => 0.2126 * dec(r / 255) + 0.7152 * dec(g / 255) + 0.0722 * dec(b / 255)
function ratio(fg: RGBA, bg: RGBA, base = [255, 255, 255]): number {
  const B = bg[3] < 1 ? over(bg, base) : bg.slice(0, 3)
  const F = fg[3] < 1 ? over(fg, B) : fg.slice(0, 3)
  const a = lum(F), b = lum(B)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
const C = (map: Record<string, string>, n: string) => parse(`var(--${n})`, map)
const onBg = (map: Record<string, string>, fg: string, bg: string) => ratio(C(map, fg), C(map, bg))
/** 控件边框的实际对比:先叠在控件自己的底 own 上,再和外面的面 outer 比(稿的 edgeOn) */
const edgeOn = (map: Record<string, string>, b: string, own: string, outer: string) =>
  ratio([...over(C(map, b), C(map, own).slice(0, 3)), 1] as RGBA, C(map, outer))
const WHITE: RGBA = [255, 255, 255, 1]

const COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|oklch)\(/i
/** 暗色稿 darkOf 里两边同值的颜色令牌(图表填充、品牌蓝):暗色块里不重写。新增要写明为什么两边一样。 */
const SAME_IN_BOTH = ['fill-slate', 'fill-blue', 'fill-cyan', 'fill-sky', 'brand-blue', 'brand-accent']

describe('tokens.css · 浅色 / 暗色成对', () => {
  it('浅色块里写了颜色值的令牌,暗色块都有值(别名跟着变,不用重写)', () => {
    const missing = Object.entries(LIGHT)
      .filter(([k, v]) => COLOR.test(v) && !(k in DARK_ONLY) && !SAME_IN_BOTH.includes(k))
      .map(([k]) => '--' + k)
    expect(missing).toEqual([])
  })

  it('暗色块不定义浅色块里没有的令牌(拼错名字的那种)', () => {
    expect(Object.keys(DARK_ONLY).filter((k) => !(k in LIGHT)).map((k) => '--' + k)).toEqual([])
  })

  it('暗色块的每个颜色值都解析得出来(引用的令牌都存在)', () => {
    // 阴影(「0 1px …」开头)不在此列
    const bad = Object.entries(DARK_ONLY).filter(([, v]) => !/^-?\d/.test(v)).flatMap(([k]) => {
      try { C(DARK, k); return [] } catch { return ['--' + k] }
    })
    expect(bad).toEqual([])
  })
})

/**
 * 浅色块现有颜色令牌的值(2026-09-20 冻结)。暗色模式的前提是「浅色外观零变化」(DARK-MODE-SPEC §2 / §4),
 * 截图对比只在收口时做一次;这里让改了浅色值的人当场红。**只许加新令牌,不许改这些值**。
 * 真要改浅色(用户拍板的那种),改值的同一个提交里把这里一起改,并在提交说明里写清是哪条拍板。
 */
const LIGHT_FROZEN: Record<string, string> = {
  'ink-900': 'rgb(28, 28, 28)', 'ink-700': 'rgba(28, 28, 28, 0.8)', 'ink-500': 'rgba(28, 28, 28, 0.4)', 'ink-300': 'rgba(28, 28, 28, 0.2)',
  'ink-100': 'rgba(28, 28, 28, 0.1)', 'ink-050': 'rgba(28, 28, 28, 0.05)', 'ink-040': 'rgba(0, 0, 0, 0.04)', 'surface-page': 'rgb(255, 255, 255)',
  'surface-card': 'rgb(249, 249, 250)', 'surface-sunken': 'rgb(245, 245, 246)', 'surface-overlay': 'rgba(255, 255, 255, 0.9)',
  'surface-white': 'rgb(255, 255, 255)', 'surface-subtle': 'var(--surface-sunken)', 'accent-slate': 'rgb(229, 236, 246)',
  'accent-sky': 'rgb(227, 245, 255)', 'accent-blue': 'rgb(230, 241, 253)', 'accent-cyan': 'rgb(222, 244, 250)', 'hue-blue': 'oklch(0.55 0.115 250)',
  'hue-cyan': 'oklch(0.66 0.082 228)', 'hue-orange': 'oklch(0.54 0.115 62)', 'hue-red': 'oklch(0.56 0.150 27)', 'hue-yellow': 'oklch(0.80 0.100 86)',
  'hue-green': 'oklch(0.58 0.130 150)', 'fill-slate': 'rgb(120, 140, 176)', 'fill-blue': 'rgb(129, 174, 232)', 'fill-cyan': 'rgb(160, 205, 232)',
  'fill-sky': 'rgb(196, 226, 244)', 'brand-blue': 'rgb(76, 152, 253)', 'brand-deep': 'rgb(31, 95, 191)', 'brand-accent': 'rgb(112, 148, 244)',
  'text-primary': 'var(--ink-900)', 'text-secondary': 'var(--ink-700)', 'text-muted': 'rgba(28, 28, 28, 0.62)', 'text-disabled': 'var(--ink-300)',
  'text-on-solid': 'rgb(255, 255, 255)', 'text-link': 'var(--hue-blue)', 'bg-app': 'var(--surface-page)', 'bg-panel': 'var(--surface-card)',
  'bg-sunken': 'var(--surface-sunken)', 'bg-hover': 'var(--ink-050)', 'border-subtle': 'var(--ink-100)', 'border-strong': 'var(--ink-300)',
  'divider': 'var(--ink-100)', 'control-solid': 'var(--ink-900)', 'control-solid-text': 'rgb(255, 255, 255)', 'control-soft': 'var(--ink-040)',
  'control-solid-hover': 'rgb(58, 58, 58)', 'status-success': 'var(--hue-green)', 'status-info': 'var(--hue-blue)',
  'status-pending': 'var(--hue-cyan)', 'status-warning': 'var(--hue-orange)', 'status-danger': 'var(--hue-red)',
  'status-danger-hover': 'rgb(224, 49, 39)', 'status-neutral': 'var(--ink-500)', 'delta-up': 'var(--hue-green)', 'delta-down': 'var(--hue-red)',
  'delta-up-text': 'oklch(0.50 0.12 150)', 'delta-down-text': 'oklch(0.52 0.15 27)', 'info-text-on-tint': 'oklch(0.50 0.115 250)',
  'text-muted-tint': 'rgba(28, 28, 28, 0.7)', 'warn-text': 'rgb(133, 79, 11)', 'surface-raised': 'rgb(255, 255, 255)',
  'border-control': 'var(--ink-100)', 'border-control-strong': 'var(--ink-300)', 'scrim': 'rgba(28, 28, 28, 0.34)', 'tip-bg': 'rgb(40, 52, 66)',
  'toast-bg': 'var(--ink-900)', 'warn-bg': 'rgb(255, 243, 230)', 'danger-bg': 'rgb(253, 232, 230)', 'row-selected': 'rgba(24, 134, 254, 0.1)',
  'shadow-dialog': '0 24px 64px rgba(28, 28, 28, 0.28)', 'shadow-xs': '0 1px 2px rgba(28, 28, 28, 0.04)',
  'shadow-sm': '0 1px 3px rgba(28, 28, 28, 0.06), 0 1px 2px rgba(28, 28, 28, 0.04)', 'shadow-md': '0 4px 12px rgba(28, 28, 28, 0.06)',
  'shadow-pop': '0 8px 28px rgba(28, 28, 28, 0.12)', 'shadow-pill': '0 1px 4px rgba(28, 28, 28, 0.08)', 'scrollbar-thumb': 'rgba(28, 28, 28, 0.22)',
  'scrollbar-thumb-hover': 'rgba(28, 28, 28, 0.38)',
}

describe('tokens.css · 浅色值不变', () => {
  it('已有颜色令牌的浅色值与冻结表逐字一致(只许加,不许改)', () => {
    const changed = Object.entries(LIGHT_FROZEN).filter(([k, v]) => LIGHT[k] !== v).map(([k, v]) => `--${k}: ${v} → ${LIGHT[k] ?? '(删了)'}`)
    expect(changed).toEqual([])
  })
})

describe('tokens.css · 暗色对比度(稿 Tokens 板第 1 节)', () => {
  const SURF = ['surface-page', 'surface-white', 'surface-card', 'surface-raised']

  it('主字 / 次字 / 说明字在四层面上 ≥4.5(两种外观)', () => {
    for (const map of [DARK, LIGHT]) {
      for (const t of ['text-primary', 'text-secondary', 'text-muted']) {
        for (const s of SURF) expect(onBg(map, t, s), `--${t} / --${s}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('链接蓝 / 红 / 橙 / 绿写字在四层面上 ≥4.5(暗色)', () => {
    for (const t of ['text-link', 'hue-red', 'hue-orange', 'hue-green', 'brand-deep']) {
      for (const s of SURF) expect(onBg(DARK, t, s), `--${t} / --${s}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('KPI 卡的字在四个 accent 暗底上 ≥4.5(涨跌、说明、警示)', () => {
    for (const t of ['text-primary', 'text-muted-tint', 'delta-up-text', 'delta-down-text', 'warn-text', 'info-text-on-tint']) {
      for (const b of ['accent-slate', 'accent-sky', 'accent-blue', 'accent-cyan']) {
        expect(onBg(DARK, t, b), `--${t} / --${b}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('控件边框 --border-control 叠在控件底上、对外面 ≥3(卡片上 / 搜索框 / 浮层上的输入框)', () => {
    expect(edgeOn(DARK, 'border-control', 'surface-white', 'surface-white')).toBeGreaterThanOrEqual(3)
    expect(edgeOn(DARK, 'border-control', 'surface-card', 'surface-white')).toBeGreaterThanOrEqual(3)
    expect(edgeOn(DARK, 'border-control', 'surface-white', 'surface-raised')).toBeGreaterThanOrEqual(3)
    expect(edgeOn(DARK, 'border-control-strong', 'surface-white', 'surface-white')).toBeGreaterThanOrEqual(3)
  })

  it('实底上的字:选中日期(--hue-blue)、实底按钮、危险按钮 ≥4.5(两种外观);深色气泡 / 提示条上的白字 ≥4.5', () => {
    for (const map of [DARK, LIGHT]) {
      expect(onBg(map, 'control-solid-text', 'hue-blue'), '选中日期').toBeGreaterThanOrEqual(4.5)
      expect(onBg(map, 'control-solid-text', 'control-solid'), '实底按钮').toBeGreaterThanOrEqual(4.5)
    }
    expect(onBg(DARK, 'control-solid-text', 'status-danger'), '危险按钮').toBeGreaterThanOrEqual(4.5)
    for (const map of [DARK, LIGHT]) {
      expect(ratio(WHITE, C(map, 'tip-bg')), '白字 / --tip-bg').toBeGreaterThanOrEqual(4.5)
      expect(ratio(WHITE, C(map, 'toast-bg')), '白字 / --toast-bg').toBeGreaterThanOrEqual(4.5)
    }
  })

  it('选中行、警示条、出错底上的字 ≥4.5(暗色)', () => {
    expect(ratio(C(DARK, 'text-primary'), [...over(C(DARK, 'row-selected'), C(DARK, 'surface-white').slice(0, 3)), 1] as RGBA)).toBeGreaterThanOrEqual(4.5)
    expect(onBg(DARK, 'hue-orange', 'warn-bg')).toBeGreaterThanOrEqual(4.5)
    expect(onBg(DARK, 'warn-text', 'warn-bg')).toBeGreaterThanOrEqual(4.5)
    expect(onBg(DARK, 'hue-red', 'danger-bg')).toBeGreaterThanOrEqual(4.5)
  })

  it('滚动条滑块在卡片上 ≥3(暗色 35% 白)', () => {
    expect(onBg(DARK, 'scrollbar-thumb', 'surface-white')).toBeGreaterThanOrEqual(3)
  })
})

describe('在线头像身份色(Avatar.vue,M4)', () => {
  const src = readFileSync(join(SRC, 'components', 'ds', 'Avatar.vue'), 'utf8')
  const pal = [...(src.match(/const PALETTE = \[([\s\S]*?)\];/)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1])

  it('8 色都是固定字面量(不引令牌:令牌暗色下会变),白字 ≥4.5', () => {
    expect(pal).toHaveLength(8)
    for (const c of pal) expect(ratio(WHITE, parse(c, {})), c).toBeGreaterThanOrEqual(4.5)
  })

  it('没有偏紫的:HSV 色相不落在 260°–340°', () => {
    for (const c of pal) {
      const [r, g, b] = parse(c, {})
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      if (mx === mn) continue
      const h = mx === r ? ((g - b) / (mx - mn)) * 60 : mx === g ? (2 + (b - r) / (mx - mn)) * 60 : (4 + (r - g) / (mx - mn)) * 60
      const hue = (h + 360) % 360
      expect(hue >= 260 && hue <= 340, `${c} 色相 ${hue.toFixed(0)}°`).toBe(false)
    }
  })
})

// ── 2026-09-20 对抗复查提议的令牌(主持人加进 tokens.css 之后才跑;没加的那条显示 skipped)──
// 浅色值 = 各处原来写死的那个值(浅色外观不变);暗色值保证它们配的字 ≥4.5。
describe('tokens.css · 2026-09-20 提议的令牌', () => {
  const has = (...ks: string[]) => ks.every((k) => k in LIGHT && k in DARK_ONLY)
  const LIGHT_IS: [string, string][] = [
    ['danger-soft', 'rgb(255, 238, 237)'], ['warn-soft', 'rgb(252, 243, 232)'], ['caution-soft', 'rgb(255, 250, 235)'],
    ['ok-soft', 'rgb(222, 244, 229)'], ['info-soft', 'rgb(232, 240, 254)'], ['ok-text', 'rgb(21, 128, 61)'],
    ['amber-text', 'rgb(180, 83, 9)'], ['caution-text', 'rgb(138, 97, 0)'], ['orange-text', 'rgb(178, 100, 0)'],
    ['coral-text', 'rgb(202, 66, 41)'], ['slate-text', 'rgb(64, 84, 124)'], ['badge-cyan-text', 'rgb(22, 140, 195)'],
    ['badge-slate-text', 'rgb(90, 110, 150)'], ['badge-orange-text', 'rgb(190, 110, 0)'], ['row-selected-raised', 'var(--accent-slate)'],
  ]
  for (const [k, v] of LIGHT_IS) {
    it.skipIf(!has(k))(`--${k} 浅色 = 原来写死的 ${v}`, () => expect(LIGHT[k]).toBe(v))
  }
  // [字, 底]:暗色 ≥4.5(浅色就是原值,不重算)
  const PAIRS: [string, string][] = [
    ['hue-red', 'danger-soft'], ['coral-text', 'danger-soft'], ['coral-text', 'danger-bg'],
    ['hue-orange', 'warn-soft'], ['amber-text', 'warn-soft'], ['orange-text', 'warn-soft'], ['warn-text', 'warn-soft'],
    ['caution-text', 'caution-soft'], ['ok-text', 'ok-soft'], ['hue-blue', 'info-soft'], ['slate-text', 'accent-slate'],
  ]
  for (const [fg, bg] of PAIRS) {
    it.skipIf(!has(...[fg, bg].filter((t) => !(t in DARK_ONLY && t in LIGHT) && LIGHT_IS.some(([k]) => k === t))))(`暗色 --${fg} / --${bg} ≥4.5`, () => {
      expect(onBg(DARK, fg, bg)).toBeGreaterThanOrEqual(4.5)
    })
  }
  // 徽标:字对「14% 同色叠在卡片上」的底(Badge.vue 的 fill)
  const BADGE: [string, RGBA][] = [['badge-cyan-text', [50, 173, 230, 0.14]], ['badge-slate-text', [120, 140, 176, 0.14]], ['badge-orange-text', [255, 149, 0, 0.14]]]
  for (const [k, fill] of BADGE) {
    it.skipIf(!has(k))(`暗色 --${k} 对徽标底 ≥4.5(稿 Components ⑥)`, () => {
      expect(ratio(C(DARK, k), [...over(fill, C(DARK, 'surface-white').slice(0, 3)), 1] as RGBA)).toBeGreaterThanOrEqual(4.5)
    })
  }
  it.skipIf(!has('row-selected-raised'))('命令面板选中行暗色 = --row-selected(和浮层分得开),浅色 = --accent-slate;上面的主字 ≥4.5', () => {
    expect(DARK_ONLY['row-selected-raised']).toBe('var(--row-selected)')
    const row = [...over(C(DARK, 'row-selected-raised'), C(DARK, 'surface-raised').slice(0, 3)), 1] as RGBA
    expect(ratio(C(DARK, 'text-primary'), row)).toBeGreaterThanOrEqual(4.5)
  })
})
