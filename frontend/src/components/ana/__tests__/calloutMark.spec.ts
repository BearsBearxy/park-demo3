// 图上点标注(calloutMark)的几何断言 —— 2026-09-17 用户:「根本看不见字」。
// 改前是 symbol:'pin',两行字画在 30~44px 的针头里,溢出针头的白字落在白底上。
// 这里用 ECharts SSR 真排一遍版,量三件事:字在签里、签在画布里、签不压住它标的那个点。
// jsdom 没有 canvas,zrender 退回按字号估字宽(汉字 = 1 个字号宽)—— 与浏览器差几个像素,
// 所以边界留了 2px 容差;真屏另在浏览器 390 / 1366 宽下量过(见提交说明)。
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as echarts from 'echarts'
import { CALLOUT, FP_ANA_THEME } from '../anaTheme'
import { calcBe, cvpOption } from '@/views/analysis/breakeven.logic'
import { fitRevenueTrend, mainChart, mainChartOption, outlierResidualsByMonth } from '@/views/analysis/cockpit.logic'
import type { PnlSummary } from '@/analysis/anaData'

echarts.registerTheme('fpAnaTheme', FP_ANA_THEME)

interface Box { x: number; y: number; w: number; h: number }
interface Callout { chip: Box; lines: Box[]; dot: { x: number; y: number } }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalBox = (el: any): Box => {
  const r = el.getBoundingRect().clone()
  r.applyTransform(el.getComputedTransform())
  return { x: r.x, y: r.y, w: r.width, h: r.height }
}

function layout(option: object, color: string, width: number, height: number): Callout[] {
  const chart = echarts.init(null, 'fpAnaTheme', { renderer: 'svg', ssr: true, width, height })
  chart.setOption({ ...option, animation: false })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list: any[] = chart.getZr().storage.getDisplayList(true)
  // 签 = 底色为 color 的 ZRText 背景矩形;字 = 同一个 ZRText 下的 TSpan;点 = 填 color 的圆
  const out: Callout[] = []
  for (const bg of list.filter((e) => e.type === 'rect' && e.style.fill === color && e.parent?.type === 'text')) {
    const text = bg.parent
    const lines = list.filter((e) => e.type === 'tspan' && e.parent === text).map(globalBox)
    const host = text.__hostTarget
    const dot = host.getBoundingRect().clone()
    dot.applyTransform(host.getComputedTransform())
    out.push({ chip: globalBox(bg), lines, dot: { x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 } })
  }
  chart.dispose()
  return out
}

const TOL = 2
const inside = (a: Box, b: Box): boolean =>
  a.x >= b.x - TOL && a.y >= b.y - TOL && a.x + a.w <= b.x + b.w + TOL && a.y + a.h <= b.y + b.h + TOL
const contains = (b: Box, p: { x: number; y: number }): boolean =>
  p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h

function expectReadable(cs: Callout[], width: number, height: number, n = 1): void {
  expect(cs).toHaveLength(n)
  for (const c of cs) {
    expect(c.lines.length, '签里得有字').toBeGreaterThan(0)
    for (const l of c.lines) expect(inside(l, c.chip), `字 ${JSON.stringify(l)} 溢出签 ${JSON.stringify(c.chip)}`).toBe(true)
    expect(inside(c.chip, { x: 0, y: 0, w: width, h: height }), `签 ${JSON.stringify(c.chip)} 出了 ${width}×${height} 画布`).toBe(true)
    expect(contains(c.chip, c.dot), '签压住了它标的点').toBe(false)
  }
}

// 手机 S 档卡内宽 ~350 / 桌面 ~1000;高取 S 档 260 与桌面 300
const SIZES: [number, number][] = [[350, 260], [1000, 300]]

describe('calloutMark:签里的字看得见', () => {
  it.each(SIZES)('盈亏平衡 保本点 %i×%i:签在点的左上', (w, h) => {
    const be = calcBe(1_180_000, 1_020_000, 0.62)   // 保本 ≈ 47%,与库里当前口径同一量级
    const cs = layout(cvpOption(be, true), CALLOUT.amber, w, h)
    expectReadable(cs, w, h)
    const { chip, dot } = cs[0]
    expect(chip.y + chip.h).toBeLessThanOrEqual(dot.y)
    expect(chip.x + chip.w).toBeLessThanOrEqual(dot.x + TOL)
  })

  it.each(SIZES)('驾驶舱 负收入月 %i×%i:点在柱头,签在柱头下方', (w, h) => {
    const N12 = (): (number | null)[] => new Array(12).fill(null)
    const rev = [512, 498, 530, 541, 505, 522, 560, 548, 533, 551, 1180, -63.6].map((v) => v * 10000)
    const profit = [88, 71, 95, 102, 80, 90, 118, 104, 99, 110, 402, -655.3].map((v) => v * 10000)
    const pnl: PnlSummary = { year: 2025, months: Array.from({ length: 12 }, (_, i) => i + 1), revenue: rev, cost: N12(), profit, bySchedule: {} }
    const d = mainChart(pnl, 9_270_0000)!
    const fit = fitRevenueTrend(pnl)
    const opt = mainChartOption(d, outlierResidualsByMonth(fit, d.rev, d.outlierMonths), 'none')!
    const cs = layout(opt, CALLOUT.red, w, h)
    expectReadable(cs, w, h)
    expect(cs[0].chip.y).toBeGreaterThanOrEqual(cs[0].dot.y)
    expect(cs[0].lines.length, '两行:收入为负 / N倍残差').toBe(2)
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
