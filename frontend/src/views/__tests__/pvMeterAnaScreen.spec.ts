import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref, type Component } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import PvMeterAnaView from '@/views/analysis/PvMeterAnaView.vue'
import PvChips from '@/views/analysis/PvChips.vue'
import PvDayChart from '@/views/analysis/PvDayChart.vue'
import PvPerKwBars from '@/views/analysis/PvPerKwBars.vue'
import PvYieldBand from '@/views/analysis/PvYieldBand.vue'
import PvAnchorBars from '@/views/analysis/PvAnchorBars.vue'
import PvLedgerScatter from '@/views/analysis/PvLedgerScatter.vue'
import PvConsumption from '@/views/analysis/PvConsumption.vue'
import PvRevenueBars from '@/views/analysis/PvRevenueBars.vue'
import PvAlphaBars from '@/views/analysis/PvAlphaBars.vue'
import PvResidualHeat from '@/views/analysis/PvResidualHeat.vue'
import PvQualityGrid from '@/views/analysis/PvQualityGrid.vue'
import PvLabTable from '@/views/analysis/PvLabTable.vue'
import PvDriftChart from '@/views/analysis/PvDriftChart.vue'
import PvControlChart from '@/views/analysis/PvControlChart.vue'
import PvBetaChart from '@/views/analysis/PvBetaChart.vue'
import PvDetailTable from '@/views/analysis/PvDetailTable.vue'
import { buildLab } from '@/views/analysis/pvMeterAna.logic'
import type { AnchorBars, ChipGroups } from '@/views/analysis/pvAnaV4.logic'
import { pvMeterApi, type PvReadingDTO, type PvStationDTO } from '@/api/pvMeter'
import { elecCostApi } from '@/api/elecCost'
import { paramsApi, type ParamRowDTO } from '@/api/params'
import { providePeriodMonths, usePeriod } from '@/analysis/usePeriod'
import { __resetCompareForTest } from '@/analysis/useCompare'

/**
 * 光伏分栋分析 v4 的接线证明(PV-ANALYSIS-SCREEN-V4 §2 四个状态 + §0 保留的行为)。
 *
 * 各叶子组件的像素几何由各自的 spec 钉坐标;数据口径由 pvAnaV4.logic.spec 钉。
 * 这里只管**屏把它们接起来之后**才成立的事:
 *   ① 四个状态(账面量 / 绝对水平 / 高级分析 / 抽屉)各自渲染了哪些组件,ECharts 一张都不剩。
 *   ② 选中态是一条线索:芯片 / A2 行 / α 条改的是同一个 selId,点了只换图不开抽屉;
 *      抽屉入口只有主卡卡头;#st= 深链;上一栋 / 下一栋按芯片顺序走。
 *   ③ 换期 / 换档 / 关抽屉时段控档位与选中栋不变。
 *   ④ 高级分析懒算:没点开时 buildLab 一次都不跑,点开只跑一次,离开后换选中也不跑。
 *   ⑤ 月中未录全:未到 ≠ 漏抄,覆盖率按已过去算。
 *   ⑥ 文案:任何档都不写统计名词,不写判词。
 */

vi.mock('@/api/pvMeter', () => ({
  pvMeterApi: {
    stations: vi.fn(), readings: vi.fn(), readingsYear: vi.fn(),
    months: vi.fn(), years: vi.fn(), simulate: vi.fn(),
  },
}))
vi.mock('@/api/params', () => ({ paramsApi: { list: vi.fn() } }))
// 上网单价读计费参数 pv_grid_price(2026-10-06 改稿,和判据参数同一趟);开发库里是 0.453
vi.mock('@/api/elecCost', () => ({ elecCostApi: { priceCfg: vi.fn(async () => [{ cfgKey: 'pv_grid_price', value: 0.453, source: 'default', monthValue: null, defaultValue: 0.453, note: null }]) } }))
// buildLab 原样跑,只是包一层计数器 —— 只查组件没渲染证不了「没算」,组件本来就挂在 v-if 下面
vi.mock('@/views/analysis/pvMeterAna.logic', async (orig) => {
  const a = await orig<typeof import('@/views/analysis/pvMeterAna.logic')>()
  return { ...a, buildLab: vi.fn(a.buildLab) }
})
const push = vi.fn()
const replace = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push, replace }),
  RouterLink: { template: '<a><slot /></a>' },
}))
vi.mock('@/analysis/anaData', () => ({
  // 光伏月账(pv)到 9 月:工具条「光伏月账到 2026年9月」
  fetchAvailableMonths: vi.fn(async () => ({ months: ['2026-07', '2026-08'], sources: { pnl: ['2026-07', '2026-08'], pv: ['2026-08', '2026-09'] } })),
  invalidateAnaCache: vi.fn(),
}))

const pad = (n: number) => String(n).padStart(2, '0')
const N = 9
const dim = (y: number, m: number) => new Date(y, m, 0).getDate()

// 确定性伪随机。**健康的栋也必须有正常抖动** —— 无噪声夹具测不出「把噪声当发现」:
// ±2 倍的带天然双侧漏出 ~4.6%,无噪声时健康栋一个点都不出带,两种口径恰好给出同一个答案(假绿)。
const rnd = (i: number, m: number, d: number) => {
  const x = Math.sin(i * 127.1 + m * 311.7 + d * 74.7) * 43758.5453
  return x - Math.floor(x)
}

interface FxOpt {
  /** S4 从 7/19 起掉 35%(种入的断崖)。false = 零故障园区 */
  crash?: boolean
  /** 最后一条抄表。月中未录全用它把数据截在 8/15 */
  through?: string
  /** 全园都没抄的日子(漏抄,不是未到) */
  skip?: string[]
  /** 楼栋序号(0 起)→ 第一条抄表日。早于它的日子没有记录(投产前) */
  late?: Record<number, string>
}

const stationsFx: PvStationDTO[] = Array.from({ length: N }, (_, i) => ({
  id: i + 1, name: `S${i + 1}`, phase: i < 5 ? 1 : 2, metered: 1,
  capacityKwp: 100, panelCount: i === 2 ? 100 : 200, panelWatt: 500,
  priceYuan: 0.86, sortNo: i,
}))

function readingsOf(year: number, o: FxOpt = {}): PvReadingDTO[] {
  const crash = o.crash ?? true
  const through = o.through ?? `${year}-12-31`
  const skip = new Set(o.skip ?? [])
  const out: PvReadingDTO[] = []
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= dim(year, m); d++) {
      const date = `${year}-${pad(m)}-${pad(d)}`
      if (date > through) return out
      if (skip.has(date)) continue
      for (let i = 0; i < N; i++) {
        if (o.late?.[i] && date < o.late[i]) continue
        const bad = crash && i === 3 && (m > 7 || (m === 7 && d > 18))
        const u = rnd(i, m, d)
        // ±3% 常态抖动 + 4% 的日子来一个 ±10% 尖峰:健康栋每月落到范围外一两天,但成不了段
        const jit = 1 + (u - 0.5) * 0.06 + (u > 0.98 ? 0.10 : u < 0.02 ? -0.10 : 0)
        const gen = 400 * (1 + (d % 5) * 0.1) * jit * (bad ? 0.65 : 1)
        out.push({
          id: out.length + 1, stationId: i + 1, stationName: `S${i + 1}`, readDate: date,
          // 损耗率随日子变,不钉死一个数(计划 §2.5:夹具不用真库那条 2.91% 的平线)
          genTotal: gen, selfUse: gen * 0.7, gridFeed: gen * (0.27 + (d % 4) * 0.005),
          priceSnap: 0.86, revenue: gen * 0.7 * 0.86, note: null, source: 'simulated',
        })
      }
    }
  }
  return out
}

interface MountOpt extends FxOpt {
  /** 上一年(2025)的抄表接口失败 */
  prevFail?: boolean
  gran?: 'month' | 'year'
  month?: number
  /** 「今天」。**月中未录全全靠它** —— logic 取系统当天,所以这里假 Date */
  today?: string
  readings?: PvReadingDTO[]
  stations?: PvStationDTO[]
}

// 挂过的屏每条测试后卸掉:usePeriod 是模块级单例,留着的旧实例会在下一条换期时跟着重算(停在高级分析的那个会再跑 buildLab)
const mounted: VueWrapper[] = []

async function mountScreen(o: MountOpt = {}, host: Component = PvMeterAnaView) {
  // 只假 Date,不假 setTimeout —— flushPromises 靠真 setTimeout 排空微任务
  vi.useFakeTimers({ toFake: ['Date'] })
  const [ty, tm, td] = (o.today ?? '2026-09-02').split('-').map(Number)
  vi.setSystemTime(new Date(ty, tm - 1, td, 12, 0, 0))

  const rds = o.readings ?? readingsOf(2026, o)
  vi.mocked(pvMeterApi.stations).mockResolvedValue(o.stations ?? stationsFx)
  vi.mocked(pvMeterApi.readingsYear).mockImplementation(async (y: number) => {
    if (y === 2025 && o.prevFail) throw new Error('boom')
    return y === 2026 ? rds : y === 2025 ? readingsOf(2025, { crash: false }) : []
  })
  vi.mocked(paramsApi.list).mockResolvedValue([])          // 取不到参数 → 回落默认线

  const w = mount(host, { global: { stubs: { RouterLink: true, teleport: true } } })
  mounted.push(w)
  await flushPromises()
  providePeriodMonths(['2026-07', '2026-08'], ['2026-08'])
  usePeriod().setYear(2026)
  // usePeriod 是模块级单例,sel 不随 pinia 重建而复位 —— 每条都显式设粒度与月份
  usePeriod().setGran(o.gran ?? 'month')
  usePeriod().setMonth(o.month ?? 8)
  await flushPromises()
  return w
}

async function toSection(w: VueWrapper, label: string) {
  const tab = w.findAll('.pma-seg [role="tab"]').find(b => b.text() === label)
  expect(tab, `分段「${label}」不在`).toBeTruthy()
  await tab!.trigger('click')
  await flushPromises()
}

/** 开抽屉:主卡卡头那条「看 X 的整年 →」—— 全屏唯一的抽屉入口 */
async function openDrawer(w: VueWrapper) {
  const lk = w.findAll('.pma-main .av2-card-h .pma-lk').find(b => b.text().startsWith('看 '))
  expect(lk, '卡头没有开抽屉的入口').toBeTruthy()
  await lk!.trigger('click')
  await flushPromises()
}

const chartName = (w: VueWrapper) => w.find('.pdc-hd .nm').text()
/** 大图折线段:每段 `M x0,y0 L x1,y1`,按 DOM 顺序 → [x0, y0, x1, y1] */
const lineSegs = (w: VueWrapper) => w.findAll('.pdc path.line').map(p =>
  (p.attributes('d') ?? '').match(/-?[\d.]+/g)!.map(Number))
const groups = (w: VueWrapper) => w.findComponent(PvChips).props('groups') as ChipGroups
const kpi = (w: VueWrapper, label: string) => {
  const t = w.findAll('.av2-kpi').find(k => k.find('.l').text() === label)
  expect(t, `KPI 瓦「${label}」不在`).toBeTruthy()
  // 副行颜色 2026-09-19 起由 AnaKpiTile 的样式表按 .warn 类给(灰 --text-muted-tint / 警示 --warn-text),不再内联
  return { v: t!.find('.v').text(), d: t!.find('.d').text(), warn: t!.find('.d').classes().includes('warn') }
}
/** 屏自己写的字:KPI 行 + 主体 + 抽屉(不含 AnaShell 工具条) */
const bodyText = (w: VueWrapper) =>
  w.findAll('.anx-kpis, .pma-body, .fp-dwr').map(e => e.text()).join('\n')

/** 展开「其余 N 栋」,点第一枚 */
async function pickFirstFolded(w: VueWrapper): Promise<string> {
  await w.find('.pvc button.more').trigger('click')
  const chip = w.findAll('.pvc-pop button.chip').find(b => b.attributes('disabled') === undefined)
  expect(chip, '浮层里没有可点的栋').toBeTruthy()
  const name = chip!.findAll('span')[1].text()
  await chip!.trigger('click')
  await flushPromises()
  return name
}

const boot = () => {
  while (mounted.length) mounted.pop()!.unmount()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  __resetCompareForTest()
  location.hash = ''
}

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  vi.useRealTimers()
})

const MID: MountOpt = { through: '2026-08-15', skip: ['2026-08-07'], today: '2026-08-15' }
// 2026-10-06 改稿:发了多少、每千瓦多少、哪栋偏离、自己用了多少、挣了多少(原来六张数据质量瓦拿掉)
const KPI_LABELS = ['发电量', '每千瓦日均', '连着 3 天偏离的楼栋', '自用占比', '自用和上网收益']
const DEV = '连着 3 天偏离的楼栋'

describe('光伏分栋分析 · 四个状态各自渲染什么', () => {
  beforeEach(boot)

  it('默认(去向和收益):KPI 五瓦 + 第一排(主卡:芯片 + 大图 + 判据脚;新卡:各栋每千瓦日均)+ B7 B8;别的档与抽屉的组件一个都不在', async () => {
    const w = await mountScreen()
    expect(w.findAll('.anx-kpis .av2-kpi').map(k => k.find('.l').text())).toEqual(KPI_LABELS)
    // 首屏自上而下三块:主卡 → 段控 → 档内容器(V4 §2.1)
    expect([...w.find('.pma-body').element.children].map(e => e.className.split(' ').pop()))
      .toEqual(['pma-row1', 'pma-seg', 'pma-sec'])
    // 第一排:主卡 s8 + 新卡 s4 同排(D5①)
    expect([...w.find('.pma-row1').element.children].map(e => [...e.classList].filter(c => /^av2-s\d+$/.test(c))[0])).toEqual(['av2-s8', 'av2-s4'])
    expect(w.find('.pma-pk').findComponent(PvPerKwBars).exists()).toBe(true)
    expect(w.find('.pma-pk .av2-card-h .t').text()).toBe('各栋每千瓦日均发电')
    expect(w.find('.pma-main').findComponent(PvChips).exists()).toBe(true)
    expect(w.find('.pma-main').findComponent(PvDayChart).exists()).toBe(true)
    expect(w.find('.pma-main .pma-b2').exists()).toBe(true)
    expect(w.find('.pma-sec').findComponent(PvConsumption).exists()).toBe(true)
    expect(w.find('.pma-sec').findComponent(PvRevenueBars).exists()).toBe(true)
    for (const c of [PvYieldBand, PvAnchorBars, PvLedgerScatter, PvAlphaBars, PvResidualHeat, PvQualityGrid,
      PvLabTable, PvDriftChart, PvControlChart, PvBetaChart, PvDetailTable]) {
      expect(w.findComponent(c).exists(), `${(c as { __name?: string }).__name} 不该出现在默认档`).toBe(false)
    }
  })

  it('按装机比:B3 + A2 + B6 三张 s12(2026-10-06 改稿卡名);去向和收益那两张不在', async () => {
    const w = await mountScreen()
    await toSection(w, '按装机比')
    const cards = w.findAll('.pma-sec .av2-grid > .av2-card')
    expect(cards.map(c => c.find('.av2-card-h .t').text())).toEqual(['每千瓦发电走势', '每千瓦日均和合格线的差', '台账装机和板数算出的装机'])
    expect(cards.map(c => c.find('.av2-card-h .hint').text())).toEqual([
      `选中 ${chartName(w)} · 每天 · 和全园中间一半比 · kWh`, `2026年全年 · ${N} 栋楼 · 和合格线比 · kWh`, `全部 ${N} 栋楼 · 和台账比 · kWp`,
    ])
    expect(cards.every(c => c.classes('av2-s12'))).toBe(true)
    expect(cards[0].findComponent(PvYieldBand).exists()).toBe(true)
    expect(cards[1].findComponent(PvAnchorBars).exists()).toBe(true)
    expect(cards[1].find('.pma-badge').exists(), '上一年有分栋读数,不出「没有分栋读数」角标').toBe(false)
    expect(cards[2].findComponent(PvLedgerScatter).exists()).toBe(true)
    expect(w.findComponent(PvConsumption).exists()).toBe(false)
    expect(w.findComponent(PvRevenueBars).exists()).toBe(false)
    // A2「比去年」那一列要上一年的抄表:和这一年同一趟取;夹具 2025 年整年都有 → 每栋都出百分比
    expect(vi.mocked(pvMeterApi.readingsYear)).toHaveBeenCalledWith(2025)
    expect((w.findComponent(PvAnchorBars).props('data') as AnchorBars).rows.every(r => /^[+−]\d+\.\d%$/.test(r.prev))).toBe(true)
  })

  // 2026-10-06 改稿(画板 pv-v2 m-lab / y-lab):按月 常年水平 s6 + 抄表齐不齐 s6 同排、核对表 s12;
  // 按年 常年水平 s6 + 每月和常年水平的差 s6、抄表齐不齐独占 s12、核对表 s12。两张小卡(隔天像不像 / 碰巧更偏)并进核对表两列
  it('❗核对明细 · 按月:常年水平 s6 + 抄表齐不齐 s6 + 核对表 s12;每月和常年的差只在按年出', { timeout: 30_000 }, async () => {
    const w = await mountScreen()
    await toSection(w, '核对明细')
    const grid = w.find('.pma-sec .av2-grid')
    const kids = [...grid.element.children]
    expect(kids.map(e => [...e.classList].filter(c => /^av2-s\d+$/.test(c))[0])).toEqual(['av2-s6', 'av2-s6', 'av2-s12'])
    expect(grid.findComponent(PvAlphaBars).element).toBe(kids[0])
    expect(grid.findComponent(PvQualityGrid).element).toBe(kids[1])
    expect(grid.findComponent(PvLabTable).element).toBe(kids[2])
    expect(grid.findComponent(PvResidualHeat).exists()).toBe(false)
    expect(w.findAll('.pma-sec .fp-empty')).toHaveLength(0)   // 「画不出这张图」2026-10-01 起是 FPEmpty(十件 ⑦)
    expect(w.findComponent(PvConsumption).exists()).toBe(false)
    expect(w.findComponent(PvYieldBand).exists()).toBe(false)
    // ❗各块写明自己吃的期间(S-17):整年的卡放在按月的屏上写「2026年全年」,跟着段走的日历写这一段
    expect(grid.findComponent(PvAlphaBars).find('.hint').text()).toBe('2026年全年 · 和全园中间那栋比 · %')
    expect(grid.findComponent(PvLabTable).find('.hint').text()).toBe(`2026年全年 · 全部 ${stationsFx.length} 栋楼`)
    expect(grid.find('.pqg-leg .per').text()).toBe('2026 年 8 月')
    // 核对表 9 列,后两列每栋一个数
    const th = grid.findComponent(PvLabTable).findAll('th:not(.fp-fill)').map(t => t.text())
    expect(th.slice(-2)).toEqual(['隔天像不像', '碰巧更偏'])
    const ranked = grid.findComponent(PvLabTable).findAll('tbody tr:not(.unborn)')
    expect(ranked.length).toBeGreaterThan(0)
    for (const tr of ranked) {
      const td = tr.findAll('td:not(.fp-fill)')
      expect(td[7].text()).toMatch(/^−?\d\.\d\d$/)
      expect(Number(td[8].text())).toBeGreaterThanOrEqual(0)
    }
  })

  it('❗核对明细 · 按年:常年水平 s6 + 每月和常年的差 s6 + 抄表齐不齐 s12 + 核对表 s12;卡头不再写整年(和工具条同一个期)', { timeout: 30_000 }, async () => {
    const w = await mountScreen({ gran: 'year' })
    await toSection(w, '核对明细')
    const grid = w.find('.pma-sec .av2-grid')
    const kids = [...grid.element.children]
    expect(kids.map(e => [...e.classList].filter(c => /^av2-s\d+$/.test(c))[0])).toEqual(['av2-s6', 'av2-s6', 'av2-s12', 'av2-s12'])
    expect(grid.findComponent(PvAlphaBars).element).toBe(kids[0])
    expect(grid.findComponent(PvResidualHeat).element).toBe(kids[1])
    expect(grid.findComponent(PvQualityGrid).element).toBe(kids[2])
    expect(grid.findComponent(PvLabTable).element).toBe(kids[3])
    expect(grid.find('.prh-year').text()).toBe('2026')
    expect(grid.findComponent(PvAlphaBars).find('.hint').text()).toMatch(/^\d+ 栋楼 · 和全园中间那栋比 · %$/)
    expect(grid.findComponent(PvLabTable).find('.hint').text()).toBe(`全部 ${stationsFx.length} 栋楼`)
    // usePeriod 是模块级单例,下一条挂载时先按上一条留下的粒度算一遍、默认选中栋就停在年档那栋 —— 还回月档
    usePeriod().setGran('month')
    await flushPromises()
  })

  it('抽屉:抽屉头(栋名 · 在网天数 · 年发电 · 装机 · 期别 + 上一栋 / 下一栋)+ B9 B10 B11 B12', async () => {
    const w = await mountScreen()
    expect(w.find('.fp-dwr').exists()).toBe(false)
    await openDrawer(w)
    const dwr = w.find('.fp-dwr')
    expect(dwr.find('.fp-dwr-hd h3').text()).toBe('S4')
    expect(dwr.find('.fp-dwr-hd').text()).toMatch(/整年在网 \d+ 天 · 年发电 [\d.]+万kWh · 装机 100 kWp · 一期/)
    // 四块卡名(2026-10-06 改稿);明细表卡头写这一栋的名字
    expect(dwr.findAll('.pma-drawer .av2-card-h .t').map(t => t.text())).toEqual(['每天的偏离和水平变化', '每天的偏离和两道范围', '跟全园一起涨落的程度', '每天的读数'])
    expect(dwr.findComponent(PvDetailTable).find('.hint').text()).toMatch(/^S4 · 8月 \d+ 天 · kWh$/)
    expect(dwr.findAll('.fp-dwr-hd button[aria-label]').map(b => b.attributes('aria-label'))).toEqual(['上一栋', '下一栋', '关闭'])
    const body = dwr.find('.pma-drawer')
    expect([...body.element.children]).toEqual([
      dwr.findComponent(PvDriftChart).element, dwr.findComponent(PvControlChart).element,
      dwr.findComponent(PvBetaChart).element, dwr.findComponent(PvDetailTable).element,
    ])
  })

  it('ECharts 整屏一张都不剩:源码里没有 AnaEChart / bandSeries / 旧的四个组件', () => {
    const s = readFileSync(join(__dirname, '../analysis/PvMeterAnaView.vue'), 'utf8')
    for (const gone of ['AnaEChart', 'bandSeries', 'PvQueue', 'PvDots', 'PvSlope', 'PvSeasonRows'])
      expect(s, `view 里还有 ${gone}`).not.toContain(gone)
  })
})

describe('光伏分栋分析 · 选中态与抽屉入口', () => {
  beforeEach(boot)

  it('首屏:出范围的栋常显,其余收进「其余 N 栋楼」;默认选中偏离天数最多、有连着偏离的那栋', async () => {
    const w = await mountScreen()
    const g = groups(w)
    expect(g.shown.map(c => [c.name, c.kind])).toEqual([['S4', 'hit']])   // 夹具里只有 S4 有断崖
    expect(w.findAll('.pvc > button.chip')).toHaveLength(1)
    expect(w.find('.pvc button.more').text()).toBe(`其余 ${N - 1} 栋楼 ▾`)
    expect(chartName(w)).toBe('S4')
    // 一张大图,不是每栋一张
    expect(w.findAll('.pdc svg')).toHaveLength(1)
    // KPI 主数与芯片「命中」同一个门槛(数段不数点)
    expect(kpi(w, DEV).v).toBe(`${g.shown.filter(c => c.kind === 'hit').length} 栋`)
  })

  it('点芯片 = 换图,不开抽屉、不动地址栏;包括收起来的那些(判据线决定谁常显,不决定谁能被看)', async () => {
    const w = await mountScreen()
    const name = await pickFirstFolded(w)
    expect(name).not.toBe('S4')
    expect(chartName(w)).toBe(name)
    expect(w.find('.fp-dwr').exists(), '点芯片开了抽屉').toBe(false)
    expect(replace).not.toHaveBeenCalled()
    // 选中的栋升进常显 —— 换完图芯片条上看得见自己选的是谁
    expect(groups(w).shown.some(c => c.name === name && c.selected)).toBe(true)
  })

  it('A2 行点击 = 选中该栋换上面的主图,不开抽屉(§1 #12);B3 选中栋跟着走', async () => {
    const w = await mountScreen()
    await toSection(w, '按装机比')
    expect((w.findComponent(PvYieldBand).props('data') as { selName: string }).selName).toBe('S4')
    w.findComponent(PvAnchorBars).vm.$emit('pick', 6)
    await flushPromises()
    expect(chartName(w)).toBe('S6')
    expect(w.findComponent(PvAnchorBars).props('selId')).toBe(6)
    expect((w.findComponent(PvYieldBand).props('data') as { selName: string }).selName).toBe('S6')
    expect(w.find('.fp-dwr').exists()).toBe(false)
  })

  it('卡头「看 X 的整年 →」开抽屉,地址栏加 #st=(replace,不进历史栈);关抽屉清掉', async () => {
    const w = await mountScreen()
    expect(w.find('.pma-main .av2-card-h .pma-lk').text()).toBe('看 S4 的整年 →')
    await openDrawer(w)
    expect(w.find('.fp-dwr').exists()).toBe(true)
    expect(replace).toHaveBeenLastCalledWith({ hash: '#st=4' })
    expect(push).not.toHaveBeenCalled()
    await w.find('.fp-dwr-x').trigger('click')
    await flushPromises()
    expect(w.find('.fp-dwr').exists()).toBe(false)
    expect(replace).toHaveBeenLastCalledWith({ hash: '' })
  })

  it('❗#st= 带本段没有的栋(99):不开抽屉、清掉地址栏,主图停在芯片第一枚(对照:#st=6 见下一条)', async () => {
    location.hash = '#st=99'
    const w = await mountScreen()
    expect(w.find('.fp-dwr').exists()).toBe(false)
    expect(replace).toHaveBeenLastCalledWith({ hash: '' })
    expect(chartName(w)).toBe('S4')
  })

  it('❗KeepAlive 切走再切回:抽屉已关(Teleport 出去的遮罩不留在别的页签上);切走时不改地址栏', async () => {
    const shown = ref(true)
    const Other = defineComponent({ name: 'OtherTab', render: () => h('div', '别的屏') })
    const Host = defineComponent({ setup: () => () => h(KeepAlive, null, [shown.value ? h(PvMeterAnaView) : h(Other)]) })
    const w = await mountScreen({}, Host)
    await openDrawer(w)
    expect(w.find('.fp-dwr').exists()).toBe(true)
    replace.mockClear()
    shown.value = false
    await flushPromises()
    expect(replace).not.toHaveBeenCalled()
    shown.value = true
    await flushPromises()
    expect(w.find('.fp-dwr').exists(), '切回来抽屉还开着').toBe(false)
    expect(chartName(w)).toBe('S4')
  })

  // C5-05 ④:数据到之前抽屉**不许开** —— 开着的话标题是空的、正文显「这栋可用的逐日偏离不足 8 天」,
  // 那句在加载期不成立。加载期只出页面骨架,抽屉等 snap 第一次非空才 rise 上来。
  it('❗#st= 深链:抄表还没回来时不开抽屉(只出骨架),数据到了才开', async () => {
    location.hash = '#st=6'
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 2, 12, 0, 0))
    type Rds = Awaited<ReturnType<typeof pvMeterApi.readingsYear>>
    let release!: (v: Rds) => void
    vi.mocked(pvMeterApi.stations).mockResolvedValue(stationsFx)
    vi.mocked(pvMeterApi.readingsYear).mockImplementation((y: number) =>
      y === 2026 ? new Promise<Rds>(r => { release = r }) : Promise.resolve([]))
    vi.mocked(paramsApi.list).mockResolvedValue([])
    const w = mount(PvMeterAnaView, { global: { stubs: { RouterLink: true, teleport: true } } })
    mounted.push(w)
    await flushPromises()
    providePeriodMonths(['2026-07', '2026-08'], ['2026-08'])
    usePeriod().setYear(2026); usePeriod().setGran('month'); usePeriod().setMonth(8)
    await flushPromises()

    expect(w.find('.fp-dwr').exists(), '抄表在途时抽屉必须是关的').toBe(false)
    expect(w.find('.pma-skel').exists(), '在途时屏上是骨架').toBe(true)

    release(readingsOf(2026, {}))
    await flushPromises()
    expect(w.find('.fp-dwr').exists(), '数据到了抽屉才开').toBe(true)
    expect(w.find('.fp-dwr-hd h3').text()).toBe('S6')
  })

  it('#st= 深链:带着 #st=6 进屏,数据到了直接开 S6 的抽屉,主图也停在 S6', async () => {
    location.hash = '#st=6'
    const w = await mountScreen()
    expect(w.find('.fp-dwr').exists()).toBe(true)
    expect(w.find('.fp-dwr-hd h3').text()).toBe('S6')
    expect(chartName(w)).toBe('S6')
    expect(w.findComponent(PvDriftChart).exists()).toBe(true)
  })

  it('上一栋 / 下一栋按芯片顺序走(常显在前、收起在后),首尾相接', async () => {
    const w = await mountScreen()
    await w.find('.pvc button.more').trigger('click')
    const order = [
      ...w.findAll('.pvc > button.chip'),
      ...w.findAll('.pvc-pop button.chip').filter(b => b.attributes('disabled') === undefined),
    ].map(b => b.findAll('span')[1].text())
    expect(order[0]).toBe('S4')
    expect(order).toHaveLength(N)
    await openDrawer(w)
    const title = () => w.find('.fp-dwr-hd h3').text()
    const step = async (label: string) => {
      await w.find(`.fp-dwr-hd button[aria-label="${label}"]`).trigger('click')
      await flushPromises()
    }
    await step('下一栋')
    expect(title()).toBe(order[1])
    expect(chartName(w)).toBe(order[1])
    // 走到别的栋,芯片常显区会变 —— 顺序不许跟着变,否则再点「下一栋」会跳栋或原地打转
    await step('下一栋')
    expect(title()).toBe(order[2])
    await step('上一栋')
    await step('上一栋')
    expect(title()).toBe('S4')
    await step('上一栋')
    expect(title()).toBe(order[N - 1])
    expect(replace).toHaveBeenLastCalledWith({ hash: `#st=${order[N - 1].slice(1)}` })
  })

  it('换期 / 换档 / 关抽屉:段控档位与选中栋都不变', async () => {
    const w = await mountScreen()
    const name = await pickFirstFolded(w)
    await toSection(w, '按装机比')
    const selected = () => w.findAll('.pma-seg [role="tab"]').find(t => t.attributes('aria-selected') === 'true')!.text()
    usePeriod().setMonth(7)
    await flushPromises()
    expect(selected()).toBe('按装机比')
    expect(chartName(w)).toBe(name)
    await openDrawer(w)
    expect(w.find('.fp-dwr-hd h3').text()).toBe(name)
    await w.find('.fp-dwr-x').trigger('click')
    await flushPromises()
    expect(selected()).toBe('按装机比')
    expect(chartName(w)).toBe(name)
    await toSection(w, '去向和收益')
    expect(chartName(w)).toBe(name)
  })
})

describe('光伏分栋分析 · 高级分析懒算', () => {
  beforeEach(boot)

  // 破坏验证注:这条设计上要两道机制一起破才红 —— lab computed 里的 section 闸,与 computed 惰性
  // (模板只在 section === 'lab' 分支里读 labView,没人读就不算)。只破一道时保持绿是对的,性质还在。
  // 出处:PV-ANALYSIS-SPEC「懒算」那条(2026-09-02 实测);V4 §6.5b 标「保留」。
  it('第一道:段控在但默认不选中,停在账面量时 buildLab 一次都不跑(第三档出不出现也不靠它)', async () => {
    const w = await mountScreen()
    const tabs = w.findAll('.pma-seg [role="tab"]')
    expect(tabs.map(t => t.text())).toEqual(['按装机比', '去向和收益', '核对明细'])
    expect(tabs.find(t => t.text() === '去向和收益')!.attributes('aria-selected')).toBe('true')
    expect(vi.mocked(buildLab)).not.toHaveBeenCalled()
    await toSection(w, '按装机比')
    await pickFirstFolded(w)
    expect(vi.mocked(buildLab)).not.toHaveBeenCalled()
    // 段旁说明句是大白话(§1 #1),不写统计量
    expect(w.find('.pma-seghint').text()).toBe('按装机比看每千瓦发多少；核对明细看抄表齐不齐、名次稳不稳')
  })

  it('第二道:点进去只算一次;切走之后换选中、换月,一次都不再算', { timeout: 30_000 }, async () => {
    const w = await mountScreen()
    await toSection(w, '核对明细')
    expect(vi.mocked(buildLab)).toHaveBeenCalledTimes(1)
    await toSection(w, '去向和收益')
    expect(w.findComponent(PvAlphaBars).exists()).toBe(false)
    await pickFirstFolded(w)
    usePeriod().setMonth(7)
    await flushPromises()
    expect(vi.mocked(buildLab)).toHaveBeenCalledTimes(1)
  })

  it('常年水平条点击换上面的主图;「碰巧更偏」打乱的月跟着期间走并写在核对表表脚', { timeout: 30_000 }, async () => {
    const w8 = await mountScreen({ month: 8 })
    await toSection(w8, '核对明细')
    expect(w8.findComponent(PvLabTable).props('winMonth')).toBe(8)
    expect(w8.findComponent(PvLabTable).text()).toContain('「碰巧更偏」：8月日子打乱重算 1000 次里更偏的次数')
    expect(w8.find('.pma-sec').text(), '窗口已跟着期间走,屏上不许再写「最后 30 天」').not.toContain('最后 30 天')
    w8.findComponent(PvAlphaBars).vm.$emit('pick', 2)
    await flushPromises()
    expect(chartName(w8)).toBe('S2')
    expect(w8.find('.fp-dwr').exists()).toBe(false)

    boot()
    const w7 = await mountScreen({ month: 7 })
    await toSection(w7, '核对明细')
    expect(w7.findComponent(PvLabTable).props('winMonth')).toBe(7)
  })
})

describe('光伏分栋分析 · 主卡:刻度、事实句与判据脚', () => {
  beforeEach(boot)

  it('月段:大图横轴画满当月 1…31;年段换成 12 个月,连续段那条改按月计、不划掉', async () => {
    const w = await mountScreen()
    const xs = w.findAll('.pdc text.ax').map(t => t.text())
    expect(xs[0]).toBe('1')
    expect(xs[xs.length - 1]).toBe('31')
    expect(w.find('.pma-b2').text()).toContain('连着 3 天偏离算一次')

    boot()
    const y = await mountScreen({ gran: 'year' })
    expect(y.findAll('.pdc text.ax')).toHaveLength(12)
    expect(y.find('.pma-b2').text()).toContain('连着 3 个月偏离算一次')
    expect(y.find('.pma-b2').text()).not.toContain('年档不出此判据')
    // ❗年档芯片徽标数的是月,单位写「个月」
    expect(y.find('.pvc > button.chip .bd').text()).toMatch(/^\d+ 个月$/)
  })

  // 2026-10-06 改稿:B7 卡下的长图注(含「数据到」)换成读数句 + 参照;数据到哪个月看工具条
  it('❗年中打开年档(数据只到 8/20):横轴仍画满 12 个月,B7 画未到淡区;发电最低那个月不拿还没到的月算', async () => {
    const y = await mountScreen({ gran: 'year', through: '2026-08-20' })
    expect(y.findAll('.pdc text.ax').map(t => t.text())).toEqual(Array.from({ length: 12 }, (_, i) => `${i + 1}月`))
    expect(y.findAll('.pcs-xl')).toHaveLength(12)
    expect(y.find('.pcs-future').exists()).toBe(true)
    expect(y.find('.pma-sec .ana-read').text()).toMatch(/最低 [1-8]月 /)
  })

  it('❗今天晚于最后一条抄表(今天 8/20、数据到 8/15):工具条写到 8 月', async () => {
    const w = await mountScreen({ through: '2026-08-15', today: '2026-08-20' })
    expect(w.find('.anx-asof-text').text()).toBe('分栋抄表 2026年1–8月 · 光伏月账到 2026年9月')
  })

  it('判据脚:三条当前值原文 + 平时范围拿哪段估 + 去改深链 + 末尾「全园一起少发时，这张图看不出来」', async () => {
    const w = await mountScreen()
    const b2 = w.find('.pma-b2')
    const rows = b2.findAll(':scope > .pma-b2-r')
    expect(rows).toHaveLength(2)
    expect(rows[0].findAll(':scope > span').map(s => s.text())).toEqual([
      '平时范围：常见水平上下各放 2 份正常起伏', '连着 3 天偏离算一次', '抄够 90% 才判',
    ])
    expect(rows[0].element.lastElementChild!.textContent).toBe('去改')
    expect(rows[1].find('.base').text()).toMatch(/^平时范围按 /)
    expect(rows[1].element.lastElementChild!.textContent).toBe('全园一起少发时，这张图看不出来')
    expect(b2.find('.pma-lk').text()).toBe('去改')
    await b2.find('.pma-lk').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/params', query: { adopt: '2026-12', section: 'pv' } })
    const q = (push.mock.calls[0][0] as { query: Record<string, string> }).query
    expect(q).not.toHaveProperty('ym')
    expect(q).not.toHaveProperty('p')
  })

  it('范围是拿**段外**那一段估的,窗口写在判据脚里 —— 换一栋跟着换', async () => {
    const w = await mountScreen()
    await pickFirstFolded(w)
    const m = w.find('.pma-b2 .base').text().match(/^平时范围按 (\d+月\d+日)–(\d+月\d+日) 的 (\d+) 天算(，含\S+)?$/)
    expect(m, `判据脚的窗口不是「平时范围按 首–末 的 N 天算」: ${w.find('.pma-b2 .base').text()}`).not.toBeNull()
    expect(Number(m![3]), '窗口只取到当段之内就等于没有段外的范围').toBeGreaterThan(31)
  })

  it('参数取不到时回落默认线,屏照常出', async () => {
    vi.mocked(paramsApi.list).mockRejectedValue(new Error('boom'))
    const w = await mountScreen()
    expect(w.find('.pma-b2').text()).toContain('平时范围：常见水平上下各放 2 份正常起伏')
    expect(groups(w).shown.some(c => c.kind === 'hit')).toBe(true)
  })

  it('种入的断崖:事实句说低于平时几天、几段连着(2026-10-06 改稿:哪几天连着由段底色画,句里不写日子)', async () => {
    const w = await mountScreen()
    expect(w.find('.pdc-hd .fact').text()).toMatch(/^31 天低于平时，1 段连着$/)
    boot()
    const f7 = (await mountScreen({ month: 7 })).find('.pdc-hd .fact').text()
    expect(f7, '回看 7 月:断崖从 19 日起,这个月只数 13 天').toBe('13 天低于平时，1 段连着')
  })

  it('大图:带与中心线在,S4 出范围的点是低于色,段底色夹进绘图区', async () => {
    const w = await mountScreen()
    expect(w.find('.pdc rect.band').exists()).toBe(true)
    expect(w.find('.pdc path.ctr').exists()).toBe(true)
    const pts = w.findAll('.pdc circle.pt')
    expect(pts.length).toBeGreaterThan(20)
    expect(new Set(pts.map(p => p.attributes('fill')))).toEqual(new Set(['#E24B4A']))
    expect(w.findAll('.pdc rect.run')).toHaveLength(1)
  })

  it('❗主卡恒高:判据脚固定两行、每行钉高 16 不折行;没有可画的栋时占位块与大图同高;换选中 / 换年档都是两行', async () => {
    const s = readFileSync(join(__dirname, '../analysis/PvMeterAnaView.vue'), 'utf8')
    const css = s.slice(s.indexOf('<style'))
    const rule = (sel: string) => css.match(new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
    expect(rule('.pma-b2-r')).toMatch(/height:\s*16px/)
    expect(rule('.pma-b2-r')).toMatch(/overflow:\s*hidden/)
    expect(rule('.pma-b2-r')).toMatch(/white-space:\s*nowrap/)
    expect(css).not.toMatch(/flex-wrap:\s*wrap/)
    // 占位块的高不再写死在 CSS 里 —— 它按档跟着 PvDayChart 的画布走(桌面 236 → 260,窄档 200 → 224)。
    // 原来钉 CSS 文本那句有个毛病:写死多少它都绿,窄档对不上也看不出来(2026-09-20 对抗复查抓到:
    // 窄档真版式只有 224,而这句一直绿着)。改成钉「两档的值都在,且同一处下发」。
    const pvSrc = readFileSync(join(__dirname, '..', 'analysis', 'PvMeterAnaView.vue'), 'utf8')
    expect(pvSrc, '两档的高必须都在,且从同一处下发').toMatch(/narrow\.value \? '224px' : '260px'/)
    // 判据必须是容器宽,不是视口档 —— 图自己看的就是容器宽,两边用不同判据会在视口 488–600 分叉。
    expect(pvSrc, '占位块的档位判据要与图同源(容器宽)').toMatch(/mainW\.value < 420/)
    expect(pvSrc, '这个文件不该再按视口档判大图那块的高').not.toMatch(/tier\.value === 's' \? '2\d\dpx'/)
    expect(rule('.pma-nochart'), '高度改成内联下发后,CSS 里不该再留一个写死的高').not.toMatch(/height:\s*\d/)
    const w = await mountScreen()
    expect(w.findAll('.pma-b2 > .pma-b2-r')).toHaveLength(2)
    await pickFirstFolded(w)
    expect(w.findAll('.pma-b2 > .pma-b2-r')).toHaveLength(2)
    boot()
    const y = await mountScreen({ gran: 'year' })
    expect(y.findAll('.pma-b2 > .pma-b2-r')).toHaveLength(2)
    expect(y.findAll('.pma-b2 > .pma-b2-r')[0].text()).toContain('连着 3 个月偏离算一次')
  })

  it('大图画布高度恒定:整段录全与月中一样高(主卡恒高靠它)', async () => {
    const h = (await mountScreen()).find('.pdc svg').attributes('height')
    boot()
    expect((await mountScreen(MID)).find('.pdc svg').attributes('height')).toBe(h)
  })
})

describe('光伏分栋分析 · 月中未录全(§03.8)', () => {
  beforeEach(boot)

  it('覆盖率 = 已抄 ÷ **已过去**,93% ≥ 90% → 一栋都不读不出:判了全部 9 栋楼', async () => {
    const w = await mountScreen(MID)
    expect(kpi(w, DEV).d).toBe(`判了 ${N} 栋楼`)   // 0 栋历史不够不写后半句(S-28)
    expect(groups(w).shown.some(c => c.kind === 'unreadable')).toBe(false)
  })

  it('大图:漏抄那天折线断开 + 1 个底部刻度;未到只画淡底,不写「未到 / 漏」字', async () => {
    const w = await mountScreen(MID)
    // 折线按相邻两刻度一段画(换栋形变要同结构);连续段数 = 起点接不上前一段终点的段数
    const segs = lineSegs(w)
    expect(segs.length).toBeGreaterThan(1)
    expect(segs.filter((s, k) => k === 0 || s[0] !== segs[k - 1][2]).length).toBe(2)
    expect(w.findAll('.pdc rect.miss')).toHaveLength(1)
    expect(w.find('.pdc rect.future').exists()).toBe(true)
    expect(w.find('.pdc').text()).not.toMatch(/未到|漏/)
  })

  it('大图:未到那一段一个数据图元都没有 —— 不画点、不连线、绝不补 0', async () => {
    const w = await mountScreen(MID)
    const cut = Number(w.find('.pdc rect.future').attributes('x'))
    expect(cut).toBeGreaterThan(0)
    const cx = w.findAll('.pdc circle.pt').map(c => Number(c.attributes('cx')))
    expect(cx.length).toBeGreaterThan(0)
    expect(cx.every(x => x < cut)).toBe(true)
    const px = [...new Set(lineSegs(w).flatMap(s => [s[0], s[2]]))]
    expect(px).toHaveLength(14)
    expect(px.every(x => x < cut)).toBe(true)
  })

  it('整段录全时没有未到淡底,也没有缺抄刻度', async () => {
    const w = await mountScreen()
    expect(w.findAll('.pdc rect.future')).toHaveLength(0)
    expect(w.findAll('.pdc rect.miss')).toHaveLength(0)
  })

  it('抽屉明细表:未到的行不出现,漏抄的行出现、值为「—」+「没抄表」', async () => {
    const w = await mountScreen(MID)
    await openDrawer(w)
    const rows = w.findAll('.pv-b12 tbody tr')
    expect(rows).toHaveLength(15)
    const miss = rows.filter(r => r.classes('miss'))
    expect(miss).toHaveLength(1)
    expect(miss[0].findAll('td')[2].text()).toBe('—')
    expect(miss[0].findAll('td')[4].text()).toBe('没抄表')
  })

  it('命中 / 读不出 / 未投产三类芯片同屏:在网不足 90 天的栋读不出,本段没抄表的栋灰字禁用垫底', async () => {
    // S8 从 6/20 才有抄表(数据到 8/15,整年在网不到 90 天);S9 整段一条都没有
    const w = await mountScreen({ ...MID, late: { 7: '2026-06-20', 8: '2026-09-01' } })
    const g = groups(w)
    expect(g.shown.map(c => [c.name, c.kind])).toEqual([['S4', 'hit'], ['S8', 'unreadable']])
    expect(g.folded[g.folded.length - 1]).toMatchObject({ name: 'S9', kind: 'unborn', clickable: false })
    expect(kpi(w, DEV).d).toBe('判了 7 栋楼，1 栋历史不够')   // 已投产 8 栋(S9 没投产)− 历史不够的 S8
    expect(w.find('.pvc > button.chip .bd').exists()).toBe(true)
    expect(w.findAll('.pvc > button.chip')[1].text()).toBe('S8历史不够')
    expect(w.find('.pma-main .ana-ref').text()).toMatch(/^S8读数从6月20日起，还差 \d+ 天满 90 天$/)
    // 读不出的栋照样点得动(§6.3 点任意一栋都能看)
    await w.findAll('.pvc > button.chip')[1].trigger('click')
    await flushPromises()
    expect(chartName(w)).toBe('S8')
    // ❗选中读不出的栋:事实句只写原因,大图不出判据画面
    expect(w.find('.pdc-hd .fact').text()).toMatch(/^在网 \d+ 天，不足 90 天$/)
    expect(w.findComponent(PvDayChart).props('unreadable')).toBe(true)
    expect(w.findAll('.pdc circle.pt')).toHaveLength(0)
    expect(w.findAll('.pdc rect.run')).toHaveLength(0)
    await w.find('.pvc button.more').trigger('click')
    const s9 = w.findAll('.pvc-pop button.chip').find(b => b.text().includes('S9'))!
    expect(s9.attributes('disabled')).toBeDefined()
    // disabled 只挡住了芯片按钮;A2 行 / α 条 emit 未投产的 id 要靠 pickStation 挡 —— 选中栋不变
    await toSection(w, '按装机比')
    w.findComponent(PvAnchorBars).vm.$emit('pick', 9)
    await flushPromises()
    expect(w.findComponent(PvAnchorBars).props('selId')).toBe(8)
    expect(chartName(w)).toBe('S8')
  })
})

describe('光伏分栋分析 · 0 命中', () => {
  beforeEach(boot)

  it('KPI 五瓦照常,连着偏离 0 栋;芯片没有命中,大图停在零散偏离天数最多的那栋;主卡计数句不出、位置留着', async () => {
    const w = await mountScreen({ crash: false })
    expect(w.findAll('.anx-kpis .av2-kpi').map(k => k.find('.l').text())).toEqual(KPI_LABELS)
    expect(kpi(w, DEV).v).toBe('0 栋')
    expect(groups(w).shown.some(c => c.kind === 'hit')).toBe(false)
    expect(w.find('.pdc svg').exists()).toBe(true)
    const all = [...groups(w).shown, ...groups(w).folded]
    expect(all.find(c => c.selected)!.outDays).toBe(Math.max(...all.map(c => c.outDays)))
    expect(w.find('.pma-main .ana-read').classes()).toContain('hold')
    expect(w.find('.pma-main .ana-read').text()).toBe('')

    boot()
    const hit = await mountScreen()
    expect(kpi(hit, DEV).v).toBe('1 栋')
    expect(hit.find('.pma-main .ana-read').text()).toBe('8月有 1 栋楼连着 3 天偏离平时')
  })
})

describe('光伏分栋分析 · 文案(§05)', () => {
  beforeEach(boot)

  const BAD = ['异常', '需关注', '严重', '健康', '良好', '疑似', '建议', '应发',
    '缺口', '损失', '比应得少', '现场检查', '可安排清洗', '误报']
  // 任何档都不写统计名词(V4 §0 作废了「只在高级分析档出现」那条)
  const STAT = /σ|置信|块自助|自相关|零假设|标准差|z\s*分数|BH-FDR|N_eff|p\s*值|q\s*值|\bp\s*[<≤=]|\bq\s*[<≤=]|导出的 CSV/

  const scan = (t: string, where: string) => {
    expect(t.length, `${where} 一个字都没抓到,这条是空跑`).toBeGreaterThan(50)
    for (const b of BAD) expect(t, `${where} 出现了「${b}」`).not.toContain(b)
    expect(t, `${where} 出现了统计名词`).not.toMatch(STAT)
    expect(t, `${where} 提了设计稿`).not.toMatch(/设计稿|画板|画布/)
  }

  it('三档 + 抽屉:没有判词、建议、统计名词', { timeout: 30_000 }, async () => {
    const w = await mountScreen()
    scan(bodyText(w), '去向和收益')
    await toSection(w, '按装机比')
    scan(bodyText(w), '按装机比')
    await toSection(w, '核对明细')
    scan(bodyText(w), '核对明细')
    await openDrawer(w)
    scan(bodyText(w), '抽屉')
  })

  it('说明写的是这张图在画什么:卡头写覆盖 · 和谁比 · 单位;按装机比的分母那句(都录了板数不出,一栋没录才说)', async () => {
    const w = await mountScreen()
    expect(w.find('.pma-main .hint').text()).toBe(`判了 ${N} 栋楼 · 和全园中间那栋比 · 天`)
    const sec = () => w.findAll('.pma-sec .av2-grid > .av2-card')
    expect(sec()[0].find('.hint').text()).toBe(`全部 ${N} 栋楼合计 · 万kWh`)
    expect(sec()[1].find('.hint').text()).toBe(`全部 ${N} 栋楼 · 按合计排 · 万元`)
    await toSection(w, '按装机比')
    expect(sec()[0].findAll('.ana-ref')).toHaveLength(0)   // 夹具每栋都录了板数
    expect(sec()[1].findAll('.ana-ref').map(p => p.text())[0]).toBe('合格线一年 807.5 kWh，摊到每天 2.21 kWh')
    boot()
    const bare = await mountScreen({ stations: stationsFx.map(s => ({ ...s, panelCount: null, panelWatt: null })) })
    await toSection(bare, '按装机比')
    const cards = bare.findAll('.pma-sec .av2-grid > .av2-card')
    expect(cards[0].findAll('.ana-ref').map(p => p.text())).toEqual([`按台账装机算，全部 ${N} 栋楼都没录板数`])
    // 一栋都没录板数:台账卡收成一行 +「去录入 →」(画板 m-abs)
    expect(cards[2].find('.pls-empty').text()).toBe(`全部 ${N} 栋楼都没录板数，录了才画得出和台账对不对得上去录入 →`)
    expect(cards[2].find('.pls-svg').exists()).toBe(false)
  })

  it('❗外壳不出对比开关:屏上没有任何同比显示,可点却什么都不变的开关不给', async () => {
    const w = await mountScreen()
    expect(w.find('.anx-cmp').exists()).toBe(false)
    expect(w.find('.anx-period').exists(), '期间选择器应该在,这条才不是空跑').toBe(true)
  })
})

describe('光伏分栋分析 · 护栏', () => {
  beforeEach(boot)

  it('整年无抄表 → 空态深链,不画 KPI、芯片、图', async () => {
    const w = await mountScreen({ readings: [] })
    expect(w.text()).toContain('2026 年暂无分栋抄表记录')
    expect(w.findAll('.av2-kpi')).toHaveLength(0)
    expect(w.findComponent(PvChips).exists()).toBe(false)
    expect(w.findComponent(PvDayChart).exists()).toBe(false)
  })

  it('❗这一段一栋都没投产 → 大图那块换成空状态件 FPEmpty(十件 ⑦),高度仍钉在大图那块', async () => {
    const late = Object.fromEntries(Array.from({ length: N }, (_, i) => [i, '2026-09-01']))
    const w = await mountScreen({ late })
    expect(w.find('.pma-body').exists(), '夹具没走到有快照的分支').toBe(true)
    expect(w.findComponent(PvDayChart).exists()).toBe(false)
    const box = w.find('.pma-main .pma-nochart')
    expect(box.attributes('style')).toContain('height: 260px')
    expect(box.find('.fp-empty .t').text()).toBe('这一段还没有楼有读数。')   // 不写「逐刻度比值」这类行话
  })

  it('❗上一年和这一年同一趟取(屏顶比去年、新卡比去年那列都要它);切档不再打', async () => {
    const w = await mountScreen()
    const years = () => vi.mocked(pvMeterApi.readingsYear).mock.calls.map(c => c[0]).filter(y => y >= 2025)
    expect(years()).toEqual([2026, 2025])
    await toSection(w, '按装机比')
    await toSection(w, '核对明细')
    expect(years()).toEqual([2026, 2025])
  })

  it('❗上一年接口失败:这一年照常出;KPI 比去年那行写「—」,新卡不说「还没有分栋读数」;A2 写「上一年数据没取到」', async () => {
    const w = await mountScreen({ prevFail: true })
    expect(w.find('.pma-body').exists(), '上一年没取到不该把这一年也判失败').toBe(true)
    expect(kpi(w, '发电量').d).toMatch(/比7月\s*— 比去年8月$/)
    expect(w.find('.pma-pk').text()).not.toContain('还没有分栋读数')
    await toSection(w, '按装机比')
    // A2「比去年」那列写「—」;没取到不出「2025年没有分栋读数」角标(那是没读到,不是没有)
    const a = w.findComponent(PvAnchorBars)
    expect((a.props('data') as AnchorBars).rows.every(r => r.prev === '—')).toBe(true)
    expect(w.findAll('.pma-sec .pma-badge')).toHaveLength(0)
  })

  it('❗B6「去录入板数」落到能录板数的分栋运营账(mode=meter),不落汇总本', async () => {
    const w = await mountScreen()
    await toSection(w, '按装机比')
    w.findComponent(PvLedgerScatter).vm.$emit('record')
    expect(push).toHaveBeenCalledWith({ path: '/pv-income', query: { mode: 'meter' } })
  })
})

describe('光伏分栋分析 · 数据质量日历接线(L6)', () => {
  beforeEach(boot)

  const cellsOf = (w: VueWrapper) => w.findAll('.pqg g.pqg-cell')
  const kindOf = (w: VueWrapper, d: string) => cellsOf(w).find(c => c.attributes('data-date') === d)?.attributes('data-kind')

  it('月档铺满自然月 31 格、折成普通月历:7 列周一…周日,2026-08 周六开头共 6 行;图例写这一段', { timeout: 30_000 }, async () => {
    const w = await mountScreen({ month: 8 })
    await toSection(w, '核对明细')
    const cells = cellsOf(w)
    expect(cells).toHaveLength(31)
    expect(cells[0].attributes('data-date')).toBe('2026-08-01')
    expect(cells[30].attributes('data-date')).toBe('2026-08-31')
    expect(new Set(cells.map(c => c.find('rect.pqg-bg').attributes('x'))).size).toBe(7)
    expect(new Set(cells.map(c => c.find('rect.pqg-bg').attributes('y'))).size).toBe(6)
    expect(w.find('.pqg-leg .per').text()).toBe('2026 年 8 月')
  })

  it('❗月中打开 → 31 格一个不少;数据截止日(12 日)之后、今天(20 日)及之前是缺抄,今天之后才是「还没到」', { timeout: 30_000 }, async () => {
    const w = await mountScreen({ readings: readingsOf(2026).filter(r => r.readDate <= '2026-08-12'), month: 8, today: '2026-08-20' })
    await toSection(w, '核对明细')
    expect(cellsOf(w)).toHaveLength(31)
    expect(kindOf(w, '2026-08-05')).toBe('full')
    expect(kindOf(w, '2026-08-13')).toBe('miss')
    expect(kindOf(w, '2026-08-20')).toBe('miss')
    expect(kindOf(w, '2026-08-21')).toBe('todo')
  })

  it('未装表的栋不进日级分母,也不上缺抄榜 —— 整张日历不许因为它恒黄', { timeout: 30_000 }, async () => {
    const sts = stationsFx.map((s, i) => (i === 0 ? { ...s, metered: 0 } : s))
    const w = await mountScreen({ stations: sts, gran: 'year' })
    await toSection(w, '核对明细')
    const kinds = cellsOf(w).map(c => c.attributes('data-kind'))
    expect(kinds.filter(k => k === 'miss')).toHaveLength(0)
    expect(kinds.filter(k => k === 'full').length).toBeGreaterThan(300)
    expect(w.findAll('.pqg-mrow').map(r => r.find('.n').text())).not.toContain('S1')
  })

  it('四态分得开:全园一天没抄 = 缺抄,在网不足 3 栋 = 整日剔除;剔除那天气泡印「当天抄了几栋」', { timeout: 30_000 }, async () => {
    const rds = readingsOf(2026, { skip: ['2026-03-05'] })
      .filter(r => !(r.readDate === '2026-06-10' && r.stationId > 2))
    const w = await mountScreen({ readings: rds, gran: 'year' })
    await toSection(w, '核对明细')
    expect(kindOf(w, '2026-03-05')).toBe('miss')
    expect(kindOf(w, '2026-06-10')).toBe('drop')
    const kinds = cellsOf(w).map(c => c.attributes('data-kind'))
    expect(kinds.filter(k => k === 'drop')).toHaveLength(1)
    // 剔除日里所有在产栋都被判成 dropped,数格子数出来的是「在产几栋」;气泡必须取 onDay
    await cellsOf(w).find(c => c.attributes('data-date') === '2026-06-10')!.find('rect.pqg-hit').trigger('mouseenter')
    const tip = w.find('.pqg .cz-tip').text()
    expect(tip).toContain('当天抄了 2 栋')
    expect(tip).not.toContain(`当天抄了 ${N} 栋`)
  })

  it('全园在网不足 3 栋 → 印出「这条规则本段没生效」', { timeout: 30_000 }, async () => {
    const w = await mountScreen({ stations: stationsFx.slice(0, 2), readings: readingsOf(2026).filter(r => r.stationId <= 2) })
    await toSection(w, '核对明细')
    expect(cellsOf(w).filter(c => c.attributes('data-kind') === 'drop')).toHaveLength(0)
    expect(w.find('.pqg').text()).toContain('这条规则本段没生效')
  })
})

describe('光伏分栋分析 · 首进与换年的形状(C6-01 / C5-02 / C5-12)', () => {
  beforeEach(boot)

  const tick = (ms: number) => new Promise(r => setTimeout(r, ms))

  /** 整年抄表一直不回来 —— 停在首进那一帧 */
  async function mountPending() {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 2, 12, 0, 0))
    vi.mocked(pvMeterApi.stations).mockResolvedValue(stationsFx)
    vi.mocked(pvMeterApi.readingsYear).mockImplementation(() => new Promise<PvReadingDTO[]>(() => {}))
    vi.mocked(paramsApi.list).mockResolvedValue([])
    const w = mount(PvMeterAnaView, { global: { stubs: { RouterLink: true, teleport: true } } })
    mounted.push(w)
    await flushPromises()
    providePeriodMonths(['2026-07', '2026-08'], ['2026-08'])
    usePeriod().setYear(2026)
    usePeriod().setGran('month')
    usePeriod().setMonth(8)
    await flushPromises()
    return w
  }

  it('❗首进:不转圈,骨架逐块照真版式的高钉死;KPI 槽摆 5 张占位瓦', async () => {
    const w = await mountPending()
    expect(w.find('.pma-skel').exists(), '首进没出骨架').toBe(true)
    expect(w.find('.page-spin').exists(), '版式已知还在转圈').toBe(false)
    // 骨架的三块与真版式一一对应(真版式那条在「四个状态」里钉着)
    expect([...w.find('.pma-skel').element.children].map(e => e.className.split(' ').pop()))
      .toEqual(['pma-row1', 'pma-seg', 'pma-sec'])
    expect([...w.find('.pma-skel .pma-row1').element.children].map(e => e.className)).toEqual(['av2-card pma-main av2-s8', 'av2-card av2-s4 pma-pk'])
    // 块高 = 它顶替的那块的高(V4 §2.1 与代码里钉死的数;2026-09-16 起卡头、段控说明、账面量两张卡头照抄真版式):
    // 芯片行内条 26(行高 34 由 .pma-skel-chips 给)· 大图区 260 + 上距 12 = 272 · 判据脚 16 + 2 + 16
    // · 新卡画布 298(上 18 + 13 栋 × 20 + 下 20)· 图例 16 · 段控底条(宽高由里面隐形的真 Segmented 撑)
    // · B7 372 · B8 483(按月、桌面;2026-10-06 改稿长图注换成读数句 + 参照后浏览器实测,按库里 13 栋;按年 350 / 505 见下)
    expect(w.findAll('.pma-skel .fp-shim').map(e => (e.element as HTMLElement).style.height))
      .toEqual(['26px', '260px', '34px', '298px', '16px', '', '372px', '483px'])
    // 计数句、历史不够那句、新卡读数句与两句参照:骨架里同样留着空行(hold)
    expect(w.findAll('.pma-skel .pma-main p.hold')).toHaveLength(2)
    expect(w.findAll('.pma-skel .pma-pk p.hold')).toHaveLength(3)
    expect((w.findAll('.pma-skel .fp-shim')[1].element as HTMLElement).style.marginTop).toBe('12px')
    // 行高 34 与档内容器 1200 住在 scoped CSS 里,照本文件既有写法从源码读规则
    const t = readFileSync(join(__dirname, '../analysis/PvMeterAnaView.vue'), 'utf8')
    const css = t.slice(t.indexOf('<style'))
    const rule = (sel: string) => css.split(sel + ' {')[1]?.split('}')[0] ?? ''
    expect(rule('.pma-skel-chips')).toMatch(/height:\s*34px/)
    expect(rule('.pma-sec')).toMatch(/min-height:\s*1200px/)
    // 首进期摆 6 张「—」占位瓦(与真瓦同组件同栅格,换行行数一致)
    expect(w.find('.anx-kpis').exists()).toBe(true)
    expect(w.findAll('.anx-kpis .anx-kpi-hold')).toHaveLength(5)
    // 骨架还在时不亮进度线:loading 初值就是 true,门槛只对「屏上已有内容」的换期有意义
    expect(w.find('.fp-lb').exists()).toBe(false)
  })

  it('❗换年:.pma-body 不卸载、旧年内容留在原地,过 200ms 门槛才退让;数据到了原地换新', async () => {
    const w = await mountScreen()
    providePeriodMonths(['2025-08', '2026-07', '2026-08'], ['2026-08'])
    const body = w.find('.pma-body').element
    const before = bodyText(w)

    const held: (() => void)[] = []
    const release = () => { while (held.length) held.shift()!() }
    vi.mocked(pvMeterApi.readingsYear).mockImplementation((y: number) =>
      new Promise<PvReadingDTO[]>(res => { held.push(() => res(readingsOf(y, { crash: false }))) }))
    usePeriod().setYear(2025)
    await flushPromises()

    // ① 不卸载:同一个 DOM 节点、同样三块 —— 高度不变,CLS 0(今天是整棵卸载 → 240 转圈 → 撑回)
    expect(w.find('.pma-body').exists(), '.pma-body 在途期间被整棵卸载了').toBe(true)
    expect(w.find('.pma-body').element, '.pma-body 被卸载重挂了').toBe(body)
    expect([...body.children].map(e => e.className.split(' ').pop())).toEqual(['pma-row1', 'pma-seg', 'pma-sec'])
    expect(w.find('.pma-skel').exists(), '换年不该退回骨架').toBe(false)
    expect(w.find('.page-spin').exists()).toBe(false)
    expect(w.findAll('.anx-kpis .av2-kpi').map(k => k.find('.l').text()), 'KPI 瓦被清空了').toEqual(KPI_LABELS)
    // ② 旧图停在旧年:year 先变、readings 后到,中间一帧不许出现「新年刻度配旧年读数」
    expect(bodyText(w), '在途期间内容变了(snapInput 跟着 year 先换了)').toBe(before)
    // ③ 200ms 门槛:没到就不退让
    expect(w.find('.pma-body').classes()).not.toContain('fp-stale')
    await tick(260)
    await flushPromises()
    expect(w.find('.pma-body').classes()).toContain('fp-stale')
    expect(w.find('.pma-body').attributes('data-stale-host'), '没有 data-stale-host,退场会是硬切').toBeDefined()
    expect(w.find('.pma-body').attributes('aria-busy')).toBe('true')
    // ④ 进度线在 sticky 工具条上,是退让宿主的兄弟(放进去会被 opacity .42 + blur 一起糊掉)
    expect(w.find('.anx-tools > .fp-lb').exists(), '工具条上没有进度线').toBe(true)
    expect(w.find('.pma-body .fp-lb').exists(), '进度线跑进退让宿主里了').toBe(false)

    // ⑤ 数据到:原地换新,退让摘掉,还是同一个节点
    release()
    await flushPromises()
    expect(w.find('.pma-body').element).toBe(body)
    expect(w.find('.pma-body').classes()).not.toContain('fp-stale')
    expect(w.find('.fp-lb').exists()).toBe(false)
    expect(bodyText(w), '新数据到了内容没换').not.toBe(before)
  })

  it('❗换年:判据与读数同一句落地 —— 参数接口先回来不许把新年阈值配给旧年的图(C5-02 ①)', async () => {
    const w = await mountScreen()
    providePeriodMonths(['2025-08', '2026-07', '2026-08'], ['2026-08'])
    expect(w.find('.pma-b2').text(), '基线:默认 pv_band_sigma = 2').toContain('上下各放 2 份')

    const held: (() => void)[] = []
    const release = () => { while (held.length) held.shift()!() }
    vi.mocked(pvMeterApi.readingsYear).mockImplementation((y: number) =>
      new Promise<PvReadingDTO[]>(res => { held.push(() => res(readingsOf(y, { crash: false }))) }))
    // 参数接口(几条行)永远比整年抄表(几千条)先回来,且新年的范围倍数是 3
    vi.mocked(paramsApi.list).mockResolvedValue([{ key: 'pv_band_sigma', scope: '', value: 3 }] as unknown as ParamRowDTO[])
    usePeriod().setYear(2025)
    await flushPromises()
    // 判据脚、带上下沿、出范围天数、芯片颜色全由 crit 算 —— 读数还没到就不许换
    expect(w.find('.pma-b2').text(), '参数先到就把新年判据配给了旧年的图').toContain('上下各放 2 份')
    release()
    await flushPromises()
    expect(w.find('.pma-b2').text(), '读数落地了判据没跟着换').toContain('上下各放 3 份')
  })
})

// 2026-10-06 改稿第一排与屏顶:比较做成真功能(上一年读数照取,有数就算)、上网单价读参数、按年合格线画进新卡
describe('光伏分栋分析 · 改稿第一排(KPI 五瓦 / 新卡 / 工具条 / 上网单价)', () => {
  beforeEach(boot)

  it('❗KPI 副行两行:比上月 + 比去年同月;上一年有读数(夹具 2025 年整年)就出数', async () => {
    const w = await mountScreen()
    const d = w.findAll('.av2-kpi').find(k => k.find('.l').text() === '发电量')!.findAll('.d .dl, .d .dk').map(e => e.text())
    expect(d).toHaveLength(4)
    expect(d[0]).toMatch(/^[+−]\d+\.\d%$/)
    expect(d[1]).toBe('比7月')
    expect(d[2]).toMatch(/^[+−]\d+\.\d%$/)
    expect(d[3]).toBe('比去年8月')
    expect(kpi(w, '每千瓦日均').d).toContain(`同 ${N} 栋楼比7月`)
  })

  it('❗新卡:一栋一行,按月两列比7月 / 比去年8月;按年换成在网 / 比2025年,并画合格线(按月不画)', async () => {
    const w = await mountScreen()
    const svg = () => w.find('.pma-pk svg')
    expect(w.findAll('.pma-pk g.ppk-row')).toHaveLength(N)
    expect(svg().text()).toContain('比7月')
    expect(svg().text()).toContain('比去年8月')
    expect(w.find('.pma-pk .ppk-anchor').exists()).toBe(false)
    expect(w.find('.pma-pk .hint').text()).toBe(`全部 ${N} 栋楼 · 和7月、去年同月比 · kWh`)
    usePeriod().setGran('year')
    await flushPromises()
    expect(svg().text()).toContain('在网')
    expect(svg().text()).toContain('比2025年')
    expect(w.find('.pma-pk .ppk-anchor').exists()).toBe(true)
    expect(svg().text()).toContain('合格线 2.21（一年 807.5）')
    // 按年「按装机比」拿掉合格线卡(用户 10-06「按推荐」):合格线已画进新卡
    await toSection(w, '按装机比')
    expect(w.findComponent(PvAnchorBars).exists()).toBe(false)
    usePeriod().setGran('month')
    await flushPromises()
    expect(w.findComponent(PvAnchorBars).exists()).toBe(true)
  })

  it('❗第一排换期间不变形:新卡读数句钉两行、参照两行(没有的那句留空行)', async () => {
    const w = await mountScreen()
    expect(w.find('.pma-pk .ana-read').classes()).toContain('pma-pk-read')
    expect(w.findAll('.pma-pk .ana-ref')).toHaveLength(2)
    usePeriod().setGran('year')
    await flushPromises()
    expect(w.findAll('.pma-pk .ana-ref')).toHaveLength(2)
    const t = readFileSync(join(__dirname, '../analysis/PvMeterAnaView.vue'), 'utf8')
    const css = t.slice(t.indexOf('<style'))
    expect(css.split('.pma-pk-read {')[1]?.split('}')[0]).toMatch(/min-height:\s*2lh/)
  })

  it('❗上网单价读计费参数 pv_grid_price,按读数所在的月取(这一年和上一年各 12 个月);没读到不拿常数顶 —— 收益写「—」、参照写明', async () => {
    const w = await mountScreen()
    const asked = vi.mocked(elecCostApi.priceCfg).mock.calls.map(c => c[0])
    expect(asked).toContain('2026-08')
    expect(asked).toContain('2025-08')
    expect(asked).toHaveLength(24)
    expect((w.findComponent(PvRevenueBars).props('data') as { gridPrice: number }).gridPrice).toBe(0.453)
    expect(kpi(w, '自用和上网收益').v).toMatch(/^¥\d+\.\d万$/)
    boot()
    const impl = vi.mocked(elecCostApi.priceCfg).getMockImplementation()!
    vi.mocked(elecCostApi.priceCfg).mockRejectedValue(new Error('boom'))
    try {
      const w2 = await mountScreen()
      expect((w2.findComponent(PvRevenueBars).props('data') as { gridPrice: number | null }).gridPrice).toBeNull()
      expect(kpi(w2, '自用和上网收益').v).toBe('—')
      expect(w2.find('.pma-sec').text()).toContain('上网单价没读到，这几个月的上网收益没算')
      expect(w2.find('.pma-sec').text()).not.toContain('¥0.4/kWh')
    } finally { vi.mocked(elecCostApi.priceCfg).mockImplementation(impl) }
  })

  it('❗去向和收益(按月):卡名、读数句、参照全走句型库 —— 上网电量比上月;按几栋几条抄表算;上网单价读参数', async () => {
    const w = await mountScreen()
    const cards = w.findAll('.pma-sec .av2-grid > .av2-card')
    expect(cards.map(c => c.find('.av2-card-h .t').text())).toEqual(['自用、上网和损耗', '各栋自用和上网收益'])
    expect(cards[0].find('.ana-read').text()).toMatch(/^7月→8月 上网电量(增长|下降) \d+\.\d%$/)
    const aug = readingsOf(2026).filter(r => r.readDate.startsWith('2026-08')).length
    expect(cards[0].findAll('.ana-ref').map(p => p.text())).toEqual([`按全部 ${N} 栋楼 ${aug} 条抄表算`, '损耗是发电减去自用和上网剩下的，没记原因'])
    expect(cards[1].find('.ana-read').text()).toMatch(/^收益最高 .+ ¥\d+\.\d万，最低 .+ ¥\d+\.\d万$/)
    expect(cards[1].findAll('.ana-ref').map(p => p.text())).toEqual(['上网按系统里的上网单价 ¥0.453/kWh 算', '自用按录入时的单价算'])
    expect(w.find('.pma-sec').text()).not.toMatch(/万度|路上损掉|消纳/)
  })

  it('❗去向和收益(按年):发电最高最低的月 + 柱顶两个气泡;某期年中才并网 → 柱顶「二期并网」、收益参照说它只有几月', async () => {
    const late = Object.fromEntries([5, 6, 7, 8].map(i => [i, '2026-06-01']))
    const w = await mountScreen({ late, gran: 'year' })
    const cards = w.findAll('.pma-sec .av2-grid > .av2-card')
    expect(cards[0].find('.ana-read').text()).toMatch(/^发电最高 \d+月 [\d.]+万kWh，最低 \d+月 [\d.]+万kWh$/)
    expect(cards[0].findAll('.pcs-callout')).toHaveLength(2)
    expect(cards[0].findAll('.ana-ref').map(p => p.text())).toEqual(['损耗是发电减去自用和上网剩下的，没记原因'])
    expect(cards[0].findAll('text.pcs-join').map(t => t.text())).toEqual(['二期并网'])
    expect(cards[1].findAll('.ana-ref').map(p => p.text())[2]).toBe('二期只有 6–12月')
  })

  it('工具条:分栋抄表写年内范围,光伏月账到哪个月', async () => {
    const w = await mountScreen()
    expect(w.find('.anx-asof-text').text()).toBe('分栋抄表 2026年1–12月 · 光伏月账到 2026年9月')
  })
})
