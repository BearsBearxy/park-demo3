# 数据中心首页重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把数据中心首页从「同一批信息说三遍的欠账清单」改成「出账链流水线 + 附表清单」的两段式录入工作台。

**Architecture:** 后端 `DataHomeService` 换新契约：锚定月由出账链四源 ym 取 max（三级回退），出账链 4 步各自判 done/current/todo，合同与参数降级为只在有问题时出现的 `blockers`。前端 `DataHomeView.vue` 重写为两段，删掉 4 个 KPI 卡 / 待办栏 / 最近动态栏。

**Tech Stack:** Spring Boot 3.3.5 + MyBatis-Plus（后端）、Vue 3 + TS + Vite（前端）、JUnit5 + Testcontainers、Vitest。

**设计稿：** `docs/superpowers/specs/2026-08-18-data-home-redesign-design.md`（提交 d4de2dd + 1019445）

## Global Constraints

- 中文注释，密度与写法照抄周围既有代码（写「为什么」和「踩过的坑」，不复述代码）。
- 遵守 `docs/design/METRIC-SOURCE-SPEC.md`：同一判定只能有一个实现；跨屏同名指标必须同源。
- 遵守 `docs/design/API-CONTRACT-SPEC.md`：controller 返回裸 DTO 不手写 `Result.ok`；请求/响应 record 落 `dto` 包。
- **禁止 `selectList(null)`** —— CI 有 `QueryHygieneTest` 门禁。
- 不引入新组件、不引入新设计语言、不动导航结构。
- 每个 Task 结束必须提交，且提交前该 Task 的测试全绿。
- 后端测试结论看 surefire 汇总或 `BUILD SUCCESS`，**不看管道退出码**（那是最后一个命令的）。

---

### Task 1: 后端锚定月与 months 全集

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/service/DataHomeService.java`
- Test: `backend/src/test/java/com/park/demo3/service/DataHomeServiceTest.java`

**Interfaces:**
- Consumes: 上一轮已有的 `MeterReadingMapper.selectDistinctYms()`、`AllocPoolResultMapper.selectDistinctYms()`、`AllocLossResultMapper.selectDistinctYms()`、`BillNoticeMapper.selectDistinctYms()`（均返回零补 `YYYY-MM` 升序）
- Produces: `static String anchorYm(List<String> chainYms, List<String> scheduleYms)`、`static List<String> allMonths(List<String> chainYms, List<String> scheduleYms)`

- [ ] **Step 1: 写失败测试**（加到 `DataHomeServiceTest`）

```java
@Test void 锚定月_取出账链最新月() {
    assertThat(DataHomeService.anchorYm(List.of("2023-08", "2023-10", "2024-02"), List.of("2025-10")))
        .isEqualTo("2024-02");
}

@Test void 锚定月_链为空时退到附表最新月() {
    assertThat(DataHomeService.anchorYm(List.of(), List.of("2025-01", "2025-10"))).isEqualTo("2025-10");
}

@Test void 锚定月_两边都空返回null() {
    assertThat(DataHomeService.anchorYm(List.of(), List.of())).isNull();
}

@Test void months全集_并集去重升序() {
    assertThat(DataHomeService.allMonths(List.of("2024-02", "2023-08"), List.of("2025-01", "2024-02")))
        .containsExactly("2023-08", "2024-02", "2025-01");
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && ./mvnw.cmd test -Dtest=DataHomeServiceTest`
Expected: 编译失败 `cannot find symbol: method anchorYm`

- [ ] **Step 3: 实现**

```java
/** 锚定月三级回退(spec §2.2):出账链最新月 → 附表最新月 → null(全新库)。
 *  不用「最早未完工月」:实测没有任何一个月是全做完的,那个口径恒落 2023-08,首页永远停在两年前。
 *  不用「最新有数据月」:那是 5 个月度源取 max = 2026-01,出账链在该月全空、完整度永远停在 20%。
 *  ym 是零补 YYYY-MM,字典序即时间序,不解析成 YearMonth 再比。 */
static String anchorYm(List<String> chainYms, List<String> scheduleYms) {
    String chain = chainYms.stream().max(Comparator.naturalOrder()).orElse(null);
    if (chain != null) return chain;
    return scheduleYms.stream().max(Comparator.naturalOrder()).orElse(null);
}

/** 顶部月份下拉的可切月份:链 ∪ 附表,升序去重。
 *  不能只给链的月份 —— 用户要能切到 2025-06 补台账,而那个月链上无数据。 */
static List<String> allMonths(List<String> chainYms, List<String> scheduleYms) {
    return Stream.concat(chainYms.stream(), scheduleYms.stream()).distinct().sorted().toList();
}
```

需要 `import java.util.stream.Stream;`

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && ./mvnw.cmd test -Dtest=DataHomeServiceTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/src/main/java/com/park/demo3/service/DataHomeService.java backend/src/test/java/com/park/demo3/service/DataHomeServiceTest.java
git commit -m "feat(data-home): 锚定月三级回退 + months 全集(纯函数,先落可单测的部分)"
```

---

### Task 2: 后端出账链 4 步状态

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/service/DataHomeService.java`
- Modify: `backend/src/main/java/com/park/demo3/dto/DataHomeOverviewDTO.java`（先加 `Chain`/`Step` 两个嵌套 record；顶层形状 Task 4 再换）
- Test: `backend/src/test/java/com/park/demo3/service/DataHomeServiceTest.java`

**Interfaces:**
- Produces: `static DataHomeOverviewDTO.Chain buildChain(long readingCount, boolean poolGenerated, boolean lossGenerated, int noticeCount, BigDecimal noticeTotal, int noticeWarn)`
- Produces（供 Task 4/5 引用的形状）: `Chain(int currentIndex, List<Step> steps)`、`Step(String key, String label, String status, String detail, String go)`，`status` 取值 `done` / `current` / `todo`

- [ ] **Step 1: 写失败测试**

```java
@Test void 出账链_当前步是第一个非done() {
    var chain = DataHomeService.buildChain(1088, true, true, 0, BigDecimal.ZERO, 0);
    assertThat(chain.currentIndex()).isEqualTo(3);
    assertThat(chain.steps()).extracting(DataHomeOverviewDTO.Step::status)
        .containsExactly("done", "done", "done", "current");
}

@Test void 出账链_全部完成时currentIndex为负1() {
    var chain = DataHomeService.buildChain(1088, true, true, 102, new BigDecimal("2474138.88"), 66);
    assertThat(chain.currentIndex()).isEqualTo(-1);
    assertThat(chain.steps()).allMatch(s -> "done".equals(s.status()));
}

@Test void 出账链_空月第一步为current其余todo() {
    var chain = DataHomeService.buildChain(0, false, false, 0, BigDecimal.ZERO, 0);
    assertThat(chain.currentIndex()).isZero();
    assertThat(chain.steps()).extracting(DataHomeOverviewDTO.Step::status)
        .containsExactly("current", "todo", "todo", "todo");
}

@Test void 出账链_抄表detail只给已抄数不给分母() {
    // 92/94 那个比例是 MeterView 前端 cardCounts() 在筛选链上算的,后端另算分母必然漂移
    // (METRIC-SOURCE-SPEC §1 禁止同一判定两份实现)。首页只回答「做没做、做了多少」。
    var chain = DataHomeService.buildChain(1088, false, false, 0, BigDecimal.ZERO, 0);
    assertThat(chain.steps().get(0).detail()).isEqualTo("已抄 1088 块").doesNotContain("/");
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && ./mvnw.cmd test -Dtest=DataHomeServiceTest`
Expected: 编译失败 `cannot find symbol: method buildChain`

- [ ] **Step 3: 实现**

先在 `DataHomeOverviewDTO.java` 内补两个嵌套 record（顶层 Task 4 再整体换）：

```java
public record Chain(int currentIndex, List<Step> steps) {}
public record Step(String key, String label, String status, String detail, String go) {}
```

再在 `DataHomeService` 实现：

```java
/** 出账链 4 步(spec §2.1)。合同/参数不在链上 —— 它们不按月完成,塞进来会得到两个
 *  永远不知道该不该打勾的格子;改由 blockers 承担(只在有问题时渲染)。
 *  当前步 = 第一个非 done;全 done → currentIndex=-1,前端把大卡换成「去对账核对」。 */
static DataHomeOverviewDTO.Chain buildChain(long readingCount, boolean poolGenerated, boolean lossGenerated,
                                            int noticeCount, BigDecimal noticeTotal, int noticeWarn) {
    boolean[] done   = { readingCount > 0, poolGenerated, lossGenerated, noticeCount > 0 };
    String[]  keys   = { "meters", "alloc", "alloc-loss", "bill-notices" };
    String[]  labels = { "园区抄表", "公共电核算", "楼栋损耗", "催缴单" };
    String[]  details = {
        readingCount > 0 ? "已抄 " + readingCount + " 块" : "未抄表",
        poolGenerated ? "" : "未生成",
        lossGenerated ? "" : "未生成",
        noticeCount > 0
            ? noticeCount + " 户 · ¥" + noticeTotal.setScale(2, RoundingMode.HALF_UP).toPlainString()
              + (noticeWarn > 0 ? " · " + noticeWarn + " 户带警告" : "")
            : "未生成",
    };
    int current = -1;
    for (int i = 0; i < 4; i++) if (!done[i]) { current = i; break; }

    List<DataHomeOverviewDTO.Step> steps = new ArrayList<>(4);
    for (int i = 0; i < 4; i++) {
        String status = done[i] ? "done" : (i == current ? "current" : "todo");
        steps.add(new DataHomeOverviewDTO.Step(keys[i], labels[i], status, details[i], keys[i]));
    }
    return new DataHomeOverviewDTO.Chain(current, steps);
}
```

需要 `import java.math.BigDecimal;`、`import java.math.RoundingMode;`

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && ./mvnw.cmd test -Dtest=DataHomeServiceTest`
Expected: PASS（含 Task 1 的 4 条）

- [ ] **Step 5: 提交**

```bash
git add backend/src/main/java/com/park/demo3/service/DataHomeService.java backend/src/main/java/com/park/demo3/dto/DataHomeOverviewDTO.java backend/src/test/java/com/park/demo3/service/DataHomeServiceTest.java
git commit -m "feat(data-home): 出账链 4 步状态机(当前步=第一个非done;抄表不给分母防跨屏漂移)"
```

---

### Task 3: 后端 blockers（合同缺口 + 参数 stale）

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/service/DataHomeService.java`
- Modify: `backend/src/main/java/com/park/demo3/dto/DataHomeOverviewDTO.java`（加 `Blocker` record）
- Test: `backend/src/test/java/com/park/demo3/service/DataHomeServiceTest.java`

**Interfaces:**
- Produces: `static List<DataHomeOverviewDTO.Blocker> buildBlockers(int contractNoLine, boolean paramStale)`
- Produces（形状）: `Blocker(String kind, String text, String cta, String go)`，`kind` 取值 `contract-gap` / `param-stale`

**⚠ 口径约束（METRIC-SOURCE-SPEC §1）：** 合同缺口判据必须与合同屏 `ContractsView.vue:131` 的 `noLine` 谓词同源 —— 即 `billingLineCount == 0` 的合同数。取数走 `ContractService` 已有的合同列表，**不要在 DataHomeService 里另写一套合同查询**。

- [ ] **Step 1: 写失败测试**

```java
@Test void blockers_都没问题时为空数组() {
    assertThat(DataHomeService.buildBlockers(0, false)).isEmpty();
}

@Test void blockers_合同缺计费行时出一条() {
    var bs = DataHomeService.buildBlockers(219, false);
    assertThat(bs).hasSize(1);
    assertThat(bs.get(0).kind()).isEqualTo("contract-gap");
    assertThat(bs.get(0).text()).contains("219");
    assertThat(bs.get(0).go()).isEqualTo("contracts");
}

@Test void blockers_参数过期时出一条() {
    var bs = DataHomeService.buildBlockers(0, true);
    assertThat(bs).hasSize(1);
    assertThat(bs.get(0).kind()).isEqualTo("param-stale");
    assertThat(bs.get(0).go()).isEqualTo("params");
}

@Test void blockers_两个问题都在时出两条_合同在前() {
    assertThat(DataHomeService.buildBlockers(219, true))
        .extracting(DataHomeOverviewDTO.Blocker::kind)
        .containsExactly("contract-gap", "param-stale");
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && ./mvnw.cmd test -Dtest=DataHomeServiceTest`
Expected: 编译失败 `cannot find symbol: method buildBlockers`

- [ ] **Step 3: 实现**

`DataHomeOverviewDTO` 加：

```java
public record Blocker(String kind, String text, String cta, String go) {}
```

`DataHomeService`：

```java
/** 前置条(spec §2.1):合同/参数不按月完成,不进流水线;只在**有问题时**产出一条,
 *  没问题时返回空数组、前端整条不渲染 —— 没问题的东西不该占版面,这是「有主次」的关键。
 *  合同缺口口径必须与合同屏 ContractsView 的 noLine 谓词同源(billingLineCount==0),
 *  别在这里另写一套(METRIC-SOURCE-SPEC §1)。 */
static List<DataHomeOverviewDTO.Blocker> buildBlockers(int contractNoLine, boolean paramStale) {
    List<DataHomeOverviewDTO.Blocker> out = new ArrayList<>(2);
    if (contractNoLine > 0)
        out.add(new DataHomeOverviewDTO.Blocker("contract-gap",
            contractNoLine + " 份合同无租金计费行，会让公摊/催缴单算不准", "去补档", "contracts"));
    if (paramStale)
        out.add(new DataHomeOverviewDTO.Blocker("param-stale",
            "计费参数改动晚于本月快照，屏上数字还是改参前派生的", "去重算", "params"));
    return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && ./mvnw.cmd test -Dtest=DataHomeServiceTest`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/src/main/java/com/park/demo3/service/DataHomeService.java backend/src/main/java/com/park/demo3/dto/DataHomeOverviewDTO.java backend/src/test/java/com/park/demo3/service/DataHomeServiceTest.java
git commit -m "feat(data-home): 前置条 blockers(只在有问题时产出;合同缺口与合同屏同源)"
```

---

### Task 4: 组装新 overview + controller ?ym + 删旧 DTO

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/dto/DataHomeOverviewDTO.java`（顶层 record 换新形状）
- Modify: `backend/src/main/java/com/park/demo3/service/DataHomeService.java`（`overview(String ym)`）
- Modify: `backend/src/main/java/com/park/demo3/controller/DataHomeController.java`
- Delete: `dto/DataHomeKpiDTO.java`、`dto/DataHomeTaskDTO.java`、`dto/DataHomeRecentDTO.java`、`dto/DataHomeSourceDTO.java`
- Test: `backend/src/test/java/com/park/demo3/api/DataHomeApiIT.java`（现 55 行，重写）

**Interfaces:**
- Produces: `GET /api/data-home/overview[?ym=YYYY-MM]` → 新 `DataHomeOverviewDTO`
- Produces（顶层形状，Task 5 前端逐字对齐）:
  `DataHomeOverviewDTO(Period period, List<String> months, List<Blocker> blockers, Chain chain, Schedules schedules)`
  `Period(int year, int month, String label)`、`Schedules(int done, int total, List<Item> items)`、`Item(String name, String tag, boolean done, String go)`

- [ ] **Step 1: 写失败测试**（重写 `DataHomeApiIT`）

```java
@Test void overview_默认落锚定月且形状完整() throws Exception {
    String body = getOk("/api/data-home/overview");
    assertThat((String) JsonPath.read(body, "$.data.period.label")).contains("年").contains("月");
    List<String> months = JsonPath.read(body, "$.data.months[*]");
    assertThat(months).isSorted().allMatch(m -> m.matches("\\d{4}-\\d{2}"));
    assertThat((List<?>) JsonPath.read(body, "$.data.chain.steps")).hasSize(4);
    assertThat((int) JsonPath.read(body, "$.data.schedules.total")).isEqualTo(9);
}

@Test void overview_指定月生效() throws Exception {
    String body = getOk("/api/data-home/overview?ym=2024-02");
    assertThat((int) JsonPath.read(body, "$.data.period.year")).isEqualTo(2024);
    assertThat((int) JsonPath.read(body, "$.data.period.month")).isEqualTo(2);
}

@Test void overview_完全空的月不炸() throws Exception {
    String body = getOk("/api/data-home/overview?ym=2099-12");
    assertThat((int) JsonPath.read(body, "$.data.chain.currentIndex")).isZero();
    assertThat((int) JsonPath.read(body, "$.data.schedules.done")).isZero();
}

@Test void overview_ym格式非法返回400() throws Exception {
    mvc.perform(get("/api/data-home/overview?ym=2024-13").header("Authorization", auth()))
       .andExpect(status().isBadRequest());
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && ./mvnw.cmd test -Dtest=DataHomeApiIT`
Expected: FAIL（旧契约里没有 chain / schedules / months）

- [ ] **Step 3: 实现**

`DataHomeOverviewDTO` 顶层换成上面 Interfaces 列的形状。

`DataHomeService.overview(String ym)`：
- `ym == null` → 用 `anchorYm(chainYms, scheduleYms)`；仍为 null → `period=null`、`chain` 用全 todo、`schedules.done=0`。
- 9 个附表源保留现有取数逻辑映射成 `Schedules.items`，**含现有月/年粒度差异不要统一**：月度类按 `acctMonth`（月度台账、销售收入附10、工资明细附12、办公水电附13、三期水电附14），年度类按 `year`（光伏附6、汽车充电桩附7、电动车充电桩附8、电费成本附11）。
- `currentPeriod()` 原有的 4 条聚合查询优化**不要退化**成整表读实体（原注释记着：曾把 5 张月度表整表读成实体只为取 MAX 两列）。

Controller（类上加 `@Validated`）：

```java
@Operation(summary = "数据中心首页(不传 ym = 锚定月:出账链最新有数据月)") @GetMapping("/overview")
public DataHomeOverviewDTO overview(
        @RequestParam(required = false) @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String ym) {
    return svc.overview(ym);
}
```

需要 `import jakarta.validation.constraints.Pattern;`、`import org.springframework.validation.annotation.Validated;`

- [ ] **Step 4: 清理 DataHomeServiceTest 里针对旧契约的断言**

⚠ `DataHomeServiceTest`（214 行）有 8 处断言打在即将删除的 DTO 上，不清理则删 DTO 后编译失败：
`:110/:115/:120` 用 `o.sources()`、`:134-151` 用 `o.tasks()`、`:171-176` 用 `o.recent()` 与 `DataHomeRecentDTO::time`。

处理原则：
- `o.sources()` 三处 → 改打在 `o.schedules().items()` 上（形状同为 name/tag/done/go，语义等价）；
- `o.tasks()` 六处 → **整体删除**。待办本就是 sources 的子集（这正是本次重设计要消灭的重复），
  它的语义已由 `chain` + `schedules` 覆盖，不存在等价替换；
- `o.recent()` 三处 → **整体删除**。最近动态已从产品上移除（spec §2）。

删完保留 Task 1–3 新增的纯函数用例。

- [ ] **Step 5: 删旧 DTO 并确认无残留引用**

```bash
cd backend/src/main/java/com/park/demo3/dto
rm DataHomeKpiDTO.java DataHomeTaskDTO.java DataHomeRecentDTO.java DataHomeSourceDTO.java
cd C:/financial_dashboard/demo3
grep -rn "DataHomeKpiDTO\|DataHomeTaskDTO\|DataHomeRecentDTO\|DataHomeSourceDTO" backend/src frontend/src
```

Expected: backend 无输出（前端那几处在 Task 5 一并清）

- [ ] **Step 6: 跑全量后端测试**

Run: `cd backend && ./mvnw.cmd test`
Expected: `BUILD SUCCESS`，surefire 汇总 0 failures 0 errors

- [ ] **Step 7: 提交**

```bash
git add -A backend/
git commit -m "feat(data-home): 新 overview 契约 + ?ym 参数;删掉 kpis/tasks/recent 三组重复 DTO"
```

---

### Task 5: 前端契约 + View 重写

**Files:**
- Modify: `frontend/src/types/dataHome.ts`（重写）
- Modify: `frontend/src/api/dataHome.ts`
- Modify: `frontend/src/views/data-home/DataHomeView.vue`（重写，~160 行）
- Test: `frontend/src/views/data-home/DataHomeView.spec.ts`（现 93 行，重写）

**Interfaces:**
- Consumes: Task 4 的 `GET /api/data-home/overview[?ym=]`，形状逐字对齐 Task 4 Interfaces 段

- [ ] **Step 1: 重写类型契约与 api**

```ts
export interface DataHomePeriodDTO { year: number; month: number; label: string }
export interface DataHomeBlockerDTO { kind: 'contract-gap' | 'param-stale'; text: string; cta: string; go: string }
export interface DataHomeStepDTO { key: string; label: string; status: 'done' | 'current' | 'todo'; detail: string; go: string }
export interface DataHomeChainDTO { currentIndex: number; steps: DataHomeStepDTO[] }
export interface DataHomeItemDTO { name: string; tag: string; done: boolean; go: string }
export interface DataHomeSchedulesDTO { done: number; total: number; items: DataHomeItemDTO[] }
export interface DataHomeOverviewDTO {
  period: DataHomePeriodDTO | null      // null = 库里一条数据都没有(全新库)
  months: string[]
  blockers: DataHomeBlockerDTO[]        // 空数组 = 前置条整条不渲染
  chain: DataHomeChainDTO
  schedules: DataHomeSchedulesDTO
}
```

```ts
export const dataHomeApi = {
  // 不传 ym = 后端锚定月(出账链最新有数据月);顶部下拉切月时传具体 ym
  getOverview: (ym?: string): Promise<DataHomeOverviewDTO> =>
    http.get('/data-home/overview', { params: { ym } }),
}
```

- [ ] **Step 2: 写失败测试**（重写 `DataHomeView.spec.ts`，mock `dataHomeApi`）

```ts
it('blockers 为空时前置条整条不渲染', async () => {
  const w = await mountWith({ blockers: [] })
  expect(w.text()).not.toContain('去补档')
})

it('当前步出大卡且是全页唯一主 CTA', async () => {
  const w = await mountWith({ chain: { currentIndex: 3, steps: STEPS_3DONE } })
  expect(w.text()).toContain('催缴单')
  expect(w.findAll('[data-primary-cta]')).toHaveLength(1)
})

it('4 步全 done 时大卡换成去对账', async () => {
  const w = await mountWith({ chain: { currentIndex: -1, steps: STEPS_ALLDONE } })
  expect(w.text()).toContain('本月出账已完成')
})

it('period 为 null 时显示空库引导', async () => {
  const w = await mountWith({ period: null })
  expect(w.text()).toContain('还没开始出账')
})

it('viewer 角色主 CTA 文案改查看且前置条 CTA 隐藏', async () => {
  const w = await mountWith({ blockers: [BLOCKER_CONTRACT] }, { role: 'viewer' })
  expect(w.text()).toContain('查看')
  expect(w.text()).not.toContain('去补档')
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/views/data-home/DataHomeView.spec.ts`
Expected: FAIL

- [ ] **Step 4: 重写 View**

两段结构照 spec §2 的 ASCII 图。要点：
- 复用 `ds/Card`、`ds/Button`、`iconFor`；月份下拉复用 `BillNoticesView` 的 popover 写法。
- **不抽新组件**：流水线、前置条、附表清单三块都只此一处用，抽出去是给单一实现造接口。
- 切月调 `getOverview(ym)`，**不持久化**（下次打开仍按锚重算，避免看过一次历史月后天天落在那儿）。
- 主 CTA 加 `data-primary-cta` 属性，全页只能有一个（测试锁死）。
- viewer（`useAuthStore().isReadonly`）：主 CTA 文案「去处理」→「查看」，blockers 的 cta 按钮隐藏。

模板骨架（照此填，别自由发挥版式）：

```vue
<template>
  <div class="dh" v-if="ov">
    <!-- 顶部唯一总览行:月份下拉 + 两个进度数字 -->
    <div class="dh-head">
      <button class="dh-period" @click="monthOpen = !monthOpen">
        本月工作 · {{ ov.period?.label ?? '—' }}
        <component :is="iconFor('chevron-down')" :size="14" />
      </button>
      <span class="dh-counts">出账 {{ doneSteps }}/4 · 附表 {{ ov.schedules.done }}/{{ ov.schedules.total }}</span>
    </div>

    <!-- 空库引导:period 为 null 时整页只剩这一句 -->
    <Card v-if="!ov.period" class="dh-empty">
      还没开始出账 · <a @click="go('meters')">从园区抄表开始 →</a>
    </Card>

    <template v-else>
      <!-- 前置条:blockers 为空则整条不渲染(有主次的关键:没问题的东西不占版面) -->
      <div v-for="b in ov.blockers" :key="b.kind" class="dh-blocker">
        <component :is="iconFor('alert-triangle')" :size="14" />
        <span>{{ b.text }}</span>
        <Button v-if="!auth.isReadonly" size="sm" variant="outline" @click="go(b.go)">{{ b.cta }}</Button>
      </div>

      <!-- 第一段:出账链流水线 + 当前步大卡 -->
      <section class="dh-chain">
        <h3>出账链</h3>
        <ol class="dh-steps">
          <li v-for="s in ov.chain.steps" :key="s.key" :data-status="s.status" @click="go(s.go)">
            {{ s.label }}<em v-if="s.detail">{{ s.detail }}</em>
          </li>
        </ol>
        <Card class="dh-current">
          <template v-if="ov.chain.currentIndex >= 0">
            <div>{{ curStep.label }} · {{ curStep.detail }}</div>
            <Button data-primary-cta variant="filled" @click="go(curStep.go)">
              {{ auth.isReadonly ? '查看' : '去处理' }} →
            </Button>
          </template>
          <template v-else>
            <div>本月出账已完成</div>
            <Button data-primary-cta variant="outline" @click="go('reconciliation')">去对账核对 →</Button>
          </template>
        </Card>
      </section>

      <!-- 第二段:附表录入清单,未录在前、已录淡化 -->
      <section class="dh-sched">
        <h3>附表录入 <span>{{ ov.schedules.done }}/{{ ov.schedules.total }}</span></h3>
        <ul>
          <li v-for="i in sortedItems" :key="i.go + i.name" :data-done="i.done" @click="go(i.go)">
            {{ i.done ? '✓' : '○' }} {{ i.name }}<em>{{ i.tag }}</em>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
```

`sortedItems` = 未录在前、已录在后（同组内保持后端给的顺序）；`curStep` = `ov.chain.steps[ov.chain.currentIndex]`；
`go(value)` 复用现有 tabs store 打开屏的写法（照抄现 `DataHomeView.vue` 里的 `go()`）。

- [ ] **Step 5: 跑测试 + typecheck**

Run: `cd frontend && npx vitest run src/views/data-home/DataHomeView.spec.ts && npm run typecheck`
Expected: 测试 PASS，typecheck 0 错误

- [ ] **Step 6: 提交**

```bash
git add frontend/src/types/dataHome.ts frontend/src/api/dataHome.ts frontend/src/views/data-home/
git commit -m "feat(data-home): 首页重写为两段式工作台(出账链流水线 + 附表清单)"
```

---

### Task 6: 端到端验证

**Files:** 无（只验证）

- [ ] **Step 1: 四道门禁**

```bash
cd frontend && npm run typecheck && npm test && npm run build
cd ../backend && ./mvnw.cmd test
```

Expected: typecheck 0 错；vitest 全绿；build 成功（含 precompress + size-check）；后端 `BUILD SUCCESS` + surefire 0 failures 0 errors

- [ ] **Step 2: 浏览器实证**

起 `demo3-backend`(8181) + `demo3-frontend`(5173)，登录后打开 `/data-home`，逐条核对：

1. 落在 **2024年2月**（出账链锚），不是 2026-01；
2. 出账链 4 步与实测数据一致（2024-02 有抄表 1088、公摊 98、催缴单 295 → 应全 done，`currentIndex=-1`，大卡显示「本月出账已完成」）；
3. 页面上**不再出现** KPI 卡、「本期待办」、「最近动态」三块；
4. 主 CTA 只有一个；
5. 顶部下拉切到 2025-06：出账链 4 步全 todo、附表有数（台账 2025-06 有 374 行），不报错；
6. 控制台无报错。

- [ ] **Step 3: 提交（若有修补）**

```bash
git add -A && git commit -m "fix(data-home): 端到端验证发现的问题修补"
```
