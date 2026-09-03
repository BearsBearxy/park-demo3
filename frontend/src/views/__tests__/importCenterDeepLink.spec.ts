// src/views/__tests__/importCenterDeepLink.spec.ts — 导入中心消费期间深链(SIDEBAR-UX-REDESIGN §4.2「导入中心 p 预填表单」)+ 导后「去查看」(§9 P0b)。
// 本屏没有「当前期」,parsePeriod 读一次预填台账类表单;「去查看」只给期在导入时就已知的三类(台账 / 附10 / 附12)。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import type { ImportCtx } from '@/utils/importRegistry'

const query: Record<string, string> = {}
const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ query, get fullPath() { return '/import?' + new URLSearchParams(query).toString() } }),
}))
vi.mock('@/api/importLog', () => ({ importLogApi: { overview: vi.fn(), record: vi.fn() } }))
vi.mock('@/api/ledger', () => ({
  companyApi: { list: vi.fn() },
  ledgerApi: { month: vi.fn() },
}))
vi.mock('@/api/books', () => ({ booksApi: { list: vi.fn() } }))
vi.mock('@/api/charging', () => ({ chargingApi: { cats: vi.fn() } }))
// 只桩 runImport:IMPORT_TYPES 要真的那份(磁贴按它渲染)
vi.mock('@/utils/importRegistry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/importRegistry')>()),
  runImport: vi.fn(),
}))

import ImportCenterView from '@/views/import-center/ImportCenterView.vue'
import { importLogApi } from '@/api/importLog'
import { companyApi, ledgerApi } from '@/api/ledger'
import { booksApi } from '@/api/books'
import { runImport } from '@/utils/importRegistry'

interface Vm {
  lf: { companyId: number | null; year: number; month: number }
  activeKey: string | null
  ctx: ImportCtx
  doRun: (payload: unknown[], fileName: string) => Promise<void>
}
const vmOf = (w: { vm: unknown }) => w.vm as Vm

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['entry:edit']
  vi.clearAllMocks()
  for (const k of Object.keys(query)) delete query[k]
  vi.setSystemTime(new Date('2025-06-15T00:00:00'))
  vi.mocked(importLogApi.overview).mockResolvedValue({ latestByType: [], history: [] })
  vi.mocked(companyApi.list).mockResolvedValue([
    { id: 9, name: '甲公司', short: '甲', sortNo: 1 }, { id: 12, name: '乙公司', short: '乙', sortNo: 2 },
  ])
  vi.mocked(ledgerApi.month).mockResolvedValue({ rows: [] } as never)
  vi.mocked(booksApi.list).mockResolvedValue([])
  vi.mocked(runImport).mockResolvedValue({ imported: 1, skipped: 0, errors: [] })
})

async function open() {
  const w = mount(ImportCenterView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}
/** 某类型磁贴上的「上传」按钮。 */
const uploadOf = (w: Awaited<ReturnType<typeof open>>, label: string) =>
  w.findAll('.im-tile').find(t => t.find('.im-tile-name').text() === label)!.find('button')

describe('导入中心 · 期间深链预填', () => {
  it('❗?p=2025-03&co=12 预填台账类表单 —— openImport 的重置也不丢', async () => {
    // 红线:lf 初值 / openImport 第 98 行不走 defaultLf → 表单开出来是当前年月 + 首家
    query.p = '2025-03'; query.co = '12'
    const w = await open()
    await uploadOf(w, '月度台账').trigger('click')
    await flushPromises()
    expect(w.find('.im-ctx').exists(), '公司 + 年月表单开着').toBe(true)
    expect(vmOf(w).lf).toEqual({ companyId: 12, year: 2025, month: 3 })
  })

  it('没有深链 → 当前年月 + 首家公司(改前口径)', async () => {
    const w = await open()
    await uploadOf(w, '月度台账').trigger('click')
    await flushPromises()
    expect(vmOf(w).lf).toEqual({ companyId: 9, year: 2025, month: 6 })
  })

  it('co 不在公司名单里 → 退回首家,期照用(不让「下一步」按一个不存在的公司)', async () => {
    query.p = '2025-03'; query.co = '99'
    const w = await open()
    await uploadOf(w, '月度台账').trigger('click')
    await flushPromises()
    expect(vmOf(w).lf).toEqual({ companyId: 9, year: 2025, month: 3 })
  })

  it('只有年的链接(?p=2025)不预填 —— 半个期不认,退回当前年月 + 首家', async () => {
    // 红线:defaultLf 直接用 parsed(不看 month) → year 变 2025、month 取时钟 → 「2025 年 6 月」这种拼出来的期
    query.p = '2024'; query.co = '12'
    const w = await open()
    await uploadOf(w, '月度台账').trigger('click')
    await flushPromises()
    expect(vmOf(w).lf).toEqual({ companyId: 9, year: 2025, month: 6 })
  })
})

describe('导入中心 · 导后「去查看」', () => {
  it('❗台账导完 →「去查看」带 p + co 去台账,点了弹层就关', async () => {
    // 红线:viewLink 的 ledger 分支删掉 → 没按钮;periodLink 的 co 漏了 → push 里没有 co
    const w = await open()
    const vm = vmOf(w)
    vm.activeKey = 'ledger'
    vm.ctx = { companyId: 12, companyName: '乙公司', year: 2025, month: 3 }
    await vm.doRun([{ tenantName: '甲户' }], 'a.xlsx')
    await flushPromises()
    const go = w.findAll('button').find(b => b.text() === '去查看')
    expect(go, '结果弹层该有「去查看」').toBeTruthy()
    await go!.trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/ledger', query: { p: '2025-03', co: '12' } })
    expect(w.find('.ir-scrim').exists(), '点了就关').toBe(false)
  })

  it('附表10 / 附表12 导完 → 期(与期区)从第一段取', async () => {
    const w = await open()
    const vm = vmOf(w)
    vm.activeKey = 's10'; vm.ctx = {}
    await vm.doRun([{ year: 2025, month: 3, phase: 2, records: [] }], 's10.xlsx')
    await flushPromises()
    await w.findAll('button').find(b => b.text() === '去查看')!.trigger('click')
    expect(push).toHaveBeenLastCalledWith({ path: '/sales-income', query: { p: '2025-03', co: '2' } })

    vm.activeKey = 'salary'
    await vm.doRun([{ year: 2025, month: 4, records: [] }], 'salary.xlsx')
    await flushPromises()
    await w.findAll('button').find(b => b.text() === '去查看')!.trigger('click')
    expect(push).toHaveBeenLastCalledWith({ path: '/salary', query: { p: '2025-04' } })
  })

  it('期读不出来的类型(附13 平铺行)没有「去查看」,结果弹层照旧', async () => {
    const w = await open()
    const vm = vmOf(w)
    vm.activeKey = 'office_13'; vm.ctx = {}
    await vm.doRun([{ acctMonth: '2025-03' }], 'u.xlsx')
    await flushPromises()
    expect(w.find('.ir-scrim').exists()).toBe(true)
    expect(w.findAll('button').some(b => b.text() === '去查看')).toBe(false)
    expect(w.findAll('button').some(b => b.text() === '知道了')).toBe(true)
  })

  it('台账整册多段导入(段元素带 records)不给「去查看」 —— 入库的是各段自己的公司 / 月,不是表单里的', async () => {
    // 红线:viewLink 的 ledger 分支去掉 `!first?.records` → 按表单 ctx 发链(甲公司 2025-06),而这段实际入的是乙公司 2025-03
    const w = await open()
    const vm = vmOf(w)
    vm.activeKey = 'ledger'
    vm.ctx = { companyId: 9, companyName: '甲公司', year: 2025, month: 6 }
    await vm.doRun([{ label: '乙公司 2025-03', records: [{ tenantName: '甲户', __company: '乙公司', __ym: { year: 2025, month: 3 } }] }], 'book.xlsx')
    await flushPromises()
    expect(w.find('.ir-scrim').exists()).toBe(true)
    expect(w.findAll('button').some(b => b.text() === '去查看')).toBe(false)
  })
})
