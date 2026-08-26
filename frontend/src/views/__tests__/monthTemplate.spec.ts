// 按月取模板的两个窗口(spec P2/P3,计划 Task 6 Step 4 的宿主接线)。两屏各钉两条:
//
//  · 同册切月:新月份的 templateAt 还在路上时,屏上**不许**还挂着上个月那版模板 ——
//    宿主的 book/activeBook 是 computed(矩阵态没有月份,要回退到册清单那行),
//    回退条件只比册 id 的话,同册切月就出现一个「显示上月版本」的陈旧窗口。
//  · templateAt 失败:不许静默停在旧月份那一版。列退回链尾版(册清单那行)并且要出声 ——
//    否则界面无任何提示,只有列与后端下发的 archivedCols 对不上。
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import LedgerView from '@/views/ledger/LedgerView.vue'
import LedgerWideTable from '@/views/ledger/LedgerWideTable.vue'
import S10View from '@/views/sales-income/S10View.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import BookMonthMatrix from '@/components/fp/BookMonthMatrix.vue'
import { booksApi } from '@/api/books'
import type { Book, BookDef } from '@/types/book'
import type { LedgerMonthDTO, LedgerRowDTO } from '@/types/ledger'
import type { S10MonthDTO, S10RecordDTO, S10OverviewDTO } from '@/types/s10'
import { FEE_KEYS } from '@/utils/ledgerColumns'

// ── 夹具:链尾版与各月版本各带一个专属列名,断言直接看表头上是哪一版 ──
const defWith = (id: string, label: string): BookDef => ({
  groups: [{
    id: 'g1', label: '租金', cols: [
      { id: 'factoryRent', std: true, label: '厂房租金', aliases: [], slot: 'rent', hidden: false, w: 96 },
      { id, std: false, label, aliases: [], slot: 'other', hidden: false, w: null },
    ],
  }],
})

const ledgerTip: Book = {
  id: 1, screen: 'ledger', companyId: 9, phase: null, name: '甲公司',
  ver: 5, latestVer: 5, definition: defWith('c_tip', '链尾列'),
}
const ledgerSep: Book = { ...ledgerTip, ver: 3, definition: defWith('c_sep', '九月列') }
const ledgerOct: Book = { ...ledgerTip, ver: 4, definition: defWith('c_oct', '十月列') }

const s10Tip: Book = {
  id: 7, screen: 's10', companyId: null, phase: 1, name: '一期',
  ver: 5, latestVer: 5, definition: defWith('c_tip', '链尾列'),
}
const s10Sep: Book = { ...s10Tip, ver: 3, definition: defWith('c_sep', '九月列') }
const s10Oct: Book = { ...s10Tip, ver: 4, definition: defWith('c_oct', '十月列') }

const zeroFees = () => Object.fromEntries(FEE_KEYS.map(k => [k, 0])) as Record<string, number>
const ledgerRow = {
  ...zeroFees(), id: 5, tenantId: 5, tenantName: '甲户', balancePrev: 0, totalCollected: 0,
  note: null, totalReceivable: 0, balanceEnd: 0,
} as unknown as LedgerRowDTO
const ledgerMonth = (year: number, month: number): LedgerMonthDTO => ({
  companyName: '甲公司', year, month, prevMonth: month - 1, rows: [ledgerRow],
  footer: { ...zeroFees(), balancePrev: 0, totalReceivable: 0, totalCollected: 0, balanceEnd: 0 } as LedgerMonthDTO['footer'],
  archivedCols: [],
})

const s10Row = {
  id: 11, tenantId: 11, tenantName: '甲户', phase: 1, profile: 'factory', note: null,
  source: 'manual', total: 0, extraFees: {},
} as unknown as S10RecordDTO
const s10Month = (year: number, month: number): S10MonthDTO => ({
  phase: 1, year, month, recorded: true, rows: [s10Row], columnTotals: {}, grandTotal: 0, archivedCols: [],
})
const s10Overview: S10OverviewDTO = {
  years: [2026], currentYear: 2026, currentMonth: 9,
  summaries: [{ year: 2026, recordedMonths: 9, tenantCount: 1 }],
}

vi.mock('@/api/books', () => ({
  booksApi: { list: vi.fn(), templateAt: vi.fn(), versions: vi.fn(), pin: vi.fn(), saveTemplate: vi.fn() },
}))
vi.mock('@/api/ledger', () => ({
  companyApi: { list: () => Promise.resolve([{ id: 9, name: '甲公司' }]) },
  ledgerApi: {
    years: () => Promise.resolve([{ year: 2026, months: 1 }]),
    overview: (_c: number, y: number) => Promise.resolve({
      companyName: '甲公司', year: y, monthsWithData: 1, ytdRecv: 0, avgRecv: 0, activeTenants: 1, months: [],
    }),
    month: (_c: number, y: number, m: number) => Promise.resolve(ledgerMonth(y, m)),
  },
}))
vi.mock('@/api/s10', () => ({
  s10Api: {
    getOverview: () => Promise.resolve(s10Overview),
    getMonth: (_p: number, y: number, m: number) => Promise.resolve(s10Month(y, m)),
    batchDelete: () => Promise.resolve({ deleted: 0 }),
    clearImported: () => Promise.resolve({ deleted: 0 }),
  },
}))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: () => Promise.resolve([]) } }))
// 深链直落 2026-09 表格态(两屏共用一份 query:台账读 company,附表10 读 phase)
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { y: '2026', m: '9', company: '甲公司', phase: '1', tenant: '' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

/** 手动兑现的 promise:模拟「请求还在路上」的那一帧。 */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

const heads = (w: { findAll: (s: string) => { text: () => string }[] }) =>
  w.findAll('thead th').map(t => t.text())

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['entry:edit']
  vi.mocked(booksApi.list).mockImplementation((screen: string) =>
    Promise.resolve(screen === 's10' ? [s10Tip] : [ledgerTip]))
  vi.mocked(booksApi.templateAt).mockReset()
})

describe('按月取模板 · 台账', () => {
  it('切到十月:九月那版不许在请求在途时继续挂着,回来后换成十月那版', async () => {
    vi.mocked(booksApi.templateAt).mockResolvedValueOnce(ledgerSep)
    const w = mount(LedgerView)
    await flushPromises()
    expect(heads(w)).toContain('九月列')

    const oct = deferred<Book>()
    vi.mocked(booksApi.templateAt).mockReturnValueOnce(oct.promise)
    w.findComponent(LedgerWideTable).vm.$emit('back')          // 换期 → 矩阵态
    await flushPromises()
    w.findComponent(BookMonthMatrix).vm.$emit('pick', 2026, 10) // 点十月卡
    await flushPromises()
    expect(heads(w)).not.toContain('九月列')                    // 陈旧窗口
    expect(heads(w)).toContain('链尾列')                        // 在途期间退回册清单那行

    oct.resolve(ledgerOct)
    await flushPromises()
    expect(heads(w)).toContain('十月列')
    w.unmount()
  })

  it('templateAt 挂了:不静默 —— 列退回链尾版并提示', async () => {
    vi.mocked(booksApi.templateAt).mockResolvedValueOnce(ledgerSep)
    const w = mount(LedgerView)
    await flushPromises()

    vi.mocked(booksApi.templateAt).mockRejectedValueOnce(new Error('网络挂了'))
    w.findComponent(LedgerWideTable).vm.$emit('back')
    await flushPromises()
    w.findComponent(BookMonthMatrix).vm.$emit('pick', 2026, 10)
    await flushPromises()

    expect(heads(w)).not.toContain('九月列')
    expect(w.text()).toContain('模板版本')   // FPToast 里的那句
    w.unmount()
  })
})

describe('按月取模板 · 附表10', () => {
  it('切到十月:九月那版不许在请求在途时继续挂着,回来后换成十月那版', async () => {
    vi.mocked(booksApi.templateAt).mockResolvedValueOnce(s10Sep)
    const w = mount(S10View)
    await flushPromises()
    expect(heads(w)).toContain('九月列')

    const oct = deferred<Book>()
    vi.mocked(booksApi.templateAt).mockReturnValueOnce(oct.promise)
    w.findComponent(SchedHeader).vm.$emit('back')                // 换期 → 矩阵态
    await flushPromises()
    w.findComponent(BookMonthMatrix).vm.$emit('pick', 2026, 10)
    await flushPromises()
    expect(heads(w)).not.toContain('九月列')
    expect(heads(w)).toContain('链尾列')

    oct.resolve(s10Oct)
    await flushPromises()
    expect(heads(w)).toContain('十月列')
    w.unmount()
  })

  it('templateAt 挂了:不静默 —— 列退回链尾版并提示(本屏报错口径是 alert)', async () => {
    const alerted = vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.mocked(booksApi.templateAt).mockResolvedValueOnce(s10Sep)
    const w = mount(S10View)
    await flushPromises()

    vi.mocked(booksApi.templateAt).mockRejectedValueOnce(new Error('网络挂了'))
    w.findComponent(SchedHeader).vm.$emit('back')
    await flushPromises()
    w.findComponent(BookMonthMatrix).vm.$emit('pick', 2026, 10)
    await flushPromises()

    expect(heads(w)).not.toContain('九月列')
    expect(alerted).toHaveBeenCalled()
    alerted.mockRestore()
    w.unmount()
  })
})
