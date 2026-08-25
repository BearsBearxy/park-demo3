<script setup lang="ts">
// ⓪→新建公司弹窗 — 1:1 from screen-ledger.jsx LgNewCompanyDialog (348-384).
import { ref, onMounted } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'

const props = defineProps<{ existingNames: string[] }>()
const emit = defineEmits<{ close: []; create: [name: string] }>()

const name = ref('')
const err = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
onMounted(() => inputRef.value?.focus())

function submit() {
  const v = name.value.trim()
  if (!v) { err.value = '请输入公司名称'; return }
  if (props.existingNames.includes(v)) { err.value = '已存在同名公司'; return }
  emit('create', v)
}
</script>

<template>
  <div class="lg-dlg-mask" @click="emit('close')">
    <div class="lg-dlg" @click.stop>
      <div class="lg-dlg-h">
        <h3>新建管理公司</h3>
        <p>为新的管理公司创建一份独立台账,表格结构与现有总表完全一致。</p>
      </div>
      <div class="lg-dlg-b">
        <div class="lg-dlg-lab">公司名称</div>
        <input ref="inputRef" class="lg-dlg-in" :class="{ err }" v-model="name"
               placeholder="如:园区水电管理公司"
               @input="err = ''" @keydown.enter="submit" />
        <div class="lg-dlg-erm">{{ err }}</div>
        <div class="lg-dlg-note">
          <component :is="iconFor('info')" :size="15" />
          <span>新台账各列均为空白。切换到该公司后点击「编辑」,在对应费用列录入收款即可 —— 不收的费用列保持留空。</span>
        </div>
      </div>
      <div class="lg-dlg-f">
        <Button variant="gray" size="sm" @click="emit('close')">取消</Button>
        <Button variant="filled" size="sm" @click="submit">
          <template #leading><component :is="iconFor('check')" :size="14" /></template>
          创建
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 1:1 from screen-ledger.jsx LgStyles 119-138 */
.lg-dlg-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:80; display:grid; place-items:center; opacity:0; animation:fp-fade-in var(--dur-base) forwards; }
.lg-dlg { width:min(440px,90vw); background:var(--surface-white); border-radius:var(--radius-xl); box-shadow:0 16px 48px rgba(28,28,28,.22);
  overflow:hidden; animation:fp-rise-in var(--dur-base) var(--ease-standard) both; }
.lg-dlg-h { padding:20px 22px 0; }
.lg-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.lg-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.lg-dlg-b { padding:18px 22px 4px; }
.lg-dlg-lab { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); margin-bottom:7px; }
.lg-dlg-in { width:100%; box-sizing:border-box; height:40px; padding:0 12px; font-size:13.5px; color:var(--text-primary);
  border:1px solid var(--border-subtle); border-radius:var(--radius-md); outline:none; background:var(--surface-white);
  font-family:var(--font-sans); transition:border-color var(--dur-fast) var(--ease-standard); }
.lg-dlg-in:focus { border-color:var(--hue-blue); }
.lg-dlg-in.err { border-color:var(--hue-red); }
.lg-dlg-erm { font-size:11.5px; color:var(--hue-red); margin-top:6px; min-height:14px; }
.lg-dlg-note { display:flex; gap:8px; align-items:flex-start; margin-top:12px; padding:11px 13px; border-radius:var(--radius-md);
  background:var(--accent-sky); font-size:12px; line-height:1.55; color:var(--text-secondary); }
.lg-dlg-note > :first-child { flex:0 0 auto; color:var(--hue-blue); margin-top:1px; }
.lg-dlg-f { display:flex; justify-content:flex-end; gap:8px; padding:16px 22px 20px; }
</style>
