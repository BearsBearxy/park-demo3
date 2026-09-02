import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

import PvMeterAnaView from '@/views/analysis/PvMeterAnaView.vue'
import { buildLab } from '@/views/analysis/pvMeterAna.logic'
import { pvMeterApi, type PvReadingDTO, type PvStationDTO } from '@/api/pvMeter'
import { paramsApi } from '@/api/params'
import { providePeriodMonths, usePeriod } from '@/analysis/usePeriod'
import { useCompare, __resetCompareForTest } from '@/analysis/useCompare'
import { PV_COLORS } from '@/views/analysis/pvAnaColors'

/**
 * 光伏分栋分析 v3 的渲染证明(PV-ANALYSIS-SPEC §06 全段 + §08 v3 验收)。
 *
 * logic 层的 spec 管算得对不对。这里管**屏上真的长出来了没有**,以及只有渲染后才成立的:
 *   ① 期间切「按月 / 按年」时刻度真的换了 —— 月段画当月那三十来个点,不是全年逐日。
 *   ② **文案规范**(§05)钉在渲染出来的 DOM 上:只说明可视化在做什么,
 *      不出现判词、建议动作、反事实金额,也不出现 p / q。
 *   ③ 整年无抄表 → 空态深链,不画假图。
 *
 * ④ **信息结构**(§00 v3-1/2,用户否掉了「13 行 20px 缩略条铺满首屏」)。
 *    这一组钉的是设计决定本身,不是某句文案 —— 它们是最容易在下次加功能时被悄悄推平的:
 *      · 首屏 = 队列(纯文字数字)+ **一张**单栋大图。13 行墙不许长回来。
 *      · B0 主数与队列「出范围段」组**同一个门槛**。曾经这里用「出过一次带」数数,
 *        ±2σ 天然漏出 4.6%,健康的栋几乎全被标上 —— 换个样子的同一个病。
 *      · 主卡(L1)里一张 ECharts 都不渲染:队列 + 大图是定位工具,校准与消纳是佐证,不并排等权。
 *
 * ⑤ **月中未录全**(§03.8,v3 新增的一等状态)。未到的日子 ≠ 漏抄的日子:
 *    两种视觉、两种算法,分母也不同 —— 覆盖率按**已过去**算,按整段算的话
 *    8 月 15 号打开时 13 栋全掉进「读不出」,而这屏存在的理由恰恰是「录完几天内就能看出」。
 *
 * ⑥ **排他规则**(§06.0,可机械检查那四条里能在 jsdom 里查的):
 *    26px 只在 B0 一次 / #9D5D17 **双向**钉在 L0-L1(那边必须有、这边一个都没有)/ height=440 整屏零次。
 *
 * ⑧ **配色**(§06.7)。颜色只在有真实维度的地方上岗:焦点 / 类别 / 告警。这一组钉的也是**作用域**:
 *    · 告警橙单向断言("L2/L3 没有")测不出「把 L0/L1 的橙整个删掉」—— 那边必须同时断言它在。
 *    · 焦点蓝断言"有一条蓝线"证不了它跟着队列走 —— 得点另一栋,看那条线**换了名字**。
 *    · 质量矩阵四态曾经挤在 2 灰 1 蓝里,缺抄(可行动)与未投产(不可行动)都是浅灰 ——
 *      那是把 3ceefe0 修过的 bug 用颜色再犯一次,所以四态必须落在四个类上。
 *    · 13 栋仍然没有一栋拥有自己的颜色:B3 里带颜色的只有口径线与「当前选中」这个状态。
 *
 * ⑦ **「高级分析」第三档**(2026-08 被砍掉的分析工作台,恢复在段控第三格)。
 *    这一组钉的是**作用域**,不是「多了个 tab」:统计量(σ / 置信 / N_eff / zₙ / 块自助 / BH-FDR)
 *    **只在这一档出现**,其余四处(L0 / L1 / 绝对水平 / 账面量)一个都不许有。
 *    单向放宽禁词表等于把闸门开条缝 —— 下一次有人往首屏写个 p 值也测不出来;
 *    双向才把作用域钉死:少了这一档也红,多漏到别处也红。
 */

vi.mock('@/api/pvMeter', () => ({
  pvMeterApi: {
    stations: vi.fn(), readings: vi.fn(), readingsYear: vi.fn(),
    months: vi.fn(), years: vi.fn(), simulate: vi.fn(),
  },
}))
vi.mock('@/api/params', () => ({ paramsApi: { list: vi.fn() } }))
// buildLab 原样跑,只是包一层计数器:「高级分析」是懒算的(13 次 buildDetail + 第二次抛光
// + 两轮块自助),停在默认档时它一次都不该被调 —— 只查七块没渲染证不了这件事,
// 七块本来就挂在 v-else-if 下面,算不算都不会出现在 DOM 里。
vi.mock('@/views/analysis/pvMeterAna.logic', async (orig) => {
  const a = await orig<typeof import('@/views/analysis/pvMeterAna.logic')>()
  return { ...a, buildLab: vi.fn(a.buildLab) }
})
const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))
vi.mock('@/analysis/anaData', () => ({
  fetchAvailableMonths: vi.fn(async () => ({ months: ['2026-07', '2026-08'], sources: { pnl: ['2026-07', '2026-08'] } })),
  invalidateAnaCache: vi.fn(),
}))
// height 与 option 都挂到 DOM 上:排他规则(height=440 零次 / #9D5D17 不进 L2-L3)
// 要查的正是**传进图里的那份 JSON**,只看渲染出来的文字查不到颜色。
vi.mock('@/components/ana/AnaEChart.vue', () => ({
  default: {
    name: 'AnaEChart', props: ['option', 'height'],
    template: '<div class="stub-chart" :data-h="height" :data-opt="JSON.stringify(option)" />',
  },
}))

const pad = (n: number) => String(n).padStart(2, '0')
const N = 9
const dim = (y: number, m: number) => new Date(y, m, 0).getDate()

// 确定性伪随机。**健康的栋也必须有正常抖动** —— 一份完全无噪声的夹具测不出
// 「把噪声当发现」这类 bug:±2σ 天然双侧漏出 ~4.6%,真库上正是它让 11 栋里 9 栋被误标,
// 而无噪声夹具里健康栋一个点都不出带,两种口径恰好给出同一个答案(假绿)。
// 不用 Math.random:测试要可复现。
const rnd = (i: number, m: number, d: number) => {
  const x = Math.sin(i * 127.1 + m * 311.7 + d * 74.7) * 43758.5453
  return x - Math.floor(x)
}

interface FxOpt {
  /** S4 从 7/19 起掉 35%(种入的断崖)。false = 零故障园区,用来验 0 命中那一屏 */
  crash?: boolean
  /** 最后一条抄表。月中未录全用它把数据截在 8/15 */
  through?: string
  /** 全园都没抄的日子(漏抄,不是未到) */
  skip?: string[]
}

const stationsFx: PvStationDTO[] = Array.from({ length: N }, (_, i) => ({
  id: i + 1, name: `S${i + 1}`, phase: i < 5 ? 1 : 2, metered: 1,
  // S3 台账 100 而板数算出来 50 —— 台账差那条判据线的靶子
  capacityKwp: 100, panelCount: i === 2 ? 100 : 200, panelWatt: 500,
  priceYuan: 0.86, sortNo: i,
}))

/** 一年的逐日抄表。9 栋;S4 从 7/19 起掉 35%;其余栋只有正常抖动 */
function readingsOf(year: number, o: FxOpt = {}): PvReadingDTO[] {
  const crash = o.crash ?? true
  const through = o.through ?? `${year}-12-31`
  const skip = new Set(o.skip ?? [])
  const out: PvReadingDTO[] = []
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= dim(year, m); d++) {
      const date = `${year}-${pad(m)}-${pad(d)}`
      if (date > through) return out
      if (skip.has(date)) continue
      for (let i = 0; i < N; i++) {
        const bad = crash && i === 3 && (m > 7 || (m === 7 && d > 18))
        const u = rnd(i, m, d)
        // ±3% 常态抖动 + 4% 的日子来一个 ±10% 尖峰。频率是调过的:健康的栋每月
        // 落到范围外一两天(±2σ 的正常漏出),但**够不到** scatterMin 那条判据线 ——
        // 「出过范围」与「算一段」必须在夹具里就是两件事,否则这组断言测不出东西
        const jit = 1 + (u - 0.5) * 0.06 + (u > 0.98 ? 0.10 : u < 0.02 ? -0.10 : 0)
        const gen = 400 * (1 + (d % 5) * 0.1) * jit * (bad ? 0.65 : 1)
        out.push({
          id: out.length + 1, stationId: i + 1, stationName: `S${i + 1}`, readDate: date,
          genTotal: gen, selfUse: gen * 0.7, gridFeed: gen * 0.3,
          priceSnap: 0.86, revenue: gen * 0.7 * 0.86, note: null, source: 'simulated',
        })
      }
    }
  }
  return out
}

interface MountOpt extends FxOpt {
  gran?: 'month' | 'year'
  month?: number
  /** 「今天」。**月中未录全全靠它** —— 屏不传 today,logic 取系统当天,所以这里假 Date */
  today?: string
  readings?: PvReadingDTO[]
  /** 去年的抄表:年档 B4 slopegraph 要两端都有数才画得出线段 */
  prev?: boolean
}

async function mountScreen(o: MountOpt = {}) {
  // 只假 Date,不假 setTimeout —— flushPromises 靠真 setTimeout 排空微任务
  vi.useFakeTimers({ toFake: ['Date'] })
  const [ty, tm, td] = (o.today ?? '2026-09-02').split('-').map(Number)
  vi.setSystemTime(new Date(ty, tm - 1, td, 12, 0, 0))

  const rds = o.readings ?? readingsOf(2026, o)
  const prev = o.prev ? readingsOf(2025, { crash: false }) : []
  vi.mocked(pvMeterApi.stations).mockResolvedValue(stationsFx)
  vi.mocked(pvMeterApi.readingsYear).mockImplementation(async (y: number) =>
    (y === 2026 ? rds : y === 2025 ? prev : []))
  vi.mocked(paramsApi.list).mockResolvedValue([])          // 取不到参数 → 回落默认线
  // 对比开关默认「无」,不打去年的接口 —— B4 要两端都有数才画得出线段
  if (o.prev) useCompare(['yoy']).set('yoy')

  const w = mount(PvMeterAnaView, { global: { stubs: { RouterLink: true, teleport: true } } })
  await flushPromises()
  providePeriodMonths(['2026-07', '2026-08'], ['2026-08'])
  usePeriod().setYear(2026)
  // **每条测试都显式设一次粒度与月份。** usePeriod 是模块级单例,sel 不随 pinia 重建而复位 ——
  // 上一条测试切到「按年」之后,后面所有测试都会在年段跑,而且报的是别的断言在红。
  usePeriod().setGran(o.gran ?? 'month')
  usePeriod().setMonth(o.month ?? 8)
  await flushPromises()
  return w
}

/** 切段控档。屏默认停在「账面量」,绝对水平那三块要切过去才渲染 */
async function toSection(w: VueWrapper, label: string) {
  const tab = w.findAll('[role="tab"]').find(b => b.text() === label)
  expect(tab, `分段「${label}」不在`).toBeTruthy()
  await tab!.trigger('click')
  await flushPromises()
}

/** 开抽屉:卡头那条「看 X 的整年趋势 →」 */
async function openDrawer(w: VueWrapper) {
  const lk = w.findAll('.pma-main .pma-lk').find(b => b.text().startsWith('看 '))
  expect(lk, '卡头没有开抽屉的入口').toBeTruthy()
  await lk!.trigger('click')
  await flushPromises()
}

/** 屏自己的文字(不含 AnaShell 外壳:期间条 / 对比开关那些不是这屏写的) */
const bodyText = (w: VueWrapper) =>
  w.findAll('.av2-grid, .fp-dwr').map(e => e.text()).join('\n')

/** 传进每张 ECharts 的那份 option 的原文 —— 颜色查在这里,不在渲染出来的文字里 */
const optJson = (w: VueWrapper, sel = '') =>
  w.findAll(`${sel} .stub-chart`).map(c => c.attributes('data-opt') ?? '').join('\n')

/** B3(「绝对水平」档那张 av2-s8 等效小时轨迹)传进去的 option 原文 */
const b3Json = (w: VueWrapper) =>
  w.find('.pma-sec .av2-s8 .stub-chart').attributes('data-opt') ?? ''
type B3Series = { name?: string; lineStyle?: { color?: string } }
const b3Series = (w: VueWrapper): B3Series[] =>
  (JSON.parse(b3Json(w) || '{}') as { series?: B3Series[] }).series ?? []
/** B3 里画成焦点色的那些序列的名字。跟着队列走的话它只有一个,而且会换名字 */
const b3FocusNames = (w: VueWrapper) =>
  b3Series(w).filter(s => s.lineStyle?.color === PV_COLORS.FOCUS).map(s => s.name)

const boot = () => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  __resetCompareForTest()
  location.hash = ''
}

afterEach(() => { vi.useRealTimers() })

describe('光伏分栋分析 · 两档缩放', () => {
  beforeEach(boot)

  it('月段:大图横轴是当月那三十来天 —— 画满整段,不是全年逐日', async () => {
    const w = await mountScreen()
    expect(w.find('.pma-main .av2-card-h .t').text()).toBe('2026 年 8 月逐日比值')
    // x 轴标首 / 中 / 末与 5 的倍数,**画满整段不伸缩**(§03.8)
    const xs = w.findAll('.pdc .xt').map(t => t.text())
    expect(xs[0]).toBe('1')
    expect(xs[xs.length - 1]).toBe('31')
    // v3 的页脚**只留基线窗口**。x 轴口径 / 判据 / 抄表进度屏上别处已经有了,
    // 页脚再复述一遍就是把 120 字的墙糊回图下面(用户 2026-09-02 当场否掉的那版)。
    // 「画满整段」的意图由上面那两行刻度断言承担,比匹配一句散文硬。
    const ft = w.find('.pdc-ft').text()
    expect(ft).toContain('基线')
    for (const dup of ['横轴', '画满不伸缩', '已抄', '琥珀底', '连续']) {
      expect(ft, `页脚复述了屏上别处已有的「${dup}」`).not.toContain(dup)
    }
  })

  it('年段:刻度换成逐月,「连续 N 个刻度算一段」那条判据划掉', async () => {
    const w = await mountScreen({ gran: 'year', prev: true })
    expect(w.find('.pma-main .av2-card-h .t').text()).toBe('2026 年逐月比值')
    expect(w.find('.pdc-ft .vl').text()).toContain('个月')   // 年档单位跟着换
    const off = w.findAll('.pma-b2 .off')
    expect(off).toHaveLength(1)
    expect(off[0].text()).toContain('年档不出此判据')
  })

  it('年段:B4 slopegraph 替掉 B3 轨迹,13 栋同一条灰,没有一栋有自己的颜色', async () => {
    const w = await mountScreen({ gran: 'year', prev: true })
    await toSection(w, '绝对水平')
    expect(w.find('.pv-slope').exists()).toBe(true)
    expect(w.findAll('.pv-slope line.seg')).toHaveLength(N)
    // 线段没有一条带 stroke 字面值 —— 颜色全走 CSS 令牌,13 栋同色
    expect(w.findAll('.pv-slope line.seg').every(l => !l.attributes('stroke'))).toBe(true)
  })

  it('范围是拿**段外**那一段估的,窗口写在屏上(§03.7)—— 别让人以为切月就只用一个月的数据', async () => {
    const w = await mountScreen()
    // 顺便验未命中的栋页脚也照常渲染 —— 队列里点谁都得有基线
    const ok = w.findAll('.pq-row').find(r => !r.classes('out'))
    expect(ok, '队列里没有未命中的栋').toBeTruthy()
    await ok!.trigger('click')
    await flushPromises()
    const ft = w.find('.pdc-ft')
    // 钉**结构**不钉措辞:标签 / 值(首 ~ 末 · 条数)分开渲染,措辞再改也管用,
    // 而窗口一旦缩成当段之内、或条数变成 0,下面两条必红
    expect(ft.find('.lb').text()).toBe('基线')
    const m = ft.find('.vl').text().match(/^(\d{4}-\d{2}-\d{2}) ~ ((?:\d{4}-)?\d{2}-\d{2}) · (\d+) 天$/)
    expect(m, `页脚的基线值不是「首 ~ 末 · N 天」: ${ft.find('.vl').text()}`).not.toBeNull()
    // 窗口塌成「只有当段」时这条会红
    expect(Number(m![3]), '基线只取到当段之内就等于没有段外基线').toBeGreaterThan(31)
    // ⚠ 「不含被看的那一段」**在这里断不了**:窗口是整年减当月,不连续,
    //   首(01-01)/末(12-31)/条数都看不出中间挖没挖掉 8 月。
    //   那条性质由 logic 层守着(pvMeterAnaSnapshot.logic.spec.ts
    //   「月段的带取自**段外**,不含被看的那段」)—— 破坏 excludeSeg 时红的是那两条,不是这条。
    // 「淡带 = 正常范围」不再用散文复述,改成画在带里的标签
    expect(w.find('.bandlab').text()).toContain('正常范围（2 倍波动）')
  })

  it('大图画出正常范围带、中心线,出范围的点单独放大上色', async () => {
    const w = await mountScreen()
    expect(w.find('.pdc .band').exists()).toBe(true)
    expect(w.find('.pdc .ctr').exists()).toBe(true)
    const big = w.findAll('.pdc circle').filter(c => c.attributes('fill') === PV_COLORS.OUT)
    expect(big.length).toBeGreaterThan(0)
    expect(big.every(c => c.attributes('r') === '3.4')).toBe(true)
    // 连续段的琥珀底也在(S4 八月整月在范围下方)
    expect(w.findAll(`.pdc rect[fill="${PV_COLORS.OUT}"]`).length).toBeGreaterThan(0)
  })

  it('ECharts 分在两个段控档,主卡(L1)里一张都不放', async () => {
    const w = await mountScreen()
    expect(w.findAll('.pma-main .stub-chart')).toHaveLength(0)
    expect(w.findAll('.stub-chart')).toHaveLength(2)          // 默认档 = 账面量:B7 + B8
    await toSection(w, '绝对水平')
    expect(w.findAll('.stub-chart')).toHaveLength(2)          // B3 + B6
    expect(w.find('.pma-scroll').exists()).toBe(true)         // B5 是内联 SVG bullet,不进 ECharts
  })
})

describe('光伏分栋分析 · 信息结构(队列 + 一张大图)', () => {
  beforeEach(boot)

  // 用户否掉的就是「打开先撞 13 行等权曲线」。v3 换成左队列(纯文字数字)+ 右边**一张**大图
  it('首屏是队列 + 一张大图,不是每栋一行铺满', async () => {
    const w = await mountScreen()
    expect(w.findAll('.pdc svg')).toHaveLength(1)
    const hit = w.findAll('.pq-row.out')
    expect(hit).toHaveLength(1)                                // 夹具里只有 S4 有断崖
    expect(hit[0].find('.nm').text()).toBe('S4')
    expect(w.find('.pdc-hd .nm').text()).toBe('S4')            // 默认停在队列第一行
    // ②「未低于你设的线」默认折叠 —— 组名与计数常驻,收的只是行(§06.3)
    const gh = w.findAll('.pq-gh').map(g => g.text())
    expect(gh.some(t => t.startsWith('▸未低于你设的线'))).toBe(true)
    expect(w.find('.pq-body.cap-rest').attributes('style')).toContain('display: none')
  })

  it('B0 主数 = 队列「出范围段」组的行数 —— 一个屏一个门槛', async () => {
    const w = await mountScreen()
    expect(Number(w.find('.pma-b0 .big').text())).toBe(w.findAll('.pq-row.out').length)
  })

  // 行上印的两个数**必须能解释分组**(§06.3「排序键就印在行右边那一列,顺序可复算、可反对」)。
  // 原来印的是「天」与「最大偏离」,两个都不是分组依据 —— 实屏上出现过
  // 11栋 14 天 +131.8% 进组、10栋 8 天 **+170.9%** 没进,用户没法从行上复算。
  // 现在印「天」与「段」:段决定进哪一组,天决定组内先后。
  it('行上的两个数解释分组:命中行有段、未命中行段列留空', async () => {
    const w = await mountScreen()
    await w.findAll('.pq-gh').find(g => g.text().includes('未低于'))!.trigger('click')
    await flushPromises()

    const cols = (r: ReturnType<typeof w.find>) => r.findAll('.n').map(s => s.text())
    for (const r of w.findAll('.pq-row.out')) {
      const [days, seg] = cols(r)
      expect(Number(days), '命中行的出范围刻度数应 > 0').toBeGreaterThan(0)
      expect(seg, `命中行的段列是空的,分组依据没印在行上: ${r.text()}`).toMatch(/^\d+ 段$/)
      expect(r.find('.ar2').text(), '命中行必须有方向标').toMatch(/^[▲▼]$/)
    }
    // 未命中 = 没成段。段列留空,方向标也不出现 ——
    // 一栋 0 天出范围却挂着 ▲,方向标记没有指涉物,还会看起来像命中
    for (const r of w.findAll('.pq-body .pq-row:not(.out)')) {
      expect(cols(r)[1], `未命中行不该有段: ${r.text()}`).toBe('')
      expect(r.find('.ar2').text(), `未命中行不该有方向标: ${r.text()}`).toBe('')
    }
    expect(w.find('.pq-hd').text()).toContain('段')
  })

  it('点任意一栋都能换图,包括「未低于线」的那些 —— 判据线决定谁进命中组,不决定谁能被看', async () => {
    const w = await mountScreen()
    await w.find('.pq-gh:nth-of-type(1)').trigger('click')     // 展开「未低于你设的线」
    const rows = w.findAll('.pq-body.cap-rest .pq-row')
    expect(rows.length).toBeGreaterThan(0)
    const name = rows[0].find('.nm').text()
    expect(name).not.toBe('S4')
    await rows[0].trigger('click')
    expect(w.find('.pdc-hd .nm').text()).toBe(name)
  })

  it('大图卡头那条链接开单栋抽屉,三张图固定按年', async () => {
    const w = await mountScreen()
    expect(bodyText(w)).not.toContain('逐日偏离与两道范围线')
    await openDrawer(w)
    const t = bodyText(w)
    expect(t).toContain('这一年的偏离与水平变化')
    expect(t).toContain('逐日偏离与两道范围线')
    expect(t).toContain('跟全园一起涨落的程度')
    expect(t).toContain('与上面选的期间无关')
  })
})

describe('光伏分栋分析 · 事实句与判据脚', () => {
  beforeEach(boot)

  it('种入的断崖被说成「连续 N 天在正常范围下方」,三段式,没有判词', async () => {
    const w = await mountScreen()
    expect(w.find('.pdc-hd .fact').text()).toMatch(/起连续 \d+ 天在正常范围下方/)
  })

  it('判据脚六条当前值原文回显 + 去改的深链', async () => {
    const w = await mountScreen()
    expect(w.findAll('.pma-b2 span')).toHaveLength(6)
    const t = w.find('.pma-b2').text()
    expect(t).toContain('正常范围半宽 2 倍波动')
    expect(t).toContain('连续 3 个刻度算一段')
    expect(t).toContain('抄表覆盖 ≥90%')
    expect(t).toContain('台账差 ±3%')
    expect(t).toContain('年锚点 950 小时')
    expect(t).toContain('年等效小时 ≥ 锚点 85%')
    expect(w.find('.pma-b2 .pma-lk').text()).toBe('去改')
  })

  it('底部固定写着「未列出 ≠ 没问题」', async () => {
    expect((await mountScreen()).find('.pma-foot').text()).toContain('未列出 ≠ 没问题')
  })

  it('参数取不到时回落默认线,屏照常出 —— 不显空也不整屏挂掉', async () => {
    vi.mocked(paramsApi.list).mockRejectedValue(new Error('boom'))
    const w = await mountScreen()
    expect(w.find('.pma-b2').text()).toContain('正常范围半宽 2 倍波动')
    expect(w.find('.pq-row.out').exists()).toBe(true)
  })
})

describe('光伏分栋分析 · 月中未录全(§03.8 / §08 v3 1·2·3·4)', () => {
  beforeEach(boot)

  // 月中夹具:数据到 8/15、8/07 全园漏抄、今天 8/15 → 已过去 15、已抄 14、未到 16
  const MID: MountOpt = { through: '2026-08-15', skip: ['2026-08-07'], today: '2026-08-15' }

  it('队列列头的 N = **已过去**刻度数:整段录全「天/31」,月中「天/15」', async () => {
    expect((await mountScreen()).find('.pq-hd .n').text()).toBe('天/31')
    boot()
    expect((await mountScreen(MID)).find('.pq-hd .n').text()).toBe('天/15')
  })

  it('月中:折线断成两段,恰好 1 个缺口记号与 1 个「未到」标注', async () => {
    const w = await mountScreen(MID)
    expect(w.findAll('.pdc polyline.ln')).toHaveLength(2)      // 8/07 漏抄处不插值
    expect(w.findAll('.pdc .gapl')).toHaveLength(1)            // 缺口记号「漏」
    expect(w.findAll('.pdc .futlab')).toHaveLength(1)          // 未到标注
    expect(w.find('.pdc .futlab').text()).toBe('未到（16 日起）')
    expect(w.find('.pdc .fut').exists()).toBe(true)            // 未到淡底
  })

  it('月中:未到那一段一个数据图元都没有 —— 不画点、不连线、绝不补 0', async () => {
    const w = await mountScreen(MID)
    const cut = Number(w.find('.pdc .futline').attributes('x1'))
    expect(cut).toBeGreaterThan(0)
    const cx = w.findAll('.pdc circle').map(c => Number(c.attributes('cx')))
    expect(cx).toHaveLength(14)                                // 已抄 14 天,一个不多
    expect(cx.every(x => x < cut)).toBe(true)
    const px = w.findAll('.pdc polyline.ln')
      .flatMap(p => (p.attributes('points') ?? '').split(' ').map(s => Number(s.split(',')[0])))
    expect(px.every(x => x < cut)).toBe(true)
  })

  it('整段录全时没有「未到」那一套 —— 三态是三种形状,不是同一种灰', async () => {
    const w = await mountScreen()
    expect(w.findAll('.pdc .futlab')).toHaveLength(0)
    expect(w.findAll('.pdc .futline')).toHaveLength(0)
    expect(w.findAll('.pdc .gapl')).toHaveLength(0)
  })

  // §08 v3-3:分母写成整段的话是 14/31 = 45%,13 栋全掉进「读不出」,屏上什么都不剩
  it('月中:覆盖率 = 已抄 ÷ **已过去**,93% ≥ 90% → 没有一栋掉进「读不出」', async () => {
    const w = await mountScreen(MID)
    const fresh = w.find('.pma-b0 .fresh').text()
    expect(fresh).toContain('本段已过去 15/31 天')
    expect(fresh).toContain(`已抄 ${14 * N}/${15 * N}`)
    expect(fresh).toContain('覆盖 93%（按已过去算）')
    expect(w.findAll('.pma-b0 .mid')[0].text()).toBe('0')      // 读不出 0 栋
    expect(w.findAll('.pq-gh').some(g => g.text().includes('读不出'))).toBe(false)
  })

  it('段末端 == 数据截止日 → 事实句带「（仍在持续）」', async () => {
    const w = await mountScreen(MID)
    expect(w.find('.pdc-hd .fact').text()).toContain('（仍在持续）')
  })

  it('回看已经过去的月 → 同一条断崖不带「（仍在持续）」,闭区间不暗示它还在走', async () => {
    const w = await mountScreen({ month: 7 })                  // 数据到 12/31,7 月早就结束了
    const fact = w.find('.pdc-hd .fact').text()
    expect(fact).toMatch(/起连续 \d+ 天在正常范围下方$/)
    expect(fact).not.toContain('仍在持续')
  })

  it('抽屉明细表:未到的行不出现,漏抄的行出现但值为空 + 标记', async () => {
    const w = await mountScreen(MID)
    await openDrawer(w)
    const rows = w.findAll('.pma-tb tbody tr')
    expect(rows).toHaveLength(15)                              // 已过去 15,未到那 16 天不出现
    const miss = rows.filter(r => r.classes('miss'))
    expect(miss).toHaveLength(1)
    expect(miss[0].findAll('td')[1].text()).toBe('')           // 比值为空
    expect(miss[0].findAll('td')[4].text()).toBe('漏抄')
  })
})

describe('光伏分栋分析 · 0 命中(§08 v3-9)', () => {
  beforeEach(boot)

  it('主数转灰,B0 五格与两行新鲜度照常 —— 高度恒 76px 不塌', async () => {
    const hitW = await mountScreen()
    const shape = (w: VueWrapper) => ({
      k: w.findAll('.pma-b0 .k').length,
      fresh: w.findAll('.pma-b0 .fresh > div').length,
      big: w.findAll('.pma-b0 .big').length,
    })
    const full = shape(hitW)
    boot()
    const w = await mountScreen({ crash: false })
    expect(w.find('.pma-b0').classes()).toContain('quiet')     // 主数与左竖条转灰
    expect(w.find('.pma-b0 .big').text()).toBe('0')
    // 「不塌」= 节点一个不少:四格 + 右侧两行新鲜度全在,没有 v-if 把内容抽掉。
    // 高度本身钉在 .pma-b0 的样式里(height:76px),jsdom 不跑布局,查不了计算高度
    expect(shape(w)).toEqual(full)
    expect(w.find('.pma-b0 .fresh').text()).toContain('数据到 2026-12-31')
  })

  it('「出范围段」整组不渲染 —— 不是渲染一个 0 行的空标题', async () => {
    const w = await mountScreen({ crash: false })
    expect(w.findAll('.pq-gh').some(g => g.text().includes('出范围段'))).toBe(false)
    expect(w.find('.pq-body.cap-hit').exists()).toBe(false)
    expect(w.findAll('.pq-row.out')).toHaveLength(0)
    // 零故障园区上照样有栋可看:队列 ② 组常驻,大图停在第一行
    expect(w.findAll('.pq-gh').some(g => g.text().includes('未低于你设的线'))).toBe(true)
    expect(w.find('.pdc svg').exists()).toBe(true)
  })
})

describe('光伏分栋分析 · 排他规则与首屏预算(§06.0 / §06.1 / §08 v3 7·10)', () => {
  beforeEach(boot)

  it('height=440 整屏零次,只用 170 / 200 / 250 / 300', async () => {
    const w = await mountScreen()
    const hs: string[] = []
    const grab = () => w.findAll('.stub-chart').forEach(c => hs.push(c.attributes('data-h') ?? ''))
    grab()
    await toSection(w, '绝对水平')
    grab()
    await openDrawer(w)
    grab()
    expect(hs.length).toBeGreaterThan(4)
    expect(hs).not.toContain('440')
    expect([...new Set(hs)].sort()).toEqual(['170', '200', '250', '300'])
  })

  it('强调色 #9D5D17 双向钉死:L0/L1 三个岗位都在,L2 的段与 L3 的抽屉一次都不出现', async () => {
    const w = await mountScreen()

    // ── 正面:L0/L1 里它**必须在**。只留反面那半是单向的 ——
    //    把首屏的橙整个删干净(主数转墨、队列行转墨、大图的点转墨)也照样全绿。
    // L0 与队列的橙走 CSS 令牌(var(--hue-orange) 在 scoped style 里,jsdom 拿不到计算样式),
    // 所以查**承载它的那两个开关**:主数不是 quiet(quiet 把竖条与主数一起改成墨)、命中行有 .out。
    expect(w.find('.pma-b0').classes(), 'L0 主数是 quiet 态 —— 告警色在指标卡上没上岗')
      .not.toContain('quiet')
    expect(w.findAll('.pq-row.out .n').length, 'L1 队列没有命中行的橙数字列')
      .toBeGreaterThan(0)
    // L1 大图的橙是**内联字面值**(出范围点的 fill / 连续段底色),原文查得到
    expect(w.find('.pma-main').html().toUpperCase(), 'L1 大图里没有出范围色')
      .toContain('9D5D17')

    // ── 反面:L2/L3 里一个都没有。
    // 颜色写在 option 的 JSON 里,不在渲染出来的文字里 —— 先确认真抓到了 option,
    // 抓不到的话下面那句 not.toContain 就是空跑(这类假绿是这组断言唯一的翻车方式)
    const clean = (sel: string, where: string) => {
      const opt = optJson(w, sel)
      expect(opt.length, `${where} 一份 option 都没抓到`).toBeGreaterThan(100)
      expect((w.find(sel).html() + opt).toUpperCase(), `${where} 出现了强调色`).not.toContain('9D5D17')
    }
    clean('.pma-sec', 'L2 账面量')
    await toSection(w, '绝对水平')
    clean('.pma-sec', 'L2 绝对水平')
    await openDrawer(w)
    clean('.fp-dwr', 'L3 抽屉')
  })

  // jsdom 不跑样式,量不到字号;能守的是**承载 26px 的那个类只出现一次**
  // —— 字号本身钉在 .pma-b0 .big 的样式里(font-size:26px)
  it('26px 主数全屏唯一', async () => {
    const w = await mountScreen()
    await toSection(w, '绝对水平')
    await openDrawer(w)
    expect(w.findAll('.big')).toHaveLength(1)
  })

  // §06.1 的 463px 硬预算:16(padding)+ 76(B0)+ 8 + 主卡 + 8 + 32(段控)= 140 + 主卡。
  // jsdom 不跑布局,量不了真高度;能机械守住的是**首屏只有这三块**(不许再挤进第四块),
  // 以及主卡里那张大图的高度是钉死的 206,不随刻度数或命中数长。
  it('首屏硬内容只有 B0 / 主卡 / 段控三块,大图高度恒 206', async () => {
    const w = await mountScreen()
    const top = w.find('.av2-grid').element.children
    expect([...top].slice(0, 3).map(e => e.className.split(' ').slice(-1)[0]))
      .toEqual(['pma-b0', 'pma-main', 'pma-seg'])
    expect(w.find('.pdc svg').attributes('height')).toBe('206')
    boot()
    const mid = await mountScreen({ through: '2026-08-15', skip: ['2026-08-07'], today: '2026-08-15' })
    expect(mid.find('.pdc svg').attributes('height')).toBe('206')
    // 命中多于 4 栋时队列内滚,主卡不跟着长(§06.1)
    expect(w.find('.pq-body.cap-hit').exists()).toBe(true)
  })
})

describe('光伏分栋分析 · 配色(§06.7 焦点 / 类别 / 告警)', () => {
  beforeEach(boot)

  // 焦点色是「**当前选中**」这一个状态,不是发给某一栋的私有颜色。
  // 「屏上有一条蓝线」证不了这件事 —— 给 S4 硬编码一支蓝也能过。所以要点另一栋,
  // 看那条蓝线**换成了新选中那栋的名字**;不跟着走的话下面最后一条红。
  it('焦点蓝跟着队列的选择走 —— B3 那条深线换的是名字,不是钉给某一栋', async () => {
    const w = await mountScreen()
    await toSection(w, '绝对水平')
    expect(b3Json(w).length, 'B3 的 option 没抓到,这条会空跑').toBeGreaterThan(100)
    expect(w.find('.pdc-hd .nm').text()).toBe('S4')           // 默认停在队列第一行
    expect(b3FocusNames(w), '选中那栋没有画成焦点色').toEqual(['S4'])

    // 换一栋:展开「未低于你设的线」,点第一行
    await w.findAll('.pq-gh').find(g => g.text().includes('未低于'))!.trigger('click')
    await flushPromises()
    const row = w.findAll('.pq-body.cap-rest .pq-row')[0]
    const name = row.find('.nm').text()
    expect(name).not.toBe('S4')
    await row.trigger('click')
    await flushPromises()

    expect(w.find('.pdc-hd .nm').text()).toBe(name)
    expect(b3FocusNames(w), '焦点色没跟着队列的选择走').toEqual([name])
  })

  it('B3 带颜色的只有分位带 / 全园中位 / 选中那栋 —— 13 栋没有一栋有自己的颜色', async () => {
    const w = await mountScreen()
    await toSection(w, '绝对水平')
    const opt = b3Json(w)
    expect(opt.length, 'B3 的 option 没抓到,下面两条会空跑').toBeGreaterThan(100)
    // option 原文里的颜色恰好三处,顺序也钉住:带(墨 100)· 全园中位(墨 500)· 选中那栋(焦点蓝)。
    // 多出任何一处 —— 比如有人给某一栋发了私有色、或把分位带也上了色 —— 这条就红
    expect([...opt.matchAll(/"color":"([^"]+)"/g)].map(m => m[1]))
      .toEqual([PV_COLORS.INK100, PV_COLORS.INK500, PV_COLORS.FOCUS])
    // 序列名同理:三条口径线 + 选中那栋。13 栋各画一条(那团灰毛球)长回来的话这条红
    expect(b3Series(w).map(s => s.name)).toEqual(['p25', '各栋四分位距', '全园中位', 'S4'])
  })
})

describe('光伏分栋分析 · 文案规范(§05)', () => {
  beforeEach(boot)

  // 屏只说明可视化在做什么。判词、建议动作、反事实金额、p/q 一个都不许露 ——
  // 钉在渲染后的 DOM 上:文案是在模板里拼的,logic 干净不等于屏上干净。
  // **三档全扫**:图挪进段控之后,只看首屏等于漏掉三分之二的文案。
  const BAD = ['异常', '需关注', '严重', '健康', '良好', '疑似', '建议', '应发',
    '缺口', '损失', '比应得少', '现场检查', '可安排清洗', '误报', 'q<', 'p 值']

  const scan = (t: string, where: string) => {
    for (const b of BAD) expect(t, `${where} 出现了「${b}」`).not.toContain(b)
    // 「正常范围」是 §05 给 ±2σ 指定的替换名,不是判词;除它之外「正常」一个字都不许有
    expect(t.split('正常范围').join(''), `${where} 出现了判词「正常」`).not.toContain('正常')
  }

  it('三档 + 抽屉里都没有判词、建议、反事实金额与统计量', async () => {
    const w = await mountScreen()
    scan(bodyText(w), '默认档（账面量）')
    await toSection(w, '绝对水平')
    scan(bodyText(w), '绝对水平')
    await toSection(w, '账面量')
    scan(bodyText(w), '账面量')
    await openDrawer(w)
    scan(bodyText(w), 'L3 抽屉')
  })

  it('说明写的是「这张图在画什么」:轴、单位、范围是拿哪一段估的', async () => {
    const w = await mountScreen()
    expect(w.find('.pma-main .hint').text()).toContain('÷ 全园同刻度中位')
    expect(bodyText(w)).toContain('副轴固定 0–6%')
    await toSection(w, '绝对水平')
    const t = bodyText(w)
    expect(t).toContain('纵轴 = 发电 ÷ 装机')
    expect(t).toContain('13 栋同色，没有任何一栋有自己的颜色')
    // B5 换成点图之后横轴**不从 0 起**(点是位置编码,不需要零基线;这些值天然聚在
    // 一条窄带里,从 0 起会把 13 栋画成一样长)。非零基线必须在屏上交代清楚 ——
    // 这是它成立的条件,少了这句就是一张会骗人的图
    expect(t, 'B5 横轴不从 0 起,屏上必须写明').toContain('不从 0 起')
    expect(t).toContain('点用位置编码')
    // B3 画的是分布不是每一栋,口径也要写明
    expect(t).toContain('画的是分布不是每一栋')
  })

  it('全屏禁用「环比」:外壳的对比开关上它是禁用态,不是可点的选项', async () => {
    const w = await mountScreen()
    const mom = w.findAll('.anx-seg button').find(b => b.text() === '环比')
    expect(mom, '对比开关不在').toBeTruthy()
    expect(mom!.attributes('disabled')).toBeDefined()
  })
})

describe('光伏分栋分析 · 护栏', () => {
  beforeEach(boot)

  it('整年无抄表 → 空态深链,不画队列也不画图', async () => {
    const w = await mountScreen({ readings: [] })
    expect(w.text()).toContain('2026 年暂无分栋抄表记录')
    expect(w.findAll('.pq-row')).toHaveLength(0)
    expect(w.findAll('.pdc')).toHaveLength(0)
    expect(w.findAll('.stub-chart')).toHaveLength(0)
  })

  it('页脚给出 snapshot id 与整年有效日数', async () => {
    const w = await mountScreen()
    expect(w.find('.pma-foot code').text()).toMatch(/^[0-9a-f]{8}$/)
    expect(w.find('.pma-foot').text()).toMatch(/整年有效日 \d+ \/ \d+ 天/)
    // 同一个 id 也印在 B0 右侧,页脚与指标卡对得上账
    expect(w.find('.pma-b0 .fresh code').text()).toBe(w.find('.pma-foot code').text())
  })

  it('新鲜度那两行不能删:没有它,「0 栋触线」与「数据没更新」长得一模一样', async () => {
    const w = await mountScreen()
    const fresh = w.find('.pma-b0 .fresh').text()
    expect(fresh).toContain('数据到 2026-12-31')
    expect(fresh).toContain('本段已过去 31/31 天')
    expect(fresh).toMatch(/已抄 \d+\/\d+ · 覆盖 \d+%（按已过去算）/)
  })
})

describe('光伏分栋分析 · 高级分析档(2026-08 被砍掉的工作台,恢复在段控第三格)', () => {
  beforeEach(boot)

  it('第三档在段控里,但默认**不**选中 —— 默认仍停在「账面量」,七块一块都不算', async () => {
    const w = await mountScreen()
    const tabs = w.findAll('.pma-seg [role="tab"]')
    expect(tabs.map(t => t.text())).toEqual(['绝对水平', '账面量', '高级分析'])
    // 默认档没动:恢复一个专业档不许顺手把默认落点挪走
    expect(tabs.find(t => t.text() === '账面量')!.attributes('aria-selected')).toBe('true')
    expect(tabs.find(t => t.text() === '高级分析')!.attributes('aria-selected')).toBe('false')
    expect(w.findAll('[data-lab]')).toHaveLength(0)
    // 懒算:停在默认档时这一档的量一次都不该算
    expect(vi.mocked(buildLab)).not.toHaveBeenCalled()
    // 段旁那句 11px 说的是「这一档在做什么、给谁看」,不下判断(§05)
    const hint = w.find('.pma-seghint').text()
    expect(hint).toContain('高级分析')
    for (const bad of ['异常', '建议', '需关注']) expect(hint).not.toContain(bad)
  })

  // 工作台里同时有两个期间(整年 / 观测窗口)。原来 L4/L7 的窗口写死「最后 30 天」,
  // 而数据截止在 12-31 —— **你看 8 月,它算 12 月**,屏上一个字都没说。
  // 这两条钉的是:① 窗口真的跟着期间选择器走 ② 每块都把自己吃的期间说出来
  // 挂两次 lab,buildLab 很重(13×buildDetail + 第二次抛光 + 两轮块自助),放宽超时
  it('观测窗口跟着期间走,不是写死的「最后 30 天」', { timeout: 30_000 }, async () => {
    const w8 = await mountScreen({ month: 8 })
    await toSection(w8, '高级分析')
    // 只看 L4/L7 的**观测窗口**徽标。L6 现在也带 .win(它跟着显示段走),
    // 但它标的是段本身(「2026 年 8 月」)不是窗口键,格式不同,别混在一起断言
    const winOf = (w: VueWrapper) =>
      ['L4', 'L7'].flatMap(k => w.findAll(`[data-lab="${k}"] .pma-per.win`).map(e => e.text()))
    const win8 = winOf(w8)
    expect(win8.length, 'L4 与 L7 都该有窗口徽标').toBeGreaterThanOrEqual(2)
    for (const t of win8) expect(t, `窗口徽标没跟着 8 月: ${t}`).toContain('2026-08')

    // 夹具的 providePeriodMonths 只放了 2026-07 / 2026-08 两个可选月,
    // 换别的月会被外壳挡回去(不是实现问题) —— 所以这里换 7 月
    const w7 = await mountScreen({ month: 7 })
    await toSection(w7, '高级分析')
    const win7 = winOf(w7)
    expect(win7.length).toBeGreaterThanOrEqual(2)
    for (const t of win7) expect(t, `换到 7 月窗口没跟着换: ${t}`).toContain('2026-07')
  })

  it('七块各自写明吃的是哪个期间 —— 整年还是观测窗口', { timeout: 20_000 }, async () => {
    const w = await mountScreen()
    await toSection(w, '高级分析')
    // 每一块的卡头都要有期间徽标:少一个就是那一块在默默用别的期间
    for (const card of w.findAll('[data-lab]')) {
      const id = card.attributes('data-lab')
      expect(card.findAll('.pma-per').length, `${id} 没写明期间`).toBeGreaterThan(0)
    }
  })

  it('点进去才算,而且只算一次 —— 八块 L1…L7 一块不少,一块都没退成空态', async () => {
    const w = await mountScreen()
    await toSection(w, '高级分析')
    expect(vi.mocked(buildLab)).toHaveBeenCalledTimes(1)

    const labs = w.findAll('[data-lab]')
    expect(labs.map(e => e.attributes('data-lab')))
      .toEqual(['L1', 'L2', 'L3', 'L4', 'L5a', 'L5b', 'L6', 'L7'])
    // 八块的**块名**:恢复的是这八件事,不是八个占位卡
    expect(labs.map(e => e.find('.av2-card-h .t').text().split(' · ')[0])).toEqual([
      '先天水平 α 排序', '残差自相关 ACF', '各栋残差的年内走势',
      '块自助零分布', '抛光收敛轨迹', '换个扫描顺序，名次动不动', '数据质量矩阵', '完整检验表',
    ])
    // 每块的卡头都带常驻说明(图种 · 轴与单位 · 拿哪一段算 · 来源),不是光秃秃一个标题
    expect(labs.every(e => e.find('.av2-card-h .hint').text().length > 20)).toBe(true)
    // 健康夹具上八块都该出真内容:任何一块退成 .pma-note 就是这一档没真恢复
    expect(w.findAll('[data-lab] .pma-note')).toHaveLength(0)
    // 图/组件各就各位:L1-L4 + L5a 是 ECharts,L5b 是斜率图,L6 是手写 CSS Grid,L7 是表
    expect(w.findAll('[data-lab="L1"] .stub-chart')).toHaveLength(1)
    expect(w.findAll('[data-lab="L2"] .stub-chart')).toHaveLength(1)
    // L3 换成手写 SVG 小倍数(13 栋共轴 sparkline):ECharts 一张图画不了 13 个共轴小图,
    // 而 boxplot / custom 在 echartsBundle 里没注册。
    expect(w.findAll('[data-lab="L3"] .stub-chart')).toHaveLength(0)
    expect(w.find('[data-lab="L3"] .pv-season svg').exists()).toBe(true)
    expect(w.findAll('[data-lab="L4"] .stub-chart')).toHaveLength(1)
    // L5 原来是**全屏唯一一张没有图的卡**,占满 12 栏画一堆文字 —— 拆成两张 s6:
    // 左边一条收敛轨迹(log 轴折线),右边一张行优先/列优先的名次斜率图。
    expect(w.findAll('[data-lab="L5a"] .stub-chart')).toHaveLength(1)
    expect(w.find('[data-lab="L5a"] .pma-read').text()).toContain('结论')
    expect(w.find('[data-lab="L5b"] .pv-slope svg').exists()).toBe(true)
    expect(w.findAll('[data-lab="L5b"] .stub-chart')).toHaveLength(0)
    expect(w.find('[data-lab="L6"] .pqg-cells').exists()).toBe(true)
    expect(w.findAll('[data-lab="L6"] .stub-chart')).toHaveLength(0)  // heatmap 没注册,必须手写
    expect(w.find('[data-lab="L7"] table.plt tbody tr').exists()).toBe(true)
  })

  // ── §05 的作用域:双向 ────────────────────────────────────────────────
  // 「屏上不出现统计量」这条对 L0 / L1 / 绝对水平 / 账面量 继续成立;高级分析是**唯一**例外。
  // 只把禁词表放宽的话,这一档整个删掉测试照样全绿 —— 那就等于没恢复。所以两边都断:
  // 屏上真出现的那串字(不是 spec 里的写法)在这一档必须有,在另外四处必须没有。
  const STAT = ['σ', '置信', 'N_eff', 'zₙ', '块自助', 'BH-FDR']
  // §05 原文那几种写法,全屏(**含**高级分析)都不该照抄:这一档摆的是列头与口径,不是散文
  const SPEC_WORDING = ['p 值', 'q<', '置信区间']

  it('统计量只在高级分析档:L0 / L1 / 绝对水平 / 账面量 四处一个都没有', async () => {
    const w = await mountScreen()
    const none = (t: string, where: string) => {
      expect(t.length, `${where} 一个字都没抓到,这条是空跑`).toBeGreaterThan(20)
      for (const s of [...STAT, ...SPEC_WORDING]) {
        expect(t, `${where} 出现了统计量「${s}」`).not.toContain(s)
      }
    }
    none(w.find('.pma-b0').text(), 'L0 指标卡')
    none(w.find('.pma-main').text(), 'L1 主卡')
    none(w.find('.pma-sec').text(), '账面量档')   // 默认档
    await toSection(w, '绝对水平')
    none(w.find('.pma-sec').text(), '绝对水平档')
  })

  it('统计量在高级分析档**必须有** —— 少一个就是这一档没真恢复', async () => {
    const w = await mountScreen()
    await toSection(w, '高级分析')
    const t = w.find('.pma-sec').text()
    for (const s of STAT) expect(t, `高级分析档没有「${s}」`).toContain(s)
    // 它们不是散在别处:每一个都落在七块里面
    const inLab = w.findAll('[data-lab]').map(e => e.text()).join('\n')
    for (const s of STAT) expect(inLab, `「${s}」不在七块里`).toContain(s)
    // 但 §05 的原文写法照样不抄进来:摆列头和口径,不写「p 值」这种散文
    for (const s of SPEC_WORDING) expect(t, `高级分析档照抄了 §05 的写法「${s}」`).not.toContain(s)
    // 反面钉死:切回去统计量就该消失(证明上一条测的是作用域,不是「屏上某处有 σ」)
    await toSection(w, '账面量')
    expect(w.find('.pma-sec').text()).not.toContain('σ')
  })

  // 质量矩阵**跟着期间走**:它是记账不是估计,一格就是一天,不需要样本量 ——
  // 365 列 @2px 读不出哪格是哪天,31 列才谈得上「回答剔了哪些天」
  it('质量矩阵跟着期间走 —— 月档只画当月那三十来列,不是铺满整年', async () => {
    const w = await mountScreen({ month: 8 })
    await toSection(w, '高级分析')
    const rows = w.findAll('[data-lab="L6"] .pqg-cells .c').length
    const lines = w.findAll('[data-lab="L6"] .pqg-cells').length || 1
    // 8 月 31 天 × 在网栋数;铺满整年的话列数是 365,格子数会是十倍以上
    const perRow = rows / Math.max(1, w.findAll('[data-lab="L6"] .nm').length)
    expect(perRow, `一行不是 31 格(月档没跟上,或者还在铺整年): ${perRow}`).toBe(31)
    expect(lines).toBeGreaterThan(0)
  }, 20_000)

  it('质量矩阵四态四色 —— 缺抄与未投产必须分得开,不是两片一样的浅灰', async () => {
    // 3/05 全园一天都没抄(= 缺抄);6/10 只剩两栋在网,不足 3 栋 → 那一天整日剔除;
    // S9 到 3/01 才有第一条抄表 → 它前面整整两个月是未投产。
    // 四件事在夹具里就分开,不然「合并成一个没数据」这个 bug 测不出来 ——
    // 尤其缺抄 vs 未投产:前者**可行动**(该去补录),后者**不可行动**(那时候还没建)。
    const rds = readingsOf(2026, { skip: ['2026-03-05'] })
      .filter(r => !(r.readDate === '2026-06-10' && r.stationId > 2))
      .filter(r => !(r.stationId === N && r.readDate < '2026-03-01'))
    // **年档**看:三月的漏抄、S9 一二月的未投产都在整年这条轴上。
    // 月档只画当月(2026-09-02 起),这里要的是四态齐全,所以走年档。
    const w = await mountScreen({ readings: rds, gran: 'year' })
    await toSection(w, '高级分析')

    const cells = w.findAll('[data-lab="L6"] .pqg-cells .c')
    const n = (k: string) => cells.filter(c => c.classes(k)).length
    expect(n('ok'), '正常格').toBeGreaterThan(0)
    expect(n('miss'), '缺抄格 —— 3/05 全园漏抄那一列').toBe(N)
    expect(n('dropped'), '整日剔除格 —— 6/10 在网不足 3 栋').toBe(N)
    expect(n('pre'), '未投产格 —— S9 三月才投产,前面 1 月 + 2 月').toBe(31 + 28)
    // 四态互斥且铺满。把未投产退回「碰巧没有类」(旧写法)时 n('pre') 归零,这条红
    expect(n('ok') + n('miss') + n('dropped') + n('pre')).toBe(cells.length)
    // **缺抄 ≠ 未投产**,这是这次改动的核心。jsdom 不跑 scoped style,量不到计算出来的颜色;
    // 能钉的是承载颜色的那个通道:两者落在**不同的类**上(.c.miss 暖黄 / .c.pre 无填充),
    // 而且没有一格同时挂着两个类
    expect(cells.some(c => c.classes('miss') && c.classes('pre')),
      '缺抄与未投产挂在同一格上,两态被合并了').toBe(false)
    // 颜色之外还得有第二个通道:格子只有 2-6px 宽,剩下的只有 title 和图例
    const titleOf = (k: string) => cells.find(c => c.classes(k))!.attributes('title') ?? ''
    expect(titleOf('miss')).toContain('缺抄')
    expect(titleOf('pre')).toContain('未投产')
    // 图例四条常驻,不是 hover 才出:审计得看得见这四个各是什么
    const lg = w.find('[data-lab="L6"] .pqg-legend')
    for (const s of ['缺抄', '整日剔除', '未投产', '从不补齐']) expect(lg.text()).toContain(s)
    // 四颗色块 = 四个不同的类。少一颗(或两颗共用一个类)就是四态又挤回三档
    expect(lg.findAll('.sw').map(i => i.classes().filter(c => c !== 'sw').join('+')))
      .toEqual(['ok', 'miss', 'dropped', 'pre'])
    // 读屏拿不到颜色,四个数得报出来 —— 空白格尤其
    expect(w.find('[data-lab="L6"] .pqg-cells').attributes('aria-label'))
      .toContain(`${31 + 28} 格未投产`)
  }, 30_000)

  it('高级分析档守排他规则:#9D5D17 零次、height 只有 200/250、图种只有 bar/line/scatter', async () => {
    const w = await mountScreen()
    await toSection(w, '高级分析')
    const opt = optJson(w, '.pma-sec')
    expect(opt.length, '一份 option 都没抓到,下面几条会空跑').toBeGreaterThan(100)
    // 强调色按 §06.0 只在 L0-L1,这一档全走墨阶
    expect((w.find('.pma-sec').html() + opt).toUpperCase(), '高级分析档出现了强调色')
      .not.toContain('9D5D17')
    // AnaEChart 的 height 白名单里本档只用两档,440 一次都不用
    const hs = w.findAll('[data-lab] .stub-chart').map(c => c.attributes('data-h'))
    expect([...new Set(hs)].sort()).toEqual(['200', '250'])
    // echartsBundle 是裁剪打包的:heatmap / visualMap / custom / graph 没注册,
    // 用了得到空白图 + 一句控制台警告,而 jsdom 测不出来 —— 只能在 option 原文上拦
    // 白名单是穷举的:series 三种(bar/line/scatter)+ 轴三种(category/value/log)+ markLine 的虚线样式。
    // log 轴(L5a 收敛轨迹)由 GridComponent 覆盖,不用往 echartsBundle 加任何东西。
    // 多出任何一种(heatmap / custom / graph / pie …)这条就红。
    const types = [...opt.matchAll(/"type":"(\w+)"/g)].map(m => m[1])
    expect([...new Set(types)].sort())
      .toEqual(['bar', 'category', 'dashed', 'line', 'log', 'scatter', 'value'])
  }, 30_000)
})
