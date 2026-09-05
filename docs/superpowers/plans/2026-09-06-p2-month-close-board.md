# P2 本月出账屏第二阶段（年份条 / 两栏清单 / 主管条 / 在场点 / 后端数据契约）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「本月出账」从一排胶囊变成一块真正能管月的板子：顶部年份条（复用 `BookMonthMatrix`，4 点 + 锁角标）取代现在那个月份下拉；中间两栏清单（出账 7 行 / 记账 8 行）每行的状态**由数据派生**不可手勾，前置未满显 padlock，源缺显「—」；台账带公司 chips、附10 带期区 chips；顶部主管条 32px 定高常驻，写清「待批授权 N」「谁在编辑」。顺带修一个屏上的假绿：附表6 / 附表7·8 / 附表11 现在是「今年有行就算做了」，一月录完十二月看还显对勾。

**Architecture:** 后端 `DataHomeOverviewDTO.Item` 加两个 nullable 组件 `companies` / `phases`（台账按 `company_id` 分组、附10 拆回 slot 1..4，**零新 SQL**），注入第 14 个依赖 `ManagementCompanyMapper` 取公司全集以便显「未录」；三个年度源加一道 `acctMonth` 过滤（与附13/14 既有写法逐字同形）。前端新建纯函数 `views/data-home/monthClose.logic.ts`，把后端的 9 个附表源 + 出账链 5 步 + 收入核对 + 本月锁账折成两栏 15 行的 `CloseRow[]`，屏上的计数一律从**渲染出来的行**算而不是抄 DTO 的 `total`。年份条把 `pickedYm` 的「手选优先」链路从下拉改到矩阵格子。§3.3 在场点：`utils/lockScopes` 加 `scopePeriod` 与 `navOfScope` 两个纯函数，`SidebarNav` 里的局部 `editingHere` 上提成 `presence.editingNote(navValue)`，侧栏 / 清单行 / 主管条三处共用。

**Tech Stack:** Vue 3 `<script setup>` + Pinia + vue-router 4 + Vitest（jsdom）；Spring Boot + MyBatis-Plus + JUnit5 + AssertJ；vue-tsc strict。

**Spec:** `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md` §5.2（年份条 / 两栏清单 / 主管条 / 数据契约 D8）· §3.3（在场点）· §7.1–7.2（审核键与状态机，**本期只做前置不做实现**）· §9 P2 行（破坏验证：六计数任一源缺显「—」；chip 点击带 p/co；反向护栏不红）· §10 · §12。

## Global Constraints

- **审核机制在仓里一行都没有**（五路摸底一致坐实：`review_state` / `review_log` / `GET /api/review` / `ReviewGuard` / `Perm.REVIEW_APPROVE` 全仓 grep 命中 0，`Perm.ALL` 只有 17 项，最新迁移是 `V123`）。而 spec §9 把整个 §7.4 排在 **R1**，即 P2 之后。**裁定**：
  - `Item.companies[] / phases[]` **只发 `done`，不发 `review`**；R1 再补字段，前端按 `undefined` 处理。
  - `monthClose.logic.ts` 的 `rowsOf(...)` **签名收 `review` 入参但本期调用方恒传 `null`**，行右侧审核态列渲染「—」（这正是 spec §5.2「计数源缺显『—』不显 0」的口径）。
  - 「本月锁账」行**在清单里**（§5.2 出账列第 7 行、D20 派生），但本期恒显「—」+ padlock，悬停说「审核机制未上线」。**不许**临时降级成「五步全 done 就算锁账」——那是假绿。
- **后端仍是 9 个附表源，两栏是前端呈现**。`Schedules(done, 9, items)` 里的 9 **不动**，`DataHomeApiIT:54-55` 与 `DataHomeServiceTest:107-108` 的 `hasSize(9)` / `total()==9` **一个字不改**。记账列的 8 行（附13+附14 合一、附7+附8 合一、加导入中心）全部在 `monthClose.logic.ts` 里折。**屏上的计数从渲染的行算**（记账 n/8、出账 n/7），不抄 `schedules.total` —— 这才叫「计数与屏内同源」（§8.1）。
- **三个年度源改按月判**（本期唯一一处会改变用户看到的状态）：`DataHomeService:157-165` 的 `pv.selectByYear(year)` / `charging.selectByScheduleAndYear(7|8, year)` / `elec.selectByYearAndType(year, ...)` 取回来的行**本来就带 `acctMonth`**（`PvRecord:9` / `ChargingRecord:10` / `ElecRecord:10`），加一道 `.filter(r -> acctMonth.equals(r.getAcctMonth()))` 即可，**零新查询零迁移**，写法与 `:151-156` 附13/14 的既有过滤逐字同形。**行为变化**：改前一月录了数据，十二月的首页仍显「已录」；改后按本月判。这是删掉一个假绿，不是回归。`SourceData.yearly` 这个位随之只剩「标签写不写年」的用途，注释要改口径。
- **台账公司全集要能显「未录」**：`monthly_ledger` 那次 `selectList` 已经把该月**全部公司**的行读进内存（`:142-144` 无 company 过滤），所以 `done` 零新查询（`groupingBy(MonthlyLedger::getCompanyId)`）；但公司**短名与全集**在 `management_company`，要注入第 14 个依赖。**裁定**：注入 `ManagementCompanyMapper`，照 `CompanyService.java:61-62` 的既有写法 `selectList(orderByAsc("sort_no").orderByAsc("id"))` 取全集（**不过滤 status**，与既有口径一致）。只有这样「该录 5 家，录了 3 家」才显示得出来。`DataHomeServiceTest:31-32` 的构造器与 `:64-89` 的 `stubAllEmpty()` 必须同步补一条 stub，否则 16 条测试全部 NPE。
- **附10 期区零新 SQL**：`:146-147` 现在就是 `selectBySlot(1..4, acctMonth)` 分四次查再 `concat` 拍平。拆开保留每段 `isEmpty()` 就是 `phases[].done`。期区数固定 4（仓里既有写法 `S10Service.java:135` 硬循环 1..4，无配置表）。
- **不做的三件事，各写一行理由进 §12**：
  1. **审批抽屉「页面」行改 periodLink**（spec §5.2 有这一句）：`Pending` 只有 `page/action/impact` 三个自由文本（`api/approvals.ts:14-26` / `ApprovalDtos.java:20-27`），10 个调用点各自拼字符串，既无 nav value 也无规范化的期。要做得给提权审批 DTO 加两个字段并改 10 个调用点 —— 为一个便利改动安全相邻的提权流程，本期不划算。**推后**。（主管条「谁在编辑」chips 的点跳**照做**，它走前端反查，见下。）
  2. **导入中心行没有「本月导没导」的数据源**：`import` 不在 9 个 source 里，导入日志按天数窗口取、DTO 无账期字段。本行**只做入口**，状态位恒「—」。
  3. **第 18 个权限点 `review:approve`** 与 `V124__review.sql`：属 R1。碰它会连锁 `BookPinApiIT:432` 的 `hasSize(17)`、`RoleApiIT` 的种子断言、`SystemApiIT` 的字典断言，而那几条要跑全量 testcontainers IT（Windows 冷启动 15+ 分钟）。
- **收入核对行的完成度走前端并发取数**：`reconApi.overview(year)` 返回的 `ReconMonthMeta{month,hasData,entityCount,okCount,diffCount,missCount}`，`done = diffCount === 0 && missCount === 0`（与 `ReconView.vue:67` 屏内同源）。**不**给 `DataHomeService` 加 `ReconService` 依赖（跨服务耦合换一次往返，不值）。取数失败该行显「—」，不阻断整屏。
- **`BookMonthMatrix` 没有任何插槽**（全文 `<slot` 零命中）。§5.2 写的「4 点 + 锁角标插槽」按组件既有的扩展惯例落成 **`MonthCell` 的一个字段**：`locked?: boolean`，渲染优先级排在 `pips` 之后（`:102-107` 那段）。**不加具名插槽** —— 那要动 7 个调用点与 4 份快照类断言。
- **年份条取代月份下拉**：`DataHomeView.vue:178-181` 的 `Select` 删掉，`pickedYm` 改由矩阵 `@pick` 回写。年维格子的数据源是 `billingPeriod` 的链数据，首页 `onMounted` 补一句 `void period.loadChain()`（幂等、在途去重，`:99` 注释已说明），行的组法照抄 `ChainMonthGate.vue` 组 `rows` 的那段。**「默认选中 = 出账链最新有数据月」的现锚规则不变**（`curYm` 来自 `ov.period`）。
- **§3.3 的两个纯函数放哪**：`scopePeriod(scope)` 与 `navOfScope(scope)` 都作为**独立 export** 放 `utils/lockScopes.ts`，与 `scopeNote` 并列，**不进 `S` 对象** —— `lockScopes.spec` 有一条 `Object.keys(S)` 完整性断言，放进去会直接红。`navOfScope` 用与 `editorsUnder` 同一条边界规则反查 `NAV_SCOPE_PREFIX`；**一把锁可命中多个 nav**（`billing-chain` 命中 params / alloc / bill-notices 三个），裁定：**取 `NAV_SCOPE_PREFIX` 声明序的第一个**，并在 spec 里钉住这条规则。
- **`sched:s10` 一个前缀两种粒度**（月锁 `sched:s10:1:2025-06` 与年锁 `sched:s10:1:2025` 并存，`lockScopes.ts:76-78` 两个构造器）。裁定：`scopePeriod` **照实返回**（`YYYY-MM` 或 `YYYY`），`periodLink` 的 `p` 本就允许只有年（`deepLink.ts:31-33`）。文案跟着变粒度，不额外规整。
- **`editingHere` 上提**：`SidebarNav.vue:147-164` 的局部函数搬进 `stores/presence.ts` 成 `editingNote(navValue): string | null`，`SidebarNav` 改调它（`:198` / `:200` / `:224` 三个调用点同改）。在场点的属性 **`title` 与 `aria-label` 并存**：`sidebarLockNote.spec` 现有 3 条全用 `span[title*=...]` 选择器，**一条都不许改**；新增的断言钉 `role="img"` / `aria-label` / `tabindex` / Popover 开合。`SidebarNav` 是纯 `h()` 渲染函数（`grep -c "<template>"` = 0），零位移门禁对它整份免疫，所以这几条只能靠挂载测守。
- **`NAV_SCOPE_PREFIX` 补 `'alloc-loss': 'billing-chain'`**（`lockScopes.ts:105-129` 现在缺这个键，与 params / alloc / bill-notices 同锁根，`:110-112` 已是这个写法）。清单化之后 `go()` 的确认判据逐行生效，缺键那行会静默不弹确认。`reconciliation` 与 `import` 确认无编辑锁 → **不补，但要写注释钉住理由**。
- **主管条的形状是硬约束，门禁抓不到**：§5.2 明写「32px 定高常驻，无待批显『暂无』，不 `v-if`」。`noInteractionLayoutShift.spec` 的交互态词表（`:50-51`）里**没有 `approvals`**，所以写成 `v-if="approvals.length"` 也不会红。计划在此钉死：**主管条外层不许有 `v-if`**（权限判 `can('lock:takeover') || can('system:view')` 那一层除外，那是「有没有这个角色」不是「有没有数据」）。
- **两栏清单会真红的写法**（同一份门禁的 `:50-51` 词表）：`v-if="selected"` / `selectedIds` / `dirty` / 任何流内 toast。公司 chips 的展开详情若写成 `<div v-if="selected…">` 当场红。合规写法：常驻容器 + 内层 `<template v-if>`，或 `position: absolute` 的浮层。
- **图标与令牌要先登记**：`components/ds/__tests__/icon.spec.ts:28` 扫全 `src` 的每个 `iconFor('字面量')` 必须在 `icon.ts` 的 MAP 里；构建期 `scripts/token-check.mjs:40-49` 要求每个 `var(--x)` 有定义。padlock / ✓ 锁标 / 橙钟这些新图标名与任何新色令牌，**先登记再用**。
- **首屏包只剩 6.0KB，而且是借来的**（P3 把 `CommandPalette` 改懒加载从 190.8 换到 185.0；`size-check.mjs:44` 的 `index: 191` **不许上调**）。本期进 index 的**只有** `lockScopes.scopePeriod` / `navOfScope` 与 `presence.editingNote` 三个纯函数（这两个文件本来就在 index）。主管条本体、两栏清单、`monthClose.logic.ts`、`BookMonthMatrix` 全部落在 `DataHomeView-*.js` 懒加载块（`router/index.ts` 的 `VIEWS` 表全是 `() => import()`）。**任何新的 shell 层静态 import 一律拒**。触线即停，不签字上调。
- **EOL**：仓库 `core.autocrlf=true`，无 `.gitattributes`。本期要改的文件里 `DataHomeView.vue` / `DataHomeView.spec.ts` / `DataHomeService.java` / `DataHomeOverviewDTO.java` / `presence.ts` / `lockScopes.ts` / `BookMonthMatrix.vue` / `types/dataHome.ts` 全是 **CRLF**，`SidebarNav.vue` / `SidebarPanel.vue` 是 **LF**。判断行尾一律用 `git ls-files --eol`，**别用 `grep $'\r'`**（实测给相反答案）。**禁止整文件重写**（会把行尾翻面，diff 变成全文件红绿）。
- **逐条破坏验证**：每条新断言改坏 production 一处 → **只有对应那条红** → 字符串替换还原，**绝不 `git checkout` / `git stash`**。这一期前面五期的评审累计抓到 13 处「改坏了却没有一条红」的假绿，写每条用例前先自问：**把我要保护的那一行删掉，这条会红吗**。
- 提交信息末尾：`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。前端命令在 `frontend/`，后端在 `backend/`（`./mvnw.cmd`）。**后端只跑 `-Dtest=DataHomeServiceTest,PermissionCoverageTest` 这类单测**，`*IT.java` 走 testcontainers（Windows 冷启动 15+ 分钟），只在收尾任务跑一次。

---

## 文件结构

| 文件 | 责任 |
|---|---|
| `backend/.../dto/DataHomeOverviewDTO.java:31` | `Item` 加 `List<Company> companies` / `List<Phase> phases`（都可 null）+ 两个内嵌 record（T1） |
| `backend/.../service/DataHomeService.java:139-167` | 三个年度源加 `acctMonth` 过滤；台账派生 companies；附10 拆 slot 出 phases；注入 `ManagementCompanyMapper`（T1） |
| `backend/.../service/DataHomeServiceTest.java:31,64-89` | 构造器 + `stubAllEmpty()` 补公司 stub；新增年度按月 / companies / phases 断言（T1） |
| `frontend/src/types/dataHome.ts:38-48` | 契约镜像同步（T1） |
| `frontend/src/views/data-home/monthClose.logic.ts`（新） | `rowsOf(...) → CloseRow[]` / `closeChecks(...)`；9 源折 8 行、出账 7 行、计数从行算（T2） |
| `frontend/src/views/data-home/__tests__/monthClose.logic.spec.ts`（新） | 纯函数单测：折行、padlock、源缺显「—」、年度行按月（T2） |
| `frontend/src/views/data-home/DataHomeView.vue:128-250` | 两栏清单取代胶囊行；收入核对并发取数；`go()` 逐行确认（T3） |
| `frontend/src/views/data-home/DataHomeView.spec.ts` | 既有 29 条按新版式改选择器（**只改选择器不改断言意图**），新增两栏 / chips / 「—」用例（T3） |
| `frontend/src/components/fp/BookMonthMatrix.vue:13-31, 102-107` | `MonthCell` 加 `locked?: boolean` + 渲染（T4） |
| `frontend/src/views/data-home/DataHomeView.vue:173-186` | 年份条取代 `Select`；`onMounted` 补 `loadChain`（T4） |
| `frontend/src/utils/lockScopes.ts` | 新增 `scopePeriod` / `navOfScope` 两个独立 export + `NAV_SCOPE_PREFIX` 补 `alloc-loss`（T5） |
| `frontend/src/stores/presence.ts` | 新增 `editingNote(navValue)`（从 SidebarNav 上提）（T5） |
| `frontend/src/components/ds/SidebarNav.vue:147-164, 198-207` | 改调 `presence.editingNote`；在场点补 `role="img"` / `aria-label` / `tabindex` / Popover（T5） |
| `frontend/src/utils/__tests__/lockScopes.spec.ts` · `components/ds/__tests__/sidebarLockNote.spec.ts` | +1 / +3（T5） |
| `frontend/src/views/data-home/DataHomeView.vue`（主管条段） | 32px 定高常驻；待批授权 N + 谁在编辑 chips（点跳走 `navOfScope`）（T6） |
| `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md` §5.2 / §12 · `docs/design/BOOK-WORKBENCH-SPEC.md` §7 | 规范随裁定（T7） |

---

### Task 0: 基线

- [ ] **Step 1: 记下起点**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043
git rev-parse --short HEAD && git status --short
```

期望：HEAD = `b9473da`（P3 合并后），工作区干净。

- [ ] **Step 2: 三道门禁的基线数字**

```bash
cd C:/financial_dashboard/demo3/.claude/worktrees/model-12d043/frontend
npx vitest run 2>&1 | tail -4
npx vue-tsc --noEmit
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
  public record Company(int id, String short_, boolean done) {}        // JSON 键必须是 "short"
  public record Phase(int no, boolean done) {}
  ```
  ⚠ `short` 是 Java 关键字。record 组件不能叫 `short`，用 `@JsonProperty("short")` 把 `shortName` 映射过去，或组件名取 `shortName` 并在前端类型里写 `shortName`。**实施者二选一，但必须与 `frontend/src/types/dataHome.ts` 和 T2 的 `monthClose.logic.ts` 三处一致**，并在报告里写明选了哪个。

- [ ] **Step 1: 先写失败的测试**

`DataHomeServiceTest.java` 追加三条（现有 20 条一行不动）：

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

⚠ `pvRow` / `company` / `ledgerRow` / `s10Row` / `itemOf` 四个小工厂按本文件既有风格自己加（现有工厂在 `:42-43` 一带）。`companies` 是新 mapper 的 `@Mock` 字段，要加在类顶部。

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
cd ../frontend && npx vue-tsc --noEmit && npx vitest run 2>&1 | tail -3
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
- Consumes：`DataHomeOverviewDTO`（T1 扩过）、`chainStepsOf(cell)`（`nav/billingChain.ts:29-38`，只出 `{value,label,state}`）、`ReconMonthMeta`（T3 传入，本任务允许为 null）。
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
  `RowsInput = { overview, cell, recon, review }`，其中 `review` 本期恒 `null`。

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
it('链五步的状态用 chainStepsOf(与矩阵/期间条同函数),detail 文案取 overview.chain.steps 按 key 对齐', ...)
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
| 链五步改成直接读 `overview.chain.steps[i].status` | 「链五步的状态用 chainStepsOf」 |

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
- Modify: `frontend/src/utils/lockScopes.ts`（补 `alloc-loss` 键，T5 的其余部分不在本任务）

- [ ] **Step 1: 先改既有测试的选择器（不改断言意图）**

现有 29 条里有 12 条用 `.dh-step` / `.dh-item` 选行。新版式两栏后类名会变，**只改选择器，断言一个字不动**，并在每条改动处加一句注释说明「版式从胶囊行改两栏，选择器随之」。**任何一条断言的期望值被改了都要停下报告** —— 那不是版式迁移，是遮红。

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

- [ ] **Step 3: 实现**

两栏用 CSS Grid 两列（1366×620 内视口下内容区 ≈1027×502，行 38px，两栏各 7–8 行一屏装下）。**行是常驻的**，状态点用 `data-state` 属性驱动样式，不要 `v-if` 切换整行。chips 的展开详情若要浮层，一律 `position: absolute`（零位移门禁 `:50-51` 的词表里 `selected` 会红）。

收入核对：`onMounted` 里与 `dataHomeApi.getOverview()` **并发**发 `reconApi.overview(year)`，失败 `.catch(() => null)` 落成 `recon = null`。

- [ ] **Step 4: 全量 + 破坏验证 + 提交**

期望：前端全量绿（既有 2331 + 本任务新增）；`npx vue-tsc --noEmit` 零错。破坏项至少四条，逐条只红对应的那条。

---

### Task 4: 年份条取代月份下拉

**Files:**
- Modify: `frontend/src/components/fp/BookMonthMatrix.vue:13-31, 102-107`（`MonthCell` 加 `locked?: boolean`）
- Modify: `frontend/src/views/data-home/DataHomeView.vue:173-186`（删 `Select`，挂矩阵，`onMounted` 补 `loadChain`）
- Test: `DataHomeView.spec.ts` +3；`components/fp/__tests__/` 下 BookMonthMatrix 的既有测 +1

- [ ] **Step 1: 先写失败的测试**

```ts
it('年份条取代月份下拉:屏上没有 Select,点格子换月', ...)
it('默认选中 = 出账链最新有数据月(现锚规则不变)', ...)
it('全月已审核的格子带锁角标 —— 本期审核未上线,该位恒不亮', ...)   // 钉住 locked 字段接上了
it('BookMonthMatrix:locked 为 true 时渲染锁角标,渲染优先级在 pips 之后', ...)
```

- [ ] **Step 2–4: 实现 / 破坏验证 / 提交**

`locked` 字段照 `pips`（`:23`）/ `badge`（`:28`）的既有风格加，**不加具名插槽**（那要动 7 个调用点与 4 份快照类断言）。首页 `onMounted` 补 `void period.loadChain().catch(() => {})`，行的组法照抄 `ChainMonthGate.vue` 组 `rows` 那段。`pickedYm` 改由矩阵 `@pick` 回写，`:79` 的「手选优先」链路保持。

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

- [ ] **Step 2–4: 实现 / 破坏验证 / 提交**

`scopePeriod` / `navOfScope` 是**独立 export**，与 `scopeNote` 并列，**不进 `S` 对象**（`lockScopes.spec` 有 `Object.keys(S)` 完整性断言）。`navOfScope` 的边界规则与 `editorsUnder` 逐字同形。`editingHere` 整体搬进 `presence.editingNote(navValue)`，`SidebarNav` 的三个调用点（`:198` / `:200` / `:224`）同改。在场点 **`title` 与 `aria-label` 并存** —— 现有 3 条断言用 `span[title*=]`，一条都不许改。

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
npx vitest run 2>&1 | tail -4 && npx vue-tsc --noEmit && npm run build 2>&1 | tail -2
cd ../backend && ./mvnw.cmd -q test 2>&1 | tail -20
```

后端全量会拉 testcontainers（Windows 冷启动 15+ 分钟），**本期只在这里跑一次**。index 触线即停，不签字上调。

- [ ] **Step 2: 规范修订**

- spec §5.2：补 P2 落地形状（两栏在前端折、后端仍 9 源、计数从行算、年度三行改按月、chips 的 done 口径、年份条取代下拉、locked 是字段不是插槽）。
- spec §12 补五条遗留：① 审核态整条链归 R1，本期审核态列 / 本月锁账恒「—」；② 审批抽屉「页面」行不可跳（提权 DTO 无 nav/期，10 个调用点，推后）；③ 导入中心无「本月导没导」的源；④ `navOfScope` 一把锁命中多个 nav 时取声明序首个；⑤ `sched:s10` 月锁年锁并存，`scopePeriod` 照实返回混粒度。
- `docs/design/BOOK-WORKBENCH-SPEC.md` §7 补第 7 条「清单行点击 = 显式选期，目标门被前置满足」（§8.2 派给本期的那条；第 8 条「已审核的表任何写入口一律拒」归 R1）。

- [ ] **Step 3: 提交**

---

## 自查

- **spec 覆盖**：§5.2 年份条 → T4；两栏清单 → T2+T3；主管条 → T6；公司 / 期区 chips → T1+T3；后端 DTO → T1；§3.3 在场点 → T5；§9 P2 行的三条破坏验证分别落在 T3（源缺显「—」）、T3（chip 带 p/co）、T5（反向护栏 = `lockScopes.spec` 的 `Object.keys(S)` 与 `NAV_SCOPE_PREFIX` 双向断言）。
- **占位符**：无 TBD。三处标了 ⚠ 的是「实施者必须先看实际值再落笔」：`short` 的 Java 关键字规避方式、`SourceData` 挂 companies 还是在组 Item 时挂、后端测试小工厂的既有风格。
- **任务间冲突**：T1 与 T2 共享 `DataHomeItemDTO` 的字段名（T1 定义、T2 消费，**顺序不可颠倒**）；T3 与 T4 都改 `DataHomeView.vue` 的模板头部（T3 改清单区 `:206-246`、T4 改头行 `:173-186`，**区间不相交**）；T5 的 `navOfScope` 是 T6 chips 点跳的前置（**T5 必须在 T6 之前**）；T3 先补 `NAV_SCOPE_PREFIX` 的 `alloc-loss` 键（清单行确认要用），T5 再动同文件的其余部分（**同文件不同段，T3 只加一行**）。
- **计数**：本计划不预估最终用例数 —— P3 的经验是评审每期都会补出假绿，预估的数字反而会逼实施者去凑。每个任务只与**上一个任务的实测数**比。
