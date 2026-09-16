<script setup lang="ts">
/**
 * PvAlphaBars —— 高级分析档 L1「先天水平 α 排序」+ L5 脚注那一行(PV-ANALYSIS-SCREEN-V4 §3.10 §3.11)。
 *
 * DOM 横条,几何照画板 Main.dc.html `4a`:行高 22、栋名列 58 右对齐、绘图区 x0 = 66 … 宽 − 10、
 * 条高 14 圆角 3、横轴端点 = 区间两端各外扩 2 再取到刻度步长的整数倍、刻度按 1/2/5 步长取约 5 条。
 * 跨度超过 LOG_SPREAD 倍改对数轴(α 是倍数关系:+100% = ×2、−50% = ×½)。
 * 条 = 0 线到 α;同色 30% 延长带 = 95% 区间;数据口径(排序、区间、谁没进排序)全在 pvAnaV4.logic.ts。
 * 点条 = 换上面的大图(与芯片共用一个选中态),由 view 接 pick。
 */
import { computed } from 'vue'
import { useWidth } from '@/components/ana/useWidth'
import { sgn } from '@/components/ana/anaFmt'
import { PHASE_COLORS, PV_COLORS } from './pvAnaColors'
import { niceTicks } from './forecastChart.logic'
import type { PvAlphaBarsProps } from './pvAnaV4.logic'

const props = defineProps<PvAlphaBarsProps>()
const emit = defineEmits<{ (e: 'pick', id: number): void }>()

const ROW_H = 22
// ponytail: 3 倍是经验线 —— 线性轴上最宽的栋占满全宽时,×⅓ 那头只剩一成宽度,其余栋挤成一条缝
const LOG_SPREAD = 3
const LOG_RATIOS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50]
/** 栋名列右缘(58)+ 2:标签左端越过它才算压进栋名 */
const NAME_R = 60
/** 数值标签估宽:mono 11px 每字 6.6 */
const labelW = (s: string) => s.length * 6.6
const X0 = 66
const { el, width } = useWidth(496)

const r1 = (v: number) => +v.toFixed(1)
const phaseFill = (p: number) => PHASE_COLORS[p] ?? 'var(--ink-500)'

const geo = computed(() => {
  const rows = props.data.rows
  const W = width.value
  const x1 = W - 10
  const nRows = rows.length + props.data.short.length + props.data.rest.length
  // 端点含 0,保证 0 线在图内
  const lo = Math.min(0, ...rows.map(r => r.ciLo))
  const hi = Math.max(0, ...rows.map(r => r.ciHi))
  const log = (1 + hi / 100) / (1 + lo / 100) > LOG_SPREAD
  let dlo: number, dhi: number, tv: number[]
  if (log) {
    const rlo = (1 + lo / 100) / 1.1, rhi = (1 + hi / 100) * 1.1
    dlo = (rlo - 1) * 100; dhi = (rhi - 1) * 100
    tv = LOG_RATIOS.filter(r => r >= rlo && r <= rhi).map(r => +((r - 1) * 100).toFixed(6))
  } else {
    const t = niceTicks(lo - 2, hi + 2, 5)
    const step = t.length > 1 ? t[1] - t[0] : 10
    dlo = Math.floor((lo - 2) / step) * step; dhi = Math.ceil((hi + 2) / step) * step
    tv = []
    for (let v = dlo; v <= dhi + step * 1e-9; v += step) tv.push(+v.toFixed(6))
  }
  const f = (v: number) => (log ? Math.log(1 + v / 100) : v)
  const AX = (v: number) => r1(X0 + (f(v) - f(dlo)) / (f(dhi) - f(dlo)) * (x1 - X0))
  const zero = AX(0)
  const ticks = tv.map(v => ({ x: AX(v), label: `${v > 0 ? '+' : ''}${v}%` }))
  const bars = rows.map(r => {
    const ax = AX(r.alphaPct)
    const on = r.id === props.selId
    const label = sgn(r.alphaPct, 1, '%')
    let neg = r.alphaPct < 0
    let lx = neg ? AX(r.ciLo) - 6 : AX(r.ciHi) + 6
    // 标签会压进栋名列 / 冲出右缘时,挪到 0 线另一侧 —— 一行只有一根条,那一侧是空的
    if (neg && lx - labelW(label) < NAME_R) { neg = false; lx = zero + 6 }
    else if (!neg && lx + labelW(label) > W) { neg = true; lx = zero - 6 }
    return {
      id: r.id, name: r.name, fill: phaseFill(r.phase), on,
      x: Math.min(zero, ax), w: r1(Math.max(Math.abs(ax - zero), 1)),
      bandX: AX(r.ciLo), bandW: r1(AX(r.ciHi) - AX(r.ciLo)),
      label, lx: r1(lx), neg,
    }
  })
  return { height: nRows * ROW_H + 14, plotH: nRows * ROW_H, zero, ticks, bars, log }
})

const sel = computed(() => props.data.rows.find(r => r.id === props.selId) ?? null)

// ── L5:换一种扫描顺序重算的一句 + 88×20 迷你收敛线 + 悬停一行 ──
const stab = computed(() => {
  const s = props.stability
  const head = '这份排名换一种算法顺序重算了一遍：'
  if (!s.moved.length) return `${head}${s.n} 栋名次都没变。`
  const list = s.moved.map(m => `${m.name} ${m.from}→${m.to}`).join(' · ')
  const how = s.sameShift == null ? '挪了位'
    : s.moved.length === 1 ? `挪了 ${s.sameShift} 位` : `各挪了 ${s.sameShift} 位`
  return `${head}${s.n} 栋里 ${s.sameN} 栋名次没变，${s.moved.length} 栋${how}（${list}）。`
})

</script>

<template>
  <section class="av2-card pab">
    <div class="av2-card-h">
      <span class="t">先天水平 α 排序</span>
      <span class="hint">条 = 这栋常年高于 / 低于全园中位的程度 · 淡带 = 95% 区间 · 点条换上面的图</span>
    </div>
    <div ref="el" class="pab-plot" :style="{ height: `${geo.height}px` }">
      <template v-for="t in geo.ticks" :key="t.label">
        <span class="pab-grid" :style="{ left: `${t.x}px`, height: `${geo.plotH}px`, background: PV_COLORS.GRID }" />
        <span class="pab-ax pab-tick" :style="{ left: `${t.x}px`, top: `${geo.plotH + 2}px` }">{{ t.label }}</span>
      </template>
      <span class="pab-grid pab-zero" :style="{ left: `${geo.zero}px`, height: `${geo.plotH}px`, background: PV_COLORS.REF_DIAG }" />
      <div class="pab-rows">
        <div v-for="b in geo.bars" :key="b.id" class="pab-row" :data-id="b.id">
          <span class="pab-name" :class="{ on: b.on }">{{ b.name }}</span>
          <span class="pab-band" :style="{ left: `${b.bandX}px`, width: `${b.bandW}px`, background: b.fill }" />
          <button type="button" class="pab-bar" :aria-label="`${b.name} α ${b.label}`"
            :style="{ left: `${b.x}px`, width: `${b.w}px`, background: b.fill, boxShadow: b.on ? '0 0 0 1.5px var(--ink-900)' : 'none' }"
            @click="emit('pick', b.id)" />
          <span class="pab-ax pab-val" :class="{ neg: b.neg }" :style="{ left: `${b.lx}px` }">{{ b.label }}</span>
        </div>
        <div v-for="u in data.short" :key="u.id" class="pab-row rest" :data-id="u.id">
          <span class="pab-name">{{ u.name }}</span>
          <span class="pab-ax pab-val" :style="{ left: `${X0 + 6}px` }">在网 {{ u.days }} 天，不排</span>
        </div>
        <div v-for="u in data.rest" :key="u.id" class="pab-row rest" :data-id="u.id">
          <span class="pab-name">{{ u.name }}</span>
          <span class="pab-ax pab-val" :style="{ left: `${X0 + 6}px` }">无 α</span>
        </div>
      </div>
    </div>
    <div class="pab-leg">
      <span><b :style="{ background: PV_COLORS.PHASE1 }" />一期</span>
      <span><b :style="{ background: PV_COLORS.PHASE2 }" />二期</span>
      <span><b :style="{ background: PV_COLORS.PHASE3 }" />三期</span>
      <span class="mut">横轴 = α，相对全园中位 %<template v-if="geo.log">（对数刻度）</template></span>
    </div>
    <p class="ana-read hold"><template v-if="sel">{{ sel.name }} α {{ sgn(sel.alphaPct, 1, '%') }}，{{ data.rows.length }} 栋里第 {{ sel.rank }} 位（1 = 最高）；区间 {{ sgn(sel.ciLo, 1, '%') }} ~ {{ sgn(sel.ciHi, 1, '%') }}，{{ sel.crossesZero ? '跨 0' : '不跨 0' }}</template></p>
    <div v-if="stability.n > 0" class="pab-stab">
      <span class="tx">{{ stab }}</span>
    </div>
    <p class="ana-ref">n = {{ data.rows.length }} 栋 · 全年逐日残差 · 相对全园中位，% · 淡带 = 这栋水平大概落在哪一段（95% 区间）<template v-if="data.excluded.length"> · 台账差超线不进排序：{{ data.excluded.join('、') }}</template></p>
  </section>
</template>

<style scoped>
.pab-plot { position: relative; width: 100%; }
.pab-grid { position: absolute; top: 0; width: 1px; }
.pab-ax {
  position: absolute; font-size: var(--fs-micro); line-height: 14px; font-family: var(--font-mono);
  color: var(--text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; pointer-events: none;
}
.pab-tick { width: 40px; margin-left: -20px; text-align: center; }
.pab-rows { position: absolute; left: 0; top: 0; width: 100%; display: flex; flex-direction: column; }
.pab-row { position: relative; height: 22px; }
.pab-name {
  position: absolute; left: 0; top: 0; width: 58px; line-height: 22px; text-align: right;
  font-size: var(--fs-label); white-space: nowrap;
}
.pab-name.on { font-weight: var(--fw-semibold); }
.rest .pab-name { color: var(--ink-500); }
.pab-band, .pab-bar { position: absolute; top: 4px; height: 14px; border-radius: 3px; }
.pab-band { opacity: .3; }
.pab-bar { border: 0; padding: 0; margin: 0; cursor: pointer; }
.pab-val { top: 4px; color: var(--ink-700); }
.rest .pab-val { color: var(--text-muted); }
.pab-val.neg { transform: translateX(-100%); }

.pab-leg { display: flex; align-items: center; gap: 14px; margin-top: 8px; font-size: var(--fs-micro); color: var(--text-secondary); white-space: nowrap; flex-wrap: wrap; }
.pab-leg span { display: inline-flex; align-items: center; gap: 5px; }
.pab-leg b { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.pab-leg .mut { color: var(--text-muted); }

.pab-stab { margin-top: 8px; }
.pab-stab .tx { font-size: var(--fs-label); color: var(--text-primary); line-height: 1.5; min-width: 0; }

</style>
