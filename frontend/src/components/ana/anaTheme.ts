// src/components/ana/anaTheme.ts — ECharts 统一浅色主题 fpAnaTheme(spec §一)。
// 色板:蓝族主色 + teal/coral/amber 辅助 + 语义红;白底、细网格(var(--divider) 观感)、
// tooltip 深底白字沿 .cz-tip 观感(背景 rgb(40,52,66)、圆角 9、字号 11)。
// 主题为纯 JSON,无法引用 CSS 变量 → 取 tokens.css 字面值(--divider=ink-100、--text-muted)。

import { quantile } from './anaFmt'

// ⚠ 必须与 tokens.css 的 --font-sans 逐字一致(ECharts 主题是纯 JSON,引不了 CSS 变量)。
// 不同步的话图表轴标签/图例会和页面其余部分不是同一个字体,并排一看就出戏。
// 2026-08-20 同步:此处曾停在 "Roboto Mono"(旧值),而 tokens.css 早已改为 "Roboto Mono Digits"。
// tokens.css 里写明了为什么换:整族 Roboto Mono 会把拉丁**字母**也变等宽,实测同串 16px 文本
// 163.2px vs 系统 sans 149.9px = +9%。于是图表里的 kWh / Top20 / 2025-01 是等宽、页面上是比例,
// 并排一看就出戏 —— 正是本文件头注释警告的那种不同步。Digits 版只接管 0-9,其余回退系统栈。
const FONT_SANS = '"Roboto Mono Digits", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif'
const GRID_LINE = 'rgba(28,28,28,.1)'     // var(--divider) 观感
const AXIS_LINE = 'rgba(28,28,28,.15)'
const AXIS_LABEL = 'rgba(28,28,28,.62)'   // var(--text-muted) 观感

/** 分类色板 —— 色相互不相同,给「各充电桩 / 各运营商 / 各费项」这类**无序类目**用。
 *
 *  为什么不能用下面主题默认的 color:它前 4 位是蓝族渐变(#378ADD→#85B7EB→#B5D4F4→#185FA5),
 *  那是**顺序色板**,给「期区 1/2/3」这类有序量用的 —— 实测这 4 个蓝两两对比度最低只有 1.37
 *  (#85B7EB vs #B5D4F4),堆在一起勉强能看出分界,但用来区分互不相干的类目就读不出谁是谁。
 *  首位仍是 #378ADD,与主题同起点,单系列图换不换色板外观一致。
 *  取色全部来自主题既有 8 色,不引入新色相,只是**重排成色相优先**。 */
export const CAT_COLORS = ['#378ADD', '#EF9F27', '#5DCAA5', '#E24B4A', '#F0997B', '#185FA5', '#85B7EB', '#B5D4F4']

export const FP_ANA_THEME = {
  // ⚠ 前 4 位是蓝族**渐变**(顺序色板),只适合有序量(期区 1/2/3、档位高低)。
  //   互不相干的类目请显式传 CAT_COLORS,别吃这个默认值。
  color: ['#378ADD', '#85B7EB', '#B5D4F4', '#185FA5', '#5DCAA5', '#F0997B', '#EF9F27', '#E24B4A'],
  backgroundColor: 'transparent',
  textStyle: { fontFamily: FONT_SANS },
  categoryAxis: {
    axisLine: { lineStyle: { color: AXIS_LINE } },
    axisTick: { show: false },
    axisLabel: { color: AXIS_LABEL, fontSize: 11 },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: AXIS_LABEL, fontSize: 11 },
    splitLine: { lineStyle: { color: GRID_LINE } },
  },
  legend: { textStyle: { color: 'rgba(28,28,28,.8)', fontSize: 11 }, itemWidth: 11, itemHeight: 11 },
  tooltip: {
    backgroundColor: 'rgb(40,52,66)',
    borderWidth: 0,
    borderRadius: 9,
    padding: [8, 11],
    textStyle: { color: '#fff', fontSize: 11 },
    extraCssText: 'box-shadow:0 8px 24px rgba(0,0,0,.18);',
  },
}

let registered = false
/** 注册 fpAnaTheme(幂等)。echarts 由 AnaEChart 动态 import 后传入,保持懒加载 chunk 分割。 */
export function registerFpAnaTheme(ec: { registerTheme(name: string, theme: object): void }): void {
  if (registered) return
  registered = true
  ec.registerTheme('fpAnaTheme', FP_ANA_THEME)
}

/**
 * 全站唯一一份「带子」—— 两条堆叠线:下沿透明哨兵 + 上沿只留填充,不描边(描了会被读成两条数据线)。
 *
 * 收编前全仓有五处逐字近似的手写:AnomalyView(园区 P25~P75)、TenantEnergyView(跨户均值±σ)、
 * PvMeterAnaView 三处(各栋四分位距 stack 'q'、样条带 stack 'band'、斜率标准误 stack 'se')。
 * 五处写了**四种** null 判法,收编后只许这一种:任一端 null → 该点整体 null。
 *
 * ⚠ 带色不在这里统一:AnomalyView/TenantEnergyView 用 rgba(28,28,28,.07),PV 三处用 C.INK100,
 *   差一档灰是有意的(PV-ANALYSIS-SPEC 要求渐变透明不描硬边)。统一配色是配色决定,不搭这趟车。
 *
 * ⚠ 两条系列默认都不进 tooltip(`tooltip:{show:false}`),不只是下沿哨兵:上沿那条数据是
 *   **宽度**(hi−lo),不是上沿本身。坐标轴 tooltip 一旦放它进去,标签写的是「P25~P75」
 *   「均值±σ带」,数字却是宽度值——读数句对不上量,正是这个计划要从屏上消灭的那种假话。
 *   真要在 tooltip 里印带的上下沿,用 formatter 自己算,不要指望这两条合成系列。
 */
export function bandSeries(
  lo: (number | null)[],
  hi: (number | null)[],
  opt: { name?: string; color?: string; stack?: string; dp?: number; series?: Record<string, unknown> } = {},
): object[] {
  const { name = '', color = 'rgba(28,28,28,.07)', stack = 'band', dp = 0, series = {} } = opt
  const base = { type: 'line', stack, symbol: 'none', silent: true, lineStyle: { opacity: 0 }, tooltip: { show: false }, ...series }
  const width = lo.map((l, i) => {
    const h = hi[i]
    return l == null || h == null ? null : +(h - l).toFixed(dp)
  })
  const floor = lo.map((l, i) => (l == null || hi[i] == null ? null : +l.toFixed(dp)))
  return [
    { ...base, name: '', data: floor },
    { ...base, name, data: width, areaStyle: { color } },
  ]
}

/**
 * 带宽门(P2 同类对标带 D3 附属):区间半宽 / 序列中位数 > 0.20 → 太宽,调用方应只出点不画带。
 * 覆盖率必须和相对宽度成对读:月度实收 naiveLast 覆盖率 100% 但宽度 177%、ma3 224%,
 * 只看覆盖率会把一条宽过均值一倍的带判成「很准」。
 *
 * 不写进 bandSeries 入口(职责纯渲染,调用方自己决定判不判、判完还画不画点)——
 * bandSeries.spec.ts 首条断言 [1,2]~[4,6] 半宽/中位约 0.54,过门槛,写进入口会当场判红;
 * PvMeterAnaView 的四分位带按定义就宽,进了口也回不来。
 */
export function bandTooWide(lo: (number | null)[], hi: (number | null)[]): boolean {
  const halfWidths: number[] = []
  const centers: number[] = []
  for (let i = 0; i < lo.length; i++) {
    const l = lo[i], h = hi[i]
    if (l == null || h == null) continue
    halfWidths.push((h - l) / 2)
    centers.push((l + h) / 2)
  }
  const mid = quantile(centers, 0.5)
  if (mid === 0) return false
  return quantile(halfWidths, 0.5) / mid > 0.20
}
