// 计费参数页纯逻辑(S21-PARAM-CENTER-SPEC §5):四区分组 / 生效区间徽标 / 页面禁词 / 状态条文案 /
// 复制上月电价键集。行数据 = 后端 GET /api/params 的 ParamRowDTO(人话解析在后端),本文件不碰网络。
// paramCenterLogic.spec.ts 锁定。
import type { ParamRowDTO, ParamStatusDTO } from '@/api/params'
import { PARAM_DEFS } from './paramRegistry'

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

// ── 「复制上月电价」键集 = 注册表里默认 month 的裸电价键(6 键;与后端 POST /price-cfg/copy 复制范围同源) ──
export function copyPrevMonthKeys(): string[] {
  return PARAM_DEFS.filter(d => d.defaultMode === 'month' && d.key.startsWith('elec_')).map(d => d.key)
}

export function prevYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
