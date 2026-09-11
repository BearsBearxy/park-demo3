// TenantPeer(租户对标,tenant-peer)纯函数 —— design-boards T8/T9。
// 只做板上「单位租金对标」这一张卡(其余三卡 电费/缴费行为 稿未定义内容,不做,见 TenantPeerView.vue 顶部注释)。
//
// 口径(用户已查库核实,见 .superpowers/sdd/2026-09-11-design-boards/t8-report.md 引用的任务说明):
// · 单位租金 = monthly_rent / rent_area(合同总月租,含管理费/基础维护等五费项合计,不是纯租金单价——
//   这是任务指定口径,与 ContractDTO.unitPrice(五费项之一的租金单价字段)是两回事,不要混用)。
// · 同类分组 = 同期区(building.phase)的在租合同,不按物业类型细分——板上「单位租金对标」这张卡
//   本身就是按期区分组(板上第二张卡「哪些期区能给区间」才逐期区判断是否要按 profile 再拆,那是 T10 的事)。
// · 在租 = 非草稿、非整体承租(master_lease,与散户空间重叠会重复计入)、起止日期都有、asOf 落在闭区间内
//   (镜像后端 ContractService.inForceOn,§5.2)。
import { quantile } from '@/components/ana/anaFmt'
import { RENT_KEYS, type BillingLineDTO, type ContractDTO, type PropertyType, inferPropertyType } from '@/types/contract'

/** 少于本数,不给区间/不给百分比读数(全局约束⑤;板上「样本 < 20 不画带」同一条规矩)。 */
export const MIN_SAMPLE = 20

/** 某日在租(镜像 ContractService.inForceOn):非草稿、非整体承租、起止日期齐全且 asOf 落在闭区间内。 */
export function isInForce(c: ContractDTO, asOf: string): boolean {
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

/** 租户选择器候选:按主合同去重,name 的 zh 排序(与 FPTenantPicker 的候选排序口径一致)。 */
export function eligibleTenants(rows: PeerRow[]): PeerTenantOption[] {
  const best = new Map<number, PeerRow>()
  for (const r of rows) {
    const cur = best.get(r.tenantId)
    if (!cur || r.contractId < cur.contractId) best.set(r.tenantId, r)
  }
  return [...best.values()]
    .map((r) => ({ id: r.tenantId, name: r.tenantName, phase: r.phase }))
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
