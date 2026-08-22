<script setup lang="ts">
// 导出「发财务 · 对账表」窗口(S20-BILL-DELIVERY-SPEC §5.2):单文件多 sheet ——
// 每家收款公司一个 sheet(户 × 费项 × 金额)+ 一张总表(各公司合计与未设置公司清单)。
// 这里只勾 sheet(默认全勾),写文件由宿主处理:emit('export', req)。
import { computed, ref, watch } from 'vue'
import { buildReconSheets, type ExportReconReq, type PayNoticeIn } from '@/utils/payBookLogic'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'

const props = defineProps<{
  open: boolean
  ym: string
  notices: PayNoticeIn[]
  busy?: boolean
}>()
const emit = defineEmits<{ close: []; export: [ExportReconReq] }>()

const sheets = computed(() => buildReconSheets(props.notices))
// 总表由导出实现恒出(各公司合计+未设置清单),不给勾:勾了不生效比不给勾更糟
const optional = computed(() => sheets.value.filter(s => s.kind !== 'total'))
const picked = ref(new Set<string>())
watch(() => props.open, o => { if (o) picked.value = new Set(optional.value.map(s => s.id)) })

const allChecked = computed(() => optional.value.length > 0 && optional.value.every(s => picked.value.has(s.id)))
function toggle(id: string) {
  if (picked.value.has(id)) picked.value.delete(id)
  else picked.value.add(id)
  picked.value = new Set(picked.value)
}
function toggleAll() {
  picked.value = allChecked.value ? new Set() : new Set(optional.value.map(s => s.id))
}
const money = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function onExport() {
  if (props.busy || picked.value.size === 0) return
  emit('export', {
    ym: props.ym,
    sheets: optional.value.filter(s => picked.value.has(s.id))
      .map(s => ({ companyId: s.companyId, name: s.label })),
  })
}
</script>

<template>
  <FPDrawer :open="open" title="导出对账表" icon="file-spreadsheet" :width="760"
            :subtitle="`发财务 · ${ym} · 单文件多 sheet,每家收款公司一张 + 总表`"
            @close="emit('close')">

    <table class="er-table">
      <colgroup>
        <col style="width:36px" /><col style="width:180px" /><col style="width:72px" />
        <col style="width:120px" /><col />
      </colgroup>
      <thead>
        <tr>
          <th class="ct"><input type="checkbox" :checked="allChecked" title="全选/全不选(总表除外)" @change="toggleAll" /></th>
          <th class="l">Sheet</th>
          <th>户数</th>
          <th>金额</th>
          <th class="l">说明</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in sheets" :key="s.id"
            :class="{ sel: s.kind === 'total' || picked.has(s.id), none: s.kind === 'none' }"
            @click="s.kind !== 'total' && toggle(s.id)">
          <td class="ct">
            <input type="checkbox" :checked="s.kind === 'total' || picked.has(s.id)" :disabled="s.kind === 'total'"
                   :title="s.kind === 'total' ? '总表恒出,不可取消' : undefined"
                   @click.stop @change="toggle(s.id)" />
          </td>
          <td class="l"><span class="er-name">{{ s.label }}</span></td>
          <td><span class="er-num">{{ s.tenants }}</span></td>
          <td><span class="er-num">{{ money(s.amount) }}</span></td>
          <td class="l"><span class="er-note">{{ s.note }}</span></td>
        </tr>
        <tr v-if="sheets.length === 0">
          <td class="er-noro" colspan="5">本月没有催缴单可对账 —— 先在催缴单页生成本月。</td>
        </tr>
      </tbody>
    </table>

    <template #footer>
      <span class="er-foot">总表 + 已选 {{ picked.size }} / {{ optional.length }} 张公司 sheet</span>
      <Button variant="outline" size="sm" @click="emit('close')">关闭</Button>
      <Button variant="filled" size="sm" :disabled="picked.size === 0 || busy" @click="onExport">
        <template #leading><component :is="iconFor('download')" :size="14" /></template>
        {{ busy ? '导出中…' : '导出 xlsx' }}
      </Button>
    </template>
  </FPDrawer>
</template>

<style scoped>
.er-table { border-collapse: separate; border-spacing: 0; width: 100%; table-layout: fixed; font-family: var(--font-sans); }
.er-table th, .er-table td { border-bottom: 1px solid var(--divider); box-sizing: border-box; padding: 0 8px; overflow: hidden; }
.er-table thead th { height: 32px; background: var(--surface-card); color: var(--text-muted); font-size: 11.5px; font-weight: var(--fw-semibold); text-align: right; white-space: nowrap; }
.er-table thead th.l, .er-table td.l { text-align: left; }
.er-table th.ct, .er-table td.ct { text-align: center; }
.er-table tbody td { height: 36px; vertical-align: middle; text-align: right; cursor: pointer; }
.er-table tbody tr:hover td { background: var(--surface-card); }
.er-table tbody tr.sel td { background: rgba(10, 132, 255, 0.06); }
.er-table input[type='checkbox'] { accent-color: var(--hue-blue); cursor: pointer; }
.er-name { font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.er-table tr.none .er-name { color: rgb(178, 100, 0); }
.er-num { display: block; text-align: right; font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.er-note { font-size: 11.5px; color: var(--text-muted); }
.er-noro { text-align: center !important; padding: 30px 12px !important; color: var(--text-disabled); font-size: var(--fs-label); }
.er-foot { flex: 1; font-size: 11.5px; color: var(--text-muted); }
</style>
