<script setup lang="ts">
// 附表6 光伏发电 — 年度台账状态机。
// 动线 1:1 from screen-schedule6.jsx Schedule6Screen(237-440):
// ⓪ 年份选择层(SchedYearGate) → 该年逐月明细表(SchedHeader + PvTable + 抽屉)。
// 套用 DESIGN-FIDELITY §6 加载门:overview 未到显 .page-loading,不闪空态。
import { ref, computed, onMounted } from 'vue'
import { pvApi } from '@/api/pv'
import { exportPvYear } from '@/utils/pvExcel'
import type { PvPhaseDTO, PvOverviewDTO, PvYearDTO, PvRecordDTO, PvRecordReq } from '@/types/pv'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import SchedYearGate, { type YearCard } from '@/components/sched/SchedYearGate.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import PvTable from './PvTable.vue'
import PvRecordDrawer from './PvRecordDrawer.vue'

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
  await loadYear(y)
}
function goGate() {
  year.value = null
  edit.value = false
  yearData.value = null
}

// 新增 / 删除 / 改备注后重载该年 + overview(jsx saveRecord/delRecord)
async function refresh() {
  if (year.value != null) await loadYear(year.value)
  await reloadOverview()
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
  <!-- §6 加载门:overview 到达前显转圈,不闪空态 -->
  <template v-if="overview">
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
      @pick="pickYear"
    />

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
            <!-- 导入:禁用占位(导入即将上线) -->
            <span title="导入即将上线" style="display:inline-flex">
              <Button variant="outline" size="sm" :disabled="true">
                <template #leading><component :is="iconFor('upload')" :size="14" /></template>
                导入 Excel
              </Button>
            </span>
            <Button variant="outline" size="sm" @click="drawer = true">
              <template #leading><component :is="iconFor('plus')" :size="14" /></template>
              新增记账
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
          @update:phase="phase = $event"
          @add="drawer = true"
          @delete="onDelete"
          @note="onNote"
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
    </template>

    <!-- 切年过渡兜底转圈 -->
    <div v-else class="page-loading"><span class="page-spin" /></div>
  </template>

  <div v-else class="page-loading"><span class="page-spin" /></div>
</template>

<style scoped>
/* 1:1 from screen-schedule6.jsx S6Styles(.s6-page,26) */
.s6-page { display:flex; flex-direction:column; gap:14px; height:100%; min-height:0; box-sizing:border-box; }
</style>
