// src/stores/favorites.ts — 收藏(TAB-BAR-SPEC §5.2 §5.3)。顶栏 ☆、页签右键、左边导航右键加进来,首页上一格一格列出来。
// 按账号记在浏览器里:`fp-favs:<账号>` = { v: 屏 value 数组, seeded?: true }。
// 键不存在 = 这个账号第一次登录 → 预置一格「他进系统是来干什么的」那一屏(auth.roleHome),并标 seeded;
// 之后任何增删改都去掉 seeded(首页那句「先放好了你最常用的一屏」只在没动过时说)。
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { fpBuildRoutes } from '@/nav/fpNav'
import { useAuthStore } from '@/stores/auth'

/** 最多收藏几个:首页两行 × 6 格。 */
export const MAX_FAVS = 12

const key = (who: string) => `fp-favs:${who}`

export const useFavoritesStore = defineStore('favorites', () => {
  const auth = useAuthStore()
  const ROUTES = fpBuildRoutes()
  const list = ref<string[]>([])
  const seeded = ref(false)

  function load() {
    const who = auth.me
    if (!who) { list.value = []; seeded.value = false; return }
    const raw = localStorage.getItem(key(who))
    if (raw == null) {
      const home = auth.roleHome.slice(1)
      list.value = ROUTES[home] ? [home] : []
      seeded.value = true
      save()
      return
    }
    try {
      const o = JSON.parse(raw)
      list.value = (Array.isArray(o?.v) ? o.v : []).filter((v: unknown) => typeof v === 'string' && ROUTES[v]).slice(0, MAX_FAVS)
      seeded.value = o?.seeded === true
    } catch {
      list.value = []
      seeded.value = false
    }
  }
  function save() {
    const who = auth.me
    if (!who) return
    localStorage.setItem(key(who), JSON.stringify(seeded.value ? { v: list.value, seeded: true } : { v: list.value }))
  }
  function changed() { seeded.value = false; save() }

  load()
  // 换人登录各是各的。等 permissions 也赋完再读(login() 里 me 先于权限赋值,roleHome 要看权限)
  watch(() => auth.me, load, { flush: 'post' })

  const has = (v: string) => list.value.includes(v)

  /** 收藏 / 取消。满了不加,返回 'full';加上返回 'added';去掉返回 'removed';不能收藏的屏返回 null。 */
  function toggle(v: string): 'added' | 'removed' | 'full' | null {
    if (!ROUTES[v]) return null
    if (has(v)) { remove(v); return 'removed' }
    if (list.value.length >= MAX_FAVS) return 'full'
    list.value = [...list.value, v]
    changed()
    return 'added'
  }
  function remove(v: string) {
    if (!has(v)) return
    list.value = list.value.filter(x => x !== v)
    changed()
  }
  /** 首页上拖格子换顺序。 */
  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= list.value.length || to >= list.value.length) return
    const next = [...list.value]
    const [x] = next.splice(from, 1)
    next.splice(to, 0, x)
    list.value = next
    changed()
  }

  return { list, seeded, has, toggle, remove, move, load }
})
