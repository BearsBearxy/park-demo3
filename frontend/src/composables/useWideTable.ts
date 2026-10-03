// 宽表固定列与表格高度(LIST-PAGE-SPEC §9、画布 07-A/07-B/07-C;实现规范 §1.8、§2 第 3 条)。
// 纯函数 planFixed / heightStage / numW / textW + composable useWideTable。7 张有左右固定列的表共用,
// 屏上不许再自写按屏幕档退列的逻辑。
import { computed, onBeforeUnmount, onMounted, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import { useViewport } from '@/composables/useViewport'

/** 一根「可能固定」的列。按 DOM 顺序传;备注这类说明文字不传(任何宽度都不固定)。 */
export interface WideCol {
  key: string
  side: 'L' | 'R'
  /** 列宽 px。数字列用 numW(整列全部值 + 合计),名称列用 textW(全部名字)——都不量 DOM */
  w: number
  /** 先后:0 永远不退(名称列、编辑态勾选列),数越大越先退 */
  rank: number
  /** 名称列:宽度封顶 floor(visW/5),超了省略 + 悬停看全称 */
  name?: boolean
  /** 名称列封顶的下限:格里不缩的签 / 徽标 / 勾选框 / 删除钮 + 内边距 + 约 3 个字。
   *  1/5 比它还窄时按它给,不然名字被挤成 0 宽、悬停和点按都碰不到 */
  minW?: number
}

export interface StickyStyle { position: 'sticky'; left?: string; right?: string; boxShadow?: string }

export interface FixPlan {
  /** 仍固定的列 → 内联 sticky 样式;退掉的列不在表里(原地变普通列,跟着左右滚) */
  style: Record<string, StickyStyle>
  /** 内沿阴影列:左组最右一根、右组最左一根(已写进它的 style.boxShadow) */
  edge: { L: string | null; R: string | null }
  /** 每根传入列实际用的宽(名称列是封顶后的宽);offset 按它累加,渲染列宽也必须用它 */
  w: Record<string, number>
  /** 名称列宽;没有名称列为 0 */
  nameW: number
}

/**
 * 左右固定列合计 > 0.4·visW 时按 rank 从大到小退,退到只剩 rank 0;offset 只累加仍固定的列。
 * visW ≤ 0(未布局)全留、名称列不封顶。
 */
export function planFixed(visW: number, cols: readonly WideCol[]): FixPlan {
  const cap = visW > 0 ? Math.floor(visW / 5) : Infinity
  const w: Record<string, number> = {}
  for (const c of cols) w[c.key] = c.name ? Math.min(c.w, Math.max(cap, c.minW ?? 0)) : c.w
  const kept = new Set(cols.map(c => c.key))
  if (visW > 0) {
    let total = cols.reduce((s, c) => s + w[c.key], 0)
    for (const c of cols.filter(c => c.rank > 0).sort((a, b) => b.rank - a.rank)) {
      if (total <= 0.4 * visW) break
      kept.delete(c.key)
      total -= w[c.key]
    }
  }
  const style: Record<string, StickyStyle> = {}
  const edge: FixPlan['edge'] = { L: null, R: null }
  let acc = 0
  for (const c of cols) {
    if (c.side !== 'L' || !kept.has(c.key)) continue
    style[c.key] = { position: 'sticky', left: acc + 'px' }
    acc += w[c.key]
    edge.L = c.key
  }
  acc = 0
  for (let i = cols.length - 1; i >= 0; i--) {
    const c = cols[i]
    if (c.side !== 'R' || !kept.has(c.key)) continue
    style[c.key] = { position: 'sticky', right: acc + 'px' }
    acc += w[c.key]
    edge.R = c.key
  }
  if (edge.L) style[edge.L].boxShadow = '1px 0 0 var(--border-subtle)'
  if (edge.R) style[edge.R].boxShadow = '-1px 0 0 var(--border-subtle)'
  const nameCol = cols.find(c => c.name)
  return { style, edge, w, nameW: nameCol ? w[nameCol.key] : 0 }
}

/** 分组表头高(没有填 0)、列名行高、行高、贴底合计高(没有填 0) */
export interface HeightDims { grpH: number; leafH: number; rowH: number; footH: number }
/** 0 全贴 / 1 分组表头不贴顶 / 2 合计也不贴底 / 3 另加 min-height = minTableH、整页往下滚 */
export type HeightStage = 0 | 1 | 2 | 3

/** 3 级时表格区的 min-height:列名 + 8 行 */
export const minTableH = (d: HeightDims): number => d.leafH + 8 * d.rowH

/** 按表格区实际高度判断能不能露 8 行,不够按顺序让。availH ≤ 0(未布局)按 0 级。 */
export function heightStage(availH: number, d: HeightDims): HeightStage {
  if (availH <= 0) return 0
  const rows = 8 * d.rowH
  if (availH >= d.grpH + d.leafH + d.footH + rows) return 0
  if (availH >= d.leafH + d.footH + rows) return 1
  if (availH >= d.leafH + rows) return 2
  return 3
}

// 汉字与全角标点按 1em,其余 0.6em(Roboto Mono 一格 0.6em;正文字体的拉丁字母不会更宽)
const WIDE = /[⺀-鿿豈-﫿︰-﹏＀-￯]/
// 接口数据里缺一个字段(null / undefined)按空串量,不让整张表的列宽计算抛错(2026-10-03 CI 红过一次)
type Cell = string | null | undefined
const widest = (strs: readonly Cell[], em: (s: string) => number): number =>
  strs.reduce<number>((m, s) => Math.max(m, em(s ?? '')), 0)
const px2 = (em: number, px: number, pad: number): number => Math.ceil(em * px) + 2 + pad

/** 数字列宽:按整列最长的数(调用方把合计串也放进来),0.6em/字 + 2px 余量 + 左右内边距。不量 DOM。 */
export const numW = (strs: readonly Cell[], px = 12, pad = 16): number =>
  px2(widest(strs, s => s.length * 0.6), px, pad)

/** 文字列宽:汉字 1em、其余 0.6em,取最长的一个。不量 DOM。 */
export const textW = (strs: readonly Cell[], px = 12, pad = 16): number =>
  px2(widest(strs, s => { let e = 0; for (const ch of s) e += WIDE.test(ch) ? 1 : 0.6; return e }), px, pad)

/**
 * 量表格区(wrap:overflow:auto 的那层)clientWidth / clientHeight,算固定列与高度档。
 * - 宽高真变了才重算(ResizeObserver);wrap 在 v-else 里后出现也接得上(watch(wrap),照抄 useFitRows)。
 * - dataKey 变了(换月、换账册、重新加载)按新数据重算列宽;同一个 dataKey 下列宽只增不减——
 *   编辑中数变长、原宽放不下才重算,变短不动(07-C「列不会莫名挪位」)。滚动、翻页不重算。
 * - S 档(≤600)高度恒 0 级。
 */
export function useWideTable(
  wrap: Ref<HTMLElement | null>,
  cols: MaybeRefOrGetter<readonly WideCol[]>,
  dims: MaybeRefOrGetter<HeightDims>,
  dataKey: MaybeRefOrGetter<unknown>,
) {
  const { tier } = useViewport()
  const visW = ref(0)
  const availH = ref(0)
  /** 横向滚动条高:3 级的 min-height 要把它加上,不然有滚动条时只露约 7.5 行(1024×640 实测) */
  const sbH = ref(0)
  const measure = () => {
    const el = wrap.value
    if (!el || !el.clientWidth) return   // 未布局 / KeepAlive 摘下时量到 0:保持上次,回来时 RO 再量
    visW.value = el.clientWidth          // 同值赋给 ref 不触发,拖窗口没变宽时不重算
    availH.value = el.clientHeight
    const cs = getComputedStyle(el)
    sbH.value = Math.max(0, Math.round(el.offsetHeight - el.clientHeight
      - (parseFloat(cs.borderTopWidth) || 0) - (parseFloat(cs.borderBottomWidth) || 0)))
  }
  // ponytail: 只观察 wrap 本身——它的尺寸就是要量的东西,不像 useFitRows 另挂 html 与 window resize
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
  watch(wrap, (el, old) => {
    if (old && ro) ro.unobserve(old)
    if (el && ro) ro.observe(el)
    measure()
  })
  onMounted(measure)
  onBeforeUnmount(() => ro?.disconnect())

  let key: unknown
  let grown: Record<string, number> = {}
  const effCols = computed(() => {
    const k = toValue(dataKey)
    if (k !== key) { key = k; grown = {} }
    return toValue(cols).map(c => {
      const w = Math.max(grown[c.key] ?? 0, c.w)
      grown[c.key] = w
      return w === c.w ? c : { ...c, w }
    })
  })

  // LIST-PAGE §8:编辑态每敲一键 cols 都会重算,结果没变就返回同一个对象,整表 style 引用不变、patcher 跳过
  let last: FixPlan | null = null
  let lastSig = ''
  const fix = computed<FixPlan>(() => {
    const p = planFixed(visW.value, effCols.value)
    const sig = JSON.stringify(p)
    if (last && sig === lastSig) return last
    lastSig = sig
    return (last = p)
  })
  const nameW = computed(() => fix.value.nameW)

  // 3 级时表格区被自己的 min-height 撑着,量到的是这个下限而不是可用高:
  // 量到的不超过下限就留在 3 级,真可用高超过下限才重新判(否则 3↔2 来回跳)
  let held: HeightStage = 0
  const hStage = computed<HeightStage>(() => {
    if (tier.value === 's') return (held = 0)
    const d = toValue(dims)
    const h = availH.value
    held = held === 3 && h <= minTableH(d) + 1 ? 3 : heightStage(h, d)
    return held
  })

  return { fix, nameW, hStage, sbH }
}
