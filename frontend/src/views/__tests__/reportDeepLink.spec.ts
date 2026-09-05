// src/views/__tests__/reportDeepLink.spec.ts — 报表层的期间深链(SIDEBAR-UX-REDESIGN §4.2 · P0c):损益附表 + 收入核对。
// 三大报表那一份在 reportWorkbenchFlow.spec(三屏共用 useFinStatementScreen,一份够)。
// 每条用例的注释都写明 production 改哪一行会红。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

// query 可变(切回之间换 ?p=);fullPath 走 getter(useRoute() 的返回对象只建一次);meta.value 给 PnlScheduleView 选 config
const query: Record<string, string> = {}
const meta: Record<string, unknown> = {}
const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ query, meta, get fullPath() { return '/x?' + new URLSearchParams(query).toString() } }),
}))
vi.mock('@/api/pnl', () => ({ pnlApi: { overview: vi.fn(), year: vi.fn(), save: vi.fn(), import: vi.fn() } }))
vi.mock('@/api/recon', () => ({ reconApi: { overview: vi.fn(), month: vi.fn(), mark: vi.fn(), unmark: vi.fn() } }))
// 派生对照要拉六个 api(s10/pv/charging/elec/utilities/salary):这里不测派生 —— 整段换成空数据;生成器回 null(不发整年 PUT)
vi.mock('@/reports/pnlDerive', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/reports/pnlDerive')>()),
  loadDeriveData: vi.fn().mockResolvedValue({}),
  generateMissingRows: vi.fn().mockReturnValue(null),
}))
// 锁 mock 照 paramCenterView.spec:69:不 mock 的话 locksApi 走真 axios,jsdom 里抛错
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))

import PnlScheduleView from '@/views/reports/pnl/PnlScheduleView.vue'
import ReconView from '@/views/reports/recon/ReconView.vue'
import { pnlApi } from '@/api/pnl'
import { reconApi } from '@/api/recon'
import { useAuthStore } from '@/stores/auth'

type Screen = typeof PnlScheduleView | typeof ReconView
const OPTS = { global: { stubs: { Teleport: true, RouterLink: true, 'router-link': true } } }

async function open(C: Screen) {
  const w = mount(C, OPTS)
  await flushPromises()
  return w
}
/** 把屏包进 KeepAlive,alive 开关模拟切走 / 切回(期间条裸 push 命中缓存实例就是这条路)。 */
async function keptAlive(C: Screen) {
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(C) : null) }),
  }), OPTS)
  await flushPromises()
  return { w, alive }
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['report:edit']
  vi.clearAllMocks()
  localStorage.clear()
  for (const k of Object.keys(query)) delete query[k]
  meta.value = 'rent-pnl'
  vi.mocked(pnlApi.overview).mockResolvedValue({
    years: [{ year: 2024, hasData: true, rowCount: 2 }, { year: 2025, hasData: true, rowCount: 3 }],
  } as never)
  vi.mocked(pnlApi.year).mockImplementation((_s: string, y: number) => Promise.resolve({ year: y, rows: [] }) as never)
  // 后端 overview(year) 原样回传给定年;不带年回「有数据的最大年」2025
  vi.mocked(reconApi.overview).mockImplementation((y?: number) => Promise.resolve({ year: y ?? 2025, months: [] }) as never)
  vi.mocked(reconApi.month).mockImplementation((y: number, m: number) => Promise.resolve({ year: y, month: m, entities: [] }) as never)
})

describe('损益附表 · 期间深链', () => {
  it('p=2025-06&co=all 直落 2025 年表;期间条在(不是字面「\\1」),条上带走 p=2025-06 与 co=all —— 跳回利润表月份公司都还在', async () => {
    query.p = '2025-06'; query.co = 'all'
    const w = await open(PnlScheduleView)
    expect(pnlApi.year).toHaveBeenCalledWith('s1', 2025)
    expect(w.text()).not.toContain('\\1')
    const steps = w.findAll('.fss-step')
    expect(steps).toHaveLength(9)
    await steps[0].trigger('click')   // 利润表
    // 红法:stripQuery 改回 periodQuery(y/m/co) → 形状不对;carry 改成 setup 读一次的常量 → 这条仍绿,靠下面「第二圈」那条红
    expect(push).toHaveBeenCalledWith({ path: '/income-statement', query: { p: '2025-06', co: 'all' } })
  })

  it('旧链 ?y=2024(预算 / 损益分析改前发的书签)照认', async () => {
    query.y = '2024'
    await open(PnlScheduleView)
    expect(pnlApi.year).toHaveBeenCalledWith('s1', 2024)
  })

  it('❗第二圈期跟随:切走后地址换年,切回直落新年;carry 跟着换 —— 改前 carry 是 setup 常量、年只在 onMounted 读一次', async () => {
    query.p = '2025-06'; query.co = 'all'
    const { w, alive } = await keptAlive(PnlScheduleView)
    alive.value = false; await flushPromises()
    query.p = '2024-02'; query.co = '1'
    alive.value = true; await flushPromises()
    expect(pnlApi.year).toHaveBeenCalledWith('s1', 2024)
    push.mockClear()
    await w.findAll('.fss-step')[0].trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/income-statement', query: { p: '2024-02', co: '1' } })
  })

  it('无 query 激活不重置:切回时地址栏没有期,停在原来那年', async () => {
    query.p = '2025-06'
    const { w, alive } = await keptAlive(PnlScheduleView)
    vi.mocked(pnlApi.year).mockClear()
    alive.value = false; await flushPromises()
    delete query.p
    alive.value = true; await flushPromises()
    expect(pnlApi.year).not.toHaveBeenCalled()
    expect((w.findComponent(PnlScheduleView).vm as unknown as { year: number | null }).year).toBe(2025)
  })

  it('有未保存草稿时切回不换年,只在页内提示(dirty = 四类草稿之和)', async () => {
    query.p = '2025-06'
    const { w, alive } = await keptAlive(PnlScheduleView)
    const vm = w.findComponent(PnlScheduleView).vm as unknown as { draftNote: Record<string, string>; year: number | null }
    vm.draftNote = { r1: '改了备注' }
    await flushPromises()
    vi.mocked(pnlApi.year).mockClear()
    alive.value = false; await flushPromises()
    query.p = '2024-02'
    alive.value = true; await flushPromises()
    expect(pnlApi.year).not.toHaveBeenCalled()
    expect(vm.year).toBe(2025)
    const toast = w.find('.fpt--warning')
    expect(toast.exists(), 'dirty 没接进 useDeepPeriod 就没有这条提示').toBe(true)
    expect(toast.text()).toContain('2024')
    expect(toast.text()).toContain('未保存')
  })

  it('有草稿但年没变(利润表换了个月再跳回来)→ 不弹提示,carry 跟着换月 —— dirty 闸按年幂等', async () => {
    query.p = '2025-06'; query.co = '1'
    const { w, alive } = await keptAlive(PnlScheduleView)
    const vm = w.findComponent(PnlScheduleView).vm as unknown as { draftNote: Record<string, string> }
    vm.draftNote = { r1: '改了备注' }
    await flushPromises()
    alive.value = false; await flushPromises()
    query.p = '2025-07'
    alive.value = true; await flushPromises()
    expect(w.find('.fpt--warning').exists(), '年没变,不该拦').toBe(false)
    push.mockClear()
    await w.findAll('.fss-step')[0].trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/income-statement', query: { p: '2025-07', co: '1' } })
  })
})

describe('收入核对 · 期间深链', () => {
  it('p=2024-03 直落 2024-03 工作台;maxYear 仍由不带年的 overview 决定(2025)—— 改前 overview(carry.year) 把上限污染成 2024,「下一年」锁死', async () => {
    query.p = '2024-03'
    const w = await open(ReconView)
    expect(reconApi.month).toHaveBeenCalledWith(2024, 3)
    expect(reconApi.overview).toHaveBeenCalledWith()
    const vm = w.vm as unknown as { maxYear: number; year: number }
    expect(vm.year).toBe(2024)
    expect(vm.maxYear).toBe(2025)
  })

  it('只有年 → 停在月份层;条上 9 环,co 原样带回(本屏不认 co)', async () => {
    query.p = '2024'; query.co = 'all'
    const w = await open(ReconView)
    expect(reconApi.month).not.toHaveBeenCalled()
    expect(reconApi.overview).toHaveBeenCalledWith(2024)
    const steps = w.findAll('.fss-step')
    expect(steps).toHaveLength(9)
    await steps[0].trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/income-statement', query: { p: '2024', co: 'all' } })
  })

  it('❗第二圈期跟随:切走后地址换月,切回直落新月', async () => {
    query.p = '2024-03'
    const { alive } = await keptAlive(ReconView)
    alive.value = false; await flushPromises()
    query.p = '2024-04'
    alive.value = true; await flushPromises()
    expect(reconApi.month).toHaveBeenCalledWith(2024, 4)
  })

  it('无 query 激活不重置:切回时地址栏没有期,停在 2024-03 工作台', async () => {
    query.p = '2024-03'
    const { w, alive } = await keptAlive(ReconView)
    vi.mocked(reconApi.month).mockClear()
    alive.value = false; await flushPromises()
    delete query.p
    alive.value = true; await flushPromises()
    expect(reconApi.month).not.toHaveBeenCalled()
    expect((w.findComponent(ReconView).vm as unknown as { month: number | null }).month).toBe(3)
  })
})
