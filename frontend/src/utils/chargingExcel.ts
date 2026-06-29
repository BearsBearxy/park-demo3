// 附表7/8 充电桩 Excel 导出(SheetJS)。列序对齐屏表:
// 类别 · 记账月 · 充电电量 · 手续费及服务费 · 充电成本 · 利润 · 备注 + 末行本年合计。
import type { ChargingYearDTO } from '../types/charging'

export async function exportChargingYear(
  dto: ChargingYearDTO, year: number, title: string,
): Promise<void> {
  // 懒加载 SheetJS(~200KB):仅在用户点「导出」时才拉,不进充电桩初始路由块(对齐 pvExcel)。
  const XLSX = await import('xlsx')

  const header = ['类别', '记账月', '充电电量', '手续费及服务费', '充电成本', '利润', '备注']

  const body = dto.rows.map(r => [
    r.catName, r.acctMonth, r.kwh, r.fee, r.cost, r.profit, r.note ?? '',
  ])

  const t = dto.total
  const footer = ['本年合计', '', t.kwh, t.fee, t.cost, t.profit, '']

  const ws = XLSX.utils.aoa_to_sheet([header, ...body, footer])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `${year}年`)
  XLSX.writeFile(wb, `${title}-${year}年.xlsx`)
}
