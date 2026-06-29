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
import type {
  ChargingCatDTO, ChargingOverviewDTO, ChargingYearDTO, ChargingRecordDTO, ChargingRecordReq,
} from '@/types/charging'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import SchedYearGate, { type YearCard } from '@/components/sched/SchedYearGate.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
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

// ── 进入屏:cats + overview(§6 取数前不渲染) ──────────
onMounted(async () => {
  cats.value = await chargingApi.cats(no.value)
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
  await loadYear(y)
}
function goGate() {
  year.value = null
  edit.value = false
  yearData.value = null
}

// 新增 / 删除 / 改备注后重载该年 + overview
async function refresh() {
  if (year.value != null) await loadYear(year.value)
  await reloadOverview()
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

        <ChargingTable
          :year="year"
          :icon="icon"
          :cats="yearData.cats"
          :rows="yearData.rows"
          :total="yearData.total"
          :cat="cat"
          :edit="edit"
          @update:cat="cat = $event"
          @add="drawer = true"
          @delete="onDelete"
          @note="onNote"
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
    </template>

    <!-- 切年过渡兜底转圈 -->
    <div v-else class="page-loading"><span class="page-spin" /></div>
  </template>

  <div v-else class="page-loading"><span class="page-spin" /></div>
</template>

<style scoped>
/* 1:1 from screen-charging.jsx ChStyles(.ch-page,24) */
.ch-page { display:flex; flex-direction:column; gap:14px; height:100%; min-height:0; box-sizing:border-box; }
</style>
