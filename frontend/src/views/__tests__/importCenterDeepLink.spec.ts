/* Copyright (c) 2026 Junyang. All rights reserved. */
// src/views/__tests__/importCenterDeepLink.spec.ts — 导入中心消费期间深链(SIDEBAR-UX-REDESIGN §4.2)+ 导后「去 X 看」(§9 P0b)。
// 2026-10-10 改稿(ix-v2):?p 定页头的月、co 是台账小窗的缺省公司;「去 X 看」从 registry 的 target / viewLink 拼(T4),
// 不再只认台账 / 附10 / 附12 三类。弹窗另有人在重写:这里把它换成桩,只经 runner / go 两个 prop 和 go 事件。
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
vi.mock('@/api/importLog', () => ({ importLogApi: { coverage: vi.fn(), page: vi.fn(), record: vi.fn() } }))
vi.mock('@/api/ledger', () => ({
  companyApi: { list: vi.fn() },
  ledgerApi: { month: vi.fn() },
}))
vi.mock('@/api/books', () => ({ booksApi: { list: vi.fn() } }))
vi.mock('@/api/charging', () => ({ chargingApi: { cats: vi.fn() } }))
// 只桩 runImport:IMPORT_TYPES 要真的那份(清单按它渲染,target / viewLink 也是真的)
vi.mock('@/utils/importRegistry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/importRegistry')>()),
  runImport: vi.fn(),
}))

import ImportCenterView from '@/views/import-center/ImportCenterView.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import { importLogApi } from '@/api/importLog'
import { companyApi } from '@/api/ledger'
import { booksApi } from '@/api/books'
import { runImport } from '@/utils/importRegistry'

interface Vm {
  lf: { companyId: number | null; ym: string }
  activeKey: string | null
  ctx: ImportCtx
  importing: boolean
}
const vmOf = (w: { vm: unknown }) => w.vm as Vm
/** 用例导的几类(台账 / 附表10 / 办公水电)各自那一屏的编辑与查看 */
const ENTRY = ['ledger:edit', 'ledger:view', 'sales-income:edit', 'sales-income:view', 'utilities:edit', 'utilities:view']

beforeEach(() => {
  setActivePinia(createPinia())
  // 后端给的是展开后的权限集(动作隐含本屏查看);附表12 的导入要工资编辑(隐含工资查看)
  useAuthStore().permissions = [...ENTRY, 'salary:edit', 'salary:view']
  vi.clearAllMocks()
  for (const k of Object.keys(query)) delete query[k]
  vi.setSystemTime(new Date('2025-06-15T00:00:00'))
  vi.mocked(importLogApi.coverage).mockResolvedValue([])
  vi.mocked(importLogApi.page).mockResolvedValue({ total: 0, rows: [], counts: { all: 0, partial: 0, rejected: 0 } })
  vi.mocked(companyApi.list).mockResolvedValue([
    { id: 9, name: '甲公司', short: '甲', sortNo: 1 }, { id: 12, name: '乙公司', short: '乙', sortNo: 2 },
  ])
  vi.mocked(booksApi.list).mockResolvedValue([])
  vi.mocked(runImport).mockResolvedValue({ res: { imported: 1, skipped: 0, errors: [] }, logIds: [] })
})

// RBAC v4:磁贴按它导进去的那一屏的写权显示,不按模块。破坏验证:某条 module 写成兄弟屏 / 写成模块级多屏 → 红
describe('导入中心磁贴按目标屏的编辑权', () => {
  const keysWith = async (perms: string[]) => {
    useAuthStore().permissions = ['import:view', ...perms]
    const w = mount(ImportCenterView, { global: { stubs: { Teleport: true } } })
    await flushPromises()
    return (w.vm as unknown as { visibleTypes: { key: string }[] }).visibleTypes.map(t => t.key)
  }
  it('❗只有附表7 编辑:只有汽车充电桩那一块,附表8 / 附表6 不出', async () => {
    expect(await keysWith(['car-charging:edit'])).toEqual(['charging_7'])
  })
  it('❗只有附表2 编辑:损益附表只出附表2 那一块', async () => {
    expect(await keysWith(['elec-pnl:edit'])).toEqual(['pnl_s2'])
  })
  it('❗充电桩明细:汽车、电动车任一屏的分桩读数都出;只有档案不出', async () => {
    expect(await keysWith(['ebike-charging:reading'])).toEqual(['cpMeter'])
    expect(await keysWith(['car-charging:archive', 'ebike-charging:archive'])).toEqual([])
  })
  it('❗年度预算只认导入中心编辑;合同两块只认合同编辑', async () => {
    expect(await keysWith(['import:edit'])).toEqual(['budget'])
    expect(await keysWith(['contracts:edit'])).toEqual(['contractFull', 'billingTerms'])   // 组内顺序照 ix-v2-main
  })
})

const STUBS = { Teleport: true, FpImportModal: true }
async function open() {
  const w = mount(ImportCenterView, { global: { stubs: STUBS } })
  await flushPromises()
  return w
}
/** 开某类型的导入弹窗,经弹窗的 runner 跑一次(弹窗是桩:结果卡、按钮归弹窗自己的测试) */
async function runVia(w: Awaited<ReturnType<typeof open>>, key: string, ctx: ImportCtx, payload: unknown[], fileName: string) {
  const vm = vmOf(w)
  vm.activeKey = key; vm.ctx = ctx; vm.importing = true
  await flushPromises()
  const runner = w.findComponent(FpImportModal).props('runner') as (p: unknown[], f: string, pr?: unknown) => Promise<unknown>
  await runner(payload, fileName, { from: 0, refreshing: () => {} })   // 进度回调只要 runner 用到的两样
  await flushPromises()
}
const goOf = (w: Awaited<ReturnType<typeof open>>) => w.findComponent(FpImportModal).props('go') as string | undefined
/** 某类那一行的「导入」钮 */
const importBtn = (w: Awaited<ReturnType<typeof open>>, key: string) => w.find(`.ix-row[data-key="${key}"] .ix-act button`)

describe('导入中心 · 期间深链预填', () => {
  it('❗?p=2025-03&co=12:页头是 2025-03,台账小窗缺省乙公司、同一个月 —— openImport 的重置也不丢', async () => {
    // 红线:ym 初值不认深链 → 页头 / 小窗都成了上个月;openLedgerForm 不认 deep.co → 公司空
    query.p = '2025-03'; query.co = '12'
    const w = await open()
    expect(importLogApi.coverage).toHaveBeenCalledWith('2025-03')
    await importBtn(w, 'ledger').trigger('click')
    await flushPromises()
    expect(w.find('.ix-dlg').exists(), '公司 + 月份小窗开着').toBe(true)
    expect(vmOf(w).lf).toEqual({ companyId: 12, ym: '2025-03' })
  })

  it('没有深链 → 页头上个月,台账小窗公司空着(K3:「导入」钮不替人挑公司)', async () => {
    const w = await open()
    expect(importLogApi.coverage).toHaveBeenCalledWith('2025-05')
    await importBtn(w, 'ledger').trigger('click')
    await flushPromises()
    expect(vmOf(w).lf).toEqual({ companyId: null, ym: '2025-05' })
  })

  it('co 不在公司名单里 → 公司空着,期照用(不让「下一步」按一个不存在的公司)', async () => {
    query.p = '2025-03'; query.co = '99'
    const w = await open()
    await importBtn(w, 'ledger').trigger('click')
    await flushPromises()
    expect(vmOf(w).lf).toEqual({ companyId: null, ym: '2025-03' })
  })

  it('只有年的链接(?p=2024)不认 —— 半个期不预填,退回上个月、公司空着', async () => {
    // 红线:deep 直接用 parsed(不看 month) → 页头拼出「2024 年 + 时钟月」这种期
    query.p = '2024'; query.co = '12'
    const w = await open()
    expect(importLogApi.coverage).toHaveBeenCalledWith('2025-05')
    await importBtn(w, 'ledger').trigger('click')
    await flushPromises()
    expect(vmOf(w).lf).toEqual({ companyId: null, ym: '2025-05' })
  })
})

describe('导入中心 · 导后「去 X 看」', () => {
  it('❗台账导完 → 弹窗多「去月度台账看」,带 p + co 去台账,点了弹窗就关', async () => {
    // 红线:runEntry 不按 target / viewLink 拼链 → 没按钮;ImportCenterView 不给弹窗 :go → 没按钮;goView 不关弹窗 → 最后一句红
    const w = await open()
    await runVia(w, 'ledger', { companyId: 12, companyName: '乙公司', year: 2025, month: 3 }, [{ tenantName: '甲户' }], 'a.xlsx')
    expect(goOf(w)).toBe('去月度台账看')
    w.findComponent(FpImportModal).vm.$emit('go')
    await flushPromises()
    expect(push).toHaveBeenCalledWith({ path: '/ledger', query: { p: '2025-03', co: '12' } })
    expect(w.findComponent(FpImportModal).exists(), '点了就关').toBe(false)
  })

  it('附表10 / 附表12 导完 → 期(与期区)从第一段取', async () => {
    const w = await open()
    await runVia(w, 's10', {}, [{ year: 2025, month: 3, phase: 2, records: [] }], 's10.xlsx')
    expect(goOf(w)).toBe('去附表10 销售收入看')
    w.findComponent(FpImportModal).vm.$emit('go')
    expect(push).toHaveBeenLastCalledWith({ path: '/sales-income', query: { p: '2025-03', co: '2' } })

    await runVia(w, 'salary', {}, [{ year: 2025, month: 4, records: [] }], 'salary.xlsx')
    w.findComponent(FpImportModal).vm.$emit('go')
    expect(push).toHaveBeenLastCalledWith({ path: '/salary', query: { p: '2025-04' } })
  })

  // RBAC v3:写得了、看不了目标屏的人不给「去 X 看」。2026-10-04 起工资录入隐含工资查看,这条路从清单走不到了
  //   (导入中心按 salary:edit 出行);留着守 canViewPage 这一判 —— 请主管借到导入写权的人(查看不可提权)也是这一路。
  // 破坏验证:runEntry 里 canViewPage 那一判去掉 → 红(原来点了就落「无权查看」页)
  it('❗看不了目标屏(导工资但没有工资查看)不给「去 X 看」', async () => {
    useAuthStore().permissions = [...ENTRY]
    const w = await open()
    await runVia(w, 'salary', {}, [{ year: 2025, month: 4, records: [] }], 'salary.xlsx')
    expect(goOf(w)).toBeUndefined()
  })

  it('附13 平铺行:按行里的记账月取年,去办公·三期水电的办公那一页', async () => {
    const w = await open()
    await runVia(w, 'office_13', {}, [{ acctMonth: '2025-03', belongMonth: '2025-03' }], 'u.xlsx')
    expect(goOf(w)).toBe('去办公·三期水电看')
    w.findComponent(FpImportModal).vm.$emit('go')
    expect(push).toHaveBeenLastCalledWith({ path: '/utilities', query: { p: '2025', tab: 'office' } })
  })

  it('一行都没写进去(imported 0)不给「去 X 看」', async () => {
    vi.mocked(runImport).mockResolvedValueOnce({ res: { imported: 0, skipped: 2, errors: [] }, logIds: [] })
    const w = await open()
    await runVia(w, 'salary', {}, [{ year: 2025, month: 4, records: [] }], 'salary.xlsx')
    expect(goOf(w)).toBeUndefined()
  })

  it('台账整册多段:链接按那一段自己认出的公司 / 月,不按小窗里的', async () => {
    // 红线:target 用小窗 ctx(甲公司 2025-06)发链,而这段实际入的是乙公司 2025-03(run 认完把 companyId 写回段上)
    const w = await open()
    await runVia(w, 'ledger', { companyId: 9, companyName: '甲公司', year: 2025, month: 6 },
      [{ label: '乙公司 2025-03', companyId: 12, records: [{ tenantName: '甲户', __company: '乙公司', __ym: { year: 2025, month: 3 } }] }], 'book.xlsx')
    w.findComponent(FpImportModal).vm.$emit('go')
    expect(push).toHaveBeenLastCalledWith({ path: '/ledger', query: { p: '2025-03', co: '12' } })
  })

  it('附表10 从导入中心导也是逐段:runner 把进度回调塞进 ctx._run', async () => {
    // 红线:runEntry 不带 _run → registry 的 s10 run 拿不到进度,导入中心的附表10 只能画「还在动」
    const w = await open()
    await runVia(w, 's10', {}, [{ year: 2025, month: 3, phase: 2, records: [] }], 's10.xlsx')
    expect(vi.mocked(runImport).mock.calls[0][2]._run, 'ctx._run').toBeTruthy()
  })
})
