import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

  it('❗换月取数失败 → 说出来 + 清空，不许「新期标题 + 上一期数字」', async () => {
    // 对抗复查坐实:点月格那一刻 picked 当场变 true、门收起、工具条期标与空态文案全换成新期,
    // 而表体的 readings 是上一期的 —— 用户把 3 月的量当 7 月读走,零提示、不自愈。
    // 更硬的一半:改前 loadReadings 连 try/catch 都没有。
    vi.mocked(pvMeterApi.readings).mockResolvedValue([
      { id: 1, stationId: 1, readDate: '2025-03-05', genTotal: 100, selfUse: 80, gridFeed: 20,
        priceSnap: 0.62, note: null, source: 'manual' },
    ] as never)
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')   // 2025-03,有数据
    await flushPromises()
    expect(w.find('.pm-per').text()).toBe('2025-03')

    vi.mocked(pvMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    await w.find('.pm-permonth').trigger('click')      // 回矩阵
    await flushPromises()
    await w.findAll('.bmm-card')[6].trigger('click')   // 2025-07,取数会失败
    await flushPromises()

    expect(w.find('.pm-per').text(), '期标已经是新期').toBe('2025-07')
    expect(w.find('.fp-lderr').exists(), '失败必须说出来').toBe(true)
    expect(w.text()).toContain('后端挂了')
  })

  it('❗录入/删除/导入之后要刷账期清单 —— 否则矩阵把刚录过的月继续画成「空」', async () => {
    // dataMonths 改前只喂年下拉(有 buildYearOptions 兜底,陈旧无所谓);
    // 现在它是矩阵 hasData 着色与「最近有数据月」描边的**唯一**数据源,陈旧就是矩阵在说假话。
    const w = await open()
    await w.findAll('.bmm-card')[7].trigger('click')   // 2025-08,空月
    await flushPromises()
    vi.mocked(pvMeterApi.months).mockClear()

    vi.mocked(pvMeterApi.deleteReading).mockResolvedValue(undefined as never)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const vm = w.vm as unknown as { delRow: (id: number, d: string) => Promise<void> }
    await vm.delRow(1, '2025-08-05')
    await flushPromises()

    expect(pvMeterApi.months, '写完要重新问一遍哪些月有数据').toHaveBeenCalled()
  })

  it('账期清单拉不到 → 说出来 + 给重试，不给半张矩阵', async () => {
    vi.mocked(pvMeterApi.months).mockRejectedValue(new Error('后端挂了'))
    const w = await open()
    expect(w.find('.fp-lderr').exists()).toBe(true)
    expect(w.text()).toContain('后端挂了')
    expect(w.findAll('.bmm-card')).toHaveLength(0)
  })
})

/**
 * 取数失败时,这一屏必须**闭嘴不猜** —— 2026-08-29 单屏对抗复查的 7 条。
 *
 * 共同的根:`rows` 是按 `stations` 铺的,读数拿不到时每格落 0。
 * 于是失败态下屏幕上是一张**长得完全正常的全零表**,而它是伪造的。
 * 三个出口必须一起堵:写入口(拿它当底数改)、导出(全零 xlsx 离开系统)、空态文案(「本月暂无」压过失败条)。
 */
describe('光伏分栋抄表 · 取数失败时不许猜', () => {
  /** 进到表格页(选好期),读数按 mock 决定成败。 */
  async function toTable() {
    const w = await open()
    await w.findAll('.bmm-card')[2].trigger('click')
    await flushPromises()
    return w
  }
  const btn = (w: ReturnType<typeof mount>, t: string) =>
    w.findAll('button').find(b => b.text().includes(t))

  it('❗读数挂了 + 编辑模式 → 一个写入口都不给', async () => {
    // 表里 13 行全零是 rows 按 stations 铺出来的假底数。放行录入 = 让人对着假数写真数据;
    // 更狠的是保存后 reload 撞抖动,主屏立刻变「本月暂无抄表记录」,用户判定失败去重录 ——
    // 同日撞 409,换个日期就是一条重复的消纳收益行。
    vi.mocked(pvMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await toTable()
    ;(w.vm as unknown as { editMode: boolean }).editMode = true
    await flushPromises()

    expect(w.find('.fp-lderr').exists(), '失败条得在').toBe(true)
    expect(w.findAll('.pm-edit'), '电站档案的行内输入框').toHaveLength(0)
    expect(btn(w, '导入'), '导入整月 Excel 的入口').toBeUndefined()
  })

  it('❗读数挂了 → 导出按钮禁用', async () => {
    // readings 被清成 [] 之后导出的是「全站全零」的月度表,与一个真正零发电的月份产出
    // **逐字节一致**。文件会离开系统发给别人,分辨不了就不能给。
    vi.mocked(pvMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await toTable()
    expect(btn(w, '导出')!.attributes('disabled'), '失败态还能导出').toBeDefined()
  })

  it('❗失败条与「本月暂无记录」不许同屏 —— 后者会被读成结论', async () => {
    vi.mocked(pvMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await toTable()
    expect(w.find('.fp-lderr').exists()).toBe(true)
    expect(w.find('.pm-empty').exists(), '「暂无记录」把失败说成了「真的没有」').toBe(false)
  })

  it('❗电站档案挂了 → 硬失败面 + 重试,不是永久转圈', async () => {
    // 改前 loadStations 是裸 await:一挂 stations 恒为 null,
    // 而模板那句 `v-else-if="!stations || !readings"` 就永远停在转圈上,连重试口都没有。
    vi.mocked(pvMeterApi.stations).mockRejectedValue(new Error('档案挂了'))
    const w = await toTable()
    expect(w.find('.page-spin').exists(), '不许永久转圈').toBe(false)
    expect(w.find('.pm-gate-fail').exists()).toBe(true)
    expect(w.text()).toContain('电站档案加载失败')

    vi.mocked(pvMeterApi.stations).mockResolvedValue(STATIONS as never)
    await btn(w, '重试')!.trigger('click')
    await flushPromises()
    expect(w.find('.pm-page').exists(), '重试成功该落表').toBe(true)
  })

  it('❗电站档案的失败不许被「换月」抹掉', async () => {
    // 两份数据合用一个错误槽时:档案挂了 → 用户点月格 → loadReadings 开头 `readErr = null`
    // 把它抹掉 → 读数拉成功 → 屏上是一张没有任何解释的空表(站没了行就没了)。
    // 这条就是逼出 stationsErr 独立槽的那一条。
    const w = await open()
    vi.mocked(pvMeterApi.stations).mockRejectedValue(new Error('档案挂了'))
    ;(w.vm as unknown as { loadStations: () => Promise<void> }).loadStations()
    await flushPromises()

    await w.findAll('.bmm-card')[2].trigger('click')   // 换月:读数这次是成功的
    await flushPromises()
    expect(w.text(), '档案的失败被读数的成功抹掉了').toContain('电站档案加载失败')
  })

  it('重试只重来挂掉的那一份', async () => {
    vi.mocked(pvMeterApi.readings).mockRejectedValue(new Error('后端挂了'))
    const w = await toTable()
    vi.mocked(pvMeterApi.stations).mockClear()
    vi.mocked(pvMeterApi.readings).mockClear()

    await w.find('.fp-lderr button').trigger('click')
    await flushPromises()
    expect(pvMeterApi.readings, '挂的那份要重来').toHaveBeenCalled()
    expect(pvMeterApi.stations, '好好的那份不必再拉一遍').not.toHaveBeenCalled()
  })

  it('❗.pm-page 必须 position:relative —— 否则加载条跑到页签条上', () => {
    // FPLoadBar 是 absolute 定位。宿主不给参照,它会认最近的定位祖先
    // (AppShell 的 .fp-main-card),横条直接画在整个工作区顶边上。
    // 同批四屏都写了 relative,这屏当初抄漏了 —— jsdom 不跑 scoped 样式,只能查源码。
    const s = readFileSync(join(__dirname, '../pv/PvMeterView.vue'), 'utf8')
    expect(/\.pm-page \{[^}]*position: relative/.test(s)).toBe(true)
  })
})
