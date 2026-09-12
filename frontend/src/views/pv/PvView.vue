<script setup lang="ts">
// 附表6 光伏发电 — 年度台账状态机。
// 动线 1:1 from screen-schedule6.jsx Schedule6Screen(237-440):
// ⓪ 年份选择层(SchedYearGate) → 该年逐月明细表(SchedHeader + PvTable + 抽屉)。
// 套用 PAGE-BEHAVIOR-SPEC §1 加载门:overview 未到显 .page-loading,不闪空态。
// 6 屏共用的台账状态机(勾选/批删/清空导入/进出年份门/报错口径)走 useSchedScreen,这里只留本屏差异。
import { ref, computed, onMounted , watch} from 'vue'
import { useRoute } from 'vue-router'
import { onReactivated } from '@/composables/onReactivated'
import { useDeepPeriod } from '@/composables/useDeepPeriod'
import { periodOf } from '@/nav/deepLink'
import FPToast from '@/components/fp/FPToast.vue'
import { S } from '@/utils/lockScopes'
import { pvApi } from '@/api/pv'
import { exportPvYear } from '@/utils/pvExcel'
import { parserProps, runImport } from '@/utils/importRegistry'
import { useSchedScreen, clearConfirm } from '@/composables/useSchedScreen'
import type { PvPhaseDTO, PvOverviewDTO, PvYearDTO, PvRecordDTO, PvRecordReq, PvImportRow } from '@/types/pv'
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { loadViewMode, saveViewMode } from '@/utils/viewMode'
import BookRailShell from '@/components/fp/BookRailShell.vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import SchedYearGate, { type YearCard } from '@/components/sched/SchedYearGate.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import PvTable from './PvTable.vue'
import PvRecordDrawer from './PvRecordDrawer.vue'
import PvMeterView from './PvMeterView.vue'

// ── 一屏两本账(2026-08-29 设计稿 §②):左栏常驻「报送台账 / 分栋运营账」,记住上次 ──
//    原 PV-METER-SPEC §2 的**功能门**(整屏两卡)已退场 —— 它给的理由是「原功能保持原样不动」,
//    即不动老屏的实现成本,不在那份规范的「用户确认决策」清单里。
// 组件内 ref 即会话记忆(KeepAlive 自然保持),刷新重进重选;原附表6流程零行为变化,整体包进 v-else。
// 一屏两本账(2026-08-29「两本账」设计稿 §②):左栏常驻,记住上次看的是哪一本。
// 改前是一道**整屏拦住**的功能门,而且 mode 是纯本地 ref —— 侧栏点击走 openFresh
// 会重建组件,每次进来都得重答一遍这道选择题。三份规范本来就写着「会话内记住选择」,
// 实现从落笔那天起就没做到(openFresh 的语义比那三份规范早 11 天)。
const MODES = [
  { id: 'summary', name: '报送台账', desc: '按期 · 按月' },
  { id: 'meter', name: '分栋运营账', desc: '按栋 · 按日' },
] as const
type Mode = (typeof MODES)[number]['id']
const MODE_SCREEN = 'pv-income'
// 深链 ?mode=summary|meter 只在首载认(首页附表行走 openFresh,实例总是新的;SIDEBAR-UX-REDESIGN §5.1):
// 盖过本机记住的那本,但不写回 —— 下面的 watch(mode) 非 immediate,只记用户自己的切换。
const route = useRoute()
const deepMode = MODES.find(m => m.id === route.query.mode)?.id ?? null
const mode = ref<Mode>(deepMode ?? loadViewMode(MODE_SCREEN, MODES.map(m => m.id), 'summary'))
watch(mode, (m) => saveViewMode(MODE_SCREEN, m))

// ── 本屏状态(通用部分见 useSchedScreen) ─────────────────
const phase = ref('all')
const phases = ref<PvPhaseDTO[]>([])
const overview = ref<PvOverviewDTO | null>(null)  // §6 加载信号
const yearData = ref<PvYearDTO | null>(null)

async function loadYear(y: number) {
  yearData.value = await pvApi.records(y)
}
async function reloadOverview() {
  overview.value = await pvApi.overview()
}

const {
  year, edit, drawer, importing, importResult, selectedIds, importedCount, lockedMonths, reviewKeys,
  guard, refresh, pickYear, goGate, toggleSelect, selectAll, onBatchDelete, onClearImported,
} = useSchedScreen({
  // 审核闸按月份行上锁(D18):本屏是年表屏,一屏 12 个月的行各审各的
  reviewKinds: ['pv'],
  load: loadYear,
  reloadOverview,
  rows: () => yearData.value?.rows ?? [],
  clearData: () => { yearData.value = null },
  onPickYear: () => { phase.value = 'all' },
  // 全选当前期视图行(与表内 allSelected 口径一致:按 phase 过滤)
  selectAllFilter: (r: PvRecordDTO) => phase.value === 'all' || r.phase === phase.value,
  batchDelete: pvApi.batchDelete,
  clear: { call: pvApi.clearImported, confirm: clearConfirm('本年', '手动/种子行不受影响。') },
})

// 期间深链(SIDEBAR-UX-REDESIGN §4.2):年表屏 p 只取年(current 也只报年,否则首页发 YYYY-MM 时永不相等、每次切回白拉一趟)。
// 运营账那本开着时不拉年表 —— 它在 v-else 底下看不见;带月的 p 由子屏 PvMeterView 自己认。
// 必须在下面的 onMounted / onReactivated 之前调用:期先落定,首载才只拉一次;切回时也先于重读改期。
// 本屏唯一的草稿是开着的新增抽屉 / 导入窗(pickYear 会经 edit=false 把它们关掉);切回时有 → 不切年,只在 deepNote 里说。
const { note: deepNote } = useDeepPeriod({
  current: () => ({ p: year.value == null ? null : periodOf(year.value, null) }),
  apply: (t) => { if (mode.value === 'summary') void pickYear(t.year).catch(() => {}) },
  dirty: () => (drawer.value || importing.value ? 1 : 0),
})
// KeepAlive 切回重读(spec §12):导入中心导完切回来,年表与总览不能还是导入前的(refresh = load(year) + reloadOverview)
onReactivated(() => { void refresh().catch(() => {}) })

// ⚠ 切账本必须退出编辑态。`edit` 由本层持有(useSchedScreen),锁却由子组件 SchedHeader 持有,
//   还锁挂在 useEditLock 的 onUnmounted 上 —— 切走时 SchedHeader 卸载,**锁真的还了**,
//   而 edit 仍是 true。切回来 SchedHeader 重新挂载,props.edit 已是 true:它的 scope 守卫有
//   `before == null` 前提不会触发,也没有 onMounted 重新 acquire —— 于是表格以编辑态渲染
//   却一把锁都没有,两个人能同时改同一期,后写静默盖先写(CONCURRENCY-SPEC §1.1 那个事故)。
//   改前离开只有 SchedHeader 的 @back → goGate,而 goGate 第一件事就是 edit=false;
//   左栏是这一刀新开的、绕过 goGate 的退出路径,得自己补上这一句。
watch(mode, () => { edit.value = false })

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

// ── 导入 Excel(自定义解析:多段堆叠按期切段,行自带 phaseId+acctMonth) ──
// 各段确认后经 runImport(共享 registry 执行 + 记录 import_log)→ 刷新。
async function onImportSections(picks: { label?: string; records: ImportRec[] }[], fileName: string) {
  importing.value = false
  if (!edit.value) return   // 写口自守:editMode 会就地转假,浮层可能还挂着
  await guard('导入失败', async () => {
    importResult.value = await runImport('pv', picks, {}, fileName)
    await refresh()
  })
}

const onCreate = (req: PvRecordReq) => guard('新增记账失败', async () => {
  if (!edit.value) return   // 写口自守:editMode 会就地转假,浮层可能还挂着
  await pvApi.create(req)
  drawer.value = false
  // 提交后归入对应年份(可能与当前选中年不同)
  year.value = parseInt(req.acctMonth.split('-')[0], 10)
  await refresh()
})

const onDelete = (row: PvRecordDTO) => guard('删除失败', async () => {   // seed 行 → 409
  await pvApi.remove(row.id)
  await refresh()
})

const onNote = (row: PvRecordDTO, text: string) => guard('保存备注失败', async () => {
  await pvApi.updateNote(row.id, text || null)
  await refresh()
})

const onExport = () => guard('导出失败', async () => {
  if (!yearData.value || year.value == null) return
  await exportPvYear(yearData.value, year.value)
})

const yearRange = computed(() => (overview.value?.years ?? []).map(y => y.year))
</script>

<template>
  <!-- 外壳收敛(第 5 步共享件):三屏此前各抄一份同字节的 aside+CSS,现在共用 BookRailShell -->
  <BookRailShell title="光伏发电" :books="MODES" :active-id="mode"
                 @select="(id) => (mode = id as Mode)"
                 :class="{ 'fp-fluid': mode !== 'meter' }">
  <!-- fp-fluid 条件挂(RESPONSIVE-LAYOUT-SPEC §8):master 侧给旧功能门逐状态挂的摘地板意图,
       随功能门消亡移植到壳根 —— 报送台账各态已迁移,摘 800px 地板;分栋抄表(PvMeterView) 未迁移,
       渲染在壳内,那本账保地板(响应式侧原话「不挂、保地板」)。迁移完那屏后把条件拆掉。 -->
  <!-- 分栋抄表明细(新屏) -->
  <PvMeterView v-if="mode === 'meter'" />

  <!-- 附表6 · 月度汇总:原流程原样(PAGE-BEHAVIOR-SPEC §1 加载门:overview 到达前显转圈,不闪空态) -->
  <template v-else-if="overview">
    <!-- ⓪ 年份选择层 -->
    <SchedYearGate
      class="fp-fluid"
      :scope-of="(y) => S.pv(y)"
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
      <div class="s6-page fp-fluid">
        <!-- 整年动作簇(2026-09-08 拍板):一颗按钮管整年、键仍按月;
             候选月的筛法只此一份 —— useSchedScreen 的 reviewKeys。 -->
        <SchedHeader
          :scope="S.pv(year)"
          icon="sun"
          title="附表6 · 光伏发电"
          sub="逐月发电台账 · 自发自用、余电上网 · 电量 kWh / 金额 元"
          :year="year"
          :edit="edit"
          perm="entry:edit"
          :review-keys="reviewKeys"
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

        <PvTable
          :locked-months="lockedMonths"
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

    <!-- 切年过渡兜底转圈(fp-fluid:转圈不该被 800px 地板逼出横滚) -->
    <div v-else class="page-loading fp-fluid"><span class="page-spin" /></div>

    <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />
    <FPToast v-model="deepNote" tone="warning" placement="page" :duration="0" />
  </template>

  <div v-else class="page-loading"><span class="page-spin" /></div>
  </BookRailShell>
</template>

<style scoped>
/* 1:1 from screen-schedule6.jsx S6Styles(.s6-page,26) */
.s6-page { display:flex; flex-direction:column; gap:14px; height:100%; min-height:0; box-sizing:border-box; }

</style>
