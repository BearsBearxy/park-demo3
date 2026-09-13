<script setup lang="ts">
/**
 * PvResidualHeat —— 高级分析档 L3「各栋残差的年内走势」13 × 12 热力格(PV-ANALYSIS-SCREEN-V4 §3.12)。
 *
 * **CSS 手写格,不用 ECharts**:bundle 没注册 heatmap / visualMap。几何照画板 Main.dc.html `4b`:
 * 行头 70(期别点 8 + 栋名 12px)、格 28×28 圆角 4 gap 2、列头 20(当段月实底白字)。
 * 色阶两向四档:正 = 蓝、负 = 琥珀,透明度 .14 / .30 / .50 / .75,接近 0 = 墨 4%;最深一档正向格字转白。
 * 档位线、行序(固定栋序)、谁是空格全在 pvAnaV4.logic.ts residualGrid。
 * 未到的月、有效抄表不足的月、没进模型的行一律虚线空格,不补。
 */
import { computed, ref } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { sgn } from '@/components/ana/anaFmt'
import { tipWidth, tipX } from '@/components/ana/chartTip'
import { PHASE_COLORS, PV_COLORS } from './pvAnaColors'
import type { PvResidualHeatProps, ResidualCell } from './pvAnaV4.logic'

// year:列头与气泡里的年份。ResidualGrid 没带年,由 view 传 snap.year
const props = defineProps<PvResidualHeatProps & { year: number }>()

const ALPHA = [0, 0.14, 0.3, 0.5, 0.75]
const LEG: { c: string; a: number }[] = [
  ...[4, 3, 2, 1].map(l => ({ c: PV_COLORS.ABOVE, a: ALPHA[l] })),
  { c: '', a: 0 },
  ...[1, 2, 3, 4].map(l => ({ c: PV_COLORS.FOCUS, a: ALPHA[l] })),
]

/** PV_COLORS 的 hex 叠透明度。只从色板常量派生,不另起色 */
function tint(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}

const { el, width } = useWidth(496)
/** 格宽 = (容器 − 栋名列 70 − 12 道间距) ÷ 12,钉在 28…56:宽卡片不留半边空白,窄卡片不低于 28 */
const cw = computed(() => Math.max(28, Math.min(56, Math.floor((width.value - 70 - 24) / 12))))
/** mono 11px 每字 6.6、两侧各留 2:放不下时正数去掉「+」—— 蓝色与悬停气泡仍说方向,负数的「−」不省 */
const fit = (t: string) => (t.startsWith('+') && t.length * 6.6 > cw.value - 4 ? t.slice(1) : t)

function cellLook(c: ResidualCell, inModel: boolean) {
  if (!inModel || c.state !== 'value' || c.pct == null) {
    return { t: '', bg: 'transparent', fg: 'transparent', border: '1px dashed var(--ink-100)', hover: false }
  }
  const r = Math.round(c.pct)
  const bg = c.level === 0 ? 'var(--ink-040)' : tint(c.sign > 0 ? PV_COLORS.FOCUS : PV_COLORS.ABOVE, ALPHA[c.level])
  const fg = c.level === 4 && c.sign > 0 ? 'var(--text-on-solid)' : c.level === 0 ? 'var(--ink-500)' : 'var(--text-primary)'
  return { t: `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}`, bg, fg, border: '1px solid transparent', hover: true }
}

const rows = computed(() => props.data.rows.map(r => ({
  id: r.id, name: r.name, inModel: r.inModel,
  dot: PHASE_COLORS[r.phase] ?? 'var(--ink-500)',
  on: r.id === props.selId,
  cells: r.cells.map(c => { const l = cellLook(c, r.inModel); return { ...l, t: fit(l.t), month: c.month } }),
})))

const months = computed(() => Array.from({ length: 12 }, (_, k) => {
  const cur = k + 1 === props.data.currentMonth
  return { m: k + 1, cur }
}))

const hm = ref<{ i: number; m: number } | null>(null)
const tip = computed(() => {
  const h = hm.value
  if (!h) return null
  const r = props.data.rows[h.i]
  const c = r?.cells[h.m - 1]
  if (!c || c.pct == null) return null
  const lines: { t: string; b?: number; dim?: number }[] = [
    { t: `${r.name} · ${props.year}-${String(h.m).padStart(2, '0')}`, b: 600 },
    { t: `残差 ${sgn(c.pct, 1, '%')}` },
    { t: c.sign > 0 ? '比自己常年水平多发' : c.sign < 0 ? '比自己常年水平少发' : '与常年水平持平', dim: 0.72 },
  ]
  const w = tipWidth(lines.map(l => l.t), 22)
  // 画板:格左 72 + (m−1)·30,气泡在格右 4px;右边放不下翻到格左 4px
  const center = 72 + (h.m - 1) * 30 + 14
  return { lines, left: tipX(center, w, { width: width.value, padL: 0, padR: 0 }, 18), top: 22 + h.i * 30 - 4 }
})

const legendNote = computed(() => {
  const d = props.data
  const parts: string[] = []
  if (d.throughMonth < 12) parts.push(d.throughMonth >= 11 ? '12 月还没到' : `${d.throughMonth + 1}–12 月还没到`)
  const partial = d.rows[0]?.cells.find(c => c.partial)
  if (partial) parts.push(`${partial.month} 月还没录满`)
  if (d.outsideN) parts.push(`${d.outsideN} 栋无残差`)
  return parts.join(' · ')
})
</script>

<template>
  <section class="av2-card prh">
    <div class="av2-card-h">
      <span class="t">各栋残差的年内走势</span>
      <span class="hint">格 = 该月残差中位数 % · 蓝 = 比自己常年多发，琥珀 = 少发 · 悬停看数</span>
    </div>
    <div ref="el" class="prh-grid" @mouseleave="hm = null">
      <div class="prh-head">
        <span class="prh-year">{{ year }}</span>
        <span v-for="mo in months" :key="mo.m" class="prh-mo" :class="{ cur: mo.cur }"
          :style="{ width: `${cw}px`, flexBasis: `${cw}px`, ...(mo.cur ? { background: PV_COLORS.FOCUS } : {}) }">{{ mo.m }}月</span>
      </div>
      <div v-for="(r, i) in rows" :key="r.id" class="prh-row" :data-id="r.id">
        <span class="prh-name" :class="{ on: r.on, out: !r.inModel }"><i class="dot" :style="{ background: r.dot }" />{{ r.name }}</span>
        <span v-for="c in r.cells" :key="c.month" class="prh-cell"
          :class="{ ring: hm && hm.i === i && hm.m === c.month }"
          :style="{ width: `${cw}px`, flexBasis: `${cw}px`, background: c.bg, color: c.fg, border: c.border }"
          @mouseenter="hm = c.hover ? { i, m: c.month } : null">{{ c.t }}</span>
      </div>
      <div v-if="tip" class="cz-tip pv-tip" :style="{ left: `${tip.left}px`, top: `${tip.top}px` }">
        <span v-for="(l, k) in tip.lines" :key="k" :style="{ fontWeight: l.b ?? 400, opacity: l.dim }">{{ l.t }}</span>
      </div>
    </div>
    <div class="prh-leg">
      <span class="mut">少发</span>
      <span class="sw"><b v-for="(s, k) in LEG" :key="k" :style="{ background: s.a ? tint(s.c, s.a) : 'var(--ink-040)' }" /></span>
      <span class="mut">多发</span>
      <span v-if="legendNote" class="mut note">{{ legendNote }}</span>
    </div>
  </section>
</template>

<style scoped>
.prh-grid { position: relative; display: flex; flex-direction: column; gap: 2px; }
.prh-head, .prh-row { display: flex; align-items: center; gap: 2px; }
.prh-head { height: 20px; }
.prh-row { height: 28px; }
.prh-year { width: 70px; flex: 0 0 70px; font-size: var(--fs-micro); color: var(--text-muted); }
.prh-mo, .prh-cell {
  width: 28px; flex: 0 0 28px; border-radius: 4px; display: grid; place-items: center; box-sizing: border-box;
  font-size: var(--fs-micro); font-family: var(--font-mono); font-variant-numeric: tabular-nums;
}
.prh-mo { height: 20px; color: var(--text-muted); }
.prh-mo.cur { color: var(--text-on-solid); }
.prh-cell { height: 28px; cursor: default; }
.prh-cell.ring { box-shadow: inset 0 0 0 2px var(--ink-900); }
.prh-name {
  width: 70px; flex: 0 0 70px; display: flex; align-items: center; gap: 6px; font-size: var(--fs-label);
  padding-right: 4px; white-space: nowrap; overflow: hidden; box-sizing: border-box; color: var(--text-primary);
}
.prh-name.on { font-weight: var(--fw-semibold); }
.prh-name.out { color: var(--ink-500); }
.prh-name .dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }

.prh-leg { display: flex; align-items: center; gap: 14px; margin-top: 8px; font-size: var(--fs-micro); color: var(--text-secondary); white-space: nowrap; }
.prh-leg .sw { display: inline-flex; gap: 2px; }
.prh-leg .sw b { display: inline-block; width: 11px; height: 11px; border-radius: 3px; }
.prh-leg .mut { color: var(--text-muted); }
.prh-leg .note { margin-left: auto; }

.pv-tip {
  display: flex; flex-direction: column; gap: 3px; white-space: nowrap;
  font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-on-solid);
}
</style>
