// ponytail: ported 1:1 from fp-master-ui.jsx window.fpMoney / window.fpWan
export const fpMoney = (n: number | null | undefined): string =>
  n ? '¥' + Number(n).toLocaleString('en-US') : '—'

export const fpWan = (n: number | null | undefined): string =>
  n ? '¥' + (n / 10000).toFixed(n >= 100000 ? 0 : 1) + '万' : '¥0'
