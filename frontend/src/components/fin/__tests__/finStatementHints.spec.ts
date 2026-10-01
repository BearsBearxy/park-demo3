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
import FPNote from '@/components/fp/FPNote.vue'
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

describe('三大报表 · 提示件(useFinStatementScreen)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useAuthStore().permissions = ['report:edit', 'master:edit']
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

  it('❗新建公司失败 → 失败回执,弹窗不关', async () => {
    const s = await setup()
    s.onNewCompany()
    vi.mocked(companyApi.create).mockRejectedValueOnce({})
    await s.submitCompany('新公司')
    expect(last()).toMatchObject({ tone: 'fail', text: '保存公司失败', action: { label: '重试' } })
    expect(s.dlg.value?.type).toBe('company')
  })

  it('❗导入失败 → 失败回执,不带重试(期和编辑态这会儿可能都变了)', async () => {
    const s = await editing(0)
    vi.mocked(runImport).mockRejectedValueOnce({ message: '第 3 行公司名为空' })
    await s.onImport([{ label: '物业公司', records: [] }], '利润表.xlsx')
    expect(last()).toMatchObject({ tone: 'fail', text: '第 3 行公司名为空' })
    expect(last().action).toBeUndefined()
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

  it('❗加子类弹窗里的说明是块内提示 FPNote(蓝),不是自写的天蓝底条(06-B ④)', () => {
    const w = mount(FinDialogs, {
      props: { dlg: { type: 'addrow', parentLabel: '营业收入', hint: '这一类只在利润表里出现,资产负债表不跟着加' }, companies: [] },
      global: { stubs: { Teleport: true } },
    })
    const note = w.getComponent(FPNote)
    expect([note.props('tone'), note.text()]).toEqual(['info', '这一类只在利润表里出现,资产负债表不跟着加'])
    expect(w.find('.fin-dlg-note').exists()).toBe(false)
  })
})
