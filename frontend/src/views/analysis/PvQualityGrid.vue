<script setup lang="ts">
/**
 * PvQualityGrid —— 高级分析档 L6「数据质量日历」+ 右侧缺抄榜(PV-ANALYSIS-SCREEN-V4 §3.13)。
 *
 * **日历按天折叠**(行 = 周一…周日、列 = 周):这一块答「哪一天、哪几栋没抄表」,那是日的问题。
 * **手写 SVG 格,不用 ECharts** —— bundle 没注册 heatmap / visualMap / calendar,用了是空白图,jsdom 测不出。
 *
 * 几何照画板 Main.dc.html `4d`:月档格 59×64 圆角 5 gap 4、左 28 行头、上 18 列头「第 N 周」;
 * 格内 日期 12px + 第二行 11px。四态四种画法,合并任意两个就是把不同的审计答案说成同一个:
 *   全齐 蓝 16% + 「N 栋全齐」/ 缺抄 琥珀 30% + 「缺 N 栋」/ 整日剔除 墨 10% + 45° 划痕 + 「整日剔除」/
 *   还没到 白底虚线框。「整日剔除」≠「全园一栋没抄」(3ceefe0 那个 bug 的另一面),划痕与字两路分开。
 * 右栏缺抄榜 300 宽常驻全部已装表的栋(琥珀零基条;没进模型 / 未投产的栋行尾灰字)。
 *
 * 年档画板没画:格太多,改 12px 小格、不写字、按月标列头、未到只留底边(12px 格四边虚线读成一块填充),
 * 日历区横向滚。数据口径(四态怎么判、当天抄了几栋取 onDay、榜怎么排)全在 pvAnaV4.logic.ts qualityCalendar。
 */
import { computed, ref, useId } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { tipWidth, tipX } from '@/components/ana/chartTip'
import { PHASE_COLORS, PV_COLORS } from './pvAnaColors'
import type { CalCell, PvQualityGridProps } from './pvAnaV4.logic'

// minStations / tooFewStations:全园在网不足 minStations 栋时整日剔除这条规则不生效,
// 日历上一格划痕都没有 —— 不写这句,日历就在说「一天都没剔」。由 view 传 snap.quality 的同名字段
const props = defineProps<PvQualityGridProps & { minStations?: number; tooFewStations?: boolean }>()

const WD = ['一', '二', '三', '四', '五', '六', '日']
const patId = `pvq-drop-${useId()}`
const { el, width } = useWidth(655)
const scroller = ref<HTMLElement | null>(null)

/** 月档 = 自然月铺满,最多 6 列;超过就是年档 */
const compact = computed(() => props.data.weeks > 6)
const G = computed(() => compact.value
  ? { cw: 12, ch: 12, gap: 2, rx: 2, left: 28, top: 18 }
  : { cw: 59, ch: 64, gap: 4, rx: 5, left: 28, top: 18 })

const cells = computed(() => props.data.cells.map(c => ({
  ...c,
  x: G.value.left + c.col * (G.value.cw + G.value.gap),
  y: G.value.top + c.row * (G.value.ch + G.value.gap),
  // 全齐的格不写字:一个月 30 格重复「11 栋全齐」,底色 + 图例已经说了,59px 的格也放不下
  sub: c.kind === 'full' ? '' : c.kind === 'miss' ? `缺 ${c.missNames.length} 栋` : c.kind === 'drop' ? '整日剔除' : '',
})))

const calW = computed(() => G.value.left + props.data.weeks * (G.value.cw + G.value.gap) - G.value.gap)
const calH = computed(() => G.value.top + 7 * (G.value.ch + G.value.gap) - G.value.gap)

const colHeads = computed(() => {
  const g = G.value
  if (!compact.value) {
    return Array.from({ length: props.data.weeks }, (_, k) => ({ x: g.left + k * (g.cw + g.gap) + g.cw / 2, t: `第 ${k + 1} 周`, anchor: 'middle' }))
  }
  return props.data.cells.filter(c => c.day === 1)
    .map(c => ({ x: g.left + c.col * (g.cw + g.gap), t: `${Number(c.date.slice(5, 7))}月`, anchor: 'start' }))
})
const rowHeads = computed(() => WD.map((t, r) => ({ t, r })).filter(w => !compact.value || w.r % 2 === 0)
  .map(w => ({ t: w.t, y: G.value.top + w.r * (G.value.ch + G.value.gap) + (compact.value ? 10 : 36) })))

const fullN = computed(() => Math.max(0, ...props.data.cells.filter(c => c.kind !== 'todo').map(c => c.bornN)))
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
  else if (c.kind === 'drop') lines.push({ t: '整日剔除 · 全园当天读数不进判定', c: PV_COLORS.TIP_ABOVE }, { t: `当天抄了 ${c.readN} 栋`, dim: 0.72 })
  else if (c.kind === 'miss') lines.push({ t: `缺抄 ${c.missNames.length} 栋 · ${c.missNames.join('、')}`, c: PV_COLORS.TIP_ABOVE })
  else lines.push({ t: `${c.bornN} 栋都抄齐了`, c: PV_COLORS.TIP_IN })
  const w = tipWidth(lines.map(l => l.t), 22)
  const g = G.value
  // 画板:格右 + 8 放右边;放不下翻到格左 − 8
  const left = tipX(h.x + g.cw / 2, w, { width: width.value, padL: 0, padR: 0 }, g.cw / 2 + 8)
  return { lines, left, top: Math.max(0, h.y - 8) }
})
</script>

<template>
  <section class="av2-card pqg">
    <div class="av2-card-h">
      <span class="t">数据质量日历</span>
      <span class="hint">哪一天、哪几栋没抄表</span>
    </div>
    <div ref="el" class="pqg-body" @mouseleave="hover = null">
      <div ref="scroller" class="pqg-cal" :class="{ compact }" :style="compact ? undefined : { flex: `0 0 ${calW}px` }">
        <svg :width="calW" :height="calH" :viewBox="`0 0 ${calW} ${calH}`" class="pqg-svg" role="img"
          :aria-label="`数据质量日历 ${period}`">
          <defs>
            <pattern :id="patId" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" class="pqg-hatch" stroke-width="1.4" />
            </pattern>
          </defs>
          <text v-for="h in colHeads" :key="h.t + h.x" class="pqg-colh" :x="h.x" y="12" :text-anchor="h.anchor">{{ h.t }}</text>
          <text v-for="h in rowHeads" :key="h.t" class="pqg-rowh" :class="{ compact }" x="20" :y="h.y" text-anchor="end">{{ h.t }}</text>
          <g v-for="c in cells" :key="c.date" class="pqg-cell" :data-date="c.date" :data-kind="c.kind">
            <rect v-if="c.kind === 'full'" class="pqg-bg" :x="c.x" :y="c.y" :width="G.cw" :height="G.ch" :rx="G.rx"
              :fill="PV_COLORS.FOCUS" fill-opacity=".16" />
            <rect v-else-if="c.kind === 'miss'" class="pqg-bg" :x="c.x" :y="c.y" :width="G.cw" :height="G.ch" :rx="G.rx"
              :fill="PV_COLORS.ABOVE" fill-opacity=".30" />
            <template v-else-if="c.kind === 'drop'">
              <rect class="pqg-bg" :x="c.x" :y="c.y" :width="G.cw" :height="G.ch" :rx="G.rx" :fill="PV_COLORS.DROP" />
              <rect class="pqg-hatchbox" :x="c.x" :y="c.y" :width="G.cw" :height="G.ch" :rx="G.rx" :fill="`url(#${patId})`" />
            </template>
            <line v-else-if="compact" class="pqg-todo-edge" :x1="c.x" :x2="c.x + G.cw" :y1="c.y + G.ch - 0.5" :y2="c.y + G.ch - 0.5" />
            <rect v-else class="pqg-bg pqg-todo" :x="c.x" :y="c.y" :width="G.cw" :height="G.ch" :rx="G.rx"
              fill="transparent" :stroke="PV_COLORS.DROP" stroke-dasharray="3 3" />
            <template v-if="!compact">
              <text class="pqg-day" :class="c.kind" :x="c.x + 8" :y="c.y + 18"
                :style="c.kind === 'miss' ? { fill: PV_COLORS.AMBER_TEXT } : undefined">{{ c.day }}</text>
              <text v-if="c.sub" class="pqg-sub" :class="c.kind" :x="c.x + 8" :y="c.y + 38"
                :style="c.kind === 'miss' ? { fill: PV_COLORS.AMBER_TEXT } : undefined">{{ c.sub }}</text>
            </template>
            <rect v-if="hover && hover.cell.date === c.date" class="pqg-ring" :x="c.x + 1" :y="c.y + 1"
              :width="G.cw - 2" :height="G.ch - 2" :rx="Math.max(0, G.rx - 1)" fill="none" stroke-width="2" />
            <rect class="pqg-hit" :x="c.x" :y="c.y" :width="G.cw" :height="G.ch" fill="transparent" @mouseenter="enter(c)" />
          </g>
        </svg>
      </div>
      <div class="pqg-rank">
        <div class="pqg-rank-h"><span>这一段谁漏抄了</span><span class="r">{{ data.missRows.length }} 栋全列</span></div>
        <div v-for="m in data.missRows" :key="m.id" class="pqg-mrow" :class="m.kind" :data-id="m.id">
          <span class="d" :style="{ background: PHASE_COLORS[m.phase] ?? 'var(--ink-500)' }" />
          <span class="n">{{ m.name }}</span>
          <span class="bar"><i v-if="m.kind === 'counted'" :style="{ width: `${data.maxMiss ? (m.missDays ?? 0) / data.maxMiss * 100 : 0}%`, background: PV_COLORS.ABOVE }" /></span>
          <span class="v" :style="m.kind === 'counted' && m.missDays ? { color: PV_COLORS.AMBER_TEXT } : undefined">{{
            m.kind === 'counted' ? `缺 ${m.missDays} 天` : m.kind === 'unborn' ? '未投产' : '未录装机' }}</span>
        </div>
      </div>
      <div v-if="tip" class="cz-tip pv-tip" :style="{ left: `${tip.left}px`, top: `${tip.top}px` }">
        <span v-for="(l, k) in tip.lines" :key="k" :style="{ fontWeight: l.b ?? 400, opacity: l.dim, color: l.c }">{{ l.t }}</span>
      </div>
    </div>
    <div class="pqg-leg">
      <span><b :style="{ background: PV_COLORS.FOCUS, opacity: .16 }" />{{ fullN }} 栋全抄了</span>
      <span><b :style="{ background: PV_COLORS.ABOVE, opacity: .30 }" />有栋没抄</span>
      <span><b :style="{ background: PV_COLORS.DROP }" />整日剔除</span>
      <span><b class="todo" />还没到</span>
      <span class="per">{{ period }}</span>
    </div>
    <p v-if="tooFewStations" class="ana-ref">全园在网不足 {{ minStations }} 栋，整日剔除这条规则本段没生效 —— 日历上没有划痕格，不等于没有该剔的天。</p>
  </section>
</template>

<style scoped>
.pqg-body { position: relative; display: flex; gap: 16px; align-items: flex-start; }
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

.pqg-rank { width: 300px; flex: 0 0 300px; }
.pqg-rank-h { display: flex; align-items: center; height: 18px; font-size: var(--fs-micro); color: var(--text-muted); }
.pqg-rank-h .r { margin-left: auto; }
.pqg-mrow { display: flex; align-items: center; gap: 8px; height: 22px; font-size: var(--fs-label); }
.pqg-mrow .d { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.pqg-mrow .n { width: 64px; flex: 0 0 64px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pqg-mrow .bar { flex: 1 1 auto; height: 6px; border-radius: 3px; background: var(--ink-050); overflow: hidden; }
.pqg-mrow .bar i { display: block; height: 100%; border-radius: 3px; }
.pqg-mrow .v { flex: 0 0 56px; text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-micro); color: var(--text-muted); }
.pqg-mrow.unborn .d, .pqg-mrow.noModel .d { opacity: .4; }
.pqg-mrow.unborn .n, .pqg-mrow.unborn .v, .pqg-mrow.noModel .n, .pqg-mrow.noModel .v { color: var(--text-disabled); }

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
