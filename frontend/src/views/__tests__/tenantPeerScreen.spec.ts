// src/views/__tests__/tenantPeerScreen.spec.ts — TenantPeerView(design-boards T8/T9)挂载测。
// TenantPeer.logic.spec.ts 管算得对不对(纯函数),这里管**屏上真的印出来了没有**——
// 照 expiryScreen.spec.ts 的写法(vi.mock anaData + AnaEChart 桩组件),不登录、不起真浏览器。
//
// asOf 用真实时钟(TenantPeerView 内部 `today = new Date()`),所以合同起止日期用相对「今天」
// 现算,不写死年份字符串(同 expiryScreen.spec.ts 的既有约定)。
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { BuildingDTO } from '@/types/building'
import type { ContractDTO } from '@/types/contract'
import type { TenantDTO } from '@/types/tenant'
import type { AnalysisS10Row } from '@/api/analysis'

// AnaEmpty.vue 读 useAuthStore()(navAccess 判「去录入」链接可见性)——挂载测必须有一个活跃 Pinia,
// 否则样本不足那条空态渲染时直接抛 [🍍] getActivePinia 错误(同 pvMeterAnaScreen.spec.ts 的既有写法)。
beforeEach(() => setActivePinia(createPinia()))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/components/ana/AnaEChart.vue', () => ({
  default: { name: 'AnaEChart', props: ['option', 'height'], template: '<div class="stub-chart" />' },
}))

const today = new Date()
const iso = (d: Date) => d.toLocaleDateString('sv')
const pastStart = iso(new Date(today.getFullYear() - 3, 0, 1))
const futureEnd = iso(new Date(today.getFullYear() + 1, 0, 1))

const BUILDINGS: BuildingDTO[] = [
  { id: 1, name: 'P1栋', phase: 1, phaseName: '一期', zone: 'p1', kind: 'normal', floorCount: 1, totalArea: 0, rentableArea: 0, status: 1, unitCount: 0, occupiedCount: 0, vacantCount: 0, expiringCount: 0, reservedCount: 0, leasedArea: 0, occRate: null, monthlyRent: 0, tenantIds: [], tenantBuildingArea: 0 },
  { id: 2, name: 'P2栋', phase: 2, phaseName: '二期', zone: 'p2', kind: 'normal', floorCount: 1, totalArea: 0, rentableArea: 0, status: 1, unitCount: 0, occupiedCount: 0, vacantCount: 0, expiringCount: 0, reservedCount: 0, leasedArea: 0, occRate: null, monthlyRent: 0, tenantIds: [], tenantBuildingArea: 0 },
]

function ct(p: Partial<ContractDTO>): ContractDTO {
  return {
    id: 0, contractNo: 'HT', tenantId: 0, tenantName: '', buildingId: 1, buildingName: '', unitId: null, floorInfo: '',
    rentArea: 100, monthlyRent: 1000, deposit: 0, startDate: pastStart, endDate: futureEnd, signDate: pastStart,
    status: 'active', kind: 'normal', termMonths: 24, daysToEnd: null, remark: null,
    billingLineCount: 1, ...p,   // 默认有租金计费行(F1);挂载测不专门覆盖 billingLineCount=0,那条在 TenantPeer.logic.spec.ts 测
  }
}

// 期区一:25 份(≥MIN_SAMPLE=20,给区间);单位租金 11..35(面积恒 100,月租 1000+n×100,n=1..25)。
const PHASE1 = Array.from({ length: 25 }, (_, i) => {
  const n = i + 1
  return ct({ id: 1000 + n, tenantId: n, tenantName: `租户${String(n).padStart(2, '0')}`, buildingId: 1, rentArea: 100, monthlyRent: 1000 + n * 100 })
})
// 期区二:仅 3 份(<20,无法给区间)
const PHASE2 = Array.from({ length: 3 }, (_, i) => {
  const n = 100 + i
  return ct({ id: 2000 + n, tenantId: n, tenantName: `丙租户${n}`, buildingId: 2, rentArea: 50, monthlyRent: 500 })
})
const CONTRACTS = [...PHASE1, ...PHASE2]

// F4:tenant.phase 是徽章期区的字段来源(不是 building.phase)——桩数据里两者恰好同值,
// 不专门覆盖「不一致」这个场景(那条在 TenantPeer.logic.spec.ts 用构造数据测,钉住取的是哪个字段)。
const TENANTS: TenantDTO[] = CONTRACTS.map((c) => ({
  id: c.tenantId, companyName: c.tenantName, contactName: null, contactPhone: null,
  businessType: '', status: 1, categoryId: null, phase: c.buildingId === 1 ? 1 : 2,
  since: null, monthlyRent: c.monthlyRent, leasedArea: c.rentArea,
  primaryBuilding: null, contractCount: 1, parentId: null, parentName: null,
}))

// T10:s10 附表10 电费(「同一招式，用在电费上会翻车」卡)——250(超 MIN_SAMPLE 门槛不相关,这里只需
// 覆盖「latestElecSpread 拿到数据后卡片渲染」这条路径,数字不追求业务真实,够用就行。
const S10_ROWS: AnalysisS10Row[] = Array.from({ length: 5 }, (_, i) => ({
  acctMonth: '2026-08', phase: 1, tenantId: null, tenantName: '电户' + i, elec: (i + 1) * 1000, water: 0, total: (i + 1) * 1000,
}))
const S10_MAP = new Map<string, AnalysisS10Row[]>(S10_ROWS.map((r) => [r.tenantName, [r]]))

vi.mock('@/analysis/anaData', () => ({
  fetchAvailableMonths: vi.fn(async () => ({ months: ['2026-08', '2026-09'], sources: { pnl: ['2026-08', '2026-09'] } })),
  fetchContracts: vi.fn(async () => CONTRACTS),
  fetchTenants: vi.fn(async () => TENANTS),
  fetchBuildings: vi.fn(async () => BUILDINGS),
  // F2(对抗复查):期区一(PHASE1,id 1001..1025)混合物业类型——1021..1025 这 5 份是办公,
  // 其余(含期区二/单独查头部的那份)一律厂房。用来验证口径浮层不得声称"全部是厂房"
  // (那正是 F2 坐实的缺陷:那句话验的是期区二,渲染在默认打开的期区一)。1001(租户01)
  // 仍是厂房,不影响既有的"头部物业类型"断言。
  fetchContractDetail: vi.fn(async (id: number) => {
    const pt = id >= 1021 && id <= 1025 ? 'office' : 'factory'
    const feeKey = pt === 'office' ? 'rent_office' : 'rent_factory'
    return {
      contract: {}, tenant: {}, extraUnitIds: [],
      billingLines: [{ id: 1, contractId: id, location: '主', feeKey, propertyType: pt, billMode: 'per_sqm_month', unitPrice: 10, area: 100, coeff: 1, source: 'manual', seq: 0 }],
    }
  }),
  fetchS10TenantMap: vi.fn(async () => S10_MAP),
  invalidateAnaCache: vi.fn(),
}))

import TenantPeerView from '@/views/analysis/TenantPeerView.vue'
import { fetchS10TenantMap } from '@/analysis/anaData'
import type { VueWrapper } from '@vue/test-utils'

// FPTenantPicker 候选按 zh 排序,「丙租户100」的拼音(bǐng)排在「租户01」(zū)前面——
// 不依赖「默认选中项恰好是哪户」这个隐含假设,统一用真实的点击交互切到目标租户,断言更稳更贴近真实用户路径。
async function selectTenant(w: VueWrapper, nameSubstring: string) {
  await w.find('button.fp-tp-trigger').trigger('click')
  const opt = w.findAll('.fp-tp-item').find((o) => o.text().includes(nameSubstring))
  expect(opt, `选择器里找不到「${nameSubstring}」`).toBeTruthy()
  await opt!.trigger('click')
  await flushPromises()
}

describe('TenantPeerView · 单位租金对标挂载测', () => {
  it('❗头部:期间 · 租户 · 期区 · 物业类型 面积', async () => {
    const w = mount(TenantPeerView, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await flushPromises()
    await selectTenant(w, '租户01')
    const text = w.text()
    expect(text).toContain('租户01')
    expect(text).toContain('期区一')
    expect(text).toContain('厂房')       // fetchContractDetail 桩返回 property_type=factory
    expect(text).toMatch(/100\s*㎡/)
  })

  // F2(对抗复查,缺的断言):给 fetchContractDetail 桩喂一批混合物业类型(见文件头 mock 注释),
  // 断言「单位租金对标」卡的口径浮层不得声称同类只有单一物业类型——这是改前的真实缺陷:
  // 浮层写死"全部是厂房",实际渲染的这批同类(期区一)是厂房/办公混合。
  it('❗F2:同类物业类型混合(期区一含办公)时,口径浮层不得声称"全部是厂房",须逐类点出份数', async () => {
    const w = mount(TenantPeerView, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await flushPromises()
    await selectTenant(w, '租户01')
    await flushPromises()   // propTypeCache 要等 25 份 fetchContractDetail 的 Promise.all 全部落地
    await flushPromises()
    const card = w.findAll('.av2-card').find((c) => c.text().includes('单位租金对标'))
    expect(card, '找不到「单位租金对标」卡').toBeTruthy()
    // 口径浮层默认收起(AnaMethodNote 的 v-if="open"),不打开就看不见 slot 内容——
    // 同 expiryScreen.spec.ts 的既有写法,打开浮层让门禁真的看一眼里面印了什么。
    const pill = card!.find('.ana-note-pill')
    expect(pill.exists(), '「单位租金对标」卡里没找到口径浮层的触发按钮').toBe(true)
    await pill.trigger('click')
    await flushPromises()
    const noteText = card!.text()
    expect(noteText).not.toContain('全部是厂房')   // 核心断言:改前的假话
    expect(noteText).toContain('厂房20份')
    expect(noteText).toContain('办公室5份')
  })

  it('❗卡内:直方图桩 + 读数句(闭嘴条件:below<50→"低于"分支,人数=严格大于占比)+ 参照系小字含样本量', async () => {
    const w = mount(TenantPeerView, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await flushPromises()
    await selectTenant(w, '租户01')
    const card = w.findAll('.av2-card').find((c) => c.text().includes('单位租金对标'))
    expect(card, '找不到「单位租金对标」卡').toBeTruthy()
    expect(card!.find('.stub-chart').exists(), '直方图没有渲染').toBe(true)
    // 租户01(n=1):月租 1000+1×100=1100,面积 100 → 单位租金 11,是本组(11..35)最小值:
    // 0 份严格更低 → 低于分支,严格更高的 24/25=96%
    const readEl = card!.find('.ana-read')
    expect(readEl.exists(), '没有读数句').toBe(true)
    expect(readEl.text()).toBe('11.0元/㎡·月，低于期区一96%同类')
    expect([...readEl.text()].length, '读数句超过 30 可见字').toBeLessThanOrEqual(30)
    const refEl = card!.find('.ana-ref')
    expect(refEl.text()).toMatch(/参照25份期区一、已录面积在租合同·\d{4}-\d{2}/)
    expect([...refEl.text()].length, '参照系小字超过 28 可见字').toBeLessThanOrEqual(28)
    // 带 % 的读数句必须同卡有参照系小字(全局约束⑤,anaCopyLint 同款判据)
    expect(readEl.exists() && refEl.exists()).toBe(true)
  })

  it('❗样本不足(<20)的期区:不画直方图、不印百分比,给诚实的空态说明', async () => {
    const w = mount(TenantPeerView, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await flushPromises()
    // 切到期区二那户(丙租户100),期区二只有 3 份 < MIN_SAMPLE=20
    await selectTenant(w, '丙租户100')
    const card = w.findAll('.av2-card').find((c) => c.text().includes('单位租金对标'))
    expect(card!.find('.stub-chart').exists(), '样本不足时不该画图').toBe(false)
    expect(card!.text()).toContain('同类样本不足')
    expect(card!.text()).toContain('3')       // 实际样本量
    expect(card!.text()).not.toMatch(/%/)     // 样本不足不印百分比
  })

  it('❗页签:电费/缴费行为设计稿未定义内容,禁用不可点', async () => {
    const w = mount(TenantPeerView, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await flushPromises()
    const btns = w.findAll('.tp-tabs button')
    expect(btns.map((b) => b.text())).toEqual(['单位租金', '电费', '缴费行为'])
    const elecBtn = btns[1]
    expect(elecBtn.attributes('disabled')).toBeDefined()
    await elecBtn.trigger('click')
    await flushPromises()
    // 点了禁用按钮也不该切走——卡头仍是「单位租金对标」
    expect(w.text()).toContain('单位租金对标')
  })

  it('❗T10「哪些期区能给区间」:期区一样本够(25≥20)给区间,期区二样本不足(3<20)', async () => {
    const w = mount(TenantPeerView, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await flushPromises()
    const card = w.findAll('.av2-card').find((c) => c.text().includes('哪些期区能给区间'))
    expect(card, '找不到「哪些期区能给区间」卡').toBeTruthy()
    const rows = card!.findAll('tbody tr')
    expect(rows).toHaveLength(2)   // 桩数据只有期区一、期区二两个期区
    expect(rows[0].text()).toContain('期区一')
    expect(rows[0].text()).toContain('25')
    expect(rows[0].text()).not.toContain('样本不足')   // 25≥MIN_SAMPLE=20,给区间
    expect(rows[1].text()).toContain('期区二')
    expect(rows[1].text()).toContain('3')
    expect(rows[1].text()).toContain('样本不足')       // 3<MIN_SAMPLE=20,不给区间(但中位数仍有数字)
  })

  it('❗T10「同一招式，用在电费上会翻车」:附表10 数据到位后画出 p10/p90/最高 + 读数句', async () => {
    const w = mount(TenantPeerView, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await flushPromises()
    const card = w.findAll('.av2-card').find((c) => c.text().includes('同一招式'))
    expect(card, '找不到「同一招式，用在电费上会翻车」卡').toBeTruthy()
    expect(card!.text()).toContain('2026-08')   // 桩数据的最新 acctMonth
    expect(card!.text()).toContain('5 户')       // S10_MAP 5 户
    const readEl = card!.find('.ana-read')
    expect(readEl.exists(), '没有读数句').toBe(true)
    expect(readEl.text()).toContain('倍')
    expect([...readEl.text()].length, '读数句超过 30 可见字').toBeLessThanOrEqual(30)
    const refEl = card!.find('.ana-ref')
    expect(refEl.exists(), '没有参照系小字').toBe(true)
    expect([...refEl.text()].length, '参照系小字超过 28 可见字').toBeLessThanOrEqual(28)
  })

  it('❗T10「同一招式，用在电费上会翻车」:附表10 未导入 → 诚实空态,不是空表/崩溃', async () => {
    vi.mocked(fetchS10TenantMap).mockResolvedValueOnce(new Map())
    const w = mount(TenantPeerView, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await flushPromises()
    const card = w.findAll('.av2-card').find((c) => c.text().includes('同一招式'))
    expect(card, '找不到「同一招式，用在电费上会翻车」卡').toBeTruthy()
    expect(card!.find('table').exists(), '没有电费数据时不该画表').toBe(false)
    expect(card!.text()).toContain('附表10 未导入')
  })

  it('❗T11「这张图为什么可信」:对标带 vs 预测带对照表四行都在', async () => {
    const w = mount(TenantPeerView, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await flushPromises()
    const card = w.findAll('.av2-card').find((c) => c.text().includes('这张图为什么可信'))
    expect(card, '找不到「这张图为什么可信」卡').toBeTruthy()
    const rows = card!.findAll('tbody tr')
    expect(rows).toHaveLength(4)
    expect(card!.text()).toContain('对标带')
    expect(card!.text()).toContain('预测带')
  })
})
