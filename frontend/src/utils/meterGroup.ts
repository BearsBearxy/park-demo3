// 园区抄表 Excel 式分组区块(METER-SPEC §7 v3,meterGroup.spec.ts 锁定:区块归属/排序/汇总数值)。
// 期区(zone)→区块(area,车间/楼栋座):区块头=infra 配电总表行,随后 share/ops 公共表(Excel 原序)、
// tenant 户内表(方位楼层房号自然序);「连接X车间」馈线表按标识名随 X车间 区块。
// 汇总口径:区块 sums = 区块内 ownership∈{tenant,share} 各表用量合计(总/尖/峰/平/谷,null 跳过,
// 结果四舍五入 2 位防浮点尾差);infra(避免与分表重复计)与 ops(园区经营,非向租户收费口径)不计入;
// 期区 sums = Σ区块 sums。usageOf 缺省(表档案段)= 各列 null,只用分组不用汇总。

export interface GroupableMeter {
  id: number
  zone: string
  area: string | null
  name: string                  // 标识名(内部键):仅用于「连接X车间」馈线归块判定,不再示人
  tenantName?: string | null    // 企业名称原文:真实馈线表(三至二铝缆)的「连接X车间」写在这一列
  ownership: string             // tenant/share/ops/infra
  spot: string | null
  sortNo: number                // Excel 原序
}

export interface MeterUsageLike {
  usageTotal: number | null
  usageSharp: number | null
  usagePeak: number | null
  usageFlat: number | null
  usageValley: number | null
}

// count = 计入汇总的表数(tenant+share);=0 时不出汇总行
export interface BlockSums extends MeterUsageLike { count: number }

export interface MeterBlock<T extends GroupableMeter> {
  key: string           // `${zone}|${区块名}`:折叠状态键
  name: string          // 区块名(区域)
  head: T[]             // infra 配电总表(区块头行,折叠时仍显示)
  body: T[]             // share/ops(Excel 序) + tenant(方位自然序)
  sums: BlockSums
}

export interface MeterZoneGroup<T extends GroupableMeter> {
  zone: T['zone']
  blocks: MeterBlock<T>[]
  sums: BlockSums       // 期区汇总条
}

const ZONE_ORDER: Record<string, number> = { p1: 0, p2: 1, dorm: 2 }
const SUM_KEYS = ['usageTotal', 'usageSharp', 'usagePeak', 'usageFlat', 'usageValley'] as const

// 区块名:「连接X车间」馈线表随 X车间(标识名或企业名称原文判定);否则 = area 原文;area 空 = 未分区域
export function blockNameOf(m: Pick<GroupableMeter, 'area' | 'name' | 'tenantName'>): string {
  const feed = `${m.name} ${m.tenantName ?? ''}`.match(/连接\s*([^\s，,、]*车间)/)
  if (feed) return feed[1]
  return (m.area ?? '').trim() || '未分区域'
}

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
function cnNum(s: string): number | null {
  if (CN_NUM[s] != null) return CN_NUM[s]
  const m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/)
  if (m) return (m[1] ? CN_NUM[m[1]] : 1) * 10 + (m[2] ? CN_NUM[m[2]] : 0)
  return null
}

// 方位自然序键:[楼层(负X/中文/数字,无=9999), 房号(首个≥2位数字,无=999999), 原序] 逐位比较
export function spotKey(spot: string | null | undefined, sortNo: number): [number, number, number] {
  const s = (spot ?? '').trim()
  let floor = 9999
  const fm = s.match(/(负)?([0-9一二三四五六七八九十]+)\s*[楼层]/)
  if (fm) {
    const v = /^\d+$/.test(fm[2]) ? parseInt(fm[2], 10) : cnNum(fm[2])
    if (v != null) floor = fm[1] ? -v : v
  }
  const rm = s.match(/\d{2,}/)
  const room = rm ? parseInt(rm[0], 10) : 999999
  return [floor, room, sortNo]
}

// ── 区块损耗行(PB-ALLOCATION-SPEC §3:METER-SPEC:96「总表vs分表勾稽」就地兑现) ──
// 两操作数现成:head(infra 总表用量) 与 sums(tenant+share 用量合计);损耗=一行减法,读时派生不落库。
// lossQty=分表Σ−总表(负=有损耗);无总表读数=null 不出损耗行。负超阈黄标(warn),不阻断。
export interface BlockLoss { headQty: number; lossQty: number; lossRate: number | null; warn: boolean }
// ponytail: 阈值 -5% 为经验值(真实损耗率 0.6%~9.5%),误报多再参数化
export const LOSS_WARN_RATE = -0.05
export function blockLoss(headUsages: (number | null)[], subTotal: number | null): BlockLoss | null {
  const hs = headUsages.filter((v): v is number => v != null)
  if (hs.length === 0) return null
  const headQty = Math.round(hs.reduce((s, v) => s + v, 0) * 100) / 100
  const lossQty = Math.round(((subTotal ?? 0) - headQty) * 100) / 100
  const lossRate = headQty !== 0 ? Math.round((lossQty / headQty) * 10000) / 10000 : null
  return { headQty, lossQty, lossRate, warn: lossRate != null && lossRate < LOSS_WARN_RATE }
}

const round2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100)
const emptySums = (): BlockSums =>
  ({ usageTotal: null, usageSharp: null, usagePeak: null, usageFlat: null, usageValley: null, count: 0 })

export function groupMeterBlocks<T extends GroupableMeter>(
  meters: T[],
  usageOf?: (m: T) => MeterUsageLike | null | undefined,
): MeterZoneGroup<T>[] {
  // 归块:zone → 区块名 → 成员(保持传入序=Excel 序)
  const byZone = new Map<string, Map<string, T[]>>()
  for (const m of meters) {
    let zm = byZone.get(m.zone)
    if (!zm) byZone.set(m.zone, (zm = new Map()))
    const bn = blockNameOf(m)
    const arr = zm.get(bn)
    if (arr) arr.push(m)
    else zm.set(bn, [m])
  }
  const zones = [...byZone.keys()].sort((a, b) => (ZONE_ORDER[a] ?? 9) - (ZONE_ORDER[b] ?? 9))
  return zones.map(zone => {
    const zm = byZone.get(zone)!
    const blocks = [...zm.entries()]
      .map(([name, ms]) => {
        const bySort = (a: T, b: T) => a.sortNo - b.sortNo
        const head = ms.filter(m => m.ownership === 'infra').sort(bySort)
        const pub = ms.filter(m => m.ownership !== 'infra' && m.ownership !== 'tenant').sort(bySort)
        const ten = ms.filter(m => m.ownership === 'tenant')
          .map(m => ({ m, k: spotKey(m.spot, m.sortNo) }))
          .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2])
          .map(x => x.m)
        const sums = emptySums()
        for (const m of ms) {
          if (m.ownership !== 'tenant' && m.ownership !== 'share') continue
          sums.count++
          const u = usageOf?.(m)
          if (!u) continue
          for (const k of SUM_KEYS) {
            const v = u[k]
            if (v != null) sums[k] = (sums[k] ?? 0) + v
          }
        }
        for (const k of SUM_KEYS) sums[k] = round2(sums[k])
        return {
          minSort: Math.min(...ms.map(m => m.sortNo)),
          block: { key: `${zone}|${name}`, name, head, body: [...pub, ...ten], sums },
        }
      })
      .sort((a, b) => a.minSort - b.minSort)   // 区块序 = 区块内最小 sortNo(Excel 原序)
      .map(x => x.block)
    const sums = emptySums()
    for (const b of blocks) {
      sums.count += b.sums.count
      for (const k of SUM_KEYS) {
        const v = b.sums[k]
        if (v != null) sums[k] = (sums[k] ?? 0) + v
      }
    }
    for (const k of SUM_KEYS) sums[k] = round2(sums[k])
    return { zone: zone as T['zone'], blocks, sums }
  })
}
