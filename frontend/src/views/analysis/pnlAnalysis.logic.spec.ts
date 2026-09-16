// pnlAnalysis.logic 单测:全年汇总/迷你序列/12月组合/环比右移/结构堆叠(口径=v1)。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PnlBand } from '@/analysis/anaData'
import { momShift, schedMonthly, schedSpark, schedTotals, structStack } from './pnlAnalysis.logic'

const nulls = (): (number | null)[] => new Array(12).fill(null)
function band(rev?: Partial<Record<number, number>>, cost?: Partial<Record<number, number>>, pnl?: Partial<Record<number, number>>): PnlBand {
  const fill = (src?: Partial<Record<number, number>>): (number | null)[] => {
    const a = nulls()
    for (const [m, v] of Object.entries(src ?? {})) a[+m - 1] = v as number
    return a
  }
  return { rev: fill(rev), cost: fill(cost), pnl: fill(pnl) }
}

describe('schedTotals', () => {
  it('常规附表:收入/成本/损益求和;缺 pnl 行退化 收入−成本', () => {
    expect(schedTotals(band({ 1: 100, 2: 200 }, { 1: 80 }, { 1: 20, 2: 200 }), false))
      .toEqual({ income: 300, cost: 80, pnl: 220 })
    expect(schedTotals(band({ 1: 300 }, { 1: 100 }), false)).toEqual({ income: 300, cost: 100, pnl: 200 })
  })
  it('s5 仅费用;无任何月值 → null', () => {
    expect(schedTotals(band(undefined, { 3: 55 }), true)).toEqual({ income: 0, cost: 55, pnl: 0 })
    expect(schedTotals(band(), true)).toBeNull()
    expect(schedTotals(band(), false)).toBeNull()
    expect(schedTotals(undefined, false)).toBeNull()
  })
})

describe('schedSpark / schedMonthly', () => {
  it('迷你序列=覆盖月损益(万元);s5=费用', () => {
    const b = band({ 1: 1e4, 2: 3e4 }, { 1: 1e4 }, { 1: 0, 2: 3e4 })
    expect(schedSpark(b, false, [1, 2])).toEqual([0, 3])
    expect(schedSpark(band(undefined, { 1: 2e4, 2: 4e4 }), true, [1, 2])).toEqual([2, 4])
  })
  it('组合序列:labels/rev/cost/pnl 折万;s5 仅 cost', () => {
    const b = band({ 1: 2e4 }, { 1: 1e4 })
    expect(schedMonthly(b, false, [1])).toEqual({ labels: ['1月'], rev: [2], cost: [1], pnl: [1] })
    const e = schedMonthly(band(undefined, { 1: 5e4 }), true, [1])
    expect(e).toEqual({ labels: ['1月'], rev: [], cost: [5], pnl: [] })
  })
})

describe('momShift', () => {
  it('右移一位,首位 null', () => {
    expect(momShift([1, 2, 3])).toEqual([null, 1, 2])
    expect(momShift([])).toEqual([])
  })
})

describe('structStack', () => {
  it('附表1-4 收入 ×覆盖月(万元),缺附表 → 0', () => {
    const by = { s1: band({ 1: 1e4 }), s2: band({ 1: 2e4 }) } as Record<string, PnlBand>
    const out = structStack(by, [1])
    expect(out.map((s) => s.name)).toEqual(['租金', '用电', '用水', '运管'])
    expect(out[0].values).toEqual([1])
    expect(out[1].values).toEqual([2])
    expect(out[2].values).toEqual([0])
  })
})

// ───────── C6-01 首进骨架 ─────────
// 源码形状门禁:迷你卡复用 .pa2-mini 的盒子,块高照真版式(图标 30 · 编号 11 · 名 12 · 迷你线 26 · 脚 15);
// 两张图照各自的 :height 300。改任何一个数忘了同步骨架,这条就红。
describe('损益分析首进骨架(C6-01)', () => {
  const src = readFileSync(join(__dirname, 'PnlAnalysisView.vue'), 'utf8')
  const skel = src.slice(src.indexOf('class="pa2-page pa2-skel"'), src.indexOf('<div v-else-if="!recordedCount"'))

  it('❗不转圈;骨架块高 = 迷你卡 30/11/12/26/15 + 两张图卡头 20 + 图 300', () => {
    expect(src).not.toContain('page-spin')
    // 顶替 AnaEChart 的块是 <AnaSkelChart :height>(与图同表降档,C6-01 ≤600),其余是写死高的 .fp-shim
    expect([...skel.matchAll(/height: (\d+)px|<AnaSkelChart :height="(\d+)"/g)].map(m => m[1] ?? m[2]))
      .toEqual(['30', '11', '12', '26', '15', '20', '300', '20', '300'])
    // 真版式那一侧:迷你线 26(AnaSpark :h)、图标盒 30、两张图 300
    expect(src).toContain(':w="150" :h="26"')
    expect(src).toMatch(/\.pa2-mini \.ic \{ width: 30px; height: 30px;/)
    expect(src).toContain(':option="mainOpt" :height="300"')
    expect(src).toContain(':option="structOpt" :height="300"')
  })
})
