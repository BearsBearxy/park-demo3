// 计费参数页(S21-PARAM-CENTER-SPEC §5 / §8.4):挂载渲染四区 + 状态条 / 全文禁词 / 编辑态才出 [改…] / 保存只 patch 该行 + 计数。
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { ParamRowDTO, ParamStatusDTO } from '@/api/params'
import { forbiddenText } from '@/utils/paramCenterLogic'

beforeEach(() => setActivePinia(createPinia()))

const push = vi.fn()
const query: Record<string, string> = { ym: '2024-02', zone: 'p1' }   // 深链;单测里可临时加 edit=1
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ query }),
}))

let id = 0
const row = (p: Partial<ParamRowDTO> & Pick<ParamRowDTO, 'key' | 'label' | 'group' | 'scope' | 'scopeLabel'>): ParamRowDTO => ({
  unit: '', value: 1, valueText: '1', mode: 'from', acctMonth: '', rangeText: '长期（初始版本）',
  sourceChain: [`${p.scopeLabel}:1`], formula: null, hint: null, editable: true, monthlyCheck: false,
  hasMonthRow: false, rowId: ++id, note: null, ...p,
})
const ROWS: ParamRowDTO[] = [
  row({ key: 'elec_peak', label: '峰段裸电价', unit: '元/度', group: 'monthly', scope: '', scopeLabel: '全园', value: 0.9, valueText: '0.9 元/度',
    mode: 'month', acctMonth: '2024-02', rangeText: '仅 2024-02', sourceChain: ['全园:0.9 元/度'], monthlyCheck: true }),
  row({ key: 'elevator_area_base', label: 'A座电梯面积基数', unit: '㎡', group: 'monthly', scope: 'p1', scopeLabel: '一期', value: 12487.04,
    valueText: '12487.04 ㎡', mode: 'from', acctMonth: '2024-02', rangeText: '2024-02 起长期', sourceChain: ['一期:12487.04 ㎡'], monthlyCheck: true }),
  row({ key: 'loss_adj_qty', label: '损耗调整度数', unit: '度', group: 'monthly', scope: 'building:13', scopeLabel: '一期 A座', value: -1500,
    valueText: '-1500 度', mode: 'month', acctMonth: '2024-02', rangeText: '仅 2024-02', sourceChain: ['一期 A座:-1500 度'], monthlyCheck: true, hasMonthRow: true }),
  row({ key: 'loss_adj_qty', label: '损耗调整度数', unit: '度', group: 'monthly', scope: 'building:20', scopeLabel: '一期 B座', value: null,
    valueText: '', mode: null, acctMonth: '', rangeText: '', sourceChain: [], monthlyCheck: true, rowId: null }),
  row({ key: 'mgmt_fee', label: '电力管理费（分时 / 居民）', unit: '元/度', group: 'constant', scope: '', scopeLabel: '全园', value: 0.16, valueText: '0.16 元/度' }),
  row({ key: 'coefficient', label: '池分母（层数 T / 受益面积Σ）', group: 'constant', scope: 'rule:23', scopeLabel: '招商中心净电（池）', value: 6, valueText: '6' }),
  row({ key: 'loss_variant', label: '损耗核算方式', group: 'rule', scope: 'building:20', scopeLabel: '一期 B座', value: 1,
    valueText: '纯公摊（率 = 公摊度数 ÷ 总表 + 加点）', mode: 'from', acctMonth: '2023-11', rangeText: '2023-11 起长期', sourceChain: ['一期 B座:纯公摊（率 = 公摊度数 ÷ 总表 + 加点）'] }),
  row({ key: 'loss_recon', label: '参与供电侧对账', group: 'rule', scope: 'building:20', scopeLabel: '一期 B座', value: null,
    valueText: '参与对账', mode: null, acctMonth: '', rangeText: '', sourceChain: [], rowId: null }),
  row({ key: 'loss_exclude', label: '剔出所在栋的合计', group: 'rule', scope: 'meter:307', scopeLabel: '力美C201电（表）', value: 1, valueText: '剔出合计' }),
  row({ key: 'loss_supply_meter', label: '供电侧对账总表', group: 'rule', scope: 'p1', scopeLabel: '一期', value: 5, valueText: 'B-G座总电' }),
  row({ key: 'mgmt_fee', label: '电力管理费（分时 / 居民）', unit: '元/度', group: 'constant', scope: 'tenant:5', scopeLabel: '力灏（户）', value: 0.15,
    valueText: '0.15 元/度', sourceChain: ['力灏（户）:0.15 元/度', '全园:0.16 元/度'] }),
  // 户级版本起点晚于 ym:后端出的是继承全园的行(rowId 空)—— 不是例外,④ 不列
  row({ key: 'capacity_fee', label: '装机容量费', unit: '元/kVA·月', group: 'constant', scope: 'tenant:5', scopeLabel: '力灏（户）', value: 22.6,
    valueText: '22.6 元/kVA·月', sourceChain: ['全园:22.6 元/kVA·月'], rowId: null }),
  // 全园级电价本月无值:月核对项不折叠,值格「— 缺」
  row({ key: 'elec_valley', label: '谷段裸电价', unit: '元/度', group: 'monthly', scope: '', scopeLabel: '全园', value: null,
    valueText: '', mode: null, acctMonth: '', rangeText: '', sourceChain: [], monthlyCheck: true, rowId: null }),
]
const STATUS: ParamStatusDTO = {
  priceOk: 6, priceTotal: 6, pendingChanges: 0, lastChangeAt: null,
  poolSnapshotAt: '2026-08-16T16:37:51', billBatchAt: '2026-08-12T13:41:34', stale: false, otherMonthsAffected: [],
}
const put = vi.fn()
vi.mock('@/api/params', () => ({
  paramsApi: {
    list: vi.fn(() => Promise.resolve(ROWS.map(r => ({ ...r })))),
    status: vi.fn(() => Promise.resolve({ ...STATUS })),
    put: (...a: unknown[]) => put(...a),
    history: vi.fn(() => Promise.resolve({ versions: [], changes: [] })),
    changes: vi.fn(() => Promise.resolve([])),
    recalc: vi.fn(), copyPrev: vi.fn(),
  },
}))
vi.mock('@/api/alloc', () => ({
  allocApi: {
    years: () => Promise.resolve([2023, 2024]),
    rules: () => Promise.resolve([
      { id: 23, zone: 'p1', name: '招商中心净电', feeKey: 'park_loss_pool' },
      { id: 24, zone: 'p1', name: '车库东照明', feeKey: 'park_loss_pool' },
    ]),
  },
}))
vi.mock('@/api/meters', () => ({
  metersApi: { list: () => Promise.resolve([{ id: 307, name: '力美C201电', buildingId: 20, zone: 'p1', kind: 'elec', tenantId: null, subName: null }]) },
}))
vi.mock('@/api/building', () => ({
  buildingApi: { list: () => Promise.resolve([{ id: 13, name: '一期 A座', phase: 1 }, { id: 20, name: '一期 B座', phase: 1 }]) },
}))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: () => Promise.resolve([{ id: 5, companyName: '力灏', phase: 1, parentName: null }]) } }))

import ParamCenterView from '../ParamCenterView.vue'
import ParamEditPopover from '../ParamEditPopover.vue'

async function mountPage() {
  const w = mount(ParamCenterView, { attachTo: document.body })
  expect(w.find('.page-loading').exists()).toBe(true)
  await flushPromises()
  return w
}

describe('ParamCenterView 计费参数页', () => {
  it('首载加载门 → 四区 + 固定规则 + 状态条;深链 ?ym=2024-02 落到该账期', async () => {
    const w = await mountPage()
    expect(w.find('.page-loading').exists()).toBe(false)
    const t = w.text()
    for (const h of ['① 本月参数', '② 长期常数', '③ 核算口径', '④ 户级例外', '⑤ 固定规则']) expect(t).toContain(h)
    expect(t).toContain('本月电价 6/6 ✓')
    expect(t).toContain('快照与参数一致')
    // 人话行:A座 调整度数 −1500 仅 2024-02;B座 纯公摊 2023-11 起长期;户级例外覆盖全园
    expect(t).toContain('-1500 度')
    expect(t).toContain('仅 2024-02')
    expect(t).toContain('纯公摊')
    expect(t).toContain('2023-11 起长期')
    expect(t).toContain('全园 0.16 元/度')
    // 剔出合计的表归到 B座 组下(表 → 栋 由表主数据解析)
    expect(t).toContain('剔出合计的表：')
    expect(t).toContain('力美C201电')
    // 一期 G 只读披露
    expect(t).toContain('一期公摊分摊度数 = Σ(招商中心净电、车库东照明 本月净量)')
    w.unmount()
  })

  it('全文无禁词(浏览态与编辑态)', async () => {
    const w = await mountPage()
    expect(forbiddenText(w.text())).toBe(false)
    const btn = w.findAll('button').find(b => b.text().includes('编辑模式'))!
    await btn.trigger('click')
    expect(forbiddenText(w.text())).toBe(false)
    w.unmount()
  })

  it('无命中的对象级行默认折叠,点「显示未设置项」展开;全园级月核对项无值常显 + 「缺」;③ 口径无命中显默认语义', async () => {
    const w = await mountPage()
    const trs = () => w.findAll('.pm-table tbody tr')
    const bRow = () => trs().some(tr => tr.text().includes('一期 B座') && tr.text().includes('损耗调整度数'))
    expect(bRow()).toBe(false)                                 // ① 栋级未设置行藏起
    const valley = trs().find(tr => tr.text().includes('谷段裸电价'))!
    expect(valley, '全园级电价无值不折叠').toBeTruthy()
    expect(valley.text()).toContain('缺')
    expect(w.text()).toContain('参与供电侧对账：参与对账')   // ③ 默认语义始终列
    const link = w.findAll('button.pm-link').find(b => b.text().includes('显示未设置项'))!
    expect(link.text()).toContain('（1）')                    // 只数被折叠的对象级行
    await link.trigger('click')
    expect(bRow()).toBe(true)
    w.unmount()
  })

  it('④ 只列该户自己的版本行:继承全园的 tenant 行(rowId 空)不当例外', async () => {
    const w = await mountPage()
    const t4 = w.find('#sec-tenant').text()
    expect(t4).toContain('电力管理费')
    expect(t4).not.toContain('装机容量费')
    w.unmount()
  })

  it('浏览态零写入口:编辑模式后才出 [改…] / [新增例外] / [复制上月电价] / [重算本月]', async () => {
    const w = await mountPage()
    const texts = () => w.findAll('button').map(b => b.text())
    expect(texts().some(s => s === '改…')).toBe(false)
    expect(texts().some(s => s.includes('新增例外'))).toBe(false)
    expect(texts().some(s => s.includes('重算本月'))).toBe(false)
    await w.findAll('button').find(b => b.text().includes('编辑模式'))!.trigger('click')
    expect(texts().filter(s => s === '改…').length).toBeGreaterThan(3)
    expect(texts().some(s => s.includes('新增例外'))).toBe(true)
    expect(texts().some(s => s.includes('复制上月电价'))).toBe(true)
    expect(texts().some(s => s.includes('重算本月'))).toBe(true)
    w.unmount()
  })

  it('深链 edit=1(三屏 [去重算])直接进编辑态:重算本月可点', async () => {
    query.edit = '1'
    try {
      const w = await mountPage()
      expect(w.findAll('button').some(b => b.text().includes('重算本月'))).toBe(true)
      expect(w.findAll('button').some(b => b.text() === '完成')).toBe(true)
      w.unmount()
    } finally { delete query.edit }
  })

  it('保存:PUT 带页面账期 → 只 patch 该行(其它行引用不变)+ 状态条「参数已改 1 项」', async () => {
    const { paramsApi } = await import('@/api/params')
    const listCalls = () => (paramsApi.list as ReturnType<typeof vi.fn>).mock.calls.length
    const before = listCalls()
    const w = await mountPage()
    expect(listCalls()).toBe(before + 1)   // 深链账期只拉一次(不被 watch 二次触发)
    await w.findAll('button').find(b => b.text().includes('编辑模式'))!.trigger('click')
    // 点 A座 调整度数那行的 [改…]
    const tr = w.findAll('.pm-table tbody tr').find(x => x.text().includes('一期 A座') && x.text().includes('损耗调整度数'))!
    await tr.findAll('button').find(b => b.text() === '改…')!.trigger('click')
    const pop = w.findComponent(ParamEditPopover)
    expect(pop.props('row')?.scope).toBe('building:13')
    const returned = row({ key: 'loss_adj_qty', label: '损耗调整度数', unit: '度', group: 'monthly', scope: 'building:13', scopeLabel: '一期 A座',
      value: -1400, valueText: '-1400 度', mode: 'month', acctMonth: '2024-02', rangeText: '仅 2024-02', sourceChain: ['一期 A座:-1400 度'], hasMonthRow: true })
    put.mockResolvedValueOnce(returned)
    pop.vm.$emit('save', { key: 'loss_adj_qty', scope: 'building:13', acctMonth: '2024-02', mode: 'month', value: -1400, note: null, correction: false })
    await flushPromises()
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ key: 'loss_adj_qty', scope: 'building:13', value: -1400 }), '2024-02')
    expect(w.text()).toContain('-1400 度')
    expect(w.text()).not.toContain('-1500 度')
    expect(w.text()).toContain('参数已改 1 项')
    // 只 patch 一行:list 不重拉
    expect(listCalls()).toBe(before + 1)
    w.unmount()
  })
})

describe('ParamEditPopover 改…弹窗', () => {
  const aRow = ROWS[2]   // A座 损耗调整度数 −1500 仅 2024-02
  it('默认生效方式=注册表默认(month);输入 −1400 保存 → emit 数值型 value + acctMonth=页面账期', async () => {
    const w = mount(ParamEditPopover, { props: { open: true, row: aRow, ym: '2024-02' }, attachTo: document.body })
    await flushPromises()
    const inp = document.querySelector('.fp-dwr input.pe-in') as HTMLInputElement
    expect(inp.value).toBe('-1500')
    inp.value = '-1400'
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const save = [...document.querySelectorAll('.fp-dwr button')].find(b => b.textContent?.trim() === '保存') as HTMLButtonElement
    save.click()
    await flushPromises()
    const ev = w.emitted('save')!
    expect(ev).toHaveLength(1)
    expect(ev[0][0]).toEqual({ key: 'loss_adj_qty', scope: 'building:13', acctMonth: '2024-02', mode: 'month', value: -1400, note: null, correction: false })
    w.unmount()
  })
  it('只能按月生效的键(电价)不出「自 X 起长期」;损耗调整度数照出', async () => {
    const ways = () => [...document.querySelectorAll('.fp-dwr .pe-way')].map(l => l.textContent?.trim())
    const w1 = mount(ParamEditPopover, { props: { open: true, row: ROWS[0], ym: '2024-02' }, attachTo: document.body })   // elec_peak
    await flushPromises()
    expect(ways().some(s => s?.includes('起长期'))).toBe(false)
    expect(ways().some(s => s?.includes('仅 2024-02'))).toBe(true)
    w1.unmount()
    const w2 = mount(ParamEditPopover, { props: { open: true, row: aRow, ym: '2024-02' }, attachTo: document.body })
    await flushPromises()
    expect(ways().some(s => s?.includes('起长期'))).toBe(true)
    w2.unmount()
  })
  it('有本月专属行 → 出「删除本月专属值」;点它 emit value=null 的 month 行删除', async () => {
    const w = mount(ParamEditPopover, { props: { open: true, row: aRow, ym: '2024-02' }, attachTo: document.body })
    await flushPromises()
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    const del = [...document.querySelectorAll('.fp-dwr button')].find(b => b.textContent?.includes('删除 2024-02 专属值')) as HTMLButtonElement
    expect(del).toBeTruthy()
    del.click()
    await flushPromises()
    expect(w.emitted('save')![0][0]).toEqual(expect.objectContaining({ key: 'loss_adj_qty', scope: 'building:13', acctMonth: '2024-02', mode: 'month', value: null }))
    w.unmount()
  })
})
