// 三大报表共用屏状态机的提示件(2026-10-01 S4 T20,画布 02-B 左 / 06-B ⑤⑧⑨):
// 原生 confirm → ask / askLeave,alert → 回执 / 字段下红字,删除公司的自写遮罩 → ask(删除类),改动数接进编辑锁。
// 只验 useFinStatementScreen 自己(三屏接法逐字相同,屏级动线在 reportWorkbenchFlow.spec)。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { useReviewStore } from '@/stores/review'
import { reviewApi } from '@/api/review'
import type { ReviewRow } from '@/types/review'
import { askQueue, answer } from '@/utils/ask'
import { receipts } from '@/utils/receipt'
import { companyApi } from '@/api/ledger'
import { reportApi } from '@/api/report'
import { runImport } from '@/utils/importRegistry'
import { useFinStatementScreen } from '@/components/fin/useFinStatementScreen'
import { shellOf } from '@/composables/useTabShells'
import FinDialogs from '@/components/fin/FinDialogs.vue'
import type { CompanyDTO, YearMonthsDTO } from '@/types/ledger'
import type { ReportPeriodDTO, ReportSaveRequest, ReportYearDTO } from '@/types/report'
import type { ImportResultDTO } from '@/types/import'

vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    // 编辑锁:这一期没人占 → 批下来
    post: vi.fn(() => Promise.resolve({ granted: true, holder: null, acquiredAt: 1 })),
    put: vi.fn(() => Promise.resolve({ users: [] })),
    delete: vi.fn(() => Promise.resolve()),
  },
  readToken: vi.fn(() => 'test-token'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))
vi.mock('@/api/ledger', () => ({
  companyApi: { list: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn() },
  ledgerApi: {},
}))
vi.mock('@/api/report', () => ({
  reportApi: { years: vi.fn(), year: vi.fn(), period: vi.fn(), allPeriod: vi.fn(), save: vi.fn() },
}))
vi.mock('@/api/review', () => ({
  reviewApi: {
    list: vi.fn(() => Promise.resolve([])),
    states: vi.fn(() => Promise.resolve([])),
    closedMonths: vi.fn(() => Promise.resolve([])),
    pending: vi.fn(() => Promise.resolve([])),
  },
}))
vi.mock('@/utils/importRegistry', () => ({ runImport: vi.fn() }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {}, meta: { value: 'income-statement' }, fullPath: '/income-statement' }),
  useRouter: () => ({ push: vi.fn() }),
}))

const COMPANIES: CompanyDTO[] = [
  { id: 1, name: '物业公司', short: '物业', sortNo: 1 },
  { id: 2, name: '资产公司', short: '资产', sortNo: 2 },
]
const YEARS: YearMonthsDTO[] = [{ year: 2025, months: 2 }]
const PERIOD: ReportPeriodDTO = { amounts: { '1': { cur: 12000, ytd: 34000 } }, customRows: [] }
const BODY: ReportSaveRequest = { cells: [{ rowKey: '1', field: 'cur', amount: 13000 }] }

type Screen = ReturnType<typeof useFinStatementScreen>
/** screen 给了就挂在那一屏的页签壳里(provide 屏名,同线上) */
async function setup(screen?: string): Promise<Screen> {
  let s!: Screen
  const C = defineComponent({
    setup() {
      s = useFinStatementScreen({ stmt: 'is', reviewKind: 'report-is', resetLocal: () => {} })
      return () => h('div')
    },
  })
  mount(screen ? shellOf(`${screen}:0`, C) : C)
  await flushPromises()
  return s
}
/** 物业公司 2025-02 正文,拿到锁进编辑态,草稿改了 n 处 */
async function editing(n: number, screen?: string): Promise<Screen> {
  const s = await setup(screen)
  await s.pickCell(2025, 2)
  await s.enterEdit()
  expect(s.edit.value, '没进去编辑态,下面的断言都落空').toBe(true)
  s.draft.value = Object.fromEntries(Array.from({ length: n }, (_, i) => [`${i + 1}|cur`, (i + 1) * 100]))
  return s
}
const last = () => receipts[receipts.length - 1]
/** 导入弹窗交给 runner 的进度句柄(components/import/importRun.ts) */
const fakeRun = () => ({
  from: 0, base: { imported: 0, skipped: 0, errors: [] },
  segDone: vi.fn(), stage: vi.fn(), recording: vi.fn(), refreshing: vi.fn(), note: vi.fn(), kept: vi.fn(), wrote: vi.fn(),
})

describe('三大报表 · 提示件(useFinStatementScreen)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // v3 的 master:edit + report:edit 落到 v4:三张报表各自的编辑 + 公司新增删除(月度台账)+ 公司改名(催缴单收款公司)
    useAuthStore().permissions = ['income-statement:edit', 'balance-sheet:edit', 'trial-balance:edit', 'ledger:company', 'bill-notices:payee']
    vi.clearAllMocks()
    localStorage.clear()
    askQueue.splice(0)
    receipts.splice(0)
    vi.mocked(companyApi.list).mockResolvedValue(COMPANIES)
    vi.mocked(reportApi.years).mockResolvedValue(YEARS)
    vi.mocked(reportApi.year).mockImplementation((_s: string, _c: number, y: number) => Promise.resolve<ReportYearDTO>({
      year: y,
      months: [{ month: 1, hasData: true, netPreview: 100 }, { month: 2, hasData: true, netPreview: 200 }],
    }))
    vi.mocked(reportApi.period).mockResolvedValue(PERIOD)
  })

  it('❗改动数接进编辑锁登记:0 处就是 0(不是缺省的 1),改 2 处就是 2', async () => {
    const s = await editing(0)
    const auth = useAuthStore()
    expect(auth.dirtyTotal, '没接 dirty 时按 1 算,关页签会白问一句').toBe(0)
    s.draft.value = { '1|cur': 1, '2|cur': 2 }
    expect(auth.dirtyTotal).toBe(2)
  })

  it('❗编辑态有改动时切公司走离开确认;「继续编辑」留在原处,「放弃改动并离开」才切', async () => {
    const s = await editing(3)
    const p = s.pickCompany(2)
    await flushPromises()
    expect(askQueue[0]).toMatchObject({
      title: '离开「物业公司 · 2025-02」？', body: '这页有 3 处改动还没保存。',
      action: '放弃改动并离开', cancel: '继续编辑', danger: true,
    })
    answer(false); await p
    expect([s.companyId.value, s.edit.value, Object.keys(s.draft.value).length]).toEqual([1, true, 3])
    const p2 = s.pickCompany(2)
    await flushPromises()
    answer(true); await p2
    expect(s.companyId.value).toBe(2)
  })

  it('❗编辑态「取消」有改动先问;答「继续编辑」草稿不动', async () => {
    const s = await editing(2)
    const p = s.requestCancel()
    await flushPromises()
    expect(askQueue[0]).toMatchObject({ title: '退出编辑「物业公司 · 2025-02」？', action: '放弃改动并退出编辑', danger: true })
    answer(false); await p
    expect([s.edit.value, Object.keys(s.draft.value).length]).toEqual([true, 2])
    const p2 = s.requestCancel()
    await flushPromises()
    answer(true); await p2
    expect(s.edit.value).toBe(false)
  })

  it('❗导入前有改动:02-B 左那张普通确认(不是删除类),答「仍要导入」才开导入弹窗', async () => {
    const s = await editing(3)
    const p = s.requestImport()
    await flushPromises()
    expect(askQueue[0]).toMatchObject({
      title: '导入会整期替换本期数据', body: '本期有 3 处改动还没保存，导入后会丢失。', action: '仍要导入',
    })
    expect(askQueue[0].danger, '普通确认:主按钮黑,不是红').toBeFalsy()
    answer(false); await p
    expect(s.importing.value).toBe(false)
    const p2 = s.requestImport()
    await flushPromises()
    answer(true); await p2
    expect(s.importing.value).toBe(true)
  })

  it('❗问「仍要导入」的这会儿编辑权被接管走了:答完不再开导入弹窗', async () => {
    const s = await editing(1)
    const p = s.requestImport()
    await flushPromises()
    s.edit.value = false            // 被接管:onExit 只退编辑态
    answer(true); await p
    expect(s.importing.value).toBe(false)
  })

  it('没改动:导入直接开,不问', async () => {
    const s = await editing(0)
    await s.requestImport()
    expect([askQueue.length, s.importing.value]).toEqual([0, true])
  })

  it('❗保存失败 → 失败回执带「重试」,点了再存一次;退出编辑后再点什么都不做', async () => {
    const s = await editing(2)
    vi.mocked(reportApi.save).mockRejectedValueOnce({ message: '服务器没有响应' })
    await s.save(() => BODY)
    expect(last()).toMatchObject({ tone: 'fail', text: '服务器没有响应', action: { label: '重试' } })
    expect(s.edit.value, '失败不退编辑态,草稿还在').toBe(true)
    vi.mocked(reportApi.save).mockRejectedValueOnce({})
    last().action!.run()
    await flushPromises()
    expect(reportApi.save).toHaveBeenCalledTimes(2)
    expect(last().text, '没给原因时用兜底句').toBe('保存失败')
    s.edit.value = false            // 退出编辑(取消 / 被接管)
    last().action!.run()
    await flushPromises()
    expect(reportApi.save).toHaveBeenCalledTimes(2)
  })

  it('❗删除公司:ask 删除类(焦点在取消),不再开自写遮罩;答「取消」不删', async () => {
    const s = await setup()
    const p = s.onDeleteCompany()
    await flushPromises()
    expect(askQueue[0]).toMatchObject({ title: '删除「物业公司」？', action: '删除公司', danger: true })
    expect(s.dlg.value, '不再开 FinDialogs 的删除卡').toBeNull()
    answer(false); await p
    expect(companyApi.remove).not.toHaveBeenCalled()
    vi.mocked(companyApi.remove).mockResolvedValueOnce(undefined as never)
    const p2 = s.onDeleteCompany()
    await flushPromises()
    answer(true); await p2
    expect(companyApi.remove).toHaveBeenCalledWith(1)
  })

  it('❗删除公司失败 → 失败回执带「重试」,重试再删同一家', async () => {
    const s = await setup()
    vi.mocked(companyApi.remove).mockRejectedValueOnce({ message: '这家公司下面还有台账' })
    const p = s.onDeleteCompany()
    await flushPromises()
    answer(true); await p
    expect(last()).toMatchObject({ tone: 'fail', text: '这家公司下面还有台账', action: { label: '重试' } })
    vi.mocked(companyApi.remove).mockResolvedValueOnce(undefined as never)
    last().action!.run()
    await flushPromises()
    expect(vi.mocked(companyApi.remove).mock.calls).toEqual([[1], [1]])
  })

  // 前端不带 force,名下有数据时后端恒 409:重试永远 409,不给「重试」。破坏验证:去掉 409 分支 → 红
  it('❗删除公司 409(名下还有数据)→ 回执说删不掉,不带「重试」', async () => {
    const s = await setup()
    vi.mocked(companyApi.remove).mockRejectedValueOnce({ code: 409, message: '…确认请再删一次。' })
    const p = s.onDeleteCompany()
    await flushPromises()
    expect(askQueue[0].body).toBe('名下还有台账、报表或催缴单时删不掉；删除后不能撤销。')
    answer(true); await p
    expect(last().text).toBe('「物业公司」名下还有台账、报表或催缴单，删不掉。')
    expect(last().action).toBeUndefined()
  })

  it('❗新建公司失败 → 失败回执,弹窗不关', async () => {
    const s = await setup()
    s.onNewCompany()
    vi.mocked(companyApi.create).mockRejectedValueOnce({})
    await s.submitCompany('新公司')
    expect(last()).toMatchObject({ tone: 'fail', text: '保存公司失败', action: { label: '重试' } })
    expect(s.dlg.value?.type).toBe('company')
  })

  // 2026-10-03 起导入点下去弹窗不关(画布 11;UI-OVERLAY-SPEC §8):onImport 是弹窗的 runner,失败在弹窗里原地出失败卡。
  // 破坏验证:onImport 包回 try/catch + receipt.fail(吞掉错误)→ rejects 那句红
  it('❗导入失败 → 错误原样抛给导入弹窗(失败卡照后端原句),不出回执', async () => {
    const s = await editing(0)
    const gate = { code: 409, message: '2025-02 利润表 已审核(李审 2025-03-02),撤销审核后才能修改' }
    vi.mocked(runImport).mockRejectedValueOnce(gate)
    await expect(s.onImport([{ label: '物业公司', records: [] }], '利润表.xlsx')).rejects.toBe(gate)
    expect(receipts).toHaveLength(0)
  })

  // 破坏验证:cellsOf 的 is 分支去掉 ×2 → count 那句红;steps 末步改回缺省「刷新本页」→ steps 那句红;importSecs 不滤空名 → 「2 家」红
  it('❗进度卡:按格数(利润表每行本月 + 本年累计两格)、「n 家公司 · 年 月」、五步收在「刷新本期」;公司名空的段不计', async () => {
    const s = await editing(0)
    expect(s.describeImport([
      { label: '物业公司', records: [{ rowKey: '1' }, { rowKey: '2' }] },
      { label: ' ', records: [{ rowKey: '1' }] },
    ])).toEqual({
      count: 4, unit: '格', meta: '1 家公司 · 2025 年 2 月',
      steps: ['读取文件', '核对公司', '写入 4 格', '记下这次导入', '刷新本期'],
    })
  })

  // 破坏验证:去掉 settle(不走「刷新本期」)→ refreshing 那句红;detail 去掉 → detail 红;cancelEdit 那句删 → edit 那句红;
  //          _run 不塞进 ctx → ctx 那句红(registry 就推不动「核对公司」「写入」两步)
  it('❗写完:步骤走到「刷新本期」再重读本期,结果带分公司明细「n 项 · n 格」,编辑态退出', async () => {
    const s = await editing(2)
    vi.mocked(runImport).mockResolvedValueOnce({ imported: 4, skipped: 0, errors: [] })
    const before = vi.mocked(reportApi.period).mock.calls.length
    const p = fakeRun()
    const out = await s.onImport([{ label: '物业公司', records: [{ rowKey: '1' }, { rowKey: '2' }] }], '利润表.xlsx', p)
    expect(vi.mocked(runImport).mock.calls[0][2]).toMatchObject({ year: 2025, month: 2, _run: p })
    expect(p.refreshing).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reportApi.period).mock.calls.length, '写完重读本期').toBe(before + 1)
    expect(out).toMatchObject({ imported: 4, refreshed: true, detail: [['物业公司', '2 项 · 4 格']] })
    expect(s.edit.value, '导入 = 整期替换:草稿作废、退出编辑').toBe(false)
    expect(receipts).toHaveLength(0)
  })

  // loadPeriod 自己吞错改 periodErr。破坏验证:去掉 `if (periodErr.value) throw` → refreshed 那句红
  it('❗写进去了但本期没重读上 → refreshed:false(结果卡写「本期没刷新上」),不算导入失败', async () => {
    const s = await editing(0)
    vi.mocked(runImport).mockResolvedValueOnce({ imported: 2, skipped: 0, errors: [] })
    vi.mocked(reportApi.period).mockRejectedValueOnce(new Error('timeout'))
    const out = await s.onImport([{ label: '物业公司', records: [{ rowKey: '1' }] }], '利润表.xlsx', fakeRun())
    expect(out).toMatchObject({ imported: 2, refreshed: false })
  })

  // 画布 ImportOne「读取工作簿 · 6 张余额表」/ ImportDone 左卡「创显 830 科目 · 2,542 格」。
  // 破坏验证:tb 的 p.note(0, …) 删掉 → note 那句红;cellsOf 的 tb 分支改成按行数 → 「3 格」红
  it('❗科目余额表:「读取工作簿 · n 张余额表」,格数只数非 0 金额字段,明细「n 科目 · n 格」', async () => {
    let s!: Screen
    mount(defineComponent({
      setup() { s = useFinStatementScreen({ stmt: 'tb', reviewKind: 'report-tb', resetLocal: () => {} }); return () => h('div') },
    }))
    await flushPromises()
    await s.pickCell(2025, 2)
    const secs = [{ label: '物业公司', records: [
      { account: { rowKey: '1001' }, amounts: { openDr: 5, endDr: 5, endCr: 0 } },
      { account: { rowKey: '1002' }, amounts: { periodCr: 7 } },
    ] }]
    expect(s.describeImport(secs)).toMatchObject({ count: 3, steps: ['读取工作簿', '核对公司', '写入 3 格', '记下这次导入', '刷新本期'] })
    vi.mocked(runImport).mockResolvedValueOnce({ imported: 3, skipped: 0, errors: [] })
    const p = fakeRun()
    const out = await s.onImport(secs, '余额表.xlsx', p)
    expect(p.note).toHaveBeenCalledWith(0, '1 张余额表')
    expect(out?.detail).toEqual([['物业公司', '2 科目 · 3 格']])
  })

  // 06-E 当场出现组「正在编辑的表被交审或审核通过」:改前静默退出编辑。
  // 破坏验证:删掉 useFinStatementScreen 里 ui.reportEditStop(...) 那一句 → 红
  // 破坏验证:what 里去掉屏名那一段(tabMeta(screen)?.page)→ 红
  it('❗编辑态里这一期被别人审核通过 → 退出编辑,并写明谁审的、哪一屏哪一期', async () => {
    const s = await editing(0, 'income-statement')
    const row: ReviewRow = {
      key: 'report-is:1:2025-02', kind: 'report-is', scope: '1', status: 'approved',
      submittedBy: '张三', submittedAt: '2025-03-01T09:00:00', reviewedBy: '李审', reviewedAt: '2025-03-02T10:00:00',
      reason: null, blockedBy: [],
    }
    vi.mocked(reviewApi.states).mockResolvedValue([row])
    const rs = useReviewStore()
    rs.invalidate('2025-02')
    await rs.ensureYear(2025)
    await flushPromises()
    expect(s.edit.value).toBe(false)
    expect(useUiStore().editStop).toMatchObject({ status: 'approved', by: '李审', what: '利润表 · 物业公司 · 2025-02' })
  })
})

describe('FinDialogs · 字段报错贴在字段下面(06-B ⑤)', () => {
  beforeEach(() => { receipts.splice(0) })

  it('❗空名提交:红字落在输入框所在那一格的 .fp-field-err 里,不走回执;没出错时这一行也占着', async () => {
    const w = mount(FinDialogs, {
      props: { dlg: { type: 'company', mode: 'new' }, companies: [{ id: 1, name: '物业公司' }] },
      global: { stubs: { Teleport: true } },
    })
    const err = () => w.get('.fin-field .fp-field-err')
    expect(err().text(), '常驻占位,出错不顶开下面').toBe('')
    await w.findAll('button').find((b) => b.text() === '创建')!.trigger('click')
    expect(err().text()).toBe('请输入公司名称')
    expect(receipts).toHaveLength(0)
    expect(w.find('.fin-erm').exists()).toBe(false)
  })

  it('❗同名公司:同一格红字', async () => {
    const w = mount(FinDialogs, {
      props: { dlg: { type: 'company', mode: 'new' }, companies: [{ id: 1, name: '物业公司' }] },
      global: { stubs: { Teleport: true } },
    })
    await w.get('input.fin-in').setValue('物业公司')
    await w.findAll('button').find((b) => b.text() === '创建')!.trigger('click')
    expect(w.get('.fin-field .fp-field-err').text()).toBe('已存在同名公司')
    expect(w.emitted('submitCompany')).toBeUndefined()
  })

  // 横条盘点 FinDialogs:104(2026-10-03):弹窗底部那条满宽说明并进副标题,只多后半句
  // 破坏验证:副标题里的 {{ dlg.hint }} 删掉 → 第一条红;FPNote 加回来 → 第二条红
  it('❗加子类弹窗:说明接在副标题后面,底部不再有满宽提示条;不传 hint 时副标题只有前半句', () => {
    const open = (hint?: string) => mount(FinDialogs, {
      props: { dlg: { type: 'addrow', parentLabel: '营业收入', hint }, companies: [] },
      global: { stubs: { Teleport: true } },
    })
    const w = open('可继续在子类下添加下一级。')
    expect(w.get('.fin-dlg-h p').text()).toBe('在「营业收入」下新增一个明细子类,金额随该子类逐期录入,父项自动汇总。可继续在子类下添加下一级。')
    expect(w.find('.fp-note').exists(), '底部那条满宽提示条该撤了').toBe(false)
    expect(open().get('.fin-dlg-h p').text()).toBe('在「营业收入」下新增一个明细子类,金额随该子类逐期录入,父项自动汇总。')
  })
})
