// 系统管理(RBAC-SPEC §10 P1)DTO —— 与后端 /api/system/** 契约一一对应。
// 读也要管:GET 需 system:view,非 GET 需 system:edit(RBAC-SPEC §5.1)。

/** 13 个权限点之一(顺序由后端 Perm.ALL 决定,前端不排序) */
export interface PermDTO {
  key: string
  label: string
  hint: string
}

/** 3 个业务导航层:data / reports / analysis(与 fpNav.ts 的 NavLayer.id 同值) */
export interface NavLayerDTO {
  id: string
  label: string
}

/** GET /api/system/perms */
export interface PermsMetaDTO {
  perms: PermDTO[]
  navLayers: NavLayerDTO[]
}

export interface RoleDTO {
  id: number
  code: string
  name: string
  /** 1 = 6 个预置系统角色:不可删,但权限可改 */
  /** 预置角色:不可删,但权限与导航层照改。后端是 Java boolean → JSON true/false,不是 0/1 */
  builtin: boolean
  navLayers: string[]
  perms: string[]
  userCount: number
  remark?: string | null
}

export interface RoleReq {
  /** 新建必填;PUT 不带(code 创建后不可改) */
  code?: string
  name: string
  navLayers: string[]
  perms: string[]
  remark?: string
}

/** 用户行上的角色引用(不含 perms/navLayers,要完整角色去 /system/roles 取) */
export interface UserRoleRefDTO {
  id: number
  code: string
  name: string
}

export interface UserDTO {
  id: number
  username: string
  displayName: string
  /** 1=启用 0=停用。账号只停用不删除(RBAC-SPEC §8) */
  status: number
  mustChangePassword: boolean
  roles: UserRoleRefDTO[]
  createdAt: string
}

export interface UserCreateReq {
  username: string
  displayName: string
  password: string
  roleIds: number[]
}

/** 编辑只改这两项:用户名创建后不可改(导入记录/审核痕迹按它追责) */
export interface UserUpdateReq {
  displayName: string
  roleIds: number[]
}

export interface UserQuery {
  q?: string
  status?: number
  roleId?: number
}

// ── 操作日志(RBAC-SPEC §7 P2) ─────────────────────────────────────────
// 三张来源表(param_change_log / import_log / auth_audit_log)**不合并**:各有各的专用字段,
// 合进通用表就得塞 JSON,那两屏的历史查询反而难写。归一只发生在**展示层**,即下面这个形状。

/** 日志来源:param=计费参数 · import=导入 · auth=账号与角色 · review=审核(R1 起的第 4 路)。
 *  后端只认这四个值,别的返 400(白名单在 SystemService)。 */
export type AuditSource = 'param' | 'import' | 'auth' | 'review'

export interface AuditRowDTO {
  source: AuditSource
  ts: string
  actor: string
  /** 来源各有各的取值:param=set/delete/recalc/migrate · import=complete/partial/rejected ·
   *  auth=user.create/role.update/… · review=submit/approve/return/withdraw */
  action: string
  target: string
  detail: string
  /** 只有「代他人执行」的动作有值(主管授权别人接管编辑锁)。
   *  ⚠ 有值必须显示出来 —— 审计要记两个人,只显示操作人的话「谁批准的」就白记了 */
  authorizer?: string | null
}

/** GET /api/system/logs —— 服务端分页 */
export interface AuditPageDTO {
  rows: AuditRowDTO[]
  total: number
  page: number
  size: number
  /** 三表出现过的操作人并集,给筛选下拉用 */
  actors: string[]
}

export interface AuditQuery {
  /** 空 = 全部 */
  src?: string
  /** 操作人用户名,空 = 全部 */
  actor?: string
  /** YYYY-MM-DD,含当天 00:00 */
  from?: string
  /** YYYY-MM-DD,**含结束当天全天**(后端按 to+1 天处理) */
  to?: string
  /** 从 1 起 */
  page?: number
  /** 默认 50,上限 200 */
  size?: number
}
