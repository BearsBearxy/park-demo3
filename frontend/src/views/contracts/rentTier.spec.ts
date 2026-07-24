import { describe, it, expect } from 'vitest'
import { groupTiers, currentTierIndex, tierMismatch } from './rentTier'
import type { RentTierDTO } from '@/types/contract'

const t = (o: Partial<RentTierDTO>): RentTierDTO =>
  ({ id: 1, contractId: 1, seq: 1, ...o } as RentTierDTO)

// 锚点=周兴 S10-0074:2 段,第 2 段 2024-08-10~2026-08-09 单价 14.282
const zx = [
  t({ id: 1, seq: 1, startDate: '2023-08-10', endDate: '2024-08-09', unitPrice: 12.231, monthlyAmount: 4770 }),
  t({ id: 2, seq: 2, startDate: '2024-08-10', endDate: '2026-08-09', unitPrice: 14.282, monthlyAmount: 5570 }),
]

describe('当前段判定(CONTRACT-CARD-V2-SPEC §5.2)', () => {
  it('今天落在第 2 段', () => {
    expect(currentTierIndex(zx, '2025-03-01')).toBe(1)
  })
  it('边界日闭区间:起当天/止当天都算', () => {
    expect(currentTierIndex(zx, '2023-08-10')).toBe(0)
    expect(currentTierIndex(zx, '2024-08-09')).toBe(0)
    expect(currentTierIndex(zx, '2024-08-10')).toBe(1)
    expect(currentTierIndex(zx, '2026-08-09')).toBe(1)
  })
  it('区间外返回 -1', () => {
    expect(currentTierIndex(zx, '2020-01-01')).toBe(-1)
    expect(currentTierIndex(zx, '2030-01-01')).toBe(-1)
  })
  it('相对期限(无日期)不判定', () => {
    const rel = [t({ seq: 1, label: '首年至第三年', unitPrice: 16.92 })]
    expect(currentTierIndex(rel, '2025-03-01')).toBe(-1)
  })
})

describe('分组(CONTRACT-CARD-V2-SPEC §5.1)', () => {
  it('全 null feeKey ⇒ 单轨', () => {
    expect(groupTiers(zx)).toHaveLength(1)
    expect(groupTiers(zx)[0].feeKey).toBeNull()
  })
  it('多 feeKey ⇒ 按费项分组,组内按 seq', () => {
    const multi = [
      t({ id: 1, feeKey: 'rent_factory', seq: 2 }), t({ id: 2, feeKey: 'rent_factory', seq: 1 }),
      t({ id: 3, feeKey: 'mgmt', seq: 1 }),
    ]
    const g = groupTiers(multi)
    expect(g).toHaveLength(2)
    expect(g.find(x => x.feeKey === 'rent_factory')!.rows.map(r => r.seq)).toEqual([1, 2])
  })
})

describe('换档告警(CONTRACT-CARD-V2-SPEC §5.3)', () => {
  it('当前段单价与合同现行单价不一致 ⇒ 报错档', () => {
    const m = tierMismatch(zx, '2025-03-01', 12.231)
    expect(m).not.toBeNull()
    expect(m!.expected).toBe(14.282)
    expect(m!.actual).toBe(12.231)
  })
  it('一致 ⇒ null', () => {
    expect(tierMismatch(zx, '2025-03-01', 14.282)).toBeNull()
  })
  it('无法判定当前段 ⇒ null', () => {
    expect(tierMismatch(zx, '2030-01-01', 1)).toBeNull()
  })
})
