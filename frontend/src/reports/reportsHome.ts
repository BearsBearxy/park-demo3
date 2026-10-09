// 报表中心聚合器 + 勾稽 4 项纯函数 — P2-F spec F1-F8。零后端:全走既有端点客端聚合。
// 勾稽算法复用 computeRow/computeBsRow/tbTotals(公式归前端);容差 0.005;
// loadHomeData 用 Promise.allSettled 容错:任一源失败该卡「待生成」、相关勾稽 value='—',整体不抛。
// RBAC v4(2026-10-09,RBAC-SPEC §15.7):只取看得了的那几张;看不了的卡照样列出,值写「没有查看权」,
// 相关勾稽不算(locked)。附表10 那一边只取四个期区的月合计(/s10/month-totals),不再读整张逐户宽表。
import { computeBsRow } from './balanceSheet'
import { computeRow } from './incomeStatement'
import { tbTotals, type TbAccount, type TbAmounts } from './trialBalance'
import { PNL_SCHEDULES } from './pnlSchedules'
import { reportApi } from '@/api/report'
import { pnlApi } from '@/api/pnl'
import { reconApi } from '@/api/recon'
import { s10Api } from '@/api/s10'
import { finSigned } from '@/utils/finFmt'
import type { ReportPeriodDTO } from '@/types/report'
import type { ReconMonth, ReconMonthMeta, ReconOverview, ReconStatus } from '@/types/recon'
import type { Can } from '@/nav/navAccess'

export type HomeCardKey = 'is' | 'bs' | 'tb' | 's1' | 's2' | 's3' | 's4' | 's5' | 'recon'
export type TieState = 'ok' | 'bad' | 'none' | 'pending'

export interface HomeCard {
  key: HomeCardKey
  name: string
  desc: string
  icon: string
  go: string          // fpNav 路由值,卡点击 push
  metric: string
  value: string       // 数值格式化串 | '待生成' | NO_VIEW
  updated: string     // 数据截止,如 '2025年9月';无数据 '—'
  tie: TieState
  locked: boolean     // 没有这张报表的查看权:卡照样列出、置灰
}

export interface TieItem {
  label: string
  a: string
  b: string
  value: string       // 金额/户数;不可算 '—'
  ok: boolean
  locked: boolean     // 看不了算它要的那张报表:不算、不计入「n / m 项已平」
}

export interface HomeData {
  cards: HomeCard[]
  tieout: TieItem[]
  year: number
  month: number
}

// 9 卡静态元数据(键/名/desc/icon/go),icon/go 对齐 fpNav;动态字段由 loadHomeData 填。
export type HomeCardMeta = Pick<HomeCard, 'key' | 'name' | 'desc' | 'icon' | 'go'>
export const HOME_CARDS: readonly HomeCardMeta[] = [
  { key: 'is',    name: '利润表',        desc: '收入·成本·费用与净利润',      icon: 'trending-up', go: 'income-statement' },
  { key: 'bs',    name: '资产负债表',    desc: '资产 = 负债 + 所有者权益',    icon: 'scale',       go: 'balance-sheet' },
  { key: 'tb',    name: '科目余额表',    desc: '全科目借贷余额与试算平衡',    icon: 'table-2',     go: 'trial-balance' },
  { key: 's1',    name: '附表1 租金损益', desc: '租金收入与成本明细',          icon: 'home',        go: 'rent-pnl' },
  { key: 's2',    name: '附表2 用电损益', desc: '电费收入与成本明细',          icon: 'zap',         go: 'elec-pnl' },
  { key: 's3',    name: '附表3 用水损益', desc: '水费收入与成本明细',          icon: 'droplets',    go: 'water-pnl' },
  { key: 's4',    name: '附表4 运管损益', desc: '其他运管费用收益明细',        icon: 'wrench',      go: 'ops-pnl' },
  { key: 's5',    name: '附表5 费用支出', desc: '费用支出科目明细',            icon: 'banknote',    go: 'expense-pnl' },
  { key: 'recon', name: '收入核对',      desc: '台账 ⇄ 附表10 逐户核对',      icon: 'git-compare', go: 'reconciliation' },
]

export const TIE_TOL = 0.005
/** 看不了的卡上那个值的位置写这句(不写「待生成」:那是说没录,这里是不让看)。 */
export const NO_VIEW = '没有查看权'

type Amounts = Record<string, Record<string, number>>

// 勾稽项 label/来源 单一事实源(tie 函数与 pending 占位共用,防文案漂移)
const TIE_META = {
  bs:     { label: '资产负债表平衡', a: '资产总计',             b: '负债和权益总计' },
  tb:     { label: '试算平衡',       a: '期末借方合计',         b: '期末贷方合计' },
  income: { label: '营业收入交叉',   a: '利润表·营业收入(本月)', b: '附表10·各期区合计' },
  recon:  { label: '收入核对',       a: '月度台账',             b: '附表10' },
} as const

const pendingTie = (k: keyof typeof TIE_META, locked = false): TieItem => ({ ...TIE_META[k], value: '—', ok: false, locked })

// ── 勾稽① 资产负债表平衡:computeBsRow(30) ⇄ computeBsRow(53) ──
// ponytail: 勾稽忽略自定义子类行(计划定死 customChildrenSum=()=>null);报表屏内自有精确视图
export function tieBs(bsAmounts: Amounts): TieItem {
  const leaf = (no: number) => bsAmounts[String(no)]?.end ?? 0
  const assets = computeBsRow(30, leaf, () => null)
  const liabEq = computeBsRow(53, leaf, () => null)
  return { ...TIE_META.bs, value: finSigned(assets), ok: Math.abs(assets - liabEq) <= TIE_TOL, locked: false }
}

// ── 勾稽② 试算平衡:tbTotals 期末借 ⇄ 期末贷(一级合并口径) ──
export function tieTb(tbData: ReportPeriodDTO): TieItem {
  const totals = tbTotals((tbData.accounts ?? []) as TbAccount[], tbData.amounts as TbAmounts)
  return { ...TIE_META.tb, value: finSigned(totals.endDr), ok: Math.abs(totals.endDr - totals.endCr) <= TIE_TOL, locked: false }
}

// ── 勾稽③ 营业收入交叉:利润表行1(cur) ⇄ Σ s10 四期月合计 ──
// s10 月合计取 /s10/month-totals:后端逐期区 S10Service.month(…).grandTotal(含自定义列),与改前读宽表取的同一个数。
export function tieIncome(isAmounts: Amounts, s10MonthTotals: number[]): TieItem {
  const leaf = (no: number, field: string) => isAmounts[String(no)]?.[field] ?? 0
  const rev = computeRow(1, 'cur', leaf, () => null)
  const s10 = s10MonthTotals.reduce((a, b) => a + b, 0)
  const ok = Math.abs(rev - s10) <= TIE_TOL
  return { ...TIE_META.income, value: ok ? finSigned(rev) : `${finSigned(rev)} ⇄ ${finSigned(s10)}`, ok, locked: false }
}

// ── 勾稽④ 收入核对:该月 diff+miss=0 即平 ──
export function tieRecon(meta: ReconMonthMeta): TieItem {
  const n = meta.diffCount + meta.missCount
  return { ...TIE_META.recon, value: `${n} 户待处理`, ok: n === 0, locked: false }
}

// ── 期间默认(F3):recon overview 最大 hasData 月(确定性,不读时钟)→ 取不到才落今年今月 ──
// 改前取不到落写死的种子期 {2025,9}(我园数据),新园区空库打开报表首页就是 2025 年 9 月。
// 2026-10-05 用户拍板「按你建议修改」:没数据时读时钟取今月。看不了收入核对(v4)就不问它,直接落今月。
export async function defaultPeriod(can: Can): Promise<{ year: number; month: number }> {
  if (can('reconciliation:view')) try {
    const ov = await reconApi.overview()
    const months = ov.months.filter(m => m.hasData).map(m => m.month)
    if (months.length) return { year: ov.year, month: Math.max(...months) }
  } catch { /* 回退今月 */ }
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

const settled = <T>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null)
/** 看得了才取;看不了给 null(和取失败一样不算,但卡上另写 NO_VIEW)。 */
const when = <T>(ok: boolean, f: () => Promise<T>): Promise<T | null> => (ok ? f() : Promise.resolve(null))
const hasAmounts = (d: ReportPeriodDTO | null): d is ReportPeriodDTO =>
  !!d && Object.keys(d.amounts).length > 0

// recon 月元数据:优先 overview 的该月 meta;overview 失败时从 month 实体现算(容错冗余)。
function reconMeta(ov: ReconOverview | null, mo: ReconMonth | null, month: number): ReconMonthMeta | null {
  const m = ov?.months.find(x => x.month === month)
  if (m?.hasData) return m
  if (mo && mo.entities.length) {
    const c = (s: ReconStatus) => mo.entities.filter(e => e.status === s).length
    return { month, hasData: true, entityCount: mo.entities.length, okCount: c('ok'), diffCount: c('diff'), missCount: c('miss') }
  }
  return null
}

// 卡 tie 徽标口径(spec §2):is=勾稽③ bs=① tb=② recon=④,pnl 无勾稽 'none';源缺→'pending'。
const tieState = (has: boolean, t: TieItem): TieState =>
  !has || t.value === '—' ? 'pending' : t.ok ? 'ok' : 'bad'

export async function loadHomeData(year: number, month: number, can: Can): Promise<HomeData> {
  const sees = (k: HomeCardKey) => can(`${HOME_CARDS.find(m => m.key === k)!.go}:view`)
  const [core, pnls] = await Promise.all([
    Promise.allSettled([
      when(sees('is'), () => reportApi.allPeriod('is', year, month)),
      when(sees('bs'), () => reportApi.allPeriod('bs', year, month)),
      when(sees('tb'), () => reportApi.allPeriod('tb', year, month)),
      when(sees('recon'), () => reconApi.overview(year)),
      when(sees('recon'), () => reconApi.month(year, month)),
      // 勾稽③只在看得了利润表时算(附表10 那一边报表中心查看就能取,只是四个合计)
      when(sees('is'), () => s10Api.monthTotals(year, month)),
    ]),
    Promise.allSettled(PNL_SCHEDULES.map(c => when(can(`${c.route}:view`), () => pnlApi.overview(c.schedule)))),
  ])

  const isD = settled(core[0])
  const bsD = settled(core[1])
  const tbD = settled(core[2])
  const reconOv = settled(core[3])
  const reconMo = settled(core[4])
  const s10T = settled(core[5])

  // 空 amounts 视同无数据(F6「待生成」);tb 另需科目树
  const isHas = hasAmounts(isD)
  const bsHas = hasAmounts(bsD)
  const tbHas = hasAmounts(tbD) && (tbD.accounts?.length ?? 0) > 0
  const s10Totals = s10T ? [1, 2, 3, 4].map(ph => s10T[ph as 1 | 2 | 3 | 4] ?? 0) : null
  const rMeta = reconMeta(reconOv, reconMo, month)

  const t1 = bsHas ? tieBs(bsD.amounts) : pendingTie('bs', !sees('bs'))
  const t2 = tbHas ? tieTb(tbD as ReportPeriodDTO) : pendingTie('tb', !sees('tb'))
  const t3 = isHas && s10Totals ? tieIncome(isD.amounts, s10Totals) : pendingTie('income', !sees('is'))
  const t4 = rMeta ? tieRecon(rMeta) : pendingTie('recon', !sees('recon'))
  const tieout = [t1, t2, t3, t4]

  const upd = `${year}年${month}月`
  const dyn: Record<HomeCardKey, Pick<HomeCard, 'metric' | 'value' | 'updated' | 'tie'>> = {
    is: {
      metric: '净利润(本月)',
      value: isHas
        ? finSigned(computeRow(32, 'cur', (no, f) => isD.amounts[String(no)]?.[f] ?? 0, () => null))
        : '待生成',
      updated: isHas ? upd : '—',
      tie: tieState(isHas, t3),
    },
    bs: { metric: '资产总计', value: bsHas ? t1.value : '待生成', updated: bsHas ? upd : '—', tie: tieState(bsHas, t1) },
    tb: {
      metric: tbHas ? `期末借合计 · ${tbD.accounts!.length} 科目` : '期末借合计',
      value: tbHas ? t2.value : '待生成',
      updated: tbHas ? upd : '—',
      tie: tieState(tbHas, t2),
    },
    recon: {
      metric: '差异+缺记',
      value: rMeta ? `${rMeta.diffCount + rMeta.missCount} 户` : '待生成',
      updated: rMeta ? upd : '—',
      tie: rMeta ? (t4.ok ? 'ok' : 'bad') : 'pending',
    },
    // s1..s5 下面按 PNL_SCHEDULES 填
    s1: null!, s2: null!, s3: null!, s4: null!, s5: null!,
  }
  PNL_SCHEDULES.forEach((c, i) => {
    const ov = settled(pnls[i])
    const latest = ov?.years.filter(y => y.hasData).sort((a, b) => b.year - a.year)[0] ?? null
    dyn[c.schedule] = latest
      ? { metric: `${latest.year}年已录`, value: `${latest.rowCount} 行`, updated: `${latest.year}年`, tie: 'none' }
      : { metric: '已录行数', value: '待生成', updated: '—', tie: 'pending' }
  })

  const cards = HOME_CARDS.map(m => sees(m.key)
    ? { ...m, ...dyn[m.key], locked: false }
    : { ...m, metric: dyn[m.key].metric, value: NO_VIEW, updated: '—', tie: 'none' as const, locked: true })
  return { cards, tieout, year, month }
}
