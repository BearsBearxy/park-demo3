<script setup lang="ts">
// 抽屉「档案变更」页签(METER-TIMELINE-SPEC §1.4 §3.4 §3.5):
// 在册状态(一行一段,可加一行 / 改月 / 撤回)、归属各段(只读,查看月所在那一段高亮)、
// 每一次写的变更记录(新的在前),导入写下的记录旁可撤销那一次导入对档案的改动(读数不动)。
import { ref, computed, watch, onDeactivated } from 'vue'
import { metersApi, type MeterDTO, type MeterStatusRow, type MeterTimelineDTO } from '@/api/meters'
import type { TenantDTO } from '@/types/tenant'
import type { BuildingDTO } from '@/types/building'
import { ownershipLabel } from '@/utils/meterSplit'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import MeterStatusDialog from './MeterStatusDialog.vue'
import {
  STATUS_LABEL, SRC_LABEL, EARLIEST, rangeText, untilOf, logLines, revertedBatches, type LogFmt,
} from './meterTimeline'

const props = defineProps<{
  meter: MeterDTO
  ym: string
  tl: MeterTimelineDTO
  edit: boolean                   // 编辑态 && 有档案权限 && 档案分段已加载
  tenants: TenantDTO[]
  buildings: BuildingDTO[]
}>()
const emit = defineEmits<{ changed: [] }>()

const tenantById = computed(() => new Map(props.tenants.map(t => [t.id, t.companyName])))
const buildingById = computed(() => new Map(props.buildings.map(b => [b.id, b.name])))
const fmt = computed<LogFmt>(() => ({
  tenant: id => tenantById.value.get(id),
  building: id => buildingById.value.get(id),
  ownership: o => ownershipLabel(o, props.meter.kind),
}))

const statusFroms = computed(() => props.tl.status.map(r => r.fromYm))
const assignFroms = computed(() => props.tl.assign.map(r => r.fromYm))
const isCur = (froms: string[], i: number) =>
  froms[i] <= props.ym && (i + 1 >= froms.length || froms[i + 1] > props.ym)

const assignText = (i: number) => {
  const a = props.tl.assign[i]
  const place = [a.buildingId != null ? buildingById.value.get(a.buildingId) : null, a.floorLabel, a.side, a.roomNo]
    .filter(Boolean).join(' ')
  return [a.tenantName ?? '企业名称空', ownershipLabel(a.ownership, props.meter.kind), place].filter(Boolean).join(' · ')
}
const manualText = (i: number) => {
  const a = props.tl.assign[i]
  const on = [a.tenantManual ? '租户' : '', a.ownerManual ? '归属' : '', a.locManual ? '位置' : ''].filter(Boolean)
  return on.length ? `人工设定:${on.join('、')}` : ''
}

// ── 撤销导入:每一批只在最新那条记录旁放一颗按钮;撤过的写「已撤销」 ──
const reverted = computed(() => revertedBatches(props.tl.log))
const batchHead = computed(() => {
  const seen = new Set<string>(), ids = new Set<number>()
  for (const l of props.tl.log) {
    if (l.src !== 'import' || !l.batchId || seen.has(l.batchId)) continue
    seen.add(l.batchId); ids.add(l.id)
  }
  return ids
})
const at = (s: string) => s.replace('T', ' ').slice(0, 16)

// ── 写:编辑态就地转假 / 页面停用时关掉弹窗;每个写函数开头再自守一次 ──
const dlg = ref<{ row: MeterStatusRow | null } | null>(null)
watch(() => props.edit, v => { if (!v) dlg.value = null })
onDeactivated(() => { dlg.value = null })
const busy = ref(false)
const note = ref('')

function openStatus(row: MeterStatusRow | null) {
  if (!props.edit) return
  dlg.value = { row }
}
async function dropStatus(row: MeterStatusRow, i: number) {
  if (!props.edit || busy.value) return
  const back = STATUS_LABEL[props.tl.status[i - 1].status]
  if (!confirm(`撤回「${STATUS_LABEL[row.status]} · ${rangeText(row.fromYm, untilOf(statusFroms.value, i))}」这一行?`
    + `\n撤回后这段月份回到上一行的「${back}」。`)) return
  busy.value = true
  try {
    await metersApi.deleteStatus(props.meter.id, row.fromYm)
    note.value = ''
    emit('changed')
  } catch (e) { alert((e as { message?: string })?.message ?? '撤回失败，请重试') }
  finally { busy.value = false }
}
async function revert(batchId: string, fileName: string | null) {
  if (!props.edit || busy.value) return
  if (!confirm(`撤销这次导入(${fileName ?? '文件名没有记下'})写下的档案改动?`
    + '\n这次导入改到的每一块表都按导入前的样子还原,读数不动。')) return
  busy.value = true
  try {
    const n = await metersApi.revertImport(batchId)
    note.value = `已还原 ${n} 行档案,读数没有动。`
    emit('changed')
  } catch (e) { alert((e as { message?: string })?.message ?? '撤销失败，请重试') }
  finally { busy.value = false }
}
function onStatusDone() {
  dlg.value = null
  note.value = ''
  emit('changed')
}
</script>

<template>
  <section class="tp-sec">
    <div class="tp-hd">
      <h4>在册状态</h4>
      <Button v-if="edit" variant="outline" size="sm" @click="openStatus(null)">
        <template #leading><component :is="iconFor('plus')" :size="14" /></template>
        加一行
      </Button>
    </div>
    <p v-if="!tl.status.length" class="tp-empty">这块表还没有在册状态,哪个月都不在册。</p>
    <ul v-else class="tp-list">
      <li v-for="(s, i) in tl.status" :key="s.id" :class="{ cur: isCur(statusFroms, i) }">
        <span class="rng mono">{{ rangeText(s.fromYm, untilOf(statusFroms, i)) }}</span>
        <span class="st" :class="s.status">{{ STATUS_LABEL[s.status] }}</span>
        <span class="src">{{ SRC_LABEL[s.src] }}</span>
        <span v-if="edit" class="ops">
          <button class="mt-iop" title="改这一行的月份" :disabled="busy" @click="openStatus(s)">
            <component :is="iconFor('pencil')" :size="14" />
          </button>
          <button v-if="i > 0" class="mt-iop danger" title="撤回这一行" :disabled="busy" @click="dropStatus(s, i)">
            <component :is="iconFor('rotate-ccw')" :size="14" />
          </button>
        </span>
      </li>
    </ul>
  </section>

  <section class="tp-sec">
    <div class="tp-hd"><h4>归属</h4></div>
    <p v-if="!tl.assign.length" class="tp-empty">这块表还没有归属记录。</p>
    <ul v-else class="tp-list">
      <li v-for="(a, i) in tl.assign" :key="a.id" :class="{ cur: isCur(assignFroms, i) }">
        <span class="rng mono">{{ rangeText(a.fromYm, untilOf(assignFroms, i)) }}</span>
        <span class="what">{{ assignText(i) }}</span>
        <span class="src">{{ SRC_LABEL[a.src] }}</span>
        <span v-if="manualText(i)" class="man">{{ manualText(i) }}</span>
      </li>
    </ul>
  </section>

  <section class="tp-sec">
    <div class="tp-hd"><h4>变更记录</h4></div>
    <p v-if="note" class="tp-note">{{ note }}</p>
    <p v-if="!tl.log.length" class="tp-empty">还没有改过。上线时迁移的档案不记在这里。</p>
    <ul v-else class="tp-log">
      <li v-for="l in tl.log" :key="l.id">
        <div class="meta">
          <span class="mono">{{ at(l.at) }}</span>
          <span>{{ l.operator ?? '—' }}</span>
          <span>{{ l.rowRef?.startsWith('撤销导入 ') ? '撤销导入' : SRC_LABEL[l.src] }}</span>
          <span v-if="l.fileName" class="file" :title="l.fileName">{{ l.fileName }}</span>
        </div>
        <div class="what">
          {{ l.tbl === 'status' ? '在册状态' : '归属' }} · {{ l.fromYm === EARLIEST ? '最早那一段' : `自 ${l.fromYm} 起那一段` }}
        </div>
        <ul class="lines">
          <li v-for="(t, k) in logLines(l, fmt)" :key="k">{{ t }}</li>
        </ul>
        <template v-if="batchHead.has(l.id) && l.batchId">
          <span v-if="reverted.has(l.batchId)" class="tp-done">这次导入的档案改动已撤销</span>
          <Button v-else-if="edit" variant="outline" size="sm" :disabled="busy" @click="revert(l.batchId, l.fileName)">
            撤销这次导入的档案改动
          </Button>
        </template>
      </li>
    </ul>
  </section>

  <MeterStatusDialog
    v-if="dlg && edit"
    :edit="edit" :meter-id="meter.id" :meter-name="meter.name" :ym="ym" :rows="tl.status" :row="dlg.row"
    @close="dlg = null" @done="onStatusDone"
  />
</template>

<style scoped>
.tp-sec { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.tp-hd { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px; }
.tp-hd h4 { margin: 0; font-size: var(--fs-h4); font-weight: var(--fw-semibold); color: var(--text-primary); }
.tp-empty { margin: 0; font-size: var(--fs-label); color: var(--text-muted); }
.tp-note { margin: 0; font-size: var(--fs-label); color: var(--ok-text); }
.tp-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: hidden; }
.tp-list li { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; padding: 8px 12px; border-bottom: 1px solid var(--divider); font-size: var(--fs-label); color: var(--text-secondary); }
.tp-list li:last-child { border-bottom: none; }
.tp-list li.cur { background: var(--row-selected); }
.tp-list .rng { flex: 0 0 auto; min-width: 128px; color: var(--text-primary); }
.tp-list .mono, .tp-log .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.tp-list .what { flex: 1 1 200px; min-width: 0; color: var(--text-primary); overflow-wrap: anywhere; }
.tp-list .st { flex: 1 1 auto; color: var(--text-primary); }
.tp-list .st.retired { color: var(--caution-text); }
.tp-list .st.removed { color: var(--text-muted); }
.tp-list .src { flex: 0 0 auto; color: var(--text-muted); }
.tp-list .man { flex: 0 0 auto; font-size: var(--fs-micro); border-radius: var(--radius-full); padding: 1px 8px; color: var(--hue-blue); background: var(--info-soft); }
.tp-list .ops { flex: 0 0 auto; display: inline-flex; gap: 2px; }
.tp-log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.tp-log > li { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 10px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
.tp-log .meta { display: flex; flex-wrap: wrap; gap: 2px 10px; font-size: var(--fs-micro); color: var(--text-muted); max-width: 100%; }
.tp-log .meta .file { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tp-log .what { font-size: var(--fs-label); color: var(--text-primary); }
.tp-log .lines { margin: 0; padding-left: 16px; font-size: var(--fs-label); color: var(--text-secondary); overflow-wrap: anywhere; max-width: 100%; }
.tp-done { font-size: var(--fs-label); color: var(--text-muted); }
</style>
