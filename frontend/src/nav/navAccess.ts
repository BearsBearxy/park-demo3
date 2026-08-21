// src/nav/navAccess.ts — 导航可见性:按角色的 navLayers 过滤,与 13 个权限点脱钩
//(权限只决定「能不能改」,读全开:不可见层的屏本身照样能打开、数据照显)。
// 刻意不在 fpNav.ts 源头过滤:fpAllPages()/fpBuildRoutes() 还要喂路由表、tabs store、TabStrip,
// 源头砍掉会连路由记录一起没,跳转直接 404。这里只过滤「导航入口」。
import { FP_NAV, type NavLayer } from './fpNav'

/** 单层可见性。「系统管理」层(id='system')不进 navLayers,按 system:view 判 —— 无权即整层不显示 */
export function isLayerVisible(id: string, navLayers: string[], canSystemView = false): boolean {
  return id === 'system' ? canSystemView : navLayers.includes(id)
}

/** 图标栏/侧边栏要展示的层。返回 FP_NAV 里的原对象,可直接用引用比较 */
export function visibleLayers(navLayers: string[], canSystemView = false): NavLayer[] {
  return FP_NAV.filter((L) => isLayerVisible(L.id, navLayers, canSystemView))
}

/** 登录落地页。必须落在**这个角色看得见的层里**,否则人一进来就在一个侧边栏没有入口的屏上,
 *  像页面坏了。三档:数据层 → 数据中心首页;有业务层但没数据层(园区股东)→ 驾驶舱;
 *  一个业务层都没有、只有系统管理权限(客户自建的"纯管理员")→ 用户管理。
 *  最后那档预置角色打不到(6 个预置角色都带全部业务层),但客户建得出来。 */
export function landingPath(navLayers: string[], canSystemView = false): string {
  if (navLayers.includes('data')) return '/data-home'
  if (navLayers.length) return '/cockpit'
  return canSystemView ? '/sys-users' : '/cockpit'
}
