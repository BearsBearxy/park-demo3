// 利润表 Excel 导出。列序对齐屏表:项目 + 行次 + 本月金额 + 本年累计金额。
// 值取自 valueOf(小计走公式、父项汇总),label 行只出标题不出金额。
// 出流走 utils/sheet.ts 适配层(exceljs,内部懒加载,不进初始路由块)。
import { writeAoaWorkbook } from './sheet'
import type { FinTableRow } from '@/components/fin/FinReportTable.vue'

export async function exportIncomeStatement(
  rows: FinTableRow[],
  valueOf: (rowKey: string | number, field: string) => number,
  companyName: string,
  year: number,
  month: number,
): Promise<void> {
  const header = ['项目', '行次', '本月金额', '本年累计金额']
  const body = rows.map(r => {
    const no = r.type === 'label' || r.custom ? '' : (r.no ?? r.key)
    if (r.type === 'label') return [r.label, no, '', '']
    return [r.label, no, valueOf(r.key, 'cur'), valueOf(r.key, 'ytd')]
  })

  await writeAoaWorkbook(`利润表-${companyName}-${year}年${month}月.xlsx`,
    [{ name: `${year}年${month}月`, aoa: [header, ...body] }])
}
