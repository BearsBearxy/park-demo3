<script setup lang="ts">
// 分栋抄表明细(PV-METER-SPEC §2)— 与附表6 月度汇总并列的新屏,由 PvView 功能门进入。
// 一行一电站(13 站种子),月度量=该站该月记录求和;点行开抽屉逐条增删改;
// 容量/单价行内乐观更新(BillsView setPayCo 模式:即时更新,失败回滚 alert);
// 收益口径=self_use × price_snap(录入时快照,调站价不漂移历史)。viewer 全只读。
// 编辑模式遵 EDIT-MODE-SPEC v2:浏览态完全只读——常量(容量/单价)行内改、电站增删、导入、抽屉抄表记录增删改全部收编辑态。
// 布局遵 LIST-PAGE-SPEC 列宽铁律(定宽列+唯一弹性列,fixed 布局);
// ponytail: 13 站固定量级,不上 useFitRows/FPPager 分页机(短窗时卡片内滚动兜底),站数破 30 再上。
import { ref, computed, onMounted, onDeactivated, watch } from 'vue'
import FPEditModeButton from '@/components/fp/FPEditModeButton.vue'
import { pvMeterApi, type PvStationDTO } from '@/api/pvMeter'
import type { ImportResultDTO } from '@/types/import'
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { useAuthStore } from '@/stores/auth'
import FPElevateDialog from '@/components/fp/FPElevateDialog.vue'
import FPToast from '@/components/fp/FPToast.vue'
import { S } from '@/utils/lockScopes'
import { useEditMode } from '@/composables/useEditMode'
import { useDeferredFlag } from '@/composables/useDeferredFlag'
import FPLoadBar from '@/components/fp/FPLoadBar.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
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
// Wave2-B 并行契约:registry key 'pvMeter' + 模板/月度导出(buildPvMeterTemplate/exportPvMeterMonth)
import { buildPvMeterTemplate, exportPvMeterMonth } from '@/utils/pvMeterExcel'

const auth = useAuthStore()

// ── 编辑模式(EDIT-MODE-SPEC):不跨会话,组件 ref;KeepAlive 切页签回来也回浏览态(安全默认) ──
// 编辑模式 + 提权入口(EDIT-MODE-SPEC v3 / ELEVATION-SPEC):无权限的账号也看得到按钮,
// 点了弹主管授权窗;切页签不再回浏览态(只关浮层)。
const { editMode, canEnter, asking, toggle: toggleEdit, cancelAsk, onElevated, heldByOther } =
  useEditMode(['meter-master:edit', 'meter-reading:edit'], { scope: () => S.pvMeter(year.value) })
// RBAC v2:电站档案(名称/容量/单价/增删)= meter-master:edit;抄表记录与导入 = meter-reading:edit。
// 模拟填充也判 master —— 它对缺单价的电站反写 price_yuan(RBAC-SPEC §5.3-⑤),是电站单价的写旁路。
const canMaster = computed(() => auth.can('meter-master:edit'))
const canReading = computed(() => auth.can('meter-reading:edit'))
// ⚠ 三处都要 `&& !loadErr` —— 逐字照兄弟屏 MeterView.vue:131 的 `editable`。
//   本月读数没加载成功时表里是 13 行**伪造的零**(rows 按 stations 铺,aggByStation 拿不到就落 0),
//   此时放行录入 = 让人对着假底数写真数据。对抗复查坐实的最狠一条:保存成功后 reload 撞抖动,
//   主屏立刻变「本月暂无抄表记录」,用户判定保存失败去重录 —— 同日撞 409 一头雾水,
//   换个日期就是一条重复的消纳收益行。
const editStation = computed(() => editMode.value && !loadErr.value && canMaster.value)
const editReading = computed(() => editMode.value && !loadErr.value && canReading.value)
// 切页签复位浮层,防浏览态残留写入口(同 ElecCostView)。
// ⚠ openSt 必须一起收:FPDrawer 是这屏唯一 `Teleport to body` 的浮层,
//   子树随 KeepAlive 消失时它**留在 body 上飘着**,盖在下一个屏上(照 MeterView.vue:71 的 openId)。
onDeactivated(() => { stationDlg.value = false; importing.value = false; openSt.value = null })

const pad2 = (n: number) => String(n).padStart(2, '0')
const num = (s: string) => { const n = Number(s); return isFinite(n) ? n : 0 }
// 电量 kWh / 金额 元 展示格式
const fq = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const fy = (n: number) => '¥' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── 期间:选期矩阵门(2026-08-29「两本账」设计稿 §③) ──
// 顶栏那对年月 Select 已撤 —— 改前点完功能卡直接落表,系统按 latestPeriodOf 自己 snap 到
// 最后一个有数据的月,用户从没被问过要看哪个月:BOOK-WORKBENCH-SPEC §7-1 一字不差禁止的
// 「顺手落进某个期」。出账链五屏 2026-08-28/29 刚从这个形状迁走,这屏跟上。
// 期存 store 不存屏内 ref:侧栏点击走 openFresh 会重建组件,屏内 ref 每次被清掉。
// ⚠ null = **还没回来**;[] = 回来了、就是没有。
//   这两件事必须分开:后端三个 /months 端点在空表时正常返回 [](不抛错),
//   若用 `!dataMonths.length` 当加载中,零数据时门永久转圈、矩阵一次都不渲染,
//   而它是进这本账的唯一入口 —— 那本账从此不可达,第一条也录不进去。
//   出账链那道同形的门用的是真 `loaded` 布尔(stores/billingPeriod),这里对齐它。
const dataMonths = ref<string[] | null>(null)
const monthsErr = ref<string | null>(null)
const gate = useMonthGate({
  key: 'pv-meter',
  store: ['pv-meter', 'all'],
  months: () => dataMonths.value ?? [],
})
const { year: gy, month: gm, picked, ym: gateYm, pick: pickCell, clear: clearPeriod,
        rows: gateRows, addEarlier, addLater, removeYear } = gate
const year = computed(() => gy.value ?? 0)
const month = computed(() => gm.value ?? 0)

const monthLast = computed(() => `${year.value}-${pad2(month.value)}-${pad2(new Date(year.value, month.value, 0).getDate())}`)
const monthFirst = computed(() => `${year.value}-${pad2(month.value)}-01`)

// ── 数据 ──
const stations = ref<PvStationDTO[] | null>(null)
const readings = ref<Awaited<ReturnType<typeof pvMeterApi.readings>> | null>(null)

const stationsErr = ref('')

/**
 * 站清单。改前是裸 await —— 一挂 stations 永远是 null,首屏永久转圈且无重试口。
 *
 * ⚠ 必须自带一个槽,不能与 readErr 合用(照 MeterView.vue:102-103 的 metersErr/readErr)。
 *   合用时:电站清单挂了 → 用户点月格 → loadReadings 开头 `readErr = null` 把它抹掉 →
 *   读数拉成功 → 一张没有任何解释的空表(站没了,行就没了)。
 */
async function loadStations() {
  try { stations.value = await pvMeterApi.stations(); stationsErr.value = '' }
  catch { stationsErr.value = '电站档案加载失败,请重试' }
}
/** 失败条上的「重试」:只重来挂掉的那一份(照 MeterView.vue:133-134)。 */
function retryLoad() {
  if (stationsErr.value) loadStations()
  if (readErr.value) loadReadings()
}
/** 任一份没拿全 —— 写入口与导出都按这个判。 */
const loadErr = computed(() => readErr.value || stationsErr.value)

/**
 * 换期重取时的退让（加载态设计稿 §06 第一档，逐字照 PoolLedgerView/SalaryView）。
 * 旧数据留在原地不闪，但必须退一步并**停止接受交互** —— 它还是上一期的。
 *
 * ⚠ 没有这个信号时的后果(2026-08-29 对抗复查坐实):点「换月」那一刻 `picked` 当场变 true、
 *   门收起、工具条上的期标与空态文案全部换成新期,而表体的 readings 是**上一期**的
 *   —— 用户把 3 月的量当 7 月读走,零提示、不自愈。
 */
const reloading = ref(false)
/** 熬过 200ms 才亮 —— 本地后端常几十毫秒回来,闪一下比不显示更晃眼 */
const veil = useDeferredFlag(reloading)
/** 本期取数失败的人话。改前 loadReadings 连 try/catch 都没有,失败一声不吭。 */
const readErr = ref<string | null>(null)

// 竞态守卫同 BillsView loadRows:切期保留旧数据到新数据落位,不闪 gate
let seq = 0
async function loadReadings() {
  const my = ++seq
  reloading.value = true
  // ⚠ readErr 只在**成功**时清,不能清在这里(照 MeterView.vue:120)。
  //   清在请求开头的话:失败 → 点重试 → 这一趟在途的整段时间里 loadErr 变假,
  //   写入口、导出、空态文案全部重新敞开,而 readings 还是上一趟失败留下的 []。
  //   于是屏上出现「本月暂无抄表记录」+ 可点的导出 —— 导出的正是那份全零表。
  try {
    const data = await pvMeterApi.readings(year.value, month.value)
    if (my === seq) { readings.value = data; readErr.value = null }
  } catch (e) {
    // 失败时**不留旧数据顶着新期标**:清空 → 表体让位给错误条,不给「7 月标题 + 3 月数字」
    if (my === seq) {
      readings.value = []
      readErr.value = (e as { message?: string })?.message ?? '本月读数加载失败'
    }
  } finally {
    // ⚠ 只有最新那一趟有资格熄灯(理由同催缴单)
    if (my === seq) reloading.value = false
  }
}
/** 矩阵点格:年月一起定,再拉该月读数。 */
async function onPickCell(y: number, m: number) {
  pickCell(y, m)
  await loadReadings()
}
/** 写操作之后一起刷:读数 + 账期清单。
 *  少了后者,刚录过数据的月在矩阵上仍画成虚线「空」,「最近有数据月」的描边也还停在旧月 ——
 *  改前 dataMonths 只喂年下拉(有 buildYearOptions 兜底,陈旧无所谓),现在它是矩阵着色的唯一来源。 */
async function reloadAfterWrite() {
  await loadReadings()
  await loadMonths()
}
async function loadMonths() {
  monthsErr.value = null
  try { dataMonths.value = await pvMeterApi.months() }
  catch (e) { monthsErr.value = (e as { message?: string })?.message ?? '账期清单加载失败' }
}
onMounted(() => {
  loadStations()
  loadMonths()
  if (picked.value) loadReadings()   // 会话内选过期 → 直落表,不再撞矩阵
})
watch(gateYm, () => { if (picked.value) loadReadings() })

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
  // 写口自守(照 BillNoticesView.vue:301/415/431 的既有写法):editMode 会**就地**转假
  // (被别人接管 / 30 分钟提权到期),而调用者各有各的 v-if —— 守在发请求这一层才不漏。
  if (!editStation.value) return
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
  if (!editStation.value) return
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
  // 默认日期:当前月=今天(日抄顺手);历史月=月末(月抄建议月末)。
  // today 就地取:期间块退场后没有模块级 today 了,这里本来也只用一次。
  const today = new Date()
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
// 退出编辑模式收起一切写入口(v2:浏览态零写入口)。
// ⚠ 两个弹窗必须一起关。它们的 v-if 只判自己那个 ref,不判编辑态,而 editMode 会**就地**转假:
//   别人走接管(presence.handleEviction → useEditMode.exit())、或 30 分钟提权到期。
//   屏幕当场退回浏览态而弹窗还挂着,里面的「新增」「确认导入」照样打 POST ——
//   浏览态下写库,写的还是一把已经归别人的期锁,锁在这条路上等于不存在。
watch(editMode, v => {
  if (v) return
  cancelForm()
  stationDlg.value = false
  importing.value = false
})

async function saveForm() {
  if (!editReading.value) return
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
    await reloadAfterWrite()
  } catch (e) {
    // 同站同日 409 等 → 后端中文 message 直达
    alert((e as { message?: string })?.message ?? '保存失败')
  }
}

async function delRow(id: number, date: string) {
  if (!editReading.value) return
  if (!confirm(`确认删除 ${date} 的抄表记录?`)) return
  try { await pvMeterApi.deleteReading(id); await reloadAfterWrite() }
  catch (e) { alert((e as { message?: string })?.message ?? '删除失败') }
}

async function delStation() {
  if (!editStation.value) return
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
  if (!editStation.value) return
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
  if (!editReading.value) return
  try {
    importResult.value = await runImport('pvMeter', payload as never, importCtx, fileName)
    await reloadAfterWrite()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
}

// ── 模拟填充(编辑态;照 CpMeterView:confirm→POST→alert→重载):按附表6 phase 月度汇总推导当前年分栋抄表记录 ──
const simulating = ref(false)
async function onSimulate() {
  if (!editStation.value) return   // 模拟填充会反写 price_yuan,是电站单价的写旁路
  if (simulating.value) return
  if (!confirm(`模拟填充 ${year.value} 全年：按附表6 各期月度汇总反推电站容量/单价(空位才填,年等效 950h、站内容量比例均为假设)，并按容量占比拆分各栋月末抄表记录(发电=消纳×1.03 损耗假设)。\n\n只填空位与既有「模拟」灰标记录，绝不覆盖手工录入/导入的数据。确认执行？`)) return
  simulating.value = true
  try {
    const r = await pvMeterApi.simulate(year.value)
    alert(`模拟完成：填充 ${r.filled} 条，跳过 ${r.skipped} 条（手工/导入占位、值未变或缺站）。`)
    await Promise.all([loadStations(), loadReadings()])
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
  <!-- ⓪ 没有期 → 选期矩阵(§7-1 明确选期门)。会话内选过一次之后不再出现 -->
  <FPMonthGate
    v-if="!picked"
    title="分栋抄表明细"
    icon="gauge"
    sub="选择月份进入该月逐站抄表 · 空月可直接进入录入 / 导入"
    :rows="gateRows"
    :scope-of="(y) => S.pvMeter(y)"
    :loading="dataMonths === null && !monthsErr"
    :error="monthsErr"
    @pick="onPickCell"
    @add-earlier="addEarlier"
    @add-later="addLater"
    @remove-year="removeYear"
    @retry="loadMonths"
  />

  <!-- 站清单一次都没拿到:没有它连表头都铺不出来,只能给硬失败面(照 MeterView.vue:554)。
       少了这句 stations 恒为 null,下面那行转圈永不停。 -->
  <div v-else-if="!stations && stationsErr" class="pm-gate-fail">
    <component :is="iconFor('alert-triangle')" :size="18" />
    <span>{{ stationsErr }}</span>
    <Button variant="outline" size="sm" @click="loadStations">重试</Button>
  </div>

  <div v-else-if="!stations || !readings" class="page-loading"><span class="page-spin" /></div>

  <div v-else class="pm-page">
    <!-- 换期在途的唯一信号(§06 第一档):熬过 200ms 才亮 -->
    <FPLoadBar :on="veil" />

    <!-- 标题行 -->
    <div class="pm-head">
      <div class="pm-headl">
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
        <!-- 年月下拉已撤:期由选期矩阵一处选定(§7-1),这里只显示是几月 + 回矩阵的口 -->
        <button class="pm-permonth" @click="clearPeriod">
          <component :is="iconFor('arrow-left')" :size="13" />换月
        </button>
        <span class="pm-per">{{ gateYm }}</span>
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
        <!-- 失败态禁导出:readings 被清成 [] 之后导出的是一份「全站全零」的月度表,
             与一个真正零发电的月份产出**完全一致**,发出去无从分辨。文件会离开系统,不能猜。 -->
        <!-- ⚠ 还要判 reloading。换期那一刻 picked/期标当场变成新期,而 readings 仍是上一期的
             (loadReadings 故意不清旧数据);`.fp-stale` 只盖 .pm-card,工具条是它的**兄弟**,
             FPLoadBar 又是 pointer-events:none —— 这颗按钮全程可点。
             而 utils/pvMeterExcel 不按 year/month 过滤行,只拿它们做文件名/sheet 名/标题:
             产出「…2025年07月.xlsx」而内容是 3 月的量,发出去无从分辨。 -->
        <Button variant="filled" size="sm" :disabled="exporting || !!loadErr || reloading"
                :title="loadErr ? '数据未加载成功,导出会得到一份全零的表 —— 先重试'
                        : reloading ? '本期读数还在路上,现在导出拿到的是上一期的数' : undefined"
                @click="onExport">
          <template #leading><component :is="iconFor('download')" :size="14" /></template>
          导出
        </Button>
        <!-- 编辑模式:档案/读数两把权限任一有即可进,进去后各按钮再各判各的 -->
        <!-- 失败态禁进(照 MeterView.vue:607-608):进得去也占得到 pv-meter:<year> 那把锁,
             可 editStation/editReading 都被 loadErr 判假,一个写控件都不会出现 ——
             把别人挡在外面,自己什么也做不了。 -->
        <FPEditModeButton :edit="editMode" :held-by-other="heldByOther" :can-enter="canEnter"
                          :disabled="!!loadErr"
                          :title="loadErr ? '数据未加载成功,先点失败条上的「重试」再进编辑' : undefined"
                          @toggle="toggleEdit()" />
      </div>
    </div>

    <!-- 空态引导(spec §2:去导入或抽屉手录) -->
    <!-- ⚠ 必须排除 readErr(照 MeterView.vue:638):失败态下 readings 被清成 [],
         不排除的话「加载失败」与「本月真的没有」同屏并列,而后者会盖过前者 —— 用户读到的是「没有」 -->
    <div v-if="!loadErr && readings.length === 0" class="pm-empty">
      <component :is="iconFor('info')" :size="14" />
      <span>
        {{ year }}年{{ month }}月暂无抄表记录 ——
        <template v-if="editReading">可<button class="pm-link" @click="importing = true">导入</button>整月抄表 Excel,或点击任意电站行进入抽屉手动录入。</template>
        <template v-else-if="canReading">进入右上角「编辑模式」后可录入或导入。</template>
        <template v-else>各站显示零值。</template>
      </span>
    </div>

    <!-- 主表:一行一电站;列宽铁律(fixed 布局,电站名=唯一弹性列) -->
    <!-- 本期取数失败:说出来 + 给重试。改前 loadReadings 连 try/catch 都没有,
         失败后旧数据顶着新期标继续显示,零提示、不自愈(对抗复查坐实) -->
    <FPLoadError v-if="loadErr" @retry="retryLoad">
      <div v-if="readErr">{{ year }}年{{ month }}月读数加载失败:{{ readErr }} —— 表内为空,不拿上一期的数顶替,编辑模式已锁。</div>
      <div v-if="stationsErr">{{ stationsErr }} —— 电站档案停留在上次拉到的版本。</div>
    </FPLoadError>

    <!-- fp-stale 带 pointer-events:none —— 旧数据不许被点、被录(安全项,见 base.css) -->
    <Card surface="white" :padding="0" class="pm-card"
          :class="{ 'fp-stale': veil }" :aria-busy="veil">
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
      <!-- 抽屉里也要排除失败态:主屏的失败条在抽屉后面,抽屉自己说「暂无记录」就是唯一可见结论 -->
      <!-- 只判 readErr,不判合并槽:电站档案挂掉时读数是好好的,拿 loadErr 拦会**藏掉真实记录**并说一句假话 -->
      <div v-if="readErr" class="pm-dempty">本月读数未加载成功 —— 关掉抽屉点失败条上的「重试」,别在这里录。</div>
      <div v-else-if="drawerRows.length === 0 && !adding" class="pm-dempty">
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
    <FPElevateDialog
      :page="`光伏分栋抄表 · ${year} 年`" :action="'修改电站档案 / 抄表记录'" :perms="asking" what="维护光伏表档案" @close="cancelAsk" @elevated="onElevated" />
    <FPToast v-model="okMsg" tone="info" placement="page" :duration="0" />
  </div>
</template>

<style scoped>
/* position: relative —— FPLoadBar 是 absolute 定位,宿主不给参照它会跑到最近的定位祖先
   (AppShell 的 .fp-main-card)顶边去,横跨整个页签条。同批四屏都写了,这屏当初抄漏了。 */
.pm-gate-fail {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  height: 100%; color: var(--hue-red); font-size: 13px;
}
.pm-page { position: relative; display: flex; flex-direction: column; gap: 16px; height: 100%; min-height: 0; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%; }

/* ── 标题行(样式同 BillsView 月历层 fin-head 家族) ── */
.pm-head { flex: 0 0 auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.pm-headl { display: flex; align-items: center; gap: 12px; min-width: 0; }
.pm-permonth {
  display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto;
  padding: 5px 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
  background: var(--surface-white); cursor: pointer;
  font-family: var(--font-sans); font-size: var(--fs-label); color: var(--text-muted);
  transition: color var(--dur-fast), border-color var(--dur-fast);
}
.pm-permonth:hover { color: var(--hue-blue); border-color: var(--hue-blue); }
.pm-per { flex: 0 0 auto; font-family: var(--font-mono); font-size: 13px; font-weight: var(--fw-bold); }

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
