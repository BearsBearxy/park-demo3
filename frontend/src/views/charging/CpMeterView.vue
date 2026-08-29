<script setup lang="ts">
// 分桩充电明细(CP-METER-SPEC §2)— 与附表7/8 月度汇总并列的新屏,由 ChargingView 功能门进入。
// 附表7/8 共享本组件,按 vehicleType 过滤共享桩库;一行一桩,月度量=该桩该月记录求和;点行开抽屉逐条增删改;
// 三金额(充电量/手续费/收益)全手填(从平台对账单抄,无自动换算);
// 「电表与损耗」按运营商×类型×月一条,损耗=电表−Σ充电量 读时派生,负值黄警示不阻断。
// 编辑模式遵 EDIT-MODE-SPEC v2:浏览态完全只读——常量(桩名/运营商)行内改、桩增删、导入、
// 抽屉充电记录增删改、电表月度值全部收编辑态;模板下载/导出=只读操作常驻。
// 实现骨架与 PvMeterView 同构对齐(乐观更新/竞态守卫/抽屉行式编辑同款)。
// ponytail: 桩数个位数,不上分页机;短窗时卡片内滚动兜底,桩数破 30 再上
import { ref, computed, onMounted, onDeactivated, watch } from 'vue'
import FPEditModeButton from '@/components/fp/FPEditModeButton.vue'
import { cpMeterApi, type CpStationDTO, type CpPowerUsageDTO } from '@/api/cpMeter'
import type { ImportResultDTO } from '@/types/import'
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { useAuthStore } from '@/stores/auth'
import FPElevateDialog from '@/components/fp/FPElevateDialog.vue'
import { S } from '@/utils/lockScopes'
import { useEditMode } from '@/composables/useEditMode'
import { useMonthGate } from '@/composables/useMonthGate'
import FPMonthGate from '@/components/fp/FPMonthGate.vue'
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
// W2-B 契约:registry key 'cpMeter' + 模板/月度导出(buildCpMeterTemplate/exportCpMeterMonth)
import { buildCpMeterTemplate, exportCpMeterMonth } from '@/utils/cpMeterExcel'

const props = defineProps<{ vehicleType: 'car' | 'ebike' }>()
const auth = useAuthStore()

const pad2 = (n: number) => String(n).padStart(2, '0')
const num = (s: string) => { const n = Number(s); return isFinite(n) ? n : 0 }
// 电量 kWh / 金额 元 展示格式
const fq = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const fy = (n: number) => '¥' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── 编辑模式(EDIT-MODE-SPEC):不跨会话,组件 ref;KeepAlive 切页签回来也回浏览态(安全默认) ──
// 编辑模式 + 提权入口(EDIT-MODE-SPEC v3 / ELEVATION-SPEC):无权限的账号也看得到按钮,
// 点了弹主管授权窗;切页签不再回浏览态(只关浮层)。
const { editMode, canEnter, asking, toggle: toggleEdit, cancelAsk, onElevated, heldByOther } =
  useEditMode(['meter-master:edit', 'meter-reading:edit', 'billing-run:edit'], { scope: () => S.cpMeter(props.vehicleType, year.value) })
// RBAC v2:桩库档案(桩名/运营商/增删)= meter-master:edit;充电记录/电表用电量/导入 = meter-reading:edit;
// 模拟填充在本屏是「读附表7/8 整年批量派生」,属出账运行 = billing-run:edit(RBAC-SPEC §5.3-⑥)。
const canMaster = computed(() => auth.can('meter-master:edit'))
const canReading = computed(() => auth.can('meter-reading:edit'))
const canRun = computed(() => auth.can('billing-run:edit'))
const editStation = computed(() => editMode.value && canMaster.value)
const editReading = computed(() => editMode.value && canReading.value)
onDeactivated(() => { stationDlg.value = false; importing.value = false })   // 弹窗一并复位,防浏览态残留写入口(同 ElecCostView)

// ── 期间:选期矩阵门(2026-08-29「两本账」设计稿 §③,同 PvMeterView) ──
// 顶栏那对年月 Select 已撤 —— 改前系统按 latestPeriodOf 自己 snap 到最后一个有数据的月,
// 用户从没被问过要看哪个月(§7-1 禁止的「顺手落进某个期」)。
//
// ⚠ 本屏的 snap 还多一个 bug:cpMeterApi.months() 改前**不接车型**,拿的是汽车+电动车的
//   月份全集 —— 电动车录到 2026-03、汽车只到 2025-12 时,汽车屏一进来就落在 2026-03,
//   满屏空、直接撞空态。现在按车型取(后端 /cp-meter/months?vehicleType=),
//   矩阵按本车型画格,这件事本身消失。
// ⚠ key 与手工年键都要带车型:附表7 与附表8 是两个独立的屏,各记各的期。
// ⚠ null = **还没回来**;[] = 回来了、就是没有。
//   这两件事必须分开:后端三个 /months 端点在空表时正常返回 [](不抛错),
//   若用 `!dataMonths.length` 当加载中,零数据时门永久转圈、矩阵一次都不渲染,
//   而它是进这本账的唯一入口 —— 那本账从此不可达,第一条也录不进去。
//   出账链那道同形的门用的是真 `loaded` 布尔(stores/billingPeriod),这里对齐它。
const dataMonths = ref<string[] | null>(null)
const monthsErr = ref<string | null>(null)
const { year: gy, month: gm, picked, ym: gateYm, pick: pickCell, clear: clearPeriod,
        rows: gateRows, addEarlier, addLater, removeYear } = useMonthGate({
  key: `cp-meter:${props.vehicleType}`,
  store: ['cp-meter', props.vehicleType],
  months: () => dataMonths.value ?? [],
})
const year = computed(() => gy.value ?? 0)
const month = computed(() => gm.value ?? 0)
const monthLast = computed(() => `${year.value}-${pad2(month.value)}-${pad2(new Date(year.value, month.value, 0).getDate())}`)
const monthFirst = computed(() => `${year.value}-${pad2(month.value)}-01`)

// ── 数据(桩库共享,类型过滤在前端;记录/电表随年月取) ──
const stations = ref<CpStationDTO[] | null>(null)
const readings = ref<Awaited<ReturnType<typeof cpMeterApi.readings>> | null>(null)
const usageRows = ref<CpPowerUsageDTO[] | null>(null)

async function loadStations() { stations.value = await cpMeterApi.stations() }
// 竞态守卫同 PvMeterView:切期保留旧数据到新数据落位,不闪 gate
let seq = 0
async function loadMonth() {
  const my = ++seq
  const [rd, pu] = await Promise.all([
    cpMeterApi.readings(year.value, month.value),
    cpMeterApi.powerUsage(year.value, month.value),
  ])
  if (my === seq) { readings.value = rd; usageRows.value = pu }
}
/** 矩阵点格:年月一起定,再拉该月记录。 */
async function onPickCell(y: number, m: number) {
  pickCell(y, m)
  await loadMonth()
}
async function loadMonths() {
  monthsErr.value = null
  try { dataMonths.value = await cpMeterApi.months(props.vehicleType) }
  catch (e) { monthsErr.value = (e as { message?: string })?.message ?? '账期清单加载失败' }
}
onMounted(() => {
  loadStations()
  loadMonths()
  if (picked.value) loadMonth()   // 会话内选过期 → 直落表,不再撞矩阵
})
watch(gateYm, () => { if (picked.value) loadMonth() })

// 本屏桩集合(按路由类型过滤共享桩库)
const myStations = computed(() => (stations.value ?? []).filter(s => s.vehicleType === props.vehicleType))
const myIds = computed(() => new Set(myStations.value.map(s => s.id)))
const myReadings = computed(() => (readings.value ?? []).filter(r => myIds.value.has(r.stationId)))
// 「电表与损耗」小节:本屏类型的运营商行(桩库 ∪ 已录电表行,后端已并好)
const myUsage = computed(() => (usageRows.value ?? []).filter(u => u.vehicleType === props.vehicleType))

// ── 运营商 tabs(全部 + 桩库 operator 去重动态生成,保持桩 sort 序) ──
const opTab = ref<string | number>('all')
const opTabs = computed(() => {
  const ops: string[] = []
  for (const s of myStations.value) if (!ops.includes(s.operator)) ops.push(s.operator)
  return [{ k: 'all', label: '全部' }, ...ops.map(o => ({ k: o, label: o }))]
})
const tabCounts = computed(() => {
  const c: Record<string, number> = { all: myStations.value.length }
  for (const s of myStations.value) c[s.operator] = (c[s.operator] ?? 0) + 1
  return c
})
// 编辑态改运营商名后旧 tab 可能失效 → 回「全部」防空视图
watch(opTabs, tabs => { if (!tabs.some(t => t.k === opTab.value)) opTab.value = 'all' })

// ── 主表聚合:月度量=该桩该月记录求和 ──
interface StationAgg { charge: number; fee: number; revenue: number; count: number }
const aggByStation = computed(() => {
  const m = new Map<number, StationAgg>()
  for (const r of myReadings.value) {
    const a = m.get(r.stationId) ?? { charge: 0, fee: 0, revenue: 0, count: 0 }
    a.charge += r.chargeKwh; a.fee += r.fee; a.revenue += r.revenue; a.count += 1
    m.set(r.stationId, a)
  }
  return m
})
const rows = computed(() =>
  myStations.value
    .filter(s => opTab.value === 'all' || s.operator === opTab.value)
    .map(s => ({ st: s, ...(aggByStation.value.get(s.id) ?? { charge: 0, fee: 0, revenue: 0, count: 0 }) })),
)

// ── 行内编辑桩名/运营商(编辑模式;乐观更新:即时改本地,失败回滚 alert;PUT 带全量) ──
// ponytail: 类型(car/ebike)不做行内改——建桩时弹窗可选;错型桩无记录时删了重建,需要时再给桩弹窗加编辑档
function commitStation(st: CpStationDTO, field: 'name' | 'operator', raw: string) {
  const v = raw.trim()
  if (!v) { alert(field === 'name' ? '桩名不能为空' : '运营商不能为空'); return }
  if (v === st[field]) return
  const prev = st[field]
  st[field] = v
  cpMeterApi.updateStation(st.id, { name: st.name, operator: st.operator, vehicleType: st.vehicleType })
    .then(() => { if (field === 'operator') loadMonth() })   // 运营商改名 → 电表小节行键变,重取
    .catch((e) => {
      st[field] = prev
      alert((e as { message?: string })?.message ?? '保存失败，请重试')   // 重名 409 中文文案直达
    })
}

// ── 电表用电量(录入收编辑模式,EDIT-MODE-SPEC 2026-07-18 用户修订;乐观更新+PUT 回包校正) ──
function commitMeter(u: CpPowerUsageDTO, raw: string) {
  // ponytail: 后端无删除口(uk upsert),留空视为不动;录 0 表达"本月无用电"
  if (raw.trim() === '') return
  const v = Number(raw)
  if (!isFinite(v) || v < 0) { alert('请输入非负数字'); return }
  if (v === u.meterKwh) return
  const prev = { id: u.id, meterKwh: u.meterKwh, lossKwh: u.lossKwh, note: u.note }
  u.meterKwh = v
  u.lossKwh = v - u.sumChargeKwh   // 本地先派生,PUT 回包以后端口径校正
  cpMeterApi.upsertPowerUsage({
    operator: u.operator, vehicleType: u.vehicleType,
    year: year.value, month: month.value, meterKwh: v, note: u.note,
  })
    .then(dto => Object.assign(u, dto))
    .catch((e) => {
      Object.assign(u, prev)
      alert((e as { message?: string })?.message ?? '保存失败，请重试')
    })
}

// ── 抽屉:该桩该月记录行式增删改(日期限当月/三金额/备注;仅编辑态,EDIT-MODE-SPEC v2) ──
const openSt = ref<CpStationDTO | null>(null)
const drawerRows = computed(() =>
  myReadings.value.filter(r => r.stationId === openSt.value?.id)
    .slice().sort((a, b) => a.readDate.localeCompare(b.readDate)),
)
const drawerSub = computed(() => {
  const rev = drawerRows.value.reduce((s, r) => s + r.revenue, 0)
  return `${year.value}年${month.value}月 · ${drawerRows.value.length} 条充电记录 · 本月收益 ${fy(rev)}`
})

const editId = ref<number | null>(null)     // 非空=行编辑中
const adding = ref(false)                   // 新增行展开
const form = ref({ readDate: '', chargeKwh: '', fee: '', revenue: '', note: '' })

function startAdd() {
  editId.value = null; adding.value = true
  // 默认日期:当前月=今天(日记条顺手);历史月=月末。
  // today 就地取:期间块退场后没有模块级 today 了,这里本来也只用一次。
  const today = new Date()
  const isCur = year.value === today.getFullYear() && month.value === today.getMonth() + 1
  const d = isCur ? `${year.value}-${pad2(month.value)}-${pad2(today.getDate())}` : monthLast.value
  form.value = { readDate: d, chargeKwh: '', fee: '', revenue: '', note: '' }
}
function startEdit(r: (typeof drawerRows.value)[number]) {
  adding.value = false; editId.value = r.id
  form.value = { readDate: r.readDate, chargeKwh: String(r.chargeKwh), fee: String(r.fee), revenue: String(r.revenue), note: r.note ?? '' }
}
function cancelForm() { editId.value = null; adding.value = false }
watch(openSt, cancelForm)   // 换桩/关抽屉时收起编辑行
watch(editMode, v => { if (!v) cancelForm() })   // 退出编辑模式收起编辑行(v2:浏览态零写入口,含残留输入行)

async function saveForm() {
  if (!openSt.value) return
  if (!form.value.readDate) { alert('请选择日期'); return }
  const c = num(form.value.chargeKwh), f = num(form.value.fee), rv = num(form.value.revenue)
  if (c < 0 || f < 0 || rv < 0) { alert('充电量/手续费/收益不能为负'); return }
  const req = { stationId: openSt.value.id, readDate: form.value.readDate, chargeKwh: c, fee: f, revenue: rv, note: form.value.note.trim() || null }
  try {
    if (editId.value != null) await cpMeterApi.updateReading(editId.value, req)
    else await cpMeterApi.createReading(req)
    cancelForm()
    await loadMonth()   // 记录变动 → Σ充电量/损耗一并刷新
  } catch (e) {
    // 同桩同日 409 等 → 后端中文 message 直达
    alert((e as { message?: string })?.message ?? '保存失败')
  }
}

async function delRow(id: number, date: string) {
  if (!confirm(`确认删除 ${date} 的充电记录?`)) return
  try { await cpMeterApi.deleteReading(id); await loadMonth() }
  catch (e) { alert((e as { message?: string })?.message ?? '删除失败') }
}

async function delStation() {
  const st = openSt.value
  if (!st) return
  if (!confirm(`确认删除充电桩「${st.name}」?有充电记录的桩不可删除。`)) return
  try { await cpMeterApi.deleteStation(st.id); openSt.value = null; await loadStations(); await loadMonth() }
  catch (e) { alert((e as { message?: string })?.message ?? '删除失败') }   // 有记录 409 → 中文守卫文案
}

// ── 新增充电桩弹窗(名称/运营商/类型,类型默认当前屏) ──
const stationDlg = ref(false)
const stForm = ref({ name: '', operator: '', vehicleType: props.vehicleType as string })
const stErr = ref('')
const TYPE_OPTS = [{ value: 'car', label: '汽车' }, { value: 'ebike', label: '电动车' }]
function openStationDlg() {
  stForm.value = { name: '', operator: '', vehicleType: props.vehicleType }
  stErr.value = ''
  stationDlg.value = true
}
async function submitStation() {
  const name = stForm.value.name.trim()
  const operator = stForm.value.operator.trim()
  if (!name) { stErr.value = '请输入桩名'; return }
  if (!operator) { stErr.value = '请输入运营商'; return }
  try {
    await cpMeterApi.createStation({ name, operator, vehicleType: stForm.value.vehicleType as 'car' | 'ebike' })
    stationDlg.value = false
    await loadStations(); await loadMonth()   // 新运营商 → 电表小节新行
  } catch (e) {
    stErr.value = (e as { message?: string })?.message ?? '新增充电桩失败'   // 重名 409 中文文案
  }
}

// ── 导入(registry 闭环:解析→预览→确认→入库→import_log)/模板/导出 ──
const importing = ref(false)
const importResult = ref<ImportResultDTO | null>(null)
// pvMeter 同款接线:解析期行级错误暂存 ctx._parseErrors,run 时并入结果——
// parserProps 与 runImport 必须同一 ctx 引用;每次解析整体覆写,无陈旧残留
const importCtx: ImportCtx = {}
async function onImport(payload: ImportRec[] | { label?: string; records: ImportRec[] }[], fileName: string) {
  importing.value = false
  try {
    importResult.value = await runImport('cpMeter', payload as never, importCtx, fileName)
    await loadMonth()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
}

// ── 模拟填充(编辑态;照 ElecCostView:confirm→POST→alert→重载):按附表7/8 充电汇总推导当前年分桩月末记录与电表 ──
const simulating = ref(false)
async function onSimulate() {
  if (simulating.value) return
  if (!confirm(`模拟填充 ${year.value} 全年：按附表7/8 充电汇总(万城万/小桔/叮叮充/电信)推导各桩月末充电记录与电表用电量(小桔按 60/40 拆快充1/慢充1,通道费=收益×5%,均为假设口径)。\n\n只填空位与既有「模拟」灰标记录，绝不覆盖手工录入/导入的数据。确认执行？`)) return
  simulating.value = true
  try {
    const r = await cpMeterApi.simulate(year.value)
    alert(`模拟完成：填充 ${r.filled} 条，跳过 ${r.skipped} 条（手工/导入占位、值未变或缺桩）。`)
    await Promise.all([loadStations(), loadMonth()])
    await loadMonths()   // 新写入的月要在选期矩阵上亮起来
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
  // 导出只镜像本屏:本类型桩 + 本月记录(cpMeterExcel Lite 类型与 DTO 结构兼容)
  try { await exportCpMeterMonth(myReadings.value, myStations.value, year.value, month.value) }
  catch (e) { alert((e as { message?: string })?.message ?? '导出失败') }
  finally { exporting.value = false }
}
async function onTemplate() {
  try { await buildCpMeterTemplate() }
  catch (e) { alert((e as { message?: string })?.message ?? '模板下载失败') }
}
</script>

<template>
  <!-- 首载 gate:桩/记录/电表未落位不闪空表 -->
  <!-- ⓪ 没有期 → 选期矩阵(§7-1 明确选期门)。会话内选过一次之后不再出现 -->
  <FPMonthGate
    v-if="!picked"
    :title="`${vehicleType === 'car' ? '汽车' : '电动车'}分桩充电明细`"
    icon="plug"
    sub="选择月份进入该月逐桩明细 · 空月可直接进入录入 / 导入"
    :rows="gateRows"
    :scope-of="(y) => S.cpMeter(vehicleType, y)"
    :loading="dataMonths === null && !monthsErr"
    :error="monthsErr"
    @pick="onPickCell"
    @add-earlier="addEarlier"
    @add-later="addLater"
    @remove-year="removeYear"
    @retry="loadMonths"
  />

  <div v-else-if="!stations || !readings || !usageRows" class="page-loading"><span class="page-spin" /></div>

  <div v-else class="cm-page">
    <!-- 标题行 -->
    <div class="cm-head">
      <div class="cm-headl">
        <div>
          <h2 class="cm-title"><span class="ic"><component :is="iconFor('plug')" :size="18" /></span>分桩充电明细</h2>
          <p class="cm-sub">逐桩按日期记条,自动汇月 · 充电量/手续费/收益从平台对账单抄录 · 电量 kWh / 金额 元</p>
        </div>
      </div>
      <!-- 桩增删=桩库档案(EDIT-MODE-SPEC + meter-master:edit) -->
      <Button v-if="editStation" variant="outline" size="sm" @click="openStationDlg">
        <template #leading><component :is="iconFor('plus')" :size="14" /></template>
        新增充电桩
      </Button>
    </div>

    <!-- 工具栏:运营商 tabs + 年月选择 + 模板(常驻)/导入(编辑态)/导出(常驻)/编辑模式 -->
    <div class="mx-toolbar">
      <FPPhaseTabs v-model="opTab" :tabs="opTabs" :counts="tabCounts" />
      <div class="mx-toolbar-right">
        <!-- 年月下拉已撤:期由选期矩阵一处选定(§7-1),这里只显示是几月 + 回矩阵的口 -->
        <button class="cm-permonth" @click="clearPeriod">
          <component :is="iconFor('arrow-left')" :size="13" />换月
        </button>
        <span class="cm-per">{{ gateYm }}</span>
        <Button variant="outline" size="sm" @click="onTemplate">
          <template #leading><component :is="iconFor('file-spreadsheet')" :size="14" /></template>
          下载模板
        </Button>
        <Button v-if="editReading" variant="outline" size="sm" @click="importing = true">
          <template #leading><component :is="iconFor('upload')" :size="14" /></template>
          导入
        </Button>
        <!-- 模拟填充=读附表7/8 整年批量派生(§5.3-⑥)→ billing-run,不是抄表权 -->
        <Button v-if="editMode && canRun" variant="outline" size="sm" :disabled="simulating" @click="onSimulate">
          <template #leading><component :is="iconFor('wand-2')" :size="14" /></template>
          模拟填充
        </Button>
        <Button variant="filled" size="sm" :disabled="exporting" @click="onExport">
          <template #leading><component :is="iconFor('download')" :size="14" /></template>
          导出
        </Button>
        <!-- 编辑模式:本屏三把写权限任一有即可进(模拟填充只需 billing-run),进去后各按钮再各判各的 -->
        <FPEditModeButton :edit="editMode" :held-by-other="heldByOther" :can-enter="canEnter"
                          @toggle="toggleEdit()" />
      </div>
    </div>

    <!-- 空态引导(spec §2:去导入或抽屉手录;导入入口受编辑模式管) -->
    <div v-if="myReadings.length === 0" class="cm-empty">
      <component :is="iconFor('info')" :size="14" />
      <span>
        {{ year }}年{{ month }}月暂无充电记录 ——
        <template v-if="editReading">可<button class="cm-link" @click="importing = true">导入</button>整月充电明细 Excel,或点击任意桩行进入抽屉手动录入。</template>
        <template v-else-if="canReading">进入右上角「编辑模式」后可录入或导入。</template>
        <template v-else>各桩显示零值。</template>
      </span>
    </div>

    <!-- 主表:一行一桩;列宽铁律(fixed 布局,桩名=唯一弹性列) -->
    <Card surface="white" :padding="0" class="cm-card">
      <div class="cm-tablewrap">
        <table class="cm-table">
          <colgroup>
            <col /><!-- 桩名:唯一弹性列吸收余宽 -->
            <col style="width:110px" />
            <col style="width:120px" />
            <col style="width:120px" />
            <col style="width:120px" />
            <col style="width:84px" />
          </colgroup>
          <thead>
            <tr>
              <th>充电桩</th>
              <th>运营商</th>
              <th class="num">本月充电量 (kWh)</th>
              <th class="num">手续费 (元)</th>
              <th class="num">收益 (元)</th>
              <th class="num">记录条数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.st.id" @click="openSt = r.st">
              <!-- 桩名/运营商=站点常量:编辑模式行内改(点击不冒泡开抽屉),浏览态纯文本 -->
              <td class="name" :title="r.st.name">
                <input v-if="editStation" class="cm-edit l" type="text"
                       :value="r.st.name" title="桩名,回车/失焦保存(需唯一)"
                       @click.stop
                       @change="commitStation(r.st, 'name', ($event.target as HTMLInputElement).value)" />
                <span v-else class="nm">{{ r.st.name }}</span>
              </td>
              <td :title="r.st.operator">
                <input v-if="editStation" class="cm-edit l" type="text"
                       :value="r.st.operator" title="运营商,回车/失焦保存"
                       @click.stop
                       @change="commitStation(r.st, 'operator', ($event.target as HTMLInputElement).value)" />
                <span v-else>{{ r.st.operator }}</span>
              </td>
              <td class="num" :class="{ zero: r.charge === 0 }">{{ fq(r.charge) }}</td>
              <td class="num" :class="{ zero: r.fee === 0 }">{{ fy(r.fee) }}</td>
              <td class="num rev" :class="{ zero: r.revenue === 0 }">{{ fy(r.revenue) }}</td>
              <td class="num" :class="{ zero: r.count === 0 }">{{ r.count }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>

    <!-- 电表与损耗小节(spec §2):每运营商一行;电表量录入收编辑模式(EDIT-MODE-SPEC 2026-07-18 用户修订) -->
    <Card v-if="myUsage.length" surface="white" :padding="0" class="cm-usage">
      <div class="cm-usage-head">
        <span class="t"><component :is="iconFor('zap')" :size="14" />电表与损耗</span>
        <span class="s">每运营商每月一条电表用电量 · 损耗 = 电表 − Σ充电量(读时派生,负值黄警示不阻断){{ canReading && !editMode ? ' · 编辑模式下可录改电表值' : '' }}</span>
      </div>
      <table class="cm-utable">
        <colgroup>
          <col /><!-- 运营商:弹性列 -->
          <col style="width:160px" />
          <col style="width:160px" />
          <col style="width:160px" />
        </colgroup>
        <thead>
          <tr>
            <th>运营商</th>
            <th class="num">电表用电量 kWh</th>
            <th class="num">Σ充电量 kWh</th>
            <th class="num">损耗 kWh</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in myUsage" :key="u.operator">
            <td>{{ u.operator }}</td>
            <td class="num">
              <input v-if="editReading" class="cm-edit" type="number" min="0" step="0.01"
                     :value="u.meterKwh ?? ''" placeholder="未录" title="电表用电量,回车/失焦保存"
                     @change="commitMeter(u, ($event.target as HTMLInputElement).value)" />
              <span v-else>{{ u.meterKwh != null ? fq(u.meterKwh) : '—' }}</span>
            </td>
            <td class="num">{{ fq(u.sumChargeKwh) }}</td>
            <td class="num" :class="{ loss: u.lossKwh != null && u.lossKwh < 0 }"
                :title="u.lossKwh != null && u.lossKwh < 0 ? '电表用电量小于充电量之和,请核对电表读数或充电记录' : undefined">
              {{ u.lossKwh != null ? fq(u.lossKwh) : '—' }}
            </td>
          </tr>
        </tbody>
      </table>
    </Card>

    <!-- 抽屉:该桩该月逐条充电记录;增删改仅编辑态(EDIT-MODE-SPEC v2),浏览态=纯查看列表 -->
    <FPDrawer
      :open="!!openSt"
      :title="openSt?.name ?? ''"
      :subtitle="drawerSub"
      icon="plug"
      :width="720"
      :fixedHeight="true"
      @close="openSt = null"
    >
      <div v-if="drawerRows.length === 0 && !adding" class="cm-dempty">
        该桩本月暂无充电记录{{ editReading ? ',点下方「新增记录」手动录入,或在列表页「导入」整月 Excel。' : canReading ? ',进入编辑模式后可录入或导入。' : '。' }}
      </div>
      <div v-else class="cm-dwrap">
        <table class="cm-dtable">
          <!-- 列宽预算(抽屉内容宽~672):日期96+三金额106×3=414,备注弹性;金额 12px mono「¥26,223.58」量级不截断 -->
          <colgroup>
            <col style="width:96px" />
            <col style="width:106px" />
            <col style="width:106px" />
            <col style="width:106px" />
            <col /><!-- 备注:唯一弹性列(截断走 title) -->
            <col v-if="editReading" style="width:70px" />
          </colgroup>
          <thead>
            <tr>
              <th class="l">日期</th>
              <th>充电量 (kWh)</th>
              <th>手续费 (元)</th>
              <th>收益 (元)</th>
              <th class="l">备注</th>
              <th v-if="editReading"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in drawerRows" :key="r.id">
              <!-- 行编辑态:日期(限当月)+三金额+备注可改 -->
              <tr v-if="editId === r.id" class="editing">
                <td class="l"><input v-model="form.readDate" class="cm-din" type="date" :min="monthFirst" :max="monthLast" /></td>
                <td><input v-model="form.chargeKwh" class="cm-din num" type="number" min="0" step="0.01" /></td>
                <td><input v-model="form.fee" class="cm-din num" type="number" min="0" step="0.01" /></td>
                <td><input v-model="form.revenue" class="cm-din num" type="number" min="0" step="0.01" /></td>
                <td class="l"><input v-model="form.note" class="cm-din" type="text" placeholder="备注" /></td>
                <td class="ops">
                  <button class="cm-iop ok" title="保存" @click="saveForm"><component :is="iconFor('check')" :size="15" /></button>
                  <button class="cm-iop" title="取消" @click="cancelForm"><component :is="iconFor('x')" :size="15" /></button>
                </td>
              </tr>
              <tr v-else>
                <td class="l mono">{{ r.readDate }}</td>
                <td>{{ fq(r.chargeKwh) }}</td>
                <td>{{ fy(r.fee) }}</td>
                <td>{{ fy(r.revenue) }}</td>
                <!-- simulated 灰「模拟」徽标随备注列(挤日期列会撑爆列宽;模拟 note 本就以「模拟:」开头同列语义顺),录改后转 manual 自动消失 -->
                <td class="l note" :title="r.note ?? undefined"><span v-if="r.source === 'simulated'" class="cm-sim" :title="r.note ?? '模拟数据'">模拟</span>{{ (r.source === 'simulated' ? (r.note ?? '').replace(/^模拟[:：]/, '') : r.note) || '—' }}</td>
                <td v-if="editReading" class="ops">
                  <button class="cm-iop" title="编辑" @click="startEdit(r)"><component :is="iconFor('pencil')" :size="14" /></button>
                  <button class="cm-iop danger" title="删除" @click="delRow(r.id, r.readDate)"><component :is="iconFor('trash-2')" :size="14" /></button>
                </td>
              </tr>
            </template>
            <!-- 新增行 -->
            <tr v-if="adding" class="editing">
              <td class="l"><input v-model="form.readDate" class="cm-din" type="date" :min="monthFirst" :max="monthLast" /></td>
              <td><input v-model="form.chargeKwh" class="cm-din num" type="number" min="0" step="0.01" /></td>
              <td><input v-model="form.fee" class="cm-din num" type="number" min="0" step="0.01" /></td>
              <td><input v-model="form.revenue" class="cm-din num" type="number" min="0" step="0.01" /></td>
              <td class="l"><input v-model="form.note" class="cm-din" type="text" placeholder="备注" /></td>
              <td class="ops">
                <button class="cm-iop ok" title="保存" @click="saveForm"><component :is="iconFor('check')" :size="15" /></button>
                <button class="cm-iop" title="取消" @click="cancelForm"><component :is="iconFor('x')" :size="15" /></button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <template v-if="editStation || editReading" #footer>
        <!-- 一切修改仅编辑态(EDIT-MODE-SPEC v2):删除桩=桩库档案权,新增记录=读数权 -->
        <Button v-if="editStation" variant="outline" size="sm" style="margin-right:auto;color:var(--hue-red)" @click="delStation">
          <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
          删除充电桩
        </Button>
        <Button v-if="editReading" variant="filled" size="sm" :disabled="adding" @click="startAdd">
          <template #leading><component :is="iconFor('plus')" :size="14" /></template>
          新增记录
        </Button>
      </template>
    </FPDrawer>

    <!-- 新增充电桩轻量弹窗(类型默认当前屏,可改) -->
    <div v-if="stationDlg" class="cm-mask" @mousedown="stationDlg = false">
      <div class="cm-dlg" @mousedown.stop>
        <div class="cm-dlg-h">
          <h3>新增充电桩</h3>
          <p>按桩(站)新增;类型默认当前屏,桩名全局唯一。桩名/运营商之后可在编辑模式下行内修改。</p>
        </div>
        <div class="cm-dlg-b">
          <Input v-model="stForm.name" label="桩名" placeholder="如:快充2" size="sm" />
          <div class="cm-dlg-row">
            <Input v-model="stForm.operator" label="运营商" placeholder="如:小桔" size="sm" />
            <div style="width:120px">
              <Select v-model="stForm.vehicleType" label="类型" :options="TYPE_OPTS" size="sm" />
            </div>
          </div>
          <div class="cm-dlg-err">{{ stErr }}</div>
        </div>
        <div class="cm-dlg-f">
          <Button variant="gray" size="sm" @click="stationDlg = false">取消</Button>
          <Button variant="filled" size="sm" @click="submitStation">
            <template #leading><component :is="iconFor('check')" :size="14" /></template>
            新增
          </Button>
        </div>
      </div>
    </div>

    <!-- 导入(W2-B registry 契约:key 'cpMeter';flat records / sections 两口都接) -->
    <FpImportModal
      v-if="importing"
      :title="`导入 充电桩分桩明细`"
      sub="上传/粘贴分桩充电长表(运营商|桩名|日期|充电量|手续费|收益|备注);桩名精确匹配,(桩,日期)重复导入自动覆盖"
      v-bind="parserProps('cpMeter', importCtx)"
      @close="importing = false"
      @import="onImport"
      @import-sections="onImport"
    />
    <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />
    <FPElevateDialog
      :page="`充电桩分桩明细 · ${year} 年`" :action="'修改桩库档案 / 抄表记录'" :perms="asking" what="维护充电桩表档案" @close="cancelAsk" @elevated="onElevated" />
  </div>
</template>

<style scoped>
/* 骨架与 PvMeterView pm-* 同构(cm- 前缀);差异:主表下多「电表与损耗」小节 */
.cm-permonth {
  display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto;
  padding: 5px 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
  background: var(--surface-white); cursor: pointer;
  font-family: var(--font-sans); font-size: var(--fs-label); color: var(--text-muted);
  transition: color var(--dur-fast), border-color var(--dur-fast);
}
.cm-permonth:hover { color: var(--hue-blue); border-color: var(--hue-blue); }
.cm-per { flex: 0 0 auto; font-family: var(--font-mono); font-size: 13px; font-weight: var(--fw-bold); }

.cm-page { display: flex; flex-direction: column; gap: 16px; height: 100%; min-height: 0; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%; }

/* ── 标题行 ── */
.cm-head { flex: 0 0 auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.cm-headl { display: flex; align-items: center; gap: 12px; min-width: 0; }
.cm-title { margin: 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.cm-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.cm-sub { margin: 5px 0 0; font-size: var(--fs-label); color: var(--text-muted); }

/* ── 空态引导条 ── */
.cm-empty { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--fs-label); color: var(--text-secondary); }
.cm-link { border: none; background: none; padding: 0; margin: 0 2px; font: inherit; color: var(--hue-blue); cursor: pointer; }
.cm-link:hover { text-decoration: underline; }

/* ── 主表卡片:桩数个位数不分页;短窗时卡片内滚动兜底(sticky 表头) ── */
.cm-card { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--border-subtle); overflow: hidden; }
.cm-tablewrap { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 14px 4px 12px; }
.cm-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-family: var(--font-sans); }
.cm-table th { position: sticky; top: 0; z-index: 1; background: var(--surface-white); padding: 0 16px 10px; text-align: left; font: var(--type-label); font-weight: var(--fw-regular); color: var(--text-muted); white-space: nowrap; border-bottom: 1px solid var(--divider); }
.cm-table th.num { text-align: right; }
/* 等高铁律:行高 --mx-row-h,td 不吃上下 padding;内容 nowrap+ellipsis 不撑行 */
.cm-table tbody tr { height: var(--mx-row-h, 56px); border-bottom: 1px solid var(--divider); cursor: pointer; transition: background var(--dur-fast) var(--ease-standard); }
.cm-table tbody tr:hover { background: var(--bg-panel); }
.cm-table td { padding: 0 16px; vertical-align: middle; font: var(--type-body); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cm-table td.num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.cm-table td.rev { font-weight: var(--fw-semibold); }
.cm-table td.zero { color: var(--text-disabled); font-weight: var(--fw-regular); }
.cm-table td.name .nm { font-weight: var(--fw-medium); }

/* 行内编辑输入:静默融入单元格,hover/聚焦显边框(数字右对齐;.l=文本左对齐) */
.cm-edit { width: 100%; box-sizing: border-box; height: 32px; padding: 0 8px; text-align: right; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-body); color: var(--text-primary); transition: border-color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard); appearance: textfield; -moz-appearance: textfield; }
.cm-edit::-webkit-outer-spin-button, .cm-edit::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.cm-edit:hover { border-color: var(--border-subtle); background: var(--surface-white); }
.cm-edit:focus { outline: none; border-color: var(--hue-blue); background: var(--surface-white); }
.cm-edit::placeholder { color: var(--text-disabled); }
.cm-edit.l { text-align: left; font-family: var(--font-sans); }

/* ── 电表与损耗小节 ── */
.cm-usage { flex: 0 0 auto; border: 1px solid var(--border-subtle); overflow: hidden; }
.cm-usage-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; padding: 12px 16px 0; }
.cm-usage-head .t { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.cm-usage-head .s { font-size: var(--fs-micro); color: var(--text-muted); }
.cm-utable { width: 100%; border-collapse: collapse; table-layout: fixed; font-family: var(--font-sans); }
.cm-utable th { padding: 8px 16px 8px; text-align: left; font: var(--type-label); font-weight: var(--fw-regular); color: var(--text-muted); white-space: nowrap; border-bottom: 1px solid var(--divider); }
.cm-utable th.num { text-align: right; }
.cm-utable td { height: 44px; padding: 0 16px; vertical-align: middle; font: var(--type-body); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 1px solid var(--divider); }
.cm-utable tbody tr:last-child td { border-bottom: none; }
.cm-utable td.num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.cm-utable td.loss { color: var(--hue-orange); font-weight: var(--fw-semibold); }

/* ── 抽屉记录表 ── */
.cm-dempty { padding: 40px 12px; text-align: center; color: var(--text-disabled); font-size: var(--fs-label); }
.cm-dwrap { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: hidden; }
.cm-dtable { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12.5px; white-space: nowrap; }
.cm-dtable th { padding: 8px 10px; text-align: right; font-family: var(--font-sans); font-weight: var(--fw-medium); font-size: 11px; color: var(--text-muted); background: var(--surface-card); border-bottom: 1px solid var(--divider); }
.cm-dtable td { padding: 6px 10px; text-align: right; border-bottom: 1px solid var(--divider); font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; }
.cm-dtable tbody tr:last-child td { border-bottom: none; }
.cm-dtable .l { text-align: left; }
.cm-dtable td.note { font-family: var(--font-sans); color: var(--text-muted); }
/* simulated 灰徽标(同 ElecCostView .ec-sim 口径) */
.cm-sim { margin-right: 6px; font-family: var(--font-sans); font-size: var(--fs-micro); color: var(--text-muted); background: var(--bg-sunken); border-radius: var(--radius-full); padding: 1px 7px; cursor: help; }
.cm-dtable tr.editing td { background: var(--surface-card); }
.cm-dtable td.ops { white-space: nowrap; }
.cm-din { width: 100%; box-sizing: border-box; height: 30px; padding: 0 8px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-white); font-family: var(--font-sans); font-size: 12.5px; color: var(--text-primary); transition: border-color var(--dur-fast) var(--ease-standard); }
.cm-din.num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; appearance: textfield; -moz-appearance: textfield; }
.cm-din.num::-webkit-outer-spin-button, .cm-din.num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.cm-din:focus { outline: none; border-color: var(--hue-blue); }
.cm-iop { width: 26px; height: 26px; border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-muted); display: inline-grid; place-items: center; transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.cm-iop:hover { background: var(--bg-hover); color: var(--text-primary); }
.cm-iop.ok:hover { color: var(--hue-blue); }
.cm-iop.danger:hover { background: rgb(255, 238, 237); color: var(--hue-red); }

/* ── 新增充电桩弹窗(样式同 PvMeterView pm-dlg 家族) ── */
.cm-mask { position: fixed; inset: 0; background: rgba(28, 28, 28, .34); z-index: 140; display: grid; place-items: center; }
.cm-dlg { width: min(420px, 90vw); background: var(--surface-white); border-radius: var(--radius-xl); box-shadow: 0 16px 48px rgba(28, 28, 28, .22); overflow: hidden; }
.cm-dlg-h { padding: 20px 22px 0; }
.cm-dlg-h h3 { margin: 0; font-size: 16px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.cm-dlg-h p { margin: 6px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-muted); }
.cm-dlg-b { padding: 16px 22px 4px; display: flex; flex-direction: column; gap: 12px; }
.cm-dlg-row { display: flex; gap: 12px; }
.cm-dlg-row > * { flex: 1; min-width: 0; }
.cm-dlg-err { font-size: 11.5px; color: var(--hue-red); min-height: 14px; }
.cm-dlg-f { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 22px 20px; }
</style>
