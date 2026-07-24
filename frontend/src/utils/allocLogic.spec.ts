import { describe, expect, it } from 'vitest'
import { buildAllocExportAoa, buildMonthlyGrid, resolveCfg } from './allocLogic'
import type { AllocCfgDTO, AllocResultDTO } from '@/api/alloc'

const cfg = (scope: string, cfgKey: string, value: number | null, acctMonth = ''): AllocCfgDTO =>
  ({ id: 1, scope, cfgKey, value, acctMonth, note: null })

const row = (p: Partial<AllocResultDTO>): AllocResultDTO => ({
  id: 1, tenantId: 1, tenantName: '甲', buildingId: null, buildingName: null,
  ym: '2099-01', feeKey: 'share_elec_floor', ruleId: null, qty: null, amount: 0,
  rateSnap: null, priceSnap: null, source: 'gen', note: null, generatedAt: '', ...p,
})

describe('resolveCfg 月行优先回退默认', () => {
  const rows = [
    cfg('p1', 'price_flat', 1.11417),
    cfg('p1', 'price_flat', 2, '2099-05'),
    cfg('p2', 'price_loss', 1.25312),
  ]
  it('有月行取月行', () => expect(resolveCfg(rows, 'p1', 'price_flat')).toBe(2))
  it('无月行回退默认', () => expect(resolveCfg(rows, 'p2', 'price_loss')).toBe(1.25312))
  it('两级都缺=null', () => expect(resolveCfg(rows, 'p2', 'price_sharp')).toBeNull())
})

describe('buildMonthlyGrid 户级网格', () => {
  const results = [
    row({ id: 1, tenantId: 1, tenantName: '成吉', buildingName: 'B座', feeKey: 'share_elec_floor', amount: 302.5 }),
    row({ id: 2, tenantId: 1, tenantName: '成吉', buildingName: 'B座', feeKey: 'share_elec_loss', amount: 75.43 }),
    row({ id: 3, tenantId: 2, tenantName: '合源', buildingName: 'A座', feeKey: 'share_elec_fire', amount: 63.8, source: 'manual' }),
  ]
  it('一行一户,费项归列,合计', () => {
    const grid = buildMonthlyGrid(results)
    expect(grid).toHaveLength(2)
    const cj = grid.find(g => g.tenantId === 1)!
    expect(cj.fees.share_elec_floor?.amount).toBe(302.5)
    expect(cj.total).toBe(377.93)
    expect(cj.hasManual).toBe(false)
    expect(grid.find(g => g.tenantId === 2)!.hasManual).toBe(true)
  })
  it('排序=楼栋→租户', () => {
    expect(buildMonthlyGrid(results).map(g => g.buildingName)).toEqual(['A座', 'B座'])
  })
})

describe('buildAllocExportAoa 导出平表', () => {
  it('标题+表头+户行+合计行', () => {
    const aoa = buildAllocExportAoa(buildMonthlyGrid([
      row({ tenantId: 1, tenantName: '成吉', feeKey: 'share_elec_floor', amount: 302.5 }),
    ]), '2099-01')
    expect(aoa[0][0]).toBe('公摊分摊 2099-01')
    expect(aoa[1]).toContain('楼层照明')
    expect(aoa[2][0]).toBe('成吉')
    const last = aoa[aoa.length - 1]
    expect(last[0]).toBe('合计')
    expect(last[last.length - 2]).toBe(302.5)
  })
})
