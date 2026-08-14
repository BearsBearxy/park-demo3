import { describe, expect, it } from 'vitest'
import { resolveCfg, upsertMonthCfg } from './allocLogic'
import type { AllocCfgDTO } from '@/api/alloc'

const cfg = (scope: string, cfgKey: string, value: number | null, acctMonth = ''): AllocCfgDTO =>
  ({ id: 1, scope, cfgKey, value, acctMonth, note: null })

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

describe('upsertMonthCfg 就地 patch 一条月行', () => {
  const rows = () => [
    cfg('rule:7', 'coefficient', 5, '2099-05'),
    cfg('rule:7', 'coefficient', 3),                 // 默认行:改月行不许动它
    cfg('rule:8', 'extra_qty', 170, '2099-05'),
  ]
  it('已有月行=改值', () => {
    const rs = rows()
    upsertMonthCfg(rs, 'rule:7', 'coefficient', '2099-05', 6)
    expect(resolveCfg(rs, 'rule:7', 'coefficient')).toBe(6)
    expect(rs).toHaveLength(3)
  })
  it('没有月行=新增(不碰默认行)', () => {
    const rs = rows()
    upsertMonthCfg(rs, 'rule:8', 'coefficient', '2099-05', 2)
    expect(rs).toHaveLength(4)
    expect(resolveCfg(rs, 'rule:8', 'coefficient')).toBe(2)
    expect(rs.find(r => r.scope === 'rule:7' && r.acctMonth === '')?.value).toBe(3)
  })
  it('null=删月行,回退默认行(同后端 saveCfg 口径)', () => {
    const rs = rows()
    upsertMonthCfg(rs, 'rule:7', 'coefficient', '2099-05', null)
    expect(rs).toHaveLength(2)
    expect(resolveCfg(rs, 'rule:7', 'coefficient')).toBe(3)
  })
  it('null 且本来就没月行=什么都不做', () => {
    const rs = rows()
    upsertMonthCfg(rs, 'rule:9', 'coefficient', '2099-05', null)
    expect(rs).toHaveLength(3)
  })
})
