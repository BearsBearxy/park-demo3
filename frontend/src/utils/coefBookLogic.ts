// 系数簿纯逻辑(S14-COEF-BOOK-SPEC §2/§3):COEF_KEYS 注册表(九键=价目户级例外全部 overridable 键
// + 二期层份)、行构建(期归属复用 billNoticeLogic.resolvePhase,按楼栋分组走 groupByBuilding)、
// 当前生效值解析(价目键=resolvePrice tenant 级联+常数键前滚;层份键=GET /alloc/pools?ym 成员行)、
// 暂存模型 Map<tenantId, value|null>(null=清除:删该月版本/回自动分)与提交计划
// (价目键→PUT /price-cfg 序列含配套键;层份键→按池分组整组写月版本)。coefBookLogic.spec.ts 锁定。
import type { PriceCfgDTO, PriceCfgUpsertReq } from '@/api/priceCfg'
import type {
  AllocFeeKey, AllocLinkType, AllocMethod, AllocRuleReq, AllocStdKind, AllocZone,
} from '@/api/alloc'
import { resolvePrice } from './priceCfgLogic'
import { resolvePhase, tenantBuildings, type TenantBuildings } from './billNoticeLogic'

// ── 注册表:label/unit/写计划(fixed=配套键写死值,缺省=写用户值)/层份类挂池费项 ──
// ⚠green_rate 现不在后端 PriceCfgService.CFG_KEYS 白名单(S13 行走裸 SQL 入库),
//   走 PUT /price-cfg 会 400——白名单补键归后端刀,本注册表按 spec §3.1 先列全。
export interface CoefWrite { key: string; fixed?: number }
export interface CoefKeyMeta {
  id: string
  label: string
  unit: string
  floorShare: boolean                                    // true=层份类(仅二期;池成员读写)
  feeKey: 'share_elec_elevator' | 'share_elec_fire' | null
  writes: CoefWrite[]                                    // 价目类写计划(层份类空)
  hint: string
}
export const COEF_KEYS: CoefKeyMeta[] = [
  { id: 'mgmt_fee', label: '电力管理费单价', unit: '元/度', floorShare: false, feeKey: null,
    writes: [{ key: 'mgmt_fee' }, { key: 'mgmt_fee_commercial' }],
    hint: '双键同值成对写(tenant-price-exceptions 惯例,引擎走哪支都被压过);默认 0.16 不落户级行' },
  { id: 'elevator_share', label: '电梯层份', unit: '份', floorShare: true, feeKey: 'share_elec_elevator',
    writes: [], hint: '仅二期;保存=自生效月起整名单版本组,历史月不动;空=层内按面积自动分' },
  { id: 'fire_share', label: '消防层份', unit: '份', floorShare: true, feeKey: 'share_elec_fire',
    writes: [], hint: '仅二期;保存=自生效月起整名单版本组,历史月不动;空=层内按面积自动分' },
  { id: 'water', label: '水价', unit: '元/吨', floorShare: false, feeKey: null,
    writes: [{ key: 'water' }, { key: 'water_pipe', fixed: 0 }],
    hint: '例外惯例:户级水价配套 管网维护费=0 同写(免叠默认管网费)' },
  { id: 'capacity_fee', label: '装机容量费单价', unit: '元/kVA·月', floorShare: false, feeKey: null,
    writes: [{ key: 'capacity_fee' }], hint: '' },
  { id: 'green_rate', label: '绿化水收取价', unit: '元/㎡', floorShare: false, feeKey: null,
    writes: [{ key: 'green_rate' }], hint: '' },
  { id: 'elec_package', label: '包干电价', unit: '元/度', floorShare: false, feeKey: null,
    writes: [{ key: 'elec_package' }, { key: 'mgmt_fee', fixed: 0 }, { key: 'mgmt_fee_commercial', fixed: 0 }],
    hint: '包干价已含管理费:配套双 mgmt 键=0 成组写' },
  { id: 'share_elec_fixed', label: '公共用电包干额', unit: '元/月', floorShare: false, feeKey: null,
    writes: [{ key: 'share_elec_fixed' }], hint: '替楼层公共+电梯+路灯三项' },
  { id: 'share_water_fixed', label: '公共用水包干额', unit: '元/月', floorShare: false, feeKey: null,
    writes: [{ key: 'share_water_fixed' }], hint: '替绿化水公摊' },
]
export function coefMeta(id: string): CoefKeyMeta {
  const m = COEF_KEYS.find(k => k.id === id)
  if (!m) throw new Error(`未知系数键: ${id}`)
  return m
}

// ── 行构建:当月在租合同 → 一户一行;期归属/主楼栋与催缴单列表同源 ──
export interface CoefContractIn {
  tenantId: number; tenantName: string
  buildingId: number; buildingName?: string | null; rentArea?: number | null
}
export interface CoefTenantRow {
  tenantId: number
  tenantName: string
  phase: 1 | 2 | 3
  bld: TenantBuildings
  totalAmount: 0    // groupByBuilding 泛型约束占位(组小计列本窗口不用)
}
export function buildCoefRows(
  contracts: CoefContractIn[],
  buildings: { id: number; phase: number; name: string }[],
): CoefTenantRow[] {
  const bById = new Map(buildings.map(b => [b.id, b]))
  const byTenant = new Map<number, CoefContractIn[]>()
  for (const c of contracts) {
    const a = byTenant.get(c.tenantId)
    if (a) a.push(c); else byTenant.set(c.tenantId, [c])
  }
  return [...byTenant.entries()].map(([tenantId, cs]) => ({
    tenantId,
    tenantName: cs[0].tenantName,
    phase: resolvePhase(cs.map(c => {
      const b = bById.get(c.buildingId)
      return { phase: b?.phase ?? 0, name: b?.name ?? '' }
    }), null),
    bld: tenantBuildings(cs),
    totalAmount: 0,
  }))
}

// ── 价目键当前生效值:resolvePrice 同规则逐级试(tenant:{id}→zone→''),附命中 scope(例外徽标) ──
export interface CoefPriceHit { value: number; effMonth: string; scope: string }
export function resolveCoefPrice(
  rows: PriceCfgDTO[], key: string, ym: string, tenantId: number, zone: string | null,
): CoefPriceHit | null {
  const scopes = [`tenant:${tenantId}`, ...(zone ? [zone] : []), '']
  for (const s of scopes) {
    const hit = resolvePrice(rows.filter(r => r.scope === s), key, ym, tenantId, s === '' ? null : s)
    if (hit) return { value: hit.value, effMonth: hit.effMonth, scope: s }
  }
  return null
}

// ── 层份键:池成员行(GET /alloc/pools?ym 已按月解析);池费项在 rule 上,池行只有 ruleId ──
export interface CoefPoolIn {
  ruleId: number; zone: AllocZone; name: string
  buildingId: number | null; floorLabel: string | null; side: string | null; feeName: string | null
  method: AllocMethod; stdKind: AllocStdKind | null; roundScale: number; baseKey: string | null
  note: string | null
  meters: { meterId: number; sign: number }[]
  links: { ruleId: number; type: AllocLinkType }[]
  members: { tenantId: number; weight: number | null; src: 'month' | 'default' }[]
}
export interface CoefRuleIn { id: number; feeKey: AllocFeeKey; coefficient: number | null; extraQty: number }

export function poolsOfFeeKey(pools: CoefPoolIn[], rules: CoefRuleIn[], feeKey: string): CoefPoolIn[] {
  const ids = new Set(rules.filter(r => r.feeKey === feeKey).map(r => r.id))
  return pools.filter(p => p.zone === 'p2' && ids.has(p.ruleId))   // 层份仅二期开放(spec §3)
}
export interface FloorMembership { ruleId: number; poolName: string; weight: number | null; src: 'month' | 'default' }
export function floorMemberships(feePools: CoefPoolIn[], tenantId: number): FloorMembership[] {
  const out: FloorMembership[] = []
  for (const p of feePools)
    for (const m of p.members)
      if (m.tenantId === tenantId)
        out.push({ ruleId: p.ruleId, poolName: p.name, weight: m.weight, src: m.src })
  return out
}

// ── 暂存模型:Map<tenantId, 新值|null>(null=清除:价目键删该月版本回退/层份键回自动分) ──
export type CoefStash = Map<number, number | null>

// 价目键提交计划:一户一组,组内按注册表写计划展开(配套键成组写;清除=全部键 value null)
export interface PricePlanItem { tenantId: number; reqs: PriceCfgUpsertReq[] }
export function buildPricePlan(meta: CoefKeyMeta, stash: CoefStash, ym: string): PricePlanItem[] {
  const out: PricePlanItem[] = []
  for (const [tenantId, v] of stash) {
    out.push({
      tenantId,
      reqs: meta.writes.map(w => ({
        scope: `tenant:${tenantId}`, cfgKey: w.key, acctMonth: ym,
        value: v == null ? null : (w.fixed ?? v),
        note: v == null ? null : '系数簿批量',
      })),
    })
  }
  return out
}

// 层份键提交计划:含暂存户的池,当月解析成员组套暂存 → 整组写月版本(PUT /alloc/rules/{id});
// req 其余字段照抄池行/rule(与 PoolLedgerView.submitPool 同构,不残缺提交)
export interface FloorPlanItem { ruleId: number; poolName: string; touched: number[]; req: AllocRuleReq }
export function buildFloorPlan(
  pools: CoefPoolIn[], rules: CoefRuleIn[], feeKey: string, stash: CoefStash, ym: string,
): FloorPlanItem[] {
  const ruleById = new Map(rules.map(r => [r.id, r]))
  const out: FloorPlanItem[] = []
  for (const p of poolsOfFeeKey(pools, rules, feeKey)) {
    const touched = p.members.filter(m => stash.has(m.tenantId)).map(m => m.tenantId)
    if (touched.length === 0) continue
    const rule = ruleById.get(p.ruleId)!
    out.push({
      ruleId: p.ruleId, poolName: p.name, touched,
      req: {
        zone: p.zone, name: p.name, buildingId: p.buildingId,
        floorLabel: p.floorLabel, side: p.side, feeName: p.feeName,
        method: p.method, coefficient: rule.coefficient, extraQty: rule.extraQty,
        feeKey: rule.feeKey, note: p.note,
        meterIds: p.meters.map(m => m.meterId),
        meters: p.meters.map(m => ({ meterId: m.meterId, sign: m.sign })),
        members: p.members.map(m => ({
          tenantId: m.tenantId,
          weight: stash.has(m.tenantId) ? (stash.get(m.tenantId) ?? null) : m.weight,
        })),
        memberMonth: ym,
        roundScale: p.roundScale, stdKind: p.stdKind, baseKey: p.baseKey,
        links: p.links.map(l => ({ ruleId: l.ruleId, type: l.type })),
      },
    })
  }
  return out
}

// 顺序提交中断续算:已提交池(done)覆盖尽的户出暂存,仍挂未提交池的户保留(重试口径)
export function floorStashAfter(
  items: Pick<FloorPlanItem, 'ruleId' | 'touched'>[], done: number[], stash: CoefStash,
): CoefStash {
  const doneSet = new Set(done)
  const pending = new Set<number>()
  for (const it of items) if (!doneSet.has(it.ruleId)) for (const t of it.touched) pending.add(t)
  const out: CoefStash = new Map()
  for (const [k, v] of stash) if (pending.has(k)) out.set(k, v)
  return out
}
