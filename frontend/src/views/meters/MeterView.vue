<script setup lang="ts">
// 园区抄表 v5.1 壳(METER-V5-SPEC §1+§7):账期驱动的台账同款电子表格工作台,无段切换。
// 标题行(账期年月+抄表进度条+常驻/编辑态按钮)+6 张可点击统计卡(点=状态筛选互斥切换)+
// 筛选条(电水/分区/楼栋/归属/状态/搜索/重置)+MeterLedgerGrid+MeterDetailDrawer。
// 数据装载/竞态守卫(rSeq/bSeq)/绑定降级/导入链(registry 'meter')延续 v4 口径。
// 草稿式编辑(§7.2):draft 归属本层;「完成」dirty>0 弹 SaveConfirmDialog,保存=逐变更表
// POST(无读数)/PUT(有),行级失败收集 alert 并保留 dirty;放弃=丢 draft 回浏览态。
// 编辑态不跨会话(onDeactivated 复位含 draft,EDIT-MODE-SPEC v2)。
import { ref, computed, reactive, onMounted, onDeactivated, watch } from 'vue'
import FPEditModeButton from '@/components/fp/FPEditModeButton.vue'
import FPReviewActions from '@/components/fp/FPReviewActions.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import { onReactivated } from '@/composables/onReactivated'
import { useChainDeepPeriod } from '@/composables/useDeepPeriod'
import { tenantMatchNames } from '@/utils/tenantAlias'
import {
  metersApi, type MeterDTO, type MeterReadingDTO, type MeterBindingRowDTO,
  type MeterDeleteDTO, type MeterKind,
} from '@/api/meters'
import { tenantApi } from '@/api/tenant'
import { buildingApi } from '@/api/building'
import type { TenantDTO } from '@/types/tenant'
import type { BuildingDTO } from '@/types/building'
import {
  buildRows, filterRows, cardCounts, autoLinkEstimate, isPendingMeter,
  draftDirtyIds, draftReq, healRows, bookGapText,
  type StatusFilter, type MeterDraft, type DraftField,
} from '@/composables/useMeterWorkbench'
import DatePicker from '@/components/ds/DatePicker.vue'
import { buildMeterTemplate, exportMeterMonth } from '@/utils/meterExcel'
import { OWNERSHIP_LABEL, ownershipLabel } from '@/utils/meterSplit'
import { parserProps, runImport, type ImportCtx } from '@/utils/importRegistry'
import type { ImportResultDTO } from '@/types/import'
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { useAuthStore } from '@/stores/auth'
import { useFormSheet } from '@/composables/useFormSheet'
import { useZonesStore } from '@/stores/zones'
import FPElevateDialog from '@/components/fp/FPElevateDialog.vue'
import FPLockDialogs from '@/components/fp/FPLockDialogs.vue'
import FPToast from '@/components/fp/FPToast.vue'
import { S } from '@/utils/lockScopes'
import { useEditMode } from '@/composables/useEditMode'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { chainStepsOf } from '@/nav/billingChain'
import ChainMonthGate from '@/components/fp/ChainMonthGate.vue'
import FPStepStrip from '@/components/fp/FPStepStrip.vue'
import FPMoreMenu from '@/components/fp/FPMoreMenu.vue'
import { useViewport } from '@/composables/useViewport'
import { useTopBarAction } from '@/composables/useTopBarAction'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Input from '@/components/ds/Input.vue'
import Select from '@/components/ds/Select.vue'
import Segmented from '@/components/ds/Segmented.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import SaveConfirmDialog from '@/components/import/SaveConfirmDialog.vue'
import MeterLedgerGrid from './MeterLedgerGrid.vue'
import MeterDetailDrawer from './MeterDetailDrawer.vue'
import './meter-shared.css'

const auth = useAuthStore()
// 新增表弹卡带输入 → S 档全屏 sheet;批量删除预览只是复述 + 勾选,按判据仍是居中小卡
// (styles/form-sheet.css)。
const sheet = useFormSheet()
// 档位判定走 useViewport(jsdom/SSR 无 matchMedia 恒 'xl'),宽档分支一个字不动
// (RESPONSIVE-LAYOUT-SPEC §9;同 LedgerWideTable:212)。S 档那几块整条挂 v-if="isS",
// 宽档 DOM 里根本不存在 —— 故它们的 CSS 不再套 @media。
const { tier } = useViewport()
const isS = computed(() => tier.value === 's')
// M 档(601–960,§5.10「M 档」):同样不画标题行(平板顶栏也写着屏名)、筛选同样收
// (736 内宽装不下 7 件),只有主动作留 2 个。
// ⚠ **M 档看不见手机顶栏**:AppShell.vue:162 是 `v-if="tier !== 's'"` → 桌面 TabStrip + Toolbar,
//   :168 的 v-else 才挂 MobileTopBar。所以 M 档的那 2 个主动作只能留在屏内流里,
//   在 M 档登记 useTopBarAction 是空转(规范 §5.10「M 档」按「走同一套」写,与实现不符)。
const isM = computed(() => tier.value === 'm')
const isSM = computed(() => isS.value || isM.value)
/** S 档底部面板:'filter' = 收进去的筛选件;'more' = 摘要行里值为 0 的那几样。 */
const panel = ref<'' | 'filter' | 'more'>('')
// RBAC v2(读全开写分权):抄读数与改表档案是两把权限,别一刀切 ——
// 读数(录入/导入/批量删本期)= meter-reading:edit;表档案(新增表/一键挂/抽屉里的倍率绑定删表)= meter-master:edit。
// 无权只是不出写按钮,数据照常全显。
const canReading = computed(() => auth.can('meter-reading:edit'))
const canMaster = computed(() => auth.can('meter-master:edit'))

// ── 编辑模式(EDIT-MODE-SPEC v3):切页签**保留**编辑态与草稿,只关浮层 ──
// v2 在这里 draft.clear() —— 切去别的页面核对一眼回来,没保存的读数全没了。
// 那正是用户点名要改的行为(2026-08-22)。浮层仍要关:Teleport 到 body,不随实例停用移出。
/** 弹卡标题的人话名。前端没有 kind→人话名映射表,各屏自己拼(新开一份 = 后端 ReviewKind 的第二份)。 */
const reviewLabel = computed(() => `园区抄表 · ${ym.value}`)
const { editMode, canEnter, missing: lockedPerms, asking, askFor, cancelAsk, onElevated, exit: exitEdit, heldByOther, toggle,
        lockedBy, evictedBy, lockScope, onTaken, reviewNote, reviewTip, reviewKeys } =
  useEditMode(['meter-reading:edit', 'meter-master:edit'], {
    scope: () => S.meters(year.value),
    // 审核键(§7.1):抄表屏**按年锁、按月审**。屏上编辑的确实是单月读数
    // (loadReadings(ym) / draft 按 ym 清),所以键取 ym 不取 year。
    reviewKey: () => (ym.value ? `meters:${ym.value}` : null),
  })
const importing = ref(false)
const okMsg = ref('')
const toastTone = ref<'success' | 'warning'>('success')
const openId = ref<number | null>(null)
onDeactivated(() => {
  importing.value = false; openId.value = null
  saveConfirm.value = false; delPreview.value = null; asking.value = null
  panel.value = ''
})

const pad2 = (n: number) => String(n).padStart(2, '0')

// ── 账期:出账链组级(stores/billingPeriod,2026-08-28 设计稿 §3.1) ──
// 顶栏那对年月 Select 已撤 —— 期由出账月矩阵一处选定,五屏共读一份,不可能再各落各的
// (它们抢的本来就是同一把 billing-chain 月锁)。「默认账期」那一整套
// (xxxApi.years() + /months + latestPeriodOf 的 snap)随之退场:期一定是用户在矩阵上点出来的,
// 没有「系统替你猜一个月」这回事 —— 那正是 §7-1 禁的「顺手落进某个期」。
const period = useBillingPeriodStore()
const year = computed(() => period.year ?? 0)
const month = computed(() => period.month ?? 0)
const ym = computed(() => period.ym ?? '')
// 链路条:本月各道工序走到哪(与矩阵格子同一份数据)
const chainSteps = computed(() => chainStepsOf(period.cellOf(ym.value)))
const prevYm = computed(() =>
  month.value === 1 ? `${year.value - 1}-12` : `${year.value}-${pad2(month.value - 1)}`)

// ── 数据 ──
const meters = ref<MeterDTO[] | null>(null)
const readings = ref<MeterReadingDTO[] | null>(null)
const prevReadings = ref<MeterReadingDTO[]>([])
const tenants = ref<TenantDTO[]>([])
const buildings = ref<BuildingDTO[]>([])
const tenantNameById = computed(() => new Map(tenants.value.map(t => [t.id, t.companyName])))
const buildingNameById = computed(() => new Map(buildings.value.map(b => [b.id, b.name])))

// 加载失败态(P1-5):两路都要打回可见失败 + 重试入口,不能只剩转圈或旧数据顶着
const metersErr = ref('')
const readErr = ref('')
// 表档案按月(METER-TIMELINE-SPEC §2):站在 ym 看的那一段,切月必须重拉。
// metersYm / readYm = 手上这两份数据是哪个月的 —— 切月途中两份可能还是旧月,导出要靠它们认
const metersYm = ref('')
const readYm = ref('')
let mSeq = 0
async function loadMeters() {
  const my = ++mSeq
  const at = ym.value
  try {
    const list = await metersApi.list(undefined, undefined, at || undefined)
    if (my !== mSeq) return
    meters.value = list; metersYm.value = at; metersErr.value = ''
  } catch {
    if (my !== mSeq) return
    // 首载失败若不记,整页永久停在骨架屏(meters 恒 null),连个重试入口都没有。
    // 切了月又没拉到:手上那份是别的月的档案(租户、在不在册都可能不同),不许冒充本月 → 整页失败态
    if (metersYm.value !== at) meters.value = null
    metersErr.value = '表档案加载失败，请重试'
  }
}
// 竞态守卫同 v4:切期保留旧数据到新数据落位,不闪 gate;上月读数供「上月行至」基准
let rSeq = 0
async function loadReadings() {
  const my = ++rSeq
  const at = ym.value
  try {
    const [cur, prev] = await Promise.all([
      metersApi.readings(at),
      metersApi.readings(prevYm.value).catch(() => [] as MeterReadingDTO[]),   // 上月缺失是正常业务态,不算失败
    ])
    if (my !== rSeq) return
    readings.value = cur; prevReadings.value = prev; readYm.value = at
    readErr.value = ''
  } catch {
    if (my !== rSeq) return
    // 关键:打回「无数据」,绝不留旧月数据冒充新月 —— 年月已经切了,旧数组还挂着,
    // 用户在那些行上录一格,保存走的是旧行 id 的 PUT,直接覆盖上个账期的读数
    readings.value = []
    readErr.value = '本月读数加载失败，请重试'
  }
}
// 失败态锁录入:此刻「本月」列空着不是「没抄」而是「没读到」,在上面录=覆盖旧月或凭空补条;
// 档案没拉到时,行上的在不在册 / 底数都不是本月的样子,同样不许录
// 无 meter-reading:edit 的人即使进了编辑模式(靠 meter-master)也不许录格子:格子写的是读数
const loadErr = computed(() => !!(readErr.value || metersErr.value))
const editable = computed(() => editMode.value && !loadErr.value && canReading.value)
function retryLoad() {
  if (metersErr.value) loadMeters()
  if (readErr.value) loadReadings()
}
// 绑定数据(S2 §3):失败降级(null+bindFail),不阻断整页
const bindRows = ref<MeterBindingRowDTO[] | null>(null)
const bindFail = ref(false)
let bSeq = 0
async function loadBinding() {
  if (!period.picked) return   // 还没选期(主区是选期矩阵):ym 是 '',后端按格式校验直接 400
  const my = ++bSeq
  try {
    const d = await metersApi.binding(ym.value)
    if (my === bSeq) { bindRows.value = d.rows; bindFail.value = false }
  } catch {
    if (my === bSeq) { bindRows.value = null; bindFail.value = true }
  }
}
// ── 草稿式编辑(§7.2):draft 归属本层,表格只读取+emit cell-edit ──
const draft = reactive(new Map<number, MeterDraft>())
const saveConfirm = ref(false)
const saving = ref(false)
const dirtyIds = computed(() => draftDirtyIds(rowsAll.value, draft))
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM 直落该月,pick + loadChain。本屏是链上唯一有草稿的屏:
// 切回时地址栏要求别的月而草稿未保存 → 不切期,只在 deepNote 里说(换期会 draft.clear(),见下面 watch(ym))。
// 首跑不查 dirty(全新实例没有草稿);必须在 onMounted / watch(ym) 之前调用。
const { note: deepNote } = useChainDeepPeriod(() => dirtyIds.value.length)
const rowById = computed(() => new Map(rowsAll.value.map(x => [x.m.id, x])))
// 退出编辑(保存成功/无改动/放弃)统一丢草稿:等值残留也不带回浏览态
// 退出编辑模式收起一切写入口。
// ⚠ 三个弹窗必须一起关。它们的 v-if 只判自己那个 ref,不判编辑态,而 editMode 会**就地**转假
//   (别人走接管 → presence.handleEviction → exit();或 30 分钟提权到期)。
//   最狠的是 delPreview:「批量删除本期」的确认框连账期都已经打好,接管之后按钮照样可点,
//   一下打出整月读数 + 该月派生快照 + 删完零读数的表档案的不可逆删除 ——
//   而那个月正握在刚接管的人手里。后端写口不校验锁,拦不住。
watch(editMode, v => {
  if (v) return
  draft.clear()
  saveConfirm.value = false
  importing.value = false
  meterDlg.value = false
  delPreview.value = null
})

function onCellEdit(p: { meterId: number; field: DraftField; value: string }) {
  draft.set(p.meterId, { ...draft.get(p.meterId), [p.field]: p.value })
}
// 编辑模式按钮:进=开编辑;编辑中点「完成」dirty>0 弹确认,无改动直接退出
async function onEditBtn() {
  if (!editMode.value) {
    // 缺任何一项就当场弹授权窗;取消 = 什么都没发生,留在浏览态(useEditMode 铁律 ①)
    if (lockedPerms.value.length) { askFor(); return }
    // ⚠ 这里以前是裸的 `editMode.value = true` —— **绕过了占锁**。
    //   表现:两个人能同时进本屏的编辑态,而且谁也看不到对方(锁根本没占,在场表里也没有)。
    //   必须走 toggle()，它才是「权限齐 → 占锁 → 进」那条唯一的路。
    await toggle()
    return
  }
  if (dirtyIds.value.length > 0) { saveConfirm.value = true; return }
  exitEdit()          // 退出编辑 = 结束授权(ELEVATION-SPEC)
}
// 保存修改:逐变更表 POST(无读数)/PUT(有);行级失败收集 alert 并保留该行 dirty
async function onSaveChanges() {
  saveConfirm.value = false
  if (!editMode.value || !canReading.value) return
  if (saving.value) return
  // SPEC §3.4:本月还不在册的表录了本月读数,后端会让它自本月起在册 —— 先说清楚再存
  const heal = healRows(rowsAll.value, draft)
  if (heal.length && !confirm(`${heal.length} 块表本月还不在册:${heal.slice(0, 5).map(x => x.tenantLabel ?? x.m.name).join('、')}`
    + `${heal.length > 5 ? ' 等' : ''}。存下本月读数后,${heal.length > 1 ? '它们' : '这块表'}将从 ${ym.value} 起在册。继续保存?`)) return
  saving.value = true
  const fails: string[] = []
  for (const id of dirtyIds.value.slice()) {
    const x = rowById.value.get(id)
    if (!x) { draft.delete(id); continue }   // 表已被删(抽屉侧):丢弃该草稿
    try {
      const req = draftReq(x, draft.get(id), ym.value)
      if (x.r) await metersApi.updateReading(x.r.id, req)
      else await metersApi.createReading(req)
      draft.delete(id)
    } catch (e) {
      fails.push(`${x.tenantLabel ?? x.m.tenantName ?? x.m.name}:${(e as { message?: string })?.message ?? '保存失败'}`)
    }
  }
  saving.value = false
  reloadAll()
  if (fails.length > 0) alert(`${fails.length} 块表保存失败(改动已保留,可重试):\n${fails.join('\n')}`)
  // ⚠ 走 exitEdit() 而不是直接置 false:退出编辑必须同时结束授权。
  //   直接改 ref 的话,主管刚授权的 30 分钟会在保存成功后继续挂着
  //   (本页三条退出路径,只有这条曾经漏了)。
  else exitEdit()
}
// 放弃修改:丢 draft 回浏览态
function onDiscardChanges() {
  saveConfirm.value = false
  draft.clear()
  exitEdit()
}

// 主数据清单拉取失败不阻断:租户/楼栋列显 '—',picker 候选空
function loadMasters() {
  tenantApi.list().then(v => { tenants.value = v; importCtx.tenantNames = v.flatMap(t => tenantMatchNames(t)) }).catch(() => {})
  buildingApi.list().then(v => { buildings.value = v; importCtx.buildings = v }).catch(() => {})
  // 期区清单喂导入(meter sheet 名反查用);ensure() 拉不到留空数组,importCtx.zones 也就留空 → meterExcel 回落写死三区
  zones.ensure().then(() => { importCtx.zones = zones.list })
}
// 页签切回:租户改名/楼栋变更后清单回拉,合同增删改后绑定候选回拉(浏览状态保留);
// 表档案也回拉 —— 合同终止会写解约次月起的空置行(METER-TIMELINE-SPEC §3.6),不拉就和刚拉的绑定对不上
onReactivated(() => { loadMasters(); loadBinding(); if (period.picked) loadMeters() })

onMounted(() => {
  loadMasters()
  // 没选期时主区是选期矩阵,档案也不拉(按月的档案没有月份可站)
  if (period.picked) { loadMeters(); loadReadings(); loadBinding() }
})
// 换账期:上月基准/读数/站在该月的档案全变,草稿随之作废(ponytail: 静默丢弃,需保留请先「完成」保存)
// 换账期同时关掉批删弹窗:里面复述的是旧账期的数字,留着就是张过期确认单
watch(ym, () => {
  draft.clear(); delPreview.value = null
  if (period.picked) { loadMeters(); loadReadings(); loadBinding() }
})

// 写后统一重载(读数/档案/绑定/出账月矩阵)
function reloadAll() {
  loadMeters()
  loadReadings()
  loadBinding()
  // 抄了原本空的月 → 矩阵上那一格的「抄表」点要亮起来(换出账月时立刻看得见)
  void period.reloadChain().catch(() => { /* 矩阵刷新失败不阻断本屏 */ })
}

// ── 筛选状态(§1 筛选条)+统计卡(点卡=状态筛选互斥切换) ──
const kind = ref('elec')
// 分区=一级页签(用户拍板 2026-07-28:一期/二期/宿舍分开,不混排——对齐原始账册分册习惯),无「全部」混排项
const zone = ref('p1')
const building = ref('all')
const own = ref('all')
const status = ref<StatusFilter>('all')
const q = ref('')
const KIND_OPTS = [{ value: 'elec', label: '电表' }, { value: 'water', label: '水表' }]
const zones = useZonesStore()
onMounted(() => zones.ensure())
const ZONE_OPTS = computed(() => zones.list.map(z => ({ value: z.code, label: z.name })))
const OWN_OPTS = computed(() => [
  { value: 'all', label: '全部归属' },
  ...Object.keys(OWNERSHIP_LABEL).map(value => ({ value, label: ownershipLabel(value, kind.value) })),
])
const STATUS_OPTS = [
  { value: 'all', label: '全部状态' },
  // SPEC §6:该表本月有自己的一行、且与上一行不同(换户 / 挪位置 / 停用 / 拆除……)
  { value: 'changed', label: '本月有变化' },
  // SPEC §10.4:同期区同表类这个月导入过册子、唯独没有这块表(= 企业名称旁打了标签的行)
  { value: 'bookMissing', label: '本月册子里没有' },
  { value: 'read', label: '已抄' }, { value: 'missing', label: '未抄' }, { value: 'noBase', label: '缺底数' },
  { value: 'negative', label: '倒走' }, { value: 'touMismatch', label: '时段不符' },
  { value: 'pending', label: '待核' }, { value: 'unbound', label: '待绑定' }, { value: 'placeholder', label: '占位槽' },
  { value: 'zoneOdd', label: '期区对不上' },
  { value: 'retired', label: '已停用' },   // 停用照常显示在「全部」里,选此项只看它们
  // 本月不在册的两类:平时不在表里,这两项是它们的唯一出口(点开才能改回来)
  { value: 'removed', label: '已拆' }, { value: 'notYet', label: '未在册' },
]
// 状态 Select 与统计卡互斥共用一个 status:卡的粗粒度键(anomaly/attention/ready/tenant)在 Select 显「全部」
const statusSel = computed(() => (STATUS_OPTS.some(o => o.value === status.value) ? status.value : 'all'))
function resetFilters() {
  // 分区是一级页签不参与重置
  building.value = 'all'; own.value = 'all'; status.value = 'all'; q.value = ''; suspectOnly.value = false
}
function cardClick(k: StatusFilter) {
  status.value = status.value === k ? 'all' : k
}
// 不在册那两批的说明:按状态段说话(SPEC §6),说清「列的是什么」+「怎么回到册上」
const hiddenHint = computed(() => {
  if (status.value === 'removed')
    return '列出本月已拆、不在册上的表;自哪个月起已拆,悬停状态列可见。'
      + '误标的:点开这一行,在「档案变更」的「在册状态」里撤回「已拆」那一行;拆除前的月份不受影响。'
  if (status.value === 'notYet')
    return '列出本月还不在册的表。要让它本月在册:点开这一行,'
      + '在「档案变更」里把「在册状态」第一行的起始月改到本月或更早;本月还没有读数的表,'
      + '也可以在表格里录本月读数,保存时会从本月起在册(已有本月读数的,改读数不会让它在册)。'
  return ''
})

// ── 行合流与各口径行集 ──
// 行集含本月不在册的表(已拆 / 未在册):matchStatus 把它们挡在「全部」与各分母之外,
// 只在「已拆」「未在册」「本月有变化」里出现 —— 那是它们的唯一出口
// (2026-08-14 用户报障:「我在23年9月停用了旭化成的一个表,现在根本不知道上哪去重新启用他」)。
const rowsAll = computed(() =>
  buildRows(meters.value ?? [], readings.value ?? [], prevReadings.value, bindRows.value, tenantNameById.value))
// 统计卡/进度条口径:跟随 电水+分区(§1),不受楼栋/归属/状态/搜索影响
const kindZoneRows = computed(() =>
  filterRows(rowsAll.value, { kind: kind.value, zone: zone.value, building: 'all', own: 'all', status: 'all', q: '' }))
const cards = computed(() => cardCounts(kindZoneRows.value))
// SPEC §10.4:这个期区 × 表类这个月一笔册子记录都没有 → 不逐行打标,表格上方一句
const bookGap = computed(() => bookGapText(kindZoneRows.value))
const progressPct = computed(() =>
  cards.value.tenant > 0 ? Math.round((cards.value.read / cards.value.tenant) * 100) : 0)
// 「只看存疑」(V75 §E3/§F1):独立开关,叠在筛选链之后 —— 存疑是档案质量维度,与抄表状态互不排斥。
// 两级都收:shadow(疑似重复,已被踢出Σ)与 incomplete(档案不全,仍在Σ内),都要人去补档案
const suspectOnly = ref(false)
const suspectCount = computed(() => kindZoneRows.value.filter(x => !!x.m.suspect).length)
const shadowCount = computed(() => kindZoneRows.value.filter(x => x.m.suspect === 'shadow').length)
// 表格行集:全筛选链(tfoot 已抄/未抄/Σ用量 即按此行集算)
const gridRows = computed(() => {
  const rs = filterRows(rowsAll.value, { kind: kind.value, zone: zone.value, building: building.value, own: own.value, status: status.value, q: q.value })
  return suspectOnly.value ? rs.filter(x => !!x.m.suspect) : rs
})
// 视图身份(WRITE-KEEP-CONTEXT-SPEC 铁律一):表格回顶的唯一判据。
// 这里列全 gridRows 的筛选维度 —— 这些一变就是「另一张表」,该从头看;
// 而 reloadAll() 只换 gridRows 的数组引用、视图身份没变,表格保住滚动位。加筛选维度记得同步加进来。
const viewKey = computed(() =>
  [ym.value, kind.value, zone.value, building.value, own.value, status.value, q.value, suspectOnly.value].join('|'))

// ── 位置字段候选(§A.3/§A.4 共用:抽屉行内编辑 + 新增表弹窗) ──
// 楼层/方位给基准表打底,再并上库内既有值(存量文件里出现过"中间""夹层"这类基准表外的写法);
// 区域纯数据驱动(各期区块名各不相同,没有通用基准)。
const FLOOR_BASE = ['负一层', '一楼', '二楼', '三楼', '四楼', '五楼', '六楼', '七楼', '八楼', '九楼', '十楼', '天面']
const SIDE_BASE = ['东侧', '西侧', '南侧', '北侧']
const uniqVals = (base: string[], vals: (string | null | undefined)[]) => {
  const out = [...base]
  for (const v of vals) { const t = v?.trim(); if (t && !out.includes(t)) out.push(t) }
  return out
}
const areaOpts = computed(() => uniqVals([], (meters.value ?? []).map(m => m.area)))
const floorOpts = computed(() => uniqVals(FLOOR_BASE, (meters.value ?? []).map(m => m.floorLabel)))
const sideOpts = computed(() => uniqVals(SIDE_BASE, (meters.value ?? []).map(m => m.side)))
// 新增弹窗的位置三态(§F5+§F6 叠加修正 2026-07-31):后端 applyLoc 分 null/空串/有值三态,
// 弹窗必须把前两态分开给,否则「新建时没填」会被 locDeviates 判成人工设定、导入从此不再按位置原文重解析。
//   AUTO('') → 提交 null = 不指定,按位置原文自动解析(新建默认)
//   NONE('-') → 提交 ''  = 显式跨层/不分侧,不许被位置原文解析回来
const LOC_AUTO = ''      // 表单内部值:自动
const LOC_NONE = '-'     // 表单内部值:显式无
const dlgFloorOpts = computed(() =>
  [{ value: LOC_AUTO, label: '(按位置原文自动)' }, { value: LOC_NONE, label: '—(跨层/不适用)' },
    ...floorOpts.value.map(f => ({ value: f, label: f }))])
const dlgSideOpts = computed(() =>
  [{ value: LOC_AUTO, label: '(按位置原文自动)' }, { value: LOC_NONE, label: '—(不分侧)' },
    ...sideOpts.value.map(s => ({ value: s, label: s }))])
// 表单值 → 提交值:自动=null / 显式无=空串 / 有值=原值
const locOut = (v: string) => (v === LOC_AUTO ? null : v === LOC_NONE ? '' : v.trim())

// 楼栋 Select:数据驱动清单(当前 电水+分区 下出现过的楼栋)
const buildingOpts = computed(() => {
  const seen = new Map<number, string>()
  for (const x of kindZoneRows.value) {
    const id = x.m.buildingId
    if (id != null && !seen.has(id)) seen.set(id, buildingNameById.value.get(id) ?? `#${id}`)
  }
  return [{ value: 'all', label: '全部楼栋' }, ...[...seen].map(([id, name]) => ({ value: String(id), label: name }))]
})
watch(buildingOpts, opts => { if (!opts.some(o => o.value === building.value)) building.value = 'all' })

// 统计卡定义(6 张,§1):各卡独立计数,点卡设置对应状态筛选
// n = 该维度的数值,仅 S 档摘要行用来判「上不上屏」(§5.7:值为 0 的维度收进「更多」)。
// 与 val 分开是因为 val 是**给人看的串**(待核/待绑定 是 `0 · 0` 两个数),判 0 不能拿串去判。
const cardDefs = computed(() => {
  const c = cards.value
  return [
    { k: 'tenant' as StatusFilter, label: '租户表总数', val: String(c.tenant), n: c.tenant, sub: '含待核与占位槽' },
    { k: 'read' as StatusFilter, label: '已抄', val: String(c.read), n: c.read, sub: '本月已录总示数', cls: 'ok' },
    { k: 'missing' as StatusFilter, label: '未抄', val: String(c.missing), n: c.missing, sub: '点卡筛出后一路回车录入', cls: c.missing > 0 ? 'amber' : '' },
    { k: 'anomaly' as StatusFilter, label: '异常', val: String(c.anomaly), n: c.anomaly, sub: `倒走 ${c.negative} · 时段不符 ${c.touMismatch}`, cls: c.anomaly > 0 ? 'bad' : '' },
    { k: 'attention' as StatusFilter, label: '待核 / 待绑定', val: `${c.pending} · ${c.unbound}`, n: c.pending + c.unbound, sub: '原文未挂租户 · 合同待人工选定', cls: c.pending + c.unbound > 0 ? 'coral' : '' },
    { k: 'ready' as StatusFilter, label: '派生就绪', val: String(c.ready), n: c.ready, sub: '自动+对位+人工绑定', cls: 'ok' },
  ]
})
// S 档摘要行(§5.7「≥5 张先砍再排」):值为 0 的收进「更多」,有数了自己长回主行。
// ⚠ **限定名单,不是六个维度一刀切**。可收的只有「本来就该是 0」的那三样:
//   异常 / 待核·待绑定 / 未抄 —— 它们为 0 是好消息,不占位。
//   租户表总数 / 已抄 / 派生就绪是**进度**,月初「已抄 0」正是最该看见的时候;
//   一刀切会让它在月初自己掉进「更多」,而 §5.10 的「留数不留条」同时把条退成 3px 底纹
//   —— 条也没了、数也没了,屏上就再没有进度这回事(2026-09-21 对抗复查抓到)。
const COLLAPSIBLE = new Set<StatusFilter>(['missing', 'anomaly', 'attention'])
const sumSegs = computed(() => cardDefs.value.filter(d => !(COLLAPSIBLE.has(d.k) && d.n === 0)))
const moreSegs = computed(() => cardDefs.value.filter(d => COLLAPSIBLE.has(d.k) && d.n === 0))
// 筛选钮上的计数 = 收进面板的那几件里此刻非默认的个数。
// 口径取「重置能清掉的那几项」(resetFilters 的四项),搜索在钮外自己看得见,不计;
// 分区/电水是一级页签与口径、恒有值,没有「选没选」这一说,同样不计(与 resetFilters 一致)。
const filterCount = computed(() =>
  (building.value !== 'all' ? 1 : 0) + (own.value !== 'all' ? 1 : 0)
  + (status.value !== 'all' ? 1 : 0) + (suspectOnly.value ? 1 : 0))

// ── 详情抽屉(点行打开;行集重载后引用自动更新;表被删/换期即自动关) ──
// rowsAll 含不在册的行:从「已拆」「未在册」里点开的抽屉也找得到自己那一行(2026-08-14 实测踩过)
const openRow = computed(() => rowsAll.value.find(x => x.m.id === openId.value) ?? null)
watch(openRow, r => { if (openId.value != null && !r) openId.value = null })

// ── 「按名精确匹配一键挂」(待核卡激活时工具栏侧出现,编辑态) ──
// 一键挂改的是表档案的 tenantId(POST /meters/auto-link → /api/meters/**),故判 meter-master
const showAutoLink = computed(() =>
  editMode.value && canMaster.value && (status.value === 'attention' || status.value === 'pending'))
const linking = ref(false)
const linkEstimate = computed(() =>
  autoLinkEstimate((meters.value ?? []).filter(isPendingMeter).map(m => m.tenantName), tenants.value.flatMap(t => tenantMatchNames(t))))
async function autoLink() {
  if (!editMode.value || !canMaster.value) return
  if (linking.value) return
  if (!confirm(`按企业名称原文与租户档案精确匹配,预计可挂 ${linkEstimate.value} 块待核表。继续?`)) return
  linking.value = true
  try {
    const r = await metersApi.autoLinkByName()
    alert(`已挂 ${r.linked} 块,跳过 ${r.skipped} 块。`)
    reloadAll()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '一键挂失败，请重试')
  } finally { linking.value = false }
}

// ── 批量删除本期(刀H §H5,编辑态;用户点名:自己测试导入的那批数据要能自己删掉) ──
// 不可逆,故「先预览后执行」:弹窗复述预览数字,并要人手打账期串才放行(§H5.4)。
// 口径=整月(不带 kind/zone):派生快照本就是全园区一次算出来的,只删半边月它整月都不再可信。
// 勾选项一变,预览必须重拉 —— 复述的数字与实删对不上,这个二次确认就成了摆设。
const delPreview = ref<MeterDeleteDTO | null>(null)
const delCascade = ref(true)
const delDropMeters = ref(true)
const delDropNotices = ref(false)   // 连带删该月草稿催缴单:默认不勾,要人自己点(预览数字不随它变,不重拉)
const delTyped = ref('')
const delBusy = ref(false)
const delOpt = computed(() => ({
  cascade: delCascade.value, dropEmptyMeters: delDropMeters.value, dropDraftNotices: delDropNotices.value,
}))
// 该月的催缴单:草稿 / 已作废的能连带删;已确认 / 已导出的挡住整批(确认键禁用),户名最多列 5 户,余者「等 N 户」
const delOpenN = computed(() => (delPreview.value?.draftNotices ?? 0) + (delPreview.value?.voidNotices ?? 0))
const delLockedN = computed(() => delPreview.value?.lockedNotices ?? 0)
// 连带删草稿单后端另要出账权限(同生成);本屏的授权按钮只申请抄表两项权限,没有它就不给勾、确认键也不放
const canBillRun = computed(() => auth.can('billing-run:edit'))
const delLockedNames = computed(() => {
  const t = delPreview.value?.lockedTenants ?? []
  return t.slice(0, 5).join('、') + (t.length > 5 ? ` 等 ${t.length} 户` : '')
})

// 竞态守卫同 rSeq:连点勾选项时慢的那次可能后到,弹窗复述的数字就不是即将执行的那一套口径了
let dSeq = 0
async function loadDelPreview() {
  const my = ++dSeq
  delBusy.value = true
  try {
    const p = await metersApi.deletePreview(ym.value, delOpt.value)
    if (my === dSeq) delPreview.value = p
  } catch (e) {
    if (my === dSeq) { delPreview.value = null; alert((e as { message?: string })?.message ?? '预览失败') }
  } finally {
    // 过期那次不许解锁:新预览还在飞,提前放行「确认删除」等于按旧数字执行
    if (my === dSeq) delBusy.value = false
  }
}
async function openDelDlg() {
  delTyped.value = ''
  delCascade.value = true; delDropMeters.value = true; delDropNotices.value = false
  await loadDelPreview()
  if (delPreview.value && delPreview.value.readings === 0) {
    alert(`${ym.value} 没有抄表数据可删。`); delPreview.value = null
  }
}
watch([delCascade, delDropMeters], () => { if (delPreview.value) loadDelPreview() })

async function confirmDelete() {
  // 写口自守(同 BillNoticesView 的既有写法):关弹窗只挡已知那条入口,
  // 守在发请求这一层才不漏。这一条尤其不能省 —— 它是整月不可逆删除。
  if (!editMode.value || !canReading.value) return
  const p = delPreview.value
  if (!p || delBusy.value || delTyped.value.trim() !== p.ym) return
  delBusy.value = true
  const opt = delOpt.value
  try {
    const r = await metersApi.batchDelete(p.ym, opt)
    delPreview.value = null
    // 「有表被跳过未删」是用户必须看到的 —— 那几块表他以为删了、其实还在。
    // 所以有跳过时走 warning 且**不自动消失**(duration=0,组件给关闭按钮),干净时才自动收。
    const blocked = r.meterBlocked.length
    toastTone.value = blocked > 0 ? 'warning' : 'success'
    const arch = (r.assignRows ?? 0) + (r.statusRows ?? 0)
    const bills = opt.dropDraftNotices ? (r.draftNotices ?? 0) + (r.voidNotices ?? 0) : 0
    okMsg.value = `已删除 ${r.readings} 条读数、${r.meterDeleted.length} 份表档案、${r.derived} 条派生快照`
      + (bills > 0 ? `、${bills} 张草稿催缴单` : '')
      + (arch > 0 ? `、${arch} 条本期导入写下的表档案记录` : '')
      + ((r.bookRows ?? 0) > 0 ? `、${r.bookRows} 条本月册子记录` : '') + '。'
      + (blocked > 0 ? ` 另有 ${blocked} 份表档案跳过未删(池成员,或别的月的催缴单里还有它)。` : '')
    reloadAll()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '批量删除失败')
    // 409 说明后端现状与弹窗里那份预览不同了(别人刚生成/确认了这个月的单):重拉,勾选项与确认键跟上。
    // 要 await:不然 finally 先把 delBusy 放开,确认键会按旧数字放行
    if (delPreview.value) await loadDelPreview()
  } finally { delBusy.value = false }
}

// ── 导入(registry 'meter')/模板/导出当月(v4 原样) ──
const importResult = ref<ImportResultDTO | null>(null)
const importCtx: ImportCtx = {}
async function onImport(payload: ImportRec[] | { label?: string; records: ImportRec[] }[], fileName: string) {
  importing.value = false
  if (!editMode.value || !canReading.value) return
  try {
    importResult.value = await runImport('meter', payload as never, importCtx, fileName)
    reloadAll()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
}
async function onTemplate() {
  try { await buildMeterTemplate(ym.value, zones.list) }
  catch (e) { alert((e as { message?: string })?.message ?? '模板下载失败') }
}
const exporting = ref(false)
async function onExport() {
  if (exporting.value) return
  // 导出串月(J3-2):切月途中档案 / 读数可能还是上个月的,或者这个月没拉到 —— 不导半新半旧的册子
  if (loadErr.value || metersYm.value !== ym.value || readYm.value !== ym.value) {
    alert(`${ym.value} 的表档案或读数还没加载好,稍后再导出。`); return
  }
  exporting.value = true
  // 只导站在本月在册的表(在用 + 停用),档案取本月那一段 —— 两件事都由 list(ym) 与 meterExcel 保证
  try { await exportMeterMonth(ym.value, meters.value ?? [], readings.value ?? [], zones.list) }
  catch (e) { alert((e as { message?: string })?.message ?? '导出失败') }
  finally { exporting.value = false }
}

// ── S 档「⋯」(§5.10:顶栏只留 1 个主动作,其余动作收进溢出菜单) ──
// 宽档那 5~6 颗按钮一颗不减,只是换了容身处;可见性判据与宽档逐条相同(同样的 editMode/权限)。
// ⚠「批量删除本期」不可逆。§5.11 说「定规则前,不可逆动作不要只靠菜单里一行字」——
//   这里菜单项点下去走的仍是 openDelDlg:先拉预览数字、再要人手打账期才放行,
//   二次确认在那张确认单上,不在菜单里。
// M 档「导出当月」已经是流内那 2 个主动作之一,菜单里不再重复列一条(点哪条都一样,列两遍只是噪音)。
const moreActions = computed(() => [
  { key: 'template', label: '下载模板', icon: 'file-spreadsheet' },
  ...(isM.value ? [] : [{ key: 'export', label: '导出当月', icon: 'download', disabled: exporting.value }]),
  ...(editMode.value && canReading.value ? [{ key: 'import', label: '导入', icon: 'upload' }] : []),
  ...(editMode.value && canMaster.value ? [{ key: 'new', label: '新增表', icon: 'plus' }] : []),
  ...(showAutoLink.value ? [{ key: 'autolink', label: '按名精确匹配一键挂', icon: 'wand-2', disabled: linking.value || cards.value.pending === 0 }] : []),
  ...(editMode.value && canReading.value ? [{ key: 'del', label: '批量删除本期', icon: 'trash-2', disabled: delBusy.value }] : []),
])
function onMoreAction(k: string) {
  if (k === 'template') void onTemplate()
  else if (k === 'export') void onExport()
  else if (k === 'import') importing.value = true
  else if (k === 'new') openMeterDlg()
  else if (k === 'autolink') void autoLink()
  else if (k === 'del') void openDelDlg()
}

// ── 新增表弹窗(编辑态,标题行入口;v4 原样迁移) ──
const meterDlg = ref(false)
// §A.4:补 区域/楼层/方位/房号(表编码本就有)——手工建的表不补这些就永久缺席导入位置索引
// fromYm:自这个月起在册(SPEC §3.4「新增表从当前查看月起在册」,可改);早于它的月份里没有这块表
const mForm = ref({
  kind: 'elec', zone: 'p1', building: '', spot: '', tenantId: null as number | null,
  ownership: 'share', name: '', subName: '', code: '', factor: '',
  area: '', floorLabel: '', side: '', roomNo: '', fromYm: '',
})
const mErr = ref('')
const DLG_OWN_OPTS = computed(() =>
  Object.keys(OWNERSHIP_LABEL).map(value => ({ value, label: ownershipLabel(value, mForm.value.kind) })))
const dlgBuildingOpts = computed(() => [
  { value: '', label: '—(未关联)' },
  ...buildings.value.map(b => ({ value: String(b.id), label: `${b.phaseName} · ${b.name}` })),
])
const tenantOpts = computed(() =>
  tenants.value.map(t => ({ id: t.id, name: t.companyName, phase: t.phase, parentName: t.parentName })))
function openMeterDlg() {
  mForm.value = {
    kind: kind.value, zone: zone.value,
    building: '', spot: '', tenantId: null, ownership: 'share', name: '', subName: '', code: '', factor: '',
    area: '', floorLabel: '', side: '', roomNo: '', fromYm: ym.value,
  }
  mErr.value = ''
  meterDlg.value = true
}
const trimOrNull = (s: string) => s.trim() || null
async function submitMeter() {
  if (!editMode.value || !canMaster.value) return
  const name = mForm.value.name.trim()
  if (!name) { mErr.value = '请输入标识名'; return }
  const factor = mForm.value.factor.trim() === '' ? 1 : Number(mForm.value.factor)
  if (!Number.isFinite(factor) || factor <= 0) { mErr.value = '倍率需为正数(留空=1)'; return }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mForm.value.fromYm)) { mErr.value = '请选择自哪个月起在册'; return }
  try {
    await metersApi.create({
      kind: mForm.value.kind as MeterKind, zone: mForm.value.zone, name, factor, fromYm: mForm.value.fromYm,
      subName: trimOrNull(mForm.value.subName),
      spot: trimOrNull(mForm.value.spot), code: trimOrNull(mForm.value.code),
      area: trimOrNull(mForm.value.area),
      // §F5:三列发空串(与抽屉 reqOf 一致)。后端三态里 ''=显式清除(跨层/不适用),null 才是「按 spot 解析」;
      // 发 null 会让这里选的「—(跨层/不适用)」被 spot 解析盖掉,Select 上那句「可空=跨层」就成了假话。
      floorLabel: locOut(mForm.value.floorLabel), side: locOut(mForm.value.side),
      roomNo: mForm.value.roomNo.trim() || null,
      tenantId: mForm.value.tenantId,
      buildingId: mForm.value.building === '' ? null : Number(mForm.value.building),
      ownership: mForm.value.tenantId != null ? 'tenant' : mForm.value.ownership,
    })
    meterDlg.value = false
    reloadAll()
  } catch (e) {
    mErr.value = (e as { message?: string })?.message ?? '新增失败'
  }
}

// ── S 档主动作进手机顶栏(§5.10「动作 → 顶栏右:1 个主动作」) ──
// 顶栏只在 S 档挂载(AppShell.vue:168 的 v-else),别档调它是空转 —— 屏不必自己判档。
// 「改了几处」那个读数跟着进 label(三条路里的 a):顶栏那颗按钮是外壳自己的元素,
// 流内不多也不少一个块 —— 零位移铁律(LAYOUT-STABILITY §1)不受影响,
// 也不必另开一个 v-if 的流内条(那条路 noInteractionLayoutShift 门禁拦过一次)。
// label 同时是无障碍名,所以写人话不写裸数字。
// ⚠ 这一段必须排在 rowsAll 之后:useTopBarAction 里是 watchEffect,**建立时就跑一次**,
//   而 getter 读 dirtyIds → rowsAll。写在 onEditBtn 旁边会当场 TDZ 报
//   「Cannot access 'rowsAll' before initialization」,整屏白(2026-09-21 实测)。
useTopBarAction(() => {
  // 无写权限 / 审核闸锁着:宽档这颗按钮本来就不画(FPEditModeButton 自己判四态)。
  // 审核态不会因此丢 —— 摘要行右端那簇 FPReviewActions 写着它。
  if (!canEnter.value || reviewNote.value) return null
  // 本月读数没加载成功时宽档禁用这颗钮(此刻录一格 = 覆盖旧月),手机上同样不给入口
  if (!editMode.value && loadErr.value) return null
  const n = dirtyIds.value.length
  return {
    label: editMode.value ? (n > 0 ? `退出编辑 · ${n} 处` : '退出编辑') : '编辑模式',
    icon: iconFor('pencil'),
    onClick: () => { void onEditBtn() },
  }
})

const emptyText = computed(() => {
  // 分区是一级页签恒定生效,不计入"筛过"判定
  const filtered = building.value !== 'all' || own.value !== 'all'
    || status.value !== 'all' || q.value.trim() !== ''
  return filtered ? '当前筛选下没有匹配的表(点「重置」清筛选)'
    : '该分区暂无表档案 —— 可导入整册抄表工作簿自动建档,或编辑模式下「新增表」。'
})
</script>

<template>
  <!-- 首载 gate:表档案/当月读数未落位不闪空表(v-else 紧邻,LIST-PAGE 加载门) -->
  <!-- 表档案首载失败:整页无内容可显,骨架屏会一直转 —— 换成提示+重试,别让用户干等 -->
  <!-- ⓪ 没有期 → 出账月矩阵(五屏共用一张)。选过一次之后本会话不再出现,直落表格 -->
  <ChainMonthGate v-if="!period.picked" title="园区抄表" icon="gauge" />

  <!-- fp-fluid:本屏已按 RESPONSIVE-LAYOUT-SPEC §5.3 迁移查看态(统计卡降列 / 宽表 S 档单 sticky),
       摘 base.css 的 800px 屏级地板;各根分支同挂,谁渲染谁是首子 -->
  <div v-else-if="!meters && metersErr" class="mt-gate-fail fp-fluid">
    <FPLoadError @retry="loadMeters">
      <span>{{ metersErr }}</span>
    </FPLoadError>
  </div>
  <div v-else-if="!meters || !readings" class="page-loading fp-fluid"><span class="page-spin" /></div>

  <div v-else class="mt-page fp-fluid">
    <!-- 链路条:期写在这里,五道工序横跳不换期 -->
    <FPStepStrip :steps="chainSteps" current="meters" :period="ym" @back="period.clear()" />

    <!-- 标题行:h2+账期+抄表进度条;右=模板/导出(常驻)+导入/新增表(编辑态)+编辑模式(最右)
         S 与 M 档整行都不渲染(§5.10 判据四:顶栏/平板顶栏 52px 已经写着屏名,流内不再写第二遍)。
         整块挂 v-if 而不是 display:none —— 行里那两颗按钮(编辑模式/审核簇)在窄档
         要换位置,留着一份藏起来的就成了两份同名控件。 -->
    <div v-if="!isSM" class="mt-head">
      <div class="mt-head-l">
        <h2 class="mt-title"><span class="ic"><component :is="iconFor('gauge')" :size="18" /></span>园区抄表</h2>
        <div class="mt5-prog" :title="`抄表进度(随电水/分区筛选):已抄 ${cards.read} / 租户表 ${cards.tenant}`">
          <div class="bar"><span :style="{ width: progressPct + '%' }" /></div>
          <span class="txt">{{ cards.read }}/{{ cards.tenant }} · {{ progressPct }}%</span>
        </div>
      </div>
      <div class="mt5-actions">
        <!-- 草稿式编辑(§7.2):编辑中显改动数 tag;「完成」经 onEditBtn 走确认流 -->
        <span v-if="editMode" class="mt5-tag">编辑中 · {{ dirtyIds.length }} 处改动</span>
        <Button variant="outline" size="sm" @click="onTemplate">
          <template #leading><component :is="iconFor('file-spreadsheet')" :size="14" /></template>
          下载模板
        </Button>
        <Button variant="outline" size="sm" :disabled="exporting" @click="onExport">
          <template #leading><component :is="iconFor('download')" :size="14" /></template>
          导出当月
        </Button>
        <!-- 导入/新增表收编辑态(EDIT-MODE-SPEC);模板/导出=只读操作常驻 -->
        <!-- 导入写的是读数(表顺带建档)→ meter-reading;新增表是纯档案 → meter-master -->
        <Button v-if="editMode && canReading" variant="outline" size="sm" @click="importing = true">
          <template #leading><component :is="iconFor('upload')" :size="14" /></template>
          导入
        </Button>
        <Button v-if="editMode && canMaster" variant="outline" size="sm" @click="openMeterDlg">
          <template #leading><component :is="iconFor('plus')" :size="14" /></template>
          新增表
        </Button>
        <!-- §H5 批量删除本期(整月,不可逆):编辑态 + meter-reading:edit(DELETE /api/meters/readings) -->
        <Button
          v-if="editMode && canReading" variant="danger" size="sm" :disabled="delBusy"
          title="删除本账期全部读数,并级联删除该月派生快照与删完零读数的表档案(池成员表跳过);执行前会先给出预览数字并要求手打账期确认"
          @click="openDelDlg"
        >
          <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
          批量删除本期
        </Button>
        <!-- 审核动作簇(§01):长在编辑按钮**左边**,同一条 flex 行 —— 编辑按钮位一个像素不动。
             四态八格由组件自己判(全站唯一那一份),屏这一层只负责喂键与人话名。 -->
        <FPReviewActions :keys="reviewKeys" :label="reviewLabel" :can-edit="canEnter" :edit="editMode" />
        <!-- 编辑模式:任一权限(或能请授权)即画按钮;进得去 ⇒ 两把权限一定齐(useEditMode 铁律 ①) -->
        <FPEditModeButton
          :edit="editMode" :held-by-other="heldByOther" :can-enter="canEnter"
                          :review-note="reviewNote" :review-tip="reviewTip"
          :disabled="saving || (!editMode && loadErr)"
          :title="!editMode && loadErr ? '本月数据未加载成功,先点失败条上的「重试」再录入' : undefined"
          @toggle="onEditBtn"
        />
      </div>
    </div>

    <!-- S 档摘要行(§5.7 + §5.10):6 张卡收成一行 44 —— 有数的维度成段、值为 0 的进「更多」;
         进度并进来(留数不留条:条退成行底 3px 底纹);右端是审核簇。 -->
    <div v-if="isS" class="mt5-sum">
      <div class="mt5-sum-segs">
        <button
          v-for="c in sumSegs" :key="c.k"
          class="mt5-seg" :class="[c.cls, { on: status === c.k }]"
          @click="cardClick(c.k)"
        >
          <span class="lab">{{ c.label }}</span>
          <span class="val">{{ c.val }}</span>
        </button>
        <button v-if="moreSegs.length" class="mt5-seg more" @click="panel = 'more'">
          <span class="lab">更多</span>
          <span class="val">{{ moreSegs.length }}</span>
        </button>
      </div>
      <!-- 审核态:不另画一颗徽标 —— FPReviewActions 是全站唯一那份(它自己的铁律),
           再写一份「已审核 · 谁 · 何时」就是第 16 份。整簇挪到摘要行右端。 -->
      <FPReviewActions :keys="reviewKeys" :label="reviewLabel" :can-edit="canEnter" :edit="editMode" />
      <span class="mt5-sum-bar"><span :style="{ width: progressPct + '%' }" /></span>
    </div>


    <!-- 统计卡行(6 张,随电水/分区;点=状态筛选互斥切换,选中高亮)
         ⚠ 判据仍是 isS,**M 档照画 6 张**(下面 @media 960 降三列两行)。
         §5.7 那张「≥5 张先砍成一行摘要」的表自己写着「S 档规则」,而 M 档的共同口径是
         §3.5-pre:「只收留白与行数,不收内容;不允许把入口藏进溢出菜单」——
         摘要行是把值为 0 的三个维度收进「更多」,那是收内容,M 档不做。 -->
    <div v-if="!isS" class="mt5-cards">
      <button
        v-for="c in cardDefs" :key="c.k"
        class="mt5-card" :class="[c.cls, { on: status === c.k }]"
        :title="status === c.k ? '再点取消筛选' : '点击按此维度筛选表格'"
        @click="cardClick(c.k)"
      >
        <span class="lab">{{ c.label }}</span>
        <span class="val">{{ c.val }}</span>
        <span class="sub">{{ c.sub }}</span>
      </button>
    </div>

    <!-- 加载失败条:两条各自成行(同 PoolLedgerView §F11,别让一条盖掉另一条的原因) -->
    <FPLoadError v-if="readErr || metersErr" @retry="retryLoad">
      <!-- .msg 由 FPLoadError 用 :deep 接住:两条各自成行,别让一条盖掉另一条的原因 -->
      <div class="msg">
        <div v-if="readErr">{{ readErr }} —— 读数列一律置空(不拿上月数据顶替),编辑模式已锁,重试成功后再录入</div>
        <div v-if="metersErr">{{ metersErr }} —— 表档案停留在上次拉到的版本,编辑模式已锁</div>
      </div>
    </FPLoadError>

    <!-- 月度空态引导(三分支:编辑态/可编辑/只读);读数没拉到不是「本月无数据」,让位给失败条 -->
    <div v-if="!readErr && readings.length === 0" class="mt-empty">
      <component :is="iconFor('info')" :size="14" />
      <span>
        {{ year }}年{{ month }}月暂无抄表数据 ——
        <template v-if="editMode && canReading">可<button class="mt-link" @click="importing = true">导入</button>整册抄表工作簿(自动建档),或行内直接录入本月示数。</template>
        <template v-else-if="canReading">进入右上角「编辑模式」后可录入或导入。</template>
        <template v-else>各表读数列为空。</template>
      </span>
    </div>

    <!-- S/M 档筛选条(§5.10):搜索框 + 一颗带已选计数的筛选钮 +「⋯」,44 高。
         S 档主动作(编辑模式)在**手机顶栏**,不在这一行 —— 见上面 useTopBarAction 那段。
         M 档看不见手机顶栏(AppShell.vue:162 的 tier !== 's' 走桌面 Toolbar),
         所以 M 的 2 个主动作(导出当月 + 编辑模式)与审核簇留在这一行里。 -->
    <div v-if="isSM" class="mt5-fbar">
      <div class="mx-search">
        <span class="mx-search-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </span>
        <input v-model="q" placeholder="搜索租户/原文/房号/表号/编码" >
      </div>
      <button class="mt5-fbtn" :class="{ on: filterCount > 0 }" aria-label="筛选" @click="panel = 'filter'">
        <component :is="iconFor('sliders-horizontal')" :size="18" />
        <span v-if="filterCount > 0" class="n">{{ filterCount }}</span>
      </button>
      <!-- M 档的 2 个主动作(§5.10「M 档:主动作留 2 个」,规范点名这两件)。
           S 档这里一件都不画:编辑模式在顶栏,导出当月在「⋯」里。 -->
      <template v-if="isM">
        <Button class="mt5-mact" variant="outline" size="sm" :disabled="exporting" @click="onExport">
          <template #leading><component :is="iconFor('download')" :size="14" /></template>
          导出当月
        </Button>
        <!-- 审核态(§5.10「状态不是动作」):标题行在 M 档消失了,这簇得跟过来,
             否则平板上「已审核 · 谁 · 何时」整个没有了。S 档它在摘要行右端。 -->
        <FPReviewActions :keys="reviewKeys" :label="reviewLabel" :can-edit="canEnter" :edit="editMode" />
        <!-- 「改了几处」是**状态**,外壳从没写过它,按 §5.10「反过来不成立」必须有位置。
             ⚠ 不能另开一行:那是「交互态决定显隐的流内块」,进编辑态会把表整体顶下去
             (LAYOUT-STABILITY §1,noInteractionLayoutShift 门禁实测拦下过)。
             按 §2 优先级表第 1 条「塞进已有位置」——挂成编辑钮的角标,
             绝对定位不参与布局,出现与否零位移。几何与筛选钮那颗计数角标同一份。
             S 档编辑钮进了顶栏,这个数跟着进顶栏动作的 label(同一条优先级第 1 条)。 -->
        <span class="mt5-ebtn mt5-mact">
          <FPEditModeButton
            :edit="editMode" :held-by-other="heldByOther" :can-enter="canEnter"
            :review-note="reviewNote" :review-tip="reviewTip"
            :disabled="saving || (!editMode && loadErr)"
            :title="!editMode && loadErr ? '本月数据未加载成功,先点失败条上的「重试」再录入' : undefined"
            @toggle="onEditBtn"
          />
          <span v-if="editMode && dirtyIds.length" class="n" :title="`编辑中 · ${dirtyIds.length} 处改动`">{{ dirtyIds.length }}</span>
        </span>
      </template>
      <FPMoreMenu :items="moreActions" @select="onMoreAction" />
    </div>

    <!-- 筛选条:电/水 → 分区 → 楼栋(数据驱动) → 归属 → 状态 → 搜索 → 一键挂/分时列/重置 -->
    <div v-if="!isSM" class="mt5-filters">
      <Segmented :options="ZONE_OPTS" :model-value="zone" size="sm" @update:model-value="zone = $event; building = 'all'" />
      <Segmented :options="KIND_OPTS" :model-value="kind" size="sm" @update:model-value="kind = $event" />
      <div style="width:132px">
        <Select :options="buildingOpts" :model-value="building" size="sm" @update:model-value="building = $event" />
      </div>
      <div style="width:110px">
        <Select :options="OWN_OPTS" :model-value="own" size="sm" @update:model-value="own = $event" />
      </div>
      <div style="width:110px">
        <Select :options="STATUS_OPTS" :model-value="statusSel" size="sm" @update:model-value="status = $event as StatusFilter" />
      </div>
      <div class="mx-search">
        <span class="mx-search-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </span>
        <input v-model="q" placeholder="搜索租户/原文/房号/表号/编码" />
      </div>
      <!-- 只看存疑(V75 §E3/§F1):有存疑表才出现;按下=只列两级存疑档案(疑似重复 + 档案不全) -->
      <Button
        v-if="suspectCount > 0" :variant="suspectOnly ? 'filled' : 'outline'" size="sm"
        :title="`${suspectCount} 块表区域/位置/企业名称/编码全空;其中 ${shadowCount} 块另配到档案完整、同月示数与倍率全等的同栋同类表,疑似重复建档(红底,用量不计入楼栋分表Σ),其余只是档案不全(黄底,用量照常计入Σ)`"
        @click="suspectOnly = !suspectOnly"
      >
        <template #leading><component :is="iconFor('alert-triangle')" :size="14" /></template>
        只看存疑 · {{ suspectCount }}
      </Button>
      <span style="flex:1" />
      <!-- 「按名精确匹配一键挂」:待核卡激活时工具栏侧出现(编辑态,S2 §3) -->
      <Button v-if="showAutoLink" variant="outline" size="sm" :disabled="linking || cards.pending === 0" @click="autoLink">
        <template #leading><component :is="iconFor('wand-2')" :size="14" /></template>
        按名精确匹配一键挂
      </Button>
      <Button variant="outline" size="sm" @click="resetFilters">重置</Button>
    </div>

    <!-- 隐藏表出口的说明条:这两批平时不产行,列出来是为了改回去,所以得直说改哪一格 -->
    <div v-if="hiddenHint" class="mt-hidbar">
      <component :is="iconFor('info')" :size="14" />
      <span>{{ hiddenHint }}</span>
      <span v-if="!editMode" class="mt-hidbar-em">先点右上「编辑模式」才能改。</span>
    </div>
    <!-- 本月册子(SPEC §10.4):整月没读数时让位给上面的空态引导,不叠两条 -->
    <div v-if="bookGap && readings.length" class="mt-bookbar">
      <component :is="iconFor('info')" :size="14" />
      <span>{{ bookGap }}</span>
    </div>

    <!-- 这里原来是「建议在桌面端操作」的常驻预留位(§5.3/§11.2)。2026-09-21 用户拍板撤掉:
         它只能常驻(用的时候才冒出来会把整张表顶走,LAYOUT-STABILITY §1),于是浏览态也吃
         20px + 一道 14 的 gap = 34px —— 正好一行表。撤掉后表从 8 行回到 9 行。
         理由与影响面记在规范 §5.3;块序与行数由 meterNarrow.spec 的块高断言钉着。
         录入仍不禁止、不隐藏、不优化(§11.2),只是不再为这句话留一整行。 -->
    <!-- 台账同款电子表格(§7 v5.1):分时列常驻,无分页,草稿式编辑 -->
    <MeterLedgerGrid
      :rows="gridRows" :view-key="viewKey" :edit-mode="editable" :kind="kind" :zone="zone" :draft="draft"
      :building-name-by-id="buildingNameById" :empty-text="emptyText"
      @open="openId = $event" @cell-edit="onCellEdit"
    />

    <!-- 退出编辑确认(§7.2):保存修改/放弃修改/×留在编辑态 -->
    <SaveConfirmDialog
      v-if="saveConfirm" :count="dirtyIds.length"
      @save="onSaveChanges" @discard="onDiscardChanges" @close="saveConfirm = false"
    />

    <!-- 详情抽屉:三页签(表档案/历史读数/合同绑定) -->
    <MeterDetailDrawer
      :row="openRow" :edit-mode="editMode && !loadErr" :default-ym="ym"
      :tenants="tenants" :buildings="buildings" :bind-available="bindRows !== null && !bindFail"
      :area-opts="areaOpts" :floor-opts="floorOpts" :side-opts="sideOpts"
      @close="openId = null" @reload="reloadAll"
    />

    <!-- 导入(registry key 'meter':整册 parseWorkbook → sections 勾选段;flat/sections 两口都接) -->
    <FpImportModal
      v-if="importing"
      title="导入 园区抄表 · 水电表读数"
      sub="上传整册抄表工作簿(各期区×电/水 sheet,标题行含年月),识别 sheet 逐段勾选;表自动建档并按企业名称匹配租户/楼栋/归属,同表同月重复导入自动覆盖;缺本月读数照收并标「未抄」"
      v-bind="parserProps('meter', { ...importCtx, year, month })"
      @close="importing = false"
      @import="onImport"
      @import-sections="onImport"
    />
    <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />

    <!-- S/M 档底部面板(§5.10「其余进底部面板,面板里一件不少」)。
         壳复用 styles/form-sheet.css 的 .fp-fsheet 全屏 sheet(§4.4)——
         输入控件 44 高 / 16px 字由那份 CSS 给,这里不再写第二份。
         panel='filter':筛选七件里收进来的六件(分区/电水段控 + 楼栋/归属/状态下拉 + 重置);
         panel='more'  :摘要行里此刻值为 0 的那几样,点一下照样筛表。 -->
    <div v-if="isSM && panel" class="mt-mask fp-fsheet" @mousedown="panel = ''">
      <div class="mt-dlg mt5-panel" @mousedown.stop>
        <div class="mt-dlg-h">
          <h3>{{ panel === 'filter' ? '筛选' : '更多' }}</h3>
        </div>
        <div class="mt-dlg-b fp-fsheet-bd">
          <template v-if="panel === 'filter'">
            <Segmented :options="ZONE_OPTS" :model-value="zone" size="sm" @update:model-value="zone = $event; building = 'all'" />
            <Segmented :options="KIND_OPTS" :model-value="kind" size="sm" @update:model-value="kind = $event" />
            <Select :options="buildingOpts" :model-value="building" size="sm" @update:model-value="building = $event" />
            <Select :options="OWN_OPTS" :model-value="own" size="sm" @update:model-value="own = $event" />
            <Select :options="STATUS_OPTS" :model-value="statusSel" size="sm" @update:model-value="status = $event as StatusFilter" />
            <Button
              v-if="suspectCount > 0" :variant="suspectOnly ? 'filled' : 'outline'" size="sm"
              @click="suspectOnly = !suspectOnly"
            >
              <template #leading><component :is="iconFor('alert-triangle')" :size="14" /></template>
              只看存疑 · {{ suspectCount }}
            </Button>
          </template>
          <template v-else>
            <button
              v-for="c in moreSegs" :key="c.k"
              class="mt5-seg" :class="[c.cls, { on: status === c.k }]"
              @click="cardClick(c.k); panel = ''"
            >
              <span class="lab">{{ c.label }}</span>
              <span class="val">{{ c.val }}</span>
            </button>
          </template>
        </div>
        <div class="mt-dlg-f fp-fsheet-ft">
          <Button v-if="panel === 'filter'" variant="gray" size="sm" @click="resetFilters">重置</Button>
          <Button variant="filled" size="sm" @click="panel = ''">完成</Button>
        </div>
      </div>
    </div>

    <!-- 新增表轻量弹窗(v4 原样) -->
    <div v-if="meterDlg" class="mt-mask" :class="{ 'fp-fsheet': sheet }" @mousedown="meterDlg = false">
      <div class="mt-dlg" @mousedown.stop>
        <div class="mt-dlg-h">
          <h3>新增表</h3>
          <p>手工建档一块水/电表,自所选月份起在册,更早的月份里没有它;楼栋/租户/归属可留空或后补,导入整册抄表工作簿时会自动匹配/刷新。</p>
        </div>
        <div class="mt-dlg-b fp-fsheet-bd">
          <div class="mt-dlg-row">
            <Select v-model="mForm.kind" label="类别" :options="KIND_OPTS" size="sm" />
            <Select v-model="mForm.zone" label="分区" :options="ZONE_OPTS" size="sm" />
          </div>
          <div class="mt-fld">
            <label>自这个月起在册</label>
            <DatePicker v-model="mForm.fromYm" mode="month" size="sm" aria-label="自这个月起在册" />
          </div>
          <div class="mt-dlg-row">
            <Select v-model="mForm.building" label="期数·楼栋(可空)" :options="dlgBuildingOpts" size="sm" />
            <Select v-model="mForm.ownership" label="归属" :options="DLG_OWN_OPTS" size="sm" :disabled="mForm.tenantId != null" />
          </div>
          <div class="mt-fld">
            <label>租户(可空;户内表关联,选定即归属「租户」)</label>
            <FPTenantPicker v-model="mForm.tenantId" :tenants="tenantOpts" placeholder="选择租户(可空)" />
          </div>
          <div class="mt-dlg-row">
            <Input v-model="mForm.name" label="标识名(内部键,同区同类唯一)" placeholder="如:一车间总电" size="sm" />
            <Input v-model="mForm.subName" label="表名称(可空)" placeholder="如:电表①" size="sm" />
          </div>
          <div class="mt-dlg-row">
            <Input v-model="mForm.factor" label="倍率(留空=1)" placeholder="如:500" size="sm" type="number" />
            <Input v-model="mForm.area" label="区域(可空,区块名)" placeholder="如:A座 / 六车间" size="sm" />
          </div>
          <!-- §A.4 位置四件套:楼层/方位/房号是稳定主数据(排序+公摊按层分份),位置原文另兼导入匹配键 -->
          <div class="mt-dlg-row">
            <Select v-model="mForm.floorLabel" label="楼层" :options="dlgFloorOpts" size="sm" />
            <Select v-model="mForm.side" label="方位(可空)" :options="dlgSideOpts" size="sm" />
          </div>
          <div class="mt-dlg-row">
            <Input v-model="mForm.roomNo" label="房号(可空)" placeholder="如:101室" size="sm" />
            <Input v-model="mForm.spot" label="位置原文(可空,导入匹配键)" placeholder="如:四楼西侧101室" size="sm" />
          </div>
          <div class="mt-dlg-row">
            <Input v-model="mForm.code" label="表编码(可空,导入首选身份键)" size="sm" />
          </div>
          <div class="mt-dlg-err">{{ mErr }}</div>
        </div>
        <div class="mt-dlg-f fp-fsheet-ft">
          <Button variant="gray" size="sm" @click="meterDlg = false">取消</Button>
          <Button variant="filled" size="sm" @click="submitMeter">
            <template #leading><component :is="iconFor('check')" :size="14" /></template>
            新增
          </Button>
        </div>
      </div>
    </div>

    <!-- §H5 批量删除本期:复述预览数字 + 级联勾选 + 手打账期才放行(不可逆,无撤销) -->
    <div v-if="delPreview" class="mt-mask" @mousedown="delPreview = null">
      <div class="mt-dlg" @mousedown.stop>
        <div class="mt-dlg-h">
          <h3>批量删除本期 · {{ delPreview.ym }}</h3>
          <p>不可逆操作,删除后无法撤销。请核对下列数字后输入账期确认。</p>
        </div>
        <div class="mt-dlg-b">
          <ul class="mt5-del-list">
            <li>将删除读数 <b>{{ delPreview.readings }}</b> 条,涉及 <b>{{ delPreview.meters }}</b> 块表</li>
            <li>其中 <b>{{ delPreview.metersEmptied }}</b> 块表删完后零读数</li>
            <li>将删除该月派生快照 <b>{{ delPreview.derived }}</b> 条(池核算/逐表明细/损耗/分摊结果)</li>
            <li v-if="delLockedN > 0" class="warn">
              该月有 <b>{{ delLockedN }}</b> 张已确认/已导出的催缴单({{ delLockedNames }}),读数删了单上的数就对不上了。先在催缴单屏作废这些单,再回来删
            </li>
            <!-- METER-TIMELINE-SPEC §3.5:本期导入写下的归属 / 状态记录一并删掉,预览里报数 -->
            <li v-if="(delPreview.assignRows ?? 0) + (delPreview.statusRows ?? 0) > 0">
              连带删除本期导入写下的表档案记录 <b>{{ (delPreview.assignRows ?? 0) + (delPreview.statusRows ?? 0) }}</b> 条
              (归属 {{ delPreview.assignRows ?? 0 }} · 状态 {{ delPreview.statusRows ?? 0 }})
            </li>
            <!-- SPEC §10.2:本月「册子里有这块表」的记录一并删,预览多报这个数 -->
            <li v-if="(delPreview.bookRows ?? 0) > 0">
              连带删除本月册子记录 <b>{{ delPreview.bookRows }}</b> 条,删后这个月算作没导入过册子
            </li>
            <li v-if="delPreview.meterDeleted.length > 0">
              连带删除表档案 <b>{{ delPreview.meterDeleted.length }}</b> 份:{{ delPreview.meterDeleted.join('、') }}
            </li>
            <li v-if="delPreview.meterBlocked.length > 0" class="warn">
              跳过不删的表档案 <b>{{ delPreview.meterBlocked.length }}</b> 份(池成员,或别的月的催缴单里还有它):{{ delPreview.meterBlocked.join('、') }}
            </li>
            <li v-if="delPreview.manualKept.length > 0" class="keep">
              保留的手工分摊行 <b>{{ delPreview.manualKept.length }}</b> 条(不删):{{ delPreview.manualKept.join('、') }}
            </li>
          </ul>
          <label class="mt5-del-ck">
            <input v-model="delCascade" type="checkbox" >
            <span>同时删除该月派生快照(手工分摊行始终保留)</span>
          </label>
          <label class="mt5-del-ck">
            <input v-model="delDropMeters" type="checkbox" >
            <span>同时删除「删完零读数」的表档案(池成员表、别的月催缴单里还有的表自动跳过)</span>
          </label>
          <p v-if="delOpenN > 0 && !canBillRun" class="mt5-del-nobill">
            该月有 {{ delOpenN }} 张草稿催缴单,连带删除要出账权限;请有出账权限的人来删,或先到催缴单屏处理
          </p>
          <label v-if="delOpenN > 0 && canBillRun" class="mt5-del-ck">
            <input v-model="delDropNotices" type="checkbox" >
            <span>同时删除该月的草稿催缴单({{ delOpenN }} 张{{ delPreview.voidNotices ? `,含已作废 ${delPreview.voidNotices} 张` : '' }})。催缴单按户整月出,删的是这个月全部的草稿,删后可在催缴单屏重新生成</span>
          </label>
          <Input v-model="delTyped" :label="`确认请输入账期 ${delPreview.ym}`" :placeholder="delPreview.ym" size="sm" />
        </div>
        <div class="mt-dlg-f">
          <Button variant="gray" size="sm" @click="delPreview = null">取消</Button>
          <Button
            variant="danger" size="sm"
            :disabled="delBusy || delLockedN > 0 || (delOpenN > 0 && !canBillRun) || delTyped.trim() !== delPreview.ym"
            @click="confirmDelete"
          >
            <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
            确认删除
          </Button>
        </div>
      </div>
    </div>
    <FPElevateDialog
      :page="`园区抄表 · ${year} 年`" :action="'修改表档案 / 抄表读数'" :perms="asking" what="录入抄表读数或改表档案" @close="cancelAsk" @elevated="onElevated" />
    <FPLockDialogs :locked-by="lockedBy" :evicted-by="evictedBy" :scope="lockScope()"
                   :what="`园区抄表 ${year} 年`"
                   @taken="onTaken" @close-takeover="lockedBy = null" @close-evicted="evictedBy = null" />
    <FPToast v-model="okMsg" :tone="toastTone" placement="page" :duration="toastTone === 'warning' ? 0 : 6000" />
    <FPToast v-model="deepNote" tone="warning" placement="page" :duration="0" />
  </div>
</template>

<style scoped>
.mt-page { display: flex; flex-direction: column; gap: 14px; height: 100%; min-height: 0; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%; }

/* 标题行(pm-head 家族):左=标题+账期+进度条;右=按钮组 */
.mt-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.mt-head-l { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mt-title { margin: 0 6px 0 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.mt-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.mt5-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/* 编辑中改动数 tag(lg-tag.edit 同款) */
.mt5-tag { display: inline-flex; align-items: center; height: 28px; padding: 0 12px; border-radius: var(--radius-full); background: var(--warn-soft); color: var(--hue-orange); font-size: 12.5px; font-weight: var(--fw-medium); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* 抄表进度条(已抄/租户表数,随 kind/zone) */
.mt5-prog { display: flex; align-items: center; gap: 8px; cursor: help; }
.mt5-prog .bar { width: 132px; height: 6px; border-radius: var(--radius-full); background: var(--bg-sunken); overflow: hidden; }
.mt5-prog .bar span { display: block; height: 100%; border-radius: var(--radius-full); background: rgb(52, 168, 83); transition: width var(--dur-fast) var(--ease-standard); }
.mt5-prog .txt { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-micro); color: var(--text-muted); white-space: nowrap; }

/* 统计卡行:6 张可点击卡,选中高亮 */
.mt5-cards { flex: 0 0 auto; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
.mt5-card { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 12px 14px; min-width: 0; background: var(--surface-white); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); cursor: pointer; text-align: left; font: inherit; transition: border-color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard); }
.mt5-card:hover { border-color: var(--border-strong); }
.mt5-card.on { border-color: var(--hue-blue); background: rgb(240, 246, 255); box-shadow: 0 0 0 1px var(--hue-blue) inset; }
:root[data-theme="dark"] .mt5-card.on { background: var(--row-selected); }
.mt5-card .lab { font: var(--type-label); color: var(--text-muted); white-space: nowrap; }
.mt5-card .val { font-size: 21px; font-weight: var(--fw-semibold); letter-spacing: var(--ls-tight); color: var(--text-primary); font-variant-numeric: tabular-nums; line-height: 1.1; white-space: nowrap; }
.mt5-card .sub { font-size: var(--fs-micro); color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.mt5-card.ok .val { color: var(--ok-text); }
.mt5-card.amber .val { color: var(--badge-orange-text); }
.mt5-card.bad .val { color: var(--hue-red); }
.mt5-card.coral .val { color: var(--coral-text); }

/* 筛选条:单行 */
.mt5-filters { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

/* 月度空态引导条 */
.mt-empty { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--fs-label); color: var(--text-secondary); }
.mt-link { border: none; background: none; padding: 0; margin: 0 2px; font: inherit; color: var(--hue-blue); cursor: pointer; }
.mt-link:hover { text-decoration: underline; }

/* 加载失败条(借空态条骨架换红):提示 + 重试入口 */
/* 隐藏表出口说明条:蓝调=这不是错误,是「你正在看平时不显示的那批」 */
.mt-hidbar, .mt-bookbar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; border: 1px solid rgb(206, 223, 252); border-radius: var(--radius-md); background: rgb(238, 244, 255); font-size: 12px; color: rgb(28, 84, 168); }
:root[data-theme="dark"] .mt-hidbar, :root[data-theme="dark"] .mt-bookbar { border-color: color-mix(in srgb, var(--hue-blue) 35%, transparent); background: var(--info-soft); color: var(--hue-blue); }
.mt-hidbar-em { font-weight: var(--fw-semibold); }
/* 一句话较长:字跟图标同一行、在自己那一格里折行(不整段掉到图标下面) */
.mt-bookbar > span { flex: 1 1 0; min-width: 0; }
.mt-empty .msg { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
/* 首载失败占满 gate 的位置(与 .page-loading 同为整页态,顶部起排不居中) */
.mt-gate-fail { padding: 24px 0; max-width: 1600px; margin: 0 auto; width: 100%; box-sizing: border-box; }

/* 新增表弹窗(v4 mt-dlg 家族) */
.mt-mask { position: fixed; inset: 0; background: var(--scrim); z-index: 140; display: grid; place-items: center; }
.mt-dlg { width: min(460px, 90vw); background: var(--surface-white); border-radius: var(--radius-xl); box-shadow: 0 16px 48px rgba(28, 28, 28, .22); overflow: visible; }
.mt-dlg-h { padding: 20px 22px 0; }
.mt-dlg-h h3 { margin: 0; font-size: 16px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.mt-dlg-h p { margin: 6px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-muted); }
.mt-dlg-b { padding: 16px 22px 4px; display: flex; flex-direction: column; gap: 12px; }
.mt-dlg-row { display: flex; gap: 12px; }
.mt-dlg-row > * { flex: 1; min-width: 0; }
.mt-fld label { display: block; margin-bottom: 5px; font-size: var(--fs-label); color: var(--text-secondary); }
.mt-dlg-err { font-size: 11.5px; color: var(--hue-red); min-height: 14px; }

/* §H5 批量删除确认:预览数字复述 + 级联勾选 */
.mt5-del-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--text-secondary); }
.mt5-del-list b { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.mt5-del-list .warn { color: var(--hue-orange); }
.mt5-del-list .keep { color: var(--text-muted); }
.mt5-del-ck { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-secondary); cursor: pointer; }
.mt5-del-nobill { margin: 0; font-size: 12.5px; color: var(--hue-orange); }
.mt-dlg-f { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 22px 20px; }

/* ── S 档屏顶三块(RESPONSIVE-LAYOUT-SPEC §5.7 + §5.10)────────────────────────
   这几块整条挂在 v-if="isS" / v-if="isSM"(JS 档位)上,宽档 DOM 里根本不存在 —— 故**不套 @media**
   (同 LedgerWideTable:598 那段的理由)。高度是算术的一部分,不是凑的:
   工序条 54(§5.9) + 摘要行 44 + 筛选条 44 + 标题行 0 = 屏顶 142,表才露得出行来。
   两块都 flex:0 0 <定高> —— .mt-page 是 height:100% 定高链,写成可压缩的话
   表(唯一 flex:1)算出来的高度就跟这里的数对不上。 */
.mt5-sum { flex: 0 0 44px; height: 44px; box-sizing: border-box; position: relative; display: flex; align-items: center; gap: 8px; padding-bottom: 3px; }
.mt5-sum-segs { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; overflow-x: auto; scrollbar-width: none; }
.mt5-sum-segs::-webkit-scrollbar { display: none; }
/* 每段是独立点击区:点「未抄 1」照样筛表(与宽档的点卡同一条 cardClick)。
   36 是 §6.2 行内次级操作的触达下限 —— 段高不许跟着 44 行里的余量缩。 */
.mt5-seg { flex: 0 0 auto; min-height: 36px; display: flex; align-items: center; gap: 6px; padding: 0 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-full); background: var(--surface-white); cursor: pointer; font: inherit; white-space: nowrap; }
.mt5-seg.on { border-color: var(--hue-blue); background: var(--row-selected); }
.mt5-seg .lab { font: var(--type-label); color: var(--text-muted); }
.mt5-seg .val { font-size: 15px; font-weight: var(--fw-semibold); color: var(--text-primary); font-variant-numeric: tabular-nums; }
.mt5-seg.ok .val { color: var(--ok-text); }
.mt5-seg.amber .val { color: var(--badge-orange-text); }
.mt5-seg.bad .val { color: var(--hue-red); }
.mt5-seg.coral .val { color: var(--coral-text); }
/* 进度「留数不留条」(§5.10):数已经在段里(已抄/租户表总数),条退成行底 3px 底纹 */
.mt5-sum-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; border-radius: var(--radius-full); background: var(--bg-sunken); overflow: hidden; }
.mt5-sum-bar > span { display: block; height: 100%; background: var(--ok-text); }

.mt5-fbar { flex: 0 0 44px; height: 44px; box-sizing: border-box; display: flex; align-items: center; gap: 8px; }
.mt5-fbar .mx-search { flex: 1 1 auto; width: auto; min-width: 0; }
/* M 档那 2 个主动作:不许被搜索框挤扁(搜索是这一行唯一可伸缩的件) */
.mt5-mact { flex: 0 0 auto; }
/* 16px 免 iOS 聚焦缩放(§6.5;本行只在 S/M 档存在,故直接引用 token 不再包媒体块) */
.mt5-fbar .mx-search input { font-size: var(--fs-input-m); }
.mt5-fbtn { position: relative; flex: 0 0 auto; width: 44px; height: 44px; display: grid; place-items: center; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-white); color: var(--text-secondary); cursor: pointer; }
.mt5-fbtn.on { border-color: var(--hue-blue); color: var(--hue-blue); }
/* 编辑钮上的「改了几处」角标:绝对定位,不参与布局 —— 出现与否零位移。几何与 .mt5-fbtn .n 同一份 */
.mt5-ebtn { position: relative; flex: 0 0 auto; display: inline-flex; }
.mt5-ebtn .n { position: absolute; top: 2px; right: 2px; min-width: 15px; height: 15px; padding: 0 3px; border-radius: var(--radius-full); background: var(--hue-orange); color: var(--control-solid-text); font-family: var(--font-mono); font-size: 10px; display: grid; place-items: center; pointer-events: none; }
/* 已选计数贴在定宽钮上(同顶栏红点口径):出现与消失都不挪这一行 */
.mt5-fbtn .n { position: absolute; top: 2px; right: 2px; min-width: 15px; height: 15px; padding: 0 3px; border-radius: var(--radius-full); background: var(--hue-blue); color: var(--control-solid-text); font-family: var(--font-mono); font-size: 10px; display: grid; place-items: center; pointer-events: none; }

/* 底部面板里的控件按 §6.2 主操作档 44 高;段占满整行(只有一列) */
.mt5-panel .mt5-seg { min-height: 44px; justify-content: space-between; }

/* ── 响应式(RESPONSIVE-LAYOUT-SPEC §5.3 P3 查看态):只用 960/600,宽档规则在前 ── */
@media (max-width: 960px) { /* M↓ */
  /* 统计卡 6 列在窄档挤成一字条(val 21px + sub 会溢出):M 降三列两行,组成按档静态确定 */
  .mt5-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 600px) { /* S */
  /* 原先这里还有 .mt5-cards 降两列、.mt5-filters .mx-search 收宽三条 —— §5.7/§5.10 之后
     那两块在 S 档已经不渲染(v-if="!isS"),规则留着也选不中任何东西。它们的活分别
     由 .mt5-sum(摘要行)与 .mt5-fbar(筛选条)接走,见上面那段基础规则。 */
}
</style>
