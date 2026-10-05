// src/views/__tests__/motionR2-expiryChargeBreakevenRoi.spec.ts — 动效第二轮(2026-09-16 行为矩阵)
// · 到期 / 充电桩 / 盈亏平衡 / 光伏回收四屏。
//
// 钉三件事:
//   ① 骨架只认首进:数据到了是真内容;**再换一次年**,图组件没被卸载(同一个 DOM 节点),
//      旧内容留在原地,200ms 后内容宿主挂 .fp-stale,数据到了摘掉。
//   ② 在途期间屏上的字跟「已加载的那一年 / 那一期」走,不拿新年的字配旧年的图。
//   ③ S 档(≤600)骨架里顶替 AnaEChart 的块随图降档(AnaSkelChart),顶替自绘图 / DOM 的块不降。
//
// 期间无关的两屏(到期 / 光伏回收)没有换年:到期屏钉回签静默重取不重挂,光伏回收钉进度条的擦入与形变。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, nextTick, ref, type Component } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import type { ContractDTO } from '@/types/contract'
import type { PnlSummary } from '@/analysis/anaData'
import type { PvPhaseDTO, PvRecordDTO } from '@/types/pv'
import type { CpReadingDTO } from '@/api/cpMeter'
import type { AnalysisS10Row } from '@/api/analysis'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))
vi.mock('@/components/ana/AnaEChart.vue', () => ({
  default: { name: 'AnaEChart', props: ['option', 'height', 'entrance'], template: '<div class="stub-chart" />' },
}))
vi.mock('@/analysis/anaData', async (orig) => {
  const months = ['2025-05', '2025-06', '2026-01', '2026-02', '2026-03']
  return {
    ...(await orig<typeof import('@/analysis/anaData')>()),
    fetchAvailableMonths: vi.fn(async () => ({ months, sources: { pnl: months } })),
    fetchContracts: vi.fn(),
    fetchPnlSummary: vi.fn(),
    fetchS10Rows: vi.fn(async () => []),
    fetchPvPhases: vi.fn(),
    fetchPvAll: vi.fn(),
    invalidateAnaCache: vi.fn(),
  }
})
vi.mock('@/api/cpMeter', () => ({
  cpMeterApi: { years: vi.fn(), stations: vi.fn(), readings: vi.fn(), powerUsage: vi.fn() },
}))

import ExpiryView from '@/views/analysis/ExpiryView.vue'
import ChargingAnalysisView from '@/views/analysis/ChargingAnalysisView.vue'
import BreakevenView from '@/views/analysis/BreakevenView.vue'
import PvRoiView from '@/views/analysis/PvRoiView.vue'
import { fetchContracts, fetchPnlSummary, fetchPvAll, fetchPvPhases, fetchS10Rows } from '@/analysis/anaData'
import { cpMeterApi } from '@/api/cpMeter'
import { usePeriod } from '@/analysis/usePeriod'
import { __resetAnaSettingsForTest, anaSettings, loadAnaSettings } from '@/analysis/anaSettings'
import { analysisApi } from '@/api/analysis'
import { useAuthStore } from '@/stores/auth'
import { receipt } from '@/utils/receipt'
import http from '@/api'

const STUBS = { global: { stubs: { RouterLink: true, teleport: true } } }
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))
type Finder = { findAll: (s: string) => { element: Element }[] }
const charts = (w: Finder) => w.findAll('.stub-chart').map((e) => e.element)
const shims = (w: Finder, root: string) => w.findAll(`${root} .fp-shim`).map((e) => (e.element as HTMLElement).style.height)

/** 在途闸门:open() 之后取数挂住,release() 放行 */
let gate: Promise<void> | null = null
let release = () => {}
const open = () => { gate = new Promise<void>((r) => { release = () => { gate = null; r() } }) }
const pass = async () => { if (gate) await gate }

/** S 档:只让 max-width: 600px 命中(减动效等其它查询一律不中) */
const asS = () => vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width: 600px'), media: q, addEventListener() {}, removeEventListener() {} }))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  gate = null
  __resetAnaSettingsForTest()   // 目标与阈值回默认(2026-10-05 起在库里,各用例自己给值)
})
afterEach(() => { vi.unstubAllGlobals() })

// ── 到期墙与续约 ─────────────────────────────────────────────────────
const today = new Date()
const iso = (d: Date) => d.toLocaleDateString('sv')
const CONTRACTS: ContractDTO[] = [1, 2, 3].map((i) => ({
  id: i, contractNo: 'HT' + i, tenantId: i, tenantName: '租户' + i,
  buildingId: 1, buildingName: 'A栋', unitId: i, floorInfo: '1F',
  rentArea: 100, monthlyRent: 1000 * i, deposit: 0,
  startDate: iso(new Date(today.getFullYear() - 2, 0, 1)),
  endDate: iso(new Date(today.getFullYear(), today.getMonth() + 2 * i, 1)),
  signDate: null, status: 'active', termMonths: 0, daysToEnd: null, remark: null,
}))

describe('到期墙与续约', () => {
  it('❗S 档骨架:到期墙块随图降档 250→220;合约租金带是自绘图,280 不降', () => {
    vi.mocked(fetchContracts).mockImplementation(() => new Promise<never>(() => {}))
    asS()
    const w = mount(ExpiryView, STUBS)
    // 2026-09-16 起页头 / 结论条 / 卡头 / 读数句照抄真版式,灰条只剩图块与表块(浏览器 390 宽逐块对过)
    // 到期墙(降)· 租金带 280 · 先谈哪几户表 480 · 续签计数 112 · 敏感性表 182 · Pareto(降)· 集中度环(降)· 合同清单 480
    // 2026-09-20 P2:折叠条占位 44px 插在「先谈哪几户」之后(稿 ⑦ 的折叠线位置)
    expect(shims(w, '.ana-skel')).toEqual(['220px', '280px', '480px', '44px', '112px', '182px', '260px', '260px', '480px'])
    w.unmount()
  })

  it('❗切回页签静默重取:图不卸载、不退回骨架', async () => {
    vi.mocked(fetchContracts).mockImplementation(async () => CONTRACTS)
    const alive = ref(true)
    const w = mount(defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(ExpiryView) : null) }),
    }), STUBS)
    await flushPromises()
    expect(w.find('.ana-skel').exists(), '数据到了还是骨架').toBe(false)
    const before = charts(w)
    expect(before.length, '到期墙 / Pareto / 集中度三张图').toBe(3)

    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(fetchContracts).toHaveBeenCalledTimes(2)
    expect(w.find('.ana-skel').exists(), '回签退回了骨架').toBe(false)
    const after = charts(w)
    expect(after.length).toBe(3)
    after.forEach((el, i) => expect(el, `第 ${i} 张图被卸载重挂了`).toBe(before[i]))
    w.unmount()
  })
})

// ── 充电桩分析 ───────────────────────────────────────────────────────
const cpRows = (y: number): CpReadingDTO[] => [
  { id: 1, stationId: 1, stationName: '一号桩', readDate: `${y}-03-05`, chargeKwh: y === 2026 ? 500 : 300, fee: 10, revenue: 400, note: null, source: 'manual' },
]

describe('充电桩分析', () => {
  beforeEach(() => {
    vi.mocked(cpMeterApi.years).mockResolvedValue([2025, 2026])
    vi.mocked(cpMeterApi.stations).mockResolvedValue([{ id: 1, name: '一号桩', operator: '万城万', vehicleType: 'car', sortNo: 1 }])
    vi.mocked(cpMeterApi.readings).mockImplementation(async (y: number) => { await pass(); return cpRows(y) })
    vi.mocked(cpMeterApi.powerUsage).mockResolvedValue([])
  })

  it('❗S 档骨架:四张图块随图降档 300/250/250/250 → 260/220/220/220', () => {
    vi.mocked(cpMeterApi.years).mockImplementation(() => new Promise<never>(() => {}))
    asS()
    const w = mount(ChargingAnalysisView, STUBS)
    // 2026-09-16 起页头 / 结论条 / 卡头 / 读数句照抄真版式,灰条只剩图块与表块(浏览器 390 宽逐块对过)
    // 2026-09-20 P2:这屏按稿折叠(4 图 → 2 常显 2 折),折进去的两块 S 档不进 DOM;
    // 44 = 折叠条占位(.ana-fold 的 min-height)。图1 的 height 在 S 档下发 250,再经
    // anaChartHeight 降到 220 —— 所以第一块也是 220,不再是 260。
    expect(shims(w, '.ana-skel')).toEqual(['220px', '220px', '44px'])
    w.unmount()
  })

  it('❗换年:图不卸载、字停在旧年,200ms 后退让,数据到了原地换新', async () => {
    const w = mount(ChargingAnalysisView, { ...STUBS, attachTo: document.body })
    await flushPromises()
    expect(w.find('.ana-skel').exists(), '数据到了还是骨架').toBe(false)
    expect(w.find('.ca-concl').text()).toContain('2026年')
    const before = charts(w)
    expect(before.length, '量收 / 环 / 费率三张图').toBe(3)
    const host = w.find('.ak-page[data-stale-host]')
    expect(host.exists(), '内容宿主没挂 data-stale-host').toBe(true)

    open()
    w.findComponent({ name: 'DatePicker' }).vm.$emit('update:modelValue', '2025')
    await flushPromises()
    expect(w.find('.ana-skel').exists(), '换年退回了骨架').toBe(false)
    charts(w).forEach((el, i) => expect(el, `第 ${i} 张图被卸载重挂了`).toBe(before[i]))
    expect(w.find('.ca-concl').text(), '新年的字配了旧年的图').toContain('2026年')
    expect(w.find('.ak-page[data-stale-host]').element, '宿主被重挂了').toBe(host.element)
    expect(host.classes(), '没到 200ms 就退让').not.toContain('fp-stale')

    await tick(260); await flushPromises()
    expect(host.classes()).toContain('fp-stale')
    expect(host.attributes('aria-busy')).toBe('true')
    expect(w.find('.anx-tools > .fp-lb').exists(), '工具条上没亮进度线').toBe(true)

    release(); await flushPromises()
    expect(host.classes()).not.toContain('fp-stale')
    charts(w).forEach((el, i) => expect(el, `数据到后第 ${i} 张图被重挂了`).toBe(before[i]))
    expect(w.find('.ca-concl').text()).toContain('2025年')
    w.unmount()
  })

  it('❗汽车 / 电动车是段控换档:正文整组重挂(新图入场),不在两套桩之间形变;同档换年仍是同一组节点', async () => {
    vi.mocked(cpMeterApi.stations).mockResolvedValue([
      { id: 1, name: '一号桩', operator: '万城万', vehicleType: 'car', sortNo: 1 },
      { id: 2, name: '二号桩', operator: '易充', vehicleType: 'ebike', sortNo: 2 },
    ])
    vi.mocked(cpMeterApi.readings).mockImplementation(async (y: number) => [
      ...cpRows(y),
      { id: 2, stationId: 2, stationName: '二号桩', readDate: `${y}-04-05`, chargeKwh: 80, fee: 2, revenue: 60, note: null, source: 'manual' },
    ])
    const w = mount(ChargingAnalysisView, STUBS)
    await flushPromises()
    const car = charts(w)
    expect(car.length).toBe(3)
    const grid = w.find('.ak-page[data-stale-host] .av2-grid').element
    const btn = (t: string) => w.findAll('button').find((b) => b.text() === t)!
    await btn('电动车').trigger('click')
    await flushPromises()
    expect(w.find('.ak-sub').text()).toContain('电动车桩')
    const ebike = charts(w)
    expect(ebike.length).toBe(3)
    ebike.forEach((el, i) => expect(el, `第 ${i} 张图跨档复用 = 汽车桩的柱滑成电动车桩`).not.toBe(car[i]))
    expect(w.find('.ak-page[data-stale-host] .av2-grid').element).not.toBe(grid)
    // 同档换年仍是同一组节点(对照)
    w.findComponent({ name: 'DatePicker' }).vm.$emit('update:modelValue', '2025')
    await flushPromises()
    charts(w).forEach((el, i) => expect(el).toBe(ebike[i]))
    w.unmount()
  })
})

// ── 盈亏平衡与敏感性 ─────────────────────────────────────────────────
const arr = (vals: Record<number, number>) => Array.from({ length: 12 }, (_, i) => vals[i + 1] ?? null)
const summaryOf = (y: number): PnlSummary => {
  const rev: Record<number, number> = y === 2026 ? { 1: 100000, 2: 120000, 3: 130000 } : { 5: 90000, 6: 95000 }
  const cost: Record<number, number> = y === 2026 ? { 1: 80000, 2: 90000, 3: 95000 } : { 5: 70000, 6: 72000 }
  return { year: y, months: Object.keys(rev).map(Number), revenue: arr(rev), cost: arr(cost), profit: arr({}), bySchedule: {} }
}

describe('盈亏平衡与敏感性', () => {
  beforeEach(() => {
    vi.mocked(fetchPnlSummary).mockImplementation(async (y: number) => { await pass(); return summaryOf(y) })
  })

  it('❗S 档骨架:三张图块随图降档 300/300/250 → 260/260/220;滑杆行 20 不降', () => {
    vi.mocked(fetchPnlSummary).mockImplementation(() => new Promise<never>(() => {}))
    asS()
    const w = mount(BreakevenView, STUBS)
    // 2026-09-16 起页头 / 结论条 / 卡头 / 读数句照抄真版式,灰条只剩图块与表块(浏览器 390 宽逐块对过)
    // 主图(降)· 滑杆行里的输入条 20 · 龙卷风(降)· 拆分(降)
    expect(shims(w, '.ana-skel')).toEqual(['260px', '20px', '260px', '220px'])
    w.unmount()
  })

  it('❗换年:图与 KPI 不卸载;口径月与回退标签停在旧期,200ms 后退让,数据到了原地换新', async () => {
    const w = mount(BreakevenView, { ...STUBS, attachTo: document.body })
    await flushPromises()
    const p = usePeriod()
    p.setYear(2026); p.setMonth(2)
    await flushPromises()
    expect(w.find('.ana-skel').exists(), '数据到了还是骨架').toBe(false)
    expect(w.find('.ak-sub').text()).toContain('口径月 2026-02')
    const before = charts(w)
    expect(before.length, 'CVP / 龙卷风 / 拆分三张图').toBe(3)
    expect(w.findAll('.anx-kpis .av2-kpi')).toHaveLength(6)
    const host = w.find('.ak-page[data-stale-host]')
    expect(host.exists(), '内容宿主没挂 data-stale-host').toBe(true)

    open()
    p.setYear(2025)   // 2025 只有 5、6 月 → sel 落 2025-06
    await flushPromises()
    expect(w.find('.ana-skel').exists(), '换年退回了骨架').toBe(false)
    charts(w).forEach((el, i) => expect(el, `第 ${i} 张图被卸载重挂了`).toBe(before[i]))
    expect(w.findAll('.anx-kpis .av2-kpi'), 'KPI 瓦在途被清空了').toHaveLength(6)
    // 旧年数据还在屏上:口径月不许被新年的选择拽到旧年的另一个月,也不许冒出「选 2025-06 用 2026-02」的回退标签
    expect(w.find('.ak-sub').text(), '旧图跳到了另一个口径月').toContain('口径月 2026-02')
    expect(w.find('.anx-period .fp-state').exists(), '新年的选择配旧年的口径月,冒出了回退标签').toBe(false)
    expect(host.classes(), '没到 200ms 就退让').not.toContain('fp-stale')

    await tick(260); await flushPromises()
    expect(host.classes()).toContain('fp-stale')
    expect(w.find('.anx-kpis').classes(), 'KPI 行没同拍退让').toContain('fp-stale')
    expect(w.find('.anx-tools > .fp-lb').exists(), '工具条上没亮进度线').toBe(true)

    release(); await flushPromises()
    expect(host.classes()).not.toContain('fp-stale')
    charts(w).forEach((el, i) => expect(el, `数据到后第 ${i} 张图被重挂了`).toBe(before[i]))
    expect(w.find('.ak-sub').text()).toContain('口径月 2025-06')
    w.unmount()
  })

  it('❗C6-15:只有拖滑杆那一次三张图瞬到(顶层 0);换月照常 200 形变(option 不写动画键)', async () => {
    const fr = anaSettings.breakevenFixedRatio
    useAuthStore().permissions = ['analysis:view', 'report:edit']
    const save = vi.spyOn(analysisApi, 'saveSettings').mockImplementation(async (p) => p)
    const w = mount(BreakevenView, STUBS)
    await flushPromises()
    const p = usePeriod()
    p.setYear(2026); p.setMonth(2)
    await flushPromises()
    const opts = () => w.findAllComponents({ name: 'AnaEChart' }).map((c) => c.props('option') as Record<string, unknown>)
    const upd = () => opts().map((o) => o.animationDurationUpdate)
    expect(opts()).toHaveLength(3)
    expect(upd(), '首绘就写死了 0').toEqual([undefined, undefined, undefined])

    const input = w.find('.bev-slider input[type="range"]')
    ;(input.element as HTMLInputElement).value = String(fr === 0.3 ? 0.4 : 0.3)
    await input.trigger('input')
    await flushPromises()
    expect(upd(), '拖滑杆那一次没瞬到').toEqual([0, 0, 0])
    expect(w.find('.bev-try').exists(), '有编辑权也说「只是看看效果」').toBe(false)
    // 2026-10-05 起系数在库里、全员一份(用户拍板第 2 条):拖的时候只改本屏,松手存一次。
    // 破坏验证:@change 去掉 → 红;onFr 里改回 saveAnaSettings → 「拖动中就存了」红
    expect(save, '拖动中就往库里存了').not.toHaveBeenCalled()
    await input.trigger('change')
    await flushPromises()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ breakevenFixedRatio: fr === 0.3 ? 0.4 : 0.3 })

    p.setMonth(3)
    await flushPromises()
    expect(w.find('.ak-sub').text()).toContain('口径月 2026-03')
    expect(upd(), '换月被当成拖滑杆,瞬跳').toEqual([undefined, undefined, undefined])
    save.mockRestore()
    w.unmount()
  })

  // 破坏验证:saveAnaSettings 去掉 finally 里的退回 → 红
  it('❗松手存不上:系数退回库里原来的数,说清原因', async () => {
    useAuthStore().permissions = ['analysis:view', 'report:edit']
    const save = vi.spyOn(analysisApi, 'saveSettings').mockRejectedValueOnce({ code: 403, message: '无操作权限' })
    const fail = vi.spyOn(receipt, 'fail')
    const w = mount(BreakevenView, STUBS)
    await flushPromises()
    usePeriod().setYear(2026)
    await flushPromises()
    const input = w.find('.bev-slider input[type="range"]')
    ;(input.element as HTMLInputElement).value = '0.3'
    await input.trigger('input')
    expect(anaSettings.breakevenFixedRatio, '拖的时候本屏即时重算').toBe(0.3)
    await input.trigger('change')
    await flushPromises()
    expect(anaSettings.breakevenFixedRatio).toBe(0.62)
    expect(fail).toHaveBeenCalledWith('无操作权限')
    save.mockRestore()
    fail.mockRestore()
    w.unmount()
  })

  // 系数全园区一份,只有账簿报表编辑权能改(同顶栏「目标与阈值」弹层)。用户 2026-10-05「两个都按你建议」:
  // 没有编辑权的人也能拖着看效果 —— 本屏即时重算,不发 PUT、不动全园那一份,重新进这一屏回到全园的数。
  // 破坏验证:滑杆加回 :disabled → 红;onFr 去掉看效果分支(写进 anaSettings)→ 红;onFrDone 去掉早退 → 红;
  // 去掉那一行说明 → 红;骨架去掉同一行 → 红
  // 屏上不说「试算」:三大报表里「试算平衡」是记账用语,用户看不懂(对抗复查 UI-F6),改说「看看效果」。
  // 权限名字典取不到时,拖一格重画一次不许跟着再取一次(对抗复查 UI-F5;破坏验证:那一行改回模板里直接调 lackText → 红)
  it('❗没有账簿报表编辑权:能拖着看效果,本屏重算、不存,重进回到全园的数', async () => {
    useAuthStore().permissions = ['analysis:view']
    const save = vi.spyOn(analysisApi, 'saveSettings').mockImplementation(async (p) => p)
    const get = vi.spyOn(http, 'get').mockRejectedValue(new Error('offline'))
    const permGets = () => get.mock.calls.filter(([u]) => u === '/auth/perms').length
    const w = mount(BreakevenView, STUBS)
    expect(w.find('.ana-skel .bev-try').exists(), '骨架少了「只是看看效果」那一行,数据到了会往下推').toBe(true)
    await flushPromises()
    usePeriod().setYear(2026)
    await flushPromises()
    const input = w.find('.bev-slider input[type="range"]')
    expect(input.attributes('disabled'), '滑杆还是置灰').toBeUndefined()
    expect(w.find('.bev-try').text()).toMatch(/^拖动只是看看效果，不会保存；要改全园共用的数需要「.+」权限$/)
    expect(w.find('.bev-slider').text()).toContain('(拖动即时重算保本点)')
    const before = permGets()
    for (const v of ['0.5', '0.4', '0.3']) {
      ;(input.element as HTMLInputElement).value = v
      await input.trigger('input')
      await flushPromises()
    }
    expect(permGets(), '拖一格就去取一次权限名').toBe(before)
    expect(w.find('.bev-slider .v').text(), '拖了本屏没重算').toBe('0.30')
    expect(anaSettings.breakevenFixedRatio, '看效果的数漏进了全园那一份').toBe(0.62)
    await input.trigger('change')
    await flushPromises()
    expect(save, '看效果也往库里存了').not.toHaveBeenCalled()
    get.mockRestore()
    w.unmount()

    const w2 = mount(BreakevenView, STUBS)
    await flushPromises()
    expect(w2.find('.bev-slider .v').text(), '重进这一屏还是看效果的数').toBe('0.62')
    expect((w2.find('.bev-slider input[type="range"]').element as HTMLInputElement).value).toBe('0.62')
    save.mockRestore()
    w2.unmount()
  })

  // 「两个都按你建议」(2026-10-05):看效果的数只在这一屏,离开就回到全园的数 —— 页签切走再切回是同一个实例(KeepAlive),也算离开
  // (对抗复查 UI-F4)。破坏验证:onReactivated 里去掉 tryFr 清空 → 红
  it('❗没有编辑权:看效果的数切走页签再切回,回到全园的数', async () => {
    useAuthStore().permissions = ['analysis:view']
    const alive = ref(true)
    const w = mount(defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(BreakevenView) : null) }),
    }), STUBS)
    await flushPromises()
    usePeriod().setYear(2026)
    await flushPromises()
    const input = w.find('.bev-slider input[type="range"]')
    ;(input.element as HTMLInputElement).value = '0.3'
    await input.trigger('input')
    await flushPromises()
    expect(w.find('.bev-slider .v').text()).toBe('0.30')
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(w.find('.bev-slider .v').text(), '切回来还停在看效果的数').toBe('0.62')
    w.unmount()
  })

  // 主管授权借得到账簿报表(不在不可借名单),这一屏开着时编辑权会来会走(对抗复查 UI-F1):
  // 借到了,看效果的数作废、屏上回到全园的数,再拖就是改全园那一份;拖到一半到期,这一下按第一格时定,松手照样去存,
  // 后端拒了 saveAnaSettings 退回库里的数 —— 全园那一份里不留一个没存上的数。
  // 破坏验证:去掉 frLock 那条 watch → 「还停着看效果的数」红;onFr / onFrDone 改回每次现看 frLock → 「到期了松手没去存」红
  it('❗这一屏开着时借到 / 到期编辑权:看效果的数不冒充全园的数;拖到一半到期,松手照样去存、存不上退回', async () => {
    const auth = useAuthStore()
    auth.permissions = ['analysis:view']
    const save = vi.spyOn(analysisApi, 'saveSettings').mockImplementation(async (p) => p)
    const fail = vi.spyOn(receipt, 'fail')
    const w = mount(BreakevenView, STUBS)
    await flushPromises()
    usePeriod().setYear(2026)
    await flushPromises()
    const input = w.find('.bev-slider input[type="range"]')
    const drag = async (v: string) => {
      ;(input.element as HTMLInputElement).value = v
      await input.trigger('input')
      await flushPromises()
    }
    const done = async () => { await input.trigger('change'); await flushPromises() }
    await drag('0.3')
    await done()
    expect(w.find('.bev-slider .v').text()).toBe('0.30')

    auth.permissions = ['analysis:view', 'report:edit']   // 借到了
    await flushPromises()
    expect(w.find('.bev-try').exists()).toBe(false)
    expect(w.find('.bev-slider .v').text(), '没了「只是看看效果」那一行,屏上还停着看效果的数').toBe('0.62')
    await drag('0.5')
    expect(w.find('.bev-slider .v').text(), '有了编辑权再拖,屏上不跟').toBe('0.50')
    await done()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenLastCalledWith({ breakevenFixedRatio: 0.5 })

    save.mockRejectedValueOnce({ code: 403, message: '无操作权限' })
    await drag('0.4')
    auth.permissions = ['analysis:view']   // 拖到一半到期
    await flushPromises()
    await drag('0.35')
    await done()
    expect(save, '到期了松手没去存,没存上的数留在全园那一份里').toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith({ breakevenFixedRatio: 0.35 })
    expect(anaSettings.breakevenFixedRatio, '存不上没退回库里的数').toBe(0.5)
    expect(fail).toHaveBeenCalledWith('无操作权限')
    save.mockRestore()
    fail.mockRestore()
    w.unmount()
  })

  // 画布 06-D 中格:整页回退贴期间选择旁,只有某张图回退的贴那张图的卡头,都不用满宽横条
  it('❗所选月无损益 → 期间旁「显示 2026-03 · 2 月无数据」;口径月无附表10 → 龙卷风卡头「显示 2025-12」', async () => {
    vi.mocked(fetchPnlSummary).mockImplementation(async (y: number) => {
      const s = summaryOf(y)
      return y === 2026 ? { ...s, months: [1, 3] } : s
    })
    const S10: AnalysisS10Row[] = [1, 2].map((i) => ({
      acctMonth: '2025-12', phase: i, tenantId: i, tenantName: '租户' + i, elec: 3000 * i, water: 400 * i, total: 3600 * i,
    }))
    vi.mocked(fetchS10Rows).mockResolvedValueOnce(S10)
    const w = mount(BreakevenView, STUBS)
    await flushPromises()
    const p = usePeriod()
    p.setYear(2026); p.setMonth(2)
    await flushPromises()
    // 口径月退到最近一个收入为正的覆盖月(breakeven.logic anchorMonth)= 3 月
    expect(w.find('.ak-sub').text()).toContain('口径月 2026-03')
    expect(w.findAll('.anx-period .fp-state').map((e) => e.text())).toEqual(['显示 2026-03 · 2 月无数据'])
    const tor = w.findAll('.av2-card-h').find((h) => h.find('.t').text().startsWith('哪个因素对利润影响最大'))!
    expect(tor.find('.t .fp-state').text(), '附表10 回退没贴在龙卷风卡头').toBe('显示 2025-12')
    expect(w.findAll('.av2-grid .fp-state'), '回退标签贴到别的卡上了').toHaveLength(1)
    // 换到有损益的 3 月:整页标签撤;附表10 仍只到 2025-12,卡头标签留着(两处各管各的)
    p.setMonth(3)
    await flushPromises()
    expect(w.find('.anx-period .fp-state').exists()).toBe(false)
    expect(tor.find('.t .fp-state').text()).toBe('显示 2025-12')
    w.unmount()
  })
})

// ── 光伏投资回收 ─────────────────────────────────────────────────────
const PHASES: PvPhaseDTO[] = [{ id: 'p1', name: '一期', short: '一期', online: '2024-01', cost: 14_786_883.99 }]
const rec = (i: number, fee: number): PvRecordDTO => ({
  id: i, phase: 'p1', phaseName: '一期', acctMonth: `2025-0${i}`, occurMonth: `2025-0${i}`,
  selfKwh: 1000, selfAmt: fee * 0.6, gridKwh: 500, gridAmt: fee * 0.4, gen: 1500, fee, note: null, source: 'manual',
})
const RECORDS = [rec(1, 800000), rec(2, 900000), rec(3, 1000000)]

describe('光伏投资回收', () => {
  const rectOrig = Element.prototype.getBoundingClientRect
  const inView = () => {
    Element.prototype.getBoundingClientRect = () =>
      ({ top: 100, bottom: 108, left: 0, right: 300, width: 300, height: 8, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect
  }
  let frames: FrameRequestCallback[] = []
  beforeEach(() => {
    vi.mocked(fetchPvPhases).mockResolvedValue(PHASES)
    vi.mocked(fetchPvAll).mockImplementation(async () => { await pass(); return RECORDS })
    frames = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
  })
  afterEach(() => { Element.prototype.getBoundingClientRect = rectOrig })

  it('❗S 档骨架:s8 两块顶替 AnaEChart 降 300→260;明细表块 210 不降(回收卡的行照抄真版式)', () => {
    open()
    asS()
    const w = mount(PvRoiView, STUBS)
    // 2026-09-20 P2:爬坡图按稿 260 → 220(S 档下发 250,再经 anaChartHeight 降档)。
    // 这屏**不折叠** —— 稿的改后清单里没有「折叠」二字,全屏只有 2 张图,够不上
    // 「一屏最多 4 张图常显」的门槛(曾经多做了一版折叠,已撤)。
    expect(shims(w, '.ana-skel')).toEqual(['220px', '260px', '210px'])
    w.unmount()
  })

  it('❗进度条:视口内首挂擦入(条在骨架之后才挂),animationend 摘;切回页签重播,animationcancel 摘', async () => {
    inView()
    const on = ref(true)
    const w = mount(defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (on.value ? h(PvRoiView as Component) : h('i')) }),
    }), { ...STUBS, attachTo: document.body })
    await flushPromises()
    const bar = w.find('.roi2-bar')
    expect(bar.exists()).toBe(true)
    expect(bar.classes(), '视口内首挂没擦入').toContain('first')
    bar.element.dispatchEvent(new Event('animationend'))
    await nextTick()
    expect(bar.classes(), 'animationend 没摘').not.toContain('first')

    on.value = false; await nextTick()
    on.value = true; await nextTick()
    frames.splice(0).forEach((cb) => cb(0)); await nextTick()
    expect(w.find('.roi2-bar').element, '切回页签条被重挂了').toBe(bar.element)
    expect(bar.classes(), '切回页签没重播').toContain('first')
    bar.element.dispatchEvent(new Event('animationcancel'))
    await nextTick()
    expect(bar.classes(), 'animationcancel 没摘').not.toContain('first')
    w.unmount()
  })

  it('❗改投资额:图与进度条不重挂,--pct 原地变(clip-path 过渡 200)', async () => {
    // 投资额从库里来(2026-10-05 起全员一份):屏上用的是库里那个数,不是默认的「按各期成本」
    vi.spyOn(analysisApi, 'settings').mockResolvedValueOnce({ pvInvestment: 1000 })
    await loadAnaSettings()
    const w = mount(PvRoiView, STUBS)
    await flushPromises()
    expect(w.find('.ana-skel').exists(), '数据到了还是骨架').toBe(false)
    const before = charts(w)
    expect(before.length, '爬坡 / 分期两张图').toBe(2)
    const fill = w.find('.roi2-bar-fill').element as HTMLElement
    // 累计 270 万 ÷ 投资 1000 万
    expect(fill.style.getPropertyValue('--pct')).toBe('27.0%')

    anaSettings.pvInvestment = 500
    await flushPromises()
    expect(w.find('.roi2-bar-fill').element, '进度条被重挂了').toBe(fill)
    expect(fill.style.getPropertyValue('--pct')).toBe('54.0%')
    charts(w).forEach((el, i) => expect(el, `第 ${i} 张图被卸载重挂了`).toBe(before[i]))
    w.unmount()
  })

  // 2026-10-04 用户拍板产品卖给别的园区:投资额不再写死我园 1478.7 万 —— 没填取各期工程成本合计,两样都没有出空态
  it('❗投资额没填:取各期工程成本合计;各期也没有成本就出空态,不按 0 算回收', async () => {
    const kpi = (w: ReturnType<typeof mount>, label: string) =>
      w.findAll('.av2-kpi').find((k) => k.find('.l').text() === label)!.find('.v').text()
    vi.mocked(fetchPvPhases).mockResolvedValue([{ ...PHASES[0], cost: 10_000_000 }])
    let w = mount(PvRoiView, STUBS)
    await flushPromises()
    // 累计 270 万 ÷ 各期成本合计 1000 万
    expect((w.find('.roi2-bar-fill').element as HTMLElement).style.getPropertyValue('--pct')).toBe('27.0%')
    expect(kpi(w, '工程总投资')).toBe('¥1,000.0 万')
    expect(kpi(w, '综合回收进度')).toBe('27.0%')
    w.unmount()
    vi.mocked(fetchPvPhases).mockResolvedValue([{ ...PHASES[0], cost: null }])
    w = mount(PvRoiView, STUBS)
    await flushPromises()
    expect(w.find('.roi2-bar').exists(), '没有投资额还画了回收进度').toBe(false)
    expect(w.text()).toContain('光伏投资额未填')
    w.unmount()
    // 新园区起点库的占位期别:成本列 NOT NULL,落的是列默认 0(2026-10-05 用户拍板「按你建议修改」)—— 也按「未填」出空态,不出 NaN
    vi.mocked(fetchPvPhases).mockResolvedValue([{ ...PHASES[0], cost: 0 }, { ...PHASES[0], id: 'p2', cost: 0 }])
    w = mount(PvRoiView, STUBS)
    await flushPromises()
    expect(w.find('.roi2-bar').exists(), '成本 0 还画了回收进度').toBe(false)
    expect(w.text()).toContain('光伏投资额未填')
    expect(w.text()).not.toContain('NaN')
    // KPI 行也不给确定的 ¥0 / 0%:那个 0 是没填
    expect(kpi(w, '工程总投资')).toBe('—')
    expect(kpi(w, '综合回收进度')).toBe('—')
    w.unmount()
  })

  // 2026-10-05 复查:新园区起点库带三个占位期别(一期~三期),只录了一期的客户原来读到「3 期」;
  // 我园三期都有记账,仍是 3。破坏验证:脚注改回 rows.length → 第一段读到 3,红
  it('❗分期卡脚注只数有记账月的期', async () => {
    const foot = (w: ReturnType<typeof mount>) => w.findAll('.ana-ref').find((e) => e.text().includes('柱=自消纳+上网'))!.text()
    const three = [PHASES[0], { ...PHASES[0], id: 'p2', name: '二期', short: '二期' }, { ...PHASES[0], id: 'p3', name: '三期', short: '三期' }]
    vi.mocked(fetchPvPhases).mockResolvedValue(three)
    let w = mount(PvRoiView, STUBS)
    await flushPromises()
    expect(foot(w), '只有一期有记账').toBe('1 期有记账 · 柱=自消纳+上网 · 万元')
    w.unmount()
    vi.mocked(fetchPvAll).mockResolvedValue([...RECORDS, { ...rec(4, 1), phase: 'p2' }, { ...rec(5, 1), phase: 'p3' }])
    w = mount(PvRoiView, STUBS)
    await flushPromises()
    expect(foot(w), '我园三期都有记账').toBe('3 期有记账 · 柱=自消纳+上网 · 万元')
    w.unmount()
  })
})
