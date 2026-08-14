<script setup lang="ts">
// 抄表电子表格(METER-V5-SPEC §7 v5.1):FPLedgerTable 范式 1:1 手法——双级表头(rowspan+colspan)/
// sticky offset 列宽累加/tfoot sticky bottom/34px 行高/mono 右对齐空值'–'/透明格内 input。
// 行窗口化虚拟滚动(§7 6.5):组 flatten→显示列表,只渲染可视±12 行,前后 spacer tr 撑高,
// passive scroll+rAF 节流;窗口纯函数 buildWindow/offsetOf 在 useMeterWorkbench(带单测)。
// 列模型(METER-LOC-MEMBER-SPEC §A.1,对齐原册「一期园区电」形状):
// fixedLeft=楼层·方位/用途 | 中部=房号/租户/表号/编码/倍率/上月行至组/本月行至组 | fixedRight=用量/状态;
// 稳定标识(楼层→方位→房号)锁在左侧固定列,易变的租户名降为普通列(仍可点开抽屉/带待核徽标)。
// 电表两组各 5 列(总/尖/峰/平/谷)常驻,水表各 1 列(总)。无分页:wrap overflow:auto 充满卡高。
// 表体按楼栋首现序分组,组末插「{楼栋名} · 总用电量」汇总行(§7.6,tenant+share 口径,随 draft 实时)。
// 草稿式编辑:编辑态「本月行至」全格透明 input(上月行至只读基准),draft 归属父层 MeterView,
// 本组件只读取草稿+emit cell-edit;用量列/页脚按草稿实时重算;校验红显不拦保存(§7.4)。
// 键盘流(§7.3):Tab 走原生 DOM 序(tbody 内仅本月行至有 input=行内横向),Enter 显式跳下一格,行尾进下一行首格。
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { iconFor } from '@/components/ds/icon'
import {
  STATUS_META, statusDims, effCurr, rowUsage, draftRowIssues, gridFooter, groupByBuilding, groupUsage,
  flattenGroups, buildWindow, offsetOf,
  type WorkbenchRow, type MeterDraft, type CurrField, type PrevSegs, type BuildingGroup,
  type RowWindow,
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
}>()
const emit = defineEmits<{
  open: [meterId: number]
  'cell-edit': [p: { meterId: number; field: CurrField; value: string }]
}>()

const ChevronRight = iconFor('chevron-right')
const FACTOR_TITLE = '有读数=当月录入时倍率快照;无读数=档案倍率。历史读数按录入时快照计用量,改档案倍率只影响之后新录'

// ── 列模型:电表组内 总/尖/峰/平/谷 5 列,水表仅 总 1 列(§7.1) ──
interface SegDef { lab: string; c: CurrField; p: keyof PrevSegs | null }
const ALL_SEGS: SegDef[] = [
  { lab: '总', c: 'currTotal', p: null },
  { lab: '尖', c: 'currSharp', p: 'sharp' },
  { lab: '峰', c: 'currPeak', p: 'peak' },
  { lab: '平', c: 'currFlat', p: 'flat' },
  { lab: '谷', c: 'currValley', p: 'valley' },
]
const segDefs = computed(() => (props.kind === 'elec' ? ALL_SEGS : ALL_SEGS.slice(0, 1)))
// 非分时列 9 列:楼层·方位/用途/房号/租户/表号/编码/倍率 + 用量/状态
const colCount = computed(() => 10 + segDefs.value.length * 2)

// sticky offset 列宽累加(FPLedgerTable 手法):左=楼层·方位(left:0)←用途(left:FLOOR_W) 正向累加;
// 右=状态←用量 反向累加。改列宽必须同步改 offset,否则固定列错位。
// 分隔线用 border 而非 box-shadow(§7 6.5:去阴影绘制成本;th/td 已 border-box 不占额外宽)
// AREA_W 76→100、SUB_W 70→84(2026-08-15 实测 2024-02 抄表屏滚全表 115 个格,3 个截断:
// 区域「A座自装总电表」需 100、「三期项目工地」需 92;表号「电表①新表」需 80)。
// 与字体无关 —— 这三串都是汉字为主,汉字从来走系统回退,Roboto Mono 子集里根本没有 CJK;
// 是原先按短名(「A座」「电表①」)量的宽度没覆盖到长尾。sticky offset 由这两个常量推导
// (fixFloor/fixUse/tableW 都引用它们),改常量即自动跟上,不必手工同步。
const AREA_W = 100
// TEN_W 130→180(2026-08-14 用户报障「电表的租户列都看不见了」):该格并排放名字 + 待核/存疑徽标
// + 归属徽标(非租户表)+ 悬停箭头。130px 里徽标 nowrap 先占满(「园区公摊」≈54px + 箭头/间距/padding
// ≈45px),名字只剩 30px ⇒ 一个字加省略号。同刀去掉了非租户行的名字(与「用途」列重复,见 tenName),
// 所以不必按「名字+归属徽标」并存来配宽 —— 两类行各自的需求:
//   非租户行 = 只有徽标:最长「计度寄存器」5 全角 ≈64 + 箭头间距 padding 38 = 102px
//   租户行   = 档案名 + 可能的待核徽标:实测 400 块租户表里 3/4 字占 353 块(296+57),
//              6 字以下共 384 块;长尾 18 字 12 块(曼克维全称)、14 字 6 块 —— 那 20 块截断后
//              悬停有全名。按 8 全角 100px + 待核 40 + 箭头间距 padding 38 = 178,取 180。
const FLOOR_W = 96, USE_W = 160, ROOM_W = 72, TEN_W = 180, SUB_W = 84, CODE_W = 118, FAC_W = 56
const SEG_W = 96, USAGE_W = 104, ST_W = 88
const w = (px: number) => ({ width: px + 'px', minWidth: px + 'px', maxWidth: px + 'px' })
// 表总宽=全列宽之和(colgroup+table-layout:fixed 用):窗口化每帧换行,auto 布局会按可见内容
// 逐帧重算列宽 → 快速滚动列抖动(2026-08-04 用户报障);fixed+colgroup 后列宽与内容彻底解耦
const tableW = computed(() =>
  AREA_W + FLOOR_W + USE_W + ROOM_W + TEN_W + SUB_W + CODE_W + FAC_W
  + segDefs.value.length * 2 * SEG_W + USAGE_W + ST_W)
// 区域(原册 B 列)在最左:区块带头虽然也是楼栋名,但原册每行都写,逐行显才能跟原册一行一行对
const fixArea = { ...w(AREA_W), left: '0px' }
const fixFloor = { ...w(FLOOR_W), left: AREA_W + 'px' }
// 分隔线落在最外侧固定列(用途)右缘
const fixUse = { ...w(USE_W), left: AREA_W + FLOOR_W + 'px', borderRight: '1px solid var(--border-subtle)' }
const fixUsage = { ...w(USAGE_W), right: ST_W + 'px', borderLeft: '1px solid var(--border-subtle)' }
const fixSt = { ...w(ST_W), right: '0px' }
// 汇总行标签格 colspan 跨 区域~倍率 8 列:sticky left 但不锁宽(列宽由表头定)
const fixGrpLbl = { left: '0px', borderRight: '1px solid var(--border-subtle)' }

// ── 楼栋分组(§7.6):首现序稳定分组 ──
// 分组/排序只由 rows 决定,**不传 draft**:否则编辑态每敲一个数字都要重分组+逐组重排序
// (draft 是 reactive Map,一次 set 就打翻整条 groups→displayList→visItems 计算链)。
const groups = computed(() => groupByBuilding(props.rows, props.buildingNameById))
// 组末汇总(tenant+share,随 draft 实时)叠在分组结果之上:敲键只重算这一层
const grpUsage = computed(() =>
  new Map(groups.value.map(g => [g.key, groupUsage(g.rows, props.draft)] as const)))
const usageOf = (g: BuildingGroup) => grpUsage.value.get(g.key)!

// ── 行窗口化虚拟滚动(§7 6.5):组 flatten 成显示列表,只渲染可视±12 行,前后 spacer 撑高 ──
const wrapEl = ref<HTMLElement | null>(null)
const displayList = computed(() => flattenGroups(groups.value))
const win = ref<RowWindow>({ start: 0, end: 0, topPad: 0, bottomPad: 0 })
// x/g 二择一展平(x=数据行/g=汇总行),di=显示列表全局索引(键盘流寻址用)
const visItems = computed(() => {
  const { start, end } = win.value
  return displayList.value.slice(start, end).map((it, i) => ({
    di: start + i,
    x: it.type === 'row' ? it.x : null,
    g: it.type === 'bsum' ? it.g : null,
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
// 回顶只认视图身份,不认数组引用(WRITE-KEEP-CONTEXT-SPEC 铁律一)。
// 改前两件事写在一个 watch 里:rows 是新数组就回顶。但 buildRows/filterRows 每次都产新数组,
// 「换了另一张表」与「同一张表重载」在 Object.is 眼里没区别 —— 于是抽屉 7 个 emit('reload')、
// 草稿批量保存、KeepAlive 回页全部把用户打回第 0 行,在 200-400 行的视图里重新找刚改的那块表
// (用户报障:「点完直接刷新页面,然后需要从头开始滚动找到对应电表」;停用/退场账期那两格最典型
// —— 停用行照旧产行、位置分毫未变,却整表回顶)。
// 换筛选/账期/电水/分区仍照旧回顶:那些维度都在 viewKey 里,变了就是另一张表(铁律一即此判据)。
// ⚠ 不变式(反方向,与下面那条注释配对):**凡进 viewKey 的维度,必须也是 gridRows 的依赖**。
// 现在 8 个维度条条成立(ym 经 buildRows/hiddenRows,其余 7 项经 filterRows),所以 viewKey 一变
// 必产新 rows、rows watch 必在同一 flush 跟着跑。但哪天塞进一个「不改行集」的维度(排序开关、
// 只读展示模式),回顶后就没有 rows watch 兜底重建窗口 ⇒ 永久白屏顶。故这里自己也重建一次:
// 此刻 props.rows 已是新值(props 先于 watch 回调更新),重复调一次 syncWindow 无副作用。
watch(() => props.viewKey, () => {
  if (wrapEl.value) wrapEl.value.scrollTop = 0
  syncWindow(true)
})
// 行集变化只重建窗口:重拉后行数可能变(新增/删除),spacer 高度与 [start,end) 要跟上,但不动 scrollTop。
// draft 键入不动 rows 引用,不受影响。
// nextTick 二次同步:watch 默认 pre-flush,此刻读到的是 **DOM 更新前**的 scrollTop。行集一次变短
// ≥12 行(超出缓冲)且用户正停在底部时,浏览器会把 scrollTop 同步夹紧,而窗口是按夹紧前的值算的
// ⇒ [start,end) 整体落在视口上方,顶部留一条空白要等下次滚动才自愈。DOM 落位后再算一次即消。
watch(() => props.rows, () => {
  syncWindow(true)
  nextTick(() => syncWindow(true))
})
const grpLabel = (g: BuildingGroup) => `${g.label} · 总用${props.kind === 'water' ? '水' : '电'}量`
const grpSegTitle = (g: BuildingGroup) => {
  if (props.kind !== 'elec') return undefined
  const u = usageOf(g)
  return `尖 ${fmt(u.sharp)} 峰 ${fmt(u.peak)} 平 ${fmt(u.flat)} 谷 ${fmt(u.valley)}`
}

// ── 行派生(草稿实时):用量+校验红显;页脚合计 ──
const drv = computed(() => {
  const m = new Map<number, { usage: number | null; issues: string[] }>()
  for (const x of props.rows) {
    const d = props.draft.get(x.m.id)
    m.set(x.m.id, { usage: rowUsage(x, d), issues: draftRowIssues(x, d) })
  }
  return m
})
const foot = computed(() => gridFooter(props.rows, props.draft))

// ── 展示辅助 ──
const fmt = (v: number | null | undefined) =>
  v == null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
const prevOf = (x: WorkbenchRow, s: SegDef) => (s.p ? x.prevSegs[s.p] : x.prevTotal)
const currOf = (x: WorkbenchRow, s: SegDef) => effCurr(x, props.draft.get(x.m.id), s.c)
// input 值=草稿原文>服务器读数,防重渲染吞输入
function inputVal(x: WorkbenchRow, s: SegDef): string {
  const d = props.draft.get(x.m.id)?.[s.c]
  if (d != null) return d
  const v = x.r?.[s.c]
  return v == null ? '' : String(v)
}
// V74 结构化位置三列后端 MeterDTO 已出,前端 MeterDTO 待 A3 刀补进;先经 MeterLoc 视图读取
// (MeterDTO 补齐后本处无需再改)。楼栋不成列——它是区块带头/汇总行的分组维度。
const locOf = (x: WorkbenchRow) => x.m as MeterLoc
// 「楼层·方位」合成一列(原册那一格本身就写成「四楼西侧」),与公共电核算屏 poolFloorSide 同款话术
// V77 §G3:缺段要说出来。结构化楼层方位 > spot 原文(解析不出楼层的照原文显示) >
// 有区域却什么都没录 → 占位「(位置未录)」(与后端 AllocService.LOC_TODO 同话术);
// 区域也空的园区级/跨栋表不适用,仍显 '–'。清单见 scripts/meter-loc-todo.tsv。
// P2-SHARE-LAYER-SPEC §8:非租户表(share/park/ops/infra)位置本可空,豁免催录,显 '–'。
const LOC_TODO = '(位置未录)'
const LOC_EXEMPT = new Set(['share', 'park', 'ops', 'infra'])
function floorSide(x: WorkbenchRow): string {
  const l = locOf(x)
  return ((l.floorLabel ?? '').trim() + (l.side ?? '').trim())
    || x.m.spot?.trim()
    || (x.m.area?.trim() && !LOC_EXEMPT.has(x.m.ownership) ? LOC_TODO : '–')
}
// dorm 回退:宿舍单元「1-309」(栋-房号)在导入时已随位置原文落 spot(如「三楼 1-309」),正则直读;
// 无单元的宿舍表(总表/商铺/充电桩/分时子表)不命中,显 '–' 属预期。
// 式子提到模块级:逐行渲染调用,不必每格新造一个 RegExp(无 g 标志,无 lastIndex 状态)
const RE_DORM_UNIT = /\d+-\d{3,4}/
const roomNo = (x: WorkbenchRow) =>
  locOf(x).roomNo?.trim()
  || (props.zone === 'dorm' ? x.m.spot?.match(RE_DORM_UNIT)?.[0] : undefined)
  || '–'
// 「区域」=账册 B 列原文(A座/一车间/招商中心),已是不带期数的写法,直接取 meter.area 不做加工。
// 区块带头虽然也是楼栋名,但原册每行都写满 —— 逐行显才对得上原册一行一行。
const areaLabel = (x: WorkbenchRow) => x.m.area?.trim() ?? ''
// 「用途」=账册「企业名称」列原文;公摊/基础设施表存的是用途描述,缺则回退标识名
const useLabel = (x: WorkbenchRow) => x.m.tenantName ?? x.m.name
// 非租户表(公摊/总表/园区自担/园区经营/寄存器)本来就没有租户,这一格只出归属徽标。
// 改前它回落 `tenantName ?? name` —— 与「用途」列**逐字相同**(useLabel 同一个表达式),
// 同一串话在一行里写两遍,还把格子挤到只剩一个字(2026-08-14 用户报障)。
// 租户表照旧显档案名:那是 tenant.company_name,与「用途」的账册原文不是一回事
// (原文「旭化成（男厕所）」↔ 档案「旭化成」),待核/绑定判定也挂在它上面,不能省。
function tenName(x: WorkbenchRow): string {
  return x.m.ownership === 'tenant' ? (x.tenantLabel ?? '—') : ''
}
// 悬浮同理:非租户表不重复用途原文(那一列自己有 title)
function tenTitle(x: WorkbenchRow): string | undefined {
  return x.m.ownership === 'tenant' ? (x.tenantLabel ?? x.m.tenantName ?? undefined) : undefined
}

function onInput(x: WorkbenchRow, s: SegDef, e: Event) {
  emit('cell-edit', { meterId: x.m.id, field: s.c, value: (e.target as HTMLInputElement).value })
}

// ── 键盘流(§7.3+6.5):Enter 跳下一编辑格(行内横向,行尾进下一数据行首格,汇总行跳过);
//    目标行不在窗口=pending-focus:先 scrollTop 定位重建窗口,渲染后 nextTick 聚焦 ──
function focusCell(di: number, si: number): boolean {
  const el = wrapEl.value?.querySelector<HTMLInputElement>(
    `input.mlg-ni[data-di="${di}"][data-si="${si}"]`)
  if (!el) return false
  el.focus()
  el.select()
  return true
}
function onEnter(e: KeyboardEvent) {
  const t = e.target as HTMLInputElement
  let di = Number(t.dataset.di)
  let si = Number(t.dataset.si) + 1
  if (!Number.isFinite(di)) return
  if (si >= segDefs.value.length) {                      // 行尾→下一数据行首格(bsum 无 input 跳过)
    si = 0
    const list = displayList.value
    do { di++ } while (di < list.length && list[di].type !== 'row')
    if (di >= list.length) return
  }
  if (focusCell(di, si)) return
  const wrap = wrapEl.value
  if (!wrap) return
  wrap.scrollTop = offsetOf(displayList.value, di)       // 目标行落 sticky 表头下沿
  syncWindow(true)
  nextTick(() => focusCell(di, si))
}
</script>

<template>
  <div ref="wrapEl" class="mlg-wrap" @scroll.passive="onScroll">
    <table class="mlg-table" :style="{ width: tableW + 'px' }">
      <!-- 交互稳定性(LIST-PAGE-SPEC §零布局位移):colgroup 钉死每列宽,配合 table-layout:fixed,
           滚动换行时浏览器不再按可见单元格内容重算列宽 -->
      <colgroup>
        <col :style="w(AREA_W)" /><col :style="w(FLOOR_W)" /><col :style="w(USE_W)" />
        <col :style="w(ROOM_W)" /><col :style="w(TEN_W)" /><col :style="w(SUB_W)" />
        <col :style="w(CODE_W)" /><col :style="w(FAC_W)" />
        <col v-for="s in segDefs" :key="'gp' + s.c" :style="w(SEG_W)" />
        <col v-for="s in segDefs" :key="'gc' + s.c" :style="w(SEG_W)" />
        <col :style="w(USAGE_W)" /><col :style="w(ST_W)" />
      </colgroup>
      <thead>
        <tr>
          <th rowspan="2" class="mlg-grp-th mlg-fix-th mlg-fix" :style="fixArea"
              title="原册 B 列:楼栋/车间(不带期数)">区域</th>
          <th rowspan="2" class="mlg-grp-th mlg-fix-th mlg-fix" :style="fixFloor">楼层·方位</th>
          <th rowspan="2" class="mlg-grp-th mlg-fix-th mlg-fix" :style="fixUse">用途</th>
          <th rowspan="2" class="mlg-grp-th" :style="w(ROOM_W)">{{ zone === 'dorm' ? '宿舍单元' : '房号' }}</th>
          <th rowspan="2" class="mlg-grp-th" :style="w(TEN_W)">租户</th>
          <th rowspan="2" class="mlg-grp-th" :style="w(SUB_W)">表号</th>
          <th rowspan="2" class="mlg-grp-th" :style="w(CODE_W)">编码</th>
          <th rowspan="2" class="mlg-grp-th" :style="w(FAC_W)" :title="FACTOR_TITLE">倍率</th>
          <th :colspan="segDefs.length" class="mlg-grp-th">上月行至</th>
          <th :colspan="segDefs.length" class="mlg-grp-th">本月行至</th>
          <th rowspan="2" class="mlg-grp-th mlg-fix-th mlg-fix" :style="fixUsage">用量</th>
          <th rowspan="2" class="mlg-grp-th mlg-fix-th mlg-fix" :style="fixSt">状态</th>
        </tr>
        <tr>
          <th v-for="s in segDefs" :key="'p' + s.c" class="mlg-leaf-th" :style="w(SEG_W)">{{ s.lab }}</th>
          <th v-for="s in segDefs" :key="'c' + s.c" class="mlg-leaf-th" :style="w(SEG_W)">{{ s.lab }}</th>
        </tr>
      </thead>
      <tbody>
        <!-- 窗口化(§7 6.5):顶/底 spacer 撑出全表滚动高度,中间只渲染 [start,end) -->
        <tr v-if="win.topPad > 0" class="mlg-spacer" aria-hidden="true">
          <td :colspan="colCount" :style="{ height: win.topPad + 'px' }"></td>
        </tr>
        <template v-for="v in visItems" :key="v.x ? v.x.m.id : 'bs-' + v.g!.key">
        <!-- 存疑行(V75 §E3/§F1 两级):shadow=疑似重复建档,整行浅红底,不计入楼栋分表Σ;
             incomplete=档案不全但配不到重复对手,浅黄底,**照常计入Σ** —— 只是催人补档案 -->
        <tr v-if="v.x" :class="{ 'mlg-sus': v.x.m.suspect === 'shadow', 'mlg-inc': v.x.m.suspect === 'incomplete' }">
          <!-- 区域 / 楼层·方位 / 用途(sticky 左):稳定标识,横滚常驻 -->
          <td class="mlg-fix" :style="fixArea">
            <span class="mlg-txt" :class="{ dim: !areaLabel(v.x) }">{{ areaLabel(v.x) || '–' }}</span>
          </td>
          <td class="mlg-fix" :style="fixFloor">
            <span
              class="mlg-txt" :class="{ dim: floorSide(v.x) === '–' || floorSide(v.x) === LOC_TODO }"
              :title="floorSide(v.x) === LOC_TODO ? '这块表有区域但没录楼层方位,点开租户列的抽屉补「楼层/方位/房号」三格' : (v.x.m.spot ?? undefined)"
            >{{ floorSide(v.x) }}</span>
          </td>
          <td class="mlg-fix" :style="fixUse">
            <span class="mlg-txt" :title="useLabel(v.x)">{{ useLabel(v.x) }}</span>
          </td>
          <td><span class="mlg-txt" :class="{ dim: roomNo(v.x) === '–' }">{{ roomNo(v.x) }}</span></td>
          <!-- 租户(普通列):click 开抽屉;待核 coral 名+徽标(§7.1) -->
          <td>
            <span
              class="mlg-tname" :class="{ coral: v.x.pending && !v.x.retired, dim: v.x.placeholder || v.x.retired }"
              :title="tenTitle(v.x)" @click="emit('open', v.x.m.id)"
            >
              <span class="nm">{{ tenName(v.x) }}</span>
              <!-- 停用行不再飘待核红:本月不在服务中,待核无意义(2026-08-05 用户报障) -->
              <span v-if="v.x.pending && !v.x.retired" class="mlg-st coral sm" title="企业名称原文未匹配到租户档案,点击在抽屉「合同绑定」页签挂租户">待核</span>
              <span
                v-if="v.x.m.suspect === 'shadow'" class="mlg-st bad sm"
                title="疑似重复建档:本表区域/位置/企业名称/编码全空,且与同栋同类的另一块档案完整的表同月上下期示数与倍率完全相等,很可能是同一块物理表的第二份档案。该表用量暂不计入楼栋分表Σ;认对后请补齐档案(在抽屉保存一次即解除存疑)"
              >存疑·疑似重复</span>
              <span
                v-else-if="v.x.m.suspect === 'incomplete'" class="mlg-st amber sm"
                title="档案不全:区域/位置/企业名称/编码全空,但配不到重复对手,按真表处理 —— 用量照常计入楼栋分表Σ。请补齐档案(在抽屉保存一次即解除提示)"
              >档案不全</span>
              <span v-if="v.x.m.ownership !== 'tenant'" class="mt-own" :class="'own-' + v.x.m.ownership">{{ ownershipLabel(v.x.m.ownership, v.x.m.kind) }}</span>
              <component :is="ChevronRight" :size="13" class="ch" />
            </span>
          </td>
          <td><span class="mlg-txt" :title="v.x.m.subName ?? undefined">{{ v.x.m.subName ?? '–' }}</span></td>
          <td><span class="mlg-txt mono" :class="{ dim: !v.x.m.code }" :title="v.x.m.code ?? undefined">{{ v.x.m.code ?? '–' }}</span></td>
          <td><span class="mlg-nv" :title="FACTOR_TITLE">{{ v.x.factor }}</span></td>
          <!-- 上月行至(只读基准) -->
          <td v-for="s in segDefs" :key="'p' + s.c">
            <span class="mlg-nv" :class="{ empty: prevOf(v.x, s) == null }">{{ fmt(prevOf(v.x, s)) }}</span>
          </td>
          <!-- 本月行至:编辑态全格透明 input 点格直改(§7.2);@click.stop 不触发租户格外的行为;
               data-di/si=显示列表索引/段序,键盘流跨窗寻址(§7 6.5) -->
          <td v-for="(s, si) in segDefs" :key="'c' + s.c">
            <input
              v-if="editMode" class="mlg-ni" type="number" step="any"
              :value="inputVal(v.x, s)" placeholder="–"
              :data-di="v.di" :data-si="si"
              @click.stop
              @input="onInput(v.x, s, $event)"
              @keydown.enter.prevent="onEnter($event)"
            />
            <span v-else class="mlg-nv" :class="{ empty: currOf(v.x, s) == null }">{{ fmt(currOf(v.x, s)) }}</span>
          </td>
          <!-- 用量(sticky 右,派生蓝):校验红显+title(倒走/时段不符,§7.4) -->
          <td class="mlg-fix" :style="fixUsage">
            <span
              class="mlg-sumc" :class="{ bad: drv.get(v.x.m.id)!.issues.length > 0 }"
              :title="drv.get(v.x.m.id)!.issues.join(' · ') || undefined"
            >{{ fmt(drv.get(v.x.m.id)!.usage) }}</span>
          </td>
          <td class="mlg-fix ct" :style="fixSt">
            <span class="mlg-st" :class="STATUS_META[v.x.status].cls" :title="statusDims(v.x)">{{ STATUS_META[v.x.status].label }}</span>
          </td>
        </tr>
        <!-- 楼栋分组汇总行(§7.6):兼作分隔;无 input,键盘流自然跳过;行至/状态列空 -->
        <tr v-else class="mlg-bsum">
          <td colspan="8" class="mlg-fix" :style="fixGrpLbl">
            <span class="mlg-bsum-lbl" :title="grpLabel(v.g!)">{{ grpLabel(v.g!) }}</span>
          </td>
          <td :colspan="segDefs.length * 2"></td>
          <td class="mlg-fix" :style="fixUsage">
            <span class="mlg-bsum-v" :title="grpSegTitle(v.g!)">{{ fmt(usageOf(v.g!).total) }}</span>
          </td>
          <td class="mlg-fix" :style="fixSt"></td>
        </tr>
        </template>
        <tr v-if="win.bottomPad > 0" class="mlg-spacer" aria-hidden="true">
          <td :colspan="colCount" :style="{ height: win.bottomPad + 'px' }"></td>
        </tr>
        <tr v-if="rows.length === 0">
          <td class="mlg-noro" :colspan="colCount">{{ emptyText }}</td>
        </tr>
      </tbody>
      <!-- tfoot sticky 底(§7.1):合计|本月行至组=已抄/未抄|用量=Σ当前筛选行;行至列不做列合计 -->
      <tfoot>
        <tr>
          <th class="mlg-fix" :style="fixArea"><span class="mlg-foot-lbl">合　计</span></th>
          <th class="mlg-fix" :style="fixFloor"></th>
          <!-- 用途列也是 sticky:tfoot 同样要给它固定格,否则横滚时页脚露出下层内容 -->
          <th class="mlg-fix" :style="fixUse"></th>
          <th colspan="5"></th>
          <th :colspan="segDefs.length"></th>
          <th :colspan="segDefs.length"><span class="mlg-foot-rd">已抄 {{ foot.read }} / 未抄 {{ foot.missing }}</span></th>
          <th class="mlg-fix" :style="fixUsage"><span class="mlg-foot-v">{{ fmt(foot.usageSum) }}</span></th>
          <th class="mlg-fix" :style="fixSt"></th>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<style scoped>
/* ── 宽表(双级表头+左右固定列+合计页脚)—— 1:1 手法自 FPLedgerTable.vue ── */
.mlg-wrap { flex:1 1 auto; min-height:0; overflow:auto; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); }
/* table-layout:fixed(零布局位移):列宽只由 colgroup 决定,窗口化换行不触发列宽重算;
   min-width:100% 容器更宽时按比例摊余量,与数据内容无关,同样稳定 */
.mlg-table { border-collapse:separate; border-spacing:0; table-layout:fixed; min-width:100%; font-family:var(--font-sans); }
/* 窗口化 spacer(§7 6.5):撑出未渲染区高度;不参与 hover/分隔线 */
.mlg-table tbody tr.mlg-spacer td { padding:0; border:none; background:var(--surface-white); }
.mlg-table tbody tr.mlg-spacer:hover td { background:var(--surface-white); }
.mlg-table th, .mlg-table td { border-bottom:1px solid var(--divider); box-sizing:border-box; padding:0; }
.mlg-table thead th { position:sticky; background:var(--surface-card); color:var(--text-muted); font-size:11.5px; font-weight:var(--fw-semibold); text-align:center; padding:0 8px; z-index:4; }
.mlg-grp-th { top:0; height:34px; }
.mlg-leaf-th { top:34px; height:38px; line-height:1.25; white-space:normal; }
.mlg-fix-th { top:0; z-index:6; vertical-align:middle; }
/* 固定表头单元格须盖过横向滚动的分组/子列表头 */
.mlg-table thead th.mlg-fix-th { z-index:8; }
.mlg-table tbody td { height:34px; background:var(--surface-white); vertical-align:middle; }
.mlg-table tbody tr:hover td { background:var(--surface-card); }
.mlg-fix { position:sticky; z-index:3; background:var(--surface-white); }
.mlg-table tbody tr:hover .mlg-fix { background:var(--surface-card); }
td.ct { text-align:center; }

/* 租户格:点击开抽屉;hover 出 chevron;待核 coral/占位 dim */
.mlg-tname { display:inline-flex; align-items:center; gap:5px; padding:0 10px; font-size:12.5px; font-weight:var(--fw-semibold); color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; max-width:100%; }
.mlg-tname:hover .nm { color:var(--hue-blue); }
/* 名字吃剩余宽、徽标不许被压(改前 .nm 与徽标同为 flex:0 1 auto,而徽标 nowrap 压不动,
   于是全部收缩都落在名字上 —— 列一窄名字就只剩一个字。min-width:0 是让 ellipsis 生效的前提) */
.mlg-tname .nm { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.mlg-tname .mlg-st { flex:0 0 auto; }
.mlg-tname.coral .nm { color:rgb(202, 66, 41); }
.mlg-tname.dim .nm { color:var(--text-disabled); font-weight:var(--fw-regular); }
.mlg-tname .ch { opacity:0; flex:0 0 auto; color:var(--text-disabled); transition:opacity var(--dur-fast); }
.mlg-table tbody tr:hover .mlg-tname .ch { opacity:1; }

/* mono 右对齐数值(空值'–' dim)/左对齐文本 */
.mlg-nv { display:block; text-align:right; font-size:12px; padding:0 8px; color:var(--text-secondary); font-family:var(--font-mono); font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mlg-nv.empty { color:var(--text-disabled); }
.mlg-txt { display:block; text-align:left; font-size:12px; padding:0 10px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mlg-txt.dim { color:var(--text-disabled); }
.mlg-txt.mono { font-family:var(--font-mono); font-size:11.5px; font-variant-numeric:tabular-nums; }

/* 用量(派生蓝,校验红显) */
.mlg-sumc { display:block; text-align:right; font-weight:var(--fw-semibold); color:var(--hue-blue); font-size:12px; padding:0 8px; font-family:var(--font-mono); font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mlg-sumc.bad { color:var(--hue-red); cursor:help; }

/* 透明格内 input(focus 蓝底) */
.mlg-ni { width:100%; box-sizing:border-box; border:1px solid transparent; background:transparent; text-align:right; font-size:12px; padding:3px 6px; outline:none; color:var(--text-primary); font-family:var(--font-mono); border-radius:var(--radius-sm); }
.mlg-ni:focus { background:var(--accent-blue); border-color:var(--hue-blue); }
.mlg-ni::-webkit-outer-spin-button, .mlg-ni::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }

/* 状态徽标(语义色迁自旧 MeterGrid):已抄绿/未抄amber/倒走·时段不符红/待核·待绑定coral/占位灰 */
.mlg-st { display:inline-block; font-size:var(--fs-micro); font-family:var(--font-sans); font-weight:var(--fw-regular); border-radius:var(--radius-full); padding:2px 9px; cursor:help; white-space:nowrap; }
.mlg-st.sm { padding:1px 7px; }
.mlg-st.ok { color:rgb(21, 128, 61); background:rgb(222, 244, 229); }
.mlg-st.amber { color:rgb(138, 97, 0); background:rgb(255, 244, 214); }
.mlg-st.bad { color:var(--hue-red); background:rgb(255, 238, 237); }
.mlg-st.coral { color:rgb(202, 66, 41); background:rgb(255, 235, 228); }
.mlg-st.dim { color:var(--text-muted); background:var(--bg-sunken); }

/* 存疑行(V75 §E3/§F1):shadow 浅红底(已被踢出Σ)/ incomplete 浅黄底(仍在Σ内,只是档案没填全);
   sticky 固定列同步上色(否则横滚露白) */
.mlg-table tbody tr.mlg-sus td, .mlg-table tbody tr.mlg-sus td.mlg-fix { background:rgb(255, 244, 243); }
.mlg-table tbody tr.mlg-sus:hover td, .mlg-table tbody tr.mlg-sus:hover td.mlg-fix { background:rgb(255, 236, 234); }
.mlg-table tbody tr.mlg-inc td, .mlg-table tbody tr.mlg-inc td.mlg-fix { background:rgb(255, 250, 235); }
.mlg-table tbody tr.mlg-inc:hover td, .mlg-table tbody tr.mlg-inc:hover td.mlg-fix { background:rgb(255, 246, 222); }

/* 楼栋分组汇总行(§7.6,2026-07-28 加强):Excel 同款重分隔带——加高 40px+深底+上下 2px 粗边;
   sticky 格背景同步,横滚不露馅 */
.mlg-table tbody tr.mlg-bsum td { height:40px; background:var(--surface-sunken); border-top:2px solid var(--border-strong); border-bottom:2px solid var(--border-strong); }
.mlg-bsum-lbl { display:block; padding:0 10px; text-align:left; font-size:13px; font-weight:var(--fw-semibold); letter-spacing:.02em; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mlg-bsum-v { display:block; text-align:right; padding:0 8px; font-size:13px; font-weight:var(--fw-semibold); font-family:var(--font-mono); font-variant-numeric:tabular-nums; color:var(--text-primary); }

/* 空态行(表头保留,电子表格观感) */
.mlg-noro { text-align:center; padding:40px 16px; color:var(--text-disabled); font-size:var(--fs-label); }

/* 合计页脚(sticky bottom,纯色) */
.mlg-table tfoot th { position:sticky; bottom:0; z-index:5; height:40px; font-weight:var(--fw-semibold); background:var(--surface-white); border-top:2px solid var(--border-strong); font-family:var(--font-mono); color:var(--text-primary); }
.mlg-table tfoot th.mlg-fix { z-index:7; }
.mlg-foot-lbl { display:block; padding:0 10px; text-align:left; font-family:var(--font-sans); font-size:12.5px; color:var(--text-primary); }
.mlg-foot-v { display:block; text-align:right; padding:0 8px; font-size:12px; font-variant-numeric:tabular-nums; color:var(--brand-deep); }
.mlg-foot-rd { font-size:12px; color:var(--text-secondary); font-variant-numeric:tabular-nums; }
</style>
