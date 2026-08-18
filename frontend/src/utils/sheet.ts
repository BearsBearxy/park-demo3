// 全站 Excel 读写的**唯一入口**(METRIC-SOURCE-SPEC §5)。底层 exceljs,懒加载。
// 为什么不是 SheetJS:xlsx@0.18.5 挂着两条 high 级公告(原型污染 GHSA-4r6h-8v6p-xvw6、
// ReDoS GHSA-5pgg-2g8v-p4x9),SheetJS 已停止发布到 npm —— 这个版本**永不修复**,
// `npm audit --omit=dev` 门禁会一直红。exceljs 本来就在(billNoticeExcel 的通知单),复用同一个 chunk。
// 规矩:src/ 生产代码禁止直接 import xlsx —— 门禁就是一条 grep,这行注释也不能带上那个 import 写法。
// xlsx 只降级留在 devDependencies,
// 供 tools/ 的本地迁移脚本读原始册子(含 exceljs 读不了的 .xls 旧格式)。
import { downloadBlob } from './billExcel'

export type Cell = string | number
export interface SheetAoa { name: string; aoa: Cell[][] }

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
// Excel sheet 名禁用字符与 31 字上限(非法名 exceljs 直接抛,SheetJS 只是静默截断)
const sheetName = (s: string) => (s.replace(/[\\/:*?[\]]/g, '').slice(0, 31) || 'sheet')

/**
 * 导出:整本 workbook 一次写完 + 触发浏览器下载。
 * 数字进来是数字、出去还是数字(addRow 不做 toString),空串占位落成空格 —— 与旧 aoa_to_sheet 肉眼一致。
 * 只做纯 AOA:列宽/合并/单元格样式一律不管(21 个导出点一个都没用过)。要版式的走 billNoticeExcel。
 */
export async function writeAoaWorkbook(fileName: string, sheets: SheetAoa[]): Promise<void> {
  const Workbook = (await import('exceljs')).Workbook
  const wb = new Workbook()
  for (const s of sheets) {
    const ws = wb.addWorksheet(sheetName(s.name))
    for (const row of s.aoa) ws.addRow(row)
  }
  const bytes = new Uint8Array(await wb.xlsx.writeBuffer())
  downloadBlob(new Blob([bytes], { type: XLSX_MIME }), fileName)
}

const pad2 = (n: number) => String(n).padStart(2, '0')
// exceljs 把 Excel 日期序列按 UTC 午夜还原,故用 UTC getter —— 用本地 getter 在 UTC- 时区会整体退一天。
const fmtDate = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`

type ValueTypes = typeof import('exceljs').ValueType

// 单元格 → 字符串,复刻 SheetJS `sheet_to_json({raw:false, defval:''})` 的三条语义差:
function cellText(cell: import('exceljs').Cell, VT: ValueTypes): string {
  // ① 合并区从属格:SheetJS 只给左上角、其余空;exceljs 的从属格 .value/.text 会**回主格的值**。
  //    meterExcel 的空行判定吃的就是「合并区续行是空」(那条「区域纵向合并→向下继承」的注释),
  //    不还原成空串,合并区里的空行会整片变成假记录 —— 而且不报错。
  if (cell.type === VT.Merge || cell.type === VT.Null) return ''
  const v = cell.value
  // ② 日期格:cell.text 是 'Thu Feb 01 2024 …GMT+0800',下游(办公水电的月份列)要 'yyyy-mm-dd'。
  if (v instanceof Date) return fmtDate(v)
  // ③ 公式格:取缓存结果。**必须走 cell.result,不能走 cell.value.result**——
  //    exceljs 的 FormulaValue._copyModel(lib/doc/cell.js:749)拷字段用的是真值判断
  //    `if (value) copy[name] = value`,于是 result===0 时整个 result 字段从 cell.value 里消失,
  //    读成空串。而 cell.result(cell.js:260→817)直取 model.result,0 完整保留。
  //    实测一本《二期2023年01月水电费.xlsx》就有 1140 个 0 值公式格踩这条。
  //    为什么是 P0:抄表导入的 cleanNum 把 '' 映射成 null(=漏抄)、'0' 映射成 0。
  //    上月止度=0 的表一旦读成 null,本月用量整行派生成 null,那户的电/水费凭空消失且不报错。
  if (cell.type === VT.Formula) {
    const r = cell.result
    return r instanceof Date ? fmtDate(r) : r == null ? '' : String(r)
  }
  // 数字这里出的是原始数字串(不套 numFmt),比 SheetJS 的显示串更干净:下游 cleanNum 已剥 , ¥ % 空格,
  // 长表编码也不再被渲染成 2.20605E+11 丢有效位。
  return cell.text ?? ''
}

/**
 * 读取:整册 → 每 sheet 一个二维字符串数组(FpImportModal 的下游全按矩阵消费)。
 * 收 ArrayBuffer 而不是 File:调用方本来就走 FileReader,少一层且不吃 jsdom 没实现的 Blob.arrayBuffer。
 * 行/列按 SheetJS 口径归一:补齐成密集行(空洞填 ''),再丢掉整行全空的行(= blankrows:false),
 * 否则 meterExcel.headerRow / importSections 的行扫描会整体错位。
 */
export async function readAoaWorkbook(buf: ArrayBuffer): Promise<{ name: string; matrix: string[][] }[]> {
  const { Workbook, ValueType } = await import('exceljs')
  const wb = new Workbook()
  await wb.xlsx.load(buf)
  return wb.worksheets.map(ws => {
    const width = ws.columnCount
    const matrix: string[][] = []
    ws.eachRow({ includeEmpty: true }, row => {
      const cells: string[] = []
      for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c), ValueType))
      if (cells.some(v => v !== '')) matrix.push(cells)
    })
    return { name: ws.name, matrix }
  })
}
