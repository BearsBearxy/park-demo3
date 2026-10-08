<script setup lang="ts">
// no-review: 充电桩分栋抄表是附表7/8 的**下游**派生第二本账,不单独审;
//            后端同款豁免见 CpMeterService 上的 @NoReviewGuard。
// 分桩充电明细(CP-METER-SPEC §2)— 与附表7/8 月度汇总并列的新屏,由 ChargingView 功能门进入。
// 附表7/8 共享本组件,按 vehicleType 过滤共享桩库;一行一桩,月度量=该桩该月记录求和;点行开抽屉逐条增删改;
// 三金额(充电量/手续费/收益)全手填(从平台对账单抄,无自动换算);
// 「电表与损耗」按运营商×类型×月一条,损耗=电表−Σ充电量 读时派生,负值黄警示不阻断。
// 编辑模式遵 EDIT-MODE-SPEC v2:浏览态完全只读——常量(桩名/运营商)行内改、桩增删、导入、
// 抽屉充电记录增删改、电表月度值全部收编辑态;模板下载/导出=只读操作常驻。
// 实现骨架与 PvMeterView 同构对齐(乐观更新/竞态守卫/抽屉行式编辑同款)。
// ponytail: 桩数个位数,不上分页机;短窗时卡片内滚动兜底,桩数破 30 再上
import { ref, computed, onMounted, onDeactivated, watch } from 'vue'
import { textW } from '@/composables/useWideTable'
import { useRoute } from 'vue-router'
import FPEditModeButton from '@/components/fp/FPEditModeButton.vue'
import { cpMeterApi, type CpStationDTO, type CpPowerUsageDTO } from '@/api/cpMeter'
import type { ImportPayload } from '@/components/import/FpImportModal.vue'
import { importBusy, settle, type ImportOutcome, type ImportRunProgress } from '@/components/import/importRun'
import { useAuthStore, approxDirty } from '@/stores/auth'
import { useAppConfigStore } from '@/stores/appConfig'
import { useFormSheet } from '@/composables/useFormSheet'
import FPElevateDialog from '@/components/fp/FPElevateDialog.vue'
import FPLockDialogs from '@/components/fp/FPLockDialogs.vue'
import { useDeepPeriod } from '@/composables/useDeepPeriod'
import { S } from '@/utils/lockScopes'
import { useEditMode } from '@/composables/useEditMode'
import { useMonthGate } from '@/composables/useMonthGate'
import FPMonthGate from '@/components/fp/FPMonthGate.vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Card from '@/components/ds/Card.vue'
import Select from '@/components/ds/Select.vue'
import DatePicker from '@/components/ds/DatePicker.vue'
import Input from '@/components/ds/Input.vue'
import FPPhaseTabs from '@/components/fp/FPPhaseTabs.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPLoadBar from '@/components/fp/FPLoadBar.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import FPEmpty from '@/components/fp/FPEmpty.vue'
import FPStateTag from '@/components/fp/FPStateTag.vue'
import { ask } from '@/utils/ask'
import { receipt } from '@/utils/receipt'
import { useDeferredFlag } from '@/composables/useDeferredFlag'
import { onReactivated } from '@/composables/onReactivated'
import { usePresenceStore } from '@/stores/presence'
import FpImportModal from '@/components/import/FpImportModal.vue'
import { parserProps, runImport, type ImportCtx } from '@/utils/importRegistry'
// W2-B 契约:registry key 'cpMeter' + 模板/月度导出(buildCpMeterTemplate/exportCpMeterMonth)
import { buildCpMeterTemplate, exportCpMeterMonth } from '@/utils/cpMeterExcel'

const props = defineProps<{ vehicleType: 'car' | 'ebike' }>()
/** 车型 → 屏(权限点前缀)。汽车、电动车两屏共用本组件和一张桩表 */
const screenOf = (t: string) => (t === 'car' ? 'car-charging' : 'ebike-charging')
const scr = screenOf(props.vehicleType)
const auth = useAuthStore()
const appCfg = useAppConfigStore()
// 新增充电桩弹卡带输入 → S 档全屏 sheet(styles/form-sheet.css)
const sheet = useFormSheet()

const pad2 = (n: number) => String(n).padStart(2, '0')
const num = (s: string) => { const n = Number(s); return isFinite(n) ? n : 0 }
// 电量 kWh / 金额 元 展示格式
const fq = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const fy = (n: number) => '¥' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── 编辑模式(EDIT-MODE-SPEC):不跨会话,组件 ref;KeepAlive 切页签回来也回浏览态(安全默认) ──
// 编辑模式 + 提权入口(EDIT-MODE-SPEC v3 / ELEVATION-SPEC):无权限的账号也看得到按钮,
// 点了弹主管授权窗;切页签不再回浏览态(只关浮层)。
const { editMode, canEnter, asking, toggle: toggleEdit, cancelAsk, onElevated, heldByOther,
        lockedBy, evictedBy, lockScope, onTaken } =
  useEditMode([`${scr}:archive`, `${scr}:reading`], {
    scope: () => S.cpMeter(props.vehicleType, year.value),
    // 改动数(02-A 离开确认):桩名 / 电表值即时提交,没有草稿;抽屉里开着的记录行、新增桩 / 导入弹窗算一处
    dirty: approxDirty(() => (adding.value || editId.value != null || stationDlg.value || importing.value ? 1 : 0)),
  })
// RBAC v4:桩库档案(桩名/运营商/增删)= <本屏>:archive;充电记录/电表用电量/导入 = <本屏>:reading。
// 模拟填充一次写汽车、电动车两种桩一整年的记录,两屏的「分桩读数」都要(RBAC-SPEC §15.3)。
const canMaster = computed(() => auth.can(`${scr}:archive`))
const canReading = computed(() => auth.can(`${scr}:reading`))
const canRun = computed(() => auth.can('car-charging:reading') && auth.can('ebike-charging:reading'))
// ⚠ 三处都要 `&& !loadErr` —— 逐字照兄弟屏 PvMeterView(2026-08-29/30 三轮对抗复查后的形状)。
//   本月记录没加载成功时表里是逐桩**伪造的零**(rows 按 stations 铺),放行录入 = 对着假底数写真数据。
const editStation = computed(() => editMode.value && !loadErr.value && canMaster.value)
const editReading = computed(() => editMode.value && !loadErr.value && canReading.value)
// 切页签复位浮层,防浏览态残留写入口(同 ElecCostView)。
// ⚠ openSt 必须一起收:FPDrawer 是 Teleport to body,子树随 KeepAlive 消失时它留在 body 上飘着。
onDeactivated(() => { stationDlg.value = false; if (!importBusy.value) importing.value = false; openSt.value = null })   // 在跑的导入窗不收(D14)

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

// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM 直落该月 —— 只 pick 进 screenPeriod,取数交给下面的 onMounted / watch(gateYm)。
// 必须在 onMounted / watch(gateYm) / onReactivated 之前调用:期先落定,首载才只拉一次;切回时也先于重读改期。
// 只有年的链接不动(本屏只认整月)。不传 dirty、也不接 note:抽屉里的行草稿在切走时随抽屉一起收掉
// (onDeactivated 清 openSt → watch(openSt, cancelForm)),切回时没有草稿可护。
useDeepPeriod({
  current: () => ({ p: gateYm.value }),
  apply: (t) => { if (t.month != null) pickCell(t.year, t.month) },
  // 本屏与父屏共用同一个页签 value(一个 value 两个组件,靠父屏的 mode 切换)——
  // 两个 useDeepPeriod 实例会往同一格 ctx 里对写,而子屏卸载时不回滚,页签会留着子屏的月
  // 对着父屏的年表撒谎(整期复查实测)。页签上下文由父屏一家写。
  ctx: () => null,
})

// 「读站」(SIDEBAR-UX-REDESIGN §4.2 分析层假下钻 → 真下钻):?station=<桩 id> 桩库到手且已选月后直开该桩抽屉。
// 只开一次(开过 / 找不到即清 pending):分析屏走 openFresh 实例总是新的;onDeactivated 清 openSt 是既有约定,开过的不在切回时重开。
// 只有年的链没选月 → pending 留着,选月后的下一次 loadStations(切回)再开。跨型(汽车屏收到电动车桩 id)找不到 → 不开、也清 pending。
const route = useRoute()
let pendingStation: number | null = Number(route.query.station) || null
function openDeepStation() {
  if (pendingStation == null || !picked.value) return
  const st = myStations.value.find(s => s.id === pendingStation) ?? null
  pendingStation = null
  if (st) openSt.value = st
}

const monthLast = computed(() => `${year.value}-${pad2(month.value)}-${pad2(new Date(year.value, month.value, 0).getDate())}`)
const monthFirst = computed(() => `${year.value}-${pad2(month.value)}-01`)

// ── 数据(桩库共享,类型过滤在前端;记录/电表随年月取) ──
const stations = ref<CpStationDTO[] | null>(null)
const readings = ref<Awaited<ReturnType<typeof cpMeterApi.readings>> | null>(null)
const usageRows = ref<CpPowerUsageDTO[] | null>(null)

const stationsErr = ref('')
/**
 * 桩清单。裸 await 一挂 stations 恒为 null → 模板永久转圈且无重试口。
 * ⚠ 独立错误槽 + 竞态守卫(照 PvMeterView):与 readErr 合槽会被换月的清除抹掉;
 *   无 seq 时双击重试,老的失败结算在新的成功之后,一屏正确的数据被锁成永久只读。
 */
let stSeq = 0
async function loadStations() {
  const my = ++stSeq
  try {
    const data = await cpMeterApi.stations()
    if (my === stSeq) { stations.value = data; stationsErr.value = ''; openDeepStation() }
  } catch {
    if (my === stSeq) stationsErr.value = '充电桩档案没读到'
  }
}
/** 失败条上的「重试」:只重来挂掉的那一份。 */
function retryLoad() {
  if (stationsErr.value) loadStations()
  if (readErr.value) loadMonth()
}
/** 任一份没拿全 —— 写入口与导出都按这个判。 */
const loadErr = computed(() => readErr.value || stationsErr.value)

/** 换期重取的退让(§06 第一档,同 PvMeterView):旧数据留在原地但退一步、停止交互。 */
const reloading = ref(false)
const veil = useDeferredFlag(reloading)
/** 本期取数失败的人话。只在**成功**时清 —— 清在请求开头的话,重试在途的整段窗口所有门重新敞开。 */
const readErr = ref<string | null>(null)
// 竞态守卫同 PvMeterView:切期保留旧数据到新数据落位,不闪 gate
let seq = 0
async function loadMonth() {
  const my = ++seq
  reloading.value = true
  try {
    const [rd, pu] = await Promise.all([
      cpMeterApi.readings(year.value, month.value),
      cpMeterApi.powerUsage(year.value, month.value),
    ])
    if (my === seq) { readings.value = rd; usageRows.value = pu; readErr.value = null }
  } catch (e) {
    // 失败时**不留旧数据顶着新期标**:清空 → 表体让位给错误条,不给「7 月标题 + 3 月数字」
    if (my === seq) {
      readings.value = []
      usageRows.value = []
      readErr.value = (e as { message?: string })?.message ?? '本月记录加载失败'
    }
  } finally {
    if (my === seq) reloading.value = false
  }
}
/**
 * 写路径统一走这里(照 PvMeterView 的 reloadAfterWrite)。
 * ⚠ dataMonths 是矩阵 hasData 着色的**唯一**数据源:写完只 loadMonth 不刷清单,
 *   矩阵会把刚录过的月继续画成「空」(agent 写测时抓到的移植遗漏)。
 */
async function reloadAfterWrite() {
  await loadMonth()
  await loadMonths()
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
// ⚠ 附表7/8 是两个 KeepAlive 实例,桩库共享(全站派生审计「病根 A」的本屏变体):
//   在另一屏跨型建桩/删桩、或点模拟填充(simulate 一次写两型),本实例的
//   stations/dataMonths/本月数据全部陈旧 —— 新桩不见 → 重建撞 409 却满屏找不到;
//   矩阵把 simulate 刚写的月画成空 → 用户对着假空表手工补录 → 与 simulated 行双计。
//   样板 PvMeterView 单实例没有这根轴,移植时该补未补。解药与其它 6 屏同款。
onReactivated(() => {
  loadStations()
  loadMonths()
  if (picked.value) loadMonth()
})
// 换期清掉行内格的报错:电表格的键不带月,不清的话上个月敲错的数会挂到这个月同一格上
watch(gateYm, () => { cellErr.value = null; if (picked.value) loadMonth() })

// 本屏桩集合(按路由类型过滤共享桩库)
const myStations = computed(() => (stations.value ?? []).filter(s => s.vehicleType === props.vehicleType))
const myIds = computed(() => new Set(myStations.value.map(s => s.id)))
const myReadings = computed(() => (readings.value ?? []).filter(r => myIds.value.has(r.stationId)))
// 「电表与损耗」小节:本屏类型的运营商行(桩库 ∪ 已录电表行,后端已并好)
const myUsage = computed(() => (usageRows.value ?? []).filter(u => u.vehicleType === props.vehicleType))
// 列宽铁律(2026-10-02):桩名、运营商两根文字列按本型全部值定宽(14px 字 + 左右内边距 32),余宽落进行末空列。
// 编辑态桩名是输入框,至少给 200 好录;有档案编辑权的人浏览态也按 200 预留 —— 进出编辑态列不挪位(LIST-PAGE §7)。
const stNameW = computed(() => Math.max(textW(['充电桩', ...myStations.value.map(s => s.name)], 14, 32), canMaster.value ? 200 : 0))
const usageOpW = computed(() => textW(['运营商', ...myUsage.value.map(u => u.operator)], 14, 32))

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

// ── 行内格的字段报错(十件 ⑤):红字贴在那一格输入框正下方,不走回执;同一格再交一次、过了校验才清 ──
// raw 留住用户敲的原值 —— 不留的话一重绘格子被刷回旧值,红字对着一个看着没毛病的数。
// ponytail: 全屏只记一格(新报错顶掉旧的);同时错几格成了常态再换成按格的 Map
const cellErr = ref<{ k: string; msg: string; raw: string } | null>(null)
const errOf = (k: string) => (cellErr.value?.k === k ? cellErr.value.msg : '')
const rawOf = (k: string, v: string | number | null | undefined) => (cellErr.value?.k === k ? cellErr.value.raw : v ?? '')
function badCell(k: string, msg: string, raw: string) { cellErr.value = { k, msg, raw } }
function okCell(k: string) { if (cellErr.value?.k === k) cellErr.value = null }

// ── 行内编辑桩名/运营商(编辑模式;乐观更新:即时改本地,失败回滚 + 回执;PUT 带全量) ──
// ponytail: 类型(car/ebike)不做行内改——建桩时弹窗可选;错型桩无记录时删了重建,需要时再给桩弹窗加编辑档
function commitStation(st: CpStationDTO, field: 'name' | 'operator', raw: string) {
  // 写口自守(照 BillNoticesView 口径):editMode 会就地转假,调用者各有各的 v-if,守发请求这层才不漏
  if (!editStation.value) return
  const k = `${field}:${st.id}`
  const v = raw.trim()
  if (!v) { badCell(k, field === 'name' ? '桩名不能为空' : '运营商不能为空', raw); return }
  okCell(k)
  if (v === st[field]) return
  const prev = st[field]
  st[field] = v
  cpMeterApi.updateStation(st.id, { name: st.name, operator: st.operator, vehicleType: st.vehicleType })
    .then(() => { if (field === 'operator') loadMonth() })   // 运营商改名 → 电表小节行键变,重取
    .catch((e) => {
      st[field] = prev
      receipt.fail((e as { message?: string })?.message ?? '保存失败，请重试')   // 重名 409 中文文案直达
    })
}

// ── 电表用电量(录入收编辑模式,EDIT-MODE-SPEC 2026-07-18 用户修订;乐观更新+PUT 回包校正) ──
function commitMeter(u: CpPowerUsageDTO, raw: string) {
  if (!editReading.value) return
  // 在途自守:fp-stale 的 pointer-events 挡不住**已聚焦**输入框的回车/失焦提交 ——
  // 那一下按的是新 year/month,写的却是旧期语境下的数
  if (reloading.value) return
  const k = `meter:${u.operator}`
  // ponytail: 后端无删除口(uk upsert),留空视为不动;录 0 表达"本月无用电"
  if (raw.trim() === '') { okCell(k); return }
  const v = Number(raw)
  if (!isFinite(v) || v < 0) { badCell(k, '请输入非负数字', raw); return }
  okCell(k)
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
      receipt.fail((e as { message?: string })?.message ?? '保存失败，请重试')
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
const formErr = ref('')                     // 记录行的字段报错(没选日期 / 填了负数),贴在抽屉表下面

function startAdd() {
  editId.value = null; adding.value = true; formErr.value = ''
  // 默认日期:当前月=今天(日记条顺手);历史月=月末。
  // today 就地取:期间块退场后没有模块级 today 了,这里本来也只用一次。
  const today = new Date()
  const isCur = year.value === today.getFullYear() && month.value === today.getMonth() + 1
  const d = isCur ? `${year.value}-${pad2(month.value)}-${pad2(today.getDate())}` : monthLast.value
  form.value = { readDate: d, chargeKwh: '', fee: '', revenue: '', note: '' }
}
function startEdit(r: (typeof drawerRows.value)[number]) {
  adding.value = false; editId.value = r.id; formErr.value = ''
  form.value = { readDate: r.readDate, chargeKwh: String(r.chargeKwh), fee: String(r.fee), revenue: String(r.revenue), note: r.note ?? '' }
}
function cancelForm() { editId.value = null; adding.value = false; formErr.value = '' }
watch(openSt, cancelForm)   // 换桩/关抽屉时收起编辑行
// 退出编辑模式收起一切写入口(v2:浏览态零写入口)。
// ⚠ 两个弹窗必须一起关:它们的 v-if 只判自己那个 ref,而 editMode 会**就地**转假
//   (被接管 / 30 分钟提权到期)—— 弹窗留着,里面的「新增」「确认导入」照样 POST,
//   浏览态下写库,写的还是一把已归别人的期锁。
watch(editMode, v => {
  if (v) return
  cancelForm()
  stationDlg.value = false
  if (!importBusy.value) importing.value = false   // 在跑的导入窗不收(D14)
})

async function saveForm() {
  if (!editReading.value) return
  if (!openSt.value) return
  const c = num(form.value.chargeKwh), f = num(form.value.fee), rv = num(form.value.revenue)
  formErr.value = !form.value.readDate ? '请选择日期' : c < 0 || f < 0 || rv < 0 ? '充电量 / 手续费 / 收益不能为负' : ''
  if (formErr.value) return
  const req = { stationId: openSt.value.id, readDate: form.value.readDate, chargeKwh: c, fee: f, revenue: rv, note: form.value.note.trim() || null }
  try {
    if (editId.value != null) await cpMeterApi.updateReading(editId.value, req)
    else await cpMeterApi.createReading(req)
    cancelForm()
    await reloadAfterWrite()   // 记录变动 → Σ充电量/损耗 + 矩阵着色一并刷新
  } catch (e) {
    // 同桩同日 409 等 → 后端中文 message 直达
    receipt.fail((e as { message?: string })?.message ?? '保存失败')
  }
}

async function delRow(id: number, date: string) {
  if (!editReading.value) return
  const ok = await ask({ title: `删除 ${date} 的充电记录？`, body: '删除后不能撤销。', action: '删除这条记录', danger: true })
  if (!ok || !editReading.value) return   // 问的途中被接管 / 授权到期:不写
  try { await cpMeterApi.deleteReading(id); await reloadAfterWrite() }
  catch (e) { receipt.fail((e as { message?: string })?.message ?? '删除失败') }
}

async function delStation() {
  if (!editStation.value) return
  const st = openSt.value
  if (!st) return
  const ok = await ask({ title: `删除充电桩「${st.name}」？`, body: '有充电记录的桩删不掉。', action: '删除充电桩', danger: true })
  if (!ok || !editStation.value) return   // 问的途中被接管 / 授权到期:不写
  try { await cpMeterApi.deleteStation(st.id); openSt.value = null; await loadStations(); await reloadAfterWrite() }
  catch (e) { receipt.fail((e as { message?: string })?.message ?? '删除失败') }   // 有记录 409 → 中文守卫文案
}

// ── 新增充电桩弹窗(名称/运营商/类型,类型默认当前屏) ──
const stationDlg = ref(false)
const stForm = ref({ name: '', operator: '', vehicleType: props.vehicleType as string })
const stErr = ref('')
// 只列有桩库权的车型(后端按请求的车型判 <屏>:archive)
const TYPE_OPTS = computed(() => [{ value: 'car', label: '汽车' }, { value: 'ebike', label: '电动车' }]
  .filter(o => auth.can(`${screenOf(o.value)}:archive`)))
function openStationDlg() {
  stForm.value = { name: '', operator: '', vehicleType: props.vehicleType }
  stErr.value = ''
  stationDlg.value = true
}
async function submitStation() {
  if (!editStation.value) return
  const name = stForm.value.name.trim()
  const operator = stForm.value.operator.trim()
  if (!name) { stErr.value = '请输入桩名'; return }
  if (!operator) { stErr.value = '请输入运营商'; return }
  try {
    await cpMeterApi.createStation({ name, operator, vehicleType: stForm.value.vehicleType as 'car' | 'ebike' })
    stationDlg.value = false
    await loadStations(); await reloadAfterWrite()   // 新运营商 → 电表小节新行
  } catch (e) {
    stErr.value = (e as { message?: string })?.message ?? '新增充电桩失败'   // 重名 409 中文文案
  }
}

// ── 导入(registry 闭环:解析→预览→确认→入库→import_log)/模板/导出 ──
const importing = ref(false)
// pvMeter 同款接线:解析期行级错误暂存 ctx._parseErrors,run 时并入结果——
// parserProps 与 runImport 必须同一 ctx 引用;每次解析整体覆写,无陈旧残留
const importCtx: ImportCtx = {}
// 导入弹窗的 runner(UI-OVERLAY-SPEC §8):弹窗不关,写 + 记 import_log → 刷新;失败交给弹窗的失败卡(不走回执)。
async function onImport(payload: ImportPayload, fileName: string, p?: ImportRunProgress): Promise<ImportOutcome | null> {
  if (!editReading.value) return null
  return settle(await runImport('cpMeter', payload as never, { ...importCtx, _run: p }, fileName), p, reloadAfterWrite)
}

// ── 模拟填充(编辑态;照 ElecCostView:确认弹窗→POST→结果回执→重载):按附表7/8 充电汇总推导当前年分桩月末记录与电表 ──
const simulating = ref(false)
const presence = usePresenceStore()
async function onSimulate() {
  if (!editMode.value || !canRun.value) return   // 模拟填充=两种桩整年的读数,两屏的读数权都要
  if (simulating.value) return
  // ⚠ simulate(year) 是**全类型**的:后端同时读附表7+8、写 car 与 ebike 两型的记录与电表行,
  //   而本屏只持 S.cpMeter(当前型, year) 一把锁 —— 不查对面就是绕过另一屏的期锁写对方的账。
  //   查在场表(presence 早就带回来了,同 watchScope 的判法),对面有人就不跑。
  const other = props.vehicleType === 'car' ? 'ebike' : 'car'
  const busyOn = () => presence.editorsUnder(S.cpMeter(other, year.value)).find(e => !e.self)
  // 没跑成不是出错,是「得等」:警告回执不自收,带「重试」—— 对面退出后点一下就行
  const again = { label: '重试', run: () => void onSimulate() }
  const otherEditor = busyOn()
  if (otherEditor) {
    receipt.warn(`模拟填充会同时写${other === 'ebike' ? '电动车' : '汽车'}侧的记录,而 ${otherEditor.displayName} 正在编辑那一侧的 ${year.value} 年 —— 等他退出编辑模式再跑。`, again)
    return
  }
  const ok = await ask({
    title: `模拟填充 ${year.value} 全年？`,
    body: '按附表7/8 各运营商的充电汇总推导各桩月末充电记录与电表用电量（一个运营商有几根桩时按假设比例拆，通道费 = 收益 × 5%，均为假设口径）。只填空位与既有「模拟」灰标记录，不覆盖手工录入和导入的数据。',
    action: `模拟填充 ${year.value} 全年`,
  })
  if (!ok || !editMode.value || !canRun.value) return
  // ⚠ 问的这段时间里对面可能进来 —— 上面那次检查读的
  //   名单是弹框**前**的,窗口宽度 = 用户读文案的时长(TOCTOU,复查坐实)。答完强制
  //   刷一拍再复查,把窗口收窄到一个往返 + 3 秒传播。残余窗口如实说明:服务端对 /simulate
  //   不查锁(锁在本仓是协作信号,scope 对服务端不透明,明写的架构取向)—— 这道闸是唯一防线。
  await presence.ping()
  const late = busyOn()
  if (late) {
    receipt.warn(`模拟填充会同时写${other === 'ebike' ? '电动车' : '汽车'}侧的记录,而 ${late.displayName} 正在编辑那一侧的 ${year.value} 年 —— 等他退出编辑模式再跑。`, again)
    return
  }
  simulating.value = true
  try {
    const r = await cpMeterApi.simulate(year.value)
    receipt.ok(`模拟完成：填充 ${r.filled} 条，跳过 ${r.skipped} 条（手工/导入占位、值未变或缺桩）。`)
    await Promise.all([loadStations(), loadMonth()])
    await loadMonths()   // 新写入的月要在选期矩阵上亮起来
  } catch (e) {
    receipt.fail((e as { message?: string })?.message ?? '模拟填充失败')
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
  catch (e) { receipt.fail((e as { message?: string })?.message ?? '导出失败', { label: '重试', run: () => void onExport() }) }
  finally { exporting.value = false }
}
async function onTemplate() {
  try { await buildCpMeterTemplate() }
  catch (e) { receipt.fail((e as { message?: string })?.message ?? '模板下载失败', { label: '重试', run: () => void onTemplate() }) }
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

  <!-- 桩清单一次都没拿到:没有它连表都铺不出来 —— 加载失败换掉整页内容(十件 ⑦,一律带重试) -->
  <div v-else-if="!stations && stationsErr" class="cm-gate-fail">
    <FPLoadError sub="表格按桩一行行铺,没有它这页显示不出来" @retry="loadStations">{{ stationsErr }}</FPLoadError>
  </div>

  <div v-else-if="!stations || !readings || !usageRows" class="page-loading"><span class="page-spin" /></div>

  <div v-else class="cm-page">
    <!-- 换期在途的唯一信号(§06 第一档):熬过 200ms 才亮 -->
    <FPLoadBar :on="veil" />
    <!-- 标题行 -->
    <div class="cm-head">
      <div class="cm-headl">
        <div>
          <div class="cm-titlerow">
            <h2 class="cm-title"><span class="ic"><component :is="iconFor('plug')" :size="18" /></span>分桩充电明细</h2>
            <!-- 页面状态(十件 ⑥):本型本月一条记录都没有。没读到时不贴 —— 没读到就不知道有没有 -->
            <FPStateTag v-if="!loadErr && myReadings.length === 0" tone="warn">本月还没有充电记录</FPStateTag>
          </div>
          <p class="cm-sub">逐桩按日期记条,自动汇月 · 充电量/手续费/收益从平台对账单抄录 · 电量 kWh / 金额 元</p>
        </div>
      </div>
      <!-- 桩增删=桩库档案(EDIT-MODE-SPEC + 本屏 :archive) -->
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
        <!-- 模拟填充=读附表7/8 整年批量派生(§5.3-⑥)→ billing-run,不是抄表权;客户园区不显(parkTools,2026-10-05 用户拍板「按你建议修改」;服务端同闸 DeployConfig) -->
        <Button v-if="editMode && canRun && appCfg.parkTools" variant="outline" size="sm" :disabled="simulating" @click="onSimulate">
          <template #leading><component :is="iconFor('wand-2')" :size="14" /></template>
          模拟填充
        </Button>
        <!-- 失败态/在途禁导出(照 PvMeterView):失败清成 [] 后导出的是全桩全零表,与真零月一致;
             换期在途时期标已是新期而数字是上一期的,文件离开系统后无从分辨 -->
        <!-- 悬停说明挂外面这层:钮禁用时自己收不到鼠标(同园区抄表) -->
        <span v-tip="loadErr ? '本月数据没读到,导出会得到一份全零的表 —— 先重试'
                    : reloading ? '本期记录还在路上,现在导出拿到的是上一期的数' : undefined" class="cm-ebtn">
          <Button variant="filled" size="sm" :disabled="exporting || !!loadErr || reloading" @click="onExport">
            <template #leading><component :is="iconFor('download')" :size="14" /></template>
            导出
          </Button>
        </span>
        <!-- 编辑模式:本屏三把写权限任一有即可进(模拟填充只需 billing-run),进去后各按钮再各判各的 -->
        <!-- 失败态禁"进"不禁"出"(组件的 :disabled 不分编辑态,不带 !editMode 会把「完成」也禁掉 → 死锁) -->
        <span v-tip="!editMode && loadErr ? '本月数据没读到,先点「重试」再进编辑' : undefined" class="cm-ebtn">
          <FPEditModeButton :edit="editMode" :held-by-other="heldByOther" :can-enter="canEnter"
                            :disabled="!editMode && !!loadErr"
                            @toggle="toggleEdit()" />
        </span>
      </div>
    </div>

    <!-- 加载失败(十件 ⑦,LAYOUT-STABILITY §3):换掉下面两张卡本身,不是卡上方的流内条。
         两份数据各自成行,别让一条盖掉另一条的原因;失败时 readings / usageRows 已清空,写入口与导出全关 -->
    <FPLoadError v-if="loadErr" :sub="readErr ? `${readErr} · 屏上不显示上个月的数字` : undefined" @retry="retryLoad">
      <div class="msg">
        <div v-if="readErr">{{ year }} 年 {{ month }} 月的充电记录没读到</div>
        <div v-if="stationsErr">{{ stationsErr }}</div>
      </div>
    </FPLoadError>

    <template v-else>
    <!-- 主表:一行一桩;列宽铁律(fixed 布局,各列按内容定宽,余宽落进行末空列 .fp-fill,LIST-PAGE §4 2026-10-02)。fp-stale 带 pointer-events:none -->
    <Card surface="white" :padding="0" class="cm-card"
          :class="{ 'fp-stale': veil }" :aria-busy="veil">
      <!-- 本型本月一条记录都没有、又不在能录的编辑态 → 空状态占住表格区(十件 ⑦)。
           ⚠ 编辑态不换:点桩行开抽屉是逐条录入的入口(同园区抄表) -->
      <FPEmpty v-if="myReadings.length === 0 && !editReading" class="cm-empty"
               :sub="canReading ? '进入「编辑模式」后可以导入整月充电明细 Excel,或点桩行逐条录入。' : '这个月各桩的充电记录都还没录。'">
        {{ year }} 年 {{ month }} 月还没有充电记录
      </FPEmpty>
      <div v-else class="cm-tablewrap">
        <table class="cm-table">
          <colgroup>
            <col :style="{ width: stNameW + 'px' }" /><!-- 桩名:按内容定宽 -->
            <col style="width:110px" />
            <col style="width:120px" />
            <col style="width:120px" />
            <col style="width:120px" />
            <col style="width:84px" />
            <col /><!-- 行末空列 .fp-fill:余宽落这里 -->
          </colgroup>
          <thead>
            <tr>
              <th>充电桩</th>
              <th>运营商</th>
              <th class="num">本月充电量 (kWh)</th>
              <th class="num">手续费 (元)</th>
              <th class="num">收益 (元)</th>
              <th class="num">记录条数</th>
              <th class="fp-fill" aria-hidden="true"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.st.id" @click="openSt = r.st">
              <!-- 桩名/运营商=站点常量:编辑模式行内改(点击不冒泡开抽屉),浏览态纯文本 -->
              <td class="name" v-tip="r.st.name">
                <span v-if="editStation" class="cm-fld">
                  <input class="cm-edit l" :class="{ bad: errOf(`name:${r.st.id}`) }" type="text"
                         :value="rawOf(`name:${r.st.id}`, r.st.name)" :aria-invalid="errOf(`name:${r.st.id}`) ? 'true' : undefined"
                         v-tip="'桩名,回车/失焦保存(需唯一)'"
                         @click.stop
                         @change="commitStation(r.st, 'name', ($event.target as HTMLInputElement).value)" />
                  <span class="fp-field-err cm-cellerr"><template v-if="errOf(`name:${r.st.id}`)">{{ errOf(`name:${r.st.id}`) }}</template></span>
                </span>
                <span v-else class="nm">{{ r.st.name }}</span>
              </td>
              <td v-tip="r.st.operator">
                <span v-if="editStation" class="cm-fld">
                  <input class="cm-edit l" :class="{ bad: errOf(`operator:${r.st.id}`) }" type="text"
                         :value="rawOf(`operator:${r.st.id}`, r.st.operator)" :aria-invalid="errOf(`operator:${r.st.id}`) ? 'true' : undefined"
                         v-tip="'运营商,回车/失焦保存'"
                         @click.stop
                         @change="commitStation(r.st, 'operator', ($event.target as HTMLInputElement).value)" />
                  <span class="fp-field-err cm-cellerr"><template v-if="errOf(`operator:${r.st.id}`)">{{ errOf(`operator:${r.st.id}`) }}</template></span>
                </span>
                <span v-else>{{ r.st.operator }}</span>
              </td>
              <td class="num" :class="{ zero: r.charge === 0 }">{{ fq(r.charge) }}</td>
              <td class="num" :class="{ zero: r.fee === 0 }">{{ fy(r.fee) }}</td>
              <td class="num rev" :class="{ zero: r.revenue === 0 }">{{ fy(r.revenue) }}</td>
              <td class="num" :class="{ zero: r.count === 0 }">{{ r.count }}</td>
              <td class="fp-fill" aria-hidden="true"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>

    <!-- 电表与损耗小节(spec §2):每运营商一行;电表量录入收编辑模式(EDIT-MODE-SPEC 2026-07-18 用户修订) -->
    <!-- ⚠ fp-stale 必须跟上(复查坐实的移植错位):换期在途窗口里这张卡不变灰不禁点,
         commitMeter 按新 year/month upsert —— 把旧期语境下敲的电表数写进新期的行,
         损耗派生跟着全错。样板只有一张卡,本屏第二张带写入口的卡当初忘了盖。 -->
    <Card v-if="myUsage.length" surface="white" :padding="0" class="cm-usage"
          :class="{ 'fp-stale': veil }" :aria-busy="veil">
      <div class="cm-usage-head">
        <span class="t"><component :is="iconFor('zap')" :size="14" />电表与损耗</span>
        <span class="s">每运营商每月一条电表用电量 · 损耗 = 电表 − Σ充电量(读时派生,负值黄警示不阻断){{ canReading && !editMode ? ' · 编辑模式下可录改电表值' : '' }}</span>
      </div>
      <table class="cm-utable">
        <colgroup>
          <col :style="{ width: usageOpW + 'px' }" /><!-- 运营商:按内容定宽 -->
          <col style="width:160px" />
          <col style="width:160px" />
          <col style="width:160px" />
          <col /><!-- 行末空列 .fp-fill:余宽落这里 -->
        </colgroup>
        <thead>
          <tr>
            <th>运营商</th>
            <th class="num">电表用电量 kWh</th>
            <th class="num">Σ充电量 kWh</th>
            <th class="num">损耗 kWh</th>
            <th class="fp-fill" aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in myUsage" :key="u.operator">
            <td>{{ u.operator }}</td>
            <td class="num">
              <span v-if="editReading" class="cm-fld">
                <input class="cm-edit" :class="{ bad: errOf(`meter:${u.operator}`) }" type="number" min="0" step="0.01"
                       :value="rawOf(`meter:${u.operator}`, u.meterKwh)" placeholder="未录"
                       :aria-invalid="errOf(`meter:${u.operator}`) ? 'true' : undefined" v-tip="'电表用电量,回车/失焦保存'"
                       @change="commitMeter(u, ($event.target as HTMLInputElement).value)" />
                <span class="fp-field-err cm-cellerr"><template v-if="errOf(`meter:${u.operator}`)">{{ errOf(`meter:${u.operator}`) }}</template></span>
              </span>
              <span v-else>{{ u.meterKwh != null ? fq(u.meterKwh) : '—' }}</span>
            </td>
            <td class="num">{{ fq(u.sumChargeKwh) }}</td>
            <td class="num" :class="{ loss: u.lossKwh != null && u.lossKwh < 0 }"
                v-tip="u.lossKwh != null && u.lossKwh < 0 ? '电表用电量小于充电量之和,请核对电表读数或充电记录' : undefined">
              {{ u.lossKwh != null ? fq(u.lossKwh) : '—' }}
            </td>
            <td class="fp-fill" aria-hidden="true"></td>
          </tr>
        </tbody>
      </table>
    </Card>
    </template>

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
      <!-- 只判 readErr 不判合并槽:桩档案挂掉时记录是好好的,拿 loadErr 拦会藏掉真实记录 -->
      <FPLoadError v-if="readErr" :sub="`${readErr} · 屏上不显示上个月的数字`" @retry="retryLoad">{{ year }} 年 {{ month }} 月的充电记录没读到</FPLoadError>
      <FPEmpty v-else-if="drawerRows.length === 0 && !adding" size="sm"
               :sub="editReading ? '点下方「新增记录」手动录入,或在列表页「导入」整月 Excel。' : canReading ? '进入编辑模式后可录入或导入。' : undefined">
        这个桩 {{ month }} 月还没有充电记录
      </FPEmpty>
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
                <td class="l"><DatePicker v-model="form.readDate" variant="cell" short :min="monthFirst" :max="monthLast" field-id="cp-read-date" aria-label="日期" /></td>
                <td><input v-model="form.chargeKwh" class="cm-din num" type="number" min="0" step="0.01" /></td>
                <td><input v-model="form.fee" class="cm-din num" type="number" min="0" step="0.01" /></td>
                <td><input v-model="form.revenue" class="cm-din num" type="number" min="0" step="0.01" /></td>
                <td class="l"><input v-model="form.note" class="cm-din" type="text" placeholder="备注" /></td>
                <td class="ops">
                  <button class="cm-iop ok" v-tip="'保存'" @click="saveForm"><component :is="iconFor('check')" :size="15" /></button>
                  <button class="cm-iop" v-tip="'取消'" @click="cancelForm"><component :is="iconFor('x')" :size="15" /></button>
                </td>
              </tr>
              <tr v-else>
                <td class="l mono">{{ r.readDate }}</td>
                <td>{{ fq(r.chargeKwh) }}</td>
                <td>{{ fy(r.fee) }}</td>
                <td>{{ fy(r.revenue) }}</td>
                <!-- simulated 灰「模拟」徽标随备注列(挤日期列会撑爆列宽;模拟 note 本就以「模拟:」开头同列语义顺),录改后转 manual 自动消失 -->
                <td class="l note" v-tip="r.note ?? undefined"><span v-if="r.source === 'simulated'" class="cm-sim" v-tip="r.note ?? '模拟数据'">模拟</span>{{ (r.source === 'simulated' ? (r.note ?? '').replace(/^模拟[:：]/, '') : r.note) || '—' }}</td>
                <td v-if="editReading" class="ops">
                  <button class="cm-iop" v-tip="'编辑'" @click="startEdit(r)"><component :is="iconFor('pencil')" :size="14" /></button>
                  <button class="cm-iop danger" v-tip="'删除'" @click="delRow(r.id, r.readDate)"><component :is="iconFor('trash-2')" :size="14" /></button>
                </td>
              </tr>
            </template>
            <!-- 新增行 -->
            <tr v-if="adding" class="editing">
              <td class="l"><DatePicker v-model="form.readDate" variant="cell" short :min="monthFirst" :max="monthLast" field-id="cp-read-date" aria-label="日期" /></td>
              <td><input v-model="form.chargeKwh" class="cm-din num" type="number" min="0" step="0.01" /></td>
              <td><input v-model="form.fee" class="cm-din num" type="number" min="0" step="0.01" /></td>
              <td><input v-model="form.revenue" class="cm-din num" type="number" min="0" step="0.01" /></td>
              <td class="l"><input v-model="form.note" class="cm-din" type="text" placeholder="备注" /></td>
              <td class="ops">
                <button class="cm-iop ok" v-tip="'保存'" @click="saveForm"><component :is="iconFor('check')" :size="15" /></button>
                <button class="cm-iop" v-tip="'取消'" @click="cancelForm"><component :is="iconFor('x')" :size="15" /></button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- 记录行的字段报错(十件 ⑤):行开着时常驻一行,贴在表下面(同园区抄表的读数行) -->
      <template v-if="adding || editId != null"><p class="fp-field-err">{{ formErr }}</p></template>

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
    <div v-if="stationDlg" class="cm-mask" :class="{ 'fp-fsheet': sheet }" @mousedown="stationDlg = false">
      <div class="cm-dlg" @mousedown.stop>
        <div class="cm-dlg-h">
          <h3>新增充电桩</h3>
          <p>按桩(站)新增;类型默认当前屏,桩名全局唯一。桩名/运营商之后可在编辑模式下行内修改。</p>
        </div>
        <div class="cm-dlg-b fp-fsheet-bd">
          <Input v-model="stForm.name" label="桩名" placeholder="如:快充2" size="sm" />
          <div class="cm-dlg-row">
            <Input v-model="stForm.operator" label="运营商" placeholder="如:XX充电" size="sm" />
            <div style="width:120px">
              <Select v-model="stForm.vehicleType" label="类型" :options="TYPE_OPTS" size="sm" />
            </div>
          </div>
          <p class="fp-field-err"><template v-if="stErr">{{ stErr }}</template></p>
        </div>
        <div class="cm-dlg-f fp-fsheet-ft">
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
      :runner="onImport"
      @close="importing = false"
    />
    <FPElevateDialog
      :page="`充电桩分桩明细 · ${year} 年`" :action="'修改桩库档案 / 抄表记录'" :perms="asking" what="维护充电桩表档案" @close="cancelAsk" @elevated="onElevated" />
    <FPLockDialogs :locked-by="lockedBy" :evicted-by="evictedBy" :scope="lockScope()"
                   :what="`充电桩分桩明细 ${year} 年`"
                   @taken="onTaken" @close-takeover="lockedBy = null" @close-evicted="evictedBy = null" />
  </div>
</template>

<style scoped>
/* 骨架与 PvMeterView pm-* 同构(cm- 前缀);差异:主表下多「电表与损耗」小节 */
.cm-permonth {
  display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto;
  padding: 5px 10px; border: 1px solid var(--border-control); border-radius: var(--radius-sm);
  background: var(--surface-white); cursor: pointer;
  font-family: var(--font-sans); font-size: var(--fs-label); color: var(--text-muted);
  transition: color var(--dur-fast), border-color var(--dur-fast);
}
.cm-permonth:hover { color: var(--hue-blue); border-color: var(--hue-blue); }
.cm-per { flex: 0 0 auto; font-family: var(--font-mono); font-size: 13px; font-weight: var(--fw-bold); }
.cm-ebtn { display: inline-flex; flex: 0 0 auto; }

/* 加载失败换掉整页:FPEmpty 只长不缩,给它一根撑满的纵向 flex */
.cm-gate-fail { display: flex; flex-direction: column; height: 100%; }
/* position: relative —— FPLoadBar 是 absolute,宿主不给参照它会认 AppShell 的 .fp-main-card */
.cm-page { position: relative; display: flex; flex-direction: column; gap: 16px; height: 100%; min-height: 0; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%; }

/* ── 标题行 ── */
.cm-head { flex: 0 0 auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.cm-headl { display: flex; align-items: center; gap: 12px; min-width: 0; }
.cm-titlerow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cm-title { margin: 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.cm-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.cm-sub { margin: 5px 0 0; font-size: var(--fs-label); color: var(--text-muted); }

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
.cm-edit:hover { border-color: var(--border-control); background: var(--surface-white); }
.cm-edit:focus { outline: none; border-color: var(--hue-blue); background: var(--surface-white); }
.cm-edit::placeholder { color: var(--text-disabled); }
.cm-edit.l { text-align: left; font-family: var(--font-sans); }

/* ── 行内格的字段报错(十件 ⑤):红字贴在输入框正下方,浮在格子下沿 —— 不撑行高、不挪同行别的格。
   只在出错时有字;最后一行翻到输入框上方,免得被卡片裁掉。框变红跟着。 ── */
.cm-fld { position: relative; display: flex; min-width: 0; }
.cm-table td:has(> .cm-fld), .cm-utable td:has(> .cm-fld) { overflow: visible; }
.cm-cellerr { position: absolute; left: 0; top: 100%; z-index: 2; padding: 0 4px; border-radius: var(--radius-sm); background: var(--surface-white); white-space: nowrap; pointer-events: none; }
td.num .cm-cellerr { left: auto; right: 0; }
.cm-table tbody tr:last-child .cm-cellerr, .cm-utable tbody tr:last-child .cm-cellerr { top: auto; bottom: 100%; }
.cm-cellerr:empty { display: none; }
.cm-edit.bad, .cm-edit.bad:hover, .cm-edit.bad:focus { border-color: var(--delta-down-text); }

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
.cm-din { width: 100%; box-sizing: border-box; height: 30px; padding: 0 8px; border: 1px solid var(--border-control); border-radius: var(--radius-sm); background: var(--surface-white); font-family: var(--font-sans); font-size: 12.5px; color: var(--text-primary); transition: border-color var(--dur-fast) var(--ease-standard); }
.cm-din.num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; appearance: textfield; -moz-appearance: textfield; }
.cm-din.num::-webkit-outer-spin-button, .cm-din.num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.cm-din:focus { outline: none; border-color: var(--hue-blue); }
.cm-iop { width: 26px; height: 26px; border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-muted); display: inline-grid; place-items: center; transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.cm-iop:hover { background: var(--bg-hover); color: var(--text-primary); }
.cm-iop.ok:hover { color: var(--hue-blue); }
.cm-iop.danger:hover { background: var(--danger-soft); color: var(--hue-red); }

/* ── 新增充电桩弹窗(样式同 PvMeterView pm-dlg 家族) ── */
.cm-mask { position: fixed; inset: 0; background: var(--scrim); z-index: 140; display: grid; place-items: center; }
.cm-dlg { width: min(420px, 90vw); background: var(--surface-white); border-radius: var(--radius-xl); box-shadow: 0 16px 48px rgba(28, 28, 28, .22); overflow: hidden; }
.cm-dlg-h { padding: 20px 22px 0; }
.cm-dlg-h h3 { margin: 0; font-size: 16px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.cm-dlg-h p { margin: 6px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-muted); }
.cm-dlg-b { padding: 16px 22px 4px; display: flex; flex-direction: column; gap: 12px; }
.cm-dlg-row { display: flex; gap: 12px; }
.cm-dlg-row > * { flex: 1; min-width: 0; }
.cm-dlg-f { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 22px 20px; }
</style>
