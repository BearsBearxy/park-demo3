// App 级「当场出现、不进铃铛」的几件(PAGE-BEHAVIOR-SPEC §5.2,画布 06-E;S5 FE-APP):
//   · 别的标签页退出或换了账号 → 居中弹窗,点外面、Esc 都不关,只有「刷新」(UI-OVERLAY-SPEC §3.5 例外)
//   · 临时授权按时到期 / 被系统提前收回 → 底部一句「授权已到期」(编辑中再加「，已退出编辑」)
//   · 正在编辑的表被别人交审 / 审核通过 → 全站一个 FPEvictedDialog 读 ui.editStop
//   · 远程授权批下来时弹窗已关 → App 补拉授权;挂载时 refreshMe
// 「❗」开头的做过破坏验证。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'

vi.mock('vue-router', () => ({ useRoute: () => ({ path: '/home' }) }))
// 外壳整棵不挂:这里只看 App 自己那几层
vi.mock('@/components/shell/AppShell.vue', () => ({ default: { name: 'AppShellStub', render: () => null } }))
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }))
const drift = vi.hoisted(() => ({ state: 'same' as 'same' | 'other-user' | 'signed-out' }))
vi.mock('@/api', () => ({
  default: api,
  readToken: () => 'test-token',
  bindSession: vi.fn(),
  sessionDrifted: () => drift.state !== 'same',
  sessionState: () => drift.state,
}))

import App from '@/App.vue'
import { useAuthStore, type Grant } from '@/stores/auth'
import { usePresenceStore } from '@/stores/presence'
import { useUiStore, type EditStop } from '@/stores/ui'
import type { Outcome } from '@/api/approvals'
import { receipts } from '@/utils/receipt'
import { useEditMode } from '@/composables/useEditMode'

enableAutoUnmount(afterEach)

/** 服务端此刻的授权(GET /auth/elevate 回它)。expiresAt 在 grant() 被调时按当时的钟算 */
let serverGrants: Grant[] = []
const grant = (leftMs = 1_800_000): Grant =>
  ({ perm: 'ledger:edit', permLabel: '月度台账', authorizer: 'wang', authorizerName: '王主管', expiresAt: Date.now() + leftMs })
/** GET /auth/me 回它 */
let meResp: { permissions: string[]; navLayers: string[]; roleNames: string[] } | null = null

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  localStorage.setItem('token', 'test-token')      // 不是 JWT:解析失败按有效算,isAuthed 为真
  localStorage.setItem('username', 'zhou')
  drift.state = 'same'
  serverGrants = []
  meResp = null
  api.get.mockReset().mockImplementation((url: string) =>
    Promise.resolve(url === '/auth/elevate' ? serverGrants : url === '/auth/me' ? meResp : []))
  api.delete.mockReset().mockResolvedValue(undefined)
  api.post.mockReset().mockResolvedValue(undefined)
  api.put.mockReset().mockResolvedValue({ users: [] })
  setActivePinia(createPinia())
  receipts.splice(0)
})
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

const mountApp = () => mount(App, { attachTo: document.body })
const texts = () => receipts.map((r) => [r.tone, r.text])

/** 靠 ledger:edit 编辑的一屏(真 useEditMode:权限不齐时它的守卫当场退出编辑)。直接置 editMode = 深链那条路 */
function ledgerEditing() {
  let em!: ReturnType<typeof useEditMode>
  mount(defineComponent({ setup() { em = useEditMode(['ledger:edit']); return () => h('div') } }))
  em.editMode.value = true
  return em
}

/** 进来时服务端就有一份授权(刷新页面后横幅跟着回来那条路) */
async function elevated(leftMs?: number) {
  serverGrants = [grant(leftMs)]
  const w = mountApp()
  await flushPromises()
  const auth = useAuthStore()
  expect(auth.grants, '前置:授权真的拉回来了').toHaveLength(1)
  return { w, auth, presence: usePresenceStore() }
}

describe('别的标签页退出或换了账号:居中弹窗,只有「刷新」', () => {
  // 破坏验证:遮罩上挂 `@mousedown.self="auth.drifted = false"` → 红;再加一个「知道了」按钮 → 红
  it('❗弹窗里只有一个按钮「刷新」;按遮罩、按 Esc 都还在;顶部红色横幅没了', async () => {
    drift.state = 'other-user'
    const w = mountApp()
    useAuthStore().drifted = true
    await nextTick()
    const dlg = () => document.body.querySelector<HTMLElement>('[role="alertdialog"]')
    expect(dlg(), '弹出来了').not.toBeNull()
    expect([...dlg()!.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['刷新'])
    expect(dlg()!.textContent).toContain('此浏览器已在别的标签页登录为另一个账号')

    w.find('.app-dlg-scrim').element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    w.find('.app-dlg-scrim').element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(dlg(), '点外面 / Esc 不关').not.toBeNull()
    expect(useAuthStore().drifted).toBe(true)
    expect(document.body.querySelector('.app-drift')).toBeNull()
  })

  it('别的标签页退出登录:写退出那一句,焦点落在「刷新」上', async () => {
    drift.state = 'signed-out'
    mountApp()
    useAuthStore().drifted = true
    await flushPromises()
    const dlg = document.body.querySelector<HTMLElement>('[role="alertdialog"]')!
    expect(dlg.textContent).toContain('此浏览器已在别的标签页退出登录')
    expect(dlg.textContent).toContain('刷新后回到登录页')
    expect(document.activeElement?.textContent?.trim()).toBe('刷新')
  })
})

describe('临时授权到期 / 被系统提前收回:底部一句', () => {
  // 破坏验证:presence.elevated 那个 watch 里删掉 receipt.warn → 红;删掉 endElevation → 红
  it('❗心跳从「还在」跳成「没了」:出「授权已到期」,本页授权清空', async () => {
    const { auth, presence } = await elevated()
    presence.elevated = true
    await nextTick()
    presence.elevated = false
    await flushPromises()
    expect(texts()).toEqual([['warn', '授权已到期']])
    expect(auth.grants).toHaveLength(0)
  })

  // 破坏验证:expiredText 恒回「授权已到期」→ 红
  it('❗收回时靠这份授权编辑的屏退出了:那句是「授权已到期，已退出编辑」', async () => {
    const { auth, presence } = await elevated()
    const em = ledgerEditing()
    await nextTick()
    expect(auth.editing, '前置:进了编辑态').toBe(true)
    presence.elevated = true
    await nextTick()
    presence.elevated = false
    await flushPromises()
    expect(em.editMode.value, '权限不齐,守卫退出了编辑').toBe(false)
    expect(texts()).toEqual([['warn', '授权已到期，已退出编辑']])
  })

  // 破坏验证:expiredText 改回按 auth.editing 判 → 红(人在别的屏用自己的权限编辑,什么都没退)
  it('❗到期时在编辑的屏不靠这份授权:只说「授权已到期」,不说已退出编辑', async () => {
    vi.useFakeTimers()
    const { auth } = await elevated(2_000)
    auth.openEditor(Symbol('meters'), 'meters')   // 用自己的权限编辑另一屏,授权到期它不退
    vi.advanceTimersByTime(2_000)
    await nextTick()
    expect(auth.editing, '那一屏还在编辑').toBe(true)
    expect(texts()).toEqual([['warn', '授权已到期']])
  })

  // 破坏验证:把 `before !== true` 那条去掉 → 红(刚拿到授权时在途的那拍会把新授权清掉)
  it('❗没先说过「还在」的 false 不算收回:授权留着,不出那句', async () => {
    const { auth, presence } = await elevated()
    expect(presence.elevated).toBeNull()
    presence.elevated = false
    await flushPromises()
    expect(texts()).toEqual([])
    expect(auth.grants).toHaveLength(1)
  })

  // 破坏验证:grants 那个 watch 删掉 receipt.warn → 红
  it('❗按时到期:倒数到 0 那一刻出「授权已到期」', async () => {
    vi.useFakeTimers()
    await elevated(2_000)
    vi.advanceTimersByTime(1_000)
    expect(texts()).toEqual([])
    vi.advanceTimersByTime(1_000)
    await nextTick()
    expect(texts()).toEqual([['warn', '授权已到期']])
  })

  // 破坏验证:post 那个 watch 里写死「授权已到期」→ 红;记个数的 sync watch 改成 flush:'post'(守卫跑完才数)→ 红
  it('❗按时到期时靠这份授权编辑的屏同一拍退出:那句是「授权已到期，已退出编辑」', async () => {
    vi.useFakeTimers()
    const { auth } = await elevated(2_000)
    const em = ledgerEditing()
    await nextTick()
    expect(auth.editing, '前置:进了编辑态').toBe(true)
    vi.advanceTimersByTime(2_000)
    await nextTick()
    expect(em.editMode.value, '到期那一拍守卫退出了编辑').toBe(false)
    expect(texts()).toEqual([['warn', '授权已到期，已退出编辑']])
  })

  // 破坏验证:grants 那个 watch 去掉 expiresAt 的判断(只看条数变少)→ 红
  // 破坏验证:presence.elevated 那个 watch 去掉 `!auth.grants.length` → 红(下一拍心跳带回 false,又冒一句「授权已到期」)
  it('❗自己点「结束授权」/ 退出编辑清掉的:不出那句,下一拍心跳说「没了」也不出', async () => {
    const { auth, presence } = await elevated()
    presence.elevated = true                 // 授权期间心跳说「还在」
    await nextTick()
    auth.openEditor(Symbol('ledger'), 'ledger')
    await auth.endElevation(true)
    await flushPromises()
    expect(auth.grants).toHaveLength(0)
    presence.elevated = false                // 服务端也收回了,下一拍心跳跳成「没了」
    await flushPromises()
    expect(texts()).toEqual([])
  })
})

describe('远程授权批下来、挂载时重取权限', () => {
  // 破坏验证:删掉 presence.outcome 那个 watch → 红
  it('❗批准的结果回来、没有弹窗认领:App 把授权拉回来;拒绝的不拉', async () => {
    const w = mountApp()
    await flushPromises()
    const auth = useAuthStore()
    const presence = usePresenceStore()
    expect(auth.grants).toHaveLength(0)
    const elevCalls = () => api.get.mock.calls.filter(([u]) => u === '/auth/elevate').length
    const before = elevCalls()

    presence.outcome = { id: 'r1', approved: false, approverName: '王主管' } satisfies Outcome
    await flushPromises()
    expect(elevCalls(), '拒绝的不拉').toBe(before)

    serverGrants = [grant()]
    presence.outcome = { id: 'r2', approved: true, approverName: '王主管' } satisfies Outcome
    await flushPromises()
    expect(elevCalls()).toBe(before + 1)
    expect(auth.grants).toHaveLength(1)
    expect(w.find('.app-elev').exists(), '授权条跟着出来').toBe(true)
  })

  // 破坏验证:onMounted 里删掉 auth.refreshMe() → 红
  it('❗挂载就调 /auth/me:管理员刚给的权限刷新后就生效', async () => {
    meResp = { permissions: ['x:edit'], navLayers: ['data'], roleNames: ['财务专员'] }
    const auth = useAuthStore()
    expect(auth.can('x:edit')).toBe(false)
    mountApp()
    await flushPromises()
    expect(api.get).toHaveBeenCalledWith('/auth/me')
    expect(auth.can('x:edit')).toBe(true)
  })
})

describe('正在编辑的表被交审 / 审核通过:全站一个居中弹窗', () => {
  // 破坏验证:删掉 App 里的 <FPEvictedDialog> → 红
  it('❗ui.editStop 一有值就弹,写谁审过;点「知道了」清掉', async () => {
    mountApp()
    const ui = useUiStore()
    const stop: EditStop = { key: 'ledger:2026-08', status: 'approved', by: '李审', what: '月度台账 · 2026-08' }
    ui.editStop = stop
    await nextTick()
    const dlg = document.body.querySelector<HTMLElement>('.evd-scrim[role="alertdialog"]')
    expect(dlg, '弹出来了').not.toBeNull()
    expect(dlg!.textContent).toContain('审核通过')
    expect(dlg!.textContent).toContain('李审')
    const ok = [...dlg!.querySelectorAll('button')].find((b) => b.textContent?.trim() === '知道了')!
    ok.click()
    await nextTick()
    expect(ui.editStop).toBeNull()
    expect(document.body.querySelector('.evd-scrim')).toBeNull()
  })
})
