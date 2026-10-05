// 路由守卫 · 查看权(RBAC v3 读写分开,用户 2026-10-04 拍板):没有这一屏的查看权 → 「无权查看」页,
// 写明缺哪一项、去找系统管理员开;权限一到,「无权查看」页自己回原地址。「❗」开头的做过破坏验证。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import router from '@/router'
import http from '@/api'
import NoAccessView from '@/views/NoAccessView.vue'
import { __resetAnaSettingsForTest, anaSettings } from '@/analysis/anaSettings'
import { analysisApi } from '@/api/analysis'
import { flushPromises } from '@vue/test-utils'

// 权限点人话名来自后端 Perm.META(/auth/perms);这里给两个,其余退回原名(permLabel 口径)
vi.mock('@/api/perms', () => ({
  loadPermDict: () => Promise.resolve(),
  permLabel: (k: string) => ({ 'master:view': '主数据 · 查看', 'contract:view': '合同 · 查看' } as Record<string, string>)[k] ?? k,
}))

// 2100 年才过期的令牌(守卫先看「登没登录」,过期的会被拦回登录页)
const TOKEN = `h.${btoa(JSON.stringify({ exp: 4102444800 }))}.s`

function signIn(perms: string[]) {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('token', TOKEN)
  localStorage.setItem('permissions', JSON.stringify(perms))
  setActivePinia(createPinia())
  return useAuthStore()
}
const at = () => router.currentRoute.value

// 守卫放行后 router 会空闲预热各屏 chunk(setTimeout 兜底);测试里不让它跑(同 loginKicked.spec)
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout'] }) })
afterEach(() => { vi.useRealTimers() })

describe('守卫:没有查看权落「无权查看」页', () => {
  // 破坏验证:守卫里那条 canViewPage 的 if 删掉 → 红
  it('❗只有分析查看权的人打开月度台账:落 /no-access,带着原地址', async () => {
    signIn(['analysis:view', 'report:view'])
    await router.push('/ledger?p=2025-06')
    expect(at().path).toBe('/no-access')
    expect(at().query.to).toBe('/ledger?p=2025-06')
  })

  it('有台账查看权就照常进;首页谁都能进', async () => {
    signIn(['entry:view'])
    await router.push('/ledger')
    expect(at().path).toBe('/ledger')
    await router.push('/home')
    expect(at().path).toBe('/home')
  })

  // 破坏验证:守卫改判 to.path(不带 query)→ 红
  it('❗光伏带 ?mode=meter 的深链只认抄表查看权;不带 mode 的台账查看权就够', async () => {
    signIn(['entry:view'])
    await router.push('/pv-income?mode=meter')
    expect(at().path).toBe('/no-access')
    await router.push('/pv-income')
    expect(at().path).toBe('/pv-income')
  })

  it('系统管理也走同一道门:没有 system:view 落「无权查看」页,不再悄悄兜回首页', async () => {
    signIn(['master:view', 'entry:view'])
    await router.push('/sys-roles')
    expect(at().path).toBe('/no-access')
    expect(at().query.to).toBe('/sys-roles')
  })
})

describe('「无权查看」页', () => {
  // 破坏验证:NoAccessView 的 sub 去掉 lackText 那一段 → 红;watch 删掉 → 红
  it('❗写明缺哪一项、去找系统管理员开;权限一到自己回原地址', async () => {
    const auth = signIn(['analysis:view'])
    await router.push('/tenants')
    expect(at().fullPath).toBe('/no-access?to=/tenants')
    const w = mount(NoAccessView, { global: { plugins: [router] } })
    expect(w.text()).toContain('没有「租户管理」的查看权限')
    expect(w.text()).toContain('需要「主数据 · 查看」权限才能看这一屏')
    expect(w.text()).toContain('请找系统管理员在「角色权限」里开通')
    auth.permissions = ['analysis:view', 'master:view']     // 管理员开了,刷新后 refreshMe 取回
    await nextTick()
    await vi.waitFor(() => expect(at().path).toBe('/tenants'))
    w.unmount()
  })

  it('任一即可的屏(本月出账)把几项都列出来,用「或」连', async () => {
    signIn(['analysis:view'])
    await router.push('/data-home')
    const w = mount(NoAccessView, { global: { plugins: [router] } })
    expect(w.text()).toContain('需要「主数据 · 查看」或「合同 · 查看」或「param:view」或')
    w.unmount()
  })
})

// 目标与阈值在库里、全员一份(用户 2026-10-05 拍板「2按你建议，3，4一起做」第 2 条)
describe('守卫:进分析层的屏之前先取到目标与阈值', () => {
  // 破坏验证:守卫里 await loadAnaSettings() 那行删掉 → 红;去掉 await → 「库里的数还没到就进屏了」红
  it('❗库里的数到了才进屏:屏上不先按默认值画一遍、再跳成库里的数', async () => {
    signIn(['analysis:view'])
    __resetAnaSettingsForTest()
    let release = () => {}
    const settings = vi.spyOn(analysisApi, 'settings').mockImplementation(
      () => new Promise((r) => { release = () => r({ collectTarget: 80 }) }))
    try {
      await import('@/views/analysis/ChurnView.vue')   // 屏的代码先拉好,下面等的只剩取数
      let done = false
      const nav = router.push('/churn').then(() => { done = true })
      await flushPromises()
      await flushPromises()
      expect(done, '库里的数还没到就进屏了').toBe(false)
      release()
      await nav
      expect(at().path).toBe('/churn')
      expect(anaSettings.collectTarget).toBe(80)
      // 之后再进分析屏不再等、不再取
      await router.push('/breakeven')
      expect(at().path).toBe('/breakeven')
      expect(settings).toHaveBeenCalledTimes(1)
    } finally {
      settings.mockRestore()
    }
  })
})

// ⚠ 守卫里的「只试一次」是模块级的:这一组必须是本文件第一个用零查看权快照导航的,放最后
describe('升级后第一次打开:本地还是 v2 登录时存的权限', () => {
  // 破坏验证:守卫里 staleChecked 那一段删掉 → 红(先落 /no-access)
  it('❗本地快照一个 :view 都没有:先重取一次权限再判,不先送进「无权查看」页', async () => {
    signIn(['entry:edit'])
    const get = vi.spyOn(http, 'get').mockResolvedValue({ permissions: ['entry:edit', 'entry:view'] } as never)
    try {
      await router.push('/ledger')
      expect(get).toHaveBeenCalledWith('/auth/me')
      expect(at().path).toBe('/ledger')
    } finally {
      get.mockRestore()
    }
  })
})
