// ponytail: ported 1:1 from fp-table-sort.jsx — compare/fpSortRows logic preserved exactly
export interface SortState { key: string; dir: 'asc' | 'desc' }
export type SortValue = (row: any) => any

function compare(a: any, b: any): number {
  const an = a === null || a === undefined || a === ''
  const bn = b === null || b === undefined || b === ''
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
  return [...rows].sort((a, b) => compare(valueOf(a), valueOf(b)) * dir)
}
