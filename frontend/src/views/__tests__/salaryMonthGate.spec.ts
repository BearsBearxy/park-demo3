import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

import SalaryView from '@/views/salary/SalaryView.vue'
import { salaryApi } from '@/api/salary'

/**
 * 附表12 的选期门 —— **一层**（2026-08-29「两本账」设计稿 §④）。
 *
 * 演进两步，这份 spec 记的是第二步：
 *   一（08-29 上午）改前进年后 `onPickYear` 自动落到「该年有数据的最大月」，用户没显式选过月
 *      就进了某月宽表 —— §7-1 明令禁止的「顺手落进某个期」。于是补了一道月门。
 *   二（08-29 下午）那道月门加错了：`BookMonthMatrix` 的设计意图写在组件头
 *      「全部年份纵排一屏——每年一行 12 张月卡」，**一层就够**；我却退化成「年份门 + 单年一行」两层。
 *      代价立刻可见：矩阵渲染的「＋ 补更早年份 / ＋ 添加次年」两个按钮**是死的**（只接了 @pick），
 *      而加年份的真入口跑到上一层年份门的虚线卡里去了。
 *
 * 现在与月度台账、附表10 同形：全年份矩阵 → 宽表。
 * 工资没有第二本账（没有对内逐日口径），所以**不要左栏**。
 *
 * 代价写明：年卡上「¥48.0万 · 117 人次」的年度指标随年份门一起退场，
 * 换成「哪几个月录了」一眼可见 —— 对按月录入的屏后者更有用（用户 2026-08-29 拍板）。
 */

vi.mock('@/api/salary', () => ({
  salaryApi: {
    overview: vi.fn(), records: vi.fn(),
    batchDelete: vi.fn(), clearImported: vi.fn(),
    create: vi.fn(), remove: vi.fn(), updateNote: vi.fn(),
  },
}))

// 期间深链(SIDEBAR-UX-REDESIGN §4.2):屏接了 useDeepPeriod(内部 useRoute)。query 可变 —— 深链那几条要在切回之间换掉 ?p=;
// fullPath 走 getter:useRoute() 的返回对象只建一次,写成普通字段的话切回时读到的还是旧地址(照 meterWriteGuards.spec:60-66)。
const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query, get fullPath() { return '/salary?' + new URLSearchParams(query).toString() } }),
}))

const OVERVIEW = {
  currentYear: 2025,
  years: [
    { year: 2024, hasData: true, months: [11, 12], netTotal: 96000, count: 24 },
    { year: 2025, hasData: true, months: [1, 2, 3], netTotal: 480000, count: 117 },
  ],
}

const ZERO = Object.fromEntries(
  ['base', 'post', 'perf', 'attend', 'skill', 'edu', 'other', 'lunch', 'heat',
    'commission', 'wageTotal', 'gross', 'social', 'tax', 'otherDeduct', 'deduct', 'net']
    .map(k => [k, 0]))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  for (const k of Object.keys(query)) delete query[k]
  vi.setSystemTime(new Date('2025-06-15T00:00:00'))
  vi.mocked(salaryApi.overview).mockResolvedValue(OVERVIEW as never)
  vi.mocked(salaryApi.records).mockResolvedValue({ year: 2025, month: 2, rows: [], total: ZERO } as never)
})

async function open() {
  const w = mount(SalaryView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}

/** 把屏包进 KeepAlive,alive 开关模拟切走 / 切回。 */
async function keptAlive() {
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(SalaryView) : null) }),
  }), { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return { w, alive }
}

/** 年份行标 → 该行 12 张月卡 */
function cellsOf(w: Awaited<ReturnType<typeof open>>, year: number) {
  const rows = w.findAll('.bmm-yrow:not(.bmm-addrow)')
  const row = rows.find(r => r.find('.bmm-y').text() === String(year))
  expect(row, `矩阵里没有 ${year} 年那一行`).toBeTruthy()
  return row!.findAll('.bmm-card')
}

describe('附表12 · 一层选期门', () => {
  it('❗进屏直接是全年份矩阵 —— 年份门那一层退场了', async () => {
    const w = await open()
    expect(w.find('.sm-gate').exists(), '不该再有年份门').toBe(false)
    expect(w.findAll('.bmm-yrow:not(.bmm-addrow)').length, '每年一行').toBe(2)
    expect(w.findAll('.bmm-card').length, '两年 × 12 月').toBe(24)
    expect(salaryApi.records, '没选月就不该拉某个月的工资').not.toHaveBeenCalled()
  })

  it('年份范围 = 数据年 ∪ 当前自然年，连续补满', async () => {
    vi.mocked(salaryApi.overview).mockResolvedValue({
      currentYear: 2025,
      years: [{ year: 2022, hasData: true, months: [5], netTotal: 1, count: 1 }],
    } as never)
    const w = await open()
    expect(w.findAll('.bmm-yrow:not(.bmm-addrow) .bmm-y').map(e => e.text()))
      .toEqual(['2022', '2023', '2024', '2025'])
  })

  it('有数据的月实底，没数据的虚线「空」', async () => {
    const w = await open()
    const c25 = cellsOf(w, 2025)
    expect(c25[0].classes()).toContain('has')
    expect(c25[2].classes()).toContain('has')
    expect(c25[3].classes()).toContain('blank')
    const c24 = cellsOf(w, 2024)
    expect(c24[10].classes(), '2024 只有 11、12 月').toContain('has')
    expect(c24[0].classes()).toContain('blank')
  })

  it('点月格 → 宽表，年和月一起定（跨年也对）', async () => {
    const w = await open()
    await cellsOf(w, 2024)[11].trigger('click')   // 2024-12
    await flushPromises()
    expect(salaryApi.records).toHaveBeenCalledWith(2024, 12)
    expect(w.findAll('.bmm-card').length, '矩阵让位给宽表').toBe(0)
    expect(w.find('.s12-page').exists()).toBe(true)
  })

  it('空月也点得进去 —— 那正是要去录第一笔的地方', async () => {
    const w = await open()
    await cellsOf(w, 2025)[7].trigger('click')
    await flushPromises()
    expect(salaryApi.records).toHaveBeenCalledWith(2025, 8)
  })

  it('宽表「换期」回矩阵', async () => {
    const w = await open()
    await cellsOf(w, 2025)[1].trigger('click')
    await flushPromises()
    await w.find('.lc-back').trigger('click')
    await flushPromises()
    expect(w.findAll('.bmm-card').length).toBe(24)
    expect(w.find('.sm-gate').exists(), '回的是矩阵,不是年份门').toBe(false)
  })

  it('表内月份胶囊保留 —— 那是快速换月,不是进表的门', async () => {
    const w = await open()
    await cellsOf(w, 2025)[1].trigger('click')
    await flushPromises()
    expect(w.findAll('.lc-mpill')).toHaveLength(12)
    await w.findAll('.lc-mpill')[2].trigger('click')
    await flushPromises()
    expect(salaryApi.records).toHaveBeenLastCalledWith(2025, 3)
  })

  it('❗「补更早年份」不再是死按钮 —— 上一版只接了 @pick', async () => {
    const w = await open()
    await w.find('.bmm-addy').trigger('click')
    await flushPromises()
    expect(w.findAll('.bmm-yrow:not(.bmm-addrow) .bmm-y').map(e => e.text()))
      .toEqual(['2023', '2024', '2025'])
    expect(JSON.parse(localStorage.getItem('bw-extra-years:salary:all') ?? '[]')).toEqual([2023])
  })

  it('❗「添加次年」也接上了', async () => {
    const w = await open()
    await w.find('.bmm-addbtn').trigger('click')
    await flushPromises()
    expect(w.findAll('.bmm-yrow:not(.bmm-addrow) .bmm-y').map(e => e.text()))
      .toEqual(['2024', '2025', '2026'])
  })

  it('手工加的空年可以移除；有数据的年没有移除钮', async () => {
    const w = await open()
    await w.find('.bmm-addbtn').trigger('click')   // 加 2026
    await flushPromises()
    const rm = w.findAll('.bmm-rm')
    expect(rm, '只有手工加的空年那一行有移除钮').toHaveLength(1)
    await rm[0].trigger('click')
    await flushPromises()
    expect(w.findAll('.bmm-yrow:not(.bmm-addrow) .bmm-y').map(e => e.text()))
      .toEqual(['2024', '2025'])
  })

  it('格子上的在场标记按**月**取,不再按年 —— 别人在改 3 月不该让整年 12 格都亮', async () => {
    const w = await open()
    // 矩阵把 scopeOf 传成 (y,m) => S.salary(y,m);组件按格调用
    const matrix = w.findComponent({ name: 'BookMonthMatrix' })
    const scopeOf = matrix.props('scopeOf') as (y: number, m: number) => string | null
    expect(scopeOf(2025, 3)).toBe('sched:salary:2025-03')
    expect(scopeOf(2025, 4)).toBe('sched:salary:2025-04')
  })
})

describe('附表12 · 期间深链(SIDEBAR-UX-REDESIGN §4.2)', () => {
  it('❗带 p 进屏直落那个月的宽表:矩阵不出现,拉的就是那个月且只拉一次', async () => {
    // 红线:SalaryView.vue 的 useDeepPeriod({ apply: … pickCell }) 删掉 → 落回矩阵
    query.p = '2025-03'
    const w = await open()
    expect(w.findAll('.bmm-card').length, '矩阵该被深链跳过').toBe(0)
    expect(w.find('.s12-page').exists()).toBe(true)
    expect(salaryApi.records).toHaveBeenCalledWith(2025, 3)
    expect(salaryApi.records).toHaveBeenCalledTimes(1)
  })

  it('只有年的链接不动 —— 本屏只认整月', async () => {
    query.p = '2025'
    const w = await open()
    expect(w.findAll('.bmm-card').length).toBe(24)
    expect(salaryApi.records).not.toHaveBeenCalled()
  })

  it('❗切页签回来重读:总览与本月都重拉 —— 导入中心导完切回来不能还是旧表(spec §12)', async () => {
    // 红线:SalaryView.vue 新加的 onReactivated 删掉 → 切回零请求
    query.p = '2025-03'
    const { alive } = await keptAlive()
    vi.mocked(salaryApi.overview).mockClear()
    vi.mocked(salaryApi.records).mockClear()
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(salaryApi.overview).toHaveBeenCalledTimes(1)
    expect(salaryApi.records).toHaveBeenCalledWith(2025, 3)
  })
})
