<script setup lang="ts">
// 抄表电子表格(METER-V5-SPEC §7 v5.1;2026-10-01 按画布 04-A / 04-B / 04-C 重排):
// 列 = 位置 / 用途 / 房号 / 租户 / 表号 / 编码 / 倍率 / 上月行至 / 本月行至 / [尖 峰 平 谷] / 用量 / 状态。
// - 「区域」列删了:楼栋是组头(兼小计、点它收起,datagrid「分组行兼小计」);「位置」= 楼层·方位(原册那一格本来就写「四楼西侧」)。
// - 上月 / 本月各一列总数。尖峰平谷按比例出列(touMode,datagrid「按比例出列」):没有分时表 → 不出列也不出开关;
//   少数 → 默认不出列,分时表那一行 › 点开看或录;过半 → 默认在「本月行至」后出 尖 / 峰 / 平 / 谷 四列。开关记住上次选择。
// - 状态列只写不正常的,已抄留空;倒走写「比上月少 X」。停用的表收在组尾「另有 N 块已停用 · 显示」。
// - 用量是钱那一列(规范 §2 第 29 条):加粗 + 浅蓝底 + 表头下蓝线,字不用蓝。行高 40、正文 14、表头 12、读数两位小数。
// 固定列走 useWideTable(LIST-PAGE §9,07-C 园区抄表行):用途 → 用量 → 位置 → 状态;按表格区可见宽退列,不按屏幕档。
// 列宽按全量行算(numW / textW,不量 DOM):窗口化只渲染可视行,量 DOM 会随滚动变。同一份行集里只增不减。
// 行窗口化虚拟滚动(§7 6.5):显示列表(flattenGroups)只渲染可视±12 项,前后 spacer tr 撑高,passive scroll+rAF 节流。
// 草稿式编辑:编辑态「本月行至」是输入格(没有底数的行「上月行至」开放录入底数),draft 归属父层 MeterView,
// 本组件只读取草稿 + emit cell-edit;用量 / 组小计 / 合计按草稿实时重算;校验红显不拦保存(§7.4)。
// 键盘流(§7.3):Enter 总 →(尖)→ 峰 → 平 → 谷 → 下一块表的总;Tab 走原生 DOM 序。
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, type Ref } from 'vue'
import { iconFor } from '@/components/ds/icon'
import { useViewport } from '@/composables/useViewport'
import { useWideTable, numW, textW, minTableH, type WideCol, type HeightDims } from '@/composables/useWideTable'
import { touMode, loadTouPref, saveTouPref } from '@/utils/touColumns'
import FPTableTools from '@/components/fp/FPTableTools.vue'
import FPMark from '@/components/fp/FPMark.vue'
import {
  STATUS_META, statusDims, bookTip, effVal, serverVal, baseOpen, rowUsage, draftRowIssues, gridFooter, groupByBuilding, groupUsage,
  flattenGroups, buildWindow, offsetOf, segRowUsage, SEG_FIELDS, ROW_H,
  type WorkbenchRow, type MeterDraft, type DraftField, type BuildingGroup, type RowWindow, type SegLine, type SegKey,
  type DisplayItem,
} from '@/composables/useMeterWorkbench'
import { ownershipLabel } from '@/utils/meterSplit'
import type { MeterLoc } from '@/utils/meterGroup'

const props = defineProps<{
  rows: WorkbenchRow[]              // 筛选后有序行集
  viewKey: string                   // 视图身份(筛选维度拼串):回顶的唯一判据,见下方 watch
  editMode: boolean
  kind: string
  zone: string                      // 当前分区(p1/p2/dorm):dorm 下房号列显「宿舍单元」
  draft: Map<number, MeterDraft>    // 草稿归属 MeterView(§7.2)
  buildingNameById: Map<number, string>
  emptyText: string
  /** 按比例出列的分母:这一期区、这一表类的全部行(不随状态页签 / 搜索变 —— 否则切页签尖峰平谷列会跳)。缺省用 rows */
  touBase?: WorkbenchRow[]
  /** 筛选本身就在找停用表(已停用 / 本月有变化):停用的表直接排进组里,不收进组尾「另有 N 块已停用」 */
  retiredOpen?: boolean
}>()
const emit = defineEmits<{
  open: [meterId: number]
  'cell-edit': [p: { meterId: number; field: DraftField; value: string }]
}>()

const ChevronRight = iconFor('chevron-right')
const ChevronDown = iconFor('chevron-down')
const FACTOR_TIP = '有读数=当月录入时倍率快照;无读数=档案倍率。历史读数按录入时快照计用量,改档案倍率只影响之后新录'
const PENDING_TIP = '企业名称原文未匹配到租户档案,点击在抽屉「合同绑定」页签挂租户'
const SHADOW_TIP = '疑似重复建档:本表区域/位置/企业名称/编码全空,且与同栋同类的另一块档案完整的表同月上下期示数与倍率完全相等,很可能是同一块物理表的第二份档案。该表用量暂不计入楼栋分表Σ;认对后请补齐档案(在抽屉保存一次即解除存疑)'
const INC_TIP = '档案不全:区域/位置/企业名称/编码全空,但配不到重复对手,按真表处理 —— 用量照常计入楼栋分表Σ。请补齐档案(在抽屉保存一次即解除提示)'
const { tier } = useViewport()

// ── 按比例出列(画布 04-C):分母是这一期区这一表类的全部行,水表没有分时 → 'none' ──
const tm = computed(() => {
  const base = props.touBase ?? props.rows
  return touMode(base.filter(x => x.tou).length, base.length)
})
const touPref = ref(loadTouPref('meter'))
const colsOn = computed(() => tm.value !== 'none' && (touPref.value ?? tm.value === 'cols'))
function setTou(on: boolean) { touPref.value = on; saveTouPref('meter', on) }
const rowMode = computed(() => tm.value !== 'none' && !colsOn.value)   // 分时表那一行 › 点开
const TOU_COLS = (['sharp', 'peak', 'flat', 'valley'] as SegKey[]).map(k => ({ k, ...SEG_FIELDS[k] }))
const touCols = computed(() => (colsOn.value ? TOU_COLS : []))

// ── 列菜单(卡内「列」):中间四列可藏;位置 / 用途 / 租户 / 读数 / 用量 / 状态常驻 ——
//    租户不许藏:租户格是打开这块表详情抽屉(表档案 / 历史读数 / 合同绑定 / 在册状态)的唯一入口(对抗复查 regress-3)
const MID = [
  { key: 'room', label: '房号' }, { key: 'ten', label: '租户' }, { key: 'sub', label: '表号' },
  { key: 'code', label: '编码' }, { key: 'fac', label: '倍率' },
] as const
type MidKey = typeof MID[number]['key']
const hidden = ref<string[]>([])
const toolCols = computed(() => MID.filter(c => c.key !== 'ten')
  .map(c => ({ key: c.key, label: c.key === 'room' && props.zone === 'dorm' ? '宿舍单元' : c.label })))
const show = computed(() =>
  Object.fromEntries(MID.map(c => [c.key, c.key === 'ten' || !hidden.value.includes(c.key)])) as Record<MidKey, boolean>)
const nMid = computed(() => MID.filter(c => show.value[c.key]).length)
/** 位置 用途 上月 本月 用量 状态 = 6,+ 中间列 + 尖峰平谷 + 最右空列 1(spacer / 空态行跨满整行) */
const colCount = computed(() => 7 + nMid.value + touCols.value.length)

// ── 楼栋分组(§7.6):首现序稳定分组;组头小计随 draft 实时(敲键只重算这一层,不重分组) ──
const groups = computed(() => groupByBuilding(props.rows, props.buildingNameById))
const grpUsage = computed(() =>
  new Map(groups.value.map(g => [g.key, groupUsage(g.rows, props.draft)] as const)))
const usageOf = (g: BuildingGroup) => grpUsage.value.get(g.key)!
const grpSegTip = (g: BuildingGroup) => {
  if (props.kind !== 'elec') return undefined
  const u = usageOf(g)
  return `尖 ${f2(u.sharp)} 峰 ${f2(u.peak)} 平 ${f2(u.flat)} 谷 ${f2(u.valley)}`
}

// 收起的组 / 显示了停用表的组 / 点开分时段的表:都不记忆(规范 §2 第 25 条),换视图清空
const collapsed = ref(new Set<string>())
const showRetired = ref(new Set<string>())
const expanded = ref(new Set<number>())
function flip<T>(s: Ref<Set<T>>, k: T) {
  const n = new Set(s.value)
  if (n.has(k)) n.delete(k)
  else n.add(k)
  s.value = n
}
const toggleGroup = (key: string) => flip(collapsed, key)
const toggleRetired = (key: string) => flip(showRetired, key)
const toggleRow = (id: number) => flip(expanded, id)

// ── 行窗口化虚拟滚动(§7 6.5) ──
const wrapEl = ref<HTMLElement | null>(null)
const displayList = computed(() => flattenGroups(groups.value, {
  collapsed: collapsed.value, showRetired: showRetired.value,
  expanded: rowMode.value ? expanded.value : undefined, edit: props.editMode, retiredOpen: props.retiredOpen,
}))
const win = ref<RowWindow>({ start: 0, end: 0, topPad: 0, bottomPad: 0 })
const itemKey = (it: DisplayItem) => (it.type === 'row' ? it.x.m.id
  : it.type === 'seg' ? `s${it.x.m.id}-${it.seg.keys.join()}` : `${it.type}-${it.g.key}`)
// 类型展平给模板用(di=显示列表全局索引,键盘流寻址用)
const visItems = computed(() => {
  const { start, end } = win.value
  return displayList.value.slice(start, end).map((it, i) => ({
    di: start + i, t: it.type, key: itemKey(it),
    x: it.type === 'row' || it.type === 'seg' ? it.x : null,
    seg: it.type === 'seg' ? it.seg : null,
    g: it.type === 'ghead' || it.type === 'retired' ? it.g : null,
    n: it.type === 'ghead' || it.type === 'retired' ? it.n : 0,
    on: it.type === 'ghead' ? it.open : it.type === 'retired' ? it.shown : false,
  }))
})

function syncWindow(force = false) {
  const wrap = wrapEl.value
  const next = buildWindow(displayList.value, wrap?.scrollTop ?? 0, wrap?.clientHeight ?? 600)
  const cur = win.value
  // 窗口移动<4 行不 setState(12 行缓冲兜底),防细粒度滚动反复重渲染
  if (!force && Math.abs(next.start - cur.start) < 4 && Math.abs(next.end - cur.end) < 4) return
  win.value = next
}
let rafId = 0
function onScroll() {
  if (rafId) return
  rafId = requestAnimationFrame(() => { rafId = 0; syncWindow() })
}
let ro: ResizeObserver | null = null
onMounted(() => {
  syncWindow(true)
  ro = new ResizeObserver(() => syncWindow(true))
  if (wrapEl.value) ro.observe(wrapEl.value)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  if (rafId) cancelAnimationFrame(rafId)
})
// 回顶只认视图身份,不认数组引用(WRITE-KEEP-CONTEXT-SPEC 铁律一):抽屉 reload、草稿批量保存、KeepAlive 回页
// 都产新 rows 数组,却是同一张表 —— 不许把人打回第 0 行。换筛选/账期/电水/分区都在 viewKey 里,变了才回顶。
// 此刻 props.rows 已是新值(props 先于 watch 回调更新),这里自己也重建一次窗口,不靠下面那条 watch 兜底。
watch(() => props.viewKey, () => {
  if (wrapEl.value) wrapEl.value.scrollTop = 0
  collapsed.value = new Set()
  showRetired.value = new Set()
  expanded.value = new Set()
  syncWindow(true)
})
// 显示列表变了(重拉 / 收起组 / 显示停用 / 点开分时段 / 进出编辑态)只重建窗口,不动 scrollTop。draft 键入不动它。
// nextTick 二次同步:watch 默认 pre-flush,此刻读到的是 DOM 更新前的 scrollTop;列表一次变短 ≥12 行
// 且用户停在底部时浏览器会夹紧 scrollTop,DOM 落位后再算一次,顶部不留空白。
watch(displayList, () => {
  syncWindow(true)
  nextTick(() => syncWindow(true))
})

// ── 行派生(草稿实时):用量 + 校验红显 + 状态格;页脚合计 ──
interface StCell { text: string; cls: string; neg: boolean }
// 状态列只写不正常的(datagrid「格内写法」);倒走按草稿实时写「比上月少 X」(画布 04-B 联塑精铟)
function stCell(x: WorkbenchRow, d: MeterDraft | undefined): StCell | null {
  const p = effVal(x, d, 'prevTotal')
  const c = effVal(x, d, 'currTotal')
  if (p != null && c != null) {
    if (c < p) return { text: `比上月少 ${f2(p - c)}`, cls: 'bad', neg: true }
    if (x.status === 'negative') return null           // 草稿把倒走改好了
  }
  if (x.status === 'read') return null
  const s = STATUS_META[x.status]
  return { text: s.label, cls: s.cls, neg: false }
}
const drv = computed(() => {
  const m = new Map<number, { usage: number | null; issues: string[]; st: StCell | null }>()
  for (const x of props.rows) {
    const d = props.draft.get(x.m.id)
    m.set(x.m.id, { usage: rowUsage(x, d), issues: draftRowIssues(x, d), st: stCell(x, d) })
  }
  return m
})
const foot = computed(() => gridFooter(props.rows, props.draft))

// ── 展示辅助 ──
// 读数、用量两位小数千分位(03-C)。格式器建一次:toLocaleString 每调一次新建一个 Intl 格式器,
// 列宽要按全量行逐格算,编辑态每敲一键几千次,慢到能感觉出来
const NF2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const NFAC = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 })
const f2 = (v: number | null | undefined) => (v == null ? '–' : NF2.format(v))
const fmtFac = (v: number) => NFAC.format(v)
const cur = (x: WorkbenchRow, f: DraftField) => effVal(x, props.draft.get(x.m.id), f)
// input 值=草稿原文>服务器值,防重渲染吞输入
function inputVal(x: WorkbenchRow, f: DraftField): string {
  const d = props.draft.get(x.m.id)?.[f]
  if (d != null) return d
  const v = serverVal(x, f)
  return v == null ? '' : String(v)
}
const locOf = (x: WorkbenchRow) => x.m as MeterLoc
// 「位置」= 楼层·方位(原册那一格本身就写成「四楼西侧」),与公共电核算屏同款话术。V77 §G3:缺段要说出来 ——
// 结构化楼层方位 > spot 原文 > 有区域却什么都没录 → 占位「(位置未录)」(同后端 AllocService.LOC_TODO);
// 区域也空的园区级/跨栋表、非租户表(P2-SHARE-LAYER-SPEC §8 豁免催录)显 '–'。
const LOC_TODO = '(位置未录)'
const LOC_EXEMPT = new Set(['share', 'park', 'ops', 'infra'])
function floorSide(x: WorkbenchRow): string {
  const l = locOf(x)
  return ((l.floorLabel ?? '').trim() + (l.side ?? '').trim())
    || x.m.spot?.trim()
    || (x.m.area?.trim() && !LOC_EXEMPT.has(x.m.ownership) ? LOC_TODO : '–')
}
const locTip = (x: WorkbenchRow) => (floorSide(x) === LOC_TODO
  ? '这块表有区域但没录楼层方位,点开租户列的抽屉补「楼层/方位/房号」三格' : (x.m.spot ?? undefined))
// dorm 回退:宿舍单元「1-309」在导入时已随位置原文落 spot(如「三楼 1-309」),正则直读
const RE_DORM_UNIT = /\d+-\d{3,4}/
const roomNo = (x: WorkbenchRow) =>
  locOf(x).roomNo?.trim()
  || (props.zone === 'dorm' ? x.m.spot?.match(RE_DORM_UNIT)?.[0] : undefined)
  || '–'
// 「用途」=账册「企业名称」列原文;公摊/基础设施表存的是用途描述,缺则回退标识名
const useLabel = (x: WorkbenchRow) => x.m.tenantName ?? x.m.name
// 非租户表只出归属签(名字与「用途」逐字相同,不写两遍);租户表显档案名(待核/绑定判定挂在它上面)
const tenName = (x: WorkbenchRow) => (x.m.ownership === 'tenant' ? (x.tenantLabel ?? '—') : '')
const tenTip = (x: WorkbenchRow) =>
  (x.m.ownership === 'tenant' ? (x.tenantLabel ?? x.m.tenantName ?? undefined) : undefined)
// 表号「电表①新表」:「新表」拆成小签(画布 04-A 公共用电 / 旭化成那一行)
const isNewSub = (x: WorkbenchRow) => !!x.m.subName?.trim().endsWith('新表')
function subShort(x: WorkbenchRow): string {
  const s = x.m.subName?.trim() ?? ''
  return s.replace(/新表$/, '').trim() || (s ? '' : '–')
}
// 分时段行:单段显数(可录),合并的空段行全 '–'
const segIn = (seg: SegLine) => props.editMode && seg.keys.length === 1
const segF = (seg: SegLine) => SEG_FIELDS[seg.keys[0]]
const segVal = (x: WorkbenchRow, seg: SegLine, side: 'p' | 'c') =>
  (seg.keys.length === 1 ? cur(x, segF(seg)[side]) : null)
const segUse = (x: WorkbenchRow, seg: SegLine) =>
  (seg.keys.length === 1 ? segRowUsage(x, props.draft.get(x.m.id), seg.keys[0]) : null)

// ── 列宽(datagrid「列宽」、07-C):按全量行估宽,不量 DOM;同一份行集里只增不减(编辑中变长才加宽) ──
const FS = 14                                       // 正文
const TEN_W = 180                                   // 租户格:名字 + 签,名字可省略(字可以省略,数字不行)
const EXP_W = 28                                    // 位置格左边 › 的位子(row 模式)
const TAG_W = 40                                    // 「新表」小签 + 间距
const hd = (s: string) => textW([s], 12, 20)        // 表头 12
const tx = (strs: string[], pad = 20) => textW(strs, FS, pad)
const nv = (vals: (number | null)[], pad = 24) => numW(vals.map(f2), FS, pad)   // 读数格编辑态要放下输入框的边距
// 文字列只随行集变;数字列随草稿变(编辑中数变长要跟上),分两层,敲键不重算文字列
const textWs = computed(() => {
  const R = props.rows
  const retired = groups.value.map(g => g.rows.filter(x => x.retired).length).filter(n => n > 0)
  return {
    loc: Math.max(hd('位置'), tx(R.map(floorSide))) + (rowMode.value ? EXP_W : 0),
    use: Math.max(hd('用途'), tx(R.map(useLabel)), ...(rowMode.value ? [textW(['平段 · 谷段'], 12, 54)] : []),
      ...retired.map(n => tx([`另有 ${n} 块已停用 显示`], 28))),
    room: Math.max(hd('宿舍单元'), tx(R.map(roomNo))),
    ten: TEN_W,
    sub: Math.max(hd('表号'), ...R.map(x => tx([subShort(x)]) + (isNewSub(x) ? TAG_W : 0))),
    code: Math.max(hd('编码'), numW(R.map(x => x.m.code ?? '–'), FS, 20)),
    fac: Math.max(hd('倍率'), numW(R.map(x => fmtFac(x.factor)), FS, 16)),
  }
})
const numWs = computed(() => {
  const R = props.rows
  const segs = (side: 'p' | 'c') => R.flatMap(x => TOU_COLS.map(s => cur(x, s[side])))
  const w: Record<string, number> = {
    prev: Math.max(hd('上月行至'), nv([...R.map(x => cur(x, 'prevTotal')), ...(rowMode.value ? segs('p') : [])])),
    curr: Math.max(hd('本月行至'), nv([...R.map(x => cur(x, 'currTotal')), ...(rowMode.value ? segs('c') : [])])),
    usage: Math.max(hd('用量'), nv([
      ...R.map(x => drv.value.get(x.m.id)!.usage), foot.value.usageSum, ...[...grpUsage.value.values()].map(u => u.total),
      ...(rowMode.value ? R.flatMap(x => TOU_COLS.map(s => segRowUsage(x, props.draft.get(x.m.id), s.k))) : []),
    ], 16)),
    st: Math.max(hd('状态'), ...R.map(x => { const s = drv.value.get(x.m.id)!.st; return s ? textW([s.text], 11, 36) : 0 })),
  }
  for (const s of TOU_COLS) w[s.c] = Math.max(hd(s.lab), nv(R.map(x => cur(x, s.c))))
  return w
})
const rawW = computed<Record<string, number>>(() => ({ ...textWs.value, ...numWs.value }))
let wKey: unknown = null
let wMax: Record<string, number> = {}
const colW = computed(() => {
  const raw = rawW.value
  if (wKey !== props.rows) { wKey = props.rows; wMax = {} }
  for (const k in raw) wMax[k] = Math.max(wMax[k] ?? 0, raw[k])
  return { ...wMax }
})

// ── 固定列(LIST-PAGE §9、规范 §1.8 园区抄表):用途(名称列,rank 0)→ 用量 → 位置 → 状态 ──
const wideCols = computed<WideCol[]>(() => [
  { key: 'loc', side: 'L', w: colW.value.loc, rank: 2 },
  { key: 'use', side: 'L', w: colW.value.use, rank: 0, name: true, minW: tx(['三个字']) },
  { key: 'usage', side: 'R', w: colW.value.usage, rank: 1 },
  { key: 'st', side: 'R', w: colW.value.st, rank: 3 },
])
// 表头一行 40、行 40、合计 50(04-A 合计行约 50 高);没有分组表头(grpH 0)。不够 8 行先让合计不贴底,再不够给表格区 min-height、整页往下滚
const GRID_H: HeightDims = { grpH: 0, leafH: 40, rowH: ROW_H, footH: 50 }
const { fix, hStage, sbH } = useWideTable(wrapEl, wideCols, GRID_H, () => props.rows)
const W = computed(() => ({ ...colW.value, ...fix.value.w }))
const S = computed(() => {
  const s = fix.value.style
  const at = (k: string) => (s[k] ? { ...s[k] } : undefined)
  const use = at('use')
  // 组头 / 合计的标签格:位置还固定就跨 位置+用途 两格一起钉在左边;位置退了只钉用途那一格(不许比仍固定的列宽)
  return {
    loc: at('loc'), use, usage: at('usage'), st: at('st'),
    lbl: s.loc ? { position: 'sticky' as const, left: '0px', boxShadow: s.use?.boxShadow } : use,
  }
})
const fixCls = (k: 'loc' | 'use' | 'usage' | 'st') => (fix.value.style[k] ? 'mlg-fix' : undefined)
const w = (px: number) => ({ width: px + 'px' })
const tableW = computed(() => {
  const c = W.value
  return c.loc + c.use + MID.reduce((s, m) => s + (show.value[m.key] ? c[m.key] : 0), 0)
    + c.prev + c.curr + touCols.value.reduce((s, t) => s + c[t.c], 0) + c.usage + c.st
})
const showTools = computed(() => tier.value !== 's')   // 手机档不动(规范 §2 第 21 条),不多占一行
// 3 级:表格区最少露 8 行,卡片撑高、整页往下滚(卡 = 工具条 44 + 表格区 + 上下边框 2)
const cardSt = computed(() => (hStage.value === 3
  ? { minHeight: (showTools.value ? 44 : 0) + minTableH(GRID_H) + 2 + sbH.value + 'px' } : undefined))

function onInput(x: WorkbenchRow, f: DraftField, e: Event) {
  emit('cell-edit', { meterId: x.m.id, field: f, value: (e.target as HTMLInputElement).value })
}

// ── 键盘流(§7.3+6.5):Enter 跳下一编辑格 —— 同一行下一格(按比例出列的尖峰平谷),行尾进下一个有输入格的项
//    (数据行或分时段行,组头 / 组尾跳过);目标不在窗口=pending-focus:先 scrollTop 定位重建窗口,渲染后 nextTick 聚焦 ──
function focusCell(di: number, si: number): boolean {
  const el = wrapEl.value?.querySelector<HTMLInputElement>(
    `input.mlg-ni[data-di="${di}"][data-si="${si}"]`)
  if (!el) return false
  el.focus()
  el.select()
  return true
}
// 底数格(SPEC §3.4 新表首月):Enter 进同一行的本月格
function onPrevEnter(e: KeyboardEvent) {
  focusCell(Number((e.target as HTMLElement).dataset.di), 0)
}
const hasInput = (it: DisplayItem) => it.type === 'row' || (it.type === 'seg' && it.seg.keys.length === 1)
function onEnter(e: KeyboardEvent) {
  const t = e.target as HTMLInputElement
  let di = Number(t.dataset.di)
  if (!Number.isFinite(di)) return
  if (focusCell(di, Number(t.dataset.si) + 1)) return
  const list = displayList.value
  do { di++ } while (di < list.length && !hasInput(list[di]))
  if (di >= list.length) return
  if (focusCell(di, 0)) return
  const wrap = wrapEl.value
  if (!wrap) return
  wrap.scrollTop = offsetOf(list, di)                    // 目标行落 sticky 表头下沿
  syncWindow(true)
  nextTick(() => focusCell(di, 0))
}
</script>

<template>
  <div class="mlg-wrap" :style="cardSt">
    <!-- 卡内工具条(画布 04-A 右上「分时列 · 列」):没有分时表不出开关(04-C 宿舍) -->
    <FPTableTools
      v-if="showTools" class="mlg-tools" :mode="tm" switch-label="分时列" :tou="colsOn"
      :columns="toolCols" :hidden="hidden" @update:tou="setTou" @update:hidden="hidden = $event"
    />
    <div ref="wrapEl" class="mlg-scroll" @scroll.passive="onScroll">
      <table class="mlg-table" :class="{ 'hs-foot': hStage >= 2 }" :style="{ width: tableW + 'px' }">
        <!-- 交互稳定性(LIST-PAGE-SPEC §零布局位移):colgroup 钉死每列宽,配合 table-layout:fixed,
             滚动换行时浏览器不再按可见单元格内容重算列宽。
             最后一根 <col> 不给宽 = 最右空列(LIST-PAGE §4 列宽铁律):表格区比各列合计宽时,余宽全落在它身上 -->
        <colgroup>
          <col :style="w(W.loc)" /><col :style="w(W.use)" />
          <template v-for="c in MID" :key="c.key"><col v-if="show[c.key]" :style="w(W[c.key])" /></template>
          <col :style="w(W.prev)" /><col :style="w(W.curr)" />
          <col v-for="s in touCols" :key="s.c" :style="w(W[s.c])" />
          <col :style="w(W.usage)" /><col :style="w(W.st)" /><col />
        </colgroup>
        <thead>
          <tr>
            <th :class="[fixCls('loc'), { gut: rowMode }]" :style="S.loc">位置</th>
            <th :class="fixCls('use')" :style="S.use">用途</th>
            <th v-if="show.room">{{ zone === 'dorm' ? '宿舍单元' : '房号' }}</th>
            <th v-if="show.ten">租户</th>
            <th v-if="show.sub">表号</th>
            <th v-if="show.code">编码</th>
            <th v-if="show.fac" class="r" v-tip="FACTOR_TIP">倍率</th>
            <th class="r vl">上月行至</th>
            <th class="r vl">本月行至</th>
            <th v-for="s in touCols" :key="s.c" class="r">{{ s.lab }}</th>
            <th class="r mlg-money" :class="[fixCls('usage'), { vl: !S.usage }]" :style="S.usage">用量</th>
            <th :class="fixCls('st')" :style="S.st">状态</th>
            <th class="fp-fill" aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          <!-- 窗口化(§7 6.5):顶/底 spacer 撑出全表滚动高度,中间只渲染 [start,end) -->
          <tr v-if="win.topPad > 0" class="mlg-spacer" aria-hidden="true">
            <td :colspan="colCount" :style="{ height: win.topPad + 'px' }"></td>
          </tr>
          <template v-for="v in visItems" :key="v.key">
            <!-- 组头兼小计(画布 04-A「A座 13 块 144,183.58」):点它收起;块数不算停用的 -->
            <tr v-if="v.t === 'ghead'" class="mlg-ghead">
              <td v-if="!S.loc"></td>
              <td :colspan="S.loc ? 2 : 1" class="mlg-fix" :style="S.lbl">
                <button type="button" class="mlg-gbtn" :aria-expanded="v.on" @click="toggleGroup(v.g!.key)">
                  <component :is="ChevronDown" :size="14" class="ch" />{{ v.g!.label }}<span class="n">{{ v.n }} 块</span>
                </button>
              </td>
              <td v-if="nMid" :colspan="nMid"></td>
              <td class="vl"></td><td class="vl"></td>
              <td v-for="s in touCols" :key="s.c"></td>
              <td class="mlg-money" :class="[fixCls('usage'), { vl: !S.usage }]" :style="S.usage">
                <span class="mlg-sumc" v-tip="grpSegTip(v.g!)">{{ f2(usageOf(v.g!).total) }}</span>
              </td>
              <td :class="fixCls('st')" :style="S.st"></td>
              <td class="fp-fill" aria-hidden="true"></td>
            </tr>
            <!-- 存疑行(V75 §E3/§F1 两级):shadow=疑似重复建档,整行浅红底,不计入楼栋分表Σ;
                 incomplete=档案不全但配不到重复对手,浅黄底,**照常计入Σ** —— 只是催人补档案 -->
            <tr
              v-else-if="v.t === 'row'"
              :class="{ 'mlg-sus': v.x!.m.suspect === 'shadow', 'mlg-inc': v.x!.m.suspect === 'incomplete' }"
            >
              <td :class="fixCls('loc')" :style="S.loc">
                <span class="mlg-loc">
                  <button
                    v-if="rowMode && v.x!.tou" type="button" class="mlg-exp" :aria-expanded="expanded.has(v.x!.m.id)"
                    :aria-label="expanded.has(v.x!.m.id) ? '收起尖峰平谷' : '展开尖峰平谷'"
                    @click="toggleRow(v.x!.m.id)"
                  ><component :is="ChevronDown" :size="14" /></button>
                  <i v-else-if="rowMode" class="mlg-gut" />
                  <span
                    class="mlg-txt" :class="{ dim: floorSide(v.x!) === '–' || floorSide(v.x!) === LOC_TODO }"
                    v-tip="locTip(v.x!)"
                  >{{ floorSide(v.x!) }}</span>
                </span>
              </td>
              <td :class="fixCls('use')" :style="S.use">
                <span class="mlg-txt" v-tip="useLabel(v.x!)">{{ useLabel(v.x!) }}</span>
              </td>
              <td v-if="show.room"><span class="mlg-txt" :class="{ dim: roomNo(v.x!) === '–' }">{{ roomNo(v.x!) }}</span></td>
              <!-- 租户(普通列):click 开抽屉;非租户表只出归属签;待核 coral 名+签(§7.1) -->
              <td v-if="show.ten">
                <span
                  class="mlg-tname"
                  :class="{ coral: v.x!.pending && !v.x!.retired && !v.x!.off, dim: v.x!.placeholder || v.x!.retired || !!v.x!.off }"
                  @click="emit('open', v.x!.m.id)"
                >
                  <span class="nm" v-tip="tenTip(v.x!)">{{ tenName(v.x!) }}</span>
                  <span v-if="v.x!.m.ownership !== 'tenant'" class="mlg-tag">{{ ownershipLabel(v.x!.m.ownership, v.x!.m.kind) }}</span>
                  <!-- 停用 / 不在册的行不飘待核红:本月不在服务中,待核无意义(2026-08-05 用户报障) -->
                  <span v-if="v.x!.pending && !v.x!.retired && !v.x!.off" class="mlg-st coral sm" v-tip="PENDING_TIP">待核</span>
                  <span v-if="v.x!.m.suspect === 'shadow'" class="mlg-st bad sm" v-tip="SHADOW_TIP">存疑·疑似重复</span>
                  <span v-else-if="v.x!.m.suspect === 'incomplete'" class="mlg-st amber sm" v-tip="INC_TIP">档案不全</span>
                  <!-- 本月册子没有(SPEC §10.4,就地标记 ①):挤了先缩它、最后只剩那颗点,名字不让位;悬停看是哪一段、从哪来 -->
                  <FPMark v-if="bookTip(v.x!)" tone="warn" class="mlg-book" v-tip="bookTip(v.x!)"><span>本月册子没有</span></FPMark>
                  <component :is="ChevronRight" :size="13" class="ch" />
                </span>
              </td>
              <td v-if="show.sub">
                <span class="mlg-txt mlg-sub"><span>{{ subShort(v.x!) }}</span><span v-if="isNewSub(v.x!)" class="mlg-tag">新表</span></span>
              </td>
              <td v-if="show.code"><span class="mlg-txt mono" :class="{ dim: !v.x!.m.code }">{{ v.x!.m.code ?? '–' }}</span></td>
              <td v-if="show.fac"><span class="mlg-nv">{{ fmtFac(v.x!.factor) }}</span></td>
              <!-- 上月行至:只读基准;没有底数(新表首月 / 读数没带上月行至)时编辑态开放录入底数(SPEC §3.4)。
                   data-pi 不进 data-si 序:其余行的键盘流一格不变 -->
              <td class="vl" :class="{ 'mlg-ic': editMode && baseOpen(v.x!) }">
                <input
                  v-if="editMode && baseOpen(v.x!)" class="mlg-ni" type="number" step="any"
                  :value="inputVal(v.x!, 'prevTotal')" placeholder="底数" :data-di="v.di" data-pi="0"
                  @click.stop @input="onInput(v.x!, 'prevTotal', $event)" @keydown.enter.prevent="onPrevEnter($event)"
                />
                <span v-else class="mlg-nv" :class="{ empty: v.x!.prevTotal == null }">{{ f2(v.x!.prevTotal) }}</span>
              </td>
              <!-- 本月行至:编辑态输入格;倒走红框(画布 04-B 99.8);data-di/si=显示列表索引/格序,键盘流跨窗寻址 -->
              <td class="vl" :class="{ 'mlg-ic': editMode }">
                <input
                  v-if="editMode" class="mlg-ni" :class="{ bad: drv.get(v.x!.m.id)!.st?.neg }" type="number" step="any"
                  :value="inputVal(v.x!, 'currTotal')" placeholder="–" :data-di="v.di" data-si="0"
                  @click.stop @input="onInput(v.x!, 'currTotal', $event)" @keydown.enter.prevent="onEnter($event)"
                />
                <span v-else class="mlg-nv" :class="{ empty: cur(v.x!, 'currTotal') == null }">{{ f2(cur(v.x!, 'currTotal')) }}</span>
              </td>
              <!-- 按比例出列打开时:本月 尖 / 峰 / 平 / 谷(04-C 二期卡) -->
              <td v-for="(s, i) in touCols" :key="s.c" :class="{ 'mlg-ic': editMode }">
                <input
                  v-if="editMode" class="mlg-ni" type="number" step="any"
                  :value="inputVal(v.x!, s.c)" placeholder="–" :data-di="v.di" :data-si="i + 1"
                  @click.stop @input="onInput(v.x!, s.c, $event)" @keydown.enter.prevent="onEnter($event)"
                />
                <span v-else class="mlg-nv" :class="{ empty: cur(v.x!, s.c) == null }">{{ f2(cur(v.x!, s.c)) }}</span>
              </td>
              <!-- 用量(钱那一列):时段不符红显 + 悬停说明(§7.4) -->
              <td class="mlg-money" :class="[fixCls('usage'), { vl: !S.usage }]" :style="S.usage">
                <span
                  class="mlg-sumc" :class="{ bad: drv.get(v.x!.m.id)!.issues.some(s => s.startsWith('时段不符')) }"
                  v-tip="drv.get(v.x!.m.id)!.issues.join(' · ') || undefined"
                >{{ f2(drv.get(v.x!.m.id)!.usage) }}</span>
              </td>
              <!-- 状态:只写不正常的,已抄留空 -->
              <td :class="fixCls('st')" :style="S.st">
                <span
                  v-if="drv.get(v.x!.m.id)!.st" class="mlg-st" :class="drv.get(v.x!.m.id)!.st!.cls"
                  v-tip="drv.get(v.x!.m.id)!.st!.neg ? undefined : statusDims(v.x!)"
                >{{ drv.get(v.x!.m.id)!.st!.text }}</span>
              </td>
              <td class="fp-fill" aria-hidden="true"></td>
            </tr>
            <!-- 分时段行(04-A A座总电 ⌄ 峰段/平段/谷段):编辑态出本月段输入格(04-B),回车 总→峰→平→谷 -->
            <tr v-else-if="v.t === 'seg'" class="mlg-segr">
              <td :class="fixCls('loc')" :style="S.loc"></td>
              <td :class="fixCls('use')" :style="S.use"><span class="mlg-seglbl">{{ v.seg!.label }}</span></td>
              <td v-if="nMid" :colspan="nMid"></td>
              <td class="vl" :class="{ 'mlg-ic': segIn(v.seg!) && baseOpen(v.x!) }">
                <input
                  v-if="segIn(v.seg!) && baseOpen(v.x!)" class="mlg-ni" type="number" step="any"
                  :value="inputVal(v.x!, segF(v.seg!).p)" placeholder="底数" :data-di="v.di" data-pi="0"
                  @click.stop @input="onInput(v.x!, segF(v.seg!).p, $event)" @keydown.enter.prevent="onPrevEnter($event)"
                />
                <span v-else class="mlg-nv" :class="{ empty: segVal(v.x!, v.seg!, 'p') == null }">{{ f2(segVal(v.x!, v.seg!, 'p')) }}</span>
              </td>
              <td class="vl" :class="{ 'mlg-ic': segIn(v.seg!) }">
                <input
                  v-if="segIn(v.seg!)" class="mlg-ni" type="number" step="any"
                  :value="inputVal(v.x!, segF(v.seg!).c)" placeholder="–" :data-di="v.di" data-si="0"
                  @click.stop @input="onInput(v.x!, segF(v.seg!).c, $event)" @keydown.enter.prevent="onEnter($event)"
                />
                <span v-else class="mlg-nv" :class="{ empty: segVal(v.x!, v.seg!, 'c') == null }">{{ f2(segVal(v.x!, v.seg!, 'c')) }}</span>
              </td>
              <td v-for="s in touCols" :key="s.c"></td>
              <td class="mlg-money" :class="[fixCls('usage'), { vl: !S.usage }]" :style="S.usage">
                <span class="mlg-sumc">{{ f2(segUse(v.x!, v.seg!)) }}</span>
              </td>
              <td :class="fixCls('st')" :style="S.st"></td>
              <td class="fp-fill" aria-hidden="true"></td>
            </tr>
            <!-- 组尾(METER-TIMELINE-SPEC §6,画布 04-A):停用的表收在这一行,点「显示」才进列表 -->
            <tr v-else class="mlg-retr">
              <td :class="fixCls('loc')" :style="S.loc"></td>
              <td :class="fixCls('use')" :style="S.use">
                <span class="mlg-ret">
                  {{ v.on ? `${v.n} 块已停用` : `另有 ${v.n} 块已停用` }}
                  <button type="button" class="mlg-link" @click="toggleRetired(v.g!.key)">{{ v.on ? '收起' : '显示' }}</button>
                </span>
              </td>
              <td v-if="nMid" :colspan="nMid"></td>
              <td class="vl"></td><td class="vl"></td>
              <td v-for="s in touCols" :key="s.c"></td>
              <td class="mlg-money" :class="[fixCls('usage'), { vl: !S.usage }]" :style="S.usage"></td>
              <td :class="fixCls('st')" :style="S.st"></td>
              <td class="fp-fill" aria-hidden="true"></td>
            </tr>
          </template>
          <tr v-if="win.bottomPad > 0" class="mlg-spacer" aria-hidden="true">
            <td :colspan="colCount" :style="{ height: win.bottomPad + 'px' }"></td>
          </tr>
          <tr v-if="rows.length === 0">
            <td class="mlg-noro" :colspan="colCount">{{ emptyText }}</td>
          </tr>
        </tbody>
        <!-- 合计(§7.1):用量 = Σ当前筛选行(草稿实时);不写已抄 / 未抄(04-A) -->
        <tfoot>
          <tr>
            <th v-if="!S.loc"></th>
            <th :colspan="S.loc ? 2 : 1" class="mlg-fix" :style="S.lbl"><span class="mlg-foot-lbl">合计</span></th>
            <th v-if="nMid" :colspan="nMid"></th>
            <th class="vl"></th><th class="vl"></th>
            <th v-for="s in touCols" :key="s.c"></th>
            <th class="mlg-money" :class="[fixCls('usage'), { vl: !S.usage }]" :style="S.usage"><span class="mlg-foot-v">{{ f2(foot.usageSum) }}</span></th>
            <th :class="fixCls('st')" :style="S.st"></th>
            <th class="fp-fill" aria-hidden="true"></th>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped>
/* ── 卡:工具条 + 表格区(画布 04-A);表格区 overflow:auto 是 useWideTable 量宽高的那一层 ── */
.mlg-wrap { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); overflow:hidden; }
.mlg-tools { flex:0 0 auto; }
.mlg-scroll { flex:1 1 auto; min-height:0; overflow:auto; }
/* table-layout:fixed(零布局位移):列宽只由 colgroup 决定,窗口化换行不触发列宽重算;
   min-width:100%:容器更宽时余量全落进最后那根不给宽的 <col>(最右空列 .fp-fill),各列宽一个像素不动。
   表格样式(03-C / 04):正文 14、表头 12、行高 40、字左数右、无字距 */
/* 钱那一列的两种底(03-A / 04-A / 05-A 同形,三屏同一组式子,moneyCol.spec 钉三份一致):
   数据格与合计格 = 浅蓝 60% 叠白 ≈ 画布 (241,247,254);组头那一格再叠 60% 卡片灰 ≈ (246,248,252) */
.mlg-table { --money-cell:color-mix(in srgb, var(--accent-blue) 60%, var(--surface-white)); --money-cell-grp:color-mix(in srgb, var(--money-cell) 40%, var(--surface-card)); border-collapse:separate; border-spacing:0; table-layout:fixed; min-width:100%; font-family:var(--font-sans); font-size:var(--fs-body); letter-spacing:0; color:var(--text-primary); }
/* 窗口化 spacer(§7 6.5):撑出未渲染区高度;不参与 hover/分隔线 */
.mlg-table tbody tr.mlg-spacer td { padding:0; border:none; background:var(--surface-white); }
.mlg-table tbody tr.mlg-spacer:hover td { background:var(--surface-white); }
.mlg-table th, .mlg-table td { border-bottom:1px solid var(--divider); box-sizing:border-box; padding:0; }
.mlg-table thead th { position:sticky; top:0; z-index:4; height:40px; padding:0 10px; background:var(--surface-card); color:var(--text-muted); font-size:var(--fs-label); font-weight:var(--fw-regular); text-align:left; white-space:nowrap; }
.mlg-table thead th.r { padding:0 8px; text-align:right; }
.mlg-table thead th.gut { padding-left:38px; }
.mlg-table thead th.mlg-fix { z-index:8; }
.mlg-table tbody td { height:40px; background:var(--surface-white); vertical-align:middle; }
.mlg-table tbody tr:hover td { background:var(--surface-card); }
.mlg-fix { position:sticky; z-index:3; background:var(--surface-white); }
.mlg-table tbody tr:hover .mlg-fix { background:var(--surface-card); }
/* 列组之间的整高竖线(规范 §2 第 28 条):倍率 | 上月行至 | 本月行至 | 用量;用途右缘是固定列阴影 */
.mlg-table .vl { border-left-width:1px; border-left-style:solid; border-left-color:var(--divider); }   /* 长写:jsdom 解析不了带 var() 的简写 */

/* 位置格:row 模式左边留一个 › 的位子,有分时的表放按钮 */
.mlg-loc { display:flex; align-items:center; min-width:0; }
.mlg-loc .mlg-txt { flex:1 1 auto; min-width:0; }
.mlg-exp, .mlg-gut { flex:0 0 24px; height:24px; margin-left:4px; }
.mlg-exp { display:grid; place-items:center; padding:0; border:none; border-radius:var(--radius-sm); background:none; color:var(--text-muted); cursor:pointer; }
.mlg-exp:hover { background:var(--bg-hover); color:var(--text-primary); }
.mlg-exp[aria-expanded="false"] svg { transform:rotate(-90deg); }

/* 租户格:点击开抽屉;hover 出 chevron;待核 coral/占位 dim */
.mlg-tname { display:inline-flex; align-items:center; gap:6px; padding:0 10px; color:var(--text-primary); white-space:nowrap; overflow:hidden; cursor:pointer; max-width:100%; box-sizing:border-box; }
.mlg-tname:hover .nm { color:var(--text-link); }
/* 名字吃剩余宽、签不许被压(min-width:0 是让 ellipsis 生效的前提) */
.mlg-tname .nm { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.mlg-tname .mlg-st, .mlg-tname .mlg-tag { flex:0 0 auto; }
/* 本月册子没有(SPEC §10.4):FPMark 橙点 + 字。格子挤了由它让:字先省略、最后只剩点(min-width = 点 6 + 间距 4 + 1),
   名字要等它缩到头才开始让。收缩比例按宽度加权分摊,999 时名字仍分到零点零几像素,故取 99999 */
.mlg-tname .mlg-book { flex:0 99999 auto; min-width:11px; cursor:help; }
.mlg-book > span { min-width:0; overflow:hidden; text-overflow:ellipsis; }
.mlg-tname.coral .nm { color:var(--coral-text); }
.mlg-tname.dim .nm { color:var(--text-disabled); }
.mlg-tname .ch { opacity:0; flex:0 0 auto; color:var(--text-disabled); transition:opacity var(--dur-fast); }
.mlg-table tbody tr:hover .mlg-tname .ch { opacity:1; }
/* 触屏(RESPONSIVE-LAYOUT-SPEC §6.1):hover 显形的行内箭头常显(半透明弱化) */
@media (hover: none) {
  .mlg-tname .ch { opacity:.55; }
}
/* 归属签 / 新表签(04-A):灰底小签,不分色 */
.mlg-tag { display:inline-block; font-size:var(--fs-micro); line-height:18px; padding:0 6px; border-radius:var(--radius-sm); color:var(--text-secondary); background:var(--bg-sunken); white-space:nowrap; }
.mlg-sub { display:flex; align-items:center; gap:6px; }

/* 文字左、数字右;读数两位小数、不省略(数字列宽按整列最长的值算) */
.mlg-nv { display:block; text-align:right; padding:0 8px; color:var(--text-primary); font-family:var(--font-mono); font-variant-numeric:tabular-nums; white-space:nowrap; }
.mlg-nv.empty { color:var(--text-disabled); }
.mlg-txt { display:block; text-align:left; padding:0 10px; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mlg-txt.dim { color:var(--text-disabled); }
.mlg-txt.mono { font-family:var(--font-mono); font-variant-numeric:tabular-nums; }

/* 钱那一列(用量,规范 §2 第 29 条):加粗 + 整列浅蓝底 + 表头下蓝线,字不用蓝 */
.mlg-sumc { display:block; text-align:right; padding:0 8px; font-weight:var(--fw-semibold); color:var(--text-primary); font-family:var(--font-mono); font-variant-numeric:tabular-nums; white-space:nowrap; }
.mlg-sumc.bad { color:var(--delta-down-text); cursor:help; }
.mlg-table thead th.mlg-money { border-bottom-width:2px; border-bottom-color:var(--hue-blue); color:var(--text-secondary); }
.mlg-table tbody tr > td.mlg-money, .mlg-table tbody tr:hover > td.mlg-money { background:var(--money-cell); }

/* 格内输入(编辑态):白底细框,聚焦蓝;倒走红框(画布 04-B) */
.mlg-table td.mlg-ic { padding:0 4px; }
.mlg-ni { width:100%; height:28px; box-sizing:border-box; padding:0 6px; border:1px solid var(--border-control); border-radius:var(--radius-sm); background:var(--surface-white); outline:none; text-align:right; font-family:var(--font-mono); font-size:var(--fs-body); color:var(--text-primary); }
.mlg-ni:focus { background:var(--accent-blue); border-color:var(--hue-blue); }
.mlg-ni.bad { border-color:var(--hue-red); }
.mlg-ni::-webkit-outer-spin-button, .mlg-ni::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }

/* 状态签(只写不正常的):未抄 amber / 倒走·时段不符 红 / 待核·待绑定 coral / 占位·停用 灰 */
.mlg-st { display:inline-block; margin-left:8px; font-size:var(--fs-micro); font-family:var(--font-sans); font-weight:var(--fw-regular); border-radius:var(--radius-full); padding:2px 9px; cursor:help; white-space:nowrap; }
.mlg-tname .mlg-st { margin-left:0; }
.mlg-st.sm { padding:1px 7px; }
.mlg-st.ok { color:var(--ok-text); background:var(--ok-soft); }
.mlg-st.amber { color:var(--caution-text); background:rgb(255, 244, 214); }
.mlg-st.bad { color:var(--hue-red); background:var(--danger-soft); }
.mlg-st.coral { color:var(--coral-text); background:rgb(255, 235, 228); }
.mlg-st.dim { color:var(--text-muted); background:var(--bg-sunken); }

/* 组头兼小计(画布 04-A):浅灰底,点它收起 */
.mlg-table tbody tr.mlg-ghead td { background:var(--surface-card); }
.mlg-table tbody tr.mlg-ghead > td.mlg-money { background:var(--money-cell-grp); }
/* 组小计:次要色、常规字重 —— 比数据行的用量轻一档(04-A「144,183.58」) */
.mlg-table tbody tr.mlg-ghead .mlg-sumc { font-weight:var(--fw-regular); color:var(--text-secondary); }
.mlg-gbtn { display:inline-flex; align-items:center; gap:6px; height:40px; padding:0 10px; border:none; background:none; cursor:pointer; font:inherit; font-weight:var(--fw-semibold); color:var(--text-primary); white-space:nowrap; }
.mlg-gbtn .n { font-size:var(--fs-label); font-weight:var(--fw-regular); color:var(--text-muted); }
.mlg-gbtn .ch { flex:none; color:var(--text-muted); transition:transform var(--dur-fast); }
.mlg-gbtn[aria-expanded="false"] .ch { transform:rotate(-90deg); }

/* 分时段行(32 高):位置/用途白底,其余浅灰;字 12 灰,用量不加粗不上蓝 */
.mlg-table tbody tr.mlg-segr td { height:32px; }
.mlg-table tbody tr.mlg-segr > td:nth-child(n+3) { background:var(--surface-card); }
.mlg-seglbl { display:block; padding:0 10px 0 34px; font-size:var(--fs-label); color:var(--text-muted); white-space:nowrap; }
.mlg-seglbl::before { content:'–'; margin-right:8px; color:var(--text-disabled); }
.mlg-segr .mlg-nv, .mlg-segr .mlg-sumc { font-size:var(--fs-label); font-weight:var(--fw-regular); color:var(--text-secondary); }
.mlg-segr .mlg-ni { height:24px; font-size:var(--fs-label); }

/* 组尾「另有 N 块已停用 · 显示」:字可以溢进右边的空格子 */
.mlg-ret { display:flex; align-items:center; gap:8px; padding:0 10px; color:var(--text-muted); white-space:nowrap; }
.mlg-link { padding:0; border:none; background:none; font:inherit; color:var(--text-link); cursor:pointer; }
.mlg-link:hover { text-decoration:underline; }

/* 存疑行(V75 §E3/§F1):shadow 浅红底(已被踢出Σ)/ incomplete 浅黄底(仍在Σ内,只是档案没填全);
   sticky 固定列同步上色(否则横滚露白) */
/* 可疑行 = 浅红 60% 叠在卡片上(浅色 ≈ 原 rgb(255,244,243),ΔE00 0.4);悬停整格浅红 */
.mlg-table tbody tr.mlg-sus td, .mlg-table tbody tr.mlg-sus td.mlg-fix { background:color-mix(in srgb, var(--danger-soft) 60%, var(--surface-white)); }
.mlg-table tbody tr.mlg-sus:hover td, .mlg-table tbody tr.mlg-sus:hover td.mlg-fix { background:var(--danger-soft); }
.mlg-table tbody tr.mlg-inc td, .mlg-table tbody tr.mlg-inc td.mlg-fix { background:var(--caution-soft); }
.mlg-table tbody tr.mlg-inc:hover td, .mlg-table tbody tr.mlg-inc:hover td.mlg-fix { background:rgb(255, 246, 222); }
:root[data-theme="dark"] .mlg-st.amber { background:var(--caution-soft); }
:root[data-theme="dark"] .mlg-st.coral { background:var(--danger-bg); }
:root[data-theme="dark"] .mlg-table tbody tr.mlg-inc:hover td, :root[data-theme="dark"] .mlg-table tbody tr.mlg-inc:hover td.mlg-fix { background:color-mix(in srgb, var(--caution-soft), var(--ink-900) 8%); }

/* 空态行(表头保留,电子表格观感) */
.mlg-noro { text-align:center; padding:40px 16px; color:var(--text-disabled); font-size:var(--fs-label); }

/* 合计(sticky bottom,浅灰底);不够 8 行时(hStage ≥ 2)不贴底、跟在最后一行后面 */
.mlg-table tfoot th { position:sticky; bottom:0; z-index:5; height:50px; font-weight:var(--fw-semibold); text-align:left; background:var(--surface-card); border-top:2px solid var(--border-strong); color:var(--text-primary); }
.mlg-table.hs-foot tfoot th { bottom:auto; }
.mlg-table tfoot th.mlg-fix { z-index:7; }
.mlg-table tfoot th.mlg-money { background:var(--money-cell); }   /* 合计那一格同数据格 */
.mlg-foot-lbl { display:block; padding:0 10px; }
/* 合计数 16(04-A「2,892,034.93」),合计行 50 高,与 GRID_H.footH 同步 */
.mlg-foot-v { display:block; text-align:right; padding:0 8px; font-family:var(--font-mono); font-size:16px; font-variant-numeric:tabular-nums; color:var(--text-primary); }
</style>
