// 跳到别的屏的深链:没有目标屏的查看权时置灰、写明缺哪一项(RBAC v3,用户 2026-10-04 拍板第 8 条;v4 起一屏一项)。
// 判据在 nav/navAccess(viewLack);这里只配人话名 —— 字典来自后端 Perm.META(api/perms),前端不抄。
// 字典没到之前按导航表拼屏名(permLabel),和字典里的写法逐字相同,不会先闪英文键。字典只在真要写原因时才去取(lackText 里):
// 什么都看得了的人一次都不取。
import { useAuthStore } from '@/stores/auth'
import { loadPermDict, permLabel } from '@/api/perms'
import { viewLack } from '@/nav/navAccess'
import { receipt } from '@/utils/receipt'

/**
 * 「需要「月度台账 · 查看」权限」;任一补上即可时 ≤3 项用「或」连,4 项及以上只写前两项 +「等 N 项中任一项」
 * (同后端 Perm.needText,RBAC-SPEC §15.6 —— 一个接口被十几屏共用时不把十几个屏名糊进一句)。
 */
export function lackText(perms: readonly string[]): string {
  void loadPermDict()   // 幂等:取过 / 在取就直接返回
  if (perms.length >= 4) return `需要「${perms.slice(0, 2).map(permLabel).join('」「')}」等 ${perms.length} 项中任一项权限`
  return `需要「${perms.map(permLabel).join('」或「')}」权限`
}

export function useViewGate() {
  /** 缺查看权时的一句原因;看得了(或不认识的地址)返回 ''。按钮上:`:disabled="!!lack(to)" v-tip="lack(to)"`。
   *  store 用到时再取:只在点击里用 blocked 的屏,setup 时不必已有 pinia。 */
  const lack = (to: string | null | undefined): string => {
    const ps = viewLack(to, useAuthStore().can)
    return ps ? lackText(ps) : ''
  }
  /** 图上的点、整行点击这类没法置灰的入口:缺权限就说一句原因、不跳。返回 true = 拦下了。 */
  const blocked = (to: string): boolean => {
    const t = lack(to)
    if (t) receipt.warn(`${t}，请找系统管理员开通`)
    return !!t
  }
  return { lack, blocked }
}
