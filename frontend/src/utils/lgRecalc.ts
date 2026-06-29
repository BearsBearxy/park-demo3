// Pure recalc ported from screen-ledger.jsx lgRecalc + ledger-tenants-data.js recalc.
// totalReceivable = Σ21 fees; balanceEnd = balancePrev + Σfees − totalCollected. Round 2dp.
import { FEE_KEYS } from './ledgerColumns'
import type { LedgerRowDTO } from '../types/ledger'

// 符号感知四舍五入，与后端 RoundingMode.HALF_UP（远离零）一致；
// balanceEnd 可为负，朴素 Math.round 在负半分边界会向 +∞ 偏，导致前端预览与保存回传差 1 分
const r2 = (n: number): number => (n < 0 ? -1 : 1) * Math.round(Math.abs(n) * 100) / 100

// Mutates row's derived columns in place (matches prototype) and returns it.
export function lgRecalc(row: LedgerRowDTO): LedgerRowDTO {
  const recv = FEE_KEYS.reduce((s, f) => s + (Number(row[f]) || 0), 0)
  row.totalReceivable = r2(recv)
  row.balanceEnd = r2((Number(row.balancePrev) || 0) + recv - (Number(row.totalCollected) || 0))
  return row
}
