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
import FpImportModal from '@/components/import/FpImportModal.vue'
import { importLogApi } from '@/api/importLog'
import { companyApi, ledgerApi } from '@/api/ledger'
import { booksApi } from '@/api/books'
import { runImport } from '@/utils/importRegistry'

interface Vm {
  lf: { companyId: number | null; year: number; month: number }
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
  vi.mocked(importLogApi.overview).mockResolvedValue({ latestByType: [], history: [] })
  vi.mocked(companyApi.list).mockResolvedValue([
    { id: 9, name: '甲公司', short: '甲', sortNo: 1 }, { id: 12, name: '乙公司', short: '乙', sortNo: 2 },
  ])
  vi.mocked(ledgerApi.month).mockResolvedValue({ rows: [] } as never)
  vi.mocked(booksApi.list).mockResolvedValue([])
  vi.mocked(runImport).mockResolvedValue({ imported: 1, skipped: 0, errors: [] })
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
    expect(await keysWith(['contracts:edit'])).toEqual(['billingTerms', 'contractFull'])
  })
})

async function open() {
  const w = mount(ImportCenterView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}
/** 开某类型的导入弹窗,走一遍弹窗自己的「点导入」(confirm → runner → 原地结果卡)。2026-10-03 起结果在弹窗里,不再另弹结果层 */
async function runVia(w: Awaited<ReturnType<typeof open>>, key: string, ctx: ImportCtx, payload: unknown[], fileName: string) {
  const vm = vmOf(w)
  vm.activeKey = key; vm.ctx = ctx; vm.importing = true
  await flushPromises()
  const m = w.findComponent(FpImportModal)
  await (m.vm as unknown as { start: (p: unknown[], f: string) => Promise<void> }).start(payload, fileName)
  await flushPromises()
}
const footBtn = (w: Awaited<ReturnType<typeof open>>, text: string) => w.findAll('.fpimp-f button').find(b => b.text() === text)
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

  it('只有年的链接(?p=2024)不预填 —— 半个期不认,退回当前年月 + 首家', async () => {
    // 红线:defaultLf 直接用 parsed(不看 month) → year 变 2025、month 取时钟 → 「2025 年 6 月」这种拼出来的期
    query.p = '2024'; query.co = '12'
    const w = await open()
    await uploadOf(w, '月度台账').trigger('click')
    await flushPromises()
    expect(vmOf(w).lf).toEqual({ companyId: 9, year: 2025, month: 6 })
  })
})

describe('导入中心 · 导后「去查看」', () => {
  it('❗台账导完 → 弹窗原地结果卡多「去查看」,带 p + co 去台账,点了弹窗就关', async () => {
    // 红线:viewLink 的 ledger 分支删掉 → 没按钮;periodLink 的 co 漏了 → push 里没有 co;
    //       ImportCenterView 不给弹窗 :go → 没按钮;goView 不关弹窗 → 最后一句红
    const w = await open()
    await runVia(w, 'ledger', { companyId: 12, companyName: '乙公司', year: 2025, month: 3 }, [{ tenantName: '甲户' }], 'a.xlsx')
    expect(w.find('.irc-meta').text(), '结果卡写明从导入中心导入').toContain('从导入中心导入')
    const go = footBtn(w, '去查看')
    expect(go, '结果卡该有「去查看」').toBeTruthy()
    await go!.trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/ledger', query: { p: '2025-03', co: '12' } })
    expect(w.find('.fpimp-scrim').exists(), '点了就关').toBe(false)
  })

  it('附表10 / 附表12 导完 → 期(与期区)从第一段取', async () => {
    const w = await open()
    await runVia(w, 's10', {}, [{ year: 2025, month: 3, phase: 2, records: [] }], 's10.xlsx')
    await footBtn(w, '去查看')!.trigger('click')
    expect(push).toHaveBeenLastCalledWith({ path: '/sales-income', query: { p: '2025-03', co: '2' } })

    await runVia(w, 'salary', {}, [{ year: 2025, month: 4, records: [] }], 'salary.xlsx')
    await footBtn(w, '去查看')!.trigger('click')
    expect(push).toHaveBeenLastCalledWith({ path: '/salary', query: { p: '2025-04' } })
  })

  // RBAC v3:写得了、看不了目标屏的人不给「去查看」。2026-10-04 起工资录入隐含工资查看,这条路从磁贴走不到了
  //   (导入中心按 salary:edit 出磁贴);留着守 canViewPage 这一判 —— 请主管借到导入写权的人(查看不可提权)也是这一路。
  // 破坏验证:runEntry 里 canViewPage 那一判去掉 → 红(原来点了就落「无权查看」页)
  it('❗看不了目标屏(导工资但没有工资查看)不给「去查看」,结果卡照旧', async () => {
    useAuthStore().permissions = [...ENTRY]
    const w = await open()
    await runVia(w, 'salary', {}, [{ year: 2025, month: 4, records: [] }], 'salary.xlsx')
    expect(w.find('.irc').exists()).toBe(true)
    expect(footBtn(w, '去查看')).toBeUndefined()
    expect(footBtn(w, '知道了')).toBeTruthy()
  })

  it('期读不出来的类型(附13 平铺行)没有「去查看」,结果卡照旧', async () => {
    const w = await open()
    await runVia(w, 'office_13', {}, [{ acctMonth: '2025-03' }], 'u.xlsx')
    expect(w.find('.irc').exists()).toBe(true)
    expect(footBtn(w, '去查看')).toBeUndefined()
    expect(footBtn(w, '知道了')).toBeTruthy()
  })

  it('台账整册多段导入(段元素带 records)不给「去查看」 —— 入库的是各段自己的公司 / 月,不是表单里的', async () => {
    // 红线:viewLink 的 ledger 分支去掉 `!first?.records` → 按表单 ctx 发链(甲公司 2025-06),而这段实际入的是乙公司 2025-03
    const w = await open()
    await runVia(w, 'ledger', { companyId: 9, companyName: '甲公司', year: 2025, month: 6 },
      [{ label: '乙公司 2025-03', records: [{ tenantName: '甲户', __company: '乙公司', __ym: { year: 2025, month: 3 } }] }], 'book.xlsx')
    expect(w.find('.irc').exists()).toBe(true)
    expect(footBtn(w, '去查看')).toBeUndefined()
  })

  it('附表10 从导入中心导也是逐段:runner 把进度回调塞进 ctx._run', async () => {
    // 红线:runEntry 不带 _run → registry 的 s10 run 拿不到进度,导入中心的附表10 只能画「还在动」
    const w = await open()
    await runVia(w, 's10', {}, [{ year: 2025, month: 3, phase: 2, records: [] }], 's10.xlsx')
    expect(vi.mocked(runImport).mock.calls[0][2]._run, 'ctx._run').toBeTruthy()
  })
})
