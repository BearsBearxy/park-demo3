import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

import PvMeterView from '@/views/pv/PvMeterView.vue'
import { pvMeterApi } from '@/api/pvMeter'
import { useAuthStore } from '@/stores/auth'

/**
 * 运营账屏动线的端到端证明（2026-08-29「两本账」设计稿 §③）。
 *
 * 挑光伏分栋抄表做样本：三屏（分栋抄表 / 分桩明细 / 电费成本总览）接法逐字相同。
 *
 * 要钉的就两条：
 *   ① 第一次进 = 选期矩阵，**不许**再自己 snap 到某个月（改前 `latestPeriodOf` 干的事）
 *   ② 选过之后**卸载重挂**照样直落表 —— 侧栏点击走 `tabs.openFresh()` → epoch 递增 →
 *      组件全新重建，期若回到屏内 ref，这条当场红。
 */

vi.mock('@/api/pvMeter', () => ({
  pvMeterApi: {
    stations: vi.fn(), readings: vi.fn(), months: vi.fn(), years: vi.fn(),
    createReading: vi.fn(), updateReading: vi.fn(), deleteReading: vi.fn(),
    createStation: vi.fn(), updateStation: vi.fn(), deleteStation: vi.fn(),
    simulate: vi.fn(),
  },
}))

const STATIONS = [
  { id: 1, name: 'B 座', phase: 1, capacityKwp: 210, priceYuan: 0.62, sortNo: 1 },
  { id: 2, name: 'C、D 座', phase: 1, capacityKwp: 252, priceYuan: 0.62, sortNo: 2 },
]

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['meter-master:edit', 'meter-reading:edit']
  vi.clearAllMocks()
  localStorage.clear()
  vi.setSystemTime(new Date('2025-06-15T00:00:00'))
  vi.mocked(pvMeterApi.stations).mockResolvedValue(STATIONS as never)
  vi.mocked(pvMeterApi.readings).mockResolvedValue([] as never)
  vi.mocked(pvMeterApi.months).mockResolvedValue(['2025-01', '2025-02', '2025-03'])
})

async function open() {
  const w = mount(PvMeterView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}

describe('光伏分栋抄表 · 选期动线', () => {
  it('❗第一次进 = 选期矩阵，不再自己 snap 到某个月', async () => {
    const w = await open()
    expect(w.find('.fmg').exists(), '该看到选期矩阵').toBe(true)
    expect(w.find('.pm-page').exists(), '不该直接落表格').toBe(false)
    expect(pvMeterApi.readings, '没选期就不该去拉某个月的读数').not.toHaveBeenCalled()
  })

  it('矩阵按后端给的账期画格', async () => {
    const w = await open()
    const cards = w.findAll('.bmm-card')
    expect(cards).toHaveLength(12)                 // 数据年只有 2025，当前年也是 2025
    expect(cards[0].classes()).toContain('has')
    expect(cards[2].classes()).toContain('has')
    expect(cards[3].classes()).toContain('blank')
  })

  it('点月格 → 落表格，拉的是那个月', async () => {
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    expect(pvMeterApi.readings).toHaveBeenCalledWith(2025, 3)
    expect(w.find('.pm-page').exists()).toBe(true)
    expect(w.find('.fmg').exists(), '门该退场').toBe(false)
  })

  it('❗卸载重挂后期还在 —— 侧栏点开直落表格', async () => {
    const first = await open()
    await first.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    first.unmount()

    // 侧栏点击 = openFresh → epoch 变 → 全新实例。期若在屏内 ref，这里就回到矩阵了。
    vi.clearAllMocks()
    vi.mocked(pvMeterApi.stations).mockResolvedValue(STATIONS as never)
    vi.mocked(pvMeterApi.readings).mockResolvedValue([] as never)
    vi.mocked(pvMeterApi.months).mockResolvedValue(['2025-01', '2025-02', '2025-03'])

    const again = await open()
    expect(again.find('.fmg').exists(), '选过期了就不该再拦').toBe(false)
    expect(again.find('.pm-page').exists()).toBe(true)
    expect(pvMeterApi.readings).toHaveBeenCalledWith(2025, 3)
  })

  it('顶栏「换月」回矩阵，年月下拉已不存在', async () => {
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()

    expect(w.find('.pm-per').text(), '期写在工具条上').toBe('2025-03')
    expect(w.findAll('.mx-toolbar select'), '年月下拉整个撤了').toHaveLength(0)

    await w.find('.pm-permonth').trigger('click')
    await flushPromises()
    expect(w.find('.fmg').exists()).toBe(true)
  })

  it('❗一条数据都没有时照样画得出矩阵 —— 否则这本账彻底进不去', async () => {
    // 后端三个 /months 在空表时**正常返回 []**,不抛错。
    // 曾经用 `!dataMonths.length` 当加载中,于是零数据 → 门永久转圈 → 矩阵一次不渲染,
    // 而它是进这本账的唯一入口(功能门与返回箭头都已随重设计撤掉)。
    // 全新部署、或某车型一条抄表都没有时,那本账从此不可达,第一条也录不进去。
    vi.mocked(pvMeterApi.months).mockResolvedValue([])
    const w = await open()
    expect(w.find('.page-spin').exists(), '空数据不是「加载中」').toBe(false)
    expect(w.findAll('.bmm-card'), '当前年一行 12 张空卡').toHaveLength(12)
    expect(w.findAll('.bmm-card.blank')).toHaveLength(12)

    // 而且点得进去 —— 那正是要去录第一笔的地方
    await w.findAll('.bmm-card')[6].trigger('click')
    await flushPromises()
    expect(pvMeterApi.readings).toHaveBeenCalledWith(2025, 7)
  })

  it('账期清单拉不到 → 说出来 + 给重试，不给半张矩阵', async () => {
    vi.mocked(pvMeterApi.months).mockRejectedValue(new Error('后端挂了'))
    const w = await open()
    expect(w.find('.fp-lderr').exists()).toBe(true)
    expect(w.text()).toContain('后端挂了')
    expect(w.findAll('.bmm-card')).toHaveLength(0)
  })
})
