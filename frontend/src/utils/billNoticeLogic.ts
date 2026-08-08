// 催缴单纯逻辑(S4-BILL-NOTICE-SPEC §7 S4-4 v2 拍板):费项/段字典、Excel 版式分块(非宿舍/宿舍子表)、
// 取价审计链 title、租户聚合(一个租户一条)/期归属/月租金参考/KPI。billNoticeLogic.spec.ts 锁定。
// fee_key 词汇沿用 alloc_result 现值(spec §4:不造第三套)——公摊类标签 2026-08-08 起转「租户单口径」。
// v1 的单据类/状态字典与按单 KPI 已随「屏上不显单据类/收款主体/状态」拍板删除。
// S5 刀4:租金板块(fee_group='rent' 落库行)按 premise 分块 groupRentByPremise;公摊行名=纯费项名 + billFeeTitle 悬浮。
import { ALLOC_FEE_LABEL } from '@/utils/allocLogic'
import { FEE_NAME, feeLabel, inferPropertyType, type FeeKey, type PropertyType } from '@/types/contract'

const r2 = (v: number) => Math.round(v * 100) / 100

// ── 费项(spec §4 表):直连计费键 + 公摊键 ──
// 公摊六键走「租户单口径」(2026-08-08 用户点名):显租户单上的费用项名,不显电表/池档案名。
// ⚠ 不动 ALLOC_FEE_LABEL——那是公共电核算屏的池侧词汇(消防用电/楼层照明/损耗费),改了会波及别的屏;
// 此处逐条钉死与之脱钩(即便当前取值与 alloc 相同,也写出来,免得那边改词把单据词汇拖着走)。
export const BILL_FEE_LABEL: Record<string, string> = {
  ...ALLOC_FEE_LABEL,
  share_elec_floor: '楼层公共',
  share_elec_fire: '消防照明',
  share_elec_elevator: '电梯用电',
  share_elec_loss: '线路损耗',
  share_elec_light: '路灯公摊',
  share_green_water: '绿化水公摊',
  share_water: '公用水公摊',        // 与上六键同理钉死:alloc 那边改词不许拖走单据词汇
  park_loss_pool: '园区损耗池',
  elec: '电费',
  mgmt_fee: '电力管理费',
  capacity: '装机容量费',
  water: '水费',
  water_pipe: '水管网维护费',
}
export const billFeeLabel = (k: string) => BILL_FEE_LABEL[k] ?? k

// ── 分时段 ──
export const SEG_LABEL: Record<string, string> = { sharp: '尖', peak: '峰', flat: '平', valley: '谷' }
export const segLabel = (s: string | null | undefined) => (s == null ? '' : SEG_LABEL[s] ?? s)

// ── Excel 版式(可莱恩 worksheet 范式,2026-08-05 拍板):非宿舍段电/水两部,逐场地「费块+维护费块」──
// 行归块映射:elec/capacity→电费块;mgmt_fee/楼层/消防/电梯/损耗/路灯→用电维护费块;
// water→水费块;water_pipe/绿化水→用水维护费块;未知键落 other 兜底(引擎加费项不丢行)。
// premise=null 的公摊行归「园区/未分场地」带(引擎改造后应都有 premise,此为兜底);场地按首现序。
const ELEC_FEE = new Set(['elec', 'capacity'])
const ELEC_MAINT = new Set([
  'mgmt_fee', 'share_elec_floor', 'share_elec_fire', 'share_elec_elevator', 'share_elec_loss', 'share_elec_light',
])
const WATER_FEE = new Set(['water'])
const WATER_MAINT = new Set(['water_pipe', 'share_green_water'])

export interface UtilLineBase { feeKey: string; premise: string | null; amount: number }
export interface UtilPremiseGroup<T> {
  premise: string | null
  label: string          // premise ?? 园区/未分场地
  fee: T[]               // 电费块(电表行+容量行)/水费块(水表行),入参序
  feeTotal: number
  maint: T[]             // 用电/用水维护费块
  maintTotal: number
  subtotal: number       // fee+maint(水部分「场地水费、维护费合计」用)
}
export interface UtilPart<T> { groups: UtilPremiseGroup<T>[]; total: number }
export interface ExcelStyleGroups<T> {
  elec: UtilPart<T>      // elec.total=「电费、用电维护费合计」
  water: UtilPart<T>     // water.total=「水费、用水维护费合计」
  other: T[]
  otherTotal: number
  total: number          // 非宿舍水电合计=Σ全行
}
export function groupExcelStyle<T extends UtilLineBase>(lines: T[]): ExcelStyleGroups<T> {
  const parts = { elec: { groups: [], total: 0 } as UtilPart<T>, water: { groups: [], total: 0 } as UtilPart<T> }
  const keys = { elec: new Map<string, UtilPremiseGroup<T>>(), water: new Map<string, UtilPremiseGroup<T>>() }
  const other: T[] = []
  for (const l of lines) {
    const part = ELEC_FEE.has(l.feeKey) || ELEC_MAINT.has(l.feeKey) ? 'elec'
      : WATER_FEE.has(l.feeKey) || WATER_MAINT.has(l.feeKey) ? 'water' : null
    if (!part) { other.push(l); continue }
    const k = l.premise ?? ''
    let g = keys[part].get(k)
    if (!g) {
      g = {
        premise: l.premise ?? null, label: l.premise ?? '园区/未分场地',
        fee: [], feeTotal: 0, maint: [], maintTotal: 0, subtotal: 0,
      }
      keys[part].set(k, g)
      parts[part].groups.push(g)
    }
    if (part === 'elec' ? ELEC_FEE.has(l.feeKey) : WATER_FEE.has(l.feeKey)) {
      g.fee.push(l); g.feeTotal = r2(g.feeTotal + l.amount)
    } else {
      g.maint.push(l); g.maintTotal = r2(g.maintTotal + l.amount)
    }
    g.subtotal = r2(g.feeTotal + g.maintTotal)
    parts[part].total = r2(parts[part].total + l.amount)
  }
  const otherTotal = r2(other.reduce((s, l) => s + l.amount, 0))
  return {
    elec: parts.elec, water: parts.water, other, otherTotal,
    total: r2(parts.elec.total + parts.water.total + otherTotal),
  }
}

// ── 宿舍子表(逐间宽行,Excel 宿舍段范式):电=电表行+电力管理费(同表挂靠)+路灯分摊(同房号唯一配对);
// 水=水表行+绿化水公摊(同房号)。配不上的公摊/损耗行落 extras 平铺,未知键落水子表尾——兜底别丢行。
// ponytail: 分时宿舍一表多段=一段一行,管理费挂该表首行;间序=入参行序。
export interface DormLineBase extends UtilLineBase {
  meterId: number | null
  meterLabel: string | null
  baseSnap: number | null
}
export interface DormRoomRow<T> {
  room: string           // 房号=premise,缺则表标签
  area: number | null    // 租赁面积=路灯/绿化水分摊行 baseSnap(面积基数)
  main: T                // 电表/水表行
  mgmt: T | null         // 电力管理费行(水恒 null)
  share: T | null        // 路灯分摊/绿化水公摊行
  amount: number         // 主行+管理费(Excel 金额列=用量×(基准电价+管理费))
}
export interface DormSub<T> { rooms: DormRoomRow<T>[]; extras: T[]; total: number }
export interface DormGroups<T> { elec: DormSub<T>; water: DormSub<T>; total: number }
export function groupDormExcelStyle<T extends DormLineBase>(lines: T[]): DormGroups<T> {
  const elec: DormSub<T> = { rooms: [], extras: [], total: 0 }
  const water: DormSub<T> = { rooms: [], extras: [], total: 0 }
  const elecByMeter = new Map<number, DormRoomRow<T>>()
  const mkRoom = (l: T): DormRoomRow<T> =>
    ({ room: l.premise ?? l.meterLabel ?? '–', area: null, main: l, mgmt: null, share: null, amount: r2(l.amount) })
  // 两遍扫:先建间行(电/水主行),再挂配对行
  for (const l of lines) {
    if (l.feeKey === 'elec') {
      const row = mkRoom(l)
      elec.rooms.push(row)
      if (l.meterId != null && !elecByMeter.has(l.meterId)) elecByMeter.set(l.meterId, row)
    } else if (l.feeKey === 'water') {
      water.rooms.push(mkRoom(l))
    }
  }
  // 同房号「按表」唯一才挂该表首行(S6 §3):分时一间=一表 4 段 4 行同 premise,按行数唯一永远配不上;
  // 两间不同房同 premise 时表不同→仍配不唯一,不硬挂错间。meterId 空的行各算一表(退化回按行唯一)。
  const byPremise = (rooms: DormRoomRow<T>[], premise: string | null): DormRoomRow<T> | null => {
    if (premise == null) return null
    const hit = rooms.filter(r => r.main.premise === premise)
    const meters = new Set<number | string>(hit.map((r, i) => r.main.meterId ?? `#${i}`))
    return meters.size === 1 ? hit[0] : null
  }
  for (const l of lines) {
    if (l.feeKey === 'elec' || l.feeKey === 'water') continue
    if (l.feeKey === 'mgmt_fee') {
      const row = l.meterId != null ? elecByMeter.get(l.meterId) : undefined
      if (row && !row.mgmt) { row.mgmt = l; row.amount = r2(row.amount + l.amount) } else elec.extras.push(l)
    } else if (l.feeKey === 'share_elec_light') {
      const row = byPremise(elec.rooms, l.premise)
      if (row && !row.share) { row.share = l; row.area = l.baseSnap } else elec.extras.push(l)
    } else if (l.feeKey === 'share_green_water') {
      const row = byPremise(water.rooms, l.premise)
      if (row && !row.share) { row.share = l; row.area = l.baseSnap } else water.extras.push(l)
    } else if (ELEC_FEE.has(l.feeKey) || ELEC_MAINT.has(l.feeKey)) {
      elec.extras.push(l)
    } else {
      water.extras.push(l)   // water_pipe + 未知键兜底
    }
  }
  const sum = (s: DormSub<T>) => r2(
    s.rooms.reduce((a, r) => a + r.amount + (r.share?.amount ?? 0), 0)
    + s.extras.reduce((a, l) => a + l.amount, 0))
  elec.total = sum(elec)
  water.total = sum(water)
  return { elec, water, total: r2(elec.total + water.total) }
}

// ── S5 刀4 租金板块:fee_group='rent' 落库行按 premise 分块(厂房/办公室/宿舍逐间,块序=首现序);
// 块类型=块内 rent_* 行反推(mgmt/infra 显「宿舍基础设施维护费」式段前缀,与后端 BillFeeMap 同判定)──
export interface RentLineBase { feeKey: string; premise: string | null; amount: number }
export interface RentPremiseGroup<T> {
  premise: string | null
  label: string               // premise ?? 未标场地
  type: PropertyType | null   // 块内 rent_* 行反推;无租金行=null(费项名不带前缀)
  lines: T[]
  subtotal: number
}
export interface RentGroups<T> { groups: RentPremiseGroup<T>[]; total: number }
export function groupRentByPremise<T extends RentLineBase>(lines: T[]): RentGroups<T> {
  const groups: RentPremiseGroup<T>[] = []
  const byKey = new Map<string, RentPremiseGroup<T>>()
  let total = 0
  for (const l of lines) {
    const k = l.premise ?? ''
    let g = byKey.get(k)
    if (!g) {
      g = { premise: l.premise ?? null, label: l.premise ?? '未标场地', type: null, lines: [], subtotal: 0 }
      byKey.set(k, g)
      groups.push(g)
    }
    if (g.type == null && l.feeKey.startsWith('rent_')) g.type = inferPropertyType(l.feeKey as FeeKey)
    g.lines.push(l)
    g.subtotal = r2(g.subtotal + l.amount)
    total = r2(total + l.amount)
  }
  return { groups, total }
}
// 租金行费项名:合同 13 枚举走 feeLabel(mgmt/infra 带段类型前缀),未知键原样回落
export const rentFeeName = (feeKey: string, pt: PropertyType | null): string =>
  feeKey in FEE_NAME ? feeLabel(pt, feeKey as FeeKey) : feeKey
// 面积展示(S5 §2):qty=计租面积/间数,baseSnap=分摊基数(建筑+公摊)快照;
// baseSnap>qty 时拆解「1528+458」,否则显单数。ponytail: 后端若改存公摊差额,仅此一处换算。
export function rentAreaText(qty: number | null, baseSnap: number | null): string | null {
  if (qty == null) return null
  return baseSnap != null && baseSnap > qty ? `${qty}+${r2(baseSnap - qty)}` : String(qty)
}

// ── 刀D(2026-08-08 人工审核):抽屉逐行「用量×单价=金额」可心算 ──
// 两类行的乘数不是用量列的度数:①按面积摊(路灯/绿化水):面积×分摊单价(元/㎡),用量列是该户分得的度/吨;
// ②线路损耗:金额基数(场地电费+公摊)×损耗率,用量列是链内电表度数。
// 判定不写死费项键——哪个数验得通就显哪个。S7 缺口①第三档兜底:share_src='area' 的
// 消防/楼层照明/电梯行 price_snap 存的是电价(元/度)、base_snap 存面积,等效元/㎡ 率没有任何一列存;
// 该率恒等于 amount÷base_snap(实测与源册『公共电分摊明细』AC 列逐格相同),按需补位显示,落库表价进悬浮不丢。
// ⚠ 纯显示层,一个落库值不动:后端 collectPrice() 的 `l.amount = r2(collect×base)` 白名单碰不得——
// 放宽会重算金额并破坏 splitShare 末行取余的守恒。
// 单价固定 2 位会把 0.0271 显成 0.03、0.005 显成 0.01、1.20606875 显成 1.21,验算必错:
// 取「能验算的最少位数」(2/3/4/5/6/8=落库 scale),都验不通回落 2 位(与改前一致),真值仍在单价列悬浮。
// S7 缺口②:判据=「四舍五入到分」后的整数分相等。闭区间容差 |mult×price−amount|<=0.005 与 HALF_UP 不等价,
// 会放行 0.50×1.21=0.605(→0.61≠0.60)、15.00×0.721=10.815(→10.82≠10.81)两类反例。1e-6 兜 JS 浮点。
const cents = (v: number) => Math.round(v * 100 + (v < 0 ? -1e-6 : 1e-6))
const verifies = (mult: number, price: number, amount: number) => cents(mult * price) === cents(amount)
const SCALES = [2, 3, 4, 5, 6, 8]
// 能把 mult×price 验平到 amount 的最少小数位;都验不通=null
const fitScale = (mult: number, price: number, amount: number): number | null =>
  SCALES.find(s => verifies(mult, +price.toFixed(s), amount)) ?? null
const trimZeros = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s)
const showPrice = (v: number, d: number) => trimZeros(v.toFixed(d))
export interface QtyCell {
  qty: number | null     // 真正的乘数(面积/金额基数/用量)
  unit: string           // ''|'㎡'|'元' —— 非空时别当度数看
  title: string | null   // 悬浮:摊法说明 + 原用量(度/吨不丢)
  price: string          // 单价显示串
}
export function billQtyCell(l: {
  feeKey: string
  shareSrc?: string | null
  qty: number | null
  baseSnap: number | null
  priceSnap: number | null
  amount: number
}): QtyCell {
  const p = l.priceSnap
  const raw = `${l.qty ?? '–'} ${l.feeKey.includes('water') ? '吨' : '度'}`
  const dq = p != null && l.qty != null ? fitScale(l.qty, p, l.amount) : null
  if (dq != null) return { qty: l.qty, unit: '', title: null, price: showPrice(p!, dq) }
  const base = l.baseSnap
  if (p != null && base != null && base !== 0) {
    const area = l.shareSrc === 'area'
    const tail = area ? `;该户分得 ${raw}` : `;链内用电 ${raw}`
    const db = fitScale(base, p, l.amount)
    if (db != null) {
      return {
        qty: base, unit: area ? '㎡' : '元', price: showPrice(p, db),
        title: (area ? '按面积摊:面积×分摊单价' : '按金额摊:(场地电费+公摊)×损耗率') + tail,
      }
    }
    const rate = l.amount / base            // 元/㎡ 率没落库时的兜底(缺口①)
    const dr = fitScale(base, rate, l.amount)
    if (dr != null) {
      return {
        qty: base, unit: area ? '㎡' : '元', price: showPrice(rate, dr),
        title: (area ? '按面积摊:金额÷面积=分摊单价' : '按金额摊:金额÷基数=摊率')
          + `;落库表价 ${p} 未用于本行` + tail,
      }
    }
  }
  return { qty: l.qty, unit: '', title: null, price: p == null ? '–' : showPrice(p, 2) }
}

// S7 缺口③:宿舍逐间子表两价压 2 位则 192 间行 177 条算不出金额(0.63586875→0.64)。两价各自补到
// 「能验平自己那段的最少位数」。⚠ 间行金额=用量×基准电价 与 用量×管理费 两段**各自四舍五入到分**后相加,
// 不是用量×(价+管理费):宿舍一栋311室 240.4 度 → 152.86+38.46=191.32,而 240.4×0.79586875=191.33 差 1 分
// (19/192 间行踩到)。表头据此改口径,别再邀请用户把两价加起来乘。水表行 mgmt 传 null 即退化成 用量×单价。
const fitPrice = (qty: number | null, p: number | null, amount: number): string => {
  if (p == null) return '–'
  return showPrice(p, (qty == null ? null : fitScale(qty, p, amount)) ?? 2)
}
export function dormPriceCells(
  main: { qty: number | null; priceSnap: number | null; amount: number },
  mgmt: { priceSnap: number | null; amount: number } | null,
): { price: string; mgmt: string } {
  return {
    price: fitPrice(main.qty, main.priceSnap, main.amount),
    mgmt: mgmt == null ? '–' : fitPrice(main.qty, mgmt.priceSnap, mgmt.amount),
  }
}

// ── 改造一(2026-08-08):公摊行名只显费用项名,「这笔钱哪来的」进悬浮 ──
// 行名去掉池名后同一费项会出现多条(同栋多块公共表),仍逐条保留不合并:合并会打死上面
// 「用量×单价=金额」的可验算性,也丢掉逐池溯源——靠本 tooltip 区分它们。
// 文案是人话:先说这笔钱从哪块表/哪个池来,再说怎么分到你头上;份数/面积/率全取行上真值,不写死。
// 面积档不认费项键,认 billQtyCell 的判定结果(哪个数验得通用哪个),tooltip 与「用量/单价」两列同源。
const spokenPrice = (v: number): string =>
  v >= 1 ? `${trimZeros(v.toFixed(4))} 元`
    : v >= 0.01 ? `${trimZeros((v * 100).toFixed(2))} 分钱`
      : `${trimZeros((v * 1000).toFixed(3))} 厘`
const num = (v: number | null) =>
  v == null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
export interface FeeTitleLine {
  feeKey: string
  shareSrc?: string | null
  poolName?: string | null    // 公摊池/公共表档案名;损耗行为 null(链名只在 note 里)
  qty: number | null
  baseSnap: number | null
  priceSnap: number | null
  amount: number
  note?: string | null
}
// 来源名(池档案名;损耗行池名为 null,链名从 note 取)与「一句话来源」拆开:
// 合并行的 tooltip 要在两者之间插金额(池名 金额 来源),整串拼死了插不进去。
const shareSrcName = (l: FeeTitleLine): string =>
  l.poolName ?? l.note?.match(/链\[(.+?)\]/)?.[1] ?? '公共表'
// 返回值含前导分隔(多数支为「 —— …」,损耗支为「 总表…」),src + why 逐字等于改前的整串
function shareWhy(l: FeeTitleLine): string {
  const water = l.feeKey.includes('water')
  const unit = water ? '吨' : '度'
  if (l.amount === 0) {
    return ` —— ${l.qty ? '本月摊到你这儿不足一分钱' : '这块表本月没走字'},不收钱`
  }
  // 损耗只认费项键:2024-02 有 3/121 条 qty 恰好等于金额基数,乘数列会落回用量档,但话得照说
  if (l.feeKey === 'share_elec_loss' && l.baseSnap != null && l.priceSnap != null) {
    return ` 总表用电和各家分表加起来对不上的那部分 —— `
      + `按你本月电费加楼内公摊 ${num(l.baseSnap)} 元的 ${trimZeros((l.priceSnap * 100).toFixed(4))}% 收`
  }
  const q = billQtyCell(l)
  if (q.unit === '㎡') {
    return ` —— 这是大家一起用的,按各家面积摊,每平米 ${spokenPrice(+q.price)},你的面积 ${num(q.qty)} ㎡`
  }
  // 合并后这些行不再有自己的用量/单价列(单价不同加不到一起),逐条把单价说进话里,
  // 否则用户看到「走了 5 度」却回推不出 5.57——这是合并唯一真正的信息损失,补话即可闭合。
  const each = q.price === '–' ? '' : `,每${unit} ${q.price} 元`
  if (l.shareSrc === 'member') {
    return ` —— 这块表只服务你一家,本月走了 ${num(l.qty)} ${unit}${each},整块${water ? '水' : '电'}费都算你的`
  }
  if (l.shareSrc === 'floor' && l.baseSnap != null) {
    // 「份数」池既有整层的(某侧走廊灯)也有全楼的(天面楼梯间/货梯,B座分 4 份跨 5 户),
    // 所以只说「几家一起用」,不写死「整层楼」——写死对天面池是假话。总份数未落库到行上,不编。
    return ` —— 这块公共表是几家一起用的,按份数摊,你占 ${num(l.baseSnap)} 份,`
      + `分到 ${num(l.qty)} ${unit}${each}`
  }
  return ` —— 本月分到你头上 ${num(l.qty)} ${unit}`
}
const shareTip = (l: FeeTitleLine): string | null =>
  l.feeKey.startsWith('share_') ? shareSrcName(l) + shareWhy(l) : null
// 费项名悬浮:公摊行=上面的人话来源说明;其余行=落库备注(宿舍 extras 表无备注列,别把它弄丢)→ 兜底费项名
export const billFeeTitle = (l: FeeTitleLine): string =>
  shareTip(l) ?? l.note ?? billFeeLabel(l.feeKey)

// ── 改造三(2026-08-09 用户返工):维护费块按纸单合并成一行 ──
// 上一刀只把行名从「费项·池名」换成费项名,行还是逐池一条,屏上出现好几个「楼层公共」——不是纸单的样子。
// 纸单:一项一行,后台把多个池的钱加总。「楼层公共、消防照明」是一项不是两项(源册 zh 表 F4 表头
// 原文就是一格文字一列钱),故 floor+fire 同组。电力管理费/电费/水费/容量费/水管网维护费不并——
// 它们是逐表计费项,纸单也分列。合并粒度=premise 分带内(抽屉按场地分带是更早的拍板:
// 「一个地块一个地块的给我」);单场地户合并后恰好是纸单那一行,多场地户每带各有自己一套。
// ⚠ 一分钱不改:纯渲染层合并,groupExcelStyle 的 feeTotal/maintTotal/total 全走原始行,不经此函数。
const MERGE_LABEL: Record<string, string> = {
  share_elec_floor: '楼层公共、消防照明',
  share_elec_fire: '楼层公共、消防照明',
  share_elec_elevator: '电梯用电',
  share_elec_loss: '线路损耗',
  share_elec_light: '路灯公摊',
  share_green_water: '绿化水公摊',
}
// 纸单行序:管理费/管网费(不并行,rank 0 保持入参序)在前,合并项照纸单排——
// 引擎 line_no 序是「路灯(17)在楼层(18)之前」,照搬就不是纸单的样子。sort 稳定(ES2019 起规范保证)。
const MERGE_RANK: Record<string, number> = {
  '楼层公共、消防照明': 1, '电梯用电': 2, '线路损耗': 3, '路灯公摊': 4, '绿化水公摊': 5,
}
// 备注列沿用纸单口径(按面积摊的两项);其余合并项留空
const MERGE_NOTE: Record<string, string> = {
  share_elec_light: '面积×公摊单价', share_green_water: '面积×公摊单价',
}
export interface ShareMergeRow<T> {
  label: string          // 纸单费项名
  feeKey: string         // 首个成员键(样式判定用)
  members: T[]           // 参与合并的原始行(构成条数守恒 == tooltip 条数)
  amount: number         // Σ成员金额
  qty: number | null     // 全组显示单价相同且乘数和仍验得平=求和;否则 null(构成进 tooltip)
  unit: string
  price: string | null
  note: string | null
  title: string          // 悬浮:逐条「池名 金额 一句话来源」
}
export type MaintRow<T> = { kind: 'line'; line: T } | { kind: 'merge'; row: ShareMergeRow<T> }
const money = (v: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// 用量/单价:能保住可验算就保住(单成员组、同一 std 拆多场地的路灯/绿化水),保不住才留空——
// 不许一律留空。乘数求和后必须自己验平(逐行分币各自四舍五入,和未必等于和的四舍五入)。
function mergeCells<T extends FeeTitleLine>(g: ShareMergeRow<T>): void {
  const cs = g.members.map(m => billQtyCell(m))
  const c0 = cs[0]
  if (!cs.every(c => c.price === c0.price && c.unit === c0.unit && c.qty != null)) return
  const price = Number(c0.price)
  const qty = r2(cs.reduce((s, c) => s + (c.qty ?? 0), 0))
  if (!Number.isFinite(price) || !verifies(qty, price, g.amount)) return
  g.qty = qty; g.unit = c0.unit; g.price = c0.price
}
export function mergeMaintRows<T extends FeeTitleLine>(lines: T[]): MaintRow<T>[] {
  const out: MaintRow<T>[] = []
  const byLabel = new Map<string, ShareMergeRow<T>>()
  for (const l of lines) {
    const label = MERGE_LABEL[l.feeKey]
    if (!label) { out.push({ kind: 'line', line: l }); continue }
    let g = byLabel.get(label)
    if (!g) {
      g = {
        label, feeKey: l.feeKey, members: [], amount: 0,
        qty: null, unit: '', price: null, note: MERGE_NOTE[l.feeKey] ?? null, title: '',
      }
      byLabel.set(label, g)
      out.push({ kind: 'merge', row: g })
    }
    g.members.push(l)
    g.amount = r2(g.amount + l.amount)
  }
  for (const g of byLabel.values()) {
    // 组内费项键混合(floor+fire)时逐条前缀费项名,答「什么电表的哪一项费用」
    const mixed = new Set(g.members.map(m => m.feeKey)).size > 1
    g.title = g.members
      .map(m => (mixed ? `${billFeeLabel(m.feeKey)}·` : '') + shareSrcName(m)
        + ` ${money(m.amount)} 元` + shareWhy(m))
      .join('\n')
    mergeCells(g)
  }
  return out.sort((a, b) =>
    (a.kind === 'merge' ? MERGE_RANK[a.row.label] ?? 9 : 0) - (b.kind === 'merge' ? MERGE_RANK[b.row.label] ?? 9 : 0))
}

// ── 取价审计链 title(行尾 info 图标悬浮):price_key/price_scope/price_month/rule_branch ──
export const RULE_BRANCH_LABEL: Record<string, string> = {
  tou: '分时四段',
  resident: '居民价',
  commercial: '商业价',
  tenant_override: '户级例外',
  fixed: '固定费率',
  pool: '公摊池',
}
export function priceScopeLabel(scope: string): string {
  if (scope === '') return '全园默认'
  if (scope.startsWith('tenant:')) return `户级例外(${scope})`
  return scope
}
export function auditTitle(l: {
  priceKey: string | null
  priceScope: string | null
  priceMonth: string | null
  ruleBranch: string | null
}): string | null {
  const rows = [
    l.priceKey ? `取价键 ${l.priceKey}` : null,
    l.priceScope != null ? `作用域 ${priceScopeLabel(l.priceScope)}` : null,
    l.priceMonth != null ? `价目月 ${l.priceMonth === '' ? '初始版本(自始生效)' : l.priceMonth}` : null,
    l.ruleBranch ? `判定分支 ${RULE_BRANCH_LABEL[l.ruleBranch] ?? l.ruleBranch}` : null,
  ].filter((s): s is string => !!s)
  return rows.length ? rows.join('\n') : null
}

// ── v2 拍板1:租户聚合——一个租户一条,该户全部单据(含宿舍单)合并,对齐 Excel 每租户一张 worksheet ──
export interface NoticeLike {
  id: number
  tenantId: number
  tenantName: string | null
  noticeKind: string
  premiseText: string | null
  totalAmount: number
  prevDue: number
  lineCount: number
  warn: string | null
}
export interface TenantNoticeRow {
  tenantId: number
  tenantName: string | null
  noticeIds: number[]          // 保单据序;明细抽屉逐单拉 detail 用
  lineCount: number            // 水电行数=Σ
  totalAmount: number          // 水电合计=Σ
  prevDue: number
  premiseText: string | null   // 各单场地按逗号拆项去重合并
  warn: string | null          // 各单 warn 按分号拆项去重、换行连接(悬浮原文)
  offbook: boolean             // 账外户降淡(offbook 是户级标,该户单据全为 offbook 才算)
}
export function aggregateByTenant(notices: NoticeLike[]): TenantNoticeRow[] {
  interface Acc { row: TenantNoticeRow; premises: Set<string>; warns: Set<string> }
  const accs: Acc[] = []
  const byTenant = new Map<number, Acc>()
  for (const n of notices) {
    let a = byTenant.get(n.tenantId)
    if (!a) {
      a = {
        row: {
          tenantId: n.tenantId, tenantName: n.tenantName, noticeIds: [],
          lineCount: 0, totalAmount: 0, prevDue: 0, premiseText: null, warn: null, offbook: true,
        },
        premises: new Set(), warns: new Set(),
      }
      byTenant.set(n.tenantId, a)
      accs.push(a)
    }
    const r = a.row
    r.noticeIds.push(n.id)
    r.lineCount += n.lineCount
    r.totalAmount = r2(r.totalAmount + (n.totalAmount ?? 0))
    r.prevDue = r2(r.prevDue + (n.prevDue ?? 0))
    r.tenantName ??= n.tenantName
    if (n.noticeKind !== 'offbook') r.offbook = false
    for (const p of (n.premiseText ?? '').split(',')) { const t = p.trim(); if (t) a.premises.add(t) }
    for (const w of (n.warn ?? '').split(';')) { const t = w.trim(); if (t) a.warns.add(t) }
  }
  for (const a of accs) {
    a.row.premiseText = a.premises.size ? [...a.premises].join(',') : null
    a.row.warn = a.warns.size ? [...a.warns].join('\n') : null
  }
  return accs.map(a => a.row)
}

// ── v2 拍板4:期归属——在租合同楼栋 phase(宿舍类归一期,多真期取首个非宿舍期)
//    → 回退 premise 前缀「一期/二期/三期」→ 兜底一期 ──
const DORMISH_NAME = /宿舍|散租|保障房|饭堂/
export function resolvePhase(
  buildings: { phase: number; name: string }[],   // 该户当月在租合同的楼栋(合同序)
  premiseText: string | null,
): 1 | 2 | 3 {
  let sawDorm = false
  for (const b of buildings) {
    if (b.phase === 4 || DORMISH_NAME.test(b.name)) { sawDorm = true; continue }
    if (b.phase === 1 || b.phase === 2 || b.phase === 3) return b.phase
  }
  if (sawDorm) return 1
  const m = premiseText?.match(/^(一|二|三)期/)
  if (m) return m[1] === '二' ? 2 : m[1] === '三' ? 3 : 1
  return 1
}

// ── 改造二(2026-08-08 用户点名「按楼栋分开每个租户」):期 tab 内加一级楼栋分组 ──
// 一户只进一个组:主楼栋=该户当月在租合同**租赁面积**最大的那栋(同栋多份合同先按栋求和),并列取 id 小。
// 跨栋户重复计入两个组会让组小计之和 ≠ tfoot 合计,所以只归主栋、行上给轻标记把别处场地说清。
// 组序=楼栋名自然序:中文数字先换阿拉伯(否则 zh 排序走拼音,「一/二/三车间」会排成二/六/三…),
// 再用 numeric 整理多位数;locale 取 'en' 让 A座 系列排在汉字名前(zh 会把汉字整体提前)。
export interface BuildingRef { id: number; name: string }
export interface TenantBuildings { main: BuildingRef | null; all: BuildingRef[] }   // all 按面积降序,主栋在首
export function tenantBuildings(
  cs: { buildingId: number; buildingName?: string | null; rentArea?: number | null }[],
): TenantBuildings {
  const m = new Map<number, { ref: BuildingRef; area: number }>()
  for (const c of cs) {
    if (!c.buildingId) continue
    const e = m.get(c.buildingId) ?? { ref: { id: c.buildingId, name: c.buildingName || `#${c.buildingId}` }, area: 0 }
    e.area += c.rentArea ?? 0
    m.set(c.buildingId, e)
  }
  const all = [...m.values()].sort((a, b) => b.area - a.area || a.ref.id - b.ref.id).map(e => e.ref)
  return { main: all[0] ?? null, all }
}
export interface CrossMark { badge: string; tip: string }
export function crossBuildingMark(t: TenantBuildings | undefined): CrossMark | null {
  if (!t?.main || t.all.length < 2) return null
  return {
    badge: `+${t.all.length - 1}栋`,
    tip: `该户当月在 ${t.all.length} 栋有场地:${t.all.map(b => b.name).join('、')};`
      + `本行按主楼栋(租赁面积最大)「${t.main.name}」归组,不重复计入其他楼栋组`,
  }
}
export interface BuildingGroup<T> {
  id: number | null      // null=未归楼栋(该户当月无在租合同/合同无楼栋)
  name: string
  rows: T[]
  count: number
  total: number          // 组内「本期合计」之和
}
const NO_BUILDING = '未归楼栋'
const CN_NUM: Record<string, string> = {
  一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10',
}
// ponytail: 单字直换,现有楼栋名最大到「六」;真出现「十一栋」再补十位组合
const bldSortKey = (s: string) => s.replace(/[一二三四五六七八九十]/g, c => CN_NUM[c])
const bldCollator = new Intl.Collator('en', { numeric: true })
export function groupByBuilding<T extends { totalAmount: number }>(
  rows: T[],
  buildingOf: (r: T) => BuildingRef | null,
): BuildingGroup<T>[] {
  const gs = new Map<number | string, BuildingGroup<T>>()
  for (const r of rows) {
    const b = buildingOf(r)
    const k = b?.id ?? ''
    let g = gs.get(k)
    if (!g) { g = { id: b?.id ?? null, name: b?.name || NO_BUILDING, rows: [], count: 0, total: 0 }; gs.set(k, g) }
    g.rows.push(r)
    g.count++
    g.total = r2(g.total + (r.totalAmount ?? 0))
  }
  // 空组不进 map(入参已是筛选后的行);未归楼栋置末
  return [...gs.values()].sort((a, b) => (a.id == null ? 1 : b.id == null ? -1
    : bldCollator.compare(bldSortKey(a.name), bldSortKey(b.name)) || a.id - b.id))
}

// ── v2:月租金(参考)——该户当月在租合同 monthlyRent 之和 ──
export function rentByTenant(contracts: { tenantId: number; monthlyRent: number | null }[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const c of contracts) m.set(c.tenantId, r2((m.get(c.tenantId) ?? 0) + (c.monthlyRent ?? 0)))
  return m
}

// ── v2 KPI:户数/水电总额/月租金合计(参考)/警告户数(随当前期 tab 联动) ──
export function tenantKpis(rows: { totalAmount: number; rent: number | null; warn: string | null }[]): {
  count: number; total: number; rent: number; warned: number
} {
  let total = 0, rent = 0, warned = 0
  for (const r of rows) {
    total += r.totalAmount ?? 0
    rent += r.rent ?? 0
    if (r.warn) warned++
  }
  return { count: rows.length, total: r2(total), rent: r2(rent), warned }
}
