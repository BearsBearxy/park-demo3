// RBAC v3(读写分开)起,导航、首页、页签、路由都按查看权滤。spec 里「这人什么都看得了(系统管理除外)」用这里,
// 别在各 spec 里逐个抄权限点。
import { useAuthStore } from '@/stores/auth'

export const ALL_VIEWS = [
  'master:view', 'contract:view', 'param:view', 'meter:view', 'billing:view',
  'entry:view', 'salary:view', 'report:view', 'analysis:view',
]

/** 给当前 pinia 的 auth 补上全部业务查看权(保留已有的权限点)。 */
export function grantViews(...extra: string[]): void {
  const auth = useAuthStore()
  auth.permissions = [...new Set([...auth.permissions, ...ALL_VIEWS, ...extra])]
}
