import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { metersApi } from '@/api/meters'
import { allocApi } from '@/api/alloc'
import { billNoticesApi } from '@/api/billNotices'
import { paramsApi } from '@/api/params'
import { reviewApi } from '@/api/review'

/**
 * 出账链的组级账期(2026-08-28 设计稿 §⑤)。
 *
 * 这份 store 存在的全部理由是**期不能存在屏内 ref**：侧栏点击走 `tabs.openFresh()` →
 * epoch 递增 → `App.vue` 的 KeepAlive key 变 → 组件全新重建走 onMounted。
 * 期若是屏内 ref,每次点侧栏都被清掉、每次都撞选期矩阵 —— 用户原话「我想随意打开某个表来看」。
 *
 * 「只记会话内」(2026-08-29 拍板):不落 localStorage、不写 URL。
 * 刷新 / 重开浏览器过一次矩阵是**有意**的 —— 隔天回来重新确认一次期,成本一次点击。
 */

vi.mock('@/api/meters', () => ({ metersApi: { months: vi.fn() } }))
vi.mock('@/api/alloc', () => ({ allocApi: { poolMonths: vi.fn(), lossMonths: vi.fn() } }))
vi.mock('@/api/billNotices', () => ({ billNoticesApi: { months: vi.fn() } }))
vi.mock('@/api/params', () => ({ paramsApi: { status: vi.fn() } }))
vi.mock('@/api/review', () => ({ reviewApi: { closedMonths: vi.fn() } }))

function wire(opts: {
  meters?: string[]
  pool?: string[]
  loss?: string[]
  notices?: string[]
  stale?: { ym: string; self: boolean; others: string[] }
  closed?: string[] | Error
} = {}) {
  vi.mocked(metersApi.months).mockResolvedValue(opts.meters ?? [])
  vi.mocked(allocApi.poolMonths).mockResolvedValue(opts.pool ?? [])
  vi.mocked(allocApi.lossMonths).mockResolvedValue(opts.loss ?? [])
  vi.mocked(billNoticesApi.months).mockResolvedValue(opts.notices ?? [])
  vi.mocked(paramsApi.status).mockResolvedValue({
    priceOk: 6, priceTotal: 6, pendingChanges: 0, lastChangeAt: null,
    poolSnapshotAt: null, billBatchAt: null,
    stale: opts.stale?.self ?? false,
    otherMonthsAffected: opts.stale?.others ?? [],
  })
  const c = opts.closed
  if (c instanceof Error) vi.mocked(reviewApi.closedMonths).mockRejectedValue(c)
  else vi.mocked(reviewApi.closedMonths).mockResolvedValue(c ?? [])
}

describe('出账链组级账期', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('期本身', () => {
    it('一开始没有期 —— 五屏都该落到选期矩阵', () => {
      const s = useBillingPeriodStore()
      expect(s.picked).toBe(false)
      expect(s.ym).toBe(null)
    })

    it('选过一次之后 picked 为真,ym 是零填充的 YYYY-MM', () => {
      const s = useBillingPeriodStore()
      s.pick(2025, 3)
      expect(s.picked).toBe(true)
      expect(s.ym).toBe('2025-03')
      expect(s.year).toBe(2025)
      expect(s.month).toBe(3)
    })

    it('「换出账月」把期清掉,重新回到矩阵', () => {
      const s = useBillingPeriodStore()
      s.pick(2025, 3)
      s.clear()
      expect(s.picked).toBe(false)
    })

    it('只记会话内 —— 绝不写 localStorage', () => {
      const s = useBillingPeriodStore()
      s.pick(2025, 3)
      // 键名不预设:任何键都不许出现。写进去了就是跨会话记住,与 2026-08-29 的拍板相反。
      expect(localStorage.length).toBe(0)
    })

    it('adopt 只在没有期时认领 —— 深链不覆盖用户手选的期', () => {
      const s = useBillingPeriodStore()
      s.adoptYm('2025-03')
      expect(s.ym).toBe('2025-03')
      s.adoptYm('2024-07')
      expect(s.ym, '已经有期了,后来的深链不许顶掉').toBe('2025-03')
    })

    it('adopt 认不出的串一律不动期', () => {
      const s = useBillingPeriodStore()
      for (const junk of ['', '2025-13', '2025-3', 'abc', '20250-3'] as const) s.adoptYm(junk)
      expect(s.picked).toBe(false)
    })
  })

  describe('矩阵格子', () => {
    it('四道工序各自点亮,互不影响', async () => {
      wire({
        meters: ['2025-01', '2025-02', '2025-03'],
        pool: ['2025-01', '2025-02'],
        loss: ['2025-01'],
        notices: ['2025-01'],
      })
      const s = useBillingPeriodStore()
      await s.loadChain()

      expect(s.cellOf('2025-01')).toEqual({ meters: true, pool: true, loss: true, notices: true, stale: false, closed: false })
      expect(s.cellOf('2025-02')).toEqual({ meters: true, pool: true, loss: false, notices: false, stale: false, closed: false })
      expect(s.cellOf('2025-03')).toEqual({ meters: true, pool: false, loss: false, notices: false, stale: false, closed: false })
    })

    it('没碰过的月四个点全灭', async () => {
      wire({ meters: ['2025-01'] })
      const s = useBillingPeriodStore()
      await s.loadChain()
      expect(s.cellOf('2024-08')).toEqual({ meters: false, pool: false, loss: false, notices: false, stale: false, closed: false })
    })

    it('stale 是月的属性 —— status 的自身 stale 与 otherMonthsAffected 合成一个集合', async () => {
      wire({
        meters: ['2025-01', '2025-02', '2025-03'],
        pool: ['2025-01', '2025-02', '2025-03'],
        stale: { ym: '2025-03', self: true, others: ['2025-01'] },
      })
      const s = useBillingPeriodStore()
      await s.loadChain()
      expect(s.cellOf('2025-03').stale, '被问的那个月自己').toBe(true)
      expect(s.cellOf('2025-01').stale, 'otherMonthsAffected 里的').toBe(true)
      expect(s.cellOf('2025-02').stale, '没在名单里的').toBe(false)
    })

    it('stale 拿最新一个有数据的月去问 —— 一次调用换全集', async () => {
      wire({ meters: ['2024-11'], pool: ['2025-02', '2025-05'], notices: ['2025-03'] })
      const s = useBillingPeriodStore()
      await s.loadChain()
      expect(paramsApi.status).toHaveBeenCalledTimes(1)
      expect(paramsApi.status).toHaveBeenCalledWith('2025-05')
    })

    it('一条数据都没有时不问 status —— 没有月可问,别拿当前系统月凑', async () => {
      wire({})
      const s = useBillingPeriodStore()
      await s.loadChain()
      expect(paramsApi.status).not.toHaveBeenCalled()
      expect(s.loaded).toBe(true)
    })

    it('status 挂了不阻断矩阵 —— 四个工序点照常,只是没有 stale', async () => {
      wire({ meters: ['2025-01'], pool: ['2025-01'] })
      vi.mocked(paramsApi.status).mockRejectedValue(new Error('boom'))
      const s = useBillingPeriodStore()
      await s.loadChain()
      expect(s.loaded).toBe(true)
      expect(s.cellOf('2025-01')).toEqual({ meters: true, pool: true, loss: false, notices: false, stale: false, closed: false })
    })

    it('任一 months 端点挂了就报错 —— 半张矩阵会让用户以为那些月是空的', async () => {
      wire({ meters: ['2025-01'] })
      vi.mocked(allocApi.poolMonths).mockRejectedValue(new Error('boom'))
      const s = useBillingPeriodStore()
      await s.loadChain()
      expect(s.loadErr, '必须说出来,不能静默显示一张缺了公摊列的矩阵').toBeTruthy()
      expect(s.loaded).toBe(false)
    })

    it('数据年 = 四个来源的年并集', async () => {
      wire({ meters: ['2024-11'], pool: ['2025-02'], loss: [], notices: ['2023-06'] })
      const s = useBillingPeriodStore()
      await s.loadChain()
      expect(s.dataYears).toEqual([2023, 2024, 2025])
    })

    it('五屏共读一份 —— 第二次 loadChain 不再打网络', async () => {
      wire({ meters: ['2025-01'] })
      const s = useBillingPeriodStore()
      await s.loadChain()
      await s.loadChain()
      expect(metersApi.months).toHaveBeenCalledTimes(1)
    })

    it('写操作之后 reload 强制重取 —— 生成本月后矩阵要立刻反映', async () => {
      wire({ meters: ['2025-01'] })
      const s = useBillingPeriodStore()
      await s.loadChain()
      wire({ meters: ['2025-01'], pool: ['2025-01'] })
      await s.reloadChain()
      expect(s.cellOf('2025-01').pool).toBe(true)
    })

    // ❗破坏验证:把 `loaded.value = false; inflight = null; return loadChain()` 加回 reloadChain → 红。
    //   年份条读 loaded 决定给不给 pips/locked(DataHomeView 的 yearRows):翻假的那一帧
    //   12×N 个月格的工序点与 ✓ 整块消失,刚抄完读数的月还会被画成虚线「空」卡。
    //   这一条是 2026-09-08 加「审核动作后刷年份条」时顺出来的 —— 那句 reloadChain 本身
    //   会把闪从清单挪到它正上方的年份条,五个既有调用方(抄表/公摊/催缴单/参数保存)一直白一下。
    it('❗reload 在途时旧格子留着 —— 不许先白一帧', async () => {
      wire({ meters: ['2025-01'] })
      const s = useBillingPeriodStore()
      await s.loadChain()
      let release!: (v: string[]) => void
      vi.mocked(metersApi.months).mockReturnValueOnce(new Promise<string[]>(r => { release = r }))
      const p = s.reloadChain()
      expect(s.loaded, '在途时仍算已加载,否则 pips/locked 整块不给').toBe(true)
      expect(s.cellOf('2025-01').meters, '旧格子要留着').toBe(true)
      release(['2025-01']); await p
      expect(s.cellOf('2025-01').meters).toBe(true)
    })
  })
})

// ══════════ 整月已审核 → 月格 ✓(D20,R2 T10) ══════════
describe('整月已审核', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  // 破坏验证:把 fetchAll 里那段 closedMonths 循环删掉 → 红
  it('❗全审的月标 closed,其余月不标', async () => {
    wire({ meters: ['2025-03', '2025-04'], closed: ['2025-03'] })
    const s = useBillingPeriodStore()
    await s.loadChain()
    expect(s.cellOf('2025-03').closed).toBe(true)
    expect(s.cellOf('2025-04').closed).toBe(false)
  })

  // ❗已审核的月**可能一条链数据都没有**(只有附表的月)。
  //   破坏验证:把 `map.get(m) ?? { ...EMPTY }` 换成 `map.get(m)` + 存在才标 → 红。
  it('❗链里没有的月也要标上 —— 只有附表数据的月照样会被审完', async () => {
    wire({ meters: [], closed: ['2025-07'] })
    const s = useBillingPeriodStore()
    await s.loadChain()
    expect(s.cellOf('2025-07').closed).toBe(true)
  })

  // 破坏验证:把那段的 try/catch 去掉 → 红(整屏会变成加载失败)。
  // 与四个 /months 来源不同:缺一枚 ✓ 只是少个标,缺一列工序点会被读成「这些月没做过」。
  it('❗拉不到只是少一枚 ✓,不阻断整个矩阵', async () => {
    wire({ meters: ['2025-03'], closed: new Error('boom') })
    const s = useBillingPeriodStore()
    await s.loadChain()
    expect(s.loaded, '四个工序点照常').toBe(true)
    expect(s.loadErr).toBeNull()
    expect(s.cellOf('2025-03').closed).toBe(false)
  })

  // 破坏验证:把那段里的 `if (!YM.test(m)) continue` 删掉 → 红。
  //
  // ⚠ 这道闸只管**格式**('2025-13' 挡掉),不管年份远近 —— '0001-01' 格式合法,照样进。
  //   年份窗那道闸在视图层(DataHomeView.yearRows 的 inYearWindow),两道各管一段,
  //   都要有:见 yearRows 那句「buildYearRows 内部的钳位只保证不撑爆堆内存」。
  it('❗脏 ym 不进矩阵(格式闸,与四个来源同一道)', async () => {
    wire({ meters: ['2025-03'], closed: ['2025-13', '2025-8', '2025-08'] })
    const s = useBillingPeriodStore()
    await s.loadChain()
    expect([...s.cells.keys()].sort()).toEqual(['2025-03', '2025-08'])
  })
})
