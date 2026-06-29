<script setup lang="ts">
// 附表10 · 销售收入 — 4 级动线状态机。
// 1:1 from screen-schedule10.jsx Schedule10Screen:
// ⓪ SchedYearGate(store-key 's10') → ① 月份 SchedMonthPills(已录月高亮) → ② 期 Segmented(一期/二期/三期/宿舍) → ③ 宽表。
// §6 加载门:overview 未就绪显 .page-loading,不假空态。编辑态单元格即时重算,完成时把改动 upsert 回后端。
import { ref, computed, onMounted, reactive } from 'vue'
import { s10Api } from '@/api/s10'
import { exportS10Month } from '@/utils/s10Excel'
import type { S10OverviewDTO, S10MonthDTO, S10RecordDTO, S10ColId, S10RecordReq } from '@/types/s10'
import { PHASES, PHASE_LAYOUT, leavesOf } from './layout'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import KpiCard from '@/components/ds/KpiCard.vue'
import Segmented from '@/components/ds/Segmented.vue'
import SchedYearGate, { type YearCard } from '@/components/sched/SchedYearGate.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import SchedMonthPills from '@/components/sched/SchedMonthPills.vue'
import S10Table from './S10Table.vue'
import S10RecordDrawer from './S10RecordDrawer.vue'

// ── 状态机 ───────────────────────────────────────────────
const year = ref<number | null>(null)   // null → ⓪ 年份选择层
const month = ref(1)
const phase = ref(1)
const edit = ref(false)
const drawer = ref(false)

const overview = ref<S10OverviewDTO | null>(null)  // §6 加载信号
const monthData = ref<S10MonthDTO | null>(null)
// 编辑态改动集（行 id → 已改）；完成时 upsert
const dirty = reactive(new Set<number>())

const meta = computed(() => PHASES.find(p => p.phase === phase.value)!)
const layout = computed(() => PHASE_LAYOUT[phase.value])
const leaves = computed(() => leavesOf(layout.value))

// ⓪ overview.summaries → YearCard
const yearCards = computed<YearCard[]>(() => {
  const ov = overview.value
  if (!ov) return []
  const byYear = new Map(ov.summaries.map(s => [s.year, s]))
  return ov.years.map(y => {
    const s = byYear.get(y)
    const has = !!s && (s.recordedMonths > 0 || s.tenantCount > 0)
    return {
      year: y,
      hasData: has,
      metric: has ? s!.recordedMonths + ' 个月' : '',
      label: has ? '本年已录入 · ' + s!.tenantCount + ' 户' : '',
    }
  })
})

const yearRange = computed(() => overview.value?.years ?? [])

// 已录月高亮:依据 summary.recordedMonths（当前年取 currentMonth 截止）
const recordedMonth = (m: number) => {
  const ov = overview.value
  if (!ov || year.value == null) return false
  if (year.value < ov.currentYear) return true
  if (year.value === ov.currentYear) return m <= ov.currentMonth
  return false
}

// ── 进入屏:overview（§6 取数前不渲染） ──────────
onMounted(async () => {
  overview.value = await s10Api.getOverview()
  month.value = overview.value.currentMonth || 1
})

// 竞态守卫:快速切月/期时只接受最新一次请求的结果(防乱序落表)
let monthSeq = 0
async function loadMonth() {
  if (year.value == null) return
  const seq = ++monthSeq
  const data = await s10Api.getMonth(phase.value, year.value, month.value)
  if (seq !== monthSeq) return
  monthData.value = data
  dirty.clear()
}
async function reloadOverview() {
  overview.value = await s10Api.getOverview()
}

// ── 状态迁移 ─────────────────────────────────────────────
async function pickYear(y: number) {
  year.value = y
  edit.value = false
  phase.value = 1
  monthData.value = null
  await loadMonth()
}
function goGate() {
  year.value = null
  edit.value = false
  monthData.value = null
}
async function switchMonth(m: number) {
  if (m === month.value) return
  month.value = m
  await loadMonth()   // 不清空 monthData:旧表保留到新数据落位,避免整屏闪烁
}
async function switchPhase(v: string) {
  const p = parseInt(v, 10)
  if (p === phase.value) return
  phase.value = p
  await loadMonth()   // 同上:不清空,避免整屏闪烁
}

// ── 编辑态:单元格 / 备注 / 名称 即时写回本地行（触发表内重算）+ 标脏 ──
function onCell(row: S10RecordDTO, colId: S10ColId, value: number) {
  ;(row as Record<string, unknown>)[colId] = value
  dirty.add(row.id)
}
function onNameEdit(row: S10RecordDTO, value: string) {
  row.tenantName = value
  dirty.add(row.id)
}
function onNoteEdit(row: S10RecordDTO, value: string) {
  row.note = value
  dirty.add(row.id)
}

// 把一行打成 upsert 请求体
function toReq(row: S10RecordDTO): S10RecordReq {
  const req: S10RecordReq = {
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    phase: phase.value,
    acctMonth: `${year.value}-${String(month.value).padStart(2, '0')}`,
    profile: row.profile,
    note: row.note,
  }
  leaves.value.forEach(l => { req[l.colId] = Number(row[l.colId]) || 0 })
  return req
}

// 完成编辑:把脏行 upsert 回后端,然后重载
async function finishEdit() {
  if (!edit.value) { edit.value = true; return }
  edit.value = false
  if (dirty.size === 0 || !monthData.value) return
  try {
    const rows = monthData.value.rows.filter(r => dirty.has(r.id))
    for (const r of rows) await s10Api.saveRecord(toReq(r))
    await loadMonth()
    await reloadOverview()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '保存失败')
  }
}

// 新增租户:POST（tenantId 空、source 后端定 manual）
async function onCreate(name: string, profile: string) {
  if (year.value == null) return
  try {
    await s10Api.saveRecord({
      tenantId: null,
      tenantName: name,
      phase: phase.value,
      acctMonth: `${year.value}-${String(month.value).padStart(2, '0')}`,
      profile,
    })
    drawer.value = false
    edit.value = true
    await loadMonth()
    await reloadOverview()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '新增租户失败')
  }
}

async function onDelete(row: S10RecordDTO) {
  try {
    await s10Api.deleteRecord(row.id)
    await loadMonth()
    await reloadOverview()
  } catch (e) {
    // seed 行 → 409
    alert((e as { message?: string })?.message ?? '删除失败')
  }
}

async function onExport() {
  if (!monthData.value) return
  try {
    await exportS10Month(monthData.value, '附表10 · 销售收入')
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导出失败')
  }
}

function onImport() {
  alert('导入 Excel 即将上线:将按本期版面列序（租户名称 + 各收款项目）导入整张表。')
}

// ── KPI（本月总收款 / 户数 / 户均 / 已修改处）— 编辑态从本地行即时算 ──
const rowTotal = (r: S10RecordDTO) => leaves.value.reduce((a, l) => a + (Number(r[l.colId]) || 0), 0)
const monthTotal = computed(() => (monthData.value?.rows ?? []).reduce((a, r) => a + rowTotal(r), 0))
const tenantCount = computed(() => monthData.value?.rows.length ?? 0)
const avg = computed(() => tenantCount.value ? monthTotal.value / tenantCount.value : 0)
const wan = (n: number) => '¥' + (n / 10000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '万'

const phaseOptions = PHASES.map(p => ({ value: String(p.phase), label: p.short }))
</script>

<template>
  <!-- §6 加载门:overview 到达前显转圈,不闪空态 -->
  <template v-if="overview">
    <!-- ⓪ 年份选择层 -->
    <SchedYearGate
      v-if="year === null"
      icon="coins"
      title="附表10 · 销售收入"
      sub="逐月、按期 / 宿舍汇总的租户总收款 · 先选择年份,再选择月份与期进入明细表"
      :years="yearCards"
      :current="overview.currentYear"
      store-key="s10"
      footer="每个年份按月 × 期维护租户收款;进入后在编辑模式下新增租户或导入。"
      @pick="pickYear"
    />

    <!-- 明细 -->
    <template v-else-if="monthData">
      <div class="s10-page">
        <SchedHeader
          icon="coins"
          title="附表10 · 销售收入"
          sub="逐月、按期 / 宿舍汇总的租户总收款 · 一行一租户,列为各收款项目 · 金额单位 元"
          :year="year"
          :edit="edit"
          @back="goGate"
          @toggle-edit="finishEdit"
        >
          <template #edit-actions>
            <span title="导入即将上线" style="display:inline-flex">
              <Button variant="outline" size="sm" @click="onImport">
                <template #leading><component :is="iconFor('upload')" :size="14" /></template>
                导入 Excel
              </Button>
            </span>
            <Button variant="outline" size="sm" @click="drawer = true">
              <template #leading><component :is="iconFor('plus')" :size="14" /></template>
              新增租户
            </Button>
          </template>
          <template #static-actions>
            <Button variant="outline" size="sm" @click="onExport">
              <template #leading><component :is="iconFor('download')" :size="14" /></template>
              导出
            </Button>
          </template>
        </SchedHeader>

        <!-- KPI 4 枚 -->
        <div class="s10-kpis">
          <KpiCard tint="blue" :label="month + ' 月总收款'" :value="wan(monthTotal)">
            <template #icon><component :is="iconFor('coins')" :size="18" /></template>
          </KpiCard>
          <KpiCard tint="slate" label="本月户数" :value="tenantCount + ' 户'">
            <template #icon><component :is="iconFor('users')" :size="18" /></template>
          </KpiCard>
          <KpiCard tint="sky" label="户均收款" :value="wan(avg)">
            <template #icon><component :is="iconFor('wallet')" :size="18" /></template>
          </KpiCard>
          <KpiCard tint="cyan" label="已修改处" :value="dirty.size + ' 处'">
            <template #icon><component :is="iconFor('pencil')" :size="18" /></template>
          </KpiCard>
        </div>

        <!-- ① 月份选择 -->
        <div class="s10-pick">
          <span class="s10-pick-lbl">月份</span>
          <SchedMonthPills :value="month" :has="recordedMonth" @change="switchMonth" />
        </div>

        <!-- ② 期选择 + 户数/修改提示 -->
        <div class="s10-toolbar">
          <Segmented :options="phaseOptions" :value="String(phase)" size="sm" @change="switchPhase" />
          <div class="s10-toolbar-r">
            <span v-if="edit" class="s10-editflag">
              <component :is="iconFor('pencil')" :size="13" />已修改 <b>{{ dirty.size }}</b> 处
            </span>
            <span v-else class="s10-count">{{ meta.name }} · 本月 <b>{{ tenantCount }}</b> 户</span>
          </div>
        </div>

        <!-- ③ 宽表 -->
        <S10Table
          :layout="layout"
          :phase-name="meta.name"
          :year="year"
          :month="month"
          :rows="monthData.rows"
          :edit="edit"
          @add="drawer = true"
          @edit="edit = true"
          @delete="onDelete"
          @cell="onCell"
          @note="onNoteEdit"
          @name="onNameEdit"
        />
      </div>

      <S10RecordDrawer
        v-if="drawer"
        :phase-name="meta.name"
        :layout="layout"
        @close="drawer = false"
        @save="onCreate"
      />
    </template>

    <!-- 切年/月/期过渡兜底转圈 -->
    <div v-else class="page-loading"><span class="page-spin" /></div>
  </template>

  <div v-else class="page-loading"><span class="page-spin" /></div>
</template>

<style scoped>
/* 1:1 from screen-schedule10.jsx S10Styles(.s10-page / .s10-kpis / .s10-pick / .s10-toolbar 段) */
.s10-page { display:flex; flex-direction:column; gap:14px; height:100%; min-height:0; box-sizing:border-box; font-family:var(--font-sans); color:var(--text-primary); }

.s10-kpis { flex:0 0 auto; display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px; }

/* 月份选择条 */
.s10-pick { flex:0 0 auto; display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:11px 16px; background:var(--surface-card); border-radius:var(--radius-lg); }
.s10-pick-lbl { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); flex:0 0 auto; white-space:nowrap; }
.s10-pick :deep(.lc-mpills) { flex:1 1 380px; min-width:0; }

/* 工具栏 — 固定高度,编辑/只读切换不改布局 */
.s10-toolbar { flex:0 0 auto; min-height:30px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.s10-toolbar-r { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.s10-count { font-size:12px; color:var(--text-muted); }
.s10-count b { color:var(--text-secondary); font-weight:var(--fw-semibold); font-family:var(--font-mono); }
.s10-editflag { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--hue-orange); background:rgb(255,243,230); padding:5px 11px; border-radius:var(--radius-full); }
.s10-editflag b { font-family:var(--font-mono); margin:0 2px; }
</style>
