// 附表10 销售收入 Excel 导出。导出当前 phase×year×month 宽表。
// 列序对齐屏表:租户 + 本期版面各叶子列 + 合计 + 备注，末行列合计 + 总计。
// 出流走 utils/sheet.ts 适配层（exceljs，内部懒加载，不进初始路由块）。
import { writeAoaWorkbook } from './sheet'
import { flattenCols, type BookDef } from '../types/book'
import type { S10MonthDTO } from '../types/s10'
import { PHASE_LAYOUT, leavesOf, PHASES } from '../views/sales-income/layout'

export async function exportS10Month(dto: S10MonthDTO, title: string, def?: BookDef | null): Promise<void> {
  const phaseName = PHASES.find(p => p.phase === dto.phase)?.name ?? '本期'
  // 模板给了按模板出列(§9,含自定义列跳 hidden;行已平铺);缺省回退静态版面=零回归
  const leaves: { colId: string; label: string }[] = def
    ? flattenCols(def).filter(c => !c.hidden).map(c => ({ colId: c.id, label: c.label }))
    : leavesOf(PHASE_LAYOUT[dto.phase]).map(l => ({ colId: l.colId as string, label: l.label }))

  const header = ['租户', ...leaves.map(l => l.label), '合计', '备注']

  const dyn = (r: object) => r as unknown as Record<string, number | undefined>
  const body = dto.rows.map(r => [
    r.tenantName,
    ...leaves.map(l => dyn(r)[l.colId] ?? 0),
    r.total,
    r.note ?? '',
  ])

  // 列合计:标准列走后端 columnTotals;自定义列后端不含,客户端Σ(总计 grandTotal 后端已含口袋)
  const colTotals = dto.columnTotals as Record<string, number | undefined>
  const footer = [
    '合计 · ' + dto.rows.length + ' 户',
    ...leaves.map(l => colTotals[l.colId] ?? dto.rows.reduce((a, r) => a + (dyn(r)[l.colId] ?? 0), 0)),
    dto.grandTotal,
    '',
  ]

  const sheet = `${dto.year}年${dto.month}月`
  await writeAoaWorkbook(`${title}-${phaseName}-${dto.year}年${dto.month}月.xlsx`,
    [{ name: sheet, aoa: [header, ...body, footer] }])
}
