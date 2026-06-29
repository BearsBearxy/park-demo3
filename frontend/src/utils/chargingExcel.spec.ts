import { describe, it, expect, vi } from 'vitest'
import type { ChargingYearDTO } from '../types/charging'

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

import { exportChargingYear } from './chargingExcel'

const dto: ChargingYearDTO = {
  year: 2026,
  cats: [],
  rows: [
    { id: 1, scheduleNo: 7, cat: 'dc', catName: '直流快充桩', acctMonth: '2026-01',
      kwh: 42000, fee: 36120, cost: 26040, profit: 10080, note: 'x', source: 'seed' },
  ],
  total: { kwh: 42000, fee: 36120, cost: 26040, profit: 10080 },
}

describe('exportChargingYear', () => {
  it('lays out header / row / footer in screen column order', async () => {
    await exportChargingYear(dto, 2026, '附表7 · 汽车充电桩')
    const [header, row, footer] = aoaSpy.mock.calls[0][0]
    expect(header).toEqual(['类别', '记账月', '充电电量', '手续费及服务费', '充电成本', '利润', '备注'])
    // profit is server-derived; row echoes it, never recomputed here
    expect(row).toEqual(['直流快充桩', '2026-01', 42000, 36120, 26040, 10080, 'x'])
    expect(footer).toEqual(['本年合计', '', 42000, 36120, 26040, 10080, ''])
  })
})
