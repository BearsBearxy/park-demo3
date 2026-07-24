// 一次性验收脚本(vite-node):真解析器跑真文件 → 落 JSON 供 POST /api/contracts/import-full。
// 用法: npx vite-node src/tools/runContractImport.ts -- <xlsx> <out.json>
import * as fs from 'node:fs'
import * as XLSX from 'xlsx'
import { parseContractWorkbook, contractReportCsv } from '@/utils/importContractSummary'

const [file, out] = process.argv.slice(2)
const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: true })
const sheets = wb.SheetNames.map(name => ({
  name,
  matrix: XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], {
    header: 1, blankrows: false, defval: '', raw: false, dateNF: 'yyyy-mm-dd',
  }) as string[][],
}))
console.log('sheets:', sheets.map(s => `${s.name}(${s.matrix.length}行)`).join(' | '))

const res = parseContractWorkbook(sheets)
if (res.error) { console.error('解析失败:', res.error); process.exit(1) }
fs.writeFileSync(out, JSON.stringify({ rows: res.rows }), 'utf8')
fs.writeFileSync(out.replace(/\.json$/, '.report.csv'), contractReportCsv(res.report), 'utf8')

const withTerm = res.rows.filter(r => r.startDate)
console.log(`rows=${res.rows.length} lines=${res.rows.reduce((s, r) => s + r.lines.length, 0)} 有期限=${withTerm.length} 待人工补=${res.rows.length - withTerm.length} errors=${res.errors.length}`)
console.log('待人工补清单:')
res.rows.filter(r => !r.startDate).forEach(r => console.log(`  ${r.phase ?? '?'}期 ${r.tenantName} | ${r.tenantFullName} | termType=${r.termType} | 原文=${r.termText ?? ''}`))
console.log('行级错误:')
res.errors.forEach(e => console.log(`  行${e.rowIndex} ${e.label}: ${e.reason}`))
console.log('报告问题(非空):')
res.report.filter(r => r.issues).forEach(r => console.log(`  ${r.phase} ${r.tenantName}: ${r.issues}`))
for (const k of ['金纳', '银纳', '翔海']) {
  const r = res.rows.find(x => x.tenantName.includes(k) || x.tenantFullName.includes(k))
  console.log(`锚点[${k}]`, JSON.stringify(r && {
    tenantName: r.tenantName, full: r.tenantFullName, phase: r.phase, start: r.startDate, end: r.endDate,
    termType: r.termType, termText: r.termText, tier: r.tierPriceNote,
    segs: [...new Set(r.lines.map(l => l.location))],
    lines: r.lines.map(l => `${l.location}/${l.feeKey}/${l.propertyType}`),
  }))
}
