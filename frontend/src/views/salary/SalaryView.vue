<script setup lang="ts">
// 附表12 工资明细 — 年度台账状态机。
// 动线 1:1 from screen-schedule12.jsx Schedule12Screen(274-516):
// ⓪ 选期矩阵(BookMonthMatrix:全年份纵排,每年一行 12 月卡)→ ① 该月宽表(SchedHeader + SalaryTable + 抽屉)。
//
// **一层门**,与月度台账、附表10 同形(2026-08-29「两本账」设计稿 §④)。演进两步:
//   一、改前进年后 onPickYear 自动落到「该年有数据的最大月」,用户没显式选过月就进了某月宽表
//      —— §7-1 明令禁止的「顺手落进某个期」。于是补了月门。
//   二、那道月门加错了:BookMonthMatrix 的设计意图是「全部年份纵排一屏」,**一层就够**,
//      我却退化成「年份门 + 单年一行」两层,连带把矩阵的「补更早年份 / 添加次年」变成死按钮
//      (只接了 @pick)。现在收回成一层,年份增删归矩阵自己管(utils/matrixYears 的手工年)。
//
// 工资**没有第二本账**(没有对内逐日口径),所以不要左栏 —— 见设计稿 §① 的两本账模型。
// 进表后的月份胶囊保留:那是**表内快速换月**,不是进表的门,两者不冲突。
//
// 代价写明:年卡上「¥48.0万 · 117 人次」的年度指标随年份门一起退场,换成「哪几个月录了」
// 一眼可见 —— 对按月录入的屏后者更有用(用户 2026-08-29 拍板)。
// 套用 DESIGN-FIDELITY §6 加载门:overview 未到显 .page-loading,不闪空态。
// 6 屏共用的台账状态机(勾选/批删/清空导入/进出年份门/报错口径)走 useSchedScreen,这里只留本屏差异。
import { ref, computed, onMounted, onDeactivated, watch } from 'vue'
import { S } from '@/utils/lockScopes'
import { salaryApi } from '@/api/salary'
import { useDeferredFlag } from '@/composables/useDeferredFlag'
import FPLoadBar from '@/components/fp/FPLoadBar.vue'
import { exportSalaryMonth } from '@/utils/salaryExcel'
import { useSchedScreen, clearConfirm } from '@/composables/useSchedScreen'
import type { SalaryOverviewDTO, SalaryYearMonthDTO, SalaryRecordDTO, SalaryRecordReq, SalaryImportRow } from '@/types/salary'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import SchedHeader from '@/components/sched/SchedHeader.vue'
import SchedMonthPills from '@/components/sched/SchedMonthPills.vue'
import BookMonthMatrix from '@/components/fp/BookMonthMatrix.vue'
import { loadExtraYears, saveExtraYears, buildYearRows } from '@/utils/matrixYears'
import FpImportModal, { type ImportRec } from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import { parserProps, runImport } from '@/utils/importRegistry'
import SalaryTable from './SalaryTable.vue'
import SalaryRecordDrawer from './SalaryRecordDrawer.vue'

// ── 本屏状态(通用部分见 useSchedScreen) ─────────────────
// null = 月份矩阵态(§7-1 明确选期门);有值 = 该月宽表
const month = ref<number | null>(null)
const overview = ref<SalaryOverviewDTO | null>(null)  // §6 加载信号
const monthData = ref<SalaryYearMonthDTO | null>(null)

// 竞态守卫:快速切月时只接受最新一次请求的结果(防乱序落表)
let monthSeq = 0
/**
 * 换期重取时的退让（加载态设计稿 §06 第一档）。旧数据留在原地不闪，
 * 但必须退一步并**停止接受交互** —— 它还是上一期的。顶边那条线是唯一的「在忙」信号。
 */
const reloading = ref(false)
/** 熬过 200ms 才亮 —— 本地后端常几十毫秒回来，闪一下比不显示更晃眼 */
const veil = useDeferredFlag(reloading)

async function loadMonth(y: number) {
  if (month.value == null) return   // 矩阵态:还没选月,没有「本月」可拉
  const seq = ++monthSeq
  reloading.value = true
  try {
    const data = await salaryApi.records(y, month.value!)
    if (seq !== monthSeq) return
    monthData.value = data
    readErr.value = null            // 只在成功时清 —— 清在开头,重试在途整段窗口门全敞开
  } catch (e) {
    // 失败**不留旧行顶着新期标**(复查坐实的最狠一条):pickMonth 换月失败时胶囊/期标/
    // 计数全是新月而行是旧月的 —— 用户进编辑批删「新月多余的人」,删的是旧月的真实记录。
    if (seq === monthSeq) {
      monthData.value = null
      readErr.value = (e as { message?: string })?.message ?? '本月工资加载失败'
    }
  } finally {
    // ⚠ 只有最新那一趟有资格熄灯(理由同催缴单)
    if (seq === monthSeq) reloading.value = false
  }
}
/** 本期取数失败的人话。 */
const readErr = ref<string | null>(null)
function retryMonth() { if (year.value != null) loadMonth(year.value) }
const overviewErr = ref('')
/** 总览。裸 await 一挂 overview 恒 null → 模板整屏转圈永不停,矩阵是唯一入口 —— 整本账不可达。 */
async function reloadOverview() {
  try { overview.value = await salaryApi.overview(); overviewErr.value = '' }
  catch { overviewErr.value = '工资总览加载失败,请重试' }
}

const {
  year, edit, drawer, importing, importResult, selectedIds, importedCount,
  guard, refresh, pickYear, toggleSelect, selectAll, onBatchDelete, onClearImported,
} = useSchedScreen({
  load: loadMonth,
  reloadOverview,
  rows: () => monthData.value?.rows ?? [],
  clearData: () => { monthData.value = null },
  // 年由 pickCell 与月一起定,这里不再动 month —— 替用户挑月的老逻辑随年份门一起退场
  onPickYear: () => {},
  batchDelete: salaryApi.batchDelete,
  clear: {
    call: y => salaryApi.clearImported(y, month.value!),
    confirm: clearConfirm('本月', '手动行不受影响。'),
  },
})

// 当前年的有数据月份(给月份胶囊淡显)
const yearMonths = computed<Set<number>>(() =>
  new Set(overview.value?.years.find(y => y.year === year.value)?.months ?? []),
)
const hasMonth = (m: number) => yearMonths.value.has(m)

const monthOptions = computed(() => (overview.value?.years ?? []).map(y => y.year))

// ── 进入屏:overview(§6 取数前不渲染) ──────────────────
onMounted(reloadOverview)

// 编辑态**就地**转假(SchedHeader 被接管/提权到期/换期 exitEdit)要关写浮层 ——
// 它们的 v-if 只判自己的 ref,留着的话失锁后「保存」「导入」照样落库(后端写口不校验锁)。
watch(edit, v => { if (!v) { drawer.value = false; importing.value = false } })
// 抽屉是 FPDrawer(Teleport to body):KeepAlive 切页签子树停用,它留在 body 上飘在别的屏顶上
onDeactivated(() => { drawer.value = false; importing.value = false })

async function pickMonth(m: number) {
  month.value = m
  selectedIds.value = new Set()
  // 不清空 monthData:旧表保留到新数据落位,避免整屏闪烁
  if (year.value != null) await loadMonth(year.value)
}
/** 矩阵点格:年与月一起定(§7-1 明确选期门,pick 自带年份)。 */
async function pickCell(y: number, m: number) {
  month.value = m
  await pickYear(y)   // 置年 + 退编辑态 + 清数据与勾选 + 拉本月(loadMonth 读上面刚置的 month)
}
/** 宽表「换期」回矩阵。 */
function backToMonths() {
  month.value = null
  edit.value = false
  monthData.value = null
}

// ── ⓪ 选期矩阵:全年份纵排(数据年 ∪ 当前年 ∪ 手工年,连续补满),每年一行 12 月卡 ──
// 手工年按「屏+册」记本机;工资无分册,册键固定 'all'。
const EXTRA_KEY = ['salary', 'all'] as const
const extraYears = ref<number[]>(loadExtraYears(...EXTRA_KEY))

interface Cell { month: number; hasData: boolean; cur?: boolean }
const matrixYears = computed(() => {
  const ov = overview.value
  if (!ov) return []
  const cur = new Date().getFullYear()
  const hasByYear = new Map(ov.years.map(y => [y.year, new Set(y.months)]))
  const dataYears = ov.years.filter(y => y.hasData).map(y => y.year)
  const out = buildYearRows(dataYears, cur, extraYears.value).map(r => {
    const has = hasByYear.get(r.year) ?? new Set<number>()
    // 人数按月拆分 overview 里没有,徽标留空 —— 编不出来的数字不如不显
    const months: Cell[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, hasData: has.has(i + 1) }))
    return {
      year: r.year,
      months,
      // 当前年优先:当前自然年无数据时 manual 也为真,不得标成「手工年」(它不可移除、非手工添加)
      sub: r.year === cur ? '当前年' : r.manual ? '手工年' : undefined,
      removable: r.manual && extraYears.value.includes(r.year) && months.every(m => !m.hasData),
    }
  })
  // 全年份范围内最近有数据的那一个月描边
  for (let i = out.length - 1; i >= 0; i--) {
    const j = out[i].months.map(m => m.hasData).lastIndexOf(true)
    if (j >= 0) { out[i].months[j].cur = true; break }
  }
  return out
})
function setExtra(years: number[]) {
  saveExtraYears(...EXTRA_KEY, years)
  extraYears.value = loadExtraYears(...EXTRA_KEY)   // 回读取归一化(去重排序)
}
const edge = (first: boolean) => {
  const r = matrixYears.value
  if (!r.length) return new Date().getFullYear()
  return first ? r[0].year - 1 : r[r.length - 1].year + 1
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
  if (!edit.value) return   // 写口自守(同 onCreate)
  if (year.value == null) return
  // 矩阵态导入不了(导入按钮在宽表的编辑态里),month 到这里必非空
  const ctx = { year: year.value, month: month.value ?? undefined }
  await guard('导入失败', async () => {
    importResult.value = await runImport('salary', picks, ctx, fileName)
    const first = picks[0]
    if (first) { year.value = first.year ?? year.value; month.value = first.month ?? month.value }
    selectedIds.value = new Set()   // 跳期清勾选(同 onCreate)
    await refresh()
  })
}

const onCreate = async (req: SalaryRecordReq) => {
  if (!edit.value) return   // 写口自守:editMode 会就地转假,浮层可能还挂着
  // ⚠ 写与刷新分开兜:包在同一个 catch 里时,create 已成功、refresh 失败会 alert
  //   「新增工资失败」且表里看不到新行 —— 写成功被谎报为写失败,用户会重录出重复行。
  try { await salaryApi.create(req) }
  catch (e) { alert((e as { message?: string })?.message ?? '新增工资失败'); return }
  drawer.value = false
  // 提交后归入对应年月(可能与当前选中不同);跳期必须清勾选 —— 残留的 id 会喂给
  // 「删除选中」批删另一个月的行
  const [y, m] = req.acctMonth.split('-')
  year.value = parseInt(y, 10)
  month.value = parseInt(m, 10)
  selectedIds.value = new Set()
  try { await refresh() }
  catch { alert('已保存成功,但刷新失败 —— 表内暂时看不到新行,点失败条上的「重试」即可。') }
}

const onDelete = (row: SalaryRecordDTO) => guard('删除失败', async () => {
  if (!edit.value) return
  await salaryApi.remove(row.id)
  await refresh()
})

const onNote = (row: SalaryRecordDTO, text: string) => guard('保存备注失败', async () => {
  if (!edit.value) return
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
    <!-- ⓪ 选期矩阵(§7-1 明确选期门):全年份纵排一屏,点月格才进宽表。
         没有上一层了 —— 所以没有返回键(年份增删归矩阵自己的两个按钮管)。 -->
    <div v-if="month === null" class="s12-gate">
      <div class="s12-gate-head">
        <div>
          <h2 class="s12-gate-title">
            <span class="ic"><component :is="iconFor('wallet')" :size="18" /></span>附表12 · 工资明细
          </h2>
          <p class="s12-gate-sub">选择月份进入该月宽表 · 空月可直接进入录入 / 导入</p>
        </div>
      </div>
      <BookMonthMatrix
        :scope-of="(y, m) => S.salary(y, m)"
        :book="{}"
        :years="matrixYears"
        @pick="pickCell"
        @add-earlier="setExtra([...extraYears, edge(true)])"
        @add-later="setExtra([...extraYears, edge(false)])"
        @remove-year="(y) => setExtra(extraYears.filter(x => x !== y))"
      />
    </div>

    <!-- ① 该月宽表。这一支里 year 与 month 必然非空 —— pickCell 把两者一起置,
         矩阵态由上面的 v-if 接走,所以下面的 `!` 不是图省事。 -->
    <template v-else-if="monthData">
      <div class="s12-page">
        <FPLoadBar :on="veil" />
        <SchedHeader
          :scope="S.salary(year!, month!)"
          icon="wallet"
          title="附表12 · 工资明细"
          sub="逐月人员工资 · 月工资 / 补贴 / 招商提成 / 考勤 / 代缴代扣 · 金额单位 元"
          :year="year!"
          :edit="edit"
          perm="entry:edit"
          @back="backToMonths"
          @toggle-edit="edit = !edit"
         :show-import="true" @import="importing = true">
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
            <SchedMonthPills
              :scope-of="(m) => (year == null ? null : S.salary(year, m))" :value="month!" :has="hasMonth" @change="pickMonth" />
          </div>
          <div class="s12-toolbar-r">
            <span class="s12-count">{{ year }}年{{ month }}月 <b>{{ monthData.rows.length }}</b> 人</span>
          </div>
        </div>

        <!-- fp-stale 带 pointer-events:none —— 换期在途旧行不许被点、被删(同族 6 屏都有,本屏漏) -->
        <SalaryTable
          :class="{ 'fp-stale': veil }"
          :aria-busy="veil"
          :year="year!"
          :month="month!"
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
        :init-year="year!"
        :init-month="month!"
        :years="monthOptions"
        @close="drawer = false"
        @save="onCreate"
      />

      <FpImportModal
        v-if="importing"
        :title="'导入 附表12 · 工资明细'"
        sub="上传/粘贴整张多月工资表,系统按标题行自动拆月、按姓名识别行,核对年/月后逐月导入"
        v-bind="parserProps('salary')"
        :default-year="year!"
        :default-month="month!"
        @close="importing = false"
        @import-sections="onImportSections"
      />
    </template>

    <!-- 取数失败:说出来 + 重试 + 回矩阵的口。改前失败落进下面的转圈 —— 永久转、无重试、
         无返回口,用户被锁死(pickCell 先 clearData,monthData 恒 null) -->
    <div v-else-if="readErr" class="s12-fail">
      <component :is="iconFor('alert-triangle')" :size="18" />
      <span>{{ year }}年{{ month }}月工资加载失败:{{ readErr }}</span>
      <Button variant="outline" size="sm" @click="retryMonth">重试</Button>
      <Button variant="ghost" size="sm" @click="backToMonths">返回选月</Button>
    </div>

    <!-- 切年/切月过渡兜底转圈 -->
    <div v-else class="page-loading"><span class="page-spin" /></div>

    <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />
  </template>

  <!-- overview 一次都没拿到:硬失败面 —— 矩阵是唯一入口,转圈死等 = 整本账不可达 -->
  <div v-else-if="overviewErr" class="s12-fail">
    <component :is="iconFor('alert-triangle')" :size="18" />
    <span>{{ overviewErr }}</span>
    <Button variant="outline" size="sm" @click="reloadOverview">重试</Button>
  </div>

  <div v-else class="page-loading"><span class="page-spin" /></div>
</template>

<style scoped>
/* 1:1 from screen-schedule12.jsx WStyles(.w12-page / .w12-toolbar 段) */
.s12-fail {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  height: 100%; color: var(--hue-red); font-size: 13px;
}
.s12-page { position:relative; display:flex; flex-direction:column; gap:14px; height:100%; min-height:0; box-sizing:border-box; }
.s12-toolbar { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.s12-toolbar-l { display:flex; align-items:center; gap:12px; flex-wrap:wrap; min-width:0; flex:1 1 auto; }
.s12-toolbar-r { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.s12-count { font-size:12px; color:var(--text-muted); }
.s12-count b { color:var(--text-secondary); font-weight:var(--fw-semibold); font-family:var(--font-mono); }

/* ── ① 月份矩阵态(2026-08-29 补的月门,设计稿 §3.4) ── */
.s12-gate { display: flex; flex-direction: column; gap: var(--space-4); width: 100%; height: 100%;
            min-height: 0; overflow-y: auto; box-sizing: border-box; }
.s12-gate-head { flex: 0 0 auto; display: flex; align-items: center; gap: var(--space-2); }
.s12-gate-title { margin: 0; font: var(--type-h2); display: flex; align-items: center; gap: var(--space-2); }
.s12-gate-title .ic {
  width: 26px; height: 26px; border-radius: var(--radius-sm);
  background: var(--accent-blue); color: var(--hue-blue); display: grid; place-items: center; flex: none;
}
.s12-gate-sub { margin: 4px 0 0; font-size: var(--fs-label); color: var(--text-muted); }
</style>
