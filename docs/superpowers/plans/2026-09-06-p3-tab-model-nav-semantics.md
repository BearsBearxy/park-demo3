# P3 导航入口语义 / 页签模型（ctx · evicted · pin 规则）/ 页签标题与上下文 chip 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 侧栏 / 轨 / 手机抽屉 / 手机底栏点一下不再把屏重置成全新实例 —— 恢复现场（P0a–P0c 好不容易落进去的期、公司、抽屉全都留着），KeepAlive 深度 10 → 16 覆盖专员一个月要开的屏数；「全新」收窄成三个显式动作（Shift 点击 / 关签重开 / 换层）。页签条与顶栏能说出「这一签停在哪个期、哪家公司」，页签定宽 148px 不再因改名跳动，顶栏上下文 chip 132px 常驻预留位。深链的 pin 从 16 处硬编码 `{ pin: true }` 收成一条规则：来源屏正坐在预览槽才钉住目标，否则目标照常占预览槽；预览槽被顶掉且被顶的那屏本人正在编辑时，出一条带「固定它」的 4s 提示。

**Architecture:** `stores/tabs.ts` 加三样内存态与两个动作：`ctx`（value → `{ p?, coName? }`，页签标题与顶栏 chip 的唯一数据源）、`evicted`（预览槽被替换时记下被顶的 value）、`openDeep(value)`（深链专用，按「来源是否坐在预览槽」决定 pin）。ctx 的写入**收在 `composables/useDeepPeriod` 一处**：接了深链的 18 处屏都经过这条路，屏内换期时它 watch 把期写进本屏的 ctx（台账 / 三大报表 / 附10 多传一个 `ctx()` 覆盖公司名与矩阵态）。分析层 11 屏与导入中心不接 `useDeepPeriod`（它们的期本来就不吃 URL，spec §12 已记），因此没有 ctx —— 页签只显屏名，写进 §12。四个导航入口各加一句「点当前项 / 当前层直接 return」并把 `openFresh` 换成 `open`（Shift 才 `openFresh`）；`ds/SidebarNav` 的 `select` 事件多带一个 MouseEvent 以支持 Shift。`TabStrip` 标题改成 `屏名 · 期 · 公司` 有几段写几段、`.fp-tab` 改 `flex: 0 0 148px`；`Toolbar` 面包屑后插一个定宽 132px 的常驻 chip（无期显「—」）。被顶提示复用 `AppShell` 的 `.fp-net-toast` 视觉与位置，编辑态判定走 `presence` 新增的 `holdsEditUnder(prefix)`（读本地 `editCallbacks`，不等服务端回声）。

**Tech Stack:** Vue 3 `<script setup>`（`ds/SidebarNav` 是 `defineComponent` + `h()` 渲染函数）+ Pinia + vue-router 4 + Vitest（jsdom）+ @vue/test-utils；vue-tsc strict。

**Spec:** `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md` §4.1（入口语义表）· §4.3（页签模型：pin 缺省规则 / evicted / ctx）· §6 的「页签标题」「上下文 chip」「收藏 ★」「IconRail 命令钮」四行 · §9 P3 行（破坏验证：关签重开仍全新；Shift 点击 epoch++；点当前项不 push；toast 仅编辑态出）· §10 · §12。同步修订四份既有规范（§8.2）。

## Global Constraints

- **一次一屏 + 逐条破坏验证**：每条新断言都要改坏 production 让**该红的那条**红、其余绿，再还原。破坏 / 还原一律**字符串替换**，绝不 `git checkout` / `git stash`（工作区常有未提交改动）。子 agent 写的测试由控制者独立重做破坏验证。
- **不动的东西**（改一行就是超范围）：
  - `LedgerView.gotoTenants` 的 `tabs.open('tenants', { pin: true })`（spec §4.1 明写「不变」；`ledgerLeaveAndReturn.spec` 三条断言随之不动）。
  - `ReconWorkbench.vue:121, 128` 两处 `tabs.openFresh(…, { pin: true })`（spec §4.1「收入核对 → 台账 / 附10 … 不变」）。
  - 非分析层的四处 pin 深链：`LossLedgerView:153` · `PoolLedgerView:392` · `BillNoticesView:152` · `ParamCenterView:413`（spec 只点名「分析层」；显式裁定：本期不碰，行为等价于「恒钉住」）。
  - 首页 / 报表中心的 `openFresh`：`DataHomeView.vue:91` · `ReportsHomeView.vue:47`（§4.1「首页 / 清单行 … 全新」；`reportsHomeGo.spec` 钉着）。
  - `nav/deepLink.ts` / `periodLink` / `parsePeriod` / P0a–P0c 的落期逻辑（`useDeepPeriod` 只**追加**一个 ctx watch 与一个可选 opt，`run()` 一行不改）。
  - 三个 localStorage 键（`fp-app-tabs` / `fp-app-preview` / `fp-app-recent`）的名字与序列化格式（§8.1 铁律）。`ctx` / `evicted` / `epoch` / `openTitles` 全部**只在内存**，一个都不落盘。
- **pin 缺省规则的实现形状**：新增 store 动作 `openDeep(value)` = `openFresh(value, { pin: 来源屏正坐在预览槽 })`。**来源 = `recent[0]`**：`open()` 每次都把目标推到 `recent` 队首，所以进 `openDeep` 时队首还是上一屏。天花板写进注释：刷新后第一次跳转时 `recent[0]` 来自 localStorage、未必等于当前屏 —— 代价上限是多钉或少钉一个页签，不丢数据。**不引 router 进 store**（`stores/tabs.ts` 现在只依赖 `nav/fpNav` 与 `stores/auth`，引 `@/router` 会把懒加载的视图图拉进循环）。
- **ctx 的写入点收在 `useDeepPeriod` 一处**（对 spec §4.3 枚举的六个写入点的显式裁定）：`billingPeriod.pick` / `screenPeriod.pick` / `LedgerView` 选册选月 / `useFinStatementScreen` 的 y·m·co 变化 / `useDeepPeriod.apply` 这五个写入点，**背后的屏都已经在调 `useDeepPeriod`**（实测 18 处调用：`useFinStatementScreen` 一处顶三屏、`PnlScheduleView` 一处顶五屏，加台账 / 附10 / 附12 / 运营账三屏 / 年表四屏 / 收入核对，以及 `useChainDeepPeriod` 的出账链五屏）。在 composable 里一处 watch 等价覆盖五个点，且天然拿得到本屏的 `route.meta.value` 与「期变了」的时机；分散写六处则要给 `useMonthGate` / `billingPeriod` 造出「我在哪个页签」的知识。第六点「审核态拉取」属 R2，本期不做。
- **ctx 覆盖不到分析层**（复查坐实，据实写进 §12，不在计划里声称全覆盖）：`views/analysis/` 的 11 屏与 `ImportCenterView` 都不接 `useDeepPeriod`（spec §12 已记「分析屏的期不吃 URL」、§4.2 已记导入中心不接），所以它们的页签标题只有屏名、顶栏 chip 恒显「—」。这与「有几段写几段」自洽，但不许在 Goal 里说成全覆盖。给 `usePeriod` 开深链入口连同 ctx 一起留给后期。
- **ctx 的取值不复用 `current()`**：`useFinStatementScreen.ts:128` 的 `current.p` 在矩阵态（`month == null`）是 `periodOf(year, null)` = 光秃秃一个年份 —— 那是 P0c 为「只有年的链停在矩阵」特意造的相等条件，**不是用户选了期**。照抄进 ctx 会让页签写「利润表 · 2025 · 一期公司」而用户根本没点月格（台账 `LedgerView.vue:165` 在同一状态下给的是 `null`）。所以 opt 是一个 `ctx?: () => { p: string | null; coName?: string | null }`（**一个 opt 覆盖公司名与矩阵态两件事**，不加第二个 `coName?`）；不传时默认 `{ p: o.current().p }`。年表四屏与损益附表的 `current` 只报年是**对的**（它们的期就是年），不传 opt。
- **`ctx.review` 归 R2**：`ReviewStatus` 类型要到 R1/R2 才存在。本期 `TabCtx` 只有 `p?: string` 与 `coName?: string`，R2 再加字段（`setCtx` 是浅合并的话 R2 会更好接 —— 本期实现成**整条替换**，因为期变了公司也可能变，浅合并会留下上一家公司的名字）。
- **`coName` 只有三处有来源**：台账（`company?.short || companyName`，`LedgerView.vue:75-76`）· 三大报表（`useFinStatementScreen.ts:85` 的 `companyName`，`'all'` 时给 `'全部汇总'`）· 附10（`views/sales-income/S10View.vue:253` 屏内现成的 `phase` computed → `${phase}期`，**仓里没有 `phaseOf` 这个函数**）。其余屏是园区级表，不传 opt（spec §12「公司 chips 只在台账与附10」同口径）。
- **侧栏改「恢复现场」之后，纯读屏要补切回重读**（复查坐实的阻断项，裁定：补，不留成边界）：侧栏点击此前是这些屏**唯一**的刷新入口，改成 `open` 之后「导入中心导完租户 → 侧栏点租户管理 → 看到导入前的名单」；`:max` 10 → 16 让缓存活得更久，概率只增不减。做法与 P0b 给 9 张附表屏补 `onReactivated` 逐字同形（`composables/onReactivated.ts`，天然跳过首次 activated）。**只补「重读不动用户选择」的屏**：重读会清掉筛选 / 分页 / 展开态的屏改为写进 §12，不硬补。**有草稿的屏一律不补**（本期没有这类屏落在名单里）。
- **换人清内存态**：`stores/tabs.ts` 里 `watch(() => auth.me, …)` 清 `ctx` / `evicted`（登入登出都清）。**不改 `auth.ts`**：它 `logout()` 只清 localStorage、不重置已实例化的 tabs store（`tabs` / `preview` / `recent` / `epoch` 至今都留着），从 auth 反向 import tabs 会成环（tabs 已 import auth）。ctx 跟着现有口径走，整体重置留给 P5（那期本来就要动 `auth.ts` 加 `roleNames`）—— 写进 spec §12。
- **编辑态判定不等服务端**：`presence.mode` 是服务端字段、`self` 按 user 不按 sid（同一人两个标签页都是 `self=true`），拿来判「本标签页此刻在不在编辑」会慢一拍且串台。新增 `presence.holdsEditUnder(prefix)` 直接读本地 `editCallbacks`（`stores/presence.ts:129`，`holdLock` / `dropLock` 的真源），前缀边界与 `editorsUnder` 逐字同规则（`=== p` 或 `p + ':'` 或 `p + '-'` 开头）。屏 → 锁根用现成的 `NAV_SCOPE_PREFIX`（`utils/lockScopes.ts:105-129`，值可能是 `string | string[]`，两种都要吃）。
- **被顶提示的载体不是 `FPToast`**：`FPToast` 没有动作按钮插槽（`components/fp/FPToast.vue:58-66`），而这条提示必须带「固定它」。按 spec「复用 `.fp-net-toast` 位置」在 `AppShell` 的同一个 `<Teleport to="body">` 里加一个兄弟块，复用 `.fp-net-toast` 的类与 `.act` 按钮样式；两条同时在场时给被顶提示加 `.stacked`（`bottom: 84px`）避免叠字。`.fp-net-toast` 自身的选择器、`bottom:28px`、L273 的 S 档覆盖**一个字不改**。
- **Shift 需要事件载荷**：`ds/SidebarNav.vue:184` 的 `onClick: () => …select(it.value)` 不带 MouseEvent，`emits: ["select", …]`（:115）也只带 value。改成 `onClick: (e: MouseEvent) => … select(it.value, e)` 与 `emit("select", value, e)`。**`update:modelValue` 的载荷不动**（v-model 契约）。`ds/__tests__` 下没有 SidebarNav 的挂载测，只有 `sidebarLockNote.spec` 与 `navHeight.spec` 读它 —— 两者都不碰 select 载荷。
- **手机端不做 Shift**（触屏没有修饰键）：抽屉目录项与底栏只做「当前项 / 当前层 no-op」+ `open`。`MobileNavDrawer.goRecent` 的 `open` 语义已经是对的，一行不动。
- **`:max` 只有一个落点**：`App.vue:57` 的 `:max="10"` → `16`（§4.1 末行 D9）。没有 include/exclude，淘汰全靠 key。
- **既有断言的改动清单**（超出这份清单就是超范围）：
  1. `mobileNavDrawer.spec.ts:35-42`「目录条目 = openFresh(epoch++ 全新状态)」→ 翻转成 `open`（epoch 恒 0）；spec §10 已预告「翻转 1 条」。
  2. `anaDeepLink.spec.ts:35-39`「openFresh({pin:true}) 一行不动 … pin 规则归 P3」→ 翻转成「分析层不再硬编码 pin，一律 `tabs.openDeep(`」。
  3. `anaDeepLink.spec.ts:65-70` goAnom 那条里的 `tabs.openFresh(v, { pin: true })` → `tabs.openDeep(v)`（`co: a.co,` 那半条不动）。
  4. 其余 spec 零改动。特别是 `tabs.spec.ts` 现有 18 条、`ledgerLeaveAndReturn.spec`、`reportsHomeGo.spec`、`toolbar.spec` 现有条目、`palette.spec` 6 条、`navHeight.spec`、`fpNav.spec` 全部保持绿。
- **零布局位移**（§8.1）：页签定宽与 chip 预留位是本期唯一的「新常驻元素」，两者都必须**无条件渲染**（chip 无期显「—」而不是 `v-if`），被顶提示是 `position: fixed`。`noInteractionLayoutShift.spec` 抓的是「流内块级 + v-if 引用交互态变量 + 非 absolute/fixed」的形状 —— 新增元素不许落进这个形状。
- **pin 的计数口径**（复查核对）：`views/analysis/` 下 `pin: true` 实测 **16 处、10 个文件**（不是 11 个）；`src/views/` 全仓生产代码（`--include=*.vue`）共 **23 处**，改完剩 **7 处**（`LossLedgerView:153` · `PoolLedgerView:392` · `BillNoticesView:152` · `ParamCenterView:413` · `ReconWorkbench:121,128` · **`LedgerView:685` 的 gotoTenants**）。spec §4.3 写的「分析层 9 处」是 P0c 之前的旧数，T7 一并订正为 16 处。
- **构建预算**：`npm run build` 的 size-check：index ≤ 191KB（P0c 收官实测 189.5，**余 1.5KB**），合计 ≤ 3900KB（实测 3881.3）。本期改的全是首屏常驻代码（tabs store / 四个入口 / TabStrip / Toolbar / AppShell），**很可能触线**。触线的处置顺序：① 先按 T7 的瘦身杠杆做 —— `AppShell.vue:11` 的 `CommandPalette` 静态 import 改 `defineAsyncComponent` + 模板 `v-if="paletteOpen"`（与仓里 `FPApprovalDrawer` / 手机三件套两次瘦身同一招，源码 7.9KB），② 仍超线就停下报告。**绝不上调 `BUDGET_KB.index`**。
- **EOL**：仓库 `core.autocrlf=true`，本期要改的文件混有 CRLF/LF。**禁止 `sed -i` 之类的整文件重写**；改动一律用 Edit / 精确字符串替换脚本，改完 `git diff --stat` 里不许出现「整文件重写」的行数。
- 提交信息末尾：`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。所有命令在 worktree `C:\financial_dashboard\demo3\.claude\worktrees\model-12d043`；前端命令在 `frontend/`（`npx vitest run` / `npx vue-tsc --noEmit` / `npm run build`）。

---

## 文件结构

| 文件 | 责任 |
|---|---|
| `frontend/src/stores/tabs.ts` | 新增 `ctx` / `evicted` / `setCtx` / `clearCtx` / `clearEvicted` / `openDeep`；`open` 记 evicted；`close` / `dropState` 清 ctx；换人清 ctx（T1） |
| `frontend/src/stores/__tests__/tabs.spec.ts` | +8 条（ctx 三条 / evicted 两条 / openDeep 三条），现有 18 条不动（T1） |
| `frontend/src/components/ds/SidebarNav.vue:115, 134-137, 184` | `select` 事件多带 MouseEvent（T2） |
| `frontend/src/components/shell/SidebarPanel.vue:63-67` | `onSelect(value, ev)`：当前项 return；Shift → `openFresh`，否则 `open`（T2） |
| `frontend/src/components/shell/IconRail.vue:34-39, 57, 66-69` | `goLayer(layer)`：当前层 return；命令钮补 `aria-label`（T2 / T5） |
| `frontend/src/components/shell/mobile/MobileNavDrawer.vue:44-56, 95, 109` | `goItem` 当前项 return + `open`；`goLayer` 当前层 return（:95 的 `@click="goLayer(layer.home)"` 随签名改）（T2） |
| `frontend/src/views/tenants/TenantsView.vue` · `buildings/BuildingsView.vue` · `system/System{Users,Roles,Logs}View.vue` · `views/analysis/` 的 11 屏 | 纯读屏补 `onReactivated` 切回重读（T2 Step 6b） |
| `frontend/src/components/shell/mobile/MobileBottomNav.vue:22-26` | `goLayer(layer)`：当前层 return（T2） |
| `frontend/src/App.vue:57` | KeepAlive `:max="10"` → `16`（T2） |
| `frontend/src/components/shell/__tests__/sidebarPanel.spec.ts` | +3 条点击语义（T2） |
| `frontend/src/components/shell/__tests__/iconRail.spec.ts`（新） | 3 条：当前层 no-op / 换层 openFresh / 命令钮 aria（T2，aria 那条在 T5 落地后仍在本文件） |
| `frontend/src/components/shell/mobile/mobileNavDrawer.spec.ts:35-42` | 翻转 + 补当前项 / 当前层 no-op 两条（T2） |
| `frontend/src/composables/useDeepPeriod.ts` | opts 加 `coName?`；追加 ctx watch（T3） |
| `frontend/src/views/ledger/LedgerView.vue` · `frontend/src/components/fin/useFinStatementScreen.ts` · `frontend/src/views/sales-income/S10View.vue:252-253` | 各传一个 `ctx()`（T3） |
| `frontend/src/composables/__tests__/useDeepPeriod.spec.ts` | +3 条 ctx 写入（T3） |
| `frontend/src/components/shell/TabStrip.vue:120, 127, 176-197, 231-258` | 标题拼 ctx；定宽 `flex: 0 0 148px`；溢出行同款（T4） |
| `frontend/src/components/shell/Toolbar.vue:49-51, 54-58` | ★ 补 `aria-pressed`；面包屑后插常驻 chip（T4） |
| `frontend/src/components/shell/__tests__/tabStripTitle.spec.ts`（新） | 页签标题 / 定宽 / KeepAlive 深度 5 条（T4） |
| `frontend/src/components/shell/__tests__/toolbar.spec.ts` | +2 条（chip 常驻 / ★ aria-pressed）（T4） |
| `frontend/src/stores/presence.ts:129, 251` | 新增 `holdsEditUnder(prefix)` 并导出（T5） |
| `frontend/src/components/shell/AppShell.vue` | 被顶提示块 + 样式 + 4s 计时（T5） |
| `frontend/src/components/shell/__tests__/evictToast.spec.ts`（新） | 3 条（静默 / 编辑态出 / 固定它）（T5） |
| `frontend/src/views/analysis/*.vue`（10 份 16 处） | `openFresh(…, { pin: true })` → `openDeep(…)`（T6） |
| `frontend/src/views/__tests__/anaDeepLink.spec.ts:35-39, 65-70` | 两条断言翻转（T6） |
| `docs/superpowers/specs/2026-07-07-demo3-recon-jump-tab-state-design.md` §二 · `docs/design/RESPONSIVE-LAYOUT-SPEC.md` §4.1/§4.2 · `docs/design/LAYOUT-STABILITY-SPEC.md` · `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md` 头行/§4.3/§6/§12 | 规范随裁定（T7） |

---

### Task 0: 准备与基线

**Files:** 无（只读 + 记录）

- [ ] **Step 1: 记下基线**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043
git rev-parse HEAD
git status --short
```

期望：HEAD = `53a5327`（P3 计划提交），`git status --short` 空。
**本任务控制者已代跑，实施者可跳过**：vitest 193 / 2266 全绿；build 合计 3881.5 / 3900KB，index 189.5 / 191KB（余 1.5KB）。

- [ ] **Step 2: 跑一次全量，确认起点全绿**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run 2>&1 | tail -20
```

期望：`Test Files 193 passed (193)` / `Tests 2266 passed (2266)`。数字对不上就先停，报告差异。

- [ ] **Step 3: 记下构建基线**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npm run build 2>&1 | tail -25
```

期望：size-check 通过，index ≈ 189.5 / 191KB，合计 ≈ 3881.3 / 3900KB。把这两个数字抄进本任务报告 —— T7 要拿它算本期涨了多少。

---

### Task 1: `tabs` store —— ctx / evicted / openDeep

**Files:**
- Modify: `frontend/src/stores/tabs.ts`
- Test: `frontend/src/stores/__tests__/tabs.spec.ts`

**Interfaces:**
- Consumes: 现有 `open` / `openFresh` / `pin` / `close` / `dropState` / `epochOf`、`ROUTES = fpBuildRoutes()`（:30）、`useAuthStore()`（:16-18 的 `baseHome` 已在用）。
- Produces：
  - `export interface TabCtx { p?: string; coName?: string }`
  - `ctx: Ref<Record<string, TabCtx>>`（T3 由 `useDeepPeriod` 写、T4 由 `TabStrip` / `Toolbar` 读）
  - `setCtx(value: string, c: TabCtx): void` —— **整条替换**，空字段不落键
  - `clearCtx(value?: string): void` —— 不传 = 全清
  - `evicted: Ref<string | null>` + `clearEvicted(): void`（T5 消费）
  - `openDeep(value: string): void`（T6 的 16 处调用点）

- [ ] **Step 1: 先写失败的测试**

在 `frontend/src/stores/__tests__/tabs.spec.ts` 末尾追加一个 describe（现有 18 条一行不动）：

```ts
describe('tabs store · 页签上下文 ctx / 被顶 evicted / 深链 pin 规则(P3 §4.3)', () => {
  it('setCtx 整条替换,空字段不落键;未知 value 不写', () => {
    const store = useTabsStore()
    store.setCtx('ledger', { p: '2025-06', coName: '一期公司' })
    expect(store.ctx.ledger).toEqual({ p: '2025-06', coName: '一期公司' })
    // 换期换到别家公司:整条替换,不能留着上一家的名字
    store.setCtx('ledger', { p: '2025-07' })
    expect(store.ctx.ledger).toEqual({ p: '2025-07' })
    store.setCtx('not-a-route', { p: '2025-01' })
    expect(store.ctx['not-a-route']).toBeUndefined()
  })

  it('close / dropState 清掉该页签的 ctx', () => {
    const store = useTabsStore()
    store.open('ledger', { pin: true })
    store.setCtx('ledger', { p: '2025-06' })
    store.close('ledger')
    expect(store.ctx.ledger).toBeUndefined()
    store.setCtx('tenants', { p: '2025-06' })
    store.dropState('tenants')
    expect(store.ctx.tenants).toBeUndefined()
  })

  it('换人(登入再登出)清空全部 ctx 与 evicted', async () => {
    const store = useTabsStore()
    const auth = useAuthStore()
    // ⚠ auth.me 初始就是 null(auth.ts:21 读 localStorage,beforeEach 已 clear),
    //   直接赋 null 是 null → null,watch 不触发 —— 必须先给它一个人。
    auth.me = 'zhangsan'
    await nextTick()
    store.setCtx('ledger', { p: '2025-06' })
    auth.me = null
    await nextTick()
    expect(store.ctx).toEqual({})
  })

  it('open 顶掉预览槽时记下被顶的 value;同值重开与 pin 直开不算被顶', () => {
    const store = useTabsStore()
    store.open('ledger')            // 预览槽 = ledger
    expect(store.evicted).toBeNull()
    store.open('tenants')           // 顶掉 ledger
    expect(store.evicted).toBe('ledger')
    store.clearEvicted()
    store.open('tenants')           // 同值重开
    expect(store.evicted).toBeNull()
    store.open('contracts', { pin: true })  // 直接进固定页签,不占预览槽
    expect(store.evicted).toBeNull()
  })

  it('openDeep:来源屏正坐在预览槽 → 目标钉住(来源不被顶掉)', () => {
    const store = useTabsStore()
    store.open('anomaly')                     // 来源进预览槽,recent[0] = anomaly
    store.openDeep('ledger')
    expect(store.tabs.map(t => t.value)).toContain('ledger')   // 目标钉住
    expect(store.preview?.value).toBe('anomaly')               // 来源还在
    expect(store.epochOf('ledger')).toBe(1)                    // 仍是全新实例
  })

  it('openDeep:来源已是固定页签 → 目标照常占预览槽', () => {
    const store = useTabsStore()
    store.open('anomaly', { pin: true })      // 来源钉住,recent[0] = anomaly
    store.openDeep('ledger')
    expect(store.preview?.value).toBe('ledger')
    expect(store.tabs.map(t => t.value)).not.toContain('ledger')
  })

  it('openDeep 到来源自己不把来源提成固定页签', () => {
    const store = useTabsStore()
    store.open('ledger')
    store.openDeep('ledger')
    expect(store.preview?.value).toBe('ledger')
    expect(store.tabs.map(t => t.value)).not.toContain('ledger')
  })

  it('openDeep 未知 value 不动任何槽', () => {
    const store = useTabsStore()
    const before = store.preview?.value ?? null
    store.openDeep('not-a-route')
    expect(store.preview?.value ?? null).toBe(before)
    expect(store.epochOf('not-a-route')).toBe(0)
  })
})
```

文件头 import 要补 `nextTick`（`vue`）与 `useAuthStore`（`@/stores/auth`）—— 若已存在则不重复加。

- [ ] **Step 2: 跑它,确认按预期失败**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run src/stores/__tests__/tabs.spec.ts
```

期望：新增 8 条全红（`store.setCtx is not a function` 之类），现有 18 条全绿。

- [ ] **Step 3: 实现**

在 `frontend/src/stores/tabs.ts` 的 state 段（现 :45-50）之后加：

```ts
/** 页签上下文 —— 页签标题与顶栏 chip 要显示的「这一签停在哪」。 */
export interface TabCtx { p?: string; coName?: string }
```

（`interface` 放模块顶层、`ROUTES` 之前或之后都行，但必须 `export`。）

setup 内，`epoch` 之后：

```ts
  // ── 页签上下文(spec §4.3) ──────────────────────────────
  // 未激活的页签早已卸载,屏内的 year/month/companyId 拿不到 —— 屏在换期时把期寄存到这里,
  // 页签条与顶栏才说得出「月度台账 · 2025-06 · 一期公司」。**只在内存**:三个 localStorage
  // 键的格式是铁律(§8.1),而这份东西刷新后本来就该跟着屏的实例一起重来。
  const ctx = ref<Record<string, TabCtx>>({})
  // 预览槽被顶掉时记下被顶的那个 value。出不出提示由 AppShell 判(只有本人正在编辑那屏才出)。
  const evicted = ref<string | null>(null)
```

`open()`（现 :61-78）的**非 pin 分支**里，在 `preview.value = { value }` 之前插一句：

```ts
    // 预览槽是单槽:换一个屏进来,上一个就没了。被顶的是不是正在编辑,由 AppShell 判。
    const out = preview.value?.value
    if (out && out !== value) evicted.value = out
```

新动作（放在 `dropState` 之后、`return` 之前）：

```ts
  function setCtx(value: string, c: TabCtx) {
    if (!ROUTES[value]) return
    // 整条替换而不是浅合并:期变了公司也可能变,合并会把上一家公司的名字留在标题里。
    const next: TabCtx = {}
    if (c.p) next.p = c.p
    if (c.coName) next.coName = c.coName
    ctx.value = { ...ctx.value, [value]: next }
  }

  function clearCtx(value?: string) {
    if (value == null) { ctx.value = {}; return }
    if (!(value in ctx.value)) return
    const next = { ...ctx.value }
    delete next[value]
    ctx.value = next
  }

  function clearEvicted() { evicted.value = null }

  /**
   * 深链跳转的 pin 缺省(spec §4.3):**来源屏正坐在预览槽 → 目标钉住**,否则目标照常占预览槽。
   * 来源在预览槽时若让目标也占预览槽,一跳就把来源顶没了,用户回不去 ——
   * 这正是 `LedgerView.gotoTenants` 当年硬写 `pin: true` 的理由,这里把它一般化。
   *
   * ponytail: 来源 = `recent[0]` —— `open()` 每次都把目标推到队首,所以进本函数时队首还是上一屏,
   * 不必再往 store 里塞一份「当前屏」或把 router 引进来(会成环)。
   * 天花板:刷新后的第一次跳转,`recent[0]` 来自 localStorage、未必等于当前屏 ——
   * 代价上限是多钉或少钉一个页签,不丢任何数据。
   */
  function openDeep(value: string) {
    const from = recent.value[0]
    openFresh(value, { pin: !!from && from !== value && preview.value?.value === from })
  }
```

`close()`（现 :102-123）在 `preview` / `tabs` 清理之后、`return neighbor` 之前加 `clearCtx(value)`；`dropState()`（现 :126-128）加 `clearCtx(value)`。

换人清空（放在持久化 watch 附近）：

```ts
  // 换人(登入 / 登出)清掉本次会话的内存态。auth.logout() 只清三个 localStorage 键、
  // 不重置已实例化的 store(tabs / preview / recent / epoch 至今都留着) —— 整体重置留给 P5,
  // 这里先保证新用户看不到上一个人的期与公司名。
  watch(() => useAuthStore().me, () => { ctx.value = {}; evicted.value = null })
```

`return` 面（现 :130）补：`ctx, evicted, setCtx, clearCtx, clearEvicted, openDeep`。

- [ ] **Step 4: 跑测试**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run src/stores/__tests__/tabs.spec.ts
npx vue-tsc --noEmit
```

期望：26 条全绿；tsc 零错。

- [ ] **Step 5: 逐条破坏验证**

按下表改坏 production 一处 → 跑本文件 → **只有该条红** → 还原（字符串替换，不 `git checkout`）：

| 改坏什么 | 应红的那条 |
|---|---|
| `setCtx` 的 `ctx.value = { ...ctx.value, [value]: next }` 改成 `{ ...ctx.value, [value]: { ...ctx.value[value], ...next } }`（浅合并） | 「setCtx 整条替换」 |
| `setCtx` 删掉 `if (!ROUTES[value]) return` | 「setCtx … 未知 value 不写」 |
| `close` 里删掉 `clearCtx(value)` | 「close / dropState 清掉该页签的 ctx」 |
| `open` 里的 `out !== value` 改成 `out != null` | 「同值重开 … 不算被顶」 |
| `openDeep` 的 `preview.value?.value === from` 改成 `true` | 「来源已是固定页签 → 目标照常占预览槽」 |
| `openDeep` 的 `from !== value` 删掉 | 「openDeep 到来源自己不把来源提成固定页签」 |
| 删掉 `watch(() => useAuthStore().me, …)` | 「换人 … 清空全部 ctx」 |

- [ ] **Step 6: 全量 + 提交**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run 2>&1 | tail -8
```

期望：2275 条全绿（2266 + 8，加 T1 评审修补的 1 条）。

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043
git add -A && git commit -m "$(cat <<'EOF'
feat(tabs): P3 页签模型 —— ctx(期/公司) · evicted(预览槽被顶) · openDeep(来源在预览槽才钉目标)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 四个导航入口语义 + KeepAlive 16

**Files:**
- Modify: `frontend/src/components/ds/SidebarNav.vue`（:115 emits · :134-137 `select` · :184 `onClick`）
- Modify: `frontend/src/components/shell/SidebarPanel.vue:63-67`
- Modify: `frontend/src/components/shell/IconRail.vue:34-39` + 模板 :57
- Modify: `frontend/src/components/shell/mobile/MobileNavDrawer.vue:44-56` + 模板 :109
- Modify: `frontend/src/components/shell/mobile/MobileBottomNav.vue:22-26` + 模板 :31-42
- Modify: `frontend/src/App.vue:57`
- Test: `frontend/src/components/shell/__tests__/sidebarPanel.spec.ts`（+3）· `frontend/src/components/shell/__tests__/iconRail.spec.ts`（新）· `frontend/src/components/shell/mobile/mobileNavDrawer.spec.ts`（翻转 1 + 新 2）

**Interfaces:**
- Consumes: `tabs.open` / `tabs.openFresh` / `tabs.epochOf`（T1 未改动这三个的语义）。
- Produces: `SidebarNav` 的 `select` 事件载荷 `(value: string, ev?: MouseEvent)`。

- [ ] **Step 1: 先写失败的测试 —— 侧栏**

`frontend/src/components/shell/__tests__/sidebarPanel.spec.ts` 末尾追加（文件头注释里那句「P3 会在本文件续加侧栏点击语义三条」随之删掉）：

```ts
describe('SidebarPanel · 点击语义(§4.1)', () => {
  it('点当前项:不 push、不动页签', async () => {
    const w = mountPanel()
    const tabs = useTabsStore()
    push.mockClear()
    await rowByText(w, '本月出账')!.trigger('click')
    expect(push).not.toHaveBeenCalled()
    expect(tabs.epochOf('data-home')).toBe(0)
  })

  it('点别的项 = open(恢复 KeepAlive 现场,epoch 不动)+ push', async () => {
    const w = mountPanel()
    const tabs = useTabsStore()
    await rowByText(w, '园区抄表')!.trigger('click')
    expect(tabs.epochOf('meters')).toBe(0)
    expect(tabs.preview?.value).toBe('meters')
    expect(push).toHaveBeenCalledWith('/meters')
  })

  it('Shift + 点击 = openFresh(epoch++ 全新实例)', async () => {
    const w = mountPanel()
    const tabs = useTabsStore()
    await rowByText(w, '园区抄表')!.trigger('click', { shiftKey: true })
    expect(tabs.epochOf('meters')).toBe(1)
    expect(push).toHaveBeenCalledWith('/meters')
  })
})
```

`mountPanel` / `rowByText` 用本文件既有的挂载与查行写法（现有四条用的是 `w.findAll('.fp-sbnav-row')` + `text().includes(...)`）；route mock 的 `meta.value` 是 `data-home`，所以「当前项」取「本月出账」。

- [ ] **Step 2: 先写失败的测试 —— 轨**

新建 `frontend/src/components/shell/__tests__/iconRail.spec.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import IconRail from '@/components/shell/IconRail.vue'
import { useTabsStore } from '@/stores/tabs'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { value: 'data-home' } }),
  useRouter: () => ({ push }),
}))

const mountRail = () => mount(IconRail, { global: { stubs: { Popover: true, PopoverItem: true, Avatar: true } } })
const layerBtn = (w: ReturnType<typeof mountRail>, short: string) =>
  w.findAll('button').find(b => b.text().includes(short))

describe('IconRail · 层切换语义(§4.1)', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear(); push.mockClear() })

  it('点当前层:不 push、不动页签', async () => {
    const w = mountRail()
    const tabs = useTabsStore()
    await layerBtn(w, '数据')!.trigger('click')
    expect(push).not.toHaveBeenCalled()
    expect(tabs.epochOf('data-home')).toBe(0)
  })

  it('换层 = openFresh(层首页)+ push(全新状态)', async () => {
    const w = mountRail()
    const tabs = useTabsStore()
    await layerBtn(w, '报表')!.trigger('click')
    expect(tabs.epochOf('reports-home')).toBe(1)
    expect(push).toHaveBeenCalledWith('/reports-home')
  })

  it('命令钮有 aria-label(屏读能念出它是干什么的)', () => {
    expect(mountRail().find('.fp-rail-cmd').attributes('aria-label')).toBeTruthy()
  })
})
```

⚠ 实施者先跑一次看层按钮的可见文字（`layer.short`）与层首页 value 到底是什么（`nav/fpNav.ts` 的 `NavLayer.short` / `.home`），断言里的 `'数据'` / `'报表'` / `'reports-home'` 按实际值改；auth 的 `navLayers` 缺省包含 data/reports/analysis（`stores/auth.ts:36` 的 `DEFAULT_NAV_LAYERS`），不必额外造桩。头像 Popover 若在 jsdom 里报错，按需补 stub。

- [ ] **Step 3: 先写失败的测试 —— 手机抽屉与底栏**

`frontend/src/components/shell/mobile/mobileNavDrawer.spec.ts`：
把 :35-42 那条整条替换成

```ts
  it('目录条目 = open(恢复 KeepAlive 现场,epoch 不动)+ push + 关抽屉(P3 §4.1:与桌面侧栏同义)', async () => {
    const w = mountDrawer()
    const tabs = useTabsStore()
    await w.findAll('.mnav-row').find(r => r.text().includes('租户管理'))!.trigger('click')
    expect(tabs.epochOf('tenants')).toBe(0)
    expect(tabs.preview?.value).toBe('tenants')
    expect(push).toHaveBeenCalledWith('/tenants')
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('点当前屏的目录条目:不 push,但照常关抽屉', async () => {
    const w = mountDrawer()
    push.mockClear()
    await w.findAll('.mnav-row').find(r => r.text().includes('本月出账'))!.trigger('click')
    expect(push).not.toHaveBeenCalled()
    expect(w.emitted('close')).toHaveLength(1)
  })
```

底栏那个 describe 里（现 :72 那条之后）加：

```ts
  it('点当前层:不 push、不动页签(§4.1)', async () => {
    const w = mountBottom()
    const tabs = useTabsStore()
    push.mockClear()
    await w.findAll('button').find(b => b.text().includes('数据'))!.trigger('click')
    expect(push).not.toHaveBeenCalled()
    expect(tabs.epochOf('data-home')).toBe(0)
  })
```

（`mountBottom` 用本文件既有写法；层短名按实际值。）

- [ ] **Step 4: 跑三份,确认按预期失败**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run src/components/shell/__tests__/sidebarPanel.spec.ts src/components/shell/__tests__/iconRail.spec.ts src/components/shell/mobile/mobileNavDrawer.spec.ts
```

期望：新增 / 翻转的 8 条红（侧栏 3 + 轨 3 + 抽屉 2 —— 原 :35-42 那一条被拆成「目录条目 = open」与「点当前屏只关抽屉」两条 —— 加底栏 1，净 +8），其余绿。

- [ ] **Step 5: 实现 —— `ds/SidebarNav` 带上事件**

`frontend/src/components/ds/SidebarNav.vue`：

```ts
    function select(value: string, ev?: MouseEvent) {
      emit("select", value, ev);
      emit("update:modelValue", value);
    }
```

`onClick`（:184）：

```ts
          onClick: (e: MouseEvent) => isDir ? toggle(it.value) : select(it.value, e),
```

`emits` 数组（:115）不用改（数组式声明不带载荷类型）。**`update:modelValue` 的载荷保持只有 value。**

- [ ] **Step 6: 实现 —— 四个入口**

`SidebarPanel.vue:63-67` 整段换成：

```ts
// 侧栏点击 = **恢复现场**(P3 §4.1):KeepAlive 里那份实例连同 P0a–P0c 落进去的期、公司、
// 抽屉一起留着 —— 「导航一次重过一次门」正是这一期要消灭的东西。
// 「全新」收窄成三个显式动作:Shift + 点击 / 关签后重开(dropState) / 换层。
function onSelect(value: string, ev?: MouseEvent) {
  if (value === activeValue.value) return
  if (ev?.shiftKey) tabs.openFresh(value)
  else tabs.open(value)
  router.push('/' + value)
}
```

`IconRail.vue`：`goLayer` 改成吃整个 layer（模板 :57 的 `@click="goLayer(layer.home)"` → `@click="goLayer(layer)"`）：

```ts
// 点当前层什么都不做(§4.1):它既不换屏也不该把当前层首页重置成全新实例。
function goLayer(layer: NavLayer) {
  if (layer.id === activeLayer.value.id) return
  tabsStore.openFresh(layer.home)
  router.push('/' + layer.home)
}
```

（`NavLayer` 从 `@/nav/fpNav` import type；`activeLayer` 是 computed，注意 `.value`。）

`MobileBottomNav.vue:22-26` 同形（模板 :36 的 `@click="goLayer(layer.home)"` → `@click="goLayer(layer)"`）。

`MobileNavDrawer.vue`：

```ts
// 层切换段与 IconRail 同义(换层 = 全新),点当前层不动;抽屉不关(用户可能还要在层内挑屏)。
function goLayer(layer: NavLayer) {
  if (layer.id === activeLayer.value.id) return
  tabs.openFresh(layer.home)
  router.push('/' + layer.home)
}

// 目录条目与桌面侧栏同义:恢复现场(§4.1)。触屏没有修饰键,不做 Shift。
function goItem(value: string) {
  if (value !== activeValue.value) {
    tabs.open(value)
    router.push('/' + value)
  }
  emit('close')
}
```

（`activeValue` 若本文件还没有，按 `SidebarPanel.vue:27-29` 的写法补一个 computed；`goRecent` 一行不动。**模板 :95 的 `@click="goLayer(layer.home)"` 要跟着改成 `goLayer(layer)`**，否则 tsc 报 string → NavLayer。）

`App.vue:57`：`:max="10"` → `:max="16"`，并把 :52-54 的注释补一句：

```
       max 16 = 专员一个月要开的屏数(D9;spec §4.1 末行)。侧栏点击不再重置实例之后,
       这个数字决定「切回去还在不在」——10 时排在第 11 个的屏一切回就是空白重来。
```

- [ ] **Step 6b: 纯读屏补切回重读**

侧栏改成「恢复现场」之后，这些屏**再没有任何刷新入口**（它们只在 `onMounted` 取数、没有 `onReactivated`）。逐屏加一行，写法与 P0b 给附表屏补的逐字同形：

```ts
import { onReactivated } from '@/composables/onReactivated'
// 侧栏点击自 P3 起是「恢复现场」,不再重建实例 —— 纯读屏没有草稿要保,
// 切回来该看最新的(导入中心导完租户,回这屏必须是新名单)。
onReactivated(() => { void reload() })
```

名单（复查实测「只有 onMounted、无 onReactivated」的生产屏）：

`views/tenants/TenantsView.vue` · `views/buildings/BuildingsView.vue` · `views/system/SystemUsersView.vue` · `SystemRolesView.vue` · `SystemLogsView.vue` · `views/analysis/` 的 `BudgetView` · `ChargingAnalysisView` · `FinCashflowView` · `ParkView` · `PvRoiView` · `PvMeterAnaView` · `TenantEnergyView` · `TenantPortfolioView` · `BreakevenView` · `ExpiryView`（`CockpitView` 的取数在 `AnaShell` 里，按实际落点补）。

**逐屏两条判据，任缺一条就不补、改为记进 §12**：
1. 屏内那个取数函数（`reload` / `load` / `refresh`，各屏名字不同）**只换数据**，不清筛选 / 分页 / 展开 / 抽屉等用户选择；
2. 屏内没有草稿态（没有 `dirty` / `draft` / 编辑锁）。

不补的屏在本任务报告里逐个列出理由，T7 写进 spec §12。

验证用一条挂载测（放在 `frontend/src/views/__tests__/readScreenRefresh.spec.ts`，新建）：挑 `TenantsView` 一屏，mount → 断言取数一次 → 触发 `onReactivated` 的宿主钩子 → 断言取数两次。其余屏用源码门禁一条兜住（本文件同 spec 内）：名单里补了的每一屏源码都含 `onReactivated(`。**两条用例都要能被破坏验证**：删掉 `TenantsView` 的那一行 → 两条都红。

- [ ] **Step 7: 跑三份 + 全量**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run src/components/shell 2>&1 | tail -8
npx vitest run 2>&1 | tail -8
npx vue-tsc --noEmit
```

期望：新增 10 条绿（入口语义 8 + 纯读屏 2；实际 readScreenRefresh 的源码门禁按 13 屏 it.each 展开，落地为 +22，评审已查实无计划外断言）；全量绿；tsc 零错。若 `reportsHomeGo.spec` / `ledgerLeaveAndReturn.spec` 红了 —— **停下报告**，它们本期不该动。

- [ ] **Step 8: 逐条破坏验证**

| 改坏什么 | 应红的那条 |
|---|---|
| `onSelect` 删掉 `if (value === activeValue.value) return` | 侧栏「点当前项:不 push」 |
| `onSelect` 的 `tabs.open(value)` 改回 `tabs.openFresh(value)` | 侧栏「点别的项 = open」 |
| `onSelect` 的 `ev?.shiftKey` 改成 `false` | 侧栏「Shift + 点击 = openFresh」 |
| `SidebarNav` 的 `select(it.value, e)` 改回 `select(it.value)` | 侧栏「Shift + 点击」（证明事件载荷是真通路） |
| `IconRail.goLayer` 删掉当前层 guard | 轨「点当前层」 |
| `MobileNavDrawer.goItem` 的 `tabs.open` 改回 `openFresh` | 抽屉「目录条目 = open」 |
| `MobileBottomNav.goLayer` 删掉 guard | 底栏「点当前层」 |
| 删掉 `TenantsView` 的 `onReactivated(() => { void reload() })` | 「纯读屏切回重读」两条（挂载测 + 源码门禁） |

- [ ] **Step 9: 提交**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043
git add -A && git commit -m "$(cat <<'EOF'
feat(nav): P3 入口语义 —— 侧栏/抽屉点击恢复现场、点当前项与当前层 no-op、Shift 才全新;KeepAlive 10 → 16

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: ctx 的写入 —— `useDeepPeriod` 一处 + 三个 `coName`

**Files:**
- Modify: `frontend/src/composables/useDeepPeriod.ts`
- Modify: `frontend/src/views/ledger/LedgerView.vue`（`useDeepPeriod` 调用处）· `frontend/src/components/fin/useFinStatementScreen.ts`（同）· `frontend/src/views/sales-income/S10View.vue:252-253`（同）
- Test: `frontend/src/composables/__tests__/useDeepPeriod.spec.ts`

**Interfaces:**
- Consumes: `tabs.setCtx`（T1）；`o.current()` 现有形状 `{ p: string | null; co?: number | 'all' | string | null }`。
- Produces: `DeepPeriodOpts.ctx?: () => { p: string | null; coName?: string | null }`（不传时默认 `{ p: o.current().p }`）。

- [ ] **Step 1: 先写失败的测试**

在 `frontend/src/composables/__tests__/useDeepPeriod.spec.ts` 末尾追加：

```ts
describe('useDeepPeriod · 写页签上下文(P3 §4.3)', () => {
  it('首跑就把本屏的期写进 ctx(键 = route.meta.value)', () => {
    route.query = {}
    route.meta = { value: 'ledger' }
    const year = ref(2025), month = ref<number | null>(6)
    mountWith(() => useDeepPeriod({
      current: () => ({ p: year.value ? `${year.value}-0${month.value}` : null }),
      apply: () => {},
    }))
    expect(useTabsStore().ctx.ledger).toEqual({ p: '2025-06' })
  })

  it('屏内换期(不经地址栏)也写 ctx —— 页签标题跟着屏走', async () => {
    // …同上挂载后
    month.value = 7
    await nextTick()
    expect(useTabsStore().ctx.ledger).toEqual({ p: '2025-07' })
  })

  it('传了 ctx() 就按它写(公司名一起进去),而不是照抄 current()', () => {
    // ctx: () => ({ p: '2025-06', coName: '一期公司' });current 故意返回别的 p
    expect(useTabsStore().ctx.ledger).toEqual({ p: '2025-06', coName: '一期公司' })
  })

  it('ctx() 的 p 为 null(停在选期矩阵)→ ctx 只剩空壳,页签只显屏名', () => {
    // ctx: () => ({ p: null, coName: '一期公司' }) —— 没选期就不该在页签上写期
    expect(useTabsStore().ctx.ledger).toEqual({ coName: '一期公司' })
  })
})
```

⚠ 实施者按本文件既有的挂载辅助（现有用例已有一套「造一个 setup 组件 + 可变 route」的写法）落实，别新造第二套；`route.meta` 若现有桩里没有，要补上（`meta: { value: 'ledger' }`）。三条用例共用一个 `mountWith`。

- [ ] **Step 2: 跑它,确认失败**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run src/composables/__tests__/useDeepPeriod.spec.ts
```

期望：新增 4 条红，现有条目绿。

- [ ] **Step 3: 实现 —— composable**

`frontend/src/composables/useDeepPeriod.ts` 的 `DeepPeriodOpts`（:16-22）加一个可选项：

```ts
  /**
   * 写进页签上下文的期与公司名(spec §4.3)。不传就用 `current().p` ——
   * 传的理由只有两个:① 本屏有公司 / 期区维度(台账、三大报表、附10);
   * ② 本屏的 `current().p` 是为深链相等判造的、与用户看到的期不是一回事
   *    (三大报表矩阵态 `current.p` 是光秃秃一个年份,那是「只有年的链停在矩阵」的相等条件,
   *     不是用户选了期 —— 照抄进页签会写出「利润表 · 2025」而用户没点月格)。
   */
  ctx?: () => { p: string | null; coName?: string | null }
```

`useDeepPeriod` 体内（`run(true)` 之前或之后都行，放 `onReactivated` 之后最不打扰阅读顺序）加：

```ts
  // ── 把本屏的期寄存进页签上下文(spec §4.3) ─────────────────
  // 收在这里而不是散在 billingPeriod.pick / screenPeriod.pick / LedgerView / useFinStatementScreen
  // 四处:所有有期的屏本来就都经过这条路,而这里天然拿得到「我是哪个页签」(route.meta.value)
  // 与「期变了」的时机。深链落期与屏内自己换期走的是同一个 current(),两条路一起覆盖。
  const tabs = useTabsStore()
  const navValue = (route.meta as Record<string, unknown>)?.value
  if (typeof navValue === 'string' && navValue) {
    watch(
      () => (o.ctx ? o.ctx() : { p: o.current().p, coName: null }),
      (c) => tabs.setCtx(navValue, { p: c.p ?? undefined, coName: c.coName ?? undefined }),
      { immediate: true },
    )
  }
```

（`watch` / `useTabsStore` 按需补 import。**不要**加 `deep: true` —— getter 每次返回新对象，依赖变化时本来就会触发；deep 只会多跑。）

- [ ] **Step 4: 实现 —— 三个 `coName`**

台账（`LedgerView.vue` 的 `useDeepPeriod({...})` 调用处；`current.p` 在矩阵态本来就给 null，:165 原样）：

```ts
  ctx: () => ({ p: month.value == null ? null : periodOf(year.value, month.value), coName: company.value?.short || companyName.value || null }),
```

三大报表（`useFinStatementScreen.ts` 的调用处；**这里的 p 与 `current.p` 故意不同**，见 opt 注释）：

```ts
  ctx: () => ({
    p: month.value == null ? null : periodOf(year.value, month.value),
    coName: companyId.value === 'all' ? '全部汇总' : companyName.value,
  }),
```

附10（`views/sales-income/S10View.vue:252-253` 的调用处；期区用屏内现成的 `phase` computed，**仓里没有 `phaseOf`**）：

```ts
  ctx: () => ({ p: current().p, coName: phase.value == null ? null : `${phase.value}期` }),
```

⚠ 附10 那句里的 `current().p` 按屏内实际写法取（它的 `current` 是内联箭头，直接把同样的表达式抄一遍即可，别为此提取函数）。

- [ ] **Step 5: 跑测试 + 全量**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run src/composables src/views/__tests__ 2>&1 | tail -8
npx vitest run 2>&1 | tail -8
npx vue-tsc --noEmit
```

期望：全量 2306 条（T2 收尾 2302 + 4）全绿。**特别盯**：P0a–P0c 的深链用例（`ledgerDeepLink` / `s10DeepLink` / `schedDeepLink` / `reportDeepLink` / `reportWorkbenchFlow` / `cpMeterFlow`）一条都不许红 —— 它们的 route 桩多半没有 `meta`，`navValue` 取不到就跳过写 ctx，这正是上面那个 `typeof` 判的用处。

- [ ] **Step 6: 逐条破坏验证**

| 改坏什么 | 应红的那条 |
|---|---|
| 删掉 `watch(...)` 整段 | 「首跑就把本屏的期写进 ctx」 |
| `{ immediate: true }` 去掉 | 「首跑就把本屏的期写进 ctx」（换期那条仍绿 —— 正是要区分的两件事） |
| `tabs.setCtx(navValue, …)` 的 `navValue` 换成硬编码 `'ledger'` 之外的值 | 「键 = route.meta.value」 |
| `coName: c.coName ?? undefined` 改成恒 `undefined` | 「传了 ctx() 就按它写」 |
| `o.ctx ? o.ctx() : …` 改成恒走 `current()` 那支 | 「传了 ctx() 就按它写」（三大报表矩阵态那条同理） |

- [ ] **Step 7: 提交**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043
git add -A && git commit -m "$(cat <<'EOF'
feat(tabs): P3 页签上下文写入 —— useDeepPeriod 一处 watch 覆盖全部有期的屏;台账/三大报表/附10 传公司名

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 页签标题与定宽 + 顶栏上下文 chip + 两个 aria

**Files:**
- Modify: `frontend/src/components/shell/TabStrip.vue`（:120 title · :127 label · :176-197 溢出行 · :231-240 与 :255-258 CSS）
- Modify: `frontend/src/components/shell/Toolbar.vue`（:49-51 ★ · :54-58 面包屑后插 chip · 样式段）
- Test: `frontend/src/components/shell/__tests__/tabStripTitle.spec.ts`（新）· `frontend/src/components/shell/__tests__/toolbar.spec.ts`（+2）

**Interfaces:**
- Consumes: `tabs.ctx`（T1/T3）、`ROUTES = fpBuildRoutes()`（TabStrip :17 已有）。

- [ ] **Step 1: 先写失败的测试 —— 页签**

新建 `frontend/src/components/shell/__tests__/tabStripTitle.spec.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import TabStrip from '@/components/shell/TabStrip.vue'
import { useTabsStore } from '@/stores/tabs'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { value: 'ledger' }, path: '/ledger' }),
  useRouter: () => ({ push }),
}))

const SRC = join(__dirname, '..', '..', '..')
const src = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

// TabStrip.vue:49 裸 new ResizeObserver(没有 typeof 守卫),jsdom 里没有这个全局 ——
// 不桩掉 5 条会全部炸成 ReferenceError 而不是断言失败(照 anaEChart.spec 的既有写法)。
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never

describe('TabStrip · 标题拼上下文(§6)', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear() })

  it('有期有公司:屏名 · 期 · 公司', () => {
    const tabs = useTabsStore()
    tabs.open('ledger', { pin: true })
    tabs.setCtx('ledger', { p: '2025-06', coName: '一期公司' })
    expect(mount(TabStrip).text()).toContain('月度台账 · 2025-06 · 一期公司')
  })

  it('只有期:两段;什么都没有:只有屏名(有几段写几段)', () => {
    const tabs = useTabsStore()
    tabs.open('ledger', { pin: true })
    tabs.setCtx('ledger', { p: '2025-06' })
    expect(mount(TabStrip).text()).toContain('月度台账 · 2025-06')
    tabs.clearCtx('ledger')
    const t = mount(TabStrip).text()
    expect(t).toContain('月度台账')
    expect(t).not.toContain('·')
  })

  it('title 属性带全文(定宽必然截断,鼠标停住能看全)', () => {
    const tabs = useTabsStore()
    tabs.open('ledger', { pin: true })
    tabs.setCtx('ledger', { p: '2025-06', coName: '一期公司' })
    // ⚠ 用 data-tabv 选,别用 .fp-tab —— 基底页签 data-home 排在 ledger 前面,first() 命中的是它
    const el = mount(TabStrip).find('[data-tabv="ledger"]')
    expect(el.attributes('title')).toContain('2025-06')
    expect(el.attributes('title')).toContain('一期公司')
  })

  it('页签定宽 148px(改名不改宽 —— 标题现在会跟着期变,弹性宽度等于每换一次期整条跳一次)', () => {
    const s = src('components/shell/TabStrip.vue')
    expect(s.includes('flex: 0 0 148px')).toBe(true)
    expect(/\.fp-tab\s*\{[^}]*flex:\s*1 1 0/.test(s)).toBe(false)
  })

})
```

⚠ 「月度台账」按 `fpNav` 里 `ledger` 的实际 label 改；`mount(TabStrip)` 若因子组件报错按需补 stub。

- [ ] **Step 2: 先写失败的测试 —— 顶栏**

`frontend/src/components/shell/__tests__/toolbar.spec.ts` 追加两条：

```ts
  // ⚠ 本文件的 route 桩是 meta.value = 'tenants'(:8),挂载辅助叫 mountBar(:25) ——
  //   写 'ledger' 的 ctx / pin 一个都读不到,实现全对也会红。
  it('上下文 chip 常驻:无期显「—」,有期显 期 · 公司(预留位不 v-if —— 一进一出会把面包屑推着走)', async () => {
    const w = mountBar()
    expect(w.find('.fp-ctx-chip').exists()).toBe(true)
    expect(w.find('.fp-ctx-chip').text()).toBe('—')
    useTabsStore().setCtx('tenants', { p: '2025-06', coName: '一期公司' })
    await nextTick()
    expect(w.find('.fp-ctx-chip').text()).toBe('2025-06 · 一期公司')
  })

  it('收藏 ★ 带 aria-pressed(屏读要念出「已固定 / 未固定」,:active 只是视觉)', async () => {
    const w = mountBar()
    const star = w.find('[aria-label="固定为常驻页签"]')
    expect(star.attributes('aria-pressed')).toBe('false')
    useTabsStore().pin('tenants')
    await nextTick()
    expect(star.attributes('aria-pressed')).toBe('true')
  })
```

（`nextTick` / `useTabsStore` 若本文件还没 import 要补。）

- [ ] **Step 3: 跑两份,确认失败**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run src/components/shell/__tests__/tabStripTitle.spec.ts src/components/shell/__tests__/toolbar.spec.ts
```

期望：新增 6 条红（tabStripTitle 4 + toolbar 2；KeepAlive 深度那条已在 T2 评审修补里落进 readScreenRefresh.spec，别再写第二遍）—— **是断言失败,不是 ReferenceError**；toolbar 现有条目绿。若见到 `ResizeObserver is not defined`，说明上面那行全局桩没加对。

- [ ] **Step 4: 实现 —— TabStrip**

`<script setup>` 里（`ROUTES` 之后）：

```ts
/**
 * 页签上要写的一整句:`屏名 · 期 · 公司`,**有几段写几段**(§6)。
 * 期与公司来自 `tabs.ctx` —— 未激活的页签早已卸载,屏内的 ref 拿不到。
 */
const titleOf = (v: string): string => {
  const c = tabs.ctx[v]
  return [ROUTES[v]?.page ?? v, c?.p, c?.coName].filter(Boolean).join(' · ')
}
```

:120 的 `:title` → `:title="(ROUTES[value]?.layerLabel ?? '') + ' / ' + titleOf(value)"`；:127 的标签文字 → `{{ titleOf(value) }}`；溢出下拉行（:177-197）的文字同样换成 `titleOf(...)`，并给行补 `:title="titleOf(...)"`（现在没有 title，定宽后同样会截断）。`data-tabv`（:114）已存在，不动。

CSS：`.fp-tab`（:232-240）的 `flex: 1 1 0; min-width: 42px; max-width: 196px` 三个值换成一句

```css
  /* 定宽 148px(§6):标题现在会跟着期变,弹性宽度等于「每换一次期,整条页签条重排一次」。
     改名不改宽,溢出交给 ellipsis 与 title。 */
  flex: 0 0 148px;
```

`.fp-tab.on, .fp-tab.on:hover`（:255-261）里的 `min-width: 124px`（:257）删掉，其余视觉不动。

- [ ] **Step 5: 实现 —— Toolbar**

`<script setup>`：

```ts
// 上下文 chip:面包屑后面的常驻预留位(§6)。无期显「—」而不是 v-if ——
// 一进一出会把它右边的东西推着走,LAYOUT-STABILITY §1 铁律禁止。
const ctxText = computed(() => {
  const c = tabs.ctx[activeValue.value]
  return [c?.p, c?.coName].filter(Boolean).join(' · ') || '—'
})
```

模板 :58 的 `</span>` 之后、:61 的 `.fp-toolbar-right` 之前插：

```html
    <span class="fp-ctx-chip" :title="ctxText">{{ ctxText }}</span>
```

样式段加：

```css
.fp-ctx-chip { flex: 0 0 132px; width: 132px; height: 22px; line-height: 22px; margin-left: 8px;
  padding: 0 8px; box-sizing: border-box; border-radius: var(--radius-sm); background: var(--bg-subtle);
  color: var(--text-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

（`--bg-subtle` 换成本仓真实存在的那个中性底色 token —— 实施者去 `base.css` 确认，别新造变量。）

★ 按钮（:49-51）加一个属性：

```html
  <IconButton aria-label="固定为常驻页签" :aria-pressed="String(pinned)" :active="pinned" @click="tabs.pin(activeValue)">
```

- [ ] **Step 6: 跑测试 + 全量**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run src/components/shell 2>&1 | tail -8
npx vitest run 2>&1 | tail -8
npx vue-tsc --noEmit
```

期望：全量 2315 条（T3 收尾 2309 + 6）全绿。

- [ ] **Step 7: 逐条破坏验证**

| 改坏什么 | 应红的那条 |
|---|---|
| `titleOf` 里去掉 `c?.coName` | 「有期有公司:屏名 · 期 · 公司」 |
| `titleOf` 里 `.filter(Boolean)` 删掉 | 「什么都没有:只有屏名」 |
| `:title` 改回只有屏名 | 「title 属性带全文」 |
| `flex: 0 0 148px` 改回 `flex: 1 1 0` | 「页签定宽 148px」 |
| chip 加上 `v-if="ctxText !== '—'"` | 「上下文 chip 常驻」 |
| ★ 的 `:aria-pressed` 删掉 | 「收藏 ★ 带 aria-pressed」 |

- [ ] **Step 8: 提交**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043
git add -A && git commit -m "$(cat <<'EOF'
feat(shell): P3 页签标题拼「屏名 · 期 · 公司」+ 定宽 148px;顶栏上下文 chip 常驻 132px;★ 补 aria-pressed

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 预览页签被顶提示（仅编辑态）+ 命令钮 aria

**Files:**
- Modify: `frontend/src/stores/presence.ts`（新增 `holdsEditUnder` 并加进 :251 的 return）
- Modify: `frontend/src/components/shell/AppShell.vue`（Teleport 内加一块 + 样式）
- Modify: `frontend/src/components/shell/IconRail.vue:66-69`（补 `aria-label="搜索 / 跳转"`，T2 已建的 `iconRail.spec` 第三条到这里才真绿 —— 若 T2 已顺手加上，本步只确认）
- Test: `frontend/src/components/shell/__tests__/evictToast.spec.ts`（新）

**Interfaces:**
- Consumes: `tabs.evicted` / `tabs.clearEvicted` / `tabs.pin`（T1）；`NAV_SCOPE_PREFIX`（`utils/lockScopes.ts:105-129`）。
- Produces: `presence.holdsEditUnder(prefix: string | string[] | undefined): boolean`。

- [ ] **Step 1: 先写失败的测试**

新建 `frontend/src/components/shell/__tests__/evictToast.spec.ts`：

```ts
describe('AppShell · 预览页签被顶提示(§4.3)', () => {
  it('被顶的屏本人没在编辑 → 静默(不出提示)', async () => {
    const w = mountShell()
    const tabs = useTabsStore()
    tabs.open('ledger'); tabs.open('tenants')          // 顶掉 ledger
    await nextTick()
    expect(w.find('.fp-evict-toast').exists()).toBe(false)
  })

  it('被顶的屏本人正握着锁 → 出提示,带屏名', async () => {
    const w = mountShell()
    const presence = usePresenceStore()
    presence.holdLock('ledger:1:2025-06', () => {})    // 台账的锁根
    const tabs = useTabsStore()
    tabs.open('ledger'); tabs.open('tenants')
    await nextTick()
    expect(w.find('.fp-evict-toast').text()).toContain('月度台账')
  })

  it('点「固定它」把被顶的屏钉回固定页签并收起提示', async () => {
    // …同上出提示后
    await w.find('.fp-evict-toast .act').trigger('click')
    expect(useTabsStore().tabs.map(t => t.value)).toContain('ledger')
    expect(w.find('.fp-evict-toast').exists()).toBe(false)
  })
})
```

⚠ 三样缺一不可（复查实测）：① 照抄 `sidebarPanel.spec.ts:11-21` 的 `vi.mock('@/api', …)` —— `AppShell.vue:86-91` 的 immediate watch 会 `presence.enter()`、`presence.stop()` 会发 `api.delete`，不 mock 就在 jsdom 里真发请求；② `global.stubs` 里 **`Teleport: true`** —— 提示块在 `AppShell.vue:148` 的 `<Teleport to="body">` 里，不 stub 节点被搬去 `document.body`，`w.find('.fp-evict-toast')` 找不到；③ 子组件全 stub：`{ Teleport: true, IconRail: true, SidebarPanel: true, TabStrip: true, Toolbar: true, CommandPalette: true }`（`TabStrip` 不 stub 会撞 `ResizeObserver` 未定义）。`presence` 的 3 秒轮询用 `vi.useFakeTimers()` 或 `afterEach(() => presence.stop())` 收掉。锁 scope 用 `NAV_SCOPE_PREFIX['ledger']` 的实际前缀拼一个合法值（如 `ledger:1:2025-06`）。

- [ ] **Step 2: 跑它,确认失败**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run src/components/shell/__tests__/evictToast.spec.ts
```

期望：3 条红。

- [ ] **Step 3: 实现 —— presence 的本地编辑态查询**

`frontend/src/stores/presence.ts`，`editCallbacks`（:129）之后：

```ts
  /**
   * 本标签页此刻在不在某个锁根底下持锁 —— 「预览页签被顶掉要不要吭声」只看这个。
   *
   * 不查 `users` 里的座位:`mode` 是服务端字段(慢一拍),`self` 又是按 user 比对不按 sid ——
   * 同一个人开两个标签页,两条座位都是 self,拿它判「我这一页在编辑」会串台。
   * `editCallbacks` 是客户端持锁的真源(holdLock / dropLock 的落点),即时且只属于本页。
   */
  function holdsEditUnder(prefix: string | string[] | undefined): boolean {
    if (!prefix) return false
    const ps = Array.isArray(prefix) ? prefix : [prefix]
    for (const sc of editCallbacks.keys())
      // 边界与 editorsUnder 逐字同规则:`utilities:1` 是 `utilities` 底下的,`utilities13` 不是
      if (ps.some(p => sc === p || sc.startsWith(p + ':') || sc.startsWith(p + '-'))) return true
    return false
  }
```

加进 :251 的 return 面。

- [ ] **Step 4: 实现 —— AppShell 的提示块**

`<script setup>`：

```ts
// 预览槽被顶掉的提示(§4.3)。**只在被顶的那屏本人正在编辑时出** —— 其余情况静默:
// 预览槽本来就是「随手看一眼」的槽,每换一次屏都吭一声等于把提示训练成噪音。
// 载体不用 FPToast(它没有动作按钮),复用本文件 .fp-net-toast 的位置与深色语言。
const evictValue = ref('')
const evictMsg = computed(() => (evictValue.value ? `「${ROUTES[evictValue.value]?.page ?? evictValue.value}」预览页签已被替换` : ''))
let evictTimer: ReturnType<typeof setTimeout> | null = null
watch(() => tabs.evicted, (v) => {
  if (!v) return
  tabs.clearEvicted()
  if (!presence.holdsEditUnder(NAV_SCOPE_PREFIX[v])) return
  evictValue.value = v
  if (evictTimer) clearTimeout(evictTimer)
  evictTimer = setTimeout(() => { evictValue.value = '' }, 4000)
})
function pinEvicted() {
  if (evictTimer) clearTimeout(evictTimer)
  tabs.pin(evictValue.value)
  evictValue.value = ''
}
onUnmounted(() => { if (evictTimer) clearTimeout(evictTimer) })
```

（`ROUTES = fpBuildRoutes()` / `NAV_SCOPE_PREFIX` / `usePresenceStore` / `useTabsStore` 按需 import；`presence` 本文件 :5 已经在用。）

模板，紧跟现有网络错误块（:149-153）之后、同一个 `<Teleport>` 内：

```html
    <div v-if="evictMsg" class="fp-net-toast fp-evict-toast" :class="{ stacked: !!ui.netError }" role="status">
      <span class="msg">{{ evictMsg }}</span>
      <button class="act" @click="pinEvicted">固定它</button>
      <button class="act ghost" @click="evictValue = ''">×</button>
    </div>
```

样式（`.fp-net-toast` 那一组之后，**原有规则一个字不改**）：

```css
/* 被顶提示复用上面那套深色语言与位置;两条同时在场时它上移一格,不叠字。 */
.fp-evict-toast.stacked { bottom: 84px; }
```

- [ ] **Step 5: 实现 —— 命令钮 aria**

`IconRail.vue:67-69` 的按钮加 `aria-label="搜索 / 跳转"`（§6 最后一行）。**T2 落地时已顺手加过**（`iconRail.spec` 第三条依赖它），本步只确认还在。

- [ ] **Step 6: 跑测试 + 全量**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run src/components/shell src/stores 2>&1 | tail -8
npx vitest run 2>&1 | tail -8
npx vue-tsc --noEmit
```

期望：全量 2318 条（2315 + 3）全绿。

- [ ] **Step 7: 逐条破坏验证**

| 改坏什么 | 应红的那条 |
|---|---|
| watch 里删掉 `if (!presence.holdsEditUnder(...)) return` | 「本人没在编辑 → 静默」 |
| `holdsEditUnder` 的前缀匹配改成恒 `false` | 「本人正握着锁 → 出提示」 |
| `pinEvicted` 里删掉 `tabs.pin(...)` | 「点「固定它」把被顶的屏钉回」 |
| `IconRail` 的 `aria-label` 删掉 | T2 建的 `iconRail.spec`「命令钮有 aria-label」 |

- [ ] **Step 8: 提交**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043
git add -A && git commit -m "$(cat <<'EOF'
feat(shell): P3 预览页签被顶提示(仅本人编辑态出,带「固定它」);presence 加本页持锁查询;命令钮补 aria-label

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 分析层 16 处 pin → `openDeep` + 门禁翻转

**Files:**
- Modify（10 份 16 处，行号复查逐条核对全对）：`frontend/src/views/analysis/AnomalyView.vue:152, 158, 167` · `BudgetView.vue:132` · `ChargingAnalysisView.vue:91` · `ChurnView.vue:51` · `CockpitView.vue:204, 236, 250` · `ElecAnalysisView.vue:113` · `FinCashflowView.vue:183` · `PnlAnalysisView.vue:81` · `PvMeterAnaView.vue:243, 247` · `TenantEnergyView.vue:261, 266`
- Modify: `frontend/src/views/__tests__/anaDeepLink.spec.ts:35-39, 65-70`

**Interfaces:** Consumes `tabs.openDeep`（T1）。

这是一批同形机械改动：`tabs.openFresh(X, { pin: true })` → `tabs.openDeep(X)`，一处不多一处不少。

- [ ] **Step 1: 先改门禁(它现在正钉着旧形状)**

`anaDeepLink.spec.ts:35-39` 整条替换：

```ts
  it('分析层深链不再硬编码 pin:一律 tabs.openDeep(来源在预览槽才钉住目标,规则收在 store,§4.3)', () => {
    // ⚠ 只筛分析层。SENDERS(:13-24)里还有 views/reports/recon/ReconWorkbench.vue ——
    //   那两处 pin 是 spec §4.1 明写「不变」的,断言进来会把任务卡死在一个不许改的文件上。
    //   (原写法 filter(!includes('Expiry')) 是空转:ExpiryView 根本不在 SENDERS 里,它在 :60-62 单独断言。)
    for (const rel of SENDERS.filter(r => r.startsWith('views/analysis/'))) {
      const s = src(rel)
      if (!src(rel).includes('tabs.')) continue          // 只发 query 不开页签的屏跳过
      expect(s.includes('tabs.openDeep('), `${rel} 没改走 openDeep`).toBe(true)
      expect(s.includes('{ pin: true }'), `${rel} 还硬编码着 pin`).toBe(false)
    }
  })
```

:64-69 那条里的 `tabs.openFresh(v, { pin: true })` 改成 `tabs.openDeep(v)`（`co: a.co,` 那半条**不动**）。

- [ ] **Step 2: 跑它,确认失败**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run src/views/__tests__/anaDeepLink.spec.ts
```

期望：改过的两条红。

- [ ] **Step 3: 实现 —— 16 处替换**

逐个文件把 `tabs.openFresh(X, { pin: true })` 换成 `tabs.openDeep(X)`（`tabsStore.` 前缀的按各文件实际变量名）。三处带条件的写法：

```ts
// AnomalyView.vue:167 / CockpitView.vue:250
if (v === 'ledger' || v === 'sales-income') tabs.openDeep(v)
```

**只改这 16 处。** `views/analysis/` 之外的 pin 一处不碰（`LossLedgerView` / `PoolLedgerView` / `BillNoticesView` / `ParamCenterView` / `ReconWorkbench` ×2 / `LedgerView.gotoTenants`）。

改完自查：

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
grep -rn "pin: true" src/views/analysis/ --include=*.vue | wc -l   # 期望 0
grep -rn "openDeep(" src/views/ --include=*.vue | wc -l           # 期望 16
grep -rn "pin: true" src/views/ --include=*.vue | wc -l           # 期望 7
#   = LossLedger:153 · PoolLedger:392 · BillNotices:152 · ParamCenter:413 · ReconWorkbench:121,128 · LedgerView:685
#   (spec 文件里的字符串字面量不计,所以要带 --include=*.vue)
```

- [ ] **Step 4: 跑测试 + 全量**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run 2>&1 | tail -8
npx vue-tsc --noEmit
```

期望：2318 条全绿（本任务不加不减用例）。`anaAnomaly.spec` / `ledgerLeaveAndReturn.spec` 必须仍绿。

- [ ] **Step 5: 破坏验证**

| 改坏什么 | 应红的那条 |
|---|---|
| 把 `ChurnView.vue:51` 改回 `openFresh('ledger', { pin: true })` | `anaDeepLink`「分析层深链不再硬编码 pin」（且报错信息点名 ChurnView） |
| 把 `AnomalyView.vue:167` 的 `openDeep(v)` 改回 `openFresh(v, { pin: true })` | `anaDeepLink`「goAnom 两屏同形」 |

- [ ] **Step 6: 提交**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043
git add -A && git commit -m "$(cat <<'EOF'
refactor(analysis): P3 pin 规则收进 store —— 分析层 16 处硬编码 pin:true 改走 tabs.openDeep;门禁翻转

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 规范修订 + 构建门禁 + 收尾

**Files:**
- Modify: `docs/superpowers/specs/2026-07-07-demo3-recon-jump-tab-state-design.md` §二
- Modify: `docs/design/RESPONSIVE-LAYOUT-SPEC.md` §4.1 / §4.2
- Modify: `docs/design/LAYOUT-STABILITY-SPEC.md`
- Modify: `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md`（头行 · §4.3 · §12）
- 可能 Modify（仅在 size-check 触线时）：`frontend/src/components/shell/AppShell.vue:11, 141-144`

- [ ] **Step 1: 构建门禁**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npm run build 2>&1 | tail -25
```

- index ≤ 191KB 且合计 ≤ 3900KB → 直接进 Step 3。
- **超线** → Step 2 的瘦身，**不许上调 `BUDGET_KB`**。

- [ ] **Step 2: 触线才做 —— CommandPalette 改懒加载**

`AppShell.vue:11` 的静态 import 换成

```ts
// 命令面板是 Ctrl-K 才用得上的覆盖层,却一直静态挂在首屏包里(源码 7.9KB)。
// 与 FPApprovalDrawer / 手机三件套同一招:defineAsyncComponent + **外层 v-if**
// (只靠 :open=false 等于没懒 —— 渲染了才拉块)。
const CommandPalette = defineAsyncComponent(() => import('@/components/shell/CommandPalette.vue'))
```

模板 :141-144 的 `<CommandPalette :open="paletteOpen" …>` 外面套 `v-if="paletteOpen"`（`:open` 保留，组件内的进场过渡靠它）。

改完重跑 `npm run build`，并跑 `npx vitest run src/components/shell/__tests__/palette.spec.ts` 确认 6 条仍绿（它直接挂 `CommandPalette`，不经 AppShell，应不受影响）。仍超线 → **停下报告，不要自行上调预算**。

- [ ] **Step 3: 规范修订**

`2026-07-07-demo3-recon-jump-tab-state-design.md` §二 的语义矩阵三行随 P3 改口径（在表下补一段「2026-09-06 P3 修订」，**不删原文**）：

```markdown
> **2026-09-06（P3，sidebar-ux-redesign §4.1）修订**：`SidebarPanel 点击页面` 与
> `数据首页/报表首页「去做事」行点击` 两行的「全新状态」收窄 —— 侧边栏点击改为
> **恢复该 tab 之前的浏览状态**（与 TabStrip 点击同义），首页行仍是全新（显式任务导航）。
> 「全新」只剩三个显式动作：**Shift + 侧栏点击 / 关签后重开（dropState）/ IconRail 换层**。
> 理由：P0a–P0c 把期、公司、抽屉都落进了屏内，导航一次就重过一次门是这一期要消灭的东西；
> `:max` 同步 10 → 16 覆盖专员月内要开的屏数。点当前项 / 当前层一律 no-op（不 push、不动 epoch）。
```

`RESPONSIVE-LAYOUT-SPEC.md` §4.1（:118）表格「底栏」那格的 `点按 = openFresh(layer.home)` 后面补「；**点当前层 no-op**（2026-09-06 P3）」；§4.2（:132-137）「导航语义分开走」下面那**一条合并写的 bullet**（原文是「层切换段 / sections 条目 = `openFresh` + push（与 IconRail/SidebarPanel 同义，全新状态）」，不是两条）拆成两条：

```markdown
- 层切换段 = `openFresh` + push（与 IconRail 同义，全新状态），**点当前层 no-op**；
- sections 条目 = `open` + push（与桌面 SidebarPanel 同义，**恢复现场**；2026-09-06 P3 起，
  改前是 openFresh），**点当前屏只关抽屉不 push**；触屏没有修饰键，不做 Shift；
```

`LAYOUT-STABILITY-SPEC.md` 插在 §4.2（表单的错误/提示位必须常驻）之后、§5 之前，补两行「零位移做法」登记：

```markdown
- **页签定宽 148px**（`TabStrip .fp-tab { flex: 0 0 148px }`）：标题会随期变化，弹性宽度等于
  每换一次期整条页签条重排一次。改名不改宽，溢出交给 ellipsis + `title`。
- **顶栏上下文 chip 定宽 132px 常驻**（`Toolbar .fp-ctx-chip`）：无期显「—」而不是 `v-if`，
  一进一出会把它右边的东西推着走。
```

`2026-09-03-sidebar-ux-redesign-design.md`：
- 头行「P1、P4、P0a、P0b、P0c 已在分支…」→ 加 `、P3`。
- §4.3 三条 bullet 后各补一句落地形状（pin 规则实现成 `tabs.openDeep`、来源取 `recent[0]`；ctx 写入收在 `useDeepPeriod` 一处、`review` 归 R2；被顶提示的编辑态判定走 `presence.holdsEditUnder`、载体是 `.fp-net-toast` 兄弟块），并把「分析层 **9 处**硬编码 `pin:true` 删除」订正为 **16 处、10 个文件**（9 是 P0c 之前的旧数）。
- §12 补六条遗留：
  1. `openDeep` 的来源判据是 `recent[0]`，刷新后第一次跳转可能判错（代价 = 多钉 / 少钉一个页签）。
  2. `auth.logout()` 至今不重置已实例化的 tabs store（`tabs` / `preview` / `recent` / `epoch` 都留着），P3 只让 `ctx` / `evicted` 跟着 `auth.me` 清；整体重置留给 P5。
  3. `ctx` 只写给调了 `useDeepPeriod` 的屏；导入中心等无期屏的页签标题就是屏名，符合「有几段写几段」。
  4. 被顶提示与网络错误 toast 同底 28px，两条同时在场靠 `.stacked` 上移一格 —— 三条以上没有排队机制。
  4b. **Shift 点当前项仍然重建**（不 push、只 epoch++）：偏离 §4.1 字面次序（那里 guard 写在 Shift 之前）。理由：改前「点当前项」走的就是 openFresh，不放开这条出路，当前屏在本期之后再没有任何强制刷新手势。
  5. **分析层 11 屏与导入中心没有 ctx**（它们不接 `useDeepPeriod`，期也不吃 URL）：页签只显屏名、顶栏 chip 恒显「—」。与「给 `usePeriod` 开深链入口」是同一件事，一并留后期。
  6. **T2 Step 6b 判定「不补切回重读」的那几屏**（重读会清掉用户选择的）逐个列名与理由 —— 侧栏改恢复现场之后它们没有刷新入口，用户要靠 Shift 点击或关签重开。

- [ ] **Step 4: 全量收尾**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run 2>&1 | tail -8
npx vue-tsc --noEmit
npm run build 2>&1 | tail -25
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043
git status --short
```

期望：2318 条全绿；tsc 零错；size-check 通过；`git status` 只剩本步待提交的文档。

- [ ] **Step 5: 提交**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043
git add -A && git commit -m "$(cat <<'EOF'
docs(spec): P3 规范随裁定 —— 侧栏=恢复现场/全新只剩三动作(recon-jump §二)、手机端语义(RESPONSIVE §4.1/4.2)、页签定宽与 chip 预留位(LAYOUT-STABILITY)、§4.3 落地形状与四条遗留

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 自查（写完计划后本人过一遍）

- **spec 覆盖**：§4.1 五行入口语义 → T2；`:max` 16 → T2；§4.3 pin 规则 → T1 + T6，evicted → T1 + T5，ctx → T1 + T3；§6 页签标题 / chip / ★ / 命令钮 → T4 + T5；§8.2 四份规范 → T7；§9 P3 行的四条破坏验证分别落在 T1（关签重开仍全新 = `dropState` 那条）、T2（Shift epoch++ / 点当前项不 push）、T5（toast 仅编辑态出）。
- **占位符**：无 TBD / 「参照上一任务」；每个代码步都有可抄的代码块；三处标了 ⚠ 的地方是**实施者必须先看实际值再落笔**（层短名与 home、附10 的期区取法、`--bg-subtle` token 名），不是留白。
- **类型一致**：`TabCtx` 在 T1 定义、T3 写、T4 读，字段名 `p` / `coName` 三处一致；`openDeep(value: string)` 在 T1 定义、T6 调用，签名一致；`holdsEditUnder(prefix: string | string[] | undefined)` 与 `NAV_SCOPE_PREFIX` 的值类型对齐。
- **任务间冲突**：T2 与 T4 都碰 `App.vue`（T2 改 `:max`，T4 只**读**它做源码断言）—— T4 的断言在 T2 之后必然绿，顺序不可颠倒。T2 建的 `iconRail.spec` 第三条依赖 T5 才加的 `aria-label`：**T2 落地时就把那一行 aria 顺手加上**（计划已在 T5 Step 5 写明「若 T2 已加则只确认」），否则 T2 收尾时全量会红一条。
- **用例计数**：2266（基线）+ 8（T1）+ 10（T2：入口 8 + 纯读屏 2）+ 4（T3）+ 7（T4）+ 3（T5）= **2318**（T1 +1、T2 门禁按屏展开 +22、T2 修补 +5、T3 修补 +3 均已计入），T6/T7 不增不减。
- **2026-09-06 单人复查已修**：3 阻断（T6 门禁把 ReconWorkbench 断言进去 / `mount(TabStrip)` 撞 jsdom 无 `ResizeObserver` / 侧栏改恢复现场后纯读屏没有刷新入口）· 5 严重（ctx 覆盖不到分析层 / `auth.me` 初始就是 null 用例恒红 / toolbar.spec 的 value 与辅助名对不上 / `.fp-tab` 命中基底页签 / T3 第三条与自己的标题不符导致 coName 通路零覆盖）· 6 一般（用例计数 / 三大报表矩阵态 ctx 写出年份 / evictToast 缺 api mock 与 Teleport stub / grep 期望 / 份数 10 不是 11 / S10View 路径与 `phaseOf` 不存在）· 2 建议（Task 0 的 HEAD / `MobileNavDrawer:95`）。两条正面结论记档：`recent[0]` 当来源成立（`router/index.ts:135-142` 有全局 `afterEach` 无条件 `open(v)`，每条导航路径都会把当前屏推到队首）；被顶的屏锁还在（`useEditLock.ts:176` 只在 `onUnmounted` 释放，没有 `onDeactivated`），提示出得来。
