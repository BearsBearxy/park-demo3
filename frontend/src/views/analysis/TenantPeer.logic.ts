// TenantPeer(租户对标,tenant-peer)纯函数 —— design-boards T8/T9/T10/T11。
// T8/T9:骨架 + 单位租金对标直方图。T10:「哪些期区能给区间」+「电费会翻车」两张卡。
// T11:「这张图为什么可信/和预测图的区别」对照卡(该卡是静态方法论对照,数字大多复用既有
// computed,没有新增纯函数——见 TenantPeerView.vue)。
//
// T10 两张卡的口径(用户已给出、本轮查库坐实,见任务原文与下方各函数注释):
// · 「哪些期区能给区间」不能照抄板上的四行数字(那是不过滤日期的总体,标签却写着「在租」)——
//   板还把期区二的成因诊断错了(说是宿舍与厂房混杂,真实原因是 F1 已排除的无租金计费行合同,
//   T8/T9 修复轮1 已查库坐实并改写单位租金卡自己的口径浮层)。本表按屏上实际用的口径现算:
//   在租 + 已录面积 + 排除无租金计费行(与「单位租金对标」卡同一个 buildPeerRows population)。
// · 「电费会翻车」不能抄板上的 62/7,554/79,750/122倍——那是设计时的示意数字,今天的附表10
//   最新一期(现算,不是写死 2025-12)重新量。
//
// 口径(用户已查库核实,见 .superpowers/sdd/2026-09-11-design-boards/t8-report.md 引用的任务说明):
// · 单位租金 = monthly_rent / rent_area(合同总月租,含管理费/基础维护等五费项合计,不是纯租金单价——
//   这是任务指定口径,与 ContractDTO.unitPrice(五费项之一的租金单价字段)是两回事,不要混用)。
// · 同类分组 = 同期区(building.phase)的在租合同,不按物业类型细分——板上「单位租金对标」这张卡
//   本身就是按期区分组(板上第二张卡「哪些期区能给区间」才逐期区判断是否要按 profile 再拆,那是 T10 的事)。
// · 在租 = 非草稿、非整体承租(master_lease,与散户空间重叠会重复计入)、起止日期都有、asOf 落在闭区间内
//   (镜像后端 ContractService.inForceOn,§5.2)。
// · 已排除 billingLineCount==0 的合同(F1 修复轮1,查库验过):monthly_rent 只有 mgmt/infra/elevator/
//   transformer 等维护费、没有任何 rent_* 计费行——那是数据缺口不是便宜,与 ContractsView.vue:146
//   「无租金计费行」筛选、DataHomeService 的 219 份缺口告警同一判据(BUILDING_RENT_KEYS)。
import { quantile } from '@/components/ana/anaFmt'
import { PROPERTY_TYPE_LABEL, RENT_KEYS, type BillingLineDTO, type ContractDTO, type PropertyType, inferPropertyType } from '@/types/contract'
import type { AnalysisS10Row } from '@/api/analysis'

/** 少于本数,不给区间/不给百分比读数(全局约束⑤;板上「样本 < 20 不画带」同一条规矩)。 */
export const MIN_SAMPLE = 20

/** 某日在租(镜像 ContractService.inForceOn):非草稿、非整体承租、起止日期齐全且 asOf 落在闭区间内。
 *  参数只取用到的四个字段(Pick,不是整个 ContractDTO)——F3(对抗复查)起,expiry.logic.ts 的
 *  medianFactoryRent 也复用这同一份判据,只有 monthlyRent/startDate/endDate 三个字段的候选数据
 *  不该被强迫拼出一整个 ContractDTO 才能传进来。 */
export function isInForce(c: Pick<ContractDTO, 'status' | 'kind' | 'startDate' | 'endDate'>, asOf: string): boolean {
  if (c.status === 'draft') return false
  if (c.kind === 'master_lease') return false
  if (!c.startDate || !c.endDate) return false
  return c.startDate <= asOf && asOf <= c.endDate
}

export interface PeerRow {
  contractId: number; tenantId: number; tenantName: string; buildingId: number
  phase: number; rentArea: number; monthlyRent: number; unitRent: number   // 元/㎡·月,2 位小数
}

/** 在租、已录面积、能定位到期区的合同 → 单位租金行(同类对标的population)。 */
export function buildPeerRows(contracts: ContractDTO[], phaseOf: Map<number, number>, asOf: string): PeerRow[] {
  const out: PeerRow[] = []
  for (const c of contracts) {
    if (!isInForce(c, asOf)) continue
    if (!(c.rentArea > 0)) continue
    if (!(c.billingLineCount ?? 0)) continue   // 无租金计费行:monthly_rent 里没有租金,不是「便宜」(F1)
    const phase = phaseOf.get(c.buildingId)
    if (phase == null) continue
    out.push({
      contractId: c.id, tenantId: c.tenantId, tenantName: c.tenantName, buildingId: c.buildingId,
      phase, rentArea: c.rentArea, monthlyRent: c.monthlyRent, unitRent: +(c.monthlyRent / c.rentArea).toFixed(2),
    })
  }
  return out
}

/** 某租户的主合同 = 在租行里 id 最小的一份(镜像 TenantService.buildTenantDto 的 primaryBuilding 取法)。 */
export function primaryRowOf(rows: PeerRow[], tenantId: number): PeerRow | null {
  const mine = rows.filter((r) => r.tenantId === tenantId).sort((a, b) => a.contractId - b.contractId)
  return mine[0] ?? null
}

export interface PeerTenantOption { id: number; name: string; phase: number | null }

/** 租户选择器候选:按主合同去重,name 的 zh 排序(与 FPTenantPicker 的候选排序口径一致)。
 *  phase 取 tenantPhaseOf(tenant.phase),不是 row.phase(building.phase)——F4 修复轮1:
 *  两者可能不一致(查库验过:可盈 tenant.phase=1、其主合同所在楼栋 phase=4),而 FPTenantOption.phase
 *  的约定就是 tenant.phase(见 fpTenantPicker.ts 的 toBindOptions),渲染走同一套 PHASE_BADGE。 */
export function eligibleTenants(rows: PeerRow[], tenantPhaseOf: Map<number, number | null>): PeerTenantOption[] {
  const best = new Map<number, PeerRow>()
  for (const r of rows) {
    const cur = best.get(r.tenantId)
    if (!cur || r.contractId < cur.contractId) best.set(r.tenantId, r)
  }
  return [...best.values()]
    .map((r) => ({ id: r.tenantId, name: r.tenantName, phase: tenantPhaseOf.get(r.tenantId) ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

const ZH_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
/** 板上的期区叫法「期区一/期区二/…」,不是既有 PHASES 的「一期/二期/宿舍」那一套——本屏专用。 */
export function phaseZoneLabel(phase: number): string {
  return '期区' + (ZH_NUM[phase - 1] ?? String(phase))
}

/** 同类中严格低于本户的占比(0~100 取整)。 */
export function percentBelow(values: number[], value: number): number {
  if (!values.length) return 0
  const below = values.filter((v) => v < value).length
  return Math.round((below / values.length) * 100)
}

export interface PhaseStats { n: number; p10: number; median: number; p90: number }

/** 同期区分布五数(<20 份不给区间,返回 null——全局约束⑤)。 */
export function phaseStatsOf(values: number[]): PhaseStats | null {
  if (values.length < MIN_SAMPLE) return null
  return { n: values.length, p10: quantile(values, 0.1), median: quantile(values, 0.5), p90: quantile(values, 0.9) }
}

// ── 直方图分箱(4 档等宽 + 溢出档,宽度由数据自己的 p90 算出,不是抄板上的「10」)──
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * mag
}
const HIST_BINS = 4
export interface HistBin { lo: number; hi: number; count: number }
export interface UnitRentHist { bins: HistBin[]; binWidth: number; capHi: number; overflowCount: number; overflowMax: number }

/** binWidth = niceStep(p90/4),capHi = binWidth×4;capHi 及以上落溢出档(板上「7 份 > 40，最高 150」同款)。 */
export function buildUnitRentHist(values: number[], p90: number): UnitRentHist {
  const binWidth = niceStep(p90 / HIST_BINS)
  const capHi = binWidth * HIST_BINS
  const bins: HistBin[] = Array.from({ length: HIST_BINS }, (_, i) => ({ lo: i * binWidth, hi: (i + 1) * binWidth, count: 0 }))
  let overflowCount = 0, overflowMax = 0
  for (const v of values) {
    if (v >= capHi) { overflowCount++; if (v > overflowMax) overflowMax = v; continue }
    bins[Math.min(HIST_BINS - 1, Math.max(0, Math.floor(v / binWidth)))].count++
  }
  return { bins, binWidth, capHi, overflowCount, overflowMax }
}

/** 读数句(≤30 可见字门禁,anaCopyLint.spec.ts):样本不足→闭嘴(不许印百分比,全局约束⑤)。 */
export function unitRentReadout(value: number, values: number[], phase: string): string | null {
  if (values.length < MIN_SAMPLE) return null
  const below = percentBelow(values, value)
  const v = value.toFixed(1)
  if (below >= 50) return `${v}元/㎡·月，高于${phase}${below}%同类`
  const above = Math.round((values.filter((x) => x > value).length / values.length) * 100)
  return `${v}元/㎡·月，低于${phase}${above}%同类`
}

/** 参照系小字(≤28 可见字门禁):样本量 + 分组口径 + 期间,读数句印了 % 必须同卡带这句。 */
export function unitRentRefText(n: number, phase: string, period: string): string {
  return `参照${n}份${phase}、已录面积在租合同·${period}`
}

/** 直方图 ECharts option:value 型 x 轴(能精确摆 markLine),bar 数据 [中心值,份数],
 *  溢出档摆在 capHi+binWidth/2,与常规档同宽(视觉简化,精确数字由脚注文案兜底)。
 *  p10/中位/p90/本户四条 markLine;本户超出图右边界时贴边显示,标签仍写真实值。 */
export function unitRentHistOption(hist: UnitRentHist, stats: PhaseStats, tenantName: string, tenantValue: number): object {
  const { bins, binWidth, capHi, overflowCount } = hist
  const axisMax = capHi + binWidth
  const clamp = (v: number) => Math.min(Math.max(v, 0), axisMax - binWidth * 0.02)
  const barData = [
    ...bins.map((b) => ({ value: [b.lo + binWidth / 2, b.count], itemStyle: { color: '#85B7EB' } })),
    { value: [capHi + binWidth / 2, overflowCount], itemStyle: { color: 'rgba(28,28,28,.25)' } },
  ]
  return {
    grid: { left: 46, right: 24, top: 34, bottom: 34 },
    tooltip: {
      trigger: 'item',
      formatter: (p: { value: [number, number] }) => {
        const x = p.value[0]
        const label = x >= capHi ? `${capHi}+` : `${Math.floor(x / binWidth) * binWidth}~${Math.floor(x / binWidth) * binWidth + binWidth}`
        return `${label} 元/㎡·月<br/>${p.value[1]} 份`
      },
    },
    xAxis: {
      type: 'value', min: 0, max: axisMax, interval: binWidth,
      axisLabel: { formatter: (v: number) => (v === 0 ? '0' : v === binWidth ? String(binWidth) : v === capHi ? `${capHi}+` : '') },
    },
    yAxis: { type: 'value', name: '份数', nameLocation: 'end', nameTextStyle: { fontSize: 11 } },
    series: [{
      type: 'bar', barWidth: 34, data: barData,
      markArea: {
        silent: true, itemStyle: { color: 'rgba(56,138,221,.10)' },
        label: { show: true, position: 'insideTop', color: 'rgba(28,28,28,.5)', fontSize: 11, formatter: '80% 的同类在这段' },
        data: [[{ xAxis: stats.p10 }, { xAxis: stats.p90 }]],
      },
      markLine: {
        silent: true, symbol: 'none',
        lineStyle: { type: 'dashed', color: 'rgba(28,28,28,.45)', width: 1 },
        label: { fontSize: 11, color: 'rgba(28,28,28,.65)' },
        data: [
          { xAxis: clamp(stats.p10), label: { formatter: stats.p10.toFixed(1) } },
          { xAxis: clamp(stats.median), label: { formatter: '中位 ' + stats.median.toFixed(1) } },
          { xAxis: clamp(stats.p90), label: { formatter: stats.p90.toFixed(1) } },
          {
            xAxis: clamp(tenantValue), lineStyle: { color: '#185FA5', width: 2 },
            label: { formatter: `${tenantName} ${tenantValue.toFixed(1)}`, color: '#185FA5' },
          },
        ],
      },
    }],
  }
}

// ── 头部「物业类型」(只为选中租户的主合同查一次计费行,不为整批同类都查) ──
/** 主合同的主导物业类型 = 面积最大的租金行(rent_* feeKey)的 propertyType;无租金行 → null。 */
export function dominantPropertyType(lines: BillingLineDTO[]): PropertyType | null {
  const rentLines = lines.filter((l) => (RENT_KEYS as readonly string[]).includes(l.feeKey))
  if (!rentLines.length) return null
  const best = rentLines.reduce((a, b) => ((b.area ?? 0) > (a.area ?? 0) ? b : a))
  return best.propertyType ?? inferPropertyType(best.feeKey)
}

// ── F2(对抗复查):口径浮层「这批同类物业类型是否单一」那句话,必须由实测的分布驱动 ──
// 改前的缺陷:那句话测的是期区二(17/17 厂房主导,真的是单一类型),却写死渲染在默认打开的
// 期区一(51 份:厂房24/办公14/商铺10/宿舍3,四类,office 均价 32.29 对 factory 21.83——正是
// 那句话矢口否认的"两拨价格")。根子是"验证一个总体的说法,却验的是另一个总体"——
// 修法不是再测一遍期区一重新写死,而是让这句话由「当前渲染中的那批 population」驱动:
// 谁在渲染谁负责举证,换期区、换数据,这句话跟着重算,不会再对不上。
export interface PropertyTypeCount { type: PropertyType; count: number }

/** 统计一批物业类型的分布,按份数降序(同数按类型名排序,输出稳定)。null(未知类型)不计入。 */
export function propertyTypeBreakdown(types: readonly (PropertyType | null)[]): PropertyTypeCount[] {
  const m = new Map<PropertyType, number>()
  for (const t of types) if (t) m.set(t, (m.get(t) ?? 0) + 1)
  return [...m.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
}

/** 口径浮层那句话本身(F2):单一类型时维持原有措辞;>1 类时不许再说"没有第二类物业类型",
 *  按实测分布逐类点出份数,并把"不能排除类型驱动的价格分层"这句话说清楚——breakdown 传空数组
 *  (population 为空,理论上不会走到,上游有 v-if 守卫)时按"未知"兜底,不瞎编一个"全部是"。 */
export function peerPropertyTypeNote(breakdown: PropertyTypeCount[]): string {
  if (breakdown.length <= 1) {
    const only = breakdown[0] ? PROPERTY_TYPE_LABEL[breakdown[0].type] : '未知'
    return `按期区分组、不按物业类型再拆:这批同类解析出的物业类型全部是${only},不存在"类型混杂拖累这张图"这个问题。`
  }
  const parts = breakdown.map((b) => `${PROPERTY_TYPE_LABEL[b.type]}${b.count}份`).join('、')
  return `这批同类的物业类型并非单一(${parts}):不能排除按物业类型分层带来的价格分层,`
    + `本卡仍按期区分组、不按物业类型再拆,读这张图时留意这一点。`
}

// ── T10「哪些期区能给区间」──────────────────────────────────────────────
export interface PhaseTableRow { phase: number; n: number; median: number | null; p10: number | null; p90: number | null }

/** 单个期区一行:中位数不论样本多寡都给(板对自己最薄的期区三/四也是这么做的,见 board-peer.txt
 *  的「样本不足」两行——区间格子写「样本不足」,中位数格子仍有数字);p10/p90 只在 n>=MIN_SAMPLE
 *  时给,不足时留 null,调用方渲染成「样本不足」(全局约束⑤同一条规矩,不是这张卡另起的判据)。 */
export function phaseTableRowOf(phase: number, values: number[]): PhaseTableRow {
  const n = values.length
  const enough = n >= MIN_SAMPLE
  return {
    phase, n,
    median: n ? quantile(values, 0.5) : null,
    p10: enough ? quantile(values, 0.1) : null,
    p90: enough ? quantile(values, 0.9) : null,
  }
}

/** 全部期区一次性给行(不看选中哪个租户——这张卡回答「哪个期区能给区间」,不是某户的位置,
 *  population 与「单位租金对标」卡同一个 buildPeerRows 结果,按期区分组)。 */
export function phaseTableRows(rows: PeerRow[]): PhaseTableRow[] {
  const byPhase = new Map<number, number[]>()
  for (const r of rows) {
    const list = byPhase.get(r.phase)
    if (list) list.push(r.unitRent)
    else byPhase.set(r.phase, [r.unitRent])
  }
  return [...byPhase.keys()].sort((a, b) => a - b).map((p) => phaseTableRowOf(p, byPhase.get(p)!))
}

/** 读数句(≤30 可见字):样本够(能给区间)的期区数 / 总期区数。 */
export function phaseTableReadout(rows: PhaseTableRow[]): string {
  const enough = rows.filter((r) => r.p10 != null).length
  return `${rows.length}个期区中${enough}个样本够，能给区间`
}

/** 参照系小字(≤28 可见字)。 */
export function phaseTableRefText(period: string): string {
  return `按期区分组·在租已录面积含租金合同·${period}`
}

// ── T10「同一招式，用在电费上会翻车」────────────────────────────────────
export interface ElecSpread { period: string; n: number; p10: number; p90: number; max: number }

/** 同一招式套电费:电费 = 附表10 基本+标准+维护电费(同 TenantEnergyView 口径),取全库最新一期,
 *  同名同期多条求和折叠(镜像 TenantEnergy.logic.ts buildTenantRows 的口径,不新起一套)。
 *  不按期区/面积分层,直接园区全量比——这正是本卡要示范的「反例」,不是遗漏。
 *  返回 null:一条 s10 记录都没有(附表10 未导入)。 */
export function latestElecSpread(tenantMap: Map<string, AnalysisS10Row[]>): ElecSpread | null {
  let period = ''
  for (const rs of tenantMap.values()) for (const r of rs) if (r.acctMonth > period) period = r.acctMonth
  const values: number[] = []
  for (const rs of tenantMap.values()) {
    let v = 0, has = false
    for (const r of rs) if (r.acctMonth === period) { v += r.elec; has = true }
    if (has) values.push(v)
  }
  if (!values.length) return null
  return { period, n: values.length, p10: quantile(values, 0.1), p90: quantile(values, 0.9), max: Math.max(...values) }
}

/** 读数句(≤30 可见字):p90 是 p10 的多少倍——用未取整的原始分位数算比值,不用显示用的四舍五入整数
 *  (显示的 p10/p90/最高三个数走 fint 四舍五入,两套数字各自独立,互不绑定)。p10<=0 时倍数没有
 *  意义(除零/趋近无穷),返回 null,调用方按「数据不足」处理。 */
export function elecTrapReadout(spread: ElecSpread): string | null {
  if (!(spread.p10 > 0)) return null
  const ratio = Math.round(spread.p90 / spread.p10)
  return `p90 是 p10 的 ${ratio} 倍，一条带说不清`
}

/** 参照系小字(≤28 可见字)。 */
export function elecTrapRefText(spread: ElecSpread): string {
  return `${spread.n}户附表10电费·${spread.period}`
}
