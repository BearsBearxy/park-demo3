<script setup lang="ts">
// 分析屏小卡(KPI-CARD-SPEC §3,稿 KpiA ②④):整卡浅底无边,按在排里的位置 sky / slate 交替;
// label + 值(mono 20,单位 14,太长降 16)+ 副行(涨跌 / 灰色 note,固定两行高 32)。整卡高 108,
// AnaShell 的占位瓦就是本组件,所以占位与真瓦同高。
// 迷你趋势线 2026-09-19 去掉(K3):右上角空着;trend 入参留着只为旧调用不报错,不再画。
import { computed, ref } from 'vue'
import { sgn } from './anaFmt'
import { iconFor } from '@/components/ds/icon'
import { splitUnit, useFitDown } from '@/components/ds/KpiCard.vue'
import './ana.css'

const props = withDefaults(defineProps<{
  label: string
  value: string
  delta?: number | null   // 副行数值(null/undefined 不渲染)
  kind?: string           // 副行说明(如「环比」「距目标96%」)
  unit?: string           // delta 单位
  invert?: boolean        // 越低越好(成本/逾期类)
  note?: string           // 无 delta 时的灰色副行(如覆盖期数,诚实原则)
  noteTone?: 'warn'       // note 警示色(期间回退等半显式披露升级,复审)
  profit?: boolean        // 利润类(园区利润、净利…):为负时数字标红;收入、增速、差额类不传
  loading?: boolean       // 数字位和副行换成微光条,盒子不变
  trend?: (number | null)[]   // 不再画(K3)
}>(), { unit: '%' })

const parts = computed(() => splitUnit(props.value))
// 放不下 20 降 16,按瓦的真宽度量(连单位「万/月」一起);16 还放不下就省略号 + 悬停看全
const numEl = ref<HTMLElement | null>(null)
const { small, tip } = useFitDown(numEl)
const neg = computed(() => props.profit && /^[−-]/.test(props.value))
const good = computed(() => props.delta != null && (props.invert ? props.delta <= 0 : props.delta >= 0))
</script>

<template>
  <div class="av2-kpi">
    <span class="l">{{ label }}</span>
    <span v-if="loading" class="fp-shim sk-v" aria-hidden="true"></span>
    <span v-else ref="numEl" class="v" :class="{ s16: small }" :style="neg ? { color: 'var(--delta-down-text)' } : undefined"
          :title="tip">{{ parts[0] }}<span v-if="parts[1]" class="u">{{ parts[1] }}</span></span>
    <span v-if="loading" class="d"><span class="fp-shim sk-d" aria-hidden="true"></span></span>
    <span v-else-if="delta != null" class="d"><span class="dl" :style="{ color: good ? 'var(--delta-up-text)' : 'var(--delta-down-text)' }"><component :is="iconFor(delta >= 0 ? 'arrow-up-right' : 'arrow-down-right')" :size="12" />{{ sgn(delta, 1, unit) }}</span> <span v-if="kind" class="dk">{{ kind }}</span></span>
    <span v-else-if="note" class="d note" :class="{ warn: noteTone === 'warn' }">{{ note }}</span>
    <!-- 没有副行的瓦也留副行的两行高:同一排瓦等高,首进占位瓦(一律带副行)才对得上 -->
    <span v-else class="d" aria-hidden="true"></span>
  </div>
</template>

<style scoped>
/* 像素照抄 gen-画板生成脚本.mjs .kt*(方向 A)。高 108 = 12 + 标签 18 + 4 + 数 26 + 4 + 副行 32 + 12 */
.av2-kpi { box-sizing: border-box; height: 108px; min-width: 0; border-radius: var(--radius-md); padding: 12px; display: flex; flex-direction: column; gap: 4px; background: var(--accent-sky); }
.av2-kpi:nth-child(even) { background: var(--accent-slate); }
.av2-kpi .l { flex: 0 0 auto; height: 18px; font-size: var(--fs-label); line-height: 18px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* min-width:0 + 省略号:降到 16 还放不下才截断,悬停 title 看全 */
.av2-kpi .v { flex: 0 0 auto; height: 26px; min-width: 0; font-family: var(--font-mono); font-size: var(--fs-h2); line-height: 26px; font-weight: var(--fw-semibold); font-variant-numeric: tabular-nums; letter-spacing: var(--ls-tight); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.av2-kpi .v.s16 { font-size: var(--fs-h3); }
.av2-kpi .v .u { font-family: var(--font-sans); font-size: var(--fs-body); font-weight: var(--fw-medium); }
.av2-kpi .v.s16 .u { font-size: var(--fs-label); }
/* 副行固定两行高 32(2026-09-16 用户拍板):长短不一的副行不再改变瓦高;超过两行截断 */
.av2-kpi .d { flex: 0 0 auto; height: 32px; font-size: var(--fs-micro); line-height: 16px; font-family: var(--font-mono); overflow-wrap: anywhere; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.av2-kpi .d .dl { display: inline-flex; align-items: center; gap: 2px; white-space: nowrap; vertical-align: top; }
.av2-kpi .d .dl svg { margin-right: 1px; }
/* 「距目标96%」整段一起换行,不把 96% 甩到下一行 */
.av2-kpi .d .dk { font-family: var(--font-sans); color: var(--text-muted-tint); white-space: nowrap; }
.av2-kpi .d.note { font-family: var(--font-sans); color: var(--text-muted-tint); }
.av2-kpi .d.warn { color: var(--warn-text); }
.av2-kpi .sk-v { display: block; flex: 0 0 auto; width: 72px; height: 20px; margin: 3px 0; }
.av2-kpi .sk-d { display: block; width: 64%; height: 10px; margin-top: 3px; }
</style>
