// 价目管理纯逻辑(PRICE-CFG-SPEC §2/§3 v2):cfg_key 注册表(后端 PriceCfgService.CFG_KEYS 镜像)、
// 版本链取价 resolvePrice(月变键精确命中当月版本/常数键版本自动前滚,与 S3 派生引擎同规则)、
// power_type 词表、价目表行组装、版本状态组装(右栏卡+工具栏徽标)。priceCfgLogic.spec.ts 锁定。
import type { PriceCfgDTO } from '@/api/priceCfg'

export interface PriceKeyMeta {
  key: string
  label: string
  unit: string
  group: string
  overridable: boolean // true=可作户级例外(例外抽屉费项下拉数据源)
  monthly?: boolean    // true=月变键(电价6键):取价仅命中当月版本,缺=null 派生门禁拦截
  hint: string
}

// §2 受控白名单(V62 定格 19 键,扩展方式=加行不加列):顺序即页面分组渲染顺序。
// 五个月推键(green_water/green_water_hi/lamp_sqm/fire_sqm/elevator_sqm)已删——引擎月推输出不入价目簿。
export const PRICE_KEYS: PriceKeyMeta[] = [
  { key: 'elec_peak', label: '峰段电价', unit: '元/度', group: '电价·月变', overridable: false, monthly: true, hint: '代理购电逐月变' },
  { key: 'elec_sharp', label: '尖段电价(名义)', unit: '元/度', group: '电价·月变', overridable: false, monthly: true, hint: '实收按峰,见开关' },
  { key: 'elec_flat', label: '平段电价', unit: '元/度', group: '电价·月变', overridable: false, monthly: true, hint: '代理购电逐月变' },
  { key: 'elec_valley', label: '谷段电价', unit: '元/度', group: '电价·月变', overridable: false, monthly: true, hint: '代理购电逐月变' },
  { key: 'elec_resident', label: '居民电价(宿舍)', unit: '元/度', group: '电价·月变', overridable: false, monthly: true, hint: '单一价' },
  { key: 'elec_commercial', label: '商业电价', unit: '元/度', group: '电价·月变', overridable: false, monthly: true, hint: '代理购电逐月变' },
  { key: 'mgmt_fee', label: '电力管理费(分时/居民)', unit: '元/度', group: '附加与开关', overridable: true, hint: '户级例外 0.15/0.10/0.1' },
  { key: 'mgmt_fee_commercial', label: '商业维护费', unit: '元/度', group: '附加与开关', overridable: false, hint: '商业综合=0.794+0.32' },
  { key: 'sharp_as_peak_ratio', label: '尖按尖价收取比率', unit: '比率', group: '附加与开关', overridable: false, hint: '政策开关,0=尖按峰收' },
  { key: 'capacity_fee', label: '装机容量费', unit: '元/kVA·月', group: '容量与水', overridable: true, hint: '55户实证;可莱恩23户级' },
  { key: 'water', label: '水价', unit: '元/吨', group: '容量与水', overridable: true, hint: '户级例外 4.45' },
  { key: 'water_pipe', label: '水管网维护费', unit: '元/吨', group: '容量与水', overridable: false, hint: '宿舍无管网费' },
  { key: 'lamp_area_base', label: '路灯面积基数', unit: '㎡', group: '月推参数', overridable: false, hint: '月推分母,非全司常数' },
  { key: 'green_area_base', label: '绿化面积基数', unit: '㎡', group: '月推参数', overridable: false, hint: '一期绿化0.009月推分母' },
  { key: 'area_base', label: '园区总面积基数', unit: '㎡', group: '月推参数', overridable: false, hint: '二期148918.01;园区级池(消防/路灯/绿化)分母' },
  { key: 'elevator_area_base', label: '电梯面积基数', unit: '㎡', group: '月推参数', overridable: false, hint: 'A座12487.04(历史计费面积,原表硬编码)' },
  { key: 'loss_rate', label: '固定损耗率', unit: '比率', group: '特殊轨道', overridable: false, hint: '仅宿舍/商铺固定;厂房月算' },
  { key: 'elec_package', label: '包干电价', unit: '元/度', group: '特殊轨道', overridable: true, hint: '仅户级:包干户1.0/商铺1.5' },
  { key: 'elevator_package', label: '电梯协议包干月额', unit: '元/月', group: '特殊轨道', overridable: true, hint: '仅户级:孵化器63.8/31/79.45' },
]

export const MONTHLY_KEYS: ReadonlySet<string> =
  new Set(PRICE_KEYS.filter(k => k.monthly).map(k => k.key))

// §2 决策⑤词表:台账/报表原词 → power_type(industrial≈两部制收容量费,其余≈单一制)
export type PowerType = 'industrial' | 'commercial' | 'resident'
export const POWER_TYPE_WORDS: Record<string, PowerType> = {
  大工业: 'industrial',
  工业: 'industrial',
  一般工商业: 'commercial',
  商业: 'commercial',
  居民: 'resident',
}
// 长词优先匹配(「一般工商业」不得被「商业」抢先命中)
const WORDS_DESC = Object.keys(POWER_TYPE_WORDS).sort((a, b) => b.length - a.length)
export function matchPowerType(text: string): PowerType | null {
  for (const w of WORDS_DESC) if (text.includes(w)) return POWER_TYPE_WORDS[w]
  return null
}

// §3 v2 版本链取价:acct_month=版本生效起点(''=初始版本)。scope 级联 tenant→zone→''不变,
// 每级内部:月变键仅命中 acctMonth===ym(缺当月版本=null→派生门禁,绝不拿上月价滚账);
// 常数键取 acctMonth<=ym 中最大者——没有变化就一直沿用,"版本自动前滚"。
// 字符串比较即时间序(''字典序最小=任何 ym 都覆盖)。
export interface ResolvedPrice {
  value: number
  effMonth: string   // 生效版本起点(''=长期/自始)
  updatedAt: string  // 该版本变更时间戳
}
export function resolvePrice(
  rows: PriceCfgDTO[], key: string, ym: string,
  tenantId?: number | null, zone?: string | null,
): ResolvedPrice | null {
  const scopes: string[] = []
  if (tenantId != null) scopes.push(`tenant:${tenantId}`)
  if (zone) scopes.push(zone)
  scopes.push('')
  const monthly = MONTHLY_KEYS.has(key)
  for (const scope of scopes) {
    const versions = rows.filter(r => r.scope === scope && r.cfgKey === key)
    const hit = monthly
      ? versions.find(r => r.acctMonth === ym)
      : versions.filter(r => r.acctMonth <= ym)
          .sort((a, b) => (a.acctMonth > b.acctMonth ? -1 : 1))[0]
    if (hit) return { value: hit.value, effMonth: hit.acctMonth, updatedAt: hit.updatedAt }
  }
  return null
}

export const SCOPE_LABEL: Record<string, string> = { '': '全园', p1: '一期', p2: '二期', dorm: '宿舍' }
const SCOPE_ORDER = ['', 'p1', 'p2', 'dorm']

// 左栏价目表:一键一 scope 一行(费项|范围|生效价|生效自|更新时间|编辑态新价),按 §2 group 分组。
// cur=选定月版本行(编辑态输入回显;清空=删该版本行),eff=版本链解析结果。
export interface PriceGridRow {
  meta: PriceKeyMeta
  scope: string                 // ''|p1|p2|dorm
  cur: PriceCfgDTO | null       // (scope,key,选定月) 版本行
  eff: ResolvedPrice | null     // resolvePrice v2(zone=scope)
}
export interface PriceGridGroup { group: string; rows: PriceGridRow[] }

// scope=数据中出现过的非户级 scope;全无则给全园空行保留录入口(仅户级键如 elec_package 亦然,hint 说明)
export function buildPriceGrid(rows: PriceCfgDTO[], ym: string): PriceGridGroup[] {
  const nonTenant = rows.filter(r => !r.scope.startsWith('tenant:'))
  const groups: PriceGridGroup[] = []
  for (const meta of PRICE_KEYS) {
    const scopes = [...new Set(nonTenant.filter(r => r.cfgKey === meta.key).map(r => r.scope))]
      .sort((a, b) => SCOPE_ORDER.indexOf(a) - SCOPE_ORDER.indexOf(b))
    if (scopes.length === 0) scopes.push('')
    let g = groups[groups.length - 1]
    if (!g || g.group !== meta.group) { g = { group: meta.group, rows: [] }; groups.push(g) }
    for (const scope of scopes) {
      g.rows.push({
        meta, scope,
        cur: nonTenant.find(r => r.scope === scope && r.cfgKey === meta.key && r.acctMonth === ym) ?? null,
        eff: resolvePrice(rows, meta.key, ym, null, scope || null),
      })
    }
  }
  return groups
}

// 版本状态组装(§6 右栏上卡+工具栏月变价徽标):选定月电价版本 n/6+缺失清单、
// 各组生效键计数、全簿最近更新(max updatedAt+费项名)。均按非户级行统计。
export interface VersionStatus {
  monthlyHit: number
  monthlyTotal: number
  monthlyMissing: string[]  // 缺当月版本的电价键 label 清单
  groups: { group: string; effective: number; total: number }[]
  latest: { label: string; updatedAt: string } | null
}
export function buildVersionStatus(rows: PriceCfgDTO[], ym: string): VersionStatus {
  const nonTenant = rows.filter(r => !r.scope.startsWith('tenant:'))
  const hasVersion = (meta: PriceKeyMeta) =>
    nonTenant.some(r => r.cfgKey === meta.key &&
      (meta.monthly ? r.acctMonth === ym : r.acctMonth <= ym))
  const monthlyMetas = PRICE_KEYS.filter(k => k.monthly)
  const monthlyMissing = monthlyMetas.filter(k => !hasVersion(k)).map(k => k.label)
  const groups: VersionStatus['groups'] = []
  for (const meta of PRICE_KEYS) {
    let g = groups[groups.length - 1]
    if (!g || g.group !== meta.group) { g = { group: meta.group, effective: 0, total: 0 }; groups.push(g) }
    g.total++
    if (hasVersion(meta)) g.effective++
  }
  const labelOf = new Map(PRICE_KEYS.map(k => [k.key, k.label]))
  let latest: VersionStatus['latest'] = null
  for (const r of rows)
    if (!latest || r.updatedAt > latest.updatedAt)
      latest = { label: labelOf.get(r.cfgKey) ?? r.cfgKey, updatedAt: r.updatedAt }
  return {
    monthlyHit: monthlyMetas.length - monthlyMissing.length,
    monthlyTotal: monthlyMetas.length,
    monthlyMissing, groups, latest,
  }
}
