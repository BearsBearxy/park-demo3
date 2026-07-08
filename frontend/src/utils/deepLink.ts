// src/utils/deepLink.ts — 收入核对「去改台账/去改附表10」跳转深链 query 解析(spec 2026-07-07 §一)。
// 纯函数便于单测;y/m 缺失或非法 → null(普通打开不受影响)。消费方:LedgerView/S10View onMounted。
import type { LocationQuery } from 'vue-router'

export interface LedgerDeepLink { y: number; m: number; company: string; tenant: string }
export interface S10DeepLink { y: number; m: number; phase: number; tenant: string }

type QVal = LocationQuery[string]
const str = (v: QVal): string =>
  typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : ''
const int = (v: QVal): number => parseInt(str(v), 10)

/** 台账深链:需合法 y + 月份 1..12;company/tenant 缺省空串(解析不到时视图静默停在能到的层级)。 */
export function parseLedgerDeepLink(query: LocationQuery): LedgerDeepLink | null {
  const y = int(query.y), m = int(query.m)
  if (!Number.isInteger(y) || !(m >= 1 && m <= 12)) return null
  return { y, m, company: str(query.company), tenant: str(query.tenant) }
}

/** 附表10 深链:需合法 y + 月份 1..12;phase 非法回落 1(期区 1..4)。 */
export function parseS10DeepLink(query: LocationQuery): S10DeepLink | null {
  const y = int(query.y), m = int(query.m)
  if (!Number.isInteger(y) || !(m >= 1 && m <= 12)) return null
  const p = int(query.phase)
  return { y, m, phase: p >= 1 && p <= 4 ? p : 1, tenant: str(query.tenant) }
}
