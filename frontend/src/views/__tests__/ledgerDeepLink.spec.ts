// src/views/__tests__/ledgerDeepLink.spec.ts — 台账消费期间深链(SIDEBAR-UX-REDESIGN §4.2「台账 co 落 activeBookId + year/month 直落宽表」)。
// apply 是异步的(setup 期 books / companies 还没到,先等 ensureLoaded);co 数字按公司 id、字符串按旧公司名,没给 co 落当前册 / 首册。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import type { Book } from '@/types/book'
import type { LedgerMonthDTO, LedgerRowDTO } from '@/types/ledger'
import { FEE_KEYS } from '@/utils/ledgerColumns'

const def: Book['definition'] = { groups: [{ id: 'g1', label: '租金', cols: [
  { id: 'factoryRent', std: true, label: '厂房租金', aliases: [], slot: 'rent', hidden: false, w: 96 },
] }] }
const bookA: Book = { id: 1, screen: 'ledger', companyId: 9, phase: null, name: '甲公司', ver: 1, latestVer: 1, definition: def }
const bookB: Book = { ...bookA, id: 2, companyId: 12, name: '乙公司' }
const bookC: Book = { ...bookA, id: 3, companyId: 15, name: '丙册' }   // 公司名单里没有「丙册」:钉「公司名认不到再按册名」那半条
const zeroFees = () => Object.fromEntries(FEE_KEYS.map(k => [k, 0])) as Record<string, number>
const rowOf = (name: string) => ({
  ...zeroFees(), id: 5, tenantId: 5, tenantName: name, balancePrev: 0, totalCollected: 0,
  note: null, totalReceivable: 0, balanceEnd: 0,
} as unknown as LedgerRowDTO)
const monthOf = (companyName: string, year: number, month: number): LedgerMonthDTO => ({
  companyName, year, month, prevMonth: month - 1, rows: [rowOf('甲户')],
  footer: { ...zeroFees(), balancePrev: 0, totalReceivable: 0, totalCollected: 0, balanceEnd: 0 } as LedgerMonthDTO['footer'],
  archivedCols: [],
})

const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, get fullPath() { return '/ledger?' + new URLSearchParams(query).toString() } }),
}))
vi.mock('@/api/books', () => ({ booksApi: { list: vi.fn(), templateAt: vi.fn() } }))
vi.mock('@/api/ledger', () => ({
  companyApi: { list: vi.fn() },
  ledgerApi: { years: vi.fn(), overview: vi.fn(), month: vi.fn() },
}))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: () => Promise.resolve([]) } }))
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))

import LedgerView from '@/views/ledger/LedgerView.vue'
import LedgerWideTable from '@/views/ledger/LedgerWideTable.vue'
import BookMonthMatrix from '@/components/fp/BookMonthMatrix.vue'
import { booksApi } from '@/api/books'
import { ledgerApi, companyApi } from '@/api/ledger'

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['entry:edit']
  vi.clearAllMocks()
  for (const k of Object.keys(query)) delete query[k]
  // ?tenant= 命中行会 scrollIntoView,jsdom 没实现(既有两份 spec 的 tenant 都是空串,没踩到)
  Element.prototype.scrollIntoView = vi.fn()
  vi.mocked(booksApi.list).mockResolvedValue([bookA, bookB, bookC])
  vi.mocked(booksApi.templateAt).mockImplementation((id: number) => Promise.resolve(id === 2 ? bookB : id === 3 ? bookC : bookA))
  vi.mocked(companyApi.list).mockResolvedValue([
    { id: 9, name: '甲公司', short: '甲', sortNo: 1 }, { id: 12, name: '乙公司', short: '乙', sortNo: 2 },
  ])
  vi.mocked(ledgerApi.years).mockResolvedValue([])
  vi.mocked(ledgerApi.overview).mockImplementation((_c: number, y: number) => Promise.resolve({
    companyName: '', year: y, monthsWithData: 0, ytdRecv: 0, avgRecv: 0, activeTenants: 0, months: [],
  } as never))
  vi.mocked(ledgerApi.month).mockImplementation((c: number, y: number, m: number) =>
    Promise.resolve(monthOf(c === 12 ? '乙公司' : '甲公司', y, m)))
})

async function open() {
  const w = mount(LedgerView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}
/** 把屏包进 KeepAlive,alive 开关模拟切走 / 切回(照 ledgerLeaveAndReturn.spec:80)。 */
async function keptAlive() {
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(LedgerView) : null) }),
  }), { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return { w, alive }
}
interface Vm { edit: boolean; month: number | null; draft: LedgerRowDTO[]; focusTenant: string; enterEdit: () => void; activeBookId: number | null }

describe('月度台账 · 期间深链', () => {
  it('❗p + co(公司 id) 直落该册该月宽表:矩阵不出现,月表只拉一次且是 (12, 2026, 9),模板只取一次', async () => {
    // 红线:useDeepPeriod 整段删掉 → 停在选册占位。「册 / 年 / 月同一拍连写」由用例 8 钉 —— 首载从 null 起步时中间那拍 loadMonthBook 因 m == null 早退,这里钉不住
    query.p = '2026-09'; query.co = '12'
    const w = await open()
    expect(w.findComponent(LedgerWideTable).exists(), '直落宽表').toBe(true)
    expect(w.findComponent(BookMonthMatrix).exists(), '矩阵该被深链跳过').toBe(false)
    expect(ledgerApi.month).toHaveBeenCalledWith(12, 2026, 9)
    expect(ledgerApi.month).toHaveBeenCalledTimes(1)
    expect(booksApi.templateAt).toHaveBeenCalledWith(2, 2026, 9)
    expect(booksApi.templateAt).toHaveBeenCalledTimes(1)
    expect(booksApi.list, 'books 只拉一次(onMounted 与 apply 共用 ensureLoaded)').toHaveBeenCalledTimes(1)
  })

  it('旧链 ?y&m&company=<公司名>&tenant= 照认(发链侧 P0c 已迁 periodLink;解析侧永远认旧格式 —— 地址栏里已存在的旧书签仍须落得到) —— 用非首册那家,首册兜底混不进来', async () => {
    // 红线:bookOf 的字符串分支(公司名 → companyId → 册)整段删掉 → 落首册 → 拉到 (9, …) 而不是 (12, …)
    query.y = '2026'; query.m = '9'; query.company = '乙公司'; query.tenant = '甲户'
    const w = await open()
    expect(ledgerApi.month).toHaveBeenCalledWith(12, 2026, 9)
    // focusTenant 是一次性的:表渲染完就 emit focus-done、父层随即清空,所以钉「送到表里了」而不是钉父层的 ref(计划复查 P0B-2)
    expect(w.findComponent(LedgerWideTable).emitted('focus-done'), '旧链的 ?tenant= 送到表里了').toBeTruthy()
  })

  it('旧链 company 认不到公司名时按册名兜底(册名 ≠ 公司名的那本)', async () => {
    // 红线:bookOf 里 `books.value.find(b => b.name === co)` 那半条删掉 → 认不出 → 停在选册占位,month 不被调
    query.y = '2026'; query.m = '9'; query.company = '丙册'
    await open()
    expect(ledgerApi.month).toHaveBeenCalledWith(15, 2026, 9)
  })

  it('没给 co 落首册 —— 首页台账行本期不带公司(公司 chips 是 P2 的事)', async () => {
    // 红线:bookOf(null) 返回 null → 停在选册占位,首页那一击白点
    query.p = '2026-09'
    await open()
    expect(ledgerApi.month).toHaveBeenCalledWith(9, 2026, 9)
  })

  it('co 认不出 / 只有年 → 不动,停在选册占位', async () => {
    query.p = '2026-09'; query.co = '99'
    const w = await open()
    expect(w.findComponent(LedgerWideTable).exists()).toBe(false)
    expect(ledgerApi.month).not.toHaveBeenCalled()
    delete query.co; query.p = '2026'
    const w2 = await open()
    expect(w2.findComponent(LedgerWideTable).exists()).toBe(false)
    expect(ledgerApi.month).not.toHaveBeenCalled()
  })

  it('❗编辑态有改动时切回、地址栏换了月 → 期不动、草稿还在、编辑态不退,deepNote 说清楚', async () => {
    // 红线:dirty 探针改成 () => 0 → cancelEdit 把 draft 清了,期切到 2026-10
    query.p = '2026-09'; query.co = '12'
    const { w, alive } = await keptAlive()
    const vm = w.findComponent(LedgerView).vm as unknown as Vm
    vm.enterEdit()
    await flushPromises()
    ;(vm.draft[0] as unknown as Record<string, unknown>).factoryRent = 1
    await flushPromises()
    vi.mocked(ledgerApi.month).mockClear()
    alive.value = false; await flushPromises()
    query.p = '2026-10'
    alive.value = true; await flushPromises()
    expect(ledgerApi.month, '有草稿 → 不切期,编辑态也不重读').not.toHaveBeenCalled()
    expect(vm.month).toBe(9)
    expect(vm.edit).toBe(true)
    expect(w.find('.fpt--warning').text()).toContain('地址栏要求 2026-10 期，本期有 1 处未保存')
  })

  it('编辑态但没改动时切回换月 → 先退编辑态再换期(锁经 LedgerWideTable 的 watch(edit) 归还)', async () => {
    // 红线:applyDeep 里的 `if (edit.value) cancelEdit()` 删掉 → 新月的表挂在旧月的编辑态上,lockScope 换了键旧锁没人还
    query.p = '2026-09'; query.co = '12'
    const { w, alive } = await keptAlive()
    const vm = w.findComponent(LedgerView).vm as unknown as Vm
    vm.enterEdit()
    await flushPromises()
    alive.value = false; await flushPromises()
    query.p = '2026-10'
    alive.value = true; await flushPromises()
    expect(vm.edit).toBe(false)
    expect(vm.month).toBe(10)
    expect(ledgerApi.month).toHaveBeenCalledWith(12, 2026, 10)
  })

  it('❗切页签回来重读本月(spec §12 同款):浏览态重拉,编辑态不动', async () => {
    // 红线:LedgerView.vue 新加的第二个 onReactivated 删掉 → 浏览态切回零请求(既有那个只恢复抽屉)
    query.p = '2026-09'; query.co = '12'
    const { w, alive } = await keptAlive()
    const vm = w.findComponent(LedgerView).vm as unknown as Vm
    vi.mocked(ledgerApi.month).mockClear()
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(ledgerApi.month).toHaveBeenCalledWith(12, 2026, 9)
    expect(ledgerApi.month).toHaveBeenCalledTimes(1)
    vm.enterEdit()
    await flushPromises()
    vi.mocked(ledgerApi.month).mockClear()
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(ledgerApi.month, '编辑态不重读:换了快照会把 draft 判脏').not.toHaveBeenCalled()
  })

  it('❗浏览态切回换年:册 / 年 / 月同一拍连写 → 模板只取一次且是新年月', async () => {
    // 红线:applyDeep 里 year 与 month 之间夹一个 await(分两拍写)→ watch 先按 (2, 2025, 9) 取一次模板,再按 (2, 2025, 3) 取 → 两次
    query.p = '2026-09'; query.co = '12'
    const { alive } = await keptAlive()
    vi.mocked(booksApi.templateAt).mockClear()
    vi.mocked(ledgerApi.month).mockClear()
    alive.value = false; await flushPromises()
    query.p = '2025-03'
    alive.value = true; await flushPromises()
    expect(booksApi.templateAt).toHaveBeenCalledWith(2, 2025, 3)
    expect(booksApi.templateAt, '同一拍连写,watch 只跑一次').toHaveBeenCalledTimes(1)
    expect(ledgerApi.month, '重读那趟按旧月先发,新月那趟最后发 —— seq 守卫以它为准').toHaveBeenLastCalledWith(12, 2025, 3)
  })
})
