<script setup lang="ts">
// 月份选择胶囊 — 共享脚手架(按月录入附表复用)。
// 1:1 移植 ledger-common.jsx LedgerMonthPills(.lc-mpills/.lc-mpill):
// 12 等分 sunken 轨 + 白色 active 药丸 + has(m) 为假时淡显「暂无数据」月。
const props = defineProps<{
  value: number
  has?: (m: number) => boolean   // 该月有数据?无则淡显
  /** 这一月的锁作用域。不传、或返回 null（期没选全）= 不显示在场标记。 */
  scopeOf?: (m: number) => string | null
}>()
// 在场标记(PRESENCE §04):**只标编辑态**。绝对定位,不改胶囊尺寸。
const presence = usePresenceStore()
const editorOf = (m: number) => {
  const sc = props.scopeOf?.(m)
  return sc ? (presence.editorsByScope.get(sc) ?? [])[0] ?? null : null
}
import { usePresenceStore } from '@/stores/presence'

const emit = defineEmits<{ change: [m: number] }>()
const months = Array.from({ length: 12 }, (_, i) => i + 1)
</script>

<template>
  <div class="lc-mpills" role="tablist">
    <button
      v-for="m in months"
      :key="m"
      role="tab"
      :aria-selected="m === value"
      :class="['lc-mpill', { on: m === value, empty: has && !has(m) }]"
      :title="editorOf(m) ? `${editorOf(m)!.displayName} 正在编辑` : (has && !has(m) ? '暂无数据' : undefined)"
      @click="emit('change', m)"
    >{{ m }}月<span v-if="editorOf(m)" class="lc-mdot" /></button>
  </div>
</template>

<style scoped>
/* 1:1 from ledger-common.jsx LedgerCommonStyles (.lc-mpills 段,57-62) */
.lc-mpills { display:grid; grid-template-columns:repeat(12, minmax(0,1fr)); gap:2px; padding:3px; background:var(--bg-sunken, var(--surface-sunken)); border-radius:var(--radius-full); box-sizing:border-box; }
.lc-mpill { position:relative; height:30px; border:none; background:transparent; border-radius:var(--radius-full); cursor:pointer; font-family:var(--font-sans); font-size:12.5px; color:var(--text-muted); display:inline-flex; align-items:center; justify-content:center; white-space:nowrap; transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.lc-mpill:hover:not(.on) { color:var(--text-primary); }
.lc-mpill.on { background:var(--surface-white); color:var(--text-primary); font-weight:var(--fw-semibold); box-shadow:var(--shadow-pill, 0 1px 4px rgba(28,28,28,.12)); }
.lc-mpill.empty { color:var(--text-disabled); }
/* 6px 橙点,绝对定位 —— 有人编辑和没人编辑,胶囊尺寸一模一样 */
.lc-mdot { position:absolute; top:4px; right:7px; width:6px; height:6px; border-radius:50%; background:var(--hue-orange); box-shadow:0 0 0 1.5px var(--surface-white); }
</style>
