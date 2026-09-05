// src/views/__tests__/anaDeepLink.spec.ts — 分析层 / 收入核对工作台发链的源码形状门禁(SIDEBAR-UX-REDESIGN §4.2 · P0c)。
// 这些屏零挂载测(echarts + anaData 太重),发链形状靠这里钉:统一 periodLink,不再手写 y/m/view 键;
// 特例反向钉住:PvMeterAnaView 的 adopt= 不是选月(P0A-2);utils/deepLink 已删。
// 目标屏怎么吃这些 query 由 ledgerDeepLink / s10DeepLink / schedDeepLink 各自的挂载测钉。
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..', '..')
const src = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

/** 发链文件:台账 / 附10 / 附表1–5 的深链出口。 */
const SENDERS = [
  'views/analysis/ChurnView.vue',
  'views/analysis/FinCashflowView.vue',
  'views/analysis/AnomalyView.vue',
  'views/analysis/CockpitView.vue',
  'views/analysis/TenantEnergyView.vue',
  'views/analysis/BudgetView.vue',
  'views/analysis/PnlAnalysisView.vue',
  'views/reports/recon/ReconWorkbench.vue',
  'views/analysis/ElecAnalysisView.vue',
  'views/analysis/ChargingAnalysisView.vue',
]

describe('分析层发链门禁', () => {
  it.each(SENDERS)('%s 发链走 periodLink,不再手写 y/m/view 键,不再引用 utils/deepLink', (rel) => {
    const s = src(rel)
    expect(s.includes("from '@/nav/deepLink'"), `${rel} 没 import periodLink`).toBe(true)
    expect(s.includes('periodLink('), `${rel} 没调 periodLink`).toBe(true)
    expect(/query:\s*\{\s*(y|view):/.test(s), `${rel} 还在手写 y= / view= 键`).toBe(false)
    expect(s.includes("'@/utils/deepLink'"), `${rel} 还引用已删的 utils/deepLink`).toBe(false)
  })

  it('openFresh({pin:true}) 一行不动(spec §4.1:收入核对 / 分析层 → 台账 / 附10 的页签语义;pin 规则归 P3)', () => {
    for (const rel of SENDERS.filter(r => !r.includes('Budget') && !r.includes('PnlAnalysis'))) {
      expect(src(rel).includes('{ pin: true }'), `${rel} 丢了 openFresh pin`).toBe(true)
    }
  })

  it('PvMeterAnaView 的 adopt= 不走 periodLink —— 它不是选月(P0A-2),是「采纳参数」', () => {
    const s = src('views/analysis/PvMeterAnaView.vue')
    expect(s.includes('adopt:')).toBe(true)
    expect(s.includes("periodLink('params'")).toBe(false)
  })

  it('utils/deepLink.ts 已删(零消费方;vue-tsc 证明没人再引)', () => {
    expect(existsSync(join(SRC, 'utils/deepLink.ts'))).toBe(false)
    expect(existsSync(join(SRC, 'utils/deepLink.spec.ts'))).toBe(false)
  })

  it('电费收益「去看成本」发 mode=cost(改前发 view=cost,键名对不上 ElecView 的 ?mode=,永远落报送台账)', () => {
    expect(src('views/analysis/ElecAnalysisView.vue').includes("mode: 'cost'")).toBe(true)
  })
  it('充电桩分析点桩柱发 mode=meter + station(改前裸 push 到门为止)', () => {
    const s = src('views/analysis/ChargingAnalysisView.vue')
    expect(s.includes("mode: 'meter'")).toBe(true)
    expect(s.includes('station:')).toBe(true)
  })
  it('到期墙点行带合同号(合同没有期,不走 periodLink —— 目标是 ContractsView 的搜索框)', () => {
    expect(src('views/analysis/ExpiryView.vue').includes('contractNo:')).toBe(true)
  })

  it('goAnom 两屏同形:带 co: a.co(附10 负值行落期区)+ 录入屏目标 openFresh(P0c 修补波;发链侧此前零覆盖)', () => {
    for (const rel of ['views/analysis/AnomalyView.vue', 'views/analysis/CockpitView.vue']) {
      expect(src(rel).includes('co: a.co,'), `${rel} goAnom 丢了 co`).toBe(true)
      expect(src(rel).includes('tabs.openFresh(v, { pin: true })'), `${rel} goAnom 丢了 openFresh`).toBe(true)
    }
  })
})
