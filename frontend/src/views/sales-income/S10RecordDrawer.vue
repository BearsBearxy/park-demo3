<script setup lang="ts">
// 右抽屉「新增租户」— 1:1 from screen-schedule10.jsx S10Drawer(173-213)，用共享 FPDrawer 壳。
// 租户名称 input + profile chips（office/factory 版面给不同选项）→ 保存 emit save。
// tenantId 留空、source 由后端定 manual；金额一律手填（初始为空）。
import { ref, computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import Button from '@/components/ds/Button.vue'
import { PROFILES, type LayoutId } from './layout'

const props = defineProps<{
  phaseName: string
  layout: LayoutId
}>()
const emit = defineEmits<{ close: []; save: [name: string, profile: string] }>()

const name = ref('')
const profiles = computed(() => PROFILES[props.layout])
const profile = ref(profiles.value[0].id)
const valid = computed(() => !!name.value.trim())

function save() {
  if (!valid.value) return
  emit('save', name.value.trim(), profile.value)
}
</script>

<template>
  <FPDrawer
    :open="true"
    :title="'新增租户 · ' + phaseName"
    subtitle="补一行租户到本月台账,保存后在编辑模式逐项填入收款金额"
    icon="coins"
    :width="440"
    @close="emit('close')"
  >
    <div class="s10d-fgrp">
      <span class="s10d-flabel">租户名称</span>
      <input
        class="s10d-finput"
        placeholder="如:华盛物流"
        v-model="name"
        @keydown.enter="save"
      />
    </div>

    <div class="s10d-fgrp">
      <span class="s10d-flabel">租户类型</span>
      <div class="s10d-seg">
        <button
          v-for="p in profiles"
          :key="p.id"
          :class="['s10d-chip', { on: profile === p.id }]"
          @click="profile = p.id"
        >{{ p.label }}</button>
      </div>
      <span class="s10d-hint">类型仅用于提示该租户通常涉及哪些收款项目;金额一律手动填写,初始为空。</span>
    </div>

    <template #footer>
      <Button variant="gray" @click="emit('close')">取消</Button>
      <Button variant="filled" :disabled="!valid" @click="save">
        <template #leading><component :is="iconFor('check')" :size="16" /></template>
        添加并编辑
      </Button>
    </template>
  </FPDrawer>
</template>

<style scoped>
/* 1:1 from screen-schedule10.jsx S10Styles(.s10-fgrp / .s10-finput / .s10-seg / .s10-chip 段) */
.s10d-fgrp { display:flex; flex-direction:column; gap:7px; }
.s10d-flabel { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); }
.s10d-finput { height:38px; width:100%; box-sizing:border-box; border:1px solid var(--border-subtle); border-radius:8px; padding:0 12px; font-family:var(--font-sans); font-size:13.5px; color:var(--text-primary); background:var(--surface-white); outline:none; transition:border-color var(--dur-fast); }
.s10d-finput:focus { border-color:var(--border-strong); }
.s10d-seg { display:flex; gap:6px; flex-wrap:wrap; }
.s10d-chip { flex:1 1 0; min-width:72px; height:38px; border:1px solid var(--border-subtle); background:var(--surface-white); border-radius:8px; cursor:pointer; font-family:var(--font-sans); font-size:13px; color:var(--text-secondary); display:flex; align-items:center; justify-content:center; gap:6px; transition:all var(--dur-fast); }
.s10d-chip:hover { background:var(--surface-card); }
.s10d-chip.on { border-color:var(--ink-900); background:var(--ink-900); color:#fff; }
.s10d-hint { font-size:11.5px; color:var(--text-muted); line-height:1.5; }
</style>
