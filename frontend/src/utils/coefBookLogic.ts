// 系数簿纯逻辑(S14-COEF-BOOK-SPEC §2/§3;S21 起键源=计费参数注册表):COEF_KEYS=注册表 tenantEditable 价目键
// (label/单位/值类型/枚举字典皆取自 paramRegistry;配套写计划仍按 S14 §3.1 约定)+ 二期层份两键、
// 行构建(期归属复用 billNoticeLogic.resolvePhase,按楼栋分组走 groupByBuilding)、
// 当前生效值解析(价目键=GET /params?ym&key= 后端已级联解析,前端按 户→期→全园 找行;层份键=GET /alloc/pools?ym 成员行)、
// 暂存模型 Map<tenantId, value|null>(null=清除:删该月版本/回自动分)与提交计划
// (价目键→PUT /params 序列含配套键;层份键→按池分组整组写月版本)。coefBookLogic.spec.ts 锁定。
import type { ParamPutReq, ParamRowDTO } from '@/api/params'
import type {
  AllocFeeKey, AllocLinkType, AllocMethod, AllocRuleReq, AllocStdKind, AllocZone,
} from '@/api/alloc'
import { PARAM_DEFS, type ParamDef, type ParamValueKind } from './paramRegistry'
import { resolvePhase, tenantBuildings, type TenantBuildings } from './billNoticeLogic'

// ── 注册表:label/unit/写计划(fixed=配套键写死值,缺省=写用户值)/层份类挂池费项/值类型(enum 给字典) ──
export interface CoefWrite { key: string; fixed?: number }
export interface CoefKeyMeta {
  id: string
  label: string
  unit: string
  floorShare: boolean                                    // true=层份类(仅二期;池成员读写)
  feeKey: 'share_elec_elevator' | 'share_elec_fire' | null
  writes: CoefWrite[]                                    // 价目类写计划(层份类空)
  hint: string
  valueKind: ParamValueKind                              // 值控件:enum→Select(字典),其余数字输入
  enumOptions?: Record<number, string>
}

// 配套写计划(S14 §3.1 户级例外惯例;注册表只标 pairedWith,写死值约定在这里):缺省=只写自身
const WRITES: Record<string, { writes: CoefWrite[]; hint: string }> = {
  mgmt_fee: {
    writes: [{ key: 'mgmt_fee' }, { key: 'mgmt_fee_commercial' }],
    hint: '双键同值成对写(tenant-price-exceptions 惯例,引擎走哪支都被压过);默认 0.16 不落户级行',
  },
  water: {
    writes: [{ key: 'water' }, { key: 'water_pipe', fixed: 0 }],
    hint: '例外惯例:户级水价配套 管网维护费=0 同写(免叠默认管网费)',
  },
  elec_package: {
    writes: [{ key: 'elec_package' }, { key: 'mgmt_fee', fixed: 0 }, { key: 'mgmt_fee_commercial', fixed: 0 }],
    hint: '包干价已含管理费:配套双 mgmt 键=0 成组写',
  },
}
// 配套键只随主键成组写,不单列
const SECONDARY = new Set(['mgmt_fee_commercial', 'water_pipe'])
// 价目键 = 注册表 tenantEditable 且:非 ① 区月核对项(尖峰比率/照抄金额由计费参数页按月管,系数簿版本语义是自生效月起前滚)、
// 非配套键、非前缀模板键(loss_base_form_b{bid} 需指定楼栋)、值类型可批量输入(数字/枚举;引用型需选表器,去计费参数页 ④ 区)
const BATCH_KINDS = new Set<ParamValueKind>(['number', 'rate', 'money', 'int', 'enum'])
const priceMeta = (d: ParamDef): CoefKeyMeta => ({
  id: d.key, label: d.label, unit: d.unit, floorShare: false, feeKey: null,
  writes: WRITES[d.key]?.writes ?? [{ key: d.key }],
  hint: WRITES[d.key]?.hint ?? d.hint ?? '',
  valueKind: d.valueKind, enumOptions: d.enumOptions,
})
const FLOOR_KEYS: CoefKeyMeta[] = [
  { id: 'elevator_share', label: '电梯层份', unit: '份', floorShare: true, feeKey: 'share_elec_elevator',
    writes: [], hint: '仅二期;保存=自生效月起整名单版本组,历史月不动;空=层内按面积自动分', valueKind: 'number' },
  { id: 'fire_share', label: '消防层份', unit: '份', floorShare: true, feeKey: 'share_elec_fire',
    writes: [], hint: '仅二期;保存=自生效月起整名单版本组,历史月不动;空=层内按面积自动分', valueKind: 'number' },
]
export const COEF_KEYS: CoefKeyMeta[] = [
  ...PARAM_DEFS.filter(d => d.tenantEditable && !d.monthlyCheck && !SECONDARY.has(d.key)
    && !d.key.includes('{') && BATCH_KINDS.has(d.valueKind)).map(priceMeta),
  ...FLOOR_KEYS,
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

// ── 价目键当前生效值:GET /params?ym&key= 每行已站在 ym 级联解析(值/人话/区间/命中链);本函数只按作用域找行
//    tenant:{id} → 期 → 全园,首个有值者;例外徽标 = 户级行且命中本户自己的版本(rowId 非空,而非继承上级) ──
export interface CoefPriceHit { value: number; valueText: string; rangeText: string; exception: boolean; chain: string[] }
export function resolveCoefPrice(
  rows: ParamRowDTO[], key: string, tenantId: number, zone: string | null,
): CoefPriceHit | null {
  const scopes = [`tenant:${tenantId}`, ...(zone ? [zone] : []), '']
  for (const s of scopes) {
    const r = rows.find(x => x.key === key && x.scope === s)
    if (r && r.value != null)
      return { value: r.value, valueText: r.valueText, rangeText: r.rangeText,
               exception: s.startsWith('tenant:') && r.rowId != null, chain: r.sourceChain }
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

// 价目键提交计划:一户一组,组内按注册表写计划展开(配套键成组写;清除=全部键 value null);
// mode 不传=注册表默认(系数簿键皆 from:自生效月起前滚,与旧 PUT /price-cfg 同义)
export interface PricePlanItem { tenantId: number; reqs: ParamPutReq[] }
export function buildPricePlan(meta: CoefKeyMeta, stash: CoefStash, ym: string): PricePlanItem[] {
  const out: PricePlanItem[] = []
  for (const [tenantId, v] of stash) {
    out.push({
      tenantId,
      reqs: meta.writes.map(w => ({
        key: w.key, scope: `tenant:${tenantId}`, acctMonth: ym,
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
