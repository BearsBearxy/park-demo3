<script setup lang="ts">
// 统一附表页头 — 共享脚手架。返回 + 标题 + 年份徽标 + 编辑模式徽标 + 编辑/完成。
// 1:1 移植 ledger-common.jsx LedgerHeader(.lc-head/.lc-yearbadge/.lc-editbadge)。
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import { useAuthStore } from '@/stores/auth'

const props = withDefaults(defineProps<{
  icon: string
  title: string
  sub?: string
  year: number
  edit: boolean
  /** 本屏写权限键(RBAC-SPEC)。无此权限时编辑与导入按钮不渲染,数据照常显示。
   *  必填 —— 7 个消费屏各传各的(附表族 entry:edit,损益附表 report:edit)。 */
  perm: string
  /** 本屏是否有导入能力。导入按钮由本组件统一渲染 —— 此前 7 屏各自往 #idle-actions 里
   *  塞了逐字相同的 5 行按钮,门控也就散成 7 份。 */
  showImport?: boolean
  /** 导入按钮禁用(母册附表保存中) */
  importDisabled?: boolean
  /** 未保存的草稿处数。>0 时导入前二次确认 —— 导入落库后要重拉数据,会静默冲掉草稿。
   *  只有附表10 与母册附表有草稿(其余 5 屏是抽屉即时落库),它们传,别的屏不用管。 */
  dirty?: number
}>(), { showImport: false, importDisabled: false, dirty: 0 })

const emit = defineEmits<{ back: []; 'toggle-edit': []; import: [] }>()

// 无写权限:编辑与导入按钮一律不渲染(EDIT-MODE-SPEC v2 §1 末条)。数据本身照常显示。
// 放这里而不是放 7 个消费屏 —— 那 7 屏原本一个都没引 auth,门是整体缺失的,不是漏了某屏。
const auth = useAuthStore()

function onImport() {
  if (props.dirty > 0 &&
      !confirm(`当前有 ${props.dirty} 处修改尚未保存。\n导入会重新载入本期数据,这些修改将丢失。\n\n仍要导入?`)) return
  emit('import')
}
</script>

<template>
  <div class="lc-head">
    <div class="lc-head-l">
      <button class="lc-back" @click="emit('back')" title="返回年份选择">
        <component :is="iconFor('arrow-left')" :size="17" />
      </button>
      <div>
        <h2 class="lc-title"><component :is="iconFor(icon)" :size="20" />{{ title }}</h2>
        <p v-if="sub" class="lc-sub">{{ sub }}</p>
      </div>
    </div>
    <div class="lc-head-actions">
      <span class="lc-yearbadge"><component :is="iconFor('calendar')" :size="14" />{{ year }} 年</span>
      <span v-if="edit" class="lc-editbadge"><component :is="iconFor('pencil')" :size="13" />编辑模式</span>
      <slot v-if="edit" name="edit-actions" />
      <!-- 导入 = 写操作,收进编辑态(EDIT-MODE-SPEC v2 §1「浏览态一切写入口隐藏」)。
           改前是 `v-if="!edit"` 的 #idle-actions 插槽,依据是 2026-07-11 的旧决定「导入常驻非编辑态」,
           与 07-20 定稿的 v2 直接冲突 —— 表现为本系统两套互斥的肌肉记忆:这 8 屏「退出编辑才能导入」,
           抄表/光伏/充电桩/电费成本 4 屏「进编辑才能导入」。按较新的 v2 收敛。
           顺带堵掉:浏览态暴露导入 = 任何看数据的人误点两下就覆盖整月台账。 -->
      <Button v-if="edit && showImport && auth.can(perm)" variant="outline" size="sm"
              :disabled="importDisabled" @click="onImport">
        <template #leading><component :is="iconFor('upload')" :size="14" /></template>
        导入 Excel
      </Button>
      <slot name="static-actions" />
      <!-- 文案与形态对齐 EDIT-MODE-SPEC §2 与抄表屏样板(MeterView.vue:583):
           浏览态 outline(编辑是次要动作) → 编辑态 filled(完成是主要动作)。
           改前这里恒 filled + 文案「编辑表格」,与 6 个抄表族屏的 outline +「编辑模式」两派并存。 -->
      <Button v-if="auth.can(perm)" :variant="edit ? 'filled' : 'outline'" size="sm" @click="emit('toggle-edit')">
        <template #leading><component :is="iconFor(edit ? 'check' : 'pencil')" :size="14" /></template>
        {{ edit ? '完成' : '编辑模式' }}
      </Button>
    </div>
  </div>
</template>

<style scoped>
/* 1:1 from ledger-common.jsx LedgerCommonStyles (.lc-head 段,44-55) */
.lc-head { flex:0 0 auto; display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.lc-head-l { display:flex; align-items:center; gap:12px; min-width:0; }
.lc-back { width:36px; height:36px; flex:0 0 auto; border:1px solid var(--border-subtle); background:var(--surface-white); border-radius:var(--radius-md); cursor:pointer; display:grid; place-items:center; color:var(--text-secondary); transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.lc-back:hover { background:var(--bg-hover); color:var(--text-primary); }
.lc-title { margin:0; font:var(--type-h2); font-size:var(--fs-h2); font-weight:var(--fw-semibold); color:var(--text-primary); display:flex; align-items:center; gap:10px; }
.lc-sub { margin:4px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.lc-head-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.lc-yearbadge { display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 12px; border-radius:var(--radius-full); background:var(--accent-blue); color:var(--hue-blue); font-size:12.5px; font-weight:var(--fw-semibold); font-family:var(--font-mono); font-variant-numeric:tabular-nums; white-space:nowrap; }
.lc-editbadge { display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 12px; border-radius:var(--radius-full); background:rgb(255,243,230); color:var(--hue-orange); font-size:12.5px; font-weight:var(--fw-medium); white-space:nowrap; }
</style>
