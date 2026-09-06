// src/nav/navFold.ts — 侧栏分组折叠的纯规则(SIDEBAR-UX-REDESIGN §2.1 / §3.2)。
// 折叠按 section.title 派生,NavSection 不加字段。展开集合本身是 SidebarPanel 的内存态,
// 这里只回答「路由落在这一屏时,哪些组必须是开的」;SidebarPanel 只追加、不收回。
// navHeight.spec 用同一函数算默认态高度 —— 规则改了,预算断言跟着红。
import type { NavLayer } from './fpNav'

/** 站在层首页时默认展开的组:
 *  数据层「出账」(§2.1:当前屏为 data-home 或组内屏时展开 —— 首页就是来做本月出账的);
 *  报表层「三大报表」(§3.1 默认态 284 的算法前提)。分析层首页不开组(§3.1 默认态 300)。 */
const HOME_OPEN: Record<string, string> = { data: '出账 · 每月工序', reports: '三大报表' }

/** 路由落在 activeValue 时必须展开的组标题:层首页的默认组 + 含当前屏的带标题组。 */
export function autoOpenTitles(layer: NavLayer, activeValue: string): string[] {
  const out: string[] = []
  if (activeValue === layer.home && HOME_OPEN[layer.id]) out.push(HOME_OPEN[layer.id])
  for (const s of layer.sections) {
    if (s.title && s.items.some(it => it.value === activeValue)) out.push(s.title)
  }
  return out
}
