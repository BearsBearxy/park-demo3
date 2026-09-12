// src/nav/__tests__/fpNav.spec.ts
import { describe, it, expect } from 'vitest'
import { FP_NAV, fpAllPages, fpBuildRoutes, fpFindLayer } from '../fpNav'

const layer = (id: string) => FP_NAV.find(L => L.id === id)!
const itemsOf = (id: string, title: string) => layer(id).sections.find(s => s.title === title)!.items.map(i => i.value)

describe('fpNav', () => {
  it('has 4 layers and 51 items', () => {
    expect(FP_NAV).toHaveLength(4)
    // design-boards T8:租户对标(tenant-peer)新增,租户维度组 2→3 项
    expect(fpAllPages()).toHaveLength(51)
  })
  it('builds a route per item with layer back-refs', () => {
    const r = fpBuildRoutes()
    expect(Object.keys(r)).toHaveLength(51)
    expect(r['buildings'].layer).toBe('data')
    // 首页改名「本月出账」(SIDEBAR-UX-REDESIGN §5.1 / D12):value 不变,页签/面包屑/面板从这里取字
    expect(r['data-home'].page).toBe('本月出账')
    expect(r['data-home'].icon).toBe('calendar-check')
    // 计费参数(S21-PARAM-CENTER-SPEC §5):出账组第一道工序,取代价目管理(price-cfg 不再是导航项)
    expect(r['params'].layer).toBe('data')
    expect(r['params'].page).toBe('计费参数')
    expect(r['params'].icon).toBe('sliders-horizontal')
    expect(r['price-cfg']).toBeUndefined()
    expect(r['fin-pnl'].layerLabel).toBe('经营分析')
    // 能源分析两屏(ENERGY-ANALYSIS §5):能源专题组(2026-09-03 由「专题分析」拆出)
    expect(r['elec-analysis'].layer).toBe('analysis')
    expect(r['charging-analysis'].layer).toBe('analysis')
    // 池核算两屏(POOL-ENGINE-SPEC §6):出账组,公共电核算承接 alloc,楼栋损耗紧随
    expect(r['alloc'].page).toBe('公共电核算')
    expect(r['alloc-loss'].layer).toBe('data')
    // 催缴单(S4-BILL-NOTICE-SPEC §7 S4-4):出账组,楼栋损耗之后
    expect(r['bill-notices'].layer).toBe('data')
    expect(r['bill-notices'].page).toBe('催缴单')
    expect(r['bill-notices'].kind).toBe('billNotices')
    // 系统管理层(RBAC-SPEC §4):不进 navLayers,可见性按 system:view
    expect(r['sys-users'].layer).toBe('system')
    expect(r['sys-roles'].layerLabel).toBe('系统管理')
    // 操作日志(§7 P2):三张来源表 union 的只读时间线
    expect(r['sys-logs'].layer).toBe('system')
    expect(r['sys-logs'].page).toBe('操作日志')
  })
  it('fpFindLayer resolves owning layer', () => {
    expect(fpFindLayer('balance-sheet').id).toBe('reports')
    expect(fpFindLayer('nope').id).toBe('data') // fallback first
  })
  it('数据层按动词四组:档案 / 出账 / 记账(月|年) / 导入(SIDEBAR-UX-REDESIGN §2.1)', () => {
    expect(layer('data').sections.map(s => s.title))
      .toEqual([undefined, '档案', '出账 · 每月工序', '记账 · 按月', '记账 · 按年', undefined])
    // 合同管理从出账链移入档案(D7)
    expect(itemsOf('data', '档案')).toEqual(['buildings', 'tenants', 'contracts'])
    expect(itemsOf('data', '出账 · 每月工序')).toEqual(['params', 'meters', 'alloc', 'alloc-loss', 'bill-notices'])
    // 月 / 年分组 = 后端 scheduleSources 的 monthly()/yearly();utilities 走 SchedYearGate,归年组
    expect(itemsOf('data', '记账 · 按月')).toEqual(['ledger', 'sales-income', 'salary'])
    expect(itemsOf('data', '记账 · 按年')).toEqual(['pv-income', 'car-charging', 'ebike-charging', 'elec-cost', 'utilities'])
    expect(layer('data').sections[5].items.map(i => i.value)).toEqual(['import'])
    expect(layer('data').caption).toBe('本月出账 · 记账 · 导入 · 档案')
    // 银行流水条目删除(D4):后端从没有这块数据,占位常驻是死 UI
    expect(fpBuildRoutes()['bank-flow']).toBeUndefined()
  })
  it('分析层:异常提醒中心是第一组第 2 项;经营 / 能源两个专题组(§2.3)', () => {
    const ana = layer('analysis')
    expect(ana.sections[0].title).toBeUndefined()
    expect(ana.sections[0].items.map(i => i.value)).toEqual(['cockpit', 'anomaly'])
    expect(ana.sections.map(s => s.title))
      .toEqual([undefined, '园区维度', '租户维度', '管理公司维度', '经营专题', '能源专题'])
    expect(itemsOf('analysis', '经营专题')).toEqual(['churn', 'expiry', 'breakeven', 'budget', 'pnl-analysis'])
    expect(itemsOf('analysis', '能源专题')).toEqual(['pv-roi', 'pv-meter-analysis', 'elec-analysis', 'charging-analysis'])
    // 分栋分析与投资回收同组,图标要分得开:sun 留给 pv-roi
    expect(fpBuildRoutes()['pv-meter-analysis'].icon).toBe('table-2')
  })
  it('报表层与系统层不变(§2.2 / §2.4)', () => {
    expect(layer('reports').sections.map(s => s.title)).toEqual([undefined, '三大报表', '损益附表', undefined])
    expect(layer('system').sections).toHaveLength(1)
  })
})
