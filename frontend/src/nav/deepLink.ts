// src/nav/deepLink.ts — 期间深链协议的唯一出口(SIDEBAR-UX-REDESIGN §4.2)。
// 发链 periodLink(value, { p, co?, extra? }) → { path, query };收链 parsePeriod(query)。
// 收链认三代格式,优先级 p(新)> ym(出账链旧链)> y&m(报表层 / 台账 / 附10 旧链);
// co 认 id | 'all' | 旧 company 名(台账 / 附10 的深链用公司名)。
// 越界不信任地址栏:年 2000..2100 之外整个 null;y&m 的月 1..12 之外只丢月(reportPeriod 既有口径);
// p / ym 的月必须两位补零且合法,否则整个 null(billingPeriod 的 YM 口径)。数组型 query 值取第一个(utils/deepLink 既有口径)。

export interface DeepPeriod {
  year: number
  month: number | null
  /** 公司:id | 'all' | 旧链的公司名 | 无 */
  co: number | 'all' | string | null
}

const str = (v: unknown): string =>
  typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : ''
const pad2 = (n: number) => String(n).padStart(2, '0')
const P = /^(\d{4})(?:-(0[1-9]|1[0-2]))?$/

/** 发链。缺的项不写进 query(空串会被目标屏误读成「给了个空」);extra 的值一律转 string,null / undefined 丢掉。 */
export function periodLink(
  value: string,
  o: { p: string; co?: number | 'all' | string; extra?: Record<string, string | number | boolean | null | undefined> },
): { path: string; query: Record<string, string> } {
  const query: Record<string, string> = { p: o.p }
  if (o.co != null) query.co = String(o.co)
  for (const [k, v] of Object.entries(o.extra ?? {})) if (v != null) query[k] = String(v)
  return { path: '/' + value, query }
}

/** p 的形状:'YYYY-MM';没有月只写年(损益附表 / 年表屏)。 */
export function periodOf(year: number, month: number | null): string {
  return month == null ? String(year) : `${year}-${pad2(month)}`
}

/** 收链。认不出 → null,半个期不塞给屏。 */
export function parsePeriod(q: Record<string, unknown>): DeepPeriod | null {
  let year: number
  let month: number | null
  const p = str(q.p) || str(q.ym)
  if (p) {
    const m = P.exec(p)
    if (!m) return null
    year = +m[1]
    month = m[2] ? +m[2] : null
  } else {
    year = Number(str(q.y))
    const mm = Number(str(q.m))
    month = Number.isInteger(mm) && mm >= 1 && mm <= 12 ? mm : null
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null
  const co = str(q.co)
  const company = str(q.company)
  return { year, month, co: co === 'all' ? 'all' : /^\d+$/.test(co) ? Number(co) : company || null }
}
