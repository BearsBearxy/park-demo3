<script setup lang="ts">
// 结论横幅(移植 ana-kit.jsx VerdictBanner):headline + 分点信号;asof 由调用方传(真数据截至期)。
import { computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import { STATUS, type AnaStatusLevel, type AnaTone } from './anaFmt'
import './ana.css'

export interface Verdict {
  level: AnaStatusLevel
  headline: string
  points: { tone: AnaTone | AnaStatusLevel; text: string }[]
}
const props = defineProps<{ verdict: Verdict; asof?: string }>()
const s = computed(() => STATUS[props.verdict.level] ?? STATUS.good)
const dotColor = (tone: string) => (STATUS[tone as AnaStatusLevel] ?? STATUS.neutral).color
</script>

<template>
  <div class="ak-verdict">
    <div class="ak-verdict-badge" :style="{ background: s.soft, color: s.color }">
      <component :is="iconFor(verdict.level === 'good' ? 'shield-check' : 'alert-triangle')" :size="24" />
    </div>
    <div class="ak-verdict-body">
      <div class="ak-verdict-h">
        <span class="ttl">{{ verdict.headline }}</span>
        <span v-if="asof" style="font-size: 11.5px; color: var(--text-muted)">· 数据截至 {{ asof }}</span>
      </div>
      <div class="ak-verdict-pts">
        <span v-for="(p, i) in verdict.points" :key="i" class="ak-vpt">
          <span class="dot" :style="{ background: dotColor(p.tone) }"></span>{{ p.text }}
        </span>
      </div>
    </div>
  </div>
</template>
