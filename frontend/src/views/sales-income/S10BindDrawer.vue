<script setup lang="ts">
// 附表10 行级绑定弹窗 —— 抄表屏「表档案·租户」同款交互(用户 2026-08-23 指定):
// 点开一条 → FPTenantPicker 选定即绑,解绑按钮显式;账面名保持原文,绑定只挂档案身份。
import { ref, computed } from 'vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPSectionLabel from '@/components/fp/FPSectionLabel.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import type { FPTenantOption } from '@/components/fp/fpTenantPicker'
import Button from '@/components/ds/Button.vue'
import type { S10RecordDTO } from '@/types/s10'

const props = defineProps<{
  row: S10RecordDTO | null
  /** 槽标注(如「2026年12月 · 一期」),行 DTO 不含账期,由屏状态传入 */
  slotLabel: string
  tenants: FPTenantOption[]
  /** 编辑模式 + entry:edit 才能绑/解/换;浏览态只显示状态(EDIT-MODE §1) */
  canBind: boolean
  onBind: (id: number, tenantId: number | null) => Promise<void>
  /** 行级改账面名(change 即提交;未绑定行改对名字自动配档;同槽同名 409) */
  onRename: (id: number, tenantName: string) => Promise<void>
}>()
const emit = defineEmits<{ close: [] }>()

const binding = ref(false)
const boundName = computed(() =>
  props.row?.tenantId != null
    ? props.tenants.find(t => t.id === props.row!.tenantId)?.name ?? `#${props.row!.tenantId}`
    : null)

async function commitBind(tenantId: number | null) {
  const r = props.row
  if (!r || !props.canBind || binding.value) return
  if (tenantId === r.tenantId) return
  binding.value = true
  try { await props.onBind(r.id, tenantId) } finally { binding.value = false }
}
async function commitRename(e: Event) {
  const r = props.row
  const v = (e.target as HTMLInputElement).value.trim()
  if (!r || !props.canBind || binding.value) return
  if (!v || v === r.tenantName) { (e.target as HTMLInputElement).value = r.tenantName; return }
  binding.value = true
  try { await props.onRename(r.id, v) } finally { binding.value = false }
}
</script>

<template>
  <FPDrawer
    :open="!!row"
    :title="row?.tenantName ?? ''"
    :subtitle="`附表10 · ${slotLabel} · 账面名保持原文,绑定只挂档案身份`"
    icon="user"
    :width="480"
    @close="emit('close')"
  >
    <template v-if="row">
      <div>
        <FPSectionLabel icon="git-compare">租户绑定</FPSectionLabel>
        <div class="s10-bind-fld">
          <label>账面名(导入原文,与档案名可不一致)</label>
          <input v-if="canBind" class="s10-bind-in" type="text" :value="row.tenantName"
                 :disabled="binding" title="回车/失焦保存;未绑定行改对名字会自动配档"
                 @change="commitRename" />
          <span v-else>{{ row.tenantName }}</span>
        </div>
        <div v-if="canBind" class="s10-bind">
          <FPTenantPicker
            :tenants="tenants"
            :model-value="row.tenantId"
            :disabled="binding"
            :placeholder="row.tenantId == null ? '选择租户档案(绑定后参与按租户汇总/核对)' : undefined"
            @update:model-value="commitBind($event)"
          />
          <Button v-if="row.tenantId != null" size="sm" variant="ghost" :disabled="binding"
                  @click="commitBind(null)">解绑</Button>
        </div>
        <div v-else class="s10-bind-ro">
          <template v-if="row.tenantId != null">
            已绑定:<b>{{ boundName ?? '…' }}</b>
            <span v-if="boundName && boundName !== row.tenantName" class="hint">(账面名「{{ row.tenantName }}」保持不变)</span>
          </template>
          <template v-else>
            <span class="unb">未绑定</span> 账面名未挂到租户档案 —— 进入「编辑」模式后可在此绑定
          </template>
        </div>
      </div>
      <p class="s10-bind-note">
        绑定/解绑立即生效,不需要点「保存」;账面名与档案名允许不一致(如账面记老板名、档案是公司名)。
      </p>
    </template>
  </FPDrawer>
</template>

<style scoped>
.s10-bind-fld { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; }
.s10-bind-fld label { font-size: 11px; color: var(--text-muted); }
.s10-bind-fld span { font-size: 13px; color: var(--text-primary); }
.s10-bind-in {
  height: 32px; padding: 0 10px; font-size: 13px; color: var(--text-primary);
  background: var(--surface-page); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm); outline: none; width: 100%;
}
.s10-bind-in:focus { border-color: var(--hue-blue); }
.s10-bind { display: flex; align-items: center; gap: 8px; }
.s10-bind > :first-child { flex: 1 1 auto; min-width: 0; }
.s10-bind-ro { font-size: 12.5px; color: var(--text-secondary); line-height: 1.6; }
.s10-bind-ro b { color: var(--text-primary); }
.s10-bind-ro .hint { color: var(--text-muted); }
.s10-bind-ro .unb {
  display: inline-block; font-size: 11px; font-weight: var(--fw-medium); line-height: 1;
  padding: 2px 6px; border-radius: var(--radius-full); margin-right: 6px;
  color: var(--status-warning); border: 1px solid var(--status-warning);
}
.s10-bind-note { margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.6; }
</style>
