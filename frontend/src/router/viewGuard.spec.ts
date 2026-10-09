// 路由守卫 · 查看权(RBAC v3 读写分开 2026-10-04;v4 一屏一项 2026-10-09):没有这一屏的查看权 → 「无权查看」页,
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
import { loadPermDict } from '@/api/perms'
import { flushPromises } from '@vue/test-utils'
import { viewsOf } from '@/test-utils/perms'
import { lackText } from '@/composables/useViewGate'

// 权限点人话名来自后端 Perm.META(/auth/perms);这里给两个,其余退回原名(permLabel 口径)
vi.mock('@/api/perms', () => ({
  loadPermDict: vi.fn(() => Promise.resolve()),
  permLabel: (k: string) => ({ 'tenants:view': '租户管理 · 查看', 'ledger:view': '月度台账 · 查看', 'buildings:view': '楼栋管理 · 查看' } as Record<string, string>)[k] ?? k,
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
// 整个文件的 GET 都记下来(照常放行):「快照全认得就不重取」只能这样钉 —— 守卫的「只试一次」是模块级的,
// 要是全认得也重取,第一条用例就把那一次用掉了,后面单看某一条永远看不出来
const allGets = vi.spyOn(http, 'get')

describe('守卫:没有查看权落「无权查看」页', () => {
  // 破坏验证:守卫里那条 canViewPage 的 if 删掉 → 红
  it('❗只有报表、分析查看权的人打开月度台账:落 /no-access,带着原地址', async () => {
    signIn([...viewsOf('analysis'), ...viewsOf('reports')])
    await router.push('/ledger?p=2025-06')
    expect(at().path).toBe('/no-access')
    expect(at().query.to).toBe('/ledger?p=2025-06')
  })

  it('有月度台账那一屏的查看就照常进;首页谁都能进', async () => {
    signIn(['ledger:view'])
    await router.push('/ledger')
    expect(at().path).toBe('/ledger')
    await router.push('/home')
    expect(at().path).toBe('/home')
  })

  // 同一组里部分单项没授权(客户原话「同一模块里可以有部分单项没授权」):月度台账看得了,同组的附表10 进不去
  it('同一组里没授的那一屏进不去,授了的照进', async () => {
    signIn(['ledger:view'])
    await router.push('/sales-income')
    expect(at().path).toBe('/no-access')
  })

  // 报表层同理(§15.10 示例):只授利润表查看,同组的资产负债表进不去
  it('只授利润表查看:资产负债表落「无权查看」,利润表照进', async () => {
    signIn(['income-statement:view'])
    await router.push('/balance-sheet')
    expect(at().path).toBe('/no-access')
    expect(at().query.to).toBe('/balance-sheet')
    await router.push('/income-statement')
    expect(at().path).toBe('/income-statement')
  })

  // 破坏验证:viewPermsOf 按 ?mode=meter 返回别的键 → 红
  it('❗光伏带 ?mode=meter 的深链不再另要抄表查看:有这一屏的查看,两本都进', async () => {
    signIn(['pv-income:view'])
    await router.push('/pv-income?mode=meter')
    expect(at().path).toBe('/pv-income')
    await router.push('/pv-income?mode=summary')
    expect(at().fullPath).toBe('/pv-income?mode=summary')
  })

  it('系统管理也走同一道门,三屏各一项:只有用户管理查看的人打开角色权限落「无权查看」页', async () => {
    signIn(['tenants:view', 'sys-users:view'])
    await router.push('/sys-roles')
    expect(at().path).toBe('/no-access')
    expect(at().query.to).toBe('/sys-roles')
    await router.push('/sys-users')
    expect(at().path).toBe('/sys-users')
  })
})

describe('「无权查看」页', () => {
  // 破坏验证:NoAccessView 的 sub 去掉 lackText 那一段 → 红;watch 删掉 → 红
  it('❗写明缺哪一项、去找系统管理员开;权限一到自己回原地址', async () => {
    const auth = signIn(viewsOf('analysis'))
    await router.push('/tenants')
    expect(at().fullPath).toBe('/no-access?to=/tenants')
    const w = mount(NoAccessView, { global: { plugins: [router] } })
    expect(w.text()).toContain('没有「租户管理」的查看权限')
    expect(w.text()).toContain('需要「租户管理 · 查看」权限才能看这一屏')
    expect(w.text()).toContain('请找系统管理员在「角色权限」里开通')
    auth.permissions = [...viewsOf('analysis'), 'tenants:view']     // 管理员开了,刷新后 refreshMe 取回
    await nextTick()
    await vi.waitFor(() => expect(at().path).toBe('/tenants'))
    w.unmount()
  })

  // 置灰原因与 403 同一种写法(K10):一个接口被十几屏共用时,不把十几个屏名糊进一句。
  // 破坏验证:lackText 去掉 ≥4 项那一档(全部用「或」连)→ 红
  it('❗缺的是几项任一:≤3 项用「或」连,4 项及以上只写前两项 +「等 N 项中任一项」', () => {
    expect(lackText(['ledger:view'])).toBe('需要「月度台账 · 查看」权限')
    expect(lackText(['ledger:view', 'tenants:view', 'buildings:view'])).toBe('需要「月度台账 · 查看」或「租户管理 · 查看」或「楼栋管理 · 查看」权限')
    expect(lackText(['ledger:view', 'tenants:view', 'buildings:view', 'alloc:view', 'meters:view']))
      .toBe('需要「月度台账 · 查看」「租户管理 · 查看」等 5 项中任一项权限')
  })
})

// 目标与阈值在库里、全员一份(用户 2026-10-05 拍板「2按你建议，3，4一起做」第 2 条)
describe('守卫:进分析层的屏之前先取到目标与阈值', () => {
  // 破坏验证:守卫里 await loadAnaSettings() 那行删掉 → 红;去掉 await → 「库里的数还没到就进屏了」红
  it('❗库里的数到了才进屏:屏上不先按默认值画一遍、再跳成库里的数', async () => {
    signIn(viewsOf('analysis'))
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

  // 目标与阈值下「需要「盈亏平衡与敏感性 · 编辑」…」那一行首帧就要是人话名,不先闪一下英文键(对抗复查 UI-F5)。
  // v4 起六项各归一屏,谁都可能缺其中几项 —— 有其中一项编辑的人照样要取。
  // 破坏验证:守卫里去掉 loadPermDict → 第一段红;改回「有某项编辑就不取」→ 第二段红
  it('❗权限名字典到了才进分析屏;有某一屏目标与阈值编辑权的人也取', async () => {
    signIn(viewsOf('analysis'))
    let release = () => {}
    vi.mocked(loadPermDict).mockClear().mockImplementationOnce(() => new Promise((r) => { release = () => r() }))
    await import('@/views/analysis/ExpiryView.vue')
    let done = false
    const nav = router.push('/expiry').then(() => { done = true })
    await flushPromises()
    await flushPromises()
    expect(done, '权限名还没到就进屏了').toBe(false)
    release()
    await nav
    expect(at().path).toBe('/expiry')

    signIn([...viewsOf('analysis'), 'churn:edit'])
    vi.mocked(loadPermDict).mockClear()
    await router.push('/churn')
    expect(at().path).toBe('/churn')
    expect(loadPermDict, '有流失风险线的编辑权就没取权限名:别的五项缺什么写不成人话').toHaveBeenCalled()
  })
})

// ⚠ 守卫里的「只试一次」是模块级的:这一组必须是本文件第一个用带旧键的快照导航的,放最后
describe('升级后第一次打开:本地还是 0.32 登录时存的权限', () => {
  // 破坏验证:判据改成「有键就重取」→ 这条红(下一条也跟着红:那一次早被前面的用例用掉了)
  it('❗快照里的键全认得:不重取 —— 本文件到这里为止的导航全是认得的键,一次 /auth/me 都没发', async () => {
    signIn(['tenants:view', 'review:approve'])
    await router.push('/tenants')
    expect(at().path).toBe('/tenants')
    expect(allGets.mock.calls.filter((c) => c[0] === '/auth/me')).toEqual([])
  })

  // 破坏验证:守卫里 staleChecked 那一段删掉 → 红(先落 /no-access);判据改回「一个 :view 都没有」→ 红(旧快照里有 entry:view)
  it('❗本地快照里有认不得的旧键:先重取一次权限再判,不先送进「无权查看」页', async () => {
    signIn(['entry:edit', 'entry:view'])
    const get = vi.spyOn(http, 'get').mockResolvedValue({ permissions: ['ledger:edit', 'ledger:view'] } as never)
    try {
      await router.push('/ledger')
      expect(get).toHaveBeenCalledWith('/auth/me')
      expect(at().path).toBe('/ledger')
    } finally {
      get.mockRestore()
    }
  })
})
