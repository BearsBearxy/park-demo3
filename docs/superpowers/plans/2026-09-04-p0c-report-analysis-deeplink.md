# P0c 报表层三屏 / 期间条 / 分析层发链 / 三个假下钻目标屏接期间深链 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 报表层九屏「第二圈期跟随」：利润表 → 附表1 → 利润表之后月份与公司都还在（期间条裸 push 命中 KeepAlive 缓存实例时也认 query）；附表1–5 找回丢失的期间条（用户屏上今天真的显示一个「\1」）；分析层 / 收入核对 16 处发链统一走 `periodLink`，三个假下钻（电费成本第二本账 / 分桩明细某桩 / 合同号）变成真下钻；删掉 P0b 留下的零消费方 `utils/deepLink.ts`。

**Architecture:** 报表层三屏各接 `useDeepPeriod`（三大报表 `useFinStatementScreen` 一处改三屏：期 y+m、co 数字或 all，apply 异步先等公司名单；损益附表 `PnlScheduleView` 期只有年、apply 自己按年幂等、`carry` 改成只在 apply 更新的 ref 原样带回 m/co；收入核对 `ReconView` 期 y+m、无 co、`maxYear` 只由不带年的 overview 决定）；期间条组件不动，三屏喂给它的 `stripQuery` 改成 `{ p, co }`，`nav/reportPeriod.periodQuery` 随之归零删除。分析层 6 屏 + 收入核对工作台的 ledger / s10 发链改 `periodLink`（公司名走 `extra.company`，期区走 `co`，租户名走 `extra.tenant`；`openFresh({pin:true})` 一律不动，pin 规则归 P3）；预算 / 损益分析发 `p=YYYY`；电费收益「去看成本」发 `mode=cost`（改前 `view=` 键名对不上）；充电桩分析点桩柱发 `mode=meter&station=<id>&p=YYYY-MM`，分桩明细子屏认 `station`；到期墙点行发 `contractNo=`，合同屏读一次预填搜索并在切回时按 fullPath 去重再读。新增两张源码形状门禁（报表层九屏期间条、分析层发链形状）。

**Tech Stack:** Vue 3 `<script setup>` + Pinia + vue-router 4 + Vitest（jsdom）+ @vue/test-utils；vue-tsc strict。

**Spec:** `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md` §4.1（期间条 = open 语义不变；分析层 / 报表中心 / 期间条统一 periodLink；收入核对 → 台账 / 附10 的 `openFresh({pin:true})` 不变）· §4.2 后两条（报表层三屏接 useDeepPeriod；三个假下钻目标 + anaData 五条 link）· §9 P0c 行（破坏验证：mount → deactivate → 改 query → activate 期跟随；无 query 激活不重置）· §10 · §12。P0b 遗留：删 `utils/deepLink.ts`、改五处过时注释。

## Global Constraints

- **不改的模块**：`composables/useDeepPeriod.ts`、`nav/deepLink.ts`、`components/fp/FPStepStrip.vue`（query prop 是自由包，改的是三屏喂给它的形状）、`stores/tabs.ts`、`ReportsHomeView.go`（P0a 完成态，`reportsHomeGo.spec` 钉着）、`PvMeterAnaView` 的 `adopt=` 发链（P0A-2：不是选月，不能走 periodLink —— 门禁**正向**钉 `adopt:` 仍在）。
- **注册顺序与 TDZ**：`useDeepPeriod` 首跑在 setup **同步**执行，`apply` 里同步走到第一个 `await` 之前的代码不能碰后声明的 `let` / `const`。三大报表 `applyDeep` 第一句就是 `await ensureLoaded()`（续体在 setup 结束后跑），放在 `dirty`（:80）之后即可；损益附表 `apply` 同步调 `pickYear` → `loadDerive` 读 `deriveCache`、`loadYear` 读 `yearSeq` —— **useDeepPeriod 块放在 `<script setup>` 末尾**（所有 `let` / `const` 之后）；收入核对 `applyDeep` 同步走到 `setYear` 的 `++yearReq` —— 块放在 `pickMonth` 之后。放对位置后，「期先落定再取数」照样成立（setup 同步跑完才 mount）。撞了 TDZ 的 ReferenceError 抛在 async apply 里、被 `.catch` 吞 —— 症状是「一次请求都不发」，不是控制台报错。
- **期的形状**：三大报表 `current: { p: periodOf(year, month), co: companyId }`（矩阵态 month=null → p 只有年，与 `?p=YYYY` 链相等 → 不动，正是「只有年停在矩阵」）；损益附表 `current: { p: year == null ? null : periodOf(year, null) }`（**只报年**；本屏无 co 而报表中心恒发 `co=all`，composable 的相等判永不成立 → **apply 自己 `if (t.year !== year.value)` 幂等**，`carry.value = t` 每次都更新；**dirty 闸同样按年幂等**：`() => parsePeriod(route.query)?.year !== year.value ? dirty : 0` —— 闸排在 apply 之前，apply 内的幂等补不到它，否则有草稿时年没变也误弹提示、carry 冻在旧月）；收入核对 `current: { p: year ? periodOf(year, month) : null }`（`year` 初值 0 要护住）。
- **co 的口径**：三大报表 `co` 数字必须在公司名单里，否则不动（与附10「指名期区不存在不落错册」同口径）；字符串（旧 `company` 名）报表层没有公司名维度 → 视同没给（用当前 / 首家）；`'all'` → 全部汇总。损益附表 / 收入核对不认 co，只原样带回：`carry.value.co` 是数字或 `'all'` 才写进 `stripQuery`。
- **carry 不能是 computed(route.query)**：`useRoute()` 是全局当前路由，屏停用时跟着别的屏变，回来若地址没 query 会把 carry 清空 —— 直接违反「无 query 激活不重置」。只在 apply 里写。
- **dirty**：三大报表 `dirty.value`（draft 键数 + extraDirty，切走不清）、损益附表 `dirty.value`（四类草稿之和）都是真闸 → 接 `note` + `FPToast`（`<FPToast v-model="deepNote" tone="warning" placement="page" :duration="0" />` 逐字）；收入核对无草稿 → 不传 dirty、不接 note、不加 toast。
- **stripQuery → periodLink 形状**：三屏都改成 `{ p: periodOf(year, month), ...(co 数字或 all ? { co: String(co) } : {}) }`；`nav/reportPeriod.periodQuery` 零消费方 → **删**（含 `reportPeriod.spec` 「期包」3 条 —— spec §10 的「旧格式用例保留」指解析侧，发链器不在其列，计划里显式裁定）；`parsePeriodQuery` 留作兼容层不动（`nav/deepLink.spec:62-65` 钉它）。
- **既有断言只改一处**：`reportWorkbenchFlow.spec:197-206` 钉 `{ y: '2025', m: '2', co: '1' }` → 改 `{ p: '2025-02', co: '1' }`（发链形状迁移的必然，显式裁定）；其余既有断言零改动（`stepStrip.spec` 不受影响：它传的是任意 query 包）。
- **分析层发链形状**：ledger → `periodLink('ledger', { p: periodOf(+ym.slice(0, 4), +ym.slice(5, 7)), extra: { company, tenant } })`（`periodLink.co` 是 `number | 'all'`，公司名只能走 `extra.company`，`parsePeriod` 的 company 名分支接住 —— P0b 复查 C1 已钉这条分支）；s10 → `periodLink('sales-income', { p, co: phase, extra: { tenant } })`（phase 缺席时 `co: undefined` 被 periodLink 丢掉，S10View 落当前册；ReconWorkbench 的 `?? 1` 兜底删掉 —— 新实例默认就是一期册，零行为差）；预算 / 损益分析 → `periodLink(nav, { p: periodOf(year, null) })`；`ym` 串一律经 `periodOf` 归一化（`p` 的月必须两位补零，`y&m` 旧支不要求）。`tabs.openFresh(…, { pin: true })` **一行都不动**（§4.1:144；pin 规则 §4.3 归 P3）。
- **anaData 五条规则 link**：`AnaAnomaly.link` 仍是路径字符串（`anaAnomaly.spec` 四条断言不动），加可选 `company?` / `tenant?` 两字段由规则 ④ 填；消费方 AnomalyView / CockpitView 各加 `goAnom(a)`（`periodLink(a.link.slice(1), { p: periodOf(ym), extra: { company, tenant } })`），只替换 `a.link` 那两个调用点；`r.link`（监控规则行）、`c.link`（结论条）、`'/anomaly'` 仍走原 `go(link)`。三条落分析屏（`/fin-cashflow` `/park-energy` `/churn`）的 `p` 今天不被消费（`usePeriod` 是 localStorage 单例、零 query 入口）—— **裁定：本期不给 usePeriod 开深链入口**，写进 spec §12 遗留。
- **三个假下钻**：电费收益 `goCost` 发 `mode=cost`（不是给 ElecView 加 `view` 读法 —— P0b 定的键是 `mode`，spec §4.2「读 view/y/m」按此改口径）；充电桩分析 `goDetail(p)` 从图1 点击参数取 `seriesName`（桩名 → 桩 id）与 `dataIndex`（月），发 `mode=meter&station=<id>&p=YYYY-MM`，环图 / 费率图点击没有桩 → 只发 `mode=meter&p=YYYY`；分桩明细 `CpMeterView` 首载读一次 `?station=`，桩库到手且已选月时直开该桩抽屉（`onDeactivated` 清 `openSt` 是既有约定，切回不重开）；到期墙点行发 `{ path: '/contracts', query: { contractNo } }`（合同没有期，不走 periodLink），合同屏读一次预填 `q`、切回按 fullPath 去重再读，没 query 不重置。
- **删 `utils/deepLink.ts`**：连同 `utils/deepLink.spec.ts` 整份、`nav/__tests__/deepLink.spec.ts` 第 6 行 import 与「utils/deepLink 两个解析器」那条 it；`npx vue-tsc --noEmit` 零错即证零消费方。它独有的三段语义（company/tenant 缺省 ''、phase 越界回落 1、旧 y&m 无年界）今天没有生产路径。
- **过时注释**：ChurnView:44-45 / FinCashflowView:177 / ReconWorkbench:113-114 / AnomalyView:146 / CockpitView:203 五处「LedgerView / S10View 只在 onMounted 消费 query」改口径（openFresh 保留的是页签语义，不是读 query 的必要条件）；`ledgerDeepLink.spec:106` / `s10DeepLink.spec:106` 两条用例的**标题文字**「本期不改发链侧」改口径，断言不动。
- **源码形状门禁**：新增 `reportPeriodGate.spec`（九屏 `<FPStepStrip` + `current=`；PnlScheduleView 一 View 五值用 `:current="config.route"`；模板不许再出现字面 `\1`）与 `anaDeepLink.spec`（10 个发链文件 import `@/nav/deepLink` 且无手写 `query: { y:` / `query: { view:`；PvMeterAnaView 仍含 `adopt:`；ExpiryView 含 `contractNo:`；`utils/deepLink.ts` 不存在）。既有门禁会撞的：`schedHeader.spec:140-146, 203-212`（PnlScheduleView 的 `finishEdit(forced = false)` / `if (forced)` / `:copy-text="draftAsTsv"` 不动）、`bookRail.spec:173-182`、`twoBooksRail.spec:144-172`、`noInteractionLayoutShift.spec`（ReconWorkbench 三条豁免元素不动）。
- **测试桩**：报表屏 spec **不需要** mock billingPeriod 的四个 api（纯 `useDeepPeriod` 不实例化那个 store，P0b 三份新 spec 是活证据）；vue-router 桩一律「可变 query + `get fullPath()`」（`reportWorkbenchFlow.spec:30` 要升级）；PnlScheduleView 的桩要给 `meta: { value: 'rent-pnl' }`；ContractsView 的既有挂载测 `exactPlaceholderScreens.spec` 没有 vue-router 桩，屏加 `useRoute` 前必须先补（含 `RouterLink` 桩）；in-flight api 桩用 `mockResolvedValue`，别用 pending promise。
- **EOL**：本期要改的报表层五个文件全是 LF；破坏验证一律字符串替换还原，结束 `git status` 干净，绝不 `git checkout`。
- `npm run build` size-check：index ≤ 191KB（当前 189.4，余 1.6KB）；`useDeepPeriod` / `nav/deepLink` 只被懒加载屏 import，预期不进 index；**触线即停，不签字上调**。
- 提交信息末尾：`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。所有命令在 worktree `C:\financial_dashboard\demo3\.claude\worktrees\model-12d043`；前端命令在 `frontend/`。

---

## 文件结构

| 文件 | 责任 |
|---|---|
| `frontend/src/views/reports/pnl/PnlScheduleView.vue:387` | 把字面 `\1` 换回 `<FPStepStrip …>`（T1）；接 `useDeepPeriod`、`carry` 改 ref、`stripQuery` p/co、FPToast（T3） |
| `frontend/src/views/__tests__/reportPeriodGate.spec.ts`（新） | 报表层九屏期间条源码门禁 |
| `frontend/src/components/fin/useFinStatementScreen.ts` | `ensureLoaded` + 异步 `applyDeep` + `useDeepPeriod` + `stripQuery` p/co + 返回 `deepNote` |
| `frontend/src/views/reports/{income-statement,balance-sheet,trial-balance}/*.vue` | 解构 `deepNote` + FPToast |
| `frontend/src/views/__tests__/reportWorkbenchFlow.spec.ts` | 桩升级 getter + `keptAlive` + 第二圈 / 无 query / dirty / co=999 四条 + :197 断言改形状 |
| `frontend/src/views/reports/recon/ReconView.vue` | `useDeepPeriod`（无 dirty）、`carry` ref、`maxYear` 只由默认 overview 决定 |
| `frontend/src/nav/reportPeriod.ts` · `reportPeriod.spec.ts` | 删 `periodQuery` + 期包 3 条 |
| `frontend/src/views/__tests__/reportDeepLink.spec.ts`（新） | 损益附表 4 条 + 收入核对 4 条 |
| `frontend/src/views/analysis/{Churn,FinCashflow,Anomaly,Cockpit,TenantEnergy,Budget,PnlAnalysis}View.vue` · `frontend/src/views/reports/recon/ReconWorkbench.vue` | 发链改 `periodLink`；五处注释 |
| `frontend/src/analysis/anaData.ts` | `AnaAnomaly` 加 `company?` / `tenant?`，规则 ④ 填 |
| `frontend/src/utils/deepLink.ts` · `deepLink.spec.ts` · `frontend/src/nav/__tests__/deepLink.spec.ts:6, 66-71` | 删 |
| `frontend/src/views/__tests__/ledgerDeepLink.spec.ts:106` · `s10DeepLink.spec.ts:106` | 用例标题口径 |
| `frontend/src/views/__tests__/anaDeepLink.spec.ts`（新） | 分析层发链源码门禁 |
| `frontend/src/views/analysis/ElecAnalysisView.vue` · `ChargingAnalysisView.vue` · `ExpiryView.vue` | 三个假下钻的发链侧 |
| `frontend/src/views/charging/CpMeterView.vue` · `frontend/src/views/contracts/ContractsView.vue` | `?station=` / `?contractNo=` 收链侧 |
| `frontend/src/views/__tests__/schedDeepLink.spec.ts` · `cpMeterFlow.spec.ts` · `exactPlaceholderScreens.spec.ts` · `contractsDeepLink.spec.ts`（新） | 三个假下钻的用例 / 补桩 |
| `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md` 头行 / §4.2 / §10 / §12 | 口径随裁定 |

---

### Task 0: 准备与基线

- [ ] **Step 1: BASE 与基线**

```bash
git rev-parse --short HEAD
cd frontend && npx vitest run src/views/__tests__/reportWorkbenchFlow.spec.ts src/nav src/utils/deepLink.spec.ts src/analysis/anaAnomaly.spec.ts src/components/fp/__tests__/stepStrip.spec.ts src/views/__tests__/schedDeepLink.spec.ts src/views/__tests__/cpMeterFlow.spec.ts src/views/__tests__/exactPlaceholderScreens.spec.ts src/views/__tests__/ledgerDeepLink.spec.ts src/views/__tests__/s10DeepLink.spec.ts
```
Expected: 全绿。全量基线：190 files / 2231 tests；size-check index 189.4 / 191，合计 3877.7 / 3900。

---

### Task 1: 附表1–5 找回期间条 + 报表层期间条源码门禁

**Files:**
- Modify: `frontend/src/views/reports/pnl/PnlScheduleView.vue:387`
- Create: `frontend/src/views/__tests__/reportPeriodGate.spec.ts`

**Interfaces:**
- Consumes: `FPStepStrip`（已 import，:26）、`REPORT_STEPS` / `stripLabel` / `stripQuery` / `goGate`（已在，:27 / :67-69 / :161）。
- Produces: 附表1–5 屏有期间条；九屏源码门禁（T3 改 PnlScheduleView 时它仍要绿）。

- [ ] **Step 1: 写 reportPeriodGate.spec（先红）**

新建 `frontend/src/views/__tests__/reportPeriodGate.spec.ts`：

```ts
// src/views/__tests__/reportPeriodGate.spec.ts — 报表层九屏的源码形状门禁(照 chainPeriodGate.spec 的写法)。
// 每屏都得有期间条(<FPStepStrip)并标出自己是哪一环;损益附表一 View 五值,current 是动态绑定。
// 立此门禁的直接原因:PnlScheduleView 的期间条在 977af27 合并时被 sed 反向引用写成字面「\1」,
// 丢了一个月没人发现(全仓零挂载测,报表层此前没有任何源码门禁),用户屏上真的显示一个「\1」。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const VIEWS = join(__dirname, '..')

/** 路由值 → 屏文件(current 写字面量的四屏)。 */
const FILES: Record<string, string> = {
  'income-statement': '/reports/income-statement/IncomeStatementView.vue',
  'balance-sheet': '/reports/balance-sheet/BalanceSheetView.vue',
  'trial-balance': '/reports/trial-balance/TrialBalanceView.vue',
  'reconciliation': '/reports/recon/ReconView.vue',
}
const PNL = '/reports/pnl/PnlScheduleView.vue'
const src = (rel: string) => readFileSync(join(VIEWS, rel), 'utf8')

describe('报表层期间条门禁', () => {
  it('五个文件都指得到 —— 表烂了下面全是空断言', () => {
    for (const rel of [...Object.values(FILES), PNL]) expect(src(rel).length).toBeGreaterThan(0)
  })

  it.each(Object.entries(FILES))('%s 有期间条且标出自己是哪一环', (route, rel) => {
    const s = src(rel)
    expect(s.includes('<FPStepStrip'), `${rel} 没有期间条 —— 九张报表横跳就换不了期`).toBe(true)
    expect(s.includes(`current="${route}"`), `${rel} 的期间条没标出自己是哪一环(current="${route}")`).toBe(true)
  })

  it('损益附表(一 View 五值)有期间条,current 动态绑定 config.route;模板里不许再有字面「\\1」', () => {
    const s = src(PNL)
    expect(s.includes('<FPStepStrip'), '附表1–5 没有期间条(977af27 的 sed 事故回潮)').toBe(true)
    expect(s.includes(':current="config.route"'), '一 View 五值,current 必须动态绑定').toBe(true)
    expect(/^\\1$/m.test(s), '模板里还留着 sed 反向引用的字面「\\1」').toBe(false)
  })
})
```

Run: `cd frontend && npx vitest run src/views/__tests__/reportPeriodGate.spec.ts`
Expected: 前两条绿（四屏都在），第三条红（PnlScheduleView 没有 `<FPStepStrip`、且第 387 行是 `\1`）。

- [ ] **Step 2: 补回期间条**

`frontend/src/views/reports/pnl/PnlScheduleView.vue` 第 387 行 —— 整行内容就是两个字符 `\1`（在 `<div class="pnl-page fp-fluid">` 之后、`<SchedHeader` 之前）—— 替换为：

```html
        <!-- 期间条(设计稿 §3.2c):九张报表横跳不换期。本屏是整年一张表,条上只写年份
             (2026-09-04 修复:合并 977af27 时 sed 反向引用把这一段写成了字面反斜杠 1,期间条随之丢失;
             ReconView 同一处 2026-09-03 已修,本屏漏了 —— reportPeriodGate.spec 从此钉住九屏) -->
        <FPStepStrip :steps="REPORT_STEPS" :current="config.route" :period="stripLabel"
                     :query="stripQuery" back-label="换年" @back="goGate" />
```

- [ ] **Step 3: 跑绿 + 门禁 + 破坏验证**

Run: `cd frontend && npx vitest run src/views/__tests__/reportPeriodGate.spec.ts src/components/sched/__tests__/schedHeader.spec.ts src/views/__tests__/noInteractionLayoutShift.spec.ts && npx vue-tsc --noEmit`
Expected: 全绿；tsc 0（`stripLabel` / `stripQuery` / `FPStepStrip` 从死代码变回有消费方）。破坏验证：① 把 `<FPStepStrip :steps="REPORT_STEPS" :current="config.route"` 那两行删掉 → 第三条红；② 把 `:current="config.route"` 改成 `current="rent-pnl"` → 第三条红；③ 把 IncomeStatementView 的 `current="income-statement"` 改成 `current="x"` → it.each 那条红。字符串替换还原。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/reports/pnl/PnlScheduleView.vue frontend/src/views/__tests__/reportPeriodGate.spec.ts
git commit -m "fix(reports): 附表1–5 找回被 sed 反向引用吃掉的期间条(字面 \\1);报表层九屏期间条源码门禁"
```

---
### Task 2: 三大报表接 useDeepPeriod（一处改三屏）+ 期间条 p/co 形状

**Files:**
- Modify: `frontend/src/components/fin/useFinStatementScreen.ts:13-25`（import）、`:94-112`（onMounted 深链段）、`:230-235`（stripQuery）、`:421-433`（return）
- Modify: `frontend/src/views/reports/income-statement/IncomeStatementView.vue:43, 476-479`、`balance-sheet/BalanceSheetView.vue:45, 516-519`、`trial-balance/TrialBalanceView.vue:47, 500-503`
- Modify: `frontend/src/views/__tests__/reportWorkbenchFlow.spec.ts:28-30, 197-206` + 新增四条

**Interfaces:**
- Consumes: `useDeepPeriod({ current, apply, dirty? }) → { note }`（`composables/useDeepPeriod.ts`）；`periodOf(year, month|null)`、`DeepPeriod`（`nav/deepLink.ts`，`{ year, month, co: number|'all'|string|null, company, tenant }`）；`pickCompany(id)` / `pickCell(y, m)` / `loadCompanies()` 本文件既有函数（函数声明，提升）。
- Produces: `stripQuery` 为 `{ p: 'YYYY-MM' | 'YYYY', co?: string }`（T3 的损益附表 / 收入核对同形；`reportWorkbenchFlow.spec:197` 断言随之改）；返回值新增 `deepNote: Ref<string|null>`；三屏模板尾部 FPToast。

- [ ] **Step 1: 升级 spec 桩，写四条失败用例**

`frontend/src/views/__tests__/reportWorkbenchFlow.spec.ts` 第 28-30 行：

```ts
const query: Record<string, string> = {}          // 深链;单测里临时塞 y/m/co
const push = vi.fn()
vi.mock('vue-router', () => ({ useRoute: () => ({ query }), useRouter: () => ({ push }) }))
```
替换为：
```ts
const query: Record<string, string> = {}          // 深链;单测里临时塞 p/co(旧 y/m/co 也认)
const push = vi.fn()
// fullPath 走 getter:useRoute() 的返回对象只建一次,普通字段在切回时读到的还是旧地址(照 meterWriteGuards.spec:60-66)
vi.mock('vue-router', () => ({
  useRoute: () => ({ query, get fullPath() { return '/income-statement?' + new URLSearchParams(query).toString() } }),
  useRouter: () => ({ push }),
}))
```

第 2 行 `import { mount, flushPromises } from '@vue/test-utils'` 之后加 `import { defineComponent, h, KeepAlive, ref } from 'vue'`。`open()` 之后加：

```ts
/** 把屏包进 KeepAlive,alive 开关模拟切走 / 切回(期间条裸 push 命中缓存实例就是这条路)。 */
async function keptAlive() {
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(IncomeStatementView) : null) }),
  }), { global: { stubs: { Teleport: true, RouterLink: true, 'router-link': true } } })
  await flushPromises()
  return { w, alive }
}
```

第 197-206 行那条 `❗跳去别的报表时把整包期带上` 的断言 `query: { y: '2025', m: '2', co: '1' }` → `query: { p: '2025-02', co: '1' }`（用例名后加 `(periodLink 形状 p/co)`）。

`describe('期间条')` 之后、最外层 `})` 之前新增：

```ts
  describe('期间深链(SIDEBAR-UX-REDESIGN §4.2 · P0c)', () => {
    it('❗第二圈期跟随:切走后地址换成别的月,切回直落新月 —— 改前只在 onMounted 读一次,期间条裸 push 命中缓存实例期不动', async () => {
      query.p = '2025-03'; query.co = '1'
      const { w, alive } = await keptAlive()
      expect(reportApi.period).toHaveBeenCalledWith('is', 1, 2025, 3)
      alive.value = false; await flushPromises()
      query.p = '2025-04'
      alive.value = true; await flushPromises()
      expect(reportApi.period).toHaveBeenCalledWith('is', 1, 2025, 4)
      expect(w.findAll('.bmm-card'), '正文态,不是矩阵').toHaveLength(0)
    })

    it('无 query 激活不重置:切回时地址栏没有期,停在原来那一期', async () => {
      query.p = '2025-03'; query.co = '1'
      const { w, alive } = await keptAlive()
      vi.mocked(reportApi.period).mockClear()
      alive.value = false; await flushPromises()
      delete query.p; delete query.co
      alive.value = true; await flushPromises()
      expect(reportApi.period).not.toHaveBeenCalled()
      expect(w.findAll('.bmm-card'), '还在 2025-03 正文').toHaveLength(0)
    })

    it('有未保存草稿时切回不换期,只在页内提示', async () => {
      query.p = '2025-03'; query.co = '1'
      const { w, alive } = await keptAlive()
      const vm = w.findComponent(IncomeStatementView).vm as unknown as { draft: Record<string, number> }
      vm.draft = { 'r1|amount': 1 }    // dirty = 1(draft 键数;不走编辑锁)
      await flushPromises()
      vi.mocked(reportApi.period).mockClear()
      alive.value = false; await flushPromises()
      query.p = '2025-04'
      alive.value = true; await flushPromises()
      expect(reportApi.period).not.toHaveBeenCalled()
      expect(w.find('.fpt--warning').text()).toContain('地址栏要求 2025-04 期')
    })

    it('co 指名的公司不存在 → 不落错公司:停在首家公司的矩阵,不拉本期', async () => {
      query.p = '2025-03'; query.co = '999'
      const w = await open()
      expect(reportApi.period).not.toHaveBeenCalled()
      expect(w.findAll('.br-item')[1].classes(), '首家公司照常选中').toContain('on')
      expect(w.findAll('.bmm-card').length, '矩阵').toBeGreaterThan(0)
    })

    it('❗只有年的链落在停在正文的缓存实例上 → 回矩阵、年落位、不拉本期 —— pickCompany 同公司早退不清 month,applyDeep 得自己回', async () => {
      query.p = '2025-03'; query.co = '1'
      const { w, alive } = await keptAlive()
      vi.mocked(reportApi.period).mockClear()
      alive.value = false; await flushPromises()
      query.p = '2024'; delete query.co
      alive.value = true; await flushPromises()
      expect(reportApi.period).not.toHaveBeenCalled()
      expect(w.findAll('.bmm-card').length, '回矩阵').toBeGreaterThan(0)
      expect((w.findComponent(IncomeStatementView).vm as unknown as { year: number }).year).toBe(2024)
    })
  })
```

Run: `cd frontend && npx vitest run src/views/__tests__/reportWorkbenchFlow.spec.ts`
Expected: 新五条里四条红：第一条 `period` 没被 (…,2025,4) 调过；第三条找不到 `.fpt--warning`；第四条 `period` 被调了（改前 `deepLink.companyId ?? first` 直接 `pickCompany(999)`）；第五条停在正文（`.bmm-card` 为 0）。第二条「无 query 激活不重置」**改前即绿** —— 它钉的是 composable 的 parse-null / fullPath 去重两道不动，是本屏的回归护栏，不是本任务的新行为，本任务没有能杀它的变异。`❗跳去别的报表` 那条红（还是 y/m/co 形状）。其余既有用例绿。

- [ ] **Step 2: 改 useFinStatementScreen.ts**

import 段（:13-25）：删 `import { useRoute } from 'vue-router'`（:14）；`import { REPORT_STEPS, periodQuery, parsePeriodQuery, periodLabel } from '@/nav/reportPeriod'`（:25）改为
```ts
import { REPORT_STEPS, periodLabel } from '@/nav/reportPeriod'
import { periodOf, type DeepPeriod } from '@/nav/deepLink'
import { useDeepPeriod } from '@/composables/useDeepPeriod'
```

第 94-112 行（从 `// ── 载入公司` 到 onMounted 的 `})`）整段替换为：

```ts
  // ── 载入公司 ─────────────────────────────────────────────
  // 进屏自动选中第一家:左栏常驻,「选公司」不再是一道门,没理由让人对着空占位再点一下。
  // 不默认「全部汇总」——那一档要按公司数发 N 倍请求,当默认落点太贵;它在左栏第一项,一点即到。
  //
  // 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM&co=<公司 id | all> 从报表中心 / 期间条过来时直落那一期,跳过矩阵;
  // 只有年的链接(从损益附表跳回来就是这样)→ 停在矩阵,年份照样落到它说的那年;缓存实例停在正文时回矩阵。矩阵仍是**直接从侧栏进屏**时的门。
  // 改前只在 setup 读一次 query:期间条裸 push 命中 KeepAlive 缓存实例时期纹丝不动(「第二圈期不跟」);
  // useDeepPeriod 的 onReactivated 那一跑正是对症。setup 期公司名单还没到,apply 是异步的:先等 ensureLoaded 再落公司落期。
  // co 指名的公司不存在 → 不动(与附10「指名期区不存在不落错册」同口径);co 是公司名字符串 → 报表层没有公司名维度,视同没给。
  // 换期回矩阵不改地址栏:fullPath 去重是「回矩阵后切页签不被同一地址推回正文」的唯一保障。
  let loaded: Promise<void> | null = null
  function ensureLoaded() {
    if (!loaded) loaded = loadCompanies()
    return loaded
  }
  onMounted(async () => {
    await ensureLoaded()
    // 深链的 applyDeep 先注册先续跑(同一个 promise 的续体按注册序执行),它已选了公司就不再抢着选首家
    if (companyId.value == null && companies.value.length) await pickCompany(companies.value[0].id)
  })
  async function applyDeep(t: DeepPeriod) {
    await ensureLoaded()
    if (!companies.value.length) return
    if (typeof t.co === 'number' && !companies.value.some(c => c.id === t.co)) return
    const co = t.co === 'all' || typeof t.co === 'number' ? t.co : null
    await pickCompany(co ?? companyId.value ?? companies.value[0].id)
    year.value = t.year
    if (t.month != null) await pickCell(t.year, t.month)
    // 只有年的链落在停在正文的缓存实例上:pickCompany 同公司早退不清 month,得自己回矩阵 ——
    // 否则期标换了年、表里还是旧月的快照、锁域(S.report(stmt, co, year, month))指向新年旧月。首载 month 本就 null,不多拉。
    else if (month.value != null) backToMatrix()
  }
  const { note: deepNote } = useDeepPeriod({
    current: () => ({ p: periodOf(year.value, month.value), co: companyId.value }),
    apply: (t) => { void applyDeep(t).catch(() => {}) },
    dirty: () => dirty.value,
  })
```

第 230-235 行的 stripQuery：
```ts
  /** 带着走的那一包:目标屏认得几个用几个,不认的原样传回来。 */
  const stripQuery = computed(() => periodQuery(year.value, month.value, companyId.value))
```
改为
```ts
  /** 带着走的那一包(periodLink 形状,§4.2):p=YYYY-MM(矩阵态只有年)、co=公司 id | all;目标屏认得几个用几个,不认的原样传回来。 */
  const stripQuery = computed<Record<string, string>>(() => ({
    p: periodOf(year.value, month.value),
    ...(companyId.value != null ? { co: String(companyId.value) } : {}),
  }))
```

return 对象（:426）`periodSteps, stripLabel, stripQuery,` → `periodSteps, stripLabel, stripQuery, deepNote,`。

- [ ] **Step 3: 三屏接 toast**

三个文件同样三处（以 IncomeStatementView 为例，行号见 Files）：
1. 解构行 `periodSteps, stripLabel, stripQuery,` → `periodSteps, stripLabel, stripQuery, deepNote,`
2. `import FPStepStrip from '@/components/fp/FPStepStrip.vue'` 之后加 `import FPToast from '@/components/fp/FPToast.vue'`
3. 模板末尾 `<FPEvictedDialog :eviction="evictedBy" … />` 那个标签结束之后、`</template>` 之前加一行：
```html
  <!-- 期间深链被草稿挡下时的页内提示(§4.2):切回时地址栏要求别的期,本期有未保存改动 → 不换期,只说 -->
  <FPToast v-model="deepNote" tone="warning" placement="page" :duration="0" />
```

- [ ] **Step 4: 跑绿 + tsc + 门禁**

Run: `cd frontend && npx vitest run src/views/__tests__/reportWorkbenchFlow.spec.ts src/views/__tests__/reportPeriodGate.spec.ts src/views/__tests__/lockDialogsCoverage.spec.ts src/views/__tests__/readonlyHasNoWriteButtons.spec.ts && npx vue-tsc --noEmit`
Expected: 全绿（既有 16 + 新 5 = 21），tsc 0。`vue-tsc` 此时**会**报 `nav/reportPeriod.ts` 的 `periodQuery` 未被引用吗 —— 不会（导出函数不算未用）；它在 T3 删。

- [ ] **Step 5: 破坏验证（字符串替换还原）**

① `applyDeep` 里删掉 `if (typeof t.co === 'number' && !companies.value.some(…)) return` → 「co=999」红；② `dirty: () => dirty.value,` 删掉 → 「有未保存草稿」红（period 被调 + 没 toast）；③ 把 `stripQuery` 改回 `{ y: String(year.value) … }` → 「❗跳去别的报表」红；④ 把 `useDeepPeriod` 整块换回 `onMounted` 里读一次 `parsePeriod(route.query)` 的写法（只落首载）→ 「第二圈期跟随」红；⑤ 删掉 `else if (month.value != null) backToMatrix()` → 「只有年的链落在缓存实例」红（停在正文、year 已成 2024 而 period 还是 2025-03 的 —— 这正是阻断级缺陷的现场）。每条改后单跑、还原后再跑一遍绿；结束 `git status` 只有本任务的改动。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/fin/useFinStatementScreen.ts frontend/src/views/reports/income-statement/IncomeStatementView.vue frontend/src/views/reports/balance-sheet/BalanceSheetView.vue frontend/src/views/reports/trial-balance/TrialBalanceView.vue frontend/src/views/__tests__/reportWorkbenchFlow.spec.ts
git commit -m "feat(reports): 三大报表接 useDeepPeriod(第二圈期跟随、草稿闸、co 不存在不落错公司);期间条期包改 p/co 形状"
```

---
### Task 3: 损益附表 + 收入核对接 useDeepPeriod；删 periodQuery

**Files:**
- Modify: `frontend/src/views/reports/pnl/PnlScheduleView.vue:27`（import）、`:64-76`（carry / strip / onMounted）、`:362` 之前（useDeepPeriod 块）、`:524` 之后（FPToast）
- Modify: `frontend/src/views/reports/recon/ReconView.vue:6-9`（import）、`:21-34`（carry / strip / onMounted）、`:75` 之后（useDeepPeriod 块）
- Modify: `frontend/src/nav/reportPeriod.ts:13-14, 43-52`；`frontend/src/nav/reportPeriod.spec.ts:22-35` + import
- Create: `frontend/src/views/__tests__/reportDeepLink.spec.ts`

**Interfaces:**
- Consumes: T2 定下的 `stripQuery` 形状 `{ p, co? }`；`useDeepPeriod` / `periodOf` / `DeepPeriod`；本文件既有 `pickYear(y)`（Pnl）、`setYear(y)` / `pickMonth(m)`（Recon，两者各有 `let` 竞态计数器 → 见 Global Constraints TDZ 条）。
- Produces: `reportPeriod.ts` 只剩 `REPORT_STEPS` / `ReportPeriod` / `parsePeriodQuery` / `periodLabel`；两屏 `carry: Ref<DeepPeriod | null>`。

- [ ] **Step 1: 写 reportDeepLink.spec（先红）**

新建 `frontend/src/views/__tests__/reportDeepLink.spec.ts`：

```ts
// src/views/__tests__/reportDeepLink.spec.ts — 报表层的期间深链(SIDEBAR-UX-REDESIGN §4.2 · P0c):损益附表 + 收入核对。
// 三大报表那一份在 reportWorkbenchFlow.spec(三屏共用 useFinStatementScreen,一份够)。
// 每条用例的注释都写明 production 改哪一行会红。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

// query 可变(切回之间换 ?p=);fullPath 走 getter(useRoute() 的返回对象只建一次);meta.value 给 PnlScheduleView 选 config
const query: Record<string, string> = {}
const meta: Record<string, unknown> = {}
const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ query, meta, get fullPath() { return '/x?' + new URLSearchParams(query).toString() } }),
}))
vi.mock('@/api/pnl', () => ({ pnlApi: { overview: vi.fn(), year: vi.fn(), save: vi.fn(), import: vi.fn() } }))
vi.mock('@/api/recon', () => ({ reconApi: { overview: vi.fn(), month: vi.fn(), mark: vi.fn(), unmark: vi.fn() } }))
// 派生对照要拉六个 api(s10/pv/charging/elec/utilities/salary):这里不测派生 —— 整段换成空数据;生成器回 null(不发整年 PUT)
vi.mock('@/reports/pnlDerive', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/reports/pnlDerive')>()),
  loadDeriveData: vi.fn().mockResolvedValue({}),
  generateMissingRows: vi.fn().mockReturnValue(null),
}))
// 锁 mock 照 paramCenterView.spec:69:不 mock 的话 locksApi 走真 axios,jsdom 里抛错
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))

import PnlScheduleView from '@/views/reports/pnl/PnlScheduleView.vue'
import ReconView from '@/views/reports/recon/ReconView.vue'
import { pnlApi } from '@/api/pnl'
import { reconApi } from '@/api/recon'
import { useAuthStore } from '@/stores/auth'

type Screen = typeof PnlScheduleView | typeof ReconView
const OPTS = { global: { stubs: { Teleport: true, RouterLink: true, 'router-link': true } } }

async function open(C: Screen) {
  const w = mount(C, OPTS)
  await flushPromises()
  return w
}
/** 把屏包进 KeepAlive,alive 开关模拟切走 / 切回(期间条裸 push 命中缓存实例就是这条路)。 */
async function keptAlive(C: Screen) {
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(C) : null) }),
  }), OPTS)
  await flushPromises()
  return { w, alive }
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().permissions = ['report:edit']
  vi.clearAllMocks()
  localStorage.clear()
  for (const k of Object.keys(query)) delete query[k]
  meta.value = 'rent-pnl'
  vi.mocked(pnlApi.overview).mockResolvedValue({
    years: [{ year: 2024, hasData: true, rowCount: 2 }, { year: 2025, hasData: true, rowCount: 3 }],
  } as never)
  vi.mocked(pnlApi.year).mockImplementation((_s: string, y: number) => Promise.resolve({ year: y, rows: [] }) as never)
  // 后端 overview(year) 原样回传给定年;不带年回「有数据的最大年」2025
  vi.mocked(reconApi.overview).mockImplementation((y?: number) => Promise.resolve({ year: y ?? 2025, months: [] }) as never)
  vi.mocked(reconApi.month).mockImplementation((y: number, m: number) => Promise.resolve({ year: y, month: m, entities: [] }) as never)
})

describe('损益附表 · 期间深链', () => {
  it('p=2025-06&co=all 直落 2025 年表;期间条在(不是字面「\\1」),条上带走 p=2025-06 与 co=all —— 跳回利润表月份公司都还在', async () => {
    query.p = '2025-06'; query.co = 'all'
    const w = await open(PnlScheduleView)
    expect(pnlApi.year).toHaveBeenCalledWith('s1', 2025)
    expect(w.text()).not.toContain('\\1')
    const steps = w.findAll('.fss-step')
    expect(steps).toHaveLength(9)
    await steps[0].trigger('click')   // 利润表
    // 红法:stripQuery 改回 periodQuery(y/m/co) → 形状不对;carry 改成 setup 读一次的常量 → 这条仍绿,靠下面「第二圈」那条红
    expect(push).toHaveBeenCalledWith({ path: '/income-statement', query: { p: '2025-06', co: 'all' } })
  })

  it('旧链 ?y=2024(预算 / 损益分析改前发的书签)照认', async () => {
    query.y = '2024'
    await open(PnlScheduleView)
    expect(pnlApi.year).toHaveBeenCalledWith('s1', 2024)
  })

  it('❗第二圈期跟随:切走后地址换年,切回直落新年;carry 跟着换 —— 改前 carry 是 setup 常量、年只在 onMounted 读一次', async () => {
    query.p = '2025-06'; query.co = 'all'
    const { w, alive } = await keptAlive(PnlScheduleView)
    alive.value = false; await flushPromises()
    query.p = '2024-02'; query.co = '1'
    alive.value = true; await flushPromises()
    expect(pnlApi.year).toHaveBeenCalledWith('s1', 2024)
    push.mockClear()
    await w.findAll('.fss-step')[0].trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/income-statement', query: { p: '2024-02', co: '1' } })
  })

  it('无 query 激活不重置:切回时地址栏没有期,停在原来那年', async () => {
    query.p = '2025-06'
    const { w, alive } = await keptAlive(PnlScheduleView)
    vi.mocked(pnlApi.year).mockClear()
    alive.value = false; await flushPromises()
    delete query.p
    alive.value = true; await flushPromises()
    expect(pnlApi.year).not.toHaveBeenCalled()
    expect((w.findComponent(PnlScheduleView).vm as unknown as { year: number | null }).year).toBe(2025)
  })

  it('有未保存草稿时切回不换年,只在页内提示(dirty = 四类草稿之和)', async () => {
    query.p = '2025-06'
    const { w, alive } = await keptAlive(PnlScheduleView)
    const vm = w.findComponent(PnlScheduleView).vm as unknown as { draftNote: Record<string, string>; year: number | null }
    vm.draftNote = { r1: '改了备注' }
    await flushPromises()
    vi.mocked(pnlApi.year).mockClear()
    alive.value = false; await flushPromises()
    query.p = '2024-02'
    alive.value = true; await flushPromises()
    expect(pnlApi.year).not.toHaveBeenCalled()
    expect(vm.year).toBe(2025)
    const toast = w.find('.fpt--warning')
    expect(toast.exists(), 'dirty 没接进 useDeepPeriod 就没有这条提示').toBe(true)
    expect(toast.text()).toContain('2024')
    expect(toast.text()).toContain('未保存')
  })

  it('有草稿但年没变(利润表换了个月再跳回来)→ 不弹提示,carry 跟着换月 —— dirty 闸按年幂等', async () => {
    query.p = '2025-06'; query.co = '1'
    const { w, alive } = await keptAlive(PnlScheduleView)
    const vm = w.findComponent(PnlScheduleView).vm as unknown as { draftNote: Record<string, string> }
    vm.draftNote = { r1: '改了备注' }
    await flushPromises()
    alive.value = false; await flushPromises()
    query.p = '2025-07'
    alive.value = true; await flushPromises()
    expect(w.find('.fpt--warning').exists(), '年没变,不该拦').toBe(false)
    push.mockClear()
    await w.findAll('.fss-step')[0].trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/income-statement', query: { p: '2025-07', co: '1' } })
  })
})

describe('收入核对 · 期间深链', () => {
  it('p=2024-03 直落 2024-03 工作台;maxYear 仍由不带年的 overview 决定(2025)—— 改前 overview(carry.year) 把上限污染成 2024,「下一年」锁死', async () => {
    query.p = '2024-03'
    const w = await open(ReconView)
    expect(reconApi.month).toHaveBeenCalledWith(2024, 3)
    expect(reconApi.overview).toHaveBeenCalledWith()
    const vm = w.vm as unknown as { maxYear: number; year: number }
    expect(vm.year).toBe(2024)
    expect(vm.maxYear).toBe(2025)
  })

  it('只有年 → 停在月份层;条上 9 环,co 原样带回(本屏不认 co)', async () => {
    query.p = '2024'; query.co = 'all'
    const w = await open(ReconView)
    expect(reconApi.month).not.toHaveBeenCalled()
    expect(reconApi.overview).toHaveBeenCalledWith(2024)
    const steps = w.findAll('.fss-step')
    expect(steps).toHaveLength(9)
    await steps[0].trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/income-statement', query: { p: '2024', co: 'all' } })
  })

  it('❗第二圈期跟随:切走后地址换月,切回直落新月', async () => {
    query.p = '2024-03'
    const { alive } = await keptAlive(ReconView)
    alive.value = false; await flushPromises()
    query.p = '2024-04'
    alive.value = true; await flushPromises()
    expect(reconApi.month).toHaveBeenCalledWith(2024, 4)
  })

  it('无 query 激活不重置:切回时地址栏没有期,停在 2024-03 工作台', async () => {
    query.p = '2024-03'
    const { w, alive } = await keptAlive(ReconView)
    vi.mocked(reconApi.month).mockClear()
    alive.value = false; await flushPromises()
    delete query.p
    alive.value = true; await flushPromises()
    expect(reconApi.month).not.toHaveBeenCalled()
    expect((w.findComponent(ReconView).vm as unknown as { month: number | null }).month).toBe(3)
  })
})
```

Run: `cd frontend && npx vitest run src/views/__tests__/reportDeepLink.spec.ts`
Expected: 损益附表六条：第 1 条红（`push` 形状还是 y/m/co）、第 2 条绿（旧 onMounted 也认 y）、第 3/5 条红、第 4 条绿、第 6 条红（改前 carry 是 setup 常量，push 还是 2025-06）；收入核对：第 1 条红（`maxYear` 2024 + `overview()` 没被无参调过）、第 2 条红（形状）、第 3 条红、第 4 条绿。

- [ ] **Step 2: 改 PnlScheduleView.vue**

第 27 行 `import { REPORT_STEPS, periodQuery, parsePeriodQuery, periodLabel } from '@/nav/reportPeriod'` 改为：
```ts
import { REPORT_STEPS, periodLabel } from '@/nav/reportPeriod'
import { periodOf, parsePeriod, type DeepPeriod } from '@/nav/deepLink'
import { useDeepPeriod } from '@/composables/useDeepPeriod'
import FPToast from '@/components/fp/FPToast.vue'
```
（`useRoute` 仍要：读 `meta.value`。）

第 64-76 行（从 `// 期间条(设计稿 §3.2c)。本屏是**园区全局整年一张表**` 到 onMounted 的 `})`）替换为：

```ts
// 期间条(设计稿 §3.2c)。本屏是**园区全局整年一张表**,没有月与公司维度 ——
// 但从三大报表跳过来时那两样在 query 里,得原样带回去,否则跳回利润表就丢了月份。
// carry 只在深链 apply 时写(见文末 useDeepPeriod):不能写成 computed(route.query) —— useRoute 是全局当前路由,
// 屏停用时跟着别的屏变,切回若地址没 query 会把 carry 清空(违反「无 query 激活不重置」)。
const carry = ref<DeepPeriod | null>(null)
const stripLabel = computed(() => periodLabel(year.value ?? 0, null, null))
/** 带着走的那一包(periodLink 形状 §4.2):p 用本屏的年 + 带来的月;co 只在是公司 id / all 时原样带回。 */
const stripQuery = computed<Record<string, string>>(() => {
  const co = carry.value?.co
  return {
    p: periodOf(year.value ?? 0, carry.value?.month ?? null),
    ...(co === 'all' || typeof co === 'number' ? { co: String(co) } : {}),
  }
})

// ── 进入屏:overview(§6 取数前不渲染)。深链落年在文末 useDeepPeriod(setup 同步首跑,不依赖 overview) ──
onMounted(async () => {
  overview.value = await pnlApi.overview(config.schedule)
})
```

`</script>`（:362）之前、文件里最后一个语句之后追加：

```ts
// ── 期间深链(SIDEBAR-UX-REDESIGN §4.2)。放文末:apply 同步走到 pickYear → loadDerive 读 deriveCache、loadYear 读 yearSeq,放前面撞 TDZ ──
// 年表屏 p 只取年,current 也只报年;?y= 旧链(预算 / 损益分析改前发的书签)parsePeriod 照认。
// 本屏没有 co 维度而报表中心恒发 co=all,composable 那道「与当前相同」永远判不相等 —— apply 自己按年幂等;carry 每次都更新(带回 m/co)。
// dirty = 四类草稿之和(切走不清):切回时有 → 不切年,只在 deepNote 里说。
const { note: deepNote } = useDeepPeriod({
  current: () => ({ p: year.value == null ? null : periodOf(year.value, null) }),
  apply: (t) => {
    carry.value = t
    if (t.year !== year.value) void pickYear(t.year).catch(() => {})
  },
  // 闸也要按年幂等:composable 的 dirty 闸排在 apply 之前,只报年的 current 与恒带月/co 的链永远判不相等 ——
  // 不这么写,有草稿时哪怕年没变(利润表换了个月再跳回来)也会误弹「地址栏要求 X 期」,carry 还被冻在旧月。
  dirty: () => (parsePeriod(route.query as Record<string, unknown>)?.year !== year.value ? dirty.value : 0),
})
```

模板第 524 行 `<ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />` 之后加：
```html
  <!-- 期间深链被草稿挡下时的页内提示(§4.2) -->
  <FPToast v-model="deepNote" tone="warning" placement="page" :duration="0" />
```

- [ ] **Step 3: 改 ReconView.vue**

第 7 行 `import { useRoute } from 'vue-router'` 删；第 9 行 `import { REPORT_STEPS, periodQuery, parsePeriodQuery, periodLabel } from '@/nav/reportPeriod'` 改为：
```ts
import { REPORT_STEPS, periodLabel } from '@/nav/reportPeriod'
import { periodOf, type DeepPeriod } from '@/nav/deepLink'
import { useDeepPeriod } from '@/composables/useDeepPeriod'
```

第 21-34 行（从 `// 期间条(设计稿 §3.2c)。本屏认 y/m` 到 onMounted 的 `})`）替换为：

```ts
// 期间条(设计稿 §3.2c)。本屏认 y/m,co 不认但原样带回去 —— 否则跳回利润表就丢了公司。
// carry 只在深链 apply 时写(见 pickMonth 之后):不能写成 computed(route.query) —— 屏停用时全局 route 跟着别的屏变。
const carry = ref<DeepPeriod | null>(null)
const stripLabel = computed(() => periodLabel(year.value, month.value, null))
const stripQuery = computed<Record<string, string>>(() => {
  const co = carry.value?.co
  return {
    p: periodOf(year.value, month.value),
    ...(co === 'all' || typeof co === 'number' ? { co: String(co) } : {}),
  }
})

onMounted(async () => {
  // 不带年的 overview 定默认年与上限:maxYear 只由它决定 —— 改前 overview(carry.year) 原样回传深链那年,
  // 深链 2023 进来 maxYear 就成了 2023,「下一年」按钮锁死。深链已落年时只取上限,不覆盖 overview / year。
  const o = await reconApi.overview()
  maxYear.value = o.year
  if (!year.value) { overview.value = o; year.value = o.year }
})
```

`pickMonth` 结束的 `}`（:75）之后、`// 处置标记后局部更新` 之前插入：

```ts
// ── 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM 直落该月工作台,只有年 → 停在月份层;报表中心 / 期间条都走这里 ──
// 放在 setYear / pickMonth 之后:apply 同步走到 setYear 的 ++yearReq,放前面撞 let 的 TDZ。
// 本屏没有草稿(处置标记即时 upsert),不传 dirty、不接 note、不加 toast。year 初值 0 → current 报 null(不是「0 年」)。
async function applyDeep(t: DeepPeriod) {
  carry.value = t
  if (t.year !== year.value) await setYear(t.year)
  if (t.month != null) await pickMonth(t.month)
  else month.value = null
}
useDeepPeriod({
  current: () => ({ p: year.value ? periodOf(year.value, month.value) : null }),
  apply: (t) => { void applyDeep(t).catch(() => {}) },
})
```

- [ ] **Step 4: 删 periodQuery**

`frontend/src/nav/reportPeriod.ts`：删第 43-52 行（`/** 组期包。缺的项不写进 query …` 到 `periodQuery` 的 `}`）；第 13-14 行「所以这里走查询参数而不是 store：条把整包 y/m/co 带过去，」改为「所以这里走查询参数而不是 store：条把整包 p/co 带过去（periodLink 形状，各屏自己组，2026-09-04 起），」。
`frontend/src/nav/reportPeriod.spec.ts`：删 `describe('期包(y / m / co)', …)` 整块（:22-35）；import 里去掉 `periodQuery`。

- [ ] **Step 5: 跑绿 + tsc + 门禁**

Run: `cd frontend && npx vitest run src/views/__tests__/reportDeepLink.spec.ts src/nav src/views/__tests__/reportPeriodGate.spec.ts src/components/sched/__tests__/schedHeader.spec.ts src/views/__tests__/noInteractionLayoutShift.spec.ts src/views/__tests__/lockDialogsCoverage.spec.ts && npx vue-tsc --noEmit && grep -rn "periodQuery\b" src --include=*.ts --include=*.vue | grep -v parsePeriodQuery`
Expected: 全绿；tsc 0；grep 零命中。

- [ ] **Step 6: 破坏验证（字符串替换还原）**

① Pnl `apply` 里 `if (t.year !== year.value)` 去掉条件 → 「无 query 激活不重置」仍绿（fullPath 去重挡住）但「草稿」那条仍绿 —— 说明这层幂等只防 co=all 的假变化；改为破坏 ② `carry.value = t` 删掉 → 「第二圈」红（push 形状还是 2025-06/all）；③ Pnl 的 `dirty: () => dirty.value,` 删 → 「草稿」红；④ Recon onMounted 改回 `reconApi.overview(carry.value?.year)` + `maxYear.value = o.year` 无条件 → 收入核对第 1 条红；⑤ Recon `useDeepPeriod` 块搬到 `let yearReq` 之前 → 收入核对四条全红：`overview(2024)` / `month(2024,3)` 一次都不发、月份层不渲染（TDZ 的 ReferenceError 抛在 async applyDeep 里、被 apply 的 `.catch(() => {})` 吞掉，控制台看不到那句报错；想亲眼看到就临时把 `.catch(() => {})` 摘掉再搬）。逐条还原，结束 `git status` 只有本任务改动。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/views/reports/pnl/PnlScheduleView.vue frontend/src/views/reports/recon/ReconView.vue frontend/src/nav/reportPeriod.ts frontend/src/nav/reportPeriod.spec.ts frontend/src/views/__tests__/reportDeepLink.spec.ts
git commit -m "feat(reports): 损益附表 / 收入核对接 useDeepPeriod(carry 改 ref、maxYear 不被深链年污染);期包统一 p/co,删 periodQuery"
```

---
### Task 4: 分析层 + 收入核对工作台发链统一 periodLink；anaData 异常条带定位；删 utils/deepLink；五处过时注释

**Files:**
- Modify: `frontend/src/views/analysis/ChurnView.vue:44-51`、`FinCashflowView.vue:177-184`、`AnomalyView.vue:146-159, 302`、`CockpitView.vue:199-205, 234-237, 243, 347`、`TenantEnergyView.vue:252-267`、`BudgetView.vue:129-133`、`PnlAnalysisView.vue:78-82`
- Modify: `frontend/src/views/reports/recon/ReconWorkbench.vue:113-134`
- Modify: `frontend/src/analysis/anaData.ts:332-333`（接口）、规则 ③ / ④ 三处 `out.push`
- Delete: `frontend/src/utils/deepLink.ts`、`frontend/src/utils/deepLink.spec.ts`
- Modify: `frontend/src/nav/__tests__/deepLink.spec.ts:6, 66-71`；`frontend/src/views/__tests__/ledgerDeepLink.spec.ts:106`、`s10DeepLink.spec.ts:106`（用例标题）
- Create: `frontend/src/views/__tests__/anaDeepLink.spec.ts`

**Interfaces:**
- Consumes: `periodLink(value, { p, co?, extra? })`（`nav/deepLink.ts`；`co: number | 'all'`，`extra` 值为 null / undefined 时不写进 query —— 动手前 `sed -n 1,80p frontend/src/nav/deepLink.ts` 核一遍签名与 extra 的丢空规则，若 extra 不丢 undefined 则在调用点用 `...(x != null ? { k: x } : {})`）；`periodOf(year, month|null)`。目标屏协议（P0b）：台账认 `p` + `company`（公司名）+ `tenant`；附10 认 `p` + `co`（期区数字）或 `phase` + `tenant`；年表屏认 `p`（只取年）。
- Produces: `AnaAnomaly.company?: string; tenant?: string`；AnomalyView / CockpitView 的 `goAnom(a: AnaAnomaly)`；分析层发链门禁 `anaDeepLink.spec`（T5 往里加三条）。

- [ ] **Step 1: 写 anaDeepLink.spec（先红）**

新建 `frontend/src/views/__tests__/anaDeepLink.spec.ts`：

```ts
// src/views/__tests__/anaDeepLink.spec.ts — 分析层 / 收入核对工作台发链的源码形状门禁(SIDEBAR-UX-REDESIGN §4.2 · P0c)。
// 这些屏零挂载测(echarts + anaData 太重),发链形状靠这里钉:统一 periodLink,不再手写 y/m/view 键;
// 特例反向钉住:PvMeterAnaView 的 adopt= 不是选月(P0A-2);utils/deepLink 已删。
// 目标屏怎么吃这些 query 由 ledgerDeepLink / s10DeepLink / schedDeepLink 各自的挂载测钉。
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..', '..')
const src = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

/** 发链文件:台账 / 附10 / 附表1–5 的深链出口。 */
const SENDERS = [
  'views/analysis/ChurnView.vue',
  'views/analysis/FinCashflowView.vue',
  'views/analysis/AnomalyView.vue',
  'views/analysis/CockpitView.vue',
  'views/analysis/TenantEnergyView.vue',
  'views/analysis/BudgetView.vue',
  'views/analysis/PnlAnalysisView.vue',
  'views/reports/recon/ReconWorkbench.vue',
]

describe('分析层发链门禁', () => {
  it.each(SENDERS)('%s 发链走 periodLink,不再手写 y/m/view 键,不再引用 utils/deepLink', (rel) => {
    const s = src(rel)
    expect(s.includes("from '@/nav/deepLink'"), `${rel} 没 import periodLink`).toBe(true)
    expect(s.includes('periodLink('), `${rel} 没调 periodLink`).toBe(true)
    expect(/query:\s*\{\s*(y|view):/.test(s), `${rel} 还在手写 y= / view= 键`).toBe(false)
    expect(s.includes("'@/utils/deepLink'"), `${rel} 还引用已删的 utils/deepLink`).toBe(false)
  })

  it('openFresh({pin:true}) 一行不动(spec §4.1:收入核对 / 分析层 → 台账 / 附10 的页签语义;pin 规则归 P3)', () => {
    for (const rel of SENDERS.filter(r => !r.includes('Budget') && !r.includes('PnlAnalysis'))) {
      expect(src(rel).includes('{ pin: true }'), `${rel} 丢了 openFresh pin`).toBe(true)
    }
  })

  it('PvMeterAnaView 的 adopt= 不走 periodLink —— 它不是选月(P0A-2),是「采纳参数」', () => {
    const s = src('views/analysis/PvMeterAnaView.vue')
    expect(s.includes('adopt:')).toBe(true)
    expect(s.includes("periodLink('params'")).toBe(false)
  })

  it('utils/deepLink.ts 已删(零消费方;vue-tsc 证明没人再引)', () => {
    expect(existsSync(join(SRC, 'utils/deepLink.ts'))).toBe(false)
    expect(existsSync(join(SRC, 'utils/deepLink.spec.ts'))).toBe(false)
  })
})
```

Run: `cd frontend && npx vitest run src/views/__tests__/anaDeepLink.spec.ts`
Expected: `it.each` 八条全红（没 import periodLink），`utils/deepLink` 那条红；`openFresh` / `adopt` 两条绿。

- [ ] **Step 2: 改七个分析屏 + 收入核对工作台**

每个文件在 `import { useTabsStore } from '@/stores/tabs'` 之后加 `import { periodLink, periodOf } from '@/nav/deepLink'`（ReconWorkbench 在它的 tabs import 之后同样加）。

**ChurnView.vue:44-51** 整段（从 `// 深链必须 openFresh` 到 `goLedger` 的 `}`）替换为：
```ts
// 深链走 openFresh({pin:true})(spec §4.1:分析层 → 台账的页签语义不变:新开固定页签、全新实例);
// 台账屏 useDeepPeriod 在 setup 与切回都认 query(P0b),openFresh 保留的是页签语义,不是读 query 的必要条件。
// 发链统一 periodLink(§4.2):期 p=YYYY-MM,公司名走 extra.company(periodLink.co 只收 id | all),租户走 extra.tenant。
const router = useRouter()
const tabs = useTabsStore()
function goLedger(tenant: string, company: string, ym: string) {
  tabs.openFresh('ledger', { pin: true })
  router.push(periodLink('ledger', { p: periodOf(+ym.slice(0, 4), +ym.slice(5, 7)), extra: { company, tenant } }))
}
```

**FinCashflowView.vue:177-184** 同形：注释行改为 `// 深链走 openFresh({pin:true})(页签语义,spec §4.1);发链 periodLink(§4.2):p + extra.company/tenant。台账屏切回也认 query(P0b)。`，`router.push({ path: '/ledger', query: { y: …, company, tenant } })` → `router.push(periodLink('ledger', { p: periodOf(+ym.slice(0, 4), +ym.slice(5, 7)), extra: { company, tenant } }))`；`drillYm.value = null` 那行保留。

**AnomalyView.vue:146-159** 整段替换为：
```ts
// 深链走 openFresh({pin:true})(spec §4.1 页签语义不变;目标屏 useDeepPeriod 切回也认 query,P0b)。发链统一 periodLink(§4.2):
// 台账 → p + extra.company/tenant;附10 → p + co=期区(periodLink 的 co 就是附10 的期区;缺席不写,S10View 落当前册)+ extra.tenant。
function goLedger(t: MonitorTenant): void {
  const ym = model.value?.lastLedgerYm
  if (!t.company || !ym) return
  tabs.openFresh('ledger', { pin: true })
  void router.push(periodLink('ledger', { p: periodOf(+ym.slice(0, 4), +ym.slice(5, 7)), extra: { company: t.company, tenant: t.name } }))
}
function goS10(t: MonitorTenant): void {
  const ym = t.months[t.months.length - 1]
  if (!ym) return
  tabs.openFresh('sales-income', { pin: true })
  void router.push(periodLink('sales-income', { p: periodOf(+ym.slice(0, 4), +ym.slice(5, 7)), co: t.phase ?? undefined, extra: { tenant: t.name } }))
}
const go = (link: string): void => { void router.push(link) }
/** 规则引擎异常条(AnaAnomaly):录入屏目标带期与定位;落分析屏的三条 p 今天不被消费(usePeriod 单例,spec §12 遗留),带上无害。
 *  本屏这一列(otherAnoms)只有规则①②、目标都是分析屏 → 今天等于原样 push;留着为与驾驶舱同形(驾驶舱 anomTop 含③④两条录入屏规则)。 */
const goAnom = (a: AnaAnomaly): void => {
  void router.push(periodLink(a.link.slice(1), { p: periodOf(+a.ym.slice(0, 4), +a.ym.slice(5, 7)), extra: { company: a.company, tenant: a.tenant } }))
}
```
模板第 302 行 `<button class="mn-link" @click="go(a.link)">查看分析 →</button>` → `@click="goAnom(a)"`；第 261 行 `go(r.link)` 不动。`AnaAnomaly` 若本文件尚未 import，加 `import type { AnaAnomaly } from '@/analysis/anaData'`（与既有 anaData import 合并亦可）。

**CockpitView.vue**：:203-204
```ts
  tabs.openFresh('sales-income', { pin: true })   // 深链协议:KeepAlive 只在 onMounted 消费 query
  void router.push({ path: '/sales-income', query: { y: e.name.slice(0, 4), m: String(+e.name.slice(5, 7)), phase: String(s.phase) } })
```
→
```ts
  tabs.openFresh('sales-income', { pin: true })   // 页签语义(spec §4.1);发链 periodLink:p + co=期区(§4.2)
  void router.push(periodLink('sales-income', { p: periodOf(+e.name.slice(0, 4), +e.name.slice(5, 7)), co: s.phase }))
```
:234-237 `goLedger` 里 `router.push({ path: '/ledger', query: { y: …, company, tenant } })` → `router.push(periodLink('ledger', { p: periodOf(+ym.slice(0, 4), +ym.slice(5, 7)), extra: { company, tenant } }))`。:243 `const go = …` 之后加与 AnomalyView 逐字相同的 `goAnom`（含 jsdoc）。模板 :347 `@click="go(a.link)"` → `@click="goAnom(a)"`；:293 `go(c.link)` 与 :352 `go('/anomaly')` 不动。

**TenantEnergyView.vue:258-267**：
```ts
function goLedger() {
  if (!selRow.value || !ledgerYm.value) return
  tabs.openFresh('ledger', { pin: true })
  router.push(periodLink('ledger', { p: periodOf(+ledgerYm.value.slice(0, 4), +ledgerYm.value.slice(5, 7)), extra: { company: selCompany.value, tenant: selRow.value.name } }))
}
function goS10() {
  if (!selRow.value || !curYm.value) return
  tabs.openFresh('sales-income', { pin: true })
  router.push(periodLink('sales-income', { p: periodOf(+curYm.value.slice(0, 4), +curYm.value.slice(5, 7)), co: selRow.value.phase, extra: { tenant: selRow.value.name } }))
}
```
（`selRow.value.phase` 若类型可空，写 `co: selRow.value.phase ?? undefined`。）:252 注释 `// ── 深链(openFresh+query 协议,参照 ChurnView.goLedger) ──` → `// ── 深链(openFresh 页签语义 + periodLink 发链,参照 ChurnView.goLedger) ──`。

**BudgetView.vue:129-133 / PnlAnalysisView.vue:78-82**：
```ts
// 深链走 openFresh(页签语义,spec §4.1);发链 periodLink(§4.2):年表屏只取年,p=YYYY(改前 ?y=,parsePeriod 仍认旧书签)
function goSched(nav: string): void {
  tabs.openFresh(nav, { pin: true })
  router.push(periodLink(nav, { p: periodOf(year.value, null) }))
}
```
（`year` 若是 string ref，写 `periodOf(+year.value, null)`。）

**ReconWorkbench.vue:113-134** 整段替换为：
```ts
// 跳转深链(spec 2026-07-07 §一 / SIDEBAR-UX-REDESIGN §4.1):目标页固定为钉住 tab + 全新实例(openFresh)+ query 定位租户行。
// 多公司记户取第一张卡(弹窗里本就按卡展示)。发链 periodLink(§4.2):台账 p + extra.company/tenant;附10 p + co=期区 + extra.tenant
// (没有附10 卡就不写 co:S10View 落当前册,新实例默认一期,与改前 ?? 1 同落点)。目标屏 useDeepPeriod 首载与切回都认 query(P0b)。
function jumpLedger() {
  const e = selected.value
  if (!e) return
  dlg.value = null
  tabs.openFresh('ledger', { pin: true })
  router.push(periodLink('ledger', { p: periodOf(props.year, props.month), extra: { company: e.ledgerCards[0]?.companyName, tenant: e.tenantName } }))
}
function jumpS10() {
  const e = selected.value
  if (!e) return
  dlg.value = null
  tabs.openFresh('sales-income', { pin: true })
  router.push(periodLink('sales-income', { p: periodOf(props.year, props.month), co: e.s10Cards[0]?.phase, extra: { tenant: e.tenantName } }))
}
```

- [ ] **Step 3: anaData 异常条带定位**

`frontend/src/analysis/anaData.ts:332-333`：
```ts
  link: string      // 深链(分析屏或录入屏路由)
  ym: string        // 所属期间 YYYY-MM
```
→
```ts
  link: string      // 深链目标路径(分析屏或录入屏);消费方按 ym(+company/tenant)组 periodLink(P0c)
  ym: string        // 所属期间 YYYY-MM
  company?: string  // 台账负值行:管理公司名(台账深链 extra.company)
  tenant?: string   // 租户维度规则:租户名(录入屏 extra.tenant 定位行)
```
规则 ③ `value: `¥${fInt(tot)}`, link: '/churn', ym: c,` → 末尾加 ` tenant: name,`；规则 ④ s10 `link: '/sales-income', ym: r.acctMonth,` → 加 ` tenant: r.tenantName,`；规则 ④ 台账 `link: '/ledger', ym,` → 加 ` company: r.companyName, tenant: r.tenantName,`。`anaAnomaly.spec` 若有整对象 `toEqual` 被新字段撞红 → 那是数据形状的钉子，往期望里补这两个字段（记进复查记录「既有断言改动」）；只钉 `.link` 的四条不动。

- [ ] **Step 4: 删 utils/deepLink + 注释口径**

```bash
git rm frontend/src/utils/deepLink.ts frontend/src/utils/deepLink.spec.ts
```
`frontend/src/nav/__tests__/deepLink.spec.ts`：删第 6 行 `import { parseLedgerDeepLink, parseS10DeepLink } from '@/utils/deepLink'` 与第 66-71 行那条 `it('utils/deepLink 两个解析器认 p;…')`；describe 标题 `'旧解析器委托后:认 p,旧口径原样'` 不动。
`ledgerDeepLink.spec.ts:106` / `s10DeepLink.spec.ts:106`：用例标题里「收入核对 / 分析层 … 本期不改发链侧」那句改为「发链侧 P0c 已迁 periodLink;解析侧永远认旧格式 —— 地址栏里已存在的旧书签仍须落得到」（`grep -n "不改发链侧" src/views/__tests__/*.spec.ts` 找准确位置），断言一字不动。

- [ ] **Step 5: 跑绿 + tsc + 门禁**

Run: `cd frontend && npx vue-tsc --noEmit && npx vitest run src/views/__tests__/anaDeepLink.spec.ts src/nav src/analysis src/views/__tests__/ledgerDeepLink.spec.ts src/views/__tests__/s10DeepLink.spec.ts src/views/__tests__/noInteractionLayoutShift.spec.ts && grep -rn "from '@/utils/deepLink'\|utils/deepLink\.ts" src`
Expected: tsc 0（`utils/deepLink` 零引用的证明）；全绿；grep 零命中（`nav/deepLink.ts:6` 注释里的「utils/deepLink 既有口径」字样不在此列，那行属「不改的模块」，不动）。

- [ ] **Step 6: 破坏验证**

① ChurnView 改回 `query: { y: …` → 门禁第 1 条红；② ReconWorkbench 删 `{ pin: true }` → `openFresh` 那条红；③ 把 `utils/deepLink.ts` 从 git 恢复（`git show HEAD:frontend/src/utils/deepLink.ts > frontend/src/utils/deepLink.ts`）→ 「已删」那条红，删回去；④ 手动核一次 `periodLink('sales-income', { p: '2025-03', co: undefined, extra: { tenant: '甲' } })` 的返回（`npx vitest run src/nav/__tests__/deepLink.spec.ts` 里加临时 `console.log` 或 node 一行）证明 co 缺席不写 —— 这条决定 ReconWorkbench 去掉 `?? 1` 后的落点。还原后 `git status` 只剩本任务改动。

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src/views/analysis frontend/src/views/reports/recon/ReconWorkbench.vue frontend/src/analysis/anaData.ts frontend/src/utils frontend/src/nav/__tests__/deepLink.spec.ts frontend/src/views/__tests__/anaDeepLink.spec.ts frontend/src/views/__tests__/ledgerDeepLink.spec.ts frontend/src/views/__tests__/s10DeepLink.spec.ts
git commit -m "feat(analysis): 分析层 / 收入核对 12 处发链统一 periodLink(公司名 extra.company、期区 co);异常条带定位;删零消费方 utils/deepLink;发链源码门禁"
```

---
### Task 5: 三个假下钻变真下钻（电费成本 / 分桩某桩 / 合同号）

**Files:**
- Modify: `frontend/src/views/analysis/ElecAnalysisView.vue:109-113`
- Modify: `frontend/src/views/analysis/ChargingAnalysisView.vue:82-88`
- Modify: `frontend/src/views/charging/CpMeterView.vue`（import；`useDeepPeriod` 块之后；`loadStations` 成功分支）
- Modify: `frontend/src/views/analysis/ExpiryView.vue:126`
- Modify: `frontend/src/views/contracts/ContractsView.vue:2-3`（import）、`:45` 之后（读链）、`:51`（onReactivated）
- Modify: `frontend/src/views/__tests__/schedDeepLink.spec.ts`（ElecCost 桩 + 1 条）、`cpMeterFlow.spec.ts`（+2 条）、`exactPlaceholderScreens.spec.ts:46` 之后（vue-router 桩）、`anaDeepLink.spec.ts`（+3 条）
- Create: `frontend/src/views/__tests__/contractsDeepLink.spec.ts`

**Interfaces:**
- Consumes: `periodLink` / `periodOf`；ElecView 读 `?mode=`（P0b，`MODES` id `summary | cost`）；ElecCostView 读 `?p=YYYY-MM`（挂在 mode=cost 下才存在）；ChargingView 读 `?mode=`（`summary | meter`）；CpMeterView 的 `picked` / `myStations` / `openSt` / `loadStations`（既有）；ContractsView 的 `q`（:35）与 `onReactivated`（`@/composables/onReactivated`）。
- Produces: 发链 query 键 `station`（桩 id）、`contractNo`（合同号）；`anaDeepLink.spec` 三条新门禁。

- [ ] **Step 1: 门禁先红（anaDeepLink.spec）**

`SENDERS` 数组加两项 `'views/analysis/ElecAnalysisView.vue'`、`'views/analysis/ChargingAnalysisView.vue'`；`describe` 里追加：

```ts
  it('电费收益「去看成本」发 mode=cost(改前发 view=cost,键名对不上 ElecView 的 ?mode=,永远落报送台账)', () => {
    expect(src('views/analysis/ElecAnalysisView.vue').includes("mode: 'cost'")).toBe(true)
  })
  it('充电桩分析点桩柱发 mode=meter + station(改前裸 push 到门为止)', () => {
    const s = src('views/analysis/ChargingAnalysisView.vue')
    expect(s.includes("mode: 'meter'")).toBe(true)
    expect(s.includes('station:')).toBe(true)
  })
  it('到期墙点行带合同号(合同没有期,不走 periodLink —— 目标是 ContractsView 的搜索框)', () => {
    expect(src('views/analysis/ExpiryView.vue').includes('contractNo:')).toBe(true)
  })
```

Run: `cd frontend && npx vitest run src/views/__tests__/anaDeepLink.spec.ts` → 新三条 + it.each 两项红。

- [ ] **Step 2: 电费成本 —— 发链侧 + 消费侧用例**

`ElecAnalysisView.vue:109-113` 替换为（import 段加 `import { periodLink, periodOf } from '@/nav/deepLink'`）：
```ts
// ── 深链电费成本第二本账(cost):ElecView 认 ?mode=(P0b),子屏 ElecCostView 认 ?p=YYYY-MM 落月(只有年 → 停在它的月门) ──
// 改前发的是 view=cost —— 键名对不上,永远落在报送台账(假下钻)。openFresh 页签语义不变(spec §4.1)。
function goCost(month?: number): void {
  tabs.openFresh('elec-cost', { pin: true })
  void router.push(periodLink('elec-cost', { p: periodOf(year.value, month ?? null), extra: { mode: 'cost' } }))
}
```

`schedDeepLink.spec.ts`：在第 17 行 `vi.mock('@/api/elec', …)` 之后加 ElecCostView 的两个桩（照 `elecCostFlow.spec.ts:25-48` 逐字）：
```ts
// 第二本账 ElecCostView 只在 mode=cost 下挂;它的 api 与锁照 elecCostFlow.spec:25-48
vi.mock('@/api/elecCost', () => ({
  elecCostApi: {
    meters: vi.fn(), createMeter: vi.fn(), updateMeter: vi.fn(), deleteMeter: vi.fn(),
    years: vi.fn(), months: vi.fn(),
    entries: vi.fn(), upsertEntry: vi.fn(), deleteEntry: vi.fn(),
    priceCfg: vi.fn(), savePriceCfg: vi.fn(),
    importRows: vi.fn(), simulate: vi.fn(),
    metrics: vi.fn(), metricsYear: vi.fn(),
  },
}))
vi.mock('@/api/locks', () => ({
  locksApi: {
    acquire: () => Promise.resolve({ granted: true, holder: null }),
    release: () => Promise.resolve(),
    heartbeat: () => Promise.resolve({ evicted: null }),
    takeover: () => Promise.resolve({ granted: true, holder: null }),
    releaseOnUnload: () => {},
  },
}))
```
import 段加 `import ElecCostView from '@/views/elec/ElecCostView.vue'` 与 `import { elecCostApi } from '@/api/elecCost'`；`beforeEach` 末尾加：
```ts
  vi.mocked(elecCostApi.meters).mockResolvedValue([] as never)
  vi.mocked(elecCostApi.years).mockResolvedValue([2025] as never)
  vi.mocked(elecCostApi.months).mockResolvedValue(['2025-03'] as never)
  vi.mocked(elecCostApi.entries).mockResolvedValue([] as never)
  vi.mocked(elecCostApi.priceCfg).mockResolvedValue([] as never)
  vi.mocked(elecCostApi.metrics).mockResolvedValue([] as never)
```
用例（`describe('年表屏 · 期间深链')` 里追加）：
```ts
  it('电费:?mode=cost&p=2025-03 → 第二本账 ElecCostView 挂起且直落 2025-03(电费收益「去看成本」的真下钻)', async () => {
    query.mode = 'cost'; query.p = '2025-03'
    const w = await open(ElecView)
    expect(w.findComponent(ElecCostView).exists(), 'mode=cost 才挂第二本账').toBe(true)
    expect(elecCostApi.entries).toHaveBeenCalledWith(2025, 3)
    expect(elecApi.records, '报送台账那本不该被拉').not.toHaveBeenCalled()
  })
```
（本 spec 的 `beforeEach` 已清 `query`；若 `mode` 键没被清，补 `delete query.mode`。）

- [ ] **Step 3: 分桩某桩 —— 发链侧 + 消费侧**

`ChargingAnalysisView.vue:82-88` 替换为（import 段加 `import { periodLink, periodOf } from '@/nav/deepLink'`）：
```ts
// 深链分桩运营账(第二本账 meter):ChargingView 认 ?mode=(P0b),子屏 CpMeterView 认 ?p=YYYY-MM 落月 + ?station=<桩 id> 直开该桩抽屉。
// 图1 点桩柱:seriesName = 桩名 → 桩 id,dataIndex = 月;环图 / 费率图点的是运营商,没有桩也没有月 → 只发 mode + 年。
// 改前裸 push 不带参(假下钻:到门为止)。openFresh 页签语义不变(spec §4.1)。
const navValue = computed(() => (tab.value === 'ebike' ? 'ebike-charging' : 'car-charging'))
function goDetail(p?: unknown): void {
  const e = p as { seriesName?: string; dataIndex?: number } | undefined
  const st = myStations.value.find((s) => s.name === e?.seriesName)
  const month = st && e?.dataIndex != null ? e.dataIndex + 1 : null
  tabs.openFresh(navValue.value, { pin: true })
  void router.push(periodLink(navValue.value, { p: periodOf(year.value, month), extra: { mode: 'meter', station: st?.id } }))
}
```
（模板 :230 按钮 `@click="goDetail"` 与 :240/:249/:259/:269 四张图的 `@chart-click="goDetail"` 都不动：按钮传 MouseEvent、运营商图传运营商名，都匹配不到桩 → 只发 mode + 年；只有图1 的桩柱带桩与月。）

`CpMeterView.vue`：import 段加 `import { useRoute } from 'vue-router'`；`useDeepPeriod({ … })` 块（:98-101）之后加：
```ts
// 「读站」(SIDEBAR-UX-REDESIGN §4.2 分析层假下钻 → 真下钻):?station=<桩 id> 桩库到手且已选月后直开该桩抽屉。
// 只开一次(开过 / 找不到即清 pending):分析屏走 openFresh 实例总是新的;onDeactivated 清 openSt 是既有约定,开过的不在切回时重开。
// 只有年的链没选月 → pending 留着,选月后的下一次 loadStations(切回)再开。跨型(汽车屏收到电动车桩 id)找不到 → 不开、也清 pending。
const route = useRoute()
let pendingStation: number | null = Number(route.query.station) || null
function openDeepStation() {
  if (pendingStation == null || !picked.value) return
  const st = myStations.value.find(s => s.id === pendingStation) ?? null
  pendingStation = null
  if (st) openSt.value = st
}
```
`loadStations` 成功分支 `if (my === stSeq) { stations.value = data; stationsErr.value = '' }` → `if (my === stSeq) { stations.value = data; stationsErr.value = ''; openDeepStation() }`（`openDeepStation` 在 await 之后才被调，`myStations` / `openSt` 那时已声明，无 TDZ）。

`cpMeterFlow.spec.ts` 的期间深链 describe 里追加（用本 spec 既有的挂载 helper，`vehicle-type="car"`；确认 `beforeEach` 清 `query`，没清就补 `delete query.station`）：
```ts
  it('?p=2025-03&station=1 → 落月后直开「快充1」抽屉(充电桩分析点桩柱的真下钻)', async () => {
    query.p = '2025-03'; query.station = '1'
    const w = await open()
    expect((w.vm as unknown as { openSt: CpStationDTO | null }).openSt?.id).toBe(1)
  })
  it('station 是别的车型的桩(单车棚 9)→ 汽车屏不开抽屉', async () => {
    query.p = '2025-03'; query.station = '9'
    const w = await open()
    expect((w.vm as unknown as { openSt: CpStationDTO | null }).openSt).toBeNull()
  })
```

- [ ] **Step 4: 合同号 —— 发链侧 + 消费侧 + 桩补齐**

`ExpiryView.vue:126` `<tr v-for="r in soon" :key="r.id" class="exp-row" @click="router.push('/contracts')">` → `@click="router.push({ path: '/contracts', query: { contractNo: r.contractNo } })"`；:119 注释 `点行去合同屏` 后加 `(带合同号,合同屏预填搜索)`。

`ContractsView.vue`：第 2 行之后加 `import { useRoute } from 'vue-router'`；第 45 行 `const renewFrom = …` 之后加：
```ts
// 深链 ?contractNo=<合同号>(到期墙「临期 90 天」点行,SIDEBAR-UX-REDESIGN §4.2):预填搜索框定位到该合同。
// 合同没有期维度,不接 useDeepPeriod;同一套口径手写:按 fullPath 去重 + 切回再读 —— 没 query 的激活不重置用户改过的筛选,
// 同一地址切回也不把用户清掉的搜索再填回去。
const route = useRoute()
let appliedLink = ''
function readDeepLink() {
  const key = route.fullPath ?? JSON.stringify(route.query)
  if (key === appliedLink) return
  appliedLink = key
  const no = route.query.contractNo
  if (typeof no === 'string' && no) q.value = no
}
readDeepLink()
```
第 51 行 `onReactivated(reload)   // 页签切回:…` → `onReactivated(() => { readDeepLink(); void reload() })   // 页签切回:先读链再重拉(楼栋/单元/租户改动后列表 floorInfo/名称回拉,读时派生,重拉即新)`。

`exactPlaceholderScreens.spec.ts` 第 46 行 `vi.mock('@/api/ana', …)` 之后加：
```ts
// ContractsView 读 ?contractNo=(P0c);其余三屏不碰 vue-router,这个桩对它们无感
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {}, fullPath: '/x' }),
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>' },
}))
```

新建 `frontend/src/views/__tests__/contractsDeepLink.spec.ts`：
```ts
// src/views/__tests__/contractsDeepLink.spec.ts — 合同屏 ?contractNo=(到期墙「临期 90 天」点行,SIDEBAR-UX-REDESIGN §4.2 · P0c)。
// 合同没有期维度,不接 useDeepPeriod;这里钉的是同一套口径:首载预填搜索框、切回按 fullPath 去重再读、没 query 不重置。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const query: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRoute: () => ({ query, get fullPath() { return '/contracts?' + new URLSearchParams(query).toString() } }),
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: { name: 'RouterLink', template: '<a><slot /></a>' },
}))
vi.mock('@/api/contract', () => ({
  contractApi: { list: vi.fn(), summary: vi.fn(), detail: vi.fn(() => Promise.resolve(null)) },
}))

import ContractsView from '@/views/contracts/ContractsView.vue'
import { contractApi } from '@/api/contract'

type Vm = { q: string }
const OPTS = { global: { stubs: { Teleport: true, RouterLink: true, 'router-link': true } } }

/** 把屏包进 KeepAlive,alive 开关模拟切走 / 切回。 */
async function keptAlive() {
  const alive = ref(true)
  const w = mount(defineComponent({
    setup: () => () => h(KeepAlive, null, { default: () => (alive.value ? h(ContractsView) : null) }),
  }), OPTS)
  await flushPromises()
  return { alive, vm: () => w.findComponent(ContractsView).vm as unknown as Vm }
}

describe('合同屏 · 合同号深链', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    for (const k of Object.keys(query)) delete query[k]
    vi.mocked(contractApi.list).mockResolvedValue([] as never)
    vi.mocked(contractApi.summary).mockResolvedValue({ total: 0, active: 0, expiring: 0, terminated: 0 } as never)
  })

  it('?contractNo=HT-2025-001 → 搜索框预填该合同号', async () => {
    query.contractNo = 'HT-2025-001'
    const { vm } = await keptAlive()
    expect(vm().q).toBe('HT-2025-001')
  })

  it('切回时地址栏没有合同号 → 不重置用户改过的搜索;列表照常重拉', async () => {
    query.contractNo = 'HT-2025-001'
    const { alive, vm } = await keptAlive()
    vm().q = '创显'
    alive.value = false; await flushPromises()
    delete query.contractNo
    alive.value = true; await flushPromises()
    expect(vm().q).toBe('创显')
    expect(contractApi.list).toHaveBeenCalledTimes(2)
  })

  it('❗切回时地址栏换了合同号 → 跟着换(到期墙点了第二行)', async () => {
    query.contractNo = 'HT-2025-001'
    const { alive, vm } = await keptAlive()
    alive.value = false; await flushPromises()
    query.contractNo = 'HT-2025-002'
    alive.value = true; await flushPromises()
    expect(vm().q).toBe('HT-2025-002')
  })

  it('同一地址切回不重复覆盖:用户清空了搜索,切回还是空', async () => {
    query.contractNo = 'HT-2025-001'
    const { alive, vm } = await keptAlive()
    vm().q = ''
    alive.value = false; await flushPromises()
    alive.value = true; await flushPromises()
    expect(vm().q).toBe('')
  })
})
```
（ContractsView 用 `useFitRows` —— 若 `exactPlaceholderScreens.spec` 顶部有 `ResizeObserver` 之类的全局桩，照抄进来。）

- [ ] **Step 5: 跑绿 + tsc**

Run: `cd frontend && npx vue-tsc --noEmit && npx vitest run src/views/__tests__/anaDeepLink.spec.ts src/views/__tests__/schedDeepLink.spec.ts src/views/__tests__/cpMeterFlow.spec.ts src/views/__tests__/exactPlaceholderScreens.spec.ts src/views/__tests__/contractsDeepLink.spec.ts src/views/__tests__/meterPeriodGate.spec.ts src/views/__tests__/elecCostFlow.spec.ts`
Expected: 全绿；tsc 0。

- [ ] **Step 6: 破坏验证**

① ElecAnalysisView `mode: 'cost'` 改回 `view: 'cost'` → 门禁红（消费侧用例证明 mode=cost 这条路真能落月，两边合起来才是「真下钻」）；② CpMeterView 删 `openDeepStation()` 那次调用 → cpMeterFlow「station=1」红；③ 删 `pendingStation = null` → 「别的车型」仍绿但 `openDeepStation` 会在每次 loadStations 重试 —— 加临时断言：切走切回后 `openSt` 仍 null（onDeactivated 清掉后不重开）；④ ContractsView 删 `if (key === appliedLink) return` → 「同一地址切回不重复覆盖」红；⑤ `onReactivated` 改回 `onReactivated(reload)` → 「换了合同号」红。逐条还原，`git status` 干净。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/views/analysis/ElecAnalysisView.vue frontend/src/views/analysis/ChargingAnalysisView.vue frontend/src/views/charging/CpMeterView.vue frontend/src/views/analysis/ExpiryView.vue frontend/src/views/contracts/ContractsView.vue frontend/src/views/__tests__/schedDeepLink.spec.ts frontend/src/views/__tests__/cpMeterFlow.spec.ts frontend/src/views/__tests__/exactPlaceholderScreens.spec.ts frontend/src/views/__tests__/anaDeepLink.spec.ts frontend/src/views/__tests__/contractsDeepLink.spec.ts
git commit -m "feat(analysis): 三个假下钻变真下钻 —— 电费成本 mode=cost 落月、分桩 station= 直开抽屉、到期墙 contractNo= 预填合同搜索"
```

---
### Task 6: 全量门禁 + spec 口径 + 复查记录

**Files:**
- Modify: `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md`（头行、§4.2 后两条、§10、§12）
- Modify: 本计划文件（追加「复查记录」）

- [ ] **Step 1: 全量门禁**

```bash
cd frontend && npx vitest run 2>&1 | tail -8
npm run build 2>&1 | tail -25
```
Expected: 基线 190 files / 2231 tests → 预期 193 files / ≈2264 tests（新 4 份 spec：reportPeriodGate 6、reportDeepLink 10、anaDeepLink 16（T4 建 11 + T5 加 it.each 2 与 3 条）、contractsDeepLink 4；改 4 份：reportWorkbenchFlow +5、schedDeepLink +1、cpMeterFlow +2；删 utils/deepLink.spec −7、reportPeriod.spec −3、nav/deepLink.spec −1；净 +33，以实跑为准），全绿。build 绿：index ≤ 191KB（预期 ≈189.4 不变：改动全在懒加载屏 chunk），合计 ≤ 3900KB。任何一项红 → 修到绿再往下，不签字上调。

- [ ] **Step 2: spec 口径**

`docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md`：
- 头行「P1、P4、P0a、P0b 已在分支…实施」→ 「P1、P4、P0a、P0b、P0c 已在分支…实施」。
- §4.2 倒数第二条（报表层三屏）末尾加：「（P0c 落地：三大报表 `useFinStatementScreen` 一处改三屏，co 指名公司不存在不落、字符串 co 视同没给；损益附表 current 只报年、apply 自按年幂等、carry 改 ref 只在 apply 写；收入核对 maxYear 只由不带年的 overview 决定；期间条 query 改 `{p, co}`，`periodQuery` 删。）」
- §4.2 最后一条里「ElecView 读 view/y/m」改为「ElecView 读 `mode`（P0b 的键；改前发 `view=` 键名对不上）+ ElecCostView 读 `p`」；「ChargingView 读站」改为「ChargingView 读 `mode=meter`，子屏 CpMeterView 读 `station`（点桩柱带月 `p=YYYY-MM`）」；「ContractsView 读合同号」改为「ContractsView 读 `contractNo` 预填搜索（合同无期，不走 periodLink）」；anaData 一句后加「（P0c：link 仍是路径，`AnaAnomaly` 加 `company?`/`tenant?`，消费方按 ym 组 periodLink；落 `/fin-cashflow` `/park-energy` `/churn` 的三条 `p` 今天不被消费 —— usePeriod 是 localStorage 单例、零 query 入口，见 §12 遗留。）」；「co 接受旧 company 名」若还在 → 改为「公司名只经 `company` 键 / `extra.company` 传，`co` 只收 id | all」；删 `utils/deepLink.ts` 的那句改为「P0c 已删（零消费方）」。
- §10 加：「P0c 例外：`reportWorkbenchFlow.spec:197` 的期间条断言由 `{y,m,co}` 改 `{p,co}`（发链形状迁移）；`reportPeriod.spec` 「期包」3 条随 `periodQuery` 删；`utils/deepLink.spec` 整份随模块删；`nav/deepLink.spec` 「utils/deepLink 两个解析器」1 条删；`anaAnomaly.spec` 若有整对象期望 → 补 `company/tenant` 两字段。」
- §12 加三行：「PnlScheduleView 期间条在 977af27 合并时被 sed `\1` 吃掉，2026-09-04 修回，`reportPeriodGate.spec` 钉九屏」「usePeriod（分析屏期）不吃 URL：三条落分析屏的异常条 `p` 暂无消费方；给 usePeriod 开深链入口留后期」「ReconView 深链首载发两次 overview（默认年 + 深链年）：可接受，上限与落年解耦的代价」。

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md
git commit -m "docs(spec): P0c 口径 —— 报表层三屏落地形状、三个真下钻的键、anaData 分析屏 p 暂无消费方(§12)、§10 例外"
```

- [ ] **Step 4: 对抗复查 + 修一波 + 复查记录**

对抗代码复查（Workflow，opus，三镜头 × 三反驳者）→ 一波修（一次 dispatch）→ 定点复审 → 「复查记录」追加到本计划文件末尾（任务级评审结论、对抗复查发现与裁定、门禁结果、既有断言改动清单、遗留）→ commit `docs(plan): P0c 复查记录`。

---

## 自查

1. **Spec 覆盖**：§4.2 报表层三屏 → T2/T3；期间条 periodLink 形状 → T2/T3；分析层发链统一 periodLink → T4；三个假下钻 → T5；anaData 五条 link → T4（三条分析屏目标裁定为遗留，T6 写进 §12）；§9 P0c 破坏验证（切回期跟随 / 无 query 不重置）→ T2（三大报表）、T3（附表 / 核对）、T5（合同屏同口径）；P0b 遗留（utils/deepLink、五处注释）→ T4；`\1` 事故 → T1。
2. **占位符扫描**：无 TBD / 「类似 Task N」；每处代码都给全文；两处「若类型可空 / 若是 string ref」是让实现者按 tsc 报错取舍的显式分支，不是占位。
3. **类型一致**：`stripQuery: Record<string,string>` 三屏同形；`DeepPeriod.co: number | 'all' | string | null` 的判法三处一致（`co === 'all' || typeof co === 'number'`）；`goAnom(a: AnaAnomaly)` 两屏逐字同；`AnaAnomaly.company?/tenant?` 与消费方 `extra: { company: a.company, tenant: a.tenant }` 对得上（undefined 被 periodLink 丢掉 —— T4 Step 6 ④ 手动核这条）；CpMeterView `pendingStation` 与发链 `extra.station = st?.id` 同为桩 id。
