import { describe, it, expect } from 'vitest'
import { lineMonthly, defaultBillMode, FEE_KEYS, FEE_NAME } from '@/types/contract'
import type { FeeKey, BillMode } from '@/types/contract'

// 合同页计费行「月单价只读派生」验收(BILL-FORWARD 刀1 §1.6):
// 三变体锚点逐格核对——金纳(单位置5标准行) / 银纳(厂房+宿舍+门禁+网络) / 翔海(多位置系数)。
// 抽屉/弹窗的月单价列都调 lineMonthly,formula 错这里即红。
const row = (feeKey: FeeKey, p: Partial<{ area: number; unitPrice: number; coeff: number; roomCount: number; amountOverride: number; billMode: BillMode }> = {}) =>
  ({ feeKey, billMode: p.billMode ?? defaultBillMode(feeKey), area: p.area ?? null, unitPrice: p.unitPrice ?? null, coeff: p.coeff ?? null, roomCount: p.roomCount ?? null, amountOverride: p.amountOverride ?? null })

describe('计费行月单价派生 · 三变体锚点', () => {
  it('金纳:单位置「主」5 标准行', () => {
    expect(lineMonthly(row('rent_factory', { area: 3200, unitPrice: 9.6785 }))).toBe(30971.2)
    expect(lineMonthly(row('mgmt', { area: 3200, unitPrice: 5.45 }))).toBe(17440)
    expect(lineMonthly(row('infra', { area: 3200, unitPrice: 1.91 }))).toBe(6112)
    expect(lineMonthly(row('elevator', { amountOverride: 318 }))).toBe(318)
    expect(lineMonthly(row('transformer', { amountOverride: 159 }))).toBe(159)
  })

  it('银纳:厂房位置 + 宿舍位置 + 按间门禁/网络', () => {
    expect(lineMonthly(row('rent_factory', { area: 256.52, unitPrice: 22.565 }))).toBeCloseTo(5788.4, 1)
    expect(lineMonthly(row('rent_dorm', { area: 488.33, unitPrice: 19 }))).toBe(9278.27)
    expect(lineMonthly(row('access', { unitPrice: 100, roomCount: 13 }))).toBe(108.33)   // per_room_year:年÷12
    expect(lineMonthly(row('network', { unitPrice: 50, roomCount: 13 }))).toBe(650)       // per_room_month
  })

  it('翔海:多位置,系数 1.56 独立可见(不折入单价)', () => {
    expect(lineMonthly(row('rent_factory', { area: 4708, unitPrice: 12.1, coeff: 1.56 }))).toBe(88868.21)
  })

  it('变压器 ≥150KVA:per_kva_month = KVA×1(取 contract.kva)', () => {
    expect(lineMonthly(row('transformer', { billMode: 'per_kva_month' }), 200)).toBe(200)
  })

  it('缺参数=待录(null),不塌 0', () => {
    expect(lineMonthly(row('rent_factory', { area: 3200 }))).toBeNull()   // 缺单价
    expect(lineMonthly(row('elevator'))).toBeNull()                       // 缺直填月额
    expect(lineMonthly(row('access', { unitPrice: 100 }))).toBeNull()     // 缺房数
  })

  it('系数默认 1(空当 1,非当 0)', () => {
    expect(lineMonthly(row('rent_factory', { area: 100, unitPrice: 10 }))).toBe(1000)
  })

  it('13 枚举齐全,费项名映射无缺', () => {
    expect(FEE_KEYS).toHaveLength(13)
    for (const k of FEE_KEYS) expect(FEE_NAME[k]).toBeTruthy()
  })
})
