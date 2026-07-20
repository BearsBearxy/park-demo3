<script setup lang="ts">
// 附表6 光伏发电 — 年度台账状态机。
// 动线 1:1 from screen-schedule6.jsx Schedule6Screen(237-440):
// ⓪ 年份选择层(SchedYearGate) → 该年逐月明细表(SchedHeader + PvTable + 抽屉)。
// 套用 DESIGN-FIDELITY §6 加载门:overview 未到显 .page-loading,不闪空态。
import { ref, computed, onMounted } from 'vue'
import { pvApi } from '@/api/pv'
import { exportPvYear } from '@/utils/pvExcel'
import { parserProps, runImport } from '@/utils/importRegistry'
import type { PvPhaseDTO, PvOverviewDTO, PvYearDTO, PvRecordDTO, PvRecordReq, PvImportRow } from '@/types/pv'
import type { ImportResultDTO } from '@/types/import'
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import SchedYearGate, { type YearCard } from '@/components/sched/SchedYearGate.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import PvTable from './PvTable.vue'
import PvRecordDrawer from './PvRecordDrawer.vue'
import PvMeterView from './PvMeterView.vue'

// ── 功能门(PV-METER-SPEC §2):进入先选「月度汇总(原附表6)/分栋抄表明细(新)」──
// 组件内 ref 即会话记忆(KeepAlive 自然保持),刷新重进重选;原附表6流程零行为变化,整体包进 v-else。
const mode = ref<'summary' | 'meter' | null>(null)

// ── 状态机 ───────────────────────────────────────────────
const year = ref<number | null>(null)   // null → ⓪ 年份选择层
const phase = ref('all')
const edit = ref(false)
const drawer = ref(false)

const phases = ref<PvPhaseDTO[]>([])
const overview = ref<PvOverviewDTO | null>(null)  // §6 加载信号
const yearData = ref<PvYearDTO | null>(null)

// ⓪ overview.years → YearCard(metric=「¥X万」label=「全年电费收益·N条」)
const yearCards = computed<YearCard[]>(() =>
  (overview.value?.years ?? []).map(y => ({
    year: y.year,
    hasData: y.hasData,
    metric: '¥' + (Number(y.totalFee) / 10000).toFixed(1) + '万',
    label: '全年电费收益 · ' + y.count + ' 条',
  })),
)

// ── 进入屏:phases + overview(§6 取数前不渲染) ──────────
onMounted(async () => {
  phases.value = await pvApi.phases()
  overview.value = await pvApi.overview()
})

async function loadYear(y: number) {
  yearData.value = await pvApi.records(y)
}
async function reloadOverview() {
  overview.value = await pvApi.overview()
}

// ── 状态迁移 ─────────────────────────────────────────────
async function pickYear(y: number) {
  year.value = y
  edit.value = false
  phase.value = 'all'
  yearData.value = null
  selectedIds.value = new Set()
  await loadYear(y)
}
function goGate() {
  year.value = null
  edit.value = false
  yearData.value = null
  selectedIds.value = new Set()
}

// 新增 / 删除 / 改备注后重载该年 + overview(jsx saveRecord/delRecord)
async function refresh() {
  if (year.value != null) await loadYear(year.value)
  await reloadOverview()
}

// ── 导入 Excel(自定义解析:多段堆叠按期切段,行自带 phaseId+acctMonth) ──
const importing = ref(false)
const importResult = ref<ImportResultDTO | null>(null)

// 各段确认后经 runImport(共享 registry 执行 + 记录 import_log)→ 刷新。
async function onImportSections(picks: { label?: string; records: ImportRec[] }[], fileName: string) {
  importing.value = false
  try {
    importResult.value = await runImport('pv', picks, {}, fileName)
    await refresh()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
}

// ── 清空本期导入(本年) ──
const importedCount = computed(() =>
  (yearData.value?.rows ?? []).filter(r => r.source === 'import').length,
)
async function onClearImported() {
  if (year.value == null) return
  if (importedCount.value === 0) { alert('本年没有导入的行。'); return }
  if (!confirm(`确认清空本年 ${importedCount.value} 条导入数据?手动/种子行不受影响。`)) return
  try {
    await pvApi.clearImported(year.value)
    selectedIds.value = new Set()
    await refresh()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '清空失败')
  }
}

// ── 批量删除(编辑态复选框) ──
const selectedIds = ref<Set<number>>(new Set())
function toggleSelect(row: PvRecordDTO) {
  const next = new Set(selectedIds.value)
  if (next.has(row.id)) next.delete(row.id); else next.add(row.id)
  selectedIds.value = next
}
function selectAll(checked: boolean) {
  if (!yearData.value) return
  // 全选当前期视图行(与表内 allSelected 口径一致:按 phase 过滤)
  const visible = yearData.value.rows.filter(r => phase.value === 'all' || r.phase === phase.value)
  selectedIds.value = checked ? new Set(visible.map(r => r.id)) : new Set()
}
async function onBatchDelete() {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  try {
    await pvApi.batchDelete(ids)
    selectedIds.value = new Set()
    await refresh()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '删除失败')
  }
}

async function onCreate(req: PvRecordReq) {
  try {
    await pvApi.create(req)
    drawer.value = false
    // 提交后归入对应年份(可能与当前选中年不同)
    year.value = parseInt(req.acctMonth.split('-')[0], 10)
    await refresh()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '新增记账失败')
  }
}

async function onDelete(row: PvRecordDTO) {
  try {
    await pvApi.remove(row.id)
    await refresh()
  } catch (e) {
    // seed 行 → 409
    alert((e as { message?: string })?.message ?? '删除失败')
  }
}

async function onNote(row: PvRecordDTO, text: string) {
  try {
    await pvApi.updateNote(row.id, text || null)
    await refresh()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '保存备注失败')
  }
}

async function onExport() {
  if (!yearData.value || year.value == null) return
  try {
    await exportPvYear(yearData.value, year.value)
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导出失败')
  }
}

const yearRange = computed(() => (overview.value?.years ?? []).map(y => y.year))
</script>

<template>
  <!-- ⓪ 功能门(PV-METER-SPEC §2):两卡分叉,卡片风格同 SchedYearGate 年卡 -->
  <div v-if="mode === null" class="pv-fngate">
    <div class="pv-fngate-head">
      <h2 class="pv-fngate-title">
        <span class="ic"><component :is="iconFor('sun')" :size="18" /></span>光伏发电
      </h2>
      <p class="pv-fngate-sub">选择进入方式 · 月度汇总 = 附表6 原年度台账;分栋抄表 = 逐站逐日抄表明细</p>
    </div>
    <div class="pv-fngate-grid">
      <div class="pv-fncard" @click="mode = 'summary'">
        <span class="pv-fnc-go"><component :is="iconFor('arrow-right')" :size="16" /></span>
        <div class="pv-fnc-ic"><component :is="iconFor('sun')" :size="20" /></div>
        <div class="pv-fnc-name">附表6 · 月度汇总</div>
        <div class="pv-fnc-desc">按期(一/二/三期)逐月记账的发电台账,含导入与年度合计 —— 原有流程。</div>
      </div>
      <div class="pv-fncard" @click="mode = 'meter'">
        <span class="pv-fnc-go"><component :is="iconFor('arrow-right')" :size="16" /></span>
        <div class="pv-fnc-ic"><component :is="iconFor('gauge')" :size="20" /></div>
        <div class="pv-fnc-name">分栋抄表明细</div>
        <div class="pv-fnc-desc">13 个电站按日期逐条抄表、自动汇月;行内维护装机容量与消纳单价。</div>
      </div>
    </div>
    <p class="pv-fngate-foot"><component :is="iconFor('info')" :size="13" />两种视图数据相互独立;抄表汇总与附表6 的对账功能后续提供。</p>
  </div>

  <!-- 分栋抄表明细(新屏) -->
  <PvMeterView v-else-if="mode === 'meter'" @back="mode = null" />

  <!-- 附表6 · 月度汇总:原流程原样(§6 加载门:overview 到达前显转圈,不闪空态) -->
  <template v-else-if="overview">
    <!-- ⓪ 年份选择层 -->
    <SchedYearGate
      v-if="year === null"
      icon="sun"
      title="附表6 · 光伏发电"
      sub="逐月发电台账 · 自发自用、余电上网 · 先选择年份,再进入对应年度的逐月明细表"
      :years="yearCards"
      :current="overview.currentYear"
      store-key="pv"
      footer="每个年份是一份独立的逐月发电台账;进入后在编辑模式下新增或导入。"
      back-label="返回功能选择"
      @pick="pickYear"
      @back="mode = null"
    /><!-- back=功能门回退口(组件既有 prop);附表6 年内流程零改动 -->

    <!-- 年度明细表 -->
    <template v-else-if="yearData">
      <div class="s6-page">
        <SchedHeader
          icon="sun"
          title="附表6 · 光伏发电"
          sub="逐月发电台账 · 自发自用、余电上网 · 电量 kWh / 金额 元"
          :year="year"
          :edit="edit"
          @back="goGate"
          @toggle-edit="edit = !edit"
        >
          <template #edit-actions>
            <Button variant="outline" size="sm" @click="drawer = true">
              <template #leading><component :is="iconFor('plus')" :size="14" /></template>
              新增记账
            </Button>
            <Button v-if="importedCount > 0" variant="outline" size="sm" @click="onClearImported">
              <template #leading><component :is="iconFor('rotate-ccw')" :size="14" /></template>
              清空本期导入 ({{ importedCount }})
            </Button>
            <Button v-if="selectedIds.size > 0" variant="danger" size="sm" @click="onBatchDelete">
              <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
              删除选中 ({{ selectedIds.size }})
            </Button>
          </template>
          <!-- 导入常驻非编辑态(spec 2026-07-11 §1:导入独立落库,不依赖编辑草稿) -->
          <template #idle-actions>
            <Button variant="outline" size="sm" @click="importing = true">
              <template #leading><component :is="iconFor('upload')" :size="14" /></template>
              导入 Excel
            </Button>
          </template>
          <template #static-actions>
            <Button variant="outline" size="sm" @click="onExport">
              <template #leading><component :is="iconFor('download')" :size="14" /></template>
              导出
            </Button>
          </template>
        </SchedHeader>

        <PvTable
          :year="year"
          :phases="yearData.phases"
          :rows="yearData.rows"
          :total="yearData.total"
          :phase="phase"
          :edit="edit"
          :selected-ids="selectedIds"
          @update:phase="phase = $event"
          @add="drawer = true"
          @delete="onDelete"
          @note="onNote"
          @toggle-select="toggleSelect"
          @select-all="selectAll"
        />
      </div>

      <PvRecordDrawer
        v-if="drawer"
        :phases="phases"
        :init-phase="phase"
        :init-year="year"
        :years="yearRange"
        @close="drawer = false"
        @save="onCreate"
      />

      <FpImportModal
        v-if="importing"
        :title="`导入 附表6 · ${year}年光伏发电`"
        sub="上传/粘贴多段堆叠的光伏发电明细(一期/二期/三期),系统按段切期、按表头识别列,逐段核对后导入"
        v-bind="parserProps('pv')"
        @close="importing = false"
        @import-sections="onImportSections"
      />
    </template>

    <!-- 切年过渡兜底转圈 -->
    <div v-else class="page-loading"><span class="page-spin" /></div>

    <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />
  </template>

  <div v-else class="page-loading"><span class="page-spin" /></div>
</template>

<style scoped>
/* 1:1 from screen-schedule6.jsx S6Styles(.s6-page,26) */
.s6-page { display:flex; flex-direction:column; gap:14px; height:100%; min-height:0; box-sizing:border-box; }

/* ── 功能门(PV-METER-SPEC §2):卡片风格同 SchedYearGate .sm-ycard 家族 ── */
.pv-fngate { display:flex; flex-direction:column; gap:18px; width:100%; height:100%; min-height:0; box-sizing:border-box; font-family:var(--font-sans); color:var(--text-primary); }
.pv-fngate-title { margin:0; display:flex; align-items:center; gap:11px; font-size:var(--fs-h2); font-weight:var(--fw-semibold); color:var(--text-primary); }
.pv-fngate-title .ic { width:34px; height:34px; border-radius:10px; background:var(--surface-sunken); display:grid; place-items:center; color:var(--text-secondary); flex:0 0 auto; }
.pv-fngate-sub { margin:6px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.pv-fngate-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px,1fr)); gap:16px; max-width:720px; }
.pv-fncard { position:relative; display:flex; flex-direction:column; gap:10px; min-height:152px; padding:21px 23px; box-sizing:border-box; cursor:pointer; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); transition:border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard); }
.pv-fncard:hover { border-color:var(--border-strong); box-shadow:0 8px 24px rgba(28,28,28,.10); transform:translateY(-2px); }
.pv-fnc-ic { width:40px; height:40px; border-radius:12px; background:var(--surface-card); display:grid; place-items:center; color:var(--text-secondary); }
.pv-fnc-name { font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.pv-fnc-desc { font-size:12.5px; line-height:1.55; color:var(--text-muted); }
.pv-fnc-go { position:absolute; top:21px; right:21px; width:30px; height:30px; border-radius:50%; display:grid; place-items:center; color:var(--text-disabled); background:var(--surface-card); opacity:0; transform:translateX(-4px); transition:opacity var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.pv-fncard:hover .pv-fnc-go { opacity:1; transform:translateX(0); background:var(--ink-900); color:#fff; }
.pv-fngate-foot { margin:0; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; }
</style>
