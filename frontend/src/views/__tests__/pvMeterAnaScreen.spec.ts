import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

import PvMeterAnaView from '@/views/analysis/PvMeterAnaView.vue'
import { pvMeterApi, type PvReadingDTO, type PvStationDTO } from '@/api/pvMeter'
import { paramsApi } from '@/api/params'
import { providePeriodMonths, usePeriod } from '@/analysis/usePeriod'
import { __resetCompareForTest } from '@/analysis/useCompare'

/**
 * 光伏分栋分析的渲染证明(PV-ANALYSIS-SPEC §06)。
 *
 * logic 层的 spec 管算得对不对。这里管**屏上真的长出来了没有**,以及三条只有渲染后才成立的:
 *   ① 期间切「按月 / 按年」时刻度真的换了 —— 月段画当月那三十来个点,不是全年逐日。
 *   ② **文案规范**(§05)钉在渲染出来的 DOM 上:只说明可视化在做什么,
 *      不出现判词、建议动作、反事实金额,也不出现 p / q。
 *   ③ 整年无抄表 → 空态深链,不画假图。
 */

vi.mock('@/api/pvMeter', () => ({
  pvMeterApi: {
    stations: vi.fn(), readings: vi.fn(), readingsYear: vi.fn(),
    months: vi.fn(), years: vi.fn(), simulate: vi.fn(),
  },
}))
vi.mock('@/api/params', () => ({ paramsApi: { list: vi.fn() } }))
const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), RouterLink: { template: '<a><slot /></a>' } }))
vi.mock('@/analysis/anaData', () => ({
  fetchAvailableMonths: vi.fn(async () => ({ months: ['2026-07', '2026-08'], sources: { pnl: ['2026-07', '2026-08'] } })),
  invalidateAnaCache: vi.fn(),
}))
vi.mock('@/components/ana/AnaEChart.vue', () => ({
  default: { name: 'AnaEChart', props: ['option', 'height'], template: '<div class="stub-chart" />' },
}))

const pad = (n: number) => String(n).padStart(2, '0')
const N = 9

/** 整年 9 栋;S4 从 7/19 起掉 35%(断崖);S3 台账是理论的 2 倍 */
function fixture() {
  const stations: PvStationDTO[] = Array.from({ length: N }, (_, i) => ({
    id: i + 1, name: `S${i + 1}`, phase: i < 5 ? 1 : 2, metered: 1,
    capacityKwp: 100, panelCount: i === 2 ? 100 : 200, panelWatt: 500,
    priceYuan: 0.86, sortNo: i,
  }))
  const readings: PvReadingDTO[] = []
  for (let m = 1; m <= 12; m++) {
    const dim = new Date(2026, m, 0).getDate()
    for (let d = 1; d <= dim; d++) {
      const date = `2026-${pad(m)}-${pad(d)}`
      for (let i = 0; i < N; i++) {
        const bad = i === 3 && (m > 7 || (m === 7 && d > 18))
        const gen = 400 * (1 + (d % 5) * 0.1) * (bad ? 0.65 : 1)
        readings.push({
          id: readings.length + 1, stationId: i + 1, stationName: `S${i + 1}`, readDate: date,
          genTotal: gen, selfUse: gen * 0.7, gridFeed: gen * 0.3,
          priceSnap: 0.86, revenue: gen * 0.7 * 0.86, note: null, source: 'simulated',
        })
      }
    }
  }
  return { stations, readings }
}

async function mountScreen(over: Partial<ReturnType<typeof fixture>> = {}, gran: 'month' | 'year' = 'month') {
  const f = { ...fixture(), ...over }
  vi.mocked(pvMeterApi.stations).mockResolvedValue(f.stations)
  vi.mocked(pvMeterApi.readingsYear).mockImplementation(async (y: number) => (y === 2026 ? f.readings : []))
  vi.mocked(paramsApi.list).mockResolvedValue([])          // 取不到参数 → 回落默认线
  const w = mount(PvMeterAnaView, { global: { stubs: { RouterLink: true, teleport: true } } })
  await flushPromises()
  providePeriodMonths(['2026-07', '2026-08'], ['2026-08'])
  usePeriod().setYear(2026)
  // **每条测试都显式设一次粒度。** usePeriod 是模块级单例,sel 不随 pinia 重建而复位 ——
  // 上一条测试切到「按年」之后,后面所有测试都会在年段跑,而且报的是别的断言在红。
  usePeriod().setGran(gran)
  await flushPromises()
  return w
}

const boot = () => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  __resetCompareForTest()
  location.hash = ''
}

describe('光伏分栋分析 · 两档缩放', () => {
  beforeEach(boot)

  it('月段:看板每栋一行,x 是当月那三十来天 —— 不是全年逐日', async () => {
    const w = await mountScreen()
    expect(w.findAll('.pma-brow')).toHaveLength(N)
    const t = w.text()
    expect(t).toContain('逐日看板')
    expect(t).toContain('2026 年 8 月')
  })

  it('年段:标题与说明换成逐月', async () => {
    const t = (await mountScreen({}, 'year')).text()
    expect(t).toContain('逐月看板')
    expect(t).toContain('2026 年 ·')
  })

  it('横幅写明「模型吃整年，画的是这一段」—— 别让人以为切月就只用一个月的数据', async () => {
    const t = (await mountScreen()).find('.pma-banner').text()
    expect(t).toContain('模型吃整年，画的是这一段')
    expect(t).toMatch(/抄表 \d+ 条/)
  })

  it('每行画出正常范围带与中心线,出范围的点单独标出来', async () => {
    const w = await mountScreen()
    expect(w.findAll('.pma-brow .band').length).toBeGreaterThan(0)
    expect(w.findAll('.pma-brow .ctr').length).toBeGreaterThan(0)
    expect(w.findAll('.pma-brow circle.lo').length).toBeGreaterThan(0)
  })

  it('六张 ECharts 图都渲染了(A1/T1/R1/R2/R3/R4)', async () => {
    expect((await mountScreen()).findAll('.stub-chart').length).toBeGreaterThanOrEqual(6)
  })

  it('M3 每栋一格,并写明它始终按月、与期间无关', async () => {
    const w = await mountScreen()
    expect(w.findAll('.pma-mini')).toHaveLength(N)
    expect(w.text()).toContain('始终按月')
  })
})

describe('光伏分栋分析 · F1 这一段发生了什么', () => {
  beforeEach(boot)

  it('种入的断崖被说成「连续 N 天在正常范围下方」', async () => {
    const w = await mountScreen()
    const row = w.findAll('.pma-facts li').find(r => r.find('.st').text() === 'S4')
    expect(row, '断崖那栋没出现在清单里').toBeTruthy()
    expect(row!.text()).toMatch(/起连续 \d+ 天在正常范围下方/)
  })

  it('台账差把两个数都写出来,可复算', async () => {
    const w = await mountScreen()
    const row = w.findAll('.pma-facts li').find(r => r.find('.st').text() === 'S3' && r.text().includes('kWp'))
    expect(row, 'S3 的台账差没出现').toBeTruthy()
    expect(row!.text()).toContain('100.0')
    expect(row!.text()).toContain('50.0')
  })

  it('清单按楼栋顺序排,不按严重度', async () => {
    const w = await mountScreen()
    const ids = w.findAll('.pma-facts li').map(r => Number(r.find('.st').text().slice(1)))
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
  })

  it('底部固定写着「未列出 ≠ 没问题」并列出当前几条线', async () => {
    const t = (await mountScreen()).text()
    expect(t).toContain('未列出 ≠ 没问题')
    expect(t).toContain('正常范围半宽 2 倍稳健波动')
    expect(t).toContain('台账差 ±3%')
    expect(t).toContain('锚点 950')
  })
})

describe('光伏分栋分析 · 文案规范(§05)', () => {
  beforeEach(boot)

  // 屏只说明可视化在做什么。判词、建议动作、反事实金额、p/q 一个都不许露 ——
  // 钉在渲染后的 DOM 上:文案是在模板里拼的,logic 干净不等于屏上干净
  it('渲染出来的文字里没有判词、建议、反事实金额与统计量', async () => {
    const t = (await mountScreen()).text()
    for (const w of ['需关注', '异常', '建议', '现场检查', '可安排清洗',
                     '比应得少', '缺口', '应发', '误报', 'q<', 'p 值']) {
      expect(t, w).not.toContain(w)
    }
  })

  it('说明写的是「这张图在画什么」:轴、单位、范围是拿哪一段估的', async () => {
    const t = (await mountScreen()).text()
    expect(t).toContain('÷ 全园同日中位')
    expect(t).toContain('范围取自当月之外的逐日数据')
    expect(t).toContain('所有行共用同一段纵轴')
    expect(t).toContain('副轴固定 0–3%')
  })
})

describe('光伏分栋分析 · 护栏与下钻', () => {
  beforeEach(boot)

  it('整年无抄表 → 空态深链,不画看板也不画图', async () => {
    const w = await mountScreen({ readings: [] })
    expect(w.text()).toContain('暂无分栋抄表记录')
    expect(w.findAll('.pma-brow')).toHaveLength(0)
    expect(w.findAll('.stub-chart')).toHaveLength(0)
  })

  it('页脚给出 snapshot id 与整年有效日数', async () => {
    const w = await mountScreen()
    expect(w.find('.pma-foot code').text()).toMatch(/^[0-9a-f]{8}$/)
    expect(w.text()).toMatch(/整年有效日 \d+ \/ \d+ 天/)
  })

  it('点看板的行打开单栋抽屉,里面三张都写明是整年逐日', async () => {
    const w = await mountScreen()
    expect(w.text()).not.toContain('S2 · 样条趋势')
    await w.findAll('.pma-brow')[0].trigger('click')
    const t = w.text()
    expect(t).toContain('S2 · 样条趋势')
    expect(t).toContain('S3 · 变点与置信区间')
    expect(t).toContain('M4 · 控制图')
    expect(t).toContain('与上面选的期间无关')
  })

  it('点 F1 的行也打开同一个抽屉', async () => {
    const w = await mountScreen()
    await w.findAll('.pma-facts li')[0].trigger('click')
    expect(w.text()).toContain('M4 · 控制图')
  })

  it('参数取不到时回落默认线,屏照常出 —— 不显空也不整屏挂掉', async () => {
    vi.mocked(paramsApi.list).mockRejectedValue(new Error('boom'))
    const w = await mountScreen()
    expect(w.text()).toContain('正常范围半宽 2 倍稳健波动')
    expect(w.findAll('.pma-brow').length).toBe(N)
  })
})
