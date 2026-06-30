// 月份单元格 → {year,month} — 扛办公水电真实文件的多种形态:
//   Excel 序列号(45292)、Date、'YYYY-MM-DD'、'YYYY/M/D'、'YYYY年M月'、'YYYY-MM'、'YYYYMM'(202501)、裸 'M月'/'M'。
// 裸月无年 → 用回退年(卡片年)。聚合/汇总串(2024年/2025年1-9月/小计/合计/总计)→ null(汽车跳过用)。
// 无法识别 → null(调用方收 errors 跳过)。
// 序列号按 Excel epoch 1899-12-30 起算天数换算(吃掉 1900 非闰年 bug:1899-12-30 起算即已对齐)。

export interface YearMonth { year: number; month: number }

const EXCEL_EPOCH = Date.UTC(1899, 11, 30)   // 1899-12-30 UTC,序列号 0 对应日

function fromSerial(n: number): YearMonth | null {
  // 仅当像合理日期序列号(>0 且落在 ~1900-2200)才认;否则可能是裸月号,交后续分支
  if (!(n > 60) || n > 120000) return null
  const d = new Date(EXCEL_EPOCH + Math.floor(n) * 86400000)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}

function ok(year: number, month: number): YearMonth | null {
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null
  return { year, month }
}

// YYYYMM(6 位纯数字,如 202501→2025-01)。仅当 6 位且解析年∈2000-2099、月 1-12 才认;
// 否则非 YYYYMM(交序列号/裸月)。序列号上限 ~73415(2100 年)永不到 6 位,故与序列号无歧义。
function fromYYYYMM(n: number): YearMonth | null {
  if (!Number.isInteger(n) || n < 200001 || n > 209912) return null
  const year = Math.floor(n / 100), month = n % 100
  return ok(year, month)
}

// 聚合/汇总串:含「年」但无「月」或带范围「-月」(2024年/2025年1-9月)、小计/合计/总计 → 非单月,返 null。
function isAggregate(s: string): boolean {
  if (/小计|合计|总计/.test(s)) return true
  if (/年/.test(s) && !/年\s*\d{1,2}\s*月\s*$/.test(s)) return true   // 「2024年」「2025年1-9月」(无单月收尾)
  return false
}

export function parseYearMonth(cell: unknown, fallbackYear?: number): YearMonth | null {
  if (cell == null || cell === '') return null

  if (cell instanceof Date && !isNaN(cell.getTime()))
    return ok(cell.getFullYear(), cell.getMonth() + 1)

  // 纯数字:6 位 YYYYMM;大值=Excel 序列号;小值(1-12)=裸月号(配回退年)
  if (typeof cell === 'number') {
    const ym = fromYYYYMM(cell)
    if (ym) return ym
    const s = fromSerial(cell)
    if (s) return s
    if (fallbackYear != null && cell >= 1 && cell <= 12) return ok(fallbackYear, cell)
    return null
  }

  const s = String(cell).trim()

  // 聚合/汇总串(年/年范围/小计/合计/总计)→ null,调用方跳过并报告
  if (isAggregate(s)) return null

  // YYYY-MM-DD / YYYY/M/D / YYYY.M.D / YYYY年M月[D日] / YYYY-MM
  let m = s.match(/^(\d{4})\s*[-/年.]\s*(\d{1,2})/)
  if (m) return ok(Number(m[1]), Number(m[2]))

  // M/D/YY(YY)(年在末位)— Excel 单元格 m/d/yy 格式经 raw:false 渲染成如 '1/1/24'/'12/1/23'。
  // 日仅占位忽略;首字段>12 视为「日」改用次字段为月(扛 D/M 排列);2 位年补 2000。
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (m) {
    let mon = Number(m[1]); const second = Number(m[2]); let yr = Number(m[3])
    if (yr < 100) yr += 2000
    if (mon > 12 && second <= 12) mon = second
    return ok(yr, mon)
  }

  // 纯数字串:同 number 分支(YYYYMM 或 序列号 或 裸月)
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s)
    const ym = fromYYYYMM(n)
    if (ym) return ym
    const ser = fromSerial(n)
    if (ser) return ser
    if (fallbackYear != null && n >= 1 && n <= 12) return ok(fallbackYear, n)
    return null
  }

  // 裸 'M月' / 'M'(无年)→ 回退年
  m = s.match(/^(\d{1,2})\s*月?$/)
  if (m && fallbackYear != null) return ok(fallbackYear, Number(m[1]))

  return null
}

// ── 自测(node --import tsx 或 vitest 跑 spec;此处保留可运行断言) ──
export function __selfTest() {
  const eq = (a: YearMonth | null, b: YearMonth | null) =>
    JSON.stringify(a) === JSON.stringify(b)
  const cases: [unknown, number | undefined, YearMonth | null][] = [
    [45292, undefined, { year: 2024, month: 1 }],        // 序列号 2024-01-01
    [45658, undefined, { year: 2025, month: 1 }],        // 序列号 2025-01-01
    ['2024-01-01', undefined, { year: 2024, month: 1 }],
    ['2024/1/1', undefined, { year: 2024, month: 1 }],
    ['2024年1月', undefined, { year: 2024, month: 1 }],
    ['2024年12月', undefined, { year: 2024, month: 12 }],
    ['2025-03', undefined, { year: 2025, month: 3 }],
    [new Date(Date.UTC(2024, 5, 1)), undefined, { year: 2024, month: 6 }],
    ['3月', 2025, { year: 2025, month: 3 }],
    ['1/1/24', undefined, { year: 2024, month: 1 }],      // m/d/yy(年末位) 2024-01
    ['12/1/23', undefined, { year: 2023, month: 12 }],    // 所属月份 2023-12
    ['3/1/2024', undefined, { year: 2024, month: 3 }],    // m/d/yyyy
    ['7', 2024, { year: 2024, month: 7 }],
    [5, 2024, { year: 2024, month: 5 }],                  // 裸月号配回退年
    ['乱码', 2025, null],
    ['', undefined, null],
    [null, undefined, null],
    ['13月', 2025, null],                                 // 越界月
    ['1999-01', undefined, null],                         // 越界年
    [202501, undefined, { year: 2025, month: 1 }],        // YYYYMM
    ['202501', undefined, { year: 2025, month: 1 }],
    ['2024年', undefined, null],                          // 聚合串
    ['2025年1-9月', undefined, null],                     // 年范围聚合
    ['小计', undefined, null],
  ]
  for (const [cell, fb, want] of cases) {
    const got = parseYearMonth(cell, fb)
    if (!eq(got, want)) throw new Error(`parseYearMonth(${JSON.stringify(cell)},${fb}) = ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`)
  }
  return true
}
