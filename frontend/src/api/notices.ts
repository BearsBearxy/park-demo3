import api from '@/api'

/**
 * 铃铛「有结果了」那一类(画布 06-E / 06-F):别人动了我的东西、或我发起的事有了结果。
 * 后端表 user_notice(V133),每人只留最近 30 条;「看过」记在服务端,换标签页 / 换电脑一致。
 */
export type NoticeKind =
  | 'review_approved' | 'review_withdrawn'
  | 'approval_approved' | 'approval_rejected' | 'approval_timeout'
  | 'bill_unconfirmed' | 'bill_voided'
  | 'perms_changed'

export interface Notice {
  id: number
  kind: NoticeKind
  /** 后端拼好的一句,如「王主管批准了你的授权」 */
  title: string
  /** 第二行小字:理由 / 「刷新后生效」/ 「30 分钟内可以改读数」。没有就 null */
  detail: string | null
  /** 点整行跳去哪:审核键(`ledger:7:2026-08`)或 `bill-notices:2026-09`;没有可跳的为 null */
  ref: string | null
  /** 谁做的(用户名);系统做的(超时)为 null */
  actor: string | null
  /** 谁做的显示名(「李审」),第二行「李审：理由 · 时刻」用;系统做的为 null */
  actorName: string | null
  /** 后端 LocalDateTime 的 ISO 串 */
  createdAt: string
  seen: boolean
}

/**
 * 系统类(新版本 / 更新记录)看过到哪儿了。也存服务端,蓝点才跨电脑一致(实现规范 §2 第 12 条)。
 * 两项都可能是 null(从没记过)。写的时候传 null / 不传的那一项后端保持原值:「看看」只写版本号,开铃铛只写 bellKey。
 */
export interface SystemSeen {
  /** 看过的更新记录版本号 */
  changelogVersion: string | null
  /** 上次开铃铛时系统组的内容键 —— 之后系统组有了新东西才亮蓝点 */
  bellKey: string | null
}

export const noticesApi = {
  /** 最近 30 条,新的在前,带 seen。只在铃铛面板打开时取 —— 心跳只带未读个数(unseenResults)。 */
  list: () => api.get<Notice[]>('/notices'),
  /** 打开铃铛 = 「有结果了」全部看过。 */
  seen: () => api.post<void>('/notices/seen'),
  /** 系统类看过到哪儿了。心跳里也带一份(presence.systemSeen),别的标签页 / 电脑看过,3 秒内跟上。 */
  systemSeen: () => api.get<SystemSeen>('/notices/system-seen'),
  markSystemSeen: (seen: Partial<SystemSeen>) => api.post<void>('/notices/system-seen', seen),
}
