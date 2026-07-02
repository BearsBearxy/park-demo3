// 损益附表派生链接(P2-G)— 数据层聚合值 → 序列键 → DERIVE_MAP(spec §2 实证 35 行位) → 对照/填入。
// loadDeriveData(year):Promise.allSettled 并行拉 6 源(s10 年聚合/光伏/充电桩7·8/电费energy·basic/
// 办公水电13/工资×12月),统一成 Record<seriesKey,(number|null)[12]>;任一源失败相关键缺失不阻塞(G6)。
// 匹配 = (schedule, normalizeHeader(行标签)) 相等,分组无关(同标签多组各自命中);未映射行不显派生,不猜(G1)。
// P2-G2:MAP 扩 group(母册分组) + generateMissingRows 生成缺失映射行(缺失判定 group+label 双 normalize)。
import { s10Api } from '@/api/s10'
import { pvApi } from '@/api/pv'
import { chargingApi } from '@/api/charging'
import { elecApi } from '@/api/elec'
import { utilitiesApi } from '@/api/utilities'
import { salaryApi } from '@/api/salary'
import { normalizeHeader } from '@/utils/importHeaderMatch'
import { detectKind } from '@/reports/pnlSchedules'
import type { PnlRowDTO } from '@/types/pnl'

export type DeriveData = Record<string /*seriesKey*/, (number | null)[]>

const EPS = 0.005   // 对照容差(G2)

// acctMonth 'YYYY-MM' → 0-based 月位;非本年/非法 → -1
function monthIdx(acctMonth: unknown, year: number): number {
  const m = /^(\d{4})-(\d{2})$/.exec(String(acctMonth ?? ''))
  if (!m || Number(m[1]) !== year) return -1
  const i = Number(m[2]) - 1
  return i >= 0 && i < 12 ? i : -1
}

// 月位累加(该月无行保持 null,有行从 0 起 Σ)
function acc(data: DeriveData, key: string, i: number, v: number) {
  if (i < 0) return
  const s = (data[key] ??= Array(12).fill(null))
  s[i] = (s[i] ?? 0) + v
}

// 组合键:逐月 Σ 非空侧,双侧空 → null;源键全缺(源失败/无数据)→ 不产键
function combine(data: DeriveData, key: string, parts: string[], op: (vals: (number | null)[]) => number | null) {
  const series = parts.map(p => data[p]).filter(Boolean)
  if (!series.length) return
  data[key] = Array.from({ length: 12 }, (_, i) => op(parts.map(p => data[p]?.[i] ?? null)))
}
const sumOp = (vals: (number | null)[]): number | null => {
  const nn = vals.filter((v): v is number => v !== null)
  return nn.length ? nn.reduce((a, b) => a + b, 0) : null
}
const subOp = ([a, b]: (number | null)[]): number | null =>
  (a === null && b === null ? null : (a ?? 0) - (b ?? 0))

// 按年懒加载入口(缓存由调用方 per year 持有,G6)
export async function loadDeriveData(year: number): Promise<DeriveData> {
  const data: DeriveData = {}
  const jobs: Promise<void>[] = [
    // s10 年聚合:phase→colId→12月Σ 直通 s10|p{n}|{colId}
    s10Api.yearSummary(year).then(dto => {
      for (const [phase, cols] of Object.entries(dto.phases ?? {}))
        for (const [colId, ms] of Object.entries(cols))
          data[`s10|p${phase}|${colId}`] = Array.from({ length: 12 }, (_, i) => ms[i] ?? null)
    }),
    // 光伏:按期聚合 selfAmt/gridAmt
    pvApi.records(year).then(dto => {
      for (const r of dto.rows) {
        const i = monthIdx(r.acctMonth, year)
        acc(data, `pv|${r.phase}|selfAmt`, i, r.selfAmt)
        acc(data, `pv|${r.phase}|gridAmt`, i, r.gridAmt)
      }
    }),
    // 充电桩 7 汽车 / 8 电动车:fee/cost 月 Σ(跨运营商)
    ...([7, 8] as const).map(no => chargingApi.records(no, year).then(dto => {
      for (const r of dto.rows) {
        const i = monthIdx(r.acctMonth, year)
        acc(data, `chg${no}|fee`, i, r.fee)
        acc(data, `chg${no}|cost`, i, r.cost)
      }
    })),
    // 电费成本:amt=(qty??demand)×price 按 期/type 月 Σ
    ...(['energy', 'basic'] as const).map(type => elecApi.records(year, type).then(dto => {
      for (const r of dto.rows) {
        const i = monthIdx(r.acctMonth, year)
        acc(data, `elec|${r.phase}|${type}|amt`, i, (r.qty ?? r.demand ?? 0) * r.price)
      }
    })),
    // 办公水电(附表13):elecAmt/waterAmt 月 Σ(后端已派生 qty×price)
    utilitiesApi.records(13, year).then(dto => {
      for (const r of dto.rows) {
        const i = monthIdx(r.acctMonth, year)
        acc(data, 'office|elecAmt', i, r.elecAmt)
        acc(data, 'office|waterAmt', i, r.waterAmt)
      }
    }),
    // 工资 ×12 月并行:各字段月 Σ(取后端 total;无行月保持 null;MAP 只用 lunch)
    ...Array.from({ length: 12 }, (_, m) => salaryApi.records(year, m + 1).then(dto => {
      if (!dto.rows?.length) return
      for (const [k, v] of Object.entries(dto.total ?? {}))
        if (typeof v === 'number') acc(data, `sal|${k}`, m, v)
    })),
  ]
  await Promise.allSettled(jobs)   // 单源失败 → 相关键缺失,不抛(G6)

  // 组合键 — 仅 MAP 用到的组合,不全量生成
  combine(data, 's10|p1|officeMgmtFee+factoryMgmtFee', ['s10|p1|officeMgmtFee', 's10|p1|factoryMgmtFee'], sumOp)
  combine(data, 's10|p1|infraOffice+infraFactory', ['s10|p1|infraOffice', 's10|p1|infraFactory'], sumOp)
  for (const p of ['p1', 'p2', 'p3']) combine(data, `pv|${p}|self+grid`, [`pv|${p}|selfAmt`, `pv|${p}|gridAmt`], sumOp)
  for (const no of [7, 8]) combine(data, `chg${no}|profit`, [`chg${no}|fee`, `chg${no}|cost`], subOp)
  combine(data, 'office|elec+water', ['office|elecAmt', 'office|waterAmt'], sumOp)
  return data
}

// ── DERIVE_MAP:spec §2 分组全表 35 个 (schedule,group,label) 唯一行位逐条落,不猜不增删 ──
// P2-G2 扩 group(母册分组,normalize 后):原 34–36 同标签重复条目并入各自分组条目——
// 一期/二期光伏发电消纳在 基准电费(供电) 与 光伏发电 两组各一条(同 series),减：办公室电费仅基准电费组一条。
// rawGroup/rawLabel 存母册原文,供 generateMissingRows 生成行落库显示。
export interface DeriveMapEntry {
  schedule: 's1' | 's2' | 's3' | 's4' | 's5'
  group: string          // normalizeHeader 后的母册分组
  label: string          // normalizeHeader 后的行标签
  series: string
  rawGroup: string       // 母册分组原文(生成行 groupLabel)
  rawLabel: string       // 行标签原文(生成行 label)
}
const M = (schedule: DeriveMapEntry['schedule'], group: string, label: string, series: string): DeriveMapEntry =>
  ({ schedule, group: normalizeHeader(group), label: normalizeHeader(label), series, rawGroup: group, rawLabel: label })

export const DERIVE_MAP: DeriveMapEntry[] = [
  // s1 租金损益 · 一期、宿舍(1–3)
  M('s1', '一期、宿舍', '一期企业服务费收入', 's10|p1|officeMgmtFee+factoryMgmtFee'),  // 证3月
  M('s1', '一期、宿舍', '一期商铺租金收入', 's10|p1|shopRent'),                        // 证3月
  M('s1', '一期、宿舍', '一期商铺企业服务费收入', 's10|p1|shopMgmtFee'),               // 证3月
  // s1 · 二期(4–7)
  M('s1', '二期', '二期租金收入', 's10|p2|factoryRent'),                               // 证2月/差2(锚点)
  M('s1', '二期', '二期企业服务收入', 's10|p2|factoryMgmtFee'),                        // 证2月/差2
  M('s1', '二期', '二期商铺收入', 's10|p2|shopRent'),                                  // 证2月/差2
  M('s1', '二期', '二期商铺企业服务收入', 's10|p2|shopMgmtFee'),                       // 证2月/差2
  // s2 电费损益 · 基本用电（供电）(8–11)
  M('s2', '基本用电（供电）', '一期基本用电收入', 's10|p1|elecBasic'),                 // 证3月
  M('s2', '基本用电（供电）', '一、三期基本用电成本', 'elec|p1|basic|amt'),            // 证12月
  M('s2', '基本用电（供电）', '二期基本用电收入', 's10|p2|elecBasic'),                 // 证2月/差2
  M('s2', '基本用电（供电）', '二期基本用电成本', 'elec|p2|basic|amt'),                // 证12月
  // s2 · 基准电费（供电）(12–14):与光伏发电组同标签行复用同 series
  M('s2', '基准电费（供电）', '一期光伏发电消纳', 'pv|p1|selfAmt'),                    // 证12月
  M('s2', '基准电费（供电）', '减：办公室电费', 'office|elecAmt'),                     // 证12月
  M('s2', '基准电费（供电）', '二期光伏发电消纳', 'pv|p2|selfAmt'),                    // 证7月
  // s2 · 光伏发电(15–20)
  M('s2', '光伏发电', '一期光伏发电消纳', 'pv|p1|selfAmt'),                            // 证12月
  M('s2', '光伏发电', '一期光伏上网收益', 'pv|p1|gridAmt'),                            // 证12月
  M('s2', '光伏发电', '一期光伏发电小计', 'pv|p1|self+grid'),                          // 证12月
  M('s2', '光伏发电', '二期光伏发电消纳', 'pv|p2|selfAmt'),                            // 证7月
  M('s2', '光伏发电', '二期光伏上网收益', 'pv|p2|gridAmt'),                            // 证7月
  M('s2', '光伏发电', '二期光伏发电小计', 'pv|p2|self+grid'),                          // 证7月
  // s3 水费损益 · 基准水费(21–23)
  M('s3', '基准水费', '一期基准水费收入', 's10|p1|waterStd'),                          // 证3月
  M('s3', '基准水费', '散租宿舍收入', 's10|p4|waterStd'),                              // 证4月
  M('s3', '基准水费', '二期基准水费收入', 's10|p2|waterStd'),                          // 证2月/差2
  // s3 · 用水维护费(24–25)
  M('s3', '用水维护费', '一期用水维护费', 's10|p1|waterMaint'),                        // 证3月
  M('s3', '用水维护费', '二期用水维护费', 's10|p2|waterMaint'),                        // 证2月/差2
  // s4 其他运管 · 基础设施维护费(26–27)
  M('s4', '基础设施维护费', '其中：一期', 's10|p1|infraOffice+infraFactory'),          // 证3月
  M('s4', '基础设施维护费', '二期', 's10|p2|infraFactory'),                            // 证2月/差2
  // s4 · 电动车充电桩(28–30)
  M('s4', '电动车充电桩', '电动车冲电桩收入', 'chg8|fee'),                             // 证12月(母册原文「冲」)
  M('s4', '电动车充电桩', '电动车充电桩电费成本', 'chg8|cost'),                        // 证12月
  M('s4', '电动车充电桩', '电动车充电桩损益', 'chg8|profit'),                          // 证7月/差5
  // s4 · 汽车充电桩(31)
  M('s4', '汽车充电桩', '汽车充电桩电费成本', 'chg7|cost'),                            // 证2月/差1
  // s4 · 其他费用收入(32)
  M('s4', '其他费用收入', '开票税费及其他税费收入', 's10|p1|landUseTax'),              // 证3月
  // s5 费用支出 · 管理费用(33–35)
  M('s5', '管理费用', '办公室电费', 'office|elecAmt'),                                 // 证12月
  M('s5', '管理费用', '办公室水电费合计', 'office|elecAmt'),                           // 证11月/差1(elec+water 备选)
  M('s5', '管理费用', '餐补费', 'sal|lunch'),                                          // 证2月
]

// 派生映射行判定(P2-G3 J1):静态 (schedule, group, label) ∈ DERIVE_MAP,双 normalize,不依赖派生数据加载
export function isMappedRow(schedule: string, groupLabel: string, label: string): boolean {
  const ng = normalizeHeader(groupLabel)
  const nl = normalizeHeader(label)
  return DERIVE_MAP.some(e => e.schedule === schedule && e.group === ng && e.label === nl)
}

// 行 → 派生序列;未映射 / 序列缺失(源失败或无数据)→ null(该行不显派生)
export function deriveRow(schedule: string, label: string, data: DeriveData): (number | null)[] | null {
  const nl = normalizeHeader(label)
  const hit = DERIVE_MAP.find(e => e.schedule === schedule && e.label === nl)
  return hit ? (data[hit.series] ?? null) : null
}

// 对照三态(G2):仅比两侧非空月;重叠 0 月 → empty(可填入示意);diffMonths 1-based
export interface CompareResult { state: 'ok' | 'diff' | 'empty'; diffMonths: number[] }
export function compareRow(rowM: (number | null)[], derived: (number | null)[]): CompareResult {
  let overlap = 0
  const diffMonths: number[] = []
  for (let i = 0; i < 12; i++) {
    const a = rowM[i] ?? null
    const b = derived[i] ?? null
    if (a === null || b === null) continue
    overlap++
    if (Math.abs(a - b) > EPS) diffMonths.push(i + 1)
  }
  if (!overlap) return { state: 'empty', diffMonths: [] }
  return { state: diffMonths.length ? 'diff' : 'ok', diffMonths }
}

// 填入(G3):只填空单元格(null←派生),已录含真 0 保留;进 draft 由调用方走现有保存
export function fillRow(rowM: (number | null)[], derived: (number | null)[]): (number | null)[] {
  return Array.from({ length: 12 }, (_, i) => rowM[i] ?? derived[i] ?? null)
}

// ── 生成缺失映射行(P2-G2)──────────────────────────────────
// 与 PnlScheduleView 整年保存 payload 行型一致(rowKey r<n> + sortOrder 按最终行序重建)
export type PnlRowSave = PnlRowDTO

// 缺失判定(H2)=(schedule, normalizeHeader(group), normalizeHeader(label)) 无既有行;
// 生成条件(H1)=该 series 本年至少 1 非空月;m=派生原值直写(H3);kind=detectKind(H4)。
// 插位(H4):同分组最后 detail 行后 → 无 detail 则组末行后 → 组不存在则按 MAP 序追加表尾成新组块。
// 返回完整新行序列(既有行+生成行,rowKey/sortOrder 重建即 PUT payload);无可生成 → null。
export function generateMissingRows(
  schedule: string, rows: PnlRowDTO[], data: DeriveData,
): { rows: PnlRowSave[]; added: number } | null {
  const existing = new Set(rows.map(r => `${normalizeHeader(r.groupLabel)}|${normalizeHeader(r.label)}`))
  const after = new Map<number, PnlRowDTO[]>()   // 既有行 idx → 其后插入的生成行
  const tail: PnlRowDTO[] = []                   // 组不存在 → 表尾新组块(MAP 序天然成块)
  let added = 0
  for (const e of DERIVE_MAP) {
    if (e.schedule !== schedule || existing.has(`${e.group}|${e.label}`)) continue
    const series = data[e.series]
    if (!series || series.every(v => v === null)) continue   // 全空不生成噪音行(H1)
    added++
    const row: PnlRowDTO = {
      rowKey: `g${added}`,   // 占位,末尾统一重建
      groupLabel: e.rawGroup,
      label: e.rawLabel,
      kind: detectKind(e.rawLabel),
      note: null,
      m: series.slice(),
      sortOrder: 0,
    }
    let anchor = -1, last = -1
    rows.forEach((r, i) => {
      if (normalizeHeader(r.groupLabel) !== e.group) return
      last = i
      if (r.kind === 'detail') anchor = i
    })
    const at = anchor >= 0 ? anchor : last
    if (at >= 0) {
      const list = after.get(at) ?? []
      list.push(row)
      after.set(at, list)
    } else tail.push(row)
  }
  if (!added) return null
  const out: PnlRowDTO[] = []
  rows.forEach((r, i) => { out.push(r); out.push(...(after.get(i) ?? [])) })
  out.push(...tail)
  return { rows: out.map((r, i) => ({ ...r, rowKey: `r${i + 1}`, sortOrder: i })), added }
}
