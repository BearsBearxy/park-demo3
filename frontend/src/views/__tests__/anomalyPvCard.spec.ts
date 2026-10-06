// 异常提醒中心底部「光伏触发规则的楼栋」卡(2026-10 改稿 pv-v2-anomaly)挂载测:
// 取数走 anaData.fetchPvRuleInput 的整条映射(pvMeterApi / paramsApi 打桩),检测走 pvRules.logic 真算;
// 钉住:卡头 / 读数句 / 规则行逐字、看全部展开收起、处置三态按规则 id 记、查看分析落到光伏屏那一栋那个月、
// 工具条末尾「光伏抄表到」、光伏取数失败只这张卡失败(重试能回来)、库里没读数照说、首进骨架有这张卡的位。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { grantViews } from '@/test-utils/perms'
import { PV_READING_DTOS, PV_ROWS, PV_STATION_DTOS } from '@/views/analysis/__fixtures__/pvRules.fixture'

const R = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: R.push, replace: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))
vi.mock('@/components/ana/AnaEChart.vue', () => ({
  default: { name: 'AnaEChart', props: ['option', 'height', 'entrance'], template: '<div class="stub-chart" />' },
}))
const MONTHS = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-06']
vi.mock('@/analysis/anaData', async (orig) => ({
  ...(await orig<typeof import('@/analysis/anaData')>()),
  fetchAvailableMonths: vi.fn(async () => ({ months: MONTHS, sources: { pnl: MONTHS } })),
  fetchAnomalyInputs: vi.fn(),
}))
vi.mock('@/api/pvMeter', () => ({
  pvMeterApi: { months: vi.fn(), stations: vi.fn(), readingsYear: vi.fn() },
}))
vi.mock('@/api/params', () => ({ paramsApi: { list: vi.fn() } }))

import AnomalyView from '@/views/analysis/AnomalyView.vue'
import * as ana from '@/analysis/anaData'
import { pvMeterApi } from '@/api/pvMeter'
import { paramsApi } from '@/api/params'
import { useTabsStore } from '@/stores/tabs'
import { __resetPeriodForTest, usePeriod } from '@/analysis/usePeriod'

const m = vi.mocked
const INPUTS = {
  ledger: [{ companyId: 1, companyName: '甲', year: 2025, month: 4, tenantId: 1, tenantName: '租户A',
    balancePrev: 0, receivable: 100, collected: 50, balanceEnd: 50 }],
  s10: [3, 4].map((mo) => ({ acctMonth: `2025-0${mo}`, phase: 1, tenantId: 1, tenantName: '租户A', elec: 100 * mo, water: 10, total: 100 * mo + 10 })),
  energy: [{ name: '园区购电电量', unit: ' kWh', series: { '2025-04': 1000 } }],
}
const PV_YMS = ['2025-01', '2025-02', '2025-03', '2025-04']
const TITLE = '光伏触发规则的楼栋'

let w: VueWrapper | null = null
beforeEach(() => {
  setActivePinia(createPinia())
  grantViews()   // RBAC v3(master 0.28.0):没有光伏屏的查看权时「查看分析」置灰,这里给全部业务查看权
  vi.clearAllMocks()
  localStorage.clear()
  __resetPeriodForTest()
  ana.__clearAnaCacheForTest()
  m(ana.fetchAnomalyInputs).mockResolvedValue(INPUTS as never)
  m(pvMeterApi.months).mockResolvedValue(PV_YMS)
  m(pvMeterApi.stations).mockResolvedValue(PV_STATION_DTOS)
  m(pvMeterApi.readingsYear).mockImplementation(async (y: number) => (y === 2025 ? PV_READING_DTOS : []))
  m(paramsApi.list).mockResolvedValue([])
})
afterEach(() => { w?.unmount(); w = null })

const mountIt = () => (w = mount(AnomalyView, { global: { stubs: { RouterLink: true, teleport: true } } }))
const card = (v: VueWrapper) => v.findAll('.av2-card').find((c) => c.find('.av2-card-h .t').exists() && c.find('.av2-card-h .t').text() === TITLE)
/** 检测逐月让出主线程:多排几轮宏任务,直到卡里没有留位灰块 */
async function untilPv(v: VueWrapper) {
  for (let i = 0; i < 40; i++) {
    await flushPromises()
    const c = card(v)
    if (c && !v.find('.ak-skel').exists() && !c.find('.fp-shim').exists()) return c
    await new Promise((r) => setTimeout(r, 0))
  }
  throw new Error('光伏卡一直没出来')
}
const rowTexts = (c: ReturnType<typeof card>) => c!.findAll('.mn-rule').map((r) => [r.find('.tt').element.firstChild!.textContent, r.find('.mn-vv').text(), r.find('.dt').text()])

// 小楼 4 月:合计 ÷ 2 kWp ÷ 29 天(4月5日漏抄),独立于 logic 再算一遍
const xiao = PV_ROWS.filter((r) => r.stationId === 9 && r.date.startsWith('2025-04'))
const xiaoPerDay = (xiao.reduce((t, r) => t + r.gen, 0) / 2 / xiao.length).toFixed(1)

describe('异常提醒中心 · 光伏触发规则的楼栋', () => {
  it('❗卡头、读数句、规则行逐字(每栋最近一条,月从近到远);工具条末尾接「光伏抄表到」', async () => {
    const c = await untilPv(mountIt())
    expect(c.find('.av2-card-h .hint').text()).toBe('3 栋楼 · 2025年1–4月 · 4 条')
    expect(c.find('.ana-read').text()).toBe('4月 2 栋楼触发规则，共 2 条')
    const rows = rowTexts(c)
    expect(rows.map((r) => [r[0], r[2]])).toEqual([
      ['小楼 4月每千瓦日均超 24 kWh', `${xiao.length} 天里 ${xiao.length} 天超过 24 kWh · 台账装机 2.0 kWp`],
      ['S4 4月连着 3 天以上偏离平时', '4月20–23日连着低于平时范围'],
      ['S3 3月连着 3 天以上偏离平时', '3月10–14日连着高于平时范围'],
    ])
    expect(rows[0][1]).toBe(`4月每千瓦日均 ${xiaoPerDay} kWh`)
    expect(rows[1][1]).toMatch(/^4月偏离平时 \d+ 天$/)
    expect(w!.find('.anx-asof-text').text()).toBe('台账到 2025年4月 · 销售收入表到 2025年4月 · 电量到 2025年4月 · 光伏抄表到 2025年4月')
    // 判据参数和光伏屏同一份:站在这一年 12 月取
    expect(m(paramsApi.list).mock.calls[0].slice(0, 2)).toEqual(['2025-12', 'all'])
  })

  it('❗看全部 4 条 → 出全部(S3 1月那条也在),收起回到 3 行', async () => {
    const c = await untilPv(mountIt())
    const all = c.find('.mn-all')
    expect(all.text()).toBe('看全部 4 条 →')
    await all.trigger('click')
    expect(rowTexts(card(w!)).map((r) => r[0])).toEqual([
      '小楼 4月每千瓦日均超 24 kWh', 'S4 4月连着 3 天以上偏离平时', 'S3 3月连着 3 天以上偏离平时', 'S3 1月连着 3 天以上偏离平时',
    ])
    expect(rowTexts(card(w!))[3][2]).toBe('1月5–8日连着高于平时范围')
    await card(w!)!.find('.mn-all').trigger('click')
    expect(card(w!)!.findAll('.mn-rule')).toHaveLength(3)
  })

  it('❗处置三态按规则 id 记在 fp-ana-anom(楼栋 id + 年月,换会话不丢)', async () => {
    const c = await untilPv(mountIt())
    const seg = c.findAll('.mn-rule')[0].findAll('.mn-st-seg button')
    await seg[1].trigger('click')
    expect(JSON.parse(localStorage.getItem('fp-ana-anom')!)).toEqual({ 'pv-over:9:2025-04': 'doing' })
    expect(card(w!)!.findAll('.mn-rule')[0].find('.mn-st-seg button.on').text()).toBe('处理中')
  })

  it('❗查看分析 → 光伏分栋分析停到这条的那个月(期间单例)、开这栋(#st=)、全新实例', async () => {
    const tabs = useTabsStore()
    const deep = vi.spyOn(tabs, 'openDeep')
    const c = await untilPv(mountIt())
    expect(usePeriod().sel.value).toMatchObject({ gran: 'month', year: 2025, month: 6 })   // 默认落在最新月
    await c.findAll('.mn-rule')[1].find('.mn-link').trigger('click')
    expect(usePeriod().sel.value).toEqual({ gran: 'month', year: 2025, month: 4 })
    expect(deep).toHaveBeenCalledWith('pv-meter-analysis')
    expect(R.push).toHaveBeenCalledWith({ path: '/pv-meter-analysis', hash: '#st=4' })
  })

  it('❗光伏没读到:只这张卡换成失败(租户清单照出),点重试回来', async () => {
    m(pvMeterApi.readingsYear).mockRejectedValueOnce(new Error('boom'))
    const v = mountIt()
    let c = await untilPv(v)
    expect(v.find('.mn-row').exists(), '整屏被拖垮了').toBe(true)
    expect(c.text()).toContain('光伏抄表没读到')
    expect(c.findAll('.mn-rule')).toHaveLength(0)
    expect(v.find('.anx-asof-text').text()).not.toContain('光伏')
    await c.findAll('button').find((b) => b.text() === '重试')!.trigger('click')
    c = await untilPv(v)
    expect(c.findAll('.mn-rule')).toHaveLength(3)
    expect(v.find('.anx-asof-text').text()).toContain('光伏抄表到 2025年4月')
  })

  it('库里一条分栋读数都没有:卡上照说,工具条不写光伏', async () => {
    m(pvMeterApi.months).mockResolvedValue([])
    const v = mountIt()
    const c = await untilPv(v)
    expect(c.text()).toContain('光伏分栋抄表里还没有读数')
    expect(v.find('.anx-asof-text').text()).not.toContain('光伏')
    expect(m(pvMeterApi.readingsYear)).not.toHaveBeenCalled()
  })

  it('首进骨架里有这张卡的位(标题照抄、规则块 264)', async () => {
    m(ana.fetchAnomalyInputs).mockImplementation(() => new Promise(() => {}))
    const v = mountIt()
    await flushPromises()
    const skel = v.find('.ak-skel')
    const c = skel.findAll('.av2-card').find((x) => x.find('.t').text() === TITLE)!
    expect(c.find('.fp-shim').attributes('style')).toContain('height: 264px')
  })

  it('光伏规则不进规则引擎(铃铛、驾驶舱「本月触发的规则」都读 buildAnomalies)', async () => {
    await untilPv(mountIt())
    expect(ana.buildAnomalies(INPUTS as never, { collectTarget: 96, spikeTh: 40 }).some((a) => /光伏|pv-/.test(a.id + a.title))).toBe(false)
  })
})
