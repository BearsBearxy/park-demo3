// src/views/reports/__tests__/reportsHints.spec.ts
// 报表区(T29 · S4 机械替换 M10)换成十件标准件之后的行为:
//   ⑨ 自写的批量删除遮罩(.fin-mask / .pnl-mask)→ ask(danger):标题问句、正文给数、主按钮写动作,答「取消」不删;
//      问的这会儿编辑权被收走了,答「删除」也不再写(写函数开头自守)。
//   ⑧ alert() 报成败 → 结果回执:失败不自收,带「重试」,重试重放的是**当时那一次**(收入核对:同一户、同一句备注)。
//      批量删除半途失败不带重试(前几条已删,原样重跑会对着删过的行再删)。
//   ⑤ 自写报错行(pnl-derr)→ .fp-field-err,字段错误不走回执。
//   ⑦ 手写空状态(还没有管理公司 / 年度暂无数据 / 无匹配租户 / 该月无核对实体)→ FPEmpty 一种样子。
//   ⑩ 原生 title= → v-tip(图标钮补 aria-label)。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { useAuthStore } from '@/stores/auth'
import { askQueue, answer } from '@/utils/ask'
import { receipts } from '@/utils/receipt'
import BalanceSheetView from '@/views/reports/balance-sheet/BalanceSheetView.vue'
import IncomeStatementView from '@/views/reports/income-statement/IncomeStatementView.vue'
import TrialBalanceView from '@/views/reports/trial-balance/TrialBalanceView.vue'
import PnlScheduleView from '@/views/reports/pnl/PnlScheduleView.vue'
import ReconWorkbench from '@/views/reports/recon/ReconWorkbench.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import { companyApi } from '@/api/ledger'
import { reportApi } from '@/api/report'
import { pnlApi } from '@/api/pnl'
import { reconApi } from '@/api/recon'
import { writeAoaWorkbook } from '@/utils/sheet'
import { exportIncomeStatement } from '@/utils/incomeStatementExcel'
import { runImport } from '@/utils/importRegistry'
import type { ReportCustomRowDTO, ReportPeriodDTO } from '@/types/report'
import type { PnlOverviewDTO, PnlRowDTO, PnlYearDTO } from '@/types/pnl'
import type { ReconEntity } from '@/types/recon'
import type { TbAccount } from '@/reports/trialBalance'

vi.mock('@/api/ledger', () => ({
  companyApi: { list: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn() },
  ledgerApi: {},
}))
vi.mock('@/api/report', () => ({
  reportApi: {
    years: vi.fn(), year: vi.fn(), period: vi.fn(), allPeriod: vi.fn(), save: vi.fn(),
    addCustomRow: vi.fn(), deleteCustomRow: vi.fn(),
  },
}))
vi.mock('@/api/review', () => ({
  reviewApi: {
    list: vi.fn(() => Promise.resolve([])), states: vi.fn(() => Promise.resolve([])),
    submit: vi.fn(), approve: vi.fn(), returnBack: vi.fn(), withdraw: vi.fn(), recall: vi.fn(),
    closedMonths: vi.fn(() => Promise.resolve([])), pending: vi.fn(() => Promise.resolve([])),
  },
}))
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: vi.fn(() => Promise.resolve({ granted: true, holder: null, acquiredAt: 1 })),
    release: vi.fn(() => Promise.resolve()), releaseOnUnload: vi.fn(),
    heartbeat: vi.fn(() => Promise.resolve({ evicted: null })),
    takeover: vi.fn(() => Promise.resolve({ granted: true, holder: null })),
  },
}))
vi.mock('@/api/pnl', () => ({ pnlApi: { overview: vi.fn(), year: vi.fn(), save: vi.fn(), import: vi.fn() } }))
vi.mock('@/api/recon', () => ({ reconApi: { overview: vi.fn(), month: vi.fn(), mark: vi.fn(), unmark: vi.fn() } }))
vi.mock('@/utils/sheet', async (orig) => ({ ...(await orig<object>()), writeAoaWorkbook: vi.fn() }))
vi.mock('@/utils/incomeStatementExcel', async (orig) => ({ ...(await orig<object>()), exportIncomeStatement: vi.fn() }))
vi.mock('@/utils/importRegistry', async (orig) => ({ ...(await orig<object>()), runImport: vi.fn() }))
// 派生对照拉的是一串别的接口;这里让它失败(屏上「失败静默」),表照常出
vi.mock('@/reports/pnlDerive', async (orig) => ({
  ...(await orig<object>()),
  loadDeriveData: vi.fn(() => Promise.reject(new Error('派生不可用'))),
}))

const route = {
  query: {} as Record<string, string>,
  meta: {} as Record<string, unknown>,
  get fullPath() { return '/x?' + new URLSearchParams(this.query).toString() },
}
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push: vi.fn() }) }))

const STUBS = { Teleport: true, RouterLink: true, 'router-link': true }
const REPORT_EDITS = ['income-statement:edit', 'balance-sheet:edit', 'trial-balance:edit',
  'rent-pnl:edit', 'elec-pnl:edit', 'water-pnl:edit', 'ops-pnl:edit', 'expense-pnl:edit', 'reconciliation:edit']

beforeEach(() => {
  setActivePinia(createPinia())
  // v3 的 master:edit + report:edit 落到 v4:三张报表 + 五张损益附表 + 收入核对各自的编辑,公司新增删除(月度台账)与改名(催缴单收款公司)
  useAuthStore().permissions = [...REPORT_EDITS, 'ledger:company', 'bill-notices:payee']
  vi.clearAllMocks()
  localStorage.clear()
  askQueue.splice(0)
  receipts.splice(0)
  route.query = {}
  route.meta = {}
  // clearAllMocks 不清实现:上一条塞的 reject 会漏到下一条,这几个每条从干净开始
  for (const f of [writeAoaWorkbook, exportIncomeStatement, runImport, pnlApi.save, reconApi.mark,
    reportApi.addCustomRow, reportApi.deleteCustomRow]) vi.mocked(f).mockReset()
  vi.setSystemTime(new Date('2025-06-15T00:00:00'))
})

const btn = (w: VueWrapper, text: string) => {
  const b = w.findAll('button').find(x => x.text().includes(text))
  if (!b) throw new Error(`找不到按钮「${text}」`)
  return b
}

// ── 三大报表夹具 ─────────────────────────────────────────────
const CUSTOM: ReportCustomRowDTO[] = [{ id: 77, rowKey: 'c1', parentKey: '1', label: '航泽借款', level: 1 }]
const ACCOUNTS: TbAccount[] = [
  { rowKey: '1001', parentKey: null, code: '1001', label: '库存现金', level: 0, sortOrder: 0 },
  { rowKey: '1002', parentKey: null, code: '1002', label: '银行存款', level: 0, sortOrder: 1 },
  { rowKey: '100201', parentKey: '1002', code: '100201', label: '农商行', level: 1, sortOrder: 2 },
  { rowKey: '2202', parentKey: null, code: '2202', label: '应付账款', level: 0, sortOrder: 3 },
]
function wireFin(companies = [{ id: 1, name: '物业公司', short: '物业' }]) {
  vi.mocked(companyApi.list).mockResolvedValue(companies as never)
  vi.mocked(reportApi.years).mockResolvedValue([{ year: 2025, months: 3 }] as never)
  vi.mocked(reportApi.year).mockResolvedValue({
    year: 2025,
    months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, hasData: i < 3, netPreview: 0 })),
  } as never)
  const period: ReportPeriodDTO = {
    amounts: { '1001': { endDr: 100 }, '1002': { endDr: 200 }, '100201': { endDr: 50 }, '2202': { endCr: 300 } },
    customRows: CUSTOM,
    accounts: ACCOUNTS,
  }
  vi.mocked(reportApi.period).mockResolvedValue({ year: 2025, month: 1, ...period } as never)
}

/** 开屏 → 点第一个月格进正文;edit=true 再点「编辑模式」 */
async function openFin(view: unknown, edit = false) {
  const w = mount(view as never, { global: { stubs: STUBS } })
  await flushPromises()
  await w.findAll('.bmm-card')[0].trigger('click')
  await flushPromises()
  if (edit) {
    await w.find('button.fp-emb').trigger('click')
    await flushPromises()
  }
  return w
}

const FIN = [
  { name: '资产负债表', view: BalanceSheetView },
  { name: '利润表', view: IncomeStatementView },
  { name: '科目余额表', view: TrialBalanceView },
] as const

describe.each(FIN)('$name · 空状态与悬停说明', ({ name, view }) => {
  // 2026-10-03 画布 09 ReportPickEmpty:左栏撤了,「新增公司」进空态(RBAC v4:有「月度台账 · 新增删除公司」才出)
  // 夹具不退化:收走新增删除后仍有公司改名(收款公司)—— 改名权不该让「新增公司」出来
  it('❗一家公司都没有 → FPEmpty 占住内容区:一句 + 副句 + 「新增公司」;没有新增删除公司不出钮', async () => {
    wireFin([])
    const w = mount(view as never, { global: { stubs: STUBS } })
    await flushPromises()
    const e = w.find('.finw-empty .fp-empty')
    expect(e.exists(), '内容区该是 FPEmpty').toBe(true)
    expect(e.find('.t').text()).toBe('还没有管理公司')
    expect(e.find('.sub').text()).toBe(`${name} 按公司 × 年月分期`)
    expect(e.find('.act').text()).toBe('新增公司')
    await e.find('.act button').trigger('click')
    expect((w.vm as unknown as { dlg: unknown }).dlg).toEqual({ type: 'company', mode: 'new' })

    useAuthStore().permissions = [...REPORT_EDITS, 'bill-notices:payee']
    await flushPromises()
    expect(w.find('.finw-empty .fp-empty .act').exists(), '没有新增删除公司不出「新增公司」').toBe(false)
  })

  it('❗「换期」是带字的钮(期间条最左):不靠悬停说明,也没有原生 title', async () => {
    wireFin()
    const w = await openFin(view)
    const back = w.find('.fpb-back')
    expect(back.text()).toBe('换期')
    expect(back.attributes('title')).toBeUndefined()
  })
})

describe.each([
  { name: '资产负债表', view: BalanceSheetView, stmt: 'bs' },
  { name: '利润表', view: IncomeStatementView, stmt: 'is' },
] as const)('$name · 批量删除 / 子类失败回执', ({ view, stmt }) => {
  beforeEach(() => wireFin())

  async function pickCustomAndAsk() {
    const w = await openFin(view, true)
    const tr = w.findAll('tr').find(r => r.text().includes('航泽借款'))!
    await tr.find('.fin-ck').trigger('change')
    await btn(w, '删除所选').trigger('click')
    await flushPromises()
    return w
  }

  it('❗点「删除所选」出 ask(删除类):标题问句、正文给数、主按钮写动作;答「取消」不删,答「删除」才删', async () => {
    const w = await pickCustomAndAsk()
    expect(w.find('.fin-mask').exists(), '不该再有自写确认遮罩').toBe(false)
    expect(askQueue).toHaveLength(1)
    expect(askQueue[0]).toMatchObject({ title: '删除所选 1 行？', action: '删除 1 行', danger: true })
    expect(askQueue[0].body).toBe('自定义行 1 行将删除(含其下子类,立即生效)。')
    answer(false)
    await flushPromises()
    expect(reportApi.deleteCustomRow).not.toHaveBeenCalled()

    await btn(w, '删除所选').trigger('click')
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(reportApi.deleteCustomRow).toHaveBeenCalledWith(stmt, 77)
  })

  it('❗问的这会儿编辑权被收走(权限掉了 → 退编辑态,选集还在):答「删除」也不再删', async () => {
    await pickCustomAndAsk()
    useAuthStore().permissions = ['ledger:company', 'bill-notices:payee']   // 报表编辑收走,公司的两项还在
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(reportApi.deleteCustomRow).not.toHaveBeenCalled()
  })

  it('❗批量删除失败:失败回执,不带重试(半途失败重跑会对删过的行再删)', async () => {
    vi.mocked(reportApi.deleteCustomRow).mockRejectedValue(new Error('服务器没有响应'))
    await pickCustomAndAsk()
    answer(true)
    await flushPromises()
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ tone: 'fail', text: '服务器没有响应' })
    expect(receipts[0].action).toBeUndefined()
  })

  it('❗删子类失败:失败回执带「重试」,重试再删同一行', async () => {
    vi.mocked(reportApi.deleteCustomRow).mockRejectedValue(new Error('服务器没有响应'))
    const w = await openFin(view, true)
    const tr = w.findAll('tr').find(r => r.text().includes('航泽借款'))!
    await tr.find('.custom-x').trigger('click')
    await flushPromises()
    expect(receipts[0]).toMatchObject({ tone: 'fail', text: '服务器没有响应' })
    expect(receipts[0].action?.label).toBe('重试')
    receipts[0].action!.run()
    await flushPromises()
    expect(reportApi.deleteCustomRow).toHaveBeenCalledTimes(2)
    expect(vi.mocked(reportApi.deleteCustomRow).mock.calls[1]).toEqual([stmt, 77])
  })

  it('❗加子类失败:失败回执带「重试」,重试提交同一个名字', async () => {
    vi.mocked(reportApi.addCustomRow).mockRejectedValue(new Error('名字重复'))
    const w = await openFin(view, true)
    const tr = w.findAll('tr').find(r => r.text().includes(stmt === 'bs' ? '货币资金' : '营业收入'))!
    await tr.find('.addchild').trigger('click')
    await flushPromises()
    await w.find('.fin-dlg input.fin-in').setValue('一期租户')
    await btn(w, '添加').trigger('click')
    await flushPromises()
    expect(receipts[0]).toMatchObject({ tone: 'fail', text: '名字重复' })
    receipts[0].action!.run()
    await flushPromises()
    expect(reportApi.addCustomRow).toHaveBeenCalledTimes(2)
    expect(vi.mocked(reportApi.addCustomRow).mock.calls[1][2]).toMatchObject({ parentKey: '1', label: '一期租户' })
  })
})

describe.each([
  { name: '资产负债表', view: BalanceSheetView, exp: () => writeAoaWorkbook },
  { name: '利润表', view: IncomeStatementView, exp: () => exportIncomeStatement },
  { name: '科目余额表', view: TrialBalanceView, exp: () => writeAoaWorkbook },
] as const)('$name · 导出失败', ({ view, exp }) => {
  it('❗导出失败 → 失败回执带「重试」,点了再导一次', async () => {
    wireFin()
    vi.mocked(exp()).mockRejectedValue(new Error('磁盘满了'))
    const w = await openFin(view)
    await btn(w, '导出 Excel').trigger('click')
    await flushPromises()
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ tone: 'fail', text: '磁盘满了' })
    expect(receipts[0].action?.label).toBe('重试')
    receipts[0].action!.run()
    await flushPromises()
    expect(exp()).toHaveBeenCalledTimes(2)
  })
})

// 2026-10-03 画布 11(ImportOne / ImportDone;UI-OVERLAY-SPEC §8):点导入后弹窗不关,内容区换进度,写完原地出结果卡。
// 三屏接法逐字相同(:runner / :describe 都出自 useFinStatementScreen),这里钉的是「屏真把 runner 交给了弹窗」。
// 破坏验证:任一屏把 :runner 换回 @import-sections → 该屏「导入中弹窗不关」与结果卡两句红
describe.each([
  { name: '资产负债表', view: BalanceSheetView, rec: { rowKey: '1', end: 5 }, detail: '1 项 · 1 格' },
  { name: '利润表', view: IncomeStatementView, rec: { rowKey: '1', cur: 1, ytd: 2 }, detail: '1 项 · 2 格' },
  { name: '科目余额表', view: TrialBalanceView, rec: { account: ACCOUNTS[0], amounts: { endDr: 5, openDr: 0 } }, detail: '1 科目 · 1 格' },
] as const)('$name · 导入走弹窗的 runner', ({ view, rec, detail }) => {
  it('❗点导入后弹窗不关;写完重读本期,弹窗里原地出结果卡(分公司明细 + 本期已刷新)', async () => {
    wireFin()
    let done!: (v: unknown) => void
    vi.mocked(runImport).mockReturnValueOnce(new Promise(r => { done = r }) as never)
    const w = await openFin(view, true)
    await btn(w, '导入').trigger('click')
    await flushPromises()
    const modal = w.findComponent(FpImportModal)
    ;(modal.vm as unknown as { onLabelConfirm: (p: unknown[]) => void }).onLabelConfirm([{ label: '物业公司', records: [rec] }])
    await flushPromises()
    expect(runImport).toHaveBeenCalledTimes(1)
    expect(w.find('.fpimp-scrim').exists(), '导入中弹窗不关').toBe(true)
    const before = vi.mocked(reportApi.period).mock.calls.length
    done({ imported: 2, skipped: 0, errors: [] })
    await flushPromises()
    expect(vi.mocked(reportApi.period).mock.calls.length, '写完重读本期').toBe(before + 1)
    expect(w.find('.fpimp-scrim').exists(), '结果卡在弹窗里,弹窗还开着').toBe(true)
    const card = w.find('.irc')
    expect(card.find('h4').text()).toBe('导入完成')
    expect(card.find('.irc-meta').text()).toContain('本期已刷新')
    expect([card.find('.irc-kv span').text(), card.find('.irc-kv b').text()]).toEqual(['物业公司', detail])
    expect(receipts).toHaveLength(0)
  })
})

describe('科目余额表 · 批量删除', () => {
  beforeEach(() => wireFin())

  async function pick1002AndAsk() {
    const w = await openFin(TrialBalanceView, true)
    const tr = w.findAll('table.tb-table tbody tr').find(r => r.text().includes('银行存款'))!
    await tr.find('.tb-ck').trigger('change')
    await btn(w, '删除所选').trigger('click')
    await flushPromises()
    return w
  }
  const countTag = (w: VueWrapper) => w.findAll('.fin-count').map(t => t.text()).find(t => t.endsWith('项'))

  it('❗出 ask(删除类):件数按级联后的行数写;答「取消」科目一个不少,答「删除」连下级一起去掉', async () => {
    const w = await pick1002AndAsk()
    expect(askQueue).toHaveLength(1)
    expect(askQueue[0]).toMatchObject({ title: '删除所选 1 个科目？', action: '删除 2 行', danger: true })
    expect(askQueue[0].body).toContain('合计 2 行')
    answer(false)
    await flushPromises()
    expect(countTag(w)).toBe('3 / 4 项')

    await btn(w, '删除所选').trigger('click')
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(countTag(w)).toBe('2 / 2 项')
  })

  it('❗问的这会儿编辑权被收走:答「删除」也不动科目树', async () => {
    const w = await pick1002AndAsk()
    useAuthStore().permissions = ['ledger:company', 'bill-notices:payee']   // 报表编辑收走,公司的两项还在
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(countTag(w)).toBe('3 / 4 项')
  })

  it('❗表内图标钮的悬停说明挂 v-tip:勾选框 / 展开箭头 / 删科目 都有 aria-label、没有 title', async () => {
    const w = await openFin(TrialBalanceView, true)
    const tr = w.findAll('table.tb-table tbody tr').find(r => r.text().includes('银行存款'))!
    expect(tr.find('.tb-ck').attributes('aria-label')).toBe('选择科目(批量删除)')
    expect(tr.find('.tb-caret').attributes('aria-label')).toBe('展开下级')
    expect(tr.find('.tb-x').attributes('aria-label')).toBe('删除科目(含下级)')
    await tr.find('.tb-caret').trigger('click')
    expect(tr.find('.tb-caret').attributes('aria-label'), '展开后跟着换').toBe('收起下级')
    expect(tr.find('[title]').exists()).toBe(false)
  })
})

// ── 损益附表 ────────────────────────────────────────────────
// 页头换成桩:锁 / 审核 / 提权在 SchedHeader 自己的 spec 里测,这里只要「切编辑」和两个动作插槽
const SchedHeaderStub = defineComponent({
  emits: ['toggle-edit', 'back', 'import'],
  setup(_, { slots, emit }) {
    return () => h('div', { class: 'sh-stub' }, [
      h('button', { class: 'sh-toggle', onClick: () => emit('toggle-edit') }, '切编辑'),
      h('button', { class: 'sh-import', onClick: () => emit('import') }, '打开导入'),
      slots['edit-actions']?.(),
      slots['static-actions']?.(),
    ])
  },
})
// 导入弹窗桩:点「导入这份」= 弹窗调屏给的 runner(真弹窗的进度卡 / 结果卡在 components/import 自己的 spec 里测)
let stubRun: Promise<unknown> | null = null
const ImportStub = defineComponent({
  props: { runner: { type: Function, default: null } },
  emits: ['close'],
  setup(props) {
    const p = {
      from: 0, base: { imported: 0, skipped: 0, errors: [] },
      segDone: vi.fn(), stage: vi.fn(), recording: vi.fn(), refreshing: vi.fn(), note: vi.fn(), kept: vi.fn(),
    }
    return () => h('button', { class: 'imp-go', onClick: () => { stubRun = props.runner?.([{ a: 1 }], '附表1.xlsx', p) ?? null } }, '导入这份')
  },
})
const PNL_ROWS: PnlRowDTO[] = [
  { rowKey: 'r1', groupLabel: '一期', label: '测试细分甲', kind: 'detail', note: null, m: [100, null, 300, null, null, null, null, null, null, null, null, null], sortOrder: 0 },
  { rowKey: 'r2', groupLabel: '二期', label: '测试细分乙', kind: 'detail', note: null, m: [7, 8, null, null, null, null, null, null, null, null, null, 12], sortOrder: 1 },
]
function wirePnl(rows = PNL_ROWS) {
  route.meta = { value: 'rent-pnl', icon: 'trending-up' }
  route.query = { p: '2025' }
  const ov: PnlOverviewDTO = { years: [{ year: 2025, hasData: rows.length > 0, rowCount: rows.length }] }
  const yr: PnlYearDTO = { year: 2025, rows }
  vi.mocked(pnlApi.overview).mockResolvedValue(ov)
  vi.mocked(pnlApi.year).mockResolvedValue(yr)
}
async function openPnl(edit = false) {
  const w = mount(PnlScheduleView, { global: { stubs: { ...STUBS, SchedHeader: SchedHeaderStub, FpImportModal: ImportStub } } })
  await flushPromises()
  if (edit) {
    await w.find('.sh-toggle').trigger('click')
    await flushPromises()
  }
  return w
}
const pnlRows = (w: VueWrapper) => w.findAll('table.pt-table tbody tr').map(r => r.find('.pt-sub-t').text())

describe('损益附表', () => {
  beforeEach(() => wirePnl())

  it('❗批量删除出 ask(删除类);答「取消」行还在,答「删除」才从表里去掉', async () => {
    const w = await openPnl(true)
    await w.findAll('.pt-ck')[0].trigger('change')
    await btn(w, '删除所选').trigger('click')
    await flushPromises()
    expect(w.find('.pnl-mask').exists(), '不该再有自写确认遮罩').toBe(false)
    expect(askQueue).toHaveLength(1)
    expect(askQueue[0]).toMatchObject({ title: '删除所选 1 行？', action: '删除 1 行', danger: true })
    expect(askQueue[0].body).toContain('从 2025 年矩阵中删除')
    answer(false)
    await flushPromises()
    expect(pnlRows(w)).toEqual(['测试细分甲', '测试细分乙'])

    await btn(w, '删除所选').trigger('click')
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(pnlRows(w)).toEqual(['测试细分乙'])
  })

  it('❗新增行不填名字:字段下面出红字(.fp-field-err),不走回执', async () => {
    const w = await openPnl(true)
    await btn(w, '新增行').trigger('click')
    await w.findAll('.pnl-dlg .pnl-btn').find(b => b.text().includes('新增'))!.trigger('click')
    expect(w.find('.pnl-dlg .fp-field-err').text()).toBe('请输入科目细分名称')
    expect(receipts).toHaveLength(0)
  })

  it('❗保存失败 → 失败回执带「重试」,重试再存一次', async () => {
    vi.mocked(pnlApi.save).mockRejectedValue(new Error('服务器没有响应'))
    const w = await openPnl(true)
    const cell = w.findAll('.pt-in')[1]
    ;(cell.element as HTMLInputElement).value = '55'
    await cell.trigger('change')                          // 表格格子认 change(失焦提交)
    await w.find('.sh-toggle').trigger('click')            // 有改动 → 保存确认
    await flushPromises()
    await w.findAll('.scd-scrim button').find(b => b.text().includes('保存'))!.trigger('click')
    await flushPromises()
    expect(receipts[0]).toMatchObject({ tone: 'fail', text: '服务器没有响应' })
    receipts[0].action!.run()
    await flushPromises()
    expect(pnlApi.save).toHaveBeenCalledTimes(2)
  })

  // 2026-10-03 起导入点下去弹窗不关(画布 11;UI-OVERLAY-SPEC §8):onImport 是弹窗的 runner;
  // 失败在弹窗里原地出失败卡(「返回修改」再导),不再出回执。
  // 破坏验证:FpImportModal 换回 @import(不给 :runner)→ stubRun 为空,resolves 那句红;
  //          onImport 里留着 importing = false → 「导入中弹窗不关」红;settle 里不刷 → 「刷新本年」红;包回 try/catch + 回执 → rejects 红
  it('❗导入是弹窗的 runner:跑着时弹窗不关,写完刷新本年再交结果;失败抛给弹窗,不出回执', async () => {
    let done!: (v: unknown) => void
    vi.mocked(runImport).mockReturnValueOnce(new Promise(r => { done = r }) as never)
    const w = await openPnl()
    await w.find('.sh-import').trigger('click')
    await w.find('.imp-go').trigger('click')
    await flushPromises()
    expect(vi.mocked(runImport).mock.calls[0].slice(0, 2)).toEqual(['pnl_s1', [{ a: 1 }]])
    expect(w.find('.imp-go').exists(), '导入中弹窗不关').toBe(true)
    const before = vi.mocked(pnlApi.year).mock.calls.length
    done({ imported: 2, skipped: 0, errors: [] })
    await expect(stubRun).resolves.toMatchObject({ imported: 2, refreshed: true })
    expect(vi.mocked(pnlApi.year).mock.calls.length, '写完刷新本年').toBe(before + 1)
    expect(w.find('.imp-go').exists(), '结果卡在弹窗里,弹窗还开着').toBe(true)

    vi.mocked(runImport).mockRejectedValueOnce(new Error('表头对不上'))
    await w.find('.imp-go').trigger('click')
    await expect(stubRun).rejects.toThrow('表头对不上')
    expect(receipts, '失败交给弹窗的失败卡').toHaveLength(0)
  })

  it('❗导出失败 → 失败回执带「重试」', async () => {
    vi.mocked(writeAoaWorkbook).mockRejectedValue(new Error('磁盘满了'))
    const w = await openPnl()
    await btn(w, '导出').trigger('click')
    await flushPromises()
    expect(receipts[0]).toMatchObject({ tone: 'fail', text: '磁盘满了' })
    receipts[0].action!.run()
    await flushPromises()
    expect(writeAoaWorkbook).toHaveBeenCalledTimes(2)
  })

  it('❗空年 → FPEmpty;编辑态带「新增行」按钮,浏览态不带', async () => {
    wirePnl([])
    const w = await openPnl()
    const e = w.find('.pt-wrap .fp-empty')
    expect(e.find('.t').text()).toBe('2025年 暂无数据')
    expect(e.find('button').exists(), '浏览态不该有写入口').toBe(false)
    await w.find('.sh-toggle').trigger('click')
    await flushPromises()
    await w.find('.pt-wrap .fp-empty button').trigger('click')
    await flushPromises()
    expect(w.find('.pnl-dlg h3').text(), '「新增行」该打开新增行弹窗').toBe('新增行')
  })

  // 2026-10-05 用户拍板「按你建议修改」:一年数据都没有(新园区空库)时年份层「最新」标今年;有数据照旧标最大数据年,不看时钟。
  // 本文件 beforeEach 把时钟钉在 2025-06-15
  it('❗年份层「最新」:有数据 → 最大数据年(时钟不参与);一年数据都没有 → 今年,不是后端给的明年', async () => {
    route.query = {}
    const cur = (w: VueWrapper) => w.find('.sm-ycard.cur .sm-yc-year').text()
    vi.mocked(pnlApi.overview).mockResolvedValue({ years: [
      { year: 2024, hasData: true, rowCount: 3 }, { year: 2025, hasData: false, rowCount: 0 }, { year: 2026, hasData: false, rowCount: 0 }] })
    let w = await openPnl()
    expect(cur(w)).toBe('2024年')
    w.unmount()
    vi.mocked(pnlApi.overview).mockResolvedValue({ years: [
      { year: 2025, hasData: false, rowCount: 0 }, { year: 2026, hasData: false, rowCount: 0 }] })
    w = await openPnl()
    expect(cur(w)).toBe('2025年')
  })
})

// ── 收入核对工作台 ───────────────────────────────────────────
const ent = (tenantName: string, over: Partial<ReconEntity> = {}): ReconEntity => ({
  tenantId: 1, tenantName, status: 'diff', ledgerTotal: 1000, s10Total: 900, diff: 100,
  marked: false, markNote: null,
  fees: [{ key: 'rent', label: '租金', ledgerAmt: 1000, s10Amt: 900, delta: 100, onlySide: null }],
  ledgerCards: [{ companyName: '物业公司', total: 1000, fees: { rent: 1000 } }],
  s10Cards: [{ phase: 1, total: 900, fees: { rent: 900 } }],
  ...over,
})
const mountWb = (entities: ReconEntity[]) =>
  mount(ReconWorkbench, { props: { year: 2025, month: 3, entities }, global: { stubs: STUBS } })

describe('收入核对工作台', () => {
  it('❗搜不到 → 清单区 FPEmpty「无匹配租户」;一户都没有 → 右栏 FPEmpty「该月无核对实体」', async () => {
    const w = mountWb([ent('甲公司')])
    await w.find('.rc-search input').setValue('不存在')
    expect(w.find('.rc-list .fp-empty .t').text()).toBe('无匹配租户')

    const empty = mountWb([])
    expect(empty.find('.rc-detail .fp-empty .t').text()).toBe('该月无核对实体')
  })

  it('❗标记失败 → 失败回执带「重试」;弹窗关了、换到别的户再点重试,标的还是原来那户、那句备注', async () => {
    vi.mocked(reconApi.mark).mockRejectedValueOnce(new Error('服务器没有响应')).mockResolvedValue(undefined)
    const w = mountWb([ent('甲公司'), ent('乙公司', { tenantId: 2 })])
    await w.find('.rc-dtitle .bbtn').trigger('click')            // 甲公司(默认选中第一户)
    await w.find('.rc-pop textarea').setValue('甲的差额是押金')
    await w.find('.rc-pop-confirm').trigger('click')
    await flushPromises()
    expect(receipts[0]).toMatchObject({ tone: 'fail', text: '服务器没有响应' })
    expect(receipts[0].action?.label).toBe('重试')

    await w.find('.rc-mask').trigger('mousedown')                 // 关弹窗
    await w.findAll('.rc-li').find(li => li.text().includes('乙公司'))!.trigger('click')
    receipts[0].action!.run()
    await flushPromises()
    expect(vi.mocked(reconApi.mark).mock.calls[1][2]).toEqual({ tenantName: '甲公司', tenantId: 1, note: '甲的差额是押金' })
    expect(w.emitted('patch')?.[0]).toEqual(['甲公司', true, '甲的差额是押金'])
  })

  it('❗标记失败后期间条换了月(同一个工作台换 props):再点重试不标 —— 不往别的月上写', async () => {
    vi.mocked(reconApi.mark).mockRejectedValueOnce(new Error('服务器没有响应')).mockResolvedValue(undefined)
    const w = mountWb([ent('甲公司')])
    await w.find('.rc-dtitle .bbtn').trigger('click')
    await w.find('.rc-pop-confirm').trigger('click')
    await flushPromises()
    await w.setProps({ month: 4 })
    receipts[0].action!.run()
    await flushPromises()
    expect(reconApi.mark).toHaveBeenCalledTimes(1)
  })

  it('❗返回钮挂 v-tip:aria-label「返回月份」,没有 title', () => {
    const back = mountWb([ent('甲公司')]).find('.rc-back')
    expect(back.attributes('title')).toBeUndefined()
    expect(back.attributes('aria-label')).toBe('返回月份')
  })
})

// ── 源码形状:本批 9 个文件 ─────────────────────────────────────
// 浏览器自带的弹框与 title 小框一个不留;原来那几句悬停说明一句不丢(搬到 v-tip 上)。
const SRC = join(__dirname, '..', '..', '..')
const FILES: Record<string, string[]> = {
  // 三大报表:标题旁那颗「← 返回选期矩阵」图标钮 2026-10-03 撤了,回矩阵走期间条最左的「‹ 换期」(带字,不要悬停)
  'views/reports/balance-sheet/BalanceSheetView.vue': [],
  'views/reports/income-statement/IncomeStatementView.vue': [],
  'views/reports/trial-balance/TrialBalanceView.vue': [],
  'views/reports/trial-balance/TbTable.vue': ['选择科目(批量删除)', '收起下级', '展开下级', '删除科目(含下级)'],
  'views/reports/pnl/PnlScheduleView.vue': [],
  'views/reports/pnl/PnlTable.vue': ['选择该行(批量删除)', 'r.groupLabel', 'badges[r.rowKey].title', '从数据层派生值填入空格(不覆盖已录)'],
  'views/reports/recon/ReconView.vue': ['上一年', '下一年'],
  'views/reports/recon/ReconWorkbench.vue': ['返回月份'],
  'views/reports/home/ReportsHomeView.vue': ['打印即将上线', '导出即将上线'],
}
const TAG = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g

describe.each(Object.entries(FILES))('源码 · %s', (rel, tips) => {
  const src = readFileSync(join(SRC, rel), 'utf8')
  const tpl = src.slice(src.indexOf('<template>'), src.lastIndexOf('</template>'))

  it('没有 window.confirm / alert,也没有裸 confirm( / alert(', () => {
    expect(src).not.toMatch(/\b(?:window\.)?(?:confirm|alert)\(/)
  })

  it('原生标签与 ds/Button 上没有 title=(声明了 title prop 的组件除外)', () => {
    const bad = [...tpl.matchAll(TAG)]
      .filter(([, tag, attrs]) => (/^[a-z]/.test(tag) || tag === 'Button') && /\s:?title=/.test(attrs))
      .map(([m]) => m.slice(0, 80))
    expect(bad).toEqual([])
  })

  it.skipIf(!tips.length)('原来的悬停说明都搬到了 v-tip 上', () => {
    const vtips = [...tpl.matchAll(/v-tip="([^"]*)"/g)].map(m => m[1])
    for (const t of tips) expect(vtips.some(v => v.includes(t)), `少了「${t}」`).toBe(true)
  })
})
