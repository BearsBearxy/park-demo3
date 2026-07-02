// 派生点扫描工具(P2-G G5 转正)— 读本机真实数据层测试文件 7 份 + 母册附表1–5,
// 用生产解析器建候选序列(单列 + 同 scope 双列组合),对附表全部行做值匹配:
// 命中 = 两侧非空且 |差|≤0.011 的月 ≥2(且非零,防 0⇄0 噪声)。差异月如实计数,不影响命中。
// 用途:用户导入更多真实月份后重跑,发现新派生点 → 扩 pnlDerive.DERIVE_MAP(G5)。
// 真实文件不在本机 → 整套 it.skip;末尾断言匹配行数 ≥30 = 回归护栏(当前 36 点,允许数据增长后变多)。
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { splitSections } from '@/utils/importSections'
import { splitSalarySections } from '@/utils/importSalarySections'
import { importPvSections } from '@/utils/importPvSections'
import { importChargingRows } from '@/utils/importChargingRows'
import { importElecRows } from '@/utils/importElecRows'
import { importPnlSchedule } from '@/utils/importPnlSchedule'
import { matchByHeader, type ColumnMapEntry, type ImportRec } from '@/utils/importHeaderMatch'
import { parseYearMonth } from '@/utils/parseYearMonth'
import { parserProps } from '@/utils/importRegistry'
import { leavesOf } from '@/views/sales-income/layout'
import { PNL_SCHEDULES } from '@/reports/pnlSchedules'

const DIR = 'C:/financial_dashboard/2025全年发生额、预算对比'
const FILES = {
  master: '2025年收入、费用统计（2025.12.31）(1).xlsx',
  s10: '附表10测试.xlsx',
  pv: '光伏发电测试.xlsx',
  chg7: '汽车充电桩测试.xlsx',
  chg8: '电动车充电桩测试.xlsx',
  elec: '电费成本测试.xlsx',
  office: '办公室水电测试.xlsx',
  salary: '工资测试.xlsx',
}
const allExist = Object.values(FILES).every(f => existsSync(join(DIR, f)))
const itReal = allExist ? it : it.skip

const YEAR = 2025
const TOL = 0.011   // 扫描容差(发现工具口径,宽于 compareRow 的 0.005)

// 与 FpImportModal 相同读法(cellDates + raw:false + dateNF)
function readSheet(file: string, re?: RegExp): string[][] {
  const wb = XLSX.read(readFileSync(join(DIR, file)), { type: 'buffer', cellDates: true })
  const name = (re && wb.SheetNames.find(n => re.test(n))) ?? wb.SheetNames[0]
  return XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], {
    header: 1, blankrows: false, defval: '', raw: false, dateNF: 'yyyy-mm-dd',
  }) as string[][]
}

type Series = (number | null)[]
const num = (v: unknown): number => (typeof v === 'number' ? v : parseFloat(String(v ?? '')) || 0)
const mi = (acctMonth: unknown): number => {
  const m = new RegExp(`^${YEAR}-(\\d{2})$`).exec(String(acctMonth ?? ''))
  return m ? Number(m[1]) - 1 : -1
}
function acc(map: Map<string, Series>, key: string, i: number, v: number) {
  if (i < 0 || i > 11) return
  const s = map.get(key) ?? Array(12).fill(null)
  s[i] = (s[i] ?? 0) + v
  map.set(key, s)
}
// 逐月 Σ 非空(全空 → null)
function sumSeries(list: Series[]): Series {
  return Array.from({ length: 12 }, (_, i) => {
    const nn = list.map(s => s[i]).filter((v): v is number => v != null)
    return nn.length ? nn.reduce((a, b) => a + b, 0) : null
  })
}

// ── 各源 → 候选序列(slot 去重镜像导入 upsert:同槽后者替换前者) ──────────────
function buildCandidates(): Map<string, Series> {
  const cand = new Map<string, Series>()

  // s10:拆段 → 前导段(无标题)锚定 2025-01 二期(与母册锚点一致) → slot=(期,年,月) 去重 → phase×colId 月Σ
  const phaseLayouts = {
    office: leavesOf('office').map(l => ({ label: l.label, key: l.colId })),
    factory: leavesOf('factory').map(l => ({ label: l.label, key: l.colId })),
  }
  const s10Cols = [...new Set([...leavesOf('office'), ...leavesOf('factory')].map(l => String(l.colId)))]
  const secs = splitSections(readSheet(FILES.s10), phaseLayouts, ['租户名称', '租户'])
    .map(s => (s.year ? s : { ...s, year: YEAR, month: 1, phase: 2 }))   // 前导段锚定
  const bySlot = new Map(secs.map(s => [`${s.phase}|${s.year}-${s.month}`, s]))
  const s10Phase = new Map<string, Series>()   // `p{n}|{colId}`
  for (const s of bySlot.values()) {
    if (s.year !== YEAR) continue
    for (const r of s.records)
      for (const c of s10Cols)
        if (typeof r[c] === 'number') acc(s10Phase, `p${s.phase}|${c}`, s.month! - 1, r[c] as number)
  }
  const scopeSeries = (scope: string, c: string): Series | undefined => {
    if (scope === 'all') return sumSeriesOrU([1, 2, 3, 4].map(p => s10Phase.get(`p${p}|${c}`)))
    if (scope === 'p1+p4') return sumSeriesOrU([s10Phase.get(`p1|${c}`), s10Phase.get(`p4|${c}`)])
    return s10Phase.get(`${scope}|${c}`)
  }
  function sumSeriesOrU(list: (Series | undefined)[]): Series | undefined {
    const nn = list.filter((s): s is Series => !!s)
    return nn.length ? sumSeries(nn) : undefined
  }
  for (const scope of ['p1', 'p2', 'p3', 'p4', 'p1+p4', 'all']) {
    const withData = s10Cols.filter(c => scopeSeries(scope, c)?.some(v => v != null))
    for (const c of withData) cand.set(`s10|${scope}|${c}`, scopeSeries(scope, c)!)
    for (let i = 0; i < withData.length; i++)         // 双列组合(spec §6:4–5 列组合显式延后)
      for (let j = i + 1; j < withData.length; j++) {
        const [a, b] = [withData[i], withData[j]]
        cand.set(`s10|${scope}|${a}+${b}`, sumSeries([scopeSeries(scope, a)!, scopeSeries(scope, b)!]))
      }
  }

  // pv:拆段 → slot=(期,记账月) 去重 → selfAmt/gridAmt/self+grid × p1/p2/p3/all
  const pvRecs = [...new Map(importPvSections(readSheet(FILES.pv)).sections
    .flatMap(s => s.records).map(r => [`${r.phaseId}|${r.acctMonth}`, r])).values()]
  const pvMap = new Map<string, Series>()
  for (const r of pvRecs) {
    acc(pvMap, `${r.phaseId}|selfAmt`, mi(r.acctMonth), num(r.selfAmt))
    acc(pvMap, `${r.phaseId}|gridAmt`, mi(r.acctMonth), num(r.gridAmt))
  }
  for (const p of ['p1', 'p2', 'p3', 'all']) {
    const part = (f: string) => (p === 'all'
      ? sumSeries(['p1', 'p2', 'p3'].map(q => pvMap.get(`${q}|${f}`) ?? Array(12).fill(null)))
      : pvMap.get(`${p}|${f}`))
    const self = part('selfAmt'); const grid = part('gridAmt')
    if (self?.some(v => v != null)) cand.set(`pv|${p}|selfAmt`, self)
    if (grid?.some(v => v != null)) cand.set(`pv|${p}|gridAmt`, grid)
    if (self && grid) cand.set(`pv|${p}|self+grid`, sumSeries([self, grid]))
  }

  // 充电桩 7/8:cats 硬编码 V19 → slot=(cat,月) 去重 → fee/cost/profit(=fee−cost)
  const CATS: Record<number, { catId: string; name: string }[]> = {
    7: [{ catId: 'wancheng', name: '万城万' }, { catId: 'xiaoju', name: '小桔' }],
    8: [{ catId: 'dingding', name: '叮叮充' }, { catId: 'dianxin', name: '电信' }],
  }
  for (const no of [7, 8] as const) {
    const { records } = importChargingRows(readSheet(no === 7 ? FILES.chg7 : FILES.chg8), no, CATS[no])
    const recs = [...new Map(records.map(r => [`${r.cat}|${r.acctMonth}`, r])).values()]
    const fee: Series = Array(12).fill(null)
    const cost: Series = Array(12).fill(null)
    for (const r of recs) {
      const i = mi(r.acctMonth); if (i < 0) continue
      fee[i] = (fee[i] ?? 0) + num(r.fee)
      cost[i] = (cost[i] ?? 0) + num(r.cost)
    }
    cand.set(`chg${no}|fee`, fee)
    cand.set(`chg${no}|cost`, cost)
    cand.set(`chg${no}|profit`, Array.from({ length: 12 }, (_, i) =>
      (fee[i] == null && cost[i] == null ? null : (fee[i] ?? 0) - (cost[i] ?? 0))))
  }

  // 电费:amt=(qty??demand)×price 按 期/type 月Σ(行=发票行项,无槽去重)
  const elecRes = importElecRows(readSheet(FILES.elec))
  const elecMap = new Map<string, Series>()
  for (const r of elecRes.records ?? [])
    acc(elecMap, `${r.phaseId}|${r.type}`, mi(r.acctMonth), num(r.qty ?? r.demand) * num(r.price))
  for (const t of ['energy', 'basic']) {
    for (const p of ['p1', 'p2', 'p3'])
      if (elecMap.get(`${p}|${t}`)) cand.set(`elec|${p}|${t}|amt`, elecMap.get(`${p}|${t}`)!)
    const all = ['p1', 'p2', 'p3'].map(p => elecMap.get(`${p}|${t}`)).filter((s): s is Series => !!s)
    if (all.length) cand.set(`elec|all|${t}|amt`, sumSeries(all))
  }

  // 办公水电(13):表头匹配 → slot=月 去重 → elecAmt/waterAmt/elec+water
  const OFF = parserProps('office_13') as { columnMap: ColumnMapEntry[]; nameLabels: string[] }
  const offRecs = matchByHeader(readSheet(FILES.office), OFF.columnMap, OFF.nameLabels).records
  const offSlot = new Map<number, ImportRec>()
  for (const r of offRecs) {
    const ym = parseYearMonth(r.tenantName)
    if (ym?.year === YEAR) offSlot.set(ym.month - 1, r)
  }
  const offE: Series = Array(12).fill(null)
  const offW: Series = Array(12).fill(null)
  for (const [i, r] of offSlot) {
    offE[i] = num(r.elecQty) * num(r.elecPrice)
    offW[i] = num(r.waterQty) * num(r.waterPrice)
  }
  cand.set('office|elecAmt', offE)
  cand.set('office|waterAmt', offW)
  cand.set('office|elec+water', sumSeries([offE, offW]))

  // 工资:多月拆段 → slot=(年,月) 去重 → 各数值字段月Σ
  const SAL = parserProps('salary') as { columnMap: ColumnMapEntry[]; nameLabels: string[] }
  const salSecs = splitSalarySections(readSheet(FILES.salary), SAL.columnMap, SAL.nameLabels)
  const salBySlot = new Map(salSecs.filter(s => s.year === YEAR).map(s => [s.month, s]))
  const salFields = SAL.columnMap.filter(c => !c.text).map(c => c.key)
  for (const s of salBySlot.values())
    for (const r of s.records)
      for (const f of salFields) acc(cand as Map<string, Series>, `sal|${f}`, s.month! - 1, num(r[f]))

  // 全空/不足 2 个非零月的序列永不可能命中,先剔(提速+去噪)
  for (const [k, s] of cand)
    if (s.filter(v => v != null && Math.abs(v) > 0.005).length < 2) cand.delete(k)
  return cand
}

describe('deriveSweep — 数据层×损益附表全量派生点扫描(真实文件)', () => {
  itReal('候选序列值匹配(≥2 非零月 ±0.011)→ 匹配行数 ≥30(回归护栏)', () => {
    const cand = buildCandidates()
    const report: string[] = []
    let matched = 0

    for (const config of PNL_SCHEDULES) {
      const { rows } = importPnlSchedule(readSheet(FILES.master, config.sheetRe))
      for (const row of rows) {
        let best: { key: string; hits: number; diffs: number } | null = null
        for (const [key, s] of cand) {
          let hits = 0; let diffs = 0
          for (let i = 0; i < 12; i++) {
            const a = row.m[i]; const b = s[i]
            if (a == null || b == null) continue
            // ponytail: 命中需非零,0⇄0 不算实证;若未来出现真实全零派生行,放宽此处
            if (Math.abs(a - b) <= TOL && Math.abs(a) > 0.005) hits++
            else if (Math.abs(a - b) > TOL) diffs++
          }
          if (hits >= 2 && (!best || hits > best.hits)) best = { key, hits, diffs }
        }
        if (best) {
          matched++
          report.push(`${config.schedule} [${row.groupLabel}] ${row.label} ← ${best.key} (证${best.hits}月${best.diffs ? `/差${best.diffs}` : ''})`)
        }
      }
    }

    console.info(`deriveSweep: ${matched} 行命中派生点\n` + report.join('\n'))
    expect(matched).toBeGreaterThanOrEqual(30)
  }, 120_000)
})
