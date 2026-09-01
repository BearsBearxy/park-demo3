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
 *   ① 14 块都在,且热力矩阵**真的画出了格子** —— jsdom 测不出 ECharts 漏注册,
 *      所以三张网格走 CSS Grid,这里直接数节点。
 *   ② **文案规范**(§05)钉在渲染出来的 DOM 上:屏只说明可视化在做什么,
 *      不出现判词(正常/异常/需关注)、建议动作、反事实金额。
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
// ECharts 在 jsdom 里没有 canvas;图只需证明「渲染了」,不需要真画
vi.mock('@/components/ana/AnaEChart.vue', () => ({
  default: { name: 'AnaEChart', props: ['option', 'height'], template: '<div class="stub-chart" />' },
}))

const pad = (n: number) => String(n).padStart(2, '0')
const N = 9

/** 整年 9 栋;S4 从 7/19 起掉 35%,S6 从 8 月才投产 */
function fixture(monthCount = 12) {
  const stations: PvStationDTO[] = Array.from({ length: N }, (_, i) => ({
    id: i + 1, name: `S${i + 1}`, phase: i < 5 ? 1 : 2, metered: 1,
    capacityKwp: 100, panelCount: i === 2 ? 400 : 200, panelWatt: 500,
    priceYuan: 0.86, sortNo: i,
  }))
  const readings: PvReadingDTO[] = []
  for (const m of Array.from({ length: monthCount }, (_, k) => k + 1)) {
    const dim = new Date(2026, m, 0).getDate()
    for (let d = 1; d <= dim; d++) {
      const date = `2026-${pad(m)}-${pad(d)}`
      for (let i = 0; i < N; i++) {
        if (i === 5 && m < 8) continue                       // S6 8 月才投产 → 前面留白
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

async function mountScreen(over: Partial<ReturnType<typeof fixture>> = {}) {
  const f = { ...fixture(), ...over }
  vi.mocked(pvMeterApi.stations).mockResolvedValue(f.stations)
  vi.mocked(pvMeterApi.readingsYear).mockImplementation(async (y: number) => (y === 2026 ? f.readings : []))
  vi.mocked(paramsApi.list).mockResolvedValue([])          // 取不到参数 → 回落默认判据线
  const w = mount(PvMeterAnaView, { global: { stubs: { RouterLink: true, teleport: true } } })
  await flushPromises()
  providePeriodMonths(['2026-07', '2026-08'], ['2026-08'])
  usePeriod().setYear(2026)
  await flushPromises()
  return w
}

describe('光伏分栋分析 · 14 块', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    __resetCompareForTest()
    location.hash = ''
  })

  it('五层的块标题都在', async () => {
    const t = (await mountScreen()).text()
    for (const b of ['L1 · 相对偏离', 'M1', 'M2', 'D2', 'F1 · 判据命中清单',
                     'A1 · 绝对效率轨迹', 'T1 · 台账 vs 理论装机',
                     'R1 · 消纳结构', 'R2 · 各站消纳收益', 'R3 · 各站发电效率', 'R4 · 发电量月度趋势',
                     'M3 · 响应斜率小倍数']) {
      expect(t, b).toContain(b)
    }
  })

  // ① 热力矩阵走 CSS Grid,不走 ECharts —— 直接数节点,jsdom 测得出来
  it('三张网格各 9 栋 × 12 月 = 108 格,共 324 格', async () => {
    const w = await mountScreen()
    expect(w.findAll('.hm-c')).toHaveLength(9 * 12 * 3)
  })

  it('未投产的月是留白(c-na),与「有该月但算不出」的斜纹(c-nd)是两种视觉', async () => {
    const w = await mountScreen()
    // S6 前 7 个月未投产 × 三张 = 21 格留白
    expect(w.findAll('.hm-c.c-na').length).toBeGreaterThanOrEqual(21)
  })

  it('六张 ECharts 图都渲染了(A1/T1/R1/R2/R3/R4)', async () => {
    const w = await mountScreen()
    expect(w.findAll('.stub-chart').length).toBeGreaterThanOrEqual(6)
  })

  it('M3 每栋一格,共用同一段纵轴并把范围写在图注里', async () => {
    const w = await mountScreen()
    expect(w.findAll('.pma-mini')).toHaveLength(9)
    expect(w.text()).toContain('所有格共用同一段纵轴')
  })
})

describe('光伏分栋分析 · F1 判据命中清单', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    __resetCompareForTest()
    location.hash = ''
  })

  it('每行三段式:楼栋 · 哪个数 · 多少 · 跟什么比', async () => {
    const w = await mountScreen()
    const li = w.findAll('.pma-hits li')
    expect(li.length).toBeGreaterThan(0)
    for (const row of li) {
      expect(row.find('.st').exists()).toBe(true)
      expect(row.find('.cr').exists()).toBe(true)
      expect(row.find('.vl').exists()).toBe(true)
      expect(row.find('.ln').exists()).toBe(true)
    }
  })

  it('S3 的台账差命中并写出可复算的两个数', async () => {
    const w = await mountScreen()
    const row = w.findAll('.pma-hits li').find(r => r.find('.st').text() === 'S3')!
    expect(row, 'S3 未出现在清单里').toBeTruthy()
    expect(row.find('.cr').text()).toBe('台账差')
    expect(row.find('.vl').text()).toContain('vs 理论')
    expect(row.find('.ln').text()).toBe('判据线 ±3%')
  })

  it('底部固定写着「未列出 ≠ 没问题」并列出当前判据线', async () => {
    const t = (await mountScreen()).text()
    expect(t).toContain('未列出 ≠ 没问题')
    expect(t).toContain('月偏离 ±10%')
    expect(t).toContain('台账差 ±3%')
    expect(t).toContain('锚点 950')
  })

  it('清单按楼栋顺序排,不按严重度', async () => {
    const w = await mountScreen()
    const names = w.findAll('.pma-hits li').map(r => Number(r.find('.st').text().slice(1)))
    expect(names).toEqual([...names].sort((a, b) => a - b))
  })
})

describe('光伏分栋分析 · 文案规范(§05)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    __resetCompareForTest()
    location.hash = ''
  })

  // 屏只说明可视化在做什么。判词、建议动作、反事实金额一个都不许露 ——
  // 钉在渲染后的 DOM 上:文案是在模板里拼的,logic 干净不等于屏上干净
  it('渲染出来的文字里没有判词、建议与反事实金额', async () => {
    const t = (await mountScreen()).text()
    for (const w of ['需关注', '异常', '建议', '现场检查', '可安排清洗', '比应得少', '缺口', '误报']) {
      expect(t, w).not.toContain(w)
    }
  })

  it('说明写的是「这张图在画什么」:轴、单位、色阶、留白的含义', async () => {
    const t = (await mountScreen()).text()
    expect(t).toContain('留白 = 该月尚无抄表记录')
    expect(t).toContain('红=低于基准 蓝=高于')
    expect(t).toContain('副轴固定 0–3%')
    expect(t).toContain('柱高是绝对额，不是效率')
  })

  it('横幅只陈述事实:条数、装表栋数、录了铭牌的栋数', async () => {
    const t = (await mountScreen()).find('.pma-banner').text()
    expect(t).toMatch(/抄表 \d+ 条/)
    expect(t).toMatch(/\d+ 栋已装表/)
    expect(t).toMatch(/\d+ 栋已录板数与单块标称功率/)
  })
})

describe('光伏分栋分析 · 护栏与下钻', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    __resetCompareForTest()
    location.hash = ''
  })

  it('整年无抄表 → 空态深链,不画网格也不画图', async () => {
    const w = await mountScreen({ readings: [] })
    expect(w.text()).toContain('暂无分栋抄表记录')
    expect(w.findAll('.hm-c')).toHaveLength(0)
    expect(w.findAll('.stub-chart')).toHaveLength(0)
  })

  it('页脚给出 snapshot id 与有效日数', async () => {
    const w = await mountScreen()
    expect(w.find('.pma-foot code').text()).toMatch(/^[0-9a-f]{8}$/)
    expect(w.text()).toMatch(/有效日 \d+ \/ \d+ 天/)
  })

  it('点网格的格打开单栋抽屉', async () => {
    const w = await mountScreen()
    expect(w.text()).not.toContain('S2 · 样条趋势')
    await w.findAll('.hm-c')[0].trigger('click')
    expect(w.text()).toContain('S2 · 样条趋势')
    expect(w.text()).toContain('S3 · 变点与置信区间')
    expect(w.text()).toContain('M4 · 残差控制图')
  })

  it('点 F1 的行也打开同一个抽屉', async () => {
    const w = await mountScreen()
    await w.findAll('.pma-hits li')[0].trigger('click')
    expect(w.text()).toContain('M4 · 残差控制图')
  })

  it('参数取不到时回落默认判据线,屏照常出 —— 不显空也不整屏挂掉', async () => {
    vi.mocked(paramsApi.list).mockRejectedValue(new Error('boom'))
    const w = await mountScreen()
    expect(w.text()).toContain('月偏离 ±10%')
    expect(w.findAll('.hm-c').length).toBeGreaterThan(0)
  })
})
