// src/nav/__tests__/navHeight.spec.ts — 侧栏面板高度预算(SIDEBAR-UX-REDESIGN §3.1)。
//
// 1366×768 办公机:浏览器内视口 ≈ 620px(顶部铬边 + 任务栏吃掉 ~148)
//   → 减 stage padding 24、卡边框 2、面板 padding 32、面板头 24、两处间隙 28、分割线 1 → 导航区 ≈ 509px。
// 预算取 500,**只写在这里一处**(spec §3.1)。算式常量是 SidebarNav.vue 的实测值:
//   行 34 / 组内 gap 2(含标题到首行) / 组标题 30(--type-label 18 行高 + padding 6×2) / 组间 16。
// 想往某组塞屏而算不下时,红的是这里 —— 先想折叠或分组,不要来改数字。
import { describe, it, expect } from 'vitest'
import { FP_NAV, type NavLayer } from '../fpNav'
import { autoOpenTitles } from '../navFold'

const PANEL_BUDGET = 500
const ROW = 34, GAP = 2, TITLE = 30, SECTION_GAP = 16

/** 面板导航区高度:带标题组折叠时只剩 30px 标题行;无标题组恒展开。 */
function navHeight(layer: NavLayer, open: string[]): number {
  const parts = layer.sections.map(s => {
    const rows = s.items.length * ROW + (s.items.length - 1) * GAP
    if (!s.title) return rows
    return open.includes(s.title) ? TITLE + GAP + rows : TITLE
  })
  return parts.reduce((a, b) => a + b, 0) + (layer.sections.length - 1) * SECTION_GAP
}

const layer = (id: string) => FP_NAV.find(L => L.id === id)!
const BUSINESS = FP_NAV.filter(L => L.id !== 'system').map(L => [L.id, L] as const)

describe('侧栏面板高度预算(§3.1)', () => {
  it('算式与 spec 表一致:默认态(站在层首页)数据 448 / 报表 284 / 分析 300', () => {
    expect(navHeight(layer('data'), autoOpenTitles(layer('data'), 'data-home'))).toBe(448)
    expect(navHeight(layer('reports'), autoOpenTitles(layer('reports'), 'reports-home'))).toBe(284)
    expect(navHeight(layer('analysis'), autoOpenTitles(layer('analysis'), 'cockpit'))).toBe(300)
  })
  it.each(BUSINESS)('%s 层默认态 ≤ 500', (_id, L) => {
    expect(navHeight(L, autoOpenTitles(L, L.home))).toBeLessThanOrEqual(PANEL_BUDGET)
  })
  it.each(BUSINESS)('%s 层任一单组展开 ≤ 500', (_id, L) => {
    for (const s of L.sections) {
      if (!s.title) continue
      expect(navHeight(L, [s.title]), s.title).toBeLessThanOrEqual(PANEL_BUDGET)
    }
  })
})

describe('autoOpenTitles(§2.1 / §3.2)', () => {
  it('层首页:数据层开「出账」,报表层开「三大报表」,分析层不开组', () => {
    expect(autoOpenTitles(layer('data'), 'data-home')).toEqual(['出账 · 每月工序'])
    expect(autoOpenTitles(layer('reports'), 'reports-home')).toEqual(['三大报表'])
    expect(autoOpenTitles(layer('analysis'), 'cockpit')).toEqual([])
  })
  it('组内屏:只开含当前屏的那一组;无标题组的屏不开任何组', () => {
    expect(autoOpenTitles(layer('data'), 'salary')).toEqual(['记账 · 按月'])
    expect(autoOpenTitles(layer('analysis'), 'pv-roi')).toEqual(['能源专题'])
    expect(autoOpenTitles(layer('data'), 'import')).toEqual([])
    expect(autoOpenTitles(layer('data'), 'nope')).toEqual([])
  })
})
