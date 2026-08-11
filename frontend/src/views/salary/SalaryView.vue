<script setup lang="ts">
// 附表12 工资明细 — 年度台账状态机。
// 动线 1:1 from screen-schedule12.jsx Schedule12Screen(274-516):
// ⓪ 年份选择层(SchedYearGate) → 月份胶囊(SchedMonthPills) → 该月宽表(SchedHeader + SalaryTable + 抽屉)。
// 套用 DESIGN-FIDELITY §6 加载门:overview 未到显 .page-loading,不闪空态。
// 6 屏共用的台账状态机(勾选/批删/清空导入/进出年份门/报错口径)走 useSchedScreen,这里只留本屏差异。
import { ref, computed, onMounted } from 'vue'
import { salaryApi } from '@/api/salary'
import { exportSalaryMonth } from '@/utils/salaryExcel'
import { useSchedScreen, clearConfirm } from '@/composables/useSchedScreen'
import type { SalaryOverviewDTO, SalaryYearMonthDTO, SalaryRecordDTO, SalaryRecordReq, SalaryImportRow } from '@/types/salary'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import SchedYearGate, { type YearCard } from '@/components/sched/SchedYearGate.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import SchedMonthPills from '@/components/sched/SchedMonthPills.vue'
import FpImportModal, { type ImportRec } from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import { parserProps, runImport } from '@/utils/importRegistry'
import SalaryTable from './SalaryTable.vue'
import SalaryRecordDrawer from './SalaryRecordDrawer.vue'

// ── 本屏状态(通用部分见 useSchedScreen) ─────────────────
const month = ref(1)
const overview = ref<SalaryOverviewDTO | null>(null)  // §6 加载信号
const monthData = ref<SalaryYearMonthDTO | null>(null)

// 竞态守卫:快速切月时只接受最新一次请求的结果(防乱序落表)
let monthSeq = 0
async function loadMonth(y: number) {
  const seq = ++monthSeq
  const data = await salaryApi.records(y, month.value)
  if (seq !== monthSeq) return
  monthData.value = data
}
async function reloadOverview() {
  overview.value = await salaryApi.overview()
}

const {
  year, edit, drawer, importing, importResult, selectedIds, importedCount,
  guard, refresh, pickYear, goGate, toggleSelect, selectAll, onBatchDelete, onClearImported,
} = useSchedScreen({
  load: loadMonth,
  reloadOverview,
  rows: () => monthData.value?.rows ?? [],
  clearData: () => { monthData.value = null },
  // 进年默认落到该年有数据的最大月,无则 1 月(零系统时钟)
  onPickYear: y => {
    const ms = overview.value?.years.find(yr => yr.year === y)?.months ?? []
    month.value = ms.length ? ms[ms.length - 1] : 1
  },
  batchDelete: salaryApi.batchDelete,
  clear: {
    call: y => salaryApi.clearImported(y, month.value),
    confirm: clearConfirm('本月', '手动行不受影响。'),
  },
})

// ⓪ overview.years → YearCard(metric=「¥X万」label=「全年实发·N人次」)
const yearCards = computed<YearCard[]>(() =>
  (overview.value?.years ?? []).map(y => ({
    year: y.year,
    hasData: y.hasData,
    metric: '¥' + (Number(y.netTotal) / 10000).toFixed(1) + '万',
    label: '全年实发 · ' + y.count + ' 人次',
  })),
)

// 当前年的有数据月份(给月份胶囊淡显)
const yearMonths = computed<Set<number>>(() =>
  new Set(overview.value?.years.find(y => y.year === year.value)?.months ?? []),
)
const hasMonth = (m: number) => yearMonths.value.has(m)

const monthOptions = computed(() => (overview.value?.years ?? []).map(y => y.year))

// ── 进入屏:overview(§6 取数前不渲染) ──────────────────
onMounted(async () => {
  overview.value = await salaryApi.overview()
})

async function pickMonth(m: number) {
  month.value = m
  selectedIds.value = new Set()
  // 不清空 monthData:旧表保留到新数据落位,避免整屏闪烁
  if (year.value != null) await loadMonth(year.value)
}

// ── 导入 Excel(按表头名字匹配,行身份=姓名) ──────────────
// columnMap:真实工资表叶子标签 → SalaryRecord 字段 key(姓名走 nameLabels;派生/未建模列不入)。
// role=文本列(text:true,存原串不 cleanNum)。前缀匹配扛单位后缀(应出勤（天）/请假（天）)。
// 「其它津贴」(other,津贴项) 与 「其他」(otherDeduct,扣项) 靠完整标签+前缀消歧;不导 合计工资/实出勤/全勤考核/应发/实发/代缴代扣。
// 工资多月分段导入:经 runImport(共享 registry 逐段执行 + 记录 import_log),跳到首段年月 + reload。
async function onImportSections(
  picks: { year?: number; month?: number; phase?: number; records: ImportRec[] }[],
  fileName: string,
) {
  importing.value = false
  if (year.value == null) return
  const ctx = { year: year.value, month: month.value }
  await guard('导入失败', async () => {
    importResult.value = await runImport('salary', picks, ctx, fileName)
    const first = picks[0]
    if (first) { year.value = first.year ?? year.value; month.value = first.month ?? month.value }
    await refresh()
  })
}

const onCreate = (req: SalaryRecordReq) => guard('新增工资失败', async () => {
  await salaryApi.create(req)
  drawer.value = false
  // 提交后归入对应年月(可能与当前选中不同)
  const [y, m] = req.acctMonth.split('-')
  year.value = parseInt(y, 10)
  month.value = parseInt(m, 10)
  await refresh()
})

const onDelete = (row: SalaryRecordDTO) => guard('删除失败', async () => {
  await salaryApi.remove(row.id)
  await refresh()
})

const onNote = (row: SalaryRecordDTO, text: string) => guard('保存备注失败', async () => {
  await salaryApi.updateNote(row.id, text || null)
  await refresh()
})

const onExport = () => guard('导出失败', async () => {
  if (!monthData.value) return
  await exportSalaryMonth(monthData.value)
})
</script>

<template>
  <!-- §6 加载门:overview 到达前显转圈,不闪空态 -->
  <template v-if="overview">
    <!-- ⓪ 年份选择层 -->
    <SchedYearGate
      v-if="year === null"
      icon="wallet"
      title="附表12 · 工资明细"
      sub="逐月人员工资 · 月工资 / 补贴 / 招商提成 / 考勤 / 代缴代扣 · 先选择年份,再进入对应年度的逐月明细表"
      :years="yearCards"
      :current="overview.currentYear"
      store-key="salary"
      footer="每个年份是一份独立的逐月工资台账;进入后在编辑模式下新增或导入。"
      @pick="pickYear"
    />

    <!-- 年度明细表 -->
    <template v-else-if="monthData">
      <div class="s12-page">
        <SchedHeader
          icon="wallet"
          title="附表12 · 工资明细"
          sub="逐月人员工资 · 月工资 / 补贴 / 招商提成 / 考勤 / 代缴代扣 · 金额单位 元"
          :year="year"
          :edit="edit"
          @back="goGate"
          @toggle-edit="edit = !edit"
        >
          <template #edit-actions>
            <Button variant="outline" size="sm" @click="drawer = true">
              <template #leading><component :is="iconFor('plus')" :size="14" /></template>
              新增工资
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

        <!-- 月份胶囊 + 本月人数 -->
        <div class="s12-toolbar">
          <div class="s12-toolbar-l">
            <SchedMonthPills :value="month" :has="hasMonth" @change="pickMonth" />
          </div>
          <div class="s12-toolbar-r">
            <span class="s12-count">{{ year }}年{{ month }}月 <b>{{ monthData.rows.length }}</b> 人</span>
          </div>
        </div>

        <SalaryTable
          :year="year"
          :month="month"
          :rows="monthData.rows"
          :total="monthData.total"
          :edit="edit"
          :selected-ids="selectedIds"
          @add="drawer = true"
          @delete="onDelete"
          @note="onNote"
          @toggle-select="toggleSelect"
          @select-all="selectAll"
        />
      </div>

      <SalaryRecordDrawer
        v-if="drawer"
        :init-year="year"
        :init-month="month"
        :years="monthOptions"
        @close="drawer = false"
        @save="onCreate"
      />

      <FpImportModal
        v-if="importing"
        :title="'导入 附表12 · 工资明细'"
        sub="上传/粘贴整张多月工资表,系统按标题行自动拆月、按姓名识别行,核对年/月后逐月导入"
        v-bind="parserProps('salary')"
        :default-year="year"
        :default-month="month"
        @close="importing = false"
        @import-sections="onImportSections"
      />
    </template>

    <!-- 切年/切月过渡兜底转圈 -->
    <div v-else class="page-loading"><span class="page-spin" /></div>

    <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />
  </template>

  <div v-else class="page-loading"><span class="page-spin" /></div>
</template>

<style scoped>
/* 1:1 from screen-schedule12.jsx WStyles(.w12-page / .w12-toolbar 段) */
.s12-page { display:flex; flex-direction:column; gap:14px; height:100%; min-height:0; box-sizing:border-box; }
.s12-toolbar { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.s12-toolbar-l { display:flex; align-items:center; gap:12px; flex-wrap:wrap; min-width:0; flex:1 1 auto; }
.s12-toolbar-r { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.s12-count { font-size:12px; color:var(--text-muted); }
.s12-count b { color:var(--text-secondary); font-weight:var(--fw-semibold); font-family:var(--font-mono); }
</style>
