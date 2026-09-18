// 收藏(TAB-BAR-SPEC §5.2 §5.3)。「❗」开头的做过破坏验证。
import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useFavoritesStore, MAX_FAVS } from '../favorites'
import { useAuthStore } from '@/stores/auth'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

function login(who: string, permissions: string[] = ['ledger:edit']) {
  const auth = useAuthStore()
  auth.me = who
  auth.permissions = permissions
  return auth
}

describe('收藏', () => {
  it('❗第一次登录:预置原来按角色落地的那一屏,并记下「是预置的」', () => {
    login('zhou')                                   // 有写权限 → 本月出账
    const f = useFavoritesStore()
    expect(f.list).toEqual(['data-home'])
    expect(f.seeded).toBe(true)
    expect(JSON.parse(localStorage.getItem('fp-favs:zhou')!)).toEqual({ v: ['data-home'], seeded: true })
  })

  it('零写权限的人(总经理、股东)预置经营驾驶舱', () => {
    login('gm', [])
    expect(useFavoritesStore().list).toEqual(['cockpit'])
  })

  it('❗键已经在(哪怕是空的)就不再预置 —— 删光了不能自己长回来', () => {
    localStorage.setItem('fp-favs:zhou', JSON.stringify({ v: [] }))
    login('zhou')
    const f = useFavoritesStore()
    expect(f.list).toEqual([])
    expect(f.seeded).toBe(false)
  })

  it('❗任何改动都去掉「预置」标记', () => {
    login('zhou')
    const f = useFavoritesStore()
    f.toggle('ledger')
    expect(f.seeded).toBe(false)
    expect(JSON.parse(localStorage.getItem('fp-favs:zhou')!)).toEqual({ v: ['data-home', 'ledger'] })
  })

  it('toggle:加 / 去;只收导航里的屏', () => {
    login('zhou')
    const f = useFavoritesStore()
    expect(f.toggle('ledger')).toBe('added')
    expect(f.has('ledger')).toBe(true)
    expect(f.toggle('ledger')).toBe('removed')
    expect(f.toggle('home')).toBeNull()
    expect(f.toggle('newtab')).toBeNull()
    expect(f.list).toEqual(['data-home'])
  })

  it(`❗最多 ${MAX_FAVS} 个,满了不加`, () => {
    login('zhou')
    const f = useFavoritesStore()
    const more = ['ledger', 'tenants', 'contracts', 'buildings', 'meters', 'alloc', 'params', 'salary', 'utilities', 'import', 'cockpit', 'park']
    for (const v of more) f.toggle(v)
    expect(f.list.length).toBe(MAX_FAVS)
    expect(f.toggle('churn')).toBe('full')
    expect(f.has('churn')).toBe(false)
  })

  it('拖动换顺序', () => {
    login('zhou')
    const f = useFavoritesStore()
    f.toggle('ledger')
    f.toggle('tenants')
    f.move(2, 0)
    expect(f.list).toEqual(['tenants', 'data-home', 'ledger'])
  })

  it('❗按账号记:换个人登录各是各的', async () => {
    const auth = login('zhou')
    const f = useFavoritesStore()
    f.toggle('ledger')
    auth.me = 'li'
    auth.permissions = []
    await nextTick()
    await nextTick()
    expect(f.list).toEqual(['cockpit'])
    auth.me = 'zhou'
    await nextTick()
    await nextTick()
    expect(f.list).toEqual(['data-home', 'ledger'])
  })
})
