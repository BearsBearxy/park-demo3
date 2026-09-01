import { describe, expect, it } from 'vitest'
import { adviceOf, buildSnapshot, cpPhrase, type ReadingRow, type StationCfg, type WeatherDay } from './pvMeterAna.logic'

// 快照(PV-ANALYSIS-SPEC §06.4 铁律 + §07 护栏)。
// 这一层是「一份数据、一次计算」的落点,护栏也全在这里 —— 不测就是假绿。

const pad = (n: number) => String(n).padStart(2, '0')
const dateOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

interface Opts {
  year?: number            // 造上一年数据(同比护栏)用
  nStations?: number
  months?: number[]        // 造哪几个月
  cap?: (i: number) => number | null
  metered?: (i: number) => boolean
  gen?: (i: number, m: number, d: number) => number   // 返回 0 = 该日无记录
  weather?: boolean
}

function make(o: Opts = {}) {
  const y = o.year ?? 2026
  const n = o.nStations ?? 9
  const months = o.months ?? [7, 8]
  const stations: StationCfg[] = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `S${i + 1}`,
    capKwp: o.cap ? o.cap(i) : 100,
    metered: o.metered ? o.metered(i) : true,
  }))
  const rows: ReadingRow[] = []
  const weather: WeatherDay[] = []
  const seen = new Set<string>()
  for (const m of months) {
    const dim = new Date(y, m, 0).getDate()
    for (let d = 1; d <= dim; d++) {
      const date = dateOf(y, m, d)
      if (!seen.has(date)) {
        seen.add(date)
        weather.push({ date, ghiKwh: 4 + (d % 5) * 0.4, rainMm: 0, isRain: d % 10 === 0, hours: 24 })
      }
      for (let i = 0; i < n; i++) {
        const g = o.gen ? o.gen(i, m, d) : 400 * (1 + (i - 4) * 0.01) * (1 + (d % 5) * 0.1)
        if (g <= 0) continue
        rows.push({
          stationId: i + 1, date, gen: g,
          selfUse: g * 0.7, gridFeed: g * 0.3, revenue: g * 0.7 * 0.86, priceSnap: 0.86,
        })
      }
    }
  }
  return { stations, rows, weather: o.weather === false ? [] : weather }
}

const snap = (o: Opts = {}) => {
  const { stations, rows, weather } = make(o)
  return buildSnapshot({ year: 2026, stations, rows, weather, gridPrice: 0.391 })
}

describe('snapshot id —— 页脚拿它对账', () => {
  it('同一份数据两次算,id 相同', () => {
    expect(snap().id).toBe(snap().id)
  })
  it('数据变了 id 就变', () => {
    const a = snap()
    const b = snap({ gen: (i, m, d) => 400 * (1 + (i - 4) * 0.01) * (1 + (d % 5) * 0.1) + (i === 0 ? 1 : 0) })
    expect(b.id).not.toBe(a.id)
  })
})

describe('§07 护栏', () => {
  // 第一行:「没装表」与「装了表但漏抄」必须分开 —— 前者永久不用管,后者要催人
  it('metered=0 整站不进分析,单独标「未装表」且建议是无需处理', () => {
    const s = snap({ metered: i => i !== 2 })
    const row = s.stations.find(r => r.name === 'S3')!
    expect(row.statusLabel).toBe('未装表')
    expect(row.advice).toBe('无需处理')
    expect(s.quality.noMeter).toEqual(['S3'])
    expect(s.polish.alpha.has(3)).toBe(false)      // 不进矩阵
    expect(s.park.counts.risk + s.park.counts.watch + s.park.counts.ok).toBe(8)
  })

  // 第二行:无容量算不出 eff,混进去会污染 β̂;但要**列名**,不能静默吞掉
  it('未录容量整站不进分析,单独标「未录容量」且催人补', () => {
    const s = snap({ cap: i => (i === 1 ? null : 100) })
    const row = s.stations.find(r => r.name === 'S2')!
    expect(row.statusLabel).toBe('未录容量')
    expect(row.advice).toContain('补填装机容量')
    expect(s.quality.noCapacity).toEqual(['S2'])
    expect(s.quality.noMeter).toEqual([])          // 与「未装表」分开,不混
  })

  // §07 最容易出假绿的一条:显「正常」就是骗人
  it('某站有效日 < 20 → 「数据不全」,**不出结论**', () => {
    // S5 只在每月前 5 天有记录
    const s = snap({ gen: (i, m, d) => (i === 4 && d > 5 ? 0 : 400 * (1 + (i - 4) * 0.01) * (1 + (d % 5) * 0.1)) })
    const row = s.stations.find(r => r.name === 'S5')!
    expect(row.status).toBe('mute')
    expect(row.statusLabel).toBe('数据不全')
    expect(row.statusLabel).not.toBe('正常')
    expect(row.situation).toContain('不做判断')
    expect(row.advice).toBe('补录抄表')
  })

  // 4 栋掉线就能污染中位数 β,导致全园当天集体误报 → 降级(不是悄悄照算)。
  // 但「整个园区就 6 栋」与「某几天掉线到 3 栋」是两回事,处理方式也两样
  it('整个园区已装表楼栋不足 8 → 逐站结论全收起,只留收益与同比', () => {
    const s = snap({ nStations: 6 })
    expect(s.quality.tooFewStations).toBe(true)
    expect(s.quality.degraded).toBe(true)
    expect(s.quality.droppedThin).toBe(0)          // 不是按"剔天"处理,否则一天不剩
    for (const r of s.stations) {
      expect(r.status).toBe('mute')
      expect(r.relPct).toBeNull()                  // 屏上不能再出现「相对园区」的数
    }
    expect(s.park.revenue).toBeGreaterThan(0)      // 收益照给
  })
  it('参与站够 → 不降级', () => {
    const s = snap({ nStations: 9 })
    expect(s.quality.degraded).toBe(false)
  })

  // 天气 hours<24 的日子剔除,且**剔了几天要报出来**
  it('天气缺小时的日子被剔除并计数', () => {
    const { stations, rows, weather } = make()
    weather[3].hours = 20
    weather[7].hours = 18
    const s = buildSnapshot({ year: 2026, stations, rows, weather, gridPrice: 0.391 })
    expect(s.quality.droppedHours).toBe(2)
    expect(s.polish.beta.has(weather[3].date)).toBe(false)
  })

  // 没有天气数据时不做天气过滤,但要在质量记录里说清楚 —— 不能把空集合当「全过」
  it('没有天气数据 → hasWeather=false,但分析照跑(不做天气过滤)', () => {
    const s = snap({ weather: false })
    expect(s.quality.hasWeather).toBe(false)
    expect(s.health).toEqual([])
    expect(s.polish.alpha.size).toBe(9)
  })
})

describe('第一层输出', () => {
  it('表按缺口金额降序', () => {
    const s = snap()
    const gaps = s.stations.map(r => r.gapMoney)
    expect([...gaps].sort((a, b) => b - a)).toEqual(gaps)
  })

  it('主口径月 = 该年最后一个有抄表的月', () => {
    expect(snap({ months: [5, 6, 7] }).ym).toBe('2026-07')
  })

  it('近 13 个月最多 13 根,应得不低于实际', () => {
    const s = snap({ months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] })
    expect(s.monthly.labels).toHaveLength(12)
    s.monthly.due.forEach((d, i) => expect(d).toBeGreaterThanOrEqual(s.monthly.actual[i]))
  })

  it('四灯计数之和 = 表行数', () => {
    const s = snap({ metered: i => i !== 0, cap: i => (i === 1 ? null : 100) })
    const c = s.park.counts
    expect(c.ok + c.watch + c.risk + c.mute).toBe(s.stations.length)
  })

  // §06「不确定性怎么说」的黑名单:第一层永不出现这些词
  it('表格文案里没有统计术语', () => {
    const BAN = ['显著', '残差', '归一化', '置信区间', '等效利用小时', 'kWh/kWp', 'p 值', 'q 值']
    const s = snap({ gen: (i, m, d) => (i === 3 && (m > 7 || (m === 7 && d > 18)) ? 260 : 400) * (1 + (d % 5) * 0.1) })
    for (const row of s.stations) {
      for (const word of BAN) {
        expect(row.situation, `${row.name} situation`).not.toContain(word)
        expect(row.advice, `${row.name} advice`).not.toContain(word)
      }
    }
  })

  // §5.2 盲区②:抛光只看**变化**,看不见**水平**。某栋一直低 25% 会被 α 整个吸收,
  // 残差恒为 0 → 变点/显著性通道**永远检不出来**。必须由先天缺陷通道兜住。
  //
  // ⚠ 这条断言早先写成 `if (status !== 'ok' && shape === 'flat') { ... }` ——
  //   条件不满足就整条空过,改坏 adviceOf 也不红(假绿)。现在无条件断言,且先钉住前提。
  it('一直偏低的站被先天缺陷通道兜住 —— 抬成需关注,建议核对容量台账', () => {
    const s = snap({ gen: (i, m, d) => (i === 3 ? 300 : 400) * (1 + (d % 5) * 0.1) })
    const row = s.stations.find(r => r.name === 'S4')!

    // 前提:变点通道确实看不见它(残差被 α 吸干净)
    const resid = [...s.polish.resid.get(4)!.values()]
    const mean = resid.reduce((a, b) => a + b, 0) / resid.length
    expect(Math.abs(mean)).toBeLessThan(0.01)

    // 结论:水平这条线看得见
    expect(s.congenital.find(c => c.id === 4)!.suspect).toBe(true)
    expect(row.status).toBe('watch')
    expect(row.situation).toBe('一直偏低,不是新问题')
    expect(row.advice).toContain('装机容量台账')
    expect(row.advice).not.toContain('现场检查')
  })

  it('水平正常的园区(展开度 ±4%)一个都不抬', () => {
    const s = snap()
    expect(s.congenital.filter(c => c.suspect)).toHaveLength(0)
    expect(s.stations.filter(r => r.status !== 'ok')).toHaveLength(0)
  })

  // §5.7 同一条规则:金额才是过滤器。α 判定说「这栋一直偏低」不等于该点灯 ——
  // 一个月、少发一千来块的站点了灯,黄灯就成了噪声本身。
  it('α 偏低但钱不够门槛 → 认定为疑似,但**不点灯**', () => {
    // 只有 7 月一个月 + S4 低 10%:31 天 × 约 400 度 × 10.5% × 0.86 ≈ ¥1,120,够不着 ¥2,000
    const s = snap({ months: [7], gen: (i, m, d) => (i === 3 ? 360 : 400) * (1 + (d % 5) * 0.1) })
    expect(s.congenital.find(c => c.id === 4)!.suspect).toBe(true)   // α 这条线看见了
    expect(s.stations.find(r => r.name === 'S4')!.status).toBe('ok') // 但屏上不点灯
  })
})

// §5.4 的形状→动作映射表。五种形状派五拨不同的人,判错了派错人:
// step 现场检查 / ramp 测直流侧压降 / sawtooth 可安排清洗 / flat 先核对容量台账 / spike 对运维台账。
// 直接测这张表:default(显著但无形状)那条分支在整链夹具里难可靠造出来。
describe('adviceOf —— 形状决定派谁去', () => {
  it.each([
    ['step', '现场检查'],
    ['ramp', '直流侧压降'],
    ['sawtooth', '清洗'],
    ['spike', '运维台账'],
    ['flat', '装机容量台账'],
  ] as const)('%s → %s', (shape, expected) => {
    expect(adviceOf('risk', shape)).toContain(expected)
  })

  it('正常的站不给动作', () => {
    expect(adviceOf('ok', 'step')).toBe('保持')
  })

  // sawtooth 与 ramp 只差「雨后回不回弹」,却是「安排清洗」与「爬上去测压降」两回事
  it('sawtooth 与 ramp 的建议不能相同', () => {
    expect(adviceOf('risk', 'sawtooth')).not.toBe(adviceOf('risk', 'ramp'))
  })
})

// ══ §07 十条护栏的表驱动覆盖 ══════════════════════════════════════════
//
// 每一条都必须**显式暴露**,不许静默处理 —— 这是本产品既有的文化,也是财务肯认数的前提。
// 以后加护栏加一行。表里每条都指名它防的是什么,防不住会怎样。
//
// ⚠ 这张表只证明「十条都有人管」。每条的**行为**在上面各自的 it 里逐条断言,
//   两者缺一不可:光有表 = 只知道有代码碰过它,不知道碰对没有。

interface GuardCase {
  no: number
  what: string
  build: () => ReturnType<typeof snap>
  check: (s: ReturnType<typeof snap>) => void
}

const GUARDS: GuardCase[] = [
  {
    no: 1, what: '未装表:整站不出现,与「漏抄」分档',
    build: () => snap({ metered: i => i !== 2 }),
    check: s => {
      expect(s.quality.noMeter).toEqual(['S3'])
      expect(s.stations.find(r => r.name === 'S3')!.statusLabel).toBe('未装表')
      expect(s.polish.alpha.has(3)).toBe(false)
    },
  },
  {
    no: 2, what: '未录容量:不入分析,卡片脚注列名',
    build: () => snap({ cap: i => (i === 1 ? null : 100) }),
    check: s => {
      expect(s.quality.noCapacity).toEqual(['S2'])
      expect(s.polish.alpha.has(2)).toBe(false)
    },
  },
  {
    no: 3, what: '当日参与站 < 8:整屏降级,不悄悄照算',
    build: () => snap({ nStations: 6 }),
    check: s => {
      expect(s.quality.degraded).toBe(true)
      expect(s.quality.tooFewStations).toBe(true)
    },
  },
  {
    no: 4, what: '天气 hours < 24:该日剔除并报出剔除天数',
    build: () => {
      const { stations, rows, weather } = make()
      weather[2].hours = 19
      return buildSnapshot({ year: 2026, stations, rows, weather, gridPrice: 0.391 })
    },
    check: s => expect(s.quality.droppedHours).toBe(1),
  },
  {
    no: 5, what: '低出力日:阈值只打 GHI,剔除天数报出',
    build: () => {
      const { stations, rows, weather } = make()
      weather[4].ghiKwh = 0.2
      weather[5].ghiKwh = 0.3
      return buildSnapshot({ year: 2026, stations, rows, weather, gridPrice: 0.391 })
    },
    check: s => {
      expect(s.quality.droppedLowGhi).toBe(2)
      // 被剔的是**天气弱**的那天,不是发电低的那天 —— 打在 gen 上等于优先删除故障楼的故障日
      expect(s.polish.beta.size).toBe(s.quality.okDays)
    },
  },
  {
    no: 6, what: '某站有效日 < 20:显「数据不全」,不出结论',
    build: () => snap({ gen: (i, m, d) => (i === 4 && d > 5 ? 0 : 400 * (1 + (i - 4) * 0.01) * (1 + (d % 5) * 0.1)) }),
    check: s => {
      const r = s.stations.find(x => x.name === 'S5')!
      expect(r.statusLabel).toBe('数据不全')
      expect(r.status).toBe('mute')
    },
  },
  {
    no: 7, what: '只有月抄的站:降级月频卡,不与日频站混排',
    build: () => snap({ gen: (i, m, d) => (i === 5 && d !== 15 ? 0 : 400 * (1 + (i - 4) * 0.01) * (1 + (d % 5) * 0.1)), months: [3, 4, 5, 6, 7] }),
    check: s => {
      const r = s.stations.find(x => x.name === 'S6')!
      expect(r.statusLabel).toBe('月频口径')
      expect(r.advice).not.toContain('补录抄表')   // 不是数据缺,催人补录是错的建议
    },
  },
  {
    no: 8, what: '上一年无抄表:同比显「—」不显「0%」',
    build: () => {
      const { stations, rows, weather } = make()
      return buildSnapshot({ year: 2026, stations, rows, weather, gridPrice: 0.391, prevRows: [] })
    },
    check: s => {
      expect(s.yoy.monthPct).toBeNull()
      expect(s.yoy.yearPct).toBeNull()
      expect(s.yoy.monthNote).toContain('没得比')
    },
  },
  {
    no: 9, what: '同比跨年月份不齐:按两年都有抄表的月对齐,报出参与月数',
    build: () => {
      const cur = make({ months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] })
      const prev = make({ months: [1, 2, 3], year: 2025 })
      return buildSnapshot({
        year: 2026, stations: cur.stations, rows: cur.rows, weather: cur.weather,
        gridPrice: 0.391, prevRows: prev.rows,
      })
    },
    check: s => {
      // 12 个月直接对 3 个月会虚高 300%;对齐后只比那 3 个月
      expect(s.yoy.yearMonths).toBe(3)
      expect(Math.abs(s.yoy.yearPct!)).toBeLessThan(20)
      expect(s.yoy.yearNote).toContain('3 个月')
    },
  },
  {
    no: 10, what: '整年无抄表:整屏空态,不画假图',
    build: () => snap({ gen: () => 0 }),
    check: s => {
      expect(s.stations.every(r => r.status === 'mute')).toBe(true)
      expect(s.park.gap).toBe(0)
    },
  },
]

describe('§07 十条护栏 —— 表驱动(以后加护栏加一行)', () => {
  it.each(GUARDS.map(g => [g.no, g.what, g] as const))('第 %i 条:%s', (_no, _what, g) => {
    g.check(g.build())
  })

  it('十条一条不少', () => {
    expect(GUARDS.map(g => g.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})

describe('同比的两条护栏(§07 第 8、9 行)', () => {
  it('没取上一年数据 → 显「—」,措辞与「上一年真没有」分开', () => {
    const s = snap()   // 不传 prevRows
    expect(s.yoy.monthPct).toBeNull()
    expect(s.yoy.monthNote).toBe('未取上一年数据')
  })

  it('去年同月有数 → 给出百分比', () => {
    const cur = make({ months: [8] })
    const prev = make({ months: [8], year: 2025, gen: (i, m, d) => 400 * (1 + (d % 5) * 0.1) * 0.8 })
    const s = buildSnapshot({
      year: 2026, stations: cur.stations, rows: cur.rows, weather: cur.weather,
      gridPrice: 0.391, prevRows: prev.rows,
    })
    expect(s.yoy.monthPct).not.toBeNull()
    expect(s.yoy.monthPct!).toBeGreaterThan(20)   // 今年比去年高约 25%
    expect(s.yoy.monthNote).toContain('2025-08')
  })

  // 0% 意味着「持平」,—— 意味着「没得比」。这两句话在财务会上是完全不同的结论
  it('去年同月无数时绝不返回 0', () => {
    const cur = make({ months: [8] })
    const prev = make({ months: [3], year: 2025 })
    const s = buildSnapshot({
      year: 2026, stations: cur.stations, rows: cur.rows, weather: cur.weather,
      gridPrice: 0.391, prevRows: prev.rows,
    })
    expect(s.yoy.monthPct).toBeNull()
    expect(s.yoy.monthPct).not.toBe(0)
  })
})

// ── 屏上实测暴露的三条(2026-08-31,dev 库 13 站真数据)───────────────────
describe('第一层的三条一致性', () => {
  // §08 验收⑤:第一层的「本月缺口」与逐站缺口求和必须**分毫不差**。
  // 实测踩到:KPI ¥37,181 而表行合计 ¥137,180 —— 先天缺陷通道改写了行上的 gapMoney,
  // 而园区口径还在从改写前的中间量求和。
  it('KPI 缺口 = 逐站缺口求和,分毫不差', () => {
    const s = snap({ gen: (i, m, d) => (i < 4 ? 250 : 400) * (1 + (d % 5) * 0.1) })
    const sum = s.stations.reduce((a, r) => a + r.gapMoney, 0)
    expect(s.park.gap).toBeCloseTo(sum, 9)
    expect(s.park.gap).toBeGreaterThan(0)   // 夹具真的造出了缺口,不是 0=0 的空过
  })

  // §5.3:正侧偏离归**数据质量告警**,不是性能告警。
  // 实测踩到:三期两栋 α 是园区中位的 7 倍,屏上显「正常 · 高 664%」——
  // 一栋楼不可能比同园其余楼强 7 倍,那是容量台账写错了。判「正常」等于把台账错误盖过去。
  it('折算下来高得离谱的站判「数据存疑」,不判「正常」', () => {
    const s = snap({ cap: i => (i === 8 ? 12 : 100) })   // S9 容量填成 1/8
    const r = s.stations.find(x => x.name === 'S9')!
    expect(r.status).toBe('mute')
    expect(r.statusLabel).toBe('数据存疑')
    expect(r.advice).toContain('装机容量台账')
    expect(r.situation).toContain('不合常理')
  })

  // 早先只挂横幅说「不做楼栋之间的比较」,而屏上比较照做 —— 屏在撒谎。
  // 正确做法是把那些天**整日剔除**,和低辐照日一个待遇。
  it('参与站不足的日子整日剔除,不是只挂个横幅', () => {
    const { stations, rows, weather } = make()
    // 3/07、3/08 两天只留 3 个站
    const thin = new Set(['2026-07-07', '2026-07-08'])
    const kept = rows.filter(r => !thin.has(r.date) || r.stationId <= 3)
    const s = buildSnapshot({ year: 2026, stations, rows: kept, weather, gridPrice: 0.391 })
    expect(s.quality.droppedThin).toBe(2)
    expect(s.polish.beta.has('2026-07-07')).toBe(false)
    expect(s.polish.beta.has('2026-07-08')).toBe(false)
    // 剔完之后每一天都够 8 站 —— 不是"报了个数然后照算"
    expect(s.quality.minStationsOnDay).toBeGreaterThanOrEqual(8)
  })
})

// ── 第二层 · 单栋逐日明细(§06.2)──────────────────────────────────────
describe('StationDetail', () => {
  // S4 从 7/19 起掉 35%,整年数据
  const stepped = () => snap({
    months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    gen: (i, m, d) => 400 * (1 + (i - 4) * 0.01) * (1 + (d % 5) * 0.1)
      * (i === 3 && (m > 7 || (m === 7 && d > 18)) ? 0.65 : 1),
  })

  it('逐日序列齐全,长度一致', () => {
    const r = stepped().stations.find(x => x.name === 'S4')!
    const d = r.detail!
    expect(d.dates.length).toBeGreaterThan(300)
    expect(d.gen).toHaveLength(d.dates.length)
    expect(d.expected).toHaveLength(d.dates.length)
    expect(d.gapCum).toHaveLength(d.dates.length)
    expect(d.resid).toHaveLength(d.dates.length)
  })

  // 主图三样信息:折点=开始变差、斜率=元/天、终点=至今一共亏多少
  it('累计缺口单调不减,终点 = 至今一共亏多少', () => {
    const d = stepped().stations.find(x => x.name === 'S4')!.detail!
    for (let i = 1; i < d.gapCum.length; i++) expect(d.gapCum[i]).toBeGreaterThanOrEqual(d.gapCum[i - 1])
    expect(d.gapCum[d.gapCum.length - 1]).toBeGreaterThan(0)
  })

  it('折点后的斜率明显陡于折点前 —— 「再拖一个月多少钱」靠它口算', () => {
    const d = stepped().stations.find(x => x.name === 'S4')!.detail!
    expect(d.cpDate).not.toBeNull()
    expect(d.slopeAfter).toBeGreaterThan(d.slopeBefore * 3)
  })

  it('折点落在种入日附近', () => {
    const d = stepped().stations.find(x => x.name === 'S4')!.detail!
    expect(d.cpDate!.slice(0, 7)).toBe('2026-07')
  })

  it('健康站没有折点也没有累计缺口', () => {
    const d = stepped().stations.find(x => x.name === 'S1')!.detail!
    expect(d.gapCum[d.gapCum.length - 1]).toBeLessThan(d.gapCum.length)   // 近似 0(数值噪声级)
  })

  // 「不参与判定」有**五种**走法,每种都要不画图(不是画一张空图)。
  // 早先只测了未装表/未录容量两支,改坏「数据存疑」那支一条都不红
  it.each([
    ['未装表', 'S3', () => snap({ metered: i => i !== 2 })],
    ['未录容量', 'S2', () => snap({ cap: i => (i === 1 ? null : 100) })],
    ['数据存疑', 'S9', () => snap({ cap: i => (i === 8 ? 12 : 100) })],
    ['月频口径', 'S6', () => snap({ months: [3, 4, 5, 6, 7], gen: (i, m, d) => (i === 5 && d !== 15 ? 0 : 400 * (1 + (i - 4) * 0.01) * (1 + (d % 5) * 0.1)) })],
    ['有效日不足', 'S5', () => snap({ gen: (i, m, d) => (i === 4 && d > 5 ? 0 : 400 * (1 + (i - 4) * 0.01) * (1 + (d % 5) * 0.1)) })],
  ] as const)('%s 的站没有 detail', (_why, name, build) => {
    const r = build().stations.find(x => x.name === name)!
    expect(r.status).toBe('mute')
    expect(r.detail).toBeNull()
  })

  it('园区楼栋数不足时所有站的 detail 都收起', () => {
    const s = snap({ nStations: 6 })
    expect(s.stations.every(r => r.detail === null)).toBe(true)
  })
})

// §06.2:变点标注**必须同时写区间**。但写法由区间宽度决定 ——
// 固定一种是错的:强效应下写「中旬」丢精度,弱效应下写「7月18日」是承诺算法给不了的东西。
describe('cpPhrase —— 宽度决定措辞', () => {
  const mk = (lo: string, hi: string, at: string) =>
    ({ cpDate: at, cpLo: lo, cpHi: hi } as Parameters<typeof cpPhrase>[0])

  it('窄区间(≤3 天)照实写日期,不硬凑「中旬」', () => {
    const t = cpPhrase(mk('2026-07-18', '2026-07-19', '2026-07-18'))
    expect(t).toBe('折点 · 7/18')
    expect(t).not.toContain('中旬')
  })

  it('宽区间写旬 + 区间 + 「不是精确到天」', () => {
    const t = cpPhrase(mk('2026-07-11', '2026-07-26', '2026-07-18'))
    expect(t).toContain('中旬')
    expect(t).toContain('7/11–7/26')
    expect(t).toContain('不是精确到天')
  })

  it('没有折点就不出这句话', () => {
    expect(cpPhrase(mk('', '', null as unknown as string))).toBe('')
  })
})

// 从 PvRoiView 的「消纳结构」区接过来的检查(Task 13 卸那块时不能把它一起丢了):
// 损耗 = 发电 − 自消纳 − 上网,负值 = 计量异常(自用+上网比总发电还多,物理上不可能)
describe('计量异常(自 PvRoiView 消纳结构区接管)', () => {
  it('自用+上网 超过发电总量 → 数据存疑,建议查接线', () => {
    const { stations, rows, weather } = make()
    rows.filter(r => r.stationId === 6).forEach(r => { r.selfUse = r.gen * 0.8; r.gridFeed = r.gen * 0.35 })
    const s = buildSnapshot({ year: 2026, stations, rows, weather, gridPrice: 0.391 })
    const r = s.stations.find(x => x.name === 'S6')!
    expect(r.statusLabel).toBe('数据存疑')
    expect(r.situation).toContain('比发电总量还多')
    expect(r.advice).toContain('接线')
  })

  // 抄表四舍五入会带出零点几个百分点的负数,那不是错 —— 容差之内不报
  it('零点几个百分点的负差不报警', () => {
    const { stations, rows, weather } = make()
    rows.filter(r => r.stationId === 6).forEach(r => { r.selfUse = r.gen * 0.703; r.gridFeed = r.gen * 0.3 })
    const s = buildSnapshot({ year: 2026, stations, rows, weather, gridPrice: 0.391 })
    expect(s.stations.find(x => x.name === 'S6')!.statusLabel).not.toBe('数据存疑')
  })
})

// 天气按月分批导时必然撞上:先导了上半年,下半年的抄表**不能**因此不进模型。
// 天气只是用来筛掉坏日子的,不是模型输入 —— 没有天气行 ≠ 坏日子,只是不知道好不好。
describe('天气只覆盖部分日子', () => {
  const halfYear = () => {
    const { stations, rows, weather } = make({ months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] })
    // 只保留上半年的天气行
    return buildSnapshot({
      year: 2026, stations, rows, gridPrice: 0.391,
      weather: weather.filter(w => Number(w.date.slice(5, 7)) <= 6),
    })
  }

  it('没有天气行的日子照常进模型 —— 不为「不知道」而扔掉真数据', () => {
    const s = halfYear()
    // 下半年的日子必须在 β 里(它们没被筛过,但不该被丢)
    expect(s.polish.beta.has('2026-09-15')).toBe(true)
    expect(s.polish.beta.has('2026-12-20')).toBe(true)
    // 每站的有效日应当覆盖到全年量级,不是只剩上半年
    const anyStation = s.stations.find(r => r.days > 0)!
    expect(anyStation.days).toBeGreaterThan(300)
  })

  it('未筛天数与覆盖率如实报出 —— 不确定一律显式暴露', () => {
    const s = halfYear()
    expect(s.quality.unscreenedDays).toBeGreaterThan(150)
    expect(s.quality.weatherCoverage).toBeGreaterThan(0.4)
    expect(s.quality.weatherCoverage).toBeLessThan(0.6)
  })

  it('天气全覆盖时未筛天数为 0、覆盖率为 1', () => {
    const s = snap()
    expect(s.quality.unscreenedDays).toBe(0)
    expect(s.quality.weatherCoverage).toBeCloseTo(1, 9)
  })

  it('压根没有天气时覆盖率为 0,且不做任何日过滤', () => {
    const s = snap({ weather: false })
    expect(s.quality.hasWeather).toBe(false)
    expect(s.quality.weatherCoverage).toBe(0)
    expect(s.quality.unscreenedDays).toBeGreaterThan(0)
  })

  // 有天气行且**明确判定为坏**的日子照旧剔除 —— 放宽的只是「没有天气行」那一类
  it('有天气行但辐照过弱的日子照旧剔除', () => {
    const { stations, rows, weather } = make()
    weather[3].ghiKwh = 0.2
    weather[4].ghiKwh = 0.3
    const s = buildSnapshot({ year: 2026, stations, rows, weather, gridPrice: 0.391 })
    expect(s.polish.beta.has(weather[3].date)).toBe(false)
    expect(s.quality.droppedLowGhi).toBe(2)
    expect(s.quality.unscreenedDays).toBe(0)      // 它们有天气行,只是没通过 —— 不算「未筛」
  })
})
