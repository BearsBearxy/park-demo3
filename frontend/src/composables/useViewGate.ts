// 跳到别的屏的深链:没有目标屏的查看权时置灰、写明缺哪一项(RBAC v3,用户 2026-10-04 拍板第 8 条)。
// 判据在 nav/navAccess(viewLack);这里只配人话名 —— 字典来自后端 Perm.META(api/perms),前端不抄。
// 字典没到之前退回权限点原名,难看但不空白(permLabel 同一条口径)。字典只在真要写原因时才去取(lackText 里):
// 什么都看得了的人一次都不取。
import { useAuthStore } from '@/stores/auth'
import { loadPermDict, permLabel } from '@/api/perms'
import { viewLack } from '@/nav/navAccess'
import { receipt } from '@/utils/receipt'

/** 「需要「台账与附表 · 查看」权限」;任一补上即可时用「或」连。 */
export function lackText(perms: readonly string[]): string {
  void loadPermDict()   // 幂等:取过 / 在取就直接返回
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
