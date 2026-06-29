// 附表6 Excel 导出(SheetJS)。列序对齐屏表(spec §6):
// 期 · 记账月 · 发生月 · 发电总量 · 电费总额 · 自消纳电量 · 自消纳金额 · 上网电量 · 上网收益 · 备注 + 末行本年合计。
import type { PvYearDTO } from '../types/pv'

export async function exportPvYear(dto: PvYearDTO, year: number): Promise<void> {
  // 懒加载 SheetJS(~200KB):仅在用户点「导出」时才拉,不进 /pv 初始路由块(对齐 ledgerExcel)。
  const XLSX = await import('xlsx')

  const header = [
    '期', '记账月', '发生月', '发电总量', '电费总额',
    '自消纳电量', '自消纳金额', '上网电量', '上网收益', '备注',
  ]

  const body = dto.rows.map(r => [
    r.phaseName, r.acctMonth, r.occurMonth, r.gen, r.fee,
    r.selfKwh, r.selfAmt, r.gridKwh, r.gridAmt, r.note ?? '',
  ])

  const t = dto.total
  const footer = [
    '本年合计', '', '', t.gen, t.fee,
    t.selfKwh, t.selfAmt, t.gridKwh, t.gridAmt, '',
  ]

  const ws = XLSX.utils.aoa_to_sheet([header, ...body, footer])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `${year}年`)
  XLSX.writeFile(wb, `附表6-光伏发电-${year}年.xlsx`)
}
