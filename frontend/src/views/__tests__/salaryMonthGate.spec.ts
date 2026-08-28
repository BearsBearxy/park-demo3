import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

import SalaryView from '@/views/salary/SalaryView.vue'
import { salaryApi } from '@/api/salary'

/**
 * 附表12 的月门（2026-08-29 设计稿 §3.4）。
 *
 * 改前：进年后 `onPickYear` 自动落到该年有数据的最大月，用户**没显式选过月**就进了某月宽表
 * —— 附表10 改造前的同款毛病，BOOK-WORKBENCH-SPEC §7-1 明令禁止。
 * 数据层其余附表（6/7/8/11/13/14）是整年一张表，没有「月」这一层可选，所以只有这一屏要补。
 */

vi.mock('@/api/salary', () => ({
  salaryApi: {
    overview: vi.fn(), records: vi.fn(),
    batchDelete: vi.fn(), clearImported: vi.fn(),
    create: vi.fn(), remove: vi.fn(), updateNote: vi.fn(),
  },
}))

const OVERVIEW = {
  currentYear: 2025,
  years: [{ year: 2025, hasData: true, months: [1, 2, 3], netTotal: 480000, count: 117 }],
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  vi.mocked(salaryApi.overview).mockResolvedValue(OVERVIEW as never)
  // total 全零:少给它 SalaryTable 会刷一屏 prop 警告,把真问题淹掉
  const zero = Object.fromEntries(['base','post','perf','attend','skill','edu','other','lunch','heat',
    'commission','wageTotal','gross','social','tax','otherDeduct','deduct','net'].map(k => [k, 0]))
  vi.mocked(salaryApi.records).mockResolvedValue({ year: 2025, month: 2, rows: [], total: zero } as never)
})

async function open() {
  const w = mount(SalaryView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}

/** 年份门 → 点 2025 年卡 */
async function pickYear(w: Awaited<ReturnType<typeof open>>) {
  await w.find('.sm-ycard').trigger('click')
  await flushPromises()
}

describe('附表12 · 月门', () => {
  it('进屏还是年份门', async () => {
    const w = await open()
    expect(w.find('.sm-gate').exists()).toBe(true)
  })

  it('❗选了年不再自动落进某个月 —— 先看到月份矩阵', async () => {
    const w = await open()
    await pickYear(w)
    expect(w.find('.s12-gate').exists(), '该是月份矩阵').toBe(true)
    expect(salaryApi.records, '没选月就不该拉某个月的工资').not.toHaveBeenCalled()
  })

  it('矩阵是单年一行 12 格,有数据的月实底', async () => {
    const w = await open()
    await pickYear(w)
    const cards = w.findAll('.bmm-card')
    expect(cards).toHaveLength(12)
    expect(cards[0].classes()).toContain('has')
    expect(cards[2].classes()).toContain('has')
    expect(cards[3].classes()).toContain('blank')
  })

  it('点月格才进宽表,拉的是那个月', async () => {
    const w = await open()
    await pickYear(w)
    await w.findAll('.bmm-card')[1].trigger('click')
    await flushPromises()
    expect(salaryApi.records).toHaveBeenCalledWith(2025, 2)
    expect(w.find('.s12-gate').exists(), '月门让位给宽表').toBe(false)
    expect(w.find('.s12-page').exists()).toBe(true)
  })

  it('空月也点得进去 —— 那正是要去录第一笔的地方', async () => {
    const w = await open()
    await pickYear(w)
    await w.findAll('.bmm-card')[7].trigger('click')
    await flushPromises()
    expect(salaryApi.records).toHaveBeenCalledWith(2025, 8)
  })

  it('宽表「换期」回月份矩阵,不是回年份门', async () => {
    const w = await open()
    await pickYear(w)
    await w.findAll('.bmm-card')[1].trigger('click')
    await flushPromises()
    await w.find('.lc-back').trigger('click')
    await flushPromises()
    expect(w.find('.s12-gate').exists(), '回的是月门').toBe(true)
    expect(w.find('.sm-gate').exists(), '不是年份门').toBe(false)
  })

  it('表内月份胶囊保留 —— 那是快速换月,不是进表的门', async () => {
    const w = await open()
    await pickYear(w)
    await w.findAll('.bmm-card')[1].trigger('click')
    await flushPromises()
    expect(w.findAll('.lc-mpill')).toHaveLength(12)
    await w.findAll('.lc-mpill')[2].trigger('click')
    await flushPromises()
    expect(salaryApi.records).toHaveBeenLastCalledWith(2025, 3)
  })
})
