// src/nav/__tests__/fpNav.spec.ts
import { describe, it, expect } from 'vitest'
import { FP_NAV, fpAllPages, fpBuildRoutes, fpFindLayer } from '../fpNav'
describe('fpNav', () => {
  it('has 3 layers and 41 items', () => {
    expect(FP_NAV).toHaveLength(3)
    expect(fpAllPages()).toHaveLength(41)
  })
  it('builds a route per item with layer back-refs', () => {
    const r = fpBuildRoutes()
    expect(Object.keys(r)).toHaveLength(41)
    expect(r['buildings'].layer).toBe('data')
    expect(r['fin-pnl'].layerLabel).toBe('经营分析')
  })
  it('fpFindLayer resolves owning layer', () => {
    expect(fpFindLayer('balance-sheet').id).toBe('reports')
    expect(fpFindLayer('nope').id).toBe('data') // fallback first
  })
})
