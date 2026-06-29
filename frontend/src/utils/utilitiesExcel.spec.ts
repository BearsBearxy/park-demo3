import { describe, it, expect, vi } from 'vitest'
import type { OfficeYearDTO } from '../types/utilities'

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

import { exportUtilitiesYear } from './utilitiesExcel'

const dto: OfficeYearDTO = {
  year: 2026,
  scheduleNo: 13,
  rows: [
    { id: 1, scheduleNo: 13, acctMonth: '2026-01', belongMonth: '2025-12',
      elecQty: 3072, elecPrice: 0.8123, elecAmt: 2495.4,
      waterQty: 154, waterPrice: 4.15, waterAmt: 639.1, total: 3134.5,
      note: 'x', source: 'seed' },
  ],
  total: { elecQty: 3072, elecAmt: 2495.4, waterQty: 154, waterAmt: 639.1, total: 3134.5 },
}

describe('exportUtilitiesYear', () => {
  it('lays out header / row / footer in screen column order', async () => {
    await exportUtilitiesYear(dto, 2026, '附表13 · 办公水电')
    const [header, row, footer] = aoaSpy.mock.calls[0][0]
    expect(header).toEqual([
      '记账月', '所属月', '用电量(千瓦)', '基准电价', '电费金额',
      '用水量(吨)', '基准水价', '水费金额', '水电费合计', '备注',
    ])
    // elecAmt/waterAmt/total are server-derived; row echoes them, never recomputed here
    expect(row).toEqual(['2026-01', '2025-12', 3072, 0.8123, 2495.4, 154, 4.15, 639.1, 3134.5, 'x'])
    expect(footer).toEqual(['本年合计', '', 3072, '', 2495.4, 154, '', 639.1, 3134.5, ''])
  })
})
