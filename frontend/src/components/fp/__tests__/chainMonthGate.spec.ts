import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

import ChainMonthGate from '@/components/fp/ChainMonthGate.vue'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { metersApi } from '@/api/meters'
import { allocApi } from '@/api/alloc'
import { billNoticesApi } from '@/api/billNotices'
import { paramsApi } from '@/api/params'
import { reviewApi } from '@/api/review'
import type { ReviewRow, ReviewStatus } from '@/types/review'

/**
 * 出账月矩阵（2026-08-28 设计稿 §①）—— 五屏共用的那道门。
 * 组件本身是薄的：数据在 stores/billingPeriod，格子在 BookMonthMatrix，
 * 这里只负责把两者对起来，外加手工年的增删。
 */

vi.mock('@/api/meters', () => ({ metersApi: { months: vi.fn() } }))
vi.mock('@/api/alloc', () => ({ allocApi: { poolMonths: vi.fn(), lossMonths: vi.fn() } }))
vi.mock('@/api/billNotices', () => ({ billNoticesApi: { months: vi.fn() } }))
// billingPeriod.fetchAll 的第 5 个来源(R2 T10:整月已审核 → 月格 ✓)。
// 与另外四个一样必须 mock:不 mock 的话走真 axios,而它在 Promise.all 里,
// 整个矩阵要等这一趟在 jsdom 里超时才渲染 —— 表现是「格子一个都找不到」。
vi.mock('@/api/review', () => ({
  reviewApi: {
    closedMonths: vi.fn().mockResolvedValue([]),
    states: vi.fn().mockResolvedValue([]),     // 编辑闸走这条(闸道,按年)
    list: vi.fn().mockResolvedValue([]),
    submit: vi.fn(), approve: vi.fn(), returnBack: vi.fn(), withdraw: vi.fn(),
  },
}))
vi.mock('@/api/params', () => ({ paramsApi: { status: vi.fn() } }))

const NOW = 2025

function wire(o: { meters?: string[]; pool?: string[]; loss?: string[]; notices?: string[]; stale?: string[]
                   review?: ReviewRow[] } = {}) {
  // ⚠ 闸道每条用例都要重设:vi.clearAllMocks() 只清调用记录、不清实现,
  //   某一条设的 mockResolvedValue 会漏进后面每一条(角标那几条互相染色,查起来像随机红)。
  vi.mocked(reviewApi.states).mockResolvedValue(o.review ?? [])
  vi.mocked(metersApi.months).mockResolvedValue(o.meters ?? [])
  vi.mocked(allocApi.poolMonths).mockResolvedValue(o.pool ?? [])
  vi.mocked(allocApi.lossMonths).mockResolvedValue(o.loss ?? [])
  vi.mocked(billNoticesApi.months).mockResolvedValue(o.notices ?? [])
  vi.mocked(paramsApi.status).mockResolvedValue({
    priceOk: 6, priceTotal: 6, pendingChanges: 0, lastChangeAt: null,
    poolSnapshotAt: null, billBatchAt: null,
    stale: false, otherMonthsAffected: o.stale ?? [],
  })
}

async function mk() {
  const w = mount(ChainMonthGate, { props: { title: '园区抄表', icon: 'gauge' } })
  await flushPromises()
  return w
}

describe('出账月矩阵', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    vi.setSystemTime(new Date(`${NOW}-06-15T00:00:00`))
  })

  it('屏名进标题 —— 五屏共用一张矩阵，但你得知道自己点开的是哪一屏', async () => {
    wire({ meters: ['2025-01'] })
    expect((await mk()).text()).toContain('园区抄表')
  })

  it('格子上的四个点来自 store 的进度', async () => {
    wire({ meters: ['2025-01', '2025-02'], pool: ['2025-01'] })
    const w = await mk()
    const cards = w.findAll('.bmm-card')
    // 2025 年那一行的 1 月 / 2 月（数据年只有 2025，故只有一行）
    expect(cards[0].findAll('.bmm-pip.on')).toHaveLength(2)   // 抄表 + 公摊
    expect(cards[1].findAll('.bmm-pip.on')).toHaveLength(1)   // 只有抄表
    expect(cards[2].text()).toContain('空')
  })

  it('需重算的月换底色', async () => {
    wire({ meters: ['2025-03'], pool: ['2025-03'], stale: ['2025-03'] })
    const w = await mk()
    expect(w.findAll('.bmm-card')[2].classes()).toContain('stale')
  })

  it('点月格 = 选定期，五屏一起换 —— 这是整个改造的目的', async () => {
    wire({ meters: ['2025-03'] })
    const w = await mk()
    await w.findAll('.bmm-card')[2].trigger('click')
    const p = useBillingPeriodStore()
    expect(p.ym).toBe('2025-03')
    expect(p.picked).toBe(true)
  })

  it('空月照样点得进去 —— 那正是要去录第一笔的地方', async () => {
    wire({ meters: ['2025-01'] })
    const w = await mk()
    await w.findAll('.bmm-card')[7].trigger('click')
    expect(useBillingPeriodStore().ym).toBe('2025-08')
  })

  it('年份范围 = 数据年 ∪ 当前自然年，连续补满', async () => {
    wire({ meters: ['2023-04'] })
    const w = await mk()
    expect(w.findAll('.bmm-yrow .bmm-y').map(e => e.text())).toEqual(['2023', '2024', '2025'])
  })

  it('加载失败说出来，不给半张矩阵', async () => {
    wire({ meters: ['2025-01'] })
    vi.mocked(allocApi.poolMonths).mockRejectedValue(new Error('后端挂了'))
    const w = await mk()
    expect(w.find('.fp-lderr').exists()).toBe(true)
    expect(w.text()).toContain('后端挂了')
    expect(w.findAll('.bmm-card'), '缺一列的矩阵会被读成「这些月没做过」').toHaveLength(0)
  })

  it('手工年记在本机，键按屏分组 —— 五屏共用同一份，加一次五屏都看得见', async () => {
    wire({ meters: ['2025-01'] })
    const w = await mk()
    await w.find('.bmm-addy').trigger('click')     // ＋ 补更早年份
    expect(JSON.parse(localStorage.getItem('bw-extra-years:chain:billing') ?? '[]')).toEqual([2024])
    expect(w.findAll('.bmm-yrow .bmm-y').map(e => e.text())).toEqual(['2024', '2025'])
  })
})

/**
 * 月卡审核角标（设计稿 §9.2-④）。
 *
 * 这一格对的是**五把键**（CHAIN 五道工序 params / meters / alloc / alloc-loss / bill-notices），
 * 取最未完成的一档（`components/fp/monthReview.ts` 的 worstReview）——
 * 月格回答的是「这个月还有没有我的事」，不是「这个月封了没有」。
 *
 * 「哪一档画哪个色」在 chainMatrix.spec.ts 钉过（组件那一层）；这里只验**这道门喂进去的是什么**：
 * 哪五把键、怎么聚合、什么时候不喂、按年取了几趟。
 */
const KINDS = ['params', 'meters', 'alloc', 'alloc-loss', 'bill-notices']
const row = (key: string, status: ReviewStatus): ReviewRow => ({
  key, kind: key.slice(0, key.lastIndexOf(':')), scope: null, status,
  submittedBy: 'zhangsan', submittedAt: null, reviewedBy: '李审',
  reviewedAt: '2025-03-05T10:00:00', reason: null, blockedBy: [],
})
/** 某月五把键同一档。 */
const all5 = (ym: string, status: ReviewStatus) => KINDS.map(k => row(`${k}:${ym}`, status))

/** 闸道是第二趟异步（矩阵先落地 → watch 才发请求），要再刷一次微任务才拿得到角标。 */
async function mkRv() {
  const w = await mk()
  await flushPromises()
  return w
}

describe('出账月矩阵 · 月卡审核角标', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    vi.setSystemTime(new Date(`${NOW}-06-15T00:00:00`))
  })

  it('❗五把键取最未完成的一档 —— 一把被退回，另外四把已审也不许画成绿锁', async () => {
    // 破坏验证:reviewOf 改成 `period.cellOf(ym).closed ? 'approved' : null`(只画整月锁账那一档)→ 红
    wire({
      meters: ['2025-01'],
      review: [...all5('2025-01', 'approved').slice(0, 4), row('bill-notices:2025-01', 'returned')],
    })
    const rv = (await mkRv()).findAll('.bmm-card')[0].find('.bmm-rv')
    expect(rv.exists()).toBe(true)
    expect(rv.classes(), '五把里有一把还得回来改，这个月就还有你的事').toContain('rv-returned')
  })

  it('❗五把全 approved 才是绿锁', async () => {
    wire({ meters: ['2025-01'], review: all5('2025-01', 'approved') })
    expect((await mkRv()).findAll('.bmm-card')[0].find('.bmm-rv').classes()).toContain('rv-approved')
  })

  it('❗库里一行都没有 = 未交审（灰点），不是「没角标」', async () => {
    // 破坏验证:去掉 Cell 里那行 `review: reviewOf(ym)` → 一格都不画 → 红
    wire({ meters: ['2025-01'] })
    expect((await mkRv()).findAll('.bmm-card')[0].find('.bmm-rv').classes()).toContain('rv-entered')
  })

  it('❗空月一格不画 —— 本来就没有东西可交，一片虚线卡长满灰点是纯噪音', async () => {
    // 破坏验证:BookMonthMatrix 模板里角标那条 `m.hasData &&` 去掉 → 红
    wire({ meters: ['2025-01'], review: all5('2025-05', 'approved') })
    const card = (await mkRv()).findAll('.bmm-card')[4]      // 2025-05：四道工序一道没走
    expect(card.classes()).toContain('blank')
    expect(card.find('.bmm-rv').exists()).toBe(false)
  })

  it('❗闸道没回来时一格都不画，不拿「未交审」冒充「还不知道」', async () => {
    wire({ meters: ['2025-01'] })
    let release!: (v: unknown) => void
    vi.mocked(reviewApi.states).mockReturnValue(new Promise((r) => { release = r }) as never)
    const w = await mkRv()
    expect(w.findAll('.bmm-rv'), '闸道还没回来 —— 进屏那几百毫秒不许先刷一片灰点再翻牌').toHaveLength(0)
    release([])
    await flushPromises()
    expect(w.findAll('.bmm-rv').length, '回来了才画').toBeGreaterThan(0)
  })

  it('❗按年取，一年一趟（不是一格一趟、更不是一格五趟）', async () => {
    // 破坏验证:把那条 watch 整条删掉 → 一趟都不发 → 红
    // (⚠ 只去掉 { immediate: true } **这条不红**:首进时 rows 从空变满,watch 照样会响一次。
    //  immediate 挡的是下面那条「第二次进门」—— 注释别谎报破坏点。)
    wire({ meters: ['2024-11', '2025-01'] })
    await mkRv()
    expect(vi.mocked(reviewApi.states).mock.calls.map(c => c[0]), '纵排两年 ⇒ 两趟').toEqual([2024, 2025])
  })

  it('❗第二次进门也要取 —— 五屏共读一份 chain，回到矩阵时它早就加载好了', async () => {
    // 破坏验证:watch 去掉 { immediate: true } → 挂载时年份表就已经是全的、字符串再没变过 →
    // watch 一次都不响 → 角标全没 → 红。而「换出账月」回到这道门走的正是这条路(store 有缓存),
    // 也就是说这是**多数**进门姿势,不是边角。
    wire({ meters: ['2025-01'], review: all5('2025-01', 'approved') })
    await useBillingPeriodStore().loadChain()      // 模拟:抄表屏已经进过一次,cells 早已在手
    vi.mocked(reviewApi.states).mockClear()
    const w = await mkRv()
    expect(vi.mocked(reviewApi.states).mock.calls.map(c => c[0])).toEqual([2025])
    expect(w.findAll('.bmm-card')[0].find('.bmm-rv').classes()).toContain('rv-approved')
  })

  it('❗角标与四道工序点并存，且不占流内子元素位 —— 加它不改月卡结构', async () => {
    // 破坏验证:把角标那个 <span> 挪进 .bmm-pips 里（或并进 pips/badge 那条 v-else-if 互斥链）
    // → 工序点消失 / 子元素数与无角标时相等 → 红
    wire({ meters: ['2025-01'], pool: ['2025-01'], review: all5('2025-01', 'submitted') })
    const withRv = (await mkRv()).findAll('.bmm-card')[0]
    // 同一张卡、闸道拉挂（yearLoaded 假 ⇒ statusOf 恒 null ⇒ 不画角标），其余完全一样
    setActivePinia(createPinia())
    wire({ meters: ['2025-01'], pool: ['2025-01'] })
    vi.mocked(reviewApi.states).mockRejectedValue(new Error('闸道挂了'))
    const without = (await mkRv()).findAll('.bmm-card')[0]

    expect(without.find('.bmm-rv').exists(), '对照组必须真的没有角标').toBe(false)
    expect(withRv.findAll('.bmm-pip.on'), '角标不许把工序点挤掉').toHaveLength(2)
    expect(withRv.element.children.length, '角标是 absolute 的，只多一个不占流的子元素')
      .toBe(without.element.children.length + 1)
    expect(withRv.element.children[0].classList.contains('bmm-month'), '月份仍是第一个流内元素').toBe(true)
  })
})
