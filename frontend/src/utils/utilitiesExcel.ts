// 附表13/14 办公·三期水电 Excel 导出。列序对齐屏表:
// 记账月 · 所属月 · 用电量 · 基准电价 · 电费金额 · 用水量 · 基准水价 · 水费金额 · 水电费合计 · 备注 + 末行本年合计。
// 出流走 utils/sheet.ts 适配层(exceljs,内部懒加载,不进初始路由块)。
import { writeAoaWorkbook } from './sheet'
import type { OfficeYearDTO } from '../types/utilities'

export async function exportUtilitiesYear(
  dto: OfficeYearDTO, year: number, title: string,
): Promise<void> {
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

  await writeAoaWorkbook(`${title}-${year}年.xlsx`,
    [{ name: `${year}年`, aoa: [header, ...body, footer] }])
}
