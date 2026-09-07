import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useReviewStore } from '@/stores/review'
import { parseReviewKey, reviewNoteOf, LOCKING, type ReviewRow } from '@/types/review'
import api from '@/api'

vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve()),
    put: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
  },
}))

const row = (p: Partial<ReviewRow> & { key: string }): ReviewRow => ({
  kind: 'salary', scope: null, status: 'entered',
  submittedBy: null, submittedAt: null, reviewedBy: null, reviewedAt: null,
  reason: null, blockedBy: [], ...p,
})

/** 只数打到 /review 的 GET —— 别的 mock 调用不算。 */
const listCalls = () => vi.mocked(api.get).mock.calls.filter(c => c[0] === '/review').length

describe('审核键解析', () => {
  it('带 scope 的三段键', () => {
    expect(parseReviewKey('ledger:7:2024-02')).toEqual({ kind: 'ledger', scope: '7', period: '2024-02' })
  })

  // 破坏验证:把 types/review.ts 的 lastIndexOf 换成 indexOf,这条红 —— 会切成 kind='alloc',
  // 而 `alloc` 是另一把真实存在的键,不报错,只锁错表。
  it('kind 里的连字符不许被当成分隔符 —— alloc-loss 不能切成 alloc', () => {
    expect(parseReviewKey('alloc-loss:2024-02')).toEqual({ kind: 'alloc-loss', scope: null, period: '2024-02' })
    expect(parseReviewKey('charging-car:2024-02')?.kind).toBe('charging-car')
    expect(parseReviewKey('bill-notices:2024-02')?.kind).toBe('bill-notices')
  })

  // 破坏验证:把 PERIOD 换成 /^\d{4}-\d{2}$/(即后端 MeterService 那份松的),这条红。
  it('月份闸与后端 ReviewKind.PERIOD 同严 —— 13 月 / 0 月不认', () => {
    expect(parseReviewKey('salary:2024-13')).toBeNull()
    expect(parseReviewKey('salary:2024-00')).toBeNull()
    expect(parseReviewKey('salary:2024-2')).toBeNull()
  })

  it('形状不对一律 null,不猜', () => {
    expect(parseReviewKey('salary')).toBeNull()
    expect(parseReviewKey(':2024-02')).toBeNull()
    expect(parseReviewKey('ledger::2024-02')).toBeNull()
  })
})

describe('药丸文案', () => {
  it('待审核与已审核两句;returned / entered 不出药丸', () => {
    expect(reviewNoteOf(row({ key: 'k', status: 'submitted' }))).toBe('待审核 · 已交审')
    expect(reviewNoteOf(row({ key: 'k', status: 'approved', reviewedBy: '李审', reviewedAt: '2024-03-05T10:00:00' })))
      .toBe('已审核 · 李审 03-05')
    expect(reviewNoteOf(row({ key: 'k', status: 'returned' }))).toBeNull()
    expect(reviewNoteOf(null)).toBeNull()
  })

  // 破坏验证:把 LOCKING 加上 'returned',这条红。returned 的可编辑性等同录入中(§7.2)。
  it('挡编辑的只有两个态,returned 不在内', () => {
    expect([...LOCKING].sort()).toEqual(['approved', 'submitted'])
  })
})

describe('审核 store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('同月并发两次只打一趟网络', async () => {
    const s = useReviewStore()
    await Promise.all([s.ensure('2024-02'), s.ensure('2024-02')])
    expect(listCalls()).toBe(1)
    // 已缓存,第三次也不打
    await s.ensure('2024-02')
    expect(listCalls()).toBe(1)
  })

  it('rowOf 按整把键认,认不到回 null', async () => {
    vi.mocked(api.get).mockResolvedValueOnce([row({ key: 'ledger:7:2024-02', kind: 'ledger', scope: '7', status: 'approved' })])
    const s = useReviewStore()
    await s.ensure('2024-02')
    expect(s.rowOf('ledger:7:2024-02')?.status).toBe('approved')
    expect(s.rowOf('ledger:8:2024-02')).toBeNull()   // 同 kind 不同公司,不许张冠李戴
    expect(s.rowOf('salary:2024-02')).toBeNull()
  })

  // 破坏验证:把 act() 里的 invalidate+ensure 删掉,这条红 —— 屏上会一直挂着交审前的状态。
  it('交审之后当月重取,屏上拿到的是新态', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([row({ key: 'salary:2024-02', status: 'entered' })])
      .mockResolvedValueOnce([row({ key: 'salary:2024-02', status: 'submitted' })])
    const s = useReviewStore()
    await s.ensure('2024-02')
    expect(s.rowOf('salary:2024-02')?.status).toBe('entered')
    await s.submit('salary:2024-02')
    expect(s.rowOf('salary:2024-02')?.status).toBe('submitted')
    expect(listCalls()).toBe(2)
  })

  // 破坏验证:把 catch 里那句 failed 记录删掉,这条红 —— 拉失败会与「这个月没有审核记录」
  // 无法区分,而后者是放行,前者必须保守。
  it('拉失败要留痕:isLoaded 为假且 isFailed 为真', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('boom'))
    const s = useReviewStore()
    await s.ensure('2024-02')
    expect(s.isLoaded('2024-02')).toBe(false)
    expect(s.isFailed('2024-02')).toBe(true)
    expect(s.rowsOf('2024-02')).toEqual([])
  })
})
