// src/composables/__tests__/useDeepPeriod.spec.ts — 目标屏消费期间深链(SIDEBAR-UX-REDESIGN §4.2)。
// 首次在 setup 期跑(不查 dirty:全新实例没有草稿);KeepAlive 切回再跑;按 fullPath 去重;三不动。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, reactive, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const route = reactive({ fullPath: '/x', query: {} as Record<string, string | string[]>, meta: {} as Record<string, unknown> })
vi.mock('vue-router', () => ({ useRoute: () => route }))
vi.mock('@/api/meters', () => ({ metersApi: { months: vi.fn().mockResolvedValue(['2025-03']) } }))
vi.mock('@/api/alloc', () => ({ allocApi: { poolMonths: vi.fn().mockResolvedValue([]), lossMonths: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/api/billNotices', () => ({ billNoticesApi: { months: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/api/params', () => ({ paramsApi: { status: vi.fn().mockResolvedValue({ stale: false, otherMonthsAffected: [] }) } }))

import { useDeepPeriod, useChainDeepPeriod, type DeepPeriodOpts } from '@/composables/useDeepPeriod'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { useTabsStore } from '@/stores/tabs'
import { metersApi } from '@/api/meters'

function setRoute(query: Record<string, string>) {
  route.query = query
  route.fullPath = '/x' + (Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '')
}

/** 把 composable 包进 KeepAlive 里的壳,alive 开关模拟切走 / 切回。 */
function host(o: Omit<DeepPeriodOpts, 'apply'> & { apply?: DeepPeriodOpts['apply'] }) {
  const apply = vi.fn(o.apply ?? (() => {}))
  let api!: ReturnType<typeof useDeepPeriod>
  const Inner = defineComponent({ setup() { api = useDeepPeriod({ ...o, apply }); return () => null } })
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(Inner) : null) }),
  }))
  const away = async () => { alive.value = false; await nextTick() }
  const back = async () => { alive.value = true; await nextTick(); await nextTick() }
  return { w, apply, away, back, note: () => api.note.value }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  setRoute({})
  route.meta = {}
})

describe('useDeepPeriod', () => {
  it('带 p 挂载 → setup 期就 apply 一次;切走切回同一地址不再 apply', async () => {
    setRoute({ p: '2025-03', co: 'all' })
    const h1 = host({ current: () => ({ p: null }) })
    expect(h1.apply).toHaveBeenCalledTimes(1)
    expect(h1.apply).toHaveBeenCalledWith({ year: 2025, month: 3, co: 'all' })
    await h1.away(); await h1.back()
    expect(h1.apply, '同 fullPath 二次激活不重复').toHaveBeenCalledTimes(1)
  })

  it('切走期间地址变了 → 切回再 apply 一次', async () => {
    setRoute({ p: '2025-03' })
    const h1 = host({ current: () => ({ p: null }) })
    await h1.away()
    setRoute({ p: '2025-04' })
    await h1.back()
    expect(h1.apply).toHaveBeenCalledTimes(2)
    expect(h1.apply).toHaveBeenLastCalledWith({ year: 2025, month: 4, co: null })
  })

  it('无 p(也无旧格式)不 apply;地址栏垃圾也不 apply', async () => {
    const h1 = host({ current: () => ({ p: null }) })
    expect(h1.apply).not.toHaveBeenCalled()
    setRoute({ p: '1999-13' })
    const h2 = host({ current: () => ({ p: null }) })
    expect(h2.apply).not.toHaveBeenCalled()
  })

  it('与当前 (period, co) 相同 → 不动', () => {
    setRoute({ p: '2025-03', co: '2' })
    const same = host({ current: () => ({ p: '2025-03', co: 2 }) })
    expect(same.apply).not.toHaveBeenCalled()
    const diffCo = host({ current: () => ({ p: '2025-03', co: 3 }) })
    expect(diffCo.apply, '期同公司不同也算不同').toHaveBeenCalledTimes(1)
  })

  it('切回时目标屏有未保存改动 → 不切期,note 说清要哪一期、有几处', async () => {
    setRoute({ p: '2025-03' })
    const dirty = ref(0)
    const h1 = host({ current: () => ({ p: '2025-03' }), dirty: () => dirty.value })
    expect(h1.apply, '与当前相同,首跑不动').not.toHaveBeenCalled()
    dirty.value = 2
    await h1.away()
    setRoute({ p: '2025-05' })
    await h1.back()
    expect(h1.apply).not.toHaveBeenCalled()
    expect(h1.note()).toBe('地址栏要求 2025-05 期，本期有 2 处未保存')
    // 草稿保存完再切回来:这次真的 apply,提示随之清空(不许一句旧话挂到用户关掉为止)
    dirty.value = 0
    await h1.away()
    setRoute({ p: '2025-06' })
    await h1.back()
    expect(h1.apply).toHaveBeenLastCalledWith({ year: 2025, month: 6, co: null })
    expect(h1.note()).toBe('')
  })

  it('首跑不查 dirty —— 全新实例没有草稿,dirty 源在屏里可能还没声明', () => {
    setRoute({ p: '2025-03' })
    const h1 = host({ current: () => ({ p: null }), dirty: () => 5 })
    expect(h1.apply).toHaveBeenCalledTimes(1)
    expect(h1.note()).toBe('')
  })
})

describe('useChainDeepPeriod(出账链五屏的接法)', () => {
  it('apply = billingPeriod.pick + loadChain(门被深链跳过时它是唯一加载点)', async () => {
    setRoute({ p: '2025-03' })
    mount(defineComponent({ setup() { useChainDeepPeriod(); return () => null } }))
    const period = useBillingPeriodStore()
    expect(period.ym).toBe('2025-03')
    await flushPromises()
    expect(metersApi.months, 'loadChain 被调 → 矩阵数据在路上').toHaveBeenCalledTimes(1)
  })
  it('显式深链覆盖会话里已选的期(D2);只有年的链接不动链屏', () => {
    const period = useBillingPeriodStore()
    period.pick(2024, 1)
    setRoute({ p: '2025-03' })
    mount(defineComponent({ setup() { useChainDeepPeriod(); return () => null } }))
    expect(period.ym).toBe('2025-03')
    setRoute({ p: '2026' })
    mount(defineComponent({ setup() { useChainDeepPeriod(); return () => null } }))
    expect(period.ym, '年份链接对链屏没意义,不动').toBe('2025-03')
  })
})

describe('useDeepPeriod · 写页签上下文(P3 §4.3)', () => {
  it('首跑就把本屏的期写进 ctx(键 = route.meta.value)', () => {
    route.meta = { value: 'ledger' }
    const year = ref(2025), month = ref<number | null>(6)
    host({ current: () => ({ p: year.value ? `${year.value}-0${month.value}` : null }) })
    expect(useTabsStore().ctx.ledger).toEqual({ p: '2025-06' })
  })

  it('屏内换期(不经地址栏)也写 ctx —— 页签标题跟着屏走', async () => {
    route.meta = { value: 'ledger' }
    const year = ref(2025), month = ref<number | null>(6)
    host({ current: () => ({ p: year.value ? `${year.value}-0${month.value}` : null }) })
    month.value = 7
    await nextTick()
    expect(useTabsStore().ctx.ledger).toEqual({ p: '2025-07' })
  })

  it('传了 ctx() 就按它写(公司名一起进去),而不是照抄 current()', () => {
    route.meta = { value: 'ledger' }
    // current() 故意回一个跟 ctx() 不同的 p —— 断言要能证明写进去的是 ctx() 那份,不是抄 current()
    host({
      current: () => ({ p: '1999-01' }),
      ctx: () => ({ p: '2025-06', coName: '一期公司' }),
    })
    expect(useTabsStore().ctx.ledger).toEqual({ p: '2025-06', coName: '一期公司' })
  })

  it('ctx() 的 p 为 null(停在选期矩阵)→ ctx 只剩空壳,页签只显屏名', () => {
    route.meta = { value: 'ledger' }
    host({
      current: () => ({ p: '2025-06' }),
      ctx: () => ({ p: null, coName: '一期公司' }),
    })
    expect(useTabsStore().ctx.ledger).toEqual({ coName: '一期公司' })
  })
})
