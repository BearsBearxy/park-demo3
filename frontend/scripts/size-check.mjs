// 构建后包体预算门禁:体积超线就红。放在 precompress 之后跑,只看原始体积不看 .gz ——
// 压缩率随内容波动(改几个中文字符就能差几 KB),原始体积才是能归因、能对比的那个量。
// 零新依赖,只用 node 内置模块(与 precompress.mjs 同口径)。
// ⚠ 本文件的 KB = 1024 字节;vite 构建日志打印的 kB 是 1000 进制(exceljs 那行写 938.48 kB
//   = 这里的 917.1KB),两处数字对不上不是谁算错了。
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 预算 = 2026-08-18 立档当天实测 + 10% 余量。实测值(KB):
//   exceljs 917.1 / echarts 677.5 / index 160.6(js 137.5 + css 23.1) / vue 101.8 / assets 合计 3472.1
// ⚠ 只许降不许升。超了先瘦身;确需上调,必须改这里的数字并在 PR 说明里写清为什么涨 ——
//   这张表的意义就是「涨」必须是一次有人签字的决定,而不是一次没人看的构建日志。
const BUDGET_KB = {
  // 两个重块靠 await import 懒加载(exceljs 见 utils/sheet.ts,echarts 见 components/ana/echartsBundle.ts),
  // 不进首屏 —— 但也不能无限胖,点一次导出等半天同样是事故。
  exceljs: 1009,
  echarts: 746,
  // 首屏两块:入口 + 框架三件套。这两条最该盯,涨了就是所有人每次打开都变慢。
  // 2026-08-27 上调 177 → 185（+8KB）。**这是一次签字决定，理由写在这里**：
  //   在场层（顶栏在线头像胶囊 + 侧栏入口红点）与编辑锁按钮是**首屏常驻功能**，
  //   每次打开任何一页都要用 —— 立档那天（2026-08-18）还没有这个功能。
  //   构成：stores/presence.ts（唯一那条 3 秒轮询）、utils/lockScopes.ts（红点要的
  //   「scope 前缀 → 导航项」表）、FPPresenceBar、Toolbar 的铃铛与胶囊。
  //   已先做过瘦身：铃铛的待批抽屉（FPApprovalDrawer）改 defineAsyncComponent + v-if
  //   懒加载，从这一块里砍掉 13.2KB（194.3 → 181.1）。剩下的都是真·首屏。
  // ⚠ 立此存照：P1–P3 那次提交（6f6205a）其实已经把这条压破 2.1KB 而没人发现 ——
  //   因为那轮只跑了 vitest 与 vue-tsc，**没跑 npm run build**。改代码之后请跑构建。
  index: 185,
  vue: 113,
}
// 具名预算之外的兜底:防止胖东西从大块搬进某个屏的块里,总量没降却绕过了上面四条。
const TOTAL_KB = 3820

const ASSETS = fileURLToPath(new URL('../dist/assets', import.meta.url))
// vite 产物名形如 index-DpSatsEZ.js,hash 每次构建都变,去掉 -<hash> 才是 chunk 名。
// 顺带:.map / .js.gz 都不以 .js|.css 结尾,在这一条正则里一起被挡掉。
const NAME_RE = /^(.+)-[\w-]{8}\.(js|css)$/

let total = 0
const size = new Map() // chunk 名 → 字节(同名的 .js 与 .css 合并计,预算按"这块屏多重"看才有意义)
for (const f of readdirSync(ASSETS)) {
  const m = NAME_RE.exec(f)
  if (!m) continue
  const n = statSync(join(ASSETS, f)).size
  total += n
  size.set(m[1], (size.get(m[1]) ?? 0) + n)
}
if (size.size === 0) throw new Error(`size-check: ${ASSETS} 里没扫到任何 chunk,构建产物是不是没出来?`)

const kb = (b) => b / 1024
const fmt = (b) => kb(b).toFixed(1)
const over = []
for (const [name, max] of Object.entries(BUDGET_KB)) {
  const got = size.get(name)
  // 预算里有、产物里没有 = chunk 改名了。不当"通过"处理:那等于这条预算从此静默失效。
  if (got === undefined) {
    over.push(`${name}: 产物里找不到这个 chunk —— 改了 vite.config.ts 的 manualChunks?请同步本表`)
  } else if (kb(got) > max) {
    over.push(`${name}: ${fmt(got)}KB > 预算 ${max}KB(超 ${(kb(got) - max).toFixed(1)}KB)`)
  }
}
if (kb(total) > TOTAL_KB) over.push(`dist/assets 合计: ${fmt(total)}KB > 预算 ${TOTAL_KB}KB`)

if (over.length) {
  console.error(`size-check 未通过:\n  ${over.join('\n  ')}\n预算写在 frontend/scripts/size-check.mjs 顶部。`)
  process.exit(1)
}
console.log(`size-check: 合计 ${fmt(total)}KB / ${TOTAL_KB}KB,具名块 ${Object.keys(BUDGET_KB).map((n) => `${n} ${fmt(size.get(n))}KB`).join(' | ')}`)
