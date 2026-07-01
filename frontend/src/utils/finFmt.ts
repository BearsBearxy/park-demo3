// 报表数值格式化。1:1 移植 fin-common.jsx 的 finFmt/finSigned/finWan/finMoney(window 全局 → 模块导出)。
// 报表专用 2 位小数 + Unicode 负号 '−';与 money.ts(台账用)口径不同,故独立。

export function finFmt(v: number | string | null | undefined): string {
  if (v == null || v === 0 || v === '') return ''
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function finSigned(v: number | null | undefined): string {
  const n = Number(v) || 0
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? '−' + s : s
}

export function finWan(v: number | null | undefined): string {
  const n = Number(v) || 0
  return (n < 0 ? '−¥' : '¥') + (Math.abs(n) / 10000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' 万'
}

export function finMoney(v: number | null | undefined): string {
  const n = Number(v) || 0
  return (n < 0 ? '−¥' : '¥') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
