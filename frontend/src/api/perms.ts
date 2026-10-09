import { ref } from 'vue'
import http from '@/api'
import { fpBuildRoutes } from '@/nav/fpNav'

// 权限点字典（键 → 人话名）。后端 Perm.META 是唯一来源 —— 前端不许自己抄一份，
// 加第 15 个权限点时它要自动出现。走 /api/auth/perms 而不是 /api/system/perms：
// 提权弹窗要给**没有系统管理查看权的财务专员**看「你缺的是哪几项」。
export interface PermMeta { key: string; label: string; hint: string }

const dict = ref<Record<string, PermMeta>>({})
let loading: Promise<void> | null = null

/** 幂等、并发安全：多个弹窗同时打开也只发一次请求。 */
export function loadPermDict(): Promise<void> {
  if (Object.keys(dict.value).length) return Promise.resolve()
  if (!loading) {
    loading = http.get<PermMeta[]>('/auth/perms')
      .then((list) => { dict.value = Object.fromEntries(list.map((m) => [m.key, m])) })
      .catch(() => { /* 拿不到就退回显示权限点原名，不让弹窗打不开 */ })
      .finally(() => { loading = null })
  }
  return loading
}

const ROUTES = fpBuildRoutes()
const ACT: Record<string, string> = { view: '查看', edit: '编辑' }

/**
 * 字典还没到(或取不到)时按导航表拼人话:`tenants:view` →「租户管理 · 查看」,和后端 Perm.META 的写法逐字相同
 * (屏名两边由 PermScreensMatchFpNavTest 对账),所以字典到了也不跳字;专有动作只写屏名。
 * 不退回权限点原名:回执是定死的一句,英文键会一直挂到人点 ×。
 */
export function permLabel(perm: string): string {
  const hit = dict.value[perm]?.label
  if (hit) return hit
  const i = perm.lastIndexOf(':')
  const page = ROUTES[perm.slice(0, i)]?.page
  if (!page) return perm   // 跨屏三项不可提权、也不进 lackText,走不到这里
  const act = ACT[perm.slice(i + 1)]
  return act ? `${page} · ${act}` : page
}

export function permHint(perm: string): string {
  return dict.value[perm]?.hint ?? ''
}
