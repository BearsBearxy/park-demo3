// 审核闸的**入口**覆盖率门禁(SIDEBAR-UX-REDESIGN §7.5,R2 T4c)。
//
// R1 有一份 ReviewGuardCoverageTest 守后端写路径。这一份守的是另一半:**屏上的入口**。
// 漏一屏的表现是最坏的那种假绿 —— 清单上写着「已审核」,而那一屏的编辑按钮照样能点,
// 人照改照存,一路走到后端才被 423 挡回来(如果那条写路径也漏了,就连挡都没有)。
//
// 判据从**源码**推导,不手写清单(stage-review 2026-08-31 新1 的教训:手写清单会跟着代码烂)。
// 三条不许省(照 R1 那份的教训):
//   ① 任何一步解析不出来一律 fail() 并点名是哪个 kind / 哪个文件,不许 continue
//   ② 扫到的文件数有下限断言,防空扫
//   ③ 白名单(不进审核的屏)写死并断言理由非空 —— 它是例外不是常态
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SRC = resolve(__dirname, '../..')                       // frontend/src
const REPO = resolve(SRC, '../..')                            // 仓库根

/** 后端 ReviewKind 枚举里的 14 个 code —— **从 Java 源码读**,不在这里抄一份。
 *  抄一份的话,后端加了第 15 个 kind 而没有屏声明它,这份门禁一声不吭。 */
function backendKinds(): string[] {
  const p = join(REPO, 'backend/src/main/java/com/park/demo3/security/ReviewKind.java')
  const src = readFileSync(p, 'utf8')
  // 形如 `PARAMS        ("params",         "计费参数", ...` —— 取每个枚举常量的第一个字符串
  // ⚠ `[A-Z_0-9]+` 不是 `[A-Z_]+`:枚举常量 S10 带数字,少了 0-9 会**静默漏掉 s10** ——
  //   头一版就漏了,靠下面那条「解析不出 14 个就 fail」抓出来的。这正是那条规矩存在的理由。
  const kinds = [...src.matchAll(/^\s{4}[A-Z_0-9]+\s*\(\s*"([a-z0-9-]+)"/gm)].map(m => m[1])
  expect(kinds.length, `没能从 ReviewKind.java 解析出 kind 列表(解析不出来就是这份门禁失效了,不许放过):${p}`)
    .toBeGreaterThanOrEqual(14)
  return kinds
}

/** 递归收 .vue / .ts,跳过测试文件。 */
function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) collect(p, out)
    else if ((p.endsWith('.vue') || p.endsWith('.ts')) && !p.endsWith('.spec.ts')) out.push(p)
  }
  return out
}

/**
 * 审核键的声明处。三条编辑闸各有各的写法,都在这里认:
 *   · useEditMode 的 `reviewKey: () => ...`
 *   · SchedHeader / LedgerWideTable 的 `:review-key="..."`
 *   · 年表屏(useSchedScreen)的 `reviewKinds: [...]`
 * 只认这三种形状 —— 别处偶然出现的同名字符串(注释、文案)不算数。
 */
function declSites(files: string[]): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const re of [/reviewKey:\s*\(\)\s*=>[\s\S]{0,400}?(?=\n\s*\}\)|\n\s*\}\s*$)/g,
                      /:review-key="[\s\S]{0,300}?"/g,
                      /reviewKinds:\s*[\s\S]{0,200}?(?=\n\s*(?:reviewScope|load|\/\/))/g,
                      /reviewKind:\s*'[a-z-]+'/g]) {
      for (const m of src.matchAll(re)) out.push({ file: f, text: m[0] })
    }
  }
  return out
}

/**
 * 不进审核的屏(对应后端的 @NoReviewGuard)。**理由写在产品代码里**,不是这里的注释 ——
 * 门禁只负责检查那句理由存在且非空。上限 8 条:例外多到两位数就该重想这套机制。
 */
const EXEMPT: Record<string, string> = {
  'views/pv/PvMeterView.vue': '光伏分栋抄表',
  'views/charging/CpMeterView.vue': '充电桩分栋抄表',
  'views/bills/CoefBookWindow.vue': '母册系数簿',
  'views/bills/PayBookWindow.vue': '母册收款簿',
  'views/reports/pnl/PnlScheduleView.vue': '损益附表',
}

describe('审核闸入口覆盖率(R2 T4c)', () => {
  const files = collect(join(SRC, 'views')).concat([
    join(SRC, 'components/sched/SchedHeader.vue'),
    join(SRC, 'composables/useSchedScreen.ts'),
  ])

  // 防空扫:照 PermissionCoverageTest 那条 hasSizeGreaterThan(150) 的精神。
  it('扫到的文件数量像话', () => {
    expect(files.length, '扫出来的文件太少 —— 多半是路径写错了在空扫,那样下面每条都恒绿').toBeGreaterThan(60)
  })

  // ❗这一条是整份门禁的要害。
  it('❗14 个 kind 每个都有屏声明它 —— 少一个就是「屏上说已审核,编辑按钮照样能点」', () => {
    const sites = declSites(files)
    expect(sites.length, '一处审核键声明都没扫到 —— 正则失配了,不是真的没有').toBeGreaterThan(8)

    const missing: string[] = []
    for (const kind of backendKinds()) {
      // 键形状是 `kind[:scope]:period`,声明处一定以 `kind:` 或 `'kind'` 出现
      const hit = sites.some(s => s.text.includes(`${kind}:`) || s.text.includes(`'${kind}'`))
      if (!hit) missing.push(kind)
    }
    expect(missing,
      `这些 kind 没有任何屏声明:${missing.join(' / ')}\n` +
      '后端加了新 kind 却没给它配前端入口 —— 那一屏的编辑按钮不受审核约束。\n' +
      '真的不该进审核,就把那一屏加进本文件的 EXEMPT 并在屏里写 `// no-review: 理由`。').toEqual([])
  })

  it('❗白名单里每一屏都在自己代码里写明了理由', () => {
    expect(Object.keys(EXEMPT).length, '例外多到两位数就该重想这套机制,不是继续往白名单里加')
      .toBeLessThanOrEqual(8)
    for (const [rel, what] of Object.entries(EXEMPT)) {
      const src = readFileSync(join(SRC, rel), 'utf8')
      // ⚠ 横向空白只能用 [ 	],不能用 \s —— \s 含换行,`// no-review:` 后面留空时
      //   `\s*` 会跨行吃到注释的**下一行**,于是「理由删空」这个破坏当场变成假绿(实测过)。
      const m = src.match(/\/\/[ 	]*no-review:[ 	]*(.*)/)
      expect(m, `${rel}(${what})在白名单里,但代码里没有 \`// no-review: 理由\` 那一行 —— ` +
                '理由要长在产品代码上,不是长在测试的常量表里(R1 同款做法)').toBeTruthy()
      expect((m?.[1] ?? '').trim().length,
        `${rel} 的 no-review 理由是空的 —— 空理由等于没写`).toBeGreaterThan(6)
    }
  })

  it('❗白名单里的屏确实没有声明审核键(两边不许同时成立)', () => {
    const both = Object.keys(EXEMPT).filter(rel =>
      declSites([join(SRC, rel)]).length > 0)
    expect(both, `这些屏既在白名单里、又声明了审核键,两个说法对不上:${both.join(' / ')}`).toEqual([])
  })
})
