// 真实数据迁移:清种子后从《2025全年发生额、预算对比》13 个真实 Excel 重建 dev 库。
// 复用前端导入管线的解析配置(parserProps 闭包)与各 API 契约(照抄 importRegistry.run 的调用)。
// 运行: npx vite-node src/tools/realDataMigrate.ts -- <dry|masters|import|verify>
//   dry     只解析全部文件并打印统计,不写库
//   masters 创建公司(台账6家)+楼栋(附表10期区4栋)+租户(附表10∪台账并集)
//   import  导入 13 个文件(附表6/7/8/10/11/12/13 + 损益附表1-5 + 台账2025-01×6公司)
//   verify  各屏 API 抽查
/* eslint-disable no-console */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { parserProps, type ImportCtx } from '@/utils/importRegistry'
import { splitSections } from '@/utils/importSections'
import { splitSalarySections } from '@/utils/importSalarySections'
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { PHASE_LAYOUT } from '@/views/sales-income/layout'
import { lgColumns, FEE_KEYS } from '@/utils/ledgerColumns'
import type { ColumnMapEntry } from '@/utils/importHeaderMatch'

const DIR = 'C:/financial_dashboard/2025全年发生额、预算对比'
const API = 'http://localhost:8181/api'
const MODE = process.argv[process.argv.length - 1]

// ── 通用 ────────────────────────────────────────────────
let token = ''
async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json()) as { code: number; message: string; data: T }
  if (data.code !== 0) throw new Error(`${method} ${path} → code ${data.code}: ${data.message}`)
  return data.data
}
async function login() {
  const res = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  const d = (await res.json()) as { code: number; data: { token: string } }
  if (d.code !== 0) throw new Error('登录失败')
  token = d.data.token
}
// 与 FpImportModal 相同读法(cellDates + raw:false + dateNF)
function readSheet(file: string): string[][] {
  const wb = XLSX.read(readFileSync(join(DIR, file)), { type: 'buffer', cellDates: true })
  return XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], {
    header: 1, blankrows: false, defval: '', raw: false, dateNF: 'yyyy-mm-dd',
  }) as string[][]
}
const cleanNum = (x: unknown): number => { const v = parseFloat(String(x).replace(/[, ¥%]/g, '')); return isNaN(v) ? 0 : v }
type ImportResult = { imported: number; skipped: number; errors: { rowIndex: number; label: string; reason: string }[] }
const fmt = (r: ImportResult) => `导入 ${r.imported} 跳过 ${r.skipped} 错误 ${r.errors.length}${r.errors.length ? ' ← ' + r.errors.slice(0, 3).map(e => `${e.label}:${e.reason}`).join('; ') : ''}`

// ── 台账测试.xlsx bespoke 解析(多公司分段 + 两行表头按名匹配) ──
const LEDGER_TITLE_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月园区费用明细表/
interface LedgerSection {
  year: number; month: number; companyKey: string
  rows: { tenantName: string; fees: Record<string, number>; balancePrev: number; totalCollected: number; note: string | null }[]
}
function parseLedgerFile(matrix: string[][]): LedgerSection[] {
  // label→feeKey 映射来自 lgColumns 单一事实源
  const labelToKey: Record<string, string> = {}
  for (const g of lgColumns(0).groups) for (const c of g.cols) labelToKey[c.label] = c.key
  const titleRows: { ri: number; year: number; month: number }[] = []
  matrix.forEach((r, ri) => {
    const m = r.join('').match(LEDGER_TITLE_RE)
    if (m) titleRows.push({ ri, year: Number(m[1]), month: Number(m[2]) })
  })
  const sections: LedgerSection[] = []
  titleRows.forEach((t, i) => {
    const end = i + 1 < titleRows.length ? titleRows[i + 1].ri : matrix.length
    const block = matrix.slice(t.ri, end)
    const topIdx = block.findIndex(r => r.some(c => String(c).trim() === '租户'))
    const feeIdx = block.findIndex(r => r.some(c => String(c).trim() === '厂房租金'))
    if (topIdx < 0 || feeIdx < 0) return
    const top = block[topIdx].map(c => String(c).trim())
    const fee = block[feeIdx].map(c => String(c).trim())
    const nameCol = top.indexOf('租户')
    const prevCol = top.findIndex(c => /^\d{1,2}月结余$/.test(c))
    const collCol = top.findIndex(c => c === '本月收款')
    const noteCol = top.findIndex(c => c.startsWith('备注'))
    const feeCols: [number, string][] = []
    fee.forEach((label, ci) => { if (labelToKey[label]) feeCols.push([ci, labelToKey[label]]) })
    const rows: LedgerSection['rows'] = []
    let companyKey = ''
    for (let r = feeIdx + 1; r < block.length; r++) {
      const row = block[r]
      const c0 = String(row[0] ?? '').trim()
      if (c0 && !companyKey) companyKey = c0
      const name = String(row[nameCol] ?? '').trim()
      if (!name || /合计|总计|应收/.test(name)) continue
      const fees: Record<string, number> = {}
      for (const k of FEE_KEYS) fees[k] = 0
      for (const [ci, key] of feeCols) fees[key] = cleanNum(row[ci])
      rows.push({
        tenantName: name, fees,
        balancePrev: prevCol >= 0 ? cleanNum(row[prevCol]) : 0,
        totalCollected: collCol >= 0 ? cleanNum(row[collCol]) : 0,
        note: noteCol >= 0 && String(row[noteCol] ?? '').trim() ? String(row[noteCol]).trim() : null,
      })
    }
    // 段内同名租户合并(真实台账同租户多处物业分行记;uk_ledger 每租户每月一行 → 费用/结余/收款累加)
    const byName = new Map<string, LedgerSection['rows'][number]>()
    for (const r of rows) {
      const prev = byName.get(r.tenantName)
      if (!prev) { byName.set(r.tenantName, r); continue }
      for (const k of FEE_KEYS) prev.fees[k] = Math.round((prev.fees[k] + r.fees[k]) * 100) / 100
      prev.balancePrev = Math.round((prev.balancePrev + r.balancePrev) * 100) / 100
      prev.totalCollected = Math.round((prev.totalCollected + r.totalCollected) * 100) / 100
      prev.note = [prev.note, r.note].filter(Boolean).join(';') || null
      console.log(`  [合并] ${companyKey} ${t.year}-${t.month} 重复租户「${r.tenantName}」费用累加`)
    }
    sections.push({ year: t.year, month: t.month, companyKey, rows: [...byName.values()] })
  })
  return sections
}

// ── 各文件解析(复用 registry 解析配置) ─────────────────────
function parseS10() {
  const cfg = parserProps('s10')
  const secs = splitSections(readSheet('附表10测试.xlsx'),
    cfg.phaseLayouts as never, (cfg.nameLabels as string[]) ?? ['租户'])
  // 文件开头存在无标题前导段(FpImportModal 里由用户在汇总屏确认年月期;脚本按证据推断):
  // 年月 = 首个有标题段的年月;期 = 版式推断(office→一期,factory→二期;散租/三期均有标题不会是前导段)
  const firstTitled = secs.find(s => s.year && s.month)
  for (const s of secs) {
    if (s.records.length && !s.year && firstTitled) {
      s.year = firstTitled.year; s.month = firstTitled.month
      s.phase = s.layout === 'office' ? 1 : 2
      console.log(`  [推断] 无标题前导段 → ${s.year}-${s.month} 期${s.phase}(${s.layout}, ${s.records.length} 行)`)
    }
  }
  return secs.filter(s => s.records.length && s.year && s.month && s.phase)
}
function parseCustom(key: string, file: string, ctx: ImportCtx = {}) {
  const cfg = parserProps(key, ctx)
  const parse = cfg.customParse as (m: string[][]) => { records?: ImportRec[]; sections?: { label: string; records: ImportRec[] }[]; error?: string }
  const r = parse(readSheet(file))
  if (r.error) throw new Error(`${file}: ${r.error}`)
  return { records: r.records ?? r.sections?.flatMap(s => s.records) ?? [], ctx }
}
function parseSalary() {
  const cfg = parserProps('salary')
  return splitSalarySections(readSheet('工资测试.xlsx'),
    cfg.columnMap as ColumnMapEntry[], (cfg.nameLabels as string[]) ?? ['姓名'])
}
function parseOffice() {
  // 与 registry office run 相同:按表头名匹配(月份为行身份)
  const cfg = parserProps('office_13')
  // matchByHeader 经由 registry 的 columnMap;这里直接借 salary 同款入口
  return { columnMap: cfg.columnMap as ColumnMapEntry[], nameLabels: (cfg.nameLabels as string[]) ?? ['月份'] }
}

const PNL_FILES: [string, string][] = [
  ['s1', '25年租金损益.xlsx'], ['s2', '25年用电损益.xlsx'], ['s3', '25年用水损益.xlsx'],
  ['s4', '25年运管损益.xlsx'], ['s5', '25年费用支出.xlsx'],
]

// ── dry:解析统计 ────────────────────────────────────────
async function dry() {
  console.log('=== 台账测试 ===')
  const lz = parseLedgerFile(readSheet('台账测试.xlsx'))
  lz.forEach(s => console.log(`  ${s.year}-${s.month} 公司[${s.companyKey}] 租户行 ${s.rows.length}`))
  console.log('=== 附表10 ===')
  const s10 = parseS10()
  s10.forEach(s => console.log(`  ${s.year}-${s.month} 期${s.phase}(${s.layout}) 行 ${s.records.length}`))
  const tenants = collectTenants(s10, lz)
  console.log(`  租户并集: ${tenants.size}(含台账新增 ${[...tenants.values()].filter(t => t.phase == null).length})`)
  console.log('=== 附表6 光伏 ===', parseCustom('pv', '光伏发电测试.xlsx').records.length, '行')
  console.log('=== 附表11 电费 ===', parseCustom('elec', '电费成本测试.xlsx').records.length, '行')
  console.log('=== 附表12 工资 ===')
  parseSalary().forEach(s => console.log(`  ${s.year}-${s.month} 行 ${s.records.length}`))
  {
    const XLSXm = readSheet('办公室水电测试.xlsx')
    const { matchByHeader } = await import('@/utils/importHeaderMatch')
    const o = parseOffice()
    const r = matchByHeader(XLSXm, o.columnMap, o.nameLabels)
    console.log('=== 附表13 办公水电 ===', r.records.length, '行')
  }
  for (const [sch, file] of PNL_FILES) {
    const { importPnlSchedule } = await import('@/utils/importPnlSchedule')
    const r = importPnlSchedule(readSheet(file))
    console.log(`=== 损益 ${sch} ${file} === 年 ${r.year} 行 ${r.rows.length}${r.error ? ' 错误:' + r.error : ''}`)
  }
  // 充电桩需 cats(登录后取)
  await login()
  for (const no of [7, 8] as const) {
    const cats = await call<unknown[]>('GET', `/charging/${no}/cats`)
    const file = no === 7 ? '汽车充电桩测试.xlsx' : '电动车充电桩测试.xlsx'
    const ctx: ImportCtx = { cats }
    const r = parseCustom(`charging_${no}`, file, ctx)
    console.log(`=== 附表${no} 充电桩 === ${r.records.length} 行, 解析告警 ${(ctx._parseErrors ?? []).length}`)
  }
}

// ── masters:公司/楼栋/租户 ──────────────────────────────
function collectTenants(s10: ReturnType<typeof parseS10>, lz: LedgerSection[]) {
  const map = new Map<string, { phase: number | null }>()
  for (const s of s10) for (const r of s.records) {
    const name = String(r.tenantName ?? '').trim()
    if (!name || /合计|总计/.test(name) || /^\d+$/.test(name)) continue
    if (!map.has(name)) map.set(name, { phase: s.phase! })
  }
  for (const s of lz) for (const r of s.rows) {
    if (/^\d+$/.test(r.tenantName)) continue
    if (!map.has(r.tenantName)) map.set(r.tenantName, { phase: null })
  }
  return map
}
async function masters() {
  await login()
  const lz = parseLedgerFile(readSheet('台账测试.xlsx'))
  const s10 = parseS10()
  // 公司:台账 6 段的第0列缩写
  const companies = [...new Set(lz.map(s => s.companyKey).filter(Boolean))]
  for (const name of companies) {
    try { await call('POST', '/companies', { name }); console.log('公司 ✓', name) }
    catch (e) { console.log('公司 ✗', name, (e as Error).message) }
  }
  // 楼栋:附表10 期区 4 类(面积未知留 0)
  const zones: [string, number][] = [['一期', 1], ['二期', 2], ['三期', 3], ['散租宿舍', 4]]
  for (const [name, phase] of zones) {
    try {
      await call('POST', '/buildings', { name, phase, floorCount: 1, totalArea: 0, rentableArea: 0, perFloor: 0, remark: '由附表10期区分类自动创建,面积待补' })
      console.log('楼栋 ✓', name)
    } catch (e) { console.log('楼栋 ✗', name, (e as Error).message) }
  }
  // 租户:附表10 ∪ 台账,期取附表10 段期,businessType 必填占位「未分类」
  const tenants = collectTenants(s10, lz)
  let ok = 0, fail = 0
  for (const [name, meta] of tenants) {
    try {
      await call('POST', '/tenants', { companyName: name, businessType: '未分类', phase: meta.phase ?? undefined, remark: '由真实数据迁移自动创建' })
      ok++
    } catch (e) { fail++; console.log('租户 ✗', name, (e as Error).message) }
  }
  console.log(`租户 ✓ ${ok} / ✗ ${fail} (共 ${tenants.size})`)
}

// ── import:13 文件 ──────────────────────────────────────
const pad2 = (m: number) => String(m).padStart(2, '0')
async function importAll() {
  await login()
  // 附表10(期×月逐段;profile 同 registry run)
  {
    const s10 = parseS10()
    let agg = { imported: 0, skipped: 0, errors: [] as ImportResult['errors'] }
    for (const p of s10) {
      const rows = p.records.map(r => ({ profile: PHASE_LAYOUT[p.phase!], ...r }))
      const res = await call<ImportResult>('POST', '/s10/import', { phase: p.phase, acctMonth: `${p.year}-${pad2(p.month!)}`, rows })
      agg.imported += res.imported; agg.skipped += res.skipped; agg.errors.push(...res.errors)
    }
    console.log('附表10:', fmt(agg))
  }
  // 光伏 / 电费(整表 rows 一次导)
  for (const [key, file, path] of [['pv', '光伏发电测试.xlsx', '/pv/import'], ['elec', '电费成本测试.xlsx', '/elec/import']] as const) {
    const { records } = parseCustom(key, file)
    console.log(key + ':', fmt(await call<ImportResult>('POST', path, { rows: records })))
  }
  // 充电桩 7/8(cats 上下文)
  for (const no of [7, 8] as const) {
    const cats = await call<unknown[]>('GET', `/charging/${no}/cats`)
    const ctx: ImportCtx = { cats }
    const { records } = parseCustom(`charging_${no}`, no === 7 ? '汽车充电桩测试.xlsx' : '电动车充电桩测试.xlsx', ctx)
    const res = await call<ImportResult>('POST', `/charging/${no}/import`, { rows: records })
    console.log(`charging_${no}:`, fmt(res), `(解析告警 ${(ctx._parseErrors ?? []).length})`)
  }
  // 工资(逐月)
  for (const p of parseSalary()) {
    if (!p.year || !p.month) { console.log('salary: 跳过无年月段'); continue }
    const res = await call<ImportResult>('POST', `/salary/import?year=${p.year}&month=${p.month}`, { rows: p.records })
    console.log(`salary ${p.year}-${p.month}:`, fmt(res))
  }
  // 办公水电 附13(按月份行,照抄 registry run 的 byYear→(acctMonth,belongMonth))
  {
    const { matchByHeader } = await import('@/utils/importHeaderMatch')
    const { parseYearMonth } = await import('@/utils/parseYearMonth')
    const o = parseOffice()
    const { records } = matchByHeader(readSheet('办公室水电测试.xlsx'), o.columnMap, o.nameLabels)
    const rows: unknown[] = []
    let skipped = 0
    for (const r of records) {
      const ym = parseYearMonth(r.tenantName as string)
      if (!ym) { skipped++; continue }
      const bm = parseYearMonth(r.belongMonth as string, ym.year)
      rows.push({
        acctMonth: `${ym.year}-${pad2(ym.month)}`,
        belongMonth: bm ? `${bm.year}-${pad2(bm.month)}` : `${ym.year}-${pad2(ym.month)}`,
        elecQty: r.elecQty, elecPrice: r.elecPrice, waterQty: r.waterQty, waterPrice: r.waterPrice,
      })
    }
    const res = await call<ImportResult>('POST', '/utilities/13/import', { rows })
    console.log('office_13:', fmt(res), `(月份无法识别跳过 ${skipped})`)
  }
  // 损益附表 1-5(整年替换,年自动识别)
  {
    const { importPnlSchedule } = await import('@/utils/importPnlSchedule')
    for (const [sch, file] of PNL_FILES) {
      const r = importPnlSchedule(readSheet(file))
      if (r.error) { console.log(`pnl ${sch}: 解析失败 ${r.error}`); continue }
      const y = r.year ?? 2025
      const res = await call<ImportResult>('POST', `/pnl/${sch}/import?year=${y}`, { rows: r.rows })
      console.log(`pnl ${sch} → ${y}:`, fmt(res))
    }
  }
  await importLedger()
}

// 台账(逐公司段:import 费用 → save 补 结余/收款/备注)
async function importLedger() {
  {
    const lz = parseLedgerFile(readSheet('台账测试.xlsx'))
    const companies = await call<{ id: number; name: string }[]>('GET', '/companies')
    const byName = new Map(companies.map(c => [c.name, c.id]))
    for (const sec of lz) {
      const cid = byName.get(sec.companyKey)
      if (!cid) { console.log(`ledger [${sec.companyKey}]: 公司不存在,跳过`); continue }
      const importRows = sec.rows.map(r => ({ tenantName: r.tenantName, ...r.fees }))
      const res = await call<ImportResult>('POST', `/ledger/companies/${cid}/import?year=${sec.year}&month=${sec.month}`, { rows: importRows })
      // 补 balancePrev/totalCollected/note:tenantId 从租户表按名映射(month 端点已改为只回存储行,
      // 全零费用但有结余的行 import 会跳过,须凭租户表映射经 save 落库)
      const allT = await call<{ id: number; companyName: string }[]>('GET', '/tenants')
      const idByName = new Map(allT.map(t => [t.companyName, t.id]))
      const saveRows = sec.rows
        .filter(r => idByName.has(r.tenantName))
        .map(r => ({ tenantId: idByName.get(r.tenantName), balancePrev: r.balancePrev, totalCollected: r.totalCollected, note: r.note, ...r.fees }))
      await call('PUT', `/ledger/companies/${cid}/months/${sec.year}/${sec.month}`, { rows: saveRows })
      console.log(`ledger [${sec.companyKey}] ${sec.year}-${sec.month}:`, fmt(res), `+ save ${saveRows.length} 行补结余/收款`)
    }
  }
}

// ── reports:三大报表(2025年10月文件（拼）.xls,按公司拆段分别入各公司) ──
// 文件里同一公司在各表标签不同(① / ③物业（火炬园） / ③期末余额（帮管好）),按编号①-⑥统一映射;
// 编号↔公司依据:台账文件 6 段顺序(①创显…⑥创燊高) 与 bs 表头括号(③帮管好④一泽⑤积前⑥创燊高)双重印证。
const REPORT_FILE = 'C:/financial_dashboard/2025全年发生额、预算对比/2025年10月文件/2025年10月文件（拼）.xls'
const NUM_MAP: Record<string, string> = { '①': '创显', '②': 'B2', '③': '帮管好', '④': '一泽', '⑤': '积前', '⑥': '创燊高' }
const KNOWN = Object.values(NUM_MAP)
function mapCompany(label: string): string {
  const num = label.match(/[①②③④⑤⑥]/)?.[0]
  if (num) return NUM_MAP[num]
  return KNOWN.find(k => label.includes(k)) ?? label
}
async function importReports() {
  await login()
  const wb = XLSX.read(readFileSync(REPORT_FILE), { type: 'buffer', cellDates: true })
  const sheetOf = (name: string) => XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], {
    header: 1, blankrows: false, defval: '', raw: false, dateNF: 'yyyy-mm-dd',
  }) as string[][]
  const Y = 2025, M = 10
  const { importIncomeStatement } = await import('@/utils/importIncomeStatement')
  const { importBalanceSheet } = await import('@/utils/importBalanceSheet')
  const { importTrialBalance } = await import('@/utils/importTrialBalance')
  const { TB_FIELDS } = await import('@/reports/trialBalance')

  // is:每段 {rowKey,cur,ytd} → cells cur/ytd(照抄 registry report_is.run)
  {
    const r = importIncomeStatement(sheetOf('利润表'))
    if (r.error) throw new Error('利润表: ' + r.error)
    const sections = r.sections.map(s => ({
      companyName: mapCompany(s.label),
      cells: s.records.flatMap(rec => [
        { rowKey: String(rec.rowKey), field: 'cur', amount: Number(rec.cur) || 0 },
        { rowKey: String(rec.rowKey), field: 'ytd', amount: Number(rec.ytd) || 0 },
      ]),
    }))
    sections.forEach(s => console.log(`  is 段 → ${s.companyName}(${s.cells.length / 2} 行)`))
    console.log('利润表:', fmt(await call<ImportResult>('POST', `/reports/is/import?year=${Y}&month=${M}`, { sections })))
  }
  // bs:每段 {rowKey,end} → cells field='end'(照抄 registry report_bs.run)
  {
    const r = importBalanceSheet(sheetOf('资产负债表'))
    if (r.error) throw new Error('资产负债表: ' + r.error)
    const sections = r.sections.map(s => ({
      companyName: mapCompany(s.label),
      cells: s.records.map(rec => ({ rowKey: String(rec.rowKey), field: 'end', amount: Number(rec.end) || 0 })),
    }))
    sections.forEach(s => console.log(`  bs 段 → ${s.companyName}(${s.cells.length} 行)`))
    console.log('资产负债表:', fmt(await call<ImportResult>('POST', `/reports/bs/import?year=${Y}&month=${M}`, { sections })))
  }
  // tb:每张「余额表」sheet=一公司段,accounts+cells 8 字段展开、0 不落库(照抄 registry report_tb.run)
  {
    const sheets = wb.SheetNames.map(name => ({ name, matrix: sheetOf(name) }))
    const r = importTrialBalance(sheets)
    if (r.error) throw new Error('科目余额表: ' + r.error)
    const sections = r.sections.map(s => {
      const accounts: unknown[] = []
      const cells: { rowKey: string; field: string; amount: number }[] = []
      for (const rec of s.records as { account: { rowKey: string }; amounts: Record<string, number> }[]) {
        accounts.push(rec.account)
        for (const f of TB_FIELDS) {
          const v = Number(rec.amounts?.[f.key]) || 0
          if (v !== 0) cells.push({ rowKey: rec.account.rowKey, field: f.key, amount: v })
        }
      }
      return { companyName: mapCompany(s.label), accounts, cells }
    })
    sections.forEach(s => console.log(`  tb 段 → ${s.companyName}(科目 ${s.accounts.length}, 非零格 ${s.cells.length})`))
    console.log('科目余额表:', fmt(await call<ImportResult>('POST', `/reports/tb/import?year=${Y}&month=${M}`, { sections })))
  }
  // 抽查:各公司三表 2025 年份
  const companies = await call<{ id: number; name: string }[]>('GET', '/companies')
  for (const c of companies) {
    const parts: string[] = []
    for (const stmt of ['is', 'bs', 'tb']) {
      const ys = await call<{ year: number; months: number }[]>('GET', `/reports/${stmt}/${c.id}/years`)
      parts.push(`${stmt}:${ys.map(y => `${y.year}×${y.months}月`).join(',') || '空'}`)
    }
    console.log(`  ${c.name} → ${parts.join('  ')}`)
  }
}

// ── link:附表10 租户↔楼栋归属(单元+合同派生) ─────────────
// 归属信号:一期=office 版式 4 组租金列(A座/B-G座/空地/宿舍区);二期=第0列分组(一至四车间/五、六车间);
// 三期/散租宿舍=整期一栋(三期文件内仅「三车间」一个分组,不再细分)。
// 落地机制:每栋按归属租户数重建单元(楼栋此时无合同可删重建),每归属生成一份 active 合同
// (合同号 S10-xxxx,remark 标明派生来源,月租=该租户该栋最新非零月租金,面积/日期留空)。
const PHASE1_GROUPS: { building: string; cols: string[]; rentCols: string[] }[] = [
  { building: '一期 A座', cols: ['officeRent', 'officeMgmtFee'], rentCols: ['officeRent'] },
  { building: '一期 B-G座', cols: ['factoryRent', 'factoryMgmtFee'], rentCols: ['factoryRent'] },
  { building: '一期 空地', cols: ['landRent'], rentCols: ['landRent'] },
  { building: '一期 宿舍区', cols: ['shopRent', 'dormRent', 'dormFacilityFee', 'shopMgmtFee'], rentCols: ['shopRent', 'dormRent'] },
]
const RENT_SUM_COLS = ['officeRent', 'factoryRent', 'landRent', 'shopRent', 'dormRent']
function scanPhase2Groups(): Map<string, string> {
  // 二期段第0列分组向下延续,第1列=租户名
  const m = readSheet('附表10测试.xlsx')
  const T = /(\d{4})\s*年\s*(\d{1,2})\s*月.*?(一期|二期|三期|散租宿舍)/
  const map = new Map<string, string>()
  let inP2 = true   // 文件前导段=1月二期
  let group = ''
  for (const r of m) {
    const t = r.join('').match(T)
    if (t) { inP2 = t[3] === '二期'; group = ''; continue }
    if (!inP2) continue
    const c0 = String(r[0] ?? '').trim()
    if (/车间/.test(c0) && !/合计|总计/.test(c0)) group = c0
    const name = String(r[1] ?? '').trim()
    if (name && group && !/租户|项目|合计|总计/.test(name)) map.set(name, group)
  }
  return map
}
async function link() {
  await login()
  // 每租户每期各租金列的「最新非零值」(来自已导入的 s10 记录,逐月宽表端点聚合)
  type Rec = Record<string, unknown> & { tenantName: string; acctMonth: string }
  const byPhase = new Map<number, Map<string, Rec[]>>()
  for (const phase of [1, 2, 3, 4]) {
    const m = new Map<string, Rec[]>()
    for (let month = 1; month <= 12; month++) {
      const dto = await call<{ recorded: boolean; rows: (Record<string, unknown> & { tenantName: string })[] }>(
        'GET', `/s10/${phase}/2025/${month}`)
      if (!dto.recorded) continue
      for (const r of dto.rows) {
        if (/^\d/.test(r.tenantName)) continue   // 段标题残行(202506三期)/纯数字垃圾
        const arr = m.get(r.tenantName) ?? []
        arr.push({ ...r, acctMonth: `2025-${pad2(month)}` } as Rec); m.set(r.tenantName, arr)
      }
    }
    byPhase.set(phase, m)
  }
  const latestVal = (rows: Rec[], cols: string[]) => {
    const sorted = [...rows].sort((a, b) => b.acctMonth.localeCompare(a.acctMonth))
    for (const r of sorted) {
      const v = cols.reduce((s, c) => s + (Number(r[c]) || 0), 0)
      if (v > 0) return Math.round(v * 100) / 100
    }
    return 0
  }
  // 归属派生
  const p2group = scanPhase2Groups()
  const assoc: { tenantName: string; building: string; rent: number }[] = []
  let p1NoSignal = 0
  for (const [name, rows] of byPhase.get(1) ?? []) {
    let hit = false
    for (const g of PHASE1_GROUPS) {
      if (latestVal(rows, g.cols) > 0) { assoc.push({ tenantName: name, building: g.building, rent: latestVal(rows, g.rentCols) }); hit = true }
    }
    if (!hit) p1NoSignal++
  }
  for (const [name, rows] of byPhase.get(2) ?? []) {
    const g = p2group.get(name)
    const building = g === '五、六车间' ? '二期 五、六车间' : '二期 一至四车间'
    assoc.push({ tenantName: name, building, rent: latestVal(rows, RENT_SUM_COLS) })
  }
  for (const [name, rows] of byPhase.get(3) ?? []) assoc.push({ tenantName: name, building: '三期', rent: latestVal(rows, RENT_SUM_COLS) })
  for (const [name, rows] of byPhase.get(4) ?? []) assoc.push({ tenantName: name, building: '散租宿舍', rent: latestVal(rows, RENT_SUM_COLS) })
  const perBuilding = new Map<string, typeof assoc>()
  for (const a of assoc) { const arr = perBuilding.get(a.building) ?? []; arr.push(a); perBuilding.set(a.building, arr) }
  for (const [b, list] of perBuilding) console.log(`  ${b}: ${list.length} 户(有租金 ${list.filter(x => x.rent > 0).length})`)
  console.log(`  一期无列信号跳过 ${p1NoSignal} 户;归属合计 ${assoc.length}`)
  if (process.env.DRY) return

  // 清垃圾租户(202xxx 段标题残行,无合同/台账可直删)
  const tenants = await call<{ id: number; companyName: string }[]>('GET', '/tenants')
  for (const t of tenants) {
    if (/^\d/.test(t.companyName)) {
      await call('DELETE', `/tenants/${t.id}`).catch(e => console.log('垃圾租户删除失败', t.companyName, (e as Error).message))
      console.log('  垃圾租户 ✓ 删', t.companyName)
    }
  }
  const tenantId = new Map((await call<{ id: number; companyName: string }[]>('GET', '/tenants')).map(t => [t.companyName, t.id]))
  // 重建楼栋(带 N 个单元,unit_no=101..;N>99 分层),再逐归属建合同
  const buildings = await call<{ id: number; name: string; phase: number }[]>('GET', '/buildings')
  let seq = 0
  for (const [bname, list] of perBuilding) {
    const old = buildings.find(b => b.name === bname)
    if (!old) { console.log(`  楼栋缺失跳过: ${bname}`); continue }
    const n = list.length
    await call('DELETE', `/buildings/${old.id}`)
    const created = await call<{ id: number }>('POST', '/buildings', {
      name: bname, phase: old.phase, floorCount: Math.max(1, Math.ceil(n / 99)), perFloor: Math.min(n, 99),
      totalArea: 0, rentableArea: 0, remark: '由附表10分类自动创建;单元=归属租户数,面积待补',
    })
    const detail = await call<{ units: { id: number }[] }>('GET', `/buildings/${created.id}`)
    let ok = 0, fail = 0
    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      const tid = tenantId.get(a.tenantName)
      const uid = detail.units[i]?.id
      if (!tid) { fail++; console.log('  合同 ✗ 无租户', a.tenantName); continue }
      seq++
      try {
        await call('POST', '/contracts', {
          contractNo: `S10-${String(seq).padStart(4, '0')}`, tenantId: tid, buildingId: created.id,
          unitId: uid, rentArea: 0, monthlyRent: a.rent, deposit: 0, status: 'active',
          remark: '由附表10归属派生(月租=最新非零月值)',
        })
        ok++
      } catch (e) { fail++; console.log('  合同 ✗', a.tenantName, (e as Error).message) }
    }
    console.log(`  ${bname}: 楼栋重建+${detail.units.length} 单元, 合同 ✓${ok} ✗${fail}`)
  }
}

// ── verify:抽查 ─────────────────────────────────────────
async function verify() {
  await login()
  const companies = await call<{ id: number; name: string }[]>('GET', '/companies')
  console.log('公司:', companies.map(c => c.name).join(' / '))
  console.log('楼栋:', (await call<unknown[]>('GET', '/buildings')).length, '栋')
  console.log('租户:', (await call<unknown[]>('GET', '/tenants')).length, '户')
  for (const c of companies) {
    console.log(`台账年份 [${c.name}]:`, JSON.stringify(await call('GET', `/ledger/companies/${c.id}/years`)))
  }
  console.log('s10 概览:', JSON.stringify(await call('GET', '/s10/overview')).slice(0, 200))
  for (const p of ['pv/overview', 'elec/overview', 'charging/7/overview', 'charging/8/overview', 'utilities/overview', 'salary/overview']) {
    console.log(p + ':', JSON.stringify(await call('GET', '/' + p)).slice(0, 160))
  }
  for (const [sch] of PNL_FILES) {
    const y = await call<{ rows?: unknown[] } | { records?: unknown[] }>('GET', `/pnl/${sch}/2025`)
    const n = (y as { rows?: unknown[] }).rows?.length ?? '?'
    console.log(`pnl ${sch} 2025: ${n} 行`)
  }
}

const main = { dry, masters, import: importAll, ledger: async () => { await login(); await importLedger() }, reports: importReports, link, verify }[MODE]
if (!main) { console.error('用法: vite-node src/tools/realDataMigrate.ts -- <dry|masters|import|verify>'); process.exit(1) }
main().then(() => console.log('DONE ' + MODE)).catch(e => { console.error('FAILED:', e); process.exit(1) })
