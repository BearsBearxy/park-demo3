// RBAC v4(权限细到菜单单项)起,导航、首页、页签、路由都按每一屏的 `<屏>:view` 滤。spec 里「这人什么都看得了
// (系统管理除外)」用这里,别在各 spec 里逐个抄权限点。清单从导航表派生 —— 新加一屏自动带上。
import { useAuthStore } from '@/stores/auth'
import { fpAllPages } from '@/nav/fpNav'

type Layer = 'data' | 'reports' | 'analysis' | 'system'

/** 某一层全部屏的查看权:viewsOf('analysis')。 */
export function viewsOf(layer: Layer): string[] {
  return fpAllPages().filter((p) => p.layer === layer).map((p) => `${p.value}:view`)
}

/** 全部业务屏的查看权(系统管理三屏除外),从导航表派生 —— 新加一屏自动带上。 */
export const ALL_VIEWS: string[] = fpAllPages().filter((p) => p.layer !== 'system').map((p) => `${p.value}:view`)

/** 给当前 pinia 的 auth 补上 ALL_VIEWS 和 extra(保留已有的)。签名不变。 */
export function grantViews(...extra: string[]): void {
  const auth = useAuthStore()
  auth.permissions = [...new Set([...auth.permissions, ...ALL_VIEWS, ...extra])]
}
