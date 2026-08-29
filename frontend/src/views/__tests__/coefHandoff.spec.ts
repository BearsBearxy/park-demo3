import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

import BillNoticesView from '@/views/bills/BillNoticesView.vue'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { billNoticesApi } from '@/api/billNotices'
import { paramsApi } from '@/api/params'
import { contractApi } from '@/api/contract'
import { buildingApi } from '@/api/building'
import { companyBookApi } from '@/api/billDelivery'
import { billsApi } from '@/api/bills'

/**
 * 「计费参数 →〈系数簿〉」这条跳转（回归）。
 *
 * `ParamCenterView.gotoCoefBook()` 从 b6ff7e6 起就 push 着 `?coef=1`，
 * 可是催缴单屏**从来没有读过 route** —— 按钮一直只是跳过去、窗口不开。
 * 出账链改造（P1）重建的正是这条链，顺手补上两端：
 *   ① 计费参数补 `openFresh`（深链协议的另一半：KeepAlive 缓存实例只在 setup 消费 query）
 *   ② 催缴单真的消费 `?coef=1`
 *
 * 账期不用从 query 取：出账链五屏共读一份组级期，本来就是同一个月。
 */

const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRoute: () => ({ query }),
  useRouter: () => ({ push: vi.fn() }),
}))

// 摊开真模块再盖掉发请求的那几个:这些 api 文件同时导出常量与类型
// (ACCOUNT_KINDS 之类),一个一个手抄 mock 只会追着报错补,补漏一个就整屏挂。
vi.mock('@/api/billNotices', async (o) => ({
  ...(await o<object>()),
  billNoticesApi: Object.fromEntries(['list', 'months', 'generate', 'detail'].map(f => [f, vi.fn()])),
}))
vi.mock('@/api/params', async (o) => ({
  ...(await o<object>()), paramsApi: Object.fromEntries(['status', 'list'].map(f => [f, vi.fn()])),
}))
vi.mock('@/api/contract', async (o) => ({
  ...(await o<object>()), contractApi: Object.fromEntries(['list'].map(f => [f, vi.fn()])),
}))
vi.mock('@/api/building', async (o) => ({
  ...(await o<object>()), buildingApi: Object.fromEntries(['list'].map(f => [f, vi.fn()])),
}))
vi.mock('@/api/billDelivery', async (o) => ({
  ...(await o<object>()),
  billDeliveryApi: Object.fromEntries(['confirm', 'markExported'].map(f => [f, vi.fn()])),
  companyBookApi: Object.fromEntries(['list'].map(f => [f, vi.fn()])),
}))
vi.mock('@/api/bills', async (o) => ({
  ...(await o<object>()), billsApi: Object.fromEntries(['paymap', 'setPaymap'].map(f => [f, vi.fn()])),
}))
vi.mock('@/api/meters', async (o) => ({
  ...(await o<object>()), metersApi: Object.fromEntries(['months'].map(f => [f, vi.fn()])),
}))
vi.mock('@/api/alloc', async (o) => ({
  ...(await o<object>()), allocApi: Object.fromEntries(['poolMonths', 'lossMonths'].map(f => [f, vi.fn()])),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  for (const k of Object.keys(query)) delete query[k]
  vi.mocked(billNoticesApi.list).mockResolvedValue([])
  vi.mocked(billNoticesApi.months).mockResolvedValue([])
  vi.mocked(contractApi.list).mockResolvedValue([])
  vi.mocked(buildingApi.list).mockResolvedValue([])
  vi.mocked(companyBookApi.list).mockResolvedValue([])
  vi.mocked(billsApi.paymap).mockResolvedValue([])
  vi.mocked(paramsApi.status).mockResolvedValue({
    priceOk: 6, priceTotal: 6, pendingChanges: 0, lastChangeAt: null,
    poolSnapshotAt: null, billBatchAt: null, stale: false, otherMonthsAffected: [],
  } as never)
})

/** 已经选过期(链上任一屏点过月格)——从计费参数跳过来时就是这个状态。 */
async function open() {
  useBillingPeriodStore().pick(2025, 3)
  const w = mount(BillNoticesView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}

describe('计费参数 →〈系数簿〉', () => {
  it('❗带 ?coef=1 过来 → 系数簿窗口开着', async () => {
    query.coef = '1'
    const w = await open()
    expect(w.findComponent({ name: 'CoefBookWindow' }).props('open')).toBe(true)
  })

  it('没带就不开 —— 平时点开催缴单不该弹一个窗', async () => {
    const w = await open()
    expect(w.findComponent({ name: 'CoefBookWindow' }).props('open')).toBe(false)
  })

  it('系数簿拿到的是组级期,不是 query 里的 ym —— 五屏共读一份,本来就是同一个月', async () => {
    query.coef = '1'
    query.ym = '2024-12'          // 老协议残留;期以 store 为准
    const w = await open()
    expect(w.findComponent({ name: 'CoefBookWindow' }).props('ym')).toBe('2025-03')
  })
})
