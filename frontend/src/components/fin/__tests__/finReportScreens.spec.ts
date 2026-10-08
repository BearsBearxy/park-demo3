// 三大报表 · 画布 09(2026-10-03)逐格:公司下拉进期间条、KPI 撤掉、页底说明行撤掉(口径挂合计行悬停)、
// 资产负债表一张成对表、科目余额表树与固定列、ReportStates 各状态签逐字。
// 夹具不退化:三家公司名各不相同;金额有正有负有 0;资产负债表故意差 1,000.00、科目余额表故意差 2,000.00。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { useAuthStore } from '@/stores/auth'
import IncomeStatementView from '@/views/reports/income-statement/IncomeStatementView.vue'
import BalanceSheetView from '@/views/reports/balance-sheet/BalanceSheetView.vue'
import TrialBalanceView from '@/views/reports/trial-balance/TrialBalanceView.vue'
import { companyApi } from '@/api/ledger'
import { reportApi } from '@/api/report'
import { reviewApi } from '@/api/review'
import { stubWideTable } from '@/composables/__tests__/wideTableStub'
import type { ReviewRow } from '@/types/review'

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
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {}, meta: {}, get fullPath() { return '/x' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

const STUBS = { Teleport: true, RouterLink: true, 'router-link': true }
const COMPANIES = [
  { id: 1, name: '创显', short: '创' }, { id: 2, name: '帮管好', short: '帮' }, { id: 3, name: '一泽', short: '一' },
]
const tipOf = (el: Element) => (el as HTMLElement & { _tip?: { text: string } })._tip?.text
const SRC = (rel: string) => readFileSync(join(__dirname, '../../..', rel), 'utf8')

// ── 夹具 ──
const IS_AMOUNTS = {
  '1': { cur: 2000881.85, ytd: 23215887.17 }, '2': { cur: 2940770.57, ytd: 29015530.53 },
  '3': { cur: 137533.28, ytd: 1270178.46 }, '9': { cur: 137533.28, ytd: 1270178.46 },
  '14': { cur: 407215.08, ytd: 3490278.61 },
}
// 资产 1 = 货币资金 292,259.39 + 应收账款 … ;负债 31 短期借款;权益 48。故意让资产比负债 + 权益多 1,000.00
const BS_AMOUNTS = {
  '1': { end: 292259.39 }, '4': { end: 27482403.53 }, '10': { end: 5000 },
  '31': { end: 20000000 }, '36': { end: -12602461.47 }, '48': { end: 20376124.39 },
}
const TB_ACCOUNTS = [
  { rowKey: '1001', parentKey: null, code: '1001', label: '现金', level: 0, sortOrder: 0 },
  { rowKey: '1002', parentKey: null, code: '1002', label: '银行存款', level: 0, sortOrder: 1 },
  { rowKey: '100201', parentKey: '1002', code: '100201', label: '农商行太行支行（09683）', level: 1, sortOrder: 2 },
  { rowKey: '2121', parentKey: null, code: '2121', label: '应付账款', level: 0, sortOrder: 3 },
]
// 期末借方合计 36,956.34 + 295,905.87 = 332,862.21;贷方 24,525.00 + 306,337.21 → 故意让借方多 2,000.00
const TB_AMOUNTS = {
  '1001': { openDr: 35799.12, periodDr: 61000, periodCr: 59842.78, endDr: 36956.34 },
  '1002': { openDr: 234267.62, endDr: 295905.87 },
  '100201': { openDr: 234267.62, endDr: 295905.87 },
  '2121': { openCr: 24525, endCr: 330862.21 },
}

function wire(stmt: 'is' | 'bs' | 'tb', amounts?: Record<string, Record<string, number>>) {
  vi.mocked(companyApi.list).mockResolvedValue(COMPANIES as never)
  vi.mocked(reportApi.years).mockResolvedValue([{ year: 2025, months: 3 }] as never)
  vi.mocked(reportApi.year).mockResolvedValue({
    year: 2025, months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, hasData: i < 3, netPreview: 99999 })),
  } as never)
  const am = amounts ?? (stmt === 'is' ? IS_AMOUNTS : stmt === 'bs' ? BS_AMOUNTS : TB_AMOUNTS)
  const p = { year: 2025, month: 1, customRows: [], amounts: am, accounts: stmt === 'tb' ? TB_ACCOUNTS : undefined }
  vi.mocked(reportApi.period).mockResolvedValue(p as never)
  vi.mocked(reportApi.allPeriod).mockResolvedValue(p as never)
}

async function openBody(view: unknown, edit = false) {
  const w = mount(view as never, { global: { stubs: STUBS }, attachTo: document.body })
  await flushPromises()
  await w.findAll('.bmm-card')[0].trigger('click')
  await flushPromises()
  if (edit) {
    await w.find('button.fp-emb').trigger('click')
    await flushPromises()
  }
  return w
}
const actions = (w: VueWrapper) => w.findAll('.fh-r button, .fh-r .fp-emb-rv').map(b => b.text().replace(/\s+/g, ' ').trim()).filter(Boolean)

beforeEach(() => {
  setActivePinia(createPinia())
  // v3 的 master:edit + report:edit 落到 v4:三张报表各自的编辑 + 公司新增删除(月度台账)+ 公司改名(催缴单收款公司)
  useAuthStore().permissions = [...FIN_PERMS]
  vi.clearAllMocks()
  localStorage.clear()
  vi.setSystemTime(new Date('2025-06-15T00:00:00'))
  // clearAllMocks 不清实现:「已审核」那条塞的审核行会漏到后面的用例
  vi.mocked(reviewApi.states).mockResolvedValue([] as never)
  vi.mocked(reviewApi.list).mockResolvedValue([] as never)
})
afterEach(() => { document.body.innerHTML = '' })

const EDIT = { is: 'income-statement:edit', bs: 'balance-sheet:edit', tb: 'trial-balance:edit' } as const
const FIN_PERMS = [...Object.values(EDIT), 'ledger:company', 'bill-notices:payee']
const footBtns = async (w: VueWrapper) => {
  await w.find('.fpb .fcm-btn').trigger('click')
  return w.findAll('.fcm-foot button').map(b => b.text())
}

const VIEWS = [
  { name: '利润表', view: IncomeStatementView, stmt: 'is' as const, rel: 'views/reports/income-statement/IncomeStatementView.vue' },
  { name: '资产负债表', view: BalanceSheetView, stmt: 'bs' as const, rel: 'views/reports/balance-sheet/BalanceSheetView.vue' },
  { name: '科目余额表', view: TrialBalanceView, stmt: 'tb' as const, rel: 'views/reports/trial-balance/TrialBalanceView.vue' },
]

describe.each(VIEWS)('$name · 期间条 / 公司下拉 / 撤掉的东西', ({ name, view, stmt, rel }) => {
  beforeEach(() => wire(stmt))

  it('❗期间条:「‹ 换期」+ 期 + 公司下拉 + 步骤条(九步);左栏、KPI 卡、页底说明行都没了', async () => {
    const w = await openBody(view)
    expect(w.find('.fpb-back').text()).toBe('换期')
    expect(w.find('.fpb-period').text()).toBe('2025-01')
    expect(w.find('.fpb .fcm-btn .fcm-cur').text()).toBe('创显')
    expect(w.findAll('.fpb .fss-step')).toHaveLength(9)
    expect(w.find('.finw-rail').exists()).toBe(false)
    expect(w.find('.fin-kpis').exists()).toBe(false)
    expect(w.find('.fin-foot').exists()).toBe(false)
    // 卡头左「N 项」、右「单位：元」
    expect(w.find('.fc-unit').text()).toBe('单位：元')
    const src = SRC(rel)
    expect(src).not.toMatch(/KpiCard|fin-foot|iconFor\('info'\)|BookRail/)
  })

  // 破坏验证:FinPeriodBar 的 :locked="edit" 去掉 → 编辑态还有下拉,红
  it('❗编辑中:期间条没有「换期」,公司名是纯文字(换公司会丢草稿)', async () => {
    const w = await openBody(view, true)
    expect(w.find('.fpb-back').exists()).toBe(false)
    expect(w.find('.fpb .fcm-btn').exists()).toBe(false)
    expect(w.find('.fpb .fcm-name').text()).toBe('创显')
  })

  it('❗全部汇总:标题旁「3 家合计 · 只读」,按钮只剩「导出 Excel」,步骤条只剩三大报表三步', async () => {
    const w = await openBody(view)
    await w.find('.fpb .fcm-btn').trigger('click')
    await w.findAll('.fcm-it')[0].trigger('click')
    await flushPromises()
    expect(reportApi.allPeriod).toHaveBeenCalledWith(stmt, 2025, 1)
    expect(w.find('.fh-l .fp-state').text()).toBe('3 家合计 · 只读')
    expect(actions(w)).toEqual(['导出 Excel'])
    expect(w.findAll('.fpb .fss-step').map(s => s.text())).toEqual(['利润表', '资产负债表', '科目余额表'])
  })

  // 破坏验证:FinHead 的「本月未录入」改成 v-if="false" → 红
  it('❗本月未录入:标题旁签「本月未录入」;按钮只剩导出 + 编辑模式(不画交审)', async () => {
    wire(stmt, {})
    const w = await openBody(view)
    expect(w.find('.fh-l .fp-state').text()).toBe('本月未录入')
    expect(actions(w)).toEqual(['导出 Excel', '编辑模式'])
  })

  it('❗录了数:按钮是 导出 Excel · 交审 1 月 · 编辑模式', async () => {
    const w = await openBody(view)
    expect(actions(w)).toEqual(['导出 Excel', '交审 1 月', '编辑模式'])
  })

  // RBAC v4(2026-10-09,RBAC-SPEC §15.7):三张报表的编辑各是一项。夹具不退化:另两张报表的编辑都有,唯独没有本屏的。
  // 破坏验证:useFinStatementScreen 的 editPerm 改回一把通用键 / 写死成利润表 → 红
  it('❗编辑按本屏:另两张报表的编辑都有、本屏没有 → 没有「编辑模式」,也不画交审', async () => {
    useAuthStore().permissions = [...VIEWS.filter(v => v.stmt !== stmt).map(v => EDIT[v.stmt]), 'ledger:company', 'bill-notices:payee']
    const w = await openBody(view)
    expect(actions(w)).toEqual(['导出 Excel'])
  })

  // 公司不归报表:新增 / 删除挂「月度台账 · 新增删除公司」,改名挂「催缴单 · 收款公司」(后端写规则 §15.5.2 #33 / #34)。
  // 破坏验证:FinCompanyMenu 三颗任一条的 v-if 换成另一项 / 去掉 → 对应那段红;底栏 v-if 只认 canAddDel → 第一段红
  it('❗公司下拉底部各看各的:只有收款公司 → 只有「重命名」;只有新增删除公司 → 「新增公司」「删除」', async () => {
    useAuthStore().permissions = [EDIT[stmt], 'bill-notices:payee']
    let w = await openBody(view)
    expect(await footBtns(w)).toEqual(['重命名'])
    w.unmount()
    useAuthStore().permissions = [EDIT[stmt], 'ledger:company']
    w = await openBody(view)
    expect(await footBtns(w)).toEqual(['新增公司', '删除'])
    w.unmount()
    useAuthStore().permissions = [EDIT[stmt]]
    w = await openBody(view)
    expect(await footBtns(w), '两项都没有:不出底栏').toEqual([])
  })

  // 破坏验证:loadPeriod 的 catch 去掉 → 一直转圈,红
  it(`❗加载失败:内容区 FPLoadError「2025 年 1 月的${name}没读到」;编辑入口同宽禁用,悬停「本期没读到，不能编辑」`, async () => {
    vi.mocked(reportApi.period).mockRejectedValueOnce(new Error('500'))
    const w = await openBody(view)
    const e = w.find('.finw-empty .fp-empty.error')
    expect(e.find('.t').text()).toBe(`2025 年 1 月的${name}没读到`)
    expect(e.find('.sub').text()).toBe('屏上不显示上一次读到的数字')
    expect(actions(w)).toEqual(['编辑模式'])
    expect(w.find('button.fp-emb').attributes('disabled')).toBeDefined()
    expect(tipOf(w.find('.fh-eb').element)).toBe('本期没读到，不能编辑')
    // 重试 = 再读一次
    await e.find('button').trigger('click')
    await flushPromises()
    expect(w.find('.fp-empty.error').exists()).toBe(false)
    expect(w.find('.fh-eb').exists() && tipOf(w.find('.fh-eb').element)).toBeFalsy()
  })

  it('❗编辑中:标题旁「编辑中 · N 处改动」随改动数走;右侧 导入 · ··· · 取消 · 保存(导出降进 ···)', async () => {
    const w = await openBody(view, true)
    expect(w.find('.fh-l .fp-state.edit').text()).toBe('编辑中 · 0 处改动')
    const btns = actions(w).filter(t => t !== '')
    expect(btns[0]).toBe('导入')
    expect(btns.slice(-2)).toEqual(['取消', '保存'])
    expect(w.find('.fh-r .fp-more-btn').exists(), '··· 在').toBe(true)
    expect(btns).not.toContain('导出 Excel')
    const inp = w.find('input.fin-ni')
    await inp.setValue('123')
    await flushPromises()
    expect(w.find('.fh-l .fp-state.edit').text()).toBe('编辑中 · 1 处改动')
    expect(w.find('input.fin-ni').classes(), '改过的格浅蓝底').toContain('chg')
  })

  it('❗已审核:按钮位是灰药丸「已审核 · …」,没有交审', async () => {
    const row: ReviewRow = {
      key: `report-${stmt}:1:2025-01`, kind: `report-${stmt}`, scope: '1', status: 'approved',
      submittedBy: 'zhangsan', submittedAt: null, reviewedBy: '李审', reviewedAt: '2025-10-28T10:00:00', reason: null, blockedBy: [],
    }
    vi.mocked(reviewApi.states).mockResolvedValue([row] as never)
    vi.mocked(reviewApi.list).mockResolvedValue([row] as never)
    const w = await openBody(view)
    await flushPromises()
    const pill = w.find('.fh-r .fp-emb-rv')
    expect(pill.text()).toContain('已审核')
    expect(actions(w).some(t => t.startsWith('交审'))).toBe(false)
  })

  it('❗选期矩阵:标题「表名 • [公司 ▾]」;月卡不放金额(netPreview 再大也不出),空卡写「–」', async () => {
    const w = mount(view as never, { global: { stubs: STUBS } })
    await flushPromises()
    expect(w.find('.finw-title').text()).toContain(`${name}•创显`)
    expect(w.findAll('.bmm-count')).toHaveLength(0)
    expect(w.findAll('.bmm-card')[5].find('.bmm-none').text()).toBe('–')
    expect(w.text()).not.toContain('99,999')
  })
})

describe('利润表 · 表体', () => {
  beforeEach(() => wire('is'))

  it('❗「其中」父项是分组行「营业税金及附加 其中 6 项」,默认收起;「其中：」那条信息行不画', async () => {
    const w = await openBody(IncomeStatementView)
    const g = w.findAll('tbody tr').find(r => r.text().includes('营业税金及附加'))!
    expect(g.find('.fin-tagt').text()).toBe('其中 6 项')
    expect(w.text()).not.toContain('城市维护建设税')
    expect(w.findAll('tbody .fin-lt').map(e => e.text())).not.toContain('其中：')
    await g.find('.fin-caret').trigger('click')
    expect(w.text()).toContain('城市维护建设税')
  })

  // 破坏验证:NET_TIP 的 v-tip 删掉 → 红
  it('❗净利润贴底(tfoot),负数红;口径挂在「净利润」名称的悬停上;0 写「–」', async () => {
    const w = await openBody(IncomeStatementView)
    const f = w.get('tfoot')
    expect(f.find('.fin-foot-l').text()).toBe('四、净利润（净亏损以"-"号填列）')
    expect(tipOf(f.find('.fin-foot-l').element)).toContain('净利润 = 利润总额 − 所得税费用')
    expect(f.find('.fin-nv').classes()).toContain('neg')
    const r = w.findAll('tbody tr').find(x => x.text().includes('加：投资收益'))!
    expect(r.findAll('.fin-nv').map(e => e.text())).toEqual(['–', '–'])
    expect(w.findAll('thead th.k').map(e => e.text())).toEqual(['本月金额'])
  })
})

describe('资产负债表 · 一张成对表', () => {
  beforeEach(() => wire('bs'))

  it('❗第一行是两边段头「流动资产 10 项 · 合计 15」‖「流动负债 10 项 · 合计 41」;合计行不在原位', async () => {
    const w = await openBody(BalanceSheetView)
    const first = w.findAll('tbody tr')[0]
    const c1 = first.findAll('td.fin-c1')
    expect(c1.map(c => c.find('.fin-lt').text())).toEqual(['流动资产', '流动负债'])
    expect(c1.map(c => c.find('.fin-tagt').text())).toEqual(['10 项 · 合计', '10 项 · 合计'])
    expect(first.findAll('.fin-no').map(e => e.text())).toEqual(['15', '41'])
    expect(w.findAll('tbody .fin-lt').map(e => e.text())).not.toContain('流动资产合计')
    expect(w.find('.fin-table.pair').exists()).toBe(true)
    // 「非流动资产 13 项 · 合计」(固定资产账面价值 20 也算一项)
    const nc = w.findAll('tbody td.fin-c1').find(c => c.find('.fin-lt').text() === '非流动资产')!
    expect(nc.find('.fin-tagt').text()).toBe('13 项 · 合计')
  })

  it('❗存货「其中 4 项（明细，不另加进合计）」默认收起;负债合计 47 是小计行', async () => {
    const w = await openBody(BalanceSheetView)
    const inv = w.findAll('tbody td.fin-c1').find(c => c.find('.fin-lt').text() === '存货')!
    expect(inv.find('.fin-tagt').text()).toBe('其中 4 项（明细，不另加进合计）')
    expect(w.text()).not.toContain('其中：原材料')
    await inv.find('.fin-caret').trigger('click')
    expect(w.text()).toContain('其中：原材料')
    const liab = w.findAll('tbody td.fin-c1').find(c => c.find('.fin-lt').text() === '负债合计')!
    expect(liab.classes()).toContain('sub')
  })

  // 破坏验证:footMark 两边写反 → 红
  it('❗资产 ≠ 负债 + 权益:标题旁红签「资产 ≠ 负债 + 权益 · 差 1,000.00」;贴底行资产那边「● 多 1,000.00」,另一边只给点', async () => {
    const w = await openBody(BalanceSheetView)
    const bad = w.find('.fh-l .fp-state.fh-bad')
    expect(bad.text()).toBe('资产 ≠ 负债 + 权益 · 差 1,000.00')
    const f = w.get('tfoot tr')
    expect(f.findAll('.fin-foot-l').map(e => e.text())).toEqual(['资产总计', '负债和所有者权益（或股东权益）总计'])
    expect(f.findAll('.fin-no').map(e => e.text())).toEqual(['30', '53'])
    expect(f.findAll('.fin-mark').map(e => e.text())).toEqual(['多 1,000.00', ''])
    expect(tipOf(f.find('.fin-foot-l').element)).toContain('期末资产总计应等于负债合计与所有者权益合计之和')
    // 普通行负数也红(应交税费)
    const tax = w.findAll('tbody td.fin-c1').find(c => c.find('.fin-lt').text() === '应交税费')!
    expect(tax.element.parentElement!.querySelector('td:nth-child(6) .fin-nv')!.className).toContain('neg')
  })

  it('平了就没有红签也没有就地标', async () => {
    wire('bs', { '1': { end: 100 }, '48': { end: 100 } })
    const w = await openBody(BalanceSheetView)
    expect(w.find('.fh-bad').exists()).toBe(false)
    expect(w.find('.fin-mark').exists()).toBe(false)
  })
})

describe('科目余额表 · 树 / 关键列 / 固定列', () => {
  beforeEach(() => wire('tb'))

  it('❗树:按实际深度缩进,父级「1 个下级」+ 折叠箭头,默认收起,展开后子级缩进一级', async () => {
    const w = await openBody(TrialBalanceView)
    const rows = () => w.findAll('table.tb-table tbody tr')
    expect(rows().map(r => r.find('.tb-name').text())).toEqual(['现金', '银行存款', '应付账款'])
    const p = rows()[1]
    expect(p.find('.tb-kids').text()).toBe('1 个下级')
    expect(rows()[0].find('.tb-kids').exists()).toBe(false)
    await p.find('.tb-caret').trigger('click')
    expect(rows().map(r => r.find('.tb-name').text())).toEqual(['现金', '银行存款', '农商行太行支行（09683）', '应付账款'])
    expect((rows()[1].find('.tb-label').element as HTMLElement).style.paddingLeft).toBe('12px')
    expect((rows()[2].find('.tb-label').element as HTMLElement).style.paddingLeft).toBe('26px')
  })

  // 破坏验证:b 条件改成 isEnd(f.key)(不看有没有数)→ 2121 的期末借方「–」也加粗,红
  it('❗期末两列浅蓝底;那一对里有数的那一格加粗(1001 是借方、2121 是贷方),「–」与期初本期都不加粗', async () => {
    const w = await openBody(TrialBalanceView)
    const r = (code: string) => w.findAll('table.tb-table tbody tr').find(x => x.find('.tb-code').text() === code)!
    const nv = (code: string) => r(code).findAll('.fin-nv')
    // 8 列:openDr openCr periodDr periodCr ytdDr ytdCr endDr endCr
    expect(nv('1001').map(e => e.classes().includes('b'))).toEqual([false, false, false, false, false, false, true, false])
    expect(nv('2121').map(e => e.classes().includes('b'))).toEqual([false, false, false, false, false, false, false, true])
    expect(nv('2121')[6].text()).toBe('–')
    expect(r('1001').findAll('td.k')).toHaveLength(2)
    expect(w.findAll('thead th.k').map(e => e.text())).toEqual(['借方', '贷方'])
  })

  it('❗期末借贷不平:红签「期末借贷不平 · 差 2,000.00」;合计行期末借方那一格就地标「● 多 2,000.00」;合计名称挂口径悬停', async () => {
    const w = await openBody(TrialBalanceView)
    expect(w.find('.fh-l .fp-state.fh-bad').text()).toBe('期末借贷不平 · 差 2,000.00')
    const marks = w.findAll('tfoot .tb-mark')
    expect(marks).toHaveLength(1)
    expect(marks[0].text()).toBe('多 2,000.00')
    expect(marks[0].element.closest('td')!.parentElement!.children[8]).toBe(marks[0].element.closest('td'))
    expect(tipOf(w.find('tfoot .tb-foot-l').element)).toContain('合计行 = 一级科目逐列求和')
    expect(w.find('.fin-count').text()).toBe('3 / 4 项')
  })

  it('❗编辑中:「新增科目」在标题行(导入后面),点开新增科目弹窗', async () => {
    const w = await openBody(TrialBalanceView, true)
    expect(actions(w).slice(0, 2)).toEqual(['导入', '新增科目'])
    const b = w.findAll('.fh-r button').find(x => x.text() === '新增科目')!
    await b.trigger('click')
    expect(w.text()).toContain('在当前期科目表中新增一个科目')
  })
})

describe('科目余额表 · 固定列(LIST-PAGE §9.1,画布 ReportTB-1366)', () => {
  let stub: ReturnType<typeof stubWideTable>
  // 借贷平(合计行没有「多 x」就地标):就地标会把期末借方撑宽,1066 下连它也得退 —— 那是另一条路径
  beforeEach(() => { wire('tb', { ...TB_AMOUNTS, '2121': { openCr: 24525, endCr: 332862.21 } }); stub = stubWideTable('fin-wrap') })
  afterEach(() => stub.restore())

  const px = (el: Element) => (el as HTMLElement).style
  // 破坏验证:cols 里 endCr 的 rank 改成 1、endDr 改成 2 → 退的是期末借方,红
  it('❗窄(可见 1066):钉代码 + 名称(left 0 / 代码宽)与期末借方(right 0);期末贷方原地变普通列;表头并成一层写全名', async () => {
    stub.size(1066, 600)
    const w = await openBody(TrialBalanceView)
    await stub.fire(1066, 600)
    const tr = w.findAll('table.tb-table tbody tr')[0]
    const td = tr.findAll('td')
    expect(px(td[0].element).position).toBe('sticky')
    expect(px(td[0].element).left).toBe('0px')
    const codeW = parseInt((w.find('thead th.tb-c').element as HTMLElement).style.minWidth)
    expect(px(td[1].element).left).toBe(`${codeW}px`)
    expect(px(td[8].element).position).toBe('sticky')       // 期末借方
    expect(px(td[8].element).right).toBe('0px')
    expect(px(td[9].element).position, '期末贷方不固定').toBe('')
    expect(w.findAll('thead tr')).toHaveLength(1)
    expect(w.findAll('thead th:not(.fp-fill)').map(e => e.text())).toEqual(
      ['科目代码', '科目名称', '期初借方', '期初贷方', '本期借方', '本期贷方', '本年借方', '本年贷方', '期末借方', '期末贷方'])
  })

  it('❗宽(可见 1600):四根都放得下,两层表头;期末借方贴在期末贷方左边(right = 贷方宽)', async () => {
    stub.size(1600, 800)
    const w = await openBody(TrialBalanceView)
    await stub.fire(1600, 800)
    expect(w.findAll('thead tr')).toHaveLength(2)
    expect(w.findAll('thead tr')[0].findAll('th').map(e => e.text())).toEqual(['科目代码', '科目名称', '期初余额', '本期发生额', '本年累计发生额', '期末余额', ''])
    const td = w.findAll('table.tb-table tbody tr')[0].findAll('td')
    const crW = parseInt((w.findAll('thead th.h2')[7].element as HTMLElement).style.minWidth)
    expect(px(td[9].element).right).toBe('0px')
    expect(px(td[8].element).right).toBe(`${crW}px`)
  })
})
