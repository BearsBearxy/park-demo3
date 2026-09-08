// 附表族屏的审核接线(per-screen-review 设计稿 §03-B2/B4 · §07-④;SIDEBAR-UX-REDESIGN §9.2)。
//
// 两件事,都是同一个问题的两半:「屏上这一格/这颗按钮到底作用于哪一把键」。
//   ① 月卡角标(§07-④):选期矩阵改前只讲「录了没有」。人要知道 3 月锁没锁,
//      得点进去看编辑按钮变没变成药丸 —— 一年十二个月就是十二次。
//   ② reviewKey 跟不跟着屏内那一维走:附12 按月、附10 按 (期区, 月)、附13/14 按 scope。
//      接错了不会报错,只会**在三期屏上交了二期的审** —— 静默的错,所以逐条钉住。
//
// ⚠ 动作簇本身的八格(四态 × 两角色)在 components/fp/__tests__/FPReviewActions.spec.ts,
//   这里一格都不重测 —— 抄一遍就是第二份判据。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import type { ReviewRow, ReviewStatus } from '@/types/review'
import type { Book, BookDef } from '@/types/book'
import type { S10OverviewDTO, S10MonthDTO, S10RecordDTO } from '@/types/s10'

// 闸道单独 mock:走真 axios 的话 jsdom 里 reject,被 ensureYear 的 catch 吞掉 —— 一格角标都不画,
// 而「不画」正是本 spec 要区分的一档,吞了就分不出是接错了还是数据没来。
const states = vi.fn<(y: number) => Promise<ReviewRow[]>>()
vi.mock('@/api/review', () => ({
  reviewApi: {
    states: (y: number) => states(y),
    list: () => Promise.resolve([]),
    submit: vi.fn(), approve: vi.fn(), returnBack: vi.fn(), withdraw: vi.fn(), recall: vi.fn(),
    closedMonths: () => Promise.resolve([]), pending: () => Promise.resolve([]),
  },
}))
// 锁不 mock 的话 locksApi 走真 axios 抛错 → 被「拿不准就不进」兜住,编辑态永远进不去(照 salaryGuards.spec:50)
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
vi.mock('@/api/salary', () => ({
  salaryApi: {
    overview: vi.fn(), records: vi.fn(),
    create: vi.fn(), updateNote: vi.fn(), remove: vi.fn(),
    importRows: vi.fn(), clearImported: vi.fn(), batchDelete: vi.fn(),
  },
}))
vi.mock('@/api/s10', () => ({
  s10Api: {
    getOverview: vi.fn(), getMonth: vi.fn(),
    batchDelete: () => Promise.resolve({ deleted: 0 }),
    clearImported: () => Promise.resolve({ deleted: 0 }),
  },
}))
vi.mock('@/api/books', () => ({ booksApi: { list: vi.fn(), templateAt: vi.fn() } }))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: () => Promise.resolve([]) } }))
vi.mock('@/api/utilities', () => ({
  utilitiesApi: { overview: vi.fn(), records: vi.fn(), batchDelete: vi.fn(), clearImported: vi.fn() },
}))

import SalaryView from '@/views/salary/SalaryView.vue'
import S10View from '@/views/sales-income/S10View.vue'
import UtilitiesView from '@/views/utilities/UtilitiesView.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import UtilitiesTable from '@/views/utilities/UtilitiesTable.vue'
import { salaryApi } from '@/api/salary'
import { s10Api } from '@/api/s10'
import { booksApi } from '@/api/books'
import { utilitiesApi } from '@/api/utilities'

/** 闸道的一行。后端只发**已落库**的三档 —— `entered` 是前端派生的,永远不从这里来。 */
const row = (key: string, status: ReviewStatus, scope: string | null = null): ReviewRow => ({
  key, kind: key.split(':')[0], scope, status,
  submittedBy: 'zhangsan', submittedAt: '2025-07-01T09:00:00',
  reviewedBy: '李审', reviewedAt: '2025-07-02T10:00:00',
  reason: status === 'returned' ? '三期水电重复计了一次' : null, blockedBy: [],
})
const seed = (...rows: ReviewRow[]) => { states.mockResolvedValue(rows) }

type W = VueWrapper<Record<string, unknown>>
/** 年份行标 → 该行 12 张月卡 */
function cellsOf(w: W, year: number) {
  const rows = w.findAll('.bmm-yrow:not(.bmm-addrow)')
  const r = rows.find(x => x.find('.bmm-y').text() === String(year))
  expect(r, `矩阵里没有 ${year} 年那一行`).toBeTruthy()
  return r!.findAll('.bmm-card')
}
/** 一张月卡上的角标档位;没画角标回 null。 */
const badgeOf = (card: { find: (s: string) => { exists(): boolean; classes(): string[] } }) => {
  const el = card.find('.bmm-rv')
  return el.exists() ? (el.classes().find(c => c.startsWith('rv-')) ?? null) : null
}
/** 矩阵纵排了哪几年 */
const yearsOf = (w: W) => w.findAll('.bmm-yrow:not(.bmm-addrow) .bmm-y').map(e => +e.text()).sort()
const askedYears = () => [...new Set(states.mock.calls.map(c => c[0]))].sort()

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  for (const k of Object.keys(query)) delete query[k]
  for (const k of Object.keys(meta)) delete meta[k]
  Element.prototype.scrollIntoView = vi.fn()
  useAuthStore().permissions = ['entry:edit']
  vi.setSystemTime(new Date('2025-07-15T00:00:00'))
  seed()
})

// ───────────────────────────────────────────────────────────────
describe('附表12 · 月卡角标与 reviewKey', () => {
  const OVERVIEW = {
    currentYear: 2025,
    years: [{ year: 2025, hasData: true, months: [1, 2, 3, 4], netTotal: 480000, count: 117 }],
  }
  const ZERO = Object.fromEntries(
    ['base', 'post', 'perf', 'attend', 'skill', 'edu', 'other', 'lunch', 'heat',
      'commission', 'wageTotal', 'gross', 'social', 'tax', 'otherDeduct', 'deduct', 'net'].map(k => [k, 0]))

  beforeEach(() => {
    vi.mocked(salaryApi.overview).mockResolvedValue(OVERVIEW as never)
    vi.mocked(salaryApi.records).mockImplementation((y: number, m: number) =>
      Promise.resolve({ year: y, month: m, rows: [], total: ZERO } as never))
  })
  const open = async (): Promise<W> => {
    const w = mount(SalaryView, { global: { stubs: { Teleport: true } } }) as unknown as W
    await flushPromises()
    return w
  }

  // 破坏验证:把 SalaryView 月格里的 `review: reviewOf(...)` 去掉 → 四条全灭
  it('❗四档各画各的:库里有行按行,没这一行 = 派生「未交审」', async () => {
    seed(row('salary:2025-02', 'submitted'),
         row('salary:2025-03', 'approved'),
         row('salary:2025-04', 'returned'))
    const c = cellsOf(await open(), 2025)
    expect(badgeOf(c[0]), '1 月库里没这一行 —— 后端闸道只发已落库的三档').toBe('rv-entered')
    expect(badgeOf(c[1])).toBe('rv-submitted')
    expect(badgeOf(c[2])).toBe('rv-approved')
    expect(badgeOf(c[3])).toBe('rv-returned')
  })

  // 破坏验证:把 reviewOf 里的 `review.yearLoaded(y) ?` 去掉 → 这条红
  it('❗年还没到手 → 一格都不画,不是先刷一片「未交审」灰点再翻牌', async () => {
    states.mockReturnValue(new Promise(() => {}))     // 闸道恒在途
    const c = cellsOf(await open(), 2025)
    expect(c.map(badgeOf).filter(Boolean), '拿不准就什么都不画(同 blockOf 的口径)').toEqual([])
  })

  // 破坏验证:把 `:review-key` 里的 `${String(month)…}` 换成常量 '06' → 后半条红
  it('❗换月 = 换键:动作簇作用的那一把跟着月胶囊走', async () => {
    const w = await open()
    await cellsOf(w, 2025)[1].trigger('click')        // 进 2 月宽表
    await flushPromises()
    expect(w.findComponent(SchedHeader).props('reviewKey')).toBe('salary:2025-02')

    await w.findAll('.lc-mpill').find(b => b.text() === '4月')!.trigger('click')
    await flushPromises()
    expect(w.findComponent(SchedHeader).props('reviewKey'), '换了月没换键 = 在 4 月屏上交了 2 月的审')
      .toBe('salary:2025-04')
  })

  // 破坏验证:删掉 SalaryView 那条 watch(matrixYears → ensureYear) → 这条红(矩阵态零请求)
  it('矩阵态要为纵排的每一年各取一趟闸道 —— 改前这一屏一个审核请求都不发', async () => {
    const w = await open()
    expect(askedYears()).toEqual(yearsOf(w))
    expect(askedYears().length, '至少取了一年').toBeGreaterThan(0)
  })
})

// ───────────────────────────────────────────────────────────────
describe('附表10 · 期区维的角标与 reviewKey', () => {
  const def: BookDef = {
    groups: [{ id: 'g1', label: '租金', cols: [
      { id: 'factoryRent', std: true, label: '厂房租金', aliases: [], slot: 'rent', hidden: false, w: null },
    ] }],
  }
  const book1: Book = { id: 7, screen: 's10', companyId: null, phase: 1, name: '一期', ver: 3, latestVer: 3, definition: def }
  const book3: Book = { ...book1, id: 9, phase: 3, name: '三期' }
  const rec = { id: 11, tenantId: 11, tenantName: '甲户', phase: 1, profile: 'factory', note: null,
                source: 'manual', total: 0, extraFees: {} } as unknown as S10RecordDTO
  const monthOf = (phase: number, year: number, month: number): S10MonthDTO => ({
    phase, year, month, recorded: true, rows: [{ ...rec, phase }], columnTotals: {}, grandTotal: 0, archivedCols: [],
  })
  const overview: S10OverviewDTO = {
    years: [2025], currentYear: 2025, currentMonth: 4,
    summaries: [{ year: 2025, recordedMonths: 4, tenantCount: 1 }],
  }

  beforeEach(() => {
    vi.mocked(s10Api.getOverview).mockResolvedValue(overview)
    vi.mocked(s10Api.getMonth).mockImplementation((p: number, y: number, m: number) => Promise.resolve(monthOf(p, y, m)))
    vi.mocked(booksApi.list).mockResolvedValue([book1, book3])
    vi.mocked(booksApi.templateAt).mockImplementation((id: number) => Promise.resolve(id === 9 ? book3 : book1))
  })
  const open = async (): Promise<W> => {
    const w = mount(S10View, { global: { stubs: { Teleport: true } } }) as unknown as W
    await flushPromises()
    return w
  }
  const pickBook = async (w: W, name: string) => {
    await w.findAll('.br-item').find(b => b.text().includes(name))!.trigger('click')
    await flushPromises()
  }

  // 破坏验证:把 reviewOf 里的 `${phase.value}` 写死成 1 → 这条红(切到三期还画着一期的态)
  it('❗一格一把键、键带期区:切册整片换键,同一个月两册可以是两种态', async () => {
    seed(row('s10:1:2025-02', 'approved'), row('s10:3:2025-02', 'returned'))
    const w = await open()
    expect(badgeOf(cellsOf(w, 2025)[1]), '一期 2 月已审核').toBe('rv-approved')

    await pickBook(w, '三期')
    expect(badgeOf(cellsOf(w, 2025)[1]), '三期 2 月是被退回的 —— 切册没换键就会画成已审核').toBe('rv-returned')
  })

  // 破坏验证:把 `:review-key` 里的 `${phase}` 换成常量 1 → 后半条红
  it('❗reviewKey 带 (期区, 月) 两维,换哪一维都要跟着变', async () => {
    const w = await open()
    await cellsOf(w, 2025)[1].trigger('click')
    await flushPromises()
    expect(w.findComponent(SchedHeader).props('reviewKey')).toBe('s10:1:2025-02')

    await pickBook(w, '三期')                          // selectBook 末行 goGate,回矩阵
    await cellsOf(w, 2025)[2].trigger('click')         // 三期 3 月
    await flushPromises()
    expect(w.findComponent(SchedHeader).props('reviewKey'), '在三期屏上交了一期的审')
      .toBe('s10:3:2025-03')
  })
})

// ───────────────────────────────────────────────────────────────
describe('附13/14 · 切 tab = 换 scope', () => {
  const TOTAL = { elecQty: 0, elecAmt: 0, waterQty: 0, waterAmt: 0, total: 0 }
  beforeEach(() => {
    vi.mocked(utilitiesApi.overview).mockResolvedValue(
      { currentYear: 2025, years: [{ year: 2025, hasData: true, totalFee: 0, count: 1 }] } as never)
    vi.mocked(utilitiesApi.records).mockImplementation((no: number, y: number) =>
      Promise.resolve({ year: y, scheduleNo: no, rows: [], total: TOTAL } as never))
  })

  // 破坏验证:把 useSchedScreen 里那个 reviewScope 闭包换成常量 'office' → 后半条红
  //          (三期屏读到办公的锁月:人在没审的月上改不了、在审过的月上反而能改)
  it('❗办公与三期是同一把 kind 的两个 scope:切 tab 后锁月跟着换', async () => {
    seed(row('utilities:office:2025-02', 'approved', 'office'),
         row('utilities:phase3:2025-05', 'approved', 'phase3'))
    const w = mount(UtilitiesView, { global: { stubs: { Teleport: true } } }) as unknown as W
    await flushPromises()
    await w.find('.sm-ycard').trigger('click')        // 进 2025 年表
    await flushPromises()

    const locked = () => [...(w.findComponent(UtilitiesTable).props('lockedMonths') as Set<number>)]
    expect(locked(), '办公:只有 2 月审过').toEqual([2])

    await w.findAll('.ut-seg2-b').find(b => b.text().includes('三期'))!.trigger('click')
    await flushPromises()
    expect(locked(), '三期:只有 5 月审过 —— 不换 scope 就会拿办公的锁月去挡三期的行').toEqual([5])
  })
})
