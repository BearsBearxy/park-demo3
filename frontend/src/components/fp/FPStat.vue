<script setup lang="ts">
// 抽屉小卡(KPI-CARD-SPEC §3,稿 KpiA ③④):有 tint 用 tint、没有用 --surface-card;数 mono 20,单位 14,太长降 16。
import { computed, ref } from 'vue'
import { splitUnit, useFitDown } from '@/components/ds/KpiCard.vue'

const props = defineProps<{
  label: string
  value: string
  sub?: string
  tint?: 'blue' | 'slate' | 'sky' | 'cyan'
  /** 数字色(台账抽屉「本月结余」正橙负红),不传 = --text-primary */
  valueColor?: string
  /** 数字位换成微光条,盒子不变 */
  loading?: boolean
}>()

const bg = computed(() => props.tint ? `var(--accent-${props.tint})` : 'var(--surface-card)')
const parts = computed(() => splitUnit(props.value))
// 放不下 20 降 16,按卡的真宽度量;16 还放不下就省略号 + 悬停看全
const numEl = ref<HTMLElement | null>(null)
const { small, tip } = useFitDown(numEl)
</script>

<template>
  <div class="fs" :style="{ background: bg }">
    <span class="fs-l">{{ label }}</span>
    <span v-if="loading" class="fp-shim fs-sk" aria-hidden="true"></span>
    <span v-else ref="numEl" class="fs-n" :class="{ s16: small }" :style="valueColor ? { color: valueColor } : undefined" :title="tip">{{ parts[0] }}<span v-if="parts[1]" class="u">{{ parts[1] }}</span></span>
    <span v-if="sub" class="fs-s">{{ sub }}</span>
  </div>
</template>

<style scoped>
/* 像素照抄 gen-画板生成脚本.mjs .fs*(方向 A) */
.fs { box-sizing: border-box; min-width: 0; border-radius: var(--radius-lg); padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; }
.fs-l { font-size: var(--fs-label); line-height: 18px; color: var(--text-primary); white-space: nowrap; }
/* 定高 26:mono 数 + CJK 单位混排时行盒会被撑到 27.8(浏览器实测),加载条 20 + 3 + 3 = 26 就对不上 */
.fs-n { height: 26px; font-family: var(--font-mono); font-size: var(--fs-h2); line-height: 26px; font-weight: var(--fw-semibold); letter-spacing: var(--ls-tight); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fs-n.s16 { font-size: var(--fs-h3); }
.fs-n .u { font-family: var(--font-sans); font-size: var(--fs-body); font-weight: var(--fw-medium); }
.fs-s { font-size: var(--fs-micro); line-height: 16px; color: var(--text-muted-tint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fs-sk { display: block; width: 80px; height: 20px; margin: 3px 0; }
</style>
