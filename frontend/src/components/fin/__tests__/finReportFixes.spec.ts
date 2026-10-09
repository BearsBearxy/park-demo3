// 三大报表 · 对抗复查报的几条(2026-10-03):编辑中重读失败不许存、换公司不换期不落转圈、
// 资产负债表空段默认收起、科目余额表按权限预留列宽、导入挂空父级的科目按代码前缀补挂。
// 夹具不退化:三家公司名各不相同;金额有正有负有 0;科目代码 4-3-3(真实导入里挂空父级的那种)。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

import { useAuthStore } from '@/stores/auth'
import IncomeStatementView from '@/views/reports/income-statement/IncomeStatementView.vue'
import BalanceSheetView from '@/views/reports/balance-sheet/BalanceSheetView.vue'
import TrialBalanceView from '@/views/reports/trial-balance/TrialBalanceView.vue'
import { companyApi } from '@/api/ledger'
import { reportApi } from '@/api/report'
import { reviewApi } from '@/api/review'
import { stubWideTable } from '@/composables/__tests__/wideTableStub'

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
const IS_AMOUNTS = { '1': { cur: 2000881.85, ytd: 23215887.17 }, '2': { cur: 2940770.57, ytd: 29015530.53 }, '14': { cur: -407.08, ytd: 0 } }

function wire(stmt: 'is' | 'bs' | 'tb', amounts: Record<string, Record<string, number>>, accounts?: unknown[]) {
  vi.mocked(companyApi.list).mockResolvedValue(COMPANIES as never)
  vi.mocked(reportApi.years).mockResolvedValue([{ year: 2025, months: 3 }] as never)
  vi.mocked(reportApi.year).mockResolvedValue({
    year: 2025, months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, hasData: i < 3, netPreview: 0 })),
  } as never)
  const p = { year: 2025, month: 1, customRows: [], amounts, accounts }
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
const saveBtn = (w: VueWrapper) => w.findAll('.fh-r button').find(b => b.text() === '保存')!

beforeEach(() => {
  setActivePinia(createPinia())
  // v3 的 master:edit + report:edit 落到 v4:三张报表各自的编辑 + 公司新增删除(月度台账)+ 公司改名(催缴单收款公司)
  useAuthStore().permissions = ['income-statement:edit', 'balance-sheet:edit', 'trial-balance:edit', 'ledger:company', 'bill-notices:payee']
  vi.clearAllMocks()
  localStorage.clear()
  vi.setSystemTime(new Date('2025-06-15T00:00:00'))
  vi.mocked(reviewApi.states).mockResolvedValue([] as never)
  vi.mocked(reviewApi.list).mockResolvedValue([] as never)
})
afterEach(() => { document.body.innerHTML = '' })

describe('编辑中重读本期失败(添加子类之后那一读)', () => {
  beforeEach(() => wire('is', IS_AMOUNTS))

  async function failAfterAddChild() {
    const w = await openBody(IncomeStatementView, true)
    await w.find('input.fin-ni').setValue('123')
    vi.mocked(reportApi.addCustomRow).mockResolvedValue({} as never)
    vi.mocked(reportApi.period).mockRejectedValueOnce(new Error('500'))
    await w.findAll('tbody tr')[0].find('button.addchild').trigger('click')
    await w.find('.fin-dlg input.fin-in').setValue('厂房租金收入')
    await w.findAll('.fin-dlg button').find(b => b.text() === '添加')!.trigger('click')
    await flushPromises()
    return w
  }

  // 破坏验证:FinHead 保存钮的 `|| loadErr` 去掉 → 可点,红
  it('❗草稿留着、还在编辑;「保存」禁用,悬停「本期没读到，重试读到之后才能保存」;点了不弹确认不存', async () => {
    const w = await failAfterAddChild()
    expect(w.find('.fp-empty.error').exists()).toBe(true)
    expect(w.find('.fh-l .fp-state.edit').text()).toBe('编辑中 · 1 处改动')
    const b = saveBtn(w)
    expect(b.attributes('disabled')).toBeDefined()
    expect(tipOf(b.element.parentElement!)).toBe('本期没读到，重试读到之后才能保存')
    await b.trigger('click')
    await flushPromises()
    expect(reportApi.save).not.toHaveBeenCalled()
  })

  // 破坏验证:save() 的 `|| !period.value` 去掉 → 载荷只剩草稿那 1 格照样发出去,红
  it('❗save() 本身也守:本期不在手时不发请求(没改的格会被整期 clear+insert 删掉)', async () => {
    const w = await failAfterAddChild()
    const vm = w.vm as unknown as { save: (b: () => unknown) => Promise<void> }
    await vm.save(() => ({ cells: [{ rowKey: '1', field: 'cur', amount: 123 }] }))
    expect(reportApi.save).not.toHaveBeenCalled()
    // 重试读到之后,同一份草稿能存
    vi.mocked(reportApi.save).mockResolvedValue({ year: 2025, month: 1, customRows: [], amounts: IS_AMOUNTS } as never)
    await w.find('.fp-empty.error button').trigger('click')
    await flushPromises()
    expect(saveBtn(w).attributes('disabled')).toBeUndefined()
    expect(w.find('.fh-l .fp-state.edit').text()).toBe('编辑中 · 1 处改动')
  })
})

describe('期间条换公司不换期 = 换筛选档(LAYOUT-STABILITY §7.1)', () => {
  beforeEach(() => wire('is', IS_AMOUNTS))

  // 破坏验证:pickCompany 的 keep 路径照旧先清 month / period → 整页落 v-else 转圈,红
  it('❗新一期在途时整页不卸:期间条、标题行、旧表都在,没有转圈;熬过 200ms 旧内容退让 + 顶边进度线;到手后换成新公司的数', async () => {
    const w = await openBody(IncomeStatementView)
    let done!: (v: unknown) => void
    vi.mocked(reportApi.period).mockReturnValueOnce(new Promise(r => { done = r }) as never)
    await w.find('.fpb .fcm-btn').trigger('click')
    await w.findAll('.fcm-it').find(e => e.text().includes('帮管好'))!.trigger('click')
    await flushPromises()
    expect(w.find('.page-loading').exists(), '不落转圈').toBe(false)
    expect(w.find('.fin-page .fpb').exists()).toBe(true)
    expect(w.find('.fin-page .fh').exists()).toBe(true)
    expect(w.text(), '旧表原地').toContain('2,000,881.85')
    await new Promise(r => setTimeout(r, 260))
    expect(w.find('.fin-page > .fp-lb').exists(), '顶边进度线').toBe(true)
    expect(w.find('.fc').classes()).toContain('fp-stale')
    expect(w.find('.fh').classes()).toContain('fp-stale')
    expect(reportApi.period).toHaveBeenLastCalledWith('is', 2, 2025, 1)
    done({ year: 2025, month: 1, customRows: [], amounts: { '1': { cur: 5550.5, ytd: 5550.5 } } })
    await flushPromises()
    expect(w.find('.fp-lb').exists()).toBe(false)
    expect(w.find('.fc').classes()).not.toContain('fp-stale')
    expect(w.text()).toContain('5,550.50')
    expect(w.text()).not.toContain('2,000,881.85')
    expect(w.find('.fpb .fcm-btn .fcm-cur').text()).toBe('帮管好')
  })
})

describe('资产负债表 · 段里一格数都没有的段头默认收起(稿 ReportBS 非流动负债)', () => {
  // 非流动负债(42–45)一格都没有;其余段有数
  beforeEach(() => wire('bs', { '1': { end: 292259.39 }, '16': { end: 0 }, '17': { end: 5000 }, '31': { end: 20000000 }, '48': { end: -19702740.61 } }))

  // 破坏验证:段头 group 恢复恒 'open' → 「长期借款」在,红
  it('❗非流动负债 4 项 · 合计 收着(箭头朝右,下面 4 行不画);有数的段展开;点开才露出来', async () => {
    const w = await openBody(BalanceSheetView)
    const head = (t: string) => w.findAll('tbody td.fin-c1').find(c => c.find('.fin-lt').text() === t)!
    expect(head('非流动负债').find('.fin-caret').attributes('aria-label')).toBe('展开')
    expect(head('非流动资产').find('.fin-caret').attributes('aria-label')).toBe('收起')
    expect(head('流动资产').find('.fin-caret').attributes('aria-label')).toBe('收起')
    expect(w.text()).not.toContain('长期借款')
    expect(w.text()).toContain('货币资金')
    await head('非流动负债').find('.fin-caret').trigger('click')
    expect(w.text()).toContain('长期借款')
  })

  // 点击范围放宽(2026-10-03 用户):段头名称那一格整格可点,不必瞄箭头;点箭头只切一次
  // 破坏验证:FinReportTable 的 fin-c1 去掉 @click → 点段名不展开,红
  it('❗点段头名称「非流动负债」就展开,再点格子空白处收起;点箭头不会叠成两下', async () => {
    const w = await openBody(BalanceSheetView)
    const head = (t: string) => w.findAll('tbody td.fin-c1').find(c => c.find('.fin-lt').text() === t)!
    await head('非流动负债').find('.fin-lt').trigger('click')
    expect(w.text()).toContain('长期借款')
    await head('非流动负债').trigger('click')
    expect(w.text()).not.toContain('长期借款')
    await head('非流动负债').find('.fin-caret').trigger('click')
    expect(w.text()).toContain('长期借款')
  })

  // 破坏验证:段头默认去掉 anyFilled(整期空也收)→ 五个段头全收着,红
  it('❗本月未录入(整期一格都没有):五个段头全展开 —— 进编辑要录的就是这些格', async () => {
    wire('bs', {})
    const w = await openBody(BalanceSheetView)
    expect(w.find('.fh-l .fp-state').text()).toBe('本月未录入')
    const heads = ['流动资产', '非流动资产', '流动负债', '非流动负债', '所有者权益（或股东权益）']
      .map(t => w.findAll('tbody td.fin-c1').find(c => c.find('.fin-lt').text() === t)!)
    expect(heads.map(h => h.find('.fin-caret').attributes('aria-label'))).toEqual(['收起', '收起', '收起', '收起', '收起'])
    expect(w.text()).toContain('长期借款')
  })

  // 破坏验证:filled 改成读 nodeValue(含草稿)→ 清空后段自己收起,红
  it('❗编辑中把段里唯一一格清空,段不在手底下收起来(按读到的那一期判)', async () => {
    const w = await openBody(BalanceSheetView, true)
    // 非流动资产段里唯一有数的那一格(17 长期股权投资)清空
    const cell = w.findAll('tbody td').find(c => c.find('.fin-no').exists() && c.find('.fin-no').text() === '17')
    const input = cell!.element.nextElementSibling!.querySelector('input.fin-ni') as HTMLInputElement
    expect(input.value).toBe('5000')
    input.value = ''
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    const head = w.findAll('tbody td.fin-c1').find(c => c.find('.fin-lt').text() === '非流动资产')!
    expect(head.find('.fin-caret').attributes('aria-label')).toBe('收起')
  })
})

describe('科目余额表 · 按权限预留列宽 + 挂空父级的科目按代码前缀补挂', () => {
  // 4-3-3 代码:1122001006 的真父级是 1122001;导入按 4-2-2-2 切层把它存成 level 3、parentKey=null
  const ACC = [
    { rowKey: '1001', parentKey: null, code: '1001', label: '现金', level: 0, sortOrder: 0 },
    { rowKey: '1122', parentKey: null, code: '1122', label: '应收账款', level: 0, sortOrder: 1 },
    { rowKey: '1122001', parentKey: '1122', code: '1122001', label: '应收租金', level: 1, sortOrder: 2 },
    { rowKey: '1122001006', parentKey: null, code: '1122001006', label: '佛山市新材料科技有限公司', level: 3, sortOrder: 3 },
    { rowKey: '1122001007', parentKey: null, code: '1122001007', label: '广东华成科技有限公司', level: 3, sortOrder: 4 },
  ]
  const AM = {
    '1001': { openDr: 35799.12, endDr: 36956.34 }, '1122': { endDr: 551460 }, '1122001': { endDr: 551460 },
    '1122001006': { endDr: 437342 }, '1122001007': { endDr: 114118, endCr: 0 },
  }
  let stub: ReturnType<typeof stubWideTable>
  beforeEach(() => { wire('tb', AM, ACC); stub = stubWideTable('fin-wrap') })
  afterEach(() => stub.restore())
  const names = (w: VueWrapper) => w.findAll('table.tb-table tbody tr').map(r => r.find('.tb-name').text())

  // 破坏验证:copyTree 里补挂那段去掉 → 两个三级科目平铺在顶层,红
  it('❗默认只露一级;应收账款「1 个下级」→ 应收租金「2 个下级」→ 两家公司,缩进按补挂后的深度', async () => {
    stub.size(1600, 800)
    const w = await openBody(TrialBalanceView)
    expect(names(w)).toEqual(['现金', '应收账款'])
    expect(w.find('.fin-count').text()).toBe('2 / 5 项')
    const row = (t: string) => w.findAll('table.tb-table tbody tr').find(r => r.find('.tb-name').text() === t)!
    await row('应收账款').find('.tb-caret').trigger('click')
    expect(row('应收租金').find('.tb-kids').text()).toBe('2 个下级')
    // 点击范围放宽(2026-10-03 用户):点科目名称那一格就展开下级,不必瞄箭头
    // 破坏验证:TbTable 的 tb-n 去掉 @click → 名称点了不展开,红
    await row('应收租金').find('.tb-name').trigger('click')
    expect(names(w)).toEqual(['现金', '应收账款', '应收租金', '佛山市新材料科技有限公司', '广东华成科技有限公司'])
    expect((row('佛山市新材料科技有限公司').find('.tb-label').element as HTMLElement).style.paddingLeft).toBe('40px')
  })

  // 破坏验证:TbTable 的 rsv() 改回只看 editable → 浏览态代码列 72、进编辑 94,红
  it('❗有编辑权:浏览态就按勾选框 / 删除钮 / 录入框留宽,进编辑代码列、期末两列一格不挪;期末列不窄于录入框 112', async () => {
    stub.size(1600, 800)
    const w = await openBody(TrialBalanceView)
    await stub.fire(1600, 800)
    // 代码列、期末借方、期末贷方(两层表头第二行的第 7、8 格)
    const widths = () => [
      parseInt((w.find('thead th.tb-c').element as HTMLElement).style.minWidth),
      parseInt((w.findAll('thead th.h2')[6].element as HTMLElement).style.minWidth),
      parseInt((w.findAll('thead th.h2')[7].element as HTMLElement).style.minWidth),
    ]
    const before = widths()
    // 期末贷方一列全是「–」(夹具借贷不平,就地标在借方那边),不留的话只按表头宽 72
    expect(before[2]).toBeGreaterThanOrEqual(112)
    await w.find('button.fp-emb').trigger('click')
    await flushPromises()
    await stub.fire(1600, 800)
    expect(w.find('input.fin-ni').exists(), '进了编辑').toBe(true)
    expect(widths()).toEqual(before)
  })

  it('没有编辑权:不留(代码列只按表头与代码宽)', async () => {
    useAuthStore().permissions = []
    stub.size(1600, 800)
    const w = await openBody(TrialBalanceView)
    await stub.fire(1600, 800)
    // 默认只露一级(4 位代码),列宽按表头「科目代码」:11.5 × 4 + 2 + 24 = 72;有编辑权时再加勾选框那 22
    expect(parseInt((w.find('thead th.tb-c').element as HTMLElement).style.minWidth)).toBe(72)
  })
})
