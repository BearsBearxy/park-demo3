// 计费参数页(S21-PARAM-CENTER-SPEC §5,2026-10-03 版 = 画布 10-A~10-G):左目录六区 + 计数 / 深链落点 / 改值卡三选与删除这一版 /
// 本月改动点行跳转 / 某项历史居中卡 / 户级例外按户折叠 / 公摊池固定列坐标 / 说明列撤成悬停说明;
// 以及沿用的:全文禁词、浏览态零写入口、保存只 patch 该行、问题面板组头、编辑态守卫、加载失败、页面状态签。
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ParamChangeDTO, ParamHistoryDTO, ParamRowDTO, ParamStatusDTO } from '@/api/params'
import { forbiddenText } from '@/utils/paramCenterLogic'
import { useAuthStore } from '@/stores/auth'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { askQueue, answer } from '@/utils/ask'
import { receipts } from '@/utils/receipt'

// RBAC:本屏三扇门(月度录入 / 计费口径 / 重算),空权限进来是浏览态没有写入口
beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['param-monthly:edit', 'param-policy:edit', 'billing-run:edit']
  // 每条用例从同一份深链起步
  for (const k of Object.keys(query)) delete query[k]
  query.ym = '2024-02'
  askQueue.splice(0)
  receipts.splice(0)
  replace.mockClear()
  scrolled.length = 0
})

const push = vi.fn()
const replace = vi.fn()
const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push, replace }),
  useRoute: () => ({ query }),
}))
/** scrollIntoView 被谁调了(jsdom 没有这个方法) */
const scrolled: string[] = []
Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id) }

let id = 0
const row = (p: Partial<ParamRowDTO> & Pick<ParamRowDTO, 'key' | 'label' | 'group' | 'scope' | 'scopeLabel'>): ParamRowDTO => ({
  unit: '', value: 1, valueText: '1', mode: 'from', acctMonth: '', rangeText: '长期',
  sourceChain: [`${p.scopeLabel}:1`], formula: null, hint: null, editable: true, monthlyCheck: false,
  hasMonthRow: false, rowId: ++id, note: null, ...p,
})
const none = { value: null, valueText: '', mode: null, acctMonth: '', rangeText: '', sourceChain: [] as string[], rowId: null } as const
const ROWS: ParamRowDTO[] = [
  // ── 全园与期级 ──
  row({ key: 'elec_peak', label: '峰段电价', unit: '元/度', group: 'monthly', scope: '', scopeLabel: '全园', value: 0.9, valueText: '0.9 元/度',
    mode: 'month', acctMonth: '2024-02', rangeText: '仅 2024-02', sourceChain: ['全园:0.9 元/度'], monthlyCheck: true,
    formula: '分时电费单价 = 分段电价 + 电力管理费', hint: '代理购电按月变' }),
  // 月核对项本月无专属值(from 版本 2023-10 起):值照常显 + 「未核对」
  row({ key: 'elevator_area_base', label: 'A座电梯分摊面积基数', unit: '㎡', group: 'monthly', scope: 'p1', scopeLabel: '一期', value: 12027.34,
    valueText: '12,027.34 ㎡', mode: 'from', acctMonth: '2023-10', rangeText: '2023-10 起长期', sourceChain: ['一期:12,027.34 ㎡'], monthlyCheck: true }),
  // 全园级电价本月无值:值格「–」+「缺」
  row({ key: 'elec_valley', label: '谷段电价', unit: '元/度', group: 'monthly', scope: '', scopeLabel: '全园', ...none, monthlyCheck: true }),
  row({ key: 'mgmt_fee', label: '电力管理费', unit: '元/度', group: 'constant', scope: '', scopeLabel: '全园', value: 0.16, valueText: '0.16 元/度' }),
  row({ key: 'area_base', label: '园区分摊面积基数', unit: '㎡', group: 'constant', scope: 'p1', scopeLabel: '一期', value: 80000,
    valueText: '80,000 ㎡', sourceChain: ['一期:80,000 ㎡'] }),
  row({ key: 'loss_supply_meter', label: '供电局对账总表', group: 'rule', scope: 'p1', scopeLabel: '一期', value: 5, valueText: 'B-G座总电' }),
  // 枚举的括号说明挪到悬停说明,值格只留「分时制」(不然一格把本月值列撑到 260 宽)
  row({ key: 'zone_calc_kind', label: '计费口径', group: 'rule', scope: 'p1', scopeLabel: '一期', value: 1, valueText: '分时制（尖峰平谷四段 + 管理费）' }),
  // 回归钉:ref_meter 候选过滤曾按 p1/p2/dorm 枚举漏了 p3,编辑三期这一行会退到全园所有表
  row({ key: 'loss_supply_meter', label: '供电局对账总表', group: 'rule', scope: 'p3', scopeLabel: '三期', value: 400, valueText: '三期总电' }),
  // ── 公摊池 ──
  row({ key: 'extra_qty', label: '公摊池加减度数', unit: '度', group: 'monthly', scope: 'rule:23', scopeLabel: '一期 招商中心·四楼·净电（池）', value: -670,
    valueText: '-670 度', mode: 'month', acctMonth: '2024-02', rangeText: '仅 2024-02', hasMonthRow: true, monthlyCheck: true }),
  row({ key: 'coefficient', label: '分摊基数（层数或面积）', group: 'constant', scope: 'rule:23', scopeLabel: '一期 招商中心·四楼·净电（池）', ...none }),
  // 走面积基数的池:分摊基数格是那条面积基数的值,链尾「取自「园区分摊面积基数」」→ 点它跳到全园与期级那一行
  row({ key: 'coefficient', label: '分摊基数（层数或面积）', group: 'constant', scope: 'rule:31', scopeLabel: '一期园区·路灯（池）', value: 80000,
    valueText: '80,000 ㎡', sourceChain: ['一期:80,000 ㎡', '取自「园区分摊面积基数」'], editable: false, rowId: null }),
  row({ key: 'extra_qty', label: '公摊池加减度数', unit: '度', group: 'monthly', scope: 'rule:31', scopeLabel: '一期园区·路灯（池）', ...none }),
  row({ key: 'coefficient', label: '分摊基数（层数或面积）', group: 'constant', scope: 'rule:24', scopeLabel: '一期 A座·三楼西侧·公共用电（池）', value: 2293.34,
    valueText: '2,293.34', acctMonth: '2024-02', rangeText: '2024-02 起长期' }),
  // ── 楼栋损耗 ──
  row({ key: 'loss_adj_qty', label: '损耗调整度数', unit: '度', group: 'monthly', scope: 'building:13', scopeLabel: '一期 A座', value: -1500,
    valueText: '-1,500 度', mode: 'month', acctMonth: '2024-02', rangeText: '仅 2024-02', sourceChain: ['一期 A座:-1,500 度'], monthlyCheck: true, hasMonthRow: true }),
  row({ key: 'loss_adj_rate', label: '损耗率加点', unit: '比率', group: 'constant', scope: 'building:13', scopeLabel: '一期 A座', value: 0.003, valueText: '0.003 比率' }),
  row({ key: 'loss_c_meter', label: '总表取数', group: 'rule', scope: 'building:13', scopeLabel: '一期 A座', value: 9, valueText: '仅「A座总电」' }),
  row({ key: 'loss_recon', label: '供电局对账', group: 'rule', scope: 'building:13', scopeLabel: '一期 A座', value: 0, valueText: '不参与' }),
  row({ key: 'loss_variant', label: '损耗核算方式', group: 'rule', scope: 'building:13', scopeLabel: '一期 A座', ...none, valueText: '按损耗量核算（率 = …）' }),
  row({ key: 'loss_adj_qty', label: '损耗调整度数', unit: '度', group: 'monthly', scope: 'building:20', scopeLabel: '一期 B座', ...none, monthlyCheck: true }),
  row({ key: 'loss_variant', label: '损耗核算方式', group: 'rule', scope: 'building:20', scopeLabel: '一期 B座', value: 1,
    valueText: '仅按公摊分摊度数（率 = 公摊分摊度数 ÷ 分母 + 加点）', mode: 'from', acctMonth: '2023-11', rangeText: '2023-11 起长期' }),
  row({ key: 'loss_recon', label: '供电局对账', group: 'rule', scope: 'building:20', scopeLabel: '一期 B座', ...none, valueText: '参与' }),
  // 回归钉靶子:三期 G栋(id 30)zone 未标注,ref_building 候选不该按 phase 猜成「p1 桶」
  row({ key: 'loss_head', label: '损耗核算归组', group: 'rule', scope: 'building:30', scopeLabel: '三期 G栋', ...none, valueText: '独立核算' }),
  row({ key: 'loss_exclude', label: '不计入楼栋合计的电表', group: 'rule', scope: 'meter:307', scopeLabel: '力美C201电（表）', value: 1, valueText: '不计入' }),
  // ── 户级例外 ──
  row({ key: 'mgmt_fee', label: '电力管理费', unit: '元/度', group: 'constant', scope: 'tenant:5', scopeLabel: '力灏（户）', value: 0.15,
    valueText: '0.15 元/度', sourceChain: ['力灏（户）:0.15 元/度', '全园:0.16 元/度'] }),
  // 户级版本起点晚于 ym:后端出的是继承全园的行(rowId 空)—— 不是例外,不列
  row({ key: 'capacity_fee', label: '装机容量费', unit: '元/kVA·月', group: 'constant', scope: 'tenant:5', scopeLabel: '力灏（户）', value: 22.6,
    valueText: '22.6 元/kVA·月', sourceChain: ['全园:22.6 元/kVA·月'], rowId: null }),
  row({ key: 'loss_base_park_amount', label: '损耗基数附加金额（按月）', unit: '元', group: 'monthly', scope: 'tenant:6', scopeLabel: '永龙（户）', value: 11435.07,
    valueText: '11,435.07 元', mode: 'month', acctMonth: '2024-02', rangeText: '仅 2024-02', sourceChain: ['永龙（户）:11,435.07 元'] }),
  row({ key: 'green_rate', label: '绿化水公摊单价（户）', unit: '元/㎡', group: 'tenant', scope: 'tenant:7', scopeLabel: '星州（户）', value: 0.01, valueText: '0.01 元/㎡' }),
  // ── 光伏分栋判据 ──
  row({ key: 'pv_band_sigma', label: '分栋 正常范围半宽', unit: '倍', group: 'constant', scope: '', scopeLabel: '全园', value: 2, valueText: '2 倍' }),
]
const CHANGES: ParamChangeDTO[] = [
  { ts: '2026-09-25T00:02:00', actor: 'admin', action: 'recalc', label: '重算本月', acctMonth: '', mode: 'from', oldValue: null, newValue: null,
    oldText: null, newText: null, note: '池 3 / 损耗 2 / 催缴单 9', ym: '2024-02' },
  { ts: '2026-08-22T17:21:00', actor: 'clerk', action: 'set', key: 'mgmt_fee', scope: 'tenant:5', scopeLabel: '力灏（户）', label: '电力管理费',
    acctMonth: '', mode: 'from', oldValue: null, newValue: 0.15, oldText: null, newText: '0.15 元/度', note: null, authorizer: 'boss' } as ParamChangeDTO,
  { ts: '2026-08-22T08:46:00', actor: 'clerk', action: 'set', key: 'elec_peak', scope: '', scopeLabel: '全园', label: '峰段电价',
    acctMonth: '2024-02', mode: 'month', oldValue: 0.8, newValue: 0.9, oldText: '0.8 元/度', newText: '0.9 元/度', note: null },
  { ts: '2026-08-16T20:32:00', actor: 'admin', action: 'set', key: 'loss_adj_qty', scope: 'building:13', scopeLabel: '一期 A座', label: '损耗调整度数',
    acctMonth: '2024-02', mode: 'month', oldValue: -1400, newValue: -1500, oldText: '-1,400 度', newText: '-1,500 度', note: null },
  { ts: '2026-08-16T19:57:00', actor: 'admin', action: 'set', key: 'loss_exclude', scope: 'meter:307', scopeLabel: '力美C201电（表）', label: '不计入楼栋合计的电表',
    acctMonth: '', mode: 'from', oldValue: null, newValue: 1, oldText: null, newText: '不计入', note: null },
  { ts: '2026-08-10T10:00:00', actor: 'admin', action: 'set', key: 'extra_qty', scope: 'rule:31', scopeLabel: '一期园区·路灯（池）', label: '公摊池加减度数',
    acctMonth: '2024-02', mode: 'month', oldValue: 5, newValue: null, oldText: '5 度', newText: null, note: null },
  // 别的屏顺手记进同一张日志的单元面积改动:不是参数,不算、不上屏(内部标识 unit:54 也不许露)
  { ts: '2026-08-09T07:26:00', actor: 'admin', action: 'set', key: 'area', scope: 'unit:54', scopeLabel: 'unit:54', label: 'area',
    acctMonth: '', mode: 'from', oldValue: 0, newValue: 999.99, oldText: null, newText: null, note: null },
]
const STATUS: ParamStatusDTO = {
  priceOk: 6, priceTotal: 6, pendingChanges: 0, lastChangeAt: null,
  poolSnapshotAt: '2026-08-16T16:37:51', billBatchAt: '2026-08-12T13:41:34', stale: false, otherMonthsAffected: [],
}
const put = vi.fn()
// 进编辑态要先占到编辑锁(CONCURRENCY-SPEC §3.2);不 mock 的话 locksApi 走真 axios,编辑态永远进不去
/** 占锁请求过的 scope 全记下来 —— 深链那条要靠它证明锁的是**真的那个月**。 */
const acquired: string[] = []
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: (scope: string) => { acquired.push(scope); return Promise.resolve({ granted: true, holder: null }) },
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))

vi.mock('@/api/params', () => ({
  paramsApi: {
    list: vi.fn(() => Promise.resolve(ROWS.map(r => ({ ...r })))),
    status: vi.fn(() => Promise.resolve({ ...STATUS })),
    put: (...a: unknown[]) => put(...a),
    history: vi.fn(() => Promise.resolve({ versions: [], changes: [] })),
    changes: vi.fn(() => Promise.resolve(CHANGES.map(c => ({ ...c })))),
    recalc: vi.fn(), copyPrev: vi.fn(),
  },
}))
vi.mock('@/api/alloc', () => ({
  allocApi: {
    rules: () => Promise.resolve([
      { id: 23, zone: 'p1', name: '一期 招商中心·四楼·净电', feeKey: 'park_loss_pool' },
      { id: 24, zone: 'p1', name: '一期 A座·三楼西侧·公共用电', feeKey: 'floor' },
      { id: 31, zone: 'p1', name: '一期园区·路灯', feeKey: 'park_lamp' },
      // 排序那条用:id 比一期的小(库里二期池 id 在前)
      { id: 2, zone: 'p2', name: '二期 一车间·公共用电', feeKey: 'floor' },
    ]),
  },
}))
vi.mock('@/api/meters', () => ({
  metersApi: { list: vi.fn(() => Promise.resolve([
    { id: 307, name: '力美C201电', buildingId: 20, zone: 'p1', kind: 'elec', tenantId: null, subName: null },
    { id: 308, name: 'B座总电', buildingId: 20, zone: 'p1', kind: 'elec', tenantId: null, subName: null },
    { id: 400, name: '三期总电', buildingId: null, zone: 'p3', kind: 'elec', tenantId: null, subName: null },
  ])) },
}))
vi.mock('@/api/building', () => ({
  buildingApi: { list: () => Promise.resolve([
    { id: 13, name: '一期 A座', phase: 1, zone: 'p1' },
    { id: 20, name: '一期 B座', phase: 1, zone: 'p1' },
    // 三期楼栋在手工标注前 zone=null(V113 迁移故意留空)——回归钉要靠它撑住
    { id: 30, name: '三期 G栋', phase: 3, zone: null },
    { id: 9, name: '二期 一车间', phase: 2, zone: 'p2' },
  ]) },
}))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: () => Promise.resolve([
  { id: 5, companyName: '力灏', phase: 1, parentName: null },
  { id: 6, companyName: '永龙', phase: 2, parentName: null },
  { id: 7, companyName: '星州', phase: null, parentName: null },
]) } }))
vi.mock('@/api/zones', () => ({ zonesApi: { list: () => Promise.resolve([
  { code: 'p1', name: '一期', sortNo: 0 },
  { code: 'p2', name: '二期', sortNo: 1 },
  { code: 'p3', name: '三期', sortNo: 2 },
  { code: 'dorm', name: '宿舍', sortNo: 3 },
]) } }))

import ParamCenterView from '../ParamCenterView.vue'
import ParamEditPopover from '../ParamEditPopover.vue'
import ParamChangesDrawer from '../ParamChangesDrawer.vue'

type W = Awaited<ReturnType<typeof mountPage>>
async function mountPage() {
  const w = mount(ParamCenterView, { attachTo: document.body })
  expect(w.find('.page-loading').exists()).toBe(true)
  await flushPromises()
  return w
}
const navItem = (w: W, name: string) => w.findAll('.pm-ni').find(b => b.text().startsWith(name))!
async function goSec(w: W, name: string) {
  await navItem(w, name).trigger('click')
  await flushPromises()
}
async function enterEdit(w: W) {
  await w.findAll('button').find(b => b.text().includes('编辑模式'))!.trigger('click')
  await flushPromises()
  expect(w.findAll('button').some(b => b.text() === '完成'), '前置:进了编辑态').toBe(true)
}
const trOf = (w: W, id: string) => w.find(`[id="pm-row-${id}"]`)
const pop = () => document.querySelector('.pe-pop') as HTMLElement | null
type TipEl = HTMLElement & { _tip?: { text: string; sub?: string } }

describe('ParamCenterView 左目录 + 右当前区', () => {
  // 破坏验证:changeStats 的 bySec 不去重(按次数数)→「改 2」变「改 3」红;navCount 的池数改成行数 → 「3 池」红
  it('❗六区目录:本月改动 N(按项去重)、每区「改 n」与对象数', async () => {
    const w = await mountPage()
    const items = w.findAll('.pm-ni').map(b => b.text().replace(/\s+/g, ' '))
    expect(items).toEqual([
      '本月改动5',
      '全园与期级改 18',
      '公摊池改 13 池',
      '楼栋损耗改 23 栋',
      '户级例外改 13 户',
      '光伏分栋判据1',
      '固定规则6 条',
    ])
    // 默认落在全园与期级;卡头区名 + 一句说明
    expect(navItem(w, '全园与期级').classes()).toContain('on')
    expect(w.find('.pm-ch').text()).toContain('全园与期级')
    expect(w.find('.pm-ch').text()).toContain('电价、管理费、水价、面积基数')
    w.unmount()
  })

  // 破坏验证:setSec 里的 router.replace 去掉 → 第一条红
  it('切区:右卡换成那一区,地址栏只记 section(期不进地址栏,edit 不留)', async () => {
    query.edit = '1'
    const w = await mountPage()
    await goSec(w, '公摊池')
    expect(replace).toHaveBeenLastCalledWith({ path: '/params', query: { section: 'pool' } })
    expect(w.find('.pm-ch').text()).toContain('公摊池')
    expect(w.find('.pm-ch').text()).toContain('「–」= 没单独设置')
    await goSec(w, '固定规则')
    expect(w.findAll('.pm-fx li')).toHaveLength(6)
    expect(w.find('.pm-fx').text()).toContain('一期公摊分摊度数 = 园区公共电池当月净量合计 ÷ 均摊栋数')
    w.unmount()
  })

  it('首载加载门 → 标题旁页面状态签;全园与期级两组、生效区间徽标、「未核对」「缺」「● 本月改」', async () => {
    const w = await mountPage()
    expect(w.find('.page-loading').exists()).toBe(false)
    expect(w.findAll('.pm-head .fp-state').map(e => e.text())).toEqual(['本月电价 6/6', '改动都已重算 · 生成于 08-16 16:37'])
    expect(w.findAll('tr.pm-grp').map(t => t.text().replace(/\s+/g, ''))).toEqual(['每月核对3项·电价照抄供电局账单', '长期常数5项·改一次，管到下次改'])
    const peak = trOf(w, '|elec_peak')
    expect(peak.text()).toContain('0.9')
    expect(peak.find('td.key .u').text()).toBe('元/度')
    expect(peak.text()).toContain('仅 2024-02')
    expect(peak.text()).toContain('本月改')
    const ele = trOf(w, 'p1|elevator_area_base')
    expect(ele.text()).toContain('12,027.34')
    expect(ele.text()).toContain('未核对')
    expect(ele.text()).not.toContain('本月改')
    const valley = trOf(w, '|elec_valley')
    expect(valley.find('td.key').text()).toBe('–')
    expect(valley.text()).toContain('缺')
    // 破坏验证:valText 改回 bare(r) → 这两条红
    const kind = trOf(w, 'p1|zone_calc_kind').find('td.key span').element as TipEl
    expect(kind.textContent).toBe('分时制')
    expect(kind._tip).toEqual({ text: '分时制（尖峰平谷四段 + 管理费）' })
    w.unmount()
  })

  // 破坏验证:参数名格的 v-tip 改回 r.hint → formula 断言红;表头加回「说明 / 算式」列 → 第一条红
  it('❗说明 / 算式列撤掉,挪到参数名的悬停说明', async () => {
    const w = await mountPage()
    expect(w.findAll('th').map(t => t.text())).not.toContain('说明 / 算式')
    expect(w.text()).not.toContain('分时电费单价 = 分段电价 + 电力管理费')
    const name = trOf(w, '|elec_peak').find('td.nm .t').element as TipEl
    expect(name._tip).toEqual({ text: '分时电费单价 = 分段电价 + 电力管理费', sub: '代理购电按月变' })
    w.unmount()
  })

  it('组头可收起:点「每月核对」收起那一组的行', async () => {
    const w = await mountPage()
    expect(trOf(w, '|elec_peak').exists()).toBe(true)
    await w.find('[id="pm-grp-monthly"] button.xp').trigger('click')
    expect(trOf(w, '|elec_peak').exists()).toBe(false)
    expect(trOf(w, '|mgmt_fee').exists(), '另一组不动').toBe(true)
    w.unmount()
  })

  it('全文无禁词(六区,浏览态与编辑态)', async () => {
    const w = await mountPage()
    for (const edit of [false, true]) {
      if (edit) await enterEdit(w)
      for (const s of ['全园与期级', '公摊池', '楼栋损耗', '户级例外', '光伏分栋判据', '固定规则']) {
        await goSec(w, s)
        expect(forbiddenText(w.text()), `${s}${edit ? '(编辑态)' : ''}`).toBe(false)
      }
    }
    w.unmount()
  })

  it('公摊池一池一行:位置灰字 + 名字;期;按月签;没设的「–」;走面积基数的池分摊基数是链接', async () => {
    const w = await mountPage()
    await goSec(w, '公摊池')
    const r23 = trOf(w, 'rule:23')
    expect(r23.find('.loc').text()).toBe('招商中心·四楼')
    expect(r23.find('td.nm .t').text()).toBe('招商中心·四楼净电')
    expect(r23.findAll('td')[1].text()).toBe('一期')
    expect(r23.findAll('td')[2].text()).toBe('-670')
    expect(r23.find('td.key').text()).toBe('–')
    expect(w.findAll('th .mo').map(e => e.text())).toEqual(['按月', '按月'])
    const link = trOf(w, 'rule:31').find('button.pm-ln')
    expect(link.text()).toBe('80,000 ㎡')
    await link.trigger('click')
    await flushPromises()
    // 跳到全园与期级那条面积基数,高亮 + 闪一下
    expect(w.find('.pm-ch').text()).toContain('全园与期级')
    const hl = w.findAll('.pm-table tbody tr.hl')
    expect(hl).toHaveLength(1)
    expect(hl[0].text()).toContain('园区分摊面积基数')
    expect(hl[0].classes()).toContain('pm-flash')
    w.unmount()
  })

  it('楼栋损耗一栋一行:调整度数带符号、率写百分数、口径缩短;没单独设写「默认」;不计入的表收成格内签', async () => {
    const w = await mountPage()
    await goSec(w, '楼栋损耗')
    const a = trOf(w, 'building:13')
    const cells = a.findAll('td').map(t => t.text())
    expect(cells.slice(0, 9)).toEqual(['A座本月改', '一期', '-1,500', '–', '0.30%', '默认', 'A座总电', '默认', '不参与'])
    const b = trOf(w, 'building:20')
    expect(b.findAll('td')[5].text()).toBe('仅按公摊分摊度数')
    expect(b.find('.chipm').text()).toBe('力美C201电')
    expect(b.text(), '表的改动算到它所在的栋').toContain('本月改')
    expect(w.find('.pm-ch').text()).toContain('「默认」= 没单独设，按期级口径')
    expect(w.findAll('.pm-ch .ds-seg, .pm-ch [role="radiogroup"], .pm-ch button').map(b => b.text()).join('|')).toContain('有设置 2')
    w.unmount()
  })

  // 破坏验证:tenOpen 初值改成全收 → 永龙那条红;toggleTen 不删 → 收起那条红
  it('❗户级例外按户分组:组头户名 / 期 / 项数;改过的和本月有专属值的户默认展开,其余收起;点组头收放', async () => {
    const w = await mountPage()
    await goSec(w, '户级例外')
    expect(w.findAll('tr.pm-grp').map(t => t.text().replace(/\s+/g, ''))).toEqual(['力灏一期·1项', '永龙二期·1项', '星州1项'])
    expect(trOf(w, 'tenant:5|mgmt_fee').exists(), '本月改过 → 展开').toBe(true)
    expect(trOf(w, 'tenant:6|loss_base_park_amount').exists(), '本月有专属值 → 展开').toBe(true)
    expect(trOf(w, 'tenant:7|green_rate').exists(), '其余收起').toBe(false)
    expect(trOf(w, 'tenant:5|capacity_fee').exists(), '继承全园的行不是例外').toBe(false)
    const l = trOf(w, 'tenant:5|mgmt_fee')
    expect(l.find('td.key').text()).toBe('0.15')
    expect(l.find('td.nm .u').text()).toBe('元/度')
    expect(l.text()).toContain('全园 0.16 元/度')
    await trOf(w, 'tenant:7').find('button.xp').trigger('click')
    expect(trOf(w, 'tenant:7|green_rate').exists()).toBe(true)
    await trOf(w, 'tenant:5').find('button.xp').trigger('click')
    expect(trOf(w, 'tenant:5|mgmt_fee').exists()).toBe(false)
    // 搜户名:只剩匹配的组,且展开
    await w.find('.pm-ch input').setValue('星州')
    expect(w.findAll('tr.pm-grp').map(t => t.find('.t').text())).toEqual(['星州'])
    w.unmount()
  })

  // 破坏验证:poolShown 去掉 byZone → 公摊池那条红;lossShown 去掉 byZone → 楼栋那条红;tenShown 去掉 sort → 户那条红
  it('❗排序:公摊池 / 楼栋按期区(一期在前,没标期区的最后,同期照后端序);户级例外默认展开的户排最前', async () => {
    const { paramsApi } = await import('@/api/params')
    // 后端按对象 id 出行:二期池 / 二期楼栋 id 小,排在前面;星州(收起组)也挪到最前
    const p2pool = row({ key: 'coefficient', label: '分摊基数（层数或面积）', group: 'constant', scope: 'rule:2', scopeLabel: '二期 一车间·公共用电（池）',
      value: 3, valueText: '3' })
    const p2bld = row({ key: 'loss_adj_rate', label: '损耗率加点', unit: '比率', group: 'constant', scope: 'building:9', scopeLabel: '二期 一车间',
      value: 0.002, valueText: '0.002 比率' })
    const star = ROWS.find(r => r.scope === 'tenant:7')!
    vi.mocked(paramsApi.list).mockResolvedValueOnce([p2pool, p2bld, star, ...ROWS.filter(r => r !== star)].map(r => ({ ...r })))
    const w = await mountPage()
    try {
      const ids = () => w.findAll('.pm-table tbody tr').map(t => t.attributes('id'))
      await goSec(w, '公摊池')
      expect(ids()).toEqual(['pm-row-rule:23', 'pm-row-rule:31', 'pm-row-rule:24', 'pm-row-rule:2'])
      await goSec(w, '楼栋损耗')
      expect(ids()).toEqual(['pm-row-building:13', 'pm-row-building:20', 'pm-row-building:9', 'pm-row-building:30'])
      await goSec(w, '户级例外')
      expect(w.findAll('tr.pm-grp').map(t => t.find('.t').text())).toEqual(['力灏', '永龙', '星州'])
    } finally { w.unmount() }
  })

  it('光伏分栋判据一张表;目录搜索回车跳到第一处匹配并闪一下,搜不到框变红', async () => {
    const w = await mountPage()
    const q = w.find('.pm-nq input')
    await q.setValue('永龙')
    await q.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(w.find('.pm-ch').text()).toContain('户级例外')
    expect((w.find('.pm-ch input').element as HTMLInputElement).value).toBe('永龙')
    expect(trOf(w, 'tenant:6').classes()).toContain('pm-flash')
    await q.setValue('半宽')
    await q.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(trOf(w, '|pv_band_sigma').classes()).toContain('pm-flash')
    expect(trOf(w, '|pv_band_sigma').find('td.key').text()).toBe('2倍')
    await q.setValue('没有这个')
    await q.trigger('keydown', { key: 'Enter' })
    expect(w.find('.pm-nq').classes()).toContain('miss')
    w.unmount()
  })
})

// ── 深链落点(画布 10-B 板下半五条)──
describe('ParamCenterView 深链落点', () => {
  // 破坏验证:jumpTo 里不重置 poolF → 被筛掉那条红(行不在);flash 改成整行 → 格子 pm-flash 红
  it('❗section=constant + rule=池号(公共电核算):公摊池,滚到那一行,分摊基数那一格闪一下', async () => {
    query.section = 'constant'; query.rule = '23'
    const w = await mountPage()
    expect(w.find('.pm-ch').text()).toContain('公摊池')
    const r = trOf(w, 'rule:23')
    expect(r.find('td.key').classes()).toContain('pm-flash')
    expect(scrolled).toContain('pm-row-rule:23')
    w.unmount()
  })

  // 破坏验证:applyHandoff 不接 L.building → 没滚没闪,红
  it('❗section=loss + building=13 + key=loss_adj_rate(楼栋损耗点加点格):楼栋损耗,滚到那一栋,加点那一格闪', async () => {
    query.section = 'loss'; query.building = '13'; query.key = 'loss_adj_rate'
    const w = await mountPage()
    expect(w.find('.pm-ch .pm-ct').text()).toBe('楼栋损耗')
    const tds = trOf(w, 'building:13').findAll('td')
    expect(tds[4].classes()).toContain('pm-flash')
    expect(tds[2].classes()).not.toContain('pm-flash')
    expect(scrolled.at(-1)).toMatch(/^pm-row-building:13/)
    w.unmount()
  })

  it('section=monthly + rule=池号:闪的是加减度数那一格', async () => {
    query.section = 'monthly'; query.rule = '23'
    const w = await mountPage()
    const tds = trOf(w, 'rule:23').findAll('td')
    expect(tds[2].classes()).toContain('pm-flash')
    expect(tds[4].classes()).not.toContain('pm-flash')
    w.unmount()
  })

  it.each([
    ['monthly', '全园与期级', 'pm-grp-monthly'],
    ['constant', '全园与期级', 'pm-grp-constant'],
    ['rule', '楼栋损耗', ''],
    ['loss', '楼栋损耗', ''],
    ['pv', '光伏分栋判据', ''],
  ])('section=%s → %s', async (section, name, grp) => {
    query.section = section
    const w = await mountPage()
    expect(w.find('.pm-ch .pm-ct').text()).toBe(name)
    if (grp) expect(scrolled).toContain(grp)
    w.unmount()
  })

  it('section=constant + adopt(光伏分栋分析「去改常数」)→ 光伏分栋判据', async () => {
    query.section = 'constant'; query.adopt = '2026-12'
    const w = await mountPage()
    expect(w.find('.pm-ch .pm-ct').text()).toBe('光伏分栋判据')
    w.unmount()
  })

  it('edit=1(楼栋损耗 / 催缴单「去重算」)只进编辑态,不自动弹卡;锁的是真的那个月', async () => {
    query.edit = '1'
    acquired.length = 0
    const w = await mountPage()
    expect(w.findAll('button').some(b => b.text() === '完成')).toBe(true)
    expect(pop(), '不自动弹改值卡').toBeNull()
    // ❗锁的必须是真的那个月:先认领期再进编辑态,顺序反了占的是 billing-chain:0-00
    expect(acquired).not.toContain('billing-chain:0-00')
    expect(acquired.some(x => /^billing-chain:\d{4}-\d{2}$/.test(x))).toBe(true)
    // 编辑态期间条没有「换出账月」,标题旁没有「改动都已重算」(画布 10-B)
    expect(w.text()).not.toContain('换出账月')
    expect(w.findAll('.pm-head .fp-state').map(e => e.text())).toEqual(['本月电价 6/6'])
    w.unmount()
  })

  it('分析层 adopt=YYYY-12:会话已选期 → 不动(不是选月)', async () => {
    delete query.ym
    query.adopt = '2026-12'
    useBillingPeriodStore().pick(2025, 3)
    const w = await mountPage()
    expect(useBillingPeriodStore().ym).toBe('2025-03')
    w.unmount()
  })

  it('分析层 adopt=YYYY-12:会话没有期 → 认领,不撞矩阵', async () => {
    delete query.ym
    query.adopt = '2026-12'
    const w = await mountPage()
    expect(useBillingPeriodStore().ym).toBe('2026-12')
    expect(w.find('.cmg').exists()).toBe(false)
    w.unmount()
  })
})

// ── 本月改动 + 某项历史 ──
describe('ParamCenterView 本月改动 / 历史', () => {
  it('本月改动表:时间 / 参数(带范围)/ 旧 → 新 / 谁(带「x 授权」);重算行写摘要', async () => {
    const w = await mountPage()
    await goSec(w, '本月改动')
    const c = w.findComponent(ParamChangesDrawer)
    expect(c.props('open')).toBe(true)
    expect(c.text()).toContain('影响 2024-02 · 5 项改了 5 次，新的在上')
    const trs = c.findAll('.pc-tab tbody tr').map(t => t.findAll('td').map(d => d.text()))
    expect(trs[0].slice(0, 4)).toEqual(['09-25 00:02', '重算本月', '池 3 · 损耗 2 · 催缴单 9', 'admin'])
    expect(trs[1].slice(0, 4)).toEqual(['08-22 17:21', '电力管理费力灏', '–→0.15 元/度', 'clerkboss授权'])
    expect(trs).toHaveLength(6)
    expect(c.text(), '日志里别的屏记的单元面积改动不上屏').not.toContain('unit:54')
    w.unmount()
  })

  // 破坏验证:jumpTo 的 pool 分支不重置 poolF → 红(行被筛掉不在表里)
  it('❗点一行跳到那一项:被筛掉的行先切回「全部」,滚到并闪那一格;表的改动跳到它所在栋的「不计入」格', async () => {
    const w = await mountPage()
    await goSec(w, '公摊池')
    await w.findAll('.pm-ch button').find(b => b.text().startsWith('有设置'))!.trigger('click')
    expect(trOf(w, 'rule:31').exists(), '前置:路灯池没单独设,被「有设置」筛掉').toBe(false)
    await goSec(w, '本月改动')
    const rowOf = (label: string) => w.findAll('.pc-tab tbody tr').find(t => t.text().includes(label))!
    await rowOf('公摊池加减度数').trigger('click')
    await flushPromises()
    expect(w.find('.pm-ch .pm-ct').text()).toBe('公摊池')
    const r31 = trOf(w, 'rule:31')
    expect(r31.exists()).toBe(true)
    expect(r31.findAll('td')[2].classes()).toContain('pm-flash')
    expect(scrolled.at(-1)).toBe('pm-row-rule:31')
    await goSec(w, '本月改动')
    await rowOf('不计入楼栋合计的电表').trigger('click')
    await flushPromises()
    expect(w.find('.pm-ch .pm-ct').text()).toBe('楼栋损耗')
    expect(trOf(w, 'building:20').findAll('td')[9].classes()).toContain('pm-flash')
    // 重算行不跳
    await goSec(w, '本月改动')
    expect(rowOf('重算本月').classes()).not.toContain('go')
    w.unmount()
  })

  // 破坏验证:useAt 不让 month 行优先 / inUse 判错 → 色段断言红
  it('❗某项历史 = 居中卡:12 个月色段(本月在用实蓝、旧版浅蓝、换手处断开)、版本列表「本月在用」、变更记录带授权人', async () => {
    const { paramsApi } = await import('@/api/params')
    const hist: ParamHistoryDTO = {
      versions: [
        { acctMonth: '', mode: 'from', value: 2000, valueText: '2,000', note: null, rangeText: '长期 ~ 2024-01' },
        { acctMonth: '2024-02', mode: 'from', value: 2293.34, valueText: '2,293.34', note: '源册', rangeText: '2024-02 起长期' },
        { acctMonth: '2024-05', mode: 'month', value: 2400, valueText: '2,400', note: null, rangeText: '仅 2024-05' },
      ],
      changes: [
        { ts: '2026-08-16T05:00:00', actor: 'migrate', action: 'migrate', acctMonth: '2024-02', mode: 'from', oldValue: null, newValue: 2293.34,
          oldText: null, newText: '2,293.34', note: null },
        { ts: '2026-08-20T09:00:00', actor: 'clerk', action: 'set', acctMonth: '2024-05', mode: 'month', oldValue: null, newValue: 2400,
          oldText: null, newText: '2,400', note: null, authorizer: 'boss' } as ParamChangeDTO,
      ],
    }
    vi.mocked(paramsApi.history).mockResolvedValueOnce(hist)
    const w = await mountPage()
    try {
      await goSec(w, '公摊池')
      await trOf(w, 'rule:24').find('td.hi button').trigger('click')
      await flushPromises()
      expect(paramsApi.history).toHaveBeenLastCalledWith('coefficient', 'rule:24')
      const dlg = document.querySelector('.ph')!
      expect(dlg, '居中卡,不是抽屉').toBeTruthy()
      expect(document.querySelector('.fp-dwr')).toBeNull()
      expect(dlg.querySelector('h3')!.textContent).toBe('分摊基数（层数或面积）')
      expect(dlg.querySelector('.ph-ht p')!.textContent).toBe('一期 A座·三楼西侧·公共用电 · 版本时间轴与变更记录')
      const bars = [...dlg.querySelectorAll('.ph-tl > div')].map(d => [d.querySelector('.m')!.textContent, d.querySelector('.bar')!.className.replace('bar', '').trim()])
      expect(bars).toEqual([
        ['23-08', 'old st'], ['23-09', 'old'], ['23-10', 'old'], ['23-11', 'old'], ['23-12', 'old'], ['24-01', 'old en'],
        ['24-02', 'cur st'], ['24-03', 'cur'], ['24-04', 'cur en'], ['24-05', 'month st en'], ['24-06', 'cur st'], ['24-07', 'cur en'],
      ])
      expect(dlg.querySelector('.ph-tl .m.cur')!.textContent).toBe('24-02')
      const vers = [...dlg.querySelectorAll('.ph-vr')].map(v => v.textContent?.replace(/\s+/g, ''))
      expect(vers).toEqual(['2,400仅2024-05', '2,293.342024-02起长期本月在用', '2,000长期~2024-01'])
      const ch = [...dlg.querySelectorAll('.ph-tab tbody tr')].map(t => [...t.querySelectorAll('td')].slice(0, 4).map(d => d.textContent))
      expect(ch).toEqual([
        ['2026-08-16 05:00', '系统', '迁移 · 2024-02 起', '–→2,293.34'],
        ['2026-08-20 09:00', 'clerkboss授权', '设置 · 仅 2024-05', '–→2,400'],
      ])
      // Esc 关
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await flushPromises()
      expect(document.querySelector('.ph')).toBeNull()
    } finally { w.unmount() }
  })
})

// ── 公摊池窄宽固定列(LIST-PAGE §9.1,画布 10-B 板下注)——断言钉坐标 ──
describe('ParamCenterView 公摊池固定列', () => {
  let visW = 0
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true, get(this: HTMLElement) { return this.classList?.contains('pm-tw') ? visW : 0 },
    })
  })
  afterEach(() => { delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth })
  const st = (w: W, label: string) => (w.findAll('.pm-table th').find(t => t.text() === label)!.element as HTMLElement).style

  // 池名最长「A座·三楼西侧 公共用电」+「● 本月改」= 248 → 封顶 1/5;分摊基数按整列最长的数 94
  // 破坏验证:poolCols 里分摊基数的 rank 改 0 → 500 宽那条红(不退);名称列不封顶 → 778 那条 left 红
  it('❗778 宽(1366 侧栏展开):池 ≤ 可见宽 1/5(155),分摊基数贴在它右边 left=155', async () => {
    visW = 778
    const w = await mountPage()
    await goSec(w, '公摊池')
    expect([st(w, '池').position, st(w, '池').left, st(w, '池').width]).toEqual(['sticky', '0px', '155px'])
    expect([st(w, '分摊基数').position, st(w, '分摊基数').left, st(w, '分摊基数').width]).toEqual(['sticky', '155px', '94px'])
    const nm = trOf(w, 'rule:24').find('td.nm').element as HTMLElement
    expect(nm.style.maxWidth, '名称格跟着封顶,超了省略').toBe('155px')
    expect((trOf(w, 'rule:24').find('td.nm .t').element as TipEl)._tip?.text, '悬停看全称').toBe('A座·三楼西侧 公共用电')
    w.unmount()
  })

  it('❗500 宽:池 + 分摊基数超可见宽 40%(200)→ 先退分摊基数,池留着(下限 132)', async () => {
    visW = 500
    const w = await mountPage()
    await goSec(w, '公摊池')
    expect([st(w, '池').position, st(w, '池').left, st(w, '池').width]).toEqual(['sticky', '0px', '132px'])
    expect(st(w, '分摊基数').position).toBe('')
    w.unmount()
  })
})

describe('ParamCenterView 编辑态写入口', () => {
  it('浏览态零写入口;编辑态空格悬停「+ 设置」、复制上月电价挂在每月核对组头、户级例外卡头出新增例外', async () => {
    const w = await mountPage()
    const texts = () => w.findAll('button').map(b => b.text())
    expect(w.findAll('.pm-set')).toHaveLength(0)
    expect(texts().some(s => s.includes('复制上月电价'))).toBe(false)
    await trOf(w, '|elec_peak').find('td.key').trigger('click')
    expect(pop(), '浏览态点格子不弹卡').toBeNull()
    await enterEdit(w)
    expect(trOf(w, '|elec_valley').find('td.key .pm-set .b').text()).toBe('设置')
    // 破坏验证:模板 .pm-set 里的「–」去掉 → 这两条红(编辑态没悬停的空格得跟浏览态一样写「–」,卡头图例才对得上)
    expect(trOf(w, '|elec_valley').find('td.key .pm-set .dim').text()).toBe('–')
    await goSec(w, '公摊池')
    expect(trOf(w, 'rule:23').find('td.key .pm-set .dim').text()).toBe('–')
    await goSec(w, '全园与期级')
    expect(w.find('[id="pm-grp-monthly"]').text()).toContain('复制上月电价')
    expect(w.find('[id="pm-grp-constant"]').text()).not.toContain('复制上月电价')
    await goSec(w, '户级例外')
    expect(texts().some(s => s.includes('新增例外'))).toBe(true)
    expect(texts().some(s => s.includes('批量修改 → 系数簿'))).toBe(true)
    // 重算本月在问题面板「待重算」组头(本月没过期 → 不出),屏上不单放一颗
    expect(texts().some(s => s.includes('重算本月'))).toBe(false)
    w.unmount()
  })

  // 破坏验证:openEdit 里不记 anchor → 卡不贴格(anchor 断言红);put 成功后 patchRow 改成整表重拉 → listCalls 红
  it('❗点格贴格弹改值卡 → 保存:PUT 带页面账期,只 patch 该行,「待处理」翻成 1', async () => {
    const { paramsApi } = await import('@/api/params')
    const listCalls = () => vi.mocked(paramsApi.list).mock.calls.length
    const before = listCalls()
    const w = await mountPage()
    expect(listCalls()).toBe(before + 1)   // 深链账期只拉一次
    await enterEdit(w)
    await goSec(w, '楼栋损耗')
    const cell = trOf(w, 'building:13').find('td.key')
    await cell.trigger('click')
    await flushPromises()
    const p = w.findComponent(ParamEditPopover)
    expect(p.props('row')?.scope).toBe('building:13')
    expect(p.props('anchor')).toBe(cell.element)
    expect(cell.classes(), '打开的那一格蓝框').toContain('on')
    expect(pop()!.querySelector('.pe-ht b')!.textContent).toBe('损耗调整度数')
    expect(pop()!.querySelector('.pe-was')!.textContent).toBe('当前 -1,500')
    const returned = row({ key: 'loss_adj_qty', label: '损耗调整度数', unit: '度', group: 'monthly', scope: 'building:13', scopeLabel: '一期 A座',
      value: -1400, valueText: '-1,400 度', mode: 'month', acctMonth: '2024-02', rangeText: '仅 2024-02', hasMonthRow: true })
    put.mockResolvedValueOnce(returned)
    p.vm.$emit('save', { key: 'loss_adj_qty', scope: 'building:13', acctMonth: '2024-02', mode: 'month', value: -1400, note: null, correction: false })
    await flushPromises()
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ key: 'loss_adj_qty', scope: 'building:13', value: -1400 }), '2024-02')
    expect(trOf(w, 'building:13').find('td.key').text()).toBe('-1,400')
    expect(pop(), '保存成功卡收起').toBeNull()
    expect(w.find('button.fac').text()).toContain('待处理 1')
    expect(listCalls()).toBe(before + 1)
    w.unmount()
  })

  it('「不计入的表」格里的「+」:卡换成选这栋还没设的表,存成那块表的 loss_exclude=1', async () => {
    const w = await mountPage()
    await enterEdit(w)
    await goSec(w, '楼栋损耗')
    await trOf(w, 'building:20').find('button.pm-add').trigger('click')
    await flushPromises()
    const p = w.findComponent(ParamEditPopover)
    expect(p.props('meterPick')).toEqual([{ value: '308', label: 'B座总电' }])
    expect(pop()!.querySelector('.pe-ht b')!.textContent).toBe('不计入楼栋合计的表')
    w.unmount()
  })

  // 回归钉:ref_meter 候选按 scope === 'p1'/'p2'/'dorm' 枚举漏了 p3
  it('期级 ref_meter 候选按期区过滤到 p3:不退化成全园所有表', async () => {
    const w = await mountPage()
    await enterEdit(w)
    await trOf(w, 'p3|loss_supply_meter').find('td.key').trigger('click')
    const p = w.findComponent(ParamEditPopover)
    expect(p.props('row')?.scope).toBe('p3')
    expect(p.props('refOptions')).toEqual([{ value: '400', label: '三期总电' }])
    w.unmount()
  })

  // 回归钉:zoneOfBuilding 曾按 phase 猜期区;三期 G栋(zone null)只跟别的未标注楼栋同桶
  it('楼栋 ref_building 候选按真实 zone 分桶:三期未标注楼栋不混入一期候选', async () => {
    const w = await mountPage()
    await enterEdit(w)
    await goSec(w, '楼栋损耗')
    await trOf(w, 'building:30').findAll('td')[7].trigger('click')
    const p = w.findComponent(ParamEditPopover)
    expect(p.props('row')?.key).toBe('loss_head')
    expect(p.props('refOptions')).toEqual([{ value: '30', label: '三期 G栋' }])
    w.unmount()
  })

  it('❗GET /meters 带页面账期', async () => {
    const { metersApi } = await import('@/api/meters')
    const list = vi.mocked(metersApi.list)
    list.mockClear()
    const w = await mountPage()
    expect(list).toHaveBeenCalledWith('elec', undefined, '2024-02')
    w.unmount()
  })
})

// ── 改值卡(画布 10-B):三选、删除这一版 ──
describe('ParamEditPopover 改值卡', () => {
  const COEF = ROWS.find(r => r.scope === 'rule:24')!          // 2024-02 起长期 2,293.34
  const AQTY = ROWS.find(r => r.scope === 'building:13' && r.key === 'loss_adj_qty')!   // 仅 2024-02
  const PEAK = ROWS.find(r => r.key === 'elec_peak')!
  const mountPop = (r: ParamRowDTO) => mount(ParamEditPopover, { props: { open: true, row: r, ym: '2024-02' }, attachTo: document.body })
  const rads = () => [...document.querySelectorAll('.pe-pop .pe-rad')] as HTMLLabelElement[]
  async function fill(v: string) {
    const inp = document.querySelector('.pe-pop input.pe-num') as HTMLInputElement
    inp.value = v
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
  }
  const save = () => ([...document.querySelectorAll('.pe-pop button')].find(b => b.textContent?.trim() === '保存') as HTMLButtonElement).click()

  it('400 宽卡:标题 + 对象副句;值 + 单位 +「当前 x」;三选文案', async () => {
    const w = mountPop(COEF)
    await flushPromises()
    expect(pop()!.querySelector('.pe-ht')!.textContent).toBe('分摊基数（层数或面积）一期 A座·三楼西侧·公共用电')
    expect(pop()!.querySelector('.pe-was')!.textContent).toBe('当前 2,293.34')
    expect(rads().map(r => r.textContent?.trim())).toEqual([
      '仅 2024-02', '自 2024-02 起，用到更晚的一版为止', '改错：原地更正「2024-02 起」这一版',
    ])
    // 默认 = 注册表默认方式(分摊基数 from),选中那项下面一句说明
    expect(pop()!.querySelector('.pe-eff')!.textContent).toBe('2024-02 及以后沿用；更早的月份不受影响')
    w.unmount()
  })

  // 破坏验证:submit 里 correction 时 mode 改成 way.value → 第三条红;month/from 把 acctMonth 换成 r.acctMonth → 前两条红
  it.each([
    [0, { mode: 'month', correction: false, acctMonth: '2024-02' }],
    [1, { mode: 'from', correction: false, acctMonth: '2024-02' }],
    [2, { mode: 'from', correction: true, acctMonth: '2024-02' }],
  ] as const)('❗三选第 %i 项 → 提交的请求体', async (i, want) => {
    // 当前那一版起点 2023-10 ≠ 页面账期:三选的 acctMonth 一律是页面账期,换成版本起点要红
    const w = mountPop({ ...COEF, acctMonth: '2023-10', rangeText: '2023-10 起长期' })
    await flushPromises()
    await fill('2350')
    rads()[i].querySelector('input')!.click()
    await flushPromises()
    save()
    await flushPromises()
    expect(w.emitted('save')![0][0]).toEqual({ key: 'coefficient', scope: 'rule:24', value: 2350, note: null, ...want })
    w.unmount()
  })

  it('只能按月生效的键(电价)只给「仅本月」+「改错」;没有自己版本的行不给「改错」', async () => {
    const w1 = mountPop(PEAK)
    await flushPromises()
    expect(rads().map(r => r.textContent?.trim())).toEqual(['仅 2024-02', '改错：原地更正「仅 2024-02」这一版'])
    w1.unmount()
    const w2 = mountPop({ ...COEF, rowId: null, mode: null, value: null, valueText: '' })
    await flushPromises()
    expect(rads().map(r => r.textContent?.trim())).toEqual(['仅 2024-02', '自 2024-02 起，用到更晚的一版为止'])
    expect(document.querySelector('.pe-del'), '没有这一版可删').toBeNull()
    expect(document.querySelector('.pe-was'), '没有当前值').toBeNull()
    w2.unmount()
  })

  // 破坏验证:remove 的 acctMonth 换成页面账期 → from 那条红;删除标签改回「删除此版本」→ 文案红
  //   夹具版本起点 2023-10 ≠ 页面账期 2024-02:两者相同的话换成页面账期也是绿的(退化夹具)
  it('❗删除「2023-10 起」这一版:问一句(红钮),答「删除」发 value=null 的那一版', async () => {
    const w = mountPop({ ...COEF, acctMonth: '2023-10', rangeText: '2023-10 起长期' })
    await flushPromises()
    const del = document.querySelector('.pe-pop .pe-del') as HTMLButtonElement
    expect(del.textContent).toBe('删除「2023-10 起」这一版')
    del.click()
    await flushPromises()
    expect(askQueue.map(a => [a.title, a.danger])).toEqual([['删除「一期 A座·三楼西侧·公共用电（池） · 分摊基数（层数或面积）」版本「2023-10 起长期」？', true]])
    answer(true)
    await flushPromises()
    expect(w.emitted('save')![0][0]).toEqual({ key: 'coefficient', scope: 'rule:24', acctMonth: '2023-10', mode: 'from', value: null, note: null, correction: false })
    w.unmount()
  })

  it('有本月专属行 → 删的是「仅 2024-02」这一版(恢复长期值)', async () => {
    const w = mountPop(AQTY)
    await flushPromises()
    const del = document.querySelector('.pe-pop .pe-del') as HTMLButtonElement
    expect(del.textContent).toBe('删除「仅 2024-02」这一版')
    del.click()
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(w.emitted('save')![0][0]).toEqual(expect.objectContaining({ key: 'loss_adj_qty', scope: 'building:13', acctMonth: '2024-02', mode: 'month', value: null }))
    w.unmount()
  })

  it('布尔键状态句与后端 valueText 同口径:供电局对账 参与 / 不参与', async () => {
    const w = mountPop(ROWS.find(r => r.key === 'loss_recon')!)
    await flushPromises()
    expect(pop()!.textContent).toContain('不参与')
    expect(pop()!.textContent).not.toContain('参与对账')
    w.unmount()
  })

  // 破坏验证:onDoc 里去掉 askQueue 判断 → 第二条红;onKey 不 stopPropagation → 第三条红
  it('❗点外面关、确认弹窗开着时点不算点外面;Esc 只关自己', async () => {
    const w = mountPop(COEF)
    await flushPromises()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(w.emitted('close')).toHaveLength(1)
    askQueue.push({ title: 'x', resolve: () => {} } as never)
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(w.emitted('close')).toHaveLength(1)
    askQueue.splice(0)
    const outer = vi.fn()
    window.addEventListener('keydown', outer)
    pop()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(w.emitted('close')).toHaveLength(2)
    expect(outer, '宿主的 Esc 不该再收到').not.toHaveBeenCalled()
    window.removeEventListener('keydown', outer)
    w.unmount()
  })
})

/**
 * 编辑态守卫(2026-08-30,同 MeterView/BillNoticesView 那一批):
 * editMode 会**就地**转假(被接管 / 30 分钟提权到期),而写 UI 的 v-if 只判自己的 ref。
 */
describe('ParamCenterView 编辑态守卫', () => {
  it('❗编辑态就地转假 → 改值卡 / 新增例外抽屉全部收起', async () => {
    const w = await mountPage()
    const vm = w.vm as unknown as { editMode: boolean; editRow: object | null; exOpen: boolean }
    vm.editMode = true
    await nextTick()
    vm.editRow = ROWS[0]
    vm.exOpen = true
    await nextTick()
    vm.editMode = false          // ← 接管 / 提权到期走的正是这一句
    await nextTick()
    expect(vm.editRow, '改值卡没关').toBeNull()
    expect(vm.exOpen, '新增例外抽屉没关').toBe(false)
    w.unmount()
  })

  it('❗浏览态下 put 漏斗必须打不出去', async () => {
    const w = await mountPage()
    put.mockClear()
    const vm = w.vm as unknown as { put: (req: object) => Promise<boolean> }
    const ok = await vm.put({ key: 'water', scope: '', acctMonth: '2024-02', mode: 'from', value: 1.1 })
    expect(ok, '浏览态下要返回 false').toBe(false)
    expect(put, '浏览态下 PUT 被打出去了').not.toHaveBeenCalled()
    w.unmount()
  })

  it('❗浏览态下 重算/批量重算/复制上月电价 一个 API 都不许打出去', async () => {
    const { paramsApi } = await import('@/api/params')
    const w = await mountPage()
    vi.mocked(paramsApi.recalc).mockClear()
    vi.mocked(paramsApi.copyPrev).mockClear()
    const vm = w.vm as unknown as {
      status: { otherMonthsAffected: string[] } | null
      onRecalc: () => Promise<void>; onRecalcOthers: () => Promise<void>; onCopy: () => Promise<void>
    }
    // ⚠ 前置做足:otherMonths 为空时 onRecalcOthers 在自己的早退分支就 return,守卫删掉照样绿
    if (vm.status) vm.status.otherMonthsAffected = ['2024-01', '2023-12']
    const runs = [vm.onRecalc(), vm.onRecalcOthers(), vm.onCopy()]
    await flushPromises()
    expect(askQueue, '浏览态连确认弹窗都不该出').toHaveLength(0)
    while (askQueue.length) { answer(true); await flushPromises() }
    await Promise.all(runs)
    expect(paramsApi.recalc).not.toHaveBeenCalled()
    expect(paramsApi.copyPrev).not.toHaveBeenCalled()
    w.unmount()
  })

  it('编辑态里同样的调用照常出去 —— 上面两条不是被别的早退放绿的', async () => {
    const w = await mountPage()
    const vm = w.vm as unknown as { editMode: boolean; put: (req: object) => Promise<boolean> }
    vm.editMode = true
    await nextTick()
    put.mockClear()
    put.mockResolvedValueOnce(row({ key: 'water', group: 'constant', scopeLabel: '全园', label: '水价', scope: '', valueText: '1.1', rangeText: '长期' }))
    await vm.put({ key: 'water', scope: '', acctMonth: '2024-02', mode: 'from', value: 1.1 })
    expect(put).toHaveBeenCalledTimes(1)
    w.unmount()
  })
})

// ── 屏级告警:标题行「待处理」入口 + 问题面板(LAYOUT-STABILITY-SPEC §6) ──
describe('ParamCenterView 待处理入口', () => {
  const STALE: ParamStatusDTO = {
    ...STATUS, stale: true, pendingChanges: 2, lastChangeAt: '2026-08-18T09:20:00', otherMonthsAffected: ['2023-08', '2023-10'],
  }
  const drawer = () => document.querySelector('.fap')
  const acts = () => [...document.querySelectorAll('.fap-gh button:not(.fap-tg)')] as HTMLButtonElement[]
  const openChip = async (w: W) => { await w.find('button.fac').trigger('click'); await flushPromises() }

  it('页面状态只留中性事实;过期 + 其他月份受影响进入口(3)与面板分组', async () => {
    const { paramsApi } = await import('@/api/params')
    vi.mocked(paramsApi.status).mockResolvedValueOnce({ ...STALE })
    const w = await mountPage()
    expect(w.findAll('.pm-head .fp-state').map(e => e.text())).toEqual(['本月电价 6/6'])
    expect(w.find('.pm-actions button.fac').text(), '入口在标题行右侧').toContain('待处理 3')
    await openChip(w)
    const t = drawer()!.textContent ?? ''
    expect(t).toContain('待重算')
    expect(t).toContain('自上次重算起改了 2 项参数')
    expect(t).toContain('2023-08')
    w.unmount()
  })

  it('❗只有抄表改过 → 面板说抄表有改动,不出「改了 0 项参数」', async () => {
    const { paramsApi } = await import('@/api/params')
    vi.mocked(paramsApi.status).mockResolvedValueOnce({
      ...STATUS, stale: true, pendingChanges: 0, lastChangeAt: '2026-08-18T09:20:00', lastChangeSource: 'meter', staleSources: ['meter'],
    })
    const w = await mountPage()
    try {
      await openChip(w)
      const t = drawer()!.textContent ?? ''
      expect(t).toContain('自上次重算起抄表数据（读数或表档案）有改动')
      expect(t).not.toContain('项参数')
    } finally { w.unmount() }
  })

  it('无告警时入口仍渲染(quiet 态「无待处理」)', async () => {
    const w = await mountPage()
    const chip = w.find('button.fac')
    expect(chip.text()).toContain('无待处理')
    expect(chip.classes()).toContain('quiet')
    w.unmount()
  })

  it('❗组头:浏览态给「进入编辑模式」,编辑态换成「重算本月」;失败出带「重试」的回执', async () => {
    const { paramsApi } = await import('@/api/params')
    vi.mocked(paramsApi.status).mockResolvedValueOnce({ ...STALE })
    const recalc = vi.mocked(paramsApi.recalc)
    recalc.mockReset()
    recalc.mockRejectedValueOnce(new Error('重算挂了'))
    const w = await mountPage()
    try {
      await openChip(w)
      expect(acts().map(b => b.textContent?.trim())).toEqual(['进入编辑模式', '进入编辑模式'])
      acts()[0].click()
      await flushPromises()
      await openChip(w)
      expect(acts().map(b => b.textContent?.trim())).toEqual(['重算本月', '一键重算这 2 个月'])
      acts()[0].click()
      await flushPromises()
      expect(askQueue.map(a => a.title)).toEqual(['重算 2024-02？'])
      answer(true)
      await flushPromises()
      expect(recalc).toHaveBeenCalledWith('2024-02')
      const r = receipts.at(-1)
      expect([r?.tone, r?.text, r?.action?.label]).toEqual(['fail', '重算挂了', '重试'])
    } finally { recalc.mockReset(); w.unmount() }
  })

  it('一键重算这 2 个月:逐月调 recalc → 刷新 → 入口归零,成功回执', async () => {
    const { paramsApi } = await import('@/api/params')
    const recalc = vi.mocked(paramsApi.recalc)
    recalc.mockResolvedValue({ pools: 1, lossUnits: 1, notices: 1, skippedConfirmed: 0, warnings: [] })
    vi.mocked(paramsApi.status).mockResolvedValueOnce({ ...STALE })
    const w = await mountPage()
    await enterEdit(w)
    await openChip(w)
    acts().find(b => b.textContent?.includes('一键重算这 2 个月'))!.click()
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(recalc.mock.calls.map(c => c[0])).toEqual(['2023-08', '2023-10'])
    expect(w.find('button.fac').text()).toContain('无待处理')
    expect(receipts.map(r => [r.tone, r.text])).toEqual([['ok', '已重算 2 个月：2023-08、2023-10']])
    recalc.mockReset()
    w.unmount()
  })

  it('❗重算成功但有警告:不自收的警告回执,带第一条原文和其余去哪看', async () => {
    const { paramsApi } = await import('@/api/params')
    vi.mocked(paramsApi.status).mockResolvedValueOnce({ ...STALE })
    const recalc = vi.mocked(paramsApi.recalc)
    recalc.mockReset()
    recalc.mockResolvedValueOnce({ pools: 1, lossUnits: 2, notices: 3, skippedConfirmed: 0, warnings: ['甲', '乙'] })
    const w = await mountPage()
    try {
      await enterEdit(w)
      await openChip(w)
      acts().find(b => b.textContent?.includes('重算本月'))!.click()
      await flushPromises()
      answer(true)
      await flushPromises()
      expect(receipts.map(r => [r.tone, r.text]))
        .toEqual([['warn', '重算完成：池 1 · 损耗单元 2 · 催缴单 3（跳过已确认 / 已导出 0）。警告 2 条，第一条：甲。'
          + '其余 1 条要到公共电核算重新生成本月才看得到。']])
    } finally { recalc.mockReset(); w.unmount() }
  })

  it('❗一键重算中途失败:失败回执报断点和已完成几个月', async () => {
    const { paramsApi } = await import('@/api/params')
    vi.mocked(paramsApi.status).mockResolvedValueOnce({ ...STALE })
    const recalc = vi.mocked(paramsApi.recalc)
    recalc.mockReset()
    recalc.mockResolvedValueOnce({ pools: 1, lossUnits: 1, notices: 1, skippedConfirmed: 0, warnings: [] }).mockRejectedValueOnce(new Error('炸了'))
    const w = await mountPage()
    try {
      await enterEdit(w)
      await openChip(w)
      acts().find(b => b.textContent?.includes('一键重算这 2 个月'))!.click()
      await flushPromises()
      answer(true)
      await flushPromises()
      expect(receipts.map(r => [r.tone, r.text])).toEqual([['fail', '重算中断于 2023-10（炸了）；已完成 1 个月']])
    } finally { recalc.mockReset(); w.unmount() }
  })

  it('❗确认弹窗开着时被退出编辑态 / 换了月,答了也不重算、不复制', async () => {
    const { paramsApi } = await import('@/api/params')
    const recalc = vi.mocked(paramsApi.recalc)
    const copyPrev = vi.mocked(paramsApi.copyPrev)
    recalc.mockReset(); copyPrev.mockReset()
    const w = await mountPage()
    try {
      await enterEdit(w)
      const vm = w.vm as unknown as { editMode: boolean; onRecalc: () => Promise<void>; onCopy: () => Promise<void> }
      const p1 = vm.onRecalc()
      await flushPromises()
      vm.editMode = false
      await flushPromises()
      answer(true)
      await p1
      expect(recalc).not.toHaveBeenCalled()
      await enterEdit(w)
      const p2 = vm.onCopy()
      await flushPromises()
      expect(askQueue.map(a => a.title)).toEqual(['复制上月电价到 2024-02？'])
      useBillingPeriodStore().pick(2024, 3)
      await flushPromises()
      if (!vm.editMode) await enterEdit(w)
      answer(true)
      await p2
      expect(copyPrev).not.toHaveBeenCalled()
    } finally { w.unmount() }
  })

  // 破坏验证:srcItems 参数那一条去掉 onClick → 红
  it('「改了 N 项参数」那一条点开本月改动', async () => {
    const { paramsApi } = await import('@/api/params')
    vi.mocked(paramsApi.status).mockResolvedValueOnce({ ...STALE })
    const w = await mountPage()
    try {
      await openChip(w)
      const item = [...document.querySelectorAll('.fap-item')].find(b => b.textContent?.includes('改了 2 项参数')) as HTMLButtonElement
      item.click()
      await flushPromises()
      expect(w.findComponent(ParamChangesDrawer).props('open')).toBe(true)
      expect(navItem(w, '本月改动').classes()).toContain('on')
    } finally { w.unmount() }
  })
})

describe('ParamCenterView 提示件', () => {
  it('❗新增例外缺字段:红字贴在字段下面,不弹窗、不走回执、不发请求', async () => {
    const w = await mountPage()
    try {
      await enterEdit(w)
      await goSec(w, '户级例外')
      await w.findAll('button').find(b => b.text().includes('新增例外'))!.trigger('click')
      await flushPromises()
      const errs = () => [...document.querySelectorAll('.fp-dwr .fp-field-err')].map(e => e.textContent?.trim() ?? '')
      expect(errs().filter(Boolean), '没点保存前不报').toEqual([])
      put.mockClear()
      const save = [...document.querySelectorAll('.fp-dwr button')].find(b => b.textContent?.trim() === '保存') as HTMLButtonElement
      save.click()
      await flushPromises()
      expect(errs()).toContain('请选择租户')
      expect(errs()).toContain('请输入值')
      expect(receipts).toHaveLength(0)
      expect(put).not.toHaveBeenCalled()
      expect(document.querySelector('.fp-dwr .fp-tp-trigger')!.classList.contains('invalid')).toBe(true)
      expect(document.querySelector('.fp-dwr input.pm-exin[type="number"]')!.classList.contains('bad')).toBe(true)
    } finally { w.unmount() }
  })

  it('保存失败 → 底部失败回执', async () => {
    const w = await mountPage()
    try {
      const vm = w.vm as unknown as { editMode: boolean; put: (req: object) => Promise<boolean> }
      vm.editMode = true
      await nextTick()
      put.mockRejectedValueOnce(new Error('网络断了'))
      expect(await vm.put({ key: 'water', scope: '', acctMonth: '2024-02', mode: 'from', value: 1.1 })).toBe(false)
      expect(receipts.map(r => [r.tone, r.text])).toEqual([['fail', '网络断了']])
    } finally { w.unmount() }
  })

  // 破坏验证:模板 FPLoadError 的 v-else 分支去掉 → 目录断言红;FPEditModeButton 的 :disabled 删掉 → 禁用断言红
  it('❗参数没读到:失败件换掉目录与当前区、编辑按钮禁「进」;点重试重拉,成功后回来', async () => {
    const { paramsApi } = await import('@/api/params')
    const list = vi.mocked(paramsApi.list)
    list.mockRejectedValueOnce(new Error('后端挂了'))
    const w = await mountPage()
    try {
      expect(w.find('.fp-empty.error').text()).toContain('2024 年 2 月的计费参数没读到')
      expect(w.find('.pm-body').exists(), '失败时目录与当前区该被换掉').toBe(false)
      expect(w.findAll('button').find(b => b.text().includes('编辑模式'))!.attributes('disabled')).toBeDefined()
      const n = list.mock.calls.length
      await w.findAll('button').find(b => b.text().includes('重试'))!.trigger('click')
      await flushPromises()
      expect(list.mock.calls.length).toBe(n + 1)
      expect(w.find('.pm-body').exists()).toBe(true)
      expect(w.find('.fp-empty.error').exists()).toBe(false)
    } finally { w.unmount() }
  })

  // 破坏验证:load() 的 catch 里 status.value = null 去掉 → 状态签还是「本月电价 6/6」、入口还是「待处理」,两条红
  it('❗读成功后换期区重拉失败:标题旁状态签与「待处理」不留上一次读到的', async () => {
    const { paramsApi } = await import('@/api/params')
    vi.mocked(paramsApi.status).mockResolvedValueOnce({ ...STATUS, stale: true, pendingChanges: 2 })
    const w = await mountPage()
    try {
      expect(w.findAll('.pm-head .fp-state').map(e => e.text())).toEqual(['本月电价 6/6'])
      expect(w.find('button.fac').text(), '前置:上一次读到的有待处理').not.toContain('无待处理')
      vi.mocked(paramsApi.list).mockRejectedValueOnce(new Error('后端挂了'))
      await w.find('.pm-head-l').findAll('button[role="tab"]').find(b => b.text() === '一期')!.trigger('click')
      await flushPromises()
      expect(w.find('.fp-empty.error').text()).toContain('屏上不显示上一次读到的参数')
      expect(w.findAll('.pm-head .fp-state').map(e => e.text())).toEqual(['状态没读到'])
      expect(w.find('button.fac').text()).toContain('无待处理')
    } finally { w.unmount() }
  })

  it('页面状态:电价缺项、池核算未生成 → 标题旁两个黄签', async () => {
    const { paramsApi } = await import('@/api/params')
    vi.mocked(paramsApi.status).mockResolvedValueOnce({ ...STATUS, priceOk: 5, poolSnapshotAt: null })
    const w = await mountPage()
    try {
      expect(w.findAll('.pm-head .fp-state').map(e => [e.text(), e.classes('warn')]))
        .toEqual([['本月电价 5/6 · 缺 1 项', true], ['本月池核算未生成', true]])
    } finally { w.unmount() }
  })

  it('删户级例外走确认弹窗(删除类:主按钮红);取消就什么都不发', async () => {
    const w = await mountPage()
    try {
      await enterEdit(w)
      await goSec(w, '户级例外')
      put.mockClear()
      await trOf(w, 'tenant:5|mgmt_fee').find('button.pm-ib.danger').trigger('click')
      await flushPromises()
      expect(askQueue.map(a => [a.title, a.danger])).toEqual([['删除「力灏（户） · 电力管理费」例外（长期）？', true]])
      answer(false)
      await flushPromises()
      expect(put).not.toHaveBeenCalled()
    } finally { w.unmount() }
  })

  it('户级例外一条都没有 → 卡里是空状态件,不出空表', async () => {
    const { paramsApi } = await import('@/api/params')
    vi.mocked(paramsApi.list).mockResolvedValueOnce(ROWS.filter(r => !r.scope.startsWith('tenant:')).map(r => ({ ...r })))
    const w = await mountPage()
    try {
      await goSec(w, '户级例外')
      expect(w.find('.pm-card .fp-empty').text()).toContain('暂无户级例外')
      expect(w.find('.pm-card table').exists()).toBe(false)
    } finally { w.unmount() }
  })

  // 破坏验证:useEditMode 的 dirty 选项删掉 → 第一条红
  it('改动数:没开卡是 0,开着改值卡算 1 处(关页签按它问)', async () => {
    const w = await mountPage()
    try {
      await enterEdit(w)
      const auth = useAuthStore()
      expect(auth.dirtyTotal).toBe(0)
      ;(w.vm as unknown as { editRow: object | null }).editRow = ROWS[0]
      await nextTick()
      expect(auth.dirtyTotal).toBe(1)
      expect(auth.dirtyApproxOn(''), '卡开着只知道在改、不知道改了几处').toBe(true)
    } finally { w.unmount() }
  })
})
