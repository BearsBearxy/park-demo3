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

/**
 * 录审分离(RBAC-SPEC §12,用户 2026-10-04 拍板「录审不分离在超级管理，其他分离」):自己交的表要由别人通过或退回,
 * 系统管理员不受限。判据在后端 ReviewService.guardNotOwnSubmission,这里只决定「通过 / 退回」按不按得动 ——
 * 本月出账清单与审核动作簇共用这一份,各写一份必漂移。
 * me 为空时不算:没记交审人的行(submittedBy=null)与没登录完的 me=null 一比就成了「自己交的」。
 */
export const ownSubmission = (r: ReviewRow | null, me: string | null, superAdmin: boolean): boolean =>
  !superAdmin && !!me && r?.submittedBy === me
export const SELF_REVIEW_TIP = '这张表是你自己交的,要由别人通过或退回'

/**
 * 审核 kind → 交审要哪一屏的编辑权(任一即可)。与后端 `ReviewKind.perms()` 逐条相同(RBAC-SPEC §15.6);
 * 交审权 = 那一屏的编辑。楼栋损耗认两把:公共电核算一次交两张表(alloc + alloc-loss)。
 */
export const SUBMIT_PERMS: Record<string, readonly string[]> = {
  params: ['params:edit', 'params:monthly'],
  meters: ['meters:edit'],
  alloc: ['alloc:edit'],
  'alloc-loss': ['alloc-loss:edit', 'alloc:edit'],
  'bill-notices': ['bill-notices:edit'],
  ledger: ['ledger:edit'],
  s10: ['sales-income:edit'],
  salary: ['salary:edit'],
  utilities: ['utilities:edit'],
  pv: ['pv-income:edit'],
  'charging-car': ['car-charging:edit'],
  'charging-ebike': ['ebike-charging:edit'],
  'elec-cost': ['elec-cost:edit'],
  'elec-model': ['elec-cost:edit'],
  'report-is': ['income-statement:edit'],
  'report-bs': ['balance-sheet:edit'],
  'report-tb': ['trial-balance:edit'],
}

/**
 * 这把审核键我能不能交审 / 撤回:键的 kind(第一个 `:` 前)查 SUBMIT_PERMS,任一就算。
 * has 传 `auth.hasOwn`(只认角色给的,不认提权):后端 ReviewService.requireAnyPerm 查的是角色权限快照,
 * 借来的编辑权交不了审;只有「园区抄表 · 表档案」或只能请提权的人更交不了 —— 照编辑模式按钮画就是一颗点了 403 的「交审」。
 */
export const canSubmitKey = (key: string, has: (perm: string) => boolean): boolean =>
  (SUBMIT_PERMS[key.slice(0, key.indexOf(':'))] ?? []).some(has)

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
