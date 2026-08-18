// 附表10 销售收入 Excel 导出。导出当前 phase×year×month 宽表。
// 列序对齐屏表:租户 + 本期版面各叶子列 + 合计 + 备注，末行列合计 + 总计。
// 出流走 utils/sheet.ts 适配层（exceljs，内部懒加载，不进初始路由块）。
import { writeAoaWorkbook } from './sheet'
import type { S10MonthDTO, S10RecordDTO } from '../types/s10'
import { PHASE_LAYOUT, leavesOf, PHASES } from '../views/sales-income/layout'

export async function exportS10Month(dto: S10MonthDTO, title: string): Promise<void> {
  const layout = PHASE_LAYOUT[dto.phase]
  const leaves = leavesOf(layout)
  const phaseName = PHASES.find(p => p.phase === dto.phase)?.name ?? '本期'

  const header = ['租户', ...leaves.map(l => l.label), '合计', '备注']

  const body = dto.rows.map((r: S10RecordDTO) => [
    r.tenantName,
    ...leaves.map(l => r[l.colId]),
    r.total,
    r.note ?? '',
  ])

  const footer = [
    '合计 · ' + dto.rows.length + ' 户',
    ...leaves.map(l => dto.columnTotals[l.colId] ?? 0),
    dto.grandTotal,
    '',
  ]

  const sheet = `${dto.year}年${dto.month}月`
  await writeAoaWorkbook(`${title}-${phaseName}-${dto.year}年${dto.month}月.xlsx`,
    [{ name: sheet, aoa: [header, ...body, footer] }])
}
