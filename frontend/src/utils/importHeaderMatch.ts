/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
// 按表头名字匹配 — 扛真实 Excel:多行表头(租户表头与叶子标签不在同一行)、前置「车间」分类列、
// 尾部「合计/备注」列、小计行、部分叶子标签落在分组行、列乱序。
// 算法:
//  1) 表头块 = 顶部到"最后一个含≥2个费用列标签命中的行"(叶子表头行);
//  2) 逐列扫表头块(跨行)定费用列→key(捕获落在分组行的标签如「其他费用」);
//  3) 租户列 = 非费用列里、数据行"文本(非数字/非空/非小计)"最多的列(故租户表头在别行/数据租户不在首列都能找到);
//  4) 数据行 = 表头块之后、租户列非空且非小计的行;未命中的列(车间/合计/备注/分组)一律忽略。
// 仅供 columnMap 模式;位置映射仍走各屏 parseRow。

export interface ColumnMapEntry { label: string; key: string; text?: boolean; aliases?: string[] }
// __unmatched:opts.keepUnmatched 开启时,该行未匹配列的 表头→原值(BOOK-WORKBENCH-SPEC §4 禁静默丢列)
export interface ImportRec { __preview?: unknown[]; __groups?: Record<string, string>; __unmatched?: Record<string, unknown>; [k: string]: unknown }
// meta:成功时回传 关键列/表头块末行 位置,供调用方(台账拆段公司识别)定位数据行;纯增量,现有调用方不受影响
// unmatched:opts.keepUnmatched 开启时,本 sheet 匹配不上的表头列表(仅有表头文本的列;默认关闭不出现)
export interface MatchResult {
  records: ImportRec[]
  error?: string
  /** 认不出的是哪一层:header = 没有表头行 / key = 找不到关键列(租户、姓名、月份…)/ empty = 表头下没有数据行 */
  errorKind?: 'header' | 'key' | 'empty'
  meta?: { nameCol: number; headerEnd: number }
  unmatched?: { header: string; colIndex: number }[]
  /** 与 records 同序:每条记录来自 matrix 的第几行(0 基),解析器据此给导不了的行写「第 N 行」 */
  rows?: number[]
}

/** 解析时就知道导不了的行(导入弹窗核对页逐行列出,不发给后端)。
 *  row = 读进来的第几行(1 基;文件里没有空行时就是 Excel 行号),cells = 与预览列对齐的原样内容,reason = 大白话原因。
 *  合计行、小计行、空行这类本来就该跳过的不算,照旧静默跳过。 */
export interface BadRow { row: number; cells: string[]; reason: string }

/** 分段导入里一段导不了的原因(大白话,核对页写在那一段上);这一段能导返回 undefined。keyLabel = 关键列叫什么(租户名称 / 姓名) */
export function blockReason(r: Pick<MatchResult, 'records' | 'errorKind'>, keyLabel: string): string | undefined {
  if (r.errorKind === 'header') return '这一段的表头认不出'
  if (r.errorKind === 'key') return `这一段没找到「${keyLabel}」那一列`
  return r.records.length ? undefined : '这一段表头下面没有数据'
}

// 去空格 + 常见分隔/括号标点(不改字符本体),便于宽松匹配。
export function normalizeHeader(s: unknown): string {
  return String(s ?? '').replace(/[\s、，,·．。.（）()【】[\]／/\\\-_]/g, '')
}

function cleanNum(x: unknown): number {
  const v = parseFloat(String(x ?? '').replace(/[, ¥%￥]/g, ''))
  return isNaN(v) ? 0 : v
}

// 是否"数字或空"(空/各种短横线/可解析为数字)
function isNumericOrBlank(v: unknown): boolean {
  const s = String(v ?? '').replace(/[, ¥%￥\s]/g, '')
  if (s === '' || s === '-' || s === '–' || s === '—') return true
  return !isNaN(parseFloat(s)) && /^[-+]?[\d.]+$/.test(s)
}
function isSubtotal(v: string): boolean {
  return /合计|小计|总计/.test(v)
}

// 垃圾租户名(规范§九 v4):纯数字(如「0」伪租户)或以 6 位数字开头(如「202510二期」= 未标「合计」的段合计行)。
// 只供台账/附表10 通路作 opts.skipName 传入;绝不能全局套用——办公水电的关键列是「月份」,纯数字合法。
export const isGarbageTenantName = (n: string): boolean => /^\d+(\.\d+)?$/.test(n) || /^\d{6}/.test(n)

export function matchByHeader(
  matrix: string[][],
  columnMap: ColumnMapEntry[],
  nameLabels: string[],
  groupLabels?: string[],   // 「填充型分组列」(合并/稀疏):按表头名定位,值向下填充,附 rec.__groups[原标签]
  opts?: {
    skipName?: (name: string) => boolean,   // 收行过滤:数据行 name 命中即跳;缺省 = 零行为变化
    keepUnmatched?: boolean,                // 开启:回传未匹配列(unmatched)+ 每行 __unmatched;缺省 = 零行为变化(SPEC §4)
    need?: string[],                        // 表头认不出时点名缺哪几列(如光伏抄表「楼栋」「日期」,md-v2-err);缺省说「没有一行对得上」
  },
): MatchResult {
  // 认不出时的话(大白话,导入弹窗认不出卡照原样写,前面再带上文件名):不说「版面」「关键列」这类叫法
  const fixHead = '对照下面的样子改好表头，再选一次。'
  const missCols = (cols: string[]) => `没找到${cols.map(c => `「${c}」`).join(cols.length === 2 ? '和' : '、')}这${cols.length === 1 ? '一' : cols.length === 2 ? '两' : ` ${cols.length} `}列。${fixHead}`
  const noHeader = opts?.need?.length ? missCols(opts.need) : `没认出表头：没有一行的列名对得上下面的样子。改好表头，再选一次。`
  // 标签按 normalize 后长度降序:前缀命中时「最长匹配标签优先」,防短标签(如 基本)吞掉长列头。
  // aliases(列名别名,如 商铺租金)与主 label 全体参与匹配;模板/预览列仍只用主 label(一条目一列)。
  const labels = columnMap
    .flatMap(c => [c.label, ...(c.aliases ?? [])].map(l => ({ nl: normalizeHeader(l), key: c.key, text: !!c.text })))
    .sort((a, b) => b.nl.length - a.nl.length)
  // 列头 → 命中的列定义:normalize 相等 或 列头以标签为前缀(扛 用电量(千瓦)→用电量 等单位后缀)。
  const matchLabel = (cell: unknown) => {
    const nh = normalizeHeader(cell)
    if (!nh) return undefined
    for (const l of labels) if (nh === l.nl || nh.startsWith(l.nl)) return l
    return undefined
  }

  // 1) 表头块末行 = 最后一个含 ≥2 个费用列标签命中的行(叶子表头行;数据行单元格是数字/租户名/车间,不命中标签)
  let headerEnd = -1
  matrix.forEach((row, ri) => {
    let n = 0
    for (const c of row) if (matchLabel(c)) n++
    if (n >= 2) headerEnd = ri
  })
  if (headerEnd < 0) {
    return { records: [], errorKind: 'header', error: noHeader }
  }

  const width = Math.max(0, ...matrix.map(r => r.length))

  // 2) 逐列扫表头块定费用列(跨行,捕获落在分组行的标签)
  const colKey = new Map<number, string>()
  const textCols = new Set<number>() // 标记为 text 的列:存原始字符串,不 cleanNum
  for (let c = 0; c < width; c++) {
    for (let r = 0; r <= headerEnd; r++) {
      const l = matchLabel(matrix[r]?.[c])
      if (l && !colKey.has(c)) { colKey.set(c, l.key); if (l.text) textCols.add(c); break }
    }
  }
  if (colKey.size < 2) {
    return { records: [], errorKind: 'header', error: noHeader }
  }

  // 2b) 分组列(充电桩类别等合并/稀疏列):按表头名(normalize 相等)在表头块内定位 列→原标签。
  //     不占费用列;值向下填充在数据行循环里做。
  const groupCol = new Map<number, string>()   // 列 → 原始 groupLabel
  if (groupLabels?.length) {
    const gset = new Map(groupLabels.map(g => [normalizeHeader(g), g]))
    for (let c = 0; c < width; c++) {
      if (colKey.has(c)) continue
      for (let r = 0; r <= headerEnd; r++) {
        const orig = gset.get(normalizeHeader(matrix[r]?.[c]))
        if (orig && !groupCol.has(c)) { groupCol.set(c, orig); break }
      }
    }
  }

  // 3) 关键列(行身份:租户/姓名/月份…) 定位:
  //    ① 先按 nameLabels 表头匹配,且该列数据多为非空 → 用它(让"月份"等可能为纯数字的关键列也能定位);
  //    ② 否则按"非费用列里数据行文本(非数字/非空/非小计)最多"兜底(扛"租户表头在别行、数据租户不在表头列"如附表10二期)。
  const dataRows = matrix.slice(headerEnd + 1)
  if (!dataRows.some(r => r.some(c => String(c ?? '').trim() !== ''))) {
    return { records: [], errorKind: 'empty', error: '表头下面没有数据。' }
  }
  const nameSet = new Set(nameLabels.map(normalizeHeader))
  let nameCol = -1
  if (nameSet.size) {
    for (let c = 0; c < width; c++) {
      if (colKey.has(c) || groupCol.has(c)) continue
      let headerHit = false
      for (let r = 0; r <= headerEnd; r++) { if (nameSet.has(normalizeHeader(matrix[r]?.[c]))) { headerHit = true; break } }
      if (!headerHit) continue
      const nonEmpty = dataRows.filter(row => { const v = String(row[c] ?? '').trim(); return v !== '' && !isSubtotal(v) }).length
      if (nonEmpty >= Math.max(1, Math.ceil(dataRows.length * 0.5))) { nameCol = c; break }
    }
  }
  if (nameCol < 0) {
    let bestText = 0
    for (let c = 0; c < width; c++) {
      if (colKey.has(c) || groupCol.has(c)) continue
      let t = 0
      for (const row of dataRows) {
        const v = String(row[c] ?? '').trim()
        if (v && !isNumericOrBlank(v) && !isSubtotal(v)) t++
      }
      if (t > bestText) { bestText = t; nameCol = c }
    }
  }
  if (nameCol < 0) {
    return { records: [], errorKind: 'key', error: missCols([nameLabels[0]]) }
  }

  // 3b) 未匹配列(opts.keepUnmatched,SPEC §4 禁静默丢列):有表头文本、又没被认成
  //     费用列/关键列/分组列的列。表头取表头块内**最后一个**非空单元格 —— 叶子行标签
  //     优先于分组行(「宿舍区租金」不被上层「租金」组名盖掉)。
  const unmatchedCols: { header: string; colIndex: number }[] = []
  if (opts?.keepUnmatched) {
    for (let c = 0; c < width; c++) {
      if (colKey.has(c) || groupCol.has(c) || c === nameCol) continue
      let header = ''
      for (let r = headerEnd; r >= 0; r--) {
        const v = String(matrix[r]?.[c] ?? '').trim()
        if (v) { header = v; break }
      }
      if (header) unmatchedCols.push({ header, colIndex: c })
    }
  }

  // 4) 数据行 → 记录(跳过租户列空/小计行;未命中列忽略)
  //    分组列向下填充:遍历全部数据行(含小计行也吃其组值更新载体),组首有值则更新,空则沿用上一值。
  const records: ImportRec[] = []
  const rowIdx: number[] = []
  const carry = new Map<number, string>()   // groupCol → 上一非空组值
  for (const [k, row] of dataRows.entries()) {
    for (const ci of groupCol.keys()) {
      const gv = String(row[ci] ?? '').trim()
      if (gv && !isSubtotal(gv)) carry.set(ci, gv)
    }
    const name = String(row[nameCol] ?? '').trim()
    if (!name || isSubtotal(name)) continue
    if (opts?.skipName?.(name)) continue
    const rec: ImportRec = { tenantName: name }
    colKey.forEach((key, ci) => { rec[key] = textCols.has(ci) ? String(row[ci] ?? '').trim() : cleanNum(row[ci]) })
    if (groupCol.size) {
      const groups: Record<string, string> = {}
      groupCol.forEach((label, ci) => { groups[label] = carry.get(ci) ?? '' })
      rec.__groups = groups
    }
    rec.__preview = [name, ...columnMap.map(c => (c.text ? rec[c.key] : (rec[c.key] as number)) || '')]
    if (opts?.keepUnmatched) {
      const um: Record<string, unknown> = {}
      for (const u of unmatchedCols) {
        // 同名表头多列:首列优先(unmatched 列表里两列都可见,值层面不让后列静默盖前列)
        if (u.header in um) continue
        um[u.header] = String(row[u.colIndex] ?? '').trim()
      }
      rec.__unmatched = um
    }
    records.push(rec)
    rowIdx.push(headerEnd + 1 + k)
  }
  if (!records.length) {
    return { records: [], errorKind: 'empty', error: '表头下面没有能导的行。' }
  }
  const result: MatchResult = { records, meta: { nameCol, headerEnd }, rows: rowIdx }
  if (opts?.keepUnmatched) result.unmatched = unmatchedCols
  return result
}
