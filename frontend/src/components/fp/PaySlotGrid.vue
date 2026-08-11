<script setup lang="ts">
// 收款方方格(S20-BILL-DELIVERY-SPEC §2.2「去指定」落点):催缴单明细抽屉里的一段——
// 该户本月有钱的收款槽逐格铺开,多选 → 底部指定公司 → 应用。数据源=payBookLogic.buildSlotCells。
// 只发事件不落库:保存由宿主(BillNoticesView 抽屉)统一提交 PUT /bills/paymap,失败提示也归宿主。
import { computed, ref, watch } from 'vue'
import type { S10ColId } from '@/types/s10'
import type { SlotCell } from '@/utils/payBookLogic'
import { fpMoney } from '@/utils/money'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'

const props = withDefaults(defineProps<{
  cells: SlotCell[]
  companies: { id: number; name: string; short?: string }[]
  canEdit?: boolean
  saving?: boolean
}>(), { canEdit: true, saving: false })

const emit = defineEmits<{ save: [{ colIds: S10ColId[]; companyId: number }] }>()

const selected = ref(new Set<string>())
const coId = ref('')

// 换户/重载后格子变了:清掉已选,免得把上一户的选择应用到这户
watch(() => props.cells, () => { selected.value = new Set() })

const coOpts = computed(() =>
  props.companies.map(c => ({ value: String(c.id), label: c.short || c.name })))

function toggle(colId: string) {
  if (!props.canEdit) return
  if (selected.value.has(colId)) selected.value.delete(colId)
  else selected.value.add(colId)
  selected.value = new Set(selected.value)
}
function apply() {
  if (!coId.value || selected.value.size === 0) return
  emit('save', { colIds: [...selected.value] as S10ColId[], companyId: +coId.value })
  selected.value = new Set()
}
</script>

<template>
  <div class="psg">
    <div v-if="cells.length === 0" class="psg-empty">该户本月没有需要指定收款方的费用</div>

    <div v-else class="psg-grid">
      <button v-for="c in cells" :key="c.colId" type="button" class="psg-cell"
              :class="{ sel: selected.has(c.colId), gap: c.companyId == null, ro: !canEdit }"
              :title="[c.items.join('、'), c.note, c.inherit].filter(Boolean).join('\n')"
              @click="toggle(c.colId)">
        <span class="psg-hd">
          <b>{{ c.label }}</b>
          <em v-if="c.amount != null" class="psg-amt">{{ fpMoney(c.amount) }}</em>
        </span>
        <span class="psg-items">{{ c.items.join('、') }}</span>
        <span class="psg-co" :class="{ inh: !!c.inherit, none: c.companyId == null }">
          <template v-if="c.companyId != null">
            {{ c.companyName }}<em v-if="c.inherit">（{{ c.inherit }}）</em>
          </template>
          <template v-else>未设置</template>
        </span>
        <span v-if="c.neverSeeded && c.companyId == null" class="psg-tag">系统从无默认</span>
        <span v-if="c.note" class="psg-tag alt">整单通吃</span>
      </button>
    </div>

    <div v-if="canEdit && cells.length" class="psg-bar">
      <span>已选 <b>{{ selected.size }}</b> 项</span>
      <span class="psg-sep">·</span>
      <span>指定收款公司</span>
      <div style="width:170px">
        <Select :options="coOpts" :model-value="coId" size="sm" placeholder="选择公司"
                @update:model-value="coId = $event" />
      </div>
      <Button variant="outline" size="sm" :disabled="selected.size === 0 || !coId || saving" @click="apply">
        <template #leading><component :is="iconFor('check')" :size="14" /></template>
        {{ saving ? '保存中…' : '应用' }}
      </Button>
    </div>
  </div>
</template>

<style scoped>
.psg { display: flex; flex-direction: column; gap: 10px; }
.psg-empty { padding: 18px; text-align: center; color: var(--text-disabled); font-size: var(--fs-label); }

.psg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; }
.psg-cell { position: relative; display: flex; flex-direction: column; gap: 4px; padding: 9px 11px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-white); text-align: left; cursor: pointer; font-family: var(--font-sans); }
.psg-cell:hover { background: var(--surface-card); }
.psg-cell.sel { border-color: var(--hue-blue); background: rgba(10, 132, 255, 0.06); }
.psg-cell.gap { border-style: dashed; }
.psg-cell.ro { cursor: default; }
.psg-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.psg-hd b { font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.psg-amt { font-style: normal; font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.psg-items { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.psg-co { font-size: 12px; color: var(--text-primary); }
.psg-co.inh { color: var(--text-muted); }
.psg-co.inh em { font-style: normal; font-size: 10.5px; }
.psg-co.none { color: rgb(178, 100, 0); }
.psg-tag { align-self: flex-start; padding: 1px 6px; border-radius: var(--radius-full); background: rgba(255, 149, 0, 0.14); font-size: 10.5px; color: rgb(178, 100, 0); }
.psg-tag.alt { background: var(--surface-sunken); color: var(--text-muted); }

.psg-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-card); font-size: 12.5px; color: var(--text-secondary); flex-wrap: wrap; }
.psg-bar b { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.psg-sep { color: var(--text-disabled); }
</style>
