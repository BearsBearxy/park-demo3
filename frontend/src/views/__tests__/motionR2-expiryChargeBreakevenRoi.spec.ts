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
import Select from '@/components/ds/Select.vue'
import { fetchContracts, fetchPnlSummary, fetchPvAll, fetchPvPhases } from '@/analysis/anaData'
import { cpMeterApi } from '@/api/cpMeter'
import { usePeriod } from '@/analysis/usePeriod'
import { anaSettings, saveAnaSettings } from '@/analysis/anaSettings'

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
    // 页头 20 + 20 · (卡头 20 + 到期墙 AnaSkelChart) · (卡头 20 + 租金带 280 + 读数句 20 + 参照小字 20)
    expect(shims(w, '.ana-skel')).toEqual(['20px', '20px', '20px', '220px', '20px', '280px', '20px', '20px'])
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
    // 页头 20 + 20 · 结论条 20 · (卡头 20 + 图) × 4
    expect(shims(w, '.ana-skel')).toEqual(['20px', '20px', '20px', '20px', '260px', '20px', '220px', '20px', '220px', '20px', '220px'])
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
    w.findComponent(Select).vm.$emit('update:modelValue', '2025')
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
    w.findComponent(Select).vm.$emit('update:modelValue', '2025')
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
    // 页头 20 + 20 · 结论条 20 · (卡头 20 + 图 + 滑杆 20) · (20 + 图) · (20 + 图)
    expect(shims(w, '.ana-skel')).toEqual(['20px', '20px', '20px', '20px', '260px', '20px', '20px', '260px', '20px', '220px'])
    w.unmount()
  })

  it('❗换年:图与 KPI 不卸载;口径月与横幅停在旧期,200ms 后退让,数据到了原地换新', async () => {
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
    // 旧年数据还在屏上:口径月不许被新年的选择拽到旧年的另一个月,也不许冒出「选 2025-06 用 2026-02」的横幅
    expect(w.find('.ak-sub').text(), '旧图跳到了另一个口径月').toContain('口径月 2026-02')
    expect(w.find('.ana-pbanner').exists(), '新年的选择配旧年的口径月,冒出了横幅').toBe(false)
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

    p.setMonth(3)
    await flushPromises()
    expect(w.find('.ak-sub').text()).toContain('口径月 2026-03')
    expect(upd(), '换月被当成拖滑杆,瞬跳').toEqual([undefined, undefined, undefined])
    saveAnaSettings({ breakevenFixedRatio: fr })
    w.unmount()
  })
})

// ── 光伏投资回收 ─────────────────────────────────────────────────────
const PHASES: PvPhaseDTO[] = [{ id: 'p1', name: '一期', short: '一期', online: '2024-01' }]
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

  it('❗S 档骨架:s8 两块顶替 AnaEChart 降 300→260;s4 两块顶替进度卡 / 明细表,300 不降', () => {
    open()
    asS()
    const w = mount(PvRoiView, STUBS)
    expect(shims(w, '.ana-skel')).toEqual(['20px', '260px', '20px', '300px', '20px', '260px', '20px', '300px'])
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
    const invest = anaSettings.pvInvestment
    saveAnaSettings({ pvInvestment: 1000 })
    const w = mount(PvRoiView, STUBS)
    await flushPromises()
    expect(w.find('.ana-skel').exists(), '数据到了还是骨架').toBe(false)
    const before = charts(w)
    expect(before.length, '爬坡 / 分期两张图').toBe(2)
    const fill = w.find('.roi2-bar-fill').element as HTMLElement
    // 累计 270 万 ÷ 投资 1000 万
    expect(fill.style.getPropertyValue('--pct')).toBe('27.0%')

    saveAnaSettings({ pvInvestment: 500 })
    await flushPromises()
    expect(w.find('.roi2-bar-fill').element, '进度条被重挂了').toBe(fill)
    expect(fill.style.getPropertyValue('--pct')).toBe('54.0%')
    charts(w).forEach((el, i) => expect(el, `第 ${i} 张图被卸载重挂了`).toBe(before[i]))
    saveAnaSettings({ pvInvestment: invest })
    w.unmount()
  })
})
