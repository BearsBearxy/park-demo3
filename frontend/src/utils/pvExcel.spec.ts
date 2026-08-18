import { describe, it, expect, vi } from 'vitest'
import type { PvYearDTO } from '../types/pv'

// capture the AOA handed to the sheet adapter without writing a file
const aoaSpy = vi.fn((rows: unknown[][]) => ({ rows }))
vi.mock('./sheet', () => ({
  writeAoaWorkbook: (_f: string, sheets: { aoa: unknown[][] }[]) => { aoaSpy(sheets[0].aoa) },
}))

import { exportPvYear } from './pvExcel'

const dto: PvYearDTO = {
  year: 2026,
  phases: [],
  rows: [
    { id: 1, phase: 'p1', phaseName: '一期 B-G 座', acctMonth: '2026-01', occurMonth: '2025-12',
      selfKwh: 100, selfAmt: 90, gridKwh: 40, gridAmt: 18, gen: 140, fee: 108, note: 'x', source: 'seed' },
  ],
  total: { gen: 140, fee: 108, selfKwh: 100, selfAmt: 90, gridKwh: 40, gridAmt: 18 },
}

describe('exportPvYear', () => {
  it('lays out header / row / footer in spec §6 column order', async () => {
    await exportPvYear(dto, 2026)
    const [header, row, footer] = aoaSpy.mock.calls[0][0]
    expect(header).toEqual(['期', '记账月', '发生月', '发电总量', '电费总额', '自消纳电量', '自消纳金额', '上网电量', '上网收益', '备注'])
    // gen/fee are server-derived; row echoes them, never recomputed here
    expect(row).toEqual(['一期 B-G 座', '2026-01', '2025-12', 140, 108, 100, 90, 40, 18, 'x'])
    expect(footer).toEqual(['本年合计', '', '', 140, 108, 100, 90, 40, 18, ''])
  })
})
