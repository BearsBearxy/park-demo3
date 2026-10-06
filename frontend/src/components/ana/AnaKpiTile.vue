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
  // 2026-10 改稿五屏(规范 S-12/S-41):副行涨跌值由句型库写好整段传进来(「−1,004.4万」+「比11月」),
  // 颜色不再按正负自动给:dtone 'up' 绿 = 向好,'down' 红 = 只给利润下滑,不传 = 次要灰(收入、成本差额为负不标红)。
  // 传了 dval 就不看 delta;不传 = 原样(其余屏零变化)。
  dval?: string
  ddir?: 'up' | 'dn'
  dkey?: string
  dtone?: 'up' | 'down'
  // 改稿五屏:「51.7%」的 % 也按单位写小字(画板如此;规范 S-11 单位 14)。不传 = 原样(其余屏零变化)
  pctUnit?: boolean
  // 光伏分栋分析(2026-10-06 改稿):副行两行 = 比上期 + 比去年同期,各一行「箭头 值 key」;val 为 null 写「—」不带箭头。
  // 字由句型库写好整段传进来(PVK),颜色同 dval 不传 dtone = 次要灰。传了 drows 就不看 dval / delta / note;不传 = 原样(其余屏零变化)
  drows?: { val: string | null; dir?: 'up' | 'dn'; key: string }[]
}>(), { unit: '%' })

const parts = computed<[string, string]>(() => (props.pctUnit && /\d%$/.test(props.value) ? [props.value.slice(0, -1), '%'] : splitUnit(props.value)))
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
          v-tip="tip">{{ parts[0] }}<span v-if="parts[1]" class="u">{{ parts[1] }}</span></span>
    <span v-if="loading" class="d"><span class="fp-shim sk-d" aria-hidden="true"></span></span>
    <span v-else-if="drows?.length" class="d"><span v-for="(r, i) in drows" :key="i" class="dr"><span class="dl" style="color: var(--text-secondary)"><component :is="iconFor(r.dir === 'up' ? 'arrow-up-right' : 'arrow-down-right')" v-if="r.val != null" :size="12" />{{ r.val ?? '—' }}</span> <span class="dk">{{ r.key }}</span></span></span>
    <span v-else-if="dval" class="d"><span class="dl" :style="{ color: dtone === 'up' ? 'var(--delta-up-text)' : dtone === 'down' ? 'var(--delta-down-text)' : 'var(--text-secondary)' }"><component :is="iconFor(ddir === 'up' ? 'arrow-up-right' : 'arrow-down-right')" :size="12" />{{ dval }}</span> <span v-if="dkey" class="dk">{{ dkey }}</span></span>
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
/* min-width:0 + 省略号:降到 16 还放不下才截断,悬停看全(v-tip) */
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
/* 两行副行(drows)一行一条、各自不折:窄瓦(手机两列)放不下时 key 尾巴省略,不把第二行挤出两行高 */
.av2-kpi .d .dr { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.av2-kpi .d.warn { color: var(--warn-text); }
.av2-kpi .sk-v { display: block; flex: 0 0 auto; width: 72px; height: 20px; margin: 3px 0; }
.av2-kpi .sk-d { display: block; width: 64%; height: 10px; margin-top: 3px; }
</style>
