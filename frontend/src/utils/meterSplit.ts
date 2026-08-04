// 园区抄表 v2 结构化档案纯函数(METER-SPEC §6.2/§6.3,spec 锁定):
// splitTenantSpot 租户名/方位拆分、classifyOwnership 归属自动分类、buildingIdFor 区域→楼栋映射。
// 租户库 = tenants api companyName 全量;多命中不自动挂(multi=true → tenant_id 置空、预览标「待核」)。

export type MeterOwnership = 'tenant' | 'share' | 'ops' | 'infra' | 'park' | 'register'
export const OWNERSHIP_LABEL: Record<MeterOwnership, string> = {
  tenant: '租户', share: '园区公摊', ops: '园区经营', infra: '配电总表', park: '园区自担',
  register: '计度寄存器',
}
// infra 的展示名按表类分流:电=配电总表,水=供水总表(2026-08-04 报障:水表列表挂"配电总表"徽标)
export const ownershipLabel = (o: string, kind?: string | null): string =>
  o === 'infra' && kind === 'water' ? '供水总表'
    : (OWNERSHIP_LABEL[o as MeterOwnership] ?? o)

// 分表Σ成员(§8.2):租户+公摊+park 园区自担。park 不收租户不进公摊池,但物理挂在楼栋分表下,
// 必须进「区块/楼栋用量合计」——与后端 AllocService.inSubSigma(损耗组 D)同一口径,勿分叉。
// infra 不计(与分表重复)、ops 不计(园区经营非收费口径)。
// §F7:suspect='shadow'(疑似重复建档)与后端一并排除——同一块物理表两份档案各带一条读数,计两次是凭空多的用量
// (A座 2024-02 抄表屏曾比损耗屏多 107.80)。'incomplete'(档案不全但配不到重复对手)**照算**,
// 排掉会让 5 块挂栋的 p2 临电长期少计。参数收整块表,只为读 suspect,判定仍只看 ownership+suspect。
// 刀H §H2(V79):ownership='register'(非计费计度寄存器)由下面这个白名单天然排除 —— 与后端同口径。
export function inSubSigma(m: { ownership: string; suspect?: string | null }): boolean {
  if (m.suspect === 'shadow') return false
  const o = m.ownership
  return o === 'tenant' || o === 'share' || o === 'park'
}

// 方位特征正则(§6.2):东西南北侧/高低区/门口/楼层室栋座/尾部房号
export const SPOT_RE = /(东|西|南|北)侧|高区|低区|门口|负?\d+[-—–]?\d*(楼|层|室|栋|座)|\d+[A-Za-z]?\d*室?$/
// 方位型(SPOT_RE 的子集,整串匹配):位置列已给出位置时,只有这些才允许再拼到 spot 尾部。
// 楼层/房号型不在内 —— 位置列已经是楼层,再拼一个只会得到 '天面 1' 这种把同层裂开的键。
export const SPOT_DIR_RE = /^((东|西|南|北)侧|高区|低区|门口)$/

export interface TenantSpotSplit {
  tenant: string | null   // 唯一命中的库内全名;未命中/多命中 = null
  spot: string | null
  multi: boolean          // 多命中(如 邓宇峰×3)→ 待核
}

// 匹配优先级(§6.2):全等 > 库名唯一包含候选(锂朋→锂朋科技) > 候选唯一包含库名;
// 每级 ≥2 命中即 multi 停止,不落到下一级。包含匹配要求候选 ≥2 字,防单字误挂。
function matchTenant(cand: string, names: string[]): { name: string | null; multi: boolean } {
  if (!cand) return { name: null, multi: false }
  if (names.includes(cand)) return { name: cand, multi: false }
  if (cand.length >= 2) {
    for (const pred of [(n: string) => n.includes(cand), (n: string) => cand.includes(n)]) {
      const hits = names.filter(pred)
      if (hits.length === 1) return { name: hits[0], multi: false }
      if (hits.length > 1) return { name: null, multi: true }
    }
  }
  return { name: null, multi: false }
}

export function splitTenantSpot(raw: string, tenantNames: string[]): TenantSpotSplit {
  const s = String(raw ?? '').trim()
  if (!s) return { tenant: null, spot: null, multi: false }
  // 括号「X（Y）」(全半角均认):两段先各自全等匹配→命中者为租户、另一段为方位;都命中取 X
  const m = s.match(/^(.+?)[（(]([^（()）]+)[）)]$/)
  if (m) {
    const x = m[1].trim(), y = m[2].trim()
    if (tenantNames.includes(x)) return { tenant: x, spot: y || null, multi: false }
    if (tenantNames.includes(y)) return { tenant: y, spot: x || null, multi: false }
    // 都不命中:方位正则判方位段,余段为租户候选(默认括号内为方位,如 邓宇峰（高区）)
    const [cand, spot] = SPOT_RE.test(x) && !SPOT_RE.test(y) ? [y, x] : [x, y]
    const r = matchTenant(cand, tenantNames)
    return { tenant: r.name, spot: spot || null, multi: r.multi }
  }
  // 无括号连写(桑尼号西侧):从尾部剥方位后缀,剩余对库匹配
  const tail = s.match(new RegExp(`(${SPOT_RE.source})$`))
  const spot = tail ? tail[0] : null
  const cand = spot ? s.slice(0, s.length - spot.length).trim() : s
  const r = matchTenant(cand, tenantNames)
  return { tenant: r.name, spot, multi: r.multi }
}

// 归属自动分类(§6.3):infra > 公摊显式标记 > tenant > share/ops 关键词 > 默认 share(档案可改)。
// name 传关键词判定文本(调用方拼 标识名+企业名称原文,关键词落在哪个字段都吃得到)。
// ⚠公摊标记必须先于租户命中:一期跟户公摊表命名为「公共用电/租户名」(受益人挂名),
// 租户匹配器会命中租户名——曾致 27 块楼层公共分表误挂租户(2026-07-28 数据修复,plan 留档)。
// 园区自担关键词(V68,依据一期册专表「创显承担电费」行):这些表园区自己吃,不向租户收也不进公摊池。
// 必须先于 share 判定(门岗/消防中控室/监控室 的 meter_type 是「公共用电/未分摊」会被 share 规则吃掉),
// 但「已分摊」标记优先——同专表里 车库照明/生活加压泵/A座一楼大堂/招商中心电2 标注已分摊,是真公摊。
const PARK_SELF_RE = /创显|物业部办公室|门岗|监控室|人才港|消防中控室/

// 刀H §H2(V79)计度寄存器关键词:反向有功/正向无功/反向无功/需量/最大需量 是**电表寄存器的标准叫法**,
// 一块物理表除正向有功电量外还计这些附属量,它们不是用电量。判据窄且是行业术语,不会误伤真表
// (全库盘查 2026-07-31:仅「永龙反向有功」一行命中)。必须最先判 —— 名字里带租户名(永龙)会先被租户匹配吃掉,
// 曾让 15527 度「反向有功」当成三车间租户用电进 building 32 的分表Σ(占 32.4%)。
const REGISTER_RE = /反向有功|正向无功|反向无功|需量|最大需量/

export function classifyOwnership(meterType: string | undefined, name: string, tenantMatched: boolean): MeterOwnership {
  const t = meterType ?? ''
  if (REGISTER_RE.test(name)) return 'register'
  if (/总|变压器/.test(t) || /连接|馈/.test(name)) return 'infra'
  if (!/已分摊/.test(t) && PARK_SELF_RE.test(name)) return 'park'
  if (/公共用电|已分摊|未分摊/.test(t) || /公共用电|公共电/.test(name)) return 'share'
  if (/户内/.test(t) || tenantMatched) return 'tenant'
  if (/消防|电梯|楼道|照明|路灯|大堂|低压电房/.test(name)) return 'share'
  if (/水泵|生活泵|绿化|办公|闸机|保安|门禁|招商|充电/.test(name)) return 'ops'
  return 'share'
}

// 区域→楼栋映射(§6.3 + BUILDING-RESTRUCTURE-SPEC §3.4,楼栋重建后逐栋细分,name 匹配):未命中 → null 档案可改。
// $1 = 捕获组代入(宿舍中文数字栋/A-G座/一~六车间);跨栋与公共(B-G座总表/三\/四栋/园区/路灯/招商中心/钢构车间/铝缆)不挂栋。
const AREA_BUILDING: { re: RegExp; name: string; dormOnly?: boolean }[] = [
  { re: /^([一二三四])栋/, name: '一期 宿舍$1栋', dormOnly: true },   // 中文数字栋(修 v1 /\d+栋/ 只认阿拉伯数字缺陷)
  { re: /(?<![A-G]-)([A-G])座/, name: '一期 $1座' },                  // lookbehind 排除 B-G座 总表
  { re: /招商中心/, name: '一期 招商中心' },                           // 2026-07-28 补建楼栋(账册独立区域,曾漏建致 13 块表未挂)
  { re: /空地/, name: '一期 空地' },
  { re: /([一二三四五六])车间/, name: '二期 $1车间' },
  { re: /创业大厦/, name: '三期 创业大厦' },
  { re: /工业大厦/, name: '三期 工业大厦' },
]
const norm = (s: string) => s.replace(/\s+/g, '')

export function buildingIdFor(zone: string, area: string | undefined, buildings: { id: number; name: string }[]): number | null {
  const a = area ?? ''
  if (!a) return null
  for (const r of AREA_BUILDING) {
    if (r.dormOnly && zone !== 'dorm') continue
    const m = r.re.exec(a)
    if (!m) continue
    const t = norm(m[1] ? r.name.replace('$1', m[1]) : r.name)
    const b = buildings.find(x => norm(x.name) === t)
      ?? buildings.find(x => t.includes(norm(x.name)) || norm(x.name).includes(t))   // 库内名无期数前缀等变体兜底
    return b?.id ?? null
  }
  return null
}
