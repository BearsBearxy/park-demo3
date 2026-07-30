// 池核算纯逻辑(POOL-ENGINE-SPEC §6,S3-B1 刀2):分带分组/tfoot 合计(ref 行剔除)/
// 分摊语义标签/分摊标准折入披露/导出 AOA/损耗对账区行格式化。poolLedgerLogic.spec.ts 锁定。
import type { AllocLossReconDTO, AllocLossUnitDTO, AllocPoolRowDTO } from '@/api/alloc'
import { ALLOC_METHOD_LABEL } from '@/utils/allocLogic'
import { floorRank } from '@/composables/useMeterWorkbench'

export const POOL_ZONE_LABEL: Record<string, string> = { p1: '一期', p2: '二期', dorm: '宿舍' }

const r2 = (v: number) => Math.round(v * 100) / 100
// 浮点噪音清理后的紧凑数字串(0.0050000 → '0.005')
const trimNum = (v: number) => String(Number(v.toFixed(8)))
const fmtN = (v: number | null) =>
  v == null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })

// ── 分摊语义:method+基数标签(X层/㎡/户对户/不分摊/纯标准行) ──
export function poolSemantics(r: Pick<AllocPoolRowDTO, 'method' | 'baseSnap'>): string {
  const base = r.baseSnap
  switch (r.method) {
    case 'floor': return base != null ? `${trimNum(base)}层均摊` : ALLOC_METHOD_LABEL.floor
    case 'area': return base != null ? `${trimNum(base)}㎡分摊` : ALLOC_METHOD_LABEL.area
    case 'direct': return '户对户'
    case 'none': return '不分摊'
    case 'ref': return '纯标准行'
    default: return ALLOC_METHOD_LABEL[r.method] ?? r.method
  }
}

// ── 分摊标准展示:text=按 roundScale 定小数;含折入时 title 披露 '0.01+0.005' ──
export function stdDisplay(r: Pick<AllocPoolRowDTO, 'stdValue' | 'foldAdd' | 'roundScale'>):
  { text: string; title: string | null } {
  if (r.stdValue == null) return { text: '–', title: null }
  // 折入档可比 roundScale 多一位(V46=ROUND(x,2)+0.005=0.015),按值实际小数位与 roundScale 取大,防截位
  const frac = String(r.stdValue).split('.')[1]?.length ?? 0
  const text = r.stdValue.toFixed(Math.max(r.roundScale, frac))
  if (!r.foldAdd) return { text, title: null }
  return { text, title: `${trimNum(r.stdValue - r.foldAdd)}+${trimNum(r.foldAdd)}` }
}

// ── 池名自动生成(V69,与后端 AllocService.poolName 同规则;后端没给 autoName 时前端兜底) ──
// 非空段「·」连接;楼层+侧向合成一段;楼栋名原样(含空格);末端截到 64(name VARCHAR(64))。
// ⚠楼栋空(园区级)前缀取 zone 期别:一/二期/宿舍各有一个「路灯」池,统一写"园区级"会三撞一。
const ZONE_POOL_PREFIX: Record<string, string> = { p1: '一期园区', p2: '二期园区', dorm: '宿舍区' }
export function poolAutoName(zone: string, buildingName: string | null | undefined, floorLabel: string | null | undefined,
                             side: string | null | undefined, feeName: string | null | undefined): string {
  const t = (s: string | null | undefined) => (s ?? '').trim()
  const parts = [t(buildingName) || ZONE_POOL_PREFIX[zone] || '园区级']
  const loc = t(floorLabel) + t(side)
  if (loc) parts.push(loc)
  if (t(feeName)) parts.push(t(feeName))
  return parts.join('·').slice(0, 64)
}

// ── 分带只按楼栋(用户 2026-07-30 报障:四级分带带头比数据行还多,没法读) ──
// 园区级在前 + 楼栋账册序 = 直接吃后端 pools 的行序首现(AllocService §1249 已按
// 园区级→楼栋最小 sortNo→楼层→侧向→sortNo 排好),不在前端另造一套楼栋序。
// 楼层/侧向降级为「楼层·方位」列(poolFloorSide),带内按 楼层序(整栋排首)→侧向→sortNo。
export interface PoolBand {
  label: string                  // 楼栋名;园区级池='园区级'
  rows: AllocPoolRowDTO[]
}
// 整栋池(floorLabel 空)恒排带首;其余复用抄表台账的楼层解析(负一层<一楼<…<天面)
const floorSort = (f: string | null | undefined) => (f?.trim() ? floorRank(f) : -Infinity)
export function groupPoolsByBuilding(rows: AllocPoolRowDTO[], zone: string): PoolBand[] {
  const bands: PoolBand[] = []
  const byKey = new Map<string, PoolBand>()
  for (const r of rows.filter(x => x.zone === zone)) {
    const label = r.buildingName?.trim() || '园区级'
    let b = byKey.get(label)
    if (!b) { b = { label, rows: [] }; byKey.set(label, b); bands.push(b) }
    b.rows.push(r)
  }
  for (const b of bands) b.rows.sort((a, c) =>
    floorSort(a.floorLabel) - floorSort(c.floorLabel)
    || (a.side ?? '').localeCompare(c.side ?? '')
    || a.sortNo - c.sortNo)
  return bands
}

// ── 「楼层·方位」列(定位从池名里搬出来成列):整栋池'–',园区级池空 ──
export function poolFloorSide(r: Pick<AllocPoolRowDTO, 'buildingId' | 'floorLabel' | 'side'>): string {
  if (r.buildingId == null) return ''
  return ((r.floorLabel ?? '').trim() + (r.side ?? '').trim()) || '–'
}

// ── 池名称列只显费项名(楼栋/楼层已成列,不再重复);feeName 空的存量池回退全名 ──
export const poolFeeLabel = (r: Pick<AllocPoolRowDTO, 'feeName' | 'name'>) =>
  r.feeName?.trim() || r.name

// ── 盈亏色阶:0(±0.005 容差)=绿/亏(负)=红/盈(正)=橙;null(未生成或 ref 池)=灰 ──
export function gapClass(v: number | null | undefined): 'empty' | 'ok' | 'bad' | 'warn' {
  if (v == null) return 'empty'
  if (Math.abs(v) < 0.005) return 'ok'
  return v < 0 ? 'bad' : 'warn'
}

// ── tfoot 合计:Σ度数/Σ应分摊,ref 行(纯标准行)不计;全 null=null(未生成月显'–') ──
export function poolFooter(bands: PoolBand[]): { qty: number | null; cost: number | null } {
  let qty: number | null = null
  let cost: number | null = null
  for (const b of bands) for (const r of b.rows) {
    if (r.method === 'ref') continue
    if (r.qtyTotal != null) qty = r2((qty ?? 0) + r.qtyTotal)
    if (r.costAmount != null) cost = r2((cost ?? 0) + r.costAmount)
  }
  return { qty, cost }
}

// ── 导出 AOA:标题+表头+池行(平表,分带落「楼栋」列)+合计行(列序=屏列序) ──
// 池名称导全名 autoName(屏上只显费项名,导出要能脱离上下文看);实收/盈亏 待账单模块,恒空。
export function buildPoolExportAoa(bands: PoolBand[], ym: string, zoneLabel: string): (string | number)[][] {
  const aoa: (string | number)[][] = [
    [`公共电核算 ${ym} · ${zoneLabel}`],
    ['楼栋', '楼层·方位', '池名称', '表构成', '用量·总', '尖', '峰', '平', '谷', '应分摊(元)',
      '分摊语义', '分摊标准', '摊出', '差额', '实收', '盈亏', '备注'],
  ]
  const c = (v: number | null) => (v == null ? '' : v)
  for (const b of bands) {
    for (const r of b.rows) {
      aoa.push([
        b.label, poolFloorSide(r), r.autoName || r.name,
        r.meters.map(m => (m.sign < 0 ? '-' : '') + m.name).join('、'),
        c(r.qtyTotal), c(r.qtySharp), c(r.qtyPeak), c(r.qtyFlat), c(r.qtyValley),
        c(r.costAmount), poolSemantics(r), c(r.stdValue),
        c(r.allocatedAmount), c(r.gapAmount), '', '', r.note ?? '',
      ])
    }
  }
  const foot = poolFooter(bands)
  aoa.push(['合计', '', '', '', c(foot.qty), '', '', '', '',
    c(foot.cost), '', '', '', '', '', '', 'ref 行不计'])
  return aoa
}

// ── 损耗对账区两行(供电侧总表 vs 单元总表Σ / 单元分表Σ),读时派生列落位到屏列 ──
export interface LossReconRow {
  label: string
  cQty: number | null    // 落「总表用电量」列(vs 总表Σ行)
  dQty: number | null    // 落「分表用电量」列(vs 分表Σ行)
  loss: number | null
  rate: number | null
}
export function buildLossReconRows(r: AllocLossReconDTO | null | undefined): LossReconRow[] {
  if (!r) return []
  const s = fmtN(r.supplyQty)
  return [
    { label: `对账 · 供电侧总表 ${s} vs 单元总表Σ`, cQty: r.sumC, dQty: null, loss: r.lossVsC, rate: r.rateVsC },
    { label: `对账 · 供电侧总表 ${s} vs 单元分表Σ`, cQty: null, dQty: r.sumD, loss: r.lossVsD, rate: r.rateVsD },
  ]
}

// ── 损耗合计行:Σ 总表/铝缆/分表/损耗量(率不合计) ──
export function lossFooter(units: AllocLossUnitDTO[]):
  { cQty: number | null; cableQty: number | null; dQty: number | null; eQty: number | null } {
  const sum = (pick: (u: AllocLossUnitDTO) => number | null) => {
    let s: number | null = null
    for (const u of units) { const v = pick(u); if (v != null) s = r2((s ?? 0) + v) }
    return s
  }
  return { cQty: sum(u => u.cQty), cableQty: sum(u => u.cableQty), dQty: sum(u => u.dQty), eQty: sum(u => u.eQty) }
}
