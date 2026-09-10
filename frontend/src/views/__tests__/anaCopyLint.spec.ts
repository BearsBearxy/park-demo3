import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { elecReadout } from '../analysis/monitor.logic'
import { bandReadout } from '../analysis/TenantEnergy.logic'

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
const READ_MAX = 30
const HINT_OVER_BASELINE = 28   // ⚠ 只许改小

const DIR = join(__dirname, '../analysis')
const strip = (s: string) =>
  s.replace(/<[^>]*>/g, '').replace(/\{\{[\s\S]*?\}\}/g, '').replace(/\s+/g, '').trim()

function scan(re: RegExp): { file: string; text: string; len: number }[] {
  const out: { file: string; text: string; len: number }[] = []
  for (const f of readdirSync(DIR)) {
    if (!f.endsWith('.vue')) continue
    const src = readFileSync(join(DIR, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
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
    for (const f of readdirSync(DIR)) {
      if (!f.endsWith('.vue')) continue
      const src = readFileSync(join(DIR, f), 'utf8')
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
  it('❗读数句渲染结果(不是插值源码)也要 ≤30 可见字', () => {
    const cases: (string | null)[] = [
      elecReadout(500000, { p25: 123456, p75: 987654, n: 23 }),
      bandReadout(500000, 123456, 987654, '电费'),
      bandReadout(500000, 123456, 987654, '水费'),
    ]
    for (const s of cases) {
      expect(s, '这几个入参本该出句,不该闭嘴').not.toBeNull()
      expect([...(s as string)].length, s ?? '').toBeLessThanOrEqual(READ_MAX)
    }
  })
})
