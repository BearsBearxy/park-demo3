# P1 · 「本月出账」首页改名 + 出账链 5 步 + 行点击带月 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 数据中心首页改名「本月出账」，出账链流水线从 4 步补成 5 步（第 1 步「计费参数」以电价录齐为判据），首页行点击把当前月带进出账链五屏与收入核对，不再落回选期矩阵。

**Architecture:** 零新屏、零新端点。后端 `DataHomeService.buildChain` 多收两个整数（`priceOk/priceTotal`，来自已经在调的 `paramService.status(ym)`），头插一步；前端 `DataHomeView.go()` 在跳链屏前先写 `billingPeriod` store（五屏共读，目标屏的 `ChainMonthGate` 因 `period.picked` 为真而不渲染），跳收入核对带 `?y&m`；`fpNav.ts` 只改 label/icon。侧栏点击语义（P3）、期间深链协议（P0）、清单版式（P2）本期一概不碰。

**Tech Stack:** Spring Boot 3 / Java 17 / Mockito（`DataHomeServiceTest` 是纯 Mockito 单测，不需 Docker）· Vue 3 `<script setup>` / Pinia / Vitest + @vue/test-utils · Maven wrapper `backend/mvnw.cmd`。

**Spec:** `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md` §5.1（P1 范围）、§4.1（首页行语义）、§9 P1 行（破坏验证）、§0.2 D2 / D12。

## Global Constraints

- 出账链五屏的期**只记会话内**：不写 localStorage、不进 URL（spec D3；`stores/billingPeriod.ts:13`）。本期只调用现有 `period.pick(y, m)`，**不改 `adoptYm` 的语义**（`billingPeriod.spec.ts:84-88` 原样）。
- 首页行点击仍走 `tabsStore.openFresh(v)`（spec 2026-07-07 §二 的现状；翻案是 P3 的事）。
- 第 1 步「计费参数」done = `priceTotal > 0 && priceOk == priceTotal`，**禁止**用 `ParamStatusDTO.stale` 当判据（spec §5.1）。`stale` 继续只喂 `buildBlockers`。
- 矩阵格子仍 4 颗点（`nav/billingChain.ts:40-45` 的 `pipsOf` 不动）；链路条 `chainStepsOf` 不动。三处口径差写在 `DataHomeService.buildChain` 注释里。
- 零布局位移：骨架步数与真版式必须同为 5（`DataHomeView.spec.ts` 「首载骨架」两条钉住）。
- 计数与屏内同源：`priceOk/priceTotal` 取自 `ParamService.status` 同一 DTO，不另算。
- 每条新断言写完先**破坏验证**：改坏 production → 只有对应那条转红 → 还原（用字符串替换，绝不 `git checkout`）。
- 提交信息中文，格式 `feat(data-home): …`，末尾 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。

---

## File Structure

| 文件 | 责任 | 本期动作 |
|---|---|---|
| `backend/src/main/java/com/park/demo3/service/DataHomeService.java` | 首页只读聚合 | `buildChain` 4 → 5 步；两处调用改传 `ps.priceOk()/priceTotal()` |
| `backend/src/main/java/com/park/demo3/dto/DataHomeOverviewDTO.java` | 契约 | 只改注释「4 步」→「5 步」 |
| `backend/src/test/java/com/park/demo3/service/DataHomeServiceTest.java` | 单测 | 6 处 `buildChain` 调用改 8 参；断言下标 +1；新增 3 条参数步测试 |
| `backend/src/test/java/com/park/demo3/api/DataHomeApiIT.java` | 集成测试（CI 跑） | `hasSize(4)` → `5` |
| `frontend/src/types/dataHome.ts` | 前端契约 | 注释「4 步」→「5 步」 |
| `frontend/src/views/data-home/DataHomeView.vue` | 首页 | 标题「本月出账」；`/5`；骨架 5；`go()` 带月 |
| `frontend/src/views/data-home/DataHomeView.spec.ts` | 首页测试 | fixture 5 步；`恒 4 步` → 5；+4 条行点击测试 |
| `frontend/src/nav/fpNav.ts` | 导航唯一事实源 | `data-home` label `本月出账`、icon `calendar-check` |
| `frontend/src/nav/__tests__/fpNav.spec.ts` | 导航测试 | +1 断言 |
| `frontend/src/components/shell/mobile/mobileNavDrawer.spec.ts` | 抽屉测试 | mock 文案同步 |
| `docs/superpowers/specs/2026-08-18-data-home-redesign-design.md` | 首页原 spec | §2.1 加修订记录 |

---

### Task 0: 工作区准备与基线

**Files:**
- 无代码改动。

**Interfaces:**
- Produces: 本 worktree 能跑 vitest 与 `DataHomeServiceTest`。

- [ ] **Step 1: 给 worktree 挂 node_modules（gitignore 内，安全）**

worktree `frontend/node_modules` 不存在，主 checkout 有。建目录联接（PowerShell）：

```powershell
New-Item -ItemType Junction -Path "C:\financial_dashboard\demo3\.claude\worktrees\model-12d043\frontend\node_modules" -Target "C:\financial_dashboard\demo3\frontend\node_modules"
```

已存在则跳过。`git status --short` 必须**不**出现 `frontend/node_modules`（`.gitignore:12` 已忽略）。

- [ ] **Step 2: 前端基线**

Run（在 `frontend/` 下）：

```bash
npx vitest run src/views/data-home src/nav src/components/shell/mobile
```

Expected: 全绿。记下用例数（当前 `DataHomeView.spec` 10 条、`fpNav.spec` 3 条、`navAccess.spec` 4 条、`mobileNavDrawer.spec` 若干）。

- [ ] **Step 3: 后端基线（纯 Mockito 单测，不需 Docker）**

Run（在 `backend/` 下）：

```bash
./mvnw.cmd -q -Dtest=DataHomeServiceTest -DfailIfNoTests=false test
```

Expected: `BUILD SUCCESS`，`Tests run: 15`（12 条 + 3 条 blockers）。若 Maven 首次下载依赖，允许耗时。

---

### Task 1: 后端 `buildChain` 4 → 5 步（TDD）

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/service/DataHomeService.java:62-70`（空库分支）、`:88`（`paramStale`）、`:108`（正常分支调用）、`:222-259`（`buildChain`）
- Modify: `backend/src/main/java/com/park/demo3/dto/DataHomeOverviewDTO.java:21`（注释）
- Modify: `backend/src/test/java/com/park/demo3/service/DataHomeServiceTest.java:148-183`
- Modify: `backend/src/test/java/com/park/demo3/api/DataHomeApiIT.java:51`

**Interfaces:**
- Produces: `static DataHomeOverviewDTO.Chain buildChain(int priceOk, int priceTotal, long readingCount, boolean poolGenerated, boolean lossGenerated, int noticeCount, BigDecimal noticeTotal, int noticeWarn)`；`steps` 顺序固定 `params, meters, alloc, alloc-loss, bill-notices`；`Step.key == Step.go`。
- Consumes: `ParamStatusDTO.priceOk() / priceTotal()`（`backend/src/main/java/com/park/demo3/dto/ParamStatusDTO.java`）。

- [ ] **Step 1: 改现有 6 处调用与断言，新增 3 条参数步测试（先红）**

把 `DataHomeServiceTest.java:148-183` 的五个出账链测试替换为：

```java
    @Test void 出账链_当前步是第一个非done() {
        var chain = DataHomeService.buildChain(6, 6, 1088, true, true, 0, java.math.BigDecimal.ZERO, 0);
        assertThat(chain.currentIndex()).isEqualTo(4);
        assertThat(chain.steps()).extracting(DataHomeOverviewDTO.Step::status)
            .containsExactly("done", "done", "done", "done", "current");
        assertThat(chain.steps()).extracting(DataHomeOverviewDTO.Step::key)
            .containsExactly("params", "meters", "alloc", "alloc-loss", "bill-notices");
    }

    @Test void 出账链_催缴单detail报张数不报户数() {
        // bill_notice 一租户可有多行(按收款公司/单据类型拆单);而催缴单屏的「户数」是
        // aggregateByTenant 聚合后、且只算当前期别 tab(默认一期)的数。两者根本不是一个口径,
        // 首页报「张」= 唯一且不会与屏上户数打架(METRIC-SOURCE-SPEC §2)。
        var chain = DataHomeService.buildChain(6, 6, 1, true, true, 295, new java.math.BigDecimal("4107986.54"), 183);
        assertThat(chain.steps().get(4).detail())
            .isEqualTo("295 张 · ¥4107986.54 · 183 张有警告").doesNotContain("户");
    }

    @Test void 出账链_全部完成时currentIndex为负1() {
        var chain = DataHomeService.buildChain(6, 6, 1088, true, true, 102, new java.math.BigDecimal("2474138.88"), 66);
        assertThat(chain.currentIndex()).isEqualTo(-1);
        assertThat(chain.steps()).allMatch(s -> "done".equals(s.status()));
    }

    @Test void 出账链_空月第一步为current其余todo() {
        var chain = DataHomeService.buildChain(0, 6, 0, false, false, 0, java.math.BigDecimal.ZERO, 0);
        assertThat(chain.currentIndex()).isZero();
        assertThat(chain.steps()).extracting(DataHomeOverviewDTO.Step::status)
            .containsExactly("current", "todo", "todo", "todo", "todo");
    }

    @Test void 出账链_抄表detail只给已抄数不给分母() {
        // 92/94 那个比例是 MeterView 前端 cardCounts() 在电水+分区筛选链上算的,
        // 后端另算一份分母必然与之漂移 —— METRIC-SOURCE-SPEC §1 禁止同一判定两份实现。
        // 首页只回答「这步做没做、做了多少」,比例留在抄表屏(它才有完整筛选口径)。
        var chain = DataHomeService.buildChain(6, 6, 1088, false, false, 0, java.math.BigDecimal.ZERO, 0);
        assertThat(chain.steps().get(1).detail()).isEqualTo("已抄 1088 块").doesNotContain("/");
    }

    // ── 第 1 步「计费参数」(SIDEBAR-UX-REDESIGN §5.1):判据是电价录齐,不是 stale ──
    @Test void 参数步_电价录齐才done() {
        var chain = DataHomeService.buildChain(6, 6, 0, false, false, 0, java.math.BigDecimal.ZERO, 0);
        assertThat(chain.steps().get(0).status()).isEqualTo("done");
        assertThat(chain.steps().get(0).detail()).isEqualTo("本月电价 6/6 已录");
        assertThat(chain.currentIndex()).isEqualTo(1);
    }

    @Test void 参数步_少一键就是current且detail报进度() {
        var chain = DataHomeService.buildChain(5, 6, 1088, true, true, 102, java.math.BigDecimal.ZERO, 0);
        assertThat(chain.steps().get(0).status()).isEqualTo("current");
        assertThat(chain.steps().get(0).detail()).isEqualTo("本月电价 5/6 已录");
        assertThat(chain.currentIndex()).isZero();
    }

    @Test void 参数步_没有电价键的月不算done且detail未配置() {
        // 全新库分支传 (0, 0):priceTotal 为 0 时 0 == 0 不能算 done —— 那是「没配」不是「配齐」
        var chain = DataHomeService.buildChain(0, 0, 0, false, false, 0, java.math.BigDecimal.ZERO, 0);
        assertThat(chain.steps().get(0).status()).isEqualTo("current");
        assertThat(chain.steps().get(0).detail()).isEqualTo("未配置");
    }
```

`全新库_period为null且不炸`（:117-127）里 `assertThat(o.chain().currentIndex()).isZero()` 不用改（空库第 1 步就是 current）。

- [ ] **Step 2: 跑测试确认编译失败**

Run（`backend/`）：

```bash
./mvnw.cmd -q -Dtest=DataHomeServiceTest -DfailIfNoTests=false test
```

Expected: `COMPILATION ERROR … method buildChain … cannot be applied to given types`。

- [ ] **Step 3: 改 `buildChain` 与两处调用**

`DataHomeService.java` 顶部 import 补一行（若已有则跳过）：

```java
import com.park.demo3.dto.ParamStatusDTO;
```

`:66-69` 空库分支改为：

```java
        if (ym == null) {   // 全新库:一条数据都没有,前端出「还没开始出账」引导
            return new DataHomeOverviewDTO(null, months, List.of(),
                buildChain(0, 0, 0, false, false, 0, BigDecimal.ZERO, 0),
                new DataHomeOverviewDTO.Schedules(0, 9, List.of()));
        }
```

`:88` 一行改为两行（`status` 只调一次，两个消费者共用同一个 DTO —— 计数与屏内同源）：

```java
        ParamStatusDTO ps = paramService.status(ym);
        boolean paramStale = ps.stale();
```

`:108` 调用改为：

```java
            buildChain(ps.priceOk(), ps.priceTotal(), readings, pool, loss, notices.size(), noticeTotal, noticeWarn),
```

`:222-259` 整段替换为：

```java
    // ══ 出账链 5 步(SIDEBAR-UX-REDESIGN §5.1;2026-09-03 由 4 步补成 5 步) ═════════════════════
    // 合同仍不进流水线(「待补档案」是全局档案缺口,不按月),留在 buildBlockers。
    // 计费参数进了:判据是**本月电价键录齐**,这是专员每月第一道工序的可回答问题。

    /** 出账链 5 步。当前步 = 第一个非 done;全 done → currentIndex=-1,前端把大卡换成「去对账核对」。
     *  ⚠ 第 1 步不用 ParamStatusDTO.stale 当判据:stale 是「改参晚于快照,需重算」,月初池/催缴单都还没
     *    生成时恒 false —— 拿它当 done,第 1 步会在最需要它的时候假绿。stale 继续只喂 buildBlockers。
     *  ⚠ 三处「参数」口径各答各的问题,不是 bug:链路条 chainStepsOf 画「参数与快照一致」(stale 驱动),
     *    这里画「电价录齐」(priceOk),矩阵格子 pipsOf 仍 4 颗点不含参数。
     *  ⚠ 催缴单 detail 给「N 张」不是「N 户」:bill_notice 一租户可有多行(按收款公司/单据类型拆单),
     *    而催缴单屏的「户数」是 aggregateByTenant 聚合后、且只算当前期别 tab 的数。首页要的是整月全期口径,
     *    屏上压根没有这个数 —— 与其重算一份聚合(METRIC-SOURCE-SPEC §1 禁止同一判定两份实现),
     *    不如老实报单据张数:口径唯一、不会和屏上的户数打架。
     *  ⚠ 抄表 detail 只给「已抄 N 块」不给分母:92/94 那个比例是 MeterView 前端 cardCounts()
     *    在电水+分区筛选链上算的,后端另算一份分母必然与之漂移(METRIC-SOURCE-SPEC §1)。 */
    static DataHomeOverviewDTO.Chain buildChain(int priceOk, int priceTotal,
                                                long readingCount, boolean poolGenerated, boolean lossGenerated,
                                                int noticeCount, BigDecimal noticeTotal, int noticeWarn) {
        boolean paramsDone = priceTotal > 0 && priceOk == priceTotal;
        boolean[] done   = { paramsDone, readingCount > 0, poolGenerated, lossGenerated, noticeCount > 0 };
        String[]  keys   = { "params", "meters", "alloc", "alloc-loss", "bill-notices" };
        String[]  labels = { "计费参数", "园区抄表", "公共电核算", "楼栋损耗", "催缴单" };
        String[]  details = {
            priceTotal > 0 ? "本月电价 " + priceOk + "/" + priceTotal + " 已录" : "未配置",
            readingCount > 0 ? "已抄 " + readingCount + " 块" : "未抄表",
            poolGenerated ? "" : "未生成",
            lossGenerated ? "" : "未生成",
            noticeCount > 0
                ? noticeCount + " 张 · ¥" + noticeTotal.setScale(2, RoundingMode.HALF_UP).toPlainString()
                  + (noticeWarn > 0 ? " · " + noticeWarn + " 张有警告" : "")
                : "未生成",
        };
        int current = -1;
        for (int i = 0; i < done.length; i++) if (!done[i]) { current = i; break; }

        List<DataHomeOverviewDTO.Step> steps = new ArrayList<>(done.length);
        for (int i = 0; i < done.length; i++) {
            String status = done[i] ? "done" : (i == current ? "current" : "todo");
            steps.add(new DataHomeOverviewDTO.Step(keys[i], labels[i], status, details[i], keys[i]));
        }
        return new DataHomeOverviewDTO.Chain(current, steps);
    }
```

`DataHomeOverviewDTO.java:21` 注释 `currentIndex=-1 表示 4 步全部完成` 改为 `5 步全部完成`。

- [ ] **Step 4: 跑单测确认全绿**

Run（`backend/`）：

```bash
./mvnw.cmd -q -Dtest=DataHomeServiceTest -DfailIfNoTests=false test
```

Expected: `Tests run: 18, Failures: 0`。

- [ ] **Step 5: 破坏验证（逐条）**

用字符串替换把 `boolean paramsDone = priceTotal > 0 && priceOk == priceTotal;` 临时改为 `boolean paramsDone = priceOk == priceTotal;`，重跑：**只有** `参数步_没有电价键的月不算done且detail未配置` 应红。还原。
再把它临时改为 `boolean paramsDone = priceOk > 0;`，重跑：**只有** `参数步_少一键就是current且detail报进度` 应红。还原。
两次都确认后再往下。

- [ ] **Step 6: 同步集成测试与文档**

`DataHomeApiIT.java:51`：

```java
        assertThat((List<?>) JsonPath.read(body, "$.data.chain.steps")).hasSize(5);
```

方法名 `overview_出账链四步的状态取值受限`（:58）改为 `overview_出账链五步的状态取值受限`。IT 需 Testcontainers，本机不跑，CI `./mvnw -B verify` 跑（`.github/workflows/ci.yml:24`）。

`docs/superpowers/specs/2026-08-18-data-home-redesign-design.md` §2.1 标题下追加一段：

```markdown
> **2026-09-03 修订**（SIDEBAR-UX-REDESIGN §5.1）：出账链改画 **5 步**，头插「计费参数」，
> done = `priceOk == priceTotal`（本月电价键录齐），detail「本月电价 n/6 已录」。
> 不用 `stale` 当判据（月初恒 false 会假绿）；`stale` 仍只做 `param-stale` 前置条。
> 矩阵 4 颗点不变。下文「4 步」按此理解。
```

- [ ] **Step 7: 提交**

```bash
git add backend/src/main/java/com/park/demo3/service/DataHomeService.java backend/src/main/java/com/park/demo3/dto/DataHomeOverviewDTO.java backend/src/test/java/com/park/demo3/service/DataHomeServiceTest.java backend/src/test/java/com/park/demo3/api/DataHomeApiIT.java docs/superpowers/specs/2026-08-18-data-home-redesign-design.md
git commit -m "feat(data-home): 出账链 4 步补成 5 步 —— 计费参数以电价录齐为判据，不吃 stale

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 前端契约、骨架与标题（TDD）

**Files:**
- Modify: `frontend/src/types/dataHome.ts:35`（注释）
- Modify: `frontend/src/views/data-home/DataHomeView.vue:71,79,108,116`
- Modify: `frontend/src/views/data-home/DataHomeView.spec.ts:20-30,71-90,140-152`

**Interfaces:**
- Consumes: Task 1 的 5 步契约（`steps[0].key === 'params'`）。
- Produces: 首页文案「本月出账」、`出账 n/5`、骨架 5 步；spec fixture `STEPS_4DONE / STEPS_ALLDONE`（供 Task 3 复用）。

- [ ] **Step 1: 改 spec fixture 与断言（先红）**

`DataHomeView.spec.ts:20-30` 的 fixture 替换为：

```ts
const STEPS_4DONE: DataHomeStepDTO[] = [
  step('params', '计费参数', 'done', '本月电价 6/6 已录'),
  step('meters', '园区抄表', 'done', '已抄 1088 块'),
  step('alloc', '公共电核算', 'done'),
  step('alloc-loss', '楼栋损耗', 'done'),
  step('bill-notices', '催缴单', 'current', '未生成'),
]
const STEPS_ALLDONE: DataHomeStepDTO[] = STEPS_4DONE.map((s, i) =>
  i === 4 ? step('bill-notices', '催缴单', 'done', '102 户 · ¥2474138.88 · 66 户带警告') : s)
```

`overview()` 里 `chain: { currentIndex: 3, steps: STEPS_3DONE }` → `chain: { currentIndex: 4, steps: STEPS_4DONE }`；
`当前步出大卡` 用例里同样 `currentIndex: 4, steps: STEPS_4DONE`；
用例名 `4 步全 done 时大卡换成去对账` → `5 步全 done 时大卡换成去对账`。

「首载骨架」用例（:140-152）四处改：

```ts
    expect(w.findAll('.dh-step').length, '出账链恒 5 步').toBe(5)
    …
    expect(w.text()).toContain('本月出账')
    …
    expect(w.findAll('.dh-step').length, '真版式也是 5 步 —— 对不上就会跳').toBe(5)
```

（第二处 `'本月工作'` → `'本月出账'`。）

- [ ] **Step 2: 跑 spec 确认红**

Run（`frontend/`）：

```bash
npx vitest run src/views/data-home
```

Expected: 「首载骨架」两处 `toBe(5)` 与 `toContain('本月出账')` 红，其余绿。

- [ ] **Step 3: 改模板与注释**

`DataHomeView.vue`：
- `:71` 与 `:108` 两处 `<span class="dh-title">本月工作</span>` → `<span class="dh-title">本月出账</span>`
- `:79` `<li v-for="i in 4"` → `<li v-for="i in 5"`
- `:116` `出账 {{ doneSteps }}/4 · 附表 …` → `出账 {{ doneSteps }}/5 · 附表 …`
- 头注释第 2 行 `数据中心首页 = 录入工作台` 后补一句：`2026-09-03 改名「本月出账」，出账链 5 步（SIDEBAR-UX-REDESIGN §5.1）。`

`types/dataHome.ts:35` `currentIndex = -1 表示 4 步全部完成` → `5 步`。

- [ ] **Step 4: 跑 spec 确认绿**

Run：

```bash
npx vitest run src/views/data-home
```

Expected: 10 passed。

- [ ] **Step 5: 破坏验证**

把 `v-for="i in 5"` 临时改回 `4`，重跑：**只有**「数据没到时不是白屏，骨架条数与真版式一致」红（`出账链恒 5 步`）。还原。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/types/dataHome.ts frontend/src/views/data-home/DataHomeView.vue frontend/src/views/data-home/DataHomeView.spec.ts
git commit -m "feat(data-home): 首页改题「本月出账」，流水线与骨架同步 5 步

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 首页行点击带月（TDD）

**Files:**
- Modify: `frontend/src/views/data-home/DataHomeView.vue:11-40`（script）
- Modify: `frontend/src/views/data-home/DataHomeView.spec.ts`（+4 用例，`beforeEach` 加 `push.mockClear()`）

**Interfaces:**
- Consumes: `useBillingPeriodStore().pick(y: number, m: number)` / `.picked` / `.year` / `.month`（`stores/billingPeriod.ts`）；`usePresenceStore().users`（`Seat.self / editScopes`，`stores/presence.ts:10-24`）；`periodQuery(year, month, companyId)`（`nav/reportPeriod.ts:44`）；`CHAIN`（`nav/billingChain.ts:12`，五个 value）。
- Produces: `go(v: string)` 新语义：链屏先 `pick` 再 push；`reconciliation` push 带 `{ y, m }`；其余不变。

- [ ] **Step 1: 写 4 条失败测试**

`DataHomeView.spec.ts` 顶部 import 补：

```ts
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { usePresenceStore } from '@/stores/presence'
```

`beforeEach(() => setActivePinia(createPinia()))` 改为：

```ts
beforeEach(() => { setActivePinia(createPinia()); push.mockClear() })
```

在 `describe('数据中心首页 · 两段式工作台'` 末尾（`不传 ym 首载走锚定月` 之后）追加：

```ts
  // ── 行点击带月(SIDEBAR-UX-REDESIGN §4.1 / D2):出账链五屏共读 billingPeriod store,
  //    首页先 pick 当前月再跳,目标屏的 ChainMonthGate 因 period.picked 而不渲染 ──
  it('点出账链步骤:先把首页当前月写进 billingPeriod 再跳转', async () => {
    const w = await mountWith()
    await w.findAll('.dh-step')[1].trigger('click')   // 园区抄表
    const period = useBillingPeriodStore()
    expect(period.picked).toBe(true)
    expect([period.year, period.month]).toEqual([2024, 2])
    expect(push).toHaveBeenCalledWith('/meters')
  })

  it('点附表项:不动 billingPeriod', async () => {
    const w = await mountWith()
    await w.findAll('.dh-item')[0].trigger('click')   // 月度台账
    expect(useBillingPeriodStore().picked).toBe(false)
    expect(push).toHaveBeenCalledWith('/ledger')
  })

  it('全 done 的「去对账核对」带 ?y&m', async () => {
    const w = await mountWith({ chain: { currentIndex: -1, steps: STEPS_ALLDONE } })
    await w.find('[data-primary-cta]').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/reconciliation', query: { y: '2024', m: '2' } })
  })

  it('本人握着别的月的链锁时点出账链行先确认,取消则不切期不跳转', async () => {
    const w = await mountWith()
    const presence = usePresenceStore()
    presence.users = [{
      user: 'me', displayName: '我', role: null, scope: null, label: null, mode: 'edit',
      editScopes: ['billing-chain:2025-03'], sinceMs: 0, idleMs: 0, self: true,
    }]
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await w.findAll('.dh-step')[1].trigger('click')
    expect(confirm).toHaveBeenCalledOnce()
    expect(useBillingPeriodStore().picked).toBe(false)
    expect(push).not.toHaveBeenCalled()
    confirm.mockRestore()
  })
```

- [ ] **Step 2: 跑 spec 确认 4 条红**

Run：

```bash
npx vitest run src/views/data-home
```

Expected: 新增 4 条红（`picked` 为 false / push 参数不带 query / confirm 未被调），其余 10 条绿。

- [ ] **Step 3: 改 `go()`**

`DataHomeView.vue` script 的 import 段补：

```ts
import { useBillingPeriodStore } from '@/stores/billingPeriod'
import { usePresenceStore } from '@/stores/presence'
import { periodQuery } from '@/nav/reportPeriod'
import { CHAIN } from '@/nav/billingChain'
```

`const auth = useAuthStore()` 之后补：

```ts
const period = useBillingPeriodStore()
const presence = usePresenceStore()
const CHAIN_VALUES = new Set(CHAIN.map(c => c.value))

/** 本人正握着的出账链 / 抄表锁里的期(`billing-chain:2025-03` → `2025-03`,`meters:2025` → `2025`)。 */
function myChainLockPeriods(): string[] {
  const me = presence.users.find(u => u.self)
  return (me?.editScopes ?? [])
    .filter(sc => sc.startsWith('billing-chain:') || sc.startsWith('meters:'))
    .map(sc => sc.slice(sc.indexOf(':') + 1))
}
```

把现有 `go()` 整个替换为：

```ts
// 行点击 = 「去做事」显式导航 → 全新状态(openFresh;侧栏语义翻案是 P3 的事,这里不动)。
// 出账链五屏共读 billingPeriod store:先 pick 首页当前月再 push,目标屏的选期矩阵就被前置满足
// (SIDEBAR-UX-REDESIGN §4.1 / D2)。pick 覆盖会话里已选的期 —— 首页写着的月就是用户刚点的意图;
// 本人正握着**别的月**的链锁时先确认:换期会让 useEditMode 退出编辑、清掉未保存草稿。
// 收入核对认 ?y&m(ReconView.vue:23 parsePeriodQuery),其余屏本期不带参(P0b 再接)。
// ponytail: window.confirm —— 与 ParamCenterView / BillNoticesView 现有 200+ 处同款,P0 之后若换 FPDrawer 一起换。
function go(v: string) {
  const p = ov.value?.period
  if (p && CHAIN_VALUES.has(v)) {
    const ym = `${p.year}-${String(p.month).padStart(2, '0')}`
    const other = myChainLockPeriods().find(x => x !== ym && !ym.startsWith(x))
    if (other && !window.confirm(`切到 ${ym} 会退出你在 ${other} 的编辑，未保存的改动会丢失。继续？`)) return
    period.pick(p.year, p.month)
  }
  tabsStore.openFresh(v)
  if (p && v === 'reconciliation') {
    router.push({ path: '/reconciliation', query: periodQuery(p.year, p.month, null) })
    return
  }
  router.push('/' + v)
}
```

- [ ] **Step 4: 跑 spec 确认全绿**

Run：

```bash
npx vitest run src/views/data-home
```

Expected: 14 passed。

- [ ] **Step 5: 破坏验证（逐条）**

1. 临时删掉 `period.pick(p.year, p.month)` 一行 → 重跑：**只有**「点出账链步骤」红。还原。
2. 临时把 `if (p && CHAIN_VALUES.has(v))` 改为 `if (p)` → **只有**「点附表项:不动 billingPeriod」红。还原。
3. 临时把 `query: periodQuery(p.year, p.month, null)` 改为 `query: {}` → **只有**「去对账核对带 ?y&m」红。还原。
4. 临时把 `if (other && !window.confirm(` 改为 `if (false && !window.confirm(` → **只有**「本人握着别的月的链锁」红。还原。

- [ ] **Step 6: 类型检查**

Run（`frontend/`）：

```bash
npx vue-tsc --noEmit -p tsconfig.app.json
```

Expected: 无输出（0 错误）。若报 `presence.users` 赋值类型（spec 里的字面量少字段），按 `stores/presence.ts:10-24` 的 `Seat` 补齐字段，**不要**用 `as any`。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/views/data-home/DataHomeView.vue frontend/src/views/data-home/DataHomeView.spec.ts
git commit -m "feat(data-home): 首页行点击把当前月带进出账链与收入核对 —— 不再落回选期矩阵

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 导航项改名

**Files:**
- Modify: `frontend/src/nav/fpNav.ts:10`
- Modify: `frontend/src/nav/__tests__/fpNav.spec.ts:9-12`
- Modify: `frontend/src/components/shell/mobile/mobileNavDrawer.spec.ts:8`
- Modify: `frontend/src/nav/navAccess.ts:18`（注释）

**Interfaces:**
- Produces: `fpBuildRoutes()['data-home'] === { page: '本月出账', icon: 'calendar-check', … }`；页签条、面包屑、命令面板、在场 label 自动跟随（都从 `ROUTES[value].page` 取）。

- [ ] **Step 1: 加断言（先红）**

`fpNav.spec.ts` 的 `builds a route per item with layer back-refs` 用例里，`expect(r['buildings'].layer).toBe('data')` 之后插入：

```ts
    // 首页改名「本月出账」(SIDEBAR-UX-REDESIGN §5.1 / D12):value 不变,页签/面包屑/面板从这里取字
    expect(r['data-home'].page).toBe('本月出账')
    expect(r['data-home'].icon).toBe('calendar-check')
```

- [ ] **Step 2: 跑 spec 确认红**

Run：

```bash
npx vitest run src/nav
```

Expected: `fpNav.spec` 1 红（`数据中心首页` ≠ `本月出账`）。

- [ ] **Step 3: 改 fpNav 与两处文案**

`fpNav.ts:10`：

```ts
    { items: [{ value: 'data-home', label: '本月出账', icon: 'calendar-check', kind: 'data-home' }] },
```

`mobileNavDrawer.spec.ts:8`：

```ts
  useRoute: () => ({ meta: { value: 'data-home', page: '本月出账' } }),
```

`navAccess.ts:18` 注释 `数据层 → 数据中心首页` → `数据层 → 本月出账`。

- [ ] **Step 4: 跑受影响的测试**

Run：

```bash
npx vitest run src/nav src/components/shell src/stores src/router
```

Expected: 全绿（`fpNav.spec` 51 项计数不变；`palette.spec` 3 层组不变；`routeMap.spec` 不变）。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/nav/fpNav.ts frontend/src/nav/__tests__/fpNav.spec.ts frontend/src/components/shell/mobile/mobileNavDrawer.spec.ts frontend/src/nav/navAccess.ts
git commit -m "feat(nav): 数据中心首页改名「本月出账」

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 全量回归、构建门禁与对抗复查

**Files:**
- 无新改动（除非复查抓到问题）。

**Interfaces:**
- Produces: P1 可合并；复查记录进 `docs/superpowers/plans/2026-09-03-p1-month-close-home.md` 末尾「复查记录」小节。

- [ ] **Step 1: 前端全量测试**

Run（`frontend/`）：

```bash
npx vitest run
```

Expected: 全绿；文件数 179、用例数比基线 +6（Task 2 +0、Task 3 +4、Task 4 +2 断言在同一用例内不计）。

- [ ] **Step 2: 构建与体积门禁**

Run（`frontend/`）：

```bash
npm run build
```

Expected: `vue-tsc` 0 错；`token-check` 绿；`size-check` 绿（本期只加 4 个 import 与 ~20 行，index 块预算 191KB 应不触线；触线即停，先瘦身不签字）。

- [ ] **Step 3: 后端单测再跑一遍**

Run（`backend/`）：

```bash
./mvnw.cmd -q -Dtest=DataHomeServiceTest -DfailIfNoTests=false test
```

Expected: `Tests run: 18, Failures: 0`。

- [ ] **Step 4: 对抗复查**

用 Workflow 起 3 个只想推翻的复查员，各一个镜头，对象是 `git diff master...HEAD`：
- 正确性：`buildChain` 判据、`go()` 的 confirm 条件（`meters:2024` 年锁 vs `2024-02` 目标应不弹）、`periodQuery` 形状与 `ReconView.vue:23` 一致。
- 护栏：8 份 flow/gate spec 是否仍绿（源码扫描门禁只扫 views/ 内 `year/month ref`，本期没加）；`billingPeriod.spec:84-88` 原样；零布局位移（骨架 5 = 真版式 5）。
- 用户价值：专员从首页选 2024-02 点「计费参数」是否真的直落（`ParamCenterView.vue:575` 同款 `v-if="!period.picked"` 门）；已选 2025-03 再点 2024-02 是否覆盖。
每条坐实的 HIGH 修完再进 Step 5；子 agent 写的断言本人重做破坏验证。

- [ ] **Step 5: 记录复查结果**

在本文件末尾追加「## 复查记录」：日期、三镜头各抓到几条、修了什么、遗留什么。

- [ ] **Step 6: 提交复查记录**

```bash
git add docs/superpowers/plans/2026-09-03-p1-month-close-home.md
git commit -m "docs(plan): P1 复查记录

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 本期不做（提醒执行者别顺手）

- 侧栏 / 抽屉点击改 `open`（P3）；`KeepAlive max`（P3）；页签标题与上下文 chip（P3）。
- `nav/deepLink.ts` / `useDeepPeriod`（P0）；附表行带 `?p` / `tab` / `mode`（P0b）。
- fpNav 分组重排、删 `bank-flow`、`navHeight.spec`（P4）。
- 年份条 / 两栏清单 / 主管条 / DTO `companies/phases`（P2）。
- 审核机制（R1/R2）。
- `adoptYm` 语义、`billingPeriod` 持久化。
- 登录后的浏览器实测：口令不能由 Claude 输入，P1 验收靠单测 + 破坏验证 + 复查；真机走查由你登录后按 spec §9 P1 行的两条做。
