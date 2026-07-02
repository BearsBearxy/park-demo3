// 科目余额表 8 列模板 + 合计/平衡差/折叠搜索纯函数 — spec §1 C2/C6/C7。同 reports/balanceSheet.ts 约定。
// 科目树是数据(按期存库,spec §0),此处只定义列模板与展示逻辑;合计客端算不落库。

export type TbFieldKey =
  | 'openDr' | 'openCr'
  | 'periodDr' | 'periodCr'
  | 'ytdDr' | 'ytdCr'
  | 'endDr' | 'endCr'

export interface TbField {
  key: TbFieldKey
  label: string
  group: '期初余额' | '本期发生额' | '本年累计发生额' | '期末余额'
  side: '借方' | '贷方'
}

export const TB_FIELDS: TbField[] = [
  { key: 'openDr',   label: '期初借方', group: '期初余额',       side: '借方' },
  { key: 'openCr',   label: '期初贷方', group: '期初余额',       side: '贷方' },
  { key: 'periodDr', label: '本期借方', group: '本期发生额',     side: '借方' },
  { key: 'periodCr', label: '本期贷方', group: '本期发生额',     side: '贷方' },
  { key: 'ytdDr',    label: '本年借方', group: '本年累计发生额', side: '借方' },
  { key: 'ytdCr',    label: '本年贷方', group: '本年累计发生额', side: '贷方' },
  { key: 'endDr',    label: '期末借方', group: '期末余额',       side: '借方' },
  { key: 'endCr',    label: '期末贷方', group: '期末余额',       side: '贷方' },
]

// 镜像后端 ReportAccountDTO(spec §2):code/parentKey 可空(缩进型下级无代码/一级无父)。
export interface TbAccount {
  rowKey: string
  parentKey: string | null
  code: string | null
  label: string
  level: number
  sortOrder: number
}

export type TbAmounts = Record<string, Partial<Record<TbFieldKey, number>>>

// 合计尾行:Σ level-0 行 per 列(下级明细已含在一级科目值内,不重复加,spec C7)。
export function tbTotals(accounts: TbAccount[], amounts: TbAmounts): Record<TbFieldKey, number> {
  const totals = Object.fromEntries(TB_FIELDS.map(f => [f.key, 0])) as Record<TbFieldKey, number>
  for (const a of accounts) {
    if (a.level !== 0) continue
    const row = amounts[a.rowKey]
    if (!row) continue
    for (const f of TB_FIELDS) totals[f.key] += row[f.key] ?? 0
  }
  return totals
}

// 试算平衡差 = 期末借合计 − 期末贷合计(非 0 显红,spec C7)。
export function tbBalanceDiff(totals: Record<TbFieldKey, number>): number {
  return totals.endDr - totals.endCr
}

/**
 * 折叠+搜索的行过滤(spec C6),输出保 sortOrder 序。
 * - query 空:level 0 恒可见;下级行需全部祖先都在 expanded 内。
 * - query 非空:code/label 含 query 的行 + 其全部祖先可见,无视 expanded。
 */
export function visibleRows(accounts: TbAccount[], expanded: Set<string>, query: string): TbAccount[] {
  const byKey = new Map(accounts.map(a => [a.rowKey, a]))
  const ancestors = (a: TbAccount): string[] => {
    const out: string[] = []
    for (let p = a.parentKey; p != null; p = byKey.get(p)?.parentKey ?? null) out.push(p)
    return out
  }
  const q = query.trim()
  let pass: (a: TbAccount) => boolean
  if (q) {
    const visible = new Set<string>()
    for (const a of accounts) {
      if (!(a.code ?? '').includes(q) && !a.label.includes(q)) continue
      visible.add(a.rowKey)
      for (const key of ancestors(a)) visible.add(key)
    }
    pass = a => visible.has(a.rowKey)
  } else {
    pass = a => ancestors(a).every(key => expanded.has(key))
  }
  return accounts.filter(pass).sort((a, b) => a.sortOrder - b.sortOrder)
}
