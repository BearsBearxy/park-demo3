// src/nav/__tests__/fpNav.spec.ts
import { describe, it, expect } from 'vitest'
import { FP_NAV, fpAllPages, fpBuildRoutes, fpFindLayer } from '../fpNav'
describe('fpNav', () => {
  it('has 3 layers and 45 items', () => {
    expect(FP_NAV).toHaveLength(3)
    expect(fpAllPages()).toHaveLength(45)
  })
  it('builds a route per item with layer back-refs', () => {
    const r = fpBuildRoutes()
    expect(Object.keys(r)).toHaveLength(45)
    expect(r['buildings'].layer).toBe('data')
    expect(r['fin-pnl'].layerLabel).toBe('经营分析')
    // 能源分析两屏(ENERGY-ANALYSIS §5):专题分析组
    expect(r['elec-analysis'].layer).toBe('analysis')
    expect(r['charging-analysis'].layer).toBe('analysis')
  })
  it('fpFindLayer resolves owning layer', () => {
    expect(fpFindLayer('balance-sheet').id).toBe('reports')
    expect(fpFindLayer('nope').id).toBe('data') // fallback first
  })
})
