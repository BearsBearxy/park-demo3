import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DERIVE_MAP, loadDeriveData, deriveRow, compareRow, fillRow } from './pnlDerive'
import { normalizeHeader } from '@/utils/importHeaderMatch'
import { s10Api } from '@/api/s10'
import { pvApi } from '@/api/pv'
import { chargingApi } from '@/api/charging'
import { elecApi } from '@/api/elec'
import { utilitiesApi } from '@/api/utilities'
import { salaryApi } from '@/api/salary'

vi.mock('@/api/s10', () => ({ s10Api: { yearSummary: vi.fn() } }))
vi.mock('@/api/pv', () => ({ pvApi: { records: vi.fn() } }))
vi.mock('@/api/charging', () => ({ chargingApi: { records: vi.fn() } }))
vi.mock('@/api/elec', () => ({ elecApi: { records: vi.fn() } }))
vi.mock('@/api/utilities', () => ({ utilitiesApi: { records: vi.fn() } }))
vi.mock('@/api/salary', () => ({ salaryApi: { records: vi.fn() } }))

// 1-based 月 → 值,其余月 null
const months = (pairs: Record<number, number>) =>
  Array.from({ length: 12 }, (_, i) => (pairs[i + 1] ?? null))

function primeAll() {
  vi.mocked(s10Api.yearSummary).mockResolvedValue({
    year: 2025,
    phases: {
      1: {
        officeMgmtFee: months({ 1: 100, 3: 7 }),
        factoryMgmtFee: months({ 1: 50 }),
        shopRent: months({ 1: 888 }),
      },
      2: { factoryRent: months({ 1: 2841683.37 }) },
      4: { waterStd: months({ 2: 66 }) },
    },
  } as never)
  vi.mocked(pvApi.records).mockResolvedValue({ rows: [
    { phase: 'p1', acctMonth: '2025-01', selfAmt: 10, gridAmt: 5 },
    { phase: 'p1', acctMonth: '2025-01', selfAmt: 2, gridAmt: 1 },   // 同月多行 → Σ
    { phase: 'p2', acctMonth: '2025-02', selfAmt: 30, gridAmt: 0 },
    { phase: 'p1', acctMonth: '2024-12', selfAmt: 999, gridAmt: 999 },  // 非本年 → 忽略
  ] } as never)
  vi.mocked(chargingApi.records).mockImplementation(((no: number) => Promise.resolve({
    rows: no === 7
      ? [{ acctMonth: '2025-01', fee: 100, cost: 40 }]
      : [{ acctMonth: '2025-02', fee: 30, cost: 10 }],
  })) as never)
  vi.mocked(elecApi.records).mockImplementation(((_y: number, type: string) => Promise.resolve({
    rows: type === 'energy'
      ? [{ phase: 'p1', acctMonth: '2025-01', qty: 100, demand: null, price: 2 }]
      : [
          { phase: 'p1', acctMonth: '2025-03', qty: null, demand: 50, price: 3 },
          { phase: 'p2', acctMonth: '2025-01', qty: null, demand: 10, price: 1 },
        ],
  })) as never)
  vi.mocked(utilitiesApi.records).mockResolvedValue({ rows: [
    { acctMonth: '2025-01', elecAmt: 500, waterAmt: 100 },
  ] } as never)
  vi.mocked(salaryApi.records).mockImplementation(((_y: number, m: number) => (m <= 2
    ? Promise.resolve({ rows: [{}], total: { lunch: m * 10, base: 1000 } })
    : Promise.reject(new Error('no data')))) as never)
}

beforeEach(() => { vi.clearAllMocks(); primeAll() })

describe('DERIVE_MAP — 36 条实证映射(spec §2)', () => {
  it('恰 36 条;label 已 normalize;schedule 合法', () => {
    expect(DERIVE_MAP).toHaveLength(36)
    expect(DERIVE_MAP.every(e => e.label === normalizeHeader(e.label))).toBe(true)
    expect(DERIVE_MAP.every(e => /^s[1-5]$/.test(e.schedule))).toBe(true)
  })
})

describe('loadDeriveData — 并行管道 + 序列键', () => {
  it('s10 基础键 + 组合键 Σ(单侧非空取该侧,双侧空 null)', async () => {
    const data = await loadDeriveData(2025)
    expect(data['s10|p1|shopRent']?.[0]).toBe(888)
    expect(data['s10|p2|factoryRent']?.[0]).toBeCloseTo(2841683.37, 2)
    const combo = data['s10|p1|officeMgmtFee+factoryMgmtFee']
    expect(combo?.[0]).toBe(150)     // 100 + 50
    expect(combo?.[2]).toBe(7)       // 仅 officeMgmtFee 有值
    expect(combo?.[5]).toBeNull()    // 双侧空
  })

  it('pv 按期聚合 selfAmt/gridAmt/self+grid;非本年行忽略', async () => {
    const data = await loadDeriveData(2025)
    expect(data['pv|p1|selfAmt']?.[0]).toBe(12)
    expect(data['pv|p1|gridAmt']?.[0]).toBe(6)
    expect(data['pv|p1|self+grid']?.[0]).toBe(18)
    expect(data['pv|p1|selfAmt']?.[11]).toBeNull()
    expect(data['pv|p2|self+grid']?.[1]).toBe(30)
  })

  it('chg fee/cost/profit(=fee−cost);elec amt=(qty??demand)×price;office elec+water', async () => {
    const data = await loadDeriveData(2025)
    expect(data['chg7|profit']?.[0]).toBe(60)
    expect(data['chg8|fee']?.[1]).toBe(30)
    expect(data['chg8|profit']?.[1]).toBe(20)
    expect(data['elec|p1|energy|amt']?.[0]).toBe(200)   // qty 100 × price 2
    expect(data['elec|p1|basic|amt']?.[2]).toBe(150)    // demand 50 × price 3
    expect(data['elec|p2|basic|amt']?.[0]).toBe(10)
    expect(data['office|elecAmt']?.[0]).toBe(500)
    expect(data['office|elec+water']?.[0]).toBe(600)
  })

  it('salary ×12 月并行:成功月 Σ 字段,失败月 null,不抛', async () => {
    const data = await loadDeriveData(2025)
    expect(vi.mocked(salaryApi.records)).toHaveBeenCalledTimes(12)
    expect(data['sal|lunch']?.slice(0, 3)).toEqual([10, 20, null])
    expect(data['sal|base']?.[0]).toBe(1000)
  })

  it('某源 reject → 相关键缺失、其余源不受影响、不抛(allSettled)', async () => {
    vi.mocked(s10Api.yearSummary).mockRejectedValue(new Error('boom'))
    const data = await loadDeriveData(2025)
    expect(Object.keys(data).some(k => k.startsWith('s10|'))).toBe(false)
    expect(data['pv|p1|selfAmt']?.[0]).toBe(12)
  })
})

describe('deriveRow — normalize 命中(分组无关)', () => {
  it('标签带空格/顿号照样命中;未映射/错 schedule → null', async () => {
    const data = await loadDeriveData(2025)
    expect(deriveRow('s1', ' 一期商铺 租金收入 ', data)).toEqual(data['s10|p1|shopRent'])
    expect(deriveRow('s2', '一、三期基本用电成本', data)).toEqual(data['elec|p1|basic|amt'])
    expect(deriveRow('s3', '散租宿舍收入', data)?.[1]).toBe(66)   // s10|p4|waterStd
    expect(deriveRow('s1', '不存在的行', data)).toBeNull()
    expect(deriveRow('s2', '一期商铺租金收入', data)).toBeNull()  // s1 的标签,s2 不命中
  })

  it('命中映射但源失败(序列缺失)→ null 不显派生', async () => {
    vi.mocked(s10Api.yearSummary).mockRejectedValue(new Error('boom'))
    const data = await loadDeriveData(2025)
    expect(deriveRow('s1', '一期商铺租金收入', data)).toBeNull()
  })
})

describe('compareRow — 三态(容差 0.005,仅比两侧非空月)', () => {
  it('重叠月全等(±0.005)→ ok', () => {
    const r = compareRow([100.004, null, 3], [100, 7, 3])
    expect(r).toEqual({ state: 'ok', diffMonths: [] })
  })
  it('有差异月 → diff + 1-based diffMonths', () => {
    const r = compareRow([100, 200, null], [100, 190, 5])
    expect(r.state).toBe('diff')
    expect(r.diffMonths).toEqual([2])
  })
  it('重叠 0 月(错位非空/行全空)→ empty', () => {
    expect(compareRow([5, null], [null, 7]).state).toBe('empty')
    expect(compareRow(Array(12).fill(null), months({ 1: 9 })).state).toBe('empty')
  })
})

describe('fillRow — 只填空格', () => {
  it('null 取派生,已录(含真 0)保留,派生空仍 null', () => {
    const rowM = [null, 3, 0, null]
    const derived = [1, 9, 9, null]
    expect(fillRow(rowM, derived).slice(0, 4)).toEqual([1, 3, 0, null])
  })
})
