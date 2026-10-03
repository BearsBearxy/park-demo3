// 计费参数页「左目录 + 右当前区」的纯逻辑(S21-PARAM-CENTER-SPEC §5.1,2026-10-03 版,画布 10-A~10-G):
// 行 → 区 / 深链落点 / 本月改动计数 / 公摊池·楼栋一对象一行 / 户级例外按户分组 / 格子显示文字。不碰网络。
import type { ParamChangeDTO, ParamRowDTO } from '@/api/params'
import { paramDef } from '@/utils/paramRegistry'

export type Sec = 'changes' | 'park' | 'pool' | 'loss' | 'tenant' | 'pv' | 'fixed'
export const SECS: readonly Sec[] = ['changes', 'park', 'pool', 'loss', 'tenant', 'pv', 'fixed']
export type DataSec = 'park' | 'pool' | 'loss' | 'tenant' | 'pv'

/** 一行(或一条改动)归哪一区:户 → 户级例外;池 → 公摊池;栋 / 表 → 楼栋损耗;光伏判据键 → 光伏;其余(全园 / 期)→ 全园与期级 */
export function secOf(key: string, scope: string): DataSec {
  if (scope.startsWith('tenant:')) return 'tenant'
  if (scope.startsWith('rule:')) return 'pool'
  if (scope.startsWith('building:') || scope.startsWith('meter:')) return 'loss'
  if (key.startsWith('pv_')) return 'pv'
  return 'park'
}

/**
 * 深链落点(画布 10-B 板下半「深链落到哪」五条):
 * rule=池号 → 公摊池那一行(section=monthly 闪加减度数,否则闪分摊基数);section=constant + adopt → 光伏分栋判据;
 * section=loss + building=栋号(+ key=键)→ 楼栋损耗那一栋那一格(楼栋损耗屏点调整度数 / 加点格带);
 * 新区名(section=pool/loss/pv…)直落;旧书签 section=monthly / constant / rule → 全园与期级·每月核对 / ·长期常数 / 楼栋损耗。
 * edit=1 不在这里(只进编辑态,不弹卡)。
 */
export interface Landing { sec: Sec; group?: 'monthly' | 'constant'; rule?: number; building?: number; key?: string }
export function landingOf(q: Record<string, unknown>): Landing {
  const s = typeof q.section === 'string' ? q.section : ''
  if (typeof q.rule === 'string' && /^\d+$/.test(q.rule))
    return { sec: 'pool', rule: Number(q.rule),
      key: typeof q.key === 'string' && (POOL_KEYS as readonly string[]).includes(q.key) ? q.key : s === 'monthly' ? 'extra_qty' : 'coefficient' }
  if (s === 'loss' && typeof q.building === 'string' && /^\d+$/.test(q.building))
    return { sec: 'loss', building: Number(q.building), key: typeof q.key === 'string' ? q.key : '' }
  if (s === 'constant' && typeof q.adopt === 'string') return { sec: 'pv' }
  if ((SECS as readonly string[]).includes(s)) return { sec: s as Sec }
  if (s === 'monthly' || s === 'constant') return { sec: 'park', group: s }
  if (s === 'rule') return { sec: 'loss' }
  return { sec: 'park' }
}

// ── 本月改动(GET /params/changes = 影响本月的改动 + 本月重算):一项 = 一个 (作用域, 键);池结构改动 key 为空,也算那个池的一项 ──
/** 提权授权人(后端 Change.authorizer,2026-10-03 起下发;旧后端没这个字段 → null) */
export const authorizerOf = (c: ParamChangeDTO): string | null => c.authorizer ?? null
/** 日志里迁移写的行 actor = migrate,屏上写「系统」 */
export const whoOf = (c: ParamChangeDTO): string => (c.actor === 'migrate' ? '系统' : c.actor)
export const itemKey = (scope: string, key: string) => `${scope}|${key}`
/** 本页认的改动:注册表里的参数、池结构改动(key 空 + 池作用域)、本月重算。日志里别的屏顺手记的(单元面积 unit:N 之类)不算,也不上屏 */
export const isParamChange = (c: ParamChangeDTO): boolean =>
  c.action === 'recalc' || (!!c.key && !!paramDef(c.key)) || (!c.key && !!c.scope?.startsWith('rule:'))
export interface ChangeStats { items: Set<string>; scopes: Set<string>; times: number; bySec: Record<DataSec, number> }
export function changeStats(list: readonly ParamChangeDTO[]): ChangeStats {
  const edits = list.filter(c => c.action !== 'recalc' && c.scope != null && isParamChange(c))
  const items = new Set(edits.map(c => itemKey(c.scope ?? '', c.key ?? '')))
  const bySec: Record<DataSec, number> = { park: 0, pool: 0, loss: 0, tenant: 0, pv: 0 }
  for (const k of items) { const i = k.indexOf('|'); bySec[secOf(k.slice(i + 1), k.slice(0, i))]++ }
  return { items, scopes: new Set(edits.map(c => c.scope ?? '')), times: edits.length, bySec }
}

// ── 公摊池 / 楼栋损耗:一对象一行,列 = 键 ──
export const POOL_KEYS = ['extra_qty', 'manual_qty', 'coefficient', 'std_add', 'price_override', 'round_scale'] as const
export const LOSS_KEYS = ['loss_adj_qty', 'loss_rate_manual', 'loss_adj_rate', 'loss_variant', 'loss_c_meter', 'loss_head', 'loss_recon'] as const
export interface ObjRow { scope: string; id: number; label: string; cells: Record<string, ParamRowDTO> }
export function objRows(rows: readonly ParamRowDTO[], prefix: 'rule:' | 'building:'): ObjRow[] {
  const m = new Map<string, ObjRow>()
  for (const r of rows) {
    if (!r.scope.startsWith(prefix)) continue
    let o = m.get(r.scope)
    if (!o) m.set(r.scope, (o = { scope: r.scope, id: Number(r.scope.slice(prefix.length)), label: r.scopeLabel, cells: {} }))
    o.cells[r.key] = r
  }
  return [...m.values()]
}

// ── 户级例外:只列该户自己的版本行(rowId 非空;继承上级的不算例外),按户分组,组序 = 后端行序 ──
export interface TenantGroup { scope: string; id: number; name: string; rows: ParamRowDTO[] }
export function tenantGroups(rows: readonly ParamRowDTO[]): TenantGroup[] {
  const m = new Map<string, TenantGroup>()
  for (const r of rows) {
    if (!r.scope.startsWith('tenant:') || r.rowId == null) continue
    let g = m.get(r.scope)
    if (!g) m.set(r.scope, (g = { scope: r.scope, id: Number(r.scope.slice(7)), name: r.scopeLabel.replace(/（户）$/, ''), rows: [] }))
    g.rows.push(r)
  }
  return [...m.values()]
}

// ── 格子文字 ──
/** 本作用域自己设了(命中行就在这一级);继承上级 / 没命中都不算 */
export const own = (r: ParamRowDTO | undefined): boolean => r?.rowId != null
/** 站在本月有生效值(自设或继承) */
export const hit = (r: ParamRowDTO | undefined): boolean => r?.mode != null
/** 「一期 A座」→「A座」;期另起一列 */
export const stripPhase = (s: string) => s.replace(/^[一二三四五六七八九十\d]+期\s?/, '')
/** 池名「一期 A座·三楼西侧·公共用电（池）」→ 位置「A座·三楼西侧」+ 名字「公共用电」 */
export function poolName(label: string): { loc: string; name: string } {
  const s = stripPhase(label.replace(/（池）$/, ''))
  const i = s.lastIndexOf('·')
  return i < 0 ? { loc: '', name: s } : { loc: s.slice(0, i), name: s.slice(i + 1) }
}
/** 值去掉单位尾巴(单位写在表头或旁边小灰字) */
export function bare(r: ParamRowDTO): string {
  const t = r.valueText ?? ''
  return r.unit && t.endsWith(' ' + r.unit) ? t.slice(0, -(r.unit.length + 1)) : t
}
/** 加减度数 / 调整度数:正数带 + */
const SIGNED = new Set(['extra_qty', 'loss_adj_qty'])
/** 楼栋损耗的两根率列按百分数写(0.003 → 0.30%) */
const PCT = new Set(['loss_adj_rate', 'loss_rate_manual'])
/** 对象表(公摊池 / 楼栋损耗)里一格的短文字;没生效值返回 '' */
export function cellText(r: ParamRowDTO | undefined): string {
  if (!r || !hit(r)) return ''
  if (PCT.has(r.key) && r.value != null) return `${(r.value * 100).toFixed(2)}%`
  const t = bare(r)
  if (SIGNED.has(r.key) && (r.value ?? 0) > 0) return `+${t}`
  if (r.key === 'round_scale') return t.replace(/^四舍五入到 (\d) 位$/, '$1 位')
  if (r.key === 'loss_variant') return t.split('（')[0]
  const m = /^并入「(.+)」核算$/.exec(t)
  if (m) return `并入 ${stripPhase(m[1])}`
  const n = /^仅「(.+)」$/.exec(t)
  return n ? n[1] : t
}
/** 版本的短名:仅 2024-02 / 2024-02 起 / 长期(最早那一版) */
export function verLabel(mode: string | null, acctMonth: string): string {
  return mode === 'month' ? `仅 ${acctMonth}` : acctMonth ? `${acctMonth} 起` : '长期'
}
