<script setup lang="ts">
// 附表13/14 办公·三期水电 — 单 View,内部 tab 状态(office=13 / phase3=14)。
// 动线 1:1 from screen-utilities.jsx UtilitiesScreen(238-444):
// ⓪ 年份选择层(SchedYearGate,store-key="utilities",合并 13+14 两子表)→
//   进表后顶部 Segmented 切「附表13·办公水电 / 附表14·三期水电」(切 tab → 用对应 no 重载 records)。
// 套用 DESIGN-FIDELITY §6 加载门:overview 未到显 .page-loading,不闪空态。
import { ref, computed, onMounted } from 'vue'
import { S } from '@/utils/lockScopes'
import { utilitiesApi } from '@/api/utilities'
import { exportUtilitiesYear } from '@/utils/utilitiesExcel'
import { parseYearMonth } from '@/utils/parseYearMonth'
import { useSchedScreen, clearConfirm } from '@/composables/useSchedScreen'
import type { OfficeOverviewDTO, OfficeYearDTO, OfficeRecordDTO, OfficeRecordReq, OfficeImportRow } from '@/types/utilities'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import SchedYearGate, { type YearCard } from '@/components/sched/SchedYearGate.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import FpImportModal, { type ImportRec } from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import { parserProps, runImport } from '@/utils/importRegistry'
import UtilitiesTable from './UtilitiesTable.vue'
import UtilitiesRecordDrawer from './UtilitiesRecordDrawer.vue'

// ── 子表元信息(office=13 / phase3=14;icon construction 不在图标表 → phase3 用 wrench) ──
type Tab = 'office' | 'phase3'
const TABS: Record<Tab, { no: number; name: string; icon: string; sub: string; note: string }> = {
  office: {
    no: 13, name: '办公水电', icon: 'building',
    sub: '园区办公区逐月水电费 · 用电量 千瓦 / 用水量 吨 / 金额 元',
    note: '办公区日常水电,按月持续记录;单价为园区基准价。',
  },
  phase3: {
    no: 14, name: '三期水电', icon: 'wrench',
    sub: '三期区域建设期间临时水电 · 工程完工后停止记录',
    note: '三期建设临时用水用电,工程完工(2025年3月)即止;此后不再产生记录。',
  },
}

// ── 本屏状态(通用部分见 useSchedScreen) ─────────────────
const tab = ref<Tab>('office')
const no = computed(() => TABS[tab.value].no)
const meta = computed(() => TABS[tab.value])

const overview = ref<OfficeOverviewDTO | null>(null)  // §6 加载信号(合并 13+14)
const yearData = ref<OfficeYearDTO | null>(null)

// 竞态守卫:快速切子表时只接受最新一次请求的结果(防乱序落表)
let yearSeq = 0
async function loadYear(y: number) {
  const seq = ++yearSeq
  const data = await utilitiesApi.records(no.value, y)
  if (seq !== yearSeq) return
  yearData.value = data
}
async function reloadOverview() {
  overview.value = await utilitiesApi.overview()
}

const {
  year, edit, drawer, importing, importResult, selectedIds, importedCount,
  guard, refresh, pickYear, goGate, toggleSelect, selectAll, onBatchDelete, onClearImported,
} = useSchedScreen({
  load: loadYear,
  reloadOverview,
  rows: () => yearData.value?.rows ?? [],
  clearData: () => { yearData.value = null },
  batchDelete: utilitiesApi.batchDelete,
  clear: {
    call: y => utilitiesApi.clearImported(no.value, y),
    confirm: clearConfirm('本年', '手动行不受影响。'),
  },
})

// ⓪ overview.years → YearCard(metric=「¥X万」label=「全年水电费·N条」)
const yearCards = computed<YearCard[]>(() =>
  (overview.value?.years ?? []).map(y => ({
    year: y.year,
    hasData: y.hasData,
    metric: '¥' + (y.totalFee / 10000).toFixed(1) + '万',
    label: '全年水电费 · ' + y.count + ' 条',
  })),
)

const yearRange = computed(() => (overview.value?.years ?? []).map(y => y.year))

// ── 进入屏:overview(§6 取数前不渲染) ──────────
onMounted(async () => {
  overview.value = await utilitiesApi.overview()
})

// ── 导入 Excel(按表头名字匹配,行身份=月份字符串) ──────────
// 经 runImport(共享 registry:逐行 parseYearMonth 分年 + importRows + 记录 import_log)→ 刷新。
async function onImport(recs: ImportRec[], fileName: string) {
  importing.value = false
  if (!edit.value) return   // 写口自守:editMode 会就地转假,浮层可能还挂着
  if (year.value == null) return
  await guard('导入失败', async () => {
    importResult.value = await runImport('office_' + no.value, recs, {}, fileName)
    await refresh()
  })
}

// 切子表 → 用对应 no 重载当前年 records
async function switchTab(t: Tab) {
  if (t === tab.value) return
  tab.value = t
  selectedIds.value = new Set()
  if (year.value != null) {
    await loadYear(year.value)   // 不清空 yearData:避免整屏闪烁
  }
}

const onCreate = (req: OfficeRecordReq) => guard('新增记账失败', async () => {
  if (!edit.value) return   // 写口自守:editMode 会就地转假,浮层可能还挂着
  await utilitiesApi.create(no.value, req)
  drawer.value = false
  // 提交后归入对应年份(可能与当前选中年不同)
  year.value = parseInt(req.acctMonth.split('-')[0], 10)
  await refresh()
})

const onDelete = (row: OfficeRecordDTO) => guard('删除失败', async () => {
  await utilitiesApi.remove(no.value, row.id)
  await refresh()
})

const onNote = (row: OfficeRecordDTO, text: string) => guard('保存备注失败', async () => {
  await utilitiesApi.updateNote(no.value, row.id, text || null)
  await refresh()
})

const onExport = () => guard('导出失败', async () => {
  if (!yearData.value || year.value == null) return
  await exportUtilitiesYear(yearData.value, year.value, '附表' + no.value + ' · ' + meta.value.name)
})
</script>

<template>
  <!-- §6 加载门:overview 到达前显转圈,不闪空态 -->
  <template v-if="overview">
    <!-- ⓪ 年份选择层(合并 13+14;store-key 固定 'utilities')。
         fp-fluid = 摘掉 base.css 的 800px 屏级地板(RESPONSIVE-LAYOUT-SPEC §8):本屏查看态已按
         §5.4/§6 迁移——表在 .ut-tablewrap 内横滚、hover 显形控件触屏常显;各状态根逐一挂。 -->
    <SchedYearGate
      class="fp-fluid"
      :scope-of="(y) => S.utilities(no, y)"
      v-if="year === null"
      icon="plug"
      title="办公 · 三期水电"
      sub="附表13 办公水电 / 附表14 三期水电 · 先选择年份,再进入对应年度的逐月明细表"
      :years="yearCards"
      :current="overview.currentYear"
      store-key="utilities"
      footer="每个年份是一份独立的逐月水电台账;进入后顶部可切换办公 / 三期子表,在编辑模式下新增或导入。"
      @pick="pickYear"
    />

    <!-- 年度明细表 -->
    <template v-else-if="yearData">
      <div class="ut-page fp-fluid">
        <SchedHeader
          :scope="S.utilities(no, year)"
          icon="plug"
          title="办公 · 三期水电"
          :sub="meta.sub"
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

        <!-- 子表分段(办公 / 三期)+ 本年条数(1:1 from jsx .ut-toolbar) -->
        <div class="ut-toolbar">
          <div class="ut-toolbar-l">
            <div class="ut-seg2">
              <button :class="['ut-seg2-b', { on: tab === 'office' }]" @click="switchTab('office')">
                <component :is="iconFor('building')" :size="15" />附表13 · 办公水电
              </button>
              <button :class="['ut-seg2-b', { on: tab === 'phase3' }]" @click="switchTab('phase3')">
                <component :is="iconFor('wrench')" :size="15" />附表14 · 三期水电
              </button>
            </div>
          </div>
          <div class="ut-toolbar-r">
            <span class="ut-count">本年 <b>{{ yearData.rows.length }}</b> 条记账</span>
          </div>
        </div>

        <UtilitiesTable
          :year="year"
          :icon="meta.icon"
          :name="meta.name"
          :note="meta.note"
          :rows="yearData.rows"
          :total="yearData.total"
          :edit="edit"
          :selected-ids="selectedIds"
          @add="drawer = true"
          @delete="onDelete"
          @note="onNote"
          @toggle-select="toggleSelect"
          @select-all="selectAll"
        />
      </div>

      <UtilitiesRecordDrawer
        v-if="drawer"
        :no="no"
        :name="meta.name"
        :icon="meta.icon"
        :init-year="year"
        :years="yearRange"
        @close="drawer = false"
        @save="onCreate"
      />

      <FpImportModal
        v-if="importing"
        :title="`导入 附表${no} · ${year}年${meta.name}`"
        sub="上传/粘贴逐月水电表,系统按表头名字识别列、按月份识别行,核对后导入本年"
        v-bind="parserProps('office_' + no)"
        @close="importing = false"
        @import="onImport"
      />
    </template>

    <!-- 切年 / 切子表过渡兜底转圈(fp-fluid:转圈不该被 800px 地板逼出横滚) -->
    <div v-else class="page-loading fp-fluid"><span class="page-spin" /></div>

    <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />
  </template>

  <div v-else class="page-loading fp-fluid"><span class="page-spin" /></div>
</template>

<style scoped>
/* 1:1 from screen-utilities.jsx UtStyles(.ut-page / .ut-seg2 / .ut-toolbar 段) */
.ut-page { display:flex; flex-direction:column; gap:14px; height:100%; min-height:0; box-sizing:border-box; font-family:var(--font-sans); color:var(--text-primary); }

/* 子表分段(办公 / 三期) */
.ut-seg2 { flex:0 0 auto; display:flex; gap:6px; padding:4px; background:var(--surface-sunken); border-radius:var(--radius-full); width:max-content; }
.ut-seg2-b { display:inline-flex; align-items:center; gap:7px; height:34px; padding:0 16px; border:none; background:transparent; border-radius:var(--radius-full); cursor:pointer; font-family:var(--font-sans); font-size:13px; font-weight:var(--fw-medium); color:var(--text-secondary); transition:all var(--dur-fast); }
.ut-seg2-b:hover { color:var(--text-primary); }
.ut-seg2-b.on { background:var(--surface-white); color:var(--text-primary); box-shadow:0 1px 4px rgba(28,28,28,.10); }

.ut-toolbar { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.ut-toolbar-l { display:flex; align-items:center; gap:12px; flex-wrap:wrap; min-width:0; }
.ut-toolbar-r { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.ut-count { font-size:12px; color:var(--text-muted); }
.ut-count b { color:var(--text-secondary); font-weight:var(--fw-semibold); font-family:var(--font-mono); }

@media (max-width: 600px) { /* S */
  /* 工具行收纳(RESPONSIVE-LAYOUT-SPEC §3.3 修订:允许两行):子表分段与计数各自成行;
     .ut-seg2(width:max-content,两钮 ≈330px)比 390 视口还宽时段内横滚兜底,不撑破页宽 */
  .ut-toolbar-l { overflow-x:auto; }
}
</style>
