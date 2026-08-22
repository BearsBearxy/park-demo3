import { ref } from 'vue'
import http from '@/api'

// 权限点字典（键 → 人话名）。后端 Perm.META 是唯一来源 —— 前端不许自己抄一份，
// 加第 15 个权限点时它要自动出现。走 /api/auth/perms 而不是 /api/system/perms：
// 提权弹窗要给**没有 system:view 的财务专员**看「你缺的是哪几项」。
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

/** 字典还没到时退回原始键 —— 难看但不空白，且不会因为一次网络失败卡住授权流程。 */
export function permLabel(perm: string): string {
  return dict.value[perm]?.label ?? perm
}

export function permHint(perm: string): string {
  return dict.value[perm]?.hint ?? ''
}
