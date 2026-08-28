import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

import LossLedgerView from '@/views/alloc/LossLedgerView.vue'
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { allocApi } from '@/api/alloc'
import { paramsApi } from '@/api/params'
import { metersApi } from '@/api/meters'
import { billNoticesApi } from '@/api/billNotices'

/**
 * 出账链动线的端到端证明（2026-08-28 设计稿 §⑤）。
 *
 * 用户原话：「那你做成链条式的我想随意打开某个表来看的话怎么解决」。
 * 答案是期存在 store 而不是屏内 ref —— 这份 spec 就是那句话的可执行版本：
 * **卸载重挂之后期还在，直落表格**。
 *
 * 为什么「卸载重挂」是对的模拟：侧栏点击走 `tabs.openFresh()` → epoch 递增 →
 * `App.vue` 的 KeepAlive key（`value:epoch`）变 → 组件全新重建走 onMounted。
 * 期若回到屏内 ref，这份 spec 当场红。
 *
 * 挑楼栋损耗做样本：它是链上最薄的一屏（只读、无编辑态），
 * 门 / 链路条 / 组级期这三件的接法五屏逐字相同。
 */

vi.mock('@/api/alloc', () => ({
  allocApi: {
    loss: vi.fn(),
    poolMonths: vi.fn(),
    lossMonths: vi.fn(),
  },
}))
vi.mock('@/api/params', () => ({ paramsApi: { list: vi.fn(), status: vi.fn() } }))
vi.mock('@/api/meters', () => ({ metersApi: { months: vi.fn() } }))
vi.mock('@/api/billNotices', () => ({ billNoticesApi: { months: vi.fn() } }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const STATUS = {
  priceOk: 6, priceTotal: 6, pendingChanges: 0, lastChangeAt: null,
  poolSnapshotAt: null, billBatchAt: null, stale: false, otherMonthsAffected: [] as string[],
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  vi.mocked(metersApi.months).mockResolvedValue(['2025-02', '2025-03'])
  vi.mocked(allocApi.poolMonths).mockResolvedValue(['2025-03'])
  vi.mocked(allocApi.lossMonths).mockResolvedValue(['2025-03'])
  vi.mocked(billNoticesApi.months).mockResolvedValue([])
  vi.mocked(paramsApi.status).mockResolvedValue(STATUS)
  vi.mocked(paramsApi.list).mockResolvedValue([])
  vi.mocked(allocApi.loss).mockResolvedValue({ generated: true, units: [], recon: [] })
})

async function open() {
  const w = mount(LossLedgerView)
  await flushPromises()
  return w
}

describe('出账链动线 · 楼栋损耗', () => {
  it('本会话第一次进 → 出账月矩阵，不是表格', async () => {
    const w = await open()
    expect(w.find('.cmg').exists(), '该看到选期矩阵').toBe(true)
    expect(w.find('.ll-wrap').exists(), '不该直接落表格').toBe(false)
    expect(allocApi.loss, '没选期就不该去拉某个月的数据').not.toHaveBeenCalled()
  })

  it('点月格 → 落表格，并且拉的是那个月', async () => {
    const w = await open()
    // 2025 年那一行的 3 月（数据年只有 2025）
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    expect(w.find('.cmg').exists(), '门该退场').toBe(false)
    expect(w.find('.ll-wrap').exists()).toBe(true)
    expect(allocApi.loss).toHaveBeenCalledWith('2025-03')
  })

  it('❗卸载重挂后期还在 —— 侧栏点开直落表格，不再撞矩阵', async () => {
    const first = await open()
    await first.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    first.unmount()

    // 侧栏点击 = openFresh → epoch 变 → 全新实例。期若在屏内 ref，这里就回到矩阵了。
    vi.clearAllMocks()
    vi.mocked(paramsApi.list).mockResolvedValue([])
    vi.mocked(allocApi.loss).mockResolvedValue({ generated: true, units: [], recon: [] })
    vi.mocked(paramsApi.status).mockResolvedValue(STATUS)

    const again = await open()
    expect(again.find('.cmg').exists(), '选过期了就不该再拦').toBe(false)
    expect(again.find('.ll-wrap').exists()).toBe(true)
    expect(allocApi.loss).toHaveBeenCalledWith('2025-03')
  })

  it('链路条上写着期与当前屏 —— 用户任何时候都知道自己在哪个月、哪一环', async () => {
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()

    expect(w.find('.fss-period').text()).toBe('2025-03')
    const on = w.findAll('.fss-step').filter(s => s.classes('on'))
    expect(on).toHaveLength(1)
    expect(on[0].text()).toBe('楼栋损耗')
    expect(w.findAll('.fss-step').map(s => s.text()))
      .toEqual(['计费参数', '园区抄表', '公共电核算', '楼栋损耗', '催缴单'])
  })

  it('链路条的点跟着本月进度 —— 抄了表、生成了池和损耗，没出催缴单', async () => {
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    const states = w.findAll('.fss-step .fss-pip').map(p => p.classes().join(' '))
    expect(states).toEqual([
      'fss-pip done',   // 计费参数：与快照一致
      'fss-pip done',   // 园区抄表：2025-03 有读数
      'fss-pip done',   // 公共电核算：有池快照
      'fss-pip done',   // 楼栋损耗：有损耗快照
      'fss-pip todo',   // 催缴单：没出单
    ])
  })

  it('「换出账月」回矩阵 —— 想换月随时点得到', async () => {
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    await w.find('.fss-back').trigger('click')
    await flushPromises()
    expect(w.find('.cmg').exists()).toBe(true)
    expect(useBillingPeriodStore().picked).toBe(false)
  })

  it('顶栏那对年月下拉已撤 —— 「顺手落进某个期」的入口不复存在', async () => {
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    expect(w.findAll('.ll-head select')).toHaveLength(0)
    expect(w.find('.ll-head').text(), '标题行只剩屏名与期区').not.toContain('年')
  })
})
