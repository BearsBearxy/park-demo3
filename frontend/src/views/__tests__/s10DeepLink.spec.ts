// src/views/__tests__/s10DeepLink.spec.ts — 附表10 消费期间深链(SIDEBAR-UX-REDESIGN §4.2「附10 co = 期区 1..4」/ §9 P0b 破坏验证「chip 深链不撞 goGate」)。
// 期区直写 activeBookId,不经 selectBook —— 它在表格态末行 goGate 把人推回矩阵;templateAt 只按目标册取一次(ensureLoaded 那拍 year 仍 null,watch 早退)。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import type { Book, BookDef } from '@/types/book'
import type { S10MonthDTO, S10RecordDTO, S10OverviewDTO } from '@/types/s10'

const s10Def: BookDef = {
  groups: [{ id: 'g1', label: '租金', cols: [
    { id: 'factoryRent', std: true, label: '厂房租金', aliases: [], slot: 'rent', hidden: false, w: null },
  ] }],
}
const book1: Book = { id: 7, screen: 's10', companyId: null, phase: 1, name: '一期', ver: 3, latestVer: 3, definition: s10Def }
const book3: Book = { ...book1, id: 9, phase: 3, name: '三期' }
const row = {
  id: 11, tenantId: 11, tenantName: '甲户', phase: 1, profile: 'factory', note: null,
  source: 'manual', total: 0, extraFees: {},
} as unknown as S10RecordDTO
const monthOf = (phase: number, year: number, month: number): S10MonthDTO => ({
  phase, year, month, recorded: true, rows: [{ ...row, phase }], columnTotals: {}, grandTotal: 0, archivedCols: [],
})
const overview: S10OverviewDTO = {
  years: [2026], currentYear: 2026, currentMonth: 9,
  summaries: [{ year: 2026, recordedMonths: 9, tenantCount: 1 }],
}

const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, get fullPath() { return '/sales-income?' + new URLSearchParams(query).toString() } }),
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
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))

import S10View from '@/views/sales-income/S10View.vue'
import S10Table from '@/views/sales-income/S10Table.vue'
import { s10Api } from '@/api/s10'
import { booksApi } from '@/api/books'

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['entry:edit']
  vi.clearAllMocks()
  for (const k of Object.keys(query)) delete query[k]
  // ?tenant= 命中行会 scrollIntoView,jsdom 没实现(既有两份 spec 的 tenant 都是空串,没踩到)
  Element.prototype.scrollIntoView = vi.fn()
  vi.mocked(s10Api.getOverview).mockResolvedValue(overview)
  vi.mocked(s10Api.getMonth).mockImplementation((p: number, y: number, m: number) => Promise.resolve(monthOf(p, y, m)))
  vi.mocked(booksApi.list).mockResolvedValue([book1, book3])
  vi.mocked(booksApi.templateAt).mockImplementation((id: number) => Promise.resolve(id === 9 ? book3 : book1))
})

async function open() {
  const w = mount(S10View, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}
/** 把屏包进 KeepAlive,alive 开关模拟切走 / 切回。 */
async function keptAlive() {
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(S10View) : null) }),
  }), { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return { w, alive }
}
interface Vm { dirty: Set<number>; monthData: S10MonthDTO | null; onCell: (r: S10RecordDTO, c: string, v: number) => void; focusTenant: string; year: number | null }

describe('附表10 · 期间深链', () => {
  it('❗co=3 直落三期账册该月:矩阵不出现、月表只拉一次且是 (3, 2026, 9)、模板只取一次 —— 不撞 selectBook → goGate', async () => {
    // 红线①:applyDeep 写成「先 pickCell 再 selectBook(b.id)」→ selectBook 末行 goGate 把 year 打回 null,.s10-gate 出现;
    // 红线②:册 / 月 / 年分两拍写(中间 await)→ templateAt 跑两次;
    // 红线③:useDeepPeriod 整段删掉 → 落回矩阵
    query.p = '2026-09'; query.co = '3'
    const w = await open()
    expect(w.find('.s10-gate').exists(), '门该被深链跳过').toBe(false)
    expect(w.find('.s10-page').exists()).toBe(true)
    expect(w.find('.s10-period-book').text()).toContain('三期')
    expect(s10Api.getMonth).toHaveBeenCalledWith(3, 2026, 9)
    expect(s10Api.getMonth).toHaveBeenCalledTimes(1)
    expect(booksApi.templateAt).toHaveBeenCalledWith(9, 2026, 9)
    expect(booksApi.templateAt, '册 / 月 / 年同一拍连写,watch 只跑一次').toHaveBeenCalledTimes(1)
    expect(s10Api.getOverview, 'overview 只拉一次(onMounted 与 apply 共用 ensureLoaded)').toHaveBeenCalledTimes(1)
    expect(booksApi.list).toHaveBeenCalledTimes(1)
  })

  it('旧链 ?y&m&phase=3&tenant= 照认(发链侧 P0c 已迁 periodLink;解析侧永远认旧格式 —— 地址栏里已存在的旧书签仍须落得到)', async () => {
    query.y = '2026'; query.m = '9'; query.phase = '3'; query.tenant = '甲户'
    const w = await open()
    expect(s10Api.getMonth).toHaveBeenCalledWith(3, 2026, 9)
    // focusTenant 是一次性的:表渲染完就 emit focusDone、父层随即清空,所以钉「送到表里了」而不是钉父层的 ref(计划复查 P0B-2)
    expect(w.findComponent(S10Table).emitted('focusDone'), '旧链的 ?tenant= 送到表里了').toBeTruthy()
  })

  it('只有年的链接不动 —— 本屏只认整月', async () => {
    query.p = '2026'
    const w = await open()
    expect(w.find('.s10-gate').exists()).toBe(true)
    expect(s10Api.getMonth).not.toHaveBeenCalled()
  })

  it('❗切页签回来重读:总览与本月都重拉(spec §12)', async () => {
    // 红线:S10View.vue 新加的 onReactivated 删掉 → 切回零请求
    query.p = '2026-09'; query.co = '3'
    const { alive } = await keptAlive()
    vi.mocked(s10Api.getOverview).mockClear()
    vi.mocked(s10Api.getMonth).mockClear()
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(s10Api.getOverview).toHaveBeenCalledTimes(1)
    expect(s10Api.getMonth).toHaveBeenCalledWith(3, 2026, 9)
  })

  it('❗有未保存改动时切回、地址栏换了月 → 期不动、草稿不被冲掉(重读也不拉本月),deepNote 说清楚', async () => {
    // 红线①:dirty 探针改成 () => 0 → 期被切到 2026-10,loadMonth 顺手 dirty.clear();
    // 红线②:onReactivated 里的 dirty.size === 0 门删掉 → 重读 loadMonth 把草稿冲掉
    query.p = '2026-09'; query.co = '3'
    const { w, alive } = await keptAlive()
    const vm = w.findComponent(S10View).vm as unknown as Vm
    vm.onCell(vm.monthData!.rows[0], 'factoryRent', 5)
    await flushPromises()
    expect(vm.dirty.size, '前提:真的算脏了').toBe(1)
    vi.mocked(s10Api.getMonth).mockClear()
    alive.value = false; await flushPromises()
    query.p = '2026-10'
    alive.value = true; await flushPromises()
    expect(s10Api.getMonth, '有草稿 → 不切期、不重读本月').not.toHaveBeenCalled()
    expect(vm.dirty.size).toBe(1)
    expect(w.find('.fpt--warning').text()).toContain('地址栏要求 2026-10 期，本期有 1 处未保存')
  })

  it('链接指名的期区不存在 → 不落错册:停在矩阵,不拉月表', async () => {
    // 红线:applyDeep 里 `if (t.co != null && !b) return` 删掉 → 落到一期册的 2026-09,getMonth(1, 2026, 9)
    query.p = '2026-09'; query.co = '2'
    const w = await open()
    expect(w.find('.s10-gate').exists()).toBe(true)
    expect(s10Api.getMonth).not.toHaveBeenCalled()
  })
})
