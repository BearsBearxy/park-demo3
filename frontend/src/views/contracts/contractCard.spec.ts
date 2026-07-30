import { describe, it, expect } from 'vitest'
import {
  PINNED_FEES, COND_FEES, OPTIONAL_FEES, PROPERTY_TYPES,
  feeLabel, inferPropertyType, pinnedDefaultUnitPrice,
} from '@/types/contract'
import type { FeeKey, PropertyType, ContractDTO } from '@/types/contract'
import { leafIds, ancestorsOf, descendantsOf, chainOf, displayIds } from './chain'

// CONTRACT-CARD-SPEC §1/§7.1:类型钉死费用组 + §5.3 续签链聚合。
// 锚点=后端 ALLOWED_FEES(= PINNED ∪ COND ∪ OPTIONAL[land_tax]),前后端必须逐格一致。

// 镜像后端 ContractService.ALLOWED_FEES(§7.1),此处独立写死做交叉核对
const BACKEND_ALLOWED: Record<PropertyType, FeeKey[]> = {
  factory: ['rent_factory', 'mgmt', 'infra', 'elevator', 'transformer', 'land_tax'],
  office:  ['rent_office', 'mgmt', 'elevator', 'transformer', 'land_tax'],
  dorm:    ['rent_dorm', 'infra', 'access', 'network', 'land_tax'],
  shop:    ['rent_shop', 'infra', 'mgmt', 'transformer', 'land_tax'],
  land:    ['rent_land', 'land_tax'],
}

describe('类型钉死费用组 · 与后端白名单一致', () => {
  it('PINNED ∪ COND ∪ OPTIONAL 覆盖后端允许集(逐类型逐费项)', () => {
    for (const pt of PROPERTY_TYPES) {
      const front = new Set<FeeKey>([...PINNED_FEES[pt], ...COND_FEES[pt], ...OPTIONAL_FEES])
      expect([...front].sort()).toEqual([...BACKEND_ALLOWED[pt]].sort())
    }
  })

  it('拍板钉死项(2026-07-24):办公室不含基础维护;宿舍含门禁+网络无条件项;空地只租金', () => {
    expect(PINNED_FEES.office).not.toContain('infra')
    expect(PINNED_FEES.office).toEqual(['rent_office', 'mgmt'])
    expect(PINNED_FEES.dorm).toEqual(['rent_dorm', 'infra', 'access', 'network'])
    expect(COND_FEES.dorm).toEqual([])
    expect(PINNED_FEES.land).toEqual(['rent_land'])
    expect(COND_FEES.shop).toEqual(['transformer'])   // 商铺条件项仅变压器,无电梯
  })

  it('门禁/网络预置单价 100/50,其余待填', () => {
    expect(pinnedDefaultUnitPrice('access')).toBe(100)
    expect(pinnedDefaultUnitPrice('network')).toBe(50)
    expect(pinnedDefaultUnitPrice('rent_factory')).toBeNull()
  })
})

describe('上下文显示名 feeLabel(§7.2)', () => {
  it('mgmt/infra 随段类型加前缀', () => {
    expect(feeLabel('factory', 'mgmt')).toBe('厂房企业管理服务费')
    expect(feeLabel('office', 'mgmt')).toBe('办公室企业管理服务费')
    expect(feeLabel('dorm', 'infra')).toBe('宿舍基础设施维护费')
    expect(feeLabel('shop', 'mgmt')).toBe('商铺企业管理服务费')
  })
  it('租金/电梯等非前缀项直取 FEE_NAME', () => {
    expect(feeLabel('factory', 'rent_factory')).toBe('厂房租金')
    expect(feeLabel('factory', 'elevator')).toBe('电梯维护费')
    expect(feeLabel('land', 'rent_land')).toBe('空地租金')
  })
})

describe('遗留段类型反推 inferPropertyType', () => {
  it('按租金 fee_key 反推,非租金兜底 factory', () => {
    expect(inferPropertyType('rent_office')).toBe('office')
    expect(inferPropertyType('rent_dorm')).toBe('dorm')
    expect(inferPropertyType('rent_shop')).toBe('shop')
    expect(inferPropertyType('rent_land')).toBe('land')
    expect(inferPropertyType('mgmt')).toBe('factory')
  })
})

describe('续签链聚合(§5.3)', () => {
  // 链:1 →(续)2 →(续)3;另有独立合同 9。3 与 9 为叶子。
  const c = (id: number, parent: number | null): ContractDTO =>
    ({ id, parentContractId: parent, contractNo: 'HT-' + id, startDate: null, endDate: null } as unknown as ContractDTO)
  const list = [c(1, null), c(2, 1), c(3, 2), c(9, null)]

  it('叶子=不被任何合同引用为 parent 的合同(每链最新期)', () => {
    const leaves = leafIds(list)
    expect(leaves.has(3)).toBe(true)
    expect(leaves.has(9)).toBe(true)
    expect(leaves.has(1)).toBe(false)
    expect(leaves.has(2)).toBe(false)
    expect(leaves.size).toBe(2)
  })

  it('ancestorsOf 沿 parentContractId 上溯(近→远)', () => {
    expect(ancestorsOf(list, 3).map(x => x.id)).toEqual([2, 1])
    expect(ancestorsOf(list, 9)).toEqual([])
  })

  it('环/悬空 parent 不死循环', () => {
    const bad = [c(1, 2), c(2, 1)]        // 互指环
    expect(ancestorsOf(bad, 1).length).toBeLessThanOrEqual(2)
    const dangling = [c(5, 999)]           // 悬空 parent
    expect(ancestorsOf(dangling, 5)).toEqual([])
  })

  it('descendantsOf 沿 parent 向下找后代(远→近)', () => {
    expect(descendantsOf(list, 1).map(x => x.id)).toEqual([2, 3])
    expect(descendantsOf(list, 3)).toEqual([])
  })

  it('chainOf 返回整条链并标期号(1,2,3)', () => {
    expect(chainOf(list, 2).map(x => [x.seq, x.c.id])).toEqual([[1, 1], [2, 2], [3, 3]])
    expect(chainOf(list, 9).map(x => [x.seq, x.c.id])).toEqual([[1, 9]])
  })

  it('chainOf 遇环/悬空不死循环', () => {
    const bad = [c(1, 2), c(2, 1)]
    expect(chainOf(bad, 1).length).toBeLessThanOrEqual(2)
    expect(chainOf([c(5, 999)], 5).map(x => x.c.id)).toEqual([5])
  })

  it('chainOf 遇分叉取最新一条(id 大者)并告警', () => {
    const forked = [c(1, null), c(2, 1), c(3, 1)]   // 1 被续签两次
    const ids = chainOf(forked, 1).map(x => x.c.id)
    expect(ids).toEqual([1, 3])
  })
})

// 默认视图取「当前生效段」而非无条件取链尾(2026-07-28 拍板:旭化成 382 在租 / 383 未起租)
describe('默认显示段 displayIds(2026-07-28)', () => {
  const d = (id: number, parent: number | null, start: string | null, end: string | null, status = 'active') =>
    ({ id, parentContractId: parent, contractNo: 'HT-' + id, startDate: start, endDate: end, status } as unknown as ContractDTO)
  const TODAY = '2026-07-28'

  it('链尾未起租时取覆盖今天的那一期(旭化成 382/383)', () => {
    const list = [d(382, null, '2023-10-27', '2026-10-26'), d(383, 382, '2026-10-27', '2027-10-26')]
    expect([...displayIds(list, TODAY)]).toEqual([382])
  })

  it('链尾已生效则仍取链尾', () => {
    const list = [d(1, null, '2023-01-01', '2026-01-31'), d(2, 1, '2026-02-01', '2029-01-31')]
    expect([...displayIds(list, TODAY)]).toEqual([2])
  })

  it('整链无生效段(全过期)退回链尾', () => {
    const list = [d(1, null, '2020-01-01', '2021-12-31'), d(2, 1, '2022-01-01', '2023-12-31')]
    expect([...displayIds(list, TODAY)]).toEqual([2])
  })

  it('已终止/草稿不算生效段', () => {
    const list = [d(1, null, '2023-01-01', '2027-12-31', 'terminated'), d(2, 1, '2026-10-01', '2028-12-31', 'draft')]
    expect([...displayIds(list, TODAY)]).toEqual([2])   // 无生效段 → 链尾
  })

  it('缺起止日不误判为生效段', () => {
    const list = [d(1, null, null, null), d(2, 1, '2026-10-27', '2027-10-26')]
    expect([...displayIds(list, TODAY)]).toEqual([2])
  })

  it('多链各自独立取段', () => {
    const list = [d(382, null, '2023-10-27', '2026-10-26'), d(383, 382, '2026-10-27', '2027-10-26'),
                  d(9, null, '2024-01-01', '2027-01-01')]
    expect([...displayIds(list, TODAY)].sort((a, b) => a - b)).toEqual([9, 382])
  })
})
