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
