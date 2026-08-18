// 附表7/8 充电桩 Excel 导出。列序对齐屏表:
// 类别 · 记账月 · 充电电量 · 手续费及服务费 · 充电成本 · 利润 · 备注 + 末行本年合计。
// 出流走 utils/sheet.ts 适配层(exceljs,内部懒加载,不进充电桩初始路由块)。
import { writeAoaWorkbook } from './sheet'
import type { ChargingYearDTO } from '../types/charging'

export async function exportChargingYear(
  dto: ChargingYearDTO, year: number, title: string,
): Promise<void> {
  const header = ['类别', '记账月', '充电电量', '手续费及服务费', '充电成本', '利润', '备注']

  const body = dto.rows.map(r => [
    r.catName, r.acctMonth, r.kwh, r.fee, r.cost, r.profit, r.note ?? '',
  ])

  const t = dto.total
  const footer = ['本年合计', '', t.kwh, t.fee, t.cost, t.profit, '']

  await writeAoaWorkbook(`${title}-${year}年.xlsx`,
    [{ name: `${year}年`, aoa: [header, ...body, footer] }])
}
