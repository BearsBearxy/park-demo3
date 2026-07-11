<script setup lang="ts">
// 附表7/8 充电桩 — 年度台账状态机(一个 View 参数化 schedule no)。
// 动线 1:1 from screen-charging.jsx ChargingScreen(233-437):
// ⓪ 年份选择层(SchedYearGate) → 该年逐月明细表(SchedHeader + ChargingTable + 抽屉)。
// schedule no 从路由 meta.kind 取(schedule7→7 汽车 / schedule8→8 电动车);两路由共用本 View。
// 套用 DESIGN-FIDELITY §6 加载门:overview 未到显 .page-loading,不闪空态。
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { chargingApi } from '@/api/charging'
import { exportChargingYear } from '@/utils/chargingExcel'
import { parserProps, runImport, type ImportCtx } from '@/utils/importRegistry'
import type {
  ChargingCatDTO, ChargingOverviewDTO, ChargingYearDTO, ChargingRecordDTO, ChargingRecordReq,
  ChargingImportRow,
} from '@/types/charging'
import type { ImportResultDTO } from '@/types/import'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import SchedYearGate, { type YearCard } from '@/components/sched/SchedYearGate.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import FpImportModal, { type ImportRec } from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import ChargingTable from './ChargingTable.vue'
import ChargingRecordDrawer from './ChargingRecordDrawer.vue'

// ── schedule 实例派生(meta.kind → no/icon/title) ──────────
const route = useRoute()
const no = computed(() => ((route.meta as { kind?: string }).kind === 'schedule8' ? 8 : 7))
const icon = computed(() => (no.value === 8 ? 'bike' : 'car'))
const title = computed(() => (no.value === 8 ? '附表8 · 电动车充电桩' : '附表7 · 汽车充电桩'))
const sub = computed(() =>
  no.value === 8
    ? '电动车棚及充电桩逐月手续费及服务费、充电成本与利润 · 电量 千瓦时 / 金额 元'
    : '汽车充电桩逐月手续费及服务费、充电成本与利润 · 电量 千瓦时 / 金额 元',
)

// ── 状态机 ───────────────────────────────────────────────
const year = ref<number | null>(null)   // null → ⓪ 年份选择层
const cat = ref('all')
const edit = ref(false)
const drawer = ref(false)

const cats = ref<ChargingCatDTO[]>([])
const overview = ref<ChargingOverviewDTO | null>(null)  // §6 加载信号
const yearData = ref<ChargingYearDTO | null>(null)

// ⓪ overview.years → YearCard(metric=「¥X万」label=「全年利润·N条」)
const yearCards = computed<YearCard[]>(() =>
  (overview.value?.years ?? []).map(y => ({
    year: y.year,
    hasData: y.hasData,
    metric: (y.totalProfit < 0 ? '−¥' : '¥') + (Math.abs(y.totalProfit) / 10000).toFixed(1) + '万',
    label: '全年利润 · ' + y.count + ' 条',
  })),
)

// 导入上下文(稳定对象):cats 供 registry 的 charging customParse;其 _parseErrors 由 customParse 暂存、runImport 合并。
const importCtx: ImportCtx = {}

// ── 进入屏:cats + overview(§6 取数前不渲染) ──────────
onMounted(async () => {
  cats.value = await chargingApi.cats(no.value)
  importCtx.cats = cats.value
  overview.value = await chargingApi.overview(no.value)
})

async function loadYear(y: number) {
  yearData.value = await chargingApi.records(no.value, y)
}
async function reloadOverview() {
  overview.value = await chargingApi.overview(no.value)
}

// ── 状态迁移 ─────────────────────────────────────────────
async function pickYear(y: number) {
  year.value = y
  edit.value = false
  cat.value = 'all'
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

// 新增 / 删除 / 改备注后重载该年 + overview
async function refresh() {
  if (year.value != null) await loadYear(year.value)
  await reloadOverview()
}

// ── 导入 Excel(自定义解析:单表逐行,运营商下填,fee 按附表口径算好) ──
const importing = ref(false)
const importResult = ref<ImportResultDTO | null>(null)
// 确认导入 → runImport(共享 registry:customParse 已把解析期跳过暂存到 importCtx._parseErrors,run 合并 + 记录 import_log)。
async function onImport(recs: ImportRec[], fileName: string) {
  importing.value = false
  try {
    importResult.value = await runImport('charging_' + no.value, recs, importCtx, fileName)
    await refresh()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
}

// ── 清空本期导入(本附表本年) ──
const importedCount = computed(() =>
  (yearData.value?.rows ?? []).filter(r => r.source === 'import').length,
)
async function onClearImported() {
  if (year.value == null) return
  if (importedCount.value === 0) { alert('本年没有导入的行。'); return }
  if (!confirm(`确认清空本年 ${importedCount.value} 条导入数据?手动行不受影响。`)) return
  try {
    await chargingApi.clearImported(no.value, year.value)
    selectedIds.value = new Set()
    await refresh()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '清空失败')
  }
}

// ── 批量删除(编辑态复选框) ──
const selectedIds = ref<Set<number>>(new Set())
function toggleSelect(row: ChargingRecordDTO) {
  const next = new Set(selectedIds.value)
  if (next.has(row.id)) next.delete(row.id); else next.add(row.id)
  selectedIds.value = next
}
function selectAll(checked: boolean) {
  if (!yearData.value) return
  const visible = yearData.value.rows.filter(r => cat.value === 'all' || r.cat === cat.value)
  selectedIds.value = checked ? new Set(visible.map(r => r.id)) : new Set()
}
async function onBatchDelete() {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  try {
    await chargingApi.batchDelete(no.value, ids)
    selectedIds.value = new Set()
    await refresh()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '删除失败')
  }
}

async function onCreate(req: ChargingRecordReq) {
  try {
    await chargingApi.create(no.value, req)
    drawer.value = false
    // 提交后归入对应年份(可能与当前选中年不同)
    year.value = parseInt(req.acctMonth.split('-')[0], 10)
    await refresh()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '新增记账失败')
  }
}

async function onDelete(row: ChargingRecordDTO) {
  try {
    await chargingApi.remove(no.value, row.id)
    await refresh()
  } catch (e) {
    // seed 行 → 409
    alert((e as { message?: string })?.message ?? '删除失败')
  }
}

async function onNote(row: ChargingRecordDTO, text: string) {
  try {
    await chargingApi.updateNote(no.value, row.id, text || null)
    await refresh()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '保存备注失败')
  }
}

async function onExport() {
  if (!yearData.value || year.value == null) return
  try {
    await exportChargingYear(yearData.value, year.value, title.value)
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导出失败')
  }
}

const yearRange = computed(() => (overview.value?.years ?? []).map(y => y.year))
</script>

<template>
  <!-- §6 加载门:overview 到达前显转圈,不闪空态 -->
  <template v-if="overview">
    <!-- ⓪ 年份选择层 -->
    <SchedYearGate
      v-if="year === null"
      :icon="icon"
      :title="title"
      :sub="sub + ' · 先选择年份,再进入对应年度的逐月台账'"
      :years="yearCards"
      :current="overview.currentYear"
      :store-key="'charging-' + no"
      footer="每个年份是一份独立的逐月台账;进入后在编辑模式下新增或导入。"
      @pick="pickYear"
    />

    <!-- 年度明细表 -->
    <template v-else-if="yearData">
      <div class="ch-page">
        <SchedHeader
          :icon="icon"
          :title="title"
          :sub="sub"
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

        <ChargingTable
          :year="year"
          :icon="icon"
          :cats="yearData.cats"
          :rows="yearData.rows"
          :total="yearData.total"
          :cat="cat"
          :edit="edit"
          :selected-ids="selectedIds"
          @update:cat="cat = $event"
          @add="drawer = true"
          @delete="onDelete"
          @note="onNote"
          @toggle-select="toggleSelect"
          @select-all="selectAll"
        />
      </div>

      <ChargingRecordDrawer
        v-if="drawer"
        :no="no"
        :cats="cats"
        :init-cat="cat"
        :init-year="year"
        :years="yearRange"
        @close="drawer = false"
        @save="onCreate"
      />

      <FpImportModal
        v-if="importing"
        :title="`导入 ${title} · ${year}年`"
        :sub="no === 8
          ? '上传/粘贴电动车充电桩损益明细,系统按运营商、按月份识别行(充电金额收入已扣手续费直取),核对后导入'
          : '上传/粘贴汽车充电桩收益汇总,系统按运营商、按月份识别行(fee=充电收入−手续费,聚合年/范围行跳过),核对后导入'"
        v-bind="parserProps('charging_' + no, importCtx)"
        @close="importing = false"
        @import="onImport"
      />
    </template>

    <!-- 切年过渡兜底转圈 -->
    <div v-else class="page-loading"><span class="page-spin" /></div>

    <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />
  </template>

  <div v-else class="page-loading"><span class="page-spin" /></div>
</template>

<style scoped>
/* 1:1 from screen-charging.jsx ChStyles(.ch-page,24) */
.ch-page { display:flex; flex-direction:column; gap:14px; height:100%; min-height:0; box-sizing:border-box; }
</style>
