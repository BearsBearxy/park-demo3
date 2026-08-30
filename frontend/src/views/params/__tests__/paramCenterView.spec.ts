// 计费参数页(S21-PARAM-CENTER-SPEC §5 / §8.4):挂载渲染四区 + 状态条 / 全文禁词 / 编辑态才出 [修改] / 保存只 patch 该行 + 计数。
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ParamRowDTO, ParamStatusDTO } from '@/api/params'
import { forbiddenText } from '@/utils/paramCenterLogic'
import { useAuthStore } from '@/stores/auth'

// RBAC:本屏三扇门(① param-monthly / ②③④ param-policy / 重算 billing-run),空权限进来是浏览态没有写入口
beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['param-monthly:edit', 'param-policy:edit', 'billing-run:edit']
})

const push = vi.fn()
const query: Record<string, string> = { ym: '2024-02', zone: 'p1' }   // 深链;单测里可临时加 edit=1
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ query }),
}))

let id = 0
const row = (p: Partial<ParamRowDTO> & Pick<ParamRowDTO, 'key' | 'label' | 'group' | 'scope' | 'scopeLabel'>): ParamRowDTO => ({
  unit: '', value: 1, valueText: '1', mode: 'from', acctMonth: '', rangeText: '长期',
  sourceChain: [`${p.scopeLabel}:1`], formula: null, hint: null, editable: true, monthlyCheck: false,
  hasMonthRow: false, rowId: ++id, note: null, ...p,
})
const ROWS: ParamRowDTO[] = [
  row({ key: 'elec_peak', label: '峰段电价', unit: '元/度', group: 'monthly', scope: '', scopeLabel: '全园', value: 0.9, valueText: '0.9 元/度',
    mode: 'month', acctMonth: '2024-02', rangeText: '仅 2024-02', sourceChain: ['全园:0.9 元/度'], monthlyCheck: true }),
  // 月核对项本月无专属值(from 版本 2023-10 起):值照常显 + 「沿用 2023-10 起设置」灰徽标 + 未核对
  row({ key: 'elevator_area_base', label: 'A座电梯分摊面积基数', unit: '㎡', group: 'monthly', scope: 'p1', scopeLabel: '一期', value: 12027.34,
    valueText: '12,027.34 ㎡', mode: 'from', acctMonth: '2023-10', rangeText: '2023-10 起长期', sourceChain: ['一期:12,027.34 ㎡'], monthlyCheck: true }),
  row({ key: 'loss_adj_qty', label: '损耗调整度数', unit: '度', group: 'monthly', scope: 'building:13', scopeLabel: '一期 A座', value: -1500,
    valueText: '-1,500 度', mode: 'month', acctMonth: '2024-02', rangeText: '仅 2024-02', sourceChain: ['一期 A座:-1,500 度'], monthlyCheck: true, hasMonthRow: true }),
  row({ key: 'loss_adj_qty', label: '损耗调整度数', unit: '度', group: 'monthly', scope: 'building:20', scopeLabel: '一期 B座', value: null,
    valueText: '', mode: null, acctMonth: '', rangeText: '', sourceChain: [], monthlyCheck: true, rowId: null }),
  row({ key: 'mgmt_fee', label: '电力管理费', unit: '元/度', group: 'constant', scope: '', scopeLabel: '全园', value: 0.16, valueText: '0.16 元/度' }),
  row({ key: 'coefficient', label: '分摊基数（层数或面积）', group: 'constant', scope: 'rule:23', scopeLabel: '招商中心净电（池）', value: 6, valueText: '6' }),
  // 走面积基数的池:只读行,值=那条面积基数参数的值,链尾「取自「园区分摊面积基数」」→ 来自列可点跳到 ② 区那一行
  row({ key: 'area_base', label: '园区分摊面积基数', unit: '㎡', group: 'constant', scope: 'p1', scopeLabel: '一期', value: 80000,
    valueText: '80,000 ㎡', sourceChain: ['一期:80,000 ㎡'] }),
  row({ key: 'coefficient', label: '分摊基数（层数或面积）', group: 'constant', scope: 'rule:31', scopeLabel: '一期园区·路灯（池）', value: 80000,
    valueText: '80,000 ㎡', sourceChain: ['一期:80,000 ㎡', '取自「园区分摊面积基数」'], editable: false, rowId: null }),
  row({ key: 'loss_variant', label: '损耗核算方式', group: 'rule', scope: 'building:20', scopeLabel: '一期 B座', value: 1,
    valueText: '仅按公摊分摊度数（率 = 公摊分摊度数 ÷ 分母 + 加点）', mode: 'from', acctMonth: '2023-11', rangeText: '2023-11 起长期',
    sourceChain: ['一期 B座:仅按公摊分摊度数（率 = 公摊分摊度数 ÷ 分母 + 加点）'] }),
  row({ key: 'loss_recon', label: '供电局对账', group: 'rule', scope: 'building:20', scopeLabel: '一期 B座', value: null,
    valueText: '参与', mode: null, acctMonth: '', rangeText: '', sourceChain: [], rowId: null }),
  row({ key: 'loss_exclude', label: '不计入楼栋合计的电表', group: 'rule', scope: 'meter:307', scopeLabel: '力美C201电（表）', value: 1, valueText: '不计入' }),
  row({ key: 'loss_supply_meter', label: '供电局对账总表', group: 'rule', scope: 'p1', scopeLabel: '一期', value: 5, valueText: 'B-G座总电' }),
  // 回归钉:P7 fix-round 1 —— ref_meter 候选过滤曾按 p1/p2/dorm 枚举漏了 p3,编辑三期这一行会退到全园所有表
  row({ key: 'loss_supply_meter', label: '供电局对账总表', group: 'rule', scope: 'p3', scopeLabel: '三期', value: 400, valueText: '三期总电' }),
  // 回归钉靶子:三期 G栋(id 30)zone 未标注,ref_building 候选不该按 phase 猜成「p1 桶」
  row({ key: 'loss_head', label: '损耗核算归组', group: 'rule', scope: 'building:30', scopeLabel: '三期 G栋', value: null,
    valueText: '未设置', mode: null, acctMonth: '', rangeText: '', sourceChain: [], rowId: null }),
  row({ key: 'mgmt_fee', label: '电力管理费', unit: '元/度', group: 'constant', scope: 'tenant:5', scopeLabel: '力灏（户）', value: 0.15,
    valueText: '0.15 元/度', sourceChain: ['力灏（户）:0.15 元/度', '全园:0.16 元/度'] }),
  // 户级版本起点晚于 ym:后端出的是继承全园的行(rowId 空)—— 不是例外,④ 不列
  row({ key: 'capacity_fee', label: '装机容量费', unit: '元/kVA·月', group: 'constant', scope: 'tenant:5', scopeLabel: '力灏（户）', value: 22.6,
    valueText: '22.6 元/kVA·月', sourceChain: ['全园:22.6 元/kVA·月'], rowId: null }),
  // 全园级电价本月无值:月核对项不折叠,值格「— 缺」
  row({ key: 'elec_valley', label: '谷段电价', unit: '元/度', group: 'monthly', scope: '', scopeLabel: '全园', value: null,
    valueText: '', mode: null, acctMonth: '', rangeText: '', sourceChain: [], monthlyCheck: true, rowId: null }),
]
const STATUS: ParamStatusDTO = {
  priceOk: 6, priceTotal: 6, pendingChanges: 0, lastChangeAt: null,
  poolSnapshotAt: '2026-08-16T16:37:51', billBatchAt: '2026-08-12T13:41:34', stale: false, otherMonthsAffected: [],
}
const put = vi.fn()
// 计费参数页自 P3 起要先占到编辑锁才进得了编辑态（CONCURRENCY-SPEC §3.2：
// 它与公共电核算 / 催缴单 / 系数簿共占 billing-chain 那把月锁）。
// 不 mock 的话 locksApi 走真 axios，jsdom 里抛错 → 被「拿不准就不进」兜住 → 编辑态永远进不去。
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
  metersApi: { list: () => Promise.resolve([
    { id: 307, name: '力美C201电', buildingId: 20, zone: 'p1', kind: 'elec', tenantId: null, subName: null },
    { id: 400, name: '三期总电', buildingId: null, zone: 'p3', kind: 'elec', tenantId: null, subName: null },
  ]) },
}))
vi.mock('@/api/building', () => ({
  buildingApi: { list: () => Promise.resolve([
    { id: 13, name: '一期 A座', phase: 1, zone: 'p1' },
    { id: 20, name: '一期 B座', phase: 1, zone: 'p1' },
    // 三期楼栋在手工标注前 zone=null(V113 迁移故意留空)——回归钉要靠它撑住
    { id: 30, name: '三期 G栋', phase: 3, zone: null },
  ]) },
}))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: () => Promise.resolve([{ id: 5, companyName: '力灏', phase: 1, parentName: null }]) } }))
vi.mock('@/api/zones', () => ({ zonesApi: { list: () => Promise.resolve([
  { code: 'p1', name: '一期', sortNo: 0 },
  { code: 'p2', name: '二期', sortNo: 1 },
  { code: 'p3', name: '三期', sortNo: 2 },
  { code: 'dorm', name: '宿舍', sortNo: 3 },
]) } }))

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
    // 人话行:A座 损耗调整度数 −1,500 仅 2024-02;B座 仅按公摊分摊度数 2023-11 起长期;户级例外覆盖全园
    expect(t).toContain('-1,500 度')
    expect(t).toContain('仅 2024-02')
    expect(t).toContain('损耗核算方式：仅按公摊分摊度数')
    expect(t).toContain('2023-11 起长期')
    expect(t).toContain('全园 0.16 元/度')
    // 不计入楼栋合计的电表归到 B座 组下(表 → 栋 由表主数据解析)
    expect(t).toContain('不计入楼栋合计的电表：')
    expect(t).toContain('力美C201电')
    // 一期 G 只读披露(人话:不出现 Σ / ROUND)
    expect(t).toContain('一期公摊分摊度数 = 招商中心净电、车库东照明 本月净量合计 ÷ 均摊栋数（四舍五入到 2 位）')
    expect(t).not.toMatch(/Σ|ROUND/)
    // 「来自」列:全园设置 / 本栋设置;走面积基数的池显「取自「园区分摊面积基数」」
    expect(t).toContain('全园设置')
    expect(t).toContain('本栋设置')
    expect(t).toContain('取自「园区分摊面积基数」')
    // ① 月核对项本月无专属值:值照常显 + 沿用徽标 + 未核对(不再把「沿用长期值 …」写进值格)
    const ele = w.findAll('.pm-table tbody tr').find(tr => tr.text().includes('A座电梯分摊面积基数'))!
    expect(ele.text()).toContain('12,027.34 ㎡')
    expect(ele.text()).toContain('沿用 2023-10 起设置')
    expect(ele.text()).toContain('未核对')
    expect(ele.text()).not.toContain('沿用 2023-10 起长期值')
    w.unmount()
  })

  it('走面积基数的池:「来自」列是可点链接,点它高亮 ② 区那条面积基数行', async () => {
    const w = await mountPage()
    const link = w.findAll('button.pm-link').find(b => b.text() === '取自「园区分摊面积基数」')!
    expect(link).toBeTruthy()
    await link.trigger('click')
    const hl = w.findAll('.pm-table tbody tr.hl')
    expect(hl.length).toBe(1)
    expect(hl[0].text()).toContain('园区分摊面积基数')
    expect(hl[0].text()).toContain('80,000 ㎡')
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
    const valley = trs().find(tr => tr.text().includes('谷段电价'))!
    expect(valley, '全园级电价无值不折叠').toBeTruthy()
    expect(valley.text()).toContain('缺')
    expect(w.text()).toContain('供电局对账：参与')   // ③ 默认语义始终列
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

  it('浏览态零写入口:编辑模式后才出 [修改] / [新增例外] / [复制上月电价] / [重算本月];按钮文字不再是「改…」', async () => {
    const w = await mountPage()
    const texts = () => w.findAll('button').map(b => b.text())
    expect(texts().some(s => s === '修改')).toBe(false)
    expect(texts().some(s => s.includes('新增例外'))).toBe(false)
    expect(texts().some(s => s.includes('重算本月'))).toBe(false)
    await w.findAll('button').find(b => b.text().includes('编辑模式'))!.trigger('click')
    expect(texts().filter(s => s === '修改').length).toBeGreaterThan(3)
    expect(texts().some(s => s.includes('改…') || s.includes('剔出'))).toBe(false)
    expect(texts().some(s => s.includes('新增例外'))).toBe(true)
    expect(texts().some(s => s.includes('复制上月电价'))).toBe(true)
    expect(texts().some(s => s.includes('重算本月'))).toBe(true)
    w.unmount()
  })

  it('深链 edit=1(三屏 [去重算])直接进编辑态:重算本月可点', async () => {
    query.edit = '1'
    acquired.length = 0
    try {
      const w = await mountPage()
      expect(w.findAll('button').some(b => b.text().includes('重算本月'))).toBe(true)
      expect(w.findAll('button').some(b => b.text() === '完成')).toBe(true)
      // ❗锁的必须是**真的那个月**。改前是先 toggleEdit() 再 adoptYm():
      //   占的是 `param-center:0-00`(期还没认领,year/month 都是 `?? 0`),
      //   紧接着期被改成真的那个月 —— 锁与所编的期从此错位,而表现是「锁没生效」,不报错。
      //   （给 useEditMode.enter() 补上"占锁回来复核一次期"之后这条当场暴露:
      //     复核发现期变了 → 还锁不进 → 深链彻底进不去编辑态。）
      // 出账链四屏共一把月锁 → scope 是 `billing-chain:YYYY-MM`(S.paramCenter = billingChain)
      expect(acquired, '深链占的锁不是真期的那把').not.toContain('billing-chain:0-00')
      expect(acquired.some(x => /^billing-chain:\d{4}-\d{2}$/.test(x)), '没占到真期的锁').toBe(true)
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
    // 点 A座 损耗调整度数那行的 [修改]
    const tr = w.findAll('.pm-table tbody tr').find(x => x.text().includes('一期 A座') && x.text().includes('损耗调整度数'))!
    await tr.findAll('button').find(b => b.text() === '修改')!.trigger('click')
    const pop = w.findComponent(ParamEditPopover)
    expect(pop.props('row')?.scope).toBe('building:13')
    const returned = row({ key: 'loss_adj_qty', label: '损耗调整度数', unit: '度', group: 'monthly', scope: 'building:13', scopeLabel: '一期 A座',
      value: -1400, valueText: '-1,400 度', mode: 'month', acctMonth: '2024-02', rangeText: '仅 2024-02', sourceChain: ['一期 A座:-1,400 度'], hasMonthRow: true })
    put.mockResolvedValueOnce(returned)
    pop.vm.$emit('save', { key: 'loss_adj_qty', scope: 'building:13', acctMonth: '2024-02', mode: 'month', value: -1400, note: null, correction: false })
    await flushPromises()
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ key: 'loss_adj_qty', scope: 'building:13', value: -1400 }), '2024-02')
    expect(w.text()).toContain('-1,400 度')
    expect(w.text()).not.toContain('-1,500 度')
    // 「参数已改 N 项」不再挂在状态条上(§6 收进告警 chip):写一行 → chip 由「无待处理」翻成「待处理 1」
    expect(w.find('button.fac').text()).toContain('待处理 1')
    // 只 patch 一行:list 不重拉
    expect(listCalls()).toBe(before + 1)
    w.unmount()
  })

  // 回归钉(P7 fix-round 1):ref_meter 候选过滤曾按 scope === 'p1'/'p2'/'dorm' 枚举,漏了 p3 ——
  // 编辑三期的「供电局对账总表」会退到 else 分支(meters.value,全园所有表都能选),
  // 而不是只给三期的表。改用形状校验(isZoneCode)后应该只剩三期总电一个候选。
  it('③ 核算口径 ref_meter 候选按期区过滤到 p3:不再退化成全园所有表', async () => {
    const w = await mountPage()
    await w.findAll('button').find(b => b.text().includes('编辑模式'))!.trigger('click')
    const tr = w.findAll('.pm-rgroup').find(g => g.text().includes('三期'))!
      .findAll('.pm-rrow').find(x => x.text().includes('供电局对账总表'))!
    await tr.findAll('button').find(b => b.text() === '修改')!.trigger('click')
    const pop = w.findComponent(ParamEditPopover)
    expect(pop.props('row')?.scope).toBe('p3')
    expect(pop.props('refOptions')).toEqual([{ value: '400', label: '三期总电' }])
    w.unmount()
  })

  // 回归钉:zoneOfBuilding 曾按 b.phase === 2 ? 'p2' : 'p1' 猜期区,phase 3(以及宿舍 phase 1)
  // 一律落进 'p1' 桶,与真正的一期楼栋混在一起当「同期区」候选。改读 b.zone 真实字段后,
  // 三期 G栋(zone 未标注 = null)只该跟别的「未标注」楼栋同桶,不能把一期 A/B座也算进来。
  it('③ 核算口径 ref_building 候选按真实 zone 分桶:三期未标注楼栋不再混入一期候选', async () => {
    const w = await mountPage()
    await w.findAll('button').find(b => b.text().includes('编辑模式'))!.trigger('click')
    const tr = w.findAll('.pm-rgroup').find(g => g.text().includes('三期 G栋'))!
      .findAll('.pm-rrow').find(x => x.text().includes('损耗核算归组'))!
    await tr.findAll('button').find(b => b.text() === '修改')!.trigger('click')
    const pop = w.findComponent(ParamEditPopover)
    expect(pop.props('row')?.scope).toBe('building:30')
    expect(pop.props('refOptions')).toEqual([{ value: '30', label: '三期 G栋' }])
    w.unmount()
  })
})

// ── 屏级告警:常驻 chip + 右侧抽屉(LAYOUT-STABILITY-SPEC §6)——
//    过期/跨月受影响不再是状态条上的橙字,且跨月那条必须给得出一键清除的路径(§6-3) ──
describe('ParamCenterView 告警 chip + 抽屉', () => {
  const STALE = {
    ...STATUS, stale: true, pendingChanges: 2, lastChangeAt: '2026-08-18T09:20:00',
    otherMonthsAffected: ['2023-08', '2023-10'],
  }
  const drawer = () => document.querySelector('.fp-sdw')
  const openChip = async (w: Awaited<ReturnType<typeof mountPage>>) => {
    await w.find('button.fac').trigger('click')
    await flushPromises()
  }

  it('状态条只留中性事实;过期 + 其他月份受影响进 chip(3)与抽屉分组', async () => {
    const { paramsApi } = await import('@/api/params')
    ;(paramsApi.status as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...STALE })
    const w = await mountPage()
    // 状态条:电价事实 + 无橙字(旧文案「参数已改 N 项…请切到该月重算」全部移走)
    const bar = w.find('.pm-bar.status').text()
    expect(bar).toContain('本月电价 6/6')
    expect(bar).not.toContain('旧快照')
    expect(bar).not.toContain('请切到该月重算')
    expect(w.find('.pm-bar.warn').exists()).toBe(false)
    // chip 常驻,计数 = 本月过期 1 + 其他月份 2
    expect(w.find('button.fac').text()).toContain('待处理 3')
    expect(drawer()).toBeNull()
    await openChip(w)
    const t = drawer()!.textContent ?? ''
    expect(t).toContain('本月快照过期')
    expect(t).toContain('自上次重算起改了 2 项参数')
    expect(t).toContain('其他月份受影响')
    expect(t).toContain('2023-08')
    expect(t).toContain('2023-10')
    w.unmount()
  })

  it('无告警时 chip 仍渲染(quiet 态),抽屉是空态', async () => {
    const w = await mountPage()
    const chip = w.find('button.fac')
    expect(chip.text()).toContain('无待处理')
    expect(chip.classes()).toContain('quiet')
    await openChip(w)
    expect(drawer()!.textContent).toContain('本月没有待处理事项')
    w.unmount()
  })

  it('一键重算这 2 个月:逐月调 recalc → 刷新 status → chip 归零(§6-3 可清除性)', async () => {
    const { paramsApi } = await import('@/api/params')
    const recalc = paramsApi.recalc as ReturnType<typeof vi.fn>
    recalc.mockResolvedValue({ pools: 1, lossUnits: 1, notices: 1, skippedConfirmed: 0, warnings: [] })
    ;(paramsApi.status as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...STALE })
    const w = await mountPage()
    await w.findAll('button').find(b => b.text().includes('编辑模式'))!.trigger('click')
    await openChip(w)
    const btn = [...drawer()!.querySelectorAll('button')].find(b => b.textContent?.includes('一键重算这 2 个月'))!
    expect(btn, '跨月告警必须给一键批量,不许只写「请切到该月重算」').toBeTruthy()
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    btn.click()
    await flushPromises()
    expect(recalc.mock.calls.map(c => c[0])).toEqual(['2023-08', '2023-10'])
    // 重算后重拉的 status 不再 stale → chip 归零,抽屉留开显空态
    expect(w.find('button.fac').text()).toContain('无待处理')
    expect(drawer()!.textContent).toContain('本月没有待处理事项')
    recalc.mockReset()
    w.unmount()
  })
})

describe('ParamEditPopover 修改弹窗', () => {
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
  it('布尔键状态句与后端 valueText 同口径:供电局对账 参与 / 不参与(不再是「参与对账」);不计入楼栋合计 计入 / 不计入', async () => {
    const txt = () => document.querySelector('.fp-dwr')?.textContent ?? ''
    const w1 = mount(ParamEditPopover, { props: { open: true, row: ROWS.find(r => r.key === 'loss_recon')!, ym: '2024-02' }, attachTo: document.body })
    await flushPromises()
    expect(txt()).toContain('不参与')
    expect(txt()).not.toContain('参与对账')
    w1.unmount()
    const w2 = mount(ParamEditPopover, { props: { open: true, row: ROWS.find(r => r.key === 'loss_exclude')!, ym: '2024-02' }, attachTo: document.body })
    await flushPromises()
    expect(txt()).toContain('不计入')
    expect(txt()).not.toContain('剔出')
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

/**
 * 编辑态守卫(2026-08-30,同 MeterView/BillNoticesView 那一批):
 * editMode 会**就地**转假(被接管 / 30 分钟提权到期),而写 UI 的 v-if 只判自己的 ref。
 */
describe('ParamCenterView 编辑态守卫', () => {
  it('❗编辑态就地转假 → 修改浮层 / 新增例外抽屉 / 行内新增剔除全部收起', async () => {
    const w = await mountPage()
    const vm = w.vm as unknown as {
      editMode: boolean
      editRow: object | null; exOpen: boolean; addExcl: object | null
    }
    vm.editMode = true
    await nextTick()
    vm.editRow = { key: 'price_p1', label: '一期电价' } as never
    vm.exOpen = true
    vm.addExcl = { bid: 5, meterId: '' } as never
    await nextTick()

    vm.editMode = false          // ← 接管 / 提权到期走的正是这一句
    await nextTick()
    expect(vm.editRow, '修改浮层没关').toBeNull()
    expect(vm.exOpen, '新增例外抽屉没关').toBe(false)
    expect(vm.addExcl, '行内新增剔除没关').toBeNull()
    w.unmount()
  })

  it('❗浏览态下 put 漏斗必须打不出去 —— 六个写调用方守这一处', async () => {
    // put/putAll 是全屏参数写的唯一漏斗(onSave/submitExcl/submitEx/delTenantRow 全走它)。
    // 前置做足:直呼 put 传一份完整合法的请求 —— 否则函数在早退分支 return,守卫删掉照样绿。
    const w = await mountPage()
    put.mockClear()
    const vm = w.vm as unknown as { put: (req: object) => Promise<boolean> }
    const ok = await vm.put({ key: 'price_p1', scope: 'zone:p1', acctMonth: '2024-02', mode: 'month', value: 1.1 })
    expect(ok, '浏览态下要返回 false').toBe(false)
    expect(put, '浏览态下 PUT 被打出去了').not.toHaveBeenCalled()
    w.unmount()
  })

  it('❗浏览态下 重算/批量重算/复制上月电价 一个 API 都不许打出去', async () => {
    const { paramsApi } = await import('@/api/params')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const w = await mountPage()
    vi.mocked(paramsApi.recalc).mockClear()
    vi.mocked(paramsApi.copyPrev).mockClear()
    const vm = w.vm as unknown as {
      status: { otherMonthsAffected: string[] } | null
      onRecalc: () => Promise<void>; onRecalcOthers: () => Promise<void>; onCopy: () => Promise<void>
    }
    // ⚠ 前置做足:otherMonths 为空时 onRecalcOthers 在自己的早退分支就 return,
    //   守卫删掉照样绿(破坏验证抓到的,本仓第三次栽同一个坑)。
    if (vm.status) vm.status.otherMonthsAffected = ['2024-01', '2023-12']
    await vm.onRecalc()
    await vm.onRecalcOthers()
    await vm.onCopy()
    expect(paramsApi.recalc, '浏览态下重算被打出去了').not.toHaveBeenCalled()
    expect(paramsApi.copyPrev, '浏览态下复制电价被打出去了').not.toHaveBeenCalled()
    w.unmount()
  })

  it('编辑态里同样的调用照常出去 —— 上面两条不是被别的早退放绿的', async () => {
    const w = await mountPage()
    const vm = w.vm as unknown as { editMode: boolean; put: (req: object) => Promise<boolean> }
    vm.editMode = true
    await nextTick()
    put.mockClear()
    // 回包必须是完整 ParamRowDTO(带 group)—— 写后这行会被 patch 进 rows,缺 group 会让
    // grouped computed 在断言后异步炸成 unhandled rejection(真后端不缺;是 as never 绕过了类型)
    put.mockResolvedValueOnce(row({ key: 'price_p1', group: 'monthly', scopeLabel: '全园', label: '一期电价',
      scope: 'zone:p1', valueText: '1.1', rangeText: '2024-02' }) as never)
    await vm.put({ key: 'price_p1', scope: 'zone:p1', acctMonth: '2024-02', mode: 'month', value: 1.1 })
    expect(put).toHaveBeenCalledTimes(1)
    w.unmount()
  })
})
