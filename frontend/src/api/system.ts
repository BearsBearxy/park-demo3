import http from './index'
import type {
  AuditPageDTO, AuditQuery,
  PermsMetaDTO, RoleDTO, RoleReq, UserCreateReq, UserDTO, UserQuery, UserUpdateReq,
} from '@/types/system'

// 系统管理接口(RBAC-SPEC §10 P1)。全部 /api/system/** 读要 system:view、写要 system:edit。
// ⚠ 没有 DELETE /system/users —— 账号只停用不删除(§8):名下有导入记录、系数簿修改历史、
//   审核痕迹,真删了这些记录成孤儿,追责链断掉。UI 上一律写「停用」。
export const systemApi = {
  /** GET /api/system/perms → 13 个权限点 + 3 个导航层的人话标签 */
  perms: (): Promise<PermsMetaDTO> => http.get('/system/perms'),

  /** GET /api/system/roles → 角色(含 userCount);builtin=1 的 6 个预置角色不可删 */
  roles: (): Promise<RoleDTO[]> => http.get('/system/roles'),
  createRole: (req: RoleReq): Promise<RoleDTO> => http.post('/system/roles', req),
  updateRole: (id: number, req: RoleReq): Promise<RoleDTO> => http.put(`/system/roles/${id}`, req),
  removeRole: (id: number): Promise<void> => http.delete(`/system/roles/${id}`),

  /** GET /api/system/users?q=&status=&roleId= → 账号列表(含 roles 展开) */
  users: (query: UserQuery = {}): Promise<UserDTO[]> => http.get('/system/users', { params: query }),
  createUser: (req: UserCreateReq): Promise<UserDTO> => http.post('/system/users', req),
  updateUser: (id: number, req: UserUpdateReq): Promise<UserDTO> => http.put(`/system/users/${id}`, req),

  /** POST /api/system/users/{id}/status —— 停用/启用(不是删除) */
  setUserStatus: (id: number, status: 0 | 1): Promise<UserDTO> =>
    http.post(`/system/users/${id}/status`, { status }),

  /** POST /api/system/users/{id}/password —— 管理员重置他人密码,该账号下次登录须改密 */
  resetPassword: (id: number, password: string): Promise<void> =>
    http.post(`/system/users/${id}/password`, { password }),

  /**
   * GET /api/system/logs —— 三张来源表 union 的操作日志时间线(RBAC-SPEC §7)。
   * ⚠ **服务端分页**:换页/改筛选都要重新请求,不是前端切片(param_change_log 只涨不跌)。
   * to 传 YYYY-MM-DD 时后端按「含结束当天全天」处理。
   */
  logs: (query: AuditQuery = {}): Promise<AuditPageDTO> => http.get('/system/logs', { params: query }),

  /** POST /api/auth/change-password —— 改自己的密码(首次登录强制改密走同一个端点) */
  changeOwnPassword: (currentPassword: string, newPassword: string): Promise<void> =>
    http.post('/auth/change-password', { currentPassword, newPassword }),
}
