// 审核态的前端契约(SIDEBAR-UX-REDESIGN §7.1 / §7.4)。后端 ReviewRowDTO 的镜像。
//
// 键格式 `kind[:scope]:period`,kind 白名单是后端 ReviewKind 的 14 个 code,period 恒 YYYY-MM。

export type ReviewStatus = 'entered' | 'submitted' | 'approved' | 'returned'

/**
 * 挡编辑的两个态(§7.2:待审核也锁,D17)。
 *
 * `returned` **不在内** —— 它只是留痕,可编辑性等同「录入中」。
 * 与后端 `ReviewGuard.LOCKING` 是同一个集合,改这里必须同时改那里。
 */
export const LOCKING: readonly ReviewStatus[] = ['submitted', 'approved']

export interface ReviewRow {
  key: string
  kind: string
  scope: string | null
  status: ReviewStatus
  submittedBy: string | null
  submittedAt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  reason: string | null
  /** 通过前置缺的上游人话名。没有前置或已满足时是**空数组不是 null**(后端 DTO 头注保证)。 */
  blockedBy: string[]
}

/** 与后端 ReviewKind.PERIOD 同严 —— 不用 `\d{2}`,那会放行 2024-00 / 2024-13。 */
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * `kind[:scope]:period` → 三段。解析不出来回 null。
 *
 * ⚠ **从右切**。kind 里有连字符(`alloc-loss` / `charging-car` / `bill-notices`)但没有冒号,
 *   period 恒是最后一段,scope 是中间那段可选的。从左切会把 `alloc-loss:2024-02` 切成
 *   kind='alloc' —— 而 `alloc` 是**另一把真实存在的键**,不会报错,只会锁错表。
 *   与后端 `ReviewKey.parse` 用 lastIndexOf 是同一条理由。
 */
export function parseReviewKey(
  raw: string,
): { kind: string; scope: string | null; period: string } | null {
  const i = raw.lastIndexOf(':')
  if (i < 0) return null
  const period = raw.slice(i + 1)
  if (!PERIOD.test(period)) return null
  const head = raw.slice(0, i)
  if (!head) return null
  const j = head.lastIndexOf(':')
  if (j < 0) return { kind: head, scope: null, period }
  const kind = head.slice(0, j)
  const scope = head.slice(j + 1)
  return kind && scope ? { kind, scope, period } : null
}

/** 键里的月。取不到回 null —— 调用方一律按「这一屏不受审核约束」处理。 */
export const periodOfKey = (raw: string | null): string | null =>
  (raw && parseReviewKey(raw)?.period) || null

/**
 * 编辑按钮位那颗禁用药丸的文案(§7.5)。
 *
 * 两条编辑闸(useEditMode 与 SchedHeader)共用这一份 —— 各写一份必漂移,
 * 而漂移的后果是同一个状态在附表屏和台账屏上写着两句不同的话。
 */
export function reviewNoteOf(r: ReviewRow | null): string | null {
  if (!r) return null
  if (r.status === 'submitted') return '待审核 · 已交审'
  if (r.status !== 'approved') return null
  const who = r.reviewedBy ?? ''
  // 「已审核 · 李审 03-05」—— 日期只取月日,年在屏上别处已经写着了
  const day = r.reviewedAt ? r.reviewedAt.slice(5, 10) : ''
  return `已审核${who ? ' · ' + who : ''}${day ? ' ' + day : ''}`
}

/** 待审明细的一条(后端 ReviewDtos.PendingItemDTO)。label 是后端拼好的人话名,前端不再拼。 */
export interface PendingItem {
  key: string
  kind: string
  scope: string | null
  period: string
  label: string
  submittedBy: string | null
  submittedAt: string | null
}
