// Excel export. Column order matches the on-screen wide table (spec §6):
// 租户 · 上月结余 · 21 费用 · 本月应收合计 · 本月收款 · 本月结余 · 备注 + 末行合计。
// 出流走 utils/sheet.ts 适配层(exceljs,内部懒加载,不打进 /ledger 初始路由块)。
import { writeAoaWorkbook } from './sheet'
import { lgColumns, FEE_KEYS } from './ledgerColumns'
import { flattenCols, type BookDef } from '../types/book'
import type { LedgerMonthDTO } from '../types/ledger'

export async function exportLedgerMonth(
  dto: LedgerMonthDTO, companyName: string, year: number, month: number, def?: BookDef | null,
): Promise<void> {
  // 模板给了按模板出列(改名/隐藏/自定义列全跟现行版,§9);缺省回退静态 21 列=零回归。
  // 前提:def 路径的 dto.rows 已 mergeExtras 平铺(视图 flatMonth 保证),c_ 列直接按键取值。
  const feeCols: { key: string; label: string }[] = def
    ? flattenCols(def).filter(c => !c.hidden).map(c => ({ key: c.id, label: c.label }))
    : (() => {
        const feeByKey = new Map(lgColumns(dto.prevMonth).groups.flatMap(g => g.cols).map(c => [c.key as string, c.label]))
        return FEE_KEYS.map(k => ({ key: k as string, label: feeByKey.get(k) ?? (k as string) }))
      })()

  const header = [
    '租户', dto.prevMonth + '月结余',
    ...feeCols.map(c => c.label),
    '本月应收合计', '本月收款', '本月结余', '备注',
  ]

  // 固定列走 DTO 强类型;费用列(含 c_ 平铺键)按字符串键动态取
  const dyn = (r: object) => r as unknown as Record<string, number | undefined>
  const body = dto.rows.map(r => [
    r.tenantName, r.balancePrev,
    ...feeCols.map(c => dyn(r)[c.key] ?? 0),
    r.totalReceivable, r.totalCollected, r.balanceEnd, r.note ?? '',
  ])

  // footer:标准列走后端 footer;自定义列后端 footer 不含,客户端Σ(应收/结余合计后端已含口袋,不双算)
  const f = dto.footer
  const footer = [
    '合计', f.balancePrev,
    ...feeCols.map(c => dyn(f)[c.key] ?? dto.rows.reduce((a, r) => a + (dyn(r)[c.key] ?? 0), 0)),
    f.totalReceivable, f.totalCollected, f.balanceEnd, '',
  ]

  await writeAoaWorkbook(`${companyName}-${year}${month}月-月度台账.xlsx`,
    [{ name: `${year}年${month}月`, aoa: [header, ...body, footer] }])
}
