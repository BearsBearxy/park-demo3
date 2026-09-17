// 图上点标注(calloutMark + placeCallout)的几何断言 —— 2026-09-17 用户选定设计稿方案 A「深色气泡」
// (../运维文档/设计稿/已实现/图上点标注-2026-09-17/OptionA)。改前两版:pin 符号的字溢出针头看不见;
// 实底小签靠边被裁、盖线。
// 点的像素用 ECharts SSR 真排一遍版取(convertToPixel),气泡尺寸按字宽估(汉字 = 1 个字号宽,
// 数字 0.6),摆放走 AnaEChart 用的同一个 placeCallout。量四件事:气泡在画布里、不压点、
// 尖角对准点、放在稿上画的那一侧。浏览器里另用真组件 AnaEChart 挂同一份库里数据,在 390 / 1366 宽下量过。
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as echarts from 'echarts'
import { CALLOUT_GAP, CALLOUT_TOP_LIMIT, FP_ANA_THEME, calloutsOf, placeCallout } from '../anaTheme'
import { calcBe, cvpOption } from '@/views/analysis/breakeven.logic'
import { fitRevenueTrend, mainChart, mainChartOption, outlierResidualsByMonth } from '@/views/analysis/cockpit.logic'
import type { PnlSummary } from '@/analysis/anaData'

echarts.registerTheme('fpAnaTheme', FP_ANA_THEME)

// AnaEChart 的气泡:padding 4/8、行高 15、字号 11
const charW = (ch: string) => (/[0-9]/.test(ch) ? 6.6 : /[\x20-\x7e]/.test(ch) ? 6.4 : 11)
const boxOf = (lines: string[]) => ({
  w: Math.max(...lines.map((l) => [...l].reduce((a, ch) => a + charW(ch), 0))) + 16,
  h: lines.length * 15 + 8,
})

interface Placed { dot: { x: number; y: number }; box: { w: number; h: number }; side: string; left: number; top: number; tipX: number; inGrid: boolean }
function layout(option: object, width: number, height: number): Placed[] {
  const chart = echarts.init(null, 'fpAnaTheme', { renderer: 'svg', ssr: true, width, height })
  chart.setOption({ ...option, animation: false })
  const out = calloutsOf(option).map((c) => {
    const [x, y] = chart.convertToPixel({ seriesIndex: c.seriesIndex }, c.coord as number[])
    const box = boxOf(c.spec.lines)
    return { dot: { x, y }, box, inGrid: chart.containPixel('grid', [x, y]), ...placeCallout({ x, y }, box, { w: width, h: height }, c.spec.prefer) }
  })
  chart.dispose()
  return out
}

function expectReadable(ps: Placed[], width: number, height: number): void {
  expect(ps.length, '至少一个气泡').toBeGreaterThan(0)
  for (const p of ps) {
    expect(p.inGrid, '点在绘图区里').toBe(true)
    // 气泡在画布里(离边 4)
    expect(p.left).toBeGreaterThanOrEqual(4)
    expect(p.left + p.box.w).toBeLessThanOrEqual(width - 4 + 1e-9)
    expect(p.top).toBeGreaterThanOrEqual(p.side === 'top' ? CALLOUT_TOP_LIMIT : 0)
    expect(p.top + p.box.h).toBeLessThanOrEqual(height - 4 + 1e-9)
    // 不压点:点心到气泡边正好一个 CALLOUT_GAP(尖角的长度在这段里)
    if (p.side === 'top') expect(p.dot.y - (p.top + p.box.h)).toBeCloseTo(CALLOUT_GAP, 6)
    else expect(p.top - p.dot.y).toBeCloseTo(CALLOUT_GAP, 6)
    // 尖角对准点
    expect(p.left + p.tipX).toBeCloseTo(p.dot.x, 6)
    expect(p.tipX).toBeGreaterThanOrEqual(8)
    expect(p.tipX).toBeLessThanOrEqual(p.box.w - 8)
  }
}

// 面板实测:手机 390 宽图 289×260,桌面 1366 宽图 572×300
const SIZES: [number, number][] = [[289, 260], [572, 300]]

describe('calloutMark:深色气泡摆在稿上的位置', () => {
  it.each(SIZES)('盈亏平衡 保本点 %i×%i:气泡在点上方,一行「保本 52%」', (w, h) => {
    const be = calcBe(9_407_800, 5_958_000, 0.62)   // 库里 2025-11:月收入 940.8 万、固定成本 369.4 万 → 保本 51.7%
    expect(be.bePct).toBeCloseTo(51.7, 1)
    const ps = layout(cvpOption(be, true), w, h)
    expectReadable(ps, w, h)
    expect(ps[0].side).toBe('top')
    expect(ps[0].box.h, '一行').toBe(23)
    // 居中在点上,不必夹边
    expect(ps[0].left + ps[0].box.w / 2).toBeCloseTo(ps[0].dot.x, 6)
  })

  // 库里 2025 年逐月(万元),12 月收入 −63.61、利润 −655.33
  const cockpitOpt = (): object => {
    const N12 = (): (number | null)[] => new Array(12).fill(null)
    const rev = [714.66, 716.98, 699.66, 740.61, 753.71, 771.11, 824.97, 866.91, 876.26, 930.15, 940.78, -63.61].map((v) => v * 10000)
    const profit = [179.37, 276.19, 243.35, 228.51, 253.63, 253.27, 304.6, 296.68, 249.06, 315.87, 344.9, -655.33].map((v) => v * 10000)
    const pnl: PnlSummary = { year: 2025, months: Array.from({ length: 12 }, (_, i) => i + 1), revenue: rev, cost: N12(), profit, bySchedule: {} }
    const d = mainChart(pnl, 9_270_0000)!
    return mainChartOption(d, outlierResidualsByMonth(fitRevenueTrend(pnl), d.rev, d.outlierMonths), 'none')!
  }

  it.each(SIZES)('驾驶舱 负收入月 %i×%i:点在柱头,两行气泡挂在下方', (w, h) => {
    const ps = layout(cockpitOpt(), w, h)
    expectReadable(ps, w, h)
    expect(ps[0].side).toBe('bottom')
    expect(ps[0].box.h, '两行').toBe(38)
  })

  it('❗手机宽驾驶舱 12 月贴右边:气泡夹进图里,尖角仍对准柱头(不在气泡正中)', () => {
    const [p] = layout(cockpitOpt(), 289, 260)
    expect(p.left + p.box.w).toBeCloseTo(289 - 4, 6)
    expect(p.tipX).toBeGreaterThan(p.box.w / 2 + 4)
  })
})

describe('placeCallout', () => {
  const BOX = { w: 86, h: 23 }
  it('优先上方;上方越过图例带(上沿 < 22)→ 翻到下方(光伏回收点在手机宽的情形)', () => {
    expect(placeCallout({ x: 200, y: 120 }, BOX, { w: 572, h: 300 }, 'top')).toMatchObject({ side: 'top', top: 120 - 13.5 - 23 })
    const flip = placeCallout({ x: 226, y: 52.6 }, BOX, { w: 289, h: 260 }, 'top')
    expect(flip.side).toBe('bottom')
    expect(flip.top).toBeCloseTo(52.6 + 13.5, 6)
  })
  it('优先下方;下方出图底 → 翻到上方', () => {
    expect(placeCallout({ x: 200, y: 100 }, BOX, { w: 572, h: 300 }, 'bottom').side).toBe('bottom')
    expect(placeCallout({ x: 200, y: 270 }, BOX, { w: 572, h: 300 }, 'bottom')).toMatchObject({ side: 'top', top: 270 - 13.5 - 23 })
  })
  it('两侧都放不下 → 守优先侧', () => {
    expect(placeCallout({ x: 100, y: 30 }, { w: 60, h: 200 }, { w: 300, h: 220 }, 'bottom').side).toBe('bottom')
    expect(placeCallout({ x: 100, y: 30 }, { w: 60, h: 200 }, { w: 300, h: 220 }, 'top').side).toBe('top')
  })
  it('贴左边夹到 4,尖角离气泡左沿不少于 8', () => {
    const p = placeCallout({ x: 7, y: 150 }, BOX, { w: 572, h: 300 }, 'top')
    expect(p.left).toBe(4)
    expect(p.tipX).toBe(8)
  })
  it('贴右边夹到 w−4,尖角跟着点', () => {
    const p = placeCallout({ x: 540, y: 150 }, BOX, { w: 572, h: 300 }, 'top')
    expect(p.left).toBe(572 - 4 - 86)
    expect(p.left + p.tipX).toBe(540)
  })
})

describe('calloutMark:门禁', () => {
  it('分析层不再用 symbol:\'pin\' 装字', () => {
    const root = join(__dirname, '..', '..', '..')
    const hits: string[] = []
    const walk = (dir: string): void => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f)
        if (statSync(p).isDirectory()) { if (f !== '__tests__' && f !== 'node_modules') walk(p) }
        else if (/\.(ts|vue)$/.test(f) && !f.endsWith('.spec.ts') && /symbol:\s*'pin'/.test(readFileSync(p, 'utf8'))) hits.push(p)
      }
    }
    walk(root)
    expect(hits).toEqual([])
  })
})
