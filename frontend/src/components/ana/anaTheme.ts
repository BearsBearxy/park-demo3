// src/components/ana/anaTheme.ts — ECharts 统一浅色主题 fpAnaTheme(spec §一)。
// 色板:蓝族主色 + teal/coral/amber 辅助 + 语义红;白底、细网格(var(--divider) 观感)、
// tooltip 深底白字沿 .cz-tip 观感(背景 rgb(40,52,66)、圆角 9、字号 11.5)。
// 主题为纯 JSON,无法引用 CSS 变量 → 取 tokens.css 字面值(--divider=ink-100、--text-muted)。

const FONT_SANS = '"Inter", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif'
const GRID_LINE = 'rgba(28,28,28,.1)'     // var(--divider) 观感
const AXIS_LINE = 'rgba(28,28,28,.15)'
const AXIS_LABEL = 'rgba(28,28,28,.62)'   // var(--text-muted) 观感

export const FP_ANA_THEME = {
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
  legend: { textStyle: { color: 'rgba(28,28,28,.8)', fontSize: 11.5 }, itemWidth: 11, itemHeight: 11 },
  tooltip: {
    backgroundColor: 'rgb(40,52,66)',
    borderWidth: 0,
    borderRadius: 9,
    padding: [8, 11],
    textStyle: { color: '#fff', fontSize: 11.5 },
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
