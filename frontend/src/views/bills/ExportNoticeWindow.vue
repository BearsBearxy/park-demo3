<script setup lang="ts">
// 导出「发租户 · 通知单」窗口(S20-BILL-DELIVERY-SPEC §5.1):期页签 + 楼栋分组 + 租户多选,
// 默认勾选已确认的户(未确认的可勾,点导出时提示不阻断);每家公司选用哪个收款账户(默认取 is_default)。
// 导出粒度=一户一个 Excel 文件(2026-08-14 改:不再按公司分文件夹——一户可能要给几家公司转账,
// 分文件夹等于把同一户的单据拆到几处);同户跨两家公司=文件内两个 sheet。
// 本组件只负责「选什么、用哪个账户」,真正写文件与 mark-exported 由宿主处理:emit('export', req)。
import { computed, ref, watch } from 'vue'
import { companyBookApi, type CompanyFullDTO } from '@/api/billDelivery'
import type { BuildingDTO } from '@/types/building'
import { groupByBuilding } from '@/utils/billNoticeLogic'
import {
  STATUS_LABEL, buildPayRows,
  type ExportNoticeReq, type PayContractIn, type PayNoticeIn, type PayTenantRow,
} from '@/utils/payBookLogic'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import Segmented from '@/components/ds/Segmented.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'

const props = defineProps<{
  open: boolean
  ym: string
  phase: string
  notices: PayNoticeIn[]
  contracts: PayContractIn[]
  buildings: BuildingDTO[]
  busy?: boolean          // 宿主导出中
}>()
const emit = defineEmits<{ close: []; export: [ExportNoticeReq] }>()

const phase = ref('1')
const PHASE_OPTS = [
  { value: '1', label: '一期' }, { value: '2', label: '二期' }, { value: '3', label: '三期' },
]
const q = ref('')
const confirmedOnly = ref(false)
const selected = ref(new Set<number>())
const acctByCo = ref<Record<number, string>>({})     // companyId → accountId 字符串(''=不印账户块)
const companies = ref<CompanyFullDTO[]>([])

const rowsAll = computed(() => buildPayRows(props.notices, props.contracts, props.buildings))
const phaseRows = computed(() => rowsAll.value.filter(r => r.phase === +phase.value))
const filtered = computed(() => phaseRows.value.filter(r =>
  (q.value.trim() === '' || r.tenantName.includes(q.value.trim()))
  && (!confirmedOnly.value || r.status === 'confirmed' || r.status === 'exported')))
const groups = computed(() => groupByBuilding(filtered.value, r => r.bld.main))

// 默认勾选=已确认未导出的户(spec §5.1);换期页签重算一次
function preselect() {
  selected.value = new Set(phaseRows.value.filter(r => r.status === 'confirmed').map(r => r.tenantId))
}
watch(() => props.open, async o => {
  if (!o) return
  phase.value = props.phase
  q.value = ''
  confirmedOnly.value = false
  preselect()
  try { companies.value = await companyBookApi.list() } catch { companies.value = [] }
  syncAccounts()
})
function setPhase(v: string) {
  if (v === phase.value) return
  phase.value = v
  preselect()
}

// ── 选中户涉及哪几家收款公司 → 每家选一个账户(默认 is_default,其次首个) ──
const selectedCoIds = computed(() => {
  const ids = new Set<number>()
  for (const n of props.notices)
    if (selected.value.has(n.tenantId) && n.payCompanyId != null) ids.add(n.payCompanyId)
  return [...ids]
})
const coById = computed(() => new Map(companies.value.map(c => [c.id, c])))
function syncAccounts() {
  const next = { ...acctByCo.value }
  for (const id of selectedCoIds.value) {
    if (next[id] !== undefined) continue
    const accs = coById.value.get(id)?.accounts ?? []
    const def = accs.find(a => a.isDefault) ?? accs[0]
    next[id] = def ? String(def.id) : ''
  }
  acctByCo.value = next
}
watch([selectedCoIds, companies], syncAccounts)
const acctOpts = (id: number) => [
  ...(coById.value.get(id)?.accounts ?? []).map(a => ({
    value: String(a.id),
    label: [a.accountName || a.bankName || a.accountNo || '账户', a.accountNo].filter(Boolean).join(' · '),
  })),
  { value: '', label: '不印账户块' },
]
const noAcctCos = computed(() => selectedCoIds.value.filter(id => !acctByCo.value[id]))

// ── 多选 ──
const allChecked = computed(() =>
  filtered.value.length > 0 && filtered.value.every(r => selected.value.has(r.tenantId)))
function toggleRow(id: number) {
  if (selected.value.has(id)) selected.value.delete(id)
  else selected.value.add(id)
  selected.value = new Set(selected.value)
}
function toggleAll() {
  if (allChecked.value) selected.value = new Set()
  else selected.value = new Set([...selected.value, ...filtered.value.map(r => r.tenantId)])
}

const picked = computed(() => rowsAll.value.filter(r => selected.value.has(r.tenantId)))
const sheetTotal = computed(() => picked.value.reduce((s, r) => s + r.sheetCount, 0))
const gapCount = computed(() => picked.value.filter(r => r.gap).length)
const notConfirmed = computed(() => picked.value.filter(r => r.status === 'draft' || r.status === 'partial'))

function onExport() {
  if (props.busy || picked.value.length === 0) return
  if (notConfirmed.value.length
    && !confirm(`选中的 ${notConfirmed.value.length} 户还没核对确认(${notConfirmed.value.slice(0, 3).map(r => r.tenantName).join('、')}${notConfirmed.value.length > 3 ? '…' : ''})。仍然导出?`)) return
  if (gapCount.value
    && !confirm(`其中 ${gapCount.value} 户有费用未指定收款公司,这部分通知单不会显示收款账户信息,租户可能不知道往哪付款。仍然导出?`)) return
  const accountByCompany: Record<number, number | null> = {}
  for (const id of selectedCoIds.value) accountByCompany[id] = acctByCo.value[id] ? +acctByCo.value[id] : null
  emit('export', { ym: props.ym, tenantIds: picked.value.map(r => r.tenantId), accountByCompany })
}
const statusOf = (r: PayTenantRow) => STATUS_LABEL[r.status]
</script>

<template>
  <FPDrawer :open="open" title="导出通知单" icon="download" :width="1040" :fixed-height="true"
            :subtitle="`发租户 · ${ym} · 一户一个 Excel(上表租金、下表水电),跨收款公司在文件内分 sheet,打包 zip`"
            @close="emit('close')">

    <div class="ex-controls">
      <Segmented :options="PHASE_OPTS" :model-value="phase" size="sm" @update:model-value="setPhase" />
      <input v-model="q" class="ex-search" type="text" placeholder="搜租户名" />
      <label class="ex-chk">
        <input type="checkbox" v-model="confirmedOnly" />
        只看已确认
      </label>
      <span style="flex:1"></span>
      <span class="ex-sum">已选 <b>{{ picked.length }}</b> 户 · <b>{{ picked.length }}</b> 个文件 / <b>{{ sheetTotal }}</b> 张单</span>
    </div>

    <!-- 每家公司用哪个账户(默认 is_default) -->
    <div v-if="selectedCoIds.length" class="ex-accts">
      <span class="ex-lbl">收款账户</span>
      <div v-for="id in selectedCoIds" :key="id" class="ex-acct">
        <span class="ex-co">{{ coById.get(id)?.short || coById.get(id)?.name || `#${id}` }}</span>
        <div style="width:200px">
          <Select :options="acctOpts(id)" :model-value="acctByCo[id] ?? ''" size="sm"
                  @update:model-value="acctByCo = { ...acctByCo, [id]: $event }" />
        </div>
      </div>
    </div>
    <div v-if="noAcctCos.length" class="ex-warn">
      <component :is="iconFor('info')" :size="14" />
      <span>{{ noAcctCos.length }} 家公司这次不印账户块(没录账户或选了「不印」)—— 通知单出简化版,不阻断。</span>
    </div>

    <div class="ex-wrap">
      <table class="ex-table">
        <colgroup>
          <col style="width:36px" /><col /><col style="width:150px" />
          <col style="width:96px" /><col style="width:130px" /><col style="width:96px" />
        </colgroup>
        <thead>
          <tr>
            <th class="ct"><input type="checkbox" :checked="allChecked" title="全选=当前筛选可见行" @change="toggleAll" /></th>
            <th class="l">租户</th>
            <th class="l">楼栋</th>
            <th>状态</th>
            <th>本期合计</th>
            <th title="一户一个文件;文件内按收款公司分 sheet(同户跨两家公司=两个 sheet),未设公司那部分也占一个(无账户块)">将出几张单</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="g in groups" :key="g.id ?? 'none'">
            <tr class="ex-band">
              <td class="l" colspan="6">
                <span class="ex-band-lbl">{{ g.name }}</span><span class="ex-band-sub">{{ g.count }} 户</span>
              </td>
            </tr>
            <tr v-for="r in g.rows" :key="r.tenantId" :class="{ sel: selected.has(r.tenantId) }"
                @click="toggleRow(r.tenantId)">
              <td class="ct">
                <input type="checkbox" :checked="selected.has(r.tenantId)" @click.stop @change="toggleRow(r.tenantId)" />
              </td>
              <td class="l">
                <span class="ex-tname" :title="r.tenantName">
                  {{ r.tenantName }}
                  <em v-if="r.gap" class="ex-dot" title="该户有费项未指定收款公司,这部分单不显示收款账户">●</em>
                </span>
              </td>
              <td class="l"><span class="ex-txt dim">{{ r.bld.main?.name ?? '–' }}</span></td>
              <td><span class="ex-st" :class="r.status">{{ statusOf(r) }}</span></td>
              <td><span class="ex-num">{{ r.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</span></td>
              <td><span class="ex-num">{{ r.sheetCount }}</span></td>
            </tr>
          </template>
          <tr v-if="filtered.length === 0">
            <td class="ex-noro" colspan="6">无匹配租户 —— 换期页签或取消「只看已确认」</td>
          </tr>
        </tbody>
      </table>
    </div>

    <template #footer>
      <span class="ex-foot">{{ picked.length }} 个文件 / {{ sheetTotal }} 张单<template v-if="gapCount"> · {{ gapCount }} 户无收款账户</template></span>
      <Button variant="outline" size="sm" @click="emit('close')">关闭</Button>
      <Button variant="filled" size="sm" :disabled="picked.length === 0 || busy" @click="onExport">
        <template #leading><component :is="iconFor('download')" :size="14" /></template>
        {{ busy ? '导出中…' : '导出 zip' }}
      </Button>
    </template>
  </FPDrawer>
</template>

<style scoped>
.ex-warn { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); font-size: 11.5px; color: var(--text-secondary); }

.ex-controls { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ex-search { width: 170px; height: 32px; padding: 0 12px; box-sizing: border-box; border: 1px solid var(--border-subtle); border-radius: var(--radius-full); font-size: 12.5px; background: var(--surface-white); color: var(--text-primary); }
.ex-search:focus { outline: none; border-color: var(--hue-blue); }
.ex-chk { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); cursor: pointer; }
.ex-chk input { accent-color: var(--hue-blue); cursor: pointer; }
.ex-sum { font-size: 12px; color: var(--text-secondary); }
.ex-sum b { color: var(--text-primary); font-variant-numeric: tabular-nums; }

.ex-accts { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 8px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-card); }
.ex-lbl { font-size: 11.5px; color: var(--text-muted); }
.ex-acct { display: flex; align-items: center; gap: 6px; }
.ex-co { font-size: 12px; font-weight: var(--fw-semibold); color: var(--text-primary); }

.ex-wrap { flex: 1 1 auto; min-height: 0; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--surface-white); }
.ex-table { border-collapse: separate; border-spacing: 0; width: 100%; table-layout: fixed; font-family: var(--font-sans); }
.ex-table th, .ex-table td { border-bottom: 1px solid var(--divider); box-sizing: border-box; padding: 0 8px; overflow: hidden; }
.ex-table thead th { position: sticky; top: 0; height: 34px; background: var(--surface-card); color: var(--text-muted); font-size: 11.5px; font-weight: var(--fw-semibold); text-align: right; z-index: 4; white-space: nowrap; }
.ex-table thead th.l, .ex-table td.l { text-align: left; }
.ex-table th.ct, .ex-table td.ct { text-align: center; }
.ex-table tbody td { height: 34px; background: var(--surface-white); vertical-align: middle; text-align: right; }
.ex-table tbody tr:hover td { background: var(--surface-card); }
.ex-table tbody tr.sel td { background: rgba(10, 132, 255, 0.06); }
.ex-table input[type='checkbox'] { accent-color: var(--hue-blue); cursor: pointer; }
.ex-table tr.ex-band td { height: 34px; background: var(--surface-sunken); border-top: 1px solid var(--border-strong); }
.ex-band-lbl { font-size: 12px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.ex-band-sub { margin-left: 8px; font-size: 11.5px; color: var(--text-muted); }
.ex-noro { text-align: center !important; padding: 40px 16px !important; color: var(--text-disabled); font-size: var(--fs-label); }
.ex-tname { display: block; font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ex-dot { font-style: normal; margin-left: 5px; font-size: 9px; color: rgb(255, 149, 0); cursor: help; }
.ex-txt { display: block; text-align: left; font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ex-txt.dim { color: var(--text-muted); }
.ex-num { display: block; text-align: right; font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.ex-st { display: inline-block; padding: 1px 7px; border-radius: var(--radius-full); background: var(--surface-sunken); font-size: 10.5px; color: var(--text-muted); }
.ex-st.confirmed { background: rgba(10, 132, 255, 0.12); color: rgb(10, 90, 170); }
.ex-st.exported { background: rgba(52, 199, 89, 0.14); color: rgb(21, 108, 60); }
.ex-st.partial { background: rgba(255, 149, 0, 0.14); color: rgb(178, 100, 0); }
.ex-foot { flex: 1; font-size: 11.5px; color: var(--text-muted); }
</style>
