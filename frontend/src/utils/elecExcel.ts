// 附表11 Excel 导出。两类型列集不同(对齐 screen-schedule11.jsx 表头 416-444):
//  energy: 期·记账月·开票日期·时段·用电类别·电量·不含税单价·不含税金额·税率·税额·价税合计·备注
//  basic:  期·记账月·开票日期·计费需量·单价·基本用电费·税率·税额·价税合计·备注
// 派生 amount/tax/total 后端算好,这里只回显,不重算。
// 出流走 utils/sheet.ts 适配层(exceljs,内部懒加载,不进 /elec 初始路由块)。
import { writeAoaWorkbook } from './sheet'
import type { ElecYearDTO } from '../types/elec'

export async function exportElecYear(dto: ElecYearDTO, year: number): Promise<void> {
  const energy = dto.type === 'energy'

  const header = energy
    ? ['期', '记账月', '开票日期', '时段', '用电类别', '电量', '不含税单价', '不含税金额', '税率', '税额', '价税合计', '备注']
    : ['期', '记账月', '开票日期', '计费需量', '单价', '基本用电费', '税率', '税额', '价税合计', '备注']

  const body = dto.rows.map(r => energy
    ? [r.phaseName, r.acctMonth, r.invDate ?? '', r.period ?? '', r.cat ?? '', r.qty ?? 0, r.price, r.amount, r.rate, r.tax, r.total, r.note ?? '']
    : [r.phaseName, r.acctMonth, r.invDate ?? '', r.demand ?? 0, r.price, r.amount, r.rate, r.tax, r.total, r.note ?? ''])

  const t = dto.total
  const footer = energy
    ? ['本年合计', '', '', '', '', t.qty, '', t.amount, '', t.tax, t.total, '']
    : ['本年合计', '', '', t.demand, '', t.amount, '', t.tax, t.total, '']

  const label = energy ? '电量电费' : '基本电费'
  await writeAoaWorkbook(`附表11-电费成本-${label}-${year}年.xlsx`,
    [{ name: `${year}年`, aoa: [header, ...body, footer] }])
}
