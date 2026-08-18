import { describe, it, expect, vi } from 'vitest'
import type { CollectionRow } from './finCashflow.logic'
import type { TenantDTO } from '@/types/tenant'

// capture the AOA handed to the sheet adapter without writing a file (同 pvExcel.spec 模式)
const aoaSpy = vi.fn((rows: unknown[][]) => ({ rows }))
vi.mock('@/utils/sheet', () => ({
  writeAoaWorkbook: (_f: string, sheets: { aoa: unknown[][] }[]) => { aoaSpy(sheets[0].aoa) },
}))

import { exportCollectionList } from './collectionExcel'

const tenant = (p: Partial<TenantDTO>): TenantDTO => ({
  id: 1, companyName: '王柱', contactName: '王柱', contactPhone: '138-0000',
  businessType: '仓储', status: 1, categoryId: null, phase: 1, since: null,
  monthlyRent: 0, leasedArea: 0, primaryBuilding: null, contractCount: 0,
  parentId: null, parentName: null, ...p,
})

const rows: CollectionRow[] = [
  { tenantName: '王柱', companyName: '甲公司', buckets: [100, 0, 0, 1835], total: 1935, oldestYm: '期初旧账' },
  { tenantName: '无名租户', companyName: '乙公司', buckets: [0, 50, 0, 0], total: 50, oldestYm: '2025-08' },
]

describe('exportCollectionList', () => {
  it('口径行/表头/明细(联系方式按租户名查,查不到留空)/合计尾行', async () => {
    await exportCollectionList(rows, [tenant({})], { latestYm: '2025-10', familyMode: false, companyLabel: '全部公司(汇总)' })
    const [caption, header, r1, r2, footer] = aoaSpy.mock.calls[0][0]
    expect(caption[0]).toContain('按租户')
    expect(caption[0]).toContain('2025-10')
    expect(header).toEqual(['租户', '公司', '联系人', '电话', '≤1月', '2~3月', '4~6月', '>6月', '欠费合计', '最早欠费月'])
    expect(r1).toEqual(['王柱', '甲公司', '王柱', '138-0000', 100, 0, 0, 1835, 1935, '期初旧账'])
    expect(r2).toEqual(['无名租户', '乙公司', '', '', 0, 50, 0, 0, 50, '2025-08'])
    expect(footer).toEqual(['合计(2户)', '', '', '', 100, 50, 0, 1835, 1985, ''])
  })

  it('家族口径:首列表头/合计单位改「家族/族」', async () => {
    aoaSpy.mockClear()
    await exportCollectionList(rows.slice(0, 1), [], { latestYm: '2025-10', familyMode: true, companyLabel: '甲公司' })
    const [caption, header, , footer] = aoaSpy.mock.calls[0][0]
    expect(caption[0]).toContain('按家族')
    expect(header[0]).toBe('家族')
    expect(footer[0]).toBe('合计(1族)')
  })
})
