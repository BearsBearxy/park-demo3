// 图表读数气泡外观统一(画布 06-B ⑩「替代 5 族自写气泡」):ECharts tooltip、光伏 .cz-tip、AnaTrend、
// 四张自绘 SVG 图的悬停气泡,与 ShellTip 同款 —— --tip-bg 底、字 12px / 行高 18、圆角 6、内边距 6×10。
// 只统一外观;零延迟跟鼠标、定位不在这里(各图自己的 spec 钉)。
// 期望值从 ShellTip.vue 的 .fp-tip 读,不在这里另抄一份:ShellTip 改了,这里跟着红。
import { beforeAll, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FP_ANA_THEME, FP_ANA_THEME_DARK } from '../anaTheme'
import AnaForecastChart from '../AnaForecastChart.vue'
import AnaRenewalChart from '../AnaRenewalChart.vue'
import AnaRentBandChart from '../AnaRentBandChart.vue'
import AnaUnitRentHist from '../AnaUnitRentHist.vue'
import { rollingForecastRows } from '@/views/analysis/forecastChart.logic'
import type { RentBandCol } from '@/views/analysis/rentBandChart.logic'

beforeAll(() => {
  // jsdom 没有 ResizeObserver;宽度走各图 clientWidth||默认宽 的兜底
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    }
  }
})

const src = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8')
/** 取一条 CSS 规则的声明表(去注释、空白归一)。选择器必须独占一条规则(.fp-tip 不吃 .fp-tip b) */
function rule(css: string, sel: string): Record<string, string> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const m = clean.match(new RegExp(`(?:^|\\n)\\s*${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))
  expect(m, `找不到规则 ${sel}`).not.toBeNull()
  return Object.fromEntries(m![1].split(';').map((d) => d.split(':')).filter((kv) => kv.length >= 2)
    .map(([k, ...v]) => [k.trim(), v.join(':').trim().replace(/\s+/g, ' ')]))
}
const LOOK = ['background', 'border-radius', 'padding', 'font-size', 'line-height'] as const
const SHELL = rule(src('shell', 'ShellTip.vue'), '.fp-tip')

describe('图表读数气泡 = ShellTip 同款', () => {
  it('ShellTip 本身:--tip-bg / 圆角 6 / 内边距 6×10 / 12px / 18px(下面几族都和它比)', () => {
    expect(LOOK.map((k) => SHELL[k])).toEqual(['var(--tip-bg)', '6px', '6px 10px', '12px', '18px'])
  })

  it('❗光伏 .cz-tip(ana.css 一处,12 张光伏图共用)与 AnaTrend 气泡:五项与 ShellTip 逐项相同', () => {
    const cz = rule(src('ana', 'ana.css'), '.cz-tip')
    const trend = rule(src('ana', 'AnaTrend.vue').split('<style')[1], '.ana-trend-tip')
    for (const [name, r] of [['cz-tip', cz], ['ana-trend-tip', trend]] as const) {
      expect(LOOK.map((k) => r[k]), name).toEqual(LOOK.map((k) => SHELL[k]))
    }
  })

  it('❗ECharts tooltip(浅 / 暗两套主题):圆角 6、内边距 [6,10]、字 12 / 行高 18,浅色底 = tokens.css --tip-bg', () => {
    const tokens = src('..', 'styles', 'tokens.css')
    const tipBg = tokens.match(/--tip-bg:\s*(rgb\([^)]*\))/)![1].replace(/\s+/g, '')
    for (const t of [FP_ANA_THEME, FP_ANA_THEME_DARK]) {
      const tt = t.tooltip as { borderRadius: number; padding: number[]; textStyle: { fontSize: number; lineHeight: number } }
      expect([tt.borderRadius, tt.padding, tt.textStyle.fontSize, tt.textStyle.lineHeight])
        .toEqual([parseInt(SHELL['border-radius']), SHELL.padding.split(' ').map((v) => parseInt(v)), parseInt(SHELL['font-size']), parseInt(SHELL['line-height'])])
    }
    expect(FP_ANA_THEME.tooltip.backgroundColor).toBe(tipBg)
  })
})

/* ── 四张自绘 SVG 图:悬停后量真渲染出来的气泡坐标 ─────────────────── */
const REV6 = [7146649.89, 7169836.30, 6996629.95, 7406069.55, 7537092.36, 7711058.20]
const fRows = () => rollingForecastRows({
  year: 2025, months: [1, 2, 3, 4, 5, 6], revenue: [...REV6, ...new Array(6).fill(null)],
  cost: new Array(12).fill(null), profit: new Array(12).fill(null), bySchedule: {},
})
const bandCols = (): RentBandCol[] => [
  ...Array.from({ length: 12 }, (_, i) => ({
    month: `2025-${String(i + 1).padStart(2, '0')}`, realized: 330 - i * 1.5, locked: null, mid: null, lo: null, hi: null,
  })),
  ...Array.from({ length: 12 }, (_, i) => {
    const locked = 312 - i * 8
    return { month: `2026-${String(i + 1).padStart(2, '0')}`, realized: i === 0 ? locked : null, locked, mid: locked + 12, lo: locked + 2, hi: locked + 26 }
  }),
]
const histProps = {
  bins: Array.from({ length: 16 }, (_, i) => ({ lo: i * 2.5, hi: (i + 1) * 2.5, count: ((i * 7) % 5) + 1 })),
  capHi: 40, overflowCount: 2, overflowMax: 150,
  stats: { p10: 10, median: 20, p90: 32.5 }, selfValue: 18, selfName: '甲', height: 280,
}

const SVG_CHARTS: { p: string; file: string; hover: () => Promise<VueWrapper> }[] = [
  { p: 'afc', file: 'AnaForecastChart.vue', hover: async () => {
    const w = mount(AnaForecastChart, { props: { rows: fRows(), height: 280 } })
    await w.find('.afc-host').trigger('mousemove', { clientX: 52 + ((900 - 52 - 62) * 4) / 6 })
    return w
  } },
  { p: 'arn', file: 'AnaRenewalChart.vue', hover: async () => {
    const w = mount(AnaRenewalChart, { props: { hits: 18, n: 72, band: { lo: 0.18, hi: 0.33 } } })
    await w.find('.arn-host').trigger('mousemove', { clientX: 200, clientY: 0 })   // 数轴那一档:3 行
    return w
  } },
  { p: 'arb', file: 'AnaRentBandChart.vue', hover: async () => {
    const w = mount(AnaRentBandChart, { props: { cols: bandCols(), splitIdx: 12, height: 300 } })
    await w.find('.arb-host').trigger('mousemove', { clientX: 54 + ((900 - 54 - 52) * 13) / 23 })   // 2026-02:锁定 / 预计 / 80% 区间
    return w
  } },
  { p: 'auh', file: 'AnaUnitRentHist.vue', hover: async () => {
    const w = mount(AnaUnitRentHist, { props: histProps })
    await w.find('.auh-host').trigger('mousemove', { clientX: 60 })
    return w
  } },
]
const CJK = /[　-鿿＀-￯]/

describe('自绘 SVG 图气泡 = ShellTip 同款', () => {
  it.each(SVG_CHARTS)('❗$file:底引 --tip-bg、字 12px', ({ p, file }) => {
    const css = src('ana', file).split('<style')[1]
    expect(rule(css, `.${p}-tip`).fill).toBe('var(--tip-bg)')
    expect(rule(css, `.${p}-tiptext`)['font-size']).toBe(SHELL['font-size'])
  })

  it.each(SVG_CHARTS)('❗$file:悬停气泡圆角 6,字从 (10, 19) 起每行下移 18,框高 = 上下内边距 12 + 18×行数,宽装得下 12px 字', async ({ p, hover }) => {
    const w = await hover()
    const rect = w.find(`rect.${p}-tip`)
    const texts = w.findAll(`text.${p}-tiptext`)
    expect(texts.length, '夹具要有多行').toBeGreaterThanOrEqual(3)
    expect(rect.attributes('rx')).toBe(String(parseInt(SHELL['border-radius'])))
    expect(texts.map((t) => [Number(t.attributes('x')), Number(t.attributes('y'))]))
      .toEqual(texts.map((_, i) => [10, 19 + 18 * i]))
    expect(Number(rect.attributes('height'))).toBe(12 + 18 * texts.length)
    // 不切字:12px 下中日韩字 12、其余(等宽数字)0.6em = 7.2,加左右内边距 20
    const need = Math.max(...texts.map((t) => [...t.text()].reduce((a, ch) => a + (CJK.test(ch) ? 12 : 7.2), 0))) + 20
    expect(Number(rect.attributes('width'))).toBeGreaterThanOrEqual(need)
    w.unmount()
  })
})
