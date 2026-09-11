/**
 * 「合约租金 · 未来 12 个月」自绘图的几何 —— 纯函数,不碰 DOM。
 *
 * 为什么自绘(用户 2026-09-12:「echart实现不了就自己写」):稿上这张图要的四件事,
 * ECharts 每一件都要绕:预测起点右侧整片底色、缺口那一处带引线的批注框、
 * 右端四个贴着线尾的数、以及历史段与预测段用同一条 x 轴但两种笔触。
 * 自己画 SVG 就是直说,不必先翻译成 series/markArea 再祈祷它落在该落的地方。
 *
 * 视觉同 AnaForecastChart:取自 Figma「Animated Line Charts」节点 2310:2628。
 * 直线段不做平滑 —— 平滑会在两个月之间造出没有的值。
 */
import { niceTicks, type ChartBox } from './forecastChart.logic'

/** 一列:历史段只有 realized,预测段有 locked/mid/lo/hi。 */
export interface RentBandCol {
  month: string          // 'YYYY-MM'
  realized: number | null   // 已实现(万元),历史段 + 预测起点那一个点
  locked: number | null     // 已锁定(万元)
  mid: number | null        // 预计(万元)
  lo: number | null
  hi: number | null
}

export interface RentBandGeo {
  box: ChartBox
  cols: RentBandCol[]
  realizedPath: string
  lockedPath: string
  midPath: string
  bandPath: string
  /** 预测起点那一列的 x(历史与预测的接缝)。 */
  splitX: number | null
  /** 预测段底色矩形。 */
  shade: { x: number; w: number } | null
  /** 右端贴线尾的数:上沿/预计/锁定/下沿,已按 y 去重排开,不叠字。 */
  endLabels: { y: number; text: string; kind: 'hi' | 'mid' | 'locked' | 'lo' }[]
  /** 预测起点那个点的标注(稿上「312.2」)。 */
  startDot: { x: number; y: number; text: string } | null
  /** 缺口批注:每个到期扎堆的月份一条(用户 2026-09-12:「每个到期扎堆的月份都标出来」)。
   *  y 已做过防叠字:横向挨得太近的两条会被逐级往下推。 */
  gapMarks: { x: number; y: number; lines: string[] }[]
  dots: { i: number; x: number; y: number }[]
  yTicks: { v: number; y: number; label: string }[]
  xTicks: { i: number; x: number; label: string }[]
}

export interface GapInput { colIndex: number; dropWan: number; names: string[]; count: number; endLabel: string }
/** 两条批注横向挨得比这还近,就把后一条往下推一层 —— 三行小字大约这么宽。 */
const GAP_MIN_DX = 96
const GAP_BLOCK_H = 46

const r2 = (v: number) => +v.toFixed(2)

export function rentBandGeo(
  cols: RentBandCol[] | null, box: ChartBox, splitIdx: number | null, gaps: GapInput[] = [],
): RentBandGeo | null {
  if (!cols || cols.length < 2) return null
  const vals: number[] = []
  for (const c of cols) for (const v of [c.realized, c.locked, c.mid, c.lo, c.hi]) if (v != null) vals.push(v)
  if (!vals.length) return null
  let min = Math.min(...vals), max = Math.max(...vals)
  if (min === max) { min -= 1; max += 1 }
  const pad = (max - min) * 0.12
  min -= pad; max += pad

  const innerW = box.width - box.padL - box.padR
  const innerH = box.height - box.padT - box.padB
  const n = cols.length
  const x = (i: number) => box.padL + (innerW * i) / (n - 1)
  const y = (v: number) => box.padT + innerH * (1 - (v - min) / (max - min))

  const seg = (pick: (c: RentBandCol) => number | null) => {
    const parts: string[] = []
    let open = false
    cols.forEach((c, i) => {
      const v = pick(c)
      if (v == null) { open = false; return }
      parts.push(`${open ? 'L' : 'M'}${r2(x(i))},${r2(y(v))}`)
      open = true
    })
    return parts.join(' ')
  }
  const realizedPath = seg((c) => c.realized)
  const lockedPath = seg((c) => c.locked)
  const midPath = seg((c) => c.mid)

  const bandIdx = cols.map((c, i) => ({ c, i })).filter(({ c }) => c.lo != null && c.hi != null)
  const bandPath = bandIdx.length > 1
    ? bandIdx.map(({ c, i }, k) => `${k ? 'L' : 'M'}${r2(x(i))},${r2(y(c.hi as number))}`).join(' ')
      + ' ' + [...bandIdx].reverse().map(({ c, i }) => `L${r2(x(i))},${r2(y(c.lo as number))}`).join(' ') + ' Z'
    : ''

  const splitX = splitIdx != null && splitIdx >= 0 ? r2(x(splitIdx)) : null
  const shade = splitX != null ? { x: splitX, w: r2(box.width - box.padR - splitX) } : null

  // 右端四个数:同一个 y 附近会叠字,按 y 排序后逐个至少拉开 13px
  const last = cols[n - 1]
  const raw: { y: number; text: string; kind: 'hi' | 'mid' | 'locked' | 'lo' }[] = []
  if (last.hi != null) raw.push({ y: y(last.hi), text: String(Math.round(last.hi)), kind: 'hi' })
  if (last.mid != null) raw.push({ y: y(last.mid), text: String(Math.round(last.mid)), kind: 'mid' })
  if (last.locked != null) raw.push({ y: y(last.locked), text: String(Math.round(last.locked)), kind: 'locked' })
  if (last.lo != null) raw.push({ y: y(last.lo), text: String(Math.round(last.lo)), kind: 'lo' })
  raw.sort((a, b) => a.y - b.y)
  for (let i = 1; i < raw.length; i++) if (raw[i].y - raw[i - 1].y < 13) raw[i].y = raw[i - 1].y + 13
  const endLabels = raw.map((e) => ({ ...e, y: r2(e.y) }))

  const sCol = splitIdx != null ? cols[splitIdx] : null
  const startDot = sCol && sCol.realized != null && splitX != null
    ? { x: splitX, y: r2(y(sCol.realized)), text: sCol.realized.toFixed(1) } : null

  // 每个缺口一条批注。横向挨得近的往下推一层,避免三行小字叠在一起。
  const placed: { x: number; y: number; lines: string[] }[] = []
  for (const g of [...gaps].sort((a, b) => a.colIndex - b.colIndex)) {
    if (!(g.colIndex >= 0 && g.colIndex < n)) continue
    const col = cols[g.colIndex]
    const base = col.locked ?? col.mid ?? col.realized
    if (base == null) continue
    const gx = r2(x(g.colIndex))
    let gy = r2(y(base))
    for (const p of placed) {
      if (Math.abs(p.x - gx) < GAP_MIN_DX && Math.abs(p.y - gy) < GAP_BLOCK_H) gy = r2(p.y + GAP_BLOCK_H)
    }
    placed.push({
      x: gx, y: gy,
      lines: [
        `−${g.dropWan.toFixed(1)} 万`,
        g.names.slice(0, 2).join(' + ') + (g.count > g.names.slice(0, 2).length ? ` 等 ${g.count} 份` : ''),
        `${g.endLabel} 到期`,
      ],
    })
  }
  const gapMarks = placed

  const dots = cols.map((c, i) => ({ c, i })).filter(({ c }) => c.realized != null)
    .map(({ c, i }) => ({ i, x: r2(x(i)), y: r2(y(c.realized as number)) }))

  const yTicks = niceTicks(min, max).map((v) => ({ v, y: r2(y(v)), label: String(Math.round(v)) }))
  // x 轴只标首月、每季、末月 —— 24 格全标必然挤成一团(稿上也是这么标的)
  const xTicks = cols.map((c, i) => ({ i, x: r2(x(i)), label: c.month }))
    .filter((t, i) => i === 0 || i === n - 1 || (splitIdx != null && i === splitIdx) || Number(cols[i].month.slice(5)) % 3 === 1)
  return { box, cols, realizedPath, lockedPath, midPath, bandPath, splitX, shade, endLabels, startDot, gapMarks, dots, yTicks, xTicks }
}
