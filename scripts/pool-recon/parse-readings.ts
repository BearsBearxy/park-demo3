// 抄表读数解析 —— 与导入弹窗(FpImportModal → importRegistry 'meter')同一套前端解析:
// readAoaWorkbook(exceljs 读整册) + parseMeterWorkbook(识别抄表页、拆租户/方位、按名挂 tenantId/buildingId)。
// 只取「标题里读到账期 = 目标月」且期区是一期/二期的段;不传账期兜底值(传了会把「公共电分摊明细」当成电表段)。
// 输出 {rows, fileName} = POST /api/meters/import 的请求体(去掉 UI 用的 __preview),由 PoolReconRunner 走 importRows。
//
// 用法(在 frontend 目录下跑,才能用上 vite.config 的 @ 别名;一册一个进程,整册很吃内存):
//   set NODE_OPTIONS=--max-old-space-size=8192
//   node_modules\.bin\vite-node ..\scripts\pool-recon\parse-readings.ts <xlsx> <master.json> <ym> <out.json>
// master.json = {tenants:[{id,companyName,aliases}], buildings:[{id,name}]}(recon.py 从临时库导出)
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { readAoaWorkbook } from '@/utils/sheet'
import { parseMeterWorkbook, type MeterSheetSection } from '@/utils/meterExcel'

const [xlsx, masterPath, ym, out] = process.argv.slice(2)
if (!xlsx || !masterPath || !ym || !out) {
  console.error('usage: parse-readings.ts <xlsx> <master.json> <ym> <out.json>')
  process.exit(2)
}
const master = JSON.parse(readFileSync(masterPath, 'utf-8'))
const buf = readFileSync(xlsx)
const sheets = await readAoaWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
const res = parseMeterWorkbook(sheets, master)
if (res.error) {
  console.error(res.error)
  process.exit(1)
}
const sections: MeterSheetSection[] = res.sections
  ?? (res.records ? [{ label: '(单段)', records: res.records, ym: res.records[0]?.ym ?? '', ymSource: 'title' }] : [])
const kept = sections.filter(s => s.ymSource === 'title' && s.ym === ym
  && s.records.length && ['p1', 'p2'].includes(String(s.records[0].zone)))
const rows = kept.flatMap(s => s.records).map(r => {
  const { __preview, ...rest } = r as Record<string, unknown>
  return rest
})
writeFileSync(out, JSON.stringify({ rows, fileName: basename(xlsx) }))
console.log(JSON.stringify({
  file: basename(xlsx), rows: rows.length, warning: res.warning ?? null, notice: res.notice ?? null,
  kept: kept.map(s => s.label),
  skipped: sections.filter(s => !kept.includes(s)).map(s => `${s.label} [${s.ymSource}]`),
}))
