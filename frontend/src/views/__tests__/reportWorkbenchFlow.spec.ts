import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

import { useAuthStore } from '@/stores/auth'
import { useTabsStore } from '@/stores/tabs'

import IncomeStatementView from '@/views/reports/income-statement/IncomeStatementView.vue'
import { companyApi } from '@/api/ledger'
import { reportApi } from '@/api/report'

/**
 * 三大报表：四层 → 两层（2026-08-29 设计稿 §3.2a）。
 *
 * 改前：整屏选公司 → 年份门 → 月历 → 正文。**换个公司看要退回第一屏，三道门重走一遍**
 * —— BOOK-WORKBENCH-SPEC §7-2 白纸黑字要求「多主体用左栏一键切换」，这屏是全站最违背它的一处。
 * 改后与月度台账、附表10 同形：左栏常驻公司 → 点月格 → 正文。
 *
 * 挑利润表做样本：三屏共用 `useFinStatementScreen`，接法逐字相同。
 */

vi.mock('@/api/ledger', () => ({
  companyApi: { list: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn() },
  ledgerApi: {},
}))
vi.mock('@/api/report', () => ({
  reportApi: { years: vi.fn(), year: vi.fn(), period: vi.fn(), allPeriod: vi.fn(), save: vi.fn() },
}))
const query: Record<string, string> = {}          // 深链;单测里临时塞 p/co(旧 y/m/co 也认)
const push = vi.fn()
// fullPath 走 getter:useRoute() 的返回对象只建一次,普通字段在切回时读到的还是旧地址(照 meterWriteGuards.spec:60-66)
vi.mock('vue-router', () => ({
  useRoute: () => ({ query, meta: { value: 'income-statement' }, get fullPath() { return '/income-statement?' + new URLSearchParams(query).toString() } }),
  useRouter: () => ({ push }),
}))

const COMPANIES = [
  { id: 1, name: '物业公司', short: '物业' },
  { id: 2, name: '资产公司', short: '资产' },
]

/** 物业公司 2025 有 1–3 月；资产公司 2024 有 1 月。 */
function wire() {
  vi.mocked(companyApi.list).mockResolvedValue(COMPANIES as never)
  vi.mocked(reportApi.years).mockImplementation((_s: string, cid: number) =>
    Promise.resolve(cid === 1 ? [{ year: 2025, months: 3 }] : [{ year: 2024, months: 1 }]) as never)
  vi.mocked(reportApi.year).mockImplementation((_s: string, cid: number, y: number) =>
    Promise.resolve({
      year: y,
      months: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        hasData: cid === 1 ? (y === 2025 && i < 3) : (y === 2024 && i < 1),
        netPreview: 1000 * (i + 1),
      })),
    }) as never)
  vi.mocked(reportApi.period).mockResolvedValue({
    year: 2025, month: 2, rows: [], customRows: [], amounts: {},
  } as never)
}

async function open() {
  const w = mount(IncomeStatementView, {
    global: { stubs: { Teleport: true, RouterLink: true, 'router-link': true } },
  })
  await flushPromises()
  return w
}

/** 把屏包进 KeepAlive,alive 开关模拟切走 / 切回(期间条裸 push 命中缓存实例就是这条路)。 */
async function keptAlive() {
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(IncomeStatementView) : null) }),
  }), { global: { stubs: { Teleport: true, RouterLink: true, 'router-link': true } } })
  await flushPromises()
  return { w, alive }
}

describe('三大报表工作台 · 利润表', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // 公司增删改归 master 不归 report(RBAC §5.6);左栏管理区那三个按钮吃这个点
    useAuthStore().permissions = ['master:edit', 'report:edit']
    vi.clearAllMocks()
    localStorage.clear()
    for (const k of Object.keys(query)) delete query[k]
    vi.setSystemTime(new Date('2025-06-15T00:00:00'))
    wire()
  })

  it('进屏 = 左栏 + 矩阵，没有整屏公司选择器那一层了', async () => {
    const w = await open()
    expect(w.find('.finw-rail').exists(), '左栏该常驻').toBe(true)
    expect(w.findAll('.bmm-card').length, '矩阵该在').toBeGreaterThan(0)
    expect(w.find('.fin-pick').exists(), '整屏公司选择器已退场').toBe(false)
  })

  it('左栏第一项是「全部汇总」，其余是各公司；默认选中第一家而非汇总', async () => {
    const w = await open()
    const items = w.findAll('.br-item')
    expect(items.map(i => i.text().replace(/\s+/g, ''))).toEqual(['全部汇总2家', '物业公司', '资产公司'])
    // 「全部汇总」要按公司数发 N 倍请求，不该当默认落点
    expect(items[1].classes()).toContain('on')
    expect(items[0].classes()).not.toContain('on')
  })

  it('月格来自那家公司的数据年 —— 2025 年前三格有数据', async () => {
    const w = await open()
    const cards = w.findAll('.bmm-card')
    expect(cards[0].classes()).toContain('has')
    expect(cards[2].classes()).toContain('has')
    expect(cards[3].classes()).toContain('blank')
  })

  it('月格徽标显本期净额，不是「N 行」', async () => {
    const w = await open()
    expect(w.findAll('.bmm-card')[0].find('.bmm-count').text()).not.toContain('行')
  })

  it('❗切公司只动左栏 —— 不退回第一屏、不重走年份门与月历', async () => {
    const w = await open()
    await w.findAll('.br-item')[2].trigger('click')   // 资产公司
    await flushPromises()

    expect(w.find('.finw-rail').exists(), '左栏还在').toBe(true)
    expect(w.findAll('.bmm-card').length, '直接就是新公司的矩阵').toBeGreaterThan(0)
    expect(w.text()).toContain('资产公司')
    // 资产公司的数据年是 2024，年份范围补到当前年 2025 → 两行
    expect(w.findAll('.bmm-yrow .bmm-y').map(e => e.text())).toEqual(['2024', '2025'])
  })

  it('点月格 → 正文，年与月一起定（§7-1 明确选期门）', async () => {
    const w = await open()
    await w.findAll('.bmm-card')[1].trigger('click')   // 2025-02
    await flushPromises()
    expect(reportApi.period).toHaveBeenCalledWith('is', 1, 2025, 2)
    expect(w.findAll('.bmm-card').length, '矩阵让位给正文').toBe(0)
  })

  it('正文态「换期」回矩阵，左栏一直在', async () => {
    const w = await open()
    await w.findAll('.bmm-card')[1].trigger('click')
    await flushPromises()
    await w.find('.fin-back').trigger('click')
    await flushPromises()
    expect(w.findAll('.bmm-card').length).toBeGreaterThan(0)
    expect(w.find('.finw-rail').exists()).toBe(true)
  })

  it('公司增删改还在 —— 搬到左栏管理区，作用于当前选中那一家', async () => {
    const w = await open()
    const btns = w.findAll('.finw-mbtn')
    expect(btns.map(b => b.text())).toEqual(['新增', '重命名', '删除'])
    await btns[1].trigger('click')
    await flushPromises()
    // FinDialogs 打开重命名，带的是左栏高亮那家
    expect(w.text()).toContain('物业公司')
  })

  it('停在「全部汇总」时重命名/删除置灰但不挪位（入口常驻）', async () => {
    const w = await open()
    await w.findAll('.br-item')[0].trigger('click')   // 全部汇总
    await flushPromises()
    const btns = w.findAll('.finw-mbtn')
    expect(btns).toHaveLength(3)
    expect(btns[1].attributes('disabled')).toBeDefined()
    expect(btns[2].attributes('disabled')).toBeDefined()
    expect(btns[0].attributes('disabled'), '「新增」与选中项无关,照常可点').toBeUndefined()
  })

  // ── P3:报表中心带期跳转 + 期间条(设计稿 §3.2b/c) ──
  describe('带期深链', () => {
    it('❗从报表中心带期过来 → 直落那一期,跳过矩阵', async () => {
      Object.assign(query, { y: '2025', m: '3', co: '1' })
      const w = await open()
      expect(reportApi.period).toHaveBeenCalledWith('is', 1, 2025, 3)
      expect(w.findAll('.bmm-card').length, '矩阵该被跳过').toBe(0)
    })

    it('带期里的公司也认 —— 落到它说的那家,不是默认第一家', async () => {
      Object.assign(query, { y: '2024', m: '1', co: '2' })
      const w = await open()
      expect(reportApi.period).toHaveBeenCalledWith('is', 2, 2024, 1)
      expect(w.findAll('.br-item')[2].classes(), '左栏高亮资产公司').toContain('on')
    })

    it('只有年没有月(从损益附表跳回来)→ 停在矩阵,年份照它说的', async () => {
      Object.assign(query, { y: '2025', co: '1' })
      const w = await open()
      expect(reportApi.period, '没有月就不该直接拉某一期').not.toHaveBeenCalled()
      expect(w.findAll('.bmm-card').length).toBeGreaterThan(0)
    })

    it('地址栏里的垃圾一律不信 —— 照常走默认动线', async () => {
      Object.assign(query, { y: '1999', m: '99' })
      const w = await open()
      expect(reportApi.period).not.toHaveBeenCalled()
      expect(w.findAll('.br-item')[1].classes(), '退回默认第一家').toContain('on')
    })
  })

  describe('期间条', () => {
    it('九张报表都在条上,当前屏标出来', async () => {
      const w = await open()
      await w.findAll('.bmm-card')[1].trigger('click')
      await flushPromises()
      const steps = w.findAll('.fss-step')
      expect(steps).toHaveLength(9)
      expect(steps.filter(s => s.classes('on')).map(s => s.text())).toEqual(['利润表'])
    })

    it('❗跳去别的报表时把整包期带上 —— 月份与公司都不丢(periodLink 形状 p/co)', async () => {
      const w = await open()
      await w.findAll('.bmm-card')[1].trigger('click')   // 2025-02
      await flushPromises()
      await w.findAll('.fss-step')[3].trigger('click')   // 附表1
      expect(push).toHaveBeenCalledWith({
        path: '/rent-pnl',
        query: { p: '2025-02', co: '1' },
      })
    })

    it('矩阵态没有条 —— 还没选期,没有期可写', async () => {
      const w = await open()
      expect(w.findAll('.fss-step')).toHaveLength(0)
    })

    it('矩阵态的页签上下文也没有期,选了月才有 —— current().p 在矩阵态是光秃秃一个年份(深链相等判专用),照抄会让页签写出「利润表 · 2025」而用户没点过月格', async () => {
      const w = await open()
      const tabs = useTabsStore()
      expect(tabs.ctx['income-statement']?.p).toBeUndefined()
      await w.findAll('.bmm-card')[1].trigger('click')   // 2025-02
      await flushPromises()
      expect(tabs.ctx['income-statement']).toEqual({ p: '2025-02', coName: '物业公司' })
    })
  })

  describe('期间深链(SIDEBAR-UX-REDESIGN §4.2 · P0c)', () => {
    it('❗第二圈期跟随:切走后地址换成别的月,切回直落新月 —— 改前只在 onMounted 读一次,期间条裸 push 命中缓存实例期不动', async () => {
      query.p = '2025-03'; query.co = '1'
      const { w, alive } = await keptAlive()
      expect(reportApi.period).toHaveBeenCalledWith('is', 1, 2025, 3)
      alive.value = false; await flushPromises()
      query.p = '2025-04'
      alive.value = true; await flushPromises()
      expect(reportApi.period).toHaveBeenCalledWith('is', 1, 2025, 4)
      expect(w.findAll('.bmm-card'), '正文态,不是矩阵').toHaveLength(0)
    })

    it('无 query 激活不重置:切回时地址栏没有期,停在原来那一期', async () => {
      query.p = '2025-03'; query.co = '1'
      const { w, alive } = await keptAlive()
      vi.mocked(reportApi.period).mockClear()
      alive.value = false; await flushPromises()
      delete query.p; delete query.co
      alive.value = true; await flushPromises()
      expect(reportApi.period).not.toHaveBeenCalled()
      expect(w.findAll('.bmm-card'), '还在 2025-03 正文').toHaveLength(0)
    })

    it('有未保存草稿时切回不换期,只在页内提示', async () => {
      query.p = '2025-03'; query.co = '1'
      const { w, alive } = await keptAlive()
      const vm = w.findComponent(IncomeStatementView).vm as unknown as { draft: Record<string, number> }
      vm.draft = { 'r1|amount': 1 }    // dirty = 1(draft 键数;不走编辑锁)
      await flushPromises()
      vi.mocked(reportApi.period).mockClear()
      alive.value = false; await flushPromises()
      query.p = '2025-04'
      alive.value = true; await flushPromises()
      expect(reportApi.period).not.toHaveBeenCalled()
      expect(w.find('.fpt--warning').text()).toContain('地址栏要求 2025-04 期')
    })

    it('co 指名的公司不存在 → 不落错公司:停在首家公司的矩阵,不拉本期', async () => {
      query.p = '2025-03'; query.co = '999'
      const w = await open()
      expect(reportApi.period).not.toHaveBeenCalled()
      expect(w.findAll('.br-item')[1].classes(), '首家公司照常选中').toContain('on')
      expect(w.findAll('.bmm-card').length, '矩阵').toBeGreaterThan(0)
    })

    it('❗只有年的链落在停在正文的缓存实例上 → 回矩阵、年落位、不拉本期 —— pickCompany 同公司早退不清 month,applyDeep 得自己回', async () => {
      query.p = '2025-03'; query.co = '1'
      const { w, alive } = await keptAlive()
      vi.mocked(reportApi.period).mockClear()
      alive.value = false; await flushPromises()
      query.p = '2024'; delete query.co
      alive.value = true; await flushPromises()
      expect(reportApi.period).not.toHaveBeenCalled()
      expect(w.findAll('.bmm-card').length, '回矩阵').toBeGreaterThan(0)
      expect((w.findComponent(IncomeStatementView).vm as unknown as { year: number }).year).toBe(2024)
    })
  })
})
