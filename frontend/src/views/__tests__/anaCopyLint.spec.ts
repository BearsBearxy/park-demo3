import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 分析层文案门禁(FORECAST-BAND-AND-PLAIN-SENTENCE §3.4)。
 *
 * 判据口径**先定死**:「可见字符数」= 剥掉 HTML 标签、{{ }} 插值、v-* 指令后剩下的字符数。
 * 不用「纯中文字符数」—— 按那个判,稿自己举的旗舰例子 AnomalyView 那条(剥插值后中文 19 字)
 * 根本抓不到,门禁形同虚设。
 *
 * 起点写死在断言里:立档当天 hint 超标 40 处。往下降,不许往上涨。
 */
const HINT_MAX = 24
const READ_MAX = 30
const HINT_OVER_BASELINE = 30   // ⚠ 只许改小

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

  it('❗带 % 的读数句,同一个文件里必须找得到样本量 —— 否则就是把「样本 5」包装成一个小数点', () => {
    const bad: string[] = []
    for (const f of readdirSync(DIR)) {
      if (!f.endsWith('.vue')) continue
      const src = readFileSync(join(DIR, f), 'utf8')
      const reads = [...src.matchAll(/class="ana-read"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1])
      if (!reads.some((r) => r.includes('%'))) continue
      if (!/class="ana-ref"/.test(src)) bad.push(f)
    }
    expect(bad, `这些屏印了百分数却没有参照系小字: ${bad.join(', ')}`).toEqual([])
  })
})
