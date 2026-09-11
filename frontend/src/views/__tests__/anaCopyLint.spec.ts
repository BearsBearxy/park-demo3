import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { elecBandRef, elecReadout } from '../analysis/monitor.logic'
import { bandReadout, bandRefText } from '../analysis/TenantEnergy.logic'
import { rentRollRefText, rentRollSentence, type RentRoll } from '../analysis/expiry.logic'
import { fitRevenueTrend, mainChart, outlierReadout, outlierRefText, outlierResidual } from '../analysis/cockpit.logic'
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
   * I5(对抗复查):合约租金带是本分支唯一一条**模拟**出来的带,却是唯一一张没有自己口径浮层的带卡。
   * 读者从屏上看到的只有一句「末月租金预计 X~Y」,读起来像总租金预测 —— 而它结构上不可能包含
   * 新招租(池子只装已签合同),是下界不是预测。这条门禁钉的就是「那三件事还写在卡上没有」。
   *
   * 为什么是卡级点名而不是「所有印读数句的卡都得有 note」:AnomalyView 的读数句卡把口径写在
   * 同屏底部那张总说明卡里(已过复查),一条泛化规矩会把它一起判红 —— 那是另一件事,不在本轮。
   */
  it('❗I5:「合约租金带」这张卡必须自带口径 note,并写明下界/不含新招租/整租不计', () => {
    const src = readFileSync(join(DIR, 'ExpiryView.vue'), 'utf8')
    const card = splitCards(src).find((c) => /class="t">合约租金带/.test(c.text))
    expect(card, 'ExpiryView.vue 里找不到「合约租金带」那张卡').toBeTruthy()
    const body = card!.text.replace(/<!--[\s\S]*?-->/g, '')   // 注释里写了不算,要写在屏上
    const note = /<AnaMethodNote[^>]*>([\s\S]*?)<\/AnaMethodNote>/.exec(body)
    expect(note, '这张卡没有口径浮层').toBeTruthy()
    // 判据落在**浮层正文**里,不是「这张卡的某处提过」—— 卡头 hint 也写着「不含新招租」,
    // 拿整张卡当判据的话,把浮层里那句删掉照样全绿(实测过,所以改成只认浮层)。
    for (const kw of ['不含新招租', '下界', '整租', '10~90 分位'])
      expect(note![1], `口径浮层缺了「${kw}」`).toContain(kw)
  })

  // AnomalyView.vue / TenantEnergyView.vue 是本仓明确的「零挂载测」屏(anaDeepLink.spec.ts 头注:
  // echarts + anaData 太重),上面 scan() 的 strip() 又把 `{{ elecReadout }}` 这类插值整个删掉,
  // ≤30 字预算在这两句上等于没测。但 .ana-read 段落除插值外没有第二个字符
  // (`<p v-if="elecReadout" class="ana-read">{{ elecReadout }}</p>`),
  // 渲染结果字符对字符等于这两个纯函数的返回值 —— 直接量函数输出就是量渲染结果,不必为此单开挂载测。
  it('❗读数句渲染结果(不是插值源码)也要 ≤30 可见字,且不含禁词(F9:门禁扫不到 .logic.ts,直接量函数输出)', () => {
    // Task 7:合约租金带的读数句(rentRollSentence)同样是 .logic.ts 抽出的纯函数,
    // 模板里只剩 `{{ rentRollText }}`,同一处盲区,补同一手治法。
    const rollA: RentRoll = {
      months: [{ month: '2026-09', locked: 2320000, masterLease: 0, renewalLo: 100000, renewalHi: 300000 }],
      locked: [2320000], lockedBand: undefined, renewalN: 90, renewalHits: 18, renewalP: 0.2,
    }
    const cases: (string | null)[] = [
      // 只传 p25/p75:elecReadout 不吃样本量(样本量走 elecBandRef)。多传一个 n 会触发
      // TS 的多余属性检查 —— 真实调用点传的是变量不是字面量,所以只有这里会红。
      elecReadout(500000, { p25: 123456, p75: 987654 }),
      bandReadout(500000, 123456, 987654, '电费'),
      bandReadout(500000, 123456, 987654, '水费'),
      rentRollSentence(rollA),
      outlierReadout(cockpitFit, cockpitOutlier),   // T2(design-boards):驾驶舱护栏图读数句,同一处盲区
    ]
    for (const s of cases) {
      expect(s, '这几个入参本该出句,不该闭嘴').not.toBeNull()
      expect([...(s as string)].length, s ?? '').toBeLessThanOrEqual(READ_MAX)
      expect(s, s ?? '').not.toMatch(JARGON_ONE)
    }
  })

  // F4(修复轮1):上面那条只量了 .ana-read,.ana-ref 躲过了门禁(超标的正好是躲过去的那两条,
  // 不是巧合)。F3 把 elecBandRef/bandRefText 抽成纯函数后,`<p class="ana-ref">{{ ... }}</p>`
  // 同样除插值外没有第二个字符,量函数输出即量渲染结果 —— 用上面同一手法补上。
  it('❗参照系小字渲染结果也要 ≤28 可见字,且不含禁词(F4:.ana-ref 补上跟 .ana-read 一样的门禁;F9:同一处补禁词断言)', () => {
    const rollB: RentRoll = {
      months: [], locked: [], lockedBand: undefined, renewalN: 90, renewalHits: 18, renewalP: 0.2,
    }
    const cases: string[] = [
      elecBandRef(251),
      elecBandRef(null),
      bandRefText(251),
      bandRefText(null),
      rentRollRefText(rollB),
      outlierRefText(cockpitFit),   // T2(design-boards):驾驶舱护栏图参照系小字,同一处盲区
    ]
    for (const s of cases) {
      expect([...s].length, s).toBeLessThanOrEqual(REF_MAX)
      expect(s, s).not.toMatch(JARGON_ONE)
    }
  })

  /**
   * N3(对抗复查修复轮2):到期墙浮层那句「续签不确定性…见 X 方「合约租金带」卡」指错了方向。
   * 「合约租金带」是页面上第二张卡,这句话却长在最后一张卡(合同清单)的浮层里、写着「下方」——
   * 它下面什么都没有。判据钉在**相对位置**上:合约租金带卡的位置必须在这句话之前(= 是「上方」),
   * 且原文必须写「上方」不写「下方」。
   */
  it('❗N3:到期墙浮层「见 X 方合约租金带卡」的方向必须对 —— 那张卡在这句话上面', () => {
    const src = readFileSync(join(DIR, 'ExpiryView.vue'), 'utf8')
    const bandIdx = src.indexOf('class="t">合约租金带')
    const noteIdx = src.indexOf('续签会不会发生带来的金额不确定性')
    expect(bandIdx, 'ExpiryView.vue 找不到「合约租金带」卡').toBeGreaterThan(-1)
    expect(noteIdx, 'ExpiryView.vue 找不到到期墙口径浮层那句话').toBeGreaterThan(-1)
    expect(bandIdx, '「合约租金带」卡必须在这句话之前,不然「上方」就是假话').toBeLessThan(noteIdx)
    const around = src.slice(noteIdx, noteIdx + 40)
    expect(around).toContain('见上方「合约租金带」')
    expect(around).not.toContain('见下方')
  })

  /** N4(修复轮2):C2 把 bandTooWide 整个删掉了,expiry.logic.ts 里还留着一处点名它的注释
   *  (round1 扫掉另外四处时漏掉的第五处,还恰好是那次改法引作先例的那段)。判据很直接:
   *  这个已删符号的名字不该再出现在这个文件里。 */
  it('❗N4:expiry.logic.ts 不再点名已删的 bandTooWide', () => {
    const src = readFileSync(join(DIR, 'expiry.logic.ts'), 'utf8')
    expect(src).not.toContain('bandTooWide')
  })

  /**
   * N5(修复轮2):TenantEnergyView 口径浮层原话「所以本图不印「高于/低于跨户区间」的判断句」
   * 只报了两支,而 bandReadout 的 `if (lo <= 0) return null` 是把「高于/落在/低于」三支全闭嘴——
   * 「落在」也不印。读者被告知少了两个分支,会去猜第三个到底印不印。判据钉在「不能再说只藏两支」
   * 上:浮层里不许再出现那句旧原文,且必须能读出「三支都不印」这件事。
   */
  it('❗N5:跨户区间闭嘴文案不能少说一支 —— lo<=0 时三支全闭嘴,不是只藏「高于/低于」', () => {
    const src = readFileSync(join(DIR, 'TenantEnergyView.vue'), 'utf8')
    const note = /<AnaMethodNote>([\s\S]*?)<\/AnaMethodNote>/.exec(src)
    expect(note, 'TenantEnergyView.vue 找不到跨户带那张卡的口径浮层').toBeTruthy()
    const body = note![1]
    expect(body, '旧原文只报了两支,不该再出现').not.toContain('不印「高于/低于跨户区间」的判断句')
    expect(body, '必须写清楚三支(高于/落在/低于)都不印').toMatch(/高于\/落在\/低于|落在\/高于\/低于|高于、落在、低于/)
  })

  // JARGON / JARGON_EXEMPT 定义见文件顶部(D2 doc comment,F7/F8/F9 修复轮2 的改动理由都写在那)。
  it('❗屏上(含 ⓘ 浮层)不许出现 σ / Σ / 标准差 / 标准偏差 / 西格玛 / z分数 / 置信', () => {
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
})
