import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

import PvMeterAnaView from '@/views/analysis/PvMeterAnaView.vue'
import { pvMeterApi, type PvReadingDTO, type PvStationDTO } from '@/api/pvMeter'
import { paramsApi } from '@/api/params'
import { providePeriodMonths, usePeriod } from '@/analysis/usePeriod'
import { __resetCompareForTest } from '@/analysis/useCompare'

/**
 * 光伏分栋分析的渲染证明(PV-ANALYSIS-SPEC §06)。
 *
 * logic 层的 spec 管算得对不对。这里管**屏上真的长出来了没有**,以及只有渲染后才成立的:
 *   ① 期间切「按月 / 按年」时刻度真的换了 —— 月段画当月那三十来个点,不是全年逐日。
 *   ② **文案规范**(§05)钉在渲染出来的 DOM 上:只说明可视化在做什么,
 *      不出现判词、建议动作、反事实金额,也不出现 p / q。
 *   ③ 整年无抄表 → 空态深链,不画假图。
 *
 * ④ **信息结构**(2026-09 改版,用户否掉了「13 行等权曲线占满首屏」)。
 *    这一组钉的是设计决定本身,不是某句文案 —— 它们是最容易在下次加功能时被悄悄推平的:
 *      · 首屏只展开命中判据线的栋,其余折叠。13 行墙不许长回来。
 *      · 结论条的数与事实句**同一个门槛**。曾经这里用「出过一次带」,
 *        ±2σ 天然漏出 4.6%,健康的栋几乎全被标黄 —— 换个样子的同一个病。
 *      · 默认停在「异常定位」,那一段一张 ECharts 都不渲染:
 *        看板是定位工具,校准图与消纳图是佐证,不并排等权。
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

// 确定性伪随机。**健康的栋也必须有正常抖动** —— 一份完全无噪声的夹具测不出
// 「把噪声当发现」这类 bug:±2σ 天然双侧漏出 ~4.6%,真库上正是它让 11 栋里 9 栋被误标,
// 而无噪声夹具里健康栋一个点都不出带,两种口径恰好给出同一个答案(假绿)。
// 不用 Math.random:测试要可复现。
const rnd = (i: number, m: number, d: number) => {
  const x = Math.sin(i * 127.1 + m * 311.7 + d * 74.7) * 43758.5453
  return x - Math.floor(x)
}

/** 整年 9 栋;S4 从 7/19 起掉 35%(断崖);S3 台账是理论的 2 倍;其余栋只有正常抖动 */
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
        const u = rnd(i, m, d)
        // ±3% 常态抖动 + 4% 的日子来一个 ±10% 尖峰。频率是调过的:健康的栋每月
        // 落到范围外一两天(±2σ 的正常漏出),但**够不到** scatterMin 那条判据线 ——
        // 「出过带」与「算发现」必须在夹具里就是两件事,否则这组断言测不出东西
        const jit = 1 + (u - 0.5) * 0.06 + (u > 0.98 ? 0.10 : u < 0.02 ? -0.10 : 0)
        const gen = 400 * (1 + (d % 5) * 0.1) * jit * (bad ? 0.65 : 1)
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

/** 切分段。屏默认停在「异常定位」,校准与消纳的图要切过去才渲染 */
async function toSection(w: VueWrapper, label: string) {
  const tab = w.findAll('[role="tab"]').find(b => b.text() === label)
  expect(tab, `分段「${label}」不在`).toBeTruthy()
  await tab!.trigger('click')
  await flushPromises()
}

const boot = () => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  __resetCompareForTest()
  location.hash = ''
}

describe('光伏分栋分析 · 两档缩放', () => {
  beforeEach(boot)

  it('月段:看板的 x 是当月那三十来天 —— 不是全年逐日', async () => {
    const w = await mountScreen()
    expect(w.text()).toContain('逐日看板')
    expect(w.text()).toContain('2026 年 8 月')
    // 轴只标首 / 中 / 末,当月 31 天
    expect(w.findAll('.pma-bax span').map(s => s.text())).toEqual(['1', '16', '31'])
  })

  it('年段:标题与刻度换成逐月', async () => {
    const w = await mountScreen({}, 'year')
    expect(w.text()).toContain('逐月看板')
    expect(w.findAll('.pma-bax span').map(s => s.text())).toEqual(['1月', '6月', '12月'])
  })

  it('结论条写明「模型吃整年，画的是这一段」—— 别让人以为切月就只用一个月的数据', async () => {
    const t = (await mountScreen()).find('.pma-lede').text()
    expect(t).toContain('模型吃整年，画的是这一段')
    expect(t).toMatch(/抄表 \d+ 条/)
  })

  it('命中的行画出正常范围带、中心线,出范围的点单独标出来', async () => {
    const w = await mountScreen()
    const hit = w.find('.pma-brow.hit')
    expect(hit.find('.band').exists()).toBe(true)
    expect(hit.find('.ctr').exists()).toBe(true)
    expect(hit.findAll('circle.lo').length).toBeGreaterThan(0)
  })

  it('六张 ECharts 图都渲染了,分在校准与消纳两段(异常定位段一张都不放)', async () => {
    const w = await mountScreen()
    expect(w.findAll('.stub-chart')).toHaveLength(0)
    await toSection(w, '效率校准')
    expect(w.findAll('.stub-chart')).toHaveLength(3)      // A1 / T1 / R3
    await toSection(w, '消纳收益')
    expect(w.findAll('.stub-chart')).toHaveLength(3)      // R1 / R2 / R4
  })

  it('M3 每栋一格,并写明它始终按月、与期间无关', async () => {
    const w = await mountScreen()
    await toSection(w, '效率校准')
    expect(w.findAll('.pma-mini')).toHaveLength(N)
    expect(w.text()).toContain('始终按月')
  })
})

describe('光伏分栋分析 · 信息结构(结论 → 定位 → 佐证)', () => {
  beforeEach(boot)

  // 用户否掉的就是「打开先撞 13 行等权曲线」。首屏必须只展开命中的那几栋
  it('首屏只展开命中判据线的栋,其余折进一条 —— 不是每栋一行铺满', async () => {
    const w = await mountScreen()
    const hit = w.findAll('.pma-brow.hit')
    expect(hit).toHaveLength(1)                            // 夹具里只有 S4 有断崖
    expect(hit[0].find('.nm').text()).toBe('S4')
    expect(w.findAll('.pma-brow')).toHaveLength(1)         // 折叠着,不是 9 行
    expect(w.find('.pma-fold').text()).toContain(`其余 ${N - 1} 栋`)
  })

  it('展开折叠条之后才长出其余的行', async () => {
    const w = await mountScreen()
    await w.find('.pma-fold').trigger('click')
    expect(w.findAll('.pma-brow')).toHaveLength(N)
  })

  // 曾经的 bug:结论条用「出过一次带」数数,±2σ 天然漏出 4.6%,
  // 真库 11 栋里 9 栋被标黄而事实句只有 1 条 —— 一个屏必须一个门槛
  it('结论条的数 = 事实句里本段命中的栋数,不是「出过一次带」的栋数', async () => {
    const w = await mountScreen()
    const segFacts = new Set(
      w.findAll('.pma-facts li')
        .filter(li => ['run', 'scatter', 'thin'].some(k => li.classes(k)))
        .map(li => li.find('.st').text()))
    expect(Number(w.find('.pma-lede .n').text())).toBe(segFacts.size)
    // 台账/效率是整年口径,事实句照列,但不提这一段的看板行
    expect(w.findAll('.pma-facts li').length).toBeGreaterThan(segFacts.size)
    // 栋名 + 出范围的刻度数。S4 的断崖从 7/19 起,八月整月在外
    expect(w.findAll('.pma-lede .chip').map(c => c.text())).toEqual(['S431'])
  })

  it('点结论条的栋名开抽屉', async () => {
    const w = await mountScreen()
    await w.find('.pma-lede .chip').trigger('click')
    expect(w.text()).toContain('M4 · 控制图')
  })
})

describe('光伏分栋分析 · 事实句', () => {
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
  // 钉在渲染后的 DOM 上:文案是在模板里拼的,logic 干净不等于屏上干净。
  // 三段都要扫:图挪进分段之后,只看首屏等于漏掉三分之二的文案
  it('渲染出来的文字里没有判词、建议、反事实金额与统计量', async () => {
    const w = await mountScreen()
    for (const s of ['异常定位', '效率校准', '消纳收益']) {
      if (s !== '异常定位') await toSection(w, s)
      const t = w.text()
      for (const bad of ['需关注', '建议', '现场检查', '可安排清洗',
                         '比应得少', '缺口', '应发', '误报', 'q<', 'p 值']) {
        expect(t, `${s} 段出现了「${bad}」`).not.toContain(bad)
      }
    }
  })

  it('说明写的是「这张图在画什么」:轴、单位、范围是拿哪一段估的', async () => {
    const w = await mountScreen()
    expect(w.text()).toContain('÷ 全园同日中位')
    expect(w.text()).toContain('范围取自当月之外的逐日数据')
    expect(w.text()).toContain('所有行共用同一段纵轴')
    await toSection(w, '消纳收益')
    expect(w.text()).toContain('副轴固定 0–3%')
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
    await w.find('.pma-brow').trigger('click')
    const t = w.text()
    expect(t).toContain('S2 · 样条趋势')
    expect(t).toContain('S3 · 变点与置信区间')
    expect(t).toContain('M4 · 控制图')
    expect(t).toContain('与上面选的期间无关')
  })

  it('点事实句也打开同一个抽屉', async () => {
    const w = await mountScreen()
    await w.findAll('.pma-facts li')[0].trigger('click')
    expect(w.text()).toContain('M4 · 控制图')
  })

  it('参数取不到时回落默认线,屏照常出 —— 不显空也不整屏挂掉', async () => {
    vi.mocked(paramsApi.list).mockRejectedValue(new Error('boom'))
    const w = await mountScreen()
    expect(w.text()).toContain('正常范围半宽 2 倍稳健波动')
    expect(w.find('.pma-brow.hit').exists()).toBe(true)
  })
})
