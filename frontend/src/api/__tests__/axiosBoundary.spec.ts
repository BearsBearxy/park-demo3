// axios 边界门禁:全站只有 api/index.ts 能 import axios(docs/design/SCAFFOLD.md §3.1)。
//
// 为什么锁这一条:令牌注入、信封解包、会话漂移检测(SessionDriftError)全挂在 api/index.ts 那一个
// http 实例的拦截器上。屏或 store 里自己 import axios 发请求,这三件事一件都不会发生 ——
// 不带令牌直接 401,或者把 {code,message,data} 整个信封当数据渲染。2026-09-17 实测只有
// api/index.ts 一处,在这里锁死。
//
// 静态扫源码,不跑请求;测试文件不算(它们可能要 mock axios)。
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SRC = join(__dirname, '..', '..')               // → frontend/src
const ALLOWED = 'api/index.ts'

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === '__fixtures__') continue
      out.push(...walk(p))
    } else if ((p.endsWith('.ts') || p.endsWith('.vue')) && !p.endsWith('.spec.ts')) {
      out.push(p)
    }
  }
  return out
}

// from 'axios' / import 'axios' / import('axios') / require('axios'),含 axios/子路径
const AXIOS_RE = /\b(?:from|import|require)\s*\(?\s*['"]axios(?:\/[^'"]*)?['"]/

const rel = (p: string) => relative(SRC, p).split(sep).join('/')

describe('axios 只在 api/index.ts 里出现', () => {
  const files = walk(SRC)

  it('扫描面不为空(防止目录改名后本测试静默失效)', () => {
    expect(files.length).toBeGreaterThan(200)
  })

  it('阳性对照:api/index.ts 能被正则认出来', () => {
    expect(AXIOS_RE.test(readFileSync(join(SRC, ALLOWED), 'utf8'))).toBe(true)
  })

  it('除 api/index.ts 外没有文件 import axios —— 请求一律走 api/<域>.ts', () => {
    const bad = files.map(rel).filter((f) => f !== ALLOWED && AXIOS_RE.test(readFileSync(join(SRC, f), 'utf8')))
    expect(bad).toEqual([])
  })
})
