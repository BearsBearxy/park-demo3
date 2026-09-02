// src/nav/__tests__/fpNav.spec.ts
import { describe, it, expect } from 'vitest'
import { FP_NAV, fpAllPages, fpBuildRoutes, fpFindLayer } from '../fpNav'
describe('fpNav', () => {
  it('has 4 layers and 51 items', () => {
    expect(FP_NAV).toHaveLength(4)
    expect(fpAllPages()).toHaveLength(51)
  })
  it('builds a route per item with layer back-refs', () => {
    const r = fpBuildRoutes()
    expect(Object.keys(r)).toHaveLength(51)
    expect(r['buildings'].layer).toBe('data')
    // 计费参数(S21-PARAM-CENTER-SPEC §5):出账链组,合同管理之后,取代价目管理(price-cfg 不再是导航项)
    expect(r['params'].layer).toBe('data')
    expect(r['params'].page).toBe('计费参数')
    expect(r['params'].icon).toBe('sliders-horizontal')
    expect(r['price-cfg']).toBeUndefined()
    expect(r['fin-pnl'].layerLabel).toBe('经营分析')
    // 能源分析两屏(ENERGY-ANALYSIS §5):专题分析组
    expect(r['elec-analysis'].layer).toBe('analysis')
    expect(r['charging-analysis'].layer).toBe('analysis')
    // 池核算两屏(POOL-ENGINE-SPEC §6):出账链组,公共电核算承接 alloc,楼栋损耗紧随
    expect(r['alloc'].page).toBe('公共电核算')
    expect(r['alloc-loss'].layer).toBe('data')
    // 催缴单(S4-BILL-NOTICE-SPEC §7 S4-4):出账链组,楼栋损耗之后
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
})
