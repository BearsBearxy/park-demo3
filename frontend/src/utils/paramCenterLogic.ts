// 计费参数页纯逻辑(S21-PARAM-CENTER-SPEC §5):四区分组 / 生效区间徽标 / 页面禁词 / 状态条文案 /
// 复制上月电价键集。行数据 = 后端 GET /api/params 的 ParamRowDTO(人话解析在后端),本文件不碰网络。
// paramCenterLogic.spec.ts 锁定。
import type { ParamPutReq, ParamRowDTO, ParamStatusDTO } from '@/api/params'
import { LOSS_BASE_FORM_B_TEMPLATE, PARAM_DEFS, writePlan, type ParamMode } from './paramRegistry'

export type ParamRow = ParamRowDTO
export type ParamStatus = ParamStatusDTO

// ── ① ② ③ ④ 四区分配:tenant: 作用域行一律归 ④(键主场是常数的户级例外也在 ④,spec §3.4);
//    其余按键的 group;③ 核算口径按作用范围(栋/期)折叠,组顺序按首现 ──
export interface RuleGroup { scopeLabel: string; rows: ParamRow[] }
export interface GroupedRows { monthly: ParamRow[]; constant: ParamRow[]; rule: RuleGroup[]; tenant: ParamRow[] }

export function groupRows(rows: ParamRow[]): GroupedRows {
  const out: GroupedRows = { monthly: [], constant: [], rule: [], tenant: [] }
  const ruleByLabel = new Map<string, RuleGroup>()
  for (const r of rows) {
    if (r.scope.startsWith('tenant:') || r.group === 'tenant') { out.tenant.push(r); continue }
    if (r.group === 'rule') {
      let g = ruleByLabel.get(r.scopeLabel)
      if (!g) { g = { scopeLabel: r.scopeLabel, rows: [] }; ruleByLabel.set(r.scopeLabel, g); out.rule.push(g) }
      g.rows.push(r)
      continue
    }
    out[r.group].push(r)
  }
  return out
}

// ── 生效区间徽标三态(spec §5.2):month=仅 X 月 / from=X 起长期·区间·初始版本 / inherit=无命中行(默认语义) ──
// 文案一律取后端 rangeText(右端由下一版本推出,前端不算);无命中且后端未给文案 → 「未设置」。
export type RangeTone = 'month' | 'from' | 'inherit'
export function rangeBadge(r: ParamRow): { text: string; tone: RangeTone } {
  const tone: RangeTone = r.mode === 'month' ? 'month' : r.mode === 'from' ? 'from' : 'inherit'
  return { text: r.rangeText || (tone === 'inherit' ? '未设置' : ''), tone }
}

// ── 「来自」列(spec §5.2)= 命中链尾:本栋设置 / 一期设置 / 全园设置 / 户级例外（覆盖 全园 0.16 元/度）/ 未设置 /
//    取自「园区分摊面积基数」(走面积基数的池:后端把基数键 label 挂在链尾,值来自那条参数;页面可点跳过去)。
//    sourceChain 每级 `scopeLabel:valueText`,首项=生效来源;首项作用域名 == 本行作用域名 ⇒ 自设,否则来自上级 ──
export const BASE_REF_PREFIX = '取自「'
export function baseRefLabel(r: ParamRow): string | null {
  const last = r.sourceChain?.[r.sourceChain.length - 1]
  return last?.startsWith(BASE_REF_PREFIX) ? last.slice(BASE_REF_PREFIX.length).replace(/」$/, '') : null
}
export function sourceLabel(r: ParamRow): string {
  const chain = r.sourceChain ?? []
  if (!chain.length) return '未设置'
  const base = baseRefLabel(r)
  if (base) return `取自「${base}」`
  const hitLabel = chain[0].slice(0, chain[0].indexOf(':'))
  if (hitLabel !== r.scopeLabel) return `${hitLabel}设置`
  if (r.scope === '') return '全园设置'
  if (r.scope.startsWith('tenant:')) return chain[1] ? `户级例外（覆盖 ${chain[1].replace(':', ' ')}）` : '户级例外'
  const kind = r.scope.startsWith('building:') ? '栋' : r.scope.startsWith('rule:') ? '池' : r.scope.startsWith('meter:') ? '表' : '期'
  return `本${kind}设置`
}

// ── ④ 户级例外的写序列(spec §3.4):按注册表 writePlan 成组展开(配套键 fixed 值 / 同值);
//    「损耗费基数形态（按栋）」是模板键,拼该户所在损耗链的楼栋 id → loss_base_form_b{bid} ──
export interface TenantExceptionForm { tenantId: number; key: string; bid?: number | null; value: number; mode: ParamMode; note: string | null }
export function tenantExceptionReqs(f: TenantExceptionForm, ym: string): ParamPutReq[] {
  const key = f.key === LOSS_BASE_FORM_B_TEMPLATE ? `loss_base_form_b${f.bid}` : f.key
  const scope = `tenant:${f.tenantId}`
  return writePlan(key).map(w => ({ key: w.key, scope, acctMonth: ym, mode: f.mode, value: w.fixed ?? f.value, note: f.note }))
}
// ④ [删]:按同一写计划整组删(配套键取同版本行;ponytail: 配套键若是单独另录的版本,同 (月,方式) 才会一起删,不同则留;无该行后端 no-op)
export function tenantExceptionDelReqs(r: ParamRow): ParamPutReq[] {
  return writePlan(r.key).map(w => ({ key: w.key, scope: r.scope, acctMonth: r.acctMonth, mode: r.mode, value: null }))
}

// ── 页面禁词(spec §5.2 / §8.4):字段值与内部标识不得上屏;页面 spec 用它扫全文 ──
const FORBIDDEN = /(p1|p2|dorm|building:|rule:|meter:|tenant:|默认·所有月份)/
export function forbiddenText(s: string): boolean { return FORBIDDEN.test(s) }

// ── 状态条文案(spec §5.1 / §5.5):电价 n/6 · 快照一致(生成于)| 参数已改 N 项(旧快照)· 另有 X 月受影响 ──
const hhmm = (iso: string) => iso.slice(5, 16).replace('T', ' ')   // 'YYYY-MM-DDTHH:mm:ss' → 'MM-DD HH:mm'
export function pendingSummary(s: ParamStatus): string {
  const parts: string[] = []
  const missing = s.priceTotal - s.priceOk
  parts.push(`本月电价 ${s.priceOk}/${s.priceTotal} ${missing > 0 ? `⚠ 缺 ${missing} 项` : '✓'}`)
  if (s.stale) parts.push(`参数已改 ${s.pendingChanges} 项，池核算 / 楼栋损耗 / 催缴单为旧快照 ⚠`)
  else if (s.poolSnapshotAt) parts.push(`快照与参数一致 ✓ 生成于 ${hhmm(s.poolSnapshotAt)}`)
  else parts.push('本月尚未生成池核算')
  if (s.otherMonthsAffected.length) parts.push(`另有 ${s.otherMonthsAffected.join('、')} 也受影响，请切到该月重算`)
  return parts.join(' · ')
}

// ── 其它三屏头部的 stale 条(spec §5.5.3):公共电核算 / 楼栋损耗看池快照,催缴单看批次时间 ——
//    本屏那份快照早于最近一次参数或抄表改动才算旧(后端 status.stale 是两者取或,催缴单没重生成不该让池屏也亮);
//    未生成(快照 null)不算旧。返回文案,'' = 一致 ──
export type SnapKind = 'pool' | 'bill'
export function staleText(s: ParamStatus | null | undefined, kind: SnapKind): string {
  if (!s?.lastChangeAt) return ''
  const snap = kind === 'bill' ? s.billBatchAt : s.poolSnapshotAt
  if (!snap || s.lastChangeAt <= snap) return ''       // ISO 'YYYY-MM-DDTHH:mm:ss' 字典序=时间序
  // 2026-09-23 去行话:原句「本屏为旧快照」——「快照」是引擎内部的说法,用户不认。
  // 三个消费屏(公共电核算 / 楼栋损耗 / 催缴单)都把它当告警抽屉里的一条明细文字,换词不改判定。
  // 两个来源都在时只有「最近一次」的时间(后端只给 lastChangeAt 一个),所以不说「X 于某时」。
  return staleSources(s).length > 1
    ? `参数和抄表都改过，最近一次在 ${hhmm(s.lastChangeAt)}，本屏数字还是改之前算的`
    : `${staleWhat(s)}于 ${hhmm(s.lastChangeAt)} 更新，本屏数字还是改之前算的`
}

// ── 需重算的来源(METER-TIMELINE-SPEC §5):参数 / 抄表(读数与表档案)。后端 staleSources = 让本月过期的来源,
//    lastChangeSource = 最近一次改动来自哪边(过期时它必在其中);两个都没给(旧后端)→ 按参数算。
//    只在「已判过期」的地方调,不自己判过期 ──
export type StaleSource = 'param' | 'meter'
export function staleSources(s: ParamStatus | null | undefined): StaleSource[] {
  const has = new Set<StaleSource>(s?.staleSources ?? [])
  if (s?.lastChangeSource) has.add(s.lastChangeSource)
  if (!has.size) has.add('param')
  return (['param', 'meter'] as const).filter(x => has.has(x))
}
const STALE_WORD: Record<StaleSource, [string, string]> = {
  param: ['参数', '计费参数'],
  meter: ['抄表', '抄表数据（读数或表档案）'],
}
/** 短称:参数 / 抄表 / 参数和抄表 */
export function staleWhat(s: ParamStatus | null | undefined): string {
  return staleSources(s).map(x => STALE_WORD[x][0]).join('和')
}
/** 句首主语:计费参数 / 抄表数据（读数或表档案）/ 计费参数和抄表数据 */
export function staleWho(s: ParamStatus | null | undefined): string {
  const xs = staleSources(s)
  return xs.length > 1 ? '计费参数和抄表数据' : STALE_WORD[xs[0]][1]
}
/** 告警组名:改过参数还没重算 / 改过抄表还没重算 / 改过参数和抄表还没重算 */
export function staleTitle(s: ParamStatus | null | undefined): string {
  return `改过${staleWhat(s)}还没重算`
}

// ── 「复制上月电价」键集 = 代理购电六段裸价(与后端 PriceCfgService.ELEC_KEYS / POST /price-cfg/copy 复制范围同源) ──
// 供电局综合电价 elec_grid_avg 也是 month 键但**不复制**:它是账单总金额÷总度数,月月不同,抄上月只会错。
const COPY_ELEC_KEYS = ['elec_commercial', 'elec_peak', 'elec_sharp', 'elec_flat', 'elec_valley', 'elec_resident']
export function copyPrevMonthKeys(): string[] {
  return PARAM_DEFS.filter(d => COPY_ELEC_KEYS.includes(d.key)).map(d => d.key)
}

export function prevYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
