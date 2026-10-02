// 提示件替换 M9(S4 T28):参数历史 / 变更记录抽屉的加载失败与空状态、参数删除确认、
// 附表6 空年、台账新建 / 删除公司弹窗的字段报错。光伏分栋抄表那一屏的同批断言在 meterPeriodFlow.spec.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { ParamChangeDTO, ParamHistoryDTO, ParamRowDTO } from '@/api/params'
import type { PvPhaseDTO, PvTotal } from '@/types/pv'
import { paramsApi } from '@/api/params'
import { askQueue, answer } from '@/utils/ask'
import ParamHistoryDrawer from '@/views/params/ParamHistoryDrawer.vue'
import ParamChangesDrawer from '@/views/params/ParamChangesDrawer.vue'
import ParamEditPopover from '@/views/params/ParamEditPopover.vue'
import PvTable from '@/views/pv/PvTable.vue'
import LedgerNewCompanyDialog from '@/views/ledger/LedgerNewCompanyDialog.vue'
import LedgerDeleteCompanyDialog from '@/views/ledger/LedgerDeleteCompanyDialog.vue'

vi.mock('@/api/params', () => ({ paramsApi: { history: vi.fn(), changes: vi.fn() } }))

const ROW: ParamRowDTO = {
  key: 'loss_adj_qty', label: '损耗调整度数', unit: '度', group: 'monthly', scope: 'building:13', scopeLabel: '一期 A座',
  value: -1500, valueText: '-1,500 度', mode: 'month', acctMonth: '2024-02', rangeText: '仅 2024-02', sourceChain: [],
  formula: null, hint: null, editable: true, monthlyCheck: true, hasMonthRow: true, rowId: 7, note: null,
}
const HIST: ParamHistoryDTO = {
  versions: [{ acctMonth: '2024-02', mode: 'month', value: -1500, valueText: '-1,500 度', note: null, rangeText: '仅 2024-02' }],
  changes: [],
}
const CHANGE: ParamChangeDTO = {
  ts: '2024-02-03T10:00:00', actor: '张会计', action: 'set', key: 'loss_adj_qty', scope: 'building:13', scopeLabel: '一期 A座',
  label: '损耗调整度数', acctMonth: '2024-02', mode: 'month', oldValue: null, newValue: -1500, oldText: null, newText: '-1,500 度', note: null,
}
const stub = { global: { stubs: { Teleport: true } } }
/** 抽屉在父页里先挂着、点了才开(拉数挂在 open 的变化上):照真实顺序先关着挂,再打开 */
async function openDrawer(C: typeof ParamHistoryDrawer | typeof ParamChangesDrawer, props: Record<string, unknown>) {
  const w = mount(C, { props: { open: false, ...props } as never, ...stub })
  await w.setProps({ open: true })
  await flushPromises()
  return w
}

beforeEach(() => {
  // reset 不是 clear:上一条没用掉的 mockResolvedValueOnce 不许漏进下一条
  vi.mocked(paramsApi.history).mockReset()
  vi.mocked(paramsApi.changes).mockReset()
  askQueue.splice(0)
})

describe('参数历史抽屉 · 加载失败', () => {
  it('❗接口失败 → 失败件(一句 + 原因 + 重试);重试在途失败件不撤;重拉成功出版本', async () => {
    vi.mocked(paramsApi.history).mockRejectedValueOnce(new Error('后端挂了'))
    const w = await openDrawer(ParamHistoryDrawer, { row: ROW })
    const err = () => w.find('.fp-empty.error')
    expect(err().text()).toContain('这项参数的历史没读到')
    expect(err().text()).toContain('后端挂了')

    let release = () => {}
    vi.mocked(paramsApi.history).mockImplementationOnce(() => new Promise((res) => { release = () => res(HIST) }))
    await err().find('button').trigger('click')
    expect(paramsApi.history, '点重试要重拉').toHaveBeenCalledTimes(2)
    expect(err().exists(), '重试在途失败件不许先撤(错误只在成功分支清)').toBe(true)
    release()
    await flushPromises()
    expect(err().exists()).toBe(false)
    expect(w.text()).toContain('版本（1）')
  })
})

describe('变更记录抽屉 · 加载失败与空状态', () => {
  it('❗接口失败 → 「{年} 年 {月} 月的变更记录没读到」+ 重试,点了重拉', async () => {
    vi.mocked(paramsApi.changes).mockRejectedValueOnce(new Error('后端挂了'))
    const w = await openDrawer(ParamChangesDrawer, { ym: '2024-02' })
    expect(w.find('.fp-empty.error').text()).toContain('2024 年 2 月的变更记录没读到')
    vi.mocked(paramsApi.changes).mockResolvedValueOnce([CHANGE])
    await w.find('.fp-empty.error button').trigger('click')
    await flushPromises()
    expect(paramsApi.changes).toHaveBeenLastCalledWith('2024-02')
    expect(w.find('.fp-empty').exists()).toBe(false)
    expect(w.findAll('.pc-tab tbody tr')).toHaveLength(1)
  })

  it('❗本月一条都没有 vs 筛选筛空了,空状态说的不是一件事', async () => {
    vi.mocked(paramsApi.changes).mockResolvedValueOnce([])
    const w = await openDrawer(ParamChangesDrawer, { ym: '2024-02' })
    expect(w.find('.fp-empty.empty').text()).toBe('2024 年 2 月还没有变更记录')
    w.unmount()

    vi.mocked(paramsApi.changes).mockResolvedValueOnce([CHANGE])
    const w2 = await openDrawer(ParamChangesDrawer, { ym: '2024-02' })
    await w2.find('.pc-q').setValue('电价')
    expect(w2.find('.fp-empty.empty').text()).toBe('没有符合筛选的变更记录')
  })
})

describe('参数修改弹窗 · 删除走确认弹窗', () => {
  const delBtn = (w: ReturnType<typeof mount>) => w.findAll('button').find(b => b.text().includes('删除「仅 2024-02」这一版'))!

  it('❗删除类:主按钮红、问句写删哪一个;答「取消」不发删除', async () => {
    const w = mount(ParamEditPopover, { props: { open: true, row: ROW, ym: '2024-02' }, ...stub })
    await flushPromises()
    await delBtn(w).trigger('click')
    expect(askQueue[0]).toEqual(expect.objectContaining({ title: '删除「一期 A座 · 损耗调整度数」2024-02 的专属值？', danger: true }))
    answer(false)
    await flushPromises()
    expect(w.emitted('save'), '答了取消还发了删除').toBeUndefined()
  })

  it('❗问的途中弹窗关了 → 答「删除」也不替它发删除', async () => {
    const w = mount(ParamEditPopover, { props: { open: true, row: ROW, ym: '2024-02' }, ...stub })
    await flushPromises()
    await delBtn(w).trigger('click')
    await w.setProps({ open: false })
    answer(true)
    await flushPromises()
    expect(w.emitted('save')).toBeUndefined()
  })

  // 守卫比键不比引用:换到另一行要拦;父页重载换了行对象(键相同)要放行
  // 破坏验证:key 比较去掉 → 第一条红;改成按引用比 `props.row !== r` → 第二条红
  it('❗问的途中换到了另一行(键不同)→ 答「删除」也不发', async () => {
    const w = mount(ParamEditPopover, { props: { open: true, row: ROW, ym: '2024-02' }, ...stub })
    await flushPromises()
    await delBtn(w).trigger('click')
    await w.setProps({ row: { ...ROW, key: 'loss_adj_rate', label: '损耗调整率' } })
    answer(true)
    await flushPromises()
    expect(w.emitted('save')).toBeUndefined()
  })

  it('❗问的途中父页重载换了行对象(键、作用域都没变)→ 答「删除」照常发删除', async () => {
    const w = mount(ParamEditPopover, { props: { open: true, row: ROW, ym: '2024-02' }, ...stub })
    await flushPromises()
    await delBtn(w).trigger('click')
    await w.setProps({ row: { ...ROW } })
    answer(true)
    await flushPromises()
    const saved = w.emitted('save') as [{ key: string; scope: string; acctMonth: string; mode: string; value: number | null }][] | undefined
    expect(saved).toHaveLength(1)
    expect(saved![0][0]).toMatchObject({ key: ROW.key, scope: ROW.scope, acctMonth: '2024-02', mode: 'month', value: null })
  })
})

describe('附表6 · 空年', () => {
  const PHASES: PvPhaseDTO[] = [{ id: 'p1', name: '一期光伏', short: '一期', online: '2021-06' }]
  const TOTAL: PvTotal = { gen: 0, fee: 0, selfKwh: 0, selfAmt: 0, gridKwh: 0, gridAmt: 0 }
  const props = (edit: boolean) => ({ year: 2025, phases: PHASES, rows: [], total: TOTAL, phase: 'all', edit })

  it('❗空状态换掉表格;「新增记账」只在编辑态出,点了 emit add', async () => {
    const ro = mount(PvTable, { props: props(false) })
    expect(ro.find('.fp-empty.empty').text()).toContain('2025 年还没有记账记录')
    expect(ro.find('.s6-table').exists()).toBe(false)
    expect(ro.find('.fp-empty button').exists(), '浏览态不给写入口').toBe(false)

    const ed = mount(PvTable, { props: props(true) })
    await ed.find('.fp-empty button').trigger('click')
    expect(ed.emitted('add')).toHaveLength(1)
  })
})

describe('台账 · 新建 / 删除公司弹窗的字段报错', () => {
  it('❗公司名空 / 重名 → 字段下面的红字(常驻位),不发 create', async () => {
    const w = mount(LedgerNewCompanyDialog, { props: { existingNames: ['园区水电管理公司'] } })
    expect(w.find('.fp-field-err').exists(), '报错位常驻').toBe(true)
    await w.findAll('button').find(b => b.text().includes('创建'))!.trigger('click')
    expect(w.find('.fp-field-err').text()).toBe('请输入公司名称')
    await w.find('input').setValue('园区水电管理公司')
    await w.find('input').trigger('keydown', { key: 'Enter' })
    expect(w.find('.fp-field-err').text()).toBe('已存在同名公司')
    expect(w.emitted('create')).toBeUndefined()
  })

  it('❗删除公司:输入的名字对不上 → 字段下面的红字,永久删除禁用', async () => {
    const w = mount(LedgerDeleteCompanyDialog, { props: { books: [{ id: 3, name: '水电账', companyName: '园区水电管理公司' }] } })
    await w.find('.lg-dlg-row').trigger('click')
    expect(w.find('.fp-field-err').text(), '还没输入时不报').toBe('')
    await w.find('input').setValue('园区水电')
    expect(w.find('.fp-field-err').text()).toBe('名称与「园区水电管理公司」不一致')
    expect(w.findAll('button').find(b => b.text().includes('永久删除'))!.attributes('disabled')).toBeDefined()
  })

  // 前端删公司不带 force,名下有数据时后端拒删(CompanyService.delete):不许再说「数据会一起删掉」
  it('❗删除公司:文案说名下有数据删不掉,不说「一并删除」', async () => {
    const w = mount(LedgerDeleteCompanyDialog, { props: { books: [{ id: 3, name: '水电账', companyName: '园区水电管理公司' }] } })
    expect(w.text()).toContain('名下还有台账、报表或催缴单的删不掉')
    await w.find('.lg-dlg-row').trigger('click')
    expect(w.text()).toContain('名下还有台账、报表或催缴单时删不掉')
    // 收款账户 / 收款簿的指定随公司级联删(V34 / V94),不在拒删守卫里 —— 要说出来。破坏验证:删掉这半句 → 红
    expect(w.text()).toContain('将删除该公司和它的账册、收款账户;收款簿里指给它的收款项也一起清掉')
    expect(w.text()).not.toMatch(/一并删除|连同全部台账/)
  })
})
