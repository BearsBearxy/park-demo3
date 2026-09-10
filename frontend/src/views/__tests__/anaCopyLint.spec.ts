import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { elecBandRef, elecReadout } from '../analysis/monitor.logic'
import { bandReadout, bandRefText } from '../analysis/TenantEnergy.logic'

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
const HINT_OVER_BASELINE = 28   // ⚠ 只许改小

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

describe('分析层文案门禁', () => {
  it(`❗卡头 hint ≤ ${HINT_MAX} 可见字 —— 超标处只许减少`, () => {
    const over = scan(/class="hint"[^>]*>([\s\S]*?)<\/span>/g).filter((x) => x.len > HINT_MAX)
    expect(
      over.length,
      `超标 ${over.length} 处(基线 ${HINT_OVER_BASELINE}):\n` +
        over.map((x) => `  ${x.file} ${x.len}字 ${x.text.slice(0, 30)}`).join('\n'),
    ).toBeLessThanOrEqual(HINT_OVER_BASELINE)
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

  // AnomalyView.vue / TenantEnergyView.vue 是本仓明确的「零挂载测」屏(anaDeepLink.spec.ts 头注:
  // echarts + anaData 太重),上面 scan() 的 strip() 又把 `{{ elecReadout }}` 这类插值整个删掉,
  // ≤30 字预算在这两句上等于没测。但 .ana-read 段落除插值外没有第二个字符
  // (`<p v-if="elecReadout" class="ana-read">{{ elecReadout }}</p>`),
  // 渲染结果字符对字符等于这两个纯函数的返回值 —— 直接量函数输出就是量渲染结果,不必为此单开挂载测。
  it('❗读数句渲染结果(不是插值源码)也要 ≤30 可见字,且不含禁词(F9:门禁扫不到 .logic.ts,直接量函数输出)', () => {
    const cases: (string | null)[] = [
      elecReadout(500000, { p25: 123456, p75: 987654, n: 23 }),
      bandReadout(500000, 123456, 987654, '电费'),
      bandReadout(500000, 123456, 987654, '水费'),
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
    const cases: string[] = [
      elecBandRef(251),
      elecBandRef(null),
      bandRefText(251),
      bandRefText(null),
    ]
    for (const s of cases) {
      expect([...s].length, s).toBeLessThanOrEqual(REF_MAX)
      expect(s, s).not.toMatch(JARGON_ONE)
    }
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
