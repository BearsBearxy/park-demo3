// 临时授权(ELEVATION-SPEC §4.5,画布 08):顶栏胶囊、授权卡片、App 的回执共用的几样小东西。
import type { Grant } from '@/stores/auth'

/**
 * 授权时长 —— 和后端 ElevationStore.TTL_SECONDS 同一个数(30 分钟,用户拍板 2026-08-22)。
 * 2026-10-03 起 GrantDTO 带 grantedAt,卡片上「几点授权 / 批准」直接用它;只有旧后端没带时才按到期 − 30 分钟推
 * (续期是整份覆盖,这个减法恒成立)。
 */
export const ELEV_TTL_MS = 30 * 60_000
/** 最后 1 分钟:胶囊变橙、出一条不自收的回执(画布 08 ElevStates) */
export const LAST_MIN_MS = 60_000

/** 剩余时间:分不补零、秒补零 —— 28:41 / 0:42 */
export function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 时刻 → 14:02 */
export function hhmm(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 一「份」授权 = 同一次批准(同一个授权人、同一个到期时刻)补齐的那几个权限点。
 * 一次授权常常同时补两三项(ELEVATION-SPEC §3.5),它们一起到期,屏上算一份。
 */
export interface GrantBatch {
  key: string; authorizer: string; authorizerName: string; expiresAt: number; labels: string[]
  /** 授权(远程:批准)时刻 */
  grantedAt: number
  /** 远程批准的(ElevStates「远程批准」) */
  remote: boolean
}

/** 按份归组,先到期的在前 */
export function grantBatches(gs: Grant[]): GrantBatch[] {
  const m = new Map<string, GrantBatch>()
  for (const g of gs) {
    const key = `${g.authorizer}@${g.expiresAt}`
    let b = m.get(key)
    if (!b) m.set(key, b = { key, authorizer: g.authorizer, authorizerName: g.authorizerName, expiresAt: g.expiresAt, labels: [],
                             grantedAt: g.grantedAt ?? g.expiresAt - ELEV_TTL_MS, remote: g.source === 'remote' })
    b.labels.push(g.permLabel)
  }
  return [...m.values()].sort((a, b) => a.expiresAt - b.expiresAt)
}
