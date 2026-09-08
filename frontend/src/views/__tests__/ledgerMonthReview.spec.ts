// 月度台账 · 选期矩阵的月卡审核角标(per-screen-review §07-④;SIDEBAR-UX-REDESIGN §9.2-4)。
//
// 改前这一屏只讲「录了没有」。人要知道 3 月锁没锁,得点进去看编辑按钮变没变成药丸 ——
// 一年十二个月就是十二次。角标一格一把键(ledger:{公司}:{年月}),四档:
// 灰点未交审 / 橙点待审核 / 绿锁已审核 / 红点已退回。
//
// 「哪个色画哪一档」在 components/fp/__tests__/chainMatrix.spec.ts 钉过一次(组件那一层),
// 这里只验**这一屏喂进去的是什么**:哪一把键、什么时候不喂、按年取了几趟。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import type { Book } from '@/types/book'
import type { LedgerOverviewDTO } from '@/types/ledger'
import type { ReviewRow, ReviewStatus } from '@/types/review'

const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, get fullPath() { return '/ledger' } }),
}))
vi.mock('@/api/books', () => ({ booksApi: { list: vi.fn(), templateAt: vi.fn() } }))
vi.mock('@/api/ledger', () => ({
  companyApi: { list: vi.fn() },
  ledgerApi: { years: vi.fn(), overview: vi.fn(), month: vi.fn() },
}))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: () => Promise.resolve([]) } }))
vi.mock('@/api/review', () => ({
  reviewApi: {
    list: vi.fn(() => Promise.resolve([])),
    states: vi.fn(() => Promise.resolve([])),
    submit: vi.fn(), approve: vi.fn(), returnBack: vi.fn(), withdraw: vi.fn(), recall: vi.fn(),
    closedMonths: vi.fn(() => Promise.resolve([])),
    pending: vi.fn(() => Promise.resolve([])),
  },
}))

import LedgerView from '@/views/ledger/LedgerView.vue'
import { booksApi } from '@/api/books'
import { ledgerApi, companyApi } from '@/api/ledger'
import { reviewApi } from '@/api/review'

const def: Book['definition'] = { groups: [{ id: 'g1', label: '租金', cols: [
  { id: 'factoryRent', std: true, label: '厂房租金', aliases: [], slot: 'rent', hidden: false, w: 96 },
] }] }
const bookA: Book = { id: 1, screen: 'ledger', companyId: 9, phase: null, name: '甲公司',
                      ver: 1, latestVer: 1, definition: def }

/** 2026 年 1–3 月有数据,4–12 月空。 */
const overview = (y: number): LedgerOverviewDTO => ({
  companyName: '甲公司', year: y, monthsWithData: 3, ytdRecv: 0, avgRecv: 0, activeTenants: 1,
  months: Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, recv: 0, coll: 0, tenants: 2,
    status: (i < 3 ? 'done' : 'empty') as 'done' | 'empty',
  })),
})

const row = (key: string, status: ReviewStatus): ReviewRow => ({
  key, kind: 'ledger', scope: '9', status,
  submittedBy: 'zhangsan', submittedAt: null, reviewedBy: '李审',
  reviewedAt: '2026-03-05T10:00:00', reason: null, blockedBy: [],
})

/** 进屏 → 左轨点甲公司 → 矩阵态(这一屏不自动选册,没选册只有占位)。 */
async function open() {
  const w = mount(LedgerView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  await w.findAll('.br-item')[0].trigger('click')
  await flushPromises()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['entry:edit']
  vi.clearAllMocks()
  vi.setSystemTime(new Date('2026-06-15T00:00:00'))
  vi.mocked(booksApi.list).mockResolvedValue([bookA])
  vi.mocked(booksApi.templateAt).mockResolvedValue(bookA)
  vi.mocked(companyApi.list).mockResolvedValue([{ id: 9, name: '甲公司', short: '甲', sortNo: 1 }] as never)
  vi.mocked(ledgerApi.years).mockResolvedValue([{ year: 2026, months: 3 }] as never)
  vi.mocked(ledgerApi.overview).mockImplementation((_c: number, y: number) =>
    Promise.resolve(overview(y)) as never)
  vi.mocked(reviewApi.states).mockResolvedValue([] as never)
})

describe('月度台账 · 月卡审核角标', () => {
  // 破坏验证:把 cellReviewKey 里的 companyId 换成写死 1 → 键对不上,1 月退成灰点 → 红
  it('❗一格一把键(ledger:公司:年月):已审核绿锁 / 待审核橙 / 已退回红 / 库里没这行是灰', async () => {
    vi.mocked(reviewApi.states).mockResolvedValue([
      row('ledger:9:2026-01', 'approved'),
      row('ledger:9:2026-02', 'submitted'),
      row('ledger:9:2026-03', 'returned'),
    ] as never)
    const w = await open()
    await flushPromises()
    const cards = w.findAll('.bmm-card')
    expect(cards[0].find('.bmm-rv').classes()).toContain('rv-approved')
    expect(cards[1].find('.bmm-rv').classes()).toContain('rv-submitted')
    expect(cards[2].find('.bmm-rv').classes()).toContain('rv-returned')
  })

  // 破坏验证:把 matrixYears 那格的 `review: cellReview(...)` 删掉 → 红
  it('❗库里没有这一行 = 未交审(灰点),不是「没角标」', async () => {
    const w = await open()
    await flushPromises()
    expect(w.findAll('.bmm-card')[0].find('.bmm-rv').classes()).toContain('rv-entered')
  })

  // 破坏验证:把 BookMonthMatrix 模板里的 `m.hasData &&` 去掉 → 空月长满灰点 → 红
  it('❗空月一格不画 —— 本来就没有东西可交,一片虚线卡长满灰点是纯噪音', async () => {
    const w = await open()
    await flushPromises()
    expect(w.findAll('.bmm-card')[5].find('.bmm-rv').exists()).toBe(false)
  })

  // 破坏验证:把 cellReview 里的 `!review.yearLoaded(y)` 那道门去掉 → 红
  it('❗年份数据还没到手时一格都不画,不拿「未交审」冒充「还不知道」', async () => {
    let release!: (v: unknown) => void
    vi.mocked(reviewApi.states).mockReturnValue(new Promise((r) => { release = r }) as never)
    const w = await open()
    await flushPromises()
    expect(w.findAll('.bmm-rv'), '闸道还没回来').toHaveLength(0)
    release([])
    await flushPromises()
    expect(w.findAll('.bmm-rv').length, '回来了才画').toBeGreaterThan(0)
  })

  // 破坏验证:把那条 watch 的 immediate 去掉 → 一趟都不发 → 红
  it('❗按年取,一年一趟(不是一格一趟)', async () => {
    await open()
    await flushPromises()
    // 矩阵纵排 2026(数据年,也是当前年)一行 ⇒ 一趟
    expect(vi.mocked(reviewApi.states).mock.calls.map(c => c[0])).toEqual([2026])
  })
})
