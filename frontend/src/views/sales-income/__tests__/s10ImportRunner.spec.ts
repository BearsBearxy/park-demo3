// 附表10 逐段导入的 runner(UI-OVERLAY-SPEC §8):断在第 k 段时前面的段已经写进库 —— 本页先照实刷一次,再把错误交给弹窗的失败卡。
// 锁按月(S.s10):一换期 SchedHeader 就退出编辑、收掉导入窗 —— 跳到第一段的槽挪到看完结果、关窗之后(同附表12)。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import type { Book, BookDef } from '@/types/book'
import type { S10MonthDTO, S10OverviewDTO } from '@/types/s10'

const def: BookDef = { groups: [{ id: 'g1', label: '租金', cols: [
  { id: 'factoryRent', std: true, label: '厂房租金', aliases: [], slot: 'rent', hidden: false, w: null },
] }] }
const book1: Book = { id: 7, screen: 's10', companyId: null, phase: 1, name: '一期', ver: 1, latestVer: 1, definition: def }
const overview: S10OverviewDTO = { years: [2026], currentYear: 2026, currentMonth: 9, summaries: [{ year: 2026, recordedMonths: 9, tenantCount: 1 }] }
const monthOf = (y: number, m: number): S10MonthDTO => ({ phase: 1, year: y, month: m, recorded: true, rows: [], columnTotals: {}, grandTotal: 0 })

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ query: {}, fullPath: '/sales-income' }) }))
vi.mock('@/api/s10', () => ({ s10Api: { getOverview: vi.fn(), getMonth: vi.fn(), importRows: vi.fn() } }))
vi.mock('@/api/importLog', () => ({ importLogApi: { record: vi.fn(() => Promise.resolve()) } }))
vi.mock('@/api/books', () => ({ booksApi: { list: vi.fn(), templateAt: vi.fn() } }))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: () => Promise.resolve([]) } }))
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }), release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }), takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))
vi.mock('@/api/review', () => ({
  reviewApi: {
    list: vi.fn(() => Promise.resolve([])), states: vi.fn(() => Promise.resolve([])),
    closedMonths: vi.fn(() => Promise.resolve([])), pending: vi.fn(() => Promise.resolve([])),
  },
}))

import S10View from '@/views/sales-income/S10View.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import FPTenantIssuePanel from '@/components/fp/FPTenantIssuePanel.vue'
import { s10Api } from '@/api/s10'
import { booksApi } from '@/api/books'
import type { SectionPick } from '@/components/import/FpImportModal.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['sales-income:edit']
  vi.clearAllMocks()
  vi.mocked(s10Api.getOverview).mockResolvedValue(overview)
  vi.mocked(s10Api.getMonth).mockImplementation((_ph: number, y: number, m: number) => Promise.resolve(monthOf(y, m)))
  vi.mocked(booksApi.list).mockResolvedValue([book1])
  vi.mocked(booksApi.templateAt).mockResolvedValue(book1)
})

const PICKS: SectionPick[] = [
  { year: 2026, month: 1, phase: 1, records: [{ tenantName: '甲' }] },
  { year: 2026, month: 2, phase: 1, records: [{ tenantName: '乙' }] },
]
type Vm = {
  pickCell: (y: number, m: number) => Promise<void>
  onSmartImport: (p: SectionPick[], f: string) => Promise<unknown>
  edit: boolean; month: number; year: number | null; issuesOpen: boolean
}
const vmOf = (w: { vm: unknown }) => w.vm as Vm

/** 选 2026-09 进表格态(浏览态) */
async function openMonth() {
  const w = mount(S10View, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  await vmOf(w).pickCell(2026, 9)
  await flushPromises()
  return w
}
/** 2026-09 → 编辑模式 → 打开导入弹窗 */
async function openImport() {
  const w = await openMonth()
  await w.findAll('button').find(b => b.text().includes('编辑模式'))!.trigger('click')
  await flushPromises()
  expect(vmOf(w).edit, '前置:进了编辑态').toBe(true)
  await w.findAll('button').find(b => b.text().includes('导入 Excel'))!.trigger('click')
  await flushPromises()
  expect(w.find('.fpimp-scrim').exists(), '前置:导入弹窗开着').toBe(true)
  return w
}

describe('附表10 · 逐段导入断了', () => {
  // 破坏验证:去掉 runImport 后面的 .catch(先 refresh 再抛)→ 红
  it('❗第 2 段断了:前 1 段已写进库,本页先刷新一次,错误照样抛给弹窗', async () => {
    const w = await openImport()
    vi.mocked(s10Api.importRows)
      .mockResolvedValueOnce({ imported: 1, skipped: 0, errors: [] })
      .mockRejectedValueOnce(Object.assign(new Error('Network Error'), { isAxiosError: true }))
    const before = vi.mocked(s10Api.getOverview).mock.calls.length
    await expect(vmOf(w).onSmartImport(PICKS, '附表10.xlsx')).rejects.toThrow('Network Error')
    expect(s10Api.importRows).toHaveBeenCalledTimes(2)
    expect(vi.mocked(s10Api.getOverview).mock.calls.length, '断了也刷新本页').toBe(before + 1)
    w.unmount()
  })
})

describe('附表10 · 导入完再跳期', () => {
  // 破坏验证:跳到第一段的册 / 年月挪回 runner 的 settle 刷新里 → 换期 SchedHeader 退出编辑,「编辑态还在」「还在 9 月」红;
  //          @close 换回 importing = false → 「关窗后跳到 1 月」红
  it('❗导入完:弹窗还在、编辑态还在、原地出结果卡;点「知道了」才跳到第一段(2026-01)', async () => {
    vi.mocked(s10Api.importRows).mockResolvedValue({ imported: 1, skipped: 0, errors: [] })
    const w = await openImport()
    ;(w.findComponent(FpImportModal).vm as unknown as { onSectionsConfirm: (p: SectionPick[]) => void }).onSectionsConfirm(PICKS)
    await flushPromises()
    expect(s10Api.importRows).toHaveBeenCalledTimes(2)
    expect(w.find('.irc h4').text()).toBe('导入完成')
    expect(w.find('.irc-meta').text()).toContain('本页已刷新')
    expect(vmOf(w).edit, '编辑态还在(没被换期踢出去)').toBe(true)
    expect(vmOf(w).month, '看结果时还在本期').toBe(9)

    await w.findAll('.fpimp button').find(b => b.text() === '知道了')!.trigger('click')
    await flushPromises()
    expect(w.find('.fpimp-scrim').exists()).toBe(false)
    expect(vmOf(w).month, '关窗后跳到第一段那一月').toBe(1)
    expect(vi.mocked(s10Api.getMonth).mock.calls.at(-1)).toEqual([1, 2026, 1])
    w.unmount()
  })

  // 破坏验证:registry s10 run 删掉每段前的 _alive 判断(或 S10View 不传 _alive)→ 第 2 段照发 → 红
  it('❗逐段写到一半失锁(接管 / 授权到期):剩下的段不再发,弹窗留着出失败卡', async () => {
    const w = await openImport()
    vi.mocked(s10Api.importRows).mockImplementationOnce(async () => {
      vmOf(w).edit = false   // 第 1 段在途时锁被接管
      return { imported: 1, skipped: 0, errors: [] }
    })
    ;(w.findComponent(FpImportModal).vm as unknown as { onSectionsConfirm: (p: SectionPick[]) => void }).onSectionsConfirm(PICKS)
    await flushPromises()
    expect(s10Api.importRows, '第 2 段不再发').toHaveBeenCalledTimes(1)
    expect(w.find('.fpimp-scrim').exists(), '在跑的导入窗没被收走').toBe(true)
    expect(w.find('.ipf-h h4').text()).toBe('第 2 段没导进去')
    expect(w.find('.ipf-box').text()).toContain('已退出编辑，从这一段起没有再发')
    expect(w.findAll('.fpimp-f button').map(b => b.text())).toEqual(['关闭', '返回修改'])
    w.unmount()
  })

  // 破坏验证:onSmartImport 删掉 if (!edit.value) return null → importRows 被调 → 红
  it('❗已退出编辑(失锁后弹窗留着)再点导入 / 接着导:写口自守,一条不发', async () => {
    const w = await openImport()
    vmOf(w).edit = false
    await flushPromises()
    expect(await vmOf(w).onSmartImport(PICKS, '附表10.xlsx')).toBeNull()
    expect(s10Api.importRows).not.toHaveBeenCalled()
    w.unmount()
  })
})

describe('附表10 · 未绑定面板', () => {
  // 破坏验证:act-hint 换回「进入「编辑」模式后可在此绑定;浏览态仅查看。」→ 红(每张卡都会重复这句长句)
  it('浏览态每张卡在绑定位写「编辑模式下可绑定」,同台账口径', async () => {
    const w = await openMonth()
    vmOf(w).issuesOpen = true
    await flushPromises()
    expect(w.findComponent(FPTenantIssuePanel).props('actHint')).toBe('编辑模式下可绑定')
    w.unmount()
  })
})
