// 租户名建议(纯函数):V105 起服务「未绑定租户问题面板」(FPTenantIssuePanel)与单测。
import { tenantMatchNames } from './tenantAlias'
// 规则:候选 = 库中租户 t 满足 t.companyName.length>=2 且 name 以 t.companyName 开头且严格更长
//      (如「王柱宿舍」命中「王柱」);多个命中取 companyName 最长者;子租户(parentId 非空)不作候选(仅一级关联)。
export function suggestParent(
  name: string,
  tenants: { id: number; companyName: string; parentId?: number | null }[],
): { id: number; companyName: string } | null {
  let best: { id: number; companyName: string } | null = null
  for (const t of tenants) {
    if (t.parentId != null) continue
    if (t.companyName.length < 2) continue
    if (!name.startsWith(t.companyName) || name.length <= t.companyName.length) continue
    if (!best || t.companyName.length > best.companyName.length) best = { id: t.id, companyName: t.companyName }
  }
  return best
}

// 剥常见场所后缀(「王柱宿舍」→「王柱」),供展示提示用;不命中原样返回。
const KNOWN_SUFFIXES = ['宿舍', '商铺', '厂房', '仓库', '车间', '办公室', '门面']
export function stripKnownSuffix(name: string): string {
  for (const s of KNOWN_SUFFIXES) {
    if (name.endsWith(s) && name.length > s.length) return name.slice(0, name.length - s.length)
  }
  return name
}

// ── 问题面板候选(V105 绑定抽屉):对一个未绑定账面名给出可能的档案 ─────────────
// 层级:①正名/别名精确命中(可一键绑定,含退租户——tenantMatchNames 同口径由调用方展开)
//      ②前缀父租户(「王柱宿舍」→「王柱」,复用 suggestParent)
//      ③剥场所后缀命中 ④一字之差(错别字/形近字)。
// ponytail: 不做拼音库——同音字只能靠④的编辑距离近似,命中不了的进「人工处理」文案兜底。
export interface BindCandidate { id: number; name: string; reason: string }
export interface BindSuggestion { auto: BindCandidate | null; candidates: BindCandidate[] }

// 单字符差(等长替换一位,或长度差1的插入/删除)——足够抓「黄路生/黄路升」这类笔误
export function oneCharDiff(a: string, b: string): boolean {
  if (a === b) return false
  if (a.length === b.length) {
    let diff = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false
    return diff === 1
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a]
  if (l.length - s.length !== 1) return false
  let i = 0
  while (i < s.length && s[i] === l[i]) i++
  return s.slice(i) === l.slice(i + 1)
}

export function suggestBind(
  name: string,
  tenants: { id: number; companyName: string; parentId?: number | null; aliases?: string | null; status?: number }[],
): BindSuggestion {
  // 正名+别名展开走 tenantAlias.tenantMatchNames 单一事实源(评审R1:别名规则演进只改一处);
  // 首尾空白 trim 与后端 softIndex 对齐(评审A6)
  const matchSet = (t: { companyName: string; aliases?: string | null }): string[] =>
    tenantMatchNames(t).map(n => n.trim()).filter(Boolean)
  // ① 精确命中(唯一才给 auto;多档命中降级为候选——同名多档必须人工选)
  const exact = tenants.filter(t => matchSet(t).includes(name))
  if (exact.length === 1) {
    const t = exact[0]
    return {
      auto: { id: t.id, name: t.companyName,
        reason: t.status != null && t.status !== 1 ? '档案已有此名(已退租),导入月当时可能仍在租' : '档案名/别名已能对上' },
      candidates: [],
    }
  }
  const candidates: BindCandidate[] = []
  const seen = new Set<number>()
  const push = (t: { id: number; companyName: string }, reason: string) => {
    if (!seen.has(t.id)) { seen.add(t.id); candidates.push({ id: t.id, name: t.companyName, reason }) }
  }
  if (exact.length > 1) for (const t of exact) push(t, '同名多档,需人工确认是哪一户')
  // ② 前缀父租户
  const parent = suggestParent(name, tenants)
  if (parent) push({ id: parent.id, companyName: parent.companyName }, '可能是它的场地/子租户行(名字以其开头)')
  // ③ 剥场所后缀
  const stripped = stripKnownSuffix(name)
  if (stripped !== name)
    for (const t of tenants) if (t.companyName === stripped) push(t, `剥掉「${name.slice(stripped.length)}」后与档案同名`)
  // ④ 一字之差(错别字/同音打错;限 2 字以上防误伤)
  if (name.length >= 2)
    for (const t of tenants) {
      if (seen.has(t.id)) continue
      for (const n of matchSet(t))
        if (n.length >= 2 && oneCharDiff(name, n)) { push(t, `与档案「${n}」仅一字之差,可能是错别字/同音字`); break }
    }
  return { auto: null, candidates: candidates.slice(0, 5) }
}

// ── 未绑定行归组(评审R4:台账/附表10 两屏共用,别各抄一份) ─────────────────────
export interface UnboundRowLike { tenantId: number | null; tenantName: string }
export function groupUnbound<R extends UnboundRowLike>(
  rows: R[],
  totalOf: (r: R) => number,
  where: string,
): { name: string; count: number; total: number; where: string }[] {
  const byName = new Map<string, { count: number; total: number }>()
  for (const r of rows) {
    if (r.tenantId != null) continue
    const g = byName.get(r.tenantName) ?? { count: 0, total: 0 }
    g.count += 1
    g.total += totalOf(r)
    byName.set(r.tenantName, g)
  }
  return [...byName.entries()].map(([name, g]) => ({ name, count: g.count, total: g.total, where }))
}
