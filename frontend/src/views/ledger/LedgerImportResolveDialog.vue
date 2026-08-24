<script setup lang="ts">
// 台账导入预检弹窗 — 样式 1:1 LedgerNewCompanyDialog 的 .lg-dlg 居中弹窗(宽 560px)。
// 导入表里出现租户表没有的名字时,逐名决策:创建并关联到推荐主租户 / 新建独立租户 / 跳过该行。
import { ref } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import { useAuthStore } from '@/stores/auth'

export interface ResolveItem { name: string; suggest: { id: number; companyName: string } | null }
export interface ResolveDecision { name: string; action: 'link' | 'create' | 'skip'; parentId?: number }

const props = defineProps<{ items: ResolveItem[] }>()
const emit = defineEmits<{ confirm: [decisions: ResolveDecision[]]; close: [] }>()

// 建档 = master(RBAC §5.6:台账导入不得成为建租户档案的旁路)。
// link 与 create 两档都会 tenantApi.create(link 只是多带一个 parentId),故无权时两档一起收,只剩「跳过」。
const auth = useAuthStore()
const canCreate = auth.can('master:edit')

// 每行动作:有推荐默认 link,无推荐默认 create;无建档权则一律 skip
const actions = ref<('link' | 'create' | 'skip')[]>(
  props.items.map(it => (!canCreate ? 'skip' : it.suggest ? 'link' : 'create')))

// 无推荐的行不出「创建并关联」档:选了也没有 parentId,submit 会退化成独立建档,选项形同虚设
function optsFor(it: ResolveItem) {
  if (!canCreate) return [{ value: 'skip', label: '跳过该行' }]
  return [
    ...(it.suggest ? [{ value: 'link', label: `创建并关联到 ${it.suggest.companyName}` }] : []),
    { value: 'create', label: '新建独立租户' },
    { value: 'skip', label: '跳过该行' },
  ]
}
// ds/Select 只吐字符串,窄回联合类型(值域由 optsFor 保证)
function setAction(i: number, v: string) { actions.value[i] = v as 'link' | 'create' | 'skip' }

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
        <p v-if="canCreate">下列租户名在租户表中不存在。选择「创建并关联」或「新建独立租户」将以业务类型「未分类」自动建档;选择「跳过该行」则该租户的台账行不导入。</p>
        <p v-else>下列租户名在租户表中不存在。当前账号没有建租户档案的权限,这些行只能跳过(其余行照常导入);需要建档请联系有主数据权限的同事先在「租户管理」登记。</p>
      </div>
      <div class="lg-dlg-b">
        <div v-for="(it, i) in items" :key="it.name" class="lg-rs-row">
          <span class="lg-rs-name">{{ it.name }}</span>
          <div class="lg-rs-sel">
            <Select size="sm" :options="optsFor(it)" :model-value="actions[i]"
              @update:model-value="setAction(i, $event)" />
          </div>
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
.lg-dlg-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:80; display:grid; place-items:center; opacity:0; animation:fp-fade-in var(--dur-base) forwards; }
.lg-dlg { width:min(560px,90vw); background:var(--surface-white); border-radius:var(--radius-xl); box-shadow:0 16px 48px rgba(28,28,28,.22);
  overflow:hidden; animation:fp-rise-in var(--dur-base) var(--ease-standard) both; }
.lg-dlg-h { padding:20px 22px 0; }
.lg-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.lg-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.lg-dlg-b { padding:18px 22px 4px; max-height:52vh; overflow-y:auto; display:flex; flex-direction:column; gap:8px; }
.lg-rs-row { display:flex; align-items:center; gap:12px; }
.lg-rs-name { flex:1; min-width:0; font-size:13px; font-weight:var(--fw-medium); color:var(--text-primary);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* 动作列只管定宽,外观归 ds/Select */
.lg-rs-sel { flex:0 0 232px; }
.lg-dlg-f { display:flex; justify-content:flex-end; gap:8px; padding:16px 22px 20px; }
</style>
