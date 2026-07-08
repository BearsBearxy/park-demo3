// parkEnergy.logic.ts — ParkEnergyView v2 桑基/板块数据变换纯函数(铁律⑦,单测 parkEnergy.logic.spec.ts)。
// 能量流桑基(spec §二.4):购电 / 光伏消纳 →〔园区电力〕→ 售电(转供) / 办公 / 充电,值=选中期间金额(元)。
// 口径 = v1 金额平衡同款:仅 s10 覆盖月同口径(避免 5 期售电 − 12 期购电的假差额);缺月不补 0。
// 守恒:流入合计 ≡ 流出合计(轧差项按符号落位)——
//   残差 = (购电+光伏消纳) − (售电+办公+充电);≥0 → 流出侧「损耗差额」;
//   <0(真实库即此:售电按转供加价计费,收入>成本)→ 流入侧「转供毛差」。
// 中枢节点「园区电力」使每条边都是真实 SQL 可验数字(不做两源×四汇的比例假分摊)。

// ── 结构化最小输入类型(真实 DTO 为其超集,单测夹具可极小) ──
export interface ElecRowsLike { rows: { acctMonth: string; total: number }[] }
export interface PvRowLike { acctMonth: string; selfAmt: number }
export interface ChargingLike { rows: { acctMonth: string; cost: number }[] }
export interface OfficeLike { rows: { acctMonth: string; elecAmt: number }[] }
export interface S10Like { acctMonth: string; elec: number }

/** 逐月金额行(元;缺数据源 = null,契约头规则同 anaData.EnergyMonth)。 */
export interface AmtMonth {
  ym: string
  buyCost: number | null    // 购电成本(energy+basic 价税合计)
  pvSelfAmt: number | null  // 光伏自消纳金额
  s10Elec: number | null    // 售电(转供)收入(s10 电费)
  officeAmt: number | null  // 办公/三期用电金额(附表13+14 elecAmt)
  chgCost: number | null    // 充电桩购电成本(附表7+8 cost)
}
type AmtKey = Exclude<keyof AmtMonth, 'ym'>

/** 合并各源为目标年逐月金额行(与 anaData.buildEnergyMonths 同构,只取金额侧字段)。 */
export function buildAmtMonths(
  year: number,
  elec: { energy: ElecRowsLike; basic: ElecRowsLike },
  pv: PvRowLike[],
  charging: ChargingLike[],
  office: OfficeLike[],
  s10: S10Like[],
): AmtMonth[] {
  const map = new Map<string, AmtMonth>()
  const prefix = year + '-'
  const add = (ym: string, key: AmtKey, v: number): void => {
    if (!ym.startsWith(prefix)) return
    let m = map.get(ym)
    if (!m) {
      m = { ym, buyCost: null, pvSelfAmt: null, s10Elec: null, officeAmt: null, chgCost: null }
      map.set(ym, m)
    }
    m[key] = (m[key] ?? 0) + v
  }
  for (const r of elec.energy.rows) add(r.acctMonth, 'buyCost', r.total)
  for (const r of elec.basic.rows) add(r.acctMonth, 'buyCost', r.total)
  for (const r of pv) add(r.acctMonth, 'pvSelfAmt', r.selfAmt)
  for (const dto of charging) for (const r of dto.rows) add(r.acctMonth, 'chgCost', r.cost)
  for (const dto of office) for (const r of dto.rows) add(r.acctMonth, 'officeAmt', r.elecAmt)
  for (const r of s10) add(r.acctMonth, 's10Elec', r.elec)
  return [...map.values()].sort((a, b) => a.ym.localeCompare(b.ym))
}

// ── 桑基 ──
export const HUB = '园区电力'
export type BoardKey = 'buy' | 'pvSelf' | 's10' | 'office' | 'chg' | 'residual'
export const BOARD_ZH: Record<BoardKey, string> = {
  buy: '购电成本', pvSelf: '光伏消纳', s10: '售电(转供)收入', office: '办公用电', chg: '充电桩购电', residual: '损耗差额/转供毛差',
}
const NODE_BOARD: Record<string, BoardKey> = {
  购电: 'buy', 光伏消纳: 'pvSelf', '售电(转供)': 's10', 办公: 'office', 充电桩: 'chg', 损耗差额: 'residual', 转供毛差: 'residual',
}

export interface SankeyLink { source: string; target: string; value: number }
export interface SankeyData {
  nodes: { name: string }[]
  links: SankeyLink[]
  residual: number   // 元;<0 = 转供毛差(流入侧)
}

/** 选中期间(调用方给 s10 覆盖月集合)→ 桑基节点/边。s10 无覆盖 → null(空态)。 */
export function buildSankey(months: AmtMonth[], selYms: string[]): SankeyData | null {
  const sel = months.filter((m) => selYms.includes(m.ym))
  const sum = (key: AmtKey): number | null => {
    let s: number | null = null
    for (const m of sel) if (m[key] != null) s = (s ?? 0) + m[key]!
    return s
  }
  const s10 = sum('s10Elec')
  if (s10 == null) return null
  const buy = sum('buyCost') ?? 0
  const pvSelf = sum('pvSelfAmt') ?? 0
  const office = sum('officeAmt') ?? 0
  const chg = sum('chgCost') ?? 0
  const residual = buy + pvSelf - (s10 + office + chg)

  const links: SankeyLink[] = []
  if (buy > 0) links.push({ source: '购电', target: HUB, value: buy })
  if (pvSelf > 0) links.push({ source: '光伏消纳', target: HUB, value: pvSelf })
  if (residual < 0) links.push({ source: '转供毛差', target: HUB, value: -residual })
  if (s10 > 0) links.push({ source: HUB, target: '售电(转供)', value: s10 })
  if (office > 0) links.push({ source: HUB, target: '办公', value: office })
  if (chg > 0) links.push({ source: HUB, target: '充电桩', value: chg })
  if (residual > 0) links.push({ source: HUB, target: '损耗差额', value: residual })

  const names = new Set<string>([HUB])
  for (const l of links) { names.add(l.source); names.add(l.target) }
  return { nodes: [...names].map((name) => ({ name })), links, residual }
}

/** §五策略2 桑基月锚:所选月有 s10 → 该月;否则 ≤所选的最近 s10 月;再无 → 最早 s10 月;全无 → null。
 *  (yms 为升序 s10 覆盖月;回退结果 ≠ 所选月时调用方必须渲染 AnaPeriodBanner,禁静默) */
export function anchorS10Ym(yms: string[], ym: string): string | null {
  if (!yms.length) return null
  if (yms.includes(ym)) return ym
  const le = yms.filter((m) => m <= ym)
  return le.length ? le[le.length - 1] : yms[0]
}

/** ECharts click params(节点或边)→ 板块 key(中枢/未知 → null)。 */
export function boardOfSankeyClick(params: { dataType?: string; name?: string; data?: { source?: string; target?: string } }): BoardKey | null {
  if (params.dataType === 'edge' && params.data) {
    const end = params.data.source === HUB ? params.data.target : params.data.source
    return end ? NODE_BOARD[end] ?? null : null
  }
  return params.name ? NODE_BOARD[params.name] ?? null : null
}

/** 板块月度序列(元):各自有数据月;residual = s10 覆盖月轧差(与桑基同口径)。 */
export function boardSeries(months: AmtMonth[], key: BoardKey): { yms: string[]; values: number[] } {
  const yms: string[] = []
  const values: number[] = []
  for (const m of months) {
    if (key === 'residual') {
      if (m.s10Elec == null) continue
      yms.push(m.ym)
      values.push((m.buyCost ?? 0) + (m.pvSelfAmt ?? 0) - (m.s10Elec ?? 0) - (m.officeAmt ?? 0) - (m.chgCost ?? 0))
    } else {
      const field: AmtKey = key === 'buy' ? 'buyCost' : key === 'pvSelf' ? 'pvSelfAmt' : key === 's10' ? 's10Elec' : key === 'office' ? 'officeAmt' : 'chgCost'
      if (m[field] == null) continue
      yms.push(m.ym)
      values.push(m[field]!)
    }
  }
  return { yms, values }
}
