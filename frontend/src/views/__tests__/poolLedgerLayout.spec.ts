// 公共电核算 · 页面三态、列模型、分组行、逐行写法、字距与行(计划 S3 · P4-B1 / B2 / B3 / B5,画布 03-A / 03-B / 03-C;
// 问题面板跳行 T16,画布 06-C)。夹具照 03-A 一期那几行的真实形状写(AllocPoolRowDTO / AllocPoolLineDTO 全字段)。
// 断言钉渲染出来的字、类、样式,不钉配置对象;每条的破坏验证写在它头上。
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import type { AllocMemberDiffDTO, AllocPoolLineDTO, AllocPoolMeterDTO, AllocPoolRowDTO, AllocPoolsDTO } from '@/api/alloc'
import type { ParamRowDTO } from '@/api/params'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => ({ query: {} }) }))
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))
vi.mock('@/api/alloc', () => ({
  allocApi: {
    pools: vi.fn(),
    memberDiff: vi.fn(() => Promise.resolve([])),
    meterDiff: vi.fn(() => Promise.resolve([])),
    rules: vi.fn(() => Promise.resolve([])),
    generate: vi.fn(() => Promise.resolve({ warnings: [] })),
    deleteRule: vi.fn(() => Promise.resolve()),
    poolCandidates: vi.fn(() => Promise.resolve({ meters: [], tenants: [], tenantNote: null })),
    poolMonths: vi.fn(() => Promise.resolve([])),
    lossMonths: vi.fn(() => Promise.resolve([])),
  },
}))
vi.mock('@/api/params', () => ({
  paramsApi: {
    list: vi.fn(() => Promise.resolve([])),
    status: vi.fn(() => Promise.resolve({
      priceOk: 6, priceTotal: 6, pendingChanges: 0, lastChangeAt: null,
      poolSnapshotAt: null, billBatchAt: null, stale: false, otherMonthsAffected: [],
    })),
  },
}))
vi.mock('@/api/meters', () => ({
  metersApi: { list: vi.fn(() => Promise.resolve([])), months: vi.fn(() => Promise.resolve([])) },
}))
vi.mock('@/api/building', () => ({ buildingApi: { list: vi.fn(() => Promise.resolve([])) } }))
vi.mock('@/api/tenant', () => ({ tenantApi: { list: vi.fn(() => Promise.resolve([])) } }))
vi.mock('@/api/billNotices', () => ({ billNoticesApi: { months: vi.fn(() => Promise.resolve([])) } }))
vi.mock('@/api/review', () => ({
  reviewApi: {
    closedMonths: vi.fn().mockResolvedValue([]), states: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]), submit: vi.fn(), approve: vi.fn(), returnBack: vi.fn(), withdraw: vi.fn(),
  },
}))
vi.mock('@/utils/sheet', () => ({ writeAoaWorkbook: vi.fn(() => Promise.resolve()) }))

import { defineComponent, h, KeepAlive, ref } from 'vue'
import PoolLedgerView from '../alloc/PoolLedgerView.vue'
import { writeAoaWorkbook } from '@/utils/sheet'
import { receipts } from '@/utils/receipt'
import type { ParamStatusDTO } from '@/api/params'
import { allocApi } from '@/api/alloc'
import { paramsApi } from '@/api/params'
import { askQueue, answer } from '@/utils/ask'
import { bandFooter, fmtFixed2 } from '@/utils/poolLedgerLogic'
import { stubWideTable } from '@/composables/__tests__/wideTableStub'

// ── 夹具:03-A 一期「A座及园区公共表」「A座电梯及楼层公共电」两组 ──
const meter = (p: Partial<AllocPoolMeterDTO>): AllocPoolMeterDTO => ({
  meterId: 1, name: 'A-B1-1', sign: 1, label: 'A座·负一层·地下车库东侧照明·电表①', spot: '负一层', subName: '电表①',
  meterType: null, status: 'active', statusFrom: '2023-08', ...p,
})
const line = (p: Partial<AllocPoolLineDTO>): AllocPoolLineDTO => ({
  meterId: 1, label: 'A座·负一层·地下车库东侧照明·电表①', area: 'A座', spot: '负一层', floorLabel: '负一层',
  useName: '地下车库东侧照明', subName: '电表①', meterType: null, code: null, sign: 1, factorSnap: 1,
  prevTotal: 452.02, currTotal: 497.3, qtyTotal: 45.28, qtySharp: null, qtyPeak: null, qtyFlat: null, qtyValley: null,
  costAmount: 51.9, ...p,
})
const pool = (p: Partial<AllocPoolRowDTO>): AllocPoolRowDTO => ({
  ruleId: 1, zone: 'p1', name: '一期 A座·负一层·地下车库东侧照明', bookBlock: 'A座及园区公共表', bookKey: null, groupLabel: '一期 A座',
  method: 'direct', stdKind: null, roundScale: 2, baseKey: null, sortNo: 1, note: null,
  buildingId: 13, buildingName: '一期 A座', floorLabel: '负一层', side: null, feeName: '地下车库东侧照明', feeKey: 'share_elec_light',
  autoName: '一期 A座·负一层·地下车库东侧照明', autoMembers: false, members: [], links: [],
  meters: [meter({})], lines: [line({})],
  qtyTotal: 45.28, qtySharp: null, qtyPeak: null, qtyFlat: null, qtyValley: null, extraQty: null,
  costAmount: 51.9, baseSnap: null, stdValue: null, foldAdd: null, priceSnap: null,
  allocatedAmount: null, gapAmount: null, warn: null, ...p,
})
const CAR = pool({ note: '东侧照明单独计' })
// 招商中心净额池:不出逐表行,构成进电表格悬停;一期只有它有分时读数(03-A 注「尖峰平谷默认收起」)
const ZS = pool({
  ruleId: 2, name: '一期 招商中心·四楼·招商中心电1', buildingName: '一期 招商中心', floorLabel: '四楼', feeName: '招商中心电1',
  autoName: '一期 招商中心·四楼·招商中心电1', sortNo: 2, lines: [],
  meters: [meter({ meterId: 21, label: '招商中心·总表' })],
  netParts: [
    { meterId: 21, label: '招商中心·总表', sign: 1, qty: 1142.4 },
    ...[22, 23, 24, 25, 26].map(id => ({ meterId: id, label: `招商中心·子表${id}`, sign: -1, qty: -49.87 })),
  ],
  qtyTotal: 893.01, qtySharp: null, qtyPeak: 300.5, qtyFlat: 400.2, qtyValley: 192.31, costAmount: 1023.63,
})
const LAMP = pool({
  ruleId: 3, name: '一期 A座·一楼·园区路灯', floorLabel: '一楼', feeName: '园区路灯', autoName: '一期 A座·一楼·园区路灯', sortNo: 3,
  method: 'area', stdValue: 0.07,
  meters: [meter({ meterId: 31 })],
  lines: [line({ meterId: 31, label: 'A座·一楼·园区路灯·电表①', floorLabel: '一楼', useName: '园区路灯', factorSnap: 30,
    prevTotal: 1398.87, currTotal: 1569.43, qtyTotal: 5116.8, costAmount: 5865.23 })],
  qtyTotal: 5116.8, costAmount: 5865.23,
})
// 联塑精铟:一块表都没绑。给它一个分摊方式和分摊基数 —— 整行照样写「–」才说明是「无绑定表」的规矩在管,不是数据本来就空
const LS = pool({
  ruleId: 4, bookBlock: 'A座电梯及楼层公共电', name: '一期 A座·一楼·联塑精铟', floorLabel: '一楼', feeName: '联塑精铟',
  autoName: '一期 A座·一楼·联塑精铟', sortNo: 4, method: 'area', stdValue: 0.05, meters: [], lines: [], qtyTotal: null, costAmount: null,
})
const NEW = pool({
  ruleId: 5, bookBlock: 'A座电梯及楼层公共电', name: '一期 A座·一楼东侧·公共用电', floorLabel: '一楼东侧', feeName: '公共用电',
  autoName: '一期 A座·一楼东侧·公共用电', sortNo: 5, meters: [meter({ meterId: 51 })],
  lines: [line({ meterId: 51, label: 'A座·一楼东侧·公共用电 / 旭化成·电表①新表', floorLabel: '一楼东侧', useName: '公共用电 / 旭化成',
    subName: '电表①新表', prevTotal: 56.01, currTotal: 56.01, qtyTotal: 0, costAmount: 0 })],
  qtyTotal: 0, costAmount: 0,
})
const WEST = pool({
  ruleId: 6, bookBlock: 'A座电梯及楼层公共电', name: '一期 A座·二楼西侧·公共用电', floorLabel: '二楼西侧', feeName: '公共用电',
  autoName: '一期 A座·二楼西侧·公共用电', sortNo: 6, method: 'area', stdValue: 0.03, meters: [meter({ meterId: 61 })],
  lines: [line({ meterId: 61, label: 'A座·二楼西侧·公共用电 / 西侧租户·电表①', floorLabel: '二楼西侧', useName: '公共用电 / 西侧租户',
    prevTotal: 2643.58, currTotal: 2690.69, qtyTotal: 47.11, costAmount: 54 })],
  qtyTotal: 47.11, costAmount: 54,
})
const ROWS = [CAR, ZS, LAMP, LS, NEW, WEST]
const coef = (ruleId: number, value: number, valueText: string): ParamRowDTO => ({
  key: 'coefficient', label: '分摊基数', unit: '', group: 'constant', scope: `rule:${ruleId}`, scopeLabel: `#${ruleId}（池）`,
  value, valueText, mode: 'from', acctMonth: '2023-08', rangeText: '2023-08 起长期', sourceChain: [`#${ruleId}（池）:${valueText}`],
  formula: null, hint: null, editable: true, monthlyCheck: false, hasMonthRow: false, rowId: 700 + ruleId, note: null,
})

type TipEl = HTMLElement & { _tip?: { text: string; sub?: string } }
const tipOf = (el: Element) => (el as TipEl)._tip

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['billing-run:edit', 'param-policy:edit']
  localStorage.clear()
  push.mockClear()
  vi.mocked(allocApi.generate).mockClear()
  vi.mocked(allocApi.memberDiff).mockResolvedValue([])
  vi.mocked(paramsApi.list).mockResolvedValue([coef(3, 80000, '80,000 ㎡'), coef(4, 1500, '1,500 ㎡')])
})
const mounted: VueWrapper[] = []
afterEach(() => { mounted.splice(0).forEach(w => w.unmount()); document.body.innerHTML = ''; askQueue.splice(0) })

async function open(rows: AllocPoolRowDTO[] = ROWS, generated = true) {
  vi.mocked(allocApi.pools).mockResolvedValue({ generated, rows })
  useBillingPeriodStore().pick(2025, 3)
  const w = mount(PoolLedgerView, { attachTo: document.body })
  mounted.push(w)
  await flushPromises()
  return w
}
async function enterEdit(w: VueWrapper) {
  await w.findAll('button').find(b => b.text().includes('编辑模式'))!.trigger('click')
  await flushPromises()
}
// 行末的最右空列 .fp-fill(aria-hidden)不是数据列,表头 / 格子都不算它
const ths = (w: VueWrapper) => w.findAll('thead th:not([aria-hidden])').map(t => t.text())
const rowOf = (w: VueWrapper, name: string) => w.findAll('tr.pl-row').find(tr => tr.find('.nm').text() === name)!
const cellsOf = (w: VueWrapper, name: string) => rowOf(w, name).findAll('td:not([aria-hidden])').map(td => td.text())
const COLS = ['位置', '用途', '电表', '倍率', '上月行至', '本月行至', '用量', '应分摊（元）', '分摊方式', '分摊标准', '分摊基数', '加减度数']

describe('P4-B1 页面三态(03-B)', () => {
  // 破坏验证:删掉 <FPStateTag v-if="!generated && !loadErr"> 那一行 → 第二条红
  it('本月未生成:没有灰色流内条,标题旁贴「本月未生成」', async () => {
    const w = await open(ROWS, false)
    expect(w.find('.pl-bar').exists()).toBe(false)
    expect(w.find('.pl-head').text()).toContain('本月未生成')
  })

  // 破坏验证:FPEmpty 改回 tbody 里一行 <td class="pl-noro"> → 第一条红;副句不分编辑态 → 浏览态那条红
  it('这个期区一个池都没有:空状态换掉表格(不是表里一行灰字);编辑态副句指向「新增池」', async () => {
    const w = await open([])
    expect(w.find('.pl-table').exists(), '空状态和表格互斥').toBe(false)
    expect(w.find('.pl-card .fp-empty .t').text()).toBe('一期暂无池配置')
    expect(w.find('.pl-card .fp-empty .sub').exists(), '浏览态点不到「新增池」,不提它').toBe(false)
    await enterEdit(w)
    expect(w.find('.pl-card .fp-empty .sub').text()).toBe('点右上「新增池」开始录入。')
  })

  // 破坏验证:<div v-else class="pl-tablearea"> 去掉 v-else → 表格和失败件同时在 → 第一条红
  it('加载失败:整块换掉表格区,一句 + 重试', async () => {
    vi.mocked(allocApi.pools).mockRejectedValue(new Error('网关超时'))
    useBillingPeriodStore().pick(2025, 3)
    const w = mount(PoolLedgerView, { attachTo: document.body })
    mounted.push(w)
    await flushPromises()
    expect(w.find('.pl-table').exists()).toBe(false)
    expect(w.text()).toContain('2025 年 3 月的池数据没读到')
    expect(w.findAll('button').some(b => b.text() === '重试')).toBe(true)
  })

  // 破坏验证:loadErr 挪回请求前先清 → 重试一点整页变转圈、失败件没了 → 第一条红
  it('重试:回来之前失败件留在原地(不先清成整页转圈),成功后才换回表格', async () => {
    vi.mocked(allocApi.pools).mockRejectedValueOnce(new Error('网关超时'))
    useBillingPeriodStore().pick(2025, 3)
    const w = mount(PoolLedgerView, { attachTo: document.body })
    mounted.push(w)
    await flushPromises()
    let done!: (v: AllocPoolsDTO) => void
    vi.mocked(allocApi.pools).mockReturnValueOnce(new Promise<AllocPoolsDTO>(r => { done = r }))
    await w.findAll('button').find(b => b.text() === '重试')!.trigger('click')
    await flushPromises()
    expect(w.find('.page-loading').exists(), '重试中不换成整页转圈').toBe(false)
    expect(w.text()).toContain('2025 年 3 月的池数据没读到')
    done({ generated: true, rows: ROWS })
    await flushPromises()
    expect(w.find('.pl-table').exists()).toBe(true)
  })

  // 破坏验证:FPEditModeButton 去掉 :disabled="!editMode && !!loadErr" → 红
  it('加载失败时进不了编辑模式(写入口全关)', async () => {
    vi.mocked(allocApi.pools).mockRejectedValue(new Error('网关超时'))
    useBillingPeriodStore().pick(2025, 3)
    const w = mount(PoolLedgerView, { attachTo: document.body })
    mounted.push(w)
    await flushPromises()
    const btn = w.findAll('.pl-actions button').find(b => b.text().includes('编辑模式'))!
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
  })

  // 破坏验证:导出当月的 v-if 去掉 `!editMode &&` → 编辑态还有导出 → 红;新增池挪回生成后面 → 顺序红
  it('编辑态按钮 = 新增池 → 生成本月 → 完成,导出当月只在浏览态', async () => {
    const w = await open(ROWS, false)
    expect(w.findAll('.pl-actions button').map(b => b.text())).toContain('导出当月')
    await enterEdit(w)
    const texts = w.findAll('.pl-actions button').map(b => b.text()).filter(t => ['导出当月', '新增池', '生成本月', '完成'].includes(t))
    expect(texts).toEqual(['新增池', '生成本月', '完成'])
  })
})

describe('P4-B2 列模型(03-A)', () => {
  // 破坏验证:segCols 恒给 SEGS(不看开关)→ 多出尖峰平谷 → 红;hiddenCols 默认 [] → 多出实收 / 盈亏 → 红
  it('一期默认:表头一行 12 列,尖峰平谷收起,实收 / 盈亏进列菜单', async () => {
    const w = await open()
    expect(ths(w)).toEqual(COLS)
    expect(w.find('.fp-tt-cols').text()).toBe('列 · 2 列隐藏')
  })

  // 破坏验证:setTou 不改 touOn → 开关点了列不出 → 第一条红;不 saveTouPref → 第二条红
  it('打开「分时用量」:用量后面多出尖 / 峰 / 平 / 谷,并记住', async () => {
    const w = await open()
    await w.find('[role=switch]').trigger('click')
    expect(ths(w).slice(6, 11)).toEqual(['用量', '尖', '峰', '平', '谷'])
    expect(localStorage.getItem('fp-tou-pool')).toBe('1')
  })

  // 破坏验证:FPTableTools 的 :mode 写死 'row' → 没有分时读数也出开关 → 红
  it('一块分时读数都没有:不出开关', async () => {
    const w = await open([CAR, LAMP, WEST])
    expect(w.findAll('[role=switch]')).toHaveLength(0)
  })
})

describe('P4-B3 分组行兼小计与逐行写法(03-A)', () => {
  // 破坏验证:分组行钱那一格改成显 qty → 红;带尾小计行加回来 → pl-bfoot 那条红
  it('分组行写「N 个池」+ 应分摊小计(两位),不再单独起一行小计', async () => {
    const w = await open()
    const g = w.findAll('tr.pl-grp')[0]
    expect(g.text()).toContain('A座及园区公共表')
    expect(g.text()).toContain('3 个池')
    expect(g.find('td.pl-money').text()).toBe(fmtFixed2(bandFooter([CAR, ZS, LAMP]).cost))
    expect(w.findAll('tr.pl-bfoot')).toHaveLength(0)
  })

  // 破坏验证:toggleBand 不改 collapsed → 行还在 → 红
  it('点分组行收起这一组,别的组不动', async () => {
    const w = await open()
    expect(w.findAll('tr.pl-row')).toHaveLength(6)
    await w.findAll('tr.pl-grp')[0].trigger('click')
    expect(w.findAll('tr.pl-row').map(tr => tr.find('.nm').text()))
      .toEqual(['联塑精铟', '公共用电 / 旭化成', '公共用电 / 西侧租户'])
  })

  // 破坏验证:segsOf 恒返回 [] → 点了 › 没有段行 → 红;空尖段照出(去掉 `s.k !== 'qtySharp'`)→ 多一行「尖段 –」→ 红
  it('分时收着时,招商中心那一行带 ›,点开出段行(有值的各一行;空的尖段不出,04-A A座总电)', async () => {
    const w = await open()
    await rowOf(w, '招商中心电1').find('button.pl-segtg').trigger('click')
    expect(w.findAll('tr.pl-seg').map(tr => tr.findAll('td').map(td => td.text()).filter(Boolean).join(' ')))
      .toEqual(['峰段 300.50', '平段 400.20', '谷段 192.31'])
  })

  // 04-C 一期卡:「峰段」一行有数,「平段 · 谷段」并成一行 –;尖段空着不出。和园区抄表 touSegLines 同一写法
  // 破坏验证:nil 不并(每个空段各出一行)→ 第二条多一行 → 红;空尖段照出 → 「平段」变「尖段 · 平段」→ 第一条红
  it('尖、平两段空,峰、谷有数:峰段 / 谷段各一行,空的平段一行 –,尖段不出;平、谷都空才并成「平段 · 谷段」', async () => {
    const PART = pool({ ...ZS, qtyTotal: 492.81, qtySharp: null, qtyPeak: 300.5, qtyFlat: null, qtyValley: 192.31, costAmount: 564.9 })
    const w = await open([CAR, PART, LAMP])
    await rowOf(w, '招商中心电1').find('button.pl-segtg').trigger('click')
    expect(w.findAll('tr.pl-seg').map(tr => tr.findAll('td').map(td => td.text()).filter(Boolean).join(' ')))
      .toEqual(['峰段 300.50', '谷段 192.31', '平段 –'])
    const TWO = pool({ ...PART, qtyPeak: 492.81, qtyFlat: null, qtyValley: null })
    const w2 = await open([CAR, TWO, LAMP])
    await rowOf(w2, '招商中心电1').find('button.pl-segtg').trigger('click')
    expect(w2.findAll('tr.pl-seg').map(tr => tr.find('.pl-seglbl').text())).toEqual(['峰段', '平段 · 谷段'])
  })

  // 破坏验证:电表格改回 lineLabel(全称)→ 第一条红;删掉「新表」小签 → 第二条红;悬停不给全称 → 第三条红
  it('电表格只写表号,「新表」拆成小签,全称在悬停里', async () => {
    const w = await open()
    expect(rowOf(w, '地下车库东侧照明').find('.pl-mtx').text()).toBe('电表①')
    const cell = rowOf(w, '公共用电 / 旭化成').find('.pl-meter')
    expect([cell.find('.pl-mtx').text(), cell.find('.pl-tag').text()]).toEqual(['电表①', '新表'])
    expect(tipOf(cell.find('.pl-mtx').element)?.text).toBe('A座·一楼东侧·公共用电 / 旭化成·电表①新表')
  })

  // 破坏验证:netSummary 的 text 改回「净额 · 冲减 N 表」→ 红
  it('净额池电表格写「冲减 5 表」', async () => {
    const w = await open()
    expect(cellsOf(w, '招商中心电1')[2]).toBe('冲减 5 表')
  })

  // 破坏验证:分摊方式那格去掉 noMeter 分支 → 出「按面积」→ 红;分摊基数那格去掉 noMeter 分支 → 出「1,500 ㎡」→ 红
  it('无绑定表的池整行写「–」', async () => {
    const w = await open()
    expect(cellsOf(w, '联塑精铟').slice(2)).toEqual(['无绑定表', '–', '–', '–', '–', '–', '–', '–', '–', '–'])
  })

  // 破坏验证:分摊方式改回 r.method 原文 → 红
  it('分摊方式只写方式(户对户 / 按面积),不拼基数', async () => {
    const w = await open()
    expect(rowOf(w, '地下车库东侧照明').findAll('td')[8].text()).toBe('户对户')
    expect(rowOf(w, '园区路灯').findAll('td')[8].text()).toBe('按面积')
  })

  // 破坏验证:删掉 <span class="go">↗</span> → 第一条红;tip.sub 不写去计费参数 → 第二条红;点格子不跳 → 第三条红
  it('分摊基数:值带单位,悬停出「↗ 去计费参数」,点了去计费参数页', async () => {
    const w = await open()
    const pv = rowOf(w, '园区路灯').findAll('td')[10].find('.pl-pv')
    expect(pv.text()).toBe('80,000 ㎡↗')
    expect(tipOf(pv.element)?.sub).toContain('去计费参数')
    await pv.trigger('click')
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ path: '/params', query: expect.objectContaining({ rule: '3' }) }))
  })

  // 破坏验证:useTip 的 sub 去掉备注那段 → 红
  it('备注列删了,备注进用途格的悬停说明', async () => {
    const w = await open()
    expect(tipOf(rowOf(w, '地下车库东侧照明').find('.nm').element)?.sub).toContain('备注：东侧照明单独计')
  })
})

describe('P4-B5 字距与行(03-C)', () => {
  // 破坏验证:本月行至改回 fmt(去尾零)→ 红
  it('读数两位小数:497.3 → 497.30', async () => {
    const w = await open()
    expect(rowOf(w, '地下车库东侧照明').findAll('td')[5].text()).toBe('497.30')
  })

  // 破坏验证(逐条):.pl-sumc 的 color 整条删掉 / tbody td font-size 改 12px / thead th font-size 改 11.5px /
  //   tbody td height 改 34px / .pl-table 去掉 letter-spacing / td.pl-money 背景改回 --accent-blue 原色 / 表头下线宽改 1px /
  //   钱列表头字改回 --text-primary / 分组行钱格去掉混灰底 / 分组小计改回加粗正文色 / 合计行改回 40 高 14 字 → 各自那条红
  it('钱格字不用蓝、正文 14、表头 12、行高 40、字距 0、钱列浅底、表头下蓝线(03-A / 04-A / 05-A 同形)', async () => {
    const ro = stubWideTable('pl-wrap')
    ro.injectCss('views/alloc/PoolLedgerView.vue')
    try {
      const w = await open()
      const money = rowOf(w, '园区路灯').find('td.pl-money')
      const cs = (el: Element) => getComputedStyle(el)
      expect(cs(money.find('.pl-sumc').element).color, '钱格字色 = 正文色').toBe('var(--text-primary)')
      expect(cs(money.find('.pl-sumc').element).fontWeight, '钱格加粗').toBe('var(--fw-semibold)')
      expect(cs(money.element).fontSize, '正文').toBe('14px')
      expect(cs(w.find('thead th').element).fontSize, '表头').toBe('12px')
      expect(cs(money.element).height, '行高').toBe('40px')
      const table = w.find('table.pl-table').element
      expect(cs(table).letterSpacing, '字距').toBe('0')
      expect(cs(money.element).background, '钱列底').toBe('var(--money-cell)')
      expect(cs(table).getPropertyValue('--money-cell').trim(), '浅蓝 60% 叠白 ≈ 画布 (241,247,254)')
        .toBe('color-mix(in srgb, var(--accent-blue) 60%, var(--surface-white))')
      const th = w.find('thead th.pl-money-th').element
      expect([cs(th).borderBottomWidth, cs(th).borderBottomColor], '表头下蓝线').toEqual(['2px', 'var(--hue-blue)'])
      expect(cs(th).color, '钱列表头字 = 次要色(画布 76,76,76)').toBe('var(--text-secondary)')
      // 分组行:钱格混灰底,小计常规字重 + 次要色(比数据行的钱轻一档)
      const grp = w.findAll('tr.pl-grp')[0]
      expect(cs(grp.find('td.pl-money').element).background, '分组行钱格').toBe('var(--money-cell-grp)')
      expect(cs(table).getPropertyValue('--money-cell-grp').trim())
        .toBe('color-mix(in srgb, var(--money-cell) 40%, var(--surface-card))')
      const gs = cs(grp.find('.pl-sumc').element)
      expect([gs.fontWeight, gs.color], '分组小计').toEqual(['var(--fw-regular)', 'var(--text-secondary)'])
      // 合计行 50 高、合计数 16(03-A),合计钱格同数据格
      expect(cs(w.find('tfoot th').element).height, '合计行高').toBe('50px')
      expect(w.findAll('tfoot .pl-foot-v').map(v => cs(v.element).fontSize), '用量 / 应分摊合计').toEqual(['16px', '16px'])
      expect(cs(w.find('tfoot th.pl-money').element).background, '合计钱格').toBe('var(--money-cell)')
      // 列组竖线(03-A 三条):电表 / 用量 / 分摊基数左边
      const sepTh = w.findAll('thead th.sep'), sepTd = rowOf(w, '园区路灯').findAll('td.sep')
      expect(sepTh.map(t => t.text()), '竖线落在哪三列').toEqual(['电表', '用量', '分摊基数'])
      expect([...sepTh, ...sepTd].map(e => `${cs(e.element).borderLeftWidth} ${cs(e.element).borderLeftColor}`).join(' | '))
        .toBe(Array(6).fill('1px var(--border-subtle)').join(' | '))
    } finally { ro.restore() }
  })
})

describe('T16 问题面板 · 点一条跳到那一行并闪一下(06-C)', () => {
  // 破坏验证:tr 的 'pl-flash' 类绑定去掉 → 第二条红;gotoDiff 里不展开收着的组 → 第一条红
  it('成员变动点一条:那一组收着就先展开,那一行闪一下并滚进视野', async () => {
    const diff: AllocMemberDiffDTO = { ruleId: 6, poolName: '一期 A座·二楼西侧·公共用电',
      added: [{ tenantId: 9, tenantName: '力美', unitNo: 'A201', inForce: 'yes', preChecked: true }], removed: [] }
    vi.mocked(allocApi.memberDiff).mockResolvedValue([diff])
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const w = await open()
    await w.findAll('tr.pl-grp')[1].trigger('click')          // 先把「A座电梯及楼层公共电」收起来
    expect(w.find('tr[data-rule-id="6"]').exists(), '前置:那一组收着').toBe(false)
    await w.find('button.fac').trigger('click')
    await flushPromises()
    await w.findAll('.fap-item').find(i => i.text().includes('+1 新在租'))!.trigger('click')
    await flushPromises()
    const tr = w.find('tr[data-rule-id="6"]')
    expect(tr.exists(), '收着的组被展开').toBe(true)
    expect(tr.classes()).toContain('pl-flash')
    expect(scroll).toHaveBeenCalled()
  })
})

describe('T16 确认弹窗与改动数', () => {
  // 破坏验证:onGenerate 去掉 ask 那一步 → 没问就生成 → 第一条红
  it('重新生成先问(软件内确认弹窗),答「取消」不生成、答「重新生成」才生成', async () => {
    const w = await open()
    await enterEdit(w)
    const gen = () => w.findAll('.pl-actions button').find(b => b.text() === '重新生成')!
    await gen().trigger('click')
    await flushPromises()
    expect(askQueue[0]?.title).toBe('重新生成 2025-03？')
    answer(false)
    await flushPromises()
    expect(allocApi.generate).not.toHaveBeenCalled()
    await gen().trigger('click')
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(allocApi.generate).toHaveBeenCalledWith('2025-03')
  })

  // 破坏验证:ask 之后那道 `!editMode.value ||` 删掉 → 答完照样生成 → 红
  it('问着的时候编辑权没了(提权到期 / 被接管):答「重新生成」也不生成', async () => {
    const w = await open()
    await enterEdit(w)
    await w.findAll('.pl-actions button').find(b => b.text() === '重新生成')!.trigger('click')
    await flushPromises()
    useAuthStore().permissions = []                 // 提权到期同款:useEditMode 把 editMode 就地转假
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(allocApi.generate).not.toHaveBeenCalled()
  })

  // 破坏验证:useEditMode 不传 dirty(缺省按 1)→ 抽屉关着也算 1 处 → 第一条红
  it('改动数:池配置抽屉关着 0 处,开着 1 处', async () => {
    const w = await open()
    await enterEdit(w)
    expect(useAuthStore().dirtyTotal).toBe(0)
    await w.findAll('.pl-actions button').find(b => b.text() === '新增池')!.trigger('click')
    await flushPromises()
    expect(useAuthStore().dirtyTotal).toBe(1)
  })
})

// ── 对抗复查补的断言(2026-10-01)──────────────────────────────────────────────
interface PoolVm { cfgDirty: boolean; hiddenCols: string[]; genWarnings: string[]; editMode: boolean }
const vmOf = (w: VueWrapper) => w.vm as unknown as PoolVm
// 两块表、金额按池合并(第二块没有逐表金额),第一块有分时读数:池级格的 rowspan 要把段行一起算进去
const MULTI = pool({
  ruleId: 7, bookBlock: 'A座电梯及楼层公共电', name: '一期 A座·二楼·电梯', floorLabel: '二楼', feeName: '电梯',
  autoName: '一期 A座·二楼·电梯', sortNo: 7, method: 'floor', stdValue: 12.5,
  meters: [meter({ meterId: 71 }), meter({ meterId: 72 })],
  lines: [
    line({ meterId: 71, useName: '电梯一', qtyTotal: 60, qtyPeak: 20, qtyFlat: 25, qtyValley: 15, costAmount: null }),
    line({ meterId: 72, useName: '电梯二', qtyTotal: 40, costAmount: null }),
  ],
  qtyTotal: 100, costAmount: 115.3,
})
/** 按 colspan / rowspan 展开:tbody 每一行实占几列(上面 rowspan 盖下来的格也算) */
function widths(w: VueWrapper): number[] {
  const trs = [...w.find('table.pl-table').element.querySelectorAll<HTMLTableRowElement>('tbody tr')]
  const taken = trs.map(() => new Set<number>())
  trs.forEach((tr, r) => {
    let c = 0
    for (const td of [...tr.cells]) {
      while (taken[r].has(c)) c++
      for (let dr = 0; dr < td.rowSpan; dr++) for (let dc = 0; dc < td.colSpan; dc++) taken[r + dr]?.add(c + dc)
      c += td.colSpan
    }
  })
  return taken.map(t => t.size)
}

describe('对抗复查 · 每一行都占满表头那么多列(asserts-4)', () => {
  // 破坏验证:spanOf 改成恒 1(不算段行)→ 段行下面那几行多出格子 → 红;tailN 写死 4 → 放出实收 / 盈亏后分组行少两格 → 红
  it('点开段行 / 放出实收盈亏 / 开分时列三种状态下,逐行展开的列数都等于表头列数', async () => {
    const w = await open([...ROWS, MULTI])
    const check = (what: string) => {
      const n = w.findAll('thead th').length   // 含最右空列:分组 / 逐表 / 段 / 合计每一种行末尾也都得有它那一格
      expect(widths(w).filter(x => x !== n), `${what}:有行不是 ${n} 列`).toEqual([])
    }
    await rowOf(w, '招商中心电1').find('button.pl-segtg').trigger('click')
    await rowOf(w, '电梯一').find('button.pl-segtg').trigger('click')
    expect(w.findAll('tr.pl-seg'), '前提:两处段行都点开了(各 峰 / 平 / 谷)').toHaveLength(6)
    check('点开段行')
    vmOf(w).hiddenCols = []
    await flushPromises()
    expect(ths(w).slice(-2), '前提:实收 / 盈亏放出来了').toEqual(['实收', '盈亏'])
    check('段行 + 实收 / 盈亏')
    await w.find('[role=switch]').trigger('click')
    expect(ths(w), '前提:分时列开了').toContain('尖')
    check('开分时列')
  })
})

describe('对抗复查 · 格内写法:分摊标准带单位、加减度数带正负号(asserts-6,03-A)', () => {
  const extra = (ruleId: number, value: number): ParamRowDTO => ({
    ...coef(ruleId, value, String(value)), key: 'extra_qty', label: '加减度数', group: 'monthly', rowId: 800 + ruleId,
  })
  const FLOOR = pool({
    ruleId: 8, bookBlock: 'A座电梯及楼层公共电', name: '一期 A座·二楼·楼层公共', floorLabel: '二楼', feeName: '楼层公共',
    autoName: '一期 A座·二楼·楼层公共', sortNo: 8, method: 'floor', stdValue: 12.5, meters: [meter({ meterId: 81 })],
    lines: [line({ meterId: 81, useName: '楼层公共', costAmount: 62.5 })], costAmount: 62.5,
  })
  // 破坏验证:stdText 去掉单位拼接 → 第一条红;paramText 去掉 extra_qty 的「+」→ 第二条红;
  //   户对户不回 '' → 第三条红;baseUnit 丢了 floor 那一支 → 第四条红
  it('按面积「0.07 元/㎡」、加减度数「+170」、户对户分摊标准留空、按层份「元/层」「层」', async () => {
    vi.mocked(paramsApi.list).mockResolvedValue([coef(3, 80000, '80,000 ㎡'), coef(4, 1500, '1,500 ㎡'), extra(3, 170), coef(8, 5.7, '5.7')])
    const w = await open([...ROWS, FLOOR])
    const lamp = rowOf(w, '园区路灯').findAll('td')
    expect(lamp[9].text()).toBe('0.07 元/㎡')
    expect(lamp[11].find('.pl-pv').text()).toBe('+170↗')
    expect(rowOf(w, '地下车库东侧照明').findAll('td')[9].text()).toBe('')
    const fl = rowOf(w, '楼层公共').findAll('td')
    expect([fl[9].text(), fl[10].find('.pl-pv').text()]).toEqual(['12.50 元/层', '5.7 层↗'])
  })
})

const STALE: ParamStatusDTO = {
  priceOk: 6, priceTotal: 6, pendingChanges: 2, lastChangeAt: '2025-04-02T10:00:00',
  poolSnapshotAt: '2025-04-02T09:00:00', billBatchAt: null, stale: true, otherMonthsAffected: [],
  lastChangeSource: 'param', staleSources: ['param'],
}
const groupHead = (w: VueWrapper, title: string) => w.findAll('.fap-gh').find(g => g.text().includes(title))
async function openPanel(w: VueWrapper) {
  await w.find('button.fac').trigger('click')
  await flushPromises()
}

describe('对抗复查 · 问题面板「待重算」三支(asserts-7,06-C)', () => {
  // 破坏验证:recalc 去掉 canEnter 那一支(浏览态直接给「重算本月」)→ 红
  it('浏览态 + 参数晚于结果:组头「进入编辑模式」,面板里没有「重算本月」;点了进编辑态,不生成', async () => {
    vi.mocked(paramsApi.status).mockResolvedValueOnce(STALE)
    const w = await open()
    await openPanel(w)
    const btns = groupHead(w, '待重算')!.findAll('button').filter(b => !b.classes('fap-tg'))
    expect(btns.map(b => b.text())).toEqual(['进入编辑模式'])
    expect(w.find('.fap').text()).not.toContain('重算本月')
    await btns[0].trigger('click')
    await flushPromises()
    expect(vmOf(w).editMode).toBe(true)
    expect(allocApi.generate).not.toHaveBeenCalled()
  })

  // 破坏验证:去掉 staleMsg 兜底那一支 → 这一组整个不进面板 → 红;gotoParams 不带 edit → 第二条红
  it('进不了编辑模式的人 + 参数晚于结果:组头「去计费参数页重算」,点了带 edit=1 去计费参数页', async () => {
    useAuthStore().permissions = []
    vi.mocked(paramsApi.status).mockResolvedValueOnce(STALE)
    const w = await open()
    await openPanel(w)
    const btn = groupHead(w, '待重算')!.findAll('button').find(b => b.text() === '去计费参数页重算')
    expect(btn, '组头没有「去计费参数页重算」').toBeDefined()
    await btn!.trigger('click')
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ path: '/params', query: expect.objectContaining({ edit: '1', ym: '2025-03' }) }))
  })

  // 破坏验证:cfgDirty 另起一组 → 出两个「待重算」→ 第一条红;items 只放 stale → 一条明细 → 第二条红
  it('编辑态:参数晚于结果、池配置也改过没重新生成 → 只出一个「待重算」组,两条明细,组头「重算本月」', async () => {
    vi.mocked(paramsApi.status).mockResolvedValueOnce(STALE)
    const w = await open()
    await enterEdit(w)
    vmOf(w).cfgDirty = true
    await flushPromises()
    await openPanel(w)
    const sec = w.findAll('.fap-g').filter(g => g.find('.fap-gh').text().includes('待重算'))
    expect(sec).toHaveLength(1)
    expect(sec[0].findAll('.fap-item .tx').map(i => i.text()))
      .toEqual([expect.stringContaining('本屏数字还是改之前算的'), '2025-03 池配置改过，还没重新生成'])
    expect(sec[0].find('.fap-desc').text()).toContain('和池配置改过')
    expect(sec[0].find('.fap-gh').findAll('button').map(b => b.text())).toContain('重算本月')
  })
})

describe('对抗复查 · 「本次生成告警」组要给得出动作(spec-17,LAYOUT-STABILITY §6-2)', () => {
  const WARN = '池「一期 A座·二楼·电梯」没有受益人,应分摊 115.30 元没摊到任何一户'
  // 破坏验证:gen 组去掉 action → 第一条红;浏览态也给「重新生成」→ 第二条红;进不了编辑模式还进面板 → 第三条红
  it('编辑态组头「重新生成」(先问再生成);浏览态组头「进入编辑模式」;进不了编辑模式的人面板里没有这一组', async () => {
    const w = await open()
    await enterEdit(w)
    vmOf(w).genWarnings = [WARN]
    await flushPromises()
    await openPanel(w)
    const regen = groupHead(w, '本次生成告警')!.findAll('button').find(b => b.text() === '重新生成')
    expect(regen, '编辑态组头没有「重新生成」').toBeDefined()
    await regen!.trigger('click')
    await flushPromises()
    expect(askQueue[0]?.title).toBe('重新生成 2025-03？')
    answer(true)
    await flushPromises()
    expect(allocApi.generate).toHaveBeenCalledWith('2025-03')

    vmOf(w).editMode = false
    vmOf(w).genWarnings = [WARN]
    await flushPromises()
    await openPanel(w)
    expect(groupHead(w, '本次生成告警')!.findAll('button').filter(b => !b.classes('fap-tg')).map(b => b.text()))
      .toEqual(['进入编辑模式'])

    useAuthStore().permissions = []
    await flushPromises()
    expect(groupHead(w, '本次生成告警'), '只报不给动作的不许进面板').toBeUndefined()
  })

  // 破坏验证:desc 改回「引擎生成时报的静默吞钱防线…」→ 红
  it('组说明是给用户看的:说清是什么、不处理会怎样,不写开发用语', async () => {
    const w = await open()
    await enterEdit(w)
    vmOf(w).genWarnings = [WARN]
    await flushPromises()
    await openPanel(w)
    const desc = w.findAll('.fap-g').find(g => g.find('.fap-gh').text().includes('本次生成告警'))!.find('.fap-desc').text()
    expect(desc).toBe('这次生成时查出的问题：池没有受益人、表缺读数、参数没填等。'
      + '不处理的话，有的钱摊不到任何一户、谁也不交，有的户会多摊或少摊。'
      + '改好后重新生成，这一组就清掉（换账期也会清）；不分一期、二期。')
    expect(desc).not.toMatch(/引擎|静默|防线|期别/)
  })
})

describe('对抗复查 · 导出当月出结果回执(spec-2,画布 01-A 卡5 / 02-C)', () => {
  // 破坏验证:去掉 receipt.ok → 第一条红;去掉 try/catch(失败只剩未处理的 rejection)→ 第二条红
  it('成功:「已导出 公共电核算-2025-03-一期.xlsx」;失败:失败回执带「重试」', async () => {
    receipts.splice(0)
    const w = await open()
    const exp = () => w.findAll('.pl-actions button').find(b => b.text() === '导出当月')!
    await exp().trigger('click')
    await flushPromises()
    expect(writeAoaWorkbook).toHaveBeenCalledWith('公共电核算-2025-03-一期.xlsx', expect.any(Array))
    expect(receipts.map(r => [r.tone, r.text])).toEqual([['ok', '已导出 公共电核算-2025-03-一期.xlsx']])
    vi.mocked(writeAoaWorkbook).mockRejectedValueOnce(new Error('文件被占用'))
    await exp().trigger('click')
    await flushPromises()
    expect(receipts.at(-1)).toMatchObject({ tone: 'fail', text: '文件被占用', action: { label: '重试' } })
    receipts.splice(0)
  })
})

describe('对抗复查 · 跳行闪一下的类一定会被摘掉(asserts-3)', () => {
  const DIFF: AllocMemberDiffDTO = { ruleId: 6, poolName: '一期 A座·二楼西侧·公共用电',
    added: [{ tenantId: 9, tenantName: '力美', unitNo: 'A201', inForce: 'yes', preChecked: true }], removed: [] }
  const row6 = (w: VueWrapper) => w.find('tr[data-rule-id="6"]')
  async function flash(w: VueWrapper) {
    Element.prototype.scrollIntoView = vi.fn()
    await openPanel(w)
    await w.findAll('.fap-item').find(i => i.text().includes('+1 新在租'))!.trigger('click')
    await flushPromises()
    expect(row6(w).classes(), '前提:闪着').toContain('pl-flash')
  }
  // 破坏验证:tr 上去掉 @animationcancel → 红
  it('动画被取消(KeepAlive 停用 / 行被摘时浏览器只发 cancel):类跟着摘', async () => {
    vi.mocked(allocApi.memberDiff).mockResolvedValue([DIFF])
    const w = await open()
    await flash(w)
    await row6(w).trigger('animationcancel')
    expect(row6(w).classes()).not.toContain('pl-flash')
  })
  // 破坏验证:toggleBand 里不清 flashId → 红
  it('闪着的时候把那一组收起再展开:那一行不再无端闪一次', async () => {
    vi.mocked(allocApi.memberDiff).mockResolvedValue([DIFF])
    const w = await open()
    await flash(w)
    await w.findAll('tr.pl-grp')[1].trigger('click')
    await w.findAll('tr.pl-grp')[1].trigger('click')
    expect(row6(w).classes()).not.toContain('pl-flash')
  })
  // 破坏验证:onDeactivated 里不清 flashId → 红
  it('闪着的时候切走页签再切回:那一行不闪', async () => {
    vi.mocked(allocApi.memberDiff).mockResolvedValue([DIFF])
    vi.mocked(allocApi.pools).mockResolvedValue({ generated: true, rows: ROWS })
    useBillingPeriodStore().pick(2025, 3)
    const alive = ref(true)
    const w = mount(defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(PoolLedgerView) : null) }),
    }), { attachTo: document.body })
    mounted.push(w)
    await flushPromises()
    await flash(w)
    alive.value = false
    await flushPromises()
    alive.value = true
    await flushPromises()
    expect(row6(w).classes()).not.toContain('pl-flash')
  })
})

describe('对抗复查 · 删除池:问着的时候失去编辑权 / 换了池,答「删除池」也不删(asserts-2)', () => {
  const delBtn = () => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '删除池')!
  async function askDel(w: VueWrapper) {
    vi.mocked(allocApi.deleteRule).mockClear()
    await enterEdit(w)
    await rowOf(w, '园区路灯').find('.pl-pname').trigger('click')
    await flushPromises()
    delBtn().click()
    await flushPromises()
    expect(askQueue[0]?.title).toContain('删除池')
  }
  // 对照:守卫没有把正常的删除也拦掉(否则下面两条是白绿)
  it('对照:一直在编辑态、抽屉没换池 → 答「删除池」就删', async () => {
    const w = await open()
    await askDel(w)
    answer(true)
    await flushPromises()
    expect(allocApi.deleteRule).toHaveBeenCalledWith(3)
  })
  // 破坏验证:delPool 里 ask 之后那道 `if (!editMode.value || !poolDlg.value || form.value !== f) return` 删掉 → 这条和下一条红
  it('问着的时候提权到期(编辑态就地转假)→ 不删', async () => {
    const w = await open()
    await askDel(w)
    useAuthStore().permissions = []
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(allocApi.deleteRule).not.toHaveBeenCalled()
  })
  it('问着的时候抽屉换成了另一个池 → 不删', async () => {
    const w = await open()
    await askDel(w)
    await rowOf(w, '地下车库东侧照明').find('.pl-pname').trigger('click')
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(allocApi.deleteRule).not.toHaveBeenCalled()
  })
})
