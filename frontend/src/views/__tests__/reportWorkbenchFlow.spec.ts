import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

import { useAuthStore } from '@/stores/auth'

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
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ push: vi.fn() }) }))

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

describe('三大报表工作台 · 利润表', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // 公司增删改归 master 不归 report(RBAC §5.6);左栏管理区那三个按钮吃这个点
    useAuthStore().permissions = ['master:edit', 'report:edit']
    vi.clearAllMocks()
    localStorage.clear()
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
})
