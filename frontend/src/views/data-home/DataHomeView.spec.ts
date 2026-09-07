import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, defineComponent, h, KeepAlive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { DataHomeOverviewDTO, DataHomeStepDTO, DataHomeItemDTO } from '@/types/dataHome'
import type { Pending } from '@/api/approvals'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { usePresenceStore } from '@/stores/presence'
import { useTabsStore } from '@/stores/tabs'
import { metersApi } from '@/api/meters'
import { allocApi } from '@/api/alloc'
import { billNoticesApi } from '@/api/billNotices'
import { paramsApi } from '@/api/params'

// 锁 DATA-HOME-REDESIGN spec §2/§5:三级主次(总览行 → 流水线 → 当前步大卡 + 唯一主 CTA),
// 以及「没问题的东西不占版面」(blockers 空 → 整条不渲染)。
// 改版前这屏把同一批信息说了三遍(KPI 3/4 与下方重复、待办是完整度的子集),那组断言已随契约删除。

beforeEach(() => {
  setActivePinia(createPinia())
  push.mockClear()
  // go() 现在会调 period.loadChain() —— 不清空的话「不触发 loadChain」那条会被上一条的调用污染
  vi.mocked(metersApi.months).mockClear()
  vi.mocked(allocApi.poolMonths).mockClear()
  vi.mocked(allocApi.lossMonths).mockClear()
  vi.mocked(billNoticesApi.months).mockClear()
  vi.mocked(paramsApi.status).mockClear()
  reconOverview.mockClear()
})

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

const getOverview = vi.fn()
vi.mock('@/api/dataHome', () => ({ dataHomeApi: { getOverview: (ym?: string) => getOverview(ym) } }))

// 收入核对元数据(P2 T3):默认回一个没有当月 MonthMeta 的空年,reconRow 的 hasData 闸判 na——
// 与改版前(recon 概念还不存在)的 25 条老用例默认行为等价,不改它们的既有预期。
const reconOverview = vi.fn().mockResolvedValue({ year: 0, months: [] })
vi.mock('@/api/recon', () => ({ reconApi: { overview: (year?: number) => reconOverview(year) } }))

// billingPeriod.loadChain 打的四个端点(照 stores/__tests__/billingPeriod.spec.ts:21-24 的写法)。
// 不 mock 的话点一下出账链行就真发网络请求。
vi.mock('@/api/meters', () => ({ metersApi: { months: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/api/alloc', () => ({ allocApi: { poolMonths: vi.fn().mockResolvedValue([]), lossMonths: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/api/billNotices', () => ({ billNoticesApi: { months: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/api/params', () => ({ paramsApi: { status: vi.fn().mockResolvedValue({ stale: false, otherMonthsAffected: [] }) } }))
// 审核态(R2 T6):不 mock 的话 reviewApi 走真 axios,jsdom 里抛错 → 全行显「—」,
// 下面那组用例会全部恒绿(而不是红),所以必须 mock。
vi.mock('@/api/review', () => ({
  reviewApi: {
    list: vi.fn().mockResolvedValue([]),
    states: vi.fn().mockResolvedValue([]),
    submit: vi.fn().mockResolvedValue(undefined),
    approve: vi.fn().mockResolvedValue(undefined),
    returnBack: vi.fn().mockResolvedValue(undefined),
    withdraw: vi.fn().mockResolvedValue(undefined),
    closedMonths: vi.fn().mockResolvedValue([]),
  },
}))

import DataHomeView from './DataHomeView.vue'

const step = (key: string, label: string, status: DataHomeStepDTO['status'], detail = ''): DataHomeStepDTO =>
  ({ key, label, status, detail, go: key })

const STEPS_4DONE: DataHomeStepDTO[] = [
  step('params', '计费参数', 'done', '本月电价 6/6 已录'),
  step('meters', '园区抄表', 'done', '已抄 1088 块'),
  step('alloc', '公共电核算', 'done'),
  step('alloc-loss', '楼栋损耗', 'done'),
  step('bill-notices', '催缴单', 'current', '未生成'),
]
const STEPS_ALLDONE: DataHomeStepDTO[] = STEPS_4DONE.map((s, i) =>
  i === 4 ? step('bill-notices', '催缴单', 'done', '102 户 · ¥2474138.88 · 66 户带警告') : s)

const BLOCKER_CONTRACT = {
  kind: 'contract-gap' as const,
  text: '219 份合同无租金计费行，会让公摊/催缴单算不准',
  cta: '去补档', go: 'contracts',
}

function overview(patch: Partial<DataHomeOverviewDTO> = {}): DataHomeOverviewDTO {
  return {
    period: { year: 2024, month: 2, label: '2024年2月' },
    months: ['2023-08', '2024-02', '2025-06'],
    blockers: [],
    chain: { currentIndex: 4, steps: STEPS_4DONE },
    schedules: {
      done: 2, total: 9,
      items: [
        { name: '月度台账', tag: '凭证', done: false, go: 'ledger' },
        { name: '办公水电', tag: '附13', done: true, go: 'utilities' },
        { name: '光伏发电', tag: '附6', done: true, go: 'pv-income' },
        { name: '三期水电', tag: '附14', done: true, go: 'utilities' },
      ],
    },
    ...patch,
  }
}

// RBAC v2 起 isReadonly = 「一个 :edit 权限都没有」,不再是 role === 'viewer'。
// 这屏用它决定 CTA 文案(「去处理」vs「查看」)与写按钮是否渲染,所以默认给一个有写权限的
// 登录态 —— 否则版面用例会被权限态带偏(空 pinia 在 v2 下就是只读)。传 perms: [] 模拟只读账号。
// 必须在 setActivePinia 之前写 storage:auth store 是初始化时读它的。
const EDITOR_PERMS = ['entry:edit', 'billing-run:edit', 'meter-reading:edit', 'report:edit']

async function mountWith(patch: Partial<DataHomeOverviewDTO> = {}, opts: { perms?: string[] } = {}) {
  localStorage.setItem('permissions', JSON.stringify(opts.perms ?? EDITOR_PERMS))
  setActivePinia(createPinia())
  getOverview.mockResolvedValue(overview(patch))
  const w = mount(DataHomeView)
  await flushPromises()
  return w
}

describe('数据中心首页 · 两段式工作台', () => {
  it('blockers 为空时前置条整条不渲染', async () => {
    const w = await mountWith({ blockers: [] })
    expect(w.find('.dh-blocker').exists()).toBe(false)
    expect(w.text()).not.toContain('去补档')
  })

  it('blockers 非空时才出现,且带 CTA', async () => {
    const w = await mountWith({ blockers: [BLOCKER_CONTRACT] })
    expect(w.find('.dh-blocker').exists()).toBe(true)
    expect(w.text()).toContain('219 份合同无租金计费行')
    expect(w.text()).toContain('去补档')
    // 年份条(裁定 6)必须读在前置条上面 —— 否则用户看到一条按 ym 算的警告却不知道说的是哪个月(F5)
    const h = w.html()
    expect(h.indexOf('dh-ystrip')).toBeLessThan(h.indexOf('dh-blocker'))
  })

  it('当前步出大卡,且全页只有一个主 CTA', async () => {
    const w = await mountWith({ chain: { currentIndex: 4, steps: STEPS_4DONE } })
    expect(w.text()).toContain('催缴单')
    expect(w.findAll('[data-primary-cta]')).toHaveLength(1)
    expect(w.text()).toContain('去处理')
  })

  it('5 步全 done 时大卡换成去对账', async () => {
    const w = await mountWith({ chain: { currentIndex: -1, steps: STEPS_ALLDONE } })
    expect(w.text()).toContain('本月出账已完成')
    expect(w.text()).toContain('去对账核对')
    expect(w.findAll('[data-primary-cta]')).toHaveLength(1)
  })

  it('period 为 null 时显示空库引导', async () => {
    const w = await mountWith({ period: null })
    expect(w.text()).toContain('还没开始出账')
    expect(w.find('.dh-rows').exists()).toBe(false)   // 空库不摆两栏清单空架子(选择器:胶囊行 → 两栏行,P2 T3)
    // 全新库只给一句引导,不摆空架子(F6):年份条同样不该先弹出一堆可点的「空」卡
    expect(w.findComponent({ name: 'BookMonthMatrix' }).exists()).toBe(false)
  })

  it('零写权限:主 CTA 改「查看」,前置条的写操作按钮隐藏', async () => {
    const w = await mountWith({ blockers: [BLOCKER_CONTRACT] }, { perms: [] })
    expect(w.text()).toContain('查看')
    expect(w.text()).not.toContain('去处理')
    // 前置条文案照出(他该知道有缺口),但「去补档」是写操作,不给点
    expect(w.text()).toContain('219 份合同无租金计费行')
    expect(w.text()).not.toContain('去补档')
  })

  // P2 T3:「附表未录在前、已录在后」整条删 —— sortedItems 不再存在,记账列改成固定的
  // BOOKING_ROWS 业务序(monthClose.logic.ts),不再按 done 排序。

  it('不传 ym 首载走锚定月(后端定)', async () => {
    await mountWith()
    expect(getOverview).toHaveBeenCalledWith(undefined)
  })

  // ── 行点击带月(SIDEBAR-UX-REDESIGN §4.1 / D2):出账链五屏共读 billingPeriod store,
  //    首页先 pick 当前月再跳,目标屏的 ChainMonthGate 因 period.picked 而不渲染 ──
  it('点出账链步骤:先把首页当前月写进 billingPeriod 再跳转', async () => {
    const w = await mountWith()
    await w.findAll('.dh-row-billing')[1].trigger('click')   // 园区抄表(选择器:胶囊行 → 两栏行,P2 T3)
    const period = useBillingPeriodStore()
    expect(period.picked).toBe(true)
    expect([period.year, period.month]).toEqual([2024, 2])
    expect(push).toHaveBeenCalledWith({ path: '/meters', query: { p: '2024-02' } })
  })

  it('点附表项:不动 billingPeriod;月表行带 p=YYYY-MM(SIDEBAR-UX-REDESIGN §5.1,P0b)', async () => {
    const w = await mountWith()
    await w.findAll('.dh-row-booking')[0].trigger('click')   // 月度台账(选择器:胶囊行 → 两栏行,P2 T3)
    expect(useBillingPeriodStore().picked).toBe(false)
    expect(push).toHaveBeenCalledWith({ path: '/ledger', query: { p: '2024-02' } })
  })

  it('年表行带 p=YYYY + mode=summary —— 年表屏 p 只取年,盖过本机记住的运营账', async () => {
    // 红线:periodOf(p.year, p.month) → 目标屏 current 永不相等,每次切回白拉;mode 漏了 → 落到本机记住的运营账
    // 选择器:胶囊行 → 两栏行(P2 T3);索引位移 2 → 4 —— 记账列改成固定业务序(monthClose.logic.ts
    // BOOKING_ROWS:ledger/sales-income/salary/utilities/pv-income/…),光伏发电挪到第 5 行(下标 4)。
    const w = await mountWith()
    await w.findAll('.dh-row-booking')[4].trigger('click')   // 光伏发电(附6)
    expect(push).toHaveBeenCalledWith({ path: '/pv-income', query: { p: '2024', mode: 'summary' } })
  })

  // P2 T3 改:附13+附14 折成一行「办公·三期水电」后不再是两个独立 .dh-item,断言改成点行内
  // 两个 chip(办公/三期),口径不变 —— 各自仍要落到对应 tab。
  it('附13 / 附14 合并行:两个 chip 各带自己的 tab —— 按行的 tag 分', async () => {
    // 红线:goChip 不按 chip.tab 分支、退回统一走 r.tag → 两个 chip 都落办公水电
    const w = await mountWith()
    const row = w.findAll('.dh-row-booking').find(r => r.text().includes('办公·三期水电'))!
    const chips = row.findAll('.dh-chip')
    expect(chips.map(c => c.text())).toEqual(['办公', '三期'])
    await chips[0].trigger('click')
    expect(push).toHaveBeenLastCalledWith({ path: '/utilities', query: { p: '2024', tab: 'office' } })
    await chips[1].trigger('click')
    expect(push).toHaveBeenLastCalledWith({ path: '/utilities', query: { p: '2024', tab: 'phase3' } })
  })

  it('进屏即 loadChain 一次,再点出账链行不重复打网络', async () => {
    // 年份条要 4 个工序点,所以本屏从 T4 起进屏就发;go() 里那句是幂等兜底(loaded 后直接返回)。
    // 不补这一句,目标屏 chainStepsOf(cellOf(ym)) 读到冻结的 EMPTY 格子,五道工序全显「未做」。
    const w = await mountWith()
    expect(vi.mocked(metersApi.months)).toHaveBeenCalledTimes(1)
    await w.findAll('.dh-row-billing')[1].trigger('click')
    await flushPromises()
    expect(vi.mocked(metersApi.months)).toHaveBeenCalledTimes(1)
  })

  // 修补(F9):首载失败后 loaded 仍为 false、inflight 已清空 —— 点链行时 go() 里的
  // loadChain 该真的再发一次,不是被幂等兜底吞掉。这条路径此前没有覆盖。
  it('首载失败后点链行会重试:loadChain 再发一次', async () => {
    vi.mocked(metersApi.months).mockRejectedValueOnce(new Error('x'))
    const w = await mountWith()
    await flushPromises()
    expect(vi.mocked(metersApi.months)).toHaveBeenCalledTimes(1)
    await w.findAll('.dh-row-billing')[1].trigger('click')
    await flushPromises()
    expect(vi.mocked(metersApi.months)).toHaveBeenCalledTimes(2)
  })

  // ── 刚选的月 vs 服务端回包(2026-09-03 对抗复查 F2)──
  it('刚选的月优先:回包未到时点步骤也按新选月 pick', async () => {
    const w = await mountWith()
    // 第二次 getOverview 停在在途,模拟用户切月后马上点
    let resolve!: (v: DataHomeOverviewDTO) => void
    getOverview.mockReturnValueOnce(new Promise<DataHomeOverviewDTO>((r) => { resolve = r }))
    await w.findComponent({ name: 'BookMonthMatrix' }).vm.$emit('pick', 2025, 6)
    await flushPromises()
    await w.findAll('.dh-row-billing')[1].trigger('click')   // 选择器:胶囊行 → 两栏行,P2 T3
    expect([useBillingPeriodStore().year, useBillingPeriodStore().month]).toEqual([2025, 6])
    resolve(overview({ period: { year: 2025, month: 6, label: '2025年6月' } }))
    await flushPromises()
  })

  it('晚到的旧回包不覆盖新选的月', async () => {
    const w = await mountWith()
    let resolveA!: (v: DataHomeOverviewDTO) => void
    let resolveB!: (v: DataHomeOverviewDTO) => void
    getOverview
      .mockReturnValueOnce(new Promise<DataHomeOverviewDTO>((r) => { resolveA = r }))
      .mockReturnValueOnce(new Promise<DataHomeOverviewDTO>((r) => { resolveB = r }))
    const sel = w.findComponent({ name: 'BookMonthMatrix' })
    await sel.vm.$emit('pick', 2023, 8)
    await flushPromises()
    await sel.vm.$emit('pick', 2025, 6)
    await flushPromises()
    resolveB(overview({ period: { year: 2025, month: 6, label: '2025年6月' } }))
    await flushPromises()
    resolveA(overview({ period: { year: 2023, month: 8, label: '2023年8月' } }))
    await flushPromises()
    expect(w.text()).toContain('2025年6月')
    expect(w.text()).not.toContain('2023年8月')
  })

  it('全 done 的「去对账核对」带 ?p', async () => {
    const w = await mountWith({ chain: { currentIndex: -1, steps: STEPS_ALLDONE } })
    await w.find('[data-primary-cta]').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/reconciliation', query: { p: '2024-02' } })
    expect(useBillingPeriodStore().picked).toBe(false)   // 收入核对不在出账链,不 pick
  })

  it('握着台账的锁时点非链行也先确认 —— 首页行仍是 openFresh,改前只盖出账链五屏,附10 / 台账的草稿一律不问(P3 §4.1 收窄)', async () => {
    const w = await mountWith()
    const presence = usePresenceStore()
    presence.holdLock('ledger:1:2025-03', () => {})     // 本标签页本地持锁,不等服务端回声
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const row = w.findAll('.dh-row-booking').find(r => r.text().includes('月度台账'))   // 选择器:胶囊行 → 两栏行,P2 T3
    expect(row, '清单里没有月度台账那一行').toBeTruthy()
    await row!.trigger('click')
    expect(confirm, '台账的草稿也该问一句').toHaveBeenCalledOnce()
    expect(push).not.toHaveBeenCalled()
    confirm.mockRestore()
    presence.stop()
  })

  it('本人握着别的月的链锁时点出账链行先确认,取消则不切期不跳转', async () => {
    const w = await mountWith()
    const presence = usePresenceStore()
    presence.users = [{
      sid: presence.sid, user: 'me', displayName: '我', role: null, scope: null, label: null, mode: 'edit',
      editScopes: ['billing-chain:2025-03'], sinceMs: 0, idleMs: 0, self: true,
    }]
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await w.findAll('.dh-row-billing')[1].trigger('click')   // 选择器:胶囊行 → 两栏行,P2 T3
    expect(confirm).toHaveBeenCalledOnce()
    expect(useBillingPeriodStore().picked).toBe(false)
    expect(push).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  // openFresh 无条件重建目标屏 —— 草稿不分同月异月都会丢,所以确认框认「有没有锁」不认「哪个月」
  // (2026-09-03 对抗复查 F3;spec D2 原文就是「链屏处于编辑态时先确认」)。
  it('本人握着同年的抄表年锁时点出账链行也弹确认(openFresh 会重建)', async () => {
    const w = await mountWith()
    const presence = usePresenceStore()
    presence.users = [{
      sid: presence.sid, user: 'me', displayName: '我', role: null, scope: null, label: null, mode: 'edit',
      editScopes: ['meters:2024'], sinceMs: 0, idleMs: 0, self: true,
    }]
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await w.findAll('.dh-row-billing')[1].trigger('click')   // 选择器:胶囊行 → 两栏行,P2 T3
    expect(confirm).toHaveBeenCalledOnce()
    expect(useBillingPeriodStore().picked).toBe(false)
    expect(push).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('本人握着同月的链锁时点出账链行也弹确认(同月一样会丢草稿)', async () => {
    const w = await mountWith()
    const presence = usePresenceStore()
    presence.users = [{
      sid: presence.sid, user: 'me', displayName: '我', role: null, scope: null, label: null, mode: 'edit',
      editScopes: ['billing-chain:2024-02'], sinceMs: 0, idleMs: 0, self: true,
    }]
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await w.findAll('.dh-row-billing')[1].trigger('click')   // 选择器:胶囊行 → 两栏行,P2 T3
    expect(confirm).toHaveBeenCalledOnce()
    expect(useBillingPeriodStore().picked).toBe(false)
    expect(push).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('多标签页:只看本标签页(sid)的锁 —— 别的标签页的自己座位持链锁不算', async () => {
    const w = await mountWith()
    const presence = usePresenceStore()
    presence.users = [
      { sid: 'other-tab', user: 'me', displayName: '我', role: null, scope: null, label: null, mode: 'edit',
        editScopes: ['billing-chain:2025-03'], sinceMs: 600_000, idleMs: 0, self: true },
      { sid: presence.sid, user: 'me', displayName: '我', role: null, scope: null, label: null, mode: 'view',
        editScopes: [], sinceMs: 0, idleMs: 0, self: true },
    ]
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await w.findAll('.dh-row-billing')[1].trigger('click')   // 选择器:胶囊行 → 两栏行,P2 T3
    expect(confirm).not.toHaveBeenCalled()
    expect(useBillingPeriodStore().picked).toBe(true)
    confirm.mockRestore()
  })
  it('多标签页:本标签页(sid)持链锁即使排在后面也弹确认', async () => {
    const w = await mountWith()
    const presence = usePresenceStore()
    presence.users = [
      { sid: 'other-tab', user: 'me', displayName: '我', role: null, scope: null, label: null, mode: 'edit',
        editScopes: ['sched:salary:2025-06'], sinceMs: 600_000, idleMs: 0, self: true },
      { sid: presence.sid, user: 'me', displayName: '我', role: null, scope: null, label: null, mode: 'edit',
        editScopes: ['billing-chain:2024-02'], sinceMs: 0, idleMs: 0, self: true },
    ]
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await w.findAll('.dh-row-billing')[1].trigger('click')   // 选择器:胶囊行 → 两栏行,P2 T3
    expect(confirm).toHaveBeenCalledOnce()
    expect(useBillingPeriodStore().picked).toBe(false)
    confirm.mockRestore()
  })
})

describe('数据中心首页 · 首载骨架', () => {
  // 这屏此前是整页 `v-if="ov"` —— 数据到达前一整块白屏，而它是登录后第一眼看到的屏。
  //
  // ⚠ 它的骨架**是另画的一份版式**（不像列表屏那样能在叶子上放骨架），所以有漂移风险：
  //   谁改了真版式的条数却忘了改骨架，界面就会在数据落位时跳一下，而且不报错。
  //   下面两条就是钉这件事的 —— 出账列恒 7 行、记账列恒 8 行(P2 T3,monthClose.logic §5.2)。

  /** 让接口停在「在途」，好在数据到达前观察 DOM。 */
  function pending() {
    let resolve!: (v: DataHomeOverviewDTO) => void
    getOverview.mockReturnValue(new Promise<DataHomeOverviewDTO>((r) => { resolve = r }))
    return { resolve }
  }

  it('数据没到时不是白屏，骨架条数与真版式一致', async () => {
    localStorage.setItem('permissions', JSON.stringify(EDITOR_PERMS))
    setActivePinia(createPinia())
    const gate = pending()
    const w = mount(DataHomeView)
    await flushPromises()

    expect(w.find('.dh').exists(), '根节点必须常驻 —— 它是零位移的锚点').toBe(true)
    expect(w.findAll('.fp-shim').length, '要有骨架，不是白屏').toBeGreaterThan(0)
    // 选择器:胶囊行 → 两栏行;期望值 5→7 / 9→8 —— 出账列并入收入核对 + 本月锁账两行,
    // 记账列 9 源折成 8 行(P2 T3,批准的既有断言改动清单)。
    expect(w.findAll('.dh-row-billing').length, '出账列恒 7 行').toBe(7)
    expect(w.findAll('.dh-row-booking').length, '记账列恒 8 行').toBe(8)
    // 骨架也要两栏(评审修补 T3 fix-brief #1):骨架态断,不是落位后 —— 真版式是 .dh-cols 两栏 grid,
    // 骨架若没包这层,数据落位那一瞬轴向会从单列竖排跳成两栏并排,整屏塌一次。
    expect(w.find('.dh-cols').exists(), '骨架也要两栏,否则数据落位时轴向变').toBe(true)
    // 骨架也要有年份条(F10):真版式在 .dh-head 与两栏之间插了 .dh-ystrip,骨架没包的话
    // 落位那一瞬两栏板子会被顶下去一截。
    expect(w.find('.dh-ystrip').exists(), '骨架缺年份条 → 落位时两栏被顶下去').toBe(true)
    // 静态文案不该被糊掉:它们不依赖数据,糊成微光条等于把已知的东西藏起来
    expect(w.text()).toContain('本月出账')
    expect(w.text()).toContain('出账链')

    gate.resolve(overview())
    await flushPromises()
    expect(w.findAll('.fp-shim').length, '数据到了就不该再有骨架').toBe(0)
    expect(w.findAll('.dh-row-billing').length, '真版式也是 7 行 —— 对不上就会跳').toBe(7)
    // 落位后复核不能只看出账列(评审修补 T3 fix-brief #11):记账列也要复核,否则谁把记账列的
    // 条数改坏了,这条测试一条都不会红。
    expect(w.findAll('.dh-row-booking').length, '真版式记账列也是 8 行 —— 对不上就会跳').toBe(8)
  })

  it('根节点在数据到达前后是同一个 DOM 节点', async () => {
    localStorage.setItem('permissions', JSON.stringify(EDITOR_PERMS))
    setActivePinia(createPinia())
    const gate = pending()
    const w = mount(DataHomeView)
    await flushPromises()

    const before = w.find('.dh').element
    gate.resolve(overview())
    await flushPromises()

    expect(w.find('.dh').element, '根节点被重建了 —— 那就是原来那种整页 v-if 的写法').toBe(before)
  })
})

// ── P2 T3:两栏清单落屏。行状态 / chips / 计数全在 monthClose.logic 算完(见其单测),
//    这里只测取数(recon 串行 / 失败降级)与渲染(两栏行数、chips、padlock、chip 深链)。 ──
describe('数据中心首页 · 两栏清单(P2 T3)', () => {
  // 记账列 7 个非导入源全部配到位的夹具(默认 overview() 只给 4 项,大半行是 na)——
  // 用于要求「两栏各自的行数都非 na」的用例(计数分母 n/6、n/7 才成立)。
  function fullBookingItems(overrides: Partial<Record<string, DataHomeItemDTO>> = {}): DataHomeItemDTO[] {
    const base: Record<string, DataHomeItemDTO> = {
      ledger: {
        name: '月度台账', tag: '凭证', done: false, go: 'ledger',
        companies: [{ id: 1, short: 'A公司', done: true }, { id: 2, short: 'B公司', done: false }],
      },
      s10: {
        name: '附表10', tag: '附10', done: true, go: 'sales-income',
        phases: [{ no: 1, done: true }, { no: 2, done: false }, { no: 3, done: true }, { no: 4, done: true }],
      },
      salary: { name: '附表12', tag: '附12', done: true, go: 'salary' },
      util13: { name: '办公水电', tag: '附13', done: true, go: 'utilities' },
      util14: { name: '三期水电', tag: '附14', done: true, go: 'utilities' },
      pv: { name: '光伏发电', tag: '附6', done: true, go: 'pv-income' },
      car: { name: '汽车充电', tag: '附7', done: true, go: 'car-charging' },
      ebike: { name: '电动车充电', tag: '附8', done: true, go: 'ebike-charging' },
      elec: { name: '电费', tag: '附11', done: true, go: 'elec-cost' },
    }
    // Object.values 对 Partial 的展开产出 (T | undefined)[] —— 严格模式下要显式收窄
    return Object.values({ ...base, ...overrides }).filter((x): x is DataHomeItemDTO => x != null)
  }

  it('两栏:出账列 7 行、记账列 8 行,各自带自己的计数', async () => {
    // 收入核对回包给多个月(评审修补 T3 fix-brief #7:recon 选月的 find(m => m.month === month) 零覆盖
    // —— 全 spec 此前只在这里给过成功回包,且 months 只有一个元素,find/[0]/at(-1) 完全等价,测不出
    // 选错月)。这里首月(1月)todo、当月(2月)done:选错月会让出账列少一格 done,.dh-counts 从
    // 「出账 5/6」掉成「出账 4/6」。
    reconOverview.mockResolvedValueOnce({
      year: 2024,
      months: [
        { month: 1, hasData: true, entityCount: 5, okCount: 2, diffCount: 3, missCount: 0 },
        { month: 2, hasData: true, entityCount: 5, okCount: 5, diffCount: 0, missCount: 0 },
      ],
    })
    const w = await mountWith({ schedules: { done: 7, total: 9, items: fullBookingItems() } })
    await flushPromises()   // 让 watch(curYm) 触发的 reconApi.overview 落定
    expect(w.findAll('.dh-row-billing')).toHaveLength(7)
    expect(w.findAll('.dh-row-booking')).toHaveLength(8)
    // 两处计数同源(§8.1):.dh-counts 总览行与 .dh-h3n 记账列标题都从 checks 算,
    // 分母 6/7 不是旧口径的 5/9(doneSteps/5、ov.schedules.total)
    expect(w.find('.dh-counts').text()).toBe('出账 5/6 · 附表 5/7')
    expect(w.find('.dh-h3n').text()).toBe('5/7')
    // 行状态圆点/data-state 三档零覆盖(评审修补 T3 fix-brief #6):此前全仓只钉过 na 一档,
    // dotOf 改成「非 na 一律 ✓」或「非 na 一律 ○」都全绿。这份夹具 done/todo/na 三档都有,
    // 逐行数组断言两个方向都会不再逐项相等 —— 整屏染成已做 / 整片折成未做都要红。
    expect(w.findAll('.dh-row-billing').map(r => r.find('.dh-rdot').text()))
      .toEqual(['✓', '✓', '✓', '✓', '○', '✓', '—'])
    expect(w.findAll('.dh-row-booking').map(r => r.attributes('data-state')))
      .toEqual(['todo', 'todo', 'done', 'done', 'done', 'done', 'done', 'na'])
  })

  // 评审修补(task-3-fix-brief.md #5):分母排除的是结构性 na(导入中心/本月锁账),不是「当下 state
  // 是不是 na」——收入核对还没到达时也是 na,但它是真能做完的事,恒排除会让出账分母随异步加载从 5
  // 跳到 6。默认夹具下 reconOverview 回空年(收入核对 na),分母仍应是 6,不是 5。
  it('没有核对数据的月,出账分母仍是 6 —— 不随 recon 到达从 5 跳到 6', async () => {
    const w = await mountWith({ schedules: { done: 7, total: 9, items: fullBookingItems() } })
    await flushPromises()   // 默认 reconOverview 回空年 → 收入核对 na,但仍计入分母(countable)
    expect(w.find('.dh-counts').text()).toBe('出账 4/6 · 附表 5/7')
  })

  it('源缺的行显「—」不显 0(本月锁账 / 导入中心)', async () => {
    const w = await mountWith()
    const lockRow = w.findAll('.dh-row-billing').find(r => r.text().includes('本月锁账'))
    const impRow = w.findAll('.dh-row-booking').find(r => r.text().includes('导入中心'))
    expect(lockRow, '本月锁账行应照常渲染(na 也不 v-if 掉整行)').toBeTruthy()
    expect(impRow, '导入中心行应照常渲染').toBeTruthy()
    expect(lockRow!.find('.dh-rdot').text()).toBe('—')
    expect(impRow!.find('.dh-rdot').text()).toBe('—')
    // data-state 驱动样式(灰底文案,Step 4 point 1)——不只是圆点文案凑巧对,属性也要跟 r.state 同源
    expect(lockRow!.attributes('data-state')).toBe('na')
    expect(impRow!.attributes('data-state')).toBe('na')
    // 审核态列零覆盖(评审修补 T3 fix-brief #10):此前把 .dh-rreview 整个删掉,33 条一条都不红 ——
    // 补断言钉住这一列确实渲染、且读的是 r.review(本期恒 'na',留字段给 R2 只填数据不改形状)。
    expect(lockRow!.find('.dh-rreview').text()).toBe('—')
    expect(impRow!.find('.dh-rreview').text()).toBe('—')
    expect(lockRow!.find('.dh-rreview').attributes('data-review')).toBe('na')
    expect(impRow!.find('.dh-rreview').attributes('data-review')).toBe('na')
  })

  it('台账行带公司 chips:没录的公司也在,灰的', async () => {
    const w = await mountWith({ schedules: { done: 0, total: 9, items: [
      { name: '月度台账', tag: '凭证', done: false, go: 'ledger',
        companies: [{ id: 1, short: 'A公司', done: true }, { id: 2, short: 'B公司', done: false }] },
    ] } })
    const row = w.findAll('.dh-row-booking').find(r => r.text().includes('月度台账'))!
    const chips = row.findAll('.dh-chip')
    expect(chips.map(c => c.text())).toEqual(['A公司', 'B公司'])
    expect(chips[0].attributes('data-done')).toBe('true')
    expect(chips[1].attributes('data-done')).toBe('false')   // 没录的公司也在,灰的(CSS 靠这个属性变灰)
  })

  it('附10 行带四个期区 chips', async () => {
    const w = await mountWith({ schedules: { done: 0, total: 9, items: [
      { name: '附表10', tag: '附10', done: true, go: 'sales-income',
        phases: [{ no: 1, done: true }, { no: 2, done: false }, { no: 3, done: true }, { no: 4, done: true }] },
    ] } })
    const row = w.findAll('.dh-row-booking').find(r => r.text().includes('附表10'))!
    expect(row.findAll('.dh-chip').map(c => c.text())).toEqual(['一期', '二期', '三期', '宿舍'])
  })

  it('chip 点击带 p 与 co —— 与分析层 openDeep 同口径', async () => {
    const w = await mountWith({ schedules: { done: 0, total: 9, items: [
      { name: '月度台账', tag: '凭证', done: false, go: 'ledger',
        companies: [{ id: 1, short: 'A公司', done: true }, { id: 2, short: 'B公司', done: false }] },
    ] } })
    const row = w.findAll('.dh-row-booking').find(r => r.text().includes('月度台账'))!
    await row.findAll('.dh-chip')[1].trigger('click')   // B公司,co=2
    expect(push).toHaveBeenCalledWith({ path: '/ledger', query: { p: '2024-02', co: '2' } })
  })

  // 补的覆盖(本任务自己的破坏验证抓到的空白):goChip 的 c.go 分支若写死成某一个 go
  // (比如永远 go('car-charging')),此前 32 条一条都不红 —— 深链入口串了没人拦得住。
  it('附7/附8 合并行:两个 chip 各带自己的 go —— 入口不串到另一屏', async () => {
    const w = await mountWith({ schedules: { done: 0, total: 9, items: [
      { name: '汽车充电', tag: '附7', done: true, go: 'car-charging' },
      { name: '电动车充电', tag: '附8', done: false, go: 'ebike-charging' },
    ] } })
    const row = w.findAll('.dh-row-booking').find(r => r.text().includes('附表7/8'))!
    const chips = row.findAll('.dh-chip')
    expect(chips.map(c => c.text())).toEqual(['汽车', '电动车'])
    await chips[0].trigger('click')
    expect(push).toHaveBeenLastCalledWith({ path: '/car-charging', query: { p: '2024', mode: 'summary' } })
    await chips[1].trigger('click')
    expect(push).toHaveBeenLastCalledWith({ path: '/ebike-charging', query: { p: '2024', mode: 'summary' } })
  })

  it('前置未满的行显 padlock,悬停说前置是什么;无入口的行不给点', async () => {
    const w = await mountWith()
    const lockRow = w.findAll('.dh-row-billing').find(r => r.text().includes('本月锁账'))
    expect(lockRow, '本月锁账行应照常渲染').toBeTruthy()
    const icon = lockRow!.find('.dh-rlock')
    expect(icon.exists()).toBe(true)
    // padlock 悬停文案即 r.locked。R2 起本月锁账是派生的(全部键 approved),
    // 审核态还没到时文案是「审核态加载中」——「未上线」那句随 R1/R2 落地作废。
    expect(icon.attributes('title')).toBe('审核态加载中')
    // title 要挂在 HTML 元素上(评审修补 T3 fix-brief #3):SVG 的 title 属性不出浏览器 tooltip,
    // 悬停要出文案,title 得挂在 svg 外面的包壳上 —— 断言收紧,光查属性在不在挡不住挂错元素。
    expect(icon.element.tagName.toLowerCase(), 'title 要挂在非 svg 元素上,否则浏览器不出 tooltip').not.toBe('svg')
    await lockRow!.trigger('click')
    expect(push).not.toHaveBeenCalled()   // r.go 为空 —— 无入口的行不给点
  })

  // 评审修补(task-3-fix-brief.md #8):改前这条只 mock 了失败路径,断言「显—」——但默认夹具
  // (reconOverview 恒回空年)也是「显—」,两条路径逐字等价,删掉 mockRejectedValueOnce 这条用例
  // 照样绿,是一条空断言。补一个「取数成功」的对照(圆点 ✓),让失败路径与成功路径真的可分辨 ——
  // 而不是分辨失败路径与「压根没取数」的默认路径(两者本就该长一样,分辨不出属于正常)。
  it('收入核对取数失败不阻断整屏,该行显「—」(与成功路径对照)', async () => {
    reconOverview.mockResolvedValueOnce({
      year: 2024,
      months: [{ month: 2, hasData: true, entityCount: 5, okCount: 5, diffCount: 0, missCount: 0 }],
    })
    const wOk = await mountWith()
    await flushPromises()
    const okRow = wOk.findAll('.dh-row-billing').find(r => r.text().includes('收入核对'))
    expect(okRow!.find('.dh-rdot').text(), '取数成功要显 ✓,不然和失败路径没法比').toBe('✓')

    reconOverview.mockRejectedValueOnce(new Error('network down'))
    const w = await mountWith()
    await flushPromises()   // 让失败的 reconApi.overview 落定(.catch(() => null))
    expect(w.findAll('.dh-row-billing')).toHaveLength(7)   // 取数失败不阻断整屏
    const row = w.findAll('.dh-row-billing').find(r => r.text().includes('收入核对'))
    expect(row, '收入核对行应照常渲染').toBeTruthy()
    expect(row!.find('.dh-rdot').text()).toBe('—')
  })

  // 评审修补(task-3-fix-brief.md #2):recon 只在 await **之后**赋值,换月那一刻(curYm 已变、
  // 新回包未到)这一行仍挂着上个月的结论。reconSeq 只守晚到方向(旧回包不覆盖新月),不守这段空窗。
  it('换月后收入核对不留上一个月的值', async () => {
    reconOverview.mockResolvedValueOnce({
      year: 2024,
      months: [{ month: 2, hasData: true, entityCount: 5, okCount: 5, diffCount: 0, missCount: 0 }],
    })
    const w = await mountWith()
    await flushPromises()
    const dot = () => w.findAll('.dh-row-billing').find(r => r.text().includes('收入核对'))!.find('.dh-rdot').text()
    expect(dot()).toBe('✓')
    // 切到 2024-03:overview 回来,收入核对停在在途
    getOverview.mockResolvedValueOnce(overview({ period: { year: 2024, month: 3, label: '2024年3月' } }))
    reconOverview.mockReturnValueOnce(new Promise(() => {}))
    await w.findComponent({ name: 'BookMonthMatrix' }).vm.$emit('pick', 2024, 3)
    await flushPromises()
    expect(dot(), '新月的行不该挂着上个月的 ✓').toBe('—')
  })

  // 评审修补(task-3-fix-brief.md #9):reconSeq 竞态守卫零覆盖 —— 兄弟守卫 loadSeq 有专门用例
  // (「晚到的旧回包不覆盖新选的月」)钉住,这份没有。照同款写法:切两次月,让旧月的核对回包晚到。
  it('晚到的旧核对回包不覆盖新选的月(reconSeq 守卫,同 loadSeq 口径)', async () => {
    const w = await mountWith()
    await flushPromises()
    let resolveOld!: (v: unknown) => void
    let resolveNew!: (v: unknown) => void
    reconOverview
      .mockReturnValueOnce(new Promise((r) => { resolveOld = r }))
      .mockReturnValueOnce(new Promise((r) => { resolveNew = r }))
    getOverview
      .mockResolvedValueOnce(overview({ period: { year: 2023, month: 8, label: '2023年8月' } }))
      .mockResolvedValueOnce(overview({ period: { year: 2025, month: 6, label: '2025年6月' } }))
    const sel = w.findComponent({ name: 'BookMonthMatrix' })
    await sel.vm.$emit('pick', 2023, 8)
    await flushPromises()
    await sel.vm.$emit('pick', 2025, 6)
    await flushPromises()
    // 新月(2025-06,已配平)的核对回包先到,旧月(2023-08,有差异)的晚到 —— 晚到的不该覆盖
    resolveNew({ year: 2025, months: [{ month: 6, hasData: true, entityCount: 5, okCount: 5, diffCount: 0, missCount: 0 }] })
    await flushPromises()
    resolveOld({ year: 2023, months: [{ month: 8, hasData: true, entityCount: 3, okCount: 1, diffCount: 2, missCount: 0 }] })
    await flushPromises()
    const dot = () => w.findAll('.dh-row-billing').find(r => r.text().includes('收入核对'))!.find('.dh-rdot').text()
    expect(dot(), '晚到的旧回包(2023-08,有差异)不该盖掉新选月(2025-06,已配平)的收入核对状态').toBe('✓')
  })

  // 开放覆盖项(task-3-brief.md Step 6):若「串行取数」改成并发 onMounted 里发 overview(undefined)
  // 没有任何断言会红,说明这条口径零覆盖。这条直接钉实参是当前年,不是 undefined。
  it('收入核对取数按当前年串行,实参不是 undefined', async () => {
    await mountWith()
    await flushPromises()
    expect(reconOverview).toHaveBeenCalledWith(2024)
  })
})

// ── 年份条取代月份下拉(P2 T4):年份行取 ov.months(链∪附表),链未到不给 pips ──
describe('数据中心首页 · 年份条(P2 T4)', () => {
  it('年份条取代月份下拉:屏上没有 Select,矩阵在,月名照显', async () => {
    const w = await mountWith()
    expect(w.findComponent({ name: 'Select' }).exists()).toBe(false)
    expect(w.findComponent({ name: 'BookMonthMatrix' }).exists()).toBe(true)
    expect(w.text()).toContain('2024年2月')
    // manageYears=false 真的传到了生产落点(F8):首页这条是导航不是账册管理,「＋ 补更早年份」
    // 不该出现 —— 组件级用例只证明组件支持这个 prop,这条证明首页真的传了 false。
    expect(w.find('.bmm-addy').exists()).toBe(false)
  })

  it('年份行来自 ov.months 的年,不是链数据年:只有附表的年也点得进去', async () => {
    const w = await mountWith()   // 夹具 months = ['2023-08','2024-02','2025-06'],链四端点全 mock 成 []
    const years = w.findComponent({ name: 'BookMonthMatrix' }).props('years') as
      { year: number; months: { month: number; hasData: boolean }[] }[]
    expect(years.map(y => y.year), '照 period.dataYears 组年份这里会是空的').toContain(2023)
    expect(years.map(y => y.year)).toContain(2025)
    // hasData 的口径(F4):取 ov.months.includes(ym),不取 pips —— 链全空时若照 pips 判,
    // 整条年份条含正在看的锚定月全部会画成虚线「空」卡。
    const y2024 = years.find(y => y.year === 2024)!
    expect(y2024.months.find(m => m.month === 2)!.hasData, '2024-02 在 ov.months 里').toBe(true)
    expect(y2024.months.find(m => m.month === 1)!.hasData, '2024-01 不在 ov.months 里').toBe(false)
  })

  it('点格子换月:@pick 回写 pickedYm,重新取 overview', async () => {
    const w = await mountWith()
    getOverview.mockResolvedValue(overview({ period: { year: 2025, month: 6, label: '2025年6月' } }))
    await w.findComponent({ name: 'BookMonthMatrix' }).vm.$emit('pick', 2025, 6)
    await flushPromises()
    expect(getOverview).toHaveBeenLastCalledWith('2025-06')
    expect(w.text()).toContain('2025年6月')
  })

  it('描边跟着当前显示月走,不是「最近有数据月」', async () => {
    const w = await mountWith()   // 锚定月 2024-02
    const years = w.findComponent({ name: 'BookMonthMatrix' }).props('years') as { year: number; months: { month: number; cur?: boolean }[] }[]
    const flat = years.flatMap(y => y.months.map(m => ({ ym: `${y.year}-${String(m.month).padStart(2, '0')}`, cur: m.cur })))
    expect(flat.filter(c => c.cur).map(c => c.ym)).toEqual(['2024-02'])
  })

  it('链数据没到时不给 pips —— 四个灭点会被读成「这个月一道工序没走」', async () => {
    // metersApi.months 停在在途:overview 已上屏,billingPeriod.loaded 仍为 false
    let resolve!: (v: string[]) => void
    vi.mocked(metersApi.months).mockReturnValueOnce(new Promise<string[]>((r) => { resolve = r }))
    const w = await mountWith()
    const years = w.findComponent({ name: 'BookMonthMatrix' }).props('years') as { months: { pips?: boolean[] }[] }[]
    expect(years.flatMap(y => y.months).every(m => m.pips === undefined),
      '未加载时传 [false,false,false,false] = 假绿:那是「查过了,一道没走」').toBe(true)
    resolve([])
    await flushPromises()
  })

  // F2(真 bug,major):一条脏 ym(格式不对或年份离谱)不校验就直接 +m.slice(0,4) 取年,
  // 会让 buildYearRows 的 lo..hi 跨两千年,2000+ 行 × 12 卡 —— 复查已实跑坐实 OOM。
  it('脏 ym 不进年份条:混进脏值不会撑爆年份行(F2)', async () => {
    const dirty = await mountWith({ months: ['2023-08', 'GARBAGE', '0001-01', '2025-06'] })
    const dirtyYears = dirty.findComponent({ name: 'BookMonthMatrix' }).props('years') as { year: number }[]
    const clean = await mountWith({ months: ['2023-08', '2025-06'] })
    const cleanYears = clean.findComponent({ name: 'BookMonthMatrix' }).props('years') as { year: number }[]
    expect(dirtyYears.length, '脏值应被滤掉,行数与只喂两条干净值时相同').toBe(cleanYears.length)
  })

  // F3:四个工序点的值 —— 顺序错就是屏上四道工序说错,此前一条断言都没有。
  it('工序点的值对,且只钉住取到值的那个格子 —— 别的月不沾光', async () => {
    vi.mocked(metersApi.months).mockResolvedValueOnce(['2024-02'])
    const w = await mountWith()
    await flushPromises()
    const years = w.findComponent({ name: 'BookMonthMatrix' }).props('years') as
      { year: number; months: { month: number; pips?: boolean[] }[] }[]
    const cell = (y: number, m: number) => years.find(yr => yr.year === y)!.months.find(mm => mm.month === m)!
    expect(cell(2024, 2).pips, 'pipsOf 顺序是 [meters,pool,loss,notices]').toEqual([true, false, false, false])
    expect(cell(2023, 8).pips, '没数据的月四道工序都没走').toEqual([false, false, false, false])
  })

  // F12:stale 与 pips 同一段落出,同样没有断言 —— 参数改动晚于快照那面旗要传对。
  it('stale 从链数据传到年份条格子', async () => {
    vi.mocked(metersApi.months).mockResolvedValueOnce(['2024-02'])
    vi.mocked(paramsApi.status).mockResolvedValueOnce({
      priceOk: 6, priceTotal: 6, pendingChanges: 0, lastChangeAt: null,
      poolSnapshotAt: null, billBatchAt: null,
      stale: true, otherMonthsAffected: ['2024-02'],
    })
    const w = await mountWith()
    await flushPromises()
    const years = w.findComponent({ name: 'BookMonthMatrix' }).props('years') as
      { year: number; months: { month: number; stale?: boolean }[] }[]
    expect(years.find(y => y.year === 2024)!.months.find(m => m.month === 2)!.stale).toBe(true)
  })

  // F1(真 bug,blocker):切走再切回,KeepAlive 命中缓存实例、onMounted 不再跑 —— ov(两栏板子 /
  // 两处计数 / 年份条的 hasData 全靠它)整个会话只取一次,而 period.cells 是活的(抄表/公摊/
  // 损耗/催缴单写完都调 reloadChain)。不补 onReactivated,刚抄完读数的月切回首页会被画成虚线「空」。
  it('切走再切回重取 overview:年份条读活的链数据,两栏板子不能停在旧快照', async () => {
    const alive = ref(true)
    localStorage.setItem('permissions', JSON.stringify(EDITOR_PERMS))
    setActivePinia(createPinia())
    getOverview.mockResolvedValue(overview())
    getOverview.mockClear()   // 之前测试留下的调用计数不该算进这条的「取数一次/两次」
    mount(defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(DataHomeView) : null) }),
    }))
    await flushPromises()
    expect(getOverview).toHaveBeenCalledTimes(1)
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(getOverview).toHaveBeenCalledTimes(2)
  })
})

// ── 主管条(P2 T6):presence.approvals(20 秒一拍的 ping 顺带带回,不加新请求)+「谁在编辑」chips。
//    外层唯一允许的 v-if 是权限判(有没有这个角色),数据 v-if 一律禁 —— 32px 定高常驻(裁定 1/2)。 ──
describe('数据中心首页 · 主管条(P2 T6)', () => {
  function seatEditor(displayName: string, editScopes: string[], label: string | null = null) {
    return { sid: 's-' + displayName, user: displayName, displayName, role: null,
             scope: editScopes[0] ?? null, label, mode: 'edit' as const,
             editScopes, sinceMs: 0, idleMs: 0, self: false }
  }
  function pending(id: string): Pending {
    return { id, requester: 'u-' + id, requesterName: id, requesterRole: null,
             perms: ['x'], permLabels: ['x'], page: 'x', action: 'x', impact: null, leftMs: 60_000 }
  }

  it('主管条:无 lock:takeover 也无 system:view → 整条不渲染', async () => {
    const w = await mountWith({}, { perms: ['entry:edit'] })
    expect(w.find('.dh-sup').exists()).toBe(false)
  })

  it('主管条:有权限但零待批 —— 条还在,显「暂无待批」,不是 v-if 消失', async () => {
    // 32px 定高常驻(spec §5.2)。写成 v-if="approvals.length" 门禁不会红(零位移那份的
    // 交互态词表里没有 approvals),只有这条能守住。
    const w = await mountWith({}, { perms: [...EDITOR_PERMS, 'lock:takeover'] })
    expect(w.find('.dh-sup').exists()).toBe(true)
    expect(w.find('.dh-sup').isVisible(), '不许被 display:none 之类藏掉(候选9)').toBe(true)
    expect(w.find('.dh-sup').text()).toContain('暂无待批')
  })

  it('主管条:零在编辑时 chips 容器仍在 —— 同样不许 v-if 数据', async () => {
    const w = await mountWith({}, { perms: [...EDITOR_PERMS, 'system:view'] })
    expect(w.find('.dh-sup-who').exists()).toBe(true)
    expect(w.findAll('.dh-sup-chip')).toHaveLength(0)
  })

  it('主管条:待批 N 条显数字,点开抽屉', async () => {
    // 预热懒加载的模块 —— defineAsyncComponent 首次 import() 在 vitest 里要走一次真实的
    // 模块转换,单靠 flushPromises(它只是 setTimeout(0))在冷启动时赶不上;预热之后
    // 命中转换缓存,一拍 flushPromises 就够(与 Toolbar.vue/MobileTopBar.vue 的生产用法无关,
    // 纯粹是测试环境的时序问题)。
    await import('@/components/fp/FPApprovalDrawer.vue')
    const w = await mountWith({}, { perms: [...EDITOR_PERMS, 'lock:takeover'] })
    usePresenceStore().approvals = [pending('a'), pending('b')]
    await w.vm.$nextTick()
    expect(w.find('.dh-sup').text()).toContain('2')
    await w.find('.dh-sup-inbox').trigger('click')
    await flushPromises()
    expect(w.findComponent({ name: 'FPApprovalDrawer' }).exists()).toBe(true)
  })

  it('主管条:「谁在编辑」chip 点跳带上锁串的第二维(公司/期区/tab),不止带期(fix-brief FA)', async () => {
    // 锁串本身带着第二维:ledger:{co}:{ym} 的 co 是公司。改前 goEditor 只发 periodLink(v,{p}),
    // 目标屏收到的 co 是 null,落到默认子视图(首册)—— 那里恰恰没有人在编辑(2026-09-06 复查坐实)。
    const w = await mountWith({}, { perms: [...EDITOR_PERMS, 'lock:takeover'] })
    usePresenceStore().users = [seatEditor('张三', ['ledger:3:2025-06'])]
    await w.vm.$nextTick()
    const chip = w.find('.dh-sup-chip')
    expect(chip.text()).toBe('张三 · 月度台账 · 2025-06')
    await chip.trigger('click')
    expect(push).toHaveBeenLastCalledWith({ path: '/ledger', query: { p: '2025-06', co: '3' } })
    // openFresh 真的调了 —— 确认框弹了却什么都没重建,等于弹了个谎(fix-brief FD)。
    expect(useTabsStore().epochOf('ledger')).toBe(1)
  })

  it('主管条:chip 文案的屏名读座位自带的 label,与跳转目标是两个不同的源(fix-brief FB)', async () => {
    // 出账链共占锁下(billing-chain)四分之三时间握锁的人不在「计费参数」屏 —— 文案该读
    // AppShell 按 route.path 实时写的 label(此刻真的在哪一屏),目的地仍读 scopeTarget(哪把锁)。
    const w = await mountWith({}, { perms: [...EDITOR_PERMS, 'lock:takeover'] })
    usePresenceStore().users = [seatEditor('张三', ['billing-chain:2025-06'], '数据 · 催缴单')]
    await w.vm.$nextTick()
    const chip = w.find('.dh-sup-chip')
    expect(chip.text()).toBe('张三 · 数据 · 催缴单 · 2025-06')
    await chip.trigger('click')
    expect(push).toHaveBeenLastCalledWith({ path: '/params', query: { p: '2025-06' } })
  })

  it('主管条:一人握两把锁只出一枚 chip(取 editScopes[0])', async () => {
    // 32px 定高装不下 N 人 × M 锁;这条要回答的是「谁卡在哪」,一行一个人。
    const w = await mountWith({}, { perms: [...EDITOR_PERMS, 'lock:takeover'] })
    usePresenceStore().users = [seatEditor('张三', ['billing-chain:2025-06', 'ledger:3:2025-06'])]
    await w.vm.$nextTick()
    expect(w.findAll('.dh-sup-chip')).toHaveLength(1)
    // 取位(候选8):两把锁反查出不同 nav(billing-chain→params,ledger→ledger),
    // 钉住取的是 editScopes[0] 那把 —— 换成 .at(-1) 这条也要翻脸。
    await w.find('.dh-sup-chip').trigger('click')
    expect(push).toHaveBeenLastCalledWith({ path: '/params', query: { p: '2025-06' } })
  })

  it('主管条:同一个人开两个标签页只出一枚 chip(按 user 去重,不是按 sid)(fix-brief FC)', async () => {
    // presence 的单位是座位不是人(presence.ts:52)——张三在标签页 A/B 各开一屏编辑态,
    // 两个 sid 若都保留就是两枚一模一样的 chip,主管读成两个人在抢。
    const w = await mountWith({}, { perms: [...EDITOR_PERMS, 'lock:takeover'] })
    usePresenceStore().users = [
      { ...seatEditor('张三', ['billing-chain:2025-06']), sid: 's-a' },
      { ...seatEditor('张三', ['ledger:3:2025-06']), sid: 's-b' },
    ]
    await w.vm.$nextTick()
    expect(w.findAll('.dh-sup-chip')).toHaveLength(1)
  })

  it('主管条:「谁在编辑」只数编辑态的别人 —— 自己不占位,mode=view 的不算(候选13)', async () => {
    const w = await mountWith({}, { perms: [...EDITOR_PERMS, 'lock:takeover'] })
    usePresenceStore().users = [
      { ...seatEditor('张三', ['ledger:3:2025-06']), self: true },
      { ...seatEditor('李四', ['ledger:5:2025-06']), mode: 'view' as const },
      seatEditor('王五', ['ledger:7:2025-06']),
    ]
    await w.vm.$nextTick()
    const chips = w.findAll('.dh-sup-chip')
    expect(chips).toHaveLength(1)
    expect(chips[0].text()).toBe('王五 · 月度台账 · 2025-06')
  })

  // 破坏验证(Step 6)实测坐实的空白:goEditor 去掉 confirmRebuild 调用后,既有 6 条一条不红——
  // 补这一条钉住 chip 跳转与 go() 共用同一份确认(裁定 5:两者都走 openFresh,风险一模一样)。
  it('主管条:chip 跳转复用 confirmRebuild —— 本标签页在目标屏那把锁底下持锁时点 chip 也先确认', async () => {
    const w = await mountWith({}, { perms: [...EDITOR_PERMS, 'lock:takeover'] })
    const presence = usePresenceStore()
    presence.users = [seatEditor('张三', ['billing-chain:2025-06'])]
    presence.holdLock('billing-chain:2025-06', () => {})   // 本标签页在 params 屏那把锁底下持锁
    await w.vm.$nextTick()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await w.find('.dh-sup-chip').trigger('click')
    expect(confirm, 'chip 跳转不能绕开 go() 同款的确认').toHaveBeenCalledOnce()
    expect(push).not.toHaveBeenCalled()
    confirm.mockRestore()
    presence.stop()
  })

  // 破坏验证(Step 6)实测坐实的空白:主管条整块挪进 <template v-else>(真版式分支)里,
  // 既有 7 条一条不红 —— 补这一条钉住裁定 1(渲染在两个分支之外,不跟 ov 走)。
  it('主管条:ov 未到(骨架态)时已经在 —— 不等 ov 落位才出现(裁定 1)', async () => {
    localStorage.setItem('permissions', JSON.stringify([...EDITOR_PERMS, 'lock:takeover']))
    setActivePinia(createPinia())
    let resolve!: (v: DataHomeOverviewDTO) => void
    getOverview.mockReturnValue(new Promise<DataHomeOverviewDTO>((r) => { resolve = r }))
    const w = mount(DataHomeView)
    await flushPromises()
    expect(w.find('.dh-sup').exists(), '骨架态(ov 还没到)时主管条也该在').toBe(true)
    resolve(overview())
    await flushPromises()
    expect(w.find('.dh-sup').exists(), '落位之后主管条仍在').toBe(true)
  })
})

describe('数据中心首页 · 换月的即时反馈(2026-09-06 浏览器实看:「选择月份的时候加载延迟有点明显」)', () => {
  // 三条都钉「点下去到回包之间那一段」。改前这一段是**完全静默**的:描边不动、板子不变、
  // 收入核对还要等 overview 回来才发第二趟 —— 一次点击等两趟往返,期间零反馈。
  const cursOf = (w: ReturnType<typeof mount>) =>
    (w.findComponent({ name: 'BookMonthMatrix' }).props('years') as
      { year: number; months: { month: number; cur?: boolean }[] }[])
      .flatMap(y => y.months.map(m => ({ ym: `${y.year}-${String(m.month).padStart(2, '0')}`, cur: m.cur })))
      .filter(c => c.cur).map(c => c.ym)

  it('点格子后描边立刻挪到新月,不等回包', async () => {
    const w = await mountWith()                              // 锚定月 2024-02
    getOverview.mockReturnValueOnce(new Promise(() => {}))   // 回包永不到
    await w.findComponent({ name: 'BookMonthMatrix' }).vm.$emit('pick', 2025, 6)
    await w.vm.$nextTick()
    expect(cursOf(w), '描边跟 curYm(回包派生)走的话这里还是 2024-02 —— 那一下点击零反馈').toEqual(['2025-06'])
  })

  it('点格子后收入核对与 overview 并发发,不再串在它后面', async () => {
    // 首载仍必须串行(pickedYm=null,年只能从回包派生);但显式点月时年就写在用户点的格子上,
    // 再串一趟就是白等一次往返 —— 这是 P2 引入的第二趟请求,改前每次换月都要等两趟。
    const w = await mountWith()
    reconOverview.mockClear()
    getOverview.mockReturnValueOnce(new Promise(() => {}))   // overview 永不回
    await w.findComponent({ name: 'BookMonthMatrix' }).vm.$emit('pick', 2025, 6)
    await flushPromises()
    expect(reconOverview, '串行的话要等 overview 回包才发,这里就是 0 次').toHaveBeenCalledWith(2025)
  })

  it('取数在途 200ms 后月名/计数/两栏一起压暗(fp-stale),回包立刻灭', async () => {
    // 描边已经挪到新月、而这三处还是**上一个月**的数 —— 不压暗就是同屏两处对同一件事说反话。
    // 年份条本身不压:它是你正在点的那个控件。fp-stale 带 pointer-events:none,旧行不许被点。
    const w = await mountWith()
    let resolve!: (v: DataHomeOverviewDTO) => void
    getOverview.mockReturnValueOnce(new Promise<DataHomeOverviewDTO>((r) => { resolve = r }))
    await w.findComponent({ name: 'BookMonthMatrix' }).vm.$emit('pick', 2025, 6)
    await w.vm.$nextTick()
    expect(w.find('.dh-cols').classes(), '200ms 内不亮(useDeferredFlag 防闪)').not.toContain('fp-stale')

    await new Promise((r) => setTimeout(r, 260))
    await flushPromises()
    expect(w.find('.dh-cols').classes(), '旧内容留在原地就必须退一步').toContain('fp-stale')
    expect(w.find('.dh-cols').attributes('aria-busy')).toBe('true')
    expect(w.find('.dh-mnow').classes(), '月名还是上一个月的').toContain('fp-stale')
    expect(w.find('.dh-counts').classes(), '两处计数也还是上一个月的').toContain('fp-stale')

    resolve(overview({ period: { year: 2025, month: 6, label: '2025年6月' } }))
    await flushPromises()
    expect(w.find('.dh-cols').classes(), '退场立刻灭 —— 数据都上屏了还盖着一层就是纯碍事').not.toContain('fp-stale')
  })
})


// ══════════ 审核态列 + 行动作 + 退回/撤销弹窗(§7.5,R2 T6) ══════════
//
// 这一组钉三件事:① 屏上写的是人话不是英文枚举 ② 动作按权限出、按状态出
// ③ 多键行(台账 N 公司 / 附10 N 期区 / 附13-14 / 附7-8)也够得着 —— 那 8 把键
//    在单键行的方案里全站一个入口都没有(D-R2-9)。
import { reviewApi } from '@/api/review'
import type { ReviewRow, ReviewStatus } from '@/types/review'

const YM = '2024-02'
function rvRow(key: string, kind: string, status: ReviewStatus,
               extra: Partial<ReviewRow> = {}): ReviewRow {
  return { key, kind, scope: null, status, submittedBy: null, submittedAt: null,
           reviewedBy: null, reviewedAt: null, reason: null, blockedBy: [], ...extra }
}

/** 后端 GET /api/review?period= 的形状:该月**全部**键,含派生 entered。 */
function reviewFixture(over: Record<string, Partial<ReviewRow>> = {}): ReviewRow[] {
  const mk = (key: string, kind: string, scope: string | null = null) =>
    rvRow(key, kind, (over[key]?.status as ReviewStatus) ?? 'entered', { scope, ...over[key] })
  return [
    mk(`params:${YM}`, 'params'), mk(`meters:${YM}`, 'meters'), mk(`alloc:${YM}`, 'alloc'),
    mk(`alloc-loss:${YM}`, 'alloc-loss'), mk(`bill-notices:${YM}`, 'bill-notices'),
    mk(`ledger:1:${YM}`, 'ledger', '1'), mk(`ledger:2:${YM}`, 'ledger', '2'),
    mk(`utilities:office:${YM}`, 'utilities', 'office'), mk(`utilities:phase3:${YM}`, 'utilities', 'phase3'),
    mk(`pv:${YM}`, 'pv'), mk(`salary:${YM}`, 'salary'),
    mk(`charging-car:${YM}`, 'charging-car'), mk(`charging-ebike:${YM}`, 'charging-ebike'),
    mk(`elec-cost:${YM}`, 'elec-cost'), mk(`elec-model:${YM}`, 'elec-model'),
  ]
}

/** 台账两个公司:A 已录、B 没录 —— 专钉「只交已录完的那几把」。 */
const LEDGER_ITEM: DataHomeItemDTO = {
  name: '月度台账', tag: '凭证', done: false, go: 'ledger',
  companies: [{ id: 1, short: 'A公司', done: true }, { id: 2, short: 'B公司', done: false }],
} as DataHomeItemDTO

async function mountReview(rows: ReviewRow[], perms = EDITOR_PERMS) {
  vi.mocked(reviewApi.list).mockResolvedValue(rows)
  const items = [LEDGER_ITEM, ...overview().schedules.items.filter(i => i.go !== 'ledger')]
  return mountWith({ schedules: { done: 2, total: 9, items } }, { perms })
}

const rowByText = (w: Awaited<ReturnType<typeof mountWith>>, label: string) =>
  w.findAll('.dh-row').find(r => r.text().includes(label))!
const btn = (row: ReturnType<typeof rowByText>, text: string) =>
  row.findAll('.dh-abtn').find(b => b.text() === text)

describe('数据中心首页 · 审核态与行动作(R2 T6)', () => {
  beforeEach(() => {
    vi.mocked(reviewApi.list).mockReset().mockResolvedValue([])
    vi.mocked(reviewApi.submit).mockReset().mockResolvedValue(undefined)
    vi.mocked(reviewApi.approve).mockReset().mockResolvedValue(undefined)
    vi.mocked(reviewApi.returnBack).mockReset().mockResolvedValue(undefined)
    vi.mocked(reviewApi.withdraw).mockReset().mockResolvedValue(undefined)
  })

  // 破坏验证:把模板里的 reviewText(r.review) 改回 r.review → 红
  it('❗审核态列写人话,不是 submitted / approved 这种英文', async () => {
    const w = await mountReview(reviewFixture({
      [`params:${YM}`]: { status: 'submitted' },
      [`meters:${YM}`]: { status: 'approved' },
      [`bill-notices:${YM}`]: { status: 'returned', reason: '电价填错了' },
    }))
    expect(rowByText(w, '计费参数').find('.dh-rreview').text()).toBe('待审核')
    expect(rowByText(w, '园区抄表').find('.dh-rreview').text()).toBe('已审核')
    expect(rowByText(w, '催缴单').find('.dh-rreview').text()).toBe('已退回')
    expect(rowByText(w, '附表12').find('.dh-rreview').text()).toBe('未交审')
  })

  // 破坏验证:把 reviewTip 的 returned 分支删掉 → 红
  it('❗已退回的悬停给的是理由 —— 不给理由等于告诉他「被打回来了,自己猜」', async () => {
    const w = await mountReview(reviewFixture({
      [`params:${YM}`]: { status: 'returned', reason: '电价填错了' },
    }))
    expect(rowByText(w, '计费参数').find('.dh-rreview').attributes('title')).toBe('退回理由：电价填错了')
  })

  // 破坏验证:把 submitPending 换成 submit(即没录完就不画按钮)→ 红
  it('❗没录完时「交审」画得出来但按不动 —— 直接不画会让人以为界面坏了', async () => {
    const w = await mountReview(reviewFixture())
    const salary = rowByText(w, '附表12')           // fixture 里没有 salary 源项 → state 'na'
    const notices = rowByText(w, '催缴单')          // STEPS_4DONE 里 bill-notices 是 current → todo
    expect(btn(notices, '交审')!.attributes('disabled')).toBeDefined()
    expect(btn(notices, '交审')!.attributes('title')).toContain('还没录完')
    expect(salary.find('.dh-rreview').text(), 'na 行不出动作').toBe('未交审')
  })

  it('行已做且未交审 → 「交审」可点,点了打 submit', async () => {
    const w = await mountReview(reviewFixture())
    const params = rowByText(w, '计费参数')          // STEPS_4DONE 里 params 是 done
    await btn(params, '交审')!.trigger('click')
    await flushPromises()
    expect(reviewApi.submit).toHaveBeenCalledWith(`params:${YM}`)
  })

  // 破坏验证:把 canApprove 改成恒真 → 红
  it('❗没有 review:approve 的人看不到通过/退回/撤销', async () => {
    const w = await mountReview(reviewFixture({ [`params:${YM}`]: { status: 'submitted' } }))
    const params = rowByText(w, '计费参数')
    expect(btn(params, '通过')).toBeUndefined()
    expect(btn(params, '退回')).toBeUndefined()
  })

  // 破坏验证:把 blockedBy 的 disabled 判断删掉 → 红
  it('❗上游没审完时「通过」按不动,并点名缺谁', async () => {
    const w = await mountReview(reviewFixture({
      [`alloc:${YM}`]: { status: 'submitted', blockedBy: ['计费参数', '园区抄表'] },
    }), [...EDITOR_PERMS, 'review:approve'])
    const alloc = rowByText(w, '公共电核算')
    expect(btn(alloc, '通过')!.attributes('disabled')).toBeDefined()
    expect(btn(alloc, '通过')!.attributes('title')).toBe('先通过 计费参数 / 园区抄表 的审核')
  })

  it('已审核的行出「撤销」,待审核的行出「通过」「退回」', async () => {
    const w = await mountReview(reviewFixture({
      [`params:${YM}`]: { status: 'approved' },
      [`meters:${YM}`]: { status: 'submitted' },
    }), [...EDITOR_PERMS, 'review:approve'])
    expect(btn(rowByText(w, '计费参数'), '撤销')).toBeTruthy()
    expect(btn(rowByText(w, '计费参数'), '通过')).toBeUndefined()
    expect(btn(rowByText(w, '园区抄表'), '通过')).toBeTruthy()
    expect(btn(rowByText(w, '园区抄表'), '退回')).toBeTruthy()
  })

  // ❗这一条是 D-R2-9 的证据:多键行(台账每公司一把)在单键方案里全站没有入口。
  //   破坏验证:把 keysOf 的 chips 分支删掉(只回 r.reviewKey)→ 红
  it('❗台账这种多键行也能交审,且只交已录完的那几把', async () => {
    const w = await mountReview(reviewFixture())
    const ledger = rowByText(w, '月度台账')
    expect(ledger.find('.dh-rreview').text(), '两把键都未交审').toBe('未交审')
    await btn(ledger, '交审')!.trigger('click')
    await flushPromises()
    // A 公司 done:true、B 公司 done:false —— 只交 A
    expect(reviewApi.submit).toHaveBeenCalledTimes(1)
    expect(reviewApi.submit).toHaveBeenCalledWith(`ledger:1:${YM}`)
  })

  // 破坏验证:把 chip 上的 :data-review 删掉 → 红
  it('❗chips 各带各的审核态色(公司/期区各审各的)', async () => {
    const w = await mountReview(reviewFixture({ [`ledger:2:${YM}`]: { status: 'approved' } }))
    const chips = rowByText(w, '月度台账').findAll('.dh-chip')
    expect(chips.map(c => [c.text(), c.attributes('data-review')]))
      .toEqual([['A公司', 'entered'], ['B公司', 'approved']])
  })
})

// ══════════ 屏不许闪(2026-09-08) ══════════
//
// stores/__tests__/review.spec.ts 那几条守的是 store 手上有没有值;这四条守的是**屏**。
// 两层都要:store 的 batch() 不逐把收尾是一回事,视图有没有接对是另一回事 ——
// runEach 若改回逐把调 submitAll([k]),store 那几条照样绿而屏照样闪。
//
// 手法:把动作之后那趟清单重取**悬在半空**,DOM 就稳定停在「已失效、新值未到」那一帧,
// 直接断言屏上的字与动作之前逐字相同。不用 MutationObserver、不用数 nextTick。
// 靶子选附13/14 那一行:夹具里办公水电与三期水电都 done,折成一行两把键 —— 正是用户说的多键行。
describe('❗审核动作期间清单不许出现空帧', () => {
  beforeEach(() => {
    vi.mocked(reviewApi.list).mockReset().mockResolvedValue([])
    vi.mocked(reviewApi.submit).mockReset().mockResolvedValue(undefined)
  })
  const texts = (w: Awaited<ReturnType<typeof mountWith>>) => w.findAll('.dh-rreview').map(e => e.text())

  // ❗破坏验证:把 review.ts 的 invalidate 改回「立刻 delete」→ 红。
  //   那一帧 reviewRows 变 null,每一格都退成「—」、动作按钮整组从 DOM 消失。
  //   两条断言各对应用户原话的一半:「不停闪烁」与「一个一个变绿」。
  it('❗多键行交审:重取在途时,屏上还是动作之前那一屏', async () => {
    const w = await mountReview(reviewFixture())
    const before = texts(w)
    const btns = w.findAll('.dh-abtn').length
    let release!: (v: ReviewRow[]) => void
    vi.mocked(reviewApi.list).mockImplementationOnce(() => new Promise<ReviewRow[]>(r => { release = r }))
    await btn(rowByText(w, '办公·三期水电'), '交审')!.trigger('click')
    await flushPromises()
    expect(texts(w), '重取在途时整屏退成「—」就是用户看见的那一闪').toEqual(before)
    expect(w.findAll('.dh-abtn').length, '动作按钮整组消失是同一帧的另一半').toBe(btns)
    release(reviewFixture({ [`utilities:office:${YM}`]: { status: 'submitted' },
                            [`utilities:phase3:${YM}`]: { status: 'submitted' } }))
    await flushPromises()
    expect(rowByText(w, '办公·三期水电').find('.dh-rreview').text(), '新值到了才换').toBe('待审核')
  })

  // ❗破坏验证:把 runEach 里的 `await fn(keys)` 改回 `for (const k of keys) await fn([k])` → 红(会是 2)。
  it('❗一行两把键只重取一次清单 —— 逐把收尾就是「一个一个变绿」', async () => {
    const w = await mountReview(reviewFixture())
    const before = vi.mocked(reviewApi.list).mock.calls.length
    await btn(rowByText(w, '办公·三期水电'), '交审')!.trigger('click')
    await flushPromises()
    expect(reviewApi.submit, '两把键各写一次').toHaveBeenCalledTimes(2)
    expect(vi.mocked(reviewApi.list).mock.calls.length - before, '清单只重取一次').toBe(1)
  })

  // ❗破坏验证:删掉 runEach 里那句 period.reloadChain() → 红。
  //   月格的 ✓ 读 billingPeriod 的 closedMonths,而审核动作本来不碰那条链 ——
  //   不补这一句,审完当月最后一把键月格也不打勾,要等下次进屏。
  it('❗审完当月最后一把键,年份条那格立刻打勾', async () => {
    vi.mocked(reviewApi.closedMonths).mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValue([YM])
    const w = await mountReview(reviewFixture({ [`params:${YM}`]: { status: 'submitted' } }),
                                [...EDITOR_PERMS, 'review:approve'])
    const cell = () => (w.findComponent({ name: 'BookMonthMatrix' }).props('years') as
        { year: number; months: { month: number; locked?: boolean }[] }[])
        .find(y => y.year === 2024)!.months.find(m => m.month === 2)!
    expect(cell().locked, '动作之前没打勾').toBe(false)
    await btn(rowByText(w, '计费参数'), '通过')!.trigger('click')
    await flushPromises()
    expect(cell().locked, '不重取 closedMonths 的话要等下次进屏才打勾').toBe(true)
  })

  // ❗破坏验证:把 runEach 里的 try/finally 拆掉(改回顺序执行)→ 红。
  //   6 把键审到第 3 把失败时,前两把已经写进服务端,其中可能正好有解锁整月的那一把 ——
  //   不刷的话清单已经变了而 ✓ 停在动作之前。
  it('❗中途失败也要刷年份条 —— 失败之前那几把已经写进去了', async () => {
    vi.mocked(reviewApi.closedMonths).mockReset().mockResolvedValue([])
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.mocked(reviewApi.submit).mockReset()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 409 }))
    const w = await mountReview(reviewFixture())
    await btn(rowByText(w, '办公·三期水电'), '交审')!.trigger('click')
    await flushPromises()
    expect(reviewApi.closedMonths, '进屏一趟 + 动作后一趟').toHaveBeenCalledTimes(2)
  })
})


describe('退回 / 撤销弹窗(R2 T6)', () => {
  beforeEach(() => {
    vi.mocked(reviewApi.list).mockReset().mockResolvedValue([])
    vi.mocked(reviewApi.returnBack).mockReset().mockResolvedValue(undefined)
  })

  async function openReturn() {
    const w = await mountReview(reviewFixture({ [`params:${YM}`]: { status: 'submitted' } }),
                                [...EDITOR_PERMS, 'review:approve'])
    await btn(rowByText(w, '计费参数'), '退回')!.trigger('click')
    // FPReviewDialog 是 defineAsyncComponent + Teleport:一次 flush 只够解掉动态 import,
    // 还要再一拍才渲染进 body。少一拍 querySelector 拿到 null,那不是「弹窗没出来」。
    await flushPromises()
    await flushPromises()
    return w
  }

  // 破坏验证:把 FPReviewDialog 里 ok 的 trim() 去掉 → 「全是空格」那条红
  it('❗理由必填,而且一串空格不算', async () => {
    await openReturn()
    const card = document.querySelector('.rvd-card')!
    const confirm = [...card.querySelectorAll('button')].find(b => b.textContent?.includes('确认退回'))!
    expect(confirm.hasAttribute('disabled'), '空理由不许提交').toBe(true)

    const ta = card.querySelector('textarea') as HTMLTextAreaElement
    ta.value = '    '
    ta.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(confirm.hasAttribute('disabled'), '一串空格也不算写了理由').toBe(true)
  })

  it('填了理由 → 打 returnBack 且带 trim 后的值', async () => {
    await openReturn()
    const card = document.querySelector('.rvd-card')!
    const ta = card.querySelector('textarea') as HTMLTextAreaElement
    ta.value = '  电价填错了  '
    ta.dispatchEvent(new Event('input'))
    await flushPromises()
    const confirm = [...card.querySelectorAll('button')].find(b => b.textContent?.includes('确认退回'))!
    confirm.click()
    await flushPromises()
    expect(reviewApi.returnBack).toHaveBeenCalledWith(`params:${YM}`, '电价填错了')
  })
})


// ══════════ 审核条(§7.5 审核员落地位,R2 T7) ══════════

describe('审核条(R2 T7)', () => {
  beforeEach(() => {
    vi.mocked(reviewApi.list).mockReset().mockResolvedValue([])
  })

  // 破坏验证:把 isReviewer 改成恒真 → 红
  it('❗没有 review:approve 的人看不到审核条', async () => {
    const w = await mountReview(reviewFixture(), EDITOR_PERMS)
    expect(w.find('.dh-rvbar').exists()).toBe(false)
  })

  // 破坏验证:把审核条那个 v-if 改成 v-else-if 挂在主管条上 → 红
  it('❗admin 两个身份都有 → 主管条与审核条各占各的,不合并', async () => {
    const w = await mountReview(reviewFixture(),
      [...EDITOR_PERMS, 'review:approve', 'lock:takeover'])
    expect(w.findAll('.dh-sup').length, '两条各一行,合成一条会让 admin 少看见一半').toBe(2)
    expect(w.find('.dh-rvbar').exists()).toBe(true)
  })

  // 破坏验证:把「暂无待审」那支删掉(改成 v-if="reviewCounts.pending") → 红。
  // 32px 定高常驻是 P2 裁定 1/2:零待审也要占位,不许整条塌掉。
  it('❗零待审时按钮仍在位,写「暂无待审」', async () => {
    const w = await mountReview(reviewFixture(), [...EDITOR_PERMS, 'review:approve'])
    expect(w.find('.dh-rvbar .dh-sup-inbox').text()).toBe('暂无待审')
  })

  it('待审核条数与「本月已审 n/总」都从渲染出来的行算', async () => {
    const w = await mountReview(reviewFixture({
      [`params:${YM}`]: { status: 'submitted' },
      [`meters:${YM}`]: { status: 'submitted' },
      [`pv:${YM}`]: { status: 'approved' },
    }), [...EDITOR_PERMS, 'review:approve'])
    expect(w.find('.dh-rvbar .dh-sup-inbox').text()).toBe('待审核 2')
    // 分母 = 有审核键的行数(导入中心 / 收入核对 / 本月锁账不算)
    const bar = w.find('.dh-rvcount').text()
    expect(bar).toMatch(/^本月已审 1\/\d+$/)
  })

  // ❗破坏验证:把 reviewCounts 改成抄 reviewRows.length(回包 19 把键)→ 红。
  //   §12:计数与审核键集合必须与屏内同源,假绿栽过三次。
  it('❗计数不许抄回包条数 —— 回包是 19 把键,屏上是 15 行', async () => {
    const w = await mountReview(reviewFixture(), [...EDITOR_PERMS, 'review:approve'])
    const total = +w.find('.dh-rvcount').text().match(/\/(\d+)$/)![1]
    const shown = w.findAll('.dh-rreview').filter(e => e.text() !== '—').length
    expect(total, '分母要等于屏上真的带审核态的行数').toBe(shown)
    expect(total, '不该是回包那 19 条').not.toBe(reviewFixture().length)
  })

  // 破坏验证:把 shown() 里的 onlyPending 判断删掉 → 红
  it('❗「只看待审」筛掉其余行,再点一下还原', async () => {
    const w = await mountReview(reviewFixture({
      [`params:${YM}`]: { status: 'submitted' },
    }), [...EDITOR_PERMS, 'review:approve'])
    const before = w.findAll('.dh-row').length
    await w.find('.dh-rvbar .dh-sup-inbox').trigger('click')
    const after = w.findAll('.dh-row')
    expect(after.length, '只剩待审核那一行').toBe(1)
    expect(after[0].text()).toContain('计费参数')
    // 两栏的容器与标题常驻 —— 筛掉行不是把版面塌掉
    expect(w.findAll('.dh-sec').length, '两栏 section 照样在').toBe(2)
    expect(w.text()).toContain('出账链')
    expect(w.text()).toContain('附表录入')

    await w.find('.dh-rvbar .dh-sup-inbox').trigger('click')
    expect(w.findAll('.dh-row').length).toBe(before)
  })
})
