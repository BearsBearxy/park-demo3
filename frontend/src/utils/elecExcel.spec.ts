import { describe, it, expect, vi } from 'vitest'
import type { ElecYearDTO } from '../types/elec'

// capture the AOA handed to the sheet adapter without writing a file
const aoaSpy = vi.fn((rows: unknown[][]) => ({ rows }))
vi.mock('./sheet', () => ({
  writeAoaWorkbook: (_f: string, sheets: { aoa: unknown[][] }[]) => { aoaSpy(sheets[0].aoa) },
}))

import { exportElecYear } from './elecExcel'

const energyDto: ElecYearDTO = {
  year: 2026, type: 'energy', phases: [],
  rows: [{ id: 1, type: 'energy', phase: 'p1', phaseName: '一期厂房', acctMonth: '2026-01',
    invDate: '2026-02-09', period: '峰', cat: '大工业用电', unit: '度', qty: 1000, demand: null,
    price: 0.9821, rate: 0.13, amount: 982.1, tax: 127.67, total: 1109.77, note: 'x', source: 'seed' }],
  total: { qty: 1000, demand: 0, amount: 982.1, tax: 127.67, total: 1109.77 },
}

const basicDto: ElecYearDTO = {
  year: 2026, type: 'basic', phases: [],
  rows: [{ id: 2, type: 'basic', phase: 'p1', phaseName: '一期厂房', acctMonth: '2026-01',
    invDate: '2026-02-09', period: null, cat: null, unit: null, qty: null, demand: 1250,
    price: 32, rate: 0.13, amount: 40000, tax: 5200, total: 45200, note: null, source: 'seed' }],
  total: { qty: 0, demand: 1250, amount: 40000, tax: 5200, total: 45200 },
}

describe('exportElecYear', () => {
  it('energy: 12-col header / row / footer, server-derived amount echoed', async () => {
    await exportElecYear(energyDto, 2026)
    const [header, row, footer] = aoaSpy.mock.calls[0][0]
    expect(header).toEqual(['期', '记账月', '开票日期', '时段', '用电类别', '电量', '不含税单价', '不含税金额', '税率', '税额', '价税合计', '备注'])
    expect(row).toEqual(['一期厂房', '2026-01', '2026-02-09', '峰', '大工业用电', 1000, 0.9821, 982.1, 0.13, 127.67, 1109.77, 'x'])
    expect(footer).toEqual(['本年合计', '', '', '', '', 1000, '', 982.1, '', 127.67, 1109.77, ''])
  })

  it('basic: 10-col header / row / footer with demand + basicFee', async () => {
    aoaSpy.mockClear()
    await exportElecYear(basicDto, 2026)
    const [header, row, footer] = aoaSpy.mock.calls[0][0]
    expect(header).toEqual(['期', '记账月', '开票日期', '计费需量', '单价', '基本用电费', '税率', '税额', '价税合计', '备注'])
    expect(row).toEqual(['一期厂房', '2026-01', '2026-02-09', 1250, 32, 40000, 0.13, 5200, 45200, ''])
    expect(footer).toEqual(['本年合计', '', '', 1250, '', 40000, '', 5200, 45200, ''])
  })
})
