import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

import PvMeterAnaView from '@/views/analysis/PvMeterAnaView.vue'
import { pvMeterApi, type PvReadingDTO, type PvStationDTO } from '@/api/pvMeter'
import { providePeriodMonths, usePeriod } from '@/analysis/usePeriod'
import { useCompare, __resetCompareForTest } from '@/analysis/useCompare'
import { RISK_ANNUAL_GAP, WATCH_ANNUAL_GAP } from '@/views/analysis/pvMeterAna.logic'

/**
 * 光伏分栋分析第一层的渲染证明(PV-ANALYSIS-SPEC §06.1)。
 *
 * logic 层已经有 236 条断言管算得对不对。这里管的是**屏上真的长出来了没有**,
 * 以及两条只有在渲染后才成立的硬要求:
 *   ① 术语黑名单钉在**渲染出来的 DOM** 上,不是钉在 logic 的返回值上 ——
 *      文案是在模板里拼的,logic 干净不等于屏上干净。
 *   ② 整年无抄表 → 空态深链,**不画假图**(§07 末行)。
 */

vi.mock('@/api/pvMeter', () => ({
  pvMeterApi: {
    stations: vi.fn(), readings: vi.fn(), readingsYear: vi.fn(),
    months: vi.fn(), years: vi.fn(), simulate: vi.fn(),
  },
}))
const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
// AnaShell 挂载时会去 fetchAvailableMonths,不 mock 会走真 axios
vi.mock('@/analysis/anaData', () => ({
  fetchAvailableMonths: vi.fn(async () => ({ months: ['2026-07', '2026-08'], sources: { pnl: ['2026-07', '2026-08'] } })),
  invalidateAnaCache: vi.fn(),
}))
// ECharts 在 jsdom 里没有 canvas;图只需证明「渲染了」,不需要真画
vi.mock('@/components/ana/AnaEChart.vue', () => ({
  default: { name: 'AnaEChart', props: ['option', 'height'], template: '<div class="stub-chart" />' },
}))

const pad = (n: number) => String(n).padStart(2, '0')
/** 6–18 点各一行:真实导出的常见形态 */

/** months 只给第三层用:那几条测的是图与文案渲染,不需要整年 —— 整年会让 buildSnapshot+buildLab
 *  在全量套件并行时超过默认 5s(实测)。分析质量由 logic 层的 spec 管,不靠屏测试 */
function fixture(monthCount = 12) {
  const stations: PvStationDTO[] = Array.from({ length: 9 }, (_, i) => ({
    id: i + 1, name: `S${i + 1}`, phase: 1, metered: 1,
    capacityKwp: 100, panelCount: null, panelWatt: null, priceYuan: 0.86, sortNo: i,
  }))
  const readings: PvReadingDTO[] = []
  // 整年 —— 屏加载的就是 readingsYear(y);只给两个月的话故障会占掉 70% 观测期,
  // 抛光把那个水平整个吸进 α,变点通道反而看不见(见本文件末尾那条断言)
  for (const m of Array.from({ length: monthCount }, (_, k) => k + 1)) {
    const dim = new Date(2026, m, 0).getDate()
    for (let d = 1; d <= dim; d++) {
      const date = `2026-${pad(m)}-${pad(d)}`
      for (let i = 0; i < 9; i++) {
        // S4 从 7/19 起掉 35% —— 一个屏上必须看得见的阶跃
        const bad = i === 3 && (m > 7 || (m === 7 && d > 18))
        const gen = 400 * (1 + (d % 5) * 0.1) * (bad ? 0.65 : 1)
        readings.push({
          id: readings.length + 1, stationId: i + 1, stationName: `S${i + 1}`, readDate: date,
          genTotal: gen, selfUse: gen * 0.7, gridFeed: gen * 0.3,
          priceSnap: 0.86, revenue: gen * 0.7 * 0.86, note: null, source: 'simulated',
        })
      }
    }
  }
  return { stations, readings }
}

// 按年份分发,不用 mockResolvedValueOnce —— 屏会因 setYear 再 load 一次,
// Once 会被那次 2026 的调用先吃掉,轮到 2025 时拿到的是当年数据(第一版就是这么假红的)
async function mountScreen(
  over: Partial<ReturnType<typeof fixture>> = {},
  prev?: PvReadingDTO[],
) {
  const f = { ...fixture(), ...over }
  vi.mocked(pvMeterApi.stations).mockResolvedValue(f.stations)
  vi.mocked(pvMeterApi.readingsYear).mockImplementation(async (y: number) =>
    y === 2026 ? f.readings : (prev ?? []))
  const w = mount(PvMeterAnaView, { global: { stubs: { RouterLink: true, teleport: true } } })
  await flushPromises()
  providePeriodMonths(['2026-07', '2026-08'], ['2026-08'])
  usePeriod().setYear(2026)
  await flushPromises()
  return w
}

describe('光伏分栋分析 · 第一层', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('渲染出四盏灯的定义、楼栋明细表与近月图', async () => {
    const w = await mountScreen()
    const t = w.text()
    expect(t).toContain('光伏分栋分析')
    expect(t).toContain('楼栋明细')
    // 四盏灯的定义必须写在灯旁边,不能只写在帮助里(§06.1 ③)
    expect(t).toContain('发电量与这栋楼一贯水平一致')
    expect(t).toContain('连续偏低且幅度大，基本可以确定不是天气原因')
    expect(t).toContain('这套判断平均一个月误报不到 1 次。')
    expect(w.findAll('tbody tr')).toHaveLength(9)
    expect(w.find('.stub-chart').exists()).toBe(true)
  })

  // 铁律:一份数据、一次计算、一个 snapshot id,并且**显示在页脚** ——
  // 数字对不上时先看是不是同一次计算,而不是先怀疑模型
  it('页脚显示 snapshot id 与有效日数', async () => {
    const w = await mountScreen()
    expect(w.text()).toContain('本页数据快照')
    expect(w.find('.pma-foot code').text()).toMatch(/^[0-9a-f]{8}$/)
    expect(w.text()).toMatch(/有效日 \d+ \/ \d+ 天/)
  })

  // §06「不确定性怎么说」:第一层永不出现统计术语。
  // 钉在渲染后的 DOM 上 —— 文案是在模板里拼的,logic 干净不等于屏上干净。
  it('渲染出来的文字里没有统计术语', async () => {
    const w = await mountScreen()
    const t = w.text()
    for (const word of ['显著', '残差', '归一化', '置信区间', '等效利用小时', 'kWh/kWp', 'p 值', 'q 值', '±2σ']) {
      expect(t, word).not.toContain(word)
    }
  })

  // 「这个数怎么来的」是整个设计的地基 —— 用户一定会问「你凭什么说这栋楼应该发更多」,
  // 答不上来这屏就废了。「对数双因子模型中位数抛光」不是答案,这段才是。
  it('「这个数怎么来的」展开后给的是人话,且说明了它看不出来什么', async () => {
    const w = await mountScreen()
    const btn = w.findAll('button').find(b => b.text().includes('这个数怎么来的'))!
    await btn.trigger('click')
    const t = w.find('.pma-note').text()
    expect(t).toContain('晒的是同一片太阳')
    expect(t).toContain('不需要装气象仪')
    expect(t).toContain('它看不出来的')      // 盲区必须自己说,不能等用户发现
  })

  it('点状态灯筛选下方列表,再点取消', async () => {
    const w = await mountScreen()
    const lamp = w.findAll('.pma-lamp').find(b => b.text().includes('正常'))!
    await lamp.trigger('click')
    const filtered = w.findAll('tbody tr').length
    expect(filtered).toBeGreaterThan(0)
    expect(filtered).toBeLessThan(9)
    await lamp.trigger('click')
    expect(w.findAll('tbody tr')).toHaveLength(9)
  })

  // §07 末行:整年无抄表 → 空态深链,**不画假图**
  it('整年无抄表 → 空态深链,不渲染表也不渲染图', async () => {
    const w = await mountScreen({ readings: [] })
    expect(w.text()).toContain('暂无分栋抄表记录')
    expect(w.find('tbody').exists()).toBe(false)
    expect(w.find('.stub-chart').exists()).toBe(false)
  })

  // 四个计数塞不进 KPI 的 value 槽(实测 159px vs 338px,ellipsis 吃掉后一半)。
  // 要行动的两档在 value,其余在 note —— 这个拆分被截断过一次,钉住它
  // 曾经写成裸 mount,靠上一条测试残留下来的 mock 实现才跑得起来(vi.clearAllMocks 只清调用记录,
  // 不清 mockResolvedValue)。删掉相邻那条测试就会莫名其妙地红 —— 改成自带夹具,不依赖执行顺序。
  it('楼栋状态卡:要行动的两档在主位,其余进副行', async () => {
    const w = await mountScreen()
    const tile = w.findAll('.av2-kpis .v').find(e => /异常/.test(e.text()))
    expect(tile, '楼栋状态卡的主位').toBeTruthy()
    expect(tile!.text()).toMatch(/^\d+ 异常 · \d+ 需关注$/)
    expect(tile!.text()).not.toContain('正常')      // 正常/不做判断在副行,不占主位
    expect(w.text()).toContain('点灯可筛选')
  })

  // 投资回收要总投资额,那是电费系统那边的数,现在没有 → 诚实说缺,不填假数
  it('缺总投资额时投资回收显 — 并说明原因', async () => {
    const w = await mountScreen()
    expect(w.text()).toContain('缺总投资额,暂不可算')
  })

  // ── 这屏存在的理由:种进去的阶跃,屏上认不认得出来 ──────────────────
  // 夹具里 S4 从 7/19 起掉 35%。认不出来的话前面所有断言都只是「渲染得出来」而已。
  it('种入的阶跃被认出来 —— S4 排第一行,情况指到 7 月,建议是现场检查', async () => {
    const w = await mountScreen()
    const first = w.findAll('tbody tr')[0]
    const cells = first.findAll('td').map(td => td.text())
    expect(cells[0]).toBe('S4')
    expect(cells[1]).toContain('异常')
    expect(cells[5]).toContain('7 月')          // 变点落在 7 月,且是「中旬/下旬」不是精确到天
    expect(cells[5]).toContain('之前正常')
    expect(cells[6]).toBe('现场检查')
  })

  it('变点文案不假装精确到天', async () => {
    const w = await mountScreen()
    const sit = w.findAll('tbody tr')[0].findAll('td')[5].text()
    expect(sit).toMatch(/上旬|中旬|下旬/)
    expect(sit).not.toMatch(/7 月 ?1?9 ?日/)
  })

  it('表按缺口金额降序,没缺口的排后面', async () => {
    const w = await mountScreen()
    const gaps = w.findAll('tbody tr').map(tr => {
      const t = tr.findAll('td')[3].text()
      return t === '—' ? 0 : Number(t.replace(/[^0-9]/g, ''))
    })
    expect([...gaps].sort((a, b) => b - a)).toEqual(gaps)
  })
})

// ── 同比(§07 第 8、9 行)。屏声明了 CMP=['yoy'],AnaShell 就会画出同比开关 ——
//    屏自己不 useCompare 的话,开关画得出来点了没反应。
describe('光伏分栋分析 · 同比', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    __resetCompareForTest()
  })

  it('默认不开同比时不去打上一年的接口', async () => {
    await mountScreen()
    expect(vi.mocked(pvMeterApi.readingsYear).mock.calls.map(c => c[0])).toEqual([2026])
  })

  // 这条要连跑两次完整分析(本年 + 上年)。实测 buildSnapshot 在 13 站 × 365 天下约 320ms,
  // 加上挂载与两次重算,在全量套件(178 个文件并行)抢 CPU 时会超过默认的 5s。
  // 单独放宽,不是把 testTimeout 全局调大 —— 别的用例该快就得快。
  it('打开同比才取上一年,并在页脚报出对齐了几个月', async () => {
    const w = await mountScreen({}, fixture().readings.map(
      r => ({ ...r, readDate: r.readDate.replace('2026', '2025') })))
    useCompare(['yoy']).set('yoy')
    await flushPromises()
    expect(vi.mocked(pvMeterApi.readingsYear).mock.calls.map(c => c[0])).toContain(2025)
    expect(w.text()).toContain('同比：')
    expect(w.text()).toContain('个月对齐后比较')
  }, 20000)

  // 0% 意味着「持平」,—— 意味着「没得比」。屏上绝不能把后者显成前者
  it('上一年无抄表 → 卡片说明为什么没得比,不显 0%', async () => {
    const w = await mountScreen({}, [])
    useCompare(['yoy']).set('yoy')
    await flushPromises()
    expect(w.text()).toContain('没得比')
  })
})

// ── 第二层 · 单栋详情(§06.2)──────────────────────────────────────────
describe('光伏分栋分析 · 第二层', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    __resetCompareForTest()
    location.hash = ''
  })

  it('默认不渲染第二层 —— 未选中站时整区不存在,不是渲染空态', async () => {
    const w = await mountScreen()
    expect(w.text()).not.toContain('累计缺口')
    expect(w.findAll('.stub-chart')).toHaveLength(1)   // 只有第一层那张近月图
  })

  it('点异常行展开:累计缺口 + 散点 + 逐月三块都出来', async () => {
    const w = await mountScreen()
    await w.findAll('tbody tr')[0].trigger('click')
    const t = w.text()
    expect(t).toContain('累计缺口')
    expect(t).toContain('至今累计')
    expect(t).toContain('同样天气下')
    expect(t).toContain('财务可直接抄进报告')
  })

  // §06.2:折点/斜率/终点是决策要的三样,必须都在
  it('主图旁给出折点、每天亏多少、再拖一个月多少钱', async () => {
    const w = await mountScreen()
    await w.findAll('tbody tr')[0].trigger('click')
    const t = w.find('.pma-cum').text()
    expect(t).toContain('折点')
    expect(t).toContain('/天')
    expect(t).toContain('再拖一个月')
  })

  // 变点给不了天级精度时,文案不能假装有
  it('折点措辞带区间,不是一个精确日期', async () => {
    const w = await mountScreen()
    await w.findAll('tbody tr')[0].trigger('click')
    const t = w.find('.pma-cum').text()
    expect(t).toMatch(/上旬|中旬|下旬|折点 · \d+\/\d+/)
  })

  // 财务主管一进去看见波动带,会认定「这屏不是给我用的」,连第一层也不再打开
  it('技术细节默认收起,点开才画', async () => {
    const w = await mountScreen()
    await w.findAll('tbody tr')[0].trigger('click')
    const before = w.findAll('.stub-chart').length
    const btn = w.findAll('button').find(b => b.text().includes('显示技术细节'))!
    await btn.trigger('click')
    expect(w.findAll('.stub-chart').length).toBe(before + 1)
  })

  it('再点同一行收起', async () => {
    const w = await mountScreen()
    const row = w.findAll('tbody tr')[0]
    await row.trigger('click')
    expect(w.text()).toContain('累计缺口')
    await w.findAll('tbody tr')[0].trigger('click')
    expect(w.text()).not.toContain('累计缺口')
  })

  // 不参与判定的站没有逐日明细 —— 点了不开,不弹一张空图
  it('点「数据不全」的行不展开', async () => {
    const f = fixture()
    // S9 只留 1 月的前 16 天 → 有效日 16 < 20。
    // 注意不能用「每月留 3 天」:12 个月 × 3 = 36 天,过得了 20 天门槛;
    // 也不能「每月留 1 天」,那会被判成月频口径(另一条护栏)
    const thin = f.readings.filter(r =>
      r.stationId !== 9 || (r.readDate.slice(0, 7) === '2026-01' && Number(r.readDate.slice(8, 10)) <= 16))
    const w = await mountScreen({ readings: thin })
    const muteRow = w.findAll('tbody tr').find(tr => tr.text().includes('数据不全'))!
    await muteRow.trigger('click')
    expect(w.text()).not.toContain('累计缺口')
  })

  // 同一个 URL 加锚点,不是另一套页面
  it('展开后写 URL 锚点', async () => {
    const w = await mountScreen()
    await w.findAll('tbody tr')[0].trigger('click')
    expect(location.hash).toMatch(/^#s\d+$/)
  })
})

// ── 第三层 · 方法与口径页(§06.3)────────────────────────────────────
describe('光伏分栋分析 · 第三层', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    __resetCompareForTest()
    location.hash = ''
  })

  // 方法页默认收起:财务主管一进来先看第一层,口径是要主动点开的那一层
  it('默认不展开方法页', async () => {
    const w = await mountScreen(fixture(4))
    expect(w.find('.pma-method').exists()).toBe(false)
  })

  it('方法页给出模型、显著性、三重门槛与本期数据质量', async () => {
    const w = await mountScreen(fixture(4))
    await w.findAll('button').find(b => b.text().includes('方法与口径'))!.trigger('click')
    const t = w.find('.pma-method').text()
    expect(t).toContain('中位数抛光')
    expect(t).toContain('变点检验')
    expect(t).toContain('循环分块置换')
    expect(t).toContain('三重门槛')
    expect(t).toContain('本期数据质量')
    expect(t).toContain('数据快照')
  })

  // 门槛数字必须与 logic 同源,不能在模板里写第二份
  it('方法页写出的金额门槛就是 logic 里那两个常量', async () => {
    const w = await mountScreen(fixture(4))
    await w.findAll('button').find(b => b.text().includes('方法与口径'))!.trigger('click')
    const t = w.find('.pma-method').text()
    expect(t).toContain(RISK_ANNUAL_GAP.toLocaleString('en-US'))
    expect(t).toContain(WATCH_ANNUAL_GAP.toLocaleString('en-US'))
  })

})

// 头一行的口径:屏上写的必须是实际有效日数,不是笼统的「全年数据」
describe('光伏分栋分析 · 有效日口径', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    __resetCompareForTest()
    location.hash = ''
  })

  // 头一行不许再声称「全年数据」—— 有效日是多少就说多少
  it('标题写的是实际有效日数,不是「全年数据」', async () => {
    const w = await mountScreen()
    const sub = w.find('.ak-sub').text()
    expect(sub).toMatch(/个有效日/)
    expect(sub).not.toContain('全年数据')
  })
})
