<script setup lang="ts">
// 收款簿窗口(S20-BILL-DELIVERY-SPEC §3 入口2 / S19 批量):批量指定 租户 × 收款槽 → 公司。
// 容器与交互范式照抄 CoefBookWindow(居中 FPDrawer/期页签/楼栋分组/多选/统一修改条唯一改值入口/
// 暂存-保存两段/切换与关闭前二次确认):同一个页面的两个簿,手法不一致会让用户重新学一遍。
// 收款槽=附表10 colId(不是催缴单 fee_key):一个槽承接多个费项,注册表与继承口径在 payBookLogic。
// 写=PUT /bills/paymap 单格 upsert 序列(与账单屏徽标同一张表);viewer 只读查看。
import { computed, ref, watch } from 'vue'
import { billsApi } from '@/api/bills'
import { companyBookApi, type CompanyFullDTO } from '@/api/billDelivery'
import type { S10ColId } from '@/types/s10'
import type { BuildingDTO } from '@/types/building'
import { groupByBuilding } from '@/utils/billNoticeLogic'
import {
  COL_SLOTS, buildPayMap, buildPayPlan, buildPayRows, payKey, resolveSlot, slotFeeNames, slotGap,
  slotLabel, slotOf,
  type PayContractIn, type PayMap, type PayNoticeIn, type PayStash, type PayTenantRow,
} from '@/utils/payBookLogic'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import Segmented from '@/components/ds/Segmented.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'

const props = defineProps<{
  open: boolean
  ym: string                    // 催缴单页当前账期(只用于副标题:paymap 无月份维度)
  phase: string                 // 初始期页签('1'|'2'|'3')
  notices: PayNoticeIn[]        // 当月催缴单列表行(租户清单/缺口/宿舍判定同源)
  contracts: PayContractIn[]    // 当月在租合同(期归属/楼栋)
  buildings: BuildingDTO[]
}>()
const emit = defineEmits<{ close: []; saved: [] }>()

const auth = useAuthStore()
const canEdit = computed(() => !auth.isReadonly)
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback

// ── 窗口态 ──
const phase = ref('1')
const PHASE_OPTS = [
  { value: '1', label: '一期' }, { value: '2', label: '二期' }, { value: '3', label: '三期' },
]
const q = ref('')
const colId = ref<string>(COL_SLOTS[0].colId)
const unsetOnly = ref(false)
const editMode = ref(false)
const stash = ref<PayStash>(new Map())
const selected = ref(new Set<number>())
const uniCo = ref('')

const curSlot = computed(() => slotOf(colId.value) ?? COL_SLOTS[0])

// ── 数据:公司主数据 + paymap 全量;竞态守卫 ──
const loading = ref(false)
const companies = ref<CompanyFullDTO[]>([])
const paymap = ref<PayMap>(new Map())
let seq = 0
async function load() {
  const my = ++seq
  loading.value = true
  try {
    const [cos, pm] = await Promise.all([companyBookApi.list(), billsApi.paymap()])
    if (my !== seq) return
    companies.value = cos
    paymap.value = buildPayMap(pm)
  } catch (e) {
    if (my !== seq) return
    alert(errMsg(e, '收款簿数据加载失败'))
    emit('close')
  } finally { if (my === seq) loading.value = false }
}
watch(() => props.open, o => {
  if (!o) return
  phase.value = props.phase
  q.value = ''
  colId.value = COL_SLOTS[0].colId
  unsetOnly.value = false
  editMode.value = false
  uniCo.value = ''
  stash.value = new Map()
  selected.value = new Set()
  okMsg.value = ''
  load()
})

// 停用公司不进选择器(历史映射照旧显示名字);短名优先
const coOpts = computed(() => companies.value.filter(c => c.status !== 0)
  .map(c => ({ value: String(c.id), label: c.short || c.name })))
const coName = computed(() => new Map(companies.value.map(c => [c.id, c.short || c.name])))

// ── 行:催缴单 → 一户一行(期归属/主楼栋与催缴单列表同源) ──
const rowsAll = computed(() => buildPayRows(props.notices, props.contracts, props.buildings))
const phaseRows = computed(() => rowsAll.value.filter(r => r.phase === +phase.value))
const cell = (r: PayTenantRow) => resolveSlot(paymap.value, r.tenantId, curSlot.value, stash.value)
const filtered = computed(() => phaseRows.value.filter(r =>
  (q.value.trim() === '' || r.tenantName.includes(q.value.trim()))
  && (!unsetOnly.value || cell(r).companyId == null)
  // dormRent 只对有宿舍单的户有意义,别让其余户在这个槽下白占屏
  && (!curSlot.value.wholeNotice || r.dorm)))
const groups = computed(() => groupByBuilding(filtered.value, r => r.bld.main))
const nameOf = (id: number) => rowsAll.value.find(r => r.tenantId === id)?.tenantName ?? `#${id}`
watch([q, unsetOnly], () => {
  const vis = new Set(filtered.value.map(r => r.tenantId))
  for (const id of [...selected.value]) if (!vis.has(id)) selected.value.delete(id)
  selected.value = new Set(selected.value)
})

// ── 槽下拉:每槽显缺口户数(当前期页签口径);系统从无默认的槽标出来,免得用户以为是数据丢了 ──
const slotOpts = computed(() => COL_SLOTS.map(s => {
  const n = slotGap(phaseRows.value.filter(r => !s.wholeNotice || r.dorm), paymap.value, s, stash.value)
  const tag = s.neverSeeded ? '系统从无默认' : n === 0 ? '已设齐' : `缺 ${n} 户`
  return { value: s.colId, label: `${slotLabel(s.colId)} · ${tag}` }
}))
const slotHint = computed(() => {
  const s = curSlot.value
  const parts = [`承接:${slotFeeNames(s).join('、')}`]
  if (s.inheritFrom) parts.push(`未单独设置时继承「${slotLabel(s.inheritFrom)}」的收款公司`)
  if (s.neverSeeded) parts.push('系统从无默认值 —— 这一槽全库都是空的,要用就得自己指定')
  if (s.note) parts.push(s.note)
  return parts.join(' · ')
})

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
  else selected.value = new Set(filtered.value.map(r => r.tenantId))
}

// ── 统一修改条(唯一改值入口) ──
function applyUni() {
  if (selected.value.size === 0 || !uniCo.value) return
  const cid = +uniCo.value
  const next = new Map(stash.value)
  for (const id of selected.value) next.set(payKey(id, colId.value), cid)
  stash.value = next
}
function unstash(id: number) {
  const next = new Map(stash.value)
  next.delete(payKey(id, colId.value))
  stash.value = next
}
const stashOf = (id: number) => stash.value.get(payKey(id, colId.value))

// 切期/切槽前放弃确认(暂存跨槽存活会让"保存(N)"里混着看不见的行,不如挡在这)
function guardDrop(): boolean {
  if (stash.value.size === 0) return true
  if (!confirm(`有 ${stash.value.size} 条未保存暂存,切换将放弃这些改动。继续?`)) return false
  stash.value = new Map()
  return true
}
function setPhase(v: string) {
  if (v === phase.value || !guardDrop()) return
  phase.value = v
  selected.value = new Set()
}
function setSlot(v: string) {
  if (v === colId.value || !guardDrop()) return
  colId.value = v
  selected.value = new Set()
}

// ── 保存:逐条 PUT(后端单格 upsert);失败中断报错并把已提交部分落到本地缓存 ──
const saving = ref(false)
const okMsg = ref('')
let okTimer: ReturnType<typeof setTimeout> | undefined
function flashOk(msg: string) {
  okMsg.value = msg
  clearTimeout(okTimer)
  okTimer = setTimeout(() => { okMsg.value = '' }, 5000)
}
async function onSave() {
  if (saving.value || stash.value.size === 0) return
  const plan = buildPayPlan(stash.value)
  saving.value = true
  try {
    let ok = 0
    for (const row of plan) {
      try { await billsApi.setPaymap(row) }
      catch (e) {
        alert(errMsg(e, `「${nameOf(row.tenantId)}」保存失败`) + `;之前 ${ok} 条已提交生效,窗口数据已刷新`)
        await load()
        return
      }
      const next = new Map(stash.value)
      next.delete(payKey(row.tenantId, row.feeKey))
      stash.value = next
      paymap.value.set(payKey(row.tenantId, row.feeKey), row.companyId)
      ok++
    }
    flashOk(`已保存 ${ok} 条收款指定 · 下次生成催缴单即按新映射拆单(已生成的单需重新生成才刷新)`)
    selected.value = new Set()
    uniCo.value = ''
    emit('saved')
    await load()
  } finally { saving.value = false }
}

async function exitEdit() {
  if (stash.value.size > 0) {
    if (confirm(`有 ${stash.value.size} 条暂存未保存。「确定」=先保存再退出;「取消」=下一步选择放弃`)) {
      await onSave()
      if (stash.value.size > 0) return
    } else if (confirm(`放弃这 ${stash.value.size} 条暂存改动?`)) {
      stash.value = new Map()
    } else return
  }
  editMode.value = false
  selected.value = new Set()
}
function onClose() {
  if (saving.value) return
  if (stash.value.size > 0
    && !confirm(`有 ${stash.value.size} 条未保存暂存,关闭将放弃。确认关闭?`)) return
  stash.value = new Map()
  emit('close')
}
</script>

<template>
  <FPDrawer :open="open" title="收款簿" icon="wallet" :width="1080" :fixed-height="true"
            :subtitle="`批量指定「租户 × 费用项」的收款公司 · ${ym} 在册 ${rowsAll.length} 户 · 映射与账期无关,改了即刻对以后生成的单生效`"
            @close="onClose">
    <div v-if="loading" class="pb-empty">加载中…</div>
    <template v-else>
      <div v-if="okMsg" class="pb-bar ok">
        <component :is="iconFor('check')" :size="14" />
        <span>{{ okMsg }}</span>
      </div>

      <!-- 控制行:期页签+搜索+只看未设置 | 收款槽下拉 -->
      <div class="pb-controls">
        <Segmented :options="PHASE_OPTS" :model-value="phase" size="sm" @update:model-value="setPhase" />
        <input v-model="q" class="pb-search" type="text" placeholder="搜租户名" />
        <label class="pb-chk" title="只列该槽当前解析不出收款公司的户(含继承后仍为空)">
          <input type="checkbox" v-model="unsetOnly" />
          只看未设置
        </label>
        <span style="flex:1"></span>
        <span class="pb-lbl">收款槽</span>
        <div style="width:260px">
          <Select :options="slotOpts" :model-value="colId" size="sm" @update:model-value="setSlot" />
        </div>
      </div>
      <div class="pb-hint">{{ slotHint }}</div>

      <!-- 统一修改条:勾选租户→选公司→应用到选中 -->
      <div v-if="editMode" class="pb-unibar">
        <span>已选 <b>{{ selected.size }}</b> 户</span>
        <span class="pb-sep">·</span>
        <span>统一指定为</span>
        <div style="width:170px">
          <Select :options="coOpts" :model-value="uniCo" size="sm" placeholder="选择公司"
                  @update:model-value="uniCo = $event" />
        </div>
        <Button variant="outline" size="sm" :disabled="selected.size === 0 || !uniCo" @click="applyUni">
          应用到选中
        </Button>
      </div>

      <div class="pb-wrap">
        <table class="pb-table">
          <colgroup>
            <col v-if="editMode" style="width:36px" />
            <col /><!-- 租户:唯一弹性列 -->
            <col style="width:150px" />
            <col style="width:100px" />
            <col style="width:220px" />
            <col v-if="editMode" style="width:170px" />
          </colgroup>
          <thead>
            <tr>
              <th v-if="editMode" class="ct">
                <input type="checkbox" :checked="allChecked" title="全选=当前筛选可见行" @change="toggleAll" />
              </th>
              <th class="l">租户</th>
              <th class="l">楼栋</th>
              <th title="该户本月催缴单本期合计(参考,判断这户值不值得单独设)">本期合计</th>
              <th title="当前收款公司;灰体=继承自上游槽,不是这一格自己设的">当前收款公司</th>
              <th v-if="editMode" title="暂存新值(保存后写 bill_pay_company);×=单行撤销">暂存新值</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="g in groups" :key="g.id ?? 'none'">
              <tr class="pb-band">
                <td class="l" :colspan="editMode ? 6 : 5">
                  <span class="pb-band-lbl">{{ g.name }}</span><span class="pb-band-sub">{{ g.count }} 户</span>
                </td>
              </tr>
              <tr v-for="r in g.rows" :key="r.tenantId"
                  :class="{ sel: selected.has(r.tenantId) }"
                  @click="editMode && toggleRow(r.tenantId)">
                <td v-if="editMode" class="ct">
                  <input type="checkbox" :checked="selected.has(r.tenantId)" @click.stop @change="toggleRow(r.tenantId)" />
                </td>
                <td class="l">
                  <span class="pb-tname" :title="r.tenantName">
                    {{ r.tenantName }}
                    <em v-if="r.gap" class="pb-dot" title="该户有费项未指定收款公司(提示不阻断)">●</em>
                  </span>
                </td>
                <td class="l">
                  <span class="pb-txt dim"
                        :title="r.bld.all.length > 1 ? r.bld.all.map(b => b.name).join('、') : undefined">
                    {{ r.bld.main?.name ?? '–' }}<em v-if="r.bld.all.length > 1" class="pb-xb">+{{ r.bld.all.length - 1 }}栋</em>
                  </span>
                </td>
                <td><span class="pb-num">{{ r.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</span></td>
                <td>
                  <span class="pb-val" :class="{ dim: cell(r).inherited, none: cell(r).companyId == null }">
                    <template v-if="cell(r).companyId != null">
                      {{ coName.get(cell(r).companyId!) ?? `#${cell(r).companyId}` }}
                      <em v-if="cell(r).inherited">继承自{{ slotLabel(cell(r).from!) }}</em>
                    </template>
                    <template v-else>未设置</template>
                  </span>
                </td>
                <td v-if="editMode">
                  <span v-if="stashOf(r.tenantId) != null" class="pb-stash">
                    <b>{{ coName.get(stashOf(r.tenantId)!) ?? `#${stashOf(r.tenantId)}` }}</b>
                    <button class="pb-undo" title="撤销该行暂存" @click.stop="unstash(r.tenantId)">
                      <component :is="iconFor('x')" :size="12" />
                    </button>
                  </span>
                  <span v-else class="pb-txt dim ct-r">–</span>
                </td>
              </tr>
            </template>
            <tr v-if="filtered.length === 0">
              <td class="pb-noro" :colspan="editMode ? 6 : 5">
                无匹配租户 —— 换期页签/收款槽,或取消「只看未设置」
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template #footer>
      <template v-if="editMode">
        <Button variant="gray" size="sm" :disabled="saving" @click="exitEdit">退出编辑</Button>
        <Button variant="filled" size="sm" :disabled="stash.size === 0 || saving" @click="onSave">
          <template #leading><component :is="iconFor('check')" :size="14" /></template>
          {{ saving ? '保存中…' : `保存(${stash.size})` }}
        </Button>
      </template>
      <Button v-else-if="canEdit && !loading" variant="outline" size="sm" @click="editMode = true">
        <template #leading><component :is="iconFor('pencil')" :size="14" /></template>
        编辑模式
      </Button>
      <Button variant="outline" size="sm" @click="onClose">关闭</Button>
    </template>
  </FPDrawer>
</template>

<style scoped>
.pb-empty { padding: 40px 12px; text-align: center; color: var(--text-disabled); font-size: var(--fs-label); }
.pb-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--fs-label); color: var(--text-secondary); }
.pb-bar.ok { border-style: solid; border-color: var(--hue-green); background: rgb(240, 251, 244); color: rgb(21, 108, 60); }

.pb-controls { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pb-lbl { font-size: 12px; color: var(--text-muted); }
.pb-search { width: 170px; height: 32px; padding: 0 12px; box-sizing: border-box; border: 1px solid var(--border-subtle); border-radius: var(--radius-full); font-size: 12.5px; background: var(--surface-white); color: var(--text-primary); }
.pb-search:focus { outline: none; border-color: var(--hue-blue); }
.pb-chk { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); cursor: pointer; }
.pb-chk input { accent-color: var(--hue-blue); cursor: pointer; }
.pb-hint { flex: 0 0 auto; margin-top: -14px; font-size: 11.5px; color: var(--text-muted); }

.pb-unibar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-card); font-size: 12.5px; color: var(--text-secondary); flex-wrap: wrap; }
.pb-unibar b { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.pb-sep { color: var(--text-disabled); }

.pb-wrap { flex: 1 1 auto; min-height: 0; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--surface-white); }
.pb-table { border-collapse: separate; border-spacing: 0; width: 100%; table-layout: fixed; font-family: var(--font-sans); }
.pb-table th, .pb-table td { border-bottom: 1px solid var(--divider); box-sizing: border-box; padding: 0 8px; overflow: hidden; }
.pb-table thead th { position: sticky; top: 0; height: 34px; background: var(--surface-card); color: var(--text-muted); font-size: 11.5px; font-weight: var(--fw-semibold); text-align: right; z-index: 4; white-space: nowrap; }
.pb-table thead th.l, .pb-table td.l { text-align: left; }
.pb-table th.ct, .pb-table td.ct { text-align: center; }
.pb-table tbody td { height: 34px; background: var(--surface-white); vertical-align: middle; text-align: right; }
.pb-table tbody tr:hover td { background: var(--surface-card); }
.pb-table tbody tr.sel td { background: rgba(10, 132, 255, 0.06); }
.pb-table input[type='checkbox'] { accent-color: var(--hue-blue); cursor: pointer; }
.pb-table tr.pb-band td { height: 34px; background: var(--surface-sunken); border-top: 1px solid var(--border-strong); }
.pb-band-lbl { font-size: 12px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.pb-band-sub { margin-left: 8px; font-size: 11.5px; color: var(--text-muted); }
.pb-noro { text-align: center !important; padding: 40px 16px !important; color: var(--text-disabled); font-size: var(--fs-label); }

.pb-tname { display: block; font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pb-dot { font-style: normal; margin-left: 5px; font-size: 9px; color: var(--hue-orange, rgb(255, 149, 0)); cursor: help; }
.pb-txt { display: block; text-align: left; font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pb-txt.dim { color: var(--text-muted); }
.pb-txt.ct-r { text-align: right; color: var(--text-disabled); }
.pb-xb { margin-left: 6px; padding: 1px 5px; border-radius: var(--radius-full); background: var(--surface-sunken); font-style: normal; font-size: 10.5px; color: var(--text-muted); cursor: help; }
.pb-num { display: block; text-align: right; font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.pb-val { display: block; text-align: right; font-size: 12px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pb-val.dim { color: var(--text-muted); }
.pb-val.none { color: rgb(178, 100, 0); }
.pb-val em { font-style: normal; margin-left: 5px; font-size: 10.5px; color: var(--text-muted); }
.pb-stash { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; }
.pb-stash b { font-size: 12px; color: var(--hue-blue); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pb-undo { flex: 0 0 auto; display: inline-grid; place-items: center; width: 18px; height: 18px; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); cursor: pointer; padding: 0; }
.pb-undo:hover { background: var(--surface-sunken); color: var(--hue-red); }
</style>
