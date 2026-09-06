// src/views/__tests__/chainDeepLink.spec.ts — 出账链屏消费期间深链(SIDEBAR-UX-REDESIGN §4.2 / §9 P0a 破坏验证「带 p 进屏直落」)。
// 挑楼栋损耗做样本(与 chainPeriodFlow.spec 同理:链上最薄的一屏,五屏接法逐字相同);mock 与布线与它逐字相同。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

import LossLedgerView from '@/views/alloc/LossLedgerView.vue'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { allocApi } from '@/api/alloc'
import { paramsApi } from '@/api/params'
import { metersApi } from '@/api/meters'
import { billNoticesApi } from '@/api/billNotices'

vi.mock('@/api/alloc', () => ({
  allocApi: {
    loss: vi.fn(),
    poolMonths: vi.fn(),
    lossMonths: vi.fn(),
  },
}))
vi.mock('@/api/params', () => ({ paramsApi: { list: vi.fn(), status: vi.fn() } }))
vi.mock('@/api/meters', () => ({ metersApi: { months: vi.fn() } }))
vi.mock('@/api/billNotices', () => ({ billNoticesApi: { months: vi.fn() } }))
const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, fullPath: '/alloc-loss?' + new URLSearchParams(query).toString() }),
}))

const STATUS = {
  priceOk: 6, priceTotal: 6, pendingChanges: 0, lastChangeAt: null,
  poolSnapshotAt: null, billBatchAt: null, stale: false, otherMonthsAffected: [] as string[],
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  for (const k of Object.keys(query)) delete query[k]
  vi.mocked(metersApi.months).mockResolvedValue(['2025-02', '2025-03'])
  vi.mocked(allocApi.poolMonths).mockResolvedValue(['2025-03'])
  vi.mocked(allocApi.lossMonths).mockResolvedValue(['2025-03'])
  vi.mocked(billNoticesApi.months).mockResolvedValue([])
  vi.mocked(paramsApi.status).mockResolvedValue(STATUS)
  vi.mocked(paramsApi.list).mockResolvedValue([])
  vi.mocked(allocApi.loss).mockResolvedValue({ generated: true, units: [], recon: [] })
})

async function open() {
  const w = mount(LossLedgerView)
  await flushPromises()
  return w
}

describe('出账链 · 带期深链', () => {
  it('❗带 p 进屏直落那个月:门不出现,拉的就是那个月', async () => {
    query.p = '2025-03'
    const w = await open()
    expect(w.find('.cmg').exists(), '门该被深链跳过').toBe(false)
    expect(w.find('.ll-wrap').exists()).toBe(true)
    expect(allocApi.loss).toHaveBeenCalledWith('2025-03')
    expect(allocApi.loss, '首载只拉一次(期在 watch 注册前落定)').toHaveBeenCalledTimes(1)
  })
  it('门被跳过时链路条也有数据 —— loadChain 补上了(P1 复查 F1 同坑)', async () => {
    // ⚠ 接线之前这条恒绿:门还在,ChainMonthGate.vue:36 的 onMounted 自己就调 loadChain。
    //   它的鉴别力只在门被跳过之后成立 —— 破坏验证要删的是 useChainDeepPeriod 的 apply 里那句 loadChain,不是接线本身。
    query.p = '2025-03'
    const w = await open()
    expect(w.find('.cmg').exists(), '前提:门已被跳过').toBe(false)
    expect(metersApi.months).toHaveBeenCalled()
  })
  it('旧 ?ym= 照认(出账链四处旧链本期不改发链侧)', async () => {
    query.ym = '2025-03'
    const w = await open()
    expect(w.find('.cmg').exists()).toBe(false)
    expect(allocApi.loss).toHaveBeenCalledWith('2025-03')
  })
  it('显式深链覆盖会话里已选的期(D2)', async () => {
    useBillingPeriodStore().pick(2024, 1)
    query.p = '2025-03'
    await open()
    expect(useBillingPeriodStore().ym).toBe('2025-03')
  })
  it('无 p 不 apply → 照旧撞矩阵;地址栏垃圾也不信', async () => {
    const w1 = await open()
    expect(w1.find('.cmg').exists()).toBe(true)
    query.p = '1999-03'
    const w2 = await open()
    expect(w2.find('.cmg').exists()).toBe(true)
    expect(allocApi.loss).not.toHaveBeenCalled()
  })
})
