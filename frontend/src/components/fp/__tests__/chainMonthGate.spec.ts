import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

import ChainMonthGate from '@/components/fp/ChainMonthGate.vue'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { metersApi } from '@/api/meters'
import { allocApi } from '@/api/alloc'
import { billNoticesApi } from '@/api/billNotices'
import { paramsApi } from '@/api/params'

/**
 * 出账月矩阵（2026-08-28 设计稿 §①）—— 五屏共用的那道门。
 * 组件本身是薄的：数据在 stores/billingPeriod，格子在 BookMonthMatrix，
 * 这里只负责把两者对起来，外加手工年的增删。
 */

vi.mock('@/api/meters', () => ({ metersApi: { months: vi.fn() } }))
vi.mock('@/api/alloc', () => ({ allocApi: { poolMonths: vi.fn(), lossMonths: vi.fn() } }))
vi.mock('@/api/billNotices', () => ({ billNoticesApi: { months: vi.fn() } }))
vi.mock('@/api/params', () => ({ paramsApi: { status: vi.fn() } }))

const NOW = 2025

function wire(o: { meters?: string[]; pool?: string[]; loss?: string[]; notices?: string[]; stale?: string[] } = {}) {
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
