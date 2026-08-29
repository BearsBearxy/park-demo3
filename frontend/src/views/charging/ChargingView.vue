<script setup lang="ts">
// 附表7/8 充电桩 — 年度台账状态机(一个 View 参数化 schedule no)。
// 动线 1:1 from screen-charging.jsx ChargingScreen(233-437):
// ⓪ 年份选择层(SchedYearGate) → 该年逐月明细表(SchedHeader + ChargingTable + 抽屉)。
// schedule no 从路由 meta.kind 取(schedule7→7 汽车 / schedule8→8 电动车);两路由共用本 View。
// 套用 DESIGN-FIDELITY §6 加载门:overview 未到显 .page-loading,不闪空态。
// 6 屏共用的台账状态机(勾选/批删/清空导入/进出年份门/报错口径)走 useSchedScreen,这里只留本屏差异。
import { ref, computed, onMounted , watch} from 'vue'
import { S } from '@/utils/lockScopes'
import { useRoute } from 'vue-router'
import { chargingApi } from '@/api/charging'
import { exportChargingYear } from '@/utils/chargingExcel'
import { parserProps, runImport, type ImportCtx } from '@/utils/importRegistry'
import { useSchedScreen, clearConfirm } from '@/composables/useSchedScreen'
import type {
  ChargingCatDTO, ChargingOverviewDTO, ChargingYearDTO, ChargingRecordDTO, ChargingRecordReq,
  ChargingImportRow,
} from '@/types/charging'
import { loadViewMode, saveViewMode } from '@/utils/viewMode'
import BookRailShell from '@/components/fp/BookRailShell.vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import SchedYearGate, { type YearCard } from '@/components/sched/SchedYearGate.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import FpImportModal, { type ImportRec } from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import ChargingTable from './ChargingTable.vue'
import ChargingRecordDrawer from './ChargingRecordDrawer.vue'
import CpMeterView from './CpMeterView.vue'

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
// 分桩明细屏文案随屏(共享桩库按类型过滤)
const gateTitle = computed(() => (no.value === 8 ? '电动车充电桩' : '汽车充电桩'))
const vehicleType = computed<'car' | 'ebike'>(() => (no.value === 8 ? 'ebike' : 'car'))

// ── 一屏两本账(2026-08-29 设计稿 §②):左栏常驻「报送台账 / 分桩运营账」,记住上次 ──
//    原 CP-METER-SPEC §2 的功能门(整屏两卡)已退场,理由同 PvView。
// 组件内 ref 即会话记忆(KeepAlive 自然保持),刷新重进重选;原附表7/8 流程零行为变化,整体包进 v-else。
// 一屏两本账(2026-08-29「两本账」设计稿 §②):左栏常驻,记住上次看的是哪一本。
// 改前是一道**整屏拦住**的功能门,而且 mode 是纯本地 ref —— 侧栏点击走 openFresh
// 会重建组件,每次进来都得重答一遍这道选择题。三份规范本来就写着「会话内记住选择」,
// 实现从落笔那天起就没做到(openFresh 的语义比那三份规范早 11 天)。
const MODES = [
  { id: 'summary', name: '报送台账', desc: '按运营商 · 按月' },
  { id: 'meter', name: '分桩运营账', desc: '按桩 · 按日' },
] as const
type Mode = (typeof MODES)[number]['id']
const MODE_SCREEN = no.value === 7 ? 'car-charging' : 'ebike-charging'
const mode = ref<Mode>(loadViewMode(MODE_SCREEN, MODES.map(m => m.id), 'summary'))
watch(mode, (m) => saveViewMode(MODE_SCREEN, m))

// ── 本屏状态(通用部分见 useSchedScreen) ─────────────────
const cat = ref('all')
const cats = ref<ChargingCatDTO[]>([])
const overview = ref<ChargingOverviewDTO | null>(null)  // §6 加载信号
const yearData = ref<ChargingYearDTO | null>(null)

async function loadYear(y: number) {
  yearData.value = await chargingApi.records(no.value, y)
}
async function reloadOverview() {
  overview.value = await chargingApi.overview(no.value)
}

const {
  year, edit, drawer, importing, importResult, selectedIds, importedCount,
  guard, refresh, pickYear, goGate, toggleSelect, selectAll, onBatchDelete, onClearImported,
} = useSchedScreen({
  load: loadYear,
  reloadOverview,
  rows: () => yearData.value?.rows ?? [],
  clearData: () => { yearData.value = null },
  onPickYear: () => { cat.value = 'all' },
  selectAllFilter: (r: ChargingRecordDTO) => cat.value === 'all' || r.cat === cat.value,
  batchDelete: ids => chargingApi.batchDelete(no.value, ids),
  clear: {
    call: y => chargingApi.clearImported(no.value, y),
    confirm: clearConfirm('本年', '手动行不受影响。'),
  },
})

// ⚠ 切账本必须退出编辑态。`edit` 由本层持有(useSchedScreen),锁却由子组件 SchedHeader 持有,
//   还锁挂在 useEditLock 的 onUnmounted 上 —— 切走时 SchedHeader 卸载,**锁真的还了**,
//   而 edit 仍是 true。切回来 SchedHeader 重新挂载,props.edit 已是 true:它的 scope 守卫有
//   `before == null` 前提不会触发,也没有 onMounted 重新 acquire —— 于是表格以编辑态渲染
//   却一把锁都没有,两个人能同时改同一期,后写静默盖先写(CONCURRENCY-SPEC §1.1 那个事故)。
//   改前离开只有 SchedHeader 的 @back → goGate,而 goGate 第一件事就是 edit=false;
//   左栏是这一刀新开的、绕过 goGate 的退出路径,得自己补上这一句。
watch(mode, () => { edit.value = false })

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

// ── 导入 Excel(自定义解析:单表逐行,运营商下填,fee 按附表口径算好) ──
// 确认导入 → runImport(共享 registry:customParse 已把解析期跳过暂存到 importCtx._parseErrors,run 合并 + 记录 import_log)。
async function onImport(recs: ImportRec[], fileName: string) {
  importing.value = false
  if (!edit.value) return   // 写口自守:editMode 会就地转假,浮层可能还挂着
  await guard('导入失败', async () => {
    importResult.value = await runImport('charging_' + no.value, recs, importCtx, fileName)
    await refresh()
  })
}

const onCreate = (req: ChargingRecordReq) => guard('新增记账失败', async () => {
  if (!edit.value) return   // 写口自守:editMode 会就地转假,浮层可能还挂着
  await chargingApi.create(no.value, req)
  drawer.value = false
  // 提交后归入对应年份(可能与当前选中年不同)
  year.value = parseInt(req.acctMonth.split('-')[0], 10)
  await refresh()
})

const onDelete = (row: ChargingRecordDTO) => guard('删除失败', async () => {   // seed 行 → 409
  await chargingApi.remove(no.value, row.id)
  await refresh()
})

const onNote = (row: ChargingRecordDTO, text: string) => guard('保存备注失败', async () => {
  await chargingApi.updateNote(no.value, row.id, text || null)
  await refresh()
})

const onExport = () => guard('导出失败', async () => {
  if (!yearData.value || year.value == null) return
  await exportChargingYear(yearData.value, year.value, title.value)
})

const yearRange = computed(() => (overview.value?.years ?? []).map(y => y.year))
</script>

<template>
  <!-- 外壳收敛(第 5 步共享件):三屏此前各抄一份同字节的 aside+CSS,现在共用 BookRailShell -->
  <BookRailShell title="充电桩" :books="MODES" :active-id="mode"
                 @select="(id) => (mode = id as Mode)">
  <!-- 分桩充电明细(新屏,附表7/8 共享组件按类型过滤桩) -->
  <CpMeterView v-if="mode === 'meter'" :vehicle-type="vehicleType" />

  <!-- 附表7/8 · 月度汇总:原流程原样(§6 加载门:overview 到达前显转圈,不闪空态) -->
  <template v-else-if="overview">
    <!-- ⓪ 年份选择层 -->
    <SchedYearGate
      :scope-of="(y) => S.charging(no, y)"
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
          :scope="S.charging(no, year)"
          :icon="icon"
          :title="title"
          :sub="sub"
          :year="year"
          :edit="edit"
          perm="entry:edit"
          @back="goGate"
          @toggle-edit="edit = !edit"
         :show-import="true" @import="importing = true">
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
  </BookRailShell>
</template>

<style scoped>
/* 1:1 from screen-charging.jsx ChStyles(.ch-page,24) */
.ch-page { display:flex; flex-direction:column; gap:14px; height:100%; min-height:0; box-sizing:border-box; }

</style>
