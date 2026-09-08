// 年表屏的整年交审接线(2026-09-08 拍板「一颗按钮管整年,键仍按月」)。
//
// 这四屏(附6 光伏 / 附7·8 充电桩 / 附11 电费成本 / 附13·14 水电)一屏一整年、12 行同时摆着,
// **没有「当前月」这一维** —— R4 那一轮它们因此没给页头传 review-key,动作簇整簇不渲染,
// 17 把审核键里的 6 把从上线到现在一次都没有交审入口。这一份钉住那一条不再复发。
//
// ⚠ 只断「屏 → 页头」这一段:那颗按钮作用于**哪几把键**、切 tab / 切 kind 后跟不跟着换。
//   候选月怎么筛在 composables/__tests__/useSchedScreen.spec.ts,按钮文案在
//   components/fp/__tests__/FPReviewActions.spec.ts —— 这里一条都不重测(抄一遍就是第二份判据)。
//
// 挑这两屏是因为它们各带一维会静默接错的东西:
//   · 附13/14 —— 同一把 kind 的两个 scope,切 tab 换 scope。接错 = 在三期屏上交办公的审。
//   · 附7/8   —— 两个 kind 同挂一个组件,由 route.meta 派生。接错 = 在电动车屏上交汽车的审。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

// 闸道单独 mock:走真 axios 的话 jsdom 里 reject,被 ensureYear 的 catch 吞掉 —— 动作簇的
// ready 恒假、整簇不渲染,而「不渲染」正是本 spec 要区分的那一档,吞了就分不出是接错了还是数据没来。
vi.mock('@/api/review', () => ({
  reviewApi: {
    states: () => Promise.resolve([]),
    list: () => Promise.resolve([]),
    submit: vi.fn(), approve: vi.fn(), returnBack: vi.fn(), withdraw: vi.fn(), recall: vi.fn(),
    closedMonths: () => Promise.resolve([]), pending: () => Promise.resolve([]),
  },
}))
// 锁不 mock 的话 locksApi 走真 axios 抛错(照 schedReviewWiring.spec 的口径)
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))
const query: Record<string, string> = {}
const meta: Record<string, unknown> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, meta, get fullPath() { return '/x?' + new URLSearchParams(query).toString() } }),
}))
vi.mock('@/api/utilities', () => ({
  utilitiesApi: { overview: vi.fn(), records: vi.fn(), batchDelete: vi.fn(), clearImported: vi.fn() },
}))
vi.mock('@/api/charging', () => ({
  chargingApi: {
    cats: vi.fn(), overview: vi.fn(), records: vi.fn(),
    batchDelete: vi.fn(), clearImported: vi.fn(), create: vi.fn(), updateNote: vi.fn(), remove: vi.fn(),
  },
}))

import UtilitiesView from '@/views/utilities/UtilitiesView.vue'
import ChargingView from '@/views/charging/ChargingView.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import { utilitiesApi } from '@/api/utilities'
import { chargingApi } from '@/api/charging'

type W = VueWrapper<Record<string, unknown>>

// 表体整块 stub 掉:本 spec 断的是**页头**拿到哪几把键,表体只是用来喂 rows() 的数据源。
// 不 stub 的话得为每一列造一份完整的 DTO,而那些字段与「这一年该交哪几个月」一个都不相干。
const STUBS = { Teleport: true, UtilitiesTable: true, ChargingTable: true }

/** 页头此刻拿到的那一串整年键 */
const keysOf = (w: W) => w.findComponent(SchedHeader).props('reviewKeys')
/** 进 2025 年那张年份卡 */
const enterYear = async (w: W) => {
  await w.find('.sm-ycard').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  for (const k of Object.keys(query)) delete query[k]
  for (const k of Object.keys(meta)) delete meta[k]
  Element.prototype.scrollIntoView = vi.fn()
  useAuthStore().permissions = ['entry:edit']
  vi.setSystemTime(new Date('2025-07-15T00:00:00'))
})

// ───────────────────────────────────────────────────────────────
describe('附13/14 · 整年交审键跟着 tab 的 scope 走', () => {
  const TOTAL = { elecQty: 0, elecAmt: 0, waterQty: 0, waterAmt: 0, total: 0 }
  const rows = (months: string[]) =>
    months.map((m, i) => ({ id: i + 1, source: 'manual', acctMonth: m }))

  beforeEach(() => {
    vi.mocked(utilitiesApi.overview).mockResolvedValue(
      { currentYear: 2025, years: [{ year: 2025, hasData: true, totalFee: 0, count: 3 }] } as never)
    // 办公有 2 / 3 月,三期只有 5 月 —— 两本账的行本来就不一样,候选月必须各算各的
    vi.mocked(utilitiesApi.records).mockImplementation((no: number, y: number) =>
      Promise.resolve({
        year: y, scheduleNo: no, total: TOTAL,
        rows: no === 14 ? rows(['2025-05']) : rows(['2025-02', '2025-03']),
      } as never))
  })

  // 破坏验证:把 useSchedScreen.reviewKeys 里的 `opts.reviewScope?.() ?? null` 换成常量 'office'
  //          → 后半条红(在三期屏上交了办公的审 —— 静默的错,屏上一点异样都没有)。
  it('❗切 tab = 换 scope:整年那颗按钮作用的键整片跟着换', async () => {
    const w = mount(UtilitiesView, { global: { stubs: STUBS } }) as unknown as W
    await flushPromises()
    await enterYear(w)
    expect(keysOf(w), '办公:屏上有 2 / 3 月两行')
      .toEqual(['utilities:office:2025-02', 'utilities:office:2025-03'])

    await w.findAll('.ut-seg2-b').find(b => b.text().includes('三期'))!.trigger('click')
    await flushPromises()
    expect(keysOf(w), '三期只有 5 月一行 —— scope 与月份两维都得跟着换')
      .toEqual(['utilities:phase3:2025-05'])
  })

  // 破坏验证:把 PvView/ChargingView/ElecView/UtilitiesView 任一屏的 :review-keys 删掉 → 红。
  // (源码层的同一条在 reviewActionsWiredGate.spec.ts;这里断的是它真的渲染出了一颗按钮。)
  it('❗屏上真的长出了那颗整年按钮 —— 接线断在哪一层都是「整簇不渲染」', async () => {
    const w = mount(UtilitiesView, { global: { stubs: STUBS } }) as unknown as W
    await flushPromises()
    await enterYear(w)
    const texts = w.findAll('button').map(b => b.text().trim())
    expect(texts, '闸道空表 = 两个月都还「录入中」')
      .toContain('交审 2025 年（2 个月）')
    expect(w.find('.lc-spreadchip').text(), '一颗按钮管整年,这一年的分布要读得出')
      .toBe('本年 2 待交')
  })
})

// ───────────────────────────────────────────────────────────────
describe('附7/8 · 整年交审键跟着 route.meta 的 kind 走', () => {
  const TOTAL = { kwh: 0, fee: 0, cost: 0, profit: 0 }
  beforeEach(() => {
    vi.mocked(chargingApi.cats).mockResolvedValue([])
    vi.mocked(chargingApi.overview).mockResolvedValue(
      { currentYear: 2025, years: [{ year: 2025, hasData: true, totalProfit: 0, count: 2 }] } as never)
    vi.mocked(chargingApi.records).mockImplementation((no: number, y: number) =>
      Promise.resolve({
        year: y, cats: [], total: TOTAL,
        rows: [{ id: 1, scheduleNo: no, source: 'manual', acctMonth: '2025-04' }],
      } as never))
  })
  const open = async (kind: string): Promise<W> => {
    meta.kind = kind
    const w = mount(ChargingView, { global: { stubs: STUBS } }) as unknown as W
    await flushPromises()
    await enterYear(w)
    return w
  }

  // 破坏验证:把 ChargingView 的 reviewKinds 写死成 ['charging-car'] → 后半条红。
  // 附表7 与附表8 是**两个 kind**(不是一个 kind 的两个 scope),串了就是在电动车屏上交汽车的审。
  it('❗一个组件两个 kind:附表7 与附表8 各交各的', async () => {
    expect(keysOf(await open('schedule7'))).toEqual(['charging-car:2025-04'])
    expect(keysOf(await open('schedule8')), '附表8 交的必须是 charging-ebike')
      .toEqual(['charging-ebike:2025-04'])
  })
})
