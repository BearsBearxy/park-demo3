// 附表13/14 办公·三期水电 Excel 导出(SheetJS)。列序对齐屏表:
// 记账月 · 所属月 · 用电量 · 基准电价 · 电费金额 · 用水量 · 基准水价 · 水费金额 · 水电费合计 · 备注 + 末行本年合计。
import type { OfficeYearDTO } from '../types/utilities'

export async function exportUtilitiesYear(
  dto: OfficeYearDTO, year: number, title: string,
): Promise<void> {
  // 懒加载 SheetJS(~200KB):仅在用户点「导出」时才拉,不进初始路由块(对齐 pvExcel/chargingExcel)。
  const XLSX = await import('xlsx')

  const header = [
    '记账月', '所属月', '用电量(千瓦)', '基准电价', '电费金额',
    '用水量(吨)', '基准水价', '水费金额', '水电费合计', '备注',
  ]

  const body = dto.rows.map(r => [
    r.acctMonth, r.belongMonth, r.elecQty, r.elecPrice, r.elecAmt,
    r.waterQty, r.waterPrice, r.waterAmt, r.total, r.note ?? '',
  ])

  const t = dto.total
  const footer = ['本年合计', '', t.elecQty, '', t.elecAmt, t.waterQty, '', t.waterAmt, t.total, '']

  const ws = XLSX.utils.aoa_to_sheet([header, ...body, footer])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `${year}年`)
  XLSX.writeFile(wb, `${title}-${year}年.xlsx`)
}
