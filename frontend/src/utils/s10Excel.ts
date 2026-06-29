// 附表10 销售收入 Excel 导出（SheetJS）。导出当前 phase×year×month 宽表。
// 列序对齐屏表:租户 + 本期版面各叶子列 + 合计 + 备注，末行列合计 + 总计。
// 懒加载 xlsx(~200KB):仅点「导出」才拉，不进初始路由块（1:1 仿 pvExcel/utilitiesExcel）。
import type { S10MonthDTO, S10RecordDTO } from '../types/s10'
import { PHASE_LAYOUT, leavesOf, PHASES } from '../views/sales-income/layout'

export async function exportS10Month(dto: S10MonthDTO, title: string): Promise<void> {
  const XLSX = await import('xlsx')

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

  const ws = XLSX.utils.aoa_to_sheet([header, ...body, footer])
  const wb = XLSX.utils.book_new()
  const sheet = `${dto.year}年${dto.month}月`
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  XLSX.writeFile(wb, `${title}-${phaseName}-${dto.year}年${dto.month}月.xlsx`)
}
