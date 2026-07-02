// 损益附表派生链接(P2-G)— 数据层聚合值 → 序列键 → DERIVE_MAP(spec §2 实证 36 条) → 对照/填入。
// loadDeriveData(year):Promise.allSettled 并行拉 6 源(s10 年聚合/光伏/充电桩7·8/电费energy·basic/
// 办公水电13/工资×12月),统一成 Record<seriesKey,(number|null)[12]>;任一源失败相关键缺失不阻塞(G6)。
// 匹配 = (schedule, normalizeHeader(行标签)) 相等,分组无关(同标签多组各自命中);未映射行不显派生,不猜(G1)。
import { s10Api } from '@/api/s10'
import { pvApi } from '@/api/pv'
import { chargingApi } from '@/api/charging'
import { elecApi } from '@/api/elec'
import { utilitiesApi } from '@/api/utilities'
import { salaryApi } from '@/api/salary'
import { normalizeHeader } from '@/utils/importHeaderMatch'

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

// ── DERIVE_MAP:spec §2 全表 36 条逐条落,不猜不增删 ─────────────────────────
export interface DeriveMapEntry {
  schedule: 's1' | 's2' | 's3' | 's4' | 's5'
  label: string          // normalizeHeader 后的行标签
  series: string
}
const M = (schedule: DeriveMapEntry['schedule'], label: string, series: string): DeriveMapEntry =>
  ({ schedule, label: normalizeHeader(label), series })

export const DERIVE_MAP: DeriveMapEntry[] = [
  // s1 租金损益(1–7)
  M('s1', '一期企业服务费收入', 's10|p1|officeMgmtFee+factoryMgmtFee'),  // 1 证3月
  M('s1', '一期商铺租金收入', 's10|p1|shopRent'),                        // 2 证3月
  M('s1', '一期商铺企业服务费收入', 's10|p1|shopMgmtFee'),               // 3 证3月
  M('s1', '二期租金收入', 's10|p2|factoryRent'),                         // 4 证2月/差2(锚点)
  M('s1', '二期企业服务收入', 's10|p2|factoryMgmtFee'),                  // 5 证2月/差2
  M('s1', '二期商铺收入', 's10|p2|shopRent'),                            // 6 证2月/差2
  M('s1', '二期商铺企业服务收入', 's10|p2|shopMgmtFee'),                 // 7 证2月/差2
  // s2 电费损益(8–18)
  M('s2', '一期基本用电收入', 's10|p1|elecBasic'),                       // 8 证3月
  M('s2', '二期基本用电收入', 's10|p2|elecBasic'),                       // 9 证2月/差2
  M('s2', '一、三期基本用电成本', 'elec|p1|basic|amt'),                  // 10 证12月
  M('s2', '二期基本用电成本', 'elec|p2|basic|amt'),                      // 11 证12月
  M('s2', '一期光伏发电消纳', 'pv|p1|selfAmt'),                          // 12 证12月(光伏发电组)
  M('s2', '一期光伏上网收益', 'pv|p1|gridAmt'),                          // 13 证12月
  M('s2', '一期光伏发电小计', 'pv|p1|self+grid'),                        // 14 证12月
  M('s2', '二期光伏发电消纳', 'pv|p2|selfAmt'),                          // 15 证7月
  M('s2', '二期光伏上网收益', 'pv|p2|gridAmt'),                          // 16 证7月
  M('s2', '二期光伏发电小计', 'pv|p2|self+grid'),                        // 17 证7月
  M('s2', '减：办公室电费', 'office|elecAmt'),                           // 18 证12月
  // s3 水费损益(19–23)
  M('s3', '一期基准水费收入', 's10|p1|waterStd'),                        // 19 证3月
  M('s3', '二期基准水费收入', 's10|p2|waterStd'),                        // 20 证2月/差2
  M('s3', '散租宿舍收入', 's10|p4|waterStd'),                            // 21 证4月
  M('s3', '一期用水维护费', 's10|p1|waterMaint'),                        // 22 证3月
  M('s3', '二期用水维护费', 's10|p2|waterMaint'),                        // 23 证2月/差2
  // s4 其他运管(24–30)
  M('s4', '其中：一期', 's10|p1|infraOffice+infraFactory'),              // 24 基础设施维护费·一期 证3月
  M('s4', '二期', 's10|p2|infraFactory'),                                // 25 基础设施维护费·二期 证2月/差2
  M('s4', '电动车冲电桩收入', 'chg8|fee'),                               // 26 证12月(母册原文「冲」)
  M('s4', '电动车充电桩电费成本', 'chg8|cost'),                          // 27 证12月
  M('s4', '电动车充电桩损益', 'chg8|profit'),                            // 28 证7月/差5
  M('s4', '汽车充电桩电费成本', 'chg7|cost'),                            // 29 证2月/差1
  M('s4', '开票税费及其他税费收入', 's10|p1|landUseTax'),                // 30 证3月
  // s5 费用支出(31–33)
  M('s5', '办公室电费', 'office|elecAmt'),                               // 31 证12月
  M('s5', '办公室水电费合计', 'office|elecAmt'),                         // 32 证11月/差1(elec+water 备选)
  M('s5', '餐补费', 'sal|lunch'),                                        // 33 证2月
  // s2 基准电费组同标签行(34–36):与 12/15/18 同键复用,标签匹配分组无关自然命中
  M('s2', '一期光伏发电消纳', 'pv|p1|selfAmt'),                          // 34 证12月
  M('s2', '二期光伏发电消纳', 'pv|p2|selfAmt'),                          // 35 证7月
  M('s2', '减：办公室电费', 'office|elecAmt'),                           // 36 证12月
]

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
