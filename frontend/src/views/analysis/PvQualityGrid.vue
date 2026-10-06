<script setup lang="ts">
/**
 * PvQualityGrid —— 核对明细档「每天抄表齐不齐」日历 + 右侧缺抄的楼(PV-ANALYSIS-SCREEN-V4 §3.13;2026-10-06 改稿)。
 *
 * **日历按天折叠**(行 = 周一…周日、列 = 周):这一块答「哪一天、哪几栋没抄表」,那是日的问题。
 * **手写 SVG 格,不用 ECharts** —— bundle 没注册 heatmap / visualMap / calendar,用了是空白图,jsdom 测不出。
 *
 * 月档是普通月历(2026-10-06 用户看了实现说「布局很奇怪，空白很多」后改):列 = 周一…周日、行 = 第几周,
 * 格宽跟着卡宽铺满;格区总高按 6 周的月钉死(桌面 356、窄容器 284),切月不变高,上 18 列头「周一…周日」。原来照画板 `4d` 行 = 星期、格定宽 59×64,
 * 卡一宽右边空一大片,7 行又把同排的「各栋常年水平」撑出底部空白。格内 日期 12px + 第二行 11px。四态四种画法,合并任意两个就是把不同的审计答案说成同一个:
 *   这天都抄了 蓝 16%(格里不写字)/ 有栋没抄 墨阶(MISS)+ 「缺 N 栋」/ 这天不算 墨 10% + 45° 划痕 + 「这天不算」/
 *   还没到 白底虚线框。「这天不算」≠「全园一栋没抄」(3ceefe0 那个 bug 的另一面),划痕与字两路分开。
 *   缺抄 2026-10-06 起走墨阶,不再用琥珀:琥珀在这屏是「高于平时 / 超限」。
 * 「缺抄的楼」只在这一段真有缺抄时出(缺几天):卡内宽 ≥ 640 放日历右边定宽 168,窄了挪到日历下面;
 * 全齐时不占一栏,「在网的都抄了」写在图例下面的参照行。
 *
 * 年档画板没画:格太多,改 12px 小格、不写字、按月标列头、未到只留底边(12px 格四边虚线读成一块填充),
 * 日历区横向滚。数据口径(四态怎么判、当天抄了几栋取 onDay、榜怎么排)全在 pvAnaV4.logic.ts qualityCalendar。
 */
import { computed, ref, useId } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { useEnterPhase, useMorphHold } from '@/components/ana/anaMotion'
import { tipWidth, tipX } from '@/components/ana/chartTip'
import '@/components/ana/ana.css'   // @keyframes fp-wipe
import { PHASE_COLORS, PV_COLORS } from './pvAnaColors'
import { PV, PVH, pvCalAll, pvCalFew } from '@/components/ana/anaSentence'
import type { CalCell, PvQualityGridProps } from './pvAnaV4.logic'

// minStations / tooFewStations:全园在网不足 minStations 栋时整日剔除这条规则不生效,
// 日历上一格划痕都没有 —— 不写这句,日历就在说「一天都没剔」。由 view 传 snap.quality 的同名字段
const props = defineProps<PvQualityGridProps & { minStations?: number; tooFewStations?: boolean }>()

const WD = ['一', '二', '三', '四', '五', '六', '日']
const patId = `pvq-drop-${useId()}`
const { el, width } = useWidth(655)
// 切到「高级分析」挂上来时在视口内擦入 320;换期格子只过渡底色 200(格按周 × 周内日作键,换月同一格位复用);
// 擦入中 / 改宽时 hold 关掉。缺抄榜的条与行序换期瞬到
const first = useEnterPhase(el)
const hold = useMorphHold(width, first)
const scroller = ref<HTMLElement | null>(null)

/** PV_COLORS 的 hex 叠透明度(同 PvResidualHeat)。透明度并进 fill、不另写 fill-opacity:
 *  两个属性一起过渡,中途的实际不透明度会冲过两头(蓝 16% → 墨 10% 中间闪到 30% 上下) */
function tint(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}
// computed 而不是 setup 时拷一份:页签在 KeepAlive 里常驻,切外观不重挂载,拷走的墨色(DROP)会停在旧外观
const KIND_FILL = computed<Record<CalCell['kind'], string>>(() => ({
  full: tint(PV_COLORS.FOCUS, 0.16), miss: PV_COLORS.MISS, drop: PV_COLORS.DROP, todo: 'transparent',
}))

/** 月档 = 自然月铺满,最多 6 列;超过就是年档 */
const compact = computed(() => props.data.weeks > 6)
// 判容器宽不判视口:这块图也出现在桌面 .av2-s4 窄栏里(那儿同样只有 300 多),媒体查询在那种场合失效。
// 月档窄档只缩格(PvCharts2 稿 §9):59×64 → 44×48、行头 28 → 22,6 周满月 22 + 6 × 48 − 4 = 306 ≤ 336,横向不滚。
// 字号一个都不动(日期 12px、第二行 11px、行头 12px);年档换图种是下一轮的事,这儿还是 12px 小格。
// 窄档 body 竖排(榜挪到日历下面),日历那个 flex: 0 0 calW 在竖排里会变成「高 calW」—— 那儿不写
const narrow = computed(() => width.value < 420)
/** 这一段真缺了抄的楼(全齐时为空 → 不出那一栏) */
const missed = computed(() => props.data.missRows.filter(m => m.kind === 'counted' && m.missDays))
const RANK_W = 168
const sideRank = computed(() => !compact.value && missed.value.length > 0 && width.value >= 640)
const stack = computed(() => !compact.value && missed.value.length > 0 && !sideRank.value)
// c.col = 第几周、c.row = 周几(0 = 周一)。月档转成普通月历:x 走周几、y 走第几周
const G = computed(() => {
  if (compact.value) return { cw: 12, ch: 12, gap: 2, rx: 2, left: 28, top: 18, hy: 10 }
  const gap = 4
  const avail = width.value - (sideRank.value ? RANK_W + 16 : 0)
  // 格区总高按 6 周的月钉死(桌面 6 × 56 + 5 × 4 = 356、窄容器 6 × 44 + 5 × 4 = 284),周数少的月格子拉高:
  // 切 5 周 / 6 周的月日历不变高,下面的核对表不跳(LAYOUT-STABILITY)
  const body = narrow.value ? 284 : 356
  return { cw: Math.max(36, Math.floor((avail - gap * 6) / 7)), ch: Math.floor((body + gap) / props.data.weeks) - gap, gap, rx: 5, left: 0, top: 18, hy: 0 }
})
/** 格窄于 56 时「缺 2 栋」47px 会溢到隔壁格:去掉量词写「缺 2」、「这天不算」写「不算」—— 字还在,与划痕仍是两路 */
const tight = computed(() => G.value.cw < 56)

const cells = computed(() => props.data.cells.map(c => ({
  ...c,
  x: compact.value ? G.value.left + c.col * (G.value.cw + G.value.gap) : c.row * (G.value.cw + G.value.gap),
  y: G.value.top + (compact.value ? c.row : c.col) * (G.value.ch + G.value.gap),
  // 全齐的格不写字:一个月 30 格重复「11 栋全齐」,底色 + 图例已经说了
  sub: c.kind === 'full' ? ''
    : c.kind === 'miss' ? (tight.value ? `缺 ${c.missNames.length}` : `缺 ${c.missNames.length} 栋`)
      : c.kind === 'drop' ? (tight.value ? '不算' : PV.calDrop) : '',
})))

const calW = computed(() => compact.value
  ? G.value.left + props.data.weeks * (G.value.cw + G.value.gap) - G.value.gap
  : 7 * (G.value.cw + G.value.gap) - G.value.gap)
const calH = computed(() => compact.value
  ? G.value.top + 7 * (G.value.ch + G.value.gap) - G.value.gap
  : G.value.top + (narrow.value ? 284 : 356))

const colHeads = computed(() => {
  const g = G.value
  if (!compact.value) return WD.map((t, i) => ({ x: i * (g.cw + g.gap) + 8, t: `周${t}`, anchor: 'start' }))
  return props.data.cells.filter(c => c.day === 1)
    .map(c => ({ x: g.left + c.col * (g.cw + g.gap), t: `${Number(c.date.slice(5, 7))}月`, anchor: 'start' }))
})
// 月档是普通月历,不标第几周;年档行头隔行标周几
const rowHeads = computed(() => WD.map((t, r) => ({ t, r })).filter(w => compact.value && w.r % 2 === 0)
  .map(w => ({ t: w.t, y: G.value.top + w.r * (G.value.ch + G.value.gap) + G.value.hy })))

/** 卡头写全部装了表的楼(缺抄榜的口径就是已装表的栋);右栏只列这一段真缺了抄的楼 */
const hint = computed(() => PVH.cal(props.data.missRows.length))
const period = computed(() => {
  const cs = props.data.cells
  if (!cs.length) return ''
  const a = cs[0].date, b = cs[cs.length - 1].date
  return a.slice(0, 7) === b.slice(0, 7) ? `${a.slice(0, 4)} 年 ${Number(a.slice(5, 7))} 月` : `${a.slice(0, 4)} 年`
})

interface TipLine { t: string; b?: number; dim?: number; c?: string }
const hover = ref<{ cell: CalCell; x: number; y: number } | null>(null)
function enter(c: (typeof cells.value)[number]) {
  hover.value = { cell: c, x: c.x - (scroller.value?.scrollLeft ?? 0), y: c.y }
}
const tip = computed(() => {
  const h = hover.value
  if (!h) return null
  const c = h.cell
  const lines: TipLine[] = [{ t: `${Number(c.date.slice(5, 7))} 月 ${c.day} 日`, b: 600 }]
  if (c.kind === 'todo') lines.push({ t: '还没到', dim: 0.72 })
  else if (c.kind === 'drop') lines.push({ t: `${PV.calDrop} · 全园当天读数不进判定` }, { t: `当天抄了 ${c.readN} 栋`, dim: 0.72 })
  else if (c.kind === 'miss') lines.push({ t: `缺抄 ${c.missNames.length} 栋 · ${c.missNames.join('、')}` })
  else lines.push({ t: `${c.bornN} 栋都抄齐了`, c: PV_COLORS.TIP_IN })
  const w = tipWidth(lines.map(l => l.t), 22)
  const g = G.value
  // 画板:格右 + 8 放右边;放不下翻到格左 − 8
  const left = tipX(h.x + g.cw / 2, w, { width: width.value, padL: 0, padR: 0 }, g.cw / 2 + 8)
  return { lines, left, top: Math.max(0, h.y - 8) }
})
</script>

<template>
  <section class="av2-card pqg" :class="{ narrow, stack }">
    <div class="av2-card-h">
      <span class="t">{{ PV.card.cal }}</span>
      <span class="hint">{{ hint }}</span>
    </div>
    <div ref="el" :class="['pqg-body', { first, hold }]" @mouseleave="hover = null"
      @animationend.self="first = false" @animationcancel.self="first = false">
      <div ref="scroller" class="pqg-cal" :class="{ compact }" :style="compact || narrow || stack ? undefined : { flex: `0 0 ${calW}px` }">
        <svg :width="calW" :height="calH" :viewBox="`0 0 ${calW} ${calH}`" class="pqg-svg" role="img"
          :aria-label="`数据质量日历 ${period}`">
          <defs>
            <pattern :id="patId" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" class="pqg-hatch" stroke-width="1.4" />
            </pattern>
          </defs>
          <text v-for="h in colHeads" :key="h.t + h.x" class="pqg-colh" :x="h.x" y="12" :text-anchor="h.anchor">{{ h.t }}</text>
          <text v-for="h in rowHeads" :key="h.t" class="pqg-rowh" :class="{ compact }" :x="G.left - 8" :y="h.y" text-anchor="end">{{ h.t }}</text>
          <!-- 格位键带档位:月历 ↔ 年历的同一格位不是同一天,换档整批换新元素,不做底色淡变 -->
          <g v-for="c in cells" :key="(compact ? 'y' : 'm') + (c.col * 7 + c.row)" class="pqg-cell" :data-date="c.date" :data-kind="c.kind">
            <!-- 底色一格一个 rect,四态只换 fill(还没到:透明 + 月档虚线框),换期同一格位复用才过渡得了 -->
            <rect :class="['pqg-bg', { 'pqg-todo': c.kind === 'todo' && !compact }]" :x="c.x" :y="c.y" :width="G.cw" :height="G.ch" :rx="G.rx"
              :fill="KIND_FILL[c.kind]" :stroke="c.kind === 'todo' && !compact ? PV_COLORS.DROP : undefined"
              :stroke-dasharray="c.kind === 'todo' && !compact ? '3 3' : undefined" />
            <rect v-if="c.kind === 'drop'" class="pqg-hatchbox" :x="c.x" :y="c.y" :width="G.cw" :height="G.ch" :rx="G.rx" :fill="`url(#${patId})`" />
            <line v-else-if="c.kind === 'todo' && compact" class="pqg-todo-edge" :x1="c.x" :x2="c.x + G.cw" :y1="c.y + G.ch - 0.5" :y2="c.y + G.ch - 0.5" />
            <template v-if="!compact">
              <text class="pqg-day" :class="c.kind" :x="c.x + 8" :y="c.y + 18">{{ c.day }}</text>
              <text v-if="c.sub" class="pqg-sub" :class="c.kind" :x="c.x + 8" :y="c.y + 38">{{ c.sub }}</text>
            </template>
            <rect v-if="hover && hover.cell.date === c.date" class="pqg-ring" :x="c.x + 1" :y="c.y + 1"
              :width="G.cw - 2" :height="G.ch - 2" :rx="Math.max(0, G.rx - 1)" fill="none" stroke-width="2" />
            <rect class="pqg-hit" :x="c.x" :y="c.y" :width="G.cw" :height="G.ch" fill="transparent" @mouseenter="enter(c)" />
          </g>
        </svg>
      </div>
      <div v-if="missed.length" class="pqg-rank" :style="sideRank ? { flex: `0 0 ${RANK_W}px` } : undefined">
        <div class="pqg-rank-h"><span>{{ PV.calRank }}</span></div>
        <div v-for="m in missed" :key="m.id" class="pqg-mrow" :data-id="m.id">
          <span class="d" :style="{ background: PHASE_COLORS[m.phase] ?? 'var(--ink-500)' }" />
          <span class="n">{{ m.name }}</span>
          <span class="v">缺 {{ m.missDays }} 天</span>
        </div>
      </div>
      <div v-if="tip" class="cz-tip pv-tip" :style="{ left: `${tip.left}px`, top: `${tip.top}px` }">
        <span v-for="(l, k) in tip.lines" :key="k" :style="{ fontWeight: l.b ?? 400, opacity: l.dim, color: l.c }">{{ l.t }}</span>
      </div>
    </div>
    <div class="pqg-leg">
      <span><b :style="{ background: PV_COLORS.FOCUS, opacity: .16 }" />{{ PV.calFull }}</span>
      <span><b :style="{ background: PV_COLORS.MISS }" />有栋没抄</span>
      <span><b :style="{ background: PV_COLORS.DROP }" />{{ PV.calDrop }}</span>
      <span><b class="todo" />还没到</span>
      <span class="per">{{ period }}</span>
    </div>
    <p class="ana-ref hold"><template v-if="tooFewStations">{{ pvCalFew(minStations ?? 0) }}</template><template v-else-if="!missed.length">{{ pvCalAll() }}</template></p>
  </section>
</template>

<style scoped>
.pqg-body { position: relative; display: flex; gap: 16px; align-items: flex-start; }
.pqg-body.first { clip-path: inset(0 100% 0 0); animation: fp-wipe var(--dur-slow) var(--ease-out) both; }
/* 换期只过渡底色(fill / 虚线框);格的几何、划痕、悬停描边都瞬到 */
.pqg-bg { transition: fill var(--dur-base) var(--ease-standard), stroke var(--dur-base) var(--ease-standard); }
.pqg-body.hold .pqg-bg { transition: none; }
.pqg-cal { position: relative; min-width: 0; }
.pqg-cal.compact { flex: 1 1 auto; overflow-x: auto; overflow-y: hidden; }
.pqg-svg { display: block; }
.pqg-colh { font-size: var(--fs-micro); font-family: var(--font-mono); fill: var(--text-muted); }
.pqg-rowh { font-size: var(--fs-label); font-family: var(--font-sans); fill: var(--text-muted); }
.pqg-rowh.compact { font-size: var(--fs-micro); }
.pqg-hatch { stroke: var(--ink-900); stroke-opacity: .30; }
.pqg-todo-edge { stroke: var(--ink-100); stroke-width: 1; }
.pqg-day { font-size: var(--fs-label); font-family: var(--font-mono); fill: var(--text-primary); }
.pqg-day.miss { font-weight: var(--fw-semibold); }
.pqg-day.drop { fill-opacity: .45; }
.pqg-day.todo { fill-opacity: .28; }
.pqg-sub { font-size: var(--fs-micro); font-family: var(--font-mono); fill: var(--ink-900); fill-opacity: .45; }
.pqg-sub.miss { fill-opacity: 1; }
.pqg-sub.drop { fill-opacity: .5; }
.pqg-ring { stroke: var(--ink-900); }

/* 窄容器、或月档有缺抄但卡内宽 < 640:「缺抄的楼」挪到日历下面铺满;窄容器图例换行 */
.pqg.narrow .pqg-body, .pqg.stack .pqg-body { flex-direction: column; }
.pqg.narrow .pqg-rank, .pqg.stack .pqg-rank { width: 100%; flex: 0 0 auto; }
.pqg.narrow .pqg-leg { flex-wrap: wrap; row-gap: 6px; }

/* 「缺抄的楼」:月档在右边时定宽 168(内联),年档按内容宽 */
.pqg-rank { flex: 0 1 auto; min-width: 0; }
.pqg-rank-h { display: flex; align-items: center; height: 18px; font-size: var(--fs-micro); color: var(--text-muted); }
.pqg-mrow { display: flex; align-items: center; gap: 6px; height: 22px; font-size: var(--fs-label); white-space: nowrap; }
.pqg-mrow .d { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.pqg-mrow .n { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.pqg-mrow .v { flex: 0 0 auto; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-micro); color: var(--text-secondary); }

.pqg-leg { display: flex; align-items: center; gap: 14px; margin-top: 8px; font-size: var(--fs-micro); color: var(--text-secondary); white-space: nowrap; }
.pqg-leg span { display: inline-flex; align-items: center; gap: 5px; }
.pqg-leg b { display: inline-block; width: 11px; height: 11px; border-radius: 3px; }
.pqg-leg b.todo { background: var(--surface-white); box-shadow: inset 0 0 0 1px var(--ink-900); opacity: .15; }
.pqg-leg .per { margin-left: auto; color: var(--text-muted); }

.pv-tip {
  display: flex; flex-direction: column; gap: 3px; white-space: nowrap;
  font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-on-solid);
}
</style>
