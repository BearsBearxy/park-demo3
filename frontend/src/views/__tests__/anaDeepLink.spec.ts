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

/** pin 规则要管的分析层屏 —— 比 SENDERS 多一个 PvMeterAnaView:它的发链是 `adopt=`(不走 periodLink,
 *  见下面那条例外),但它有两处开页签,漏掉的话改回硬编码 pin 全量照样全绿(整期复查坐实)。 */
const PIN_SENDERS = [...SENDERS.filter(r => r.startsWith('views/analysis/')), 'views/analysis/PvMeterAnaView.vue']

describe('分析层发链门禁', () => {
  it.each(SENDERS)('%s 发链走 periodLink,不再手写 y/m/view 键,不再引用 utils/deepLink', (rel) => {
    const s = src(rel)
    expect(s.includes("from '@/nav/deepLink'"), `${rel} 没 import periodLink`).toBe(true)
    expect(s.includes('periodLink('), `${rel} 没调 periodLink`).toBe(true)
    expect(/query:\s*\{\s*(y|view):/.test(s), `${rel} 还在手写 y= / view= 键`).toBe(false)
    expect(s.includes("'@/utils/deepLink'"), `${rel} 还引用已删的 utils/deepLink`).toBe(false)
  })

  it('分析层不再硬编码 pin:一律 tabs.openDeep(来源在预览槽才钉住目标,规则收在 store —— P3 §4.3)', () => {
    // ⚠ 只筛分析层。SENDERS 里还有 views/reports/recon/ReconWorkbench.vue ——
    //   那两处 pin 是 spec §4.1 明写「不变」的(收入核对 → 台账 / 附10 恒钉住),断言进来会把它逼改。
    for (const rel of PIN_SENDERS) {
      const s = src(rel)
      if (!s.includes('tabs.')) continue          // 只发 query 不开页签的屏跳过
      expect(s.includes('.openDeep('), `${rel} 没改走 openDeep`).toBe(true)
      expect(s.includes('{ pin: true }'), `${rel} 还硬编码着 pin`).toBe(false)
    }
  })

  it('收入核对 → 台账 / 附10 仍是硬编码 pin(spec §4.1 明写不变;它跳的是「去把这笔改掉」,来源在哪都得钉住目标)', () => {
    expect(src('views/reports/recon/ReconWorkbench.vue').includes('{ pin: true }')).toBe(true)
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

  it('goAnom 两屏同形:带 co: a.co(附10 负值行落期区)+ 录入屏目标 openDeep(P0c 修补波加的覆盖,P3 随 pin 规则改名)', () => {
    for (const rel of ['views/analysis/AnomalyView.vue', 'views/analysis/CockpitView.vue']) {
      expect(src(rel).includes('co: a.co,'), `${rel} goAnom 丢了 co`).toBe(true)
      expect(src(rel).includes('tabs.openDeep(v)'), `${rel} goAnom 丢了 openDeep`).toBe(true)
    }
  })
})
