<script setup lang="ts">
// 分栋抄表明细(PV-METER-SPEC §2)— 与附表6 月度汇总并列的新屏,由 PvView 功能门进入。
// 一行一电站(13 站种子),月度量=该站该月记录求和;点行开抽屉逐条增删改;
// 容量/单价行内乐观更新(BillsView setPayCo 模式:即时更新,失败回滚 alert);
// 收益口径=self_use × price_snap(录入时快照,调站价不漂移历史)。viewer 全只读。
// 编辑模式遵 EDIT-MODE-SPEC v2:浏览态完全只读——常量(容量/单价)行内改、电站增删、导入、抽屉抄表记录增删改全部收编辑态。
// 布局遵 LIST-PAGE-SPEC 列宽铁律(定宽列+唯一弹性列,fixed 布局);
// ponytail: 13 站固定量级,不上 useFitRows/FPPager 分页机(短窗时卡片内滚动兜底),站数破 30 再上。
import { ref, computed, onMounted, onDeactivated, watch } from 'vue'
import { pvMeterApi, type PvStationDTO } from '@/api/pvMeter'
import type { ImportResultDTO } from '@/types/import'
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { useAuthStore } from '@/stores/auth'
import FPElevateDialog from '@/components/fp/FPElevateDialog.vue'
import FPToast from '@/components/fp/FPToast.vue'
import { useEditMode } from '@/composables/useEditMode'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Card from '@/components/ds/Card.vue'
import Select from '@/components/ds/Select.vue'
import Input from '@/components/ds/Input.vue'
import FPPhaseTabs from '@/components/fp/FPPhaseTabs.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import { parserProps, runImport, type ImportCtx } from '@/utils/importRegistry'
// Wave2-B 并行契约:registry key 'pvMeter' + 模板/月度导出(buildPvMeterTemplate/exportPvMeterMonth)
import { buildPvMeterTemplate, exportPvMeterMonth } from '@/utils/pvMeterExcel'
import { buildYearOptions } from '@/utils/yearGate'
import { latestPeriodOf } from '@/utils/defaultPeriod'

const emit = defineEmits<{ back: [] }>()
const auth = useAuthStore()

// ── 编辑模式(EDIT-MODE-SPEC):不跨会话,组件 ref;KeepAlive 切页签回来也回浏览态(安全默认) ──
// 编辑模式 + 提权入口(EDIT-MODE-SPEC v3 / ELEVATION-SPEC):无权限的账号也看得到按钮,
// 点了弹主管授权窗;切页签不再回浏览态(只关浮层)。
const { editMode, canEnter, asking, toggle: toggleEdit, cancelAsk, onElevated } =
  useEditMode(['meter-master:edit', 'meter-reading:edit'])
// RBAC v2:电站档案(名称/容量/单价/增删)= meter-master:edit;抄表记录与导入 = meter-reading:edit。
// 模拟填充也判 master —— 它对缺单价的电站反写 price_yuan(RBAC-SPEC §5.3-⑤),是电站单价的写旁路。
const canMaster = computed(() => auth.can('meter-master:edit'))
const canReading = computed(() => auth.can('meter-reading:edit'))
const editStation = computed(() => editMode.value && canMaster.value)
const editReading = computed(() => editMode.value && canReading.value)
onDeactivated(() => { stationDlg.value = false; importing.value = false })   // 弹窗一并复位,防浏览态残留写入口(同 ElecCostView)

const pad2 = (n: number) => String(n).padStart(2, '0')
const num = (s: string) => { const n = Number(s); return isFinite(n) ? n : 0 }
// 电量 kWh / 金额 元 展示格式
const fq = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const fy = (n: number) => '¥' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── 期间(spec §2:月份 1-12 全开,无数据月显示零值不置灰) ──
const today = new Date()
const year = ref(today.getFullYear())
const month = ref(today.getMonth() + 1)
// 年份数据驱动(P0 审计):选项 = 有记录年份 ∪ 当前年,升序;
// 初值 = 最后一个有抄表记录的账期(§4:年月一起 snap;全系统无记录才留当年当月)
const dataYears = ref<number[]>([])
const yearOpts = computed(() =>
  buildYearOptions(dataYears.value, today).map(y => ({ value: String(y), label: `${y}年` })),
)
const monthOpts = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` }))
const monthLast = computed(() => `${year.value}-${pad2(month.value)}-${pad2(new Date(year.value, month.value, 0).getDate())}`)
const monthFirst = computed(() => `${year.value}-${pad2(month.value)}-01`)

// ── 数据 ──
const stations = ref<PvStationDTO[] | null>(null)
const readings = ref<Awaited<ReturnType<typeof pvMeterApi.readings>> | null>(null)

async function loadStations() { stations.value = await pvMeterApi.stations() }
// 竞态守卫同 BillsView loadRows:切期保留旧数据到新数据落位,不闪 gate
let seq = 0
async function loadReadings() {
  const my = ++seq
  const data = await pvMeterApi.readings(year.value, month.value)
  if (my === seq) readings.value = data
}
onMounted(async () => {
  loadStations()
  // 先拉数据年份定位初始账期:§4 要求 year 与 month 一起 snap 到最后一个有抄表记录的账期
  // (原来只 snap year、month 留系统当月,拼出的账期一条记录都没有,进来是空表)。
  // 改了年月会经 watch 触发 loadReadings,未改则本函数兜底首载。
  try {
    // years 供年下拉、months 定默认账期,互不依赖 → 并发,一个往返拿齐
    const [ys, months] = await Promise.all([pvMeterApi.years(), pvMeterApi.months()])
    dataYears.value = ys
    const p = latestPeriodOf(months)
    if (p && (p.year !== year.value || p.month !== month.value)) {
      year.value = p.year; month.value = p.month; return
    }
  } catch { /* years 拉取失败不阻断:保持当前年,选项由 ∪ 当前年兜底 */ }
  loadReadings()
})
watch([year, month], loadReadings)

// ── 期数 tabs(FPPhaseTabs tabs prop 自定义:无宿舍档) ──
const PV_TABS = [
  { k: 'all', label: '全部' },
  { k: 1, label: '一期' },
  { k: 2, label: '二期' },
  { k: 3, label: '三期' },
]
const PHASE_LABEL: Record<number, string> = { 1: '一期', 2: '二期', 3: '三期' }
const phase = ref<string | number>('all')
const tabCounts = computed(() => {
  const c: Record<string, number> = { all: stations.value?.length ?? 0, 1: 0, 2: 0, 3: 0 }
  for (const s of stations.value ?? []) c[s.phase] = (c[s.phase] ?? 0) + 1
  return c
})

// ── 主表聚合:月度量=该站该月记录求和(收益已按 price_snap 派生在行内,Σ 即月消纳收益) ──
interface StationAgg { gen: number; self: number; grid: number; revenue: number; count: number }
const aggByStation = computed(() => {
  const m = new Map<number, StationAgg>()
  for (const r of readings.value ?? []) {
    const a = m.get(r.stationId) ?? { gen: 0, self: 0, grid: 0, revenue: 0, count: 0 }
    a.gen += r.genTotal; a.self += r.selfUse; a.grid += r.gridFeed; a.revenue += r.revenue; a.count += 1
    m.set(r.stationId, a)
  }
  return m
})
const rows = computed(() =>
  (stations.value ?? [])
    .filter(s => phase.value === 'all' || s.phase === Number(phase.value))
    .map(s => ({ st: s, ...(aggByStation.value.get(s.id) ?? { gen: 0, self: 0, grid: 0, revenue: 0, count: 0 }) })),
)

// ── 行内编辑容量/单价(乐观更新:即时改本地,失败回滚 alert;PUT 带全量) ──
function commitStation(st: PvStationDTO, field: 'capacityKwp' | 'priceYuan', raw: string) {
  const v = raw.trim() === '' ? null : Number(raw)
  if (v != null && (!isFinite(v) || v < 0)) { alert('请输入非负数字'); return }
  if (v === st[field]) return
  const prev = st[field]
  st[field] = v
  pvMeterApi.updateStation(st.id, { name: st.name, phase: st.phase, capacityKwp: st.capacityKwp, priceYuan: st.priceYuan })
    .then(() => {
      // 错价修正回路(P0-3):改价只影响之后新录,提示历史修正路径(导出「明细」sheet 改后重导即按新价重新快照)
      // 这条不是「已保存」而是一段**操作指引**(历史记录怎么修),用户可能要照着做 ——
      // 所以 duration=0 不自动消失,由他读完自己关。
      if (field === 'priceYuan') okMsg.value = '已保存。历史抄表记录仍按录入时单价计收益；如需按新价修正本月，请导出明细修改后重导，或删除记录重录。'
    })
    .catch((e) => {
      st[field] = prev
      alert((e as { message?: string })?.message ?? '保存失败，请重试')
    })
}

// ── 行内编辑电站名(P0-2 接线;1:1 照 CpMeterView.commitStation:空名拦截/重名 409 文案直达/失败回滚) ──
function commitStationName(st: PvStationDTO, raw: string) {
  const v = raw.trim()
  if (!v) { alert('电站名称不能为空'); return }
  if (v === st.name) return
  const prev = st.name
  st.name = v
  pvMeterApi.updateStation(st.id, { name: st.name, phase: st.phase, capacityKwp: st.capacityKwp, priceYuan: st.priceYuan })
    .catch((e) => {
      st.name = prev
      alert((e as { message?: string })?.message ?? '保存失败，请重试')   // 重名 409 中文文案直达
    })
}

// ── 抽屉:该站该月记录行式增删改 ──
const openSt = ref<PvStationDTO | null>(null)
const drawerRows = computed(() =>
  (readings.value ?? []).filter(r => r.stationId === openSt.value?.id)
    .slice().sort((a, b) => a.readDate.localeCompare(b.readDate)),
)
const drawerSub = computed(() => {
  const rev = drawerRows.value.reduce((s, r) => s + r.revenue, 0)
  return `${year.value}年${month.value}月 · ${drawerRows.value.length} 条抄表记录 · 本月消纳收益 ${fy(rev)}`
})

const editId = ref<number | null>(null)     // 非空=行编辑中
const adding = ref(false)                   // 新增行展开
const form = ref({ readDate: '', genTotal: '', selfUse: '', gridFeed: '', note: '' })
// 操作列仅编辑态存在(EDIT-MODE-SPEC v2)
const opCols = computed(() => (editReading.value ? 7 : 6))
// 自消纳+上网 > 发电总量 → 黄警示不阻断(spec §1:抄表现实有损耗差)
const formWarn = computed(() =>
  num(form.value.selfUse) + num(form.value.gridFeed) > num(form.value.genTotal)
    ? '自消纳 + 上网 大于发电总量(可能为损耗差或录入误差),仍可保存'
    : '',
)

function startAdd() {
  editId.value = null; adding.value = true
  // 默认日期:当前月=今天(日抄顺手);历史月=月末(月抄建议月末)
  const isCur = year.value === today.getFullYear() && month.value === today.getMonth() + 1
  const d = isCur ? `${year.value}-${pad2(month.value)}-${pad2(today.getDate())}` : monthLast.value
  form.value = { readDate: d, genTotal: '', selfUse: '', gridFeed: '', note: '' }
}
function startEdit(r: (typeof drawerRows.value)[number]) {
  adding.value = false; editId.value = r.id
  form.value = { readDate: r.readDate, genTotal: String(r.genTotal), selfUse: String(r.selfUse), gridFeed: String(r.gridFeed), note: r.note ?? '' }
}
function cancelForm() { editId.value = null; adding.value = false }
watch(openSt, cancelForm)   // 换站/关抽屉时收起编辑行
watch(editMode, v => { if (!v) cancelForm() })   // 退出编辑模式收起编辑行(v2:浏览态零写入口,含残留输入行)

async function saveForm() {
  if (!openSt.value) return
  if (!form.value.readDate) { alert('请选择抄表日期'); return }
  const g = num(form.value.genTotal), s = num(form.value.selfUse), f = num(form.value.gridFeed)
  if (g < 0 || s < 0 || f < 0) { alert('电量不能为负'); return }
  const req = { stationId: openSt.value.id, readDate: form.value.readDate, genTotal: g, selfUse: s, gridFeed: f, note: form.value.note.trim() || null }
  try {
    // 新录快照当时站单价;编辑改量不改快照(后端语义,IT 锁死)
    if (editId.value != null) await pvMeterApi.updateReading(editId.value, req)
    else await pvMeterApi.createReading(req)
    cancelForm()
    await loadReadings()
  } catch (e) {
    // 同站同日 409 等 → 后端中文 message 直达
    alert((e as { message?: string })?.message ?? '保存失败')
  }
}

async function delRow(id: number, date: string) {
  if (!confirm(`确认删除 ${date} 的抄表记录?`)) return
  try { await pvMeterApi.deleteReading(id); await loadReadings() }
  catch (e) { alert((e as { message?: string })?.message ?? '删除失败') }
}

async function delStation() {
  const st = openSt.value
  if (!st) return
  if (!confirm(`确认删除电站「${st.name}」?有抄表记录的电站不可删除。`)) return
  try { await pvMeterApi.deleteStation(st.id); openSt.value = null; await loadStations() }
  catch (e) { alert((e as { message?: string })?.message ?? '删除失败') }   // 有记录 409 → 中文守卫文案
}

// ── 新增电站弹窗(名称/期数/容量/单价) ──
const stationDlg = ref(false)
const stForm = ref({ name: '', phase: '1', capacity: '', price: '' })
const stErr = ref('')
const ST_PHASE_OPTS = [{ value: '1', label: '一期' }, { value: '2', label: '二期' }, { value: '3', label: '三期' }]
function openStationDlg() {
  stForm.value = { name: '', phase: '1', capacity: '', price: '' }
  stErr.value = ''
  stationDlg.value = true
}
async function submitStation() {
  const name = stForm.value.name.trim()
  if (!name) { stErr.value = '请输入电站(楼栋)名称'; return }
  const cap = stForm.value.capacity.trim() === '' ? null : Number(stForm.value.capacity)
  const price = stForm.value.price.trim() === '' ? null : Number(stForm.value.price)
  if ((cap != null && (!isFinite(cap) || cap < 0)) || (price != null && (!isFinite(price) || price < 0))) {
    stErr.value = '容量 / 单价需为非负数字'; return
  }
  try {
    await pvMeterApi.createStation({ name, phase: +stForm.value.phase, capacityKwp: cap, priceYuan: price })
    stationDlg.value = false
    await loadStations()
  } catch (e) {
    stErr.value = (e as { message?: string })?.message ?? '新增电站失败'   // 重名 409 中文文案
  }
}

// ── 导入(registry 闭环:解析→预览→确认→入库→import_log)/模板/导出 ──
const importing = ref(false)
const okMsg = ref('')
const importResult = ref<ImportResultDTO | null>(null)
// charging/pvMeter 模式:解析期行级错误暂存 ctx._parseErrors,run 时并入结果——
// parserProps 与 runImport 必须同一 ctx 引用;每次解析整体覆写,无陈旧残留
const importCtx: ImportCtx = {}
async function onImport(payload: ImportRec[] | { label?: string; records: ImportRec[] }[], fileName: string) {
  importing.value = false
  try {
    importResult.value = await runImport('pvMeter', payload as never, importCtx, fileName)
    await loadReadings()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
}

// ── 模拟填充(编辑态;照 CpMeterView:confirm→POST→alert→重载):按附表6 phase 月度汇总推导当前年分栋抄表记录 ──
const simulating = ref(false)
async function onSimulate() {
  if (simulating.value) return
  if (!confirm(`模拟填充 ${year.value} 全年：按附表6 各期月度汇总反推电站容量/单价(空位才填,年等效 950h、站内容量比例均为假设)，并按容量占比拆分各栋月末抄表记录(发电=消纳×1.03 损耗假设)。\n\n只填空位与既有「模拟」灰标记录，绝不覆盖手工录入/导入的数据。确认执行？`)) return
  simulating.value = true
  try {
    const r = await pvMeterApi.simulate(year.value)
    alert(`模拟完成：填充 ${r.filled} 条，跳过 ${r.skipped} 条（手工/导入占位、值未变或缺站）。`)
    await Promise.all([loadStations(), loadReadings()])
    dataYears.value = await pvMeterApi.years()   // 新写入年份进选项(数据驱动)
  } catch (e) {
    alert((e as { message?: string })?.message ?? '模拟填充失败')
  } finally {
    simulating.value = false
  }
}

const exporting = ref(false)
async function onExport() {
  if (exporting.value) return
  exporting.value = true
  try { await exportPvMeterMonth(readings.value ?? [], stations.value ?? [], year.value, month.value) }
  catch (e) { alert((e as { message?: string })?.message ?? '导出失败') }
  finally { exporting.value = false }
}
async function onTemplate() {
  try { await buildPvMeterTemplate() }
  catch (e) { alert((e as { message?: string })?.message ?? '模板下载失败') }
}
</script>

<template>
  <!-- 首载 gate:站/记录未落位不闪空表 -->
  <div v-if="!stations || !readings" class="page-loading"><span class="page-spin" /></div>

  <div v-else class="pm-page">
    <!-- 标题行 -->
    <div class="pm-head">
      <div class="pm-headl">
        <button class="pm-back" title="返回功能选择" @click="emit('back')">
          <component :is="iconFor('arrow-left')" :size="16" />
        </button>
        <div>
          <h2 class="pm-title"><span class="ic"><component :is="iconFor('gauge')" :size="18" /></span>分栋抄表明细</h2>
          <p class="pm-sub">按日期逐条抄表,自动汇月 · 电量 kWh / 收益 元 · 收益 = 自消纳 × 录入时单价快照</p>
        </div>
      </div>
      <!-- 电站增删=配置操作,仅编辑态(EDIT-MODE-SPEC)+ meter-master:edit -->
      <Button v-if="editStation" variant="outline" size="sm" @click="openStationDlg">
        <template #leading><component :is="iconFor('plus')" :size="14" /></template>
        新增电站
      </Button>
    </div>

    <!-- 工具栏:期数 tabs + 年月选择 + 模板/导入/导出 -->
    <div class="mx-toolbar">
      <FPPhaseTabs v-model="phase" :tabs="PV_TABS" :counts="tabCounts" />
      <div class="mx-toolbar-right">
        <div style="width:110px">
          <Select :options="yearOpts" :model-value="String(year)" size="sm" @update:model-value="year = +$event" />
        </div>
        <div style="width:92px">
          <Select :options="monthOpts" :model-value="String(month)" size="sm" @update:model-value="month = +$event" />
        </div>
        <Button variant="outline" size="sm" @click="onTemplate">
          <template #leading><component :is="iconFor('file-spreadsheet')" :size="14" /></template>
          下载模板
        </Button>
        <!-- 导入入口收编辑态(EDIT-MODE-SPEC);模板/导出=只读操作常驻 -->
        <Button v-if="editReading" variant="outline" size="sm" @click="importing = true">
          <template #leading><component :is="iconFor('upload')" :size="14" /></template>
          导入
        </Button>
        <!-- 模拟填充会反写电站单价(§5.3-⑤)→ 判 meter-master,不是 meter-reading -->
        <Button v-if="editStation" variant="outline" size="sm" :disabled="simulating" @click="onSimulate">
          <template #leading><component :is="iconFor('wand-2')" :size="14" /></template>
          模拟填充
        </Button>
        <Button variant="filled" size="sm" :disabled="exporting" @click="onExport">
          <template #leading><component :is="iconFor('download')" :size="14" /></template>
          导出
        </Button>
        <!-- 编辑模式:档案/读数两把权限任一有即可进,进去后各按钮再各判各的 -->
        <Button v-if="canEnter" :variant="editMode ? 'filled' : 'outline'" size="sm" @click="toggleEdit()">
          <template #leading><component :is="iconFor(editMode ? 'check' : 'pencil')" :size="14" /></template>
          {{ editMode ? '完成' : '编辑模式' }}
        </Button>
      </div>
    </div>

    <!-- 空态引导(spec §2:去导入或抽屉手录) -->
    <div v-if="readings.length === 0" class="pm-empty">
      <component :is="iconFor('info')" :size="14" />
      <span>
        {{ year }}年{{ month }}月暂无抄表记录 ——
        <template v-if="editReading">可<button class="pm-link" @click="importing = true">导入</button>整月抄表 Excel,或点击任意电站行进入抽屉手动录入。</template>
        <template v-else-if="canReading">进入右上角「编辑模式」后可录入或导入。</template>
        <template v-else>各站显示零值。</template>
      </span>
    </div>

    <!-- 主表:一行一电站;列宽铁律(fixed 布局,电站名=唯一弹性列) -->
    <Card surface="white" :padding="0" class="pm-card">
      <div class="pm-tablewrap">
        <table class="pm-table">
          <colgroup>
            <col /><!-- 电站名:唯一弹性列吸收余宽 -->
            <col style="width:110px" />
            <col style="width:120px" />
            <col style="width:120px" />
            <col style="width:120px" />
            <col style="width:120px" />
            <col style="width:120px" />
            <col style="width:84px" />
          </colgroup>
          <thead>
            <tr>
              <th>电站(楼栋)</th>
              <th class="num">装机容量 kWp</th>
              <th class="num">单价 元/kWh</th>
              <th class="num">本月发电总量</th>
              <th class="num">自消纳</th>
              <th class="num">上网</th>
              <th class="num">消纳收益</th>
              <th class="num">抄表条数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.st.id" @click="openSt = r.st">
              <!-- 电站名=站点常量:编辑模式行内改(点击不冒泡开抽屉),浏览态纯文本(EDIT-MODE-SPEC) -->
              <td class="name" :title="r.st.name">
                <input v-if="editStation" class="pm-edit l" type="text"
                       :value="r.st.name" title="电站名,回车/失焦保存(需唯一)"
                       @click.stop
                       @change="commitStationName(r.st, ($event.target as HTMLInputElement).value)" />
                <template v-else>
                  <span class="nm">{{ r.st.name }}</span>
                  <span v-if="phase === 'all'" class="pm-badge">{{ PHASE_LABEL[r.st.phase] }}</span>
                </template>
              </td>
              <!-- 容量/单价=站点常量:编辑模式行内改(点击不冒泡开抽屉),浏览态纯文本(EDIT-MODE-SPEC) -->
              <td class="num">
                <input v-if="editStation" class="pm-edit" type="number" min="0" step="0.01"
                       :value="r.st.capacityKwp ?? ''" placeholder="—" title="装机容量,回车/失焦保存"
                       @click.stop
                       @change="commitStation(r.st, 'capacityKwp', ($event.target as HTMLInputElement).value)" />
                <span v-else>{{ r.st.capacityKwp != null ? fq(r.st.capacityKwp) : '—' }}</span>
              </td>
              <td class="num">
                <input v-if="editStation" class="pm-edit" type="number" min="0" step="0.0001"
                       :value="r.st.priceYuan ?? ''" placeholder="—" title="消纳综合单价,只影响之后新录记录"
                       @click.stop
                       @change="commitStation(r.st, 'priceYuan', ($event.target as HTMLInputElement).value)" />
                <span v-else>{{ r.st.priceYuan != null ? r.st.priceYuan : '—' }}</span>
              </td>
              <td class="num" :class="{ zero: r.gen === 0 }">{{ fq(r.gen) }}</td>
              <td class="num" :class="{ zero: r.self === 0 }">{{ fq(r.self) }}</td>
              <td class="num" :class="{ zero: r.grid === 0 }">{{ fq(r.grid) }}</td>
              <td class="num rev" :class="{ zero: r.revenue === 0 }">{{ fy(r.revenue) }}</td>
              <td class="num" :class="{ zero: r.count === 0 }">{{ r.count }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>

    <!-- 抽屉:该站该月逐条抄表记录;增删改仅编辑态(EDIT-MODE-SPEC v2),浏览态=纯查看列表 -->
    <FPDrawer
      :open="!!openSt"
      :title="openSt?.name ?? ''"
      :subtitle="drawerSub"
      icon="gauge"
      :width="760"
      :fixedHeight="true"
      @close="openSt = null"
    >
      <div v-if="drawerRows.length === 0 && !adding" class="pm-dempty">
        该站本月暂无抄表记录{{ editReading ? ',点下方「新增记录」手动录入,或在列表页「导入」整月 Excel。' : canReading ? ',进入编辑模式后可录入或导入。' : '。' }}
      </div>
      <div v-else class="pm-dwrap">
        <table class="pm-dtable">
          <!-- 列宽预算(抽屉内容宽~672):日期96+三量106×3+收益108=522,备注弹性≥80;数字 12px mono「47,366.13」量级不截断 -->
          <colgroup>
            <col style="width:96px" />
            <col style="width:106px" />
            <col style="width:106px" />
            <col style="width:106px" />
            <col style="width:108px" />
            <col /><!-- 备注:唯一弹性列(截断走 title) -->
            <col v-if="editReading" style="width:70px" />
          </colgroup>
          <thead>
            <tr>
              <th class="l">日期</th>
              <th>发电总量</th>
              <th>自消纳</th>
              <th>上网</th>
              <th>收益</th>
              <th class="l">备注</th>
              <th v-if="editReading"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in drawerRows" :key="r.id">
              <!-- 行编辑态:日期+三量+备注可改;收益按原快照价预览(改量不改快照) -->
              <tr v-if="editId === r.id" class="editing">
                <td class="l"><input v-model="form.readDate" class="pm-din" type="date" :min="monthFirst" :max="monthLast" /></td>
                <td><input v-model="form.genTotal" class="pm-din num" type="number" min="0" step="0.01" /></td>
                <td><input v-model="form.selfUse" class="pm-din num" type="number" min="0" step="0.01" /></td>
                <td><input v-model="form.gridFeed" class="pm-din num" type="number" min="0" step="0.01" /></td>
                <td class="ro" :title="`按原快照单价 ${r.priceSnap ?? '—'} 计`">{{ fy(num(form.selfUse) * (r.priceSnap ?? 0)) }}</td>
                <td class="l"><input v-model="form.note" class="pm-din" type="text" placeholder="备注" /></td>
                <td class="ops">
                  <button class="pm-iop ok" title="保存" @click="saveForm"><component :is="iconFor('check')" :size="15" /></button>
                  <button class="pm-iop" title="取消" @click="cancelForm"><component :is="iconFor('x')" :size="15" /></button>
                </td>
              </tr>
              <tr v-else>
                <td class="l mono">{{ r.readDate }}</td>
                <td>{{ fq(r.genTotal) }}</td>
                <td>{{ fq(r.selfUse) }}</td>
                <td>{{ fq(r.gridFeed) }}</td>
                <td :title="r.priceSnap != null ? `快照单价 ${r.priceSnap} 元/kWh` : '录入时站未配单价,收益按 0'">{{ fy(r.revenue) }}</td>
                <!-- simulated 灰「模拟」徽标随备注列(徽标挤日期列会撑爆列宽预算;模拟记录 note 本就以「模拟:」开头,同列语义顺),录改后转 manual 自动消失 -->
                <td class="l note" :title="r.note ?? undefined"><span v-if="r.source === 'simulated'" class="pm-sim" :title="r.note ?? '模拟数据'">模拟</span>{{ (r.source === 'simulated' ? (r.note ?? '').replace(/^模拟[:：]/, '') : r.note) || '—' }}</td>
                <td v-if="editReading" class="ops">
                  <button class="pm-iop" title="编辑" @click="startEdit(r)"><component :is="iconFor('pencil')" :size="14" /></button>
                  <button class="pm-iop danger" title="删除" @click="delRow(r.id, r.readDate)"><component :is="iconFor('trash-2')" :size="14" /></button>
                </td>
              </tr>
              <!-- 警示位常驻(LAYOUT-STABILITY-SPEC §4.2):编辑态一进来就占好这一行,内容才是条件的 -->
              <tr v-if="editId === r.id" class="warnrow">
                <td :colspan="opCols" class="l"><template v-if="formWarn">{{ formWarn }}</template></td>
              </tr>
            </template>
            <!-- 新增行:新录将快照当前站单价 -->
            <template v-if="adding">
              <tr class="editing">
                <td class="l"><input v-model="form.readDate" class="pm-din" type="date" :min="monthFirst" :max="monthLast" /></td>
                <td><input v-model="form.genTotal" class="pm-din num" type="number" min="0" step="0.01" /></td>
                <td><input v-model="form.selfUse" class="pm-din num" type="number" min="0" step="0.01" /></td>
                <td><input v-model="form.gridFeed" class="pm-din num" type="number" min="0" step="0.01" /></td>
                <td class="ro" :title="`按当前站单价 ${openSt?.priceYuan ?? '—'} 预览,保存时快照`">{{ fy(num(form.selfUse) * (openSt?.priceYuan ?? 0)) }}</td>
                <td class="l"><input v-model="form.note" class="pm-din" type="text" placeholder="备注" /></td>
                <td class="ops">
                  <button class="pm-iop ok" title="保存" @click="saveForm"><component :is="iconFor('check')" :size="15" /></button>
                  <button class="pm-iop" title="取消" @click="cancelForm"><component :is="iconFor('x')" :size="15" /></button>
                </td>
              </tr>
              <tr class="warnrow">
                <td :colspan="opCols" class="l"><template v-if="formWarn">{{ formWarn }}</template></td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <template v-if="editStation || editReading" #footer>
        <!-- 一切修改仅编辑态(EDIT-MODE-SPEC v2):删除电站=档案权,新增记录=读数权 -->
        <Button v-if="editStation" variant="outline" size="sm" style="margin-right:auto;color:var(--hue-red)" @click="delStation">
          <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
          删除电站
        </Button>
        <Button v-if="editReading" variant="filled" size="sm" :disabled="adding" @click="startAdd">
          <template #leading><component :is="iconFor('plus')" :size="14" /></template>
          新增记录
        </Button>
      </template>
    </FPDrawer>

    <!-- 新增电站轻量弹窗 -->
    <div v-if="stationDlg" class="pm-mask" @mousedown="stationDlg = false">
      <div class="pm-dlg" @mousedown.stop>
        <div class="pm-dlg-h">
          <h3>新增电站</h3>
          <p>按楼栋新增一个光伏电站;装机容量与消纳单价可留空后补,单价只影响之后新录的抄表记录。</p>
        </div>
        <div class="pm-dlg-b">
          <Input v-model="stForm.name" label="电站(楼栋)名称" placeholder="如:14栋" size="sm" />
          <div style="width:120px">
            <Select v-model="stForm.phase" label="期数" :options="ST_PHASE_OPTS" size="sm" />
          </div>
          <div class="pm-dlg-row">
            <Input v-model="stForm.capacity" label="装机容量 kWp(可空)" placeholder="如:180.5" size="sm" type="number" />
            <Input v-model="stForm.price" label="消纳单价 元/kWh(可空)" placeholder="如:0.65" size="sm" type="number" />
          </div>
          <div class="pm-dlg-err">{{ stErr }}</div>
        </div>
        <div class="pm-dlg-f">
          <Button variant="gray" size="sm" @click="stationDlg = false">取消</Button>
          <Button variant="filled" size="sm" @click="submitStation">
            <template #leading><component :is="iconFor('check')" :size="14" /></template>
            新增
          </Button>
        </div>
      </div>
    </div>

    <!-- 导入(Wave2-B registry 契约:key 'pvMeter';flat records / sections 两口都接) -->
    <FpImportModal
      v-if="importing"
      :title="`导入 光伏抄表明细`"
      sub="上传/粘贴分栋抄表长表(期数|楼栋|日期|发电总量|自消纳|上网|备注);楼栋按电站名精确匹配,(站,日期)重复导入自动覆盖"
      v-bind="parserProps('pvMeter', importCtx)"
      @close="importing = false"
      @import="onImport"
      @import-sections="onImport"
    />
    <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />
    <FPElevateDialog :perms="asking" what="维护光伏表档案" @close="cancelAsk" @elevated="onElevated" />
    <FPToast v-model="okMsg" tone="info" placement="page" :duration="0" />
  </div>
</template>

<style scoped>
.pm-page { display: flex; flex-direction: column; gap: 16px; height: 100%; min-height: 0; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%; }

/* ── 标题行(样式同 BillsView 月历层 fin-head 家族) ── */
.pm-head { flex: 0 0 auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.pm-headl { display: flex; align-items: center; gap: 12px; min-width: 0; }
.pm-back { width: 34px; height: 34px; flex: 0 0 auto; border: 1px solid var(--border-subtle); background: var(--surface-white); border-radius: var(--radius-md); cursor: pointer; display: grid; place-items: center; color: var(--text-secondary); transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.pm-back:hover { background: var(--bg-hover); color: var(--text-primary); }
.pm-title { margin: 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.pm-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.pm-sub { margin: 5px 0 0; font-size: var(--fs-label); color: var(--text-muted); }

/* ── 空态引导条 ── */
.pm-empty { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--fs-label); color: var(--text-secondary); }
.pm-link { border: none; background: none; padding: 0; margin: 0 2px; font: inherit; color: var(--hue-blue); cursor: pointer; }
.pm-link:hover { text-decoration: underline; }

/* ── 主表卡片:13 站定量,不分页;短窗时卡片内滚动兜底(sticky 表头) ── */
.pm-card { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--border-subtle); overflow: hidden; }
.pm-tablewrap { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 14px 4px 12px; }
.pm-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-family: var(--font-sans); }
.pm-table th { position: sticky; top: 0; z-index: 1; background: var(--surface-white); padding: 0 16px 10px; text-align: left; font: var(--type-label); font-weight: var(--fw-regular); color: var(--text-muted); white-space: nowrap; border-bottom: 1px solid var(--divider); }
.pm-table th.num { text-align: right; }
/* 等高铁律:行高 --mx-row-h,td 不吃上下 padding;内容 nowrap+ellipsis 不撑行 */
.pm-table tbody tr { height: var(--mx-row-h, 56px); border-bottom: 1px solid var(--divider); cursor: pointer; transition: background var(--dur-fast) var(--ease-standard); }
.pm-table tbody tr:hover { background: var(--bg-panel); }
.pm-table td { padding: 0 16px; vertical-align: middle; font: var(--type-body); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pm-table td.num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.pm-table td.rev { font-weight: var(--fw-semibold); }
.pm-table td.zero { color: var(--text-disabled); font-weight: var(--fw-regular); }
.pm-table td.name .nm { font-weight: var(--fw-medium); }
.pm-badge { margin-left: 8px; font-size: var(--fs-micro); color: var(--text-secondary); background: var(--bg-sunken); border-radius: var(--radius-full); padding: 1px 7px; }

/* 行内编辑输入:静默融入单元格,hover/聚焦显边框 */
.pm-edit { width: 100%; box-sizing: border-box; height: 32px; padding: 0 8px; text-align: right; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-body); color: var(--text-primary); transition: border-color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard); appearance: textfield; -moz-appearance: textfield; }
.pm-edit::-webkit-outer-spin-button, .pm-edit::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.pm-edit:hover { border-color: var(--border-subtle); background: var(--surface-white); }
.pm-edit:focus { outline: none; border-color: var(--hue-blue); background: var(--surface-white); }
.pm-edit::placeholder { color: var(--text-disabled); }
.pm-edit.l { text-align: left; font-family: var(--font-sans); }

/* ── 抽屉记录表 ── */
.pm-dempty { padding: 40px 12px; text-align: center; color: var(--text-disabled); font-size: var(--fs-label); }
.pm-dwrap { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: hidden; }
.pm-dtable { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12.5px; white-space: nowrap; }
.pm-dtable th { padding: 8px 10px; text-align: right; font-family: var(--font-sans); font-weight: var(--fw-medium); font-size: 11px; color: var(--text-muted); background: var(--surface-card); border-bottom: 1px solid var(--divider); }
.pm-dtable td { padding: 6px 10px; text-align: right; border-bottom: 1px solid var(--divider); font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; }
.pm-dtable tbody tr:last-child td { border-bottom: none; }
.pm-dtable .l { text-align: left; }
.pm-dtable td.note { font-family: var(--font-sans); color: var(--text-muted); }
/* simulated 灰徽标(同 CpMeterView .cm-sim 口径) */
.pm-sim { margin-right: 6px; font-family: var(--font-sans); font-size: var(--fs-micro); color: var(--text-muted); background: var(--bg-sunken); border-radius: var(--radius-full); padding: 1px 7px; cursor: help; }
.pm-dtable td.ro { color: var(--text-secondary); }
.pm-dtable tr.editing td { background: var(--surface-card); }
/* height 在表格单元格上即最小高度:空着也占恰好一行,警示进出不顶行(LAYOUT-STABILITY-SPEC §4.2) */
.pm-dtable tr.warnrow td { font-family: var(--font-sans); font-size: 11.5px; color: var(--hue-orange); background: var(--surface-card); padding-top: 0; height: 16px; line-height: 16px; }
.pm-dtable td.ops { white-space: nowrap; }
.pm-din { width: 100%; box-sizing: border-box; height: 30px; padding: 0 8px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-white); font-family: var(--font-sans); font-size: 12.5px; color: var(--text-primary); transition: border-color var(--dur-fast) var(--ease-standard); }
.pm-din.num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; appearance: textfield; -moz-appearance: textfield; }
.pm-din.num::-webkit-outer-spin-button, .pm-din.num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.pm-din:focus { outline: none; border-color: var(--hue-blue); }
.pm-iop { width: 26px; height: 26px; border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-muted); display: inline-grid; place-items: center; transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.pm-iop:hover { background: var(--bg-hover); color: var(--text-primary); }
.pm-iop.ok:hover { color: var(--hue-blue); }
.pm-iop.danger:hover { background: rgb(255, 238, 237); color: var(--hue-red); }

/* ── 新增电站弹窗(样式同 SchedYearGate sm-ydlg 家族) ── */
.pm-mask { position: fixed; inset: 0; background: rgba(28, 28, 28, .34); z-index: 140; display: grid; place-items: center; }
.pm-dlg { width: min(420px, 90vw); background: var(--surface-white); border-radius: var(--radius-xl); box-shadow: 0 16px 48px rgba(28, 28, 28, .22); overflow: hidden; }
.pm-dlg-h { padding: 20px 22px 0; }
.pm-dlg-h h3 { margin: 0; font-size: 16px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.pm-dlg-h p { margin: 6px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-muted); }
.pm-dlg-b { padding: 16px 22px 4px; display: flex; flex-direction: column; gap: 12px; }
.pm-dlg-row { display: flex; gap: 12px; }
.pm-dlg-row > * { flex: 1; min-width: 0; }
.pm-dlg-err { font-size: 11.5px; color: var(--hue-red); min-height: 14px; }
.pm-dlg-f { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 22px 20px; }
</style>
