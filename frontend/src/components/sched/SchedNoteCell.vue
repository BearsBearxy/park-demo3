<script setup lang="ts">
// 逐行备注单元格 — 共享脚手架。编辑态 input(blur/change emit save),只读态文本 /「—」。
// 1:1 移植 ledger-common.jsx LedgerNoteCell(.lc-note-in/.lc-note-ro)。
// 父持有 note 值(prop),编辑提交经 save 透出(由父 PATCH 落库),组件本身不存储。
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  note: string | null
  edit: boolean
  placeholder?: string
}>(), { placeholder: '备注' })
const emit = defineEmits<{ save: [text: string] }>()

const draft = ref(props.note ?? '')
watch(() => props.note, v => { draft.value = v ?? '' })

// 仅在值变化时 emit,避免 blur 无意义往返
function commit() {
  const next = draft.value.trim()
  if (next !== (props.note ?? '').trim()) emit('save', next)
}
</script>

<template>
  <input
    v-if="edit"
    class="lc-note-in"
    v-model="draft"
    :placeholder="placeholder"
    @change="commit"
    @blur="commit"
  />
  <span v-else-if="note" class="lc-note-ro" :title="note">{{ note }}</span>
  <span v-else class="lc-note-empty">—</span>
</template>

<style scoped>
/* 1:1 from ledger-common.jsx LedgerCommonStyles (.lc-note 段,64-69) */
.lc-note-in { width:100%; box-sizing:border-box; height:30px; border:1px solid var(--border-subtle); border-radius:7px; padding:0 9px; font-family:var(--font-sans); font-size:12.5px; color:var(--text-primary); background:var(--surface-white); outline:none; transition:border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard); }
.lc-note-in:focus { border-color:var(--hue-blue); box-shadow:0 0 0 3px var(--accent-blue); }
.lc-note-in::placeholder { color:var(--text-disabled); }
.lc-note-ro { color:var(--text-muted); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.lc-note-empty { color:var(--text-disabled); }
</style>
