import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { elecBandRef, elecReadout } from '../analysis/monitor.logic'
import { bandReadout, bandRefText } from '../analysis/TenantEnergy.logic'
import {
  priorityReadout, priorityRefText, renewalRateReadout, sensitivityRows, sensitivitySentence,
  sensitivityGapSentence, rentRollRefText, rentRollSentence, type RentPriorityRow, type RentRoll,
} from '../analysis/expiry.logic'
import {
  fitRevenueTrend, mainChart, outlierReadout, outlierRefText, outlierResidual,
  yearOutlookRows, yearOutlookReadout, yearOutlookRefText, backtestRows, backtestSummary, backtestReadout, backtestRefText,
} from '../analysis/cockpit.logic'
import {
  unitRentReadout, unitRentRefText, phaseTableReadout, phaseTableRefText,
  elecTrapReadout, elecTrapRefText, type PhaseTableRow, type ElecSpread,
} from '../analysis/TenantPeer.logic'
import type { PnlSummary } from '../../analysis/anaData'

/**
 * 分析层文案门禁(FORECAST-BAND-AND-PLAIN-SENTENCE §3.4)。
 *
 * 判据口径**先定死**:「可见字符数」= 剥掉 HTML 标签、{{ }} 插值、v-* 指令后剩下的字符数。
 * 不用「纯中文字符数」—— 按那个判,稿自己举的旗舰例子 AnomalyView 那条(剥插值后中文 19 字)
 * 根本抓不到,门禁形同虚设。
 *
 * 起点写死在断言里:立档当天 hint 超标 30 处。往下降,不许往上涨。
 */
const HINT_MAX = 24
const READ_MAX = 30   // ana.css:131(.ana-read 注释)
const REF_MAX = 28    // ana.css:132(.ana-ref 注释,F4 修复轮1 落成具名常量)
/**
 * ⚠ 只许改小 —— 但这一次是**改大的**(28 → 31),而且是对的。
 *
 * I6(对抗复查 2026-09-11):旧基线 28 是用一个量不准的取法数出来的。hint 段落的取法原是
 * 非贪婪正则,遇到嵌套 `<span>` 就停在内层的 `</span>`,四处 hint 被少量了一大截
 * (58→7、42→5、30→21、18→8,详见 hintTexts 的注释)。换成配平取法后重数,实测超标 31 处。
 *
 * 31 > 28 不是放宽,是**旧的数就是错的**:那 3 处从来就超标,只是门禁看不见 ——
 * 其中 42 字那条还在本分支刚改短过的屏上。「只许改小」这条规矩的前提是量得准,
 * 量不准的时候先把尺子修好,再谈往下降。下一次改这个数只许往下。
 */
const HINT_OVER_BASELINE = 31

/**
 * D2(用户 2026-09-10 拍板):统计符号跨屏禁用,口径浮层里也算屏上。
 *
 * 这条门禁是补的,不是原计划里的。Task 5 手工把这四样从租户能耗屏上清掉,
 * **一个修复轮之后 σ 就回来了** —— 搬文案进浮层时顺手写了「园区均值±1σ」。
 * 只靠人复查的规矩会回来,所以给它配一道机器判据。
 *
 * 判据只看模板,不看 <script> 与注释:代码里提 σ 是正常的(变量名、算法注释),
 * 屏上不行。豁免两个光伏文件 —— 「高级分析」面板是全仓唯一准出统计量的地方,
 * 给要复算这屏数字的人看。⚠ 这个豁免是按**整文件**给的,比规矩本身松:
 * 那两个文件里非高级分析的部分也就一并放过了。要收紧得先能界定面板边界。
 *
 * F7(修复轮2)加了两个词:标准偏差、西格玛。
 *
 * **大写 Σ 不在禁词里,这是有意的。** 修复轮 2 一度收了它,判据是「Σ 后面不跟中文才算命中」,
 * 为的是放过「Σ应收」「Σ建筑」这类求和记号。撤掉的理由:
 *  ① 本仓 Σ 就是求和号,是九个文件里的既有正当写法,会计的人读它没障碍 ——
 *    它不是统计术语,D2 禁的是统计术语。
 *  ② 那条判据是拟合当前代码的启发式,假设 Σ 和中文标签之间没有空格。而本仓别处
 *    (poolLedgerLogic.ts:193、PoolLedgerView.vue:1030)恰恰写成「Σ {值} 度」带空格,
 *    那种写法一旦被抄进本目录,门禁当场误报一个完全正当的会计标签。
 *  ③ 一条会误伤正当写法的规矩,会被第一个被它挡住的人删掉 —— 连带把真正管用的那几条
 *    一起删掉。宁可少禁一个从没出过事的字符,也不要让整道门禁失去信任。
 * 出事的是**小写 σ**(见上),它在本仓没有任何正当用途,原样禁着。
 *
 * F9(修复轮2):这道门禁原来只扫得到 .vue 模板。AnomalyView/TenantEnergyView
 * 那四句真正读给用户看的文字,Task 6 修复轮1(F3)已经抽成 monitor.logic.ts /
 * TenantEnergy.logic.ts 里的纯函数(elecReadout/elecBandRef/bandReadout/
 * bandRefText),模板里只剩 `{{ elecBandRef }}` 这样的插值,四条句子写什么禁词
 * 这道门禁都看不见。改法不是全文扫 .logic.ts —— 那两个文件里提 σ、标准差是
 * 正常的(算法注释、变量名),全文扫会大面积误伤,而且会被下一个被误伤的人删掉。
 * 改法是对这四个函数的**返回值**加禁词断言;字数门禁那两条用例已经在调它们了,
 * 断言加在同一处(见下面 READ_MAX / REF_MAX 两条 it)。
 *
 * 残留口子(F9,照实写、不假装堵上):.vue 的 <script> 块里拼一个含禁词的字符串
 * 再插值到模板(例如 `const x = '标准' + '差'` 再 `{{ x }}`),这道门禁仍抓不到——
 * 扫描前把 <script> 整段剥掉了,为的是不误伤变量名与代码注释。这条路目前没人走,
 * 但门禁本身证明不了这件事。
 */
// T2(design-boards 2026-09-11)固定字:驾驶舱护栏图的读数句/参照系小字是 cockpit.logic.ts 抽出的
// 纯函数,同 F9 的盲区(.ana-read/.ana-ref 段落除插值外没有第二个字符)——直接量函数输出即可。
// 数据是实测(park_demo3,锚点 2025-12,见 cockpit.logic.spec.ts 的「I3/I4:2025 实测量级」同一批数)。
const COCKPIT_PNL: PnlSummary = {
  year: 2025,
  months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  revenue: [
    7146649.89, 7169836.30, 6996629.95, 7406069.55, 7537092.36, 7711058.20,
    8249744.52, 8669057.75, 8762619.48, 9301530.81, 9407837.38, -636050.65,
  ],
  cost: new Array(12).fill(null),
  profit: new Array(12).fill(null),
  bySchedule: {},
}
const cockpitFit = fitRevenueTrend(COCKPIT_PNL)
const cockpitMc = mainChart(COCKPIT_PNL, null)!
const cockpitOutlier = outlierResidual(cockpitFit, cockpitMc.rev, cockpitMc.outlierMonths)
// F7(对抗复查):yearOutlookReadout/yearOutlookRefText/backtestReadout/backtestRefText 是驾驶舱
// 「全年会落在哪」「这条带过去准不准」两张卡的读数句/参照系小字——同一处 F9 盲区,改前一条都不在
// 下面两个 cases 数组里,只是恰好在 cockpit.logic.spec.ts 另行断言过才没出事。补进来,与下面
// 「❗F7:cases 完整性」那条断言配套(见该条注释)。BUDGET 锚点与 cockpit.logic.spec.ts 的
// T1/T2/T3 三节同一份(park_demo3 2025 实测,收入总计预算 92,705,202.87)。
const COCKPIT_BUDGET = 92705202.87
const cockpitYearRows = yearOutlookRows(COCKPIT_PNL, cockpitFit, COCKPIT_BUDGET)
const cockpitBacktestRows = backtestRows(COCKPIT_PNL, COCKPIT_BUDGET)
const cockpitBacktestSum = backtestSummary(cockpitBacktestRows)

// T6/T7(design-boards)固定字:「先谈哪几户」「续签率从哪来」「续签率变一档」三张卡的读数句/
// 参照系小字同样是 expiry.logic.ts 抽出的纯函数,同一处 F9 盲区(.ana-read/.ana-ref 除插值外
// 没有第二个字符)——直接量函数输出即可,不必挂载整屏。样本量级不追求业务真实,够用就行。
const PRIORITY_SAMPLE: RentPriorityRow[] = [...Array(10)].map((_, i) => ({
  id: i, contractNo: 'HT' + i, tenantName: '租户' + i, endDate: '2026-08-01', monthlyRent: (10 - i) * 100000, monthsLeft: i,
}))
const SENSITIVITY_SAMPLE = sensitivityRows(2147000, 2179000, 3122000, 0.2)

// T8/T9(design-boards)固定字:「单位租金对标」卡的读数句/参照系小字是 TenantPeer.logic.ts 抽出的
// 纯函数,同一处 F9 盲区(.ana-read/.ana-ref 除插值外没有第二个字符)——直接量函数输出即可。
// 样本量级不追求业务真实,够用(≥MIN_SAMPLE=20)就行。
const PEER_SAMPLE = Array.from({ length: 51 }, (_, i) => 7 + i)   // 7..57,51 份

// T10(design-boards)固定字:「哪些期区能给区间」「同一招式，用在电费上会翻车」两卡的读数句/
// 参照系小字同样是 TenantPeer.logic.ts 抽出的纯函数,同一处 F9 盲区——直接量函数输出即可。
// 数字是今天(asOf=2026-09-11)查库实测的真实口径(见 t10-report.md),不是编的样本量级。
const PHASE_TABLE_SAMPLE: PhaseTableRow[] = [
  { phase: 1, n: 51, median: 23.0, p10: 14.7, p90: 34.5 },
  { phase: 2, n: 17, median: 18.6, p10: null, p90: null },
  { phase: 3, n: 1, median: 19.9, p10: null, p90: null },
  { phase: 4, n: 1, median: 17.4, p10: null, p90: null },
]
const ELEC_SPREAD_SAMPLE: ElecSpread = { period: '2025-12', n: 263, p10: 62.62, p90: 11685.75, max: 101645.94 }

// rentRollSentence/rentRollRefText(合约租金带读数句/参照系小字)固定字——两条门禁与下面的
// 完整性断言共用同一份 fixture,不重复定义。
const ROLL_A: RentRoll = {
  months: [{ month: '2026-09', locked: 2320000, lockedCount: 12, masterLease: 0, renewalLo: 100000, renewalMid: 200000, renewalHi: 300000 }],
  locked: [2320000], lockedBand: undefined, renewalN: 90, renewalHits: 18, renewalP: 0.2,
  expiringCount: 5, expiringRentSum: 500000, expiringList: [], gap: null,
}
const ROLL_B: RentRoll = {
  months: [], locked: [], lockedBand: undefined, renewalN: 90, renewalHits: 18, renewalP: 0.2,
  expiringCount: 0, expiringRentSum: 0, expiringList: [], gap: null,
}

/**
 * F7(对抗复查):字数/禁词门禁的真实覆盖全靠下面 READ_SLOTS/REF_SLOTS 两张手写清单
 * (加 cockpit.logic.spec.ts 里的第三份拷贝),没有任何断言保证这张清单是全的——CockpitView
 * 两张 T3 卡的四条读数句(yearOutlookReadout/yearOutlookRefText/backtestReadout/backtestRefText)
 * 改前一条都不在这里,只是恰好在 cockpit.logic.spec.ts 另行断言过才没出事,下一张卡没这份运气。
 *
 * 判据(❗F7:cases 完整性 一条):
 * 「插值槽」= 全仓 .ana-read / .ana-ref 段落里,除 `{{ xxx }}` 插值外没有第二个字符的那些——
 * 这正是 F9 门禁摸不到渲染结果、必须靠手写清单补的那批。每个插值槽在下面登记成**一个数组**
 * (可能含多个场景,例如 TenantEnergyView 的 bandReadout 按 metric 切换文案,登记两个场景但
 * 是同一个插值槽——多场景不代表多插值槽,按数组分组才不会被"一个槽测两次"误判成两个槽)。
 * 断言 READ_SLOTS.length / REF_SLOTS.length 与全仓插值槽数量逐一相等——漏登记一个新插值槽,
 * 数字对不上,当场红(不追究"是哪一条漏了",只追究"数量还对不对",与 F7 finding 原话"或至少
 * 断言两边条数相等"同一个判据)。
 */
const READ_SLOTS: (string | null)[][] = [
  [elecReadout(500000, { p25: 123456, p75: 987654 })],                        // AnomalyView.vue elecReadout 插值槽
  [bandReadout(500000, 123456, 987654, '电费'), bandReadout(500000, 123456, 987654, '水费')],   // TenantEnergyView.vue bandReadout 插值槽(同一元素,按 metric 切两个场景)
  [rentRollSentence(ROLL_A)],                                                 // ExpiryView.vue rentRollText 插值槽
  [outlierReadout(cockpitFit, cockpitOutlier)],                               // CockpitView.vue outlierRead 插值槽
  [priorityReadout(PRIORITY_SAMPLE, 2179000)],                                // ExpiryView.vue priorityRead 插值槽
  [renewalRateReadout(18, 90)],                                               // ExpiryView.vue renewalRateRead 插值槽
  [sensitivitySentence(SENSITIVITY_SAMPLE)],                                  // ExpiryView.vue sensitivityRead 插值槽
  [sensitivityGapSentence(SENSITIVITY_SAMPLE, 3122000)],                      // ExpiryView.vue sensitivityGapRead 插值槽
  [unitRentReadout(28.11, PEER_SAMPLE, '期区一')],                             // TenantPeerView.vue readout 插值槽
  [phaseTableReadout(PHASE_TABLE_SAMPLE)],                                    // TenantPeerView.vue phaseTableRead 插值槽
  [elecTrapReadout(ELEC_SPREAD_SAMPLE)],                                      // TenantPeerView.vue elecRead 插值槽
  [yearOutlookReadout(cockpitYearRows)],                                      // CockpitView.vue yearRead 插值槽(F7 补登记)
  [backtestReadout(cockpitBacktestSum)],                                      // CockpitView.vue backRead 插值槽(F7 补登记)
]
const REF_SLOTS: string[][] = [
  [elecBandRef(251), elecBandRef(null)],                                      // AnomalyView.vue elecBandRef 插值槽
  [bandRefText(251), bandRefText(null)],                                      // TenantEnergyView.vue bandRefText 插值槽
  [rentRollRefText(ROLL_B)],                                                  // ExpiryView.vue rentRollRef 插值槽
  [outlierRefText(cockpitFit)],                                               // CockpitView.vue outlierRef 插值槽
  [priorityRefText(PRIORITY_SAMPLE, 2179000)],                                // ExpiryView.vue priorityRef 插值槽
  [unitRentRefText(51, '期区一', '2026-09')],                                  // TenantPeerView.vue refText 插值槽
  [phaseTableRefText('2026-09')],                                             // TenantPeerView.vue phaseTableRef 插值槽
  [elecTrapRefText(ELEC_SPREAD_SAMPLE)],                                      // TenantPeerView.vue elecRef 插值槽
  [yearOutlookRefText(cockpitYearRows, COCKPIT_PNL, cockpitFit)],             // CockpitView.vue yearRef 插值槽(F7 补登记)
  [backtestRefText(cockpitBacktestRows)],                                     // CockpitView.vue backRef 插值槽(F7 补登记)
]

const JARGON_SRC = String.raw`σ|标准差|标准偏差|西格玛|z\s*分数|置信`
const JARGON = new RegExp(JARGON_SRC, 'g')   // 扫描用:matchAll 找全部命中位置
const JARGON_ONE = new RegExp(JARGON_SRC)    // 单值断言用:非 global,test() 不留 lastIndex 状态
const JARGON_EXEMPT = new Set(['PvLabTable.vue', 'PvMeterAnaView.vue'])

// F8(修复轮2):原来只扫 src/views/analysis。AnaMethodNote.vue 自己住在
// src/components/ana/,是全仓专门放口径文案的组件,却完全不在门禁内 —— 并进来。
const DIR = join(__dirname, '../analysis')
const DIR2 = join(__dirname, '../../components/ana')
const DIRS = [DIR, DIR2]
const strip = (s: string) =>
  s.replace(/<[^>]*>/g, '').replace(/\{\{[\s\S]*?\}\}/g, '').replace(/\s+/g, '').trim()

function vueFiles(): { dir: string; file: string }[] {
  return DIRS.flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.vue')).map((file) => ({ dir, file })))
}

/** 全仓「插值槽」计数(F7):.ana-read/.ana-ref 段落剥掉标签/插值/空白后是空串,即除 `{{ xxx }}` 外
 *  没有第二个字符——F9 门禁摸不到渲染结果、必须靠 READ_SLOTS/REF_SLOTS 手写清单补的那批。 */
function pureInterpolationSlotCount(re: RegExp): number {
  let n = 0
  for (const { dir, file } of vueFiles()) {
    const src = readFileSync(join(dir, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    for (const m of src.matchAll(re)) if (!strip(m[1] ?? '')) n++
  }
  return n
}

function scan(re: RegExp): { file: string; text: string; len: number }[] {
  const out: { file: string; text: string; len: number }[] = []
  for (const { dir, file: f } of vueFiles()) {
    const src = readFileSync(join(dir, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    for (const m of src.matchAll(re)) {
      const t = strip(m[1] ?? '')
      if (t) out.push({ file: f, text: t, len: [...t].length })
    }
  }
  return out
}

/**
 * I6(对抗复查):hint 段落必须**配平** `<span>` 才量得准。
 *
 * 原写法是 `scan(/class="hint"[^>]*>([\s\S]*?)<\/span>/g)`,非贪婪 —— 遇到内层再套一个
 * `<span class="hint-desk">…</span>` 就停在**内层**那个 `</span>`,外层剩下的字一个都没量到。
 * 实测(2026-09-11,改前 vs 配平后):
 *   TenantPortfolioView.vue  量到 7 字  → 实际 58 字
 *   TenantEnergyView.vue     量到 5 字  → 实际 42 字
 *   CockpitView.vue          量到 21 字 → 实际 30 字
 *   PnlAnalysisView.vue      量到 8 字  → 实际 18 字
 * 分析层最长的那条 hint 被量成了 7 个字,而它就在本分支刚改短过的屏上。
 *
 * 做法:从带 class="hint" 的开标签起往后走,`<span` 加一、`</span>` 减一,归零处才是本段的结尾。
 * (`class="hint-desk"` 不会被误当成 hint —— 判据要求引号闭合的 `class="hint"`。)
 */
function hintTexts(): { file: string; text: string; len: number }[] {
  const out: { file: string; text: string; len: number }[] = []
  for (const { dir, file: f } of vueFiles()) {
    const src = readFileSync(join(dir, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    for (const open of src.matchAll(/<span[^>]*class="hint"[^>]*>/g)) {
      const bodyStart = open.index! + open[0].length
      const tagRe = /<span\b|<\/span>/g
      tagRe.lastIndex = bodyStart
      let depth = 1, tag: RegExpExecArray | null
      while ((tag = tagRe.exec(src)) !== null) {
        depth += tag[0] === '</span>' ? -1 : 1
        if (depth === 0) break
      }
      const t = strip(src.slice(bodyStart, tag ? tag.index : src.length))
      if (t) out.push({ file: f, text: t, len: [...t].length })
    }
  }
  return out
}

describe('分析层文案门禁', () => {
  it(`❗卡头 hint ≤ ${HINT_MAX} 可见字 —— 超标处只许减少`, () => {
    const over = hintTexts().filter((x) => x.len > HINT_MAX)
    expect(
      over.length,
      `超标 ${over.length} 处(基线 ${HINT_OVER_BASELINE}):\n` +
        over.map((x) => `  ${x.file} ${x.len}字 ${x.text.slice(0, 30)}`).join('\n'),
    ).toBeLessThanOrEqual(HINT_OVER_BASELINE)
  })

  /**
   * ❗I6 的真正判据:上面那条是「≤ 基线」,量得**少**它不会红 —— 缺陷正是「量少了」,
   * 所以把取法换回非贪婪版,上面那条照样全绿(实测过:28 ≤ 31)。
   * 能当场变红的判据只能钉在**取法本身**上:配平版对同一批段落,每段都不该比非贪婪版短,
   * 且在那几处内层套了 `<span class="hint-desk">` 的 hint 上必须更长。
   * 不写死字数(那几条 hint 本来就该继续变短,写死会在做对事的时候变红)。
   */
  it('❗I6:hint 取法必须配平 <span> —— 与非贪婪取法对照,配平版不更短,且在嵌套处更长', () => {
    const naive = scan(/class="hint"[^>]*>([\s\S]*?)<\/span>/g)
    const balanced = hintTexts()
    expect(balanced.length, '两种取法抓到的 hint 段数应当一致,只是每段量到哪里不同').toBe(naive.length)
    balanced.forEach((b, i) => {
      expect(b.len, `${b.file}: 配平取法反而更短了 —— 取法写错了`).toBeGreaterThanOrEqual(naive[i].len)
    })
    const nested = balanced.filter((b, i) => b.len > naive[i].len).map((b) => b.file)
    for (const f of ['TenantPortfolioView.vue', 'TenantEnergyView.vue', 'CockpitView.vue', 'PnlAnalysisView.vue'])
      expect(nested, `${f} 的 hint 内层套了 <span>,非贪婪取法必定少量,这里却没测出差异`).toContain(f)
  })

  it(`❗读数句 .ana-read ≤ ${READ_MAX} 可见字`, () => {
    const over = scan(/class="ana-read"[^>]*>([\s\S]*?)<\/p>/g).filter((x) => x.len > READ_MAX)
    expect(over.map((x) => `${x.file}:${x.len}字`)).toEqual([])
  })

  // 卡级切块:以 class="av2-card"(可带后续类名)开头的标签为卡片分界,
  // 每块从本卡开始切到下一卡开始(或文件尾)。同屏多卡是常态(AnomalyView/ChurnView
  // 等一屏 3~5 张 av2-card),file 级判据会被别的卡的 .ana-ref 顺便糊过去。
  // 已知盲区(手写模板上的简单切法,不是 parser):
  //   1) 卡嵌卡(av2-card 内部再套一层 av2-card)会被当成又开一张新卡,
  //      提前截断外层卡的内容;
  //   2) 开标签跨行(class 属性换行书写)时,单行正则抓不到分界,那张卡
  //      会被并入上一张。
  // 目前全仓 av2-card 开标签都在同一行、且不互相嵌套,两条盲区暂未命中。
  // 盲区 3:切片从第一张卡的起点开始,文件里第一张 av2-card 之前的内容不进任何切片
  // ——可接受,因为 .ana-read 只会出现在卡体内,不会写在卡外。
  const CARD_RE = /class="av2-card(?=[ "])/g
  function splitCards(src: string): { start: number; text: string }[] {
    const starts = [...src.matchAll(CARD_RE)].map((m) => m.index!)
    if (starts.length === 0) return [{ start: 0, text: src }]
    return starts.map((s, i) => ({ start: s, text: src.slice(s, starts[i + 1] ?? src.length) }))
  }
  const lineOf = (src: string, idx: number) => src.slice(0, idx).split('\n').length

  it('❗带 % 的读数句,同一张卡里必须找得到样本量 —— 否则就是把「样本 5」包装成一个小数点', () => {
    const bad: string[] = []
    for (const { dir, file: f } of vueFiles()) {
      const src = readFileSync(join(dir, f), 'utf8')
      for (const { start, text } of splitCards(src)) {
        const reads = [...text.matchAll(/class="ana-read"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1])
        const pctRead = reads.find((r) => r.includes('%'))
        if (!pctRead) continue
        if (!/class="ana-ref"/.test(text)) bad.push(`${f}:${lineOf(src, start)} ${strip(pctRead).slice(0, 20)}`)
      }
    }
    expect(bad, `这些卡片印了百分数却没有参照系小字: ${bad.join(' | ')}`).toEqual([])
  })

  /**
   * 用户 2026-09-12 拆掉 ⓘ 口径浮层之后的替代判据。
   *
   * 这里原有四道门禁,判据都落在「浮层正文里必须写着某句话」上。浮层没了,那四道跟着删 ——
   * 但其中一条守的东西必须换个形式留下:「续签率变一档」卡的四档判词借了「盈亏平衡」这个词,
   * 而它跟「盈亏平衡与敏感性」屏那个由成本结构(固定成本/边际贡献率)算出的真保本点没有任何
   * 数值关系。见过那一屏、又照字面读这张表的人,会得出「园区要亏了」的结论,比实际严重得多。
   *
   * 原来的做法是在浮层里声明「这个不是那一个」。现在改成**根本不借这个词**(判词已改成
   * 「明显偏低」),判据也跟着简单:除了盈亏平衡屏自己,分析层不许再出现它。
   * 不借词比解释借词更防回归 —— 没有词就没有误读,也不依赖谁去点开一层折叠。
   */
  it('❗「盈亏平衡」只许出现在盈亏平衡屏 —— 别处借这个词会被读成那个真保本点', () => {
    const bad: string[] = []
    for (const { dir, file: f } of vueFiles()) {
      if (f === 'BreakevenView.vue') continue
      if (/盈亏平衡/.test(readFileSync(join(dir, f), 'utf8'))) bad.push(f)
    }
    expect(bad, `这些文件借用了「盈亏平衡」: ${bad.join(' | ')}`).toEqual([])
    // 判词本身也钉住 —— 它住在 expiry.logic.ts 里,上面那圈扫 .vue 扫不到。
    for (const r of SENSITIVITY_SAMPLE) expect(r.verdict).not.toContain('盈亏平衡')
  })

  /**
   * F5(对抗复查):「单位租金对标」卡从头到尾叫「单位租金」的那个数,其实含管理费/基础维护/
   * 电梯/变压器等五费项合计,比真正的租金单价高约 36%——改前只有折叠的 ⓘ 浮层里说清楚这件事,
   * 卡头/hint/读数句这些屏上直接可见的地方全没提「含费」,谈判桌上没人会点开 ⓘ。
   * 判据钉住:这张卡未折叠处(卡头 hint、.ana-read、.ana-ref——不含 AnaMethodNote 内文)
   * 只要提了「租金」,就必须在同一处出现「含费」,不能只藏在折叠的浮层里。
   */
  it('❗F5:「单位租金对标」卡未折叠处提了"租金"就必须同处出现"含费"——不能只藏在折叠的 ⓘ 浮层里', () => {
    const src = readFileSync(join(DIR, 'TenantPeerView.vue'), 'utf8')
    const card = splitCards(src).find((c) => /class="t">单位租金对标/.test(c.text))
    expect(card, 'TenantPeerView.vue 里找不到「单位租金对标」那张卡').toBeTruthy()
    const body = card!.text.replace(/<!--[\s\S]*?-->/g, '')
    const note = /<AnaMethodNote[^>]*>[\s\S]*?<\/AnaMethodNote>/.exec(body)
    const unfolded = note ? body.slice(0, note.index) + body.slice(note.index! + note[0].length) : body
    expect(unfolded, '未折叠处压根没提"租金"——门禁本身失去意义,检查卡是不是改了名字').toContain('租金')
    expect(unfolded, '未折叠处提了"租金"却没有"含费"——读者会拿它当纯租金单价去谈判').toContain('含费')
  })

  // AnomalyView.vue / TenantEnergyView.vue 是本仓明确的「零挂载测」屏(anaDeepLink.spec.ts 头注:
  // echarts + anaData 太重),上面 scan() 的 strip() 又把 `{{ elecReadout }}` 这类插值整个删掉,
  // ≤30 字预算在这两句上等于没测。但 .ana-read 段落除插值外没有第二个字符
  // (`<p v-if="elecReadout" class="ana-read">{{ elecReadout }}</p>`),
  // 渲染结果字符对字符等于这两个纯函数的返回值 —— 直接量函数输出就是量渲染结果,不必为此单开挂载测。
  it('❗读数句渲染结果(不是插值源码)也要 ≤30 可见字,且不含禁词(F9:门禁扫不到 .logic.ts,直接量函数输出)', () => {
    for (const s of READ_SLOTS.flat()) {
      expect(s, '这几个入参本该出句,不该闭嘴').not.toBeNull()
      expect([...(s as string)].length, s ?? '').toBeLessThanOrEqual(READ_MAX)
      expect(s, s ?? '').not.toMatch(JARGON_ONE)
    }
  })

  // F4(修复轮1):上面那条只量了 .ana-read,.ana-ref 躲过了门禁(超标的正好是躲过去的那两条,
  // 不是巧合)。F3 把 elecBandRef/bandRefText 抽成纯函数后,`<p class="ana-ref">{{ ... }}</p>`
  // 同样除插值外没有第二个字符,量函数输出即量渲染结果 —— 用上面同一手法补上。
  it('❗参照系小字渲染结果也要 ≤28 可见字,且不含禁词(F4:.ana-ref 补上跟 .ana-read 一样的门禁;F9:同一处补禁词断言)', () => {
    for (const s of REF_SLOTS.flat()) {
      expect([...s].length, s).toBeLessThanOrEqual(REF_MAX)
      expect(s, s).not.toMatch(JARGON_ONE)
    }
  })

  it('❗F7:cases 清单完整性——全仓「插值槽」(.ana-read/.ana-ref 除插值外没有第二个字符)数量,'
    + '必须与 READ_SLOTS/REF_SLOTS 登记的槽位数逐一相等,漏登记一个新插值槽就当场红', () => {
    const pureRead = pureInterpolationSlotCount(/class="ana-read"[^>]*>([\s\S]*?)<\/p>/g)
    const pureRef = pureInterpolationSlotCount(/class="ana-ref"[^>]*>([\s\S]*?)<\/p>/g)
    expect(pureRead, `全仓 ${pureRead} 处纯插值 .ana-read,READ_SLOTS 只登记了 ${READ_SLOTS.length} 个槽位`)
      .toBe(READ_SLOTS.length)
    expect(pureRef, `全仓 ${pureRef} 处纯插值 .ana-ref,REF_SLOTS 只登记了 ${REF_SLOTS.length} 个槽位`)
      .toBe(REF_SLOTS.length)
  })

  /** N4(修复轮2):C2 把 bandTooWide 整个删掉了,expiry.logic.ts 里还留着一处点名它的注释
   *  (round1 扫掉另外四处时漏掉的第五处,还恰好是那次改法引作先例的那段)。判据很直接:
   *  这个已删符号的名字不该再出现在这个文件里。 */
  it('❗N4:expiry.logic.ts 不再点名已删的 bandTooWide', () => {
    const src = readFileSync(join(DIR, 'expiry.logic.ts'), 'utf8')
    expect(src).not.toContain('bandTooWide')
  })

  /**
   * N5 原来钉的是 TenantEnergyView 口径浮层里那句「本图不印…判断句」少报了一支(lo<=0 时
   * 高于/落在/低于三支全闭嘴,浮层只说了两支)。浮层 2026-09-12 拆掉,这条跟着删 ——
   * 它守的**行为**由 TenantEnergy.logic.spec.ts 的「I9」那条直接钉在 bandReadout 上,
   * 那里拿实测量级的均值与波动幅度喂进去,断言三支都返回 null,比数浮层里的字牢靠。
   */

  // JARGON / JARGON_EXEMPT 定义见文件顶部(D2 doc comment,F7/F8/F9 修复轮2 的改动理由都写在那)。
  // F8(对抗复查):标题曾经承诺连大写 Σ 也禁,判据(JARGON_SRC,见文件头 D2 doc comment)其实
  // 没有 Σ——Σ 在本仓是求和号,是有意放行的正当写法,撤禁的理由写在上面 D2 注释里。标题原文
  // 一度包含「Σ」,读测试列表的人会以为它已被禁,不会再去看六十行外的 doc comment。
  // 改法只是让名字与判据对上,不加新断言。
  it('❗屏上不许出现 σ / 标准差 / 标准偏差 / 西格玛 / z分数 / 置信(Σ 作为求和号有意放行,理由见文件头 D2)', () => {
    const bad: string[] = []
    for (const { dir, file: f } of vueFiles()) {
      if (JARGON_EXEMPT.has(f)) continue
      const tpl = readFileSync(join(dir, f), 'utf8')
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
      for (const m of tpl.matchAll(JARGON)) {
        const line = tpl.slice(0, m.index).split('\n').length
        bad.push(`  ${f} 模板第 ${line} 行附近: ${m[0]}`)
      }
    }
    expect(bad.length, `屏上出现统计符号 ${bad.length} 处:\n${bad.join('\n')}`).toBe(0)
  })

  /**
   * 用户 2026-09-12:屏上不许提设计稿。
   *
   * 出事的是三处口径文案:「设计稿标注的续签率 20%(18/90)按今天的库口径查不出」、
   * 「不是设计稿的 20%」、「board-peer.txt 只给了单位租金这一页的规格」。三处都在讲
   * **我做这屏时的过程**,而不是用户看的数 —— 稿里的数字是占位,占位数和实测数对不上
   * 是实现期的事,不该出现在产品里;`board-peer.txt` 更是工作区里的文件名。
   *
   * 判据只看模板不看 <script> 与注释:代码注释里写明这块出自哪张稿是正当的溯源。
   */
  it('❗屏上(含 ⓘ 浮层)不许提设计稿/视觉稿/board-*.txt —— 稿是实现期的东西,不是给用户看的', () => {
    const BOARD_REF = /设计稿|视觉稿|稿上|board-\w+\.txt/g
    const bad: string[] = []
    for (const { dir, file: f } of vueFiles()) {
      const tpl = readFileSync(join(dir, f), 'utf8')
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
      for (const m of tpl.matchAll(BOARD_REF)) {
        const line = tpl.slice(0, m.index).split('\n').length
        bad.push(`  ${f} 模板第 ${line} 行附近: ${m[0]}`)
      }
    }
    expect(bad.length, `屏上提到设计稿 ${bad.length} 处:\n${bad.join('\n')}`).toBe(0)
  })
})
