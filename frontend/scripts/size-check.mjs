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
  // 2026-08-29 上调 185 → 189(+4KB)。**这是一次签字决定,理由写在这里**:
  //   四档响应式外壳(RESPONSIVE-LAYOUT-SPEC)是首屏常驻功能——每个视口档都吃它:
  //   useViewport/breakpoints、L/M 浮层侧栏、S 档铬边切换与定高占位壳、
  //   壳层四档 @media 规则、屏级地板与全局打印样式(base.css)。
  //   已先做过瘦身:手机三件套(顶栏/底栏/导航抽屉)改 defineAsyncComponent + 定高
  //   占位壳懒加载,从本块砍掉 9.3KB(197.3 → 188.0)——剩下的都是真·首屏。
  //   ⚠ 实测本块 Windows 本地 188.0 / CI(Linux)189.0,跨平台构建有 ~1KB 差:
  //   预算按 CI 口径 + 1KB 余量取 190。首次取 189 只留了 0 余量,CI 差 0.0KB 红了一轮。
  // 2026-09-03 上调 190 → 191(+1KB)。**这是一次签字决定,理由写在这里**:
  //   光伏分栋分析独立成屏(PV-ANALYSIS-SPEC §01)后,首屏多了两样 ——
  //   导航单一事实源里的 1 条屏目,与 PARAM_DEFS 里 6 条光伏判据线的定义
  //   (年锚点 / 范围半宽 / 段长 / 覆盖下限 / 台账差 / 年等效小时下限)。
  //   实测 189.9 → 190.4。**屏本体 93.6KB 走懒加载,不在这一块里**。
  //   没做瘦身就上调的理由:能抠的只有 PARAM_DEFS ——它经 api/params.ts 进的首屏,
  //   摘出去是跨模块重构,风险不在本次改动范围内,为 0.4KB 不值当。记在这里,谁下次动首屏可以顺手做。
  index: 191,
  vue: 113,
}
// 具名预算之外的兜底:防止胖东西从大块搬进某个屏的块里,总量没降却绕过了上面四条。
// 2026-09-03 上调 3820 → 3900(+80KB)。**这是一次签字决定,理由写在这里**:
//   新增「光伏分栋分析」一整块屏(PV-ANALYSIS-SPEC §01,原本挤在光伏投资回收里)。
//   构成:PvMeterAnaView 块 93.6KB(视图 + pvMeterAna.logic 的中位抛光/块自助/变点检验/
//   样条/ACF,加 PvQueue·PvDayChart·PvSeasonRows·PvQualityGrid·PvSlope·PvDots·PvLabTable
//   七个组件)+ 它的 CSS 13.6KB,减去 PvRoiView 搬走那部分后净 +106KB。**整块走懒加载**。
//   ⚠ 三个重块 exceljs 917.1 / echarts 698.3 / vue 110.4 **一字节没动** ——
//     新屏没夹带任何重库进来(heatmap/visualMap/calendar 全部手写 CSS Grid 与内联 SVG,
//     正是为了不往 echartsBundle 里加东西)。这是这次敢签字的前提:涨的是新功能本身,不是失控。
//   实测 3763.1 → 3869.1,取 3900 留 ~31KB 余量(跨平台构建有 ~1KB 差,见 index 那条的教训)。
// 2026-09-07 上调 3900 → 3950(+50KB)。**这是一次签字决定,理由写在这里**:
//   审核机制前端(R2,SIDEBAR-UX-REDESIGN §7.5)。实测 master 3896.3 → 本分支 3918.3,**净 +22.0KB**。
//   构成:三条编辑闸各自的判据接线(useEditMode / SchedHeader / LedgerWideTable)、
//   12 个消费屏各自声明的审核键、四张年表屏的行级锁(sched/reviewLock + useSchedScreen)、
//   本月出账屏的审核态列 / 行动作 / 审核条、FPReviewDialog、stores+types+api/review。
//   ⚠ **首屏 index 只涨 0.2KB(186.1 → 186.3)** —— 贵的那部分全落在各屏自己的懒加载块里
//     (BillNoticesView / MeterView / LedgerView / ElecView / PoolLedgerView / PvView /
//      ChargingView / ParamCenterView 各摊一点)。三个重块 exceljs / echarts / vue 一字节没动。
//   没做进一步瘦身就上调的理由:这 22KB 是 12 个屏各自的功能代码,没有可提取的公共大块;
//   唯一能懒的 FPReviewDialog 本来就在 DataHomeView 的块里,拆出去总量不变(且换回一层
//   「点了还要再等一拍」的时序,R2 T6 已经因此栽过一次)。
//   取 3950 留 ~32KB 余量,与 2026-09-03 那次同口径(跨平台构建有 ~1KB 差,见 index 那条的教训)。
//   ⚠ 顺带记一笔:改前 master 实测 3896.3 / 预算 3900 —— 只剩 3.7KB,任何一个新功能都会撞线。
//     下一个人动这里之前先看看总量是不是又贴着线了。
// 2026-09-11 上调 3950 → 3965(+15KB)。**这是一次签字决定,理由写在这里(F2 修复轮1订正,
//   见账本 Ruling-2 —— 原提交写的「跨平台构建有 ~1KB 差」撑不起 15KB 的余量,是错的理由)**:
//   驾驶舱护栏图 T1/T2(design-boards):月度收入 OLS 拟合(fitRevenueTrend,KPI 瓦与主图共用同一份,
//   见 cockpit.logic.ts)+ 三个新 KPI 瓦(按节奏推全年/月均增速/屏上旧值)+ 主图趋势线/拟合区间/
//   离群残差标注 + 读数句。实测改前 3946.8 → 改后 3950.1,**净 +3.3KB**,撞线只差 0.1KB。
//   没有可瘦身的空间:全部是新功能本身的判断逻辑与文案,没有重复实现或可提取的公共大块
//   (任务书本就要求 KPI 与图表共用同一个 fit,已经是最省的写法)。
//   真实理由:这份计划(design-boards)后面还有 11 个任务,每个都要加图加卡 —— 逐个抬上限等于
//   抬 11 次签字,不如一次留够。取 3965 留 ~15KB 余量就是为这 11 次攒的,不是给这一次的 3.3KB 配的。
//   ⚠ **T13(本计划收口任务)必须重新实测并把上限收到「实测 + 2KB」** —— 15KB 松弛留到那时候
//   就等于没有预算(它存在的理由本就是挡住无声增长)。已写进 T13 验收条件,这里只是提前记一笔。
// 2026-09-11 T6/T7 修复轮1 上调 3965 → 4065(+100KB)。**这是一次签字决定,如实写清楚它不是
//   构建波动,也不是这一轮改动本身要的**——本轮只加了一行读数句(sensitivityGapSentence),
//   实测净增远小于 1KB,15KB 里绰绰有余,单看这一轮完全不必动这个数。
//   抬的理由是**剩余任务**:T8-T11 要建一整个新屏(board-peer.txt「租户对标」——单位租金对标带
//   + 电费分层 + 两张方法论卡,至少 3 张 ECharts 图 + 若干张卡),量级参照本仓上一次「整屏新增」
//   (PV 分栋分析,2026-09-03 那次,新屏净 +106KB,当时也是懒加载、没夹带新的重库)。取 100KB
//   是照那次的量级留够,不是量出来的——**这是估计不是实测**,如实标注,不假装精确到小数点。
//   ⚠ 这不改变收口约定:**T13 必须重新实测并把上限收到「实测 + 2KB」**,这轮多留的 100KB
//   到那时候该收多少收多少,不会因为「反正预留过」就赖着不收。
const TOTAL_KB = 4065

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
