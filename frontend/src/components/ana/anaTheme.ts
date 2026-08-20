// src/components/ana/anaTheme.ts — ECharts 统一浅色主题 fpAnaTheme(spec §一)。
// 色板:蓝族主色 + teal/coral/amber 辅助 + 语义红;白底、细网格(var(--divider) 观感)、
// tooltip 深底白字沿 .cz-tip 观感(背景 rgb(40,52,66)、圆角 9、字号 11)。
// 主题为纯 JSON,无法引用 CSS 变量 → 取 tokens.css 字面值(--divider=ink-100、--text-muted)。

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
