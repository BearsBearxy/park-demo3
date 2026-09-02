import { describe, expect, it } from 'vitest'
import { runsOf, tickState, type Run, type TickState } from './pvMeterAna.logic'

// 刻度三态与连续段(PV-ANALYSIS-SPEC §03.8,验收 §08 v3-5)。
// 这是这屏唯一有分支的逻辑 —— 其余都是画图。所以下面两张表就是这屏的闸门:
// 表里每一行的 `breaks` 写的是**它坏掉时屏上会变成什么样**,断言红了先读那句。

/**
 * 一个字符 = 一个刻度,把 out[] 与 state[] 一起摆出来。
 *   '-' 已抄,在范围下方(out=−1)    '+' 已抄,在范围上方(out=+1)
 *   '0' 已抄,在范围内(out=0)       'x' 漏抄(out=null)    '.' 未到(out=null)
 * 「漏抄与未到处一律 null,不是 0」是 BoardRow.out 的口径:0 是「量过、在范围内」。
 */
function lay(s: string): { out: (number | null)[]; state: TickState[] } {
  const out: (number | null)[] = []
  const state: TickState[] = []
  for (const c of s) {
    if (c === '-') { out.push(-1); state.push('seen') }
    else if (c === '+') { out.push(1); state.push('seen') }
    else if (c === '0') { out.push(0); state.push('seen') }
    else if (c === 'x') { out.push(null); state.push('missing') }
    else if (c === '.') { out.push(null); state.push('future') }
    else throw new Error(`未知刻度记号 ${c}`)
  }
  return { out, state }
}

interface RunCase {
  what: string
  s: string
  /** 判据线 crit.bandRun,默认 3 */
  minRun?: number
  /** 数据截止日在本段里的下标;buildBoard 在数据截止日落在本段之外时传 −1 */
  lastSeen: number
  want: Run[]
  breaks: string
}

const RUN_CASES: RunCase[] = [
  {
    what: '2 个连续不成段',
    s: '0--00',
    lastSeen: 4,
    want: [],
    breaks: '两天的抖动被涂上琥珀底色并开出一句事实,队列的命中组塞满噪声;判据脚写着「连续 ≥3」却是假话',
  },
  {
    what: '3 个成段',
    s: '0---0',
    lastSeen: 4,
    want: [{ from: 1, to: 3, dir: -1, live: false }],
    breaks: '真断崖一个段都不出:队列 0 命中、B0 主数转灰、大图上没有琥珀底 —— 一屏假绿',
  },
  {
    what: '中间夹一个漏抄仍成段(from/to 把漏抄括进去)',
    s: '--x--0',
    lastSeen: 5,
    want: [{ from: 0, to: 4, dir: -1, live: false }],
    breaks: '把记录的缺口当成现象的缺口:漏抄一天就把 5 天的断崖切成两截 2 天,两截都够不上 3,整栋从命中组消失',
  },
  {
    what: '中间夹一个未到必须断',
    s: '--.--',
    lastSeen: 1,
    want: [],
    breaks: '连过未到 = 替明天做主:8/15 打开时把 8/16 之后还没发生的日子算进段里,琥珀底一路铺到月底',
  },
  {
    what: '上越与下越不合并',
    s: '---+++',
    lastSeen: 5,
    want: [
      { from: 0, to: 2, dir: -1, live: false },
      { from: 3, to: 5, dir: 1, live: true },
    ],
    breaks: '发得少和发得多被并成一段 6 天,方向没了:事实句只能瞎写一个方向,大图上两段异号被涂成一整片',
  },
  {
    what: '回到范围内也断段(out=0 不是缺数据)',
    s: '--0--',
    lastSeen: 4,
    want: [],
    breaks: '中间那天明明量过、就在范围里,却被跳过去凑成 5 天连续 —— 段长与事实句里的天数全部虚报',
  },
  {
    what: 'live:段末端 == 数据截止日 → 仍在持续',
    s: '0---',
    lastSeen: 3,
    want: [{ from: 1, to: 3, dir: -1, live: true }],
    breaks: '还在往下掉的段被写成闭区间,事实句丢掉「(仍在持续)」,读的人以为这事已经过去了',
  },
  {
    what: 'live:数据截止日不在本段(12 月回看 8 月,lastSeen=−1)→ 不写仍在持续',
    s: '0---',
    lastSeen: -1,
    want: [{ from: 1, to: 3, dir: -1, live: false }],
    breaks: '回看历史月时每个段都挂「(仍在持续)」,12 月看 8 月被告知「至今还在掉」',
  },
  {
    what: 'minRun 可调:调到 5,3 个连续不再成段',
    s: '0---0',
    minRun: 5,
    lastSeen: 4,
    want: [],
    breaks: '判据脚回显的 bandRun 与实际用的不是同一个数:用户去参数中心改了 3→5,屏上命中一栋没少',
  },
  {
    what: 'minRun 可调:调到 5,5 个连续照常成段',
    s: '0-----',
    minRun: 5,
    lastSeen: 5,
    want: [{ from: 1, to: 5, dir: -1, live: true }],
    breaks: 'bandRun 调大后一个段都开不出,整屏永久 0 命中',
  },
  {
    what: '整段全是未到(段还没开始)',
    s: '.....',
    lastSeen: -1,
    want: [],
    breaks: '未来的空刻度被当成数据,凭空开出一个段',
  },
]

describe('runsOf —— 连续段(§03.8)', () => {
  for (const c of RUN_CASES) {
    it(`${c.what}｜坏了会:${c.breaks}`, () => {
      const { out, state } = lay(c.s)
      expect(runsOf(out, state, c.minRun ?? 3, c.lastSeen)).toEqual(c.want)
    })
  }
})

interface TickCase {
  what: string
  tick: string
  hasValue: boolean
  dataThrough: string | null
  elapsed: string | null
  want: TickState
  breaks: string
}

// 月中打开:数据截止日 8/15,已过去也到 8/15;8/07 空着,8/16 起还没发生。
const TICK_CASES: TickCase[] = [
  {
    what: '未到 ≠ 漏抄:超过已过去的刻度是未到',
    tick: '2026-08-20', hasValue: false, dataThrough: '2026-08-15', elapsed: '2026-08-15',
    want: 'future',
    breaks: '8/16–8/31 被算成漏抄:覆盖率分母从 15 变 31、14/31=45% < 90%,13 栋全掉进「读不出」,屏上什么都不剩',
  },
  {
    what: '漏抄:已过去了却没记录',
    tick: '2026-08-07', hasValue: false, dataThrough: '2026-08-15', elapsed: '2026-08-15',
    want: 'missing',
    breaks: '真漏的那天被写成「未到」:缺口记号不画、覆盖率算成 100%,催不到人去补抄',
  },
  {
    what: '已抄:有记录且不晚于数据截止日',
    tick: '2026-08-06', hasValue: true, dataThrough: '2026-08-15', elapsed: '2026-08-15',
    want: 'seen',
    breaks: '抄过的日子被判成漏抄:折线整条断成一格一格,出范围的点不进段、不进 outN',
  },
  {
    what: '有记录但晚于数据截止日,仍算漏抄',
    tick: '2026-08-20', hasValue: true, dataThrough: '2026-08-15', elapsed: '2026-08-31',
    want: 'missing',
    breaks: '数据截止日之后冒出孤立的点,B0 右侧「数据到 8-15」与图上画到 8-20 自相矛盾',
  },
  {
    what: '整年一条没抄(dataThrough=null)→ 全段漏抄,不是未到',
    tick: '2026-08-06', hasValue: false, dataThrough: null, elapsed: '2026-08-15',
    want: 'missing',
    breaks: '整段没抄的栋 seenN 不为 0,不进「读不出」组,反而以「未低于你设的线」示人 —— 假绿',
  },
  {
    what: '段还没开始(elapsed=null)→ 全是未到',
    tick: '2026-08-06', hasValue: false, dataThrough: '2026-08-15', elapsed: null,
    want: 'future',
    breaks: '还没开始的段被判成整段漏抄,B0 覆盖率 0%,队列全员「未抄 0/N」',
  },
  {
    what: '年档:刻度是 YYYY-MM,当月不能被两条 YYYY-MM-DD 边界判成未到',
    tick: '2026-08', hasValue: true, dataThrough: '2026-08-15', elapsed: '2026-08-15',
    want: 'seen',
    breaks: '年档最后一格永远空着:12 个月的图只画 11 个月,B4 的今年端点整列消失',
  },
  {
    what: '年档:段末之后的月份照常是未到',
    tick: '2026-09', hasValue: false, dataThrough: '2026-08-15', elapsed: '2026-08-15',
    want: 'future',
    breaks: '还没到的月份被算进覆盖率分母,年档 13 栋集体「读不出」',
  },
]

describe('tickState —— 刻度三态(§03.8)', () => {
  for (const c of TICK_CASES) {
    it(`${c.what}｜坏了会:${c.breaks}`, () => {
      expect(tickState(c.tick, c.hasValue, c.dataThrough, c.elapsed)).toBe(c.want)
    })
  }
})

// 两张表的交接处:runsOf 只认 state,不认 out 里有没有值 —— 三态错了,段跟着错。
it('三态与段的交接:同一串刻度,把「未到」错判成「漏抄」就会凭空多出一个段', () => {
  const seen = lay('--.--')          // 8/16 起未到 → 必须断,一个段都没有
  const wrong = lay('--x--')         // 若把未到错判成漏抄 → 跨过去凑成 5 天
  expect(runsOf(seen.out, seen.state, 3, 1)).toEqual([])
  expect(runsOf(wrong.out, wrong.state, 3, 4)).toEqual([{ from: 0, to: 4, dir: -1, live: true }])
})
