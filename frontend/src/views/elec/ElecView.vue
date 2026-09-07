<script setup lang="ts">
// 附表11 电费成本 — 年度台账状态机。
// 动线 1:1 from screen-schedule11.jsx Schedule11Screen(282-559):
// ⓪ 左栏两本账 → 年份选择层(SchedYearGate) → 该年逐月明细表(SchedHeader + 右上 type 切换 + ElecTable + 抽屉)。
// 两类型共一表用 type 区分:energy(电量电费)/ basic(基本电费),切 type 重新取数。
// 套用 DESIGN-FIDELITY §6 加载门:overview 未到显 .page-loading,不闪空态。
import { ref, computed, onMounted , watch} from 'vue'
import { useRoute } from 'vue-router'
import { onReactivated } from '@/composables/onReactivated'
import { useDeepPeriod } from '@/composables/useDeepPeriod'
import { periodOf } from '@/nav/deepLink'
import FPToast from '@/components/fp/FPToast.vue'
import { S } from '@/utils/lockScopes'
import { elecApi } from '@/api/elec'
import { exportElecYear } from '@/utils/elecExcel'
import { parserProps, runImport } from '@/utils/importRegistry'
import { useSchedScreen } from '@/composables/useSchedScreen'
import type { ElecPhaseDTO, ElecOverviewDTO, ElecYearDTO, ElecRecordDTO, ElecRecordReq, ElecImportRow } from '@/types/elec'
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { loadViewMode, saveViewMode } from '@/utils/viewMode'
import BookRailShell from '@/components/fp/BookRailShell.vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import SchedYearGate, { type YearCard } from '@/components/sched/SchedYearGate.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import ElecTable from './ElecTable.vue'
import ElecRecordDrawer from './ElecRecordDrawer.vue'
import ElecCostView from './ElecCostView.vue'

// ── 一屏两本账(2026-08-29 设计稿 §②):左栏常驻「报送台账 / 园区电费模型」,记住上次 ──
//    原 ELEC-COST-SPEC §4 的功能门(整屏两卡)已退场,理由同 PvView。
//    第二本不叫「运营账」——它记的不是逐日流水,是园区电费的物理模型(4 类 8 表 × 费项)。
// 组件内 ref 即会话记忆(KeepAlive 自然保持),刷新重进重选;原附表11流程零行为变化,整体包进 v-else。
// 一屏两本账(2026-08-29「两本账」设计稿 §②):左栏常驻,记住上次看的是哪一本。
// 改前是一道**整屏拦住**的功能门,而且 mode 是纯本地 ref —— 侧栏点击走 openFresh
// 会重建组件,每次进来都得重答一遍这道选择题。三份规范本来就写着「会话内记住选择」,
// 实现从落笔那天起就没做到(openFresh 的语义比那三份规范早 11 天)。
const MODES = [
  { id: 'summary', name: '报送台账', desc: '按类型 · 按月' },
  { id: 'cost', name: '园区电费模型', desc: '按电表 · 按费项' },
] as const
type Mode = (typeof MODES)[number]['id']
const MODE_SCREEN = 'elec-cost'
// 深链 ?mode=summary|cost 只在首载认(首页附表行走 openFresh,实例总是新的;SIDEBAR-UX-REDESIGN §5.1):
// 盖过本机记住的那本,但不写回 —— 下面的 watch(mode) 非 immediate,只记用户自己的切换。
const route = useRoute()
const deepMode = MODES.find(m => m.id === route.query.mode)?.id ?? null
const mode = ref<Mode>(deepMode ?? loadViewMode(MODE_SCREEN, MODES.map(m => m.id), 'summary'))
watch(mode, (m) => saveViewMode(MODE_SCREEN, m))

// ── 本屏状态(通用部分见 useSchedScreen) ─────────────────
const type = ref<'energy' | 'basic'>('energy')
const phases = ref<ElecPhaseDTO[]>([])
const overview = ref<ElecOverviewDTO | null>(null)  // §6 加载信号
const yearData = ref<ElecYearDTO | null>(null)

// 竞态守卫:快速切类型时只接受最新一次请求的结果(防乱序落表)
let yearSeq = 0
async function loadYear(y: number) {
  const seq = ++yearSeq
  const data = await elecApi.records(y, type.value)
  if (seq !== yearSeq) return
  yearData.value = data
}
async function reloadOverview() {
  overview.value = await elecApi.overview()
}

const {
  year, edit, drawer, importing, importResult, selectedIds, importedCount, lockedMonths,
  guard, refresh, pickYear, goGate, toggleSelect, selectAll, onBatchDelete, onClearImported,
} = useSchedScreen({
  // 审核闸按月份行上锁(D18):本屏是年表屏,一屏 12 个月的行各审各的
  reviewKinds: ['elec-cost'],
  load: loadYear,
  reloadOverview,
  rows: () => yearData.value?.rows ?? [],
  clearData: () => { yearData.value = null },
  onPickYear: () => { type.value = 'energy' },
  batchDelete: elecApi.batchDelete,
  clear: {
    call: elecApi.clearImported,
    // 本屏例外:清空跨 energy+basic 两类,不看当前视图的导入行数,文案固定
    confirm: () => confirm('确认清空本年全部导入数据(电量电费 + 基本电费)?手动/种子行不受影响。'),
  },
})

// 期间深链(SIDEBAR-UX-REDESIGN §4.2):年表屏 p 只取年(current 也只报年,否则首页发 YYYY-MM 时永不相等、每次切回白拉一趟)。
// 园区电费模型那本(cost)开着时不拉年表 —— 它在 v-else 底下看不见;带月的 p 由子屏 ElecCostView 自己认。
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

// 右上 type 切换:重新取该年该类台账(后端按 type 过滤)
async function switchType(t: string) {
  if (t === type.value || year.value == null) return
  type.value = t as 'energy' | 'basic'
  selectedIds.value = new Set()   // 选择不跨类沿用
  await loadYear(year.value)   // 不清空 yearData:避免整屏闪烁
}

// ── 导入 Excel(自定义解析:一(记账期,期)→ 多 energy + 大工业附 1 basic,扁平 records) ──
// 确认后经 runImport(共享 registry 执行 + 记录 import_log)→ 刷新。
async function onImport(recs: ImportRec[], fileName: string) {
  importing.value = false
  if (!edit.value) return   // 写口自守:editMode 会就地转假,浮层可能还挂着
  await guard('导入失败', async () => {
    importResult.value = await runImport('elec', recs, {}, fileName)
    await refresh()
  })
}

const onCreate = (req: ElecRecordReq) => guard('新增记账失败', async () => {
  if (!edit.value) return   // 写口自守:editMode 会就地转假,浮层可能还挂着
  await elecApi.create(req)
  drawer.value = false
  // 提交后归入对应年份与费用类型(可能与当前选中不同)
  year.value = parseInt(req.acctMonth.split('-')[0], 10)
  type.value = req.type
  await refresh()
})

const onDelete = (row: ElecRecordDTO) => guard('删除失败', async () => {   // seed 行 → 409
  await elecApi.remove(row.id)
  await refresh()
})

const onNote = (row: ElecRecordDTO, text: string) => guard('保存备注失败', async () => {
  await elecApi.updateNote(row.id, text || null)
  await refresh()
})

const onExport = () => guard('导出失败', async () => {
  if (!yearData.value || year.value == null) return
  await exportElecYear(yearData.value, year.value)
})

const yearRange = computed(() => (overview.value?.years ?? []).map(y => y.year))
</script>

<template>
  <!-- 外壳收敛(第 5 步共享件):三屏此前各抄一份同字节的 aside+CSS,现在共用 BookRailShell -->
  <BookRailShell title="电费" :books="MODES" :active-id="mode"
                 @select="(id) => (mode = id as Mode)"
                 :class="{ 'fp-fluid': mode !== 'cost' }">
  <!-- fp-fluid 条件挂(RESPONSIVE-LAYOUT-SPEC §8):master 侧给旧功能门逐状态挂的摘地板意图,
       随功能门消亡移植到壳根 —— 报送台账各态已迁移,摘 800px 地板;园区电费模型(ElecCostView) 未迁移,
       渲染在壳内,那本账保地板(响应式侧原话「不挂、保地板」)。迁移完那屏后把条件拆掉。 -->
  <!-- 电费成本总览(新屏) -->
  <ElecCostView v-if="mode === 'cost'" />

  <!-- 附表11 · 月度电费:原流程原样(§6 加载门:overview 到达前显转圈,不闪空态) -->
  <template v-else-if="overview">
    <!-- ⓪ 年份选择层 -->
    <SchedYearGate
      class="fp-fluid"
      :scope-of="(y) => S.elecSched(y)"
      v-if="year === null"
      icon="zap"
      title="附表11 · 电费成本"
      sub="对外电费进项 · 电量电费(分时)+ 基本电费 · 先选择年份,再进入对应年度的逐月明细表"
      :years="yearCards"
      :current="overview.currentYear"
      store-key="elec"
      footer="每个年份是一份独立的逐月电费台账;进入后在编辑模式下新增或导入。"
      @pick="pickYear"
    /><!-- back=功能门回退口(组件既有 prop);附表11 年内流程零改动 -->

    <!-- 年度明细表 -->
    <template v-else-if="yearData">
      <div class="e11-page fp-fluid">
        <SchedHeader
          :scope="S.elecSched(year)"
          icon="zap"
          title="附表11 · 电费成本"
          sub="对外电费进项 · 电量电费(分时)+ 基本电费 · 一期 / 二期 / 三期 · 金额单位 元"
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

        <ElecTable
          :locked-months="lockedMonths"
          :year="year"
          :type="type"
          :phases="yearData.phases"
          :rows="yearData.rows"
          :total="yearData.total"
          :edit="edit"
          :selected-ids="selectedIds"
          @switch-type="switchType"
          @add="drawer = true"
          @edit="edit = true"
          @delete="onDelete"
          @note="onNote"
          @toggle-select="toggleSelect"
          @select-all="selectAll"
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

      <FpImportModal
        v-if="importing"
        :title="`导入 附表11 · ${year}年电费成本`"
        sub="上传/粘贴电费成本附表(两行表头),系统按(记账期,期)切分,产电量电费 + 大工业基本电费记录,核对后导入"
        v-bind="parserProps('elec')"
        @close="importing = false"
        @import="onImport"
      />
    </template>

    <!-- 切年/切类过渡兜底转圈(fp-fluid:转圈不该被 800px 地板逼出横滚) -->
    <div v-else class="page-loading fp-fluid"><span class="page-spin" /></div>

    <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />
    <FPToast v-model="deepNote" tone="warning" placement="page" :duration="0" />
  </template>

  <div v-else class="page-loading"><span class="page-spin" /></div>
  </BookRailShell>
</template>

<style scoped>
/* 1:1 from screen-schedule11.jsx EStyles(.e11-page,21) */
.e11-page { display:flex; flex-direction:column; gap:14px; height:100%; min-height:0; box-sizing:border-box; }

</style>
