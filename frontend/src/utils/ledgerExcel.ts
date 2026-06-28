// Excel export (SheetJS). Column order matches the on-screen wide table (spec §6):
// 租户 · 上月结余 · 21 费用 · 本月应收合计 · 本月收款 · 本月结余 · 备注 + 末行合计。
import * as XLSX from 'xlsx'
import { lgColumns, FEE_KEYS } from './ledgerColumns'
import type { LedgerMonthDTO } from '../types/ledger'

export function exportLedgerMonth(
  dto: LedgerMonthDTO, companyName: string, year: number, month: number,
): void {
  const cols = lgColumns(dto.prevMonth)
  const feeByKey = new Map(cols.groups.flatMap(g => g.cols).map(c => [c.key, c.label]))

  const header = [
    '租户', dto.prevMonth + '月结余',
    ...FEE_KEYS.map(k => feeByKey.get(k) ?? k),
    '本月应收合计', '本月收款', '本月结余', '备注',
  ]

  const body = dto.rows.map(r => [
    r.tenantName, r.balancePrev,
    ...FEE_KEYS.map(k => r[k]),
    r.totalReceivable, r.totalCollected, r.balanceEnd, r.note ?? '',
  ])

  const f = dto.footer
  const footer = [
    '合计', f.balancePrev,
    ...FEE_KEYS.map(k => f[k]),
    f.totalReceivable, f.totalCollected, f.balanceEnd, '',
  ]

  const ws = XLSX.utils.aoa_to_sheet([header, ...body, footer])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `${year}年${month}月`)
  XLSX.writeFile(wb, `${companyName}-${year}${month}月-月度台账.xlsx`)
}
