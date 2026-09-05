import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { DataHomeOverviewDTO, DataHomeStepDTO, DataHomeItemDTO } from '@/types/dataHome'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { usePresenceStore } from '@/stores/presence'
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

  it('点出账链步骤后触发 loadChain:目标屏链路条不能读到空格子', async () => {
    // pick() 让目标屏的 ChainMonthGate 不挂载,而它是 loadChain 的唯一调用方 ——
    // 不补这一句,目标屏 chainStepsOf(cellOf(ym)) 读到冻结的 EMPTY 格子,五道工序全显「未做」。
    const w = await mountWith()
    await w.findAll('.dh-row-billing')[1].trigger('click')   // 选择器:胶囊行 → 两栏行,P2 T3
    await flushPromises()
    expect(vi.mocked(metersApi.months)).toHaveBeenCalledTimes(1)
  })

  it('点附表项不触发 loadChain', async () => {
    const w = await mountWith()
    await w.findAll('.dh-row-booking')[0].trigger('click')   // 选择器:胶囊行 → 两栏行,P2 T3
    await flushPromises()
    expect(vi.mocked(metersApi.months)).not.toHaveBeenCalled()
  })

  // ── 刚选的月 vs 服务端回包(2026-09-03 对抗复查 F2)──
  it('刚选的月优先:回包未到时点步骤也按新选月 pick', async () => {
    const w = await mountWith()
    // 第二次 getOverview 停在在途,模拟用户切月后马上点
    let resolve!: (v: DataHomeOverviewDTO) => void
    getOverview.mockReturnValueOnce(new Promise<DataHomeOverviewDTO>((r) => { resolve = r }))
    await w.findComponent({ name: 'Select' }).vm.$emit('update:modelValue', '2025-06')
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
    const sel = w.findComponent({ name: 'Select' })
    await sel.vm.$emit('update:modelValue', '2023-08')
    await flushPromises()
    await sel.vm.$emit('update:modelValue', '2025-06')
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
    return Object.values({ ...base, ...overrides })
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
    expect(icon.attributes('title')).toBe('审核机制未上线')   // padlock 悬停文案即 r.locked
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
    await w.findComponent({ name: 'Select' }).vm.$emit('update:modelValue', '2024-03')
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
    const sel = w.findComponent({ name: 'Select' })
    await sel.vm.$emit('update:modelValue', '2023-08')
    await flushPromises()
    await sel.vm.$emit('update:modelValue', '2025-06')
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
