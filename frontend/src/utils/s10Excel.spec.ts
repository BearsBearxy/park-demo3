import { describe, it, expect, vi } from 'vitest'
import type { S10MonthDTO } from '../types/s10'

// capture the AOA passed to aoa_to_sheet without writing a file
const aoaSpy = vi.fn((rows: unknown[][]) => ({ rows }))
vi.mock('xlsx', () => ({
  utils: {
    aoa_to_sheet: (rows: unknown[][]) => aoaSpy(rows),
    book_new: () => ({}),
    book_append_sheet: () => {},
  },
  writeFile: () => {},
}))

import { exportS10Month } from './s10Excel'
import { leavesOf } from '../views/sales-income/layout'

// factory 版面（phase 2）= 20 叶子；构造一行只填厂房租金，其余 0。
const zeros = Object.fromEntries(leavesOf('factory').map(l => [l.colId, 0])) as Record<string, number>

const dto = {
  phase: 2, year: 2026, month: 6, recorded: true,
  rows: [
    {
      id: 1, tenantId: 3, tenantName: '康泽生物', phase: 2, profile: 'factory',
      note: 'x', source: 'seed', total: 168000,
      ...zeros, factoryRent: 168000,
    },
  ],
  columnTotals: { ...zeros, factoryRent: 168000 },
  grandTotal: 168000,
} as unknown as S10MonthDTO

describe('exportS10Month', () => {
  it('lays out header / row / footer in screen column order (factory layout)', async () => {
    await exportS10Month(dto, '附表10 · 销售收入')
    const [header, row, footer] = aoaSpy.mock.calls[0][0]
    const leaves = leavesOf('factory')

    // 租户 + 20 叶子 + 合计 + 备注 = 23 列
    expect(header).toEqual(['租户', ...leaves.map(l => l.label), '合计', '备注'])
    expect(header.length).toBe(leaves.length + 3)

    // 行:租户名 + 各列金额（server-derived total 原样回显，不重算）+ 备注
    expect(row[0]).toBe('康泽生物')
    expect(row[row.length - 2]).toBe(168000) // total
    expect(row[row.length - 1]).toBe('x')    // note
    // factoryRent 是首叶子（index 1）
    expect(row[1]).toBe(168000)

    // 末行:列合计 + 总计
    expect(footer[0]).toBe('合计 · 1 户')
    expect(footer[1]).toBe(168000)
    expect(footer[footer.length - 2]).toBe(168000) // grandTotal
    expect(footer[footer.length - 1]).toBe('')
  })
})
