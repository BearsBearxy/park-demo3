import api, { readToken } from '@/api'

/** 锁被谁占着。heldMs / idleMs 由服务端算 —— 客户端的钟不可信，也不该各算各的。 */
export interface LockHolder {
  user: string
  displayName: string
  /** 已持有多久。界面上那句「已持有 12:41」 */
  heldMs: number
  /** 最后一次键鼠操作到现在多久 */
  idleMs: number
  /** 空闲 ≥20 分钟 → 走「直接接管」；否则要主管授权（CONCURRENCY-SPEC §4.3） */
  idle: boolean
}

export interface LockResult {
  granted: boolean
  holder: LockHolder | null
  /** granted 时服务端发的围栏(acquiredAt 毫秒)。release 带上它,晚到的 DELETE 不误删新锁。 */
  acquiredAt?: number | null
}

/** 被接管的通知。authorizerName 只有「授权接管」那条路径有值。 */
export interface Eviction {
  scope: string
  /** 接管者。**可空**:失锁兜底通知(锁在别处被还/后端重启/陈旧被清)没有接管者。 */
  by: string | null
  byDisplayName: string | null
  authorizerName: string | null
}

/**
 * scope 形如 `ledger:3:2025-06`（模块:标识:期，见 CONCURRENCY-SPEC §3.1）。
 *
 * **不 encodeURIComponent**：冒号在路径段里本来就合法，而 encodeURIComponent 会把 `/`
 * 编成 `%2F` —— Tomcat 默认直接拒收带 `%2F` 的路径，反而把好好的请求变成 400。
 * 作用域由代码拼出，字符集恒为 `[a-z0-9:-]`，不需要编码；真要放宽字符集，
 * 正确做法是把 scope 挪进请求体，不是在这里编码。
 */
const at = (scope: string) => `/locks/${scope}`

export const locksApi = {
  acquire: (scope: string) => api.post<LockResult>(at(scope)),

  /** 心跳续锁。返回非空即「你被接管了」。 */
  heartbeat: (scope: string, lastActivityAt: number) =>
    api.put<{ evicted: Eviction | null }>(`${at(scope)}/heartbeat`, { lastActivityAt }),

  release: (scope: string, t?: number | null) =>
    api.delete<void>(at(scope) + (t != null ? `?t=${t}` : '')),

  /** 接管。空闲态免授权（两个参数都不传）；活跃态须带授权人账号 + 密码。 */
  takeover: (scope: string, authorizer?: string, password?: string) =>
    api.post<LockResult>(`${at(scope)}/takeover`, { authorizer, password }),

  /**
   * 关标签页 / 刷新时释放。
   *
   * `beforeunload` 里发起的普通 XHR 会被浏览器连同页面一起掐掉，锁就只能等 3 分钟
   * 心跳超时自己掉 —— 下一个人白等三分钟，或者被迫去走接管。
   *
   * ⚠ **不用 `navigator.sendBeacon`**：它带不了自定义头，令牌只能塞进查询串，
   *   而查询串会进 nginx 访问日志、也会随 Referer 外泄 —— 拿一条 JWT 换三分钟等待不划算。
   *   `fetch` 的 `keepalive` 是同一件事的现代写法：页面卸载后照发，**且支持 Authorization 头**。
   *   顺带省掉后端一个专用的免鉴权端点，复用同一条 DELETE 路由。
   */
  releaseOnUnload(scope: string, fence?: number | null): void {
    const t = readToken()
    if (!t) return
    // 卸载路径上没人能接住 rejection,显式吞掉;掉了也有 3 分钟心跳超时兜底
    void fetch(`/api${at(scope)}${fence != null ? `?t=${fence}` : ''}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${t}` },
      keepalive: true,
    }).catch(() => { /* 兜底:心跳超时 */ })
  },
}
