// src/nav/navAccess.ts — 导航可见性(RBAC-SPEC v3「读写分开」2026-10-04;v4「细到菜单单项」§15,2026-10-09):
// 两道门叠在一起 —— 层看 navLayers(角色屏「导航可见层」),屏看这一屏的**查看权限**(`<屏>:view`)。
// 没有查看权的屏:导航、搜索、首页、页签条都不列;直接打开落「无权查看」页(router 守卫)。
// 刻意不在 fpNav.ts 源头过滤:fpAllPages()/fpBuildRoutes() 还要喂路由表、tabs store、TabStrip,
// 源头砍掉会连路由记录一起没,跳转直接 404。这里只过滤「导航入口」。
import { FP_NAV, fpBuildRoutes, type NavLayer, type NavSection } from './fpNav'

/** 判权函数:传 auth.can(角色给的 + 主管授权的;*:view 不可提权,所以查看权只会是角色给的)。 */
export type Can = (perm: string) => boolean

/** 屏 value → 元信息。导航表是常量,建一次。 */
const ROUTES = fpBuildRoutes()
/** 跨屏三项:不属于任何一屏。 */
export const CROSS_PERMS = ['review:approve', 'lock:takeover', 'elevate:request'] as const
const screenOf = (p: string) => p.slice(0, p.lastIndexOf(':'))

/**
 * 这一屏要哪项查看权:v4(RBAC-SPEC §15)起一屏一项 `<屏>:view`,`?mode=` 不再分权。to 是 value 或带 / ? # 的地址都行。
 * null = 不设门:首页、新标签页、改密页这类不在导航里的,以及不认识的地址(认不出来是导航表的问题,
 * 不该表现成「无权查看」)。导航里每一屏都有一项,navAccess.spec 逐屏钉着。
 */
export function viewPermsOf(to: string): readonly string[] | null {
  const path = to.replace(/^\//, '').split(/[?#]/)[0]
  return ROUTES[path] ? [`${path}:view`] : null
}
/** 屏级写权:前缀是导航里的一屏、动作不是 view。只读判定用它。 */
export const isScreenWrite = (p: string) => !!ROUTES[screenOf(p)] && !p.endsWith(':view')
/** 认得的键:屏级键或跨屏三项。快照里有认不得的(0.32 留在浏览器里的旧键)就重取一次 /auth/me。 */
export const isKnownPerm = (p: string) => !!ROUTES[screenOf(p)] || (CROSS_PERMS as readonly string[]).includes(p)

/** 看不看得了这一屏。 */
export function canViewPage(to: string, can: Can): boolean {
  const ps = viewPermsOf(to)
  return !ps || ps.some(can)
}

/** 缺的查看权(任一补上即可);看得了返回 null。置灰时拿它写原因。 */
export function viewLack(to: string | null | undefined, can: Can): readonly string[] | null {
  if (!to) return null
  const ps = viewPermsOf(to)
  return ps && !ps.some(can) ? ps : null
}

/** 单层可见性:层在 navLayers 里(「系统管理」层不进 navLayers,只看权限),且层里至少有一屏看得了。 */
export function isLayerVisible(id: string, navLayers: string[], can: Can): boolean {
  if (id !== 'system' && !navLayers.includes(id)) return false
  const L = FP_NAV.find((x) => x.id === id)
  return !!L && L.sections.some((s) => s.items.some((it) => canViewPage(it.value, can)))
}

/** 侧栏 / 手机抽屉里这一层的目录:只留看得了的屏,空组不出。 */
export function visibleSections(L: NavLayer, can: Can): NavSection[] {
  return L.sections
    .map((s) => ({ ...s, items: s.items.filter((it) => canViewPage(it.value, can)) }))
    .filter((s) => s.items.length > 0)
}

/** 点层图标落哪:层首页看不了(比如只有报表查看权、数据层只剩导入中心)就落这一层第一块看得了的屏。 */
export function layerEntry(L: NavLayer, can: Can): string {
  if (canViewPage(L.home, can)) return L.home
  return visibleSections(L, can)[0]?.items[0]?.value ?? L.home
}

/**
 * 「这个人点了这条链接,到得了吗」—— 判的是**目标屏所在层**看不看得见。
 *
 * 有查看权、只是所在层不在 navLayers 里的屏照样打得开、数据照显。所以这里的「到不了」不是打不开,
 * 而是**回不来** —— 侧边栏里没有那一层的入口,人落在那屏上没有任何返回路径。
 * 给园区股东(只有经营分析层)一条「去台账录入」,就是把他送进这么一个地方。
 *
 * 收在这里而不是各屏自己判:判据只有一条,抄第二遍就会漂。跨层引导目前有两种长法 ——
 * `AnaEmpty` 的 to(17 处)与屏内手写的 `RouterLink`(2 处) —— 两种都问这一个函数。
 * 新写的那种由 `crossLayerLinkGate.spec` 挡着,不许再出现没问过就画的跨层链接。
 *
 * to 可以带 query / hash(深链空态),取第一段就是 nav value。**不认识的目标一律放行**:
 * 认不出来是导航表的问题,不该表现成「链接凭空少了一个」。
 *
 * v3 起还要**看得了**那一屏(canViewPage)。看不了的不在这里藏 —— 调用点拿 viewLack 置灰、写明缺哪一项
 * (AnaEmpty、composables/useViewGate),藏起来的话人不知道「本来有路,只是没开权限」。
 */
export function canReach(to: string | null | undefined, navLayers: string[], can: Can): boolean {
  if (!to || !canViewPage(to, can)) return false
  const meta = ROUTES[to.replace(/^\//, '').split(/[?#]/)[0]]
  return !meta || isLayerVisible(meta.layer, navLayers, can)
}

/** 图标栏/侧边栏要展示的层。返回 FP_NAV 里的原对象,可直接用引用比较 */
export function visibleLayers(navLayers: string[], can: Can): NavLayer[] {
  return FP_NAV.filter((L) => isLayerVisible(L.id, navLayers, can))
}

/** 登录落地页。必须落在**这个角色看得见的层里**,否则人一进来就在一个侧边栏没有入口的屏上,
 *  像页面坏了。底三档:数据层 → 本月出账;有业务层但没数据层(园区股东)→ 驾驶舱;
 *  一个业务层都没有、只有系统管理权限(客户自建的"纯管理员")→ 系统管理层第一块看得了的屏(systemHome)。
 *  最后那档预置角色打不到(7 个预置角色都带全部业务层),但客户建得出来。
 *
 *  P5 在前面加两档,判的是「**这个人进系统是来干什么的**」——「看得见」只是及格线:
 *  · reviewer:审核队列长在本月出账屏上,他每天来就是为了那一屏(有 data 层才成立)。
 *  · readonly:零 `:edit` 的人(总经理 / 股东 / 只读账号)落在一屏全是录入按钮、
 *    而每颗都按不动的清单上,是把"你什么都不能做"当成开场白。驾驶舱才是他要看的。
 *  两档的次序不能反:审核员本身零 `:edit`(D16 录审分离),readonly 在前会把他也送去驾驶舱。 */
export function landingPath(navLayers: string[], systemHome: string | null = null,
                            opts: { readonly?: boolean; reviewer?: boolean } = {}): string {
  if (opts.reviewer && navLayers.includes('data')) return '/data-home'
  if (opts.readonly && navLayers.includes('analysis')) return '/cockpit'
  if (navLayers.includes('data')) return '/data-home'
  if (navLayers.length) return '/cockpit'
  return systemHome ?? '/cockpit'
}
