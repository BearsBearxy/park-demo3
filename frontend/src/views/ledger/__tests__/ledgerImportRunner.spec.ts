// 月度台账 · 导入点下去之后(画布 11 ImportOne / ImportDone / ImportFail;UI-OVERLAY-SPEC §8):
// 弹窗不关,内容区换进度卡,写完原地出结果卡;失败交给弹窗的失败卡(不走回执)。
// 年月与覆盖两道预检从「关窗之后」挪进弹窗的 confirm(开跑前问,答「取消」一条都不发)。
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
import FpImportModal, { type ImportPayload } from '@/components/import/FpImportModal.vue'
import { booksApi } from '@/api/books'
import { ledgerApi, companyApi } from '@/api/ledger'
import { runImport } from '@/utils/importRegistry'
import { askQueue, answer } from '@/utils/ask'
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
    done({ imported: 1, skipped: 0, errors: [] })
    await flushPromises()
    expect(vi.mocked(ledgerApi.month).mock.calls.length, '写完重读本月').toBe(before + 1)
    expect(w.find('.irc h4').text()).toBe('导入完成')
    expect(w.find('.irc-meta').text()).toContain('本页已刷新')
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

  // 破坏验证:去掉 :confirm(或 confirmImport 里的覆盖那道)→ askQueue 为空 → 红;答「取消」仍返回 true → 红
  it('❗整表导入开跑前:文件月 ≠ 本月先问一句,本月已有的户再问覆盖;答「取消」不跑', async () => {
    const w = await openImport()
    const confirm = w.findComponent(FpImportModal).props('confirm') as (p: ImportPayload, f: string) => Promise<boolean>
    const ym = confirm([{ tenantName: '乙户', __ymDetected: { year: 2026, month: 8 } }], '8月台账.xlsx')
    await flushPromises()
    expect(askQueue[0]?.title).toBe('导入到 2026 年 9 月？')
    answer(false)
    await expect(ym).resolves.toBe(false)

    const over = confirm([{ tenantName: '甲户' }], '台账.xlsx')
    await flushPromises()
    expect(askQueue[0]?.title).toBe('导入会覆盖已有的台账数据')
    expect(askQueue[0]?.body).toBe('本月已有 1 家租户的台账数据，文件里提供的列会被覆盖。')
    answer(false)
    await expect(over).resolves.toBe(false)

    await expect(confirm([{ tenantName: '乙户' }], '台账.xlsx'), '没撞上已有的户:不问直接跑').resolves.toBe(true)
    expect(runImport).not.toHaveBeenCalled()
  })
})
