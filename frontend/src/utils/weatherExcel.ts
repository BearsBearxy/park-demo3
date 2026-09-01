// 逐小时天气与太阳辐射 CSV 解析(PV-ANALYSIS-SPEC §04)。datashareclub 导出的实测(非预报)逐小时表,
// 一行 = 一个整点。表头按名识别(matchByHeader,含别名与单位后缀前缀匹配);行级校验(时间可识别、辐射≥0)
// 错误逐行报告不整批拦,表头识别失败才整批拦。单测 weatherExcel.spec.ts。
//
// ⚠ 关键列是**时间**,进 nameLabels 而不是 WEATHER_COLUMN_MAP。
//   放进 columnMap 的列不参与关键列竞选(importHeaderMatch.ts:117),两种后果都试过:
//     · 表里恰好只有这 8 列 → 一列不剩,直接「未找到关键列」整批拦(:138);
//     · 表里多一列没映射的(风速/能见度/气压,导出常带) → 那列被选成关键列,**它为空的行在 :167
//       `if (!name) continue` 处被静默丢掉** —— 当日 hours 变少,§07 护栏把整天剔了,一天的辐照凭空消失。
//   后者才是危险的那个:不报错、不留痕。关键列的值一律落在 rec.tenantName 上,不管它叫什么。
import { matchByHeader, type ColumnMapEntry, type ImportRec } from './importHeaderMatch'

export interface WeatherImportError { rowIndex: number; label: string; reason: string }

// 模板列 = 后端契约字段顺序;首列是关键列(与 __preview 的 name-first 对齐)
export const WEATHER_TEMPLATE_COLS = ['日期时间', '天气', '温度', '降水量', '湿度',
                                      '短波太阳辐射', '直射辐射', '散射太阳辐射']

// 时间不在此列 —— 见文件头。7 列 ≥ matchByHeader 要求的 2 列门槛
const WEATHER_COLUMN_MAP: ColumnMapEntry[] = [
  { label: '天气', key: 'weatherTxt', text: true, aliases: ['天气现象', '天气状况'] },
  { label: '温度', key: 'tempC', aliases: ['气温'] },
  { label: '降水量', key: 'precipMm', aliases: ['降水', '雨量'] },
  { label: '湿度', key: 'humidity', aliases: ['相对湿度'] },
  { label: '短波太阳辐射', key: 'ghi', aliases: ['太阳辐射', '总辐射', 'GHI'] },
  { label: '直射辐射', key: 'dni', aliases: ['法向直射辐射', 'DNI'] },
  { label: '散射太阳辐射', key: 'dhi', aliases: ['散射辐射', 'DHI'] },
]

const WEATHER_NAME_LABELS = ['日期时间', '时间', '观测时间', 'datetime']

// ── 整点解析:YYYY-MM-DD HH:mm[:ss] / YYYY/M/D H:mm / 带 T 分隔 / Excel 日期序列(带小数=小时) ──
// 归一成 'YYYY-MM-DD HH:mm'(后端 WeatherService.parseHour 收这个与带秒两种)。
// 只认年在前的写法:'08/01/2026' 在中美两种读法下是不同的日子,猜错等于整批数据错位一个月。
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

function fmt(y: number, mo: number, d: number, h: number, mi: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d))
  // 年域收口 + 真实日校验(2026-02-30 经 Date 溢出会变 3 月 → 判非法)
  if (y < 2000 || y > 2100 || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${y}-${p(mo)}-${p(d)} ${p(h)}:${p(mi)}`
}

export function parseObsTime(cell: unknown): string | null {
  if (cell == null || cell === '') return null
  const s = String(cell).trim()
  const m = s.match(/^(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})\s*日?[ T]+(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (m) return fmt(+m[1], +m[2], +m[3], +m[4], +m[5])
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s)
    if (n > 60 && n < 120000) {
      // 四舍五入到分钟再拆:Excel 序列的小数部分是二进制近似,直接 floor 会把 09:00 变成 08:59
      const ms = Math.round((EXCEL_EPOCH + n * 86400000) / 60000) * 60000
      const d = new Date(ms)
      return fmt(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes())
    }
  }
  return null
}

// ── 导入行解析(纯函数,供 importRegistry customParse) ──────────
// records = 后端 POST /api/weather/import 行契约 {obsTime, weatherTxt, tempC, precipMm, humidity, ghi, dni, dhi}。
// 数值列走 matchByHeader 的 cleanNum:空 → 0。夜间 ghi 本就是 0,所以「空」与「0」在这一层分不开;
// 真有整段缺值的日子会因日累计偏低被 §5.1 的 GHI 阈值整日剔除,不会被当成正常日算进基准。
export function parseWeatherRows(matrix: string[][]): { records: ImportRec[]; errors: WeatherImportError[] } {
  const { records: matched, error } = matchByHeader(matrix, WEATHER_COLUMN_MAP, WEATHER_NAME_LABELS)
  if (error) return { records: [], errors: [{ rowIndex: -1, label: '', reason: error }] }

  const records: ImportRec[] = []
  const errors: WeatherImportError[] = []
  matched.forEach((r, i) => {
    const raw = String(r.tenantName).trim()
    const obsTime = parseObsTime(raw)
    if (!obsTime) {
      errors.push({ rowIndex: i, label: raw, reason: '时间无法识别(需 YYYY-MM-DD HH:mm 或 Excel 日期格)' })
      return
    }
    const ghi = (r.ghi as number) ?? 0
    const dni = (r.dni as number) ?? 0
    const dhi = (r.dhi as number) ?? 0
    if (ghi < 0 || dni < 0 || dhi < 0) {
      errors.push({ rowIndex: i, label: obsTime, reason: '辐射不能为负' })
      return
    }
    const weatherTxt = String(r.weatherTxt ?? '').trim() || undefined
    const tempC = (r.tempC as number) ?? 0
    const precipMm = (r.precipMm as number) ?? 0
    const humidity = (r.humidity as number) ?? 0
    records.push({
      obsTime, weatherTxt, tempC, precipMm, humidity, ghi, dni, dhi,
      __preview: [obsTime, weatherTxt ?? '', tempC, precipMm, humidity, ghi, dni, dhi],
    })
  })
  return { records, errors }
}
