import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  HOME_CARDS, NO_VIEW, tieBs, tieTb, tieIncome, tieRecon, defaultPeriod, loadHomeData,
} from './reportsHome'
import { reportApi } from '@/api/report'
import { pnlApi } from '@/api/pnl'
import { reconApi } from '@/api/recon'
import { s10Api } from '@/api/s10'
import type { ReportPeriodDTO, ReportAccount } from '@/types/report'
import type { ReconMonthMeta } from '@/types/recon'

vi.mock('@/api/report', () => ({ reportApi: { allPeriod: vi.fn() } }))
vi.mock('@/api/pnl', () => ({ pnlApi: { overview: vi.fn() } }))
vi.mock('@/api/recon', () => ({ reconApi: { overview: vi.fn(), month: vi.fn() } }))
vi.mock('@/api/s10', () => ({ s10Api: { getMonth: vi.fn(), monthTotals: vi.fn() } }))

// 判权函数:ALL = 什么都看得了;only(...) = 只有这几项(RBAC v4 一屏一项 `<屏>:view`)
const ALL = () => true
const only = (...ps: string[]) => (p: string) => ps.includes(p)

// ── 合成数据 ──
const acc = (rowKey: string, level = 0): ReportAccount =>
  ({ rowKey, parentKey: null, code: rowKey, label: rowKey, level, sortOrder: 0 })

const meta = (diffCount: number, missCount: number): ReconMonthMeta =>
  ({ month: 9, hasData: true, entityCount: 20, okCount: 7, diffCount, missCount })

// is:行1 营业收入 1000(cur)→ 净利润 computeRow(32,'cur')=1000
const IS_D: ReportPeriodDTO = { amounts: { '1': { cur: 1000, ytd: 0 } }, customRows: [] }
// bs:货币资金 100 = 实收资本 100 → 平
const BS_D: ReportPeriodDTO = { amounts: { '1': { end: 100 }, '48': { end: 100 } }, customRows: [] }
// tb:两个一级科目,期末借 500 = 期末贷 500 → 平
const TB_D: ReportPeriodDTO = {
  amounts: { a1: { endDr: 500 }, a2: { endCr: 500 } },
  customRows: [],
  accounts: [acc('a1'), acc('a2')],
}
const PNL_OV = { years: [{ year: 2024, hasData: true, rowCount: 10 }, { year: 2025, hasData: true, rowCount: 42 }] }
const RECON_OV = { year: 2025, months: [meta(8, 5)] }
const RECON_MO = { year: 2025, month: 9, entities: [] }
const TOTALS = { 1: 250, 2: 250, 3: 250, 4: 250 }

function mockHappy() {
  vi.mocked(reportApi.allPeriod).mockImplementation(stmt =>
    Promise.resolve({ is: IS_D, bs: BS_D, tb: TB_D }[stmt as 'is' | 'bs' | 'tb']))
  vi.mocked(pnlApi.overview).mockResolvedValue(PNL_OV)
  vi.mocked(reconApi.overview).mockResolvedValue(RECON_OV)
  vi.mocked(reconApi.month).mockResolvedValue(RECON_MO)
  vi.mocked(s10Api.monthTotals).mockResolvedValue(TOTALS)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHappy()
})

// ── 勾稽① 资产负债表平衡 ──
describe('tieBs', () => {
  it('资产=负债+权益 → ok,value=资产总计格式化', () => {
    const t = tieBs(BS_D.amounts)
    expect(t.ok).toBe(true)
    expect(t.value).toBe('100.00')
  })

  it('不平 → ok=false', () => {
    const t = tieBs({ '1': { end: 100 }, '48': { end: 50 } })
    expect(t.ok).toBe(false)
    expect(t.value).toBe('100.00')
  })

  it('差 ≤0.005 容差内 → ok', () => {
    expect(tieBs({ '1': { end: 100 }, '48': { end: 100.004 } }).ok).toBe(true)
  })
})

// ── 勾稽② 试算平衡 ──
describe('tieTb', () => {
  it('期末借=期末贷 → ok,value=期末借合计;非一级科目不入合计', () => {
    const t = tieTb({
      amounts: { a1: { endDr: 500 }, a2: { endCr: 500 }, c1: { endDr: 999 } },
      customRows: [],
      accounts: [acc('a1'), acc('a2'), acc('c1', 1)],
    })
    expect(t.ok).toBe(true)
    expect(t.value).toBe('500.00')
  })

  it('借贷不平 → ok=false', () => {
    const t = tieTb({ amounts: { a1: { endDr: 500 }, a2: { endCr: 300 } }, customRows: [], accounts: [acc('a1'), acc('a2')] })
    expect(t.ok).toBe(false)
  })
})

// ── 勾稽③ 营业收入交叉 ──
describe('tieIncome', () => {
  it('利润表行1(cur) = Σ s10 四期 → ok', () => {
    const t = tieIncome(IS_D.amounts, [250, 250, 250, 250])
    expect(t.ok).toBe(true)
    expect(t.value).toBe('1,000.00')
  })

  it('不等 → ok=false,value 两值并列', () => {
    const t = tieIncome(IS_D.amounts, [100, 0, 0, 0])
    expect(t.ok).toBe(false)
    expect(t.value).toBe('1,000.00 ⇄ 100.00')
  })
})

// ── 勾稽④ 收入核对 ──
describe('tieRecon', () => {
  it('diff+miss=0 → ok', () => {
    const t = tieRecon(meta(0, 0))
    expect(t.ok).toBe(true)
    expect(t.value).toBe('0 户待处理')
  })

  it('diff+miss≠0 → ok=false,value=户数', () => {
    const t = tieRecon(meta(8, 5))
    expect(t.ok).toBe(false)
    expect(t.value).toBe('13 户待处理')
  })
})

// ── defaultPeriod 回退链 ──
describe('defaultPeriod', () => {
  // 时钟钉在 2031-07:有数据的分支不读它(结果与它无关),没数据才落它(2026-10-05 用户拍板「按你建议修改」)
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2031, 6, 15)) })
  afterEach(() => { vi.useRealTimers() })

  it('recon overview 最大 hasData 月', async () => {
    vi.mocked(reconApi.overview).mockResolvedValue({
      year: 2026,
      months: [
        { ...meta(0, 0), month: 3 },
        { ...meta(0, 0), month: 5 },
        { ...meta(0, 0), month: 6, hasData: false },
      ],
    })
    expect(await defaultPeriod(ALL)).toEqual({ year: 2026, month: 5 })
  })

  it('overview 失败 → 今年今月(不再落写死的 2025-09)', async () => {
    vi.mocked(reconApi.overview).mockRejectedValue(new Error('net'))
    expect(await defaultPeriod(ALL)).toEqual({ year: 2031, month: 7 })
  })

  it('无 hasData 月 → 今年今月(新园区空库)', async () => {
    vi.mocked(reconApi.overview).mockResolvedValue({ year: 2026, months: [{ ...meta(0, 0), hasData: false }] })
    expect(await defaultPeriod(ALL)).toEqual({ year: 2031, month: 7 })
  })
})

// ── loadHomeData 聚合 ──
describe('loadHomeData', () => {
  it('happy:9 卡按 HOME_CARDS 序 + 勾稽 4 项', async () => {
    const d = await loadHomeData(2025, 9, ALL)
    expect(d.year).toBe(2025)
    expect(d.month).toBe(9)
    expect(d.cards.map(c => c.key)).toEqual(HOME_CARDS.map(c => c.key))

    const by = Object.fromEntries(d.cards.map(c => [c.key, c]))
    expect(by.is.value).toBe('1,000.00')   // 净利润(本月)
    expect(by.is.tie).toBe('ok')           // 勾稽③ 1000 = 4×250
    expect(by.is.updated).toBe('2025年9月')
    expect(by.bs.value).toBe('100.00')     // 资产总计
    expect(by.bs.tie).toBe('ok')
    expect(by.tb.value).toBe('500.00')     // 期末借合计
    expect(by.tb.tie).toBe('ok')
    expect(by.s1.value).toBe('42 行')      // 最大数据年 2025 的行数
    expect(by.s1.tie).toBe('none')
    expect(by.s1.updated).toBe('2025年')
    expect(by.recon.value).toBe('13 户')
    expect(by.recon.tie).toBe('bad')

    expect(d.tieout).toHaveLength(4)
    expect(d.tieout.map(t => t.ok)).toEqual([true, true, true, false])
    expect(d.tieout[3].value).toBe('13 户待处理')
  })

  it('bs 源 reject → bs 卡待生成 + 勾稽① value=— ok=false,其余不受影响,不抛', async () => {
    vi.mocked(reportApi.allPeriod).mockImplementation(stmt =>
      stmt === 'bs' ? Promise.reject(new Error('boom')) : Promise.resolve({ is: IS_D, tb: TB_D }[stmt as 'is' | 'tb']))
    const d = await loadHomeData(2025, 9, ALL)
    const bs = d.cards.find(c => c.key === 'bs')!
    expect(bs.value).toBe('待生成')
    expect(bs.tie).toBe('pending')
    expect(bs.updated).toBe('—')
    expect(d.tieout[0].value).toBe('—')
    expect(d.tieout[0].ok).toBe(false)
    expect(d.cards.find(c => c.key === 'is')!.value).toBe('1,000.00')
    expect(d.tieout[1].ok).toBe(true)
  })

  it('s10 月合计 reject → 勾稽③ value=— ok=false,is 卡值仍在但 tie=pending', async () => {
    vi.mocked(s10Api.monthTotals).mockRejectedValue(new Error('boom'))
    const d = await loadHomeData(2025, 9, ALL)
    expect(d.tieout[2].value).toBe('—')
    expect(d.tieout[2].ok).toBe(false)
    const is = d.cards.find(c => c.key === 'is')!
    expect(is.value).toBe('1,000.00')
    expect(is.tie).toBe('pending')
  })

  it('is 源有数据但 amounts 空 → is 卡待生成(F6)', async () => {
    vi.mocked(reportApi.allPeriod).mockImplementation(stmt =>
      Promise.resolve({ is: { amounts: {}, customRows: [] }, bs: BS_D, tb: TB_D }[stmt as 'is' | 'bs' | 'tb']))
    const d = await loadHomeData(2025, 9, ALL)
    expect(d.cards.find(c => c.key === 'is')!.value).toBe('待生成')
  })

  it('全部源 reject → 整体不抛,9 卡全待生成,勾稽全 —', async () => {
    const boom = () => Promise.reject(new Error('boom'))
    vi.mocked(reportApi.allPeriod).mockImplementation(boom)
    vi.mocked(pnlApi.overview).mockImplementation(boom)
    vi.mocked(reconApi.overview).mockImplementation(boom)
    vi.mocked(reconApi.month).mockImplementation(boom)
    vi.mocked(s10Api.monthTotals).mockImplementation(boom)
    const d = await loadHomeData(2025, 9, ALL)
    expect(d.cards).toHaveLength(9)
    expect(d.cards.every(c => c.value === '待生成' && c.tie === 'pending')).toBe(true)
    expect(d.tieout.every(t => t.value === '—' && !t.ok)).toBe(true)
  })
})

// ── RBAC v4(2026-10-09,RBAC-SPEC §15.7 / §15.10):报表中心只取看得了的那几张 ──
// 后端读规则对报表中心只放行 /s10/month-totals;其余每张报表要它自己那一屏的查看。取了看不了的会 403,
// allSettled 吞掉之后卡上写「待生成」—— 说的是没录,其实是不让看。
// 破坏验证:loadHomeData 里 is / tb 的 when(sees(…)) 去掉 → 第一条红;locked 卡的值改回 dyn 的「待生成」→ 第一条红;
//          勾稽③改回四次 getMonth → 第二条红;defaultPeriod 去掉 can('reconciliation:view') 门 → 第三条红
describe('loadHomeData / defaultPeriod 按屏查看权取数', () => {
  it('❗只有报表中心 + 资产负债表查看:别的报表、收入核对、损益附表、附表10 一个都不取;看不了的卡写「没有查看权」', async () => {
    const d = await loadHomeData(2025, 9, only('reports-home:view', 'balance-sheet:view'))
    expect(vi.mocked(reportApi.allPeriod).mock.calls.map(c => c[0])).toEqual(['bs'])
    expect(reconApi.overview).not.toHaveBeenCalled()
    expect(reconApi.month).not.toHaveBeenCalled()
    expect(pnlApi.overview).not.toHaveBeenCalled()
    expect(s10Api.monthTotals).not.toHaveBeenCalled()
    expect(s10Api.getMonth).not.toHaveBeenCalled()

    const by = Object.fromEntries(d.cards.map(c => [c.key, c]))
    expect(d.cards.map(c => c.key), '看不了的卡照样列出').toEqual(HOME_CARDS.map(c => c.key))
    expect(by.is.value).toBe(NO_VIEW)
    expect(NO_VIEW).toBe('没有查看权')
    expect(by.is.locked).toBe(true)
    expect(by.is.tie, '看不了的卡不挂「待生成」徽标').toBe('none')
    expect(by.s3.value).toBe(NO_VIEW)
    expect(by.recon.value).toBe(NO_VIEW)
    expect(by.bs.locked).toBe(false)
    expect(by.bs.value).toBe('100.00')
    // 勾稽:只有①(资产负债表平衡)算了,其余三项是「看不了」不是「待查」
    expect(d.tieout.map(t => t.locked)).toEqual([false, true, true, true])
    expect(d.tieout[0].ok).toBe(true)
  })

  it('❗再加利润表查看:勾稽③只调一次 /s10/month-totals,不读附表10 逐户宽表', async () => {
    const d = await loadHomeData(2025, 9, only('reports-home:view', 'balance-sheet:view', 'income-statement:view'))
    expect(s10Api.monthTotals).toHaveBeenCalledTimes(1)
    expect(s10Api.monthTotals).toHaveBeenCalledWith(2025, 9)
    expect(s10Api.getMonth).not.toHaveBeenCalled()
    expect(vi.mocked(reportApi.allPeriod).mock.calls.map(c => c[0]).sort()).toEqual(['bs', 'is'])
    expect(d.tieout[2]).toMatchObject({ locked: false, ok: true, value: '1,000.00' })   // 1000 = 4 × 250
    expect(d.cards.find(c => c.key === 'is')!.tie).toBe('ok')
  })

  it('❗看不了收入核对:默认期不问收入核对接口,直接落今年今月', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2031, 6, 15))
    try {
      expect(await defaultPeriod(only('reports-home:view', 'income-statement:view'))).toEqual({ year: 2031, month: 7 })
      expect(reconApi.overview).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
})
