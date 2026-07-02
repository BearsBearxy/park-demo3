// 利润表 Excel 导出(SheetJS)。列序对齐屏表:项目 + 行次 + 本月金额 + 本年累计金额。
// 值取自 valueOf(小计走公式、父项汇总),label 行只出标题不出金额。
// 懒加载 xlsx(~200KB):仅点「导出」才拉,不进初始路由块(1:1 仿 s10Excel)。
import type { FinTableRow } from '@/components/fin/FinReportTable.vue'

export async function exportIncomeStatement(
  rows: FinTableRow[],
  valueOf: (rowKey: string | number, field: string) => number,
  companyName: string,
  year: number,
  month: number,
): Promise<void> {
  const XLSX = await import('xlsx')

  const header = ['项目', '行次', '本月金额', '本年累计金额']
  const body = rows.map(r => {
    const no = r.type === 'label' || r.custom ? '' : (r.no ?? r.key)
    if (r.type === 'label') return [r.label, no, '', '']
    return [r.label, no, valueOf(r.key, 'cur'), valueOf(r.key, 'ytd')]
  })

  const ws = XLSX.utils.aoa_to_sheet([header, ...body])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `${year}年${month}月`)
  XLSX.writeFile(wb, `利润表-${companyName}-${year}年${month}月.xlsx`)
}
