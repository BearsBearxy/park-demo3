// 池核算纯逻辑(POOL-ENGINE-SPEC §6,S3-B1 刀2):分带分组/tfoot 合计(ref 行剔除)/
// 分摊语义标签/分摊标准折入披露/导出 AOA/损耗对账区行格式化。poolLedgerLogic.spec.ts 锁定。
// BOOK-REBUILD-SPEC §H4 前端:分带改原册块(不再按楼栋)、池名称优先原册自然键 book_key、
// 「楼层」列归一为一格 floor_label、带尾按原册 SUM 区间出合计行。
// §H3:二期 2023 冻结参数在「分摊标准」列 title 里披露(stdDisplay 的 frozenNote 参数)。
import type { AllocLossReconDTO, AllocLossUnitDTO, AllocMeterDiffDTO, AllocMethod, AllocPoolLineDTO, AllocPoolRowDTO } from '@/api/alloc'
import { ALLOC_METHOD_LABEL } from '@/utils/allocLogic'
import { floorRank } from '@/composables/useMeterWorkbench'

const r2 = (v: number) => Math.round(v * 100) / 100
// 浮点噪音清理后的紧凑数字串(0.0050000 → '0.005')
const trimNum = (v: number) => String(Number(v.toFixed(8)))
const fmtN = (v: number | null) =>
  v == null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })

// ── 分摊语义:method+基数标签(X层/㎡/户对户/不分摊/纯标准行) ──
// method 收 string 而不是 AllocMethod:后端值域随原册增补(V81 加过 'manual'),
// 这里按字符串比,未知方法回落 default 显原文,不会因为联合没跟上就整屏报错。
export function poolSemantics(r: { method: string; baseSnap: number | null }): string {
  const base = r.baseSnap
  switch (r.method) {
    case 'floor': return base != null ? `${trimNum(base)}层均摊` : ALLOC_METHOD_LABEL.floor
    case 'area': return base != null ? `${trimNum(base)}㎡分摊` : ALLOC_METHOD_LABEL.area
    case 'direct': return '户对户'
    case 'none': return '不分摊'
    case 'ref': return '纯标准行'
    case 'carrier': return '冲减载体'
    case 'manual': return '无电表'
    default: return ALLOC_METHOD_LABEL[r.method as AllocMethod] ?? r.method
  }
}

// ── 备注列:manual 行(原册有分摊关系却没表)固定话术,其余显池备注 ──
// blank=没备注时的占位:屏上 '–',导出留空格(Excel 里 '–' 是噪音)
export function poolNote(r: { method: string; note: string | null }, blank = '–'): string {
  if (r.method === 'manual') return '无电表,金额人工/从总表回勾'
  return r.note ?? blank
}

// ── §H3 二期 2023 遗留链:冻结参数披露 ──
// 隐藏表『公共电分摊』(2023-04/05 死模板)有四格仍被 2024-02 的租户 sheet 直接引用:M99=0.005(路灯)、
// M109=0.01(绿化水泵)、L24=205.39(六车间消防 元/层)、L99=0.01(水泵消防控制室 元/㎡),而 L24/L99 又由
// 2023 抄见值×2023 电价现算 —— 曹小芳 2024年2月实收的 175.48 元消防用电就是这么出来的(两套电价差约 17%)。
// V83 把这四个值落成 alloc_cfg 的 rule:{id} 默认行(acct_month='' 本身即「不随月份变」=冻结),来源单元格
// 与真实年月写在 note 里;这里只负责把 note 原文挂进「分摊标准」列的 title。
// **本刀只披露不重算** —— 按 2024 年重算会改动已出的实收,需用户单独拍板(spec §H3)。
export const FROZEN_CFG_KEY = 'frozen_2023'
export const FROZEN_HINT = '本值含 2023 年冻结参数,非当月价'

// ── 分摊标准展示:text=按 roundScale 定小数;title 披露折入 '0.01+0.005' 与 §H3 冻结参数(各占一行) ──
// frozenNote=该池 frozen_2023 配置行的 note 原文(无=不披露);std 未生成(null)时仍照披露,冻结是池的属性不是当月结果。
export function stdDisplay(r: Pick<AllocPoolRowDTO, 'stdValue' | 'foldAdd' | 'roundScale'>,
                           frozenNote?: string | null): { text: string; title: string | null } {
  const tips: string[] = []
  if (frozenNote) tips.push(`${FROZEN_HINT} —— ${frozenNote}`)
  const title = () => (tips.length ? tips.join('\n') : null)
  if (r.stdValue == null) return { text: '–', title: title() }
  // 折入档可比 roundScale 多一位(V46=ROUND(x,2)+0.005=0.015),按值实际小数位与 roundScale 取大,防截位
  const frac = String(r.stdValue).split('.')[1]?.length ?? 0
  const text = r.stdValue.toFixed(Math.max(r.roundScale, frac))
  if (r.foldAdd) tips.unshift(`${trimNum(r.stdValue - r.foldAdd)}+${trimNum(r.foldAdd)}`)
  return { text, title: title() }
}

// ── 池名自动生成(V69,与后端 AllocService.poolName 同规则;后端没给 autoName 时前端兜底) ──
// 非空段「·」连接;楼层+侧向合成一段;楼栋名原样(含空格);末端截到 64(name VARCHAR(64))。
// ⚠楼栋空(园区级)前缀取 zone 期别:一/二期/宿舍各有一个「路灯」池,统一写"园区级"会三撞一。
const ZONE_POOL_PREFIX: Record<string, string> = { p1: '一期园区', p2: '二期园区', dorm: '宿舍区' }
export function poolAutoName(zone: string, buildingName: string | null | undefined, floorLabel: string | null | undefined,
                             side: string | null | undefined, feeName: string | null | undefined): string {
  const t = (s: string | null | undefined) => (s ?? '').trim()
  const parts = [t(buildingName) || ZONE_POOL_PREFIX[zone] || '园区级']
  const loc = t(floorLabel) + t(side)
  if (loc) parts.push(loc)
  if (t(feeName)) parts.push(t(feeName))
  return parts.join('·').slice(0, 64)
}

// ── 分带按原册块(§H4.2b;取代旧的按楼栋分带 groupPoolsByBuilding,已删) ──
// V80 起 alloc_rule.book_block = 原册 7 个合计行的块名原文。按楼栋分带会把原册 A 座的两个块
// (`A座及园区公共表合计:` / `A座电梯及楼层公共电合计`)并成一带、又把三行招商中心抽成自成一带
// —— 正是本次报障的结构根因。带序/带内序都直接吃后端行序首现(AllocService.pools 已按
// 块序(块内最小 book_row)→ 块内原册行序 排好;book_row 不透出 DTO,前端不重排)。
// 二期/宿舍原册无块结构 → book_block 全 NULL,回落楼栋名(园区级在前)+楼层序,行为不变。
export interface PoolBand {
  label: string                  // 原册块名;无块回落楼栋名;都没有='园区级'
  book: boolean                  // true=原册块带(带内序由后端 book_row 定,前端不再排)
  rows: AllocPoolRowDTO[]
}
// 整栋池(floorLabel 空)恒排带首;其余复用抄表台账的楼层解析(负一层<一楼<…<天面)
const floorSort = (f: string | null | undefined) => (f?.trim() ? floorRank(f) : -Infinity)
export function groupPoolsByBookBlock(rows: AllocPoolRowDTO[], zone: string): PoolBand[] {
  const bands: PoolBand[] = []
  const byKey = new Map<string, PoolBand>()
  for (const r of rows.filter(x => x.zone === zone)) {
    const block = r.bookBlock?.trim() ?? ''
    const label = block || r.buildingName?.trim() || '园区级'
    let b = byKey.get(label)
    if (!b) { b = { label, book: !!block, rows: [] }; byKey.set(label, b); bands.push(b) }
    b.rows.push(r)
  }
  for (const b of bands) if (!b.book) b.rows.sort((a, c) =>
    floorSort(a.floorLabel) - floorSort(c.floorLabel)
    || (a.side ?? '').localeCompare(c.side ?? '')
    || a.sortNo - c.sortNo)
  return bands
}

// ── 池定位分类(§H4.2a 归一后):原册 C 列就是「楼层+方位」一格,side 一期不再写入 ──
// park    园区级(不挂楼栋,本就没有楼层维度,留空)
// located 已录 floor_label(原册 C 列那一格,可能本身含方位如「四楼西侧」)
// whole   按层份(floor)池挂栋不录楼层=整栋刻意(P2-SHARE-LAYER-SPEC §8:池不分层,
//         无楼层方位概念),留空不催补
// todo    其余摊法挂了楼栋却没录楼层 —— 屏上显「(未录)」并橙标,要人工补
// ⚠旧的 workshop(按车间)/net(整栋净额)两态连同话术一并废除(§H4.3.3:屏上不许再出现
// 「天面东侧/天面西侧/整栋净额/按车间/–」)。代价:招商中心净额池会落 todo(二期 16 个
// 车间池按层份摊,已随 whole 豁免)。
export type PoolLocKind = 'park' | 'located' | 'whole' | 'todo'
type PoolLocSrc = Pick<AllocPoolRowDTO, 'buildingId' | 'floorLabel' | 'method'>
export function poolLocKind(r: PoolLocSrc): PoolLocKind {
  if ((r.floorLabel ?? '').trim()) return 'located'
  if (r.buildingId == null) return 'park'
  return r.method === 'floor' ? 'whole' : 'todo'
}
// 屏上「楼层」格的悬停说明(located/park/whole 无需解释)
export const POOL_LOC_HINT: Record<PoolLocKind, string | null> = {
  park: null,
  located: null,
  whole: null,
  todo: '这个池挂了楼栋却没录楼层 —— 点开池名在抽屉里补「楼层」(原册 C 列那一格,不拆方位)',
}

// ── 「楼层」列:单值 floor_label(不再拼 side);挂栋没录=「(未录)」,园区级/整栋(floor池)空 ──
export const POOL_LOC_UNSET = '(未录)'
export function poolFloor(r: PoolLocSrc): string {
  const kind = poolLocKind(r)
  if (kind === 'located') return (r.floorLabel ?? '').trim()
  return kind === 'todo' ? POOL_LOC_UNSET : ''
}

// ── 池名称列优先显原册 A 列自然键 book_key(§H4.2d,回溯锚点);无键回退费项名,再回退全名 ──
export const poolFeeLabel = (r: Pick<AllocPoolRowDTO, 'bookKey' | 'feeName' | 'name'>) =>
  r.bookKey?.trim() || r.feeName?.trim() || r.name

// ── 刀I §I4 合计不许双计 ──
// fold_qty 的目标池,其 qty/cost 里**已经含**源池的整段量(AllocService.poolSegQty 直接相加),
// 而源池自己在屏上还占一行 → 无条件 Σ 会把源池计两遍(块1 合计 3356.68/3739.91 比原册多 152.06/169.42
// 就是这么来的)。PoolRow.links 是**入链**(ruleId=源池),故跳过集 = 这批行里被别人 fold_qty 吃掉的源池。
// I1 拆池后全库已无 qty 折入链(只剩二期 3 条 fold_price,只叠加分摊标准不动量),这里是防御 + 单测锁死。
// ponytail: 跳过集只从传进来的这批行解析 —— 原册的 SUM 区间就是块,跨块折入本身就是数据错误。
export function foldQtySrcIds(rows: AllocPoolRowDTO[]): Set<number> {
  const s = new Set<number>()
  for (const r of rows) for (const l of r.links ?? []) if (l.type === 'fold_qty') s.add(l.ruleId)
  return s
}
// ── 带尾合计(§H4.2b:原册 7 个块各有一行合计,口径与该块 SUM 区间一致) ──
// Σ度数/Σ应分摊,ref 行(纯标准行)与 §I4 折入源行不计;全 null=null(未生成月显'–')。
// ⚠原册 r31「A座电梯及楼层公共电合计」的怪癖 —— `S31=SUM(S13:S30)` 起于 13,而
// `AD31/AE31/AF31=SUM(…12:…30)` 起于 12,同一合计行两列取不同区间。根因是块首 r12
// (联塑精铟)无电表、S 列空只有手输金额。这里按册复刻但**不特判行号**:用量列 null 天然
// 不进 Σ、金额列照进,与原册「用量区间少一行、金额区间多一行」逐格等价 —— 这也正是
// V81 manual 行的形态(qty 恒 null),行号一变(补行/改序)也不会失效。
export function bandFooter(rows: AllocPoolRowDTO[]): { qty: number | null; cost: number | null } {
  let qty: number | null = null
  let cost: number | null = null
  const folded = foldQtySrcIds(rows)
  for (const r of rows) {
    if (r.method === 'ref' || folded.has(r.ruleId)) continue
    if (r.qtyTotal != null) qty = r2((qty ?? 0) + r.qtyTotal)
    if (r.costAmount != null) cost = r2((cost ?? 0) + r.costAmount)
  }
  return { qty, cost }
}
// tfoot 全期合计 = Σ各带(口径同上)
export function poolFooter(bands: PoolBand[]): { qty: number | null; cost: number | null } {
  return bandFooter(bands.flatMap(b => b.rows))
}

// ── V73 逐表行(用户 2026-07-30:「天面还是想要一行一行的派生而不是汇总成一个」) ──
// 一个池占 max(1, lines.length) 行:逐表列一表一行,池级列 rowspan 合并 —— 即原册的合并单元格结构。
export const poolSpan = (r: Pick<AllocPoolRowDTO, 'lines'>) => Math.max(1, r.lines?.length ?? 0)
// 应分摊列:逐表金额齐全(p1/dorm 逐表ROUND口径)才逐表显;否则池行 rowspan 显池级合计。
// p2 是池级一次 ROUND、净额池/手输量池是整池一次 ROUND —— 逐表金额不存在,不按比例摊回冒充。
export function costPerLine(r: Pick<AllocPoolRowDTO, 'lines'>): boolean {
  const ls = r.lines ?? []
  return ls.length > 0 && ls.every(l => l.costAmount != null)
}
// 池合计副标题:多表池才显(单表池池行=表行,重复无意义)
export function poolSubtotal(r: Pick<AllocPoolRowDTO, 'lines' | 'qtyTotal' | 'costAmount'>): string | null {
  if ((r.lines?.length ?? 0) < 2) return null
  const q = r.qtyTotal == null ? '–' : fmtN(r.qtyTotal)
  const c = r.costAmount == null ? '–' : fmtN(r.costAmount)
  return `Σ ${q} 度 / ${c} 元`
}
// 电表行标签:sign=-1 前缀「−」(冲减);label 已是「区域·位置·用途·表号」全名
export const lineLabel = (l: AllocPoolLineDTO) => (l.sign < 0 ? '−' : '') + l.label

// ── 刀I §I3 逐行身份:「楼层」「池名称」两列逐行取自本行电表(ROW-IDENTITY-SPEC) ──
// 立法依据:原册 B(区域)/C(楼层)/D(企业名称)**永远逐行写,从不纵向合并**;真正纵向合并的只有
// AA(系数)/AC(标准)/AE(已分摊)/AF(盈亏)/AG(备注)。一个池跨多个原册行时(A座天面四部梯 = 原册
// r27–r30 四行、AA27:AA30 才是合并区间),取池级值会把四行的身份写成同一个。
// 「楼层」:池级 floor_label 是**原册 C 列原文**(楼层+方位一格,如「四楼西侧」),表级 floor_label 是
// 结构化楼层(「四楼」,方位另存 side)—— 故池级以行值开头时按册取池级(同一层的更完整写法),
// 否则取行值(池跨层、或池是园区级没有楼层而表有)。行值缺(净额池不出行/无绑定表/后端老快照)回落池级。
// ⚠ 只认 floorLabel,**不拿 spot 兜底**:spot 是位置原文,库里有「消防分表」「火炬园广告字」这类
//   根本不是楼层的值(只读查库实测,分属 p2 rule 14/15/16/17/20/21),兜底会把它们写进楼层列。
//   后端没给 floorLabel(老快照)时回落池级 = 与本刀之前完全一致,不会把噪音抬进这一列。
// 「区域」列(原册 B 列):楼栋/车间名,**不带期数前缀**(原册写的是「A座」「一车间」「招商中心」,不是「一期 A座」)。
// 行值优先取本行电表的 area —— 它就是原册 B 列原文(招商中心那几行的 area 正是「招商中心」而非「A座」);
// 缺行值(净额池不出行/无绑定表)回落池的楼栋名并剥掉期数前缀。园区级池(不挂栋)返回空串。
const PHASE_RE = /^(一期|二期|三期|宿舍区?)\s*/
export const stripPhase = (s: string | null | undefined) => (s ?? '').trim().replace(PHASE_RE, '')
export function poolArea(r: Pick<AllocPoolRowDTO, 'buildingName'>): string {
  return stripPhase(r.buildingName)
}
export const lineArea = (l: Pick<AllocPoolLineDTO, 'area'> | null | undefined, fallback: string) =>
  stripPhase(l?.area) || fallback

export function lineFloor(l: Pick<AllocPoolLineDTO, 'floorLabel'> | null | undefined,
                          poolFloorText: string): string {
  const line = (l?.floorLabel ?? '').trim()
  if (!line) return poolFloorText
  return poolFloorText.startsWith(line) ? poolFloorText : line
}
// 「池名称」:取本行电表的用途(=原册 D 列);缺失回落调用方给的池级名。
// 池级自然键 book_key(原册 A 列)不再占这一列,改进池首行副标题(poolSubtitle)。
export const lineUseName = (l: Pick<AllocPoolLineDTO, 'useName'> | null | undefined, fallback: string) =>
  l?.useName?.trim() || fallback
// 池首行副标题:原册 A 列自然键(回溯锚点)+ Σ 用量/金额。与本行用途同字时不重复出。
export function poolSubtitle(r: Pick<AllocPoolRowDTO, 'bookKey' | 'lines' | 'qtyTotal' | 'costAmount'>,
                             lineName: string): string | null {
  const key = r.bookKey?.trim()
  const parts = [key && key !== lineName ? key : null, poolSubtotal(r)].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

// ── 刀I §I2 净额池:构成明细进主行 hover(那些表在原册分摊明细上没有行,不出逐表行) ──
// 招商中心锚点:697.60+444.80−4.74−0−315.60−0−0−670 = 152.06。
// 「冲减 N 表」的 N 只数电表(meterId 非空),账册扣度不是表。
export function netSummary(r: Pick<AllocPoolRowDTO, 'netParts' | 'qtyTotal'>): { text: string; title: string } | null {
  const ps = r.netParts ?? []
  if (!ps.length) return null
  const minus = ps.filter(p => p.meterId != null && p.sign < 0).length
  const sgn = (v: number | null) => (v == null ? '–' : (v < 0 ? '−' : '+') + fmtN(Math.abs(v)))
  return {
    text: `净额 · 冲减 ${minus} 表`,
    title: ['净额构成:', ...ps.map(p => `${sgn(p.qty)}  ${p.label}`), `= ${fmtN(r.qtyTotal)} 度`].join('\n'),
  }
}

// ── 导出 AOA:标题+表头+逐表行(平表,分带落「原册块」列)+合计行(列序=屏列序) ──
// §E1:原册块/楼层/池名称 三列**每行都填**(= 原册结构,定位列是逐行写满的);
// 合并类列(语义/标准/实收/盈亏/备注)才只填池首行,下游 Excel 里人工合并即可。
// 摊出/差额两列已撤(用户 2026-08-02 拍板,同屏列;allocated/gap 仍落库不再导出)。
// §H4.2d:池名称优先导原册自然键 book_key(导出的用途就是回原册逐行对),无键才回退全名 autoName。
// 实收/盈亏 待账单模块,恒空。
export function buildPoolExportAoa(bands: PoolBand[], ym: string, zoneLabel: string): (string | number)[][] {
  const aoa: (string | number)[][] = [
    [`公共电核算 ${ym} · ${zoneLabel}`],
    ['区域', '楼层', '池名称', '原册块', '电表', '表编码', '倍率', '上月行至', '本月行至',
      '用量·总', '尖', '峰', '平', '谷', '应分摊(元)',
      '分摊语义', '分摊标准', '实收', '盈亏', '备注'],
  ]
  const c = (v: number | null | undefined) => (v == null ? '' : v)
  const s = (v: string | null | undefined) => v ?? ''
  for (const b of bands) {
    for (const r of b.rows) {
      const lines = r.lines ?? []
      const perLine = costPerLine(r)
      const emit = (i: number, l: AllocPoolLineDTO | null) => {
        // 定位列逐行填(原册 B/C/D 从不纵向合并);池名称=原册自然键优先;块名单列保留供回原册定位
        const head = [lineArea(l, poolArea(r)), lineFloor(l, poolFloor(r)),
          r.bookKey?.trim() || r.autoName || r.name, b.label]
        const tail = i === 0
          ? [poolSemantics(r), c(r.stdValue), '', '', poolNote(r, '')]
          : ['', '', '', '', '']
        aoa.push([
          ...head,
          l ? lineLabel(l) : '(无绑定表)', l ? s(l.code) : '', l ? c(l.factorSnap) : '',
          l ? c(l.prevTotal) : '', l ? c(l.currTotal) : '',
          c(l ? l.qtyTotal : r.qtyTotal), c(l ? l.qtySharp : r.qtySharp), c(l ? l.qtyPeak : r.qtyPeak),
          c(l ? l.qtyFlat : r.qtyFlat), c(l ? l.qtyValley : r.qtyValley),
          perLine ? c(l?.costAmount) : (i === 0 ? c(r.costAmount) : ''),
          ...tail,
        ])
      }
      if (lines.length) lines.forEach((l, i) => emit(i, l))
      else emit(0, null)
    }
  }
  const foot = poolFooter(bands)
  // 列位与表头对齐:区域/楼层/池名称/原册块/电表/表编码/倍率/上月/本月 共 9 格,之后才是用量·总
  aoa.push(['合计', '', '', '', '', '', '', '', '', c(foot.qty), '', '', '', '',
    c(foot.cost), '', '', '', '', 'ref 行不计;carrier 只计度数不计金额'])
  return aoa
}

// ── 未入池的公摊表 → 告警抽屉一组(V.9)。zone 过滤与 zoneDiffs 同口径(只提示本期区的)。
// desc/items 字段名对齐 FPAlertPanel 的 AlertGroup(key/title/desc/items{text}),
// PoolLedgerView 可以直接 gs.push(mg) 不用再转一层。──
export function meterDiffGroup(diffs: AllocMeterDiffDTO[], zone: string) {
  const mine = diffs.filter(d => d.zone === zone)
  if (!mine.length) return null
  return {
    key: 'meter-unpooled',
    title: `${mine.length} 块公摊表没进任何池`,
    desc: '这些表本月有读数,但没被任何池绑定 —— 它们的电费不会摊给任何人,也不会出现在催缴单上',
    items: mine.map(d => ({ text: `${d.buildingName ?? '(未挂楼栋)'} ${d.label}` })),
  }
}

// ── 损耗对账区两行(供电局总表 vs 各栋总表合计 / 各栋分表合计),读时派生列落位到屏列 ──
// 供电局读数不拼进标签,单独落「总表用电量」列;被比的合计落「分表用电量」列(从供电局总表看,各栋的表都是它的分表)
export interface LossReconRow {
  label: string
  supplyQty: number | null   // 供电局总表读数 → 「总表用电量」列
  sumQty: number | null      // 各栋总表合计 / 各栋分表合计 → 「分表用电量」列
  loss: number | null
  rate: number | null
}
export function buildLossReconRows(r: AllocLossReconDTO | null | undefined): LossReconRow[] {
  if (!r) return []
  return [
    { label: '供电局总表 vs 各栋总表合计', supplyQty: r.supplyQty, sumQty: r.sumC, loss: r.lossVsC, rate: r.rateVsC },
    { label: '供电局总表 vs 各栋分表合计', supplyQty: r.supplyQty, sumQty: r.sumD, loss: r.lossVsD, rate: r.rateVsD },
  ]
}

// ── 损耗合计行:Σ 总表/铝缆/分表/损耗量(率不合计) ──
export function lossFooter(units: AllocLossUnitDTO[]):
  { cQty: number | null; cableQty: number | null; dQty: number | null; eQty: number | null } {
  const sum = (pick: (u: AllocLossUnitDTO) => number | null) => {
    let s: number | null = null
    for (const u of units) { const v = pick(u); if (v != null) s = r2((s ?? 0) + v) }
    return s
  }
  return { cQty: sum(u => u.cQty), cableQty: sum(u => u.cableQty), dQty: sum(u => u.dQty), eQty: sum(u => u.eQty) }
}
