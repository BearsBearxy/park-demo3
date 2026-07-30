import { describe, expect, it } from 'vitest'
import { resolveCfg } from './allocLogic'
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
