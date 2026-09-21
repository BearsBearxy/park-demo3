// 电费成本结构在 S 档的并档(P2 屏板 2026-09-20)。
//
// 总表电费结构是 9 段堆叠柱:390 宽的卡里柱子约 14px,最小的那段只剩 2px 级,
// 九行图例还会把绘图区挤没。S 档改成「全年正向合计 Top3 单列 + 其余按符号并两段」。
// 会坏的是三件事,断言逐条钉:
//   ① >600 一段都不许并 —— 桌面零差异;
//   ② S 档并完段数掉下来,且并出来的抵减段逐月 ≤0(正负混加会把零轴下方那两段吃进柱高,
//      屏上读到的柱顶就不再是读数句印的那个分母);
//   ③ 读数句点名的段,图例上一定找得到 —— 句与图取的是同一份列(structCols)。
// 挂屏不起 echarts:AnaEChart 换桩,option 是 computed,传 prop 时照样求值。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { ElecCostEntryDTO, ElecMeterDTO, ElecMetricsMonthDTO, ElecPriceCfgDTO } from '@/api/elecCost'
import ElecAnalysisView from './ElecAnalysisView.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))
vi.mock('@/components/ana/AnaEChart.vue', () => ({
  default: { name: 'AnaEChart', props: ['option', 'height'], template: '<div class="stub-chart" />' },
}))
vi.mock('@/analysis/anaData', async (orig) => {
  const a = await orig<typeof import('@/analysis/anaData')>()
  return { ...a, fetchAvailableMonths: vi.fn(async () => ({ months: MONTHS, sources: {} })) }
})
vi.mock('@/api/elecCost', () => ({
  elecCostApi: {
    meters: vi.fn(async (): Promise<ElecMeterDTO[]> => METERS),
    metricsYear: vi.fn(async (): Promise<ElecMetricsMonthDTO[]> => []),
    entries: vi.fn(async (y: number, m: number): Promise<ElecCostEntryDTO[]> => entriesOf(y, m)),
    priceCfg: vi.fn(async (): Promise<ElecPriceCfgDTO[]> => []),
  },
}))

const YEAR = 2026
const MONTHS = Array.from({ length: 12 }, (_, i) => `${YEAR}-${String(i + 1).padStart(2, '0')}`)
const METERS: ElecMeterDTO[] = [
  { id: 1, name: '一期总表', kind: 'master', sortNo: 1 },
  { id: 2, name: '二期总表', kind: 'master', sortNo: 2 },
  { id: 3, name: '宿舍表', kind: 'dorm', sortNo: 3 },
  { id: 4, name: '运营表', kind: 'ops', sortNo: 4 },
]
// 九段都给非零值,量级拉开(不退化成常数):三大段远大于其余,抵减两段录成正金额、展示取负。
const FEES: { meterId: number; feeKey: string; base: number }[] = [
  { meterId: 1, feeKey: 'tou_industrial', base: 4_400_000 },   // 一期·分时
  { meterId: 1, feeKey: 'basic_industrial', base: 2_100_000 }, // 一期·基本
  { meterId: 1, feeKey: 'commercial', base: 300_000 },         // 一期·商业
  { meterId: 2, feeKey: 'tou_industrial', base: 900_000 },     // 二期·分时
  { meterId: 2, feeKey: 'basic_industrial', base: 200_000 },   // 二期·基本
  { meterId: 3, feeKey: 'usage', base: 250_000 },              // 宿舍
  { meterId: 4, feeKey: 'usage', base: 180_000 },              // 运营净额(正部分)
  { meterId: 4, feeKey: 'allocated', base: 60_000 },           // 运营净额(减项)
  { meterId: 1, feeKey: 'pf_reward', base: 120_000 },          // 抵减①
  { meterId: 1, feeKey: 'pv_grid_income', base: 340_000 },     // 抵减②
]
// 12 月刻意把三大段压到很小:该月**原始**最大的一段变成「一期·商业」,而它不在全年 Top3 里。
// 读数句取的是最新有费项的月(= 12 月),所以这一个月就是「句点名的段在图例上找不到」的现场 ——
// 不造这个月的话,月最大段恒等于年第一段,第三条用例换成读原始九段也照样绿(实测过)。
const M12_SMALL: Record<string, number> = {
  '1:tou_industrial': 100_000,
  '1:basic_industrial': 50_000,
  '2:tou_industrial': 20_000,
}
const entriesOf = (y: number, m: number): ElecCostEntryDTO[] =>
  FEES.map((f, i) => {
    const small = m === 12 ? M12_SMALL[`${f.meterId}:${f.feeKey}`] : undefined
    return {
      id: m * 100 + i,
      meterId: f.meterId,
      meterName: METERS.find((x) => x.id === f.meterId)!.name,
      acctMonth: `${y}-${String(m).padStart(2, '0')}`,
      feeKey: f.feeKey,
      subKey: '',
      amount: small ?? Math.round(f.base * (1 + 0.08 * Math.sin(m))),   // 逐月起伏,不是常数
      qty: null,
      note: null,
      source: 'manual',
    }
  })

/** 只让 max-width: 600px 命中(其它媒体查询一律不中),与 motionR2 各 spec 的 asS 同形 */
const asS = () => vi.stubGlobal('matchMedia', (q: string) =>
  ({ matches: q.includes('max-width: 600px'), media: q, addEventListener() {}, removeEventListener() {} }))

interface SeriesLike { name: string; data: (number | null)[] }
/** 总表电费结构那张卡 —— 按卡头标题取,不按下标:另外两张图(趋势 / 价差)吃的是本 spec 没喂的
 *  metricsYear / priceCfg,它们走空态时下标会整个错位。 */
async function structCard() {
  const w = mount(ElecAnalysisView, { global: { stubs: { RouterLink: true } } })
  await flushPromises()
  // 结论条也是 .av2-card,它没有卡头 —— 先 exists() 再取字,别在空 wrapper 上调 text()
  const card = w.findAll('.av2-card').find((c) => {
    const t = c.find('.av2-card-h .t')
    return t.exists() && t.text() === '总表电费结构'
  })
  expect(card, '找不到「总表电费结构」那张卡 —— 夹具退化到空态了').toBeTruthy()
  return card!
}
async function structSeries(): Promise<SeriesLike[]> {
  const card = await structCard()
  const chart = card.findComponent({ name: 'AnaEChart' })
  expect(chart.exists(), '结构卡里没有图').toBe(true)
  return (chart.props('option') as { series: SeriesLike[] }).series
}
const readText = async (): Promise<string> => (await structCard()).find('.ana-read').text()

describe('总表电费结构 · S 档并档', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.unstubAllGlobals())

  it('>600:九段原样,一段不并(桌面零差异)', async () => {
    const s = await structSeries()
    expect(s).toHaveLength(9)
    expect(s.map((x) => x.name)).toContain('功率因数奖励(抵减)')
    expect(s.map((x) => x.name)).toContain('光伏上网收益(抵减)')
  })

  it('❗S 档:并成 Top3 + 「其余 N 项」+「抵减 M 项」,抵减那段逐月 ≤0', async () => {
    asS()
    const s = await structSeries()
    expect(s.length, '并完还剩这么多段,390 宽的柱子分不动').toBeLessThanOrEqual(5)
    // Top3 = 全年正向合计前三:一期·分时 440 万 / 一期·基本 210 万 / 二期·分时 90 万
    expect(s.slice(0, 3).map((x) => x.name)).toEqual(['一期·分时', '一期·基本', '二期·分时'])
    const rest = s.find((x) => x.name.startsWith('其余'))!
    const minus = s.find((x) => x.name.startsWith('抵减'))!
    expect(rest, '并出来的正向段不见了').toBeTruthy()
    expect(minus, '并出来的抵减段不见了 —— 正负被混加进一段了').toBeTruthy()
    // 段名里的计数是「真有过正 / 负值的那几段」,不是 9−3 一刀切
    expect(rest.name).toBe('其余 4 项')
    expect(minus.name).toBe('抵减 2 项')
    for (const v of minus.data) expect(v == null || v <= 0, `抵减段出现正值 ${v}`).toBe(true)
    for (const v of rest.data) expect(v == null || v >= 0, `其余段出现负值 ${v}`).toBe(true)
  })

  it('❗S 档读数句点名的段,图例上找得到(句与图同取 structCols)', async () => {
    asS()
    const names = (await structSeries()).map((x) => x.name)
    // 夹具的现场:12 月原始最大段是「一期·商业」,并档之后它被收进「其余 4 项」、图例上没有它。
    // 句子若还去读原始九段,印出来的就是这个找不到的名字。
    expect(names, '夹具退化了:被并走的那一段还在图例里,这条测不出错位').not.toContain('一期·商业')
    const text = await readText()
    expect(text, `读数句点名的段不在图例 [${names.join(' | ')}] 里`).toContain('其余 4 项')
  })
})
