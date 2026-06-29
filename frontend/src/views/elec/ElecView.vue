<script setup lang="ts">
// 附表11 电费成本 — 年度台账状态机。
// 动线 1:1 from screen-schedule11.jsx Schedule11Screen(282-559):
// ⓪ 年份选择层(SchedYearGate) → 该年逐月明细表(SchedHeader + 右上 type 切换 + ElecTable + 抽屉)。
// 两类型共一表用 type 区分:energy(电量电费)/ basic(基本电费),切 type 重新取数。
// 套用 DESIGN-FIDELITY §6 加载门:overview 未到显 .page-loading,不闪空态。
import { ref, computed, onMounted } from 'vue'
import { elecApi } from '@/api/elec'
import { exportElecYear } from '@/utils/elecExcel'
import type { ElecPhaseDTO, ElecOverviewDTO, ElecYearDTO, ElecRecordDTO, ElecRecordReq } from '@/types/elec'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import SchedYearGate, { type YearCard } from '@/components/sched/SchedYearGate.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import ElecTable from './ElecTable.vue'
import ElecRecordDrawer from './ElecRecordDrawer.vue'

// ── 状态机 ───────────────────────────────────────────────
const year = ref<number | null>(null)   // null → ⓪ 年份选择层
const type = ref<'energy' | 'basic'>('energy')
const edit = ref(false)
const drawer = ref(false)

const phases = ref<ElecPhaseDTO[]>([])
const overview = ref<ElecOverviewDTO | null>(null)  // §6 加载信号
const yearData = ref<ElecYearDTO | null>(null)

// ⓪ overview.years → YearCard(metric=「¥X万」label=「全年电费成本·N条」)
const yearCards = computed<YearCard[]>(() =>
  (overview.value?.years ?? []).map(y => ({
    year: y.year,
    hasData: y.hasData,
    metric: '¥' + (Number(y.totalFee) / 10000).toFixed(1) + '万',
    label: '全年电费成本 · ' + y.count + ' 条',
  })),
)

// ── 进入屏:phases + overview(§6 取数前不渲染) ──────────
onMounted(async () => {
  phases.value = await elecApi.phases()
  overview.value = await elecApi.overview()
})

async function loadYear(y: number) {
  yearData.value = await elecApi.records(y, type.value)
}
async function reloadOverview() {
  overview.value = await elecApi.overview()
}

// ── 状态迁移 ─────────────────────────────────────────────
async function pickYear(y: number) {
  year.value = y
  edit.value = false
  type.value = 'energy'
  yearData.value = null
  await loadYear(y)
}
function goGate() {
  year.value = null
  edit.value = false
  yearData.value = null
}

// 右上 type 切换:重新取该年该类台账(后端按 type 过滤)
async function switchType(t: string) {
  if (t === type.value || year.value == null) return
  type.value = t as 'energy' | 'basic'
  yearData.value = null
  await loadYear(year.value)
}

// 新增 / 删除 / 改备注后重载该年 + overview(jsx saveRecord/delRecord)
async function refresh() {
  if (year.value != null) await loadYear(year.value)
  await reloadOverview()
}

async function onCreate(req: ElecRecordReq) {
  try {
    await elecApi.create(req)
    drawer.value = false
    // 提交后归入对应年份与费用类型(可能与当前选中不同)
    year.value = parseInt(req.acctMonth.split('-')[0], 10)
    type.value = req.type
    await refresh()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '新增记账失败')
  }
}

async function onDelete(row: ElecRecordDTO) {
  try {
    await elecApi.remove(row.id)
    await refresh()
  } catch (e) {
    // seed 行 → 409
    alert((e as { message?: string })?.message ?? '删除失败')
  }
}

async function onNote(row: ElecRecordDTO, text: string) {
  try {
    await elecApi.updateNote(row.id, text || null)
    await refresh()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '保存备注失败')
  }
}

async function onExport() {
  if (!yearData.value || year.value == null) return
  try {
    await exportElecYear(yearData.value, year.value)
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
      icon="zap"
      title="附表11 · 电费成本"
      sub="对外电费进项 · 电量电费(分时)+ 基本电费 · 先选择年份,再进入对应年度的逐月明细表"
      :years="yearCards"
      :current="overview.currentYear"
      store-key="elec"
      footer="每个年份是一份独立的逐月电费台账;进入后在编辑模式下新增或导入。"
      @pick="pickYear"
    />

    <!-- 年度明细表 -->
    <template v-else-if="yearData">
      <div class="e11-page">
        <SchedHeader
          icon="zap"
          title="附表11 · 电费成本"
          sub="对外电费进项 · 电量电费(分时)+ 基本电费 · 一期 / 二期 / 三期 · 金额单位 元"
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

        <ElecTable
          :year="year"
          :type="type"
          :phases="yearData.phases"
          :rows="yearData.rows"
          :total="yearData.total"
          :edit="edit"
          @switch-type="switchType"
          @add="drawer = true"
          @edit="edit = true"
          @delete="onDelete"
          @note="onNote"
        />
      </div>

      <ElecRecordDrawer
        v-if="drawer"
        :phases="phases"
        :init-type="type"
        :init-year="year"
        :years="yearRange"
        @close="drawer = false"
        @save="onCreate"
      />
    </template>

    <!-- 切年/切类过渡兜底转圈 -->
    <div v-else class="page-loading"><span class="page-spin" /></div>
  </template>

  <div v-else class="page-loading"><span class="page-spin" /></div>
</template>

<style scoped>
/* 1:1 from screen-schedule11.jsx EStyles(.e11-page,21) */
.e11-page { display:flex; flex-direction:column; gap:14px; height:100%; min-height:0; box-sizing:border-box; }
</style>
