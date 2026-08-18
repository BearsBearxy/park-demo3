// ponytail: ported 1:1 from fp-table-sort.jsx — compare 逻辑原样保留。
// 唯一刻意的偏离(2026-08-18):空值排序方向。原型的 compare()*dir 会把「空值沉底」也乘反,
// desc 下空值全浮到最前;occRate 改可空后这条立刻显形(楼栋屏默认就是 occRate desc)。
// 现按 METRIC-SOURCE-SPEC §3 强制空值恒在末尾,不参与大小比较;fpSort.spec.ts 两条断言锁死升降序。
export interface SortState { key: string; dir: 'asc' | 'desc' }
export type SortValue = (row: any) => any

const isEmpty = (v: any) => v === null || v === undefined || v === ''

function compare(a: any, b: any): number {
  const an = isEmpty(a)
  const bn = isEmpty(b)
  if (an && bn) return 0
  if (an) return 1   // empties sink to bottom
  if (bn) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const na = typeof a === 'number' ? a : parseFloat(String(a).replace(/[^\d.\-]/g, ''))
  const nb = typeof b === 'number' ? b : parseFloat(String(b).replace(/[^\d.\-]/g, ''))
  if (!isNaN(na) && !isNaN(nb) && String(a).match(/\d/) && String(b).match(/\d/)) return na - nb
  return String(a).localeCompare(String(b), 'zh-Hans-CN')
}

export function fpSortRows<T>(
  rows: T[],
  sort: SortState | null,
  columns: { key: string; sortValue?: SortValue }[],
): T[] {
  if (!sort?.key) return rows
  const col = columns.find(c => c.key === sort.key) || { key: sort.key }
  const valueOf = (row: T) =>
    col && 'sortValue' in col && typeof col.sortValue === 'function'
      ? col.sortValue(row)
      : (row as any)[col.key]
  const dir = sort.dir === 'asc' ? 1 : -1
  // 空值判定必须在 dir 乘法之外(METRIC-SOURCE-SPEC §3:null 一律排末尾,不参与大小比较)。
  // 原写法 compare()*dir 把 compare 里那句「empties sink to bottom」也乘反了:desc 下
  // 1*-1=-1,空值反而全浮到第一页最前 —— 楼栋屏默认就是 occRate desc,出租率算不出来的栋顶在最上面。
  return [...rows].sort((a, b) => {
    const va = valueOf(a), vb = valueOf(b)
    if (isEmpty(va) || isEmpty(vb)) return compare(va, vb)
    return compare(va, vb) * dir
  })
}
