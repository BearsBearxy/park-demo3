import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import PvView from '@/views/pv/PvView.vue'
import { pvApi } from '@/api/pv'
import { pvMeterApi } from '@/api/pvMeter'
import { useAuthStore } from '@/stores/auth'

/**
 * 一屏两本账：功能门 → 左栏（2026-08-29「两本账」设计稿 §②）。
 *
 * 改前是一道**整屏拦住**的岔路口，而且 `mode` 是纯本地 ref ——
 * 侧栏点击走 `tabs.openFresh()` 会重建组件，**每次进来都要重答一遍这道选择题**。
 *
 * 三份原规范（PV/CP/ELEC-METER-SPEC）本来就写着「会话内记住选择（KeepAlive）」，
 * 而实现从落笔那天起就没做到：`openFresh` 的语义（2026-07-07 定）比那三份规范
 * （07-18/19 定稿）早 11 天，两份文档从没对过账。所以这不是推翻规范，是补上它。
 *
 * 挑光伏做样本：三屏（光伏 / 充电桩 / 电费）接法逐字相同，另外两屏由下面的结构门禁覆盖。
 */

vi.mock('@/api/pv', () => ({
  pvApi: {
    overview: vi.fn(), records: vi.fn(), phases: vi.fn(),
    create: vi.fn(), remove: vi.fn(), batchDelete: vi.fn(),
    clearImported: vi.fn(), updateNote: vi.fn(),
  },
}))
vi.mock('@/api/pvMeter', () => ({
  pvMeterApi: {
    stations: vi.fn(), readings: vi.fn(), months: vi.fn(), years: vi.fn(),
    createReading: vi.fn(), updateReading: vi.fn(), deleteReading: vi.fn(),
    createStation: vi.fn(), updateStation: vi.fn(), deleteStation: vi.fn(), simulate: vi.fn(),
  },
}))

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['entry:edit', 'meter-master:edit', 'meter-reading:edit']
  vi.clearAllMocks()
  localStorage.clear()
  vi.setSystemTime(new Date('2025-06-15T00:00:00'))
  vi.mocked(pvApi.overview).mockResolvedValue({ currentYear: 2025, years: [] } as never)
  vi.mocked(pvApi.phases).mockResolvedValue([] as never)
  vi.mocked(pvMeterApi.stations).mockResolvedValue([] as never)
  vi.mocked(pvMeterApi.readings).mockResolvedValue([] as never)
  vi.mocked(pvMeterApi.months).mockResolvedValue([])
})

async function open() {
  const w = mount(PvView, { global: { stubs: { Teleport: true } } })
  await flushPromises()
  return w
}

describe('光伏 · 一屏两本账', () => {
  it('❗进屏不再是岔路口 —— 左栏两本账常驻，主区直接是内容', async () => {
    const w = await open()
    const items = w.findAll('.br-item')
    expect(items).toHaveLength(2)
    expect(items.map(i => i.find('.br-name').text())).toEqual(['报送台账', '分栋运营账'])
    // 主区已经在报送台账那一支(年份门),不是一屏卡片
    expect(w.find('.sm-gate').exists(), '默认落在报送台账').toBe(true)
  })

  it('左栏副行写的是「按什么口径看」，不是功能名', async () => {
    const w = await open()
    expect(w.findAll('.br-item .br-desc').map(d => d.text()))
      .toEqual(['按期 · 按月', '按栋 · 按日'])
  })

  it('点左栏第二项 → 换到运营账那一支，左栏还在', async () => {
    const w = await open()
    await w.findAll('.br-item')[1].trigger('click')
    await flushPromises()
    expect(w.find('.fmg').exists(), '运营账那支自己的选期矩阵').toBe(true)
    expect(w.findAll('.br-item'), '左栏常驻').toHaveLength(2)
    expect(w.findAll('.br-item')[1].classes()).toContain('on')
  })

  it('❗记住上次 —— 卸载重挂(模拟侧栏点击重建)直接落回运营账', async () => {
    const first = await open()
    await first.findAll('.br-item')[1].trigger('click')
    await flushPromises()
    first.unmount()

    const again = await open()
    expect(again.findAll('.br-item')[1].classes(), '不该退回默认那本').toContain('on')
    expect(again.find('.fmg').exists()).toBe(true)
  })

  it('本机存的值被人改坏了就退回默认，不白屏', async () => {
    localStorage.setItem('fp-view-mode:pv-income', 'nonsense')
    const w = await open()
    expect(w.findAll('.br-item')[0].classes()).toContain('on')
  })

  it('两支各自的返回箭头随功能门一起退场 —— 左栏就是出路', async () => {
    const w = await open()
    // 报送台账支:年份门不再有「返回功能选择」
    expect(w.find('.sm-gate-back').exists()).toBe(false)
    await w.findAll('.br-item')[1].trigger('click')
    await flushPromises()
    expect(w.find('.pm-back').exists(), '运营账支的返回箭头也撤了').toBe(false)
  })
})

/** 另外两屏只做结构门禁 —— 三屏接法逐字相同，各写一份挂载测只会长歪。 */
describe('三屏一致性门禁', () => {
  const VIEWS = join(__dirname, '..')
  const FILES: Record<string, string> = {
    '/pv/PvView.vue': 'pv-income',
    '/charging/ChargingView.vue': 'car-charging',   // 文件里是三元，下面只查前缀
    '/elec/ElecView.vue': 'elec-cost',
  }

  it.each(Object.keys(FILES))('%s 功能门已退场，换成左栏', (rel) => {
    const s = readFileSync(join(VIEWS, rel), 'utf8')
    expect(/fngate/.test(s), `${rel} 还有功能门那块整屏卡片`).toBe(false)
    expect(s.includes('<BookRail'), `${rel} 没有左栏`).toBe(true)
    expect(s.includes('loadViewMode'), `${rel} 不记上次看的是哪本 —— openFresh 会把它清掉`).toBe(true)
    expect(s.includes('saveViewMode'), `${rel} 只读不写，等于没记`).toBe(true)
    expect(/mode = ref<Mode>/.test(s), `${rel} 的 mode 不是从本机读出来的`).toBe(true)
    // 「返回功能选择」是功能门的回退口，门没了它也该没了
    expect(s.includes('返回功能选择'), `${rel} 还留着功能门的回退口`).toBe(false)
  })

  it.each(['/pv/PvMeterView.vue', '/charging/CpMeterView.vue', '/elec/ElecCostView.vue'])(
    '%s 的返回箭头与 back 事件一并退场', (rel) => {
      const s = readFileSync(join(VIEWS, rel), 'utf8')
      expect(s.includes('返回功能选择')).toBe(false)
      expect(s.includes("defineEmits<{ back: [] }>"), `${rel} 的 back 事件没人接了`).toBe(false)
    })
})
