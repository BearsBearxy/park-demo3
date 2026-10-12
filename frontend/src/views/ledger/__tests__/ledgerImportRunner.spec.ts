/* Copyright (c) 2026 Junyang. All rights reserved. */
// 月度台账 · 导入点下去之后(画布 11 ImportOne / ImportDone / ImportFail;UI-OVERLAY-SPEC §8):
// 弹窗不关,内容区换进度卡,写完原地出结果卡;失败交给弹窗的失败卡(不走回执)。
// 年月与覆盖两道预检在弹窗核对页(md-v2-ledger,registry 的 precheck):月份对不上二选一才能导,本月已有的写会盖掉几家。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import type { Book } from '@/types/book'
import type { LedgerMonthDTO, LedgerRowDTO } from '@/types/ledger'
import { FEE_KEYS } from '@/utils/ledgerColumns'

const def: Book['definition'] = { groups: [{ id: 'g1', label: '租金', cols: [
  { id: 'factoryRent', std: true, label: '厂房租金', aliases: [], slot: 'rent', hidden: false, w: 96 },
] }] }
const bookA: Book = { id: 1, screen: 'ledger', companyId: 9, phase: null, name: '甲公司', ver: 1, latestVer: 1, definition: def }
const zeroFees = () => Object.fromEntries(FEE_KEYS.map(k => [k, 0])) as Record<string, number>
const rowOf = (name: string) => ({
  ...zeroFees(), id: 5, tenantId: 5, tenantName: name, balancePrev: 0, totalCollected: 0,
  note: null, totalReceivable: 0, balanceEnd: 0,
} as unknown as LedgerRowDTO)
const monthOf = (year: number, month: number): LedgerMonthDTO => ({
  companyName: '甲公司', year, month, prevMonth: month - 1, rows: [rowOf('甲户')],
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
vi.mock('@/utils/importRegistry', async (orig) => ({ ...(await orig<object>()), runImport: vi.fn() }))

import LedgerView from '@/views/ledger/LedgerView.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import { booksApi } from '@/api/books'
import { ledgerApi, companyApi } from '@/api/ledger'
import { runImport } from '@/utils/importRegistry'
import { askQueue } from '@/utils/ask'
import { receipts } from '@/utils/receipt'

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['ledger:edit']
  vi.clearAllMocks()
  vi.mocked(runImport).mockReset()
  askQueue.splice(0)
  receipts.splice(0)
  for (const k of Object.keys(query)) delete query[k]
  Element.prototype.scrollIntoView = vi.fn()
  vi.mocked(booksApi.list).mockResolvedValue([bookA])
  vi.mocked(booksApi.templateAt).mockResolvedValue(bookA)
  vi.mocked(companyApi.list).mockResolvedValue([{ id: 9, name: '甲公司', short: '甲', sortNo: 1 }])
  vi.mocked(ledgerApi.years).mockResolvedValue([])
  vi.mocked(ledgerApi.overview).mockImplementation((_c: number, y: number) => Promise.resolve({
    companyName: '', year: y, monthsWithData: 0, ytdRecv: 0, avgRecv: 0, activeTenants: 0, months: [],
  } as never))
  vi.mocked(ledgerApi.month).mockImplementation((_c: number, y: number, m: number) => Promise.resolve(monthOf(y, m)))
})

/** 深链直落甲公司 2026-09 宽表,再打开导入弹窗 */
async function openImport() {
  query.p = '2026-09'; query.co = '9'
  const w = mount(LedgerView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  ;(w.vm as unknown as { importing: boolean }).importing = true
  await flushPromises()
  return w
}
type ModalVm = { onSectionsConfirm: (p: unknown[]) => void }

describe('月度台账 · 导入走弹窗的 runner', () => {
  // 破坏验证:FpImportModal 换回 @import / @import-sections(不给 :runner)→ runImport 一次都不调 / 弹窗当场关 → 红;
  //          settle 的刷新不调 loadMonth → 「写完重读本月」红
  it('❗点导入后弹窗不关;写完重读本月,弹窗里原地出结果卡', async () => {
    let done!: (v: unknown) => void
    vi.mocked(runImport).mockReturnValueOnce(new Promise(r => { done = r }) as never)
    const w = await openImport()
    ;(w.findComponent(FpImportModal).vm as unknown as ModalVm).onSectionsConfirm([{ year: 2026, month: 9, records: [{ tenantName: '乙户' }] }])
    await flushPromises()
    expect(runImport).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runImport).mock.calls[0][2]).toMatchObject({ companyId: 9, year: 2026, month: 9 })
    expect(w.find('.fpimp-scrim').exists(), '导入中弹窗不关').toBe(true)
    const before = vi.mocked(ledgerApi.month).mock.calls.length
    done({ res: { imported: 1, skipped: 0, errors: [] }, logIds: [] })
    await flushPromises()
    expect(vi.mocked(ledgerApi.month).mock.calls.length, '写完重读本月').toBe(before + 1)
    expect(w.find('.irc h4').text()).toBe('导进去 1 家')
    expect(w.find('.irc-meta').text(), '本页刷新成了,不写「没刷新上」').not.toContain('没刷新上')
  })

  // 破坏验证:onImport 包回 try/catch + receipt.fail → 失败卡不出、回执多一条 → 红
  it('❗写失败 → 弹窗里出失败卡(审核闸原句照抄后端),不出回执', async () => {
    vi.mocked(runImport).mockRejectedValueOnce({ code: 409, message: '2026-09 月度台账 已审核,撤销审核后才能修改' })
    const w = await openImport()
    ;(w.findComponent(FpImportModal).vm as unknown as ModalVm).onSectionsConfirm([{ year: 2026, month: 9, records: [{ tenantName: '乙户' }] }])
    await flushPromises()
    expect(w.find('.fpimp-scrim').exists()).toBe(true)
    expect(w.text()).toContain('2026-09 月度台账 已审核,撤销审核后才能修改')
    expect(receipts).toHaveLength(0)
  })

  // 破坏验证:LedgerView.onImport 不认 p.ym(写死屏上的月)→ 「按 8 月导」红;
  //          registry 台账 precheck 改回按全部行数(不用 overwriteTargets)→ 8 月那家结转虚行被算成会盖掉 → 「导入 1 家」红
  it('❗核对页:文件月 ≠ 本月,二选一前主按钮灰、不发确认框;改成导到 8 月 → 按 8 月查会盖掉几家(结转虚行不算)、按 8 月导', async () => {
    vi.mocked(runImport).mockResolvedValue({ res: { imported: 1, skipped: 0, errors: [] }, logIds: [] } as never)
    // 9 月:甲户有存储行;8 月:甲户只是结转虚行
    vi.mocked(ledgerApi.month).mockImplementation((_c: number, y: number, m: number) => Promise.resolve(
      { ...monthOf(y, m), rows: [{ ...rowOf('甲户'), ...(m === 8 ? { carried: true } : {}) }] } as LedgerMonthDTO))
    const w = await openImport()
    const modal = w.findComponent(FpImportModal)
    ;(modal.vm as unknown as { applyResult: (r: unknown) => void })
      .applyResult({ records: [{ tenantName: '甲户', __ymDetected: { year: 2026, month: 8 }, __preview: ['甲户'] }] })
    await flushPromises()
    const foot = () => w.findAll('.fpimp-f button')
    expect(w.find('.fpimp-target').text()).toBe('导到 2026年9月 · 甲公司')
    expect(w.findAll('.fpimp-hint.warn').map(h => h.find('.tx').text().split('？')[0])).toEqual([
      '文件标题写的是 2026年8月，和要导到的 9月不一样。导到哪个月',
      '文件里有 1 家在 9月甲公司的台账里已经有了。导进去会用文件里的数盖掉这 1 家；文件里没有的列不动。',
    ])
    expect(foot().at(-1)!.text()).toBe('覆盖 1 家并导入')
    expect(foot().at(-1)!.attributes('disabled'), '二选一之前不能导').toBeDefined()
    expect(askQueue, '不再弹确认框').toHaveLength(0)

    await w.findAll('.fpimp-choice .o').find(b => b.text() === '改成导到 8月')!.trigger('click')
    await flushPromises()
    expect(w.find('.fpimp-target').text()).toBe('导到 2026年8月 · 甲公司')
    expect(foot().at(-1)!.text(), '8 月那家只是结转虚行,不算会盖掉').toBe('导入 1 家')
    await foot().at(-1)!.trigger('click')
    await flushPromises()
    expect(vi.mocked(runImport).mock.calls[0][2]).toMatchObject({ companyId: 9, year: 2026, month: 8 })
    expect(w.find('.irc-p').text()).toBe('8月甲公司的台账已经在库里了。')
  })

  // 动效板 ⑤「在台账页里导入也一样,导进去的那几行亮 2 秒」:关窗那一刻才亮,亮的是刷新后新出现 / 内容变了的行
  // 破坏验证:closeImport 不挂 flashKeys → 「点完成后亮」红;onImport 不比刷新前后(本月行全亮)→ 丙户也亮 → 红
  it('❗导完点「完成」:新出现 / 内容变了的行亮(fp-row-flash),没变的不亮;弹窗开着时不亮;动画完摘掉', async () => {
    const r甲 = rowOf('甲户'), r丙 = { ...rowOf('丙户'), id: 6, tenantId: 6 }
    let after = false
    vi.mocked(ledgerApi.month).mockImplementation((_c: number, y: number, m: number) => Promise.resolve({
      ...monthOf(y, m),
      rows: after ? [{ ...r甲, factoryRent: 100 }, r丙, { ...rowOf('乙户'), id: 7, tenantId: 7 }] : [r甲, r丙],
    } as LedgerMonthDTO))
    vi.mocked(runImport).mockImplementation(async () => {
      after = true
      return { res: { imported: 2, skipped: 0, errors: [] }, logIds: [] } as never
    })
    const w = await openImport()
    ;(w.findComponent(FpImportModal).vm as unknown as ModalVm)
      .onSectionsConfirm([{ year: 2026, month: 9, records: [{ tenantName: '甲户' }, { tenantName: '乙户' }] }])
    await flushPromises()
    const lit = () => w.findAll('tbody tr.fp-row-flash').map(tr => tr.find('.lg-tname-txt').text()).sort()
    expect(lit(), '弹窗开着不亮(亮在它后面看不见)').toEqual([])
    await w.findAll('.fpimp-f button').find(b => b.text() === '完成')!.trigger('click')
    await flushPromises()
    expect(lit()).toEqual(['乙户', '甲户'].sort())
    const ev = new Event('animationend', { bubbles: true })
    Object.defineProperty(ev, 'animationName', { value: 'fp-row-flash' })
    w.find('tbody tr.fp-row-flash td').element.dispatchEvent(ev)
    await flushPromises()
    expect(lit(), '动画完摘掉,切回来不再亮').toEqual([])
  })
})
