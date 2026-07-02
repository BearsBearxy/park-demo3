import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  HOME_CARDS, tieBs, tieTb, tieIncome, tieRecon, defaultPeriod, loadHomeData,
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
vi.mock('@/api/s10', () => ({ s10Api: { getMonth: vi.fn() } }))

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
const s10Month = (grandTotal: number) =>
  ({ phase: 1, year: 2025, month: 9, recorded: true, rows: [], columnTotals: {}, grandTotal })

function mockHappy() {
  vi.mocked(reportApi.allPeriod).mockImplementation(stmt =>
    Promise.resolve({ is: IS_D, bs: BS_D, tb: TB_D }[stmt as 'is' | 'bs' | 'tb']))
  vi.mocked(pnlApi.overview).mockResolvedValue(PNL_OV)
  vi.mocked(reconApi.overview).mockResolvedValue(RECON_OV)
  vi.mocked(reconApi.month).mockResolvedValue(RECON_MO)
  vi.mocked(s10Api.getMonth).mockResolvedValue(s10Month(250))
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
  it('recon overview 最大 hasData 月', async () => {
    vi.mocked(reconApi.overview).mockResolvedValue({
      year: 2026,
      months: [
        { ...meta(0, 0), month: 3 },
        { ...meta(0, 0), month: 5 },
        { ...meta(0, 0), month: 6, hasData: false },
      ],
    })
    expect(await defaultPeriod()).toEqual({ year: 2026, month: 5 })
  })

  it('overview 失败 → 种子期 {2025,9}', async () => {
    vi.mocked(reconApi.overview).mockRejectedValue(new Error('net'))
    expect(await defaultPeriod()).toEqual({ year: 2025, month: 9 })
  })

  it('无 hasData 月 → 种子期 {2025,9}', async () => {
    vi.mocked(reconApi.overview).mockResolvedValue({ year: 2026, months: [{ ...meta(0, 0), hasData: false }] })
    expect(await defaultPeriod()).toEqual({ year: 2025, month: 9 })
  })
})

// ── loadHomeData 聚合 ──
describe('loadHomeData', () => {
  it('happy:9 卡按 HOME_CARDS 序 + 勾稽 4 项', async () => {
    const d = await loadHomeData(2025, 9)
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
    const d = await loadHomeData(2025, 9)
    const bs = d.cards.find(c => c.key === 'bs')!
    expect(bs.value).toBe('待生成')
    expect(bs.tie).toBe('pending')
    expect(bs.updated).toBe('—')
    expect(d.tieout[0].value).toBe('—')
    expect(d.tieout[0].ok).toBe(false)
    expect(d.cards.find(c => c.key === 'is')!.value).toBe('1,000.00')
    expect(d.tieout[1].ok).toBe(true)
  })

  it('s10 某期 reject → 勾稽③ value=— ok=false,is 卡值仍在但 tie=pending', async () => {
    vi.mocked(s10Api.getMonth).mockImplementation(phase =>
      phase === 3 ? Promise.reject(new Error('boom')) : Promise.resolve(s10Month(250)))
    const d = await loadHomeData(2025, 9)
    expect(d.tieout[2].value).toBe('—')
    expect(d.tieout[2].ok).toBe(false)
    const is = d.cards.find(c => c.key === 'is')!
    expect(is.value).toBe('1,000.00')
    expect(is.tie).toBe('pending')
  })

  it('is 源有数据但 amounts 空 → is 卡待生成(F6)', async () => {
    vi.mocked(reportApi.allPeriod).mockImplementation(stmt =>
      Promise.resolve({ is: { amounts: {}, customRows: [] }, bs: BS_D, tb: TB_D }[stmt as 'is' | 'bs' | 'tb']))
    const d = await loadHomeData(2025, 9)
    expect(d.cards.find(c => c.key === 'is')!.value).toBe('待生成')
  })

  it('全部源 reject → 整体不抛,9 卡全待生成,勾稽全 —', async () => {
    const boom = () => Promise.reject(new Error('boom'))
    vi.mocked(reportApi.allPeriod).mockImplementation(boom)
    vi.mocked(pnlApi.overview).mockImplementation(boom)
    vi.mocked(reconApi.overview).mockImplementation(boom)
    vi.mocked(reconApi.month).mockImplementation(boom)
    vi.mocked(s10Api.getMonth).mockImplementation(boom)
    const d = await loadHomeData(2025, 9)
    expect(d.cards).toHaveLength(9)
    expect(d.cards.every(c => c.value === '待生成' && c.tie === 'pending')).toBe(true)
    expect(d.tieout.every(t => t.value === '—' && !t.ok)).toBe(true)
  })
})
