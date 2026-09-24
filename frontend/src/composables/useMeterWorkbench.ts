// 园区抄表 v5 工作台纯函数层(METER-V5-SPEC §5+§7 v5.1):rows 合流(meters×readings×binding)、
// 状态最差优先派生、统计卡口径(各维独立计数,不受徽标优先级影响)、筛选链、
// Σ段实时校验、楼栋合计/损耗(复用 meterGroup 计算函数)、楼栋分组汇总行(§7.6)、草稿式编辑(draft 取值/脏行/用量重算/
// 校验红显/保存请求构造/tfoot 页脚)。全部纯函数,useMeterWorkbench.spec.ts 锁定。
// v4 useMeterFilters(搜索/待核/占位口径)与 meterBindQueue(桶映射/一键挂预估)的可复用逻辑并入本文件。
import type {
  MeterDTO, MeterReadingDTO, MeterReadingReq, MeterBindingRowDTO, BindBucket, BindStatus, MeterRowSrc,
} from '@/api/meters'
import { EARLIEST } from '@/views/meters/meterTimeline'
import { readingFlags, type MeterReadingFlags } from '@/utils/meterLogic'
import { groupMeterBlocks, blockLoss, sideRank, roomRank, type BlockSums, type BlockLoss, type MeterLoc } from '@/utils/meterGroup'
import { inSubSigma } from '@/utils/meterSplit'
import { zoneLabel } from '@/utils/zoneLabel'

// ── 搜索/待核/占位口径(迁自 v4 useMeterFilters,S2-BIND-SPEC §2) ──────────────

export interface SearchableMeter {
  name: string
  subName: string | null
  code: string | null
  spot: string | null
  tenantName: string | null
}

// 搜索匹配:租户名(库内全名)/企业名称原文/房号(spot)/表号(subName)/编码;标识名(name)保留 v3 语义
export function meterSearchHit(m: SearchableMeter, kw: string, fullName?: string | null): boolean {
  if (!kw) return true
  const hit = (s: string | null | undefined) => !!s && s.includes(kw)
  return m.name.includes(kw) || hit(m.subName) || hit(m.code) || hit(m.spot)
    || hit(m.tenantName) || hit(fullName)
}

// 占位槽原文判定:NULL/'-'/'（空）'/'已停用' 等无意义原文 → 不计入待核
export function isMeaningfulName(s: string | null | undefined): boolean {
  const t = (s ?? '').trim()
  return t !== '' && t !== '-' && t !== '—' && t !== '（空）' && t !== '(空)' && !t.includes('已停用')
}

// METER-TIMELINE-SPEC §1.3:站在该月的状态段(MeterDTO.status 已是 list(ym) 投影好的那一段)。
// 在用 / 停用 = 在册上(停用照常显示,只是不进各分母);已拆 / 还没有状态段 = 本月不在册,
// 只在「已拆」「未在册」「本月有变化」三个筛选项里出现。
export type OffRegister = 'removed' | 'notYet'
export function offRegister(m: Pick<MeterDTO, 'status'>): OffRegister | null {
  return m.status === 'removed' ? 'removed' : m.status == null ? 'notYet' : null
}

// 待核:租户表 + 未挂 tenant_id + 原文有意义
export function isPendingMeter(m: { ownership: string; tenantId: number | null; tenantName: string | null }): boolean {
  return m.ownership === 'tenant' && m.tenantId == null && isMeaningfulName(m.tenantName)
}

// 占位槽:租户表 + 未挂 + 原文无意义(空/停用槽位)
export function isPlaceholderMeter(m: { ownership: string; tenantId: number | null; tenantName: string | null }): boolean {
  return m.ownership === 'tenant' && m.tenantId == null && !isMeaningfulName(m.tenantName)
}

// ── 行合流(§5 rows 组装) ─────────────────────────────────────────────────────

export interface PrevSegs { sharp: number | null; peak: number | null; flat: number | null; valley: number | null }

export interface WorkbenchRow {
  m: MeterDTO
  r: MeterReadingDTO | null           // 选定月读数
  prevR: MeterReadingDTO | null       // 上月读数(prev 基准/新建预填)
  bind: MeterBindingRowDTO | null     // 绑定报表行(后端未就绪/非租户表=null)
  tenantLabel: string | null          // 库内全名 > 企业名称原文
  // 底数:有本月读数 = 它自己的上月行至(后端算用量只认这一格);没有 = 上月读数的本月行至(新录时预填)
  prevTotal: number | null
  prevSegs: PrevSegs                  // 同上,四段
  factor: number                      // 有读数=录入时倍率快照;无=档案倍率
  flags: MeterReadingFlags            // 漏抄/倒走/时段不符(meterLogic)
  pending: boolean                    // 待核
  placeholder: boolean                // 占位槽
  retired: boolean                    // 本月在停用段(照常显示,只是不进各分母)
  off: OffRegister | null             // 本月不在册:已拆 / 还没有状态段
  noBase: boolean                     // 缺底数:有本月行至、没有上月行至(算不出用量,不算已抄)
  zoneOdd: boolean                    // 表档案写的期区 ≠ 它挂的楼栋的期区(两个字段自相矛盾)
  unbound: boolean                    // 待绑定:binding manual(各桶)+override_stale
  ready: boolean                      // 派生就绪:auto+auto_bld+override
  tou: boolean                        // 分时表:电表且 本月/上月读数带任一分时段
  book: BookMark                      // 本月导入的册子里有没有这块表(SPEC §10.4,按期区×表类判)
  status: RowStatus
}

// SPEC §10.4:seen = 本月册子里有这块表;missing = 同期区同表类这个月有记录、唯独没有它;
// none = 同期区同表类这个月一笔都没有(不逐行打标,表格上方一句)。
// 不进 rowStatus:它与已抄 / 待核等并存,是另一条轴。
export type BookMark = 'seen' | 'missing' | 'none'

export type RowStatus =
  | 'pending' | 'unbound' | 'touMismatch' | 'negative' | 'missing' | 'read' | 'placeholder' | 'retired'
  | 'zoneOdd' | 'noBase' | OffRegister

export const STATUS_META: Record<RowStatus, { label: string; cls: string }> = {
  removed: { label: '已拆', cls: 'dim' },
  notYet: { label: '未在册', cls: 'dim' },
  retired: { label: '已停用', cls: 'dim' },
  noBase: { label: '缺底数', cls: 'amber' },
  zoneOdd: { label: '期区对不上', cls: 'bad' },
  read: { label: '已抄', cls: 'ok' },
  missing: { label: '未抄', cls: 'amber' },
  negative: { label: '倒走', cls: 'bad' },
  touMismatch: { label: '时段不符', cls: 'bad' },
  pending: { label: '待核', cls: 'coral' },
  unbound: { label: '待绑定', cls: 'coral' },
  placeholder: { label: '占位', cls: 'dim' },
}

const NO_READING = { currTotal: null, usageTotal: null, usageSharp: null, usagePeak: null, usageFlat: null, usageValley: null }
const hasSegs = (r: MeterReadingDTO | null) =>
  !!r && [r.prevSharp, r.prevPeak, r.prevFlat, r.prevValley, r.currSharp, r.currPeak, r.currFlat, r.currValley]
    .some(v => v != null)

// 状态列单徽标,最差优先:待核＞待绑定＞时段不符＞倒走＞未抄＞已抄＞占位。
// 占位槽不计未抄/已抄(v4 summarizeBinding 同口径),故 placeholder 判定先于 missing/read;
// 对非占位行两序等价,规范列出的优先序原样保持。
export function rowStatus(
  x: Pick<WorkbenchRow, 'pending' | 'unbound' | 'placeholder' | 'retired' | 'flags' | 'r'>
    & Partial<Pick<WorkbenchRow, 'zoneOdd' | 'off' | 'noBase'>>): RowStatus {
  if (x.off) return x.off           // 本月不在册:其余维度都无意义
  if (x.retired) return 'retired'   // 停用:本月不在服务中,其余维度无意义
  // 期区对不上排第二:这一行连站在哪个页签里都不对,待核/待绑定都是后话。
  // (2026-09-23 南盛物流案:一期抄表里出现一行二车间,半年无人发觉)
  if (x.zoneOdd) return 'zoneOdd'
  if (x.pending) return 'pending'
  if (x.unbound) return 'unbound'
  if (x.flags.touMismatch) return 'touMismatch'
  if (x.flags.negative) return 'negative'
  if (x.placeholder) return 'placeholder'
  if (x.r?.currTotal == null) return 'missing'
  if (x.noBase) return 'noBase'
  return 'read'
}

const UNBOUND_STATUS = new Set<BindStatus>(['manual', 'override_stale'])
const READY_STATUS = new Set<BindStatus>(['auto', 'auto_bld', 'override'])

export function buildRows(
  meters: MeterDTO[],
  readings: MeterReadingDTO[],
  prevReadings: MeterReadingDTO[],
  bindRows: MeterBindingRowDTO[] | null,
  tenantNameById?: Map<number, string>,
): WorkbenchRow[] {
  const rByMeter = new Map(readings.map(r => [r.meterId, r]))
  const pByMeter = new Map(prevReadings.map(r => [r.meterId, r]))
  const bByMeter = new Map((bindRows ?? []).map(b => [b.meterId, b]))
  const booked = new Set(meters.filter(m => m.bookSeen).map(bookKey))
  // 不在册的表(已拆 / 还没有状态段)也产行,由 matchStatus 挡在「全部」和各分母之外 ——
  // 它们只在自己那两个筛选项里出现,点开能改回来(旧版不产行,设错一格就在所有月份找不回来)
  return meters.map(m => {
    const r = rByMeter.get(m.id) ?? null
    const prevR = pByMeter.get(m.id) ?? null
    const bind = bByMeter.get(m.id) ?? null
    const pending = isPendingMeter(m)
    const placeholder = isPlaceholderMeter(m)
    const unbound = !!bind && UNBOUND_STATUS.has(bind.status)
    const flags = readingFlags(r ?? NO_READING)
    // 有本月读数就只认它自己的上月行至:后端算用量只看这一格,拿上月读数顶上去会显出一个不存在的底数
    const prevTotal = r ? r.prevTotal : prevR?.currTotal ?? null
    const x: WorkbenchRow = {
      m, r, prevR, bind,
      tenantLabel: m.tenantId != null ? (tenantNameById?.get(m.tenantId) ?? m.tenantName) : m.tenantName,
      prevTotal,
      prevSegs: r
        ? { sharp: r.prevSharp, peak: r.prevPeak, flat: r.prevFlat, valley: r.prevValley }
        : {
            sharp: prevR?.currSharp ?? null, peak: prevR?.currPeak ?? null,
            flat: prevR?.currFlat ?? null, valley: prevR?.currValley ?? null,
          },
      factor: r?.factorSnap ?? m.factor,
      flags, pending, placeholder, unbound,
      retired: m.status === 'retired',
      off: offRegister(m),
      noBase: r?.currTotal != null && prevTotal == null,
      // 两边都有值才比 —— 没挂楼栋(buildingZone 空)不算矛盾
      zoneOdd: !!m.buildingZone && m.buildingZone !== m.zone,
      ready: !!bind && READY_STATUS.has(bind.status),
      tou: m.kind === 'elec' && (hasSegs(r) || hasSegs(prevR)),
      book: m.bookSeen ? 'seen' : booked.has(bookKey(m)) ? 'missing' : 'none',
      status: 'read',
    }
    x.status = rowStatus(x)
    return x
  })
}

// 状态 tooltip:列全维度(徽标只显最差一维,悬停出全部命中维度)
export function statusDims(x: WorkbenchRow): string {
  const dims: string[] = []
  // 按状态段说话(SPEC §6):停用 2024-03 ~ 2024-08 / 自 2024-09 起已拆
  if (x.off === 'removed') return `自 ${x.m.statusFrom} 起已拆:本月不在册上,不进抄表进度与公摊分母`
  if (x.off === 'notYet') return '本月还不在册:不进抄表进度与公摊分母'
  if (x.retired) return `${x.m.statusUntil ? `停用 ${x.m.statusFrom} ~ ${x.m.statusUntil}` : `自 ${x.m.statusFrom} 起停用`}`
    + ':这几个月不进抄表进度与公摊分母(表仍在册上显示)'
  if (x.zoneOdd) dims.push(`期区对不上:表的档案写着${zoneLabel(x.m.zone)},`
    + `它挂的楼栋却在${zoneLabel(x.m.buildingZone ?? '')}。`
    + `筛期区用的是前者、位置显示用的是后者,所以它会出现在不对的页签里。请核对原册`)
  if (x.pending) dims.push('待核:企业名称原文未匹配租户档案')
  if (x.unbound) dims.push(`待绑定:${x.bind?.status !== 'override_stale' ? BIND_BUCKET_LABEL[x.bind?.bucket ?? 'no_contract']
    : x.bind.contractId == null && x.bind.pinnedContractNo
      ? `人工绑定的 ${x.bind.pinnedContractNo} 不是这一段租户的合同,没有采用`   // 换户后没重钉(SPEC §3.6)
      : '绑的那份合同本月没生效'}`)
  if (x.flags.touMismatch) dims.push('时段不符:尖峰平谷用量之和与总用量不符')
  if (x.flags.negative) dims.push('倒走:总用量为负,疑换表/抄错')
  if (x.placeholder) dims.push('占位槽:空/停用原文,不计入待核与抄表进度')
  else if (x.r?.currTotal == null) dims.push('未抄:本月总示数为空')
  else dims.push(x.noBase ? '缺底数:有本月行至、没有上月行至,算不出用量,不算已抄' : '已抄')
  return dims.join(' · ')
}

// ── 本月册子已核(SPEC §10.4) ──
const bookKey = (m: Pick<MeterDTO, 'zone' | 'kind'>) => `${m.zone}|${m.kind}`
const kindBook = (k: string) => (k === 'water' ? '水表' : '电表')
const BOOK_SRC: Record<MeterRowSrc, string> = { migrate: '按旧档案补记', import: '导入', manual: '手改', contract: '合同终止' }
// 记录是这一版上线后才开始记的(SPEC §10.2 不回填):更早导入过的月份也会显示成「没有」
export const BOOK_REDO = '上线前的导入没有记下册子里有哪些表:把那个月的册子再导一次就能标上,值没变的档案不会被改。'

// 企业名称旁的小标签「本月册子没有」的悬停;null = 不打标。
// 停用 / 不在册的行不打(同待核:本月不在服务中),与「本月册子里没有」筛选同口径。
export function bookTip(x: WorkbenchRow): string | null {
  if (x.book !== 'missing' || x.off || x.retired) return null
  const from = x.m.assignFrom === EARLIEST ? '最早' : `自 ${x.m.assignFrom} 起`
  return `这个月导入的册子里没有这块表;显示的是${from}那一行(${BOOK_SRC[x.m.assignSrc!]})`
}

// 表格上方那一句:给定行里「一笔都没有」的期区 × 表类合成一句;没有 = ''
export function bookGapText(rows: WorkbenchRow[]): string {
  const zones = new Map<string, Set<string>>()   // 表类 → 这个月一笔都没有的期区
  for (const x of rows) {
    if (x.book !== 'none') continue
    if (!zones.has(x.m.kind)) zones.set(x.m.kind, new Set())
    zones.get(x.m.kind)!.add(x.m.zone)
  }
  if (!zones.size) return ''
  const what = [...zones].map(([k, zs]) => `${[...zs].map(zoneLabel).join('、')}的${kindBook(k)}`).join('、')
  return `这个月还没导入过${what}册子,这些表的档案都是沿用的。${BOOK_REDO}`
}

// 抽屉「档案变更」页签顶部那一句
export function bookLine(x: WorkbenchRow): string {
  if (x.book === 'seen')
    return `本月册子:${x.m.bookFile ?? '文件名没有记下'} · ${(x.m.bookAt ?? '').replace('T', ' ').slice(0, 16)}`
  if (x.book === 'missing') return '这个月导入的册子里没有这块表'
  return `这个月还没导入过${zoneLabel(x.m.zone)}的${kindBook(x.m.kind)}册子。${BOOK_REDO}`
}

// ── 统计卡与状态筛选(§1:各卡独立计数;点卡=互斥设置状态筛选) ────────────────

export type StatusFilter =
  | 'all' | RowStatus            // 状态 Select 各项
  | 'tenant' | 'anomaly' | 'attention' | 'ready'   // 统计卡粗粒度维度
  | 'changed'                    // 本月有变化:该表在本月有自己的归属行 / 状态行,且与上一行不同(后端判)
  | 'bookMissing'                // 本月册子里没有:同期区同表类这个月导入过册子,唯独没有这块表(= 打了标签的行)

// 维度谓词:统计卡计数与状态筛选共用同一口径。
// 已抄/未抄以租户表为分母(标题行进度条口径:总数=已抄+未抄;缺底数算未抄),非租户表读数经 归属 筛选查看。
// 停用表:除「已停用」筛选项外全维排除(「全部」照常显示,统计卡分母排除,一处生效)。
// 不在册的表(已拆 / 未在册):连「全部」都不出现,只在自己那一项和「本月有变化」里。
export function matchStatus(x: WorkbenchRow, s: StatusFilter): boolean {
  // 本月起停用 / 已拆也是本月的变化,所以排在不在册、停用那两道闸前面
  if (s === 'changed') return x.m.changedThisMonth
  if (s === 'removed' || s === 'notYet') return x.off === s
  if (x.off) return false
  if (s === 'retired') return x.retired
  // 停用行「全部」筛选照常显示(2026-08-04 用户裁定:停用=这个月还在只是不用,须在表格可见);
  // 其余统计维度(租户表/已抄/未抄/待核…)仍排除=不进任何分母
  if (s === 'all') return true
  if (x.retired) return false
  switch (s) {
    case 'tenant': return x.m.ownership === 'tenant'
    case 'read': return x.m.ownership === 'tenant' && x.r?.currTotal != null && !x.noBase
    case 'missing': return x.m.ownership === 'tenant' && (x.r?.currTotal == null || x.noBase)
    case 'noBase': return x.noBase
    case 'negative': return x.flags.negative
    case 'touMismatch': return x.flags.touMismatch
    case 'anomaly': return x.flags.negative || x.flags.touMismatch
    case 'pending': return x.pending
    case 'unbound': return x.unbound
    case 'attention': return x.pending || x.unbound
    case 'placeholder': return x.placeholder
    case 'ready': return x.ready
    // 期区对不上:不进任何统计卡口径(它不是抄表的一个环节,是档案坏了),
    // 但状态下拉里能单独筛出来查。
    case 'zoneOdd': return x.zoneOdd
    // 不进统计卡;停用 / 不在册已被上面两道闸挡掉,与 bookTip 打标同口径
    case 'bookMissing': return x.book === 'missing'
  }
}

export interface CardCounts {
  tenant: number; read: number; missing: number
  negative: number; touMismatch: number; anomaly: number
  pending: number; unbound: number; ready: number
}

export function cardCounts(rows: WorkbenchRow[]): CardCounts {
  const c: CardCounts = { tenant: 0, read: 0, missing: 0, negative: 0, touMismatch: 0, anomaly: 0, pending: 0, unbound: 0, ready: 0 }
  for (const x of rows) {
    for (const k of Object.keys(c) as (keyof CardCounts)[]) {
      if (matchStatus(x, k)) c[k]++
    }
  }
  return c
}

export interface WorkbenchFilter {
  kind: string
  zone: string           // 'all' | p1/p2/dorm
  building: string       // 'all' | String(buildingId)
  own: string            // 'all' | tenant/share/ops/infra
  status: StatusFilter
  q: string
}

export function filterRows(rows: WorkbenchRow[], f: WorkbenchFilter): WorkbenchRow[] {
  const kw = f.q.trim()
  return rows.filter(x =>
    x.m.kind === f.kind
    && (f.zone === 'all' || x.m.zone === f.zone)
    && (f.building === 'all' || String(x.m.buildingId ?? '') === f.building)
    && (f.own === 'all' || x.m.ownership === f.own)
    && matchStatus(x, f.status)
    && meterSearchHit(x.m, kw, x.tenantLabel))
}

// ── Σ段实时校验(时段不符口径,容差同 meterLogic:max(1, |总|×1%)) ──────────────

const round2 = (v: number) => Math.round(v * 100) / 100

// 单段用量:(本段本月−本段上月)×倍率;任一端缺=null
export function segUsage(prev: number | null, curr: number | null, factor: number): number | null {
  if (prev == null || curr == null) return null
  return round2((curr - prev) * factor)
}

export interface SegCheckResult {
  segSum: number | null    // Σ四段用量;任一段缺=null
  total: number | null     // 总用量 (currTotal−prevTotal)×factor
  diff: number | null      // Σ段−总
  ok: boolean | null       // null=不可判(段/总未齐);容差同 meterLogic:max(1, |总|×1%)
}

export function segCheck(
  prevSegs: (number | null)[], currSegs: (number | null)[],
  prevTotal: number | null, currTotal: number | null, factor: number,
): SegCheckResult {
  const usages = prevSegs.map((p, i) => segUsage(p, currSegs[i] ?? null, factor))
  const segSum = usages.every(u => u != null) ? round2(usages.reduce((s, u) => s + u!, 0)) : null
  const total = segUsage(prevTotal, currTotal, factor)
  if (segSum == null || total == null) return { segSum, total, diff: null, ok: null }
  const diff = round2(segSum - total)
  return { segSum, total, diff, ok: Math.abs(diff) <= Math.max(1, Math.abs(total) * 0.01) }
}

// ── 草稿式编辑(§7 v5.1):draft 归属 MeterView,本层只提供纯函数 ─────────────────

export type CurrField = 'currTotal' | 'currSharp' | 'currPeak' | 'currFlat' | 'currValley'
export const CURR_FIELDS: readonly CurrField[] = ['currTotal', 'currSharp', 'currPeak', 'currFlat', 'currValley']
// 上月行至只在「没有底数」的行上开放录入(SPEC §3.4:新表首月录起始底数)
export type PrevField = 'prevTotal' | 'prevSharp' | 'prevPeak' | 'prevFlat' | 'prevValley'
export const PREV_FIELDS: readonly PrevField[] = ['prevTotal', 'prevSharp', 'prevPeak', 'prevFlat', 'prevValley']
export type DraftField = CurrField | PrevField
const PREV_SEG: Record<PrevField, keyof PrevSegs | null> =
  { prevTotal: null, prevSharp: 'sharp', prevPeak: 'peak', prevFlat: 'flat', prevValley: 'valley' }
// 单表草稿:字段→输入框原文(''=清空该值);未编辑字段缺席
export type MeterDraft = Partial<Record<DraftField, string>>

export function numOrNull(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

type DraftBase = Pick<WorkbenchRow, 'r' | 'prevTotal' | 'prevSegs'>
// 服务器侧的值:本月行至取本月读数;上月行至取行上的底数(见 WorkbenchRow.prevTotal)
export function serverVal(x: DraftBase, f: DraftField): number | null {
  if (f in PREV_SEG) {
    const k = PREV_SEG[f as PrevField]
    return k ? x.prevSegs[k] : x.prevTotal
  }
  return x.r?.[f as CurrField] ?? null
}

// 有效值:草稿在场取草稿(非法文本视 null),否则服务器值
export function effVal(x: DraftBase, d: MeterDraft | undefined, f: DraftField): number | null {
  const raw = d?.[f]
  if (raw != null) return numOrNull(raw)
  return serverVal(x, f)
}

// 行上开不开「上月行至」输入:按服务器侧判(敲着字不会让格子消失)
export const baseOpen = (x: Pick<WorkbenchRow, 'prevTotal'>) => x.prevTotal == null

// 脏行判定:任一格草稿数值与服务器不等(数值等价如 "5"=5 不算脏)
export function draftRowDirty(x: DraftBase, d: MeterDraft | undefined): boolean {
  if (!d) return false
  return [...CURR_FIELDS, ...PREV_FIELDS].some(f => d[f] != null && numOrNull(d[f]!) !== serverVal(x, f))
}

export function draftDirtyIds(rows: WorkbenchRow[], draft: Map<number, MeterDraft>): number[] {
  if (draft.size === 0) return []
  return rows.filter(x => draftRowDirty(x, draft.get(x.m.id))).map(x => x.m.id)
}

// 用量列实时重算:总示数(本月或底数)被草稿改动时按 (本月−上月)×倍率,否则用服务器派生 usageTotal
export function rowUsage(x: DraftBase & Pick<WorkbenchRow, 'factor'>, d: MeterDraft | undefined): number | null {
  if (d?.currTotal != null || d?.prevTotal != null)
    return segUsage(effVal(x, d, 'prevTotal'), effVal(x, d, 'currTotal'), x.factor)
  return x.r?.usageTotal ?? null
}

// 校验红显(§7.4,只标不拦保存):倒走(用量<0);电表时段不符(segCheck 口径,段/总齐才可判)
export function draftRowIssues(x: WorkbenchRow, d: MeterDraft | undefined): string[] {
  const issues: string[] = []
  const u = rowUsage(x, d)
  if (u != null && u < 0) issues.push('倒走:总用量为负,疑换表/抄错')
  if (x.m.kind === 'elec') {
    const c = segCheck(
      [effVal(x, d, 'prevSharp'), effVal(x, d, 'prevPeak'), effVal(x, d, 'prevFlat'), effVal(x, d, 'prevValley')],
      [effVal(x, d, 'currSharp'), effVal(x, d, 'currPeak'), effVal(x, d, 'currFlat'), effVal(x, d, 'currValley')],
      effVal(x, d, 'prevTotal'), effVal(x, d, 'currTotal'), x.factor)
    if (c.ok === false) issues.push(`时段不符:Σ段 ${c.segSum} ≠ 总 ${c.total}(差 ${c.diff})`)
  }
  return issues
}

// 保存请求(§7.2):十格一律取有效值 —— 有读数=服务器行打底(note 保留),无读数=上月行至预填;草稿覆写
export function draftReq(x: WorkbenchRow, d: MeterDraft | undefined, ym: string): MeterReadingReq {
  const req: MeterReadingReq = { meterId: x.m.id, ym: x.r?.ym ?? ym, note: x.r?.note ?? null }
  for (const f of [...PREV_FIELDS, ...CURR_FIELDS]) req[f] = effVal(x, d, f)
  return req
}

// 本月还不在册的表录了本月读数:保存时后端会让它自本月起在册(SPEC §3.4 自愈,本月止任一格非空才算)。
// 屏上要先说一声,不能悄悄把一块表挂上册。
// 只算本月还没有读数的表:自愈只在新录一条(createReading)时发生,改已有的读数(updateReading)不补在册 ——
// 撤销导入留下的自动建档表、第一行状态被挪晚的表都会是「不在册却有读数」,对它们承诺在册就是假话。
export function healRows(rows: WorkbenchRow[], draft: Map<number, MeterDraft>): WorkbenchRow[] {
  return rows.filter(x => x.off === 'notYet' && !x.r && draftRowDirty(x, draft.get(x.m.id))
    && CURR_FIELDS.some(f => effVal(x, draft.get(x.m.id), f) != null))
}

// tfoot 页脚(§7.1):已抄 = 本月总示数与底数都在(草稿实时,缺底数不算);Σ用量=当前筛选行草稿实时合计,全空=null
export interface GridFooter { read: number; missing: number; usageSum: number | null }

export function gridFooter(rows: WorkbenchRow[], draft: Map<number, MeterDraft>): GridFooter {
  let read = 0, missing = 0
  let usageSum: number | null = null
  for (const x of rows) {
    const d = draft.get(x.m.id)
    if (effVal(x, d, 'currTotal') != null && effVal(x, d, 'prevTotal') != null) read++
    else missing++
    const u = rowUsage(x, d)
    if (u != null) usageSum = round2((usageSum ?? 0) + u)
  }
  return { read, missing, usageSum }
}

// ── 楼栋分组汇总行(§7.6):按 buildingId 首现序稳定分组,组末汇总口径同 meterGroup §7.2 ──

export interface BuildingGroupUsage {
  total: number | null; sharp: number | null; peak: number | null; flat: number | null; valley: number | null
}
export interface BuildingGroup {
  key: string
  label: string               // 楼栋名;未挂='未挂楼栋'
  rows: WorkbenchRow[]        // 组内行(传入序原样)
  usage: BuildingGroupUsage   // 只汇 inSubSigma=tenant+share+park(infra 防重复/ops 非收费口径),随 draft 实时
}

// 段用量草稿口径同 rowUsage:该段被草稿改动按(本月−上月)×倍率,否则服务器派生
const SEG_MAP = [
  ['sharp', 'currSharp', 'usageSharp', 'prevSharp'],
  ['peak', 'currPeak', 'usagePeak', 'prevPeak'],
  ['flat', 'currFlat', 'usageFlat', 'prevFlat'],
  ['valley', 'currValley', 'usageValley', 'prevValley'],
] as const

// draft 是可选的第三参:分组与排序压根不看草稿(只读 ownership/位置/sortNo),给了才顺带把
// 组末汇总算上。MeterLedgerGrid 走「不给 draft + 单独调 groupUsage」两层,敲一个数字只重算
// 汇总,不再全量重分组重排序(P2 渲染开销铁律)。
export function groupByBuilding(
  rows: WorkbenchRow[],
  buildingNameById: Map<number, string>,
  draft?: Map<number, MeterDraft>,
): BuildingGroup[] {
  const groups: BuildingGroup[] = []
  const byKey = new Map<string, BuildingGroup>()
  for (const x of rows) {
    const id = x.m.buildingId
    const key = id == null ? 'none' : String(id)
    let g = byKey.get(key)
    if (!g) {
      g = {
        key,
        label: id == null ? '未挂楼栋' : (buildingNameById.get(id) ?? `楼栋#${id}`),
        rows: [],
        usage: { total: null, sharp: null, peak: null, flat: null, valley: null },
      }
      byKey.set(key, g)
      groups.push(g)
    }
    g.rows.push(x)
  }
  for (const g of groups) g.rows.sort(compareRowInBuilding)
  // 并列时用首现序兜底(保持稳定,不对未收录的楼栋名做字母重排)
  const seen = new Map(groups.map((g, i) => [g.key, i]))
  groups.sort((a, b) => buildingRank(a.label) - buildingRank(b.label) || seen.get(a.key)! - seen.get(b.key)!)
  if (draft) for (const g of groups) g.usage = groupUsage(g.rows, draft)
  return groups
}

// 组末汇总用量:只汇 inSubSigma=tenant+share+park(infra 防重复/ops 非收费口径),随 draft 实时
export function groupUsage(rows: WorkbenchRow[], draft: Map<number, MeterDraft>): BuildingGroupUsage {
  const u: BuildingGroupUsage = { total: null, sharp: null, peak: null, flat: null, valley: null }
  const acc = (k: keyof BuildingGroupUsage, v: number | null) => {
    if (v != null) u[k] = (u[k] ?? 0) + v
  }
  for (const x of rows) {
    if (!inSubSigma(x.m)) continue
    const d = draft.get(x.m.id)
    acc('total', rowUsage(x, d))
    for (const [k, c, sv, p] of SEG_MAP) {
      acc(k, d?.[c] != null || d?.[p] != null
        ? segUsage(effVal(x, d, p), effVal(x, d, c), x.factor) : (x.r?.[sv] ?? null))
    }
  }
  // 累加后统一 round2 防浮点尾差(meterGroup 同法)
  for (const k of ['total', 'sharp', 'peak', 'flat', 'valley'] as const) {
    const v = u[k]
    if (v != null) u[k] = round2(v)
  }
  return u
}

// ── 排序口径(用户 2026-07-30 报障:D座跑到 A座 前面、总表不在段首) ──
// 病灶=组序与行序都直接吃 meter.sort_no(导入序):V66 补档的「邱彩云东侧公共电」sort_no=0,
// 一块表就把整个 D座 拽到全页最前。改为按账册的固定顺序排,不再依赖导入序。
const BUILDING_SEQ = ['A座', 'B座', 'C座', 'D座', 'E座', 'F座', 'G座', '招商中心', '空地',
  '一车间', '二车间', '三车间', '四车间', '五车间', '六车间', '钢构车间',
  '宿舍一栋', '宿舍二栋', '宿舍三栋', '宿舍四栋']
export function buildingRank(label: string): number {
  if (label.includes('B-G座')) return BUILDING_SEQ.indexOf('G座') + 0.5   // 供电侧总表组紧随 G座(先判,否则会被 'B座' 命中)
  const i = BUILDING_SEQ.findIndex(s => label.includes(s))
  if (i >= 0) return i
  return label.includes('未挂') ? 1000 : 900                              // 未收录楼栋在前,未挂楼栋恒垫底
}

// 段内:总表(infra)→ 其余;再按 楼层→方位→房号(V74 结构化字段,缺则回退位置原文解析)→ 导入序
// floorRank(spot) 保留导出:poolLedgerLogic.floorSort 用它排池带内序。
const FLOOR_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
// 四个式子提到模块级:floorRank 在排序比较器里,O(n log n) 次调用各造 3~4 个 RegExp(尤其
// new RegExp 还要每次编译),纯属白烧。都不带 g/y 标志,没有 lastIndex 状态,复用安全。
const RE_BASEMENT = /负\s*[一1]|地下|负一层/
const RE_ROOF = /天面|屋面|楼顶/
const RE_FLOOR_NUM = /(\d+)\s*[楼层]/
const RE_FLOOR_CN = new RegExp(`([${FLOOR_CN.join('')}])\\s*[楼层]`)
export function floorRank(spot: string | null | undefined): number {
  const s = spot ?? ''
  if (!s) return 0                                    // 无位置(总表/楼栋级)排段首
  if (RE_BASEMENT.test(s)) return -1
  if (RE_ROOF.test(s)) return 99
  const ar = s.match(RE_FLOOR_NUM)
  if (ar) return +ar[1]
  const cn = s.match(RE_FLOOR_CN)
  if (cn) return FLOOR_CN.indexOf(cn[1]) + 1
  return 50                                           // 有位置但认不出楼层(如"东侧"),排在具名楼层之后
}

// 楼层位次:优先 floorLabel(天面→99 / 负一层→−1 / N楼→N / 认不出→50),空则回退 spot 原文解析
// (跨层表/非楼层表仍要有个稳定位次)。两者皆空=0,与总表同排段首。
export function floorRankOf(m: MeterLoc): number {
  const f = (m.floorLabel ?? '').trim()
  return floorRank(f || m.spot)
}

const infraRank = (x: WorkbenchRow) => (x.m.ownership === 'infra' ? 0 : 1)
export function compareRowInBuilding(a: WorkbenchRow, b: WorkbenchRow): number {
  return infraRank(a) - infraRank(b)
    || floorRankOf(a.m) - floorRankOf(b.m)
    || sideRank(a.m) - sideRank(b.m)
    || roomRank(a.m) - roomRank(b.m)
    || (a.m.sortNo ?? 0) - (b.m.sortNo ?? 0)
    || a.m.id - b.m.id
}

// ── 行窗口化虚拟滚动(§7 6.5):flatten 组→显示列表;窗口范围纯函数,组件只渲染 [start,end) ──

export const ROW_H = 34      // 数据行高(px,=MeterLedgerGrid tbody td 恒定行高)
export const BSUM_H = 40     // 楼栋汇总行高

export type DisplayItem =
  | { type: 'row'; x: WorkbenchRow }
  | { type: 'bsum'; g: BuildingGroup }

export function flattenGroups(groups: BuildingGroup[]): DisplayItem[] {
  const out: DisplayItem[] = []
  for (const g of groups) {
    for (const x of g.rows) out.push({ type: 'row', x })
    out.push({ type: 'bsum', g })
  }
  return out
}

const itemH = (it: DisplayItem) => (it.type === 'bsum' ? BSUM_H : ROW_H)

// 第 i 项内容顶距(前缀高度和):跨窗聚焦时 scrollTop=此值,恰将该行置于 sticky 表头下沿
// (thead 总高 72px 在文档流中占位=表头 sticky 高度,两者抵消)
export function offsetOf(list: DisplayItem[], i: number): number {
  let acc = 0
  const n = Math.min(i, list.length)
  for (let k = 0; k < n; k++) acc += itemH(list[k])
  return acc
}

export interface RowWindow { start: number; end: number; topPad: number; bottomPad: number }

// 可视窗口±buffer 行,半开区间 [start,end) 首尾夹紧;混合行高(34/40)线性前缀扫
// ponytail: O(n) 每次滚动帧重扫,220 行级无压力;上万行再换前缀数组/二分
export function buildWindow(list: DisplayItem[], scrollTop: number, viewportH: number, buffer = 12): RowWindow {
  const n = list.length
  if (n === 0) return { start: 0, end: 0, topPad: 0, bottomPad: 0 }
  const top = Math.max(0, scrollTop)
  const bottom = top + Math.max(0, viewportH)
  let acc = 0
  let rawStart = n, rawEnd = n
  for (let i = 0; i < n; i++) {
    const h = itemH(list[i])
    if (rawStart === n && acc + h > top) rawStart = i     // 首个底边过 scrollTop 的项
    if (acc >= bottom) { rawEnd = i; break }              // 首个顶边出视口底的项
    acc += h
  }
  const start = Math.max(0, rawStart - buffer)
  const end = Math.min(n, rawEnd + buffer)
  let topPad = 0, bottomPad = 0
  for (let i = 0; i < start; i++) topPad += itemH(list[i])
  for (let i = end; i < n; i++) bottomPad += itemH(list[i])
  return { start, end, topPad, bottomPad }
}

// ── 楼栋合计/损耗(§1 表尾:楼栋筛选唯一时;复用 meterGroup 计算函数) ────────────

export interface BuildingTotals { sums: BlockSums; loss: BlockLoss | null }

export function buildingTotals(rows: WorkbenchRow[]): BuildingTotals | null {
  if (rows.length === 0) return null
  const rById = new Map(rows.map(x => [x.m.id, x.r]))
  // 汇总口径复用 groupMeterBlocks(tenant+share 计入,infra/ops 不计,round2):合并各期区 sums
  const groups = groupMeterBlocks(rows.map(x => x.m), m => rById.get(m.id))
  const sums: BlockSums = { usageTotal: null, usageSharp: null, usagePeak: null, usageFlat: null, usageValley: null, count: 0 }
  for (const g of groups) {
    sums.count += g.sums.count
    for (const k of ['usageTotal', 'usageSharp', 'usagePeak', 'usageFlat', 'usageValley'] as const) {
      const v = g.sums[k]
      if (v != null) sums[k] = round2((sums[k] ?? 0) + v)
    }
  }
  const heads = rows.filter(x => x.m.ownership === 'infra').map(x => x.r?.usageTotal ?? null)
  return { sums, loss: blockLoss(heads, sums.usageTotal) }
}

// ── 绑定分桶与一键挂(迁自 v4 meterBindQueue,抽屉「合同绑定」页签用) ───────────

export type BindQueueBucket = BindBucket | 'pending' | 'stale'
export const BIND_BUCKET_LABEL: Record<BindQueueBucket, string> = {
  date_missing: '缺日期', ambiguous: '多合同', bld_mismatch: '口径错位',
  no_contract: '无合同', pending: '待核', stale: '绑定不适用',
}
export const BIND_STATUS_NOTE: Record<BindStatus, string> = {
  auto: '自动', auto_bld: '对位', override: '人工', override_stale: '不适用',
  manual: '待处理', pending: '待核', placeholder: '占位',
}

export function bindQueueBucket(r: Pick<MeterBindingRowDTO, 'status' | 'bucket'>): BindQueueBucket | null {
  if (r.status === 'pending') return 'pending'
  if (r.status === 'override_stale') return 'stale'
  if (r.status === 'manual') return r.bucket ?? 'no_contract'   // bucket 缺失兜底最保守桶
  return null                                                    // 绿(auto/auto_bld/override)与占位槽无待办
}

export function bindReason(qb: BindQueueBucket, row: MeterBindingRowDTO): string {
  const n = row.candidates?.length ?? 0
  switch (qb) {
    case 'pending': return '原文未匹配租户档案,先挂租户'
    case 'date_missing': return n === 1 ? '唯一合同缺起止日期,可一键确认' : `${n} 份合同缺起止日期`
    case 'ambiguous': return `${n} 份合同覆盖本月,需人工选定`
    case 'bld_mismatch': return `楼栋对位落空(口径错位),${n} 份候选`
    case 'no_contract': return '该户无有效合同(补合同是业务动作)'
    // 「过期」曾被读成「这份合同到期了」。它说的是:有人把这块表指给了这一份,而本月不在它的租期内
    // (往往是还没开始),它的前后期里也没有能接上本月的。候选=本月这户能用的合同,点一下就改过去。
    // 合同号不重复:它就印在这句话左边那一格里(MeterDetailDrawer 的 .md-bstat .val)。
    // 钉的是别户的合同(换户后没重钉,METER-TIMELINE-SPEC §3.6):后端不采用、contractId 为空 —— 不是「本月没生效」
    case 'stale':
      if (row.contractId == null && row.pinnedContractNo)
        return `人工绑定的是 ${row.pinnedContractNo},它不是这一段租户的合同,没有采用`
          + (n ? `;下面 ${n} 份是本月这户能用的` : ';该户本月也没有别的有效合同')
      return n
        ? `这一份本月还没生效或已到期,它的前后期也没有接上本月的;下面 ${n} 份是本月这户能用的`
        : '这一份本月还没生效或已到期,该户本月也没有别的有效合同'
  }
}

// 待核表原文对租户档案名:精确全等且档案内唯一才计入(重名档案不敢挂,与后端幂等口径一致)
export function autoLinkEstimate(pendingNames: (string | null)[], tenantNames: string[]): number {
  const cnt = new Map<string, number>()
  for (const n of tenantNames) cnt.set(n, (cnt.get(n) ?? 0) + 1)
  return pendingNames.filter(n => n != null && cnt.get(n) === 1).length
}
