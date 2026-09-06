# P2 本月出账屏第二阶段（年份条 / 两栏清单 / 主管条 / 在场点 / 后端数据契约）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「本月出账」从一排胶囊变成一块真正能管月的板子：顶部年份条（复用 `BookMonthMatrix`，4 点 + 锁角标）取代现在那个月份下拉；中间两栏清单（出账 7 行 / 记账 8 行）每行的状态**由数据派生**不可手勾，前置未满显 padlock，源缺显「—」；台账带公司 chips、附10 带期区 chips；顶部主管条 32px 定高常驻，写清「待批授权 N」「谁在编辑」。顺带修一个屏上的假绿：附表6 / 附表7·8 / 附表11 现在是「今年有行就算做了」，一月录完十二月看还显对勾。

**Architecture:** 后端 `DataHomeOverviewDTO.Item` 加两个 nullable 组件 `companies` / `phases`（台账按 `company_id` 分组、附10 拆回 slot 1..4，**零新 SQL**），注入第 14 个依赖 `ManagementCompanyMapper` 取公司全集以便显「未录」；三个年度源加一道 `acctMonth` 过滤（与附13/14 既有写法逐字同形）。前端新建纯函数 `views/data-home/monthClose.logic.ts`，把后端的 9 个附表源 + 出账链 5 步 + 收入核对 + 本月锁账折成两栏 15 行的 `CloseRow[]`，屏上的计数一律从**渲染出来的行**算而不是抄 DTO 的 `total`。年份条把 `pickedYm` 的「手选优先」链路从下拉改到矩阵格子。§3.3 在场点：`utils/lockScopes` 加 `scopePeriod` 与 `navOfScope` 两个纯函数，`SidebarNav` 里的局部 `editingHere` 上提成 `presence.editingNote(navValue)`，侧栏 / 清单行 / 主管条三处共用。

**Tech Stack:** Vue 3 `<script setup>` + Pinia + vue-router 4 + Vitest（jsdom）；Spring Boot + MyBatis-Plus + JUnit5 + AssertJ；vue-tsc strict。

**Spec:** `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md` §5.2（年份条 / 两栏清单 / 主管条 / 数据契约 D8）· §3.3（在场点）· §7.1–7.2（审核键与状态机，**本期只做前置不做实现**）· §9 P2 行（破坏验证：六计数任一源缺显「—」；chip 点击带 p/co；反向护栏不红）· §10 · §12。

## Global Constraints

- **审核机制在仓里一行都没有**（五路摸底一致坐实：`review_state` / `review_log` / `GET /api/review` / `ReviewGuard` / `Perm.REVIEW_APPROVE` 全仓 grep 命中 0，`Perm.ALL` 只有 17 项，最新迁移是 `V123`）。而 spec §9 把整个 §7.4 排在 **R1**，即 P2 之后。**裁定**：
  - `Item.companies[] / phases[]` **只发 `done`，不发 `review`**；R1 再补字段，前端按 `undefined` 处理。
  - **有 chips 的行，行 done 收严成「所有 chip 都 done」**（2026-09-06 执行中定）：改前台账「任一公司有行」就算 done，而同一行右边并排挂着两个灰 chip，一行之内自相矛盾；同屏的合并行却是「两项皆 done」的严口径。这块板存在的意义就是能不能全绿锁账。⚠ 实现必须按 `chips.length` 守（`companies`/`phases` 线上发 null 时 chips 是空数组，`[].every()` 恒 true，不守会把 todo 翻成 done）。
  - **chips 是「这一行有子入口」的通用装置**，不只给公司 / 期区：附13+附14 合并行出「办公」/「三期」两个 chip、附7+附8 合并行出「汽车」/「电动车」两个 chip，各自带自己的 `tab` 或 nav value。这样合并成 8 行之后，P0b 立的每一个深链入口都还在。
  - `monthClose.logic.ts` 的 `rowsOf(...)` **签名收 `review` 入参但本期调用方恒传 `null`**，行右侧审核态列渲染「—」（这正是 spec §5.2「计数源缺显『—』不显 0」的口径）。
  - 「本月锁账」行**在清单里**（§5.2 出账列第 7 行、D20 派生），但本期恒显「—」+ padlock，悬停说「审核机制未上线」。**不许**临时降级成「五步全 done 就算锁账」——那是假绿。
- **后端仍是 9 个附表源，两栏是前端呈现**。`Schedules(done, 9, items)` 里的 9 **不动**，`DataHomeApiIT:54-55` 与 `DataHomeServiceTest:107-108` 的 `hasSize(9)` / `total()==9` **一个字不改**。记账列的 8 行（附13+附14 合一、附7+附8 合一、加导入中心）全部在 `monthClose.logic.ts` 里折。**屏上的计数从渲染的行算**，不抄 `schedules.total` —— 这才叫「计数与屏内同源」（§8.1）。⚠ **2026-09-06 执行中定的口径**：恒 `na` 的行（导入中心、本月锁账）**不进分母**，所以今天是**记账 n/7、出账 n/6**，不是 8 和 7。理由：分母若包含永远做不完的行，「记账 7/8」就永远差一格，用户会去找那一格是什么；与 §5.2「计数源缺显『—』不显 0」同源 —— 源缺的行不是一个可数的事项。等 R1 让锁账变成真状态、导入中心拿到账期，分母会自己长回 8 和 7。
- **三个年度源改按月判**（本期唯一一处会改变用户看到的状态）：`DataHomeService:157-165` 的 `pv.selectByYear(year)` / `charging.selectByScheduleAndYear(7|8, year)` / `elec.selectByYearAndType(year, ...)` 取回来的行**本来就带 `acctMonth`**（`PvRecord:9` / `ChargingRecord:10` / `ElecRecord:10`），加一道 `.filter(r -> acctMonth.equals(r.getAcctMonth()))` 即可，**零新查询零迁移**，写法与 `:151-156` 附13/14 的既有过滤逐字同形。零风险的依据（复查核实）：三张表的 `acct_month` 都是 `VARCHAR(7) NOT NULL`（`V6__pv_schema.sql:16` / `V8__charging_schema.sql:18` / `V10__elec_schema.sql:15`），无 null 行；`equals` 的方向是非 null 的 ym 参数在左；`DataHomeApiIT` 那两条夹具用例**都不断言 `schedules.done`**（`:54-56` 只断 total 与 hasSize，`:80-81` 用的 ym 是 2099-12 本就空），所以不会红。**行为变化**：改前一月录了数据，十二月的首页仍显「已录」；改后按本月判。这是删掉一个假绿，不是回归。`SourceData.yearly` 这个位随之只剩「标签写不写年」的用途，注释要改口径。
- **台账公司全集要能显「未录」**：`monthly_ledger` 那次 `selectList` 已经把该月**全部公司**的行读进内存（`:142-144` 无 company 过滤），所以 `done` 零新查询（`groupingBy(MonthlyLedger::getCompanyId)`）；但公司**短名与全集**在 `management_company`，要注入第 14 个依赖。**裁定**：注入 `ManagementCompanyMapper` 取公司全集，`selectList(new QueryWrapper<>().eq("status", 1).orderByAsc("sort_no").orderByAsc("id"))`。⚠ **2026-09-06 执行中改过一次**：原裁定照 `CompanyService.java` 写「不过滤 status」，评审坐实那样会让**停用的公司**永远占着台账「该录几家」的分母、板子清不干净（仓里 `V94` 就有 status 语义、收款公司选择器早已按它过滤）。改成滤 status=1。配套：这条过滤在 SQL 层，纯 Mockito 单测里 `any()` 会吞掉 QueryWrapper、塞数据伪造不出红，用 `ArgumentCaptor` 钉 WHERE 片段（仓里先例 `BookLineageMergeTest.java:119`）；**不**为了让单测能塞数据而在 Java 层再加一道冗余过滤。只有这样「该录 5 家，录了 3 家」才显示得出来。`DataHomeServiceTest:31` 的构造器（手写 `new DataHomeService(...)`，不是注解注入）与 `:64-89` 的 `stubAllEmpty()` 必须同步补。⚠ 漏 stub **不会报错** —— Mockito 对 `List` 返回值默认给空 List，只是静默拿到空公司集、测试照绿，比 NPE 更坏。
- **附10 期区零新 SQL**：`:146-147` 现在就是 `selectBySlot(1..4, acctMonth)` 分四次查再 `concat` 拍平。拆开保留每段 `isEmpty()` 就是 `phases[].done`。期区数固定 4（仓里既有写法 `S10Service.java:135` 硬循环 1..4，无配置表）。
- **不做的三件事，各写一行理由进 §12**：
  1. **审批抽屉「页面」行改 periodLink**（spec §5.2 有这一句）：`Pending` 只有 `page/action/impact` 三个自由文本（`api/approvals.ts:14-26` / `ApprovalDtos.java:20-27`），10 个调用点各自拼字符串，既无 nav value 也无规范化的期。要做得给提权审批 DTO 加两个字段并改 10 个调用点 —— 为一个便利改动安全相邻的提权流程，本期不划算。**推后**。（主管条「谁在编辑」chips 的点跳**照做**，它走前端反查，见下。）
  2. **导入中心行没有「本月导没导」的数据源**：`import` 不在 9 个 source 里，导入日志按天数窗口取、DTO 无账期字段。本行**只做入口**，状态位恒「—」。
  3. **第 18 个权限点 `review:approve`** 与 `V124__review.sql`：属 R1。碰它会连锁 `BookPinApiIT:432` 的 `hasSize(17)`、`RoleApiIT` 的种子断言、`SystemApiIT` 的字典断言，而那几条要跑全量 testcontainers IT（Windows 冷启动 15+ 分钟）。
- **出账列五步的状态取 `overview.chain.steps[i].status`，不用 `chainStepsOf`**（复查坐实的阻断）：`nav/billingChain.ts:32` 里 `chainStepsOf` 的第一步是 `{ ...CHAIN[0], state: c.stale ? 'stale' : 'done' }` —— **计费参数恒 done**（同文件 :20-22 注释写明理由：那是矩阵那 4 个点的口径，「这个月配过参数没有」对参数不是一个有答案的问题）。清单要的是 P1 立的另一套判据 `priceTotal > 0 && priceOk == priceTotal`（`DataHomeService.buildChain:242`），而它只在后端算、只在 `overview.chain.steps[].status` 里。**照 spec §5.1 原文「矩阵 4 点、清单 5 步」两套口径**：`chainStepsOf` 只喂 T4 年份条格子的 pips / stale，清单五步一律读后端的 status。叠加时序还有第二重理由：T2/T3 在 T4（补 `loadChain`）之前，`billingPeriod.cellOf()` 恒返回全 false 的 EMPTY（`billingPeriod.ts:35-37`），照 `chainStepsOf` 走会得到「参数 done + 四步 todo」的固定假象，与后端无关。
- **收入核对行的完成度：串行补发，不是并发**（复查坐实）。年从哪来是关键：默认首载 `pickedYm` 是 null，年只能从 `overview` 回包的 `ov.period` 派生（`DataHomeView.vue:113-114`）。若照「并发」写就只能传 `undefined`，后端会取「两本账有数据的最大年」，与首页锚定月的年**大概率不是同一年** —— 收入核对行会拿别的年的差异数，形状对、数字张冠李戴，没有任何断言抓得到。**裁定：`watch(curYm)` 串行补发**（多一次往返约 60ms，换掉一整类静默错年）。`reconApi.overview(year)` 返回的是 `ReconOverview { year, months: ReconMonthMeta[] }`，要 `months.find(m => m.month === 当前月)` 再判 `done = diffCount === 0 && missCount === 0`（与 `ReconView.vue:67` 屏内同源）。**不**给 `DataHomeService` 加 `ReconService` 依赖。取数失败该行显「—」，不阻断整屏。
- **`BookMonthMatrix` 没有任何插槽**（全文 `<slot` 零命中）。§5.2 写的「4 点 + 锁角标插槽」按组件既有的扩展惯例落成 **`MonthCell` 的一个字段** `locked?: boolean`。**不加具名插槽** —— 那要动 7 个调用点与 4 份快照类断言。
  ⚠ **锁角标必须是独立的绝对定位角标，不许进 `:103-108` 那条 `v-else-if` 互斥链**（复查坐实的假绿）：那条链是 pips → badge → rowCount → 「空」，而年份条恒传 pips（照 `ChainMonthGate.vue:49-53` 的组法），pips 分支永远命中，锁标一次都画不出来；而「本期审核未上线该位恒不亮」那条用例**接对接错都绿**。写法照同文件 `.bmm-who` 那种 absolute 角标，与 pips **并存**；配套用例改成「同时传 `pips` 与 `locked: true` 时两者都在 DOM 里」。
- **年份条取代月份下拉**：`DataHomeView.vue:178-181` 的 `Select` 删掉，`pickedYm` 改由矩阵 `@pick` 回写。年维格子的数据源是 `billingPeriod` 的链数据，首页 `onMounted` 补一句 `void period.loadChain()`（幂等、在途去重，`:99` 注释已说明），行的组法照抄 `ChainMonthGate.vue` 组 `rows` 的那段。**「默认选中 = 出账链最新有数据月」的现锚规则不变**（`curYm` 来自 `ov.period`）。
- **§3.3 的两个纯函数放哪**：`scopePeriod(scope)` 与 `navOfScope(scope)` 都作为**独立 export** 放 `utils/lockScopes.ts`，与 `scopeNote` 并列，**不进 `S` 对象** —— `lockScopes.spec` 有一条 `Object.keys(S)` 完整性断言，放进去会直接红。`navOfScope` 用与 `editorsUnder` 同一条边界规则反查 `NAV_SCOPE_PREFIX`；**一把锁可命中多个 nav**（`billing-chain` 命中 params / alloc / bill-notices 三个），裁定：**取 `NAV_SCOPE_PREFIX` 声明序的第一个**，并在 spec 里钉住这条规则。
- **`sched:s10` 一个前缀两种粒度**（月锁 `sched:s10:1:2025-06` 与年锁 `sched:s10:1:2025` 并存，`lockScopes.ts:76-78` 两个构造器）。裁定：`scopePeriod` **照实返回**（`YYYY-MM` 或 `YYYY`），`periodLink` 的 `p` 本就允许只有年（`deepLink.ts:31-33`）。文案跟着变粒度，不额外规整。
- **`editingHere` 上提**：`SidebarNav.vue:147-164` 的局部函数搬进 `stores/presence.ts` 成 `editingNote(navValue): string | null`，`SidebarNav` 改调它（`:198` / `:200` / `:224` 三个调用点同改）。在场点的属性 **`title` 与 `aria-label` 并存**：`sidebarLockNote.spec` 现有 3 条全用 `span[title*=...]` 选择器，**一条都不许改**；新增的断言钉 `role="img"` / `aria-label` / `tabindex` / Popover 开合。`SidebarNav` 是纯 `h()` 渲染函数（`grep -c "<template>"` = 0），零位移门禁对它整份免疫，所以这几条只能靠挂载测守。
- **`NAV_SCOPE_PREFIX` 补 `'alloc-loss': 'billing-chain'`**（`lockScopes.ts:105-129` 现在缺这个键，与 params / alloc / bill-notices 同锁根，`:110-112` 已是这个写法）。清单化之后 `go()` 的确认判据逐行生效，缺键那行会静默不弹确认。`reconciliation` 与 `import` 确认无编辑锁 → **不补，但要写注释钉住理由**。
  ⚠ **补这个键必然弄红 `utils/lockScopes.spec.ts` 的反向护栏**（复查实跑模拟：paramCenter / poolLedger / billNotices / coefBook **四条 FAIL**）—— `:94-97` 四条 SAMPLES 声明的 navs 是 `['params','alloc','bill-notices']`，`:133-147` 断言「认领集 = 声明的那组」。**这是补键的必然结果，不是遮红**：四条各加 `'alloc-loss'` 即可，登记在下面「既有断言的改动」里。spec §9 P2 行写的「反向护栏不红」指的是**改完之后**它仍然绿。
- **主管条的形状是硬约束，门禁抓不到**：§5.2 明写「32px 定高常驻，无待批显『暂无』，不 `v-if`」。`noInteractionLayoutShift.spec` 的交互态词表（`:50-51`）里**没有 `approvals`**，所以写成 `v-if="approvals.length"` 也不会红。计划在此钉死：**主管条外层不许有 `v-if`**（权限判 `can('lock:takeover') || can('system:view')` 那一层除外，那是「有没有这个角色」不是「有没有数据」）。
- **两栏清单会真红的写法**（同一份门禁的 `:50-51` 词表）：`v-if="selected"` / `selectedIds` / `dirty` / 任何流内 toast。公司 chips 的展开详情若写成 `<div v-if="selected…">` 当场红。合规写法：常驻容器 + 内层 `<template v-if>`，或 `position: absolute` 的浮层。
- **图标与令牌要先登记**：`components/ds/__tests__/icon.spec.ts:28` 扫全 `src` 的每个 `iconFor('字面量')` 必须在 `icon.ts` 的 MAP 里；构建期 `scripts/token-check.mjs:40-49` 要求每个 `var(--x)` 有定义。padlock / ✓ 锁标 / 橙钟这些新图标名与任何新色令牌，**先登记再用**。
- **首屏包只剩 6.0KB，而且是借来的**（P3 把 `CommandPalette` 改懒加载从 190.8 换到 185.0；`size-check.mjs:44` 的 `index: 191` **不许上调**）。本期进 index 的**只有** `lockScopes.scopePeriod` / `navOfScope` 与 `presence.editingNote` 三个纯函数（这两个文件本来就在 index）。主管条本体、两栏清单、`monthClose.logic.ts`、`BookMonthMatrix` 全部落在 `DataHomeView-*.js` 懒加载块（`router/index.ts` 的 `VIEWS` 表全是 `() => import()`）。**任何新的 shell 层静态 import 一律拒**。触线即停，不签字上调。
- **EOL**：仓库 `core.autocrlf=true`，无 `.gitattributes`。本期要改的文件里 `DataHomeView.vue` / `DataHomeView.spec.ts` / `DataHomeService.java` / `DataHomeOverviewDTO.java` / `presence.ts` / `lockScopes.ts` / `BookMonthMatrix.vue` / `types/dataHome.ts` 全是 **CRLF**，`SidebarNav.vue` / `SidebarPanel.vue` 是 **LF**。判断行尾一律用 `git ls-files --eol`，**别用 `grep $'\r'`**（实测给相反答案）。**禁止整文件重写**（会把行尾翻面，diff 变成全文件红绿）。
- **既有断言的改动清单**（超出这份清单即超范围，逐条都要在提交信息里点名）：
  1. `utils/lockScopes.spec.ts:94-97` 四条 SAMPLES 的 navs 各加 `'alloc-loss'`（补键的必然结果，见上）。
  2. `DataHomeView.spec.ts:358` 「出账链恒 5 步」`toBe(5)` → 出账列 **7** 行；`:359` 「附表恒 9 项」`toBe(9)` → 记账列 **8** 行；`:367` 同一条里的第二个 `toBe(5)` 同改。**这是期望值改动不是选择器迁移**，理由是版式从一排胶囊改成两栏板子。
  3. `DataHomeView.spec.ts:138-143` 「附表未录在前、已录在后」**整条删**：两栏清单按**业务时序**固定排序（spec §5.2 的表序），`sortedItems` 的 done 升序排序随之取消。P1 那条排序是给一排扁平胶囊用的可供性，两栏板子里它会让「月度台账」跳来跳去。**删断言要在 §12 记一笔**。
  4. `DataHomeView.spec.ts:175-181` 「附13 / 附14 同屏异 tab」：合并成一行之后不可能按原样通过。**裁定：合并行带两个 chip**（「办公」/「三期」），**每个 chip 各自带自己的 `tab`** —— 这样 P0b 立的链形状（`tab=office` / `tab=phase3`）一个都不丢，spec §5.2 的 8 行也成立。该条改成断言两个 chip 各自的 tab。**附表7/8 同办**（两个 chip「汽车」/「电动车」，各自的 nav value 是 `car-charging` / `ebike-charging`）。
  5. `DataHomeView.spec.ts:161` / `:168` 的 `.dh-item` 索引位移（折行后下标变了）。
  6. `DataHomeView.spec.ts:202` 「点附表项不触发 loadChain」**整条删**（T4，2026-09-06 定）：年份条要四个工序点，本屏从此**永远**是链数据的消费者，`onMounted` 就发 —— 「点附表不打链的网络」这句话不再成立。**§12 记一笔**。
  7. `DataHomeView.spec.ts:192` 「点出账链步骤后触发 loadChain」**改写**成「进屏即 loadChain 一次；再点出账链行不重复打网络」（T4）。不改写它会因为 `onMounted` 已经发过而**恒绿** —— 变成一条什么都不守的断言。
  其余 20 条**只改选择器不改期望值**。清单之外任何一条断言的期望值被改了 → **停下报告**。
- ⚠ **类型门禁只有 `npm run typecheck` 算数**（= `vue-tsc --noEmit -p tsconfig.app.json`，也是 `npm run build` 的第一步）。**不带 `-p` 的 `npx vue-tsc --noEmit` 什么都不检查** —— 根 `tsconfig.json` 是 `files: []` + references，实测输出 0 行。2026-09-06 在 T3 收尾发现：那之前各任务报的「vue-tsc 零错」全是空的，真正验过类型的只有跑过 `npm run build` 的那几个检查点（幸好它们把问题都挡住了，T3 之后才漏出两处）。
- **逐条破坏验证**：每条新断言改坏 production 一处 → **只有对应那条红** → 字符串替换还原，**绝不 `git checkout` / `git stash`**。这一期前面五期的评审累计抓到 13 处「改坏了却没有一条红」的假绿，写每条用例前先自问：**把我要保护的那一行删掉，这条会红吗**。
- 提交信息末尾：`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。前端命令在 `frontend/`，后端在 `backend/`（`./mvnw.cmd`）。**后端只跑 `-Dtest=DataHomeServiceTest,PermissionCoverageTest` 这类单测**，`*IT.java` 走 testcontainers（Windows 冷启动 15+ 分钟），只在收尾任务跑一次。

---

## 文件结构

| 文件 | 责任 |
|---|---|
| `backend/.../dto/DataHomeOverviewDTO.java:31` | `Item` 加 `List<Company> companies` / `List<Phase> phases`（都可 null）+ 两个内嵌 record（T1） |
| `backend/.../service/DataHomeService.java:139-167` | 三个年度源加 `acctMonth` 过滤；台账派生 companies；附10 拆 slot 出 phases；注入 `ManagementCompanyMapper`（T1） |
| `backend/.../service/DataHomeServiceTest.java:31,64-89` | 构造器 + `stubAllEmpty()` 补公司 stub；新增年度按月 / companies / phases 断言（T1） |
| `frontend/src/types/dataHome.ts:38-43`（`DataHomeItemDTO`） | 契约镜像同步（T1） |
| `frontend/src/views/data-home/monthClose.logic.ts`（新） | `rowsOf(...) → CloseRow[]` / `closeChecks(...)`；9 源折 8 行、出账 7 行、计数从行算（T2） |
| `frontend/src/views/data-home/__tests__/monthClose.logic.spec.ts`（新） | 纯函数单测：折行、padlock、源缺显「—」、年度行按月（T2） |
| `frontend/src/views/data-home/DataHomeView.vue:128-250` · **`:183-185`（`.dh-counts`）与 `:237`（`.dh-h3n`）两处都直读 `ov.schedules.done/total`** | 两栏清单取代胶囊行；收入核对串行补发；`go()` 逐行确认；**两处计数一起改成从行算**（只改一处的话段标题仍显「n/9」与两栏的「n/8」当屏打架）（T3） |
| `frontend/src/views/data-home/DataHomeView.spec.ts` | 既有 29 条按新版式改选择器（**只改选择器不改断言意图**），新增两栏 / chips / 「—」用例（T3） |
| `frontend/src/components/fp/BookMonthMatrix.vue:13-31, 103-108` | `MonthCell` 加 `locked?: boolean` + **独立 absolute 角标**（不进 `:103-108` 的 v-else-if 链）（T4） |
| `frontend/src/views/data-home/DataHomeView.vue:173-186` | 年份条取代 `Select`；`onMounted` 补 `loadChain`（T4） |
| `frontend/src/utils/lockScopes.ts` | 新增 `scopePeriod` / `navOfScope` 两个独立 export + `NAV_SCOPE_PREFIX` 补 `alloc-loss`（T5） |
| `frontend/src/stores/presence.ts` | 新增 `editingNote(navValue)`（从 SidebarNav 上提）（T5） |
| `frontend/src/components/ds/SidebarNav.vue:147-164, 198-207` | 改调 `presence.editingNote`；在场点补 `role="img"` / `aria-label` / `tabindex` / Popover（T5） |
| `frontend/src/utils/lockScopes.spec.ts`（**不在 `__tests__/` 下**）· `components/ds/__tests__/sidebarLockNote.spec.ts` | +2 / +3（T5） |
| `frontend/src/views/data-home/DataHomeView.vue`（主管条段） | 32px 定高常驻；待批授权 N + 谁在编辑 chips（点跳走 `navOfScope`）（T6） |
| `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md` §5.2 / §12 · `docs/design/BOOK-WORKBENCH-SPEC.md` §7 | 规范随裁定（T7） |

---

### Task 0: 基线

- [ ] **Step 1: 记下起点**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043
git rev-parse --short HEAD && git status --short
```

期望：HEAD = `27d5f6b`（P2 计划提交后），工作区干净。

- [ ] **Step 2: 三道门禁的基线数字**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run 2>&1 | tail -4
npm run typecheck
npm run build 2>&1 | tail -2
```

期望：197 文件 / 2331 用例全绿；tsc 零错；size-check index 185.0 / 191KB，合计 3885.8 / 3900KB。**把这三个数字抄进报告** —— 后面每个任务都要跟它比。

- [ ] **Step 3: 后端基线**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/backend
./mvnw.cmd -q -Dtest=DataHomeServiceTest -DfailIfNoTests=false test
cat target/surefire-reports/*DataHomeServiceTest.txt | head -4
```

期望：`Tests run: 20, Failures: 0, Errors: 0`。

---

### Task 1: 后端数据契约 —— companies / phases / 年度行按月

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/dto/DataHomeOverviewDTO.java:31`
- Modify: `backend/src/main/java/com/park/demo3/service/DataHomeService.java:39-49, 95-108, 139-167`
- Modify: `backend/src/test/java/com/park/demo3/service/DataHomeServiceTest.java:31, 64-89`
- Modify: `frontend/src/types/dataHome.ts:38-48`

**Interfaces:**
- Produces（前端 T2 消费）：
  ```java
  public record Item(String name, String tag, boolean done, String go,
                     List<Company> companies, List<Phase> phases) {}   // 后两个可为 null
  public record Company(int id, @JsonProperty("short") String shortName, boolean done) {}
  public record Phase(int no, boolean done) {}
  ```
  前端镜像：`companies?: { id: number; short: string; done: boolean }[]` / `phases?: { no: number; done: boolean }[]`。
  ⚠ 这个写法**不是二选一，是仓里唯一的既有写法**：`short` 是 Java 保留字不能作组件名；而 `CompanyDTO.java:9` / `ChargingCatDTO.java:6` / `CompanyReq.java:10` 三处已有先例，前端镜像 `types/charging.ts:8` / `types/elec.ts:9` / `types/ledger.ts:8` 一律写 `short`（其中一处注释还专门写了「非 shortName」）。照抄，别发挥。

- [ ] **Step 1: 先写失败的测试**

`DataHomeServiceTest.java` 追加四条（现有 **20** 条一行不动；其中只有 3 条真正走到 `scheduleSources`）：

```java
@Test
void 年度类附表按本月判_不是今年有行就算做了() {
    // 附6:去年 12 月有行、本月没有 → 本月应为未做(改前:整年有行就 done,一月录完十二月还显对勾)
    when(pv.selectByYear(2025)).thenReturn(List.of(pvRow("2025-01"), pvRow("2025-03")));
    var ov = svc.overview("2025-06");
    var pv6 = ov.schedules().items().stream().filter(i -> "附6".equals(i.tag())).findFirst().orElseThrow();
    assertThat(pv6.done()).isFalse();
    var ov3 = svc.overview("2025-03");
    var pv3 = ov3.schedules().items().stream().filter(i -> "附6".equals(i.tag())).findFirst().orElseThrow();
    assertThat(pv3.done()).isTrue();
}

@Test
void 台账项带公司清单_公司全集来自管理公司表_done按该月有没有行() {
    when(companies.selectList(any())).thenReturn(List.of(company(1, "一期"), company(2, "二期")));
    when(ledger.selectList(any())).thenReturn(List.of(ledgerRow(1)));   // 只有一期录了
    var item = itemOf(svc.overview("2025-06"), "ledger");
    assertThat(item.companies()).hasSize(2);
    assertThat(item.companies().get(0).done()).isTrue();
    assertThat(item.companies().get(1).done()).isFalse();   // 没录的也要在,否则看不出「该录几家」
}

@Test
void 附10项带四个期区_零新查询_按slot各自判() {
    when(s10.selectBySlot(2, "2025-06")).thenReturn(List.of(s10Row(2)));
    var item = itemOf(svc.overview("2025-06"), "sales-income");
    assertThat(item.phases()).hasSize(4);
    assertThat(item.phases().stream().filter(p -> p.done()).map(p -> p.no())).containsExactly(2);
}

@Test
void 其余七项的companies与phases为null_不占JSON体积() {
    var item = itemOf(svc.overview("2025-06"), "salary");
    assertThat(item.companies()).isNull();
    assertThat(item.phases()).isNull();
}
```

⚠ 两件事写死，别自己发挥：
- **这份测试不用 Mockito 注解**。`DataHomeServiceTest.java:16-32` 没有 `@ExtendWith(MockitoExtension.class)`、没有 `@Mock`，13 个依赖全是字段初始化 `X x = Mockito.mock(X.class);` + `:31` 手写 `new DataHomeService(...)`。所以新 mapper 要写成 `ManagementCompanyMapper companies = Mockito.mock(ManagementCompanyMapper.class);` 加在 `:29` 之后，`:31` 构造器补第 14 个实参。**写成 `@Mock` 字段会恒为 null**，然后在每一条走 `overview` 的用例里 NPE，而且症状指向 service 不指向测试。
- `stubAllEmpty()`（`:64-89`）补一条 `when(companies.selectList(any())).thenReturn(List.of());`。⚠ **漏了不会报错** —— Mockito 对 `List` 返回值默认给空 List 不给 null，漏 stub 只是静默拿到空公司集，测试照绿。这比 NPE 更坏，所以这条 stub 要在报告里点名确认加了。
- `pvRow` / `company` / `ledgerRow` / `s10Row` / `itemOf` 五个小工厂按本文件既有风格自己加（现有工厂在 `:42-43` 一带）。

- [ ] **Step 2: 跑它,确认按预期失败**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/backend
./mvnw.cmd -q -Dtest=DataHomeServiceTest -DfailIfNoTests=false test; cat target/surefire-reports/*DataHomeServiceTest.txt | head -4
```

期望：编译失败（`companies()` 方法不存在）或 4 条红。现有 20 条不许红。

- [ ] **Step 3: 实现 —— DTO**

`DataHomeOverviewDTO.java:31` 那一行扩成三行（`Item` 加两个组件 + 两个新内嵌 record）。注释写清「都可为 null：只有台账出 companies、只有附10 出 phases；`review` 位归 R1」。

- [ ] **Step 4: 实现 —— Service**

1. 构造器（`:39-49`）注入第 14 个依赖 `ManagementCompanyMapper companies`。
2. `scheduleSources`（`:139-167`）三处 `yearly(...)` 各加一道过滤，与 `:151-156` 附13/14 的既有写法逐字同形：

```java
sources.add(yearly("光伏发电", "附6", "pv-income",
    pv.selectByYear(year).stream()
        .filter(r -> acctMonth.equals(r.getAcctMonth())).toList(), PvRecord::getUpdatedAt));
```

（附7 / 附8 / 附11 同形；附11 是两段 `concat` 之后再过滤。）
方法头注释 `:139` 的「粒度差异是既有口径」要改掉 —— 现在**全部按 acctMonth**，`yearly` 这个位只剩「标签写不写年」的用途。

3. `SourceData` 加两个可空字段承载 companies / phases，或在 `:97-108` 组 `Item` 时按 `go` 分支挂上去（**实施者选更小的那个**，在报告里说明）。台账：

```java
Map<Integer, Boolean> ledgerDone = ledgerRows.stream()
    .collect(Collectors.groupingBy(MonthlyLedger::getCompanyId,
             Collectors.reducing(false, r -> true, Boolean::logicalOr)));
List<Company> cos = companies.selectList(new QueryWrapper<ManagementCompany>()
        .orderByAsc("sort_no").orderByAsc("id")).stream()
    .map(c -> new Company(c.getId(), c.getShortName(), ledgerDone.getOrDefault(c.getId(), false)))
    .toList();
```

附10：把 `:146-147` 的四次 `selectBySlot` 拆出来各留一个 `isEmpty()`，`concat` 仍供 `done` 用（**不增加 SQL 次数**）。

- [ ] **Step 5: 实现 —— 前端契约镜像**

`frontend/src/types/dataHome.ts:38-48` 的 `DataHomeItemDTO` 加 `companies?` / `phases?`，字段名与后端 JSON 逐字一致。

- [ ] **Step 6: 跑测试**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/backend
./mvnw.cmd -q -Dtest=DataHomeServiceTest -DfailIfNoTests=false test; cat target/surefire-reports/*DataHomeServiceTest.txt | head -4
cd ../frontend && npm run typecheck && npx vitest run 2>&1 | tail -3
```

期望：后端 24 条全绿（20 + 4）；tsc 零错；前端 2331 条不动（本任务不改前端行为）。

- [ ] **Step 7: 逐条破坏验证**

| 改坏什么 | 应红的那条 |
|---|---|
| 附6 那道 `.filter(r -> acctMonth.equals(...))` 删掉 | 「年度类附表按本月判」 |
| 公司全集改成只从 ledger 行 `groupingBy` 派生 | 「公司全集来自管理公司表」（没录的那家不见了） |
| `phases` 改成四个都跟着 `concat` 的总 done | 「附10项带四个期区_按slot各自判」 |
| 给 `salary` 也挂上空的 `companies = List.of()` | 「其余七项的companies与phases为null」 |

- [ ] **Step 8: 提交**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043
git add -A && git commit -m "$(cat <<'EOF'
feat(data-home): P2 数据契约 —— 台账带公司清单、附10 带四期区;三张年表改按本月判(改前一月录完十二月还显已录)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `monthClose.logic.ts` —— 两栏 15 行的纯函数

**Files:**
- Create: `frontend/src/views/data-home/monthClose.logic.ts`
- Test: `frontend/src/views/data-home/__tests__/monthClose.logic.spec.ts`（新）

**Interfaces:**
- Consumes：`DataHomeOverviewDTO`（T1 扩过）、`ReconMonthMeta`（T3 传入，本任务允许为 null）。**不 consume `chainStepsOf`**（见 Global Constraints）。
- Produces：
  ```ts
  export type CloseCol = 'billing' | 'booking'
  export interface CloseRow {
    key: string              // 稳定 key,不用数组下标
    col: CloseCol
    label: string            // 「月度台账」
    tag?: string             // 「凭证」/「附10」
    go?: string              // nav value;无入口的行不给
    state: 'todo' | 'done' | 'stale' | 'na'   // na = 源缺,屏上显「—」
    detail?: string          // 「本月电价 6/6 已录」,来自 overview.chain.steps[i].detail
    locked?: string          // 有值 = 前置未满,显 padlock,文案即 tooltip
    chips?: { label: string; done: boolean; co: number | 'all' }[]   // 台账公司 / 附10 期区
    review: 'na'             // 本期恒 'na'(审核机制归 R1);留字段是为了 R2 只填不改形状
  }
  export function rowsOf(o: RowsInput): CloseRow[]
  export function closeChecks(rows: CloseRow[]): { done: number; total: number; byCol: Record<CloseCol, { done: number; total: number }> }
  ```
  `RowsInput = { overview, recon, review }`，其中 `review` 本期恒 `null`。**没有 `cell`** —— 出账列五步读 `overview.chain.steps`，`ChainCell` 只在 T4 的年份条里用。

- [ ] **Step 1: 先写失败的测试**

新建 `frontend/src/views/data-home/__tests__/monthClose.logic.spec.ts`，至少这 8 条：

```ts
it('出账列 7 行:链五步 + 收入核对 + 本月锁账,顺序即业务时序', ...)
it('记账列 8 行:附13+附14 折成「办公·三期水电」一行、附7+附8 折成「附表7/8」一行、加导入中心', ...)
it('折出来的行两项都 done 才算 done —— 只做了附13 是 todo,不是 done', ...)
it('本月锁账恒 na(审核机制未上线),显「—」不显 0,且带 locked 文案', ...)
it('导入中心恒 na —— 它不在后端 9 源里,没有「本月导没导」这回事', ...)
it('收入核对:recon 为 null 时 na;diffCount/missCount 都是 0 才 done', ...)
it('计数从渲染的行算,不抄 schedules.total —— 后端 9 源折成 8 行,记账列分母是 8', ...)
it('链五步的状态取 overview.chain.steps[i].status —— 不许用 chainStepsOf,它的第一步恒 done(矩阵 4 点与清单 5 步是两套口径,spec §5.1)', ...)
```

**每条写之前先自问：把我要保护的那一行删掉，这条会红吗。** 尤其「计数从行算」那条 —— 断言必须是 `byCol.booking.total === 8`，而不是「等于某个变量」。

- [ ] **Step 2: 跑它,确认 8 条全红**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run src/views/data-home/__tests__/monthClose.logic.spec.ts
```

- [ ] **Step 3: 实现**

写 `monthClose.logic.ts`。**纯函数，零 import Vue、零 store**（这样它能进懒加载块且好测）。折行表写成模块级常量：

```ts
/** 记账列 8 行 ← 后端 9 源。合并行 done = 两项皆 done(保守:与「全月已审核」同调)。 */
const BOOKING_ROWS: { key: string; label: string; tag?: string; from: string[]; go?: string }[] = [
  { key: 'ledger',        label: '月度台账', tag: '凭证',   from: ['ledger'],        go: 'ledger' },
  { key: 'sales-income',  label: '附表10',   tag: '附10',   from: ['sales-income'],  go: 'sales-income' },
  { key: 'salary',        label: '附表12',   tag: '附12',   from: ['salary'],        go: 'salary' },
  { key: 'utilities',     label: '办公·三期水电', tag: '附13/14', from: ['utilities'], go: 'utilities' },
  { key: 'pv-income',     label: '附表6',    tag: '附6',    from: ['pv-income'],     go: 'pv-income' },
  { key: 'charging',      label: '附表7/8',  tag: '附7/8',  from: ['car-charging', 'ebike-charging'], go: 'car-charging' },
  { key: 'elec-cost',     label: '附表11',   tag: '附11',   from: ['elec-cost'],     go: 'elec-cost' },
  { key: 'import',        label: '导入中心', from: [],      go: 'import' },   // 无源 → 恒 na
]
```

（`utilities` 后端出两项同名 `go`，按 `tag` 分辨附13 / 附14。）

- [ ] **Step 4: 跑测试 + 破坏验证**

| 改坏什么 | 应红的那条 |
|---|---|
| `charging` 那行的 `from` 只留一个 | 「附7+附8 折成一行」 |
| 合并行的 done 从「两项皆 done」改成「任一 done」 | 「只做了附13 是 todo」 |
| 「本月锁账」的 state 从 `na` 改成按五步派生 | 「本月锁账恒 na」 |
| `closeChecks` 的分母改成 `overview.schedules.total` | 「计数从渲染的行算」 |
| 链五步改成 `chainStepsOf(cell)` | 「链五步的状态取后端 status」（`chainStepsOf` 的第一步恒 done，会让没录电价的月显示已完成 —— P1 的破坏验证专门钉过这个洞） |

- [ ] **Step 5: 提交**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043
git add -A && git commit -m "$(cat <<'EOF'
feat(data-home): P2 monthClose.logic —— 9 源折成两栏 15 行,计数从渲染的行算不抄 DTO total

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 两栏清单落到屏上

**Files:**
- Modify: `frontend/src/views/data-home/DataHomeView.vue`（模板 `:206-246` 两块换成两栏；`:113-125` computed；`go()` 的确认判据逐行生效）
- Modify: `frontend/src/views/data-home/DataHomeView.spec.ts`
~~- Modify: `frontend/src/utils/lockScopes.ts`（补 `alloc-loss` 键）~~ **撤销**：执行中裁定不补这个键（`NAV_SCOPE_PREFIX` 是「屏 → 锁根」，出账链几屏共用一把锁根，补键不会让确认更准，只会让在场点长在一个只读屏上）。本任务**不碰 `lockScopes.ts`**。

**上游已落地，直接用（别重复造）：**
- `views/data-home/monthClose.logic.ts` 的 `rowsOf({ overview, recon, review }) → CloseRow[]` 与 `closeChecks(rows)`。**行状态、chips、计数全在那里算完了**，本任务只负责取数与渲染。
- 收入核对的判据（含 `hasData` 闸）**已经在 `reconRow` 里**，T3 只把 `ReconMonthMeta` 取来喂进去，**别再判一遍**。
- 有 chips 的行 done 已收严成「所有 chip 都 done」，所以默认夹具下 `sales-income` 是 **todo 不是 done** —— 写用例时别按旧行为设预期。
- 恒 `na` 的行不进分母，所以计数是**记账 n/7、出账 n/6**，不是 8 和 7。

- [ ] **Step 1: 先改既有测试的选择器（不改断言意图）**

本文件实测 **25** 条，其中 **16** 条用 `.dh-step` / `.dh-item` 选行（`:123 :138 :152 :161 :168 :175 :184 :193 :201 :241 :255 :272 :287 :302 :317 :349`）。**先照 Global Constraints 的「既有断言的改动清单」处理那 5 条**（期望值改 / 整条删 / 改成 chip 断言），其余**只改选择器，断言一个字不动**，每处加一句注释说明「版式从胶囊行改两栏，选择器随之」。**清单之外任何一条断言的期望值被改了都要停下报告** —— 那不是版式迁移，是遮红。

- [ ] **Step 2: 新增用例**

```ts
it('两栏:出账列 7 行、记账列 8 行,各自带自己的计数', ...)
it('源缺的行显「—」不显 0(本月锁账 / 导入中心)', ...)
it('台账行带公司 chips:没录的公司也在,灰的', ...)
it('附10 行带四个期区 chips', ...)
it('chip 点击带 p 与 co —— 与分析层 openDeep 同口径', ...)
it('前置未满的行显 padlock,悬停说前置是什么', ...)
it('收入核对取数失败不阻断整屏,该行显「—」', ...)
```

- [ ] **Step 3: 实现 —— 取数**

`onMounted` 之外补一个 `watch(curYm)`：拿到年之后串行发 `reconApi.overview(year)`，从回包的 `months` 里 `find(m => m.month === 当前月)` 落成 `recon`。失败 `.catch(() => null)`。**为什么不并发**：默认首载 `pickedYm` 是 null，年只能从 overview 回包的 `ov.period` 派生；并发就只能传 `undefined`，后端会取「两本账有数据的最大年」，与首页锚定月的年大概率不是同一年 —— 拿到的是别的年的差异数，形状对、数字张冠李戴，没有任何断言抓得到。

然后：

```ts
const rows = computed(() => (ov.value ? rowsOf({ overview: ov.value, recon: recon.value, review: null }) : []))
const checks = computed(() => closeChecks(rows.value))
const billingRows = computed(() => rows.value.filter(r => r.col === 'billing'))
const bookingRows = computed(() => rows.value.filter(r => r.col === 'booking'))
```

`review` 本期恒 `null`（审核机制归 R1）。

- [ ] **Step 4: 实现 —— 两栏版式**

两栏 CSS Grid 两列（1366×620 内视口下内容区 ≈1027×502，行 38px，两栏各 6–8 行一屏装下）。三条硬要求：

1. **行是常驻的**：状态用 `:data-state="r.state"` 属性驱动样式，**不要** `v-if` 切换整行。`na` 的行照样渲染，状态位显「—」。
2. **chips 的展开详情若要浮层，一律 `position: absolute`**。零位移门禁的交互态词表（`noInteractionLayoutShift.spec:50-51`）里有 `selected` / `selectedIds` / `dirty` —— 写成 `<div v-if="selected…">` 当场红。
3. **两处计数都要改**：`:183-185` 的 `.dh-counts` 与 `:237` 的 `.dh-h3n` 现在都直读 `ov.schedules.done/total`。只改一处的话段标题仍显「n/9」，与两栏的「n/7」当屏打架 —— 正是 §8.1「计数与屏内同源」要防的。两处一起换成 `checks`。

行内元素：状态点 · 行名 · tag · chips · padlock（`r.locked` 有值时显，文案即 tooltip）· 审核态位（本期恒「—」）。
点行走既有的 `go(r.go, r.tab)`；**`r.go` 为空的行（本月锁账）不给点**。
chip 点击带自己的参数：公司 chip 带 `co`，期区 chip 带 `co`，办公/三期与汽车/电动车两组带各自的 `tab` 或 nav value。**与分析层 `openDeep` 同口径**。

- [ ] **Step 5: 跑测试**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run src/views/data-home/
npx vitest run 2>&1 | tail -3
npm run typecheck
```

期望：`DataHomeView.spec` 现有 25 条（按 Step 1 处理过的除外）+ 新增 7 条全绿；全量在基线 **2372** 之上只多你新加的；tsc 零错。
**若 `noInteractionLayoutShift.spec` 或 `readonlyHasNoWriteButtons.spec` 红了 —— 停下报告**，那说明新版式落进了门禁抓的形状。

- [ ] **Step 6: 逐条破坏验证**

⚠ **往两个方向破坏**。上一个任务的实现者做了 18 次破坏却全部朝「改得更 done」一个方向，结果「永远不 done」与「入口串了」两片盲区一次没验到，评审一破坏全线飘绿。

| 改坏什么 | 应红的那条 |
|---|---|
| 两栏的 `filter(r => r.col === 'billing')` 改成不过滤 | 「两栏各自的行数」 |
| `.dh-counts` 改回读 `ov.schedules.total` | 「两处计数同源且分母是 7」 |
| `:237` 段标题**不**改（保留读 DTO） | 同上（这一条专门钉「两处一起改」） |
| `na` 的行加上 `v-if="r.state !== 'na'"` | 「源缺的行照样渲染，状态位显『—』」 |
| 台账行的 chips 不渲染 | 「台账行带公司 chips，没录的也在」 |
| chip 的 `co` 不带 | 「chip 点击带 p 与 co」 |
| 给本月锁账行也绑上点击 | 「无入口的行不给点」 |
| `recon` 改成不发请求（恒 null） | 「收入核对行显『—』」**注意**：这条同时验「取数失败不阻断整屏」 |
| `watch(curYm)` 改成 `onMounted` 里并发发 `overview(undefined)` | 若无断言能红 → **说明「串行」这条口径零覆盖，要补一条**（断言 `reconApi.overview` 被调用时的实参是当前年，不是 undefined） |

- [ ] **Step 7: 提交**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043
git add frontend/src/views/data-home/DataHomeView.vue frontend/src/views/data-home/DataHomeView.spec.ts
git commit -m "$(cat <<'EOF'
feat(data-home): P2 两栏清单落屏 —— 出账 7 行 / 记账 8 行,行状态由数据派生,源缺显「—」;计数两处同源从行算

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 年份条取代月份下拉

**Files:**
- Modify: `frontend/src/components/fp/BookMonthMatrix.vue`（`MonthCell` 加 `locked?: boolean` + 独立 absolute 锁角标；新增可选 prop `manageYears?: boolean`）
- Modify: `frontend/src/views/data-home/DataHomeView.vue`（删 `Select` 与 `monthOpts`，头里改显 `ov.period.label`，`.dh-head` 与前置条之间插年份条，骨架同步；`onMounted` 补 `loadChain`）
- Test: `frontend/src/components/fp/__tests__/chainMatrix.spec.ts` +2；`frontend/src/views/data-home/DataHomeView.spec.ts` 迁 4 处选择器 + 删 1 条 + 改写 1 条 + 新增 5 条

**Interfaces:**
- Consumes: T3 落地的 `.dh-head` / `.dh-cols` / 骨架分支；`stores/billingPeriod` 的 `loadChain()` / `cellOf(ym)` / `loaded`；`nav/billingChain` 的 `pipsOf(cell) → boolean[]`；`utils/matrixYears` 的 `buildYearRows(dataYears, currentYear, extraYears) → { year, manual }[]`
- Produces: `MonthCell.locked?: boolean` —— R1 §7.2「全月已审核 → ✓ 锁标」的落点；`BookMonthMatrix` 的 `manageYears?: boolean`（默认 `true`，其余 7 个调用点零改动）

**本任务的九条裁定**（2026-09-06 控制者定，逐条带理由与判错代价）：

1. **年份行的数据源是 `ov.months`，不是 `period.dataYears`。** 后端 `DataHomeService.allMonths` 的头注原话：「顶部月份下拉的可切月份：链 ∪ 附表……**不能只给链的月份** —— 用户要能切到 2025-06 补台账，而那个月链上一条数据都没有」。照 `dataYears`（只有链的四个 `/months` 端点）组年份，只有附表数据的年整年点不进去 —— 那正是这屏最常用的场景。**判错代价**：一行 `map` 换回来。
2. **`hasData` 取 `ov.months.includes(ym)`，不取 `pips.some(Boolean)`。** 同上：附表月的四个工序点全灭，照 pips 判会把它画成虚线「空」卡。
3. **`pips` 只在 `period.loaded` 为真时传，否则整个字段不给。** 链数据是 `onMounted` 之后异步到的；未到时传 `[false,false,false,false]` 就是「这个月一道工序没走」—— 本期评审累计抓了 13 处这类假绿，不许再造一处。不传时落到 `:105-107` 的 `v-else-if` 后段，卡片只显「N月」，诚实。**零位移**：`.bmm-card` 是 `min-height:62px` + `justify-content:space-between`，少一个子元素不改高度，月份标签仍在顶部（这一条要有用例钉住）。
4. **`cur`（描边）= 当前显示月，不是 ChainMonthGate 的「最近有数据月」。** 这条回答「你现在看的是哪个月」，`ChainMonthGate` 那条回答「从哪儿接着干」。用 `ym === curYm` 判。
5. **`manageYears?: boolean` 默认 `true`，首页传 `false`**，隐藏「＋ 补更早年份」「＋ 添加 {次年} 年」与行尾移除槽三处。理由：首页这条是**导航**不是账册管理 —— 在总览屏「添加 2027 年」不产生任何数据，接了线也没有语义，不接线就是两颗按下去没反应的按钮（比没有按钮更坏）。顺带省掉约 80px 竖向空间，而 1366×620 下内容区只有 ≈502px，两栏板子本身要 300px+。默认 `true` 保证 7 个既有调用点与快照类断言**一个字不改**。**判错代价**：删一个 prop。
   ⚠ 隐藏移除槽会让月卡网格变宽（`.bmm-rm-slot` 是 `flex:0 0 44px` 常驻占宽）—— 这是**跨屏的不同版式**，不是位移；同一屏内它恒隐或恒显。
6. **年份条插在 `.dh-head` 之后、前置条（`.dh-blocker`）之前。** 前置条是按 ym 算的（`paramStale` 就是 `paramService.status(ym)` 的回包），期的选择器必须读在它上面，否则用户看到一条警告却不知道说的是哪个月。
7. **头里 `.dh-msel` 换成 `ov.period.label` 纯文本，不许直接删。** `DataHomeView.spec.ts:237` 的 `expect(w.text()).toContain('2025年6月')` 与 `:238` 的 `not.toContain('2023年8月')` 靠屏上有这句月名；删了那条会红，而它守的是「晚到的旧回包不覆盖新选的月」这件真事，不是版式。这是**选择器迁移不是期望值改动**。
8. **`onMounted` 补 `loadChain` 会动到两条既有断言，两条都按下面处理**（超出计划原有的 5 条改动清单，登记为第 6、7 条）：
   - `:202`「点附表项不触发 loadChain」（`expect(metersApi.months).not.toHaveBeenCalled()`）—— **整条删**。它的意图被设计作废：年份条让本屏**永远**是链数据的消费者，「点附表不打链的网络」这句话从今天起不再成立。§12 记一笔。
   - `:192`「点出账链步骤后触发 loadChain」—— 改写成「**进屏即 loadChain 一次；再点出账链行不重复打网络**」（仍断 `toHaveBeenCalledTimes(1)`，但语义从「点了才发」变成「进屏就发 + 幂等」）。不改写的话它会因为 `onMounted` 已经发过而**恒绿**，变成一条什么都不守的断言。
9. **锁角标本期没有生产路径，唯一有效的守是组件级用例。** §7.2 审核机制整块归 R1（见 Global Constraints 第一条），所以首页**不传 `locked`**，屏级怎么写都绿。有效的守只有 `chainMatrix.spec` 里那条「同时传 `pips` 与 `locked: true` 时两者都在 DOM 里」—— 它钉的是「锁标是独立 absolute 角标，没被写进 `:102-107` 那条 `v-else-if` 互斥链」（年份条恒传 pips，写进链里就一次都画不出来，而 R1 那时再发现就晚了）。如实记 §12：本期 `locked` 是 R1 的落点，无调用方。

- [ ] **Step 1: 先写失败的测试 —— 组件级（`components/fp/__tests__/chainMatrix.spec.ts`）**

照该文件既有的 `months()` / `mk()` 两个辅助写（`:18-29`），**不要另起夹具**：

```ts
it('锁标是独立角标:同传 pips 与 locked 时两者都在 DOM 里', () => {
  const w = mk(months({ 3: { hasData: true, pips: [true, false, false, false], locked: true } }))
  const card = w.findAll('.bmm-card')[2]
  expect(card.findAll('.bmm-pip')).toHaveLength(4)
  expect(card.find('.bmm-lock').exists(), '锁标若写进 pips/badge/rowCount 那条 v-else-if 链就永远画不出来').toBe(true)
})

it('manageYears=false 时三处年份管理入口都不渲染', () => {
  setActivePinia(createPinia())
  const w = mount(BookMonthMatrix, {
    props: { book: BOOK, years: [{ year: 2025, months: months(), removable: true }], manageYears: false },
  })
  expect(w.find('.bmm-addy').exists()).toBe(false)     // ＋ 补更早年份
  expect(w.find('.bmm-addrow').exists()).toBe(false)   // ＋ 添加 {次年} 年
  expect(w.find('.bmm-rm-slot').exists()).toBe(false)  // 行尾移除槽
})
```

⚠ 第二条自己 `setActivePinia`（`mk()` 里做了，直接 `mount` 的这条没有 —— 组件读 `usePresenceStore`）。

- [ ] **Step 2: 先写失败的测试 —— 屏级（`views/data-home/DataHomeView.spec.ts`）**

```ts
it('年份条取代月份下拉:屏上没有 Select,矩阵在,月名照显', async () => {
  const w = await mountWith()
  expect(w.findComponent({ name: 'Select' }).exists()).toBe(false)
  expect(w.findComponent({ name: 'BookMonthMatrix' }).exists()).toBe(true)
  expect(w.text()).toContain('2024年2月')
})

it('年份行来自 ov.months 的年,不是链数据年:只有附表的年也点得进去', async () => {
  const w = await mountWith()   // 夹具 months = ['2023-08','2024-02','2025-06'],链四端点全 mock 成 []
  const years = w.findComponent({ name: 'BookMonthMatrix' }).props('years') as { year: number }[]
  expect(years.map(y => y.year), '照 period.dataYears 组年份这里会是空的').toContain(2023)
  expect(years.map(y => y.year)).toContain(2025)
})

it('点格子换月:@pick 回写 pickedYm,重新取 overview', async () => {
  const w = await mountWith()
  getOverview.mockResolvedValue(overview({ period: { year: 2025, month: 6, label: '2025年6月' } }))
  await w.findComponent({ name: 'BookMonthMatrix' }).vm.$emit('pick', 2025, 6)
  await flushPromises()
  expect(getOverview).toHaveBeenLastCalledWith('2025-06')
  expect(w.text()).toContain('2025年6月')
})

it('描边跟着当前显示月走,不是「最近有数据月」', async () => {
  const w = await mountWith()   // 锚定月 2024-02
  const years = w.findComponent({ name: 'BookMonthMatrix' }).props('years') as { year: number; months: { month: number; cur?: boolean }[] }[]
  const flat = years.flatMap(y => y.months.map(m => ({ ym: `${y.year}-${String(m.month).padStart(2, '0')}`, cur: m.cur })))
  expect(flat.filter(c => c.cur).map(c => c.ym)).toEqual(['2024-02'])
})

it('链数据没到时不给 pips —— 四个灭点会被读成「这个月一道工序没走」', async () => {
  // metersApi.months 停在在途:overview 已上屏,billingPeriod.loaded 仍为 false
  let resolve!: (v: string[]) => void
  vi.mocked(metersApi.months).mockReturnValueOnce(new Promise<string[]>((r) => { resolve = r }))
  const w = await mountWith()
  const years = w.findComponent({ name: 'BookMonthMatrix' }).props('years') as { months: { pips?: boolean[] }[] }[]
  expect(years.flatMap(y => y.months).every(m => m.pips === undefined),
    '未加载时传 [false,false,false,false] = 假绿:那是「查过了,一道没走」').toBe(true)
  resolve([])
  await flushPromises()
})
```

改写 `:192`、删 `:202`（裁定 8）：

```ts
it('进屏即 loadChain 一次,再点出账链行不重复打网络', async () => {
  // 年份条要 4 个工序点,所以本屏从 T4 起进屏就发;go() 里那句是幂等兜底(loaded 后直接返回)。
  // 不补这一句,目标屏 chainStepsOf(cellOf(ym)) 读到冻结的 EMPTY 格子,五道工序全显「未做」。
  const w = await mountWith()
  expect(vi.mocked(metersApi.months)).toHaveBeenCalledTimes(1)
  await w.findAll('.dh-row-billing')[1].trigger('click')
  await flushPromises()
  expect(vi.mocked(metersApi.months)).toHaveBeenCalledTimes(1)
})
```

四处 `Select` 选择器迁移（`:215` / `:230` / `:583` / `:601`，**期望值一个字不改**）：
`await w.findComponent({ name: 'Select' }).vm.$emit('update:modelValue', '2025-06')`
→ `await w.findComponent({ name: 'BookMonthMatrix' }).vm.$emit('pick', 2025, 6)`

- [ ] **Step 3: 跑它,确认按预期失败**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run src/components/fp/__tests__/chainMatrix.spec.ts src/views/data-home/DataHomeView.spec.ts
```

期望：组件 2 条 + 屏级 5 条新用例红，`Select` 迁移那 4 条红（组件不存在）。**其余既有条目全绿** —— 若有别的红，先停下报告。

- [ ] **Step 4: 实现 —— `BookMonthMatrix.vue`**

`MonthCell`（`:13-31`）末尾加一个字段，注释照该 interface 既有的密度写：

```ts
  /**
   * 全月已审核 → 卡右下角一枚 ✓ 锁标（SIDEBAR-UX-REDESIGN §7.2）。
   * **独立 absolute 角标，与 pips / badge / rowCount 并存**，不进下面那条 v-else-if 互斥链 ——
   * 年份条恒传 pips，写进链里锁标一次都画不出来，而那种用例接对接错都绿。
   * 审核机制本身归 R1，本期无调用方传它。
   */
  locked?: boolean
```

props（`:39-49`）加：

```ts
  /** 年份增删入口（补更早 / 添加次年 / 行尾移除）。默认开；总览屏那条年份条是导航不是账册管理，传 false。 */
  manageYears?: boolean
```

⚠ 本文件用的是**裸 `defineProps<{...}>()`**，没有 `withDefaults`。别为了一个布尔把整段改成 `withDefaults` —— 模板里写 `v-if="manageYears !== false"` 即可（`undefined` 当真）。

模板三处：`.bmm-top`（`:73-77`）与 `.bmm-addrow`（`:119-125`）整块加 `v-if="manageYears !== false"`；`.bmm-rm-slot`（`:111-116`）同样。锁标插在 `.bmm-who`（`:96-100`）后面、pips 那条链之前：

```html
<span v-if="m.locked" class="bmm-lock" title="本月已审核锁定"><Lock :size="11" /></span>
```

`Lock` 从 `lucide-vue-next` 直接 import，与本文件既有的 `Plus, X`（`:11`）同行同风格（**不走 `iconFor`** —— 本组件一次都没用过它）。样式挨着 `.bmm-who`（`:192`）写：

```css
.bmm-lock { position:absolute; bottom:6px; right:6px; z-index:2; pointer-events:none; display:flex; color:var(--text-muted); }
```

⚠ 位置选 **右下**：右上被 `.bmm-who` 在场头像占了，左下是 `.bmm-pips`（flex-start），只有右下是空的。`--text-muted` 本文件 `:154` 已在用，不引入新令牌（构建期 `scripts/token-check.mjs` 会查）。

- [ ] **Step 5: 实现 —— `DataHomeView.vue`**

① 删 `import Select from '@/components/ds/Select.vue'`（`:23`）与 `monthOpts`（`:133-134`）；加 `BookMonthMatrix` 的 import、`pipsOf`（并进 `:28` 那行 `@/nav/billingChain`）、`buildYearRows`（`@/utils/matrixYears`）。

② `onMounted(load)`（`:60`）→ 照 `ChainMonthGate.vue:36` 的既有写法：

```ts
onMounted(() => { void load(); void period.loadChain() })
```

`loadChain` 内部自己吞异常（`fetchAll` 的 catch 落 `loadErr`、不 reject），**不用再 `.catch`**。

③ 年份行：

```ts
// 年份条(P2 T4):年份行来自 ov.months —— 后端明发的「链 ∪ 附表」全集(DataHomeService.allMonths)。
// 照 period.dataYears 走会丢掉只有附表的年,而「切到 2025-06 补台账」正是这屏最常用的一步。
const yearRows = computed(() => {
  const ms = ov.value?.months ?? []
  const have = new Set(ms)
  const years = [...new Set(ms.map(m => +m.slice(0, 4)))]
  return buildYearRows(years, new Date().getFullYear(), []).map(r => ({
    year: r.year,
    months: Array.from({ length: 12 }, (_, i) => {
      const ym = `${r.year}-${String(i + 1).padStart(2, '0')}`
      const c = period.cellOf(ym)
      return {
        month: i + 1,
        hasData: have.has(ym),
        // 链数据没到时**整个字段不给** —— 四个灭点会被读成「这个月一道工序没走」(裁定 3)
        ...(period.loaded ? { pips: pipsOf(c), stale: c.stale } : {}),
        cur: ym === curYm.value,
      }
    }),
  }))
})
```

④ 模板：头里 `:225-228` 那块换成月名（裁定 7）；年份条作为 `.dh-head` 的**兄弟**插在前置条之前（裁定 6）：

```html
      <div v-if="ov.period" class="dh-mnow">{{ ov.period.label }}</div>
```
```html
    <div v-if="ov.period" class="dh-ystrip">
      <BookMonthMatrix :book="{}" :years="yearRows" :manage-years="false"
                       @pick="(y, m) => { pickedYm = `${y}-${String(m).padStart(2, '0')}` }" />
    </div>
```

`.dh-msel { width: 140px }`（`:321`）随 `Select` 一起删，换 `.dh-mnow`（`--fs-label` / `--text-secondary` 一类，照 `.dh-counts` 的量级）与 `.dh-ystrip`（只要一个下边距即可，矩阵自己有 `gap`）。

⑤ **骨架同步**（`:185` 那个 `.dh-msel` 28px 微光条）：换成 `.dh-mnow` 尺寸的短条，**并且**在 `.dh-head` 之后补一个 `.dh-ystrip` 微光块 —— 同一个 class、同一条竖向轴，高度按**一年**给（78px ≈ 62px 卡 + 行距）。
⚠ **诚实记一笔在注释里**：年份数在数据到达前不可知，所以骨架给一年、真版式若是四年，这一块会**长高**。T3 修的是轴向从单列跳成两栏（版式塌）—— 那是必须消掉的；块变高是同轴同序的增高，量级不同，**不假装能对齐**。

- [ ] **Step 6: 跑测试**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run src/components/fp/ src/views/data-home/
npx vitest run 2>&1 | tail -3
npm run typecheck
npm run build 2>&1 | tail -8
```

期望：全量在基线 **2384** 之上 = 2384 + 7 新增 − 1 删除 = **2390**；`npm run typecheck` 零错（⚠ **只有它算数**，见 Global Constraints 最后一条）。
`npm run build` 必须过 `size-check`：上一次是 **index 185.7 / 191KB、合计 3890.3 / 3900KB —— 只剩 9.7KB**。`BookMonthMatrix` 已经是独立共享块（`dist/assets/BookMonthMatrix-*.js` 3.3KB），多一个引用方**不增字节**；真正新增的只有本任务写的那几十行。**触线即停，不许上调 `size-check.mjs` 的任何一个数**。
**若 `noInteractionLayoutShift.spec` 或 `readonlyHasNoWriteButtons.spec` 红了 —— 停下报告。**

- [ ] **Step 7: 逐条破坏验证**

⚠ **往两个方向破坏**，并且**每一次破坏先自证改到了 production 语句**（改注释 = 没破坏，0 红会被读成「护栏是假的」—— 本期真出过一次）。还原一律**字符串替换**，替换前先数命中次数，不是 1 就换更长的上下文；**绝不 `git checkout` / `git stash`**。

| 改坏什么 | 应红的那条 |
|---|---|
| 锁标挪进 `:102-107` 的 `v-else-if` 链（改成 `v-else-if="m.locked"`） | 组件条「锁标是独立角标」 |
| `manageYears !== false` 改成恒真 | 组件条「三处年份管理入口都不渲染」 |
| `yearRows` 的年份改回 `period.dataYears` | 「年份行来自 ov.months」 |
| `hasData` 改成 `pipsOf(c).some(Boolean)` | 同上（链全空 → 整条全是虚线卡） |
| `period.loaded ? {...} : {}` 改成恒传 | 「链数据没到时不给 pips」 |
| `cur` 改成 ChainMonthGate 那套「最近有数据月」 | 「描边跟着当前显示月走」 |
| `@pick` 不回写 `pickedYm` | 「点格子换月」 |
| 头里的 `ov.period.label` 删掉 | **既有两条**（`:237` 晚到回包那条 + `:601` 那条），证明裁定 7 是真的 |
| `onMounted` 里的 `void period.loadChain()` 删掉 | 「进屏即 loadChain 一次」 |
| 骨架里新加的 `.dh-ystrip` 微光块删掉 | 若**无一条红** → 如实报告「这一条零覆盖」，**不要硬凑**（T3 那条「取数失败兜底」就是如实报了测不出） |

- [ ] **Step 8: 提交**

只 `git add` 下面四个路径，**不许 `git add -A`**（工作区可能有别人的改动）。提交信息用 `git commit -F` 读一个临时文件，避免嵌套 heredoc：

```
feat(data-home): P2 年份条取代月份下拉 —— 年份行取 ov.months(链∪附表),链未到不给 pips;BookMonthMatrix 加 locked 独立角标与 manageYears

既有断言改动(计划改动清单第 6/7 条):删「点附表项不触发 loadChain」(年份条让本屏永远消费链数据,该语义作废);
「点出账链步骤后触发 loadChain」改写成「进屏即发一次 + 幂等」(否则 onMounted 已发过,该条恒绿)。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043
git add frontend/src/components/fp/BookMonthMatrix.vue frontend/src/components/fp/__tests__/chainMatrix.spec.ts frontend/src/views/data-home/DataHomeView.vue frontend/src/views/data-home/DataHomeView.spec.ts
git commit -F <上面那段写成的临时文件路径>
```

---

### Task 5: §3.3 在场点 —— scopePeriod / navOfScope / editingNote 上提

**Files:**
- Modify: `frontend/src/utils/lockScopes.ts`（两个新 export + `NAV_SCOPE_PREFIX` 补键）
- Modify: `frontend/src/stores/presence.ts`（新增 `editingNote`）
- Modify: `frontend/src/components/ds/SidebarNav.vue:147-164, 198-207`
- Test: `utils/__tests__/lockScopes.spec.ts` +2 · `components/ds/__tests__/sidebarLockNote.spec.ts` +3

- [ ] **Step 1: 先写失败的测试**

```ts
// lockScopes.spec
it('scopePeriod 认全部锁形状:billing-chain:2025-06 → 2025-06;meters:2025 → 2025;ledger:3:2025-06 → 2025-06;无期 → null', ...)
it('navOfScope 反查 nav value —— 一把锁命中多个时取 NAV_SCOPE_PREFIX 声明序首个(billing-chain → params)', ...)
// sidebarLockNote.spec(现有 3 条一字不动)
it('在场点有 role="img" 与 aria-label —— 屏读能念出「谁在编辑哪一期」', ...)
it('在场点可聚焦(tabindex=0),Enter 开 Popover', ...)
it('文案带期:「李四 正在编辑 · 2025-06 · 三屏共用一把月锁」', ...)
```

- [ ] **Step 2: 跑它,确认按预期失败**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run src/utils/lockScopes.spec.ts src/components/ds/__tests__/sidebarLockNote.spec.ts
```

期望：新增 5 条红（`scopePeriod is not a function` 之类），**现有条目全绿**（lockScopes 的反向护栏与 sidebarLockNote 的 3 条）。

- [ ] **Step 3: 实现 —— `utils/lockScopes.ts` 两个纯函数**

放在 `scopeNote`（`:138`）旁边，**独立 export，不进 `S` 对象**（`lockScopes.spec` 有一条 `Object.keys(S)` 完整性断言，放进去直接红）：

```ts
/**
 * 从锁 scope 里抠出期。scope 一律 `模块:限定:期` 冒号分段(见本文件头注释):
 *   billing-chain:2025-06 → '2025-06'   meters:2025 → '2025'
 *   ledger:3:2025-06     → '2025-06'   report:is:1:2025-06 → '2025-06'
 *   book-template:ledger:7:2025-06 → '2025-06'   无期 → null
 * ⚠ sched:s10 一个前缀两种粒度(月锁 …:2025-06 与年锁 …:2025 并存,S.s10 / S.s10Year),
 *   这里**照实返回**,不把年补成月 —— periodLink 的 p 本就允许只有年(nav/deepLink.ts)。
 */
export function scopePeriod(scope: string | null | undefined): string | null {
  if (!scope) return null
  const last = scope.slice(scope.lastIndexOf(':') + 1)
  return /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(last) ? last : null
}

/**
 * 反查这把锁属于哪一屏。边界规则与 presence.editorsUnder 逐字同形(=== p 或 p+':' 或 p+'-' 开头)。
 * ⚠ 一把锁可命中多个 nav —— `billing-chain` 底下有 params / alloc / alloc-loss / bill-notices 四屏,
 *   它们共用一把月锁(spec §3.3)。裁定:**取 NAV_SCOPE_PREFIX 声明序的第一个**,
 *   这样「谁在编辑」的 chip 有一个稳定去处,而不是随 Object.keys 顺序漂。
 */
export function navOfScope(scope: string | null | undefined): string | null {
  if (!scope) return null
  for (const [nav, pre] of Object.entries(NAV_SCOPE_PREFIX)) {
    const ps = Array.isArray(pre) ? pre : [pre]
    if (ps.some(p => scope === p || scope.startsWith(p + ':') || scope.startsWith(p + '-'))) return nav
  }
  return null
}
```

同时给 `NAV_SCOPE_PREFIX`（`:105-129`）补一行 `'alloc-loss': 'billing-chain',`，位置紧挨 `alloc`。**注释写清** `reconciliation` / `import` 为什么不补（这两屏没有编辑锁，补了等于给一个永远不亮的键）。

⚠ 补键之后 `lockScopes.spec.ts:94-97` 四条 SAMPLES 的 `navs` 各加 `'alloc-loss'` —— **这是补键的必然结果，已在 Global Constraints 的「既有断言的改动清单」第 1 条登记**，不是遮红。改完 `:133-147` 那条反向护栏必须仍然绿。

- [ ] **Step 4: 实现 —— `editingHere` 上提**

`SidebarNav.vue:147-164` 的局部函数整体搬进 `stores/presence.ts` 成：

```ts
/**
 * 这个导航项底下有没有人在编辑 —— 有则返回提示文案,无则 null。
 * 自 P2 起上提到 store:侧栏的点、清单行、主管条 chips 三处共用同一份文案,
 * 否则同一件事三份实现会各自漂(P3 的 holdsEditUnder / editorsUnder 就差点漂开)。
 * **只标编辑态**(设计稿 §04):标记要回答的只有「我点进去改得了吗」,别人在看不挡你。
 */
function editingNote(navValue: string): string | null { … }
```

搬运时**逐字保留**原实现的边界规则与文案拼法，只把 `presence.` 前缀去掉（它现在在 store 里）。文案按 §3.3 加期：`${姓名} 正在编辑 · ${scopePeriod(sc)} · ${scopeNote(sc)}`，三段有几段写几段（与页签标题同一条口径）。

`SidebarNav.vue` 改调 `presence.editingNote(...)`，三个调用点 `:198` / `:200` / `:224` 同改，本地那份删掉。

- [ ] **Step 5: 实现 —— 在场点的可访问性**

`SidebarNav.vue:198-207` 那个 6px 橙点（`h("span", { style: { position: "absolute", … } })`）补 `role: "img"`、`"aria-label": note`、`tabindex: 0`，并接 `ds/Popover`（点按 / Enter 打开，capture mousedown 点外关 —— 照 UI-OVERLAY-SPEC 的既有写法）。

⚠ **`title` 不许删**：`sidebarLockNote.spec` 现有 3 条全用 `span[title*=...]` 选择器，删了三条一起红。`title` 与 `aria-label` **并存**（同一句文案挂两个属性，代价是重复一份，换旧护栏零改动）。
⚠ 本组件是纯 `h()` 渲染函数（`grep -c "<template>"` = 0），**零位移门禁对它整份免疫**（那份 spec 找不到 `<template>` 就整份跳过）。所以这几条只能靠挂载测守，写用例时别指望门禁兜底。

- [ ] **Step 6: 跑测试**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run src/utils/lockScopes.spec.ts src/components/ds/__tests__/sidebarLockNote.spec.ts src/stores/__tests__/presence.spec.ts
npx vitest run 2>&1 | tail -3
npm run typecheck
```

期望：三份全绿；全量在基线 2331 之上只多你新加的 5 条；tsc 零错。**若 `navHeight.spec` 红了 —— 停下报告**（在场点是 absolute 的 6px 点，不该占行高）。

- [ ] **Step 7: 逐条破坏验证**

| 改坏什么 | 应红的那条 |
|---|---|
| `scopePeriod` 的正则去掉 `(-(0[1-9]\|1[0-2]))?` 的可选段 | 「认全部锁形状」里 `meters:2025 → 2025` 那半条 |
| `navOfScope` 的边界改成裸 `startsWith(p)` | 「反查 nav value」（`utilities13` 会被误判成 `utilities` 底下的） |
| `navOfScope` 改成返回**最后一个**命中而不是第一个 | 「一把锁命中多个时取声明序首个」 |
| `NAV_SCOPE_PREFIX` 的 `alloc-loss` 键删掉 | 反向护栏那条（认领集少一个） |
| 在场点的 `aria-label` 删掉 | 「有 role=img 与 aria-label」 |
| 在场点的 `title` 删掉 | **现有 3 条**（证明并存这条约束是真的） |
| `editingNote` 的文案去掉期那一段 | 「文案带期」 |

- [ ] **Step 8: 提交**

⚠ **另一路 agent 正在同一个工作区改后端 Java**。`git status` 里会看到不属于你的改动，**一个都别碰**；提交时只 `git add` 你自己这几个路径，**不许 `git add -A`**：

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043
git add frontend/src/utils/lockScopes.ts frontend/src/utils/lockScopes.spec.ts \
        frontend/src/stores/presence.ts frontend/src/components/ds/SidebarNav.vue \
        frontend/src/components/ds/__tests__/sidebarLockNote.spec.ts
git commit -m "$(cat <<'EOF'
feat(presence): P2 §3.3 在场点 —— scopePeriod / navOfScope 两个纯函数;editingHere 上提到 store 三处共用;点补 role/aria/Popover

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 主管条

**Files:** `frontend/src/views/data-home/DataHomeView.vue`（新增主管条段）· `DataHomeView.spec.ts` +4

- [ ] **Step 1: 先写失败的测试**

```ts
it('无 lock:takeover 也无 system:view → 整条不渲染', ...)
it('有权限但零待批:条还在,32px 定高,显「暂无待批」—— 不是 v-if 消失', ...)
it('待批 N 条:点开 FPApprovalDrawer', ...)
it('「谁在编辑」chips:姓名 · 屏名 · 期,点按跳到那一屏那一期(navOfScope + scopePeriod)', ...)
```

- [ ] **Step 2–4: 实现 / 破坏验证 / 提交**

**外层不许 `v-if` 数据**（权限判那一层除外）。`noInteractionLayoutShift.spec` 的词表里没有 `approvals`，写成 `v-if="approvals.length"` 门禁**不会红** —— 靠上面那条用例守。chips 的数据来自 `presence.others.filter(u => u.mode === 'edit')`，nav 与期走 `navOfScope(sc)` / `scopePeriod(sc)`。

---

### Task 7: 规范修订 + 收尾门禁

- [ ] **Step 1: 全量门禁（含一次后端 IT）**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run 2>&1 | tail -4 && npm run typecheck && npm run build 2>&1 | tail -2
cd ../backend && ./mvnw.cmd -q test 2>&1 | tail -20
```

后端全量会拉 testcontainers（Windows 冷启动 15+ 分钟），**本期只在这里跑一次**。index 触线即停，不签字上调。

- [ ] **Step 2: 规范修订**

- spec §5.2：补 P2 落地形状（两栏在前端折、后端仍 9 源、计数从行算、年度三行改按月、chips 的 done 口径、年份条取代下拉、locked 是字段不是插槽）。
- **spec §5.2:188 与 §10:323 至今还在教「五步用 `chainStepsOf`」** —— 这是 P2 执行中被评审坐实会复活 P1 假绿的写法，两处都要改成「清单五步读 `overview.chain.steps[i].status`；`chainStepsOf` 只喂矩阵的 4 点」。§10 此前不在修订清单里，补上。
- spec §12 补九条遗留：⓪ 两栏清单取消了 P1 的「未录在前」排序（改按业务时序固定排），`DataHomeView.spec` 那条断言随之删；⓪b `chainStepsOf` 的第一步恒 done，是矩阵 4 点的口径，任何「清单/列表」场景都不许拿它当完成度；① 审核态整条链归 R1，本期审核态列 / 本月锁账恒「—」；② 审批抽屉「页面」行不可跳（提权 DTO 无 nav/期，10 个调用点，推后）；③ 导入中心无「本月导没导」的源；④ `navOfScope` 一把锁命中多个 nav 时取声明序首个；⑤ `sched:s10` 月锁年锁并存，`scopePeriod` 照实返回混粒度。
- `docs/design/BOOK-WORKBENCH-SPEC.md` §7 补第 7 条「清单行点击 = 显式选期，目标门被前置满足」（§8.2 派给本期的那条；第 8 条「已审核的表任何写入口一律拒」归 R1）。

- [ ] **Step 3: 提交**

---

## 自查

- **spec 覆盖**：§5.2 年份条 → T4；两栏清单 → T2+T3；主管条 → T6；公司 / 期区 chips → T1+T3；后端 DTO → T1；§3.3 在场点 → T5；§9 P2 行的三条破坏验证分别落在 T3（源缺显「—」）、T3（chip 带 p/co）、T5（反向护栏 = `lockScopes.spec` 的 `Object.keys(S)` 与 `NAV_SCOPE_PREFIX` 双向断言）。
- **占位符**：无 TBD。三处标了 ⚠ 的是「实施者必须先看实际值再落笔」：`short` 的 Java 关键字规避方式、`SourceData` 挂 companies 还是在组 Item 时挂、后端测试小工厂的既有风格。
- **2026-09-06 单人复查已修**：4 阻断（清单五步用 `chainStepsOf` 会复活 P1 杀掉的假绿且那条用例必假绿 / 补 `alloc-loss` 键必然弄红 `lockScopes.spec` 四条反向护栏 / 「既有断言只改选择器」不成立，五条要动期望值且一条覆盖会消失 / `@Mock` 写法在这份测试里恒 null 且漏 stub 是静默空集不是 NPE）· 2 严重（收入核对拿不到年，必须串行 / 锁角标进 v-else-if 链则永不渲染，用例两种实现都绿）· 3 一般建议（`short` 的唯一写法、两处计数直读只点了一处、`lockScopes.spec` 路径）。行号与计数订正：HEAD `27d5f6b`、`DataHomeView.spec` 25 条其中 16 条选行、`DataHomeServiceTest` 20 条、`BookMonthMatrix` 渲染段 `:103-108`、`types/dataHome.ts:38-43`。核实为「可以放心做」的：三张年表改按月（列 NOT NULL + IT 不断言 done）、主管条与零位移门禁的两条判断、`BookMonthMatrix` 是独立共享块首页引它不进 index、`BOOK-WORKBENCH-SPEC §7` 现有 6 条补第 7 条编号无冲突。
- **任务间冲突**：T1 与 T2 共享 `DataHomeItemDTO` 的字段名（T1 定义、T2 消费，**顺序不可颠倒**）；T3 与 T4 都改 `DataHomeView.vue` 的模板头部（T3 改清单区 `:206-246`、T4 改头行 `:173-186`，**区间不相交**）；T5 的 `navOfScope` 是 T6 chips 点跳的前置（**T5 必须在 T6 之前**）；T3 先补 `NAV_SCOPE_PREFIX` 的 `alloc-loss` 键（清单行确认要用），T5 再动同文件的其余部分（**同文件不同段，T3 只加一行**）。
- **计数**：本计划不预估最终用例数 —— P3 的经验是评审每期都会补出假绿，预估的数字反而会逼实施者去凑。每个任务只与**上一个任务的实测数**比。
