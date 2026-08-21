<script setup lang="ts">
// 退出编辑保存确认 — [保存修改][放弃修改] + ×关闭(留编辑态)。CSS 全本组件 scoped。
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'

defineProps<{ count: number }>()
const emit = defineEmits<{
  save: []
  discard: []
  close: []
}>()
</script>

<template>
  <div class="scd-scrim" @mousedown="emit('close')">
    <div class="scd-card" @mousedown.stop>
      <div class="scd-h">
        <component :is="iconFor('alert-triangle')" :size="20" class="scd-ic" />
        <h3>有未保存的修改</h3>
        <button class="scd-x" @click="emit('close')"><component :is="iconFor('x')" :size="16" /></button>
      </div>
      <p class="scd-body">本次编辑有 <b>{{ count }}</b> 处改动。退出前要保存吗？</p>
      <div class="scd-f">
        <Button variant="gray" @click="emit('discard')">
          <template #leading><component :is="iconFor('rotate-ccw')" :size="16" /></template>
          放弃修改
        </Button>
        <Button variant="filled" @click="emit('save')">
          <template #leading><component :is="iconFor('check')" :size="16" /></template>
          保存修改
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scd-scrim { position:fixed; inset:0; z-index:350; background:rgba(28,28,28,.32); backdrop-filter:blur(2px); display:flex; align-items:center; justify-content:center; }
.scd-card { width:min(400px,94vw); background:var(--surface-white); border-radius:var(--radius-lg); box-shadow:0 24px 60px rgba(28,28,28,.22); display:flex; flex-direction:column; overflow:hidden; }
.scd-h { display:flex; align-items:center; gap:10px; padding:18px 20px 8px; }
.scd-h h3 { margin:0; flex:1; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.scd-ic { color:var(--hue-orange); }
.scd-x { width:28px; height:28px; border:none; background:transparent; border-radius:8px; color:var(--text-muted); cursor:pointer; display:grid; place-items:center; }
.scd-x:hover { background:var(--bg-hover); color:var(--text-primary); }
.scd-body { margin:0; padding:0 20px 4px; font-size:13px; color:var(--text-secondary); }
.scd-body b { font-family:var(--font-mono); color:var(--text-primary); margin:0 2px; }
.scd-f { display:flex; gap:10px; padding:16px 20px; }
.scd-f > * { flex:1; }
</style>
