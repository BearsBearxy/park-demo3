// src/components/ana/anaFmt.ts — 分析层格式化/动态标签/统计工具(移植 ana-charts.jsx 头部工具)。
// 全部纯函数,一切标签由数据算出(峰值/趋势),无写死结论。

export const fnum = (v: number, d = 1): string =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

export const fint = (v: number): string => Math.round(v).toLocaleString('en-US')

export const sgn = (v: number, d = 1, u = '%'): string =>
  (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) + u

// ── 图表填充族(墨蓝+蓝族,无紫无绿) ──
export const INK = 'rgb(28,28,28)'
export const FILL = ['var(--fill-slate)', 'var(--fill-blue)', 'var(--fill-cyan)', 'var(--fill-sky)', 'rgb(180,200,228)', 'rgb(150,170,205)']
export const POS = 'var(--hue-blue)'
export const NEG = 'var(--hue-red)'
export const WARN = 'var(--hue-orange)'

// ── 对比开关叠加线语义色(spec 2026-07-11 §E) ──
// 曾用 #185FA5 画预算线(与利润线同色不可分)、#85B7EB 画上月线(与数据柱同蓝族难辨)。
// ECharts option 为纯 JSON 不能引用 CSS 变量 → 字面值。仅用于「对比参照线」,数据系列不用。
// 对比线语义色。2026-08-20 压暗:原 #A78BFA 对白底仅 2.72:1、#94A3B8 仅 2.56:1 ——
// 连图形元素的 3:1 都不到,而它们还要给 markLine 标签当**文字色**(那档要 4.5:1)。
// 用户原话「这个紫色的线看不清楚」。同色系下压到达标,「紫=预算 / 灰=基线」的语义区分不变。
export const CMP_BUDGET = '#7C3AED'     // 预算基准(紫) 5.70:1
export const CMP_BASELINE = '#64748B'   // 环比上月/同期基线(灰) 4.76:1

// ── 动态标签(峰值/趋势,由序列算出) ──
export type AnaTone = 'good' | 'risk' | 'warn' | 'neutral'
export interface AnaTagData { text: string; tone: AnaTone }

export function peakTag(series: number[] | null | undefined): AnaTagData | null {
  if (!series || series.length < 2) return null
  const cur = series[series.length - 1]
  const mx = Math.max(...series)
  const mn = Math.min(...series)
  if (cur === mx) return { text: '近' + series.length + '期新高', tone: 'good' }
  if (cur === mn) return { text: '近' + series.length + '期新低', tone: 'risk' }
  return null
}

export function trendTag(series: number[] | null | undefined): AnaTagData | null {
  if (!series || series.length < 3) return null
  let up = 0, down = 0
  for (let i = series.length - 1; i > 0; i--) {
    if (series[i] > series[i - 1]) { if (down) break; up++ }
    else if (series[i] < series[i - 1]) { if (up) break; down++ }
    else break
  }
  if (up >= 2) return { text: '连续' + up + '期上行', tone: 'good' }
  if (down >= 2) return { text: '连续' + down + '期下行', tone: 'risk' }
  return null
}

// ── 状态色(移植 ana-kit.jsx STATUS:正向=蓝;watch=橙;risk=红;info=青) ──
export type AnaStatusLevel = 'good' | 'watch' | 'risk' | 'info' | 'neutral'
export const STATUS: Record<AnaStatusLevel, { color: string; soft: string; label: string }> = {
  good:    { color: 'var(--hue-blue)',   soft: 'var(--accent-blue)',    label: '良好' },
  watch:   { color: 'var(--hue-orange)', soft: 'rgb(255,243,230)',      label: '关注' },
  risk:    { color: 'var(--hue-red)',    soft: 'rgb(255,238,237)',      label: '异常' },
  info:    { color: 'var(--hue-cyan)',   soft: 'var(--accent-cyan)',    label: '提示' },
  neutral: { color: 'var(--text-muted)', soft: 'var(--surface-sunken)', label: '—' },
}

// delta 方向取色(仓库令牌:up=绿 down=红);成本/逾期类「越低越好」传 invert 反转
export const deltaColor = (v: number, invert?: boolean): string => {
  const good = invert ? v <= 0 : v >= 0
  return good ? 'var(--delta-up)' : 'var(--delta-down)'
}

// ── 统计(BoxPlot/DeviationBars 用;通用数学,非 mock 引擎移植) ──
export const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0)
export const mean = (a: number[]): number => (a.length ? sum(a) / a.length : 0)
export const std = (a: number[]): number => {
  const m = mean(a)
  return a.length ? Math.sqrt(sum(a.map((v) => (v - m) * (v - m))) / a.length) : 0
}
export const quantile = (a: number[], q: number): number => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  const pos = (s.length - 1) * q
  const b = Math.floor(pos)
  const r = pos - b
  return s[b] + (s[Math.min(s.length - 1, b + 1)] - s[b]) * r
}
export interface FiveNum { min: number; q1: number; med: number; q3: number; max: number; mean: number; std: number }
export const fiveNum = (a: number[]): FiveNum => ({
  min: a.length ? Math.min(...a) : 0,
  q1: quantile(a, 0.25),
  med: quantile(a, 0.5),
  q3: quantile(a, 0.75),
  max: a.length ? Math.max(...a) : 0,
  mean: mean(a),
  std: std(a),
})

// ── Catmull-Rom 平滑路径(AnaTrend 用;FigLineChart 已随自绘图元一并删除) ──
export interface Pt { x: number; y: number }
export function smoothSegs(c: Pt[]): string {
  let d = ''
  for (let i = 0; i < c.length - 1; i++) {
    const p0 = c[i - 1] ?? c[i], p1 = c[i], p2 = c[i + 1], p3 = c[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
}
export const smoothPath = (c: Pt[]): string =>
  c.length ? `M ${c[0].x.toFixed(2)} ${c[0].y.toFixed(2)}` + smoothSegs(c) : ''

/** KPI 瓦片迷你趋势线路径(spec 2026-07-11 §B):x 等距占满宽,y 按非 null 极值归一(上下留 1px,
 *  全等序列画中线);null 为断点分段(缺月诚实断开,不 connectNulls);可画段(连续 ≥2 点)全无 → ''。 */
export function trendPath(values: (number | null)[], w: number, h: number): string {
  const vs = values.filter((v): v is number => v != null)
  if (vs.length < 2) return ''
  const mn = Math.min(...vs), mx = Math.max(...vs)
  const sx = w / (values.length - 1)
  const y = (v: number): number => (mx === mn ? h / 2 : 1 + (1 - (v - mn) / (mx - mn)) * (h - 2))
  let d = ''
  let seg: Pt[] = []
  const flush = (): void => { if (seg.length >= 2) d += (d ? ' ' : '') + smoothPath(seg); seg = [] }
  values.forEach((v, i) => { if (v == null) flush(); else seg.push({ x: i * sx, y: y(v) }) })
  flush()
  return d
}
