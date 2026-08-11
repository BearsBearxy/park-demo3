<script setup lang="ts">
// 附表11 电费成本 — 年度台账状态机。
// 动线 1:1 from screen-schedule11.jsx Schedule11Screen(282-559):
// ⓪ 功能门(ELEC-COST-SPEC:月度电费(原)/成本总览(新)) → 年份选择层(SchedYearGate) → 该年逐月明细表(SchedHeader + 右上 type 切换 + ElecTable + 抽屉)。
// 两类型共一表用 type 区分:energy(电量电费)/ basic(基本电费),切 type 重新取数。
// 套用 DESIGN-FIDELITY §6 加载门:overview 未到显 .page-loading,不闪空态。
import { ref, computed, onMounted } from 'vue'
import { elecApi } from '@/api/elec'
import { exportElecYear } from '@/utils/elecExcel'
import { parserProps, runImport } from '@/utils/importRegistry'
import { useSchedScreen } from '@/composables/useSchedScreen'
import type { ElecPhaseDTO, ElecOverviewDTO, ElecYearDTO, ElecRecordDTO, ElecRecordReq, ElecImportRow } from '@/types/elec'
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import SchedYearGate, { type YearCard } from '@/components/sched/SchedYearGate.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import ElecTable from './ElecTable.vue'
import ElecRecordDrawer from './ElecRecordDrawer.vue'
import ElecCostView from './ElecCostView.vue'

// ── 功能门(ELEC-COST-SPEC §4,1:1 照 PvView 模式):进入先选「附表11 月度电费(原)/电费成本总览(新)」──
// 组件内 ref 即会话记忆(KeepAlive 自然保持),刷新重进重选;原附表11流程零行为变化,整体包进 v-else。
const mode = ref<'summary' | 'cost' | null>(null)

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
  year, edit, drawer, importing, importResult, selectedIds, importedCount,
  guard, refresh, pickYear, goGate, toggleSelect, selectAll, onBatchDelete, onClearImported,
} = useSchedScreen({
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
  await guard('导入失败', async () => {
    importResult.value = await runImport('elec', recs, {}, fileName)
    await refresh()
  })
}

const onCreate = (req: ElecRecordReq) => guard('新增记账失败', async () => {
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
  <!-- ⓪ 功能门(ELEC-COST-SPEC §4):两卡分叉,卡片风格同 SchedYearGate 年卡 -->
  <div v-if="mode === null" class="e11-fngate">
    <div class="e11-fngate-head">
      <h2 class="e11-fngate-title">
        <span class="ic"><component :is="iconFor('zap')" :size="18" /></span>电费
      </h2>
      <p class="e11-fngate-sub">选择进入方式 · 月度电费 = 附表11 原年度台账;成本总览 = 园区电费物理模型与派生指标</p>
    </div>
    <div class="e11-fngate-grid">
      <div class="e11-fncard" @click="mode = 'summary'">
        <span class="e11-fnc-go"><component :is="iconFor('arrow-right')" :size="16" /></span>
        <div class="e11-fnc-ic"><component :is="iconFor('zap')" :size="20" /></div>
        <div class="e11-fnc-name">附表11 · 月度电费</div>
        <div class="e11-fnc-desc">对外电费进项台账(电量电费分时 + 基本电费),按年逐月记账,含导入与年度合计 —— 原有流程。</div>
      </div>
      <div class="e11-fncard" @click="mode = 'cost'">
        <span class="e11-fnc-go"><component :is="iconFor('arrow-right')" :size="16" /></span>
        <div class="e11-fnc-ic"><component :is="iconFor('gauge')" :size="20" /></div>
        <div class="e11-fnc-name">电费成本总览</div>
        <div class="e11-fnc-desc">总表/宿舍/运营电表按费项逐月录入,派生园区电费收益等 7 项指标,含电价参数与模拟填充。</div>
      </div>
    </div>
    <p class="e11-fngate-foot"><component :is="iconFor('info')" :size="13" />成本总览的模拟填充只读取附表11 等真实数据推导,不回写附表11。</p>
  </div>

  <!-- 电费成本总览(新屏) -->
  <ElecCostView v-else-if="mode === 'cost'" @back="mode = null" />

  <!-- 附表11 · 月度电费:原流程原样(§6 加载门:overview 到达前显转圈,不闪空态) -->
  <template v-else-if="overview">
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
      back-label="返回功能选择"
      @pick="pickYear"
      @back="mode = null"
    /><!-- back=功能门回退口(组件既有 prop);附表11 年内流程零改动 -->

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

        <ElecTable
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

    <!-- 切年/切类过渡兜底转圈 -->
    <div v-else class="page-loading"><span class="page-spin" /></div>

    <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />
  </template>

  <div v-else class="page-loading"><span class="page-spin" /></div>
</template>

<style scoped>
/* 1:1 from screen-schedule11.jsx EStyles(.e11-page,21) */
.e11-page { display:flex; flex-direction:column; gap:14px; height:100%; min-height:0; box-sizing:border-box; }

/* ── 功能门(ELEC-COST-SPEC §4):卡片风格同 SchedYearGate .sm-ycard 家族(1:1 照 PvView .pv-fngate) ── */
.e11-fngate { display:flex; flex-direction:column; gap:18px; width:100%; height:100%; min-height:0; box-sizing:border-box; font-family:var(--font-sans); color:var(--text-primary); }
.e11-fngate-title { margin:0; display:flex; align-items:center; gap:11px; font-size:var(--fs-h2); font-weight:var(--fw-semibold); color:var(--text-primary); }
.e11-fngate-title .ic { width:34px; height:34px; border-radius:10px; background:var(--surface-sunken); display:grid; place-items:center; color:var(--text-secondary); flex:0 0 auto; }
.e11-fngate-sub { margin:6px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.e11-fngate-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px,1fr)); gap:16px; max-width:720px; }
.e11-fncard { position:relative; display:flex; flex-direction:column; gap:10px; min-height:152px; padding:21px 23px; box-sizing:border-box; cursor:pointer; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); transition:border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard); }
.e11-fncard:hover { border-color:var(--border-strong); box-shadow:0 8px 24px rgba(28,28,28,.10); transform:translateY(-2px); }
.e11-fnc-ic { width:40px; height:40px; border-radius:12px; background:var(--surface-card); display:grid; place-items:center; color:var(--text-secondary); }
.e11-fnc-name { font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.e11-fnc-desc { font-size:12.5px; line-height:1.55; color:var(--text-muted); }
.e11-fnc-go { position:absolute; top:21px; right:21px; width:30px; height:30px; border-radius:50%; display:grid; place-items:center; color:var(--text-disabled); background:var(--surface-card); opacity:0; transform:translateX(-4px); transition:opacity var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.e11-fncard:hover .e11-fnc-go { opacity:1; transform:translateX(0); background:var(--ink-900); color:#fff; }
.e11-fngate-foot { margin:0; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; }
</style>
