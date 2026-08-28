import { describe, it, expect, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { iconFor } from '../icon'

/**
 * `iconFor()` 对没登记的名字**不报错**，只 console.warn 一句然后画个问号圈。
 *
 * 于是写错/没登记的图标能一路活到线上:界面上就是个问号,谁也不会当成 bug 报上来。
 * 'sigma'(利润表「利润总额」KPI)就这么静默兜底了好几个版本 —— 从 c6e53c5 加上那天起,
 * 一直到有测试第一次 mount 这块屏才在输出里露出那行 warn。
 *
 * 所以把「全仓所有 iconFor('字面量') 都必须在 MAP 里」钉成一条测试:
 * 加图标忘了登记,这里当场红,而不是等谁哪天正好点开那块屏。
 */
const SRC = `${process.cwd()}/src`   // vitest root = frontend/

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(`${dir}/${e.name}`)
      : /\.(vue|ts)$/.test(e.name) ? [`${dir}/${e.name}`] : [])
}

describe('ds/icon —— iconFor 的名字必须都登记过', () => {
  it('全仓 iconFor(\'字面量\') 没有一个走兜底', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const missing: string[] = []
    for (const f of walk(SRC)) {
      for (const m of readFileSync(f, 'utf8').matchAll(/iconFor\((['"])([a-z0-9-]+)\1\)/g)) {
        warn.mockClear()
        iconFor(m[2])
        if (warn.mock.calls.length) missing.push(`${m[2]} @ ${f.slice(SRC.length)}`)
      }
    }
    warn.mockRestore()
    expect(missing, '这些图标名不在 icon.ts 的 MAP 里').toEqual([])
  })
})
