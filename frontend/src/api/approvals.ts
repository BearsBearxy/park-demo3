import api from '@/api'

/** 能批这几个权限点的同事。在线的由服务端排在前面。 */
export interface Authorizer {
  username: string
  displayName: string
  role: string | null
  online: boolean
  /** 距上次心跳多久；离线为 -1 */
  idleMs: number
}

/** 一条待批请求（给授权人看）。 */
export interface Pending {
  id: string
  requester: string
  requesterName: string
  requesterRole: string | null
  perms: string[]
  permLabels: string[]
  /** 上下文三行 —— 主管远程批准时看不见请求者的屏幕，这三行是他判断的全部依据 */
  page: string
  action: string
  impact: string | null
  leftMs: number
}

/** 请求的结果（顺着在场那条 ping 回来）。 */
export interface Outcome {
  id: string
  approved: boolean
  approverName: string
}

export interface RequestBody {
  perms: string[]
  approver: string
  /** 哪一屏，如「计费参数 · 一泽 2025-06」 */
  page: string
  /** 要改什么，如「修改 loss_rate · A 座」 */
  action: string
  /** 影响谁，如「本月 A 座 41 户的催缴单金额」。可空，但**强烈建议给** */
  impact?: string
}

export const approvalsApi = {
  candidates: (perms: string[]) =>
    api.get<Authorizer[]>('/auth/approvals/candidates', { params: { perms: perms.join(',') } }),

  request: (body: RequestBody) => api.post<Pending>('/auth/approvals', body),

  /** 批准要带**自己的**密码；拒绝不用。 */
  decide: (id: string, approve: boolean, password?: string) =>
    api.post<void>(`/auth/approvals/${id}`, { approve, password }),
}
