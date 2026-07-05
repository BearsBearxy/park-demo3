<script setup lang="ts">
// 台账导入预检弹窗 — 样式 1:1 LedgerNewCompanyDialog 的 .lg-dlg 居中弹窗(宽 560px)。
// 导入表里出现租户表没有的名字时,逐名决策:创建并关联到推荐主租户 / 新建独立租户 / 跳过该行。
import { ref } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'

export interface ResolveItem { name: string; suggest: { id: number; companyName: string } | null }
export interface ResolveDecision { name: string; action: 'link' | 'create' | 'skip'; parentId?: number }

const props = defineProps<{ items: ResolveItem[] }>()
const emit = defineEmits<{ confirm: [decisions: ResolveDecision[]]; close: [] }>()

// 每行动作:有推荐默认 link,无推荐默认 create
const actions = ref<('link' | 'create' | 'skip')[]>(props.items.map(it => (it.suggest ? 'link' : 'create')))

function submit() {
  emit('confirm', props.items.map((it, i) => {
    const action = actions.value[i]
    return action === 'link' && it.suggest
      ? { name: it.name, action, parentId: it.suggest.id }
      : { name: it.name, action }
  }))
}
</script>

<template>
  <div class="lg-dlg-mask" @click="emit('close')">
    <div class="lg-dlg" @click.stop>
      <div class="lg-dlg-h">
        <h3>导入前确认 · {{ items.length }} 个未登记租户</h3>
        <p>下列租户名在租户表中不存在。选择「创建并关联」或「新建独立租户」将以业务类型「未分类」自动建档;选择「跳过该行」则该租户的台账行不导入。</p>
      </div>
      <div class="lg-dlg-b">
        <div v-for="(it, i) in items" :key="it.name" class="lg-rs-row">
          <span class="lg-rs-name">{{ it.name }}</span>
          <select class="lg-rs-sel" v-model="actions[i]">
            <option v-if="it.suggest" value="link">创建并关联到 {{ it.suggest.companyName }}</option>
            <option value="create">新建独立租户</option>
            <option value="skip">跳过该行</option>
          </select>
        </div>
      </div>
      <div class="lg-dlg-f">
        <Button variant="gray" size="sm" @click="emit('close')">取消导入</Button>
        <Button variant="filled" size="sm" @click="submit">
          <template #leading><component :is="iconFor('check')" :size="14" /></template>
          确认并继续导入
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 1:1 LedgerNewCompanyDialog .lg-dlg(宽放到 560px 容纳「名字 + 动作」两列) */
.lg-dlg-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:80; display:grid; place-items:center; opacity:0; animation:lgfade .16s forwards; }
@keyframes lgfade { to { opacity:1; } }
.lg-dlg { width:min(560px,90vw); background:var(--surface-white); border-radius:var(--radius-xl); box-shadow:0 16px 48px rgba(28,28,28,.22);
  overflow:hidden; animation:lgrise .2s var(--ease-standard) both; }
@keyframes lgrise { from { opacity:0; transform:translateY(10px) scale(.99); } to { opacity:1; transform:translateY(0) scale(1); } }
.lg-dlg-h { padding:20px 22px 0; }
.lg-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.lg-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.lg-dlg-b { padding:18px 22px 4px; max-height:52vh; overflow-y:auto; display:flex; flex-direction:column; gap:8px; }
.lg-rs-row { display:flex; align-items:center; gap:12px; }
.lg-rs-name { flex:1; min-width:0; font-size:13px; font-weight:var(--fw-medium); color:var(--text-primary);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.lg-rs-sel { flex:0 0 232px; box-sizing:border-box; height:34px; padding:0 10px; font-size:12.5px; color:var(--text-primary);
  border:1px solid var(--border-subtle); border-radius:var(--radius-md); outline:none; background:var(--surface-white);
  font-family:var(--font-sans); transition:border-color var(--dur-fast) var(--ease-standard); }
.lg-rs-sel:focus { border-color:var(--hue-blue); }
.lg-dlg-f { display:flex; justify-content:flex-end; gap:8px; padding:16px 22px 20px; }
</style>
