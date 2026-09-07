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

/** 只数打到某条端点的 GET —— 别的 mock 调用不算。 */
const callsTo = (url: string) => vi.mocked(api.get).mock.calls.filter(c => c[0] === url).length
const listCalls = () => callsTo('/review')

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
    await s.ensureYear(2024)
    expect(s.rowOf('ledger:7:2024-02')?.status).toBe('approved')
    expect(s.rowOf('ledger:8:2024-02')).toBeNull()   // 同 kind 不同公司,不许张冠李戴
    expect(s.rowOf('salary:2024-02')).toBeNull()
  })

  // 破坏验证:把 act() 里的 invalidate+ensure 删掉,这条红 —— 屏上会一直挂着交审前的状态。
  // 破坏验证:把 invalidate 里那半段「年道也失效」删掉 → 红。
  // 只失效一道的后果:清单已经翻成「待审核」,而编辑按钮还画得出来。
  it('❗交审之后**两道**都重取,清单与闸不许各说各话', async () => {
    const entered = [row({ key: 'salary:2024-02', status: 'entered' })]
    const submitted = [row({ key: 'salary:2024-02', status: 'submitted' })]
    let phase = 0
    vi.mocked(api.get).mockImplementation(() => Promise.resolve(phase === 0 ? entered : submitted) as never)
    const s = useReviewStore()
    await Promise.all([s.ensure('2024-02'), s.ensureYear(2024)])
    expect(s.rowOf('salary:2024-02')?.status, '闸道').toBe('entered')
    expect(s.rowsOf('2024-02')[0].status, '清单道').toBe('entered')
    phase = 1
    await s.submit('salary:2024-02')
    expect(s.rowOf('salary:2024-02')?.status, '闸道').toBe('submitted')
    expect(s.rowsOf('2024-02')[0].status, '清单道').toBe('submitted')
  })

  // 年表屏(附6/7/8/11、附13/14)按月份行上锁(D18)。
  // 破坏验证:把 lockedMonths 里的 kinds 过滤删掉 → 红(附表7 的锁会串到附表8 的行上)。
  it('❗lockedMonths 只认本屏管的 kind 与 scope', async () => {
    vi.mocked(api.get).mockResolvedValueOnce([
      row({ key: 'charging-car:2024-03', kind: 'charging-car', status: 'approved' }),
      row({ key: 'charging-ebike:2024-05', kind: 'charging-ebike', status: 'submitted' }),
      row({ key: 'pv:2024-07', kind: 'pv', status: 'approved' }),
      row({ key: 'utilities:office:2024-09', kind: 'utilities', scope: 'office', status: 'approved' }),
      row({ key: 'utilities:phase3:2024-11', kind: 'utilities', scope: 'phase3', status: 'approved' }),
      row({ key: 'pv:2024-08', kind: 'pv', status: 'returned' }),   // returned 不锁
    ])
    const s = useReviewStore()
    await s.ensureYear(2024)
    expect([...s.lockedMonths(2024, ['charging-car', 'charging-ebike'])].sort((a, b) => a - b)).toEqual([3, 5])
    expect([...s.lockedMonths(2024, ['pv'])], 'returned 的 8 月不在内').toEqual([7])
    expect([...s.lockedMonths(2024, ['utilities'], 'office')], '两个 scope 各锁各的').toEqual([9])
    expect([...s.lockedMonths(2024, ['utilities'], 'phase3')]).toEqual([11])
    expect([...s.lockedMonths(null, ['pv'])], '还没选年回空集').toEqual([])
  })

  // ❗一屏压多把键(公共电核算屏同时管 alloc 与 alloc-loss:池结果与损耗结果是
  //   AllocService.generate(ym) 同一次算出来的)。**任一把锁着就锁** ——
  //   只看第一把等于放行另一半。
  //   破坏验证:把 blockOf 里那个 for 换成只看 list[0] → 红。
  it('❗多键取「任一把锁着就锁」,不是只看第一把', async () => {
    vi.mocked(api.get).mockResolvedValueOnce([
      row({ key: 'alloc:2024-02', kind: 'alloc', status: 'entered' }),
      row({ key: 'alloc-loss:2024-02', kind: 'alloc-loss', status: 'approved',
            reviewedBy: '李审', reviewedAt: '2024-03-05T10:00:00' }),
    ])
    const s = useReviewStore()
    await s.ensureYear(2024)
    expect(s.blockOf(['alloc:2024-02', 'alloc-loss:2024-02'])?.note).toBe('已审核 · 李审 03-05')
    expect(s.blockOf('alloc:2024-02'), '单看没审的那把当然不挡').toBeNull()
  })

  // 破坏验证:把 blockOf 改回「isFailed → 挡住」→ 红(D-R2-7)。
  it('❗拉失败不挡编辑 —— 与旁边的编辑锁故意相反', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('boom'))
    const s = useReviewStore()
    await s.ensureYear(2024)
    expect(s.blockOf('salary:2024-02'),
           '真正的闸在后端;GET /api/review 内部跑一遍首页聚合,它一抖不该关掉 12 个屏的编辑入口').toBeNull()
  })

  // 拉失败仍要留痕(即使 blockOf 拿它放行):清单屏要能区分「这个月一条审核记录都没有」
  // 和「审核态没取到」—— 前者该显「未交审」,后者该显「—」,显反了就是对用户撒谎。
  // 破坏验证:把 catch 里那句 failed 记录删掉 → 红。
  it('拉失败要留痕:isLoaded 为假且 isFailed 为真', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('boom'))
    const s = useReviewStore()
    await s.ensure('2024-02')
    expect(s.isLoaded('2024-02')).toBe(false)
    expect(s.isFailed('2024-02')).toBe(true)
    expect(s.rowsOf('2024-02')).toEqual([])
  })
})


// ══════════ 屏不许闪(2026-09-08) ══════════
//
// 用户实测:月度台账 6 个公司点一次「交审」,行一个一个变绿、整屏反复闪。
// 两个成因各一条用例钉住 —— 这两条是这次修复的全部意义,杀不掉就等于没修。
describe('❗审核动作期间屏上不许出现空帧', () => {
  const P = '2024-02'
  const K1 = 'ledger:1:2024-02'
  const K2 = 'ledger:2:2024-02'

  async function loaded() {
    vi.mocked(api.get).mockResolvedValue([row({ key: K1, kind: 'ledger', scope: '1' }),
                                          row({ key: K2, kind: 'ledger', scope: '2' })])
    const s = useReviewStore()
    await Promise.all([s.ensure(P), s.ensureYear(2024)])
    return s
  }

  // ❗破坏验证:把 invalidate 改回「立刻 delete」→ 红。
  //   那一帧 rowsOf 回空数组,清单整张退成「—」、动作按钮整组从 DOM 消失,数据回来再画一遍。
  it('❗失效只是标过期,旧值必须还在 —— 这一条就是「不闪」本身', async () => {
    const s = await loaded()
    s.invalidate(P)
    expect(s.rowsOf(P), '失效之后旧值还得在').toHaveLength(2)
    expect(s.isLoaded(P), '屏靠这个判要不要显「—」').toBe(true)
    expect(s.rowOf(K1), '闸道同理:别的页签的锁提示不许被抹平').not.toBeNull()
  })

  // ❗破坏验证:把 store 的 batch() 改回「每把键各 invalidate + 重取一次」→ 红(会是 2 不是 1)。
  it('❗一行 N 把键只收一次尾 —— 逐把收尾就是「一个一个变绿」', async () => {
    const s = await loaded()
    const before = listCalls()
    await s.submitAll([K1, K2])
    expect(vi.mocked(api.post), '两把键各写一次').toHaveBeenCalledTimes(2)
    expect(listCalls() - before, '清单只重取一次').toBe(1)
  })

  // 标了过期就必须真的重拉 —— 只标不拉的话屏上永远停在旧数据上,比闪更糟。
  it('过期之后 ensure 会重拉,不被「已经有了」短路掉', async () => {
    const s = await loaded()
    const before = listCalls()
    await s.ensure(P)
    expect(listCalls() - before, '没过期就不该再拉').toBe(0)
    s.invalidate(P)
    await s.ensure(P)
    expect(listCalls() - before, '过期了要拉').toBe(1)
  })

  // ❗破坏验证:把 ensure/ensureYear 里那两句 seq 比对删掉 → 红。
  //   失效前发出的请求回来得比新的晚时,会把过期数据写回去 —— 屏上就是「审完了又变回未交审」。
  it('❗在途请求跨过一次失效之后回包,必须丢掉', async () => {
    const s = await loaded()
    let release: (v: unknown) => void = () => {}
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((r) => { release = r }) as never)
    s.invalidate(P)
    const first = s.ensure(P)                       // 这一趟在途
    s.invalidate(P)                                 // 再失效一次 —— 上面那趟的号作废
    release([row({ key: K1, kind: 'ledger', scope: '1', status: 'approved' })])
    await first
    expect(s.rowsOf(P), '作废那趟的回包不许落地').toHaveLength(2)
  })
})
