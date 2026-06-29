// ponytail: ported from fp-master-ui.jsx window.fpMoney / window.fpWan
// 空值(null/undefined)→「—」；合法的 0 显示 ¥0（不再与无数据混淆）
export const fpMoney = (n: number | null | undefined): string =>
  n == null ? '—' : '¥' + Number(n).toLocaleString('en-US')

// 按绝对值判断小数位与负号，负号统一用 Unicode '−'（与全站一致）
export const fpWan = (n: number | null | undefined): string => {
  if (n == null) return '¥0'
  const v = Math.abs(n)
  return (n < 0 ? '−¥' : '¥') + (v / 10000).toFixed(v >= 100000 ? 0 : 1) + '万'
}
