// src/nav/__tests__/fpNav.spec.ts
import { describe, it, expect } from 'vitest'
import { FP_NAV, fpAllPages, fpBuildRoutes, fpFindLayer } from '../fpNav'
describe('fpNav', () => {
  it('has 3 layers and 47 items', () => {
    expect(FP_NAV).toHaveLength(3)
    expect(fpAllPages()).toHaveLength(47)
  })
  it('builds a route per item with layer back-refs', () => {
    const r = fpBuildRoutes()
    expect(Object.keys(r)).toHaveLength(47)
    expect(r['buildings'].layer).toBe('data')
    // 价目管理(PRICE-CFG-SPEC §6):出账链组,合同管理之后
    expect(r['price-cfg'].layer).toBe('data')
    expect(r['fin-pnl'].layerLabel).toBe('经营分析')
    // 能源分析两屏(ENERGY-ANALYSIS §5):专题分析组
    expect(r['elec-analysis'].layer).toBe('analysis')
    expect(r['charging-analysis'].layer).toBe('analysis')
    // 池核算两屏(POOL-ENGINE-SPEC §6):出账链组,公共电核算承接 alloc,楼栋损耗紧随
    expect(r['alloc'].page).toBe('公共电核算')
    expect(r['alloc-loss'].layer).toBe('data')
  })
  it('fpFindLayer resolves owning layer', () => {
    expect(fpFindLayer('balance-sheet').id).toBe('reports')
    expect(fpFindLayer('nope').id).toBe('data') // fallback first
  })
})
