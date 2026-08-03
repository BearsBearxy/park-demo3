<script setup lang="ts">
// 详情抽屉(METER-V5-SPEC §4,FPDrawer/DESIGN-FIDELITY §7,点行打开,三页签):
// 【表档案】档案行内编辑集中:楼栋/租户 FPTenantPicker/归属/表名称/倍率/表类型 + 删除表(409 守卫);
// 【历史读数】原 ReadingDrawer 内容:逐月行式增删改、补历史月(仅编辑态);
// 【合同绑定】状态分桶+候选合同选定绑定(PUT /bind)+date_missing 唯一候选一键确认+解绑;待核先挂租户。
// 编辑均收编辑态(EDIT-MODE-SPEC v2);行内改档案=乐观更新失败回滚(v4 口径)。
import { ref, computed, watch } from 'vue'
import {
  metersApi, DEVICE_TYPE_LABEL,
  type MeterDTO, type MeterReq, type MeterReadingDTO, type MeterDeviceType,
} from '@/api/meters'
import type { TenantDTO } from '@/types/tenant'
import type { BuildingDTO } from '@/types/building'
import { readingFlags } from '@/utils/meterLogic'
import { METER_ZONE_LABEL, METER_KIND_LABEL } from '@/utils/meterExcel'
import { OWNERSHIP_LABEL } from '@/utils/meterSplit'
import {
  BIND_STATUS_NOTE, BIND_BUCKET_LABEL, bindQueueBucket, bindReason,
  type WorkbenchRow,
} from '@/composables/useMeterWorkbench'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Segmented from '@/components/ds/Segmented.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'

const props = defineProps<{
  row: WorkbenchRow | null
  editMode: boolean
  defaultYm: string              // 新增读数默认月份=工具栏选定月
  tenants: TenantDTO[]
  buildings: BuildingDTO[]
  bindAvailable: boolean         // GET /binding 是否可用(后端未就绪降级)
  areaOpts: string[]             // §A.3 位置字段候选(库内既有值 ∪ 基准表,由 MeterView 汇总)
  floorOpts: string[]
  sideOpts: string[]
}>()
const emit = defineEmits<{ close: []; reload: [] }>()

const m = computed(() => props.row?.m ?? null)

const fq = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const numOrNull = (s: string): number | null => {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
const fs = (v: number | null) => (v == null ? '' : String(v))
const failMsg = (e: unknown) => (e as { message?: string })?.message ?? '保存失败，请重试'
const FACTOR_TITLE = '倍率,回车/失焦保存;历史读数仍按录入时快照计用量,改倍率只影响之后新录'

// ── 页签 ──
const tab = ref('profile')
const TABS = [
  { value: 'profile', label: '表档案' },
  { value: 'history', label: '历史读数' },
  { value: 'bind', label: '合同绑定' },
]

const tenantById = computed(() => new Map(props.tenants.map(t => [t.id, t])))
const buildingById = computed(() => new Map(props.buildings.map(b => [b.id, b])))
const tenantOpts = computed(() =>
  props.tenants.map(t => ({ id: t.id, name: t.companyName, phase: t.phase, parentName: t.parentName })))

const drawerSub = computed(() => {
  const mm = m.value
  if (!mm) return ''
  const parts = [`${METER_ZONE_LABEL[mm.zone]}${METER_KIND_LABEL[mm.kind]}`]
  if (props.row?.tenantLabel) parts.push(props.row.tenantLabel)
  else if (mm.ownership !== 'tenant') parts.push(OWNERSHIP_LABEL[mm.ownership] ?? mm.ownership)
  parts.push(`共 ${history.value?.length ?? mm.readingCount} 条读数`)
  return parts.join(' · ')
})

// ── 【表档案】行内编辑(乐观更新失败回滚,v4 RosterPanel 口径) ──
const OWN_OPTS = Object.entries(OWNERSHIP_LABEL).map(([value, label]) => ({ value, label }))
// §A.3 联动规则:PUT 恒带当前 floorLabel/side/roomNo。后端 applyLoc 三态是「不传=按 spot 解析,
// ""=显式清除,有值=人工覆盖」,不记「是否人工改过」——所以三值一律带上,且空值发 ""(不是 null),
// 否则抽屉里选了「—(跨层/不适用)」保存后会被 spot 解析回来,即 §E8 的「改了没生效」。
const reqOf = (mm: MeterDTO): MeterReq => ({
  kind: mm.kind, zone: mm.zone, name: mm.name, area: mm.area, spot: mm.spot,
  floorLabel: mm.floorLabel ?? '', side: mm.side ?? '', roomNo: mm.roomNo ?? '',
  tenantName: mm.tenantName, meterType: mm.meterType, deviceType: mm.deviceType,
  subName: mm.subName, code: mm.code, factor: mm.factor,
  tenantId: mm.tenantId, buildingId: mm.buildingId, ownership: mm.ownership,
  retiredYm: mm.retiredYm,
  activeFromYm: mm.activeFromYm,
  removedYm: mm.removedYm,
})
// §A.3 身份/位置字段行内提交:一份乐观更新失败回滚(同 commitSubName 范式),各字段只差 key。
// name 是唯一键 (kind,zone,name),后端 409 的中文消息原样弹出,不吞。
type LocKey = 'name' | 'code' | 'area' | 'floorLabel' | 'side' | 'roomNo' | 'spot' | 'tenantName'
function commitField(mm: MeterDTO, key: LocKey, raw: string) {
  const t = raw.trim()
  if (key === 'name' && t === '') { alert('标识名不能为空'); return }
  const v = key === 'name' ? t : (t || null)      // 除标识名外留空=清除
  const rec = mm as unknown as Record<LocKey, string | null>
  if (v === (rec[key] ?? null)) return
  const prev = rec[key]
  rec[key] = v
  metersApi.update(mm.id, reqOf(mm)).catch((e) => { rec[key] = prev; alert(failMsg(e)) })
}
const SPOT_TITLE = '位置原文:它是下次导入的位置匹配键,改它会改变导入的匹配行为(表编码/标识名匹配不中时按它认表);'
  + '改它不会动上面的楼层/方位/房号——那三项是独立主数据,要改请直接改它们'
  + '(§F6:三项与原文解析不一致时会被标为「人工设定」,之后导入不再按原文重解析它们)'
// §F6/§G5 人工设定标志:某列与「位置原文」解析结果不一致即置该位,由后端派生,前端不上报。
// V78 起是位掩码逐列判定(bit0 楼层/bit1 方位/bit2 房号)——只改房号不会连楼层一起冻住。
const LOC_BIT = { floorLabel: 1, side: 2, roomNo: 4 } as const
const locPinned = (mm: MeterDTO, key: keyof typeof LOC_BIT) => ((mm.locManual ?? 0) & LOC_BIT[key]) !== 0
const LOC_MANUAL_TITLE = '这一项已与「位置原文」不一致,视为人工设定:下次导入不会按原文重解析它'
  + '(其余两项不受影响,各自独立判定);若原文变了(表挪了地方),导入结果里会落一条提醒请你核对。'
  + '改回与原文一致即恢复自动跟随'
// §G5 存疑标(V75):shadow 会把这块表踢出楼栋分表Σ 与池分母,原先只能由「补齐识别信息」自动清 ——
// 配不上那一条的表(识别信息本就齐全、只是被误判重复)永远解不掉。这里是显式人工入口。
const SUSPECT_LABEL: Record<string, string> = { shadow: '存疑·疑似重复建档', incomplete: '档案不全' }
const SUSPECT_TITLE: Record<string, string> = {
  shadow: '疑似同一块物理表的第二份档案:本表用量不计入楼栋分表Σ、不进池分母。'
    + '确认它是独立的一块表 → 点「认领为独立表」解除,用量立即重新计入',
  incomplete: '档案不全(区域/位置/企业名称/编码四项全空):用量照常计入Σ,只是提醒补档案。'
    + '补齐任一项保存即自动清标,也可在此直接解除',
}
function clearSuspect(mm: MeterDTO) {
  if (!confirm(`确认「${mm.name}」是独立的一块表?解除后它的用量会立即重新计入楼栋分表Σ 与池分母。`)) return
  const prev = mm.suspect
  mm.suspect = null
  metersApi.update(mm.id, { ...reqOf(mm), suspect: '' })
    .then(() => emit('reload'))    // 进/出Σ 改变对账口径,重载刷新
    .catch((e) => { mm.suspect = prev; alert(failMsg(e)) })
}
function commitSubName(mm: MeterDTO, raw: string) {
  const v = raw.trim() || null
  if (v === mm.subName) return
  const prev = mm.subName
  mm.subName = v
  metersApi.update(mm.id, reqOf(mm)).catch((e) => { mm.subName = prev; alert(failMsg(e)) })
}
function commitFactor(mm: MeterDTO, raw: string) {
  const v = raw.trim() === '' ? 1 : Number(raw)   // 留空=1(档案 factor NOT NULL DEFAULT 1)
  if (!Number.isFinite(v) || v <= 0) { alert('倍率需为正数'); return }
  if (v === mm.factor) return
  const prev = mm.factor
  mm.factor = v
  metersApi.update(mm.id, reqOf(mm)).catch((e) => { mm.factor = prev; alert(failMsg(e)) })
}
function commitTenant(mm: MeterDTO, id: number | null) {
  if (id === mm.tenantId) return
  const prevId = mm.tenantId, prevOwn = mm.ownership
  mm.tenantId = id
  if (id != null) mm.ownership = 'tenant'
  metersApi.update(mm.id, reqOf(mm))
    .then(() => emit('reload'))    // 挂租户改变绑定/待核口径,重载刷新
    .catch((e) => { mm.tenantId = prevId; mm.ownership = prevOwn; alert(failMsg(e)) })
}
function commitBuilding(mm: MeterDTO, raw: string) {
  const id = raw === '' ? null : Number(raw)
  if (id === mm.buildingId) return
  const prev = mm.buildingId
  mm.buildingId = id
  metersApi.update(mm.id, reqOf(mm)).catch((e) => { mm.buildingId = prev; alert(failMsg(e)) })
}
function commitOwnership(mm: MeterDTO, raw: string) {
  if (raw === mm.ownership) return
  const prev = mm.ownership
  mm.ownership = raw as MeterDTO['ownership']
  metersApi.update(mm.id, reqOf(mm)).catch((e) => { mm.ownership = prev; alert(failMsg(e)) })
}
// 停用账期(V68):账期口径不用布尔——留空=撤销停用。改后重载,该表按新账期口径进/出各分母。
function commitRetiredYm(mm: MeterDTO, raw: string) {
  const v = raw.trim() || null
  if (v === mm.retiredYm) return
  const prev = mm.retiredYm
  mm.retiredYm = v
  metersApi.update(mm.id, reqOf(mm))
    .then(() => emit('reload'))
    .catch((e) => { mm.retiredYm = prev; alert(failMsg(e)) })
}
// 退场账期(V88):退租/拆表,该月起不再显示;历史月不受影响(硬删被读数守卫挡,退租一律走这)
function commitRemovedYm(mm: MeterDTO, raw: string) {
  const v = raw.trim() || null
  if (v === mm.removedYm) return
  const prev = mm.removedYm
  mm.removedYm = v
  metersApi.update(mm.id, reqOf(mm))
    .then(() => emit('reload'))
    .catch((e) => { mm.removedYm = prev; alert(failMsg(e)) })
}
// 启用账期(V87,与停用对称):该月前不显示不计;导入更早月份源册含此表时后端自动放宽
function commitActiveFromYm(mm: MeterDTO, raw: string) {
  const v = raw.trim() || null
  if (v === mm.activeFromYm) return
  const prev = mm.activeFromYm
  mm.activeFromYm = v
  metersApi.update(mm.id, reqOf(mm))
    .then(() => emit('reload'))
    .catch((e) => { mm.activeFromYm = prev; alert(failMsg(e)) })
}
function commitDeviceType(mm: MeterDTO, raw: string) {
  const v = (raw === '' ? null : raw) as MeterDeviceType | null
  if (v === mm.deviceType) return
  const prev = mm.deviceType
  mm.deviceType = v
  metersApi.update(mm.id, reqOf(mm)).catch((e) => { mm.deviceType = prev; alert(failMsg(e)) })
}
async function delMeter(mm: MeterDTO) {
  if (!confirm(`确认删除「${mm.name}」?有读数或绑在公摊池的表不可删除。`)) return
  try {
    await metersApi.remove(mm.id)
    emit('reload')
    emit('close')
  } catch (e) { alert((e as { message?: string })?.message ?? '删除失败') }
}

// ── 【历史读数】装载(换表即重拉;竞态守卫=闭包表 id 对当前 meter) ──
const history = ref<MeterReadingDTO[] | null>(null)
watch(() => m.value?.id, async () => {
  cancelForm()
  tab.value = 'profile'
  history.value = null
  const mm = m.value
  if (!mm) return
  const data = await metersApi.meterReadings(mm.id)
  if (m.value?.id === mm.id) history.value = data
}, { immediate: true })

const drawerRows = computed(() =>
  (history.value ?? []).slice().sort((a, b) => a.ym.localeCompare(b.ym)))

// 尖峰平谷走 title 提示(抽屉列宽预算内直排放不下 8 段)
function touTitle(r: MeterReadingDTO, side: 'prev' | 'curr'): string | undefined {
  if (m.value?.kind !== 'elec') return undefined
  const v = side === 'prev'
    ? [r.prevSharp, r.prevPeak, r.prevFlat, r.prevValley]
    : [r.currSharp, r.currPeak, r.currFlat, r.currValley]
  if (v.every(x => x == null)) return undefined
  const lab = ['尖', '峰', '平', '谷']
  return v.map((x, i) => `${lab[i]} ${x ?? '—'}`).join(' / ')
}

// 行式增删改(补历史月)
const editId = ref<number | null>(null)
const adding = ref(false)
const touOpen = ref(false)
const form = ref({
  ym: '', prevTotal: '', currTotal: '', note: '',
  prevSharp: '', prevPeak: '', prevFlat: '', prevValley: '',
  currSharp: '', currPeak: '', currFlat: '', currValley: '',
})
function startAdd() {
  editId.value = null; adding.value = true; touOpen.value = false
  form.value = {
    ym: props.defaultYm, prevTotal: '', currTotal: '', note: '',
    prevSharp: '', prevPeak: '', prevFlat: '', prevValley: '',
    currSharp: '', currPeak: '', currFlat: '', currValley: '',
  }
}
function startEdit(r: MeterReadingDTO) {
  adding.value = false; editId.value = r.id
  form.value = {
    ym: r.ym, prevTotal: fs(r.prevTotal), currTotal: fs(r.currTotal), note: r.note ?? '',
    prevSharp: fs(r.prevSharp), prevPeak: fs(r.prevPeak), prevFlat: fs(r.prevFlat), prevValley: fs(r.prevValley),
    currSharp: fs(r.currSharp), currPeak: fs(r.currPeak), currFlat: fs(r.currFlat), currValley: fs(r.currValley),
  }
  touOpen.value = m.value?.kind === 'elec'
    && [r.prevSharp, r.prevPeak, r.prevFlat, r.prevValley, r.currSharp, r.currPeak, r.currFlat, r.currValley].some(x => x != null)
}
function cancelForm() { editId.value = null; adding.value = false; touOpen.value = false }
watch(() => props.editMode, v => { if (!v) cancelForm() })

// 用量预览:(本月−上月)×倍率快照(编辑=原快照;新增=当前表倍率,保存时后端快照)
const previewUsage = computed(() => {
  const p = numOrNull(form.value.prevTotal), c = numOrNull(form.value.currTotal)
  if (p == null || c == null) return '—'
  const f = editId.value != null
    ? (history.value?.find(r => r.id === editId.value)?.factorSnap ?? 1)
    : (m.value?.factor ?? 1)
  return fq((c - p) * f)
})

async function reloadAfterWrite(mm: MeterDTO) {
  const data = await metersApi.meterReadings(mm.id)
  if (m.value?.id === mm.id) history.value = data
  emit('reload')
}
async function saveForm() {
  const mm = m.value
  if (!mm) return
  if (!/^\d{4}-\d{2}$/.test(form.value.ym)) { alert('请选择月份'); return }
  const req = {
    meterId: mm.id, ym: form.value.ym,
    prevTotal: numOrNull(form.value.prevTotal), currTotal: numOrNull(form.value.currTotal),
    prevSharp: numOrNull(form.value.prevSharp), prevPeak: numOrNull(form.value.prevPeak),
    prevFlat: numOrNull(form.value.prevFlat), prevValley: numOrNull(form.value.prevValley),
    currSharp: numOrNull(form.value.currSharp), currPeak: numOrNull(form.value.currPeak),
    currFlat: numOrNull(form.value.currFlat), currValley: numOrNull(form.value.currValley),
    note: form.value.note.trim() || null,
  }
  try {
    // 新录快照当时表倍率;编辑改量不改快照(后端语义,同 PV 口径)
    if (editId.value != null) await metersApi.updateReading(editId.value, req)
    else await metersApi.createReading(req)
    cancelForm()
    await reloadAfterWrite(mm)
  } catch (e) {
    alert((e as { message?: string })?.message ?? '保存失败')   // 同表同月 409 中文文案直达
  }
}
async function delReading(r: MeterReadingDTO) {
  const mm = m.value
  if (!mm) return
  if (!confirm(`确认删除 ${r.ym} 的读数?`)) return
  try { await metersApi.deleteReading(r.id); await reloadAfterWrite(mm) }
  catch (e) { alert((e as { message?: string })?.message ?? '删除失败') }
}

// ── 【合同绑定】(§4:分桶原因/候选选绑/一键确认/解绑/待核挂租户) ──
const bind = computed(() => props.row?.bind ?? null)
const qb = computed(() => (bind.value ? bindQueueBucket(bind.value) : null))
const uniqDateMissing = computed(() =>
  qb.value === 'date_missing' && (bind.value?.candidates?.length ?? 0) === 1
    ? bind.value!.candidates![0] : null)
async function doBind(contractId: number | null) {
  const mm = m.value
  if (!mm) return
  try { await metersApi.bind(mm.id, contractId); emit('reload') }
  catch (e) { alert((e as { message?: string })?.message ?? '绑定失败，请重试') }
}
</script>

<template>
  <FPDrawer
    :open="!!row"
    :title="m?.name ?? ''"
    :subtitle="drawerSub"
    icon="gauge"
    :width="780"
    :fixedHeight="true"
    @close="emit('close')"
  >
    <template #badge>
      <Segmented :options="TABS" :model-value="tab" size="sm" @update:model-value="tab = $event" />
    </template>

    <!-- ── 表档案 ── -->
    <div v-if="tab === 'profile' && m" class="md-grid">
      <div class="md-fld ro"><label>类别 / 分区</label><span>{{ METER_KIND_LABEL[m.kind] }} · {{ METER_ZONE_LABEL[m.zone] }}</span></div>
      <div class="md-fld ro"><label>读数条数</label><span class="mono">{{ history?.length ?? m.readingCount }}</span></div>

      <div class="md-fld">
        <label>标识名(内部键)</label>
        <input v-if="editMode" class="mt-edit l md-in mono" type="text" :value="m.name"
               title="同分区同类唯一(kind,zone,name);与已有表重名保存会被后端拒绝并回滚"
               @change="commitField(m, 'name', ($event.target as HTMLInputElement).value)" />
        <span v-else class="mono">{{ m.name }}</span>
      </div>
      <div class="md-fld">
        <label>表编码</label>
        <input v-if="editMode" class="mt-edit l md-in mono" type="text" :value="m.code ?? ''"
               title="导入的首选身份键:补上它可解掉「同位置多块表歧义」的导入报错。留空=清除"
               @change="commitField(m, 'code', ($event.target as HTMLInputElement).value)" />
        <span v-else class="mono">{{ m.code ?? '—' }}</span>
      </div>
      <div class="md-fld">
        <label>区域(楼栋/车间)</label>
        <input v-if="editMode" class="mt-edit l md-in" type="text" list="md-area-list" :value="m.area ?? ''"
               title="抄表屏区块带头,同时进导入位置索引;可从库内既有区域中选,也可直接输入。留空=清除"
               @change="commitField(m, 'area', ($event.target as HTMLInputElement).value)" />
        <span v-else>{{ m.area ?? '—' }}</span>
        <datalist v-if="editMode" id="md-area-list"><option v-for="a in areaOpts" :key="a" :value="a" /></datalist>
      </div>
      <div class="md-fld">
        <label :title="locPinned(m, 'floorLabel') ? LOC_MANUAL_TITLE : undefined">
          楼层{{ locPinned(m, 'floorLabel') ? ' · 人工设定(导入不覆盖)' : '' }}
        </label>
        <select v-if="editMode" class="mt-edit l sel md-in" :value="m.floorLabel ?? ''"
                title="稳定位置主数据,决定抄表屏排序与公摊按层分份;留空=跨层或不适用"
                @change="commitField(m, 'floorLabel', ($event.target as HTMLSelectElement).value)">
          <option value="">—(跨层/不适用)</option>
          <option v-for="f in floorOpts" :key="f" :value="f">{{ f }}</option>
        </select>
        <span v-else :class="{ dim: !m.floorLabel }">{{ m.floorLabel ?? '跨层/未录' }}</span>
      </div>
      <div class="md-fld">
        <label :title="locPinned(m, 'side') ? LOC_MANUAL_TITLE : undefined">
          方位{{ locPinned(m, 'side') ? ' · 人工设定(导入不覆盖)' : '' }}
        </label>
        <select v-if="editMode" class="mt-edit l sel md-in" :value="m.side ?? ''"
                title="同层东西侧分栏的依据;留空=整层不分侧"
                @change="commitField(m, 'side', ($event.target as HTMLSelectElement).value)">
          <option value="">—(不分侧)</option>
          <option v-for="s in sideOpts" :key="s" :value="s">{{ s }}</option>
        </select>
        <span v-else :class="{ dim: !m.side }">{{ m.side ?? '—' }}</span>
      </div>
      <div class="md-fld">
        <label :title="locPinned(m, 'roomNo') ? LOC_MANUAL_TITLE : undefined">
          房号{{ locPinned(m, 'roomNo') ? ' · 人工设定(导入不覆盖)' : '' }}
        </label>
        <input v-if="editMode" class="mt-edit l md-in" type="text" :value="m.roomNo ?? ''"
               title="单元/房号(如 101室);跨多间的表宁可留空。留空=清除"
               @change="commitField(m, 'roomNo', ($event.target as HTMLInputElement).value)" />
        <span v-else :class="{ dim: !m.roomNo }">{{ m.roomNo ?? '—' }}</span>
      </div>
      <div class="md-fld">
        <label>位置原文(导入匹配键)</label>
        <input v-if="editMode" class="mt-edit l md-in" type="text" :value="m.spot ?? ''"
               :title="SPOT_TITLE"
               @change="commitField(m, 'spot', ($event.target as HTMLInputElement).value)" />
        <span v-else>{{ m.spot ?? '—' }}</span>
      </div>
      <div class="md-fld">
        <label>企业名称原文</label>
        <input v-if="editMode" class="mt-edit l md-in" type="text" :value="m.tenantName ?? ''"
               title="账册「企业名称」列原文;公摊/基础设施表这里存的是用途描述。留空=清除"
               @change="commitField(m, 'tenantName', ($event.target as HTMLInputElement).value)" />
        <span v-else>{{ m.tenantName ?? '—' }}<span v-if="row?.pending" class="md-warn">待核</span></span>
      </div>

      <div class="md-fld">
        <label>楼栋</label>
        <select v-if="editMode" class="mt-edit l sel md-in" :value="m.buildingId ?? ''"
                @change="commitBuilding(m, ($event.target as HTMLSelectElement).value)">
          <option value="">—(未关联)</option>
          <option v-for="bd in buildings" :key="bd.id" :value="bd.id">{{ bd.phaseName }} · {{ bd.name }}</option>
        </select>
        <span v-else>{{ m.buildingId != null ? buildingById.get(m.buildingId)?.name ?? '—' : '—' }}</span>
      </div>
      <div class="md-fld pick">
        <label>租户(选定即归属「租户」)</label>
        <FPTenantPicker
          v-if="editMode"
          :tenants="tenantOpts" :model-value="m.tenantId"
          :placeholder="m.tenantName ?? '选择租户'"
          @update:model-value="commitTenant(m, $event)"
        />
        <span v-else>{{ row?.tenantLabel ?? '—' }}</span>
      </div>
      <div class="md-fld">
        <label>归属</label>
        <select v-if="editMode" class="mt-edit l sel md-in" :value="m.ownership"
                @change="commitOwnership(m, ($event.target as HTMLSelectElement).value)">
          <option v-for="o in OWN_OPTS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <span v-else class="mt-own" :class="'own-' + m.ownership">{{ OWNERSHIP_LABEL[m.ownership] ?? m.ownership }}</span>
      </div>
      <div class="md-fld">
        <label>表名称</label>
        <input v-if="editMode" class="mt-edit l md-in" type="text" :value="m.subName ?? ''"
               title="表名称(如 电表①),回车/失焦保存;留空=清除"
               @change="commitSubName(m, ($event.target as HTMLInputElement).value)" />
        <span v-else>{{ m.subName ?? '—' }}</span>
      </div>
      <div class="md-fld">
        <label>倍率</label>
        <input v-if="editMode" class="mt-edit md-in" type="number" min="0" step="0.01" :value="m.factor"
               :title="FACTOR_TITLE"
               @change="commitFactor(m, ($event.target as HTMLInputElement).value)" />
        <span v-else class="mono">{{ m.factor }}</span>
      </div>
      <div class="md-fld">
        <label>表类型</label>
        <select v-if="editMode" class="mt-edit l sel md-in" :value="m.deviceType ?? ''"
                @change="commitDeviceType(m, ($event.target as HTMLSelectElement).value)">
          <option value="">未录</option>
          <option v-for="(lab, k) in DEVICE_TYPE_LABEL" :key="k" :value="k">{{ lab }}</option>
        </select>
        <span v-else :class="{ dim: !m.deviceType }">{{ m.deviceType ? DEVICE_TYPE_LABEL[m.deviceType] : '未录' }}</span>
      </div>
      <div class="md-fld">
        <label>停用账期</label>
        <input v-if="editMode" class="mt-edit md-in" type="month" :value="m.retiredYm ?? ''"
               title="自该账期起停用(含当月不计):不进抄表进度、不进公摊/损耗分母、不参与合同绑定。留空=在用"
               @change="commitRetiredYm(m, ($event.target as HTMLInputElement).value)" />
        <span v-else :class="{ dim: !m.retiredYm }">{{ m.retiredYm ? `${m.retiredYm} 起停用` : '在用' }}</span>
      </div>
      <div class="md-fld">
        <label>退场账期</label>
        <input v-if="editMode" class="mt-edit md-in" type="month" :value="m.removedYm ?? ''"
               title="退租/拆表:自该账期起(含当月)不再显示在任何月份视图;历史月照常显示与计账。留空=未退场"
               @change="commitRemovedYm(m, ($event.target as HTMLInputElement).value)" />
        <span v-else :class="{ dim: !m.removedYm }">{{ m.removedYm ? `${m.removedYm} 起退场` : '未退场' }}</span>
      </div>
      <div class="md-fld">
        <label>启用账期</label>
        <input v-if="editMode" class="mt-edit md-in" type="month" :value="m.activeFromYm ?? ''"
               title="该账期前不在服务中(某月导入才出现的表不回溯早月);导入更早月份源册含此表时自动放宽。留空=一直在册"
               @change="commitActiveFromYm(m, ($event.target as HTMLInputElement).value)" />
        <span v-else :class="{ dim: !m.activeFromYm }">{{ m.activeFromYm ? `${m.activeFromYm} 起在册` : '一直在册' }}</span>
      </div>
      <!-- §G5 存疑标:只在有标时出现;shadow 表不进分表Σ,给一个显式的人工解除入口 -->
      <div v-if="m.suspect" class="md-fld span2">
        <label>档案状态</label>
        <span class="md-susp" :class="m.suspect" :title="SUSPECT_TITLE[m.suspect ?? '']">{{ SUSPECT_LABEL[m.suspect ?? ''] }}</span>
        <Button v-if="editMode" variant="outline" size="sm" @click="clearSuspect(m)">
          认领为独立表(解除存疑)
        </Button>
        <span v-else class="md-dim susp-hint">进入编辑模式后可解除。</span>
      </div>
    </div>

    <!-- ── 历史读数(原 ReadingDrawer 内容) ── -->
    <template v-else-if="tab === 'history'">
      <div v-if="!history" class="md-empty">加载中…</div>
      <div v-else-if="drawerRows.length === 0 && !adding" class="md-empty">
        该表暂无读数{{ editMode ? ',点下方「新增读数」补录历史月,或在表格里直接录当月。' : ',进入编辑模式后可补录。' }}
      </div>
      <div v-else class="md-hwrap">
        <table class="md-htable">
          <!-- 列宽预算(抽屉内容宽~692):月份108+上月104+本月104+用量104+状态96=516,备注弹性 -->
          <colgroup>
            <col style="width:108px" />
            <col style="width:104px" />
            <col style="width:104px" />
            <col style="width:104px" />
            <col style="width:96px" />
            <col /><!-- 备注:唯一弹性列(截断走 title) -->
            <col v-if="editMode" style="width:70px" />
          </colgroup>
          <thead>
            <tr>
              <th class="l">月份</th>
              <th>上月行至</th>
              <th>本月行至</th>
              <th>用量</th>
              <th class="l">状态</th>
              <th class="l">备注</th>
              <th v-if="editMode"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in drawerRows" :key="r.id">
              <template v-if="editId === r.id">
                <tr class="editing">
                  <td class="l"><input v-model="form.ym" class="md-din" type="month" /></td>
                  <td><input v-model="form.prevTotal" class="md-din num" type="number" step="0.01" placeholder="—" /></td>
                  <td><input v-model="form.currTotal" class="md-din num" type="number" step="0.01" placeholder="—" /></td>
                  <td class="ro" :title="`按原倍率快照 ${r.factorSnap} 计`">{{ previewUsage }}</td>
                  <td class="l">
                    <button v-if="m?.kind === 'elec'" class="md-toulink" :class="{ on: touOpen }" @click="touOpen = !touOpen">尖峰平谷</button>
                    <span v-else class="md-dim">—</span>
                  </td>
                  <td class="l"><input v-model="form.note" class="md-din" type="text" placeholder="备注" /></td>
                  <td class="ops">
                    <button class="mt-iop ok" title="保存" @click="saveForm"><component :is="iconFor('check')" :size="15" /></button>
                    <button class="mt-iop" title="取消" @click="cancelForm"><component :is="iconFor('x')" :size="15" /></button>
                  </td>
                </tr>
                <tr v-if="touOpen && m?.kind === 'elec'" class="tourow">
                  <td colspan="7" class="l">
                    <div class="md-tougrid">
                      <span class="lab">上月</span>
                      <label>尖<input v-model="form.prevSharp" class="md-din num" type="number" step="0.01" /></label>
                      <label>峰<input v-model="form.prevPeak" class="md-din num" type="number" step="0.01" /></label>
                      <label>平<input v-model="form.prevFlat" class="md-din num" type="number" step="0.01" /></label>
                      <label>谷<input v-model="form.prevValley" class="md-din num" type="number" step="0.01" /></label>
                      <span class="lab">本月</span>
                      <label>尖<input v-model="form.currSharp" class="md-din num" type="number" step="0.01" /></label>
                      <label>峰<input v-model="form.currPeak" class="md-din num" type="number" step="0.01" /></label>
                      <label>平<input v-model="form.currFlat" class="md-din num" type="number" step="0.01" /></label>
                      <label>谷<input v-model="form.currValley" class="md-din num" type="number" step="0.01" /></label>
                    </div>
                  </td>
                </tr>
              </template>
              <tr v-else>
                <td class="l mono">{{ r.ym }}</td>
                <td :title="touTitle(r, 'prev')">{{ fq(r.prevTotal) }}</td>
                <td :title="touTitle(r, 'curr')">{{ fq(r.currTotal) }}</td>
                <td :class="{ neg: (r.usageTotal ?? 0) < 0 }" :title="`× 倍率快照 ${r.factorSnap}`">{{ fq(r.usageTotal) }}</td>
                <td class="l flags">
                  <span v-if="readingFlags(r).missing" class="mt-flag warn">漏抄</span>
                  <span v-if="readingFlags(r).negative" class="mt-flag bad">倒走</span>
                  <span v-if="readingFlags(r).touMismatch" class="mt-flag bad" title="尖峰平谷用量之和与总用量不符">时段不符</span>
                </td>
                <td class="l note" :title="r.note ?? undefined">{{ r.note || '—' }}</td>
                <td v-if="editMode" class="ops">
                  <button class="mt-iop" title="编辑" @click="startEdit(r)"><component :is="iconFor('pencil')" :size="14" /></button>
                  <button class="mt-iop danger" title="删除" @click="delReading(r)"><component :is="iconFor('trash-2')" :size="14" /></button>
                </td>
              </tr>
            </template>
            <template v-if="adding">
              <tr class="editing">
                <td class="l"><input v-model="form.ym" class="md-din" type="month" /></td>
                <td><input v-model="form.prevTotal" class="md-din num" type="number" step="0.01" placeholder="—" /></td>
                <td><input v-model="form.currTotal" class="md-din num" type="number" step="0.01" placeholder="—" /></td>
                <td class="ro" :title="`按当前表倍率 ${m?.factor ?? 1} 预览,保存时快照`">{{ previewUsage }}</td>
                <td class="l">
                  <button v-if="m?.kind === 'elec'" class="md-toulink" :class="{ on: touOpen }" @click="touOpen = !touOpen">尖峰平谷</button>
                  <span v-else class="md-dim">—</span>
                </td>
                <td class="l"><input v-model="form.note" class="md-din" type="text" placeholder="备注" /></td>
                <td class="ops">
                  <button class="mt-iop ok" title="保存" @click="saveForm"><component :is="iconFor('check')" :size="15" /></button>
                  <button class="mt-iop" title="取消" @click="cancelForm"><component :is="iconFor('x')" :size="15" /></button>
                </td>
              </tr>
              <tr v-if="touOpen && m?.kind === 'elec'" class="tourow">
                <td colspan="7" class="l">
                  <div class="md-tougrid">
                    <span class="lab">上月</span>
                    <label>尖<input v-model="form.prevSharp" class="md-din num" type="number" step="0.01" /></label>
                    <label>峰<input v-model="form.prevPeak" class="md-din num" type="number" step="0.01" /></label>
                    <label>平<input v-model="form.prevFlat" class="md-din num" type="number" step="0.01" /></label>
                    <label>谷<input v-model="form.prevValley" class="md-din num" type="number" step="0.01" /></label>
                    <span class="lab">本月</span>
                    <label>尖<input v-model="form.currSharp" class="md-din num" type="number" step="0.01" /></label>
                    <label>峰<input v-model="form.currPeak" class="md-din num" type="number" step="0.01" /></label>
                    <label>平<input v-model="form.currFlat" class="md-din num" type="number" step="0.01" /></label>
                    <label>谷<input v-model="form.currValley" class="md-din num" type="number" step="0.01" /></label>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </template>

    <!-- ── 合同绑定 ── -->
    <template v-else-if="tab === 'bind' && m">
      <div v-if="m.ownership !== 'tenant'" class="md-empty">
        非租户表({{ OWNERSHIP_LABEL[m.ownership] ?? m.ownership }})无合同绑定。
      </div>
      <div v-else-if="!bindAvailable" class="md-empty">
        绑定数据不可用 —— 需要后端 GET /api/meters/binding 端点(S2-BIND-SPEC §3)。
      </div>
      <div v-else-if="!bind" class="md-empty">该表不在本月绑定报表中。</div>
      <template v-else>
        <div class="md-bstat">
          <span class="lab">当前状态</span>
          <span class="val" :class="{ stale: bind.status === 'override_stale' }">
            {{ bind.contractNo ?? '未绑定' }}
          </span>
          <span class="tag" :class="{ bad: bind.status === 'override_stale' }">{{ BIND_STATUS_NOTE[bind.status] }}</span>
          <span v-if="qb" class="reason">{{ BIND_BUCKET_LABEL[qb] }} · {{ bindReason(qb, bind) }}</span>
          <span v-else class="reason ok">合同归属就绪,可参与派生 ✓</span>
        </div>

        <!-- 待核:先挂租户(编辑态) -->
        <div v-if="qb === 'pending'" class="md-bpend">
          <template v-if="editMode">
            <span class="lab">挂租户后自动进入合同归属:</span>
            <div class="pick">
              <FPTenantPicker
                :tenants="tenantOpts" :model-value="null"
                :placeholder="m.tenantName ?? '选择租户'"
                @update:model-value="commitTenant(m, $event)"
              />
            </div>
          </template>
          <span v-else class="md-dim">进入编辑模式后可挂租户。</span>
        </div>

        <!-- 候选合同(选定绑定=写 override) -->
        <div v-if="(bind.candidates?.length ?? 0) > 0" class="md-bcands">
          <span class="lab">候选合同({{ bind.candidates!.length }})</span>
          <Button
            v-if="editMode && uniqDateMissing" variant="filled" size="sm"
            @click="doBind(uniqDateMissing.contractId)"
          >一键确认绑定 {{ uniqDateMissing.contractNo }}</Button>
          <button
            v-for="c in bind.candidates" :key="c.contractId"
            class="bc-item" :class="{ on: c.contractId === bind.contractId }"
            :disabled="!editMode"
            @click="editMode && doBind(c.contractId)"
          >
            <span class="no">{{ c.contractNo }}</span>
            <span class="sub">{{ c.buildingName ?? '—' }} · {{ c.startDate ?? '?' }} ~ {{ c.endDate ?? '?' }}</span>
          </button>
        </div>
        <div v-else-if="qb && qb !== 'pending'" class="md-dim" style="font-size:var(--fs-label)">该户无候选合同。</div>

        <!-- 解绑(人工绑定/过期时) -->
        <div v-if="editMode && (bind.status === 'override' || bind.status === 'override_stale')">
          <Button variant="outline" size="sm" @click="doBind(null)">解绑(回自动归属)</Button>
        </div>
        <div v-if="!editMode && qb && qb !== 'pending'" class="md-dim" style="font-size:var(--fs-label)">进入编辑模式后可选定/解绑。</div>
      </template>
    </template>

    <template v-if="editMode && (tab === 'history' || tab === 'profile')" #footer>
      <Button v-if="tab === 'history'" variant="filled" size="sm" :disabled="adding || !history" @click="startAdd">
        <template #leading><component :is="iconFor('plus')" :size="14" /></template>
        新增读数
      </Button>
      <Button v-if="tab === 'profile' && m" variant="outline" size="sm" class="md-del" @click="delMeter(m)">
        <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
        删除表
      </Button>
    </template>
  </FPDrawer>
</template>

<style scoped>
/* ── 表档案:两列字段网格 ── */
.md-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 22px; }
.md-fld { min-width: 0; }
.md-fld label { display: block; margin-bottom: 5px; font-size: var(--fs-label); color: var(--text-muted); }
.md-fld span { font-size: var(--fs-body); color: var(--text-primary); }
.md-fld .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.md-fld .dim { color: var(--text-disabled); }
.md-fld.ro span { color: var(--text-secondary); }
.md-warn { margin-left: 8px; font-size: var(--fs-micro); border-radius: var(--radius-full); padding: 1px 7px; color: rgb(202, 66, 41); background: rgb(255, 235, 228); }
.md-in { height: 32px; border-color: var(--border-subtle); background: var(--surface-white); }
/* §G5 存疑标一行(整宽):徽标 + 解除按钮 */
.md-fld.span2 { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.md-fld.span2 label { margin-bottom: 0; }
.md-susp { font-size: var(--fs-micro); border-radius: var(--radius-full); padding: 2px 9px; }
.md-susp.shadow { color: rgb(202, 66, 41); background: rgb(255, 235, 228); }
.md-susp.incomplete { color: rgb(146, 100, 0); background: rgb(255, 246, 219); }
.md-fld.span2 .susp-hint { font-size: var(--fs-label); }
.md-fld.pick :deep(.fp-tp-trigger) { height: 32px; font-size: 12.5px; }
.md-del { color: var(--hue-red); }

/* ── 历史读数(mt-d* 家族迁自 v4 ReadingDrawer) ── */
.md-empty { padding: 40px 12px; text-align: center; color: var(--text-disabled); font-size: var(--fs-label); }
.md-hwrap { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: hidden; }
.md-htable { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12.5px; white-space: nowrap; }
.md-htable th { padding: 8px 10px; text-align: right; font-family: var(--font-sans); font-weight: var(--fw-medium); font-size: 11px; color: var(--text-muted); background: var(--surface-card); border-bottom: 1px solid var(--divider); }
.md-htable td { padding: 6px 10px; text-align: right; border-bottom: 1px solid var(--divider); font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; }
.md-htable tbody tr:last-child td { border-bottom: none; }
.md-htable .l { text-align: left; }
.md-htable td.note, .md-htable td.flags { font-family: var(--font-sans); color: var(--text-muted); }
.md-htable td.neg { color: var(--hue-red); }
.md-htable td.ro { color: var(--text-secondary); }
.md-htable tr.editing td { background: var(--surface-card); }
.md-htable tr.tourow td { background: var(--surface-card); padding-top: 0; }
.md-htable td.ops { white-space: nowrap; }
.md-dim { color: var(--text-disabled); }
.md-din { width: 100%; box-sizing: border-box; height: 30px; padding: 0 8px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-white); font-family: var(--font-sans); font-size: 12.5px; color: var(--text-primary); transition: border-color var(--dur-fast) var(--ease-standard); }
.md-din.num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; appearance: textfield; -moz-appearance: textfield; }
.md-din.num::-webkit-outer-spin-button, .md-din.num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.md-din:focus { outline: none; border-color: var(--hue-blue); }
.md-toulink { border: 1px solid var(--border-subtle); background: var(--surface-white); border-radius: var(--radius-full); padding: 2px 10px; font-family: var(--font-sans); font-size: 11px; color: var(--text-secondary); cursor: pointer; transition: border-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.md-toulink:hover { border-color: var(--border-strong); color: var(--text-primary); }
.md-toulink.on { border-color: var(--hue-blue); color: var(--hue-blue); }
.md-tougrid { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0 6px; }
.md-tougrid .lab { font-family: var(--font-sans); font-size: 11px; color: var(--text-muted); flex: 0 0 auto; }
.md-tougrid label { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-sans); font-size: 11px; color: var(--text-secondary); }
.md-tougrid label .md-din { width: 78px; height: 26px; font-size: 12px; }

/* ── 合同绑定 ── */
.md-bstat { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 14px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-card); }
.md-bstat .lab { font-size: var(--fs-label); color: var(--text-muted); }
.md-bstat .val { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 13px; color: var(--text-primary); }
.md-bstat .val.stale { color: var(--hue-red); }
.md-bstat .tag { font-size: var(--fs-micro); color: var(--text-muted); background: var(--bg-sunken); border-radius: var(--radius-full); padding: 1px 8px; }
.md-bstat .tag.bad { color: var(--hue-red); background: rgb(255, 238, 237); }
.md-bstat .reason { flex-basis: 100%; font-size: var(--fs-label); color: var(--text-secondary); }
.md-bstat .reason.ok { color: rgb(21, 128, 61); }
.md-bpend { display: flex; flex-direction: column; gap: 8px; }
.md-bpend .lab { font-size: var(--fs-label); color: var(--text-secondary); }
.md-bpend .pick { max-width: 360px; }
.md-bpend .pick :deep(.fp-tp-trigger) { height: 32px; font-size: 12.5px; }
.md-bcands { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.md-bcands .lab { font-size: var(--fs-label); color: var(--text-muted); }
.bc-item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; border: 1px solid var(--border-subtle); background: var(--surface-white); border-radius: var(--radius-md); padding: 8px 12px; cursor: pointer; text-align: left; transition: border-color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard); }
.bc-item:hover:not(:disabled) { border-color: var(--border-strong); background: var(--bg-hover); }
.bc-item:disabled { cursor: default; }
.bc-item.on { border-color: var(--hue-blue); background: rgb(240, 246, 255); }
.bc-item .no { font-family: var(--font-mono); font-size: 12.5px; color: var(--text-primary); }
.bc-item .sub { font-size: var(--fs-micro); color: var(--text-muted); }
</style>
