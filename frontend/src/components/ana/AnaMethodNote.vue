<script setup lang="ts">
// 方法/口径说明脚注(移植 ana-charts.jsx MethodNote)。
// S 档改型(移动阅读设计稿 §05):长注释吃版面,收进「ⓘ 口径」浮层;
// D5:桌面档不再例外,一律走 pill + 浮层(FORECAST-BAND-AND-PLAIN-SENTENCE Task 5)。
import { ref, onBeforeUnmount, watch } from 'vue'
import { iconFor } from '@/components/ds/icon'

const open = ref(false)
const root = ref<HTMLElement | null>(null)

// UI-OVERLAY 范式(照抄 FPMoreMenu):点外关走 document capture mousedown(open 守卫,
// 关着时不拦别人的点击);Esc 自关并 stopPropagation(内层浮层赢,宿主弹窗听 bubble)。
// root 含触发 pill,contains 判定天然把 pill 排除在「点外」之外——pill 的 click 自己负责开合。
function onDocDown(e: MouseEvent) {
  if (!open.value) return
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !open.value) return
  e.stopPropagation()
  open.value = false
}
watch(open, (v) => {
  if (v) {
    document.addEventListener('mousedown', onDocDown, true)
    document.addEventListener('keydown', onKey, true)
  } else {
    document.removeEventListener('mousedown', onDocDown, true)
    document.removeEventListener('keydown', onKey, true)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown, true)
  document.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <!-- pill 触发 + absolute 浮层卡(覆盖不推挤,交互零位移);内容同一个 slot,
       动态插值随 slot 自然工作。 -->
  <div ref="root" class="ana-note-s">
    <button class="ana-note-pill" :class="{ on: open }" type="button" @click="open = !open">
      <component :is="iconFor('info')" :size="13" />
      口径
    </button>
    <div v-if="open" class="ana-note-pop"><slot /></div>
  </div>
</template>

<style scoped>
/* S 档:pill 高 ≥36px 保触达热区;浮层锚在 note 区向上弹——注释都在卡底,
   向上不出视口下沿;z 用 --z-popover 令牌(贴附浮层档)。 */
.ana-note-s { position: relative; margin: 10px 0 0; }
.ana-note-pill {
  display: inline-flex; align-items: center; gap: 5px;
  min-height: 36px; padding: 0 12px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-full);
  background: var(--surface-white); cursor: pointer; color: var(--text-muted);
  font-family: var(--font-sans); font-size: var(--fs-label);
}
.ana-note-pill.on { color: var(--text-primary); border-color: var(--border-strong); }
.ana-note-pop {
  position: absolute; bottom: calc(100% + 6px); left: 0; z-index: var(--z-popover);
  width: min(300px, 88vw); padding: 10px 12px; box-sizing: border-box;
  background: var(--surface-white); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md); box-shadow: var(--shadow-pop);
  font-size: var(--fs-label); color: var(--text-secondary); line-height: 1.6;
}
</style>
