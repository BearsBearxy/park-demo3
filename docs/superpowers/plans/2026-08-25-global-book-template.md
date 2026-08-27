# 账册模板全局化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 台账屏的模板从「每司一册一链」改为「全局一条链 + 每司一个版本指针」，改一次列名对所有公司生效，但每家公司自己决定何时升级。

**Architecture:** `ledger_book` 新增一行 `company_id=NULL` 的**宿主行**承载全局链；6 家公司的行退化为纯指针（`current_version_id`）。编辑只允许发生在链尾，保存后只带走原本就在链尾的公司。切版本走新的 `adopt` 端点并受归档守卫拦截。附表10（s10）屏一册一链，代码路径恒等不变。

**Tech Stack:** Spring Boot 3.3.5 / JDK 17 / MyBatis-Plus / Flyway / MySQL 8 / Vue 3 + TypeScript / Vitest

**Spec:** `docs/superpowers/specs/2026-08-25-global-book-template-design.md`

## Global Constraints

- **s10 屏零行为变更**。所有 s10 相关既有测试必须原样通过，不许改断言迁就实现。
- **标准列不可删**（`TemplateDef.assertStdKept`）——既有规则，不动。
- **自定义列 id 白名单** `c_[a-z0-9_]+`（`TemplateDef.validate`）——它会拼进归档守卫的 JSON path，不许放宽。
- **应收合计口径唯一**：`LedgerService.recalc` = `ExtraFees.sum(extra_fees) + 21 个物理列`。本次**不许**给它加模板依赖（见 spec §9）。
- 权限点 `Perm.BOOK_TEMPLATE_EDIT = "book-template:edit"`，编辑与切版本同走此点；GET 全员可读。
- 后端跑测试：`cd backend && ./mvnw -o test -Dtest=<类名>`。前端：`cd frontend && npx vitest run <路径>`。
- 提交信息用中文，句末不加句号，与仓库现有风格一致。

---

### Task 1: 模板改动集合与包含性判断（纯函数）

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/service/TemplateDef.java`
- Test: `backend/src/test/java/com/park/demo3/service/TemplateDefTest.java`

**Interfaces:**
- Consumes: 既有 `TemplateDef.Def` / `Col` / `Group` / `parse` / `flatten`
- Produces:
  - `public static Set<String> changeSet(Def base, Def x)` — x 相对 base 的改动集合
  - `public static boolean chainOrdered(List<Def> variants, Def base)` — variants 按 changeSet 大小升序时是否严格包含

**列宽 `w` 不参与改动集合**：它是纯装饰，参与只会让无谓的宽度差异挡住迁移。归并后统一取链尾那版的列宽。

- [ ] **Step 1: 写失败测试**

在 `TemplateDefTest.java` 末尾（类的最后一个 `}` 之前）追加：

```java
    private static TemplateDef.Def defOf(String json) { return TemplateDef.parse(json); }

    /** 三列基准:两个标准列 + 一个自定义列,足够覆盖 新增/改名/别名/隐藏/换槽 五类改动 */
    private static String base3() {
        return "{\"groups\":[{\"id\":\"g1\",\"label\":\"组一\",\"cols\":["
            + "{\"id\":\"factoryRent\",\"std\":true,\"label\":\"厂房租金\",\"aliases\":[],\"slot\":\"rent\",\"hidden\":false,\"w\":null},"
            + "{\"id\":\"shopRent\",\"std\":true,\"label\":\"商铺、宿舍租金\",\"aliases\":[],\"slot\":\"rent\",\"hidden\":false,\"w\":null}"
            + "]}]}";
    }

    @Test
    void changeSet_emptyForIdenticalDefs() {
        assertThat(TemplateDef.changeSet(defOf(base3()), defOf(base3()))).isEmpty();
    }

    @Test
    void changeSet_ignoresColumnWidth() {
        String widened = base3().replace("\"label\":\"厂房租金\",\"aliases\":[],\"slot\":\"rent\",\"hidden\":false,\"w\":null",
                                         "\"label\":\"厂房租金\",\"aliases\":[],\"slot\":\"rent\",\"hidden\":false,\"w\":180");
        assertThat(TemplateDef.changeSet(defOf(base3()), defOf(widened))).isEmpty();
    }

    @Test
    void changeSet_catchesLabelAliasHiddenSlotAndNewColumn() {
        String changed = "{\"groups\":[{\"id\":\"g1\",\"label\":\"组一\",\"cols\":["
            + "{\"id\":\"factoryRent\",\"std\":true,\"label\":\"厂房租金\",\"aliases\":[\"厂租\"],\"slot\":\"rent\",\"hidden\":true,\"w\":null},"
            + "{\"id\":\"shopRent\",\"std\":true,\"label\":\"商铺租金\",\"aliases\":[],\"slot\":\"misc\",\"hidden\":false,\"w\":null},"
            + "{\"id\":\"c_tax\",\"std\":false,\"label\":\"税费\",\"aliases\":[],\"slot\":\"other\",\"hidden\":false,\"w\":null}"
            + "]}]}";
        Set<String> cs = TemplateDef.changeSet(defOf(base3()), defOf(changed));
        assertThat(cs).hasSize(5);   // 别名 + 隐藏 + 改名 + 换槽 + 新增列
    }

    @Test
    void chainOrdered_trueWhenStrictlyNested_falseWhenSiblingsDiverge() {
        // v1=base, v2=base+改名, v3=v2+新增列 → 严格包含
        String v2 = base3().replace("商铺、宿舍租金", "商铺租金");
        String v3 = v2.replace("\"hidden\":false,\"w\":null}"
                + "]}]}",
              "\"hidden\":false,\"w\":null},"
                + "{\"id\":\"c_tax\",\"std\":false,\"label\":\"税费\",\"aliases\":[],\"slot\":\"other\",\"hidden\":false,\"w\":null}"
                + "]}]}");
        TemplateDef.Def base = defOf(base3());
        assertThat(TemplateDef.chainOrdered(List.of(defOf(base3()), defOf(v2), defOf(v3)), base)).isTrue();

        // 互不包含:一个改名、一个换槽,谁也不含谁
        String sibA = base3().replace("商铺、宿舍租金", "商铺租金");
        String sibB = base3().replace("\"slot\":\"rent\",\"hidden\":false,\"w\":null},"
                + "{\"id\":\"shopRent\"", "\"slot\":\"misc\",\"hidden\":false,\"w\":null},"
                + "{\"id\":\"shopRent\"");
        assertThat(TemplateDef.chainOrdered(List.of(defOf(base3()), defOf(sibA), defOf(sibB)), base)).isFalse();
    }
```

同时在文件头部 import 区补上（若尚未存在）：

```java
import java.util.List;
import java.util.Set;
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && ./mvnw -o test -Dtest=TemplateDefTest`
Expected: 编译失败，`cannot find symbol: method changeSet` / `chainOrdered`

- [ ] **Step 3: 实现**

在 `TemplateDef.java` 的 `customIds` 方法之后插入：

```java
    // ── 迁移归并用(2026-08-25):改动集合与包含性判断 ──
    // 列宽 w 是纯装饰,不参与——否则无谓的宽度差异会挡住线性链归并。

    /** x 相对 base 的改动集合。集合可比较包含关系,用来把多个变体排成一条链。 */
    public static Set<String> changeSet(Def base, Def x) {
        Set<String> out = new LinkedHashSet<>();
        var bm = new java.util.LinkedHashMap<String, Col>();
        for (Col c : flatten(base)) bm.put(c.id(), c);
        var xm = new java.util.LinkedHashMap<String, Col>();
        for (Col c : flatten(x)) xm.put(c.id(), c);
        for (String id : xm.keySet()) if (!bm.containsKey(id)) out.add(id + "|NEW");
        for (String id : bm.keySet()) if (!xm.containsKey(id)) out.add(id + "|DROP");
        for (String id : xm.keySet()) {
            Col a = bm.get(id), b = xm.get(id);
            if (a == null) continue;
            if (!Objects.equals(a.label(), b.label()))     out.add(id + "|label|" + b.label());
            if (!Objects.equals(a.aliases(), b.aliases())) out.add(id + "|aliases|" + b.aliases());
            if (a.hidden() != b.hidden())                  out.add(id + "|hidden|" + b.hidden());
            if (!Objects.equals(a.slot(), b.slot()))       out.add(id + "|slot|" + b.slot());
        }
        return out;
    }

    /** variants 按改动集合大小升序后,是否两两严格包含(能排成一条线性链)。 */
    public static boolean chainOrdered(List<Def> variants, Def base) {
        List<Set<String>> sets = new ArrayList<>();
        for (Def d : variants) sets.add(changeSet(base, d));
        sets.sort(java.util.Comparator.comparingInt(Set::size));
        for (int i = 1; i < sets.size(); i++)
            if (!sets.get(i).containsAll(sets.get(i - 1))) return false;
        return true;
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && ./mvnw -o test -Dtest=TemplateDefTest`
Expected: PASS（原有 6 个 + 新增 4 个 = 10 个）

- [ ] **Step 5: 提交**

```bash
git add backend/src/main/java/com/park/demo3/service/TemplateDef.java backend/src/test/java/com/park/demo3/service/TemplateDefTest.java
git commit -m "feat(book): 模板改动集合与包含性判断——迁移归并的地基"
```

---

### Task 2: 迁移到全局链

**Files:**
- Create: `backend/src/main/resources/db/migration/V110__book_global_lineage.sql`
- Create: `docs/data-fix/book_template_before_global_20260825.sql`（迁移前备份，执行前生成）
- Modify: `backend/src/main/java/com/park/demo3/service/BookService.java`
- Modify: `backend/src/main/java/com/park/demo3/mapper/LedgerBookMapper.java`
- Test: `backend/src/test/java/com/park/demo3/api/BookApiIT.java`

**Interfaces:**
- Consumes: `TemplateDef.changeSet` / `chainOrdered`（Task 1）
- Produces:
  - `LedgerBookMapper.lineageHost()` → 宿主行（`screen='ledger' AND company_id IS NULL`），无则 null
  - `BookService.migrateToGlobalLineage()` — 幂等，`BookSeeder` 启动调用
  - `BookService.chainBookId(LedgerBook b)` — ledger→宿主 id，s10→自身 id

- [ ] **Step 1: 先落备份（不可跳过）**

```bash
docker exec demo3-mysql mysqldump -uroot -proot --default-character-set=utf8mb4 \
  --no-create-info --complete-insert park_demo3 ledger_book book_template_version \
  > docs/data-fix/book_template_before_global_20260825.sql
```

确认文件非空且含 `INSERT INTO \`ledger_book\``。

- [ ] **Step 2: 写 V110（只建结构，不动数据）**

```sql
-- 账册模板全局化(2026-08-25 拍板,spec: docs/superpowers/specs/2026-08-25-global-book-template-design.md):
-- 台账屏从「每司一册一链」改为「全局一条链 + 每司一个版本指针」。
-- 本迁移只放宽约束;归并逻辑在 BookService.migrateToGlobalLineage()(启动幂等)——
-- 它要判断 JSON 模板之间的包含关系,SQL 做不了,且生产分叉形态未必与本地一致,
-- 纯 SQL 撞上意外形态只会写坏数据。
--
-- company_id 已是 NULL-able(V107),宿主行 (screen='ledger', company_id=NULL) 直接可插;
-- uk_book_company 在 MySQL 下多个 NULL 互不冲突,不阻止插入。宿主行唯一性由幂等种子保证。
-- 因此本文件无 DDL:留档说明迁移边界,真正的数据搬迁由启动方法完成(幂等、可重入)。
SELECT 1;
```

- [ ] **Step 3: 写失败测试**

在 `BookApiIT.java` 里，把既有的 `seededBooks_ledgerPerCompany_andFourPhaseBooks` **保留不动**，另加：

```java
    @Test
    void lineage_allLedgerCompaniesShareOneChain_hostHidden() throws Exception {
        String body = utf8(mvc.perform(get("/api/books").param("screen", "ledger")
                .header("Authorization", auth())).andExpect(status().isOk()).andReturn());
        List<Object> companyIds = JsonPath.read(body, "$.data[*].companyId");
        // 宿主行(companyId=null)不出现在清单里
        assertThat(companyIds).doesNotContainNull();
        List<Integer> vers = JsonPath.read(body, "$.data[*].ver");
        List<Integer> latest = JsonPath.read(body, "$.data[*].latestVer");
        assertThat(latest).isNotEmpty();
        // 全局链只有一条:所有册看到的 latestVer 必须相同
        assertThat(new java.util.HashSet<>(latest)).hasSize(1);
        // 每册的 ver 都不超过链尾
        for (int i = 0; i < vers.size(); i++) assertThat(vers.get(i)).isLessThanOrEqualTo(latest.get(i));
    }

    @Test
    void lineage_migrationIsIdempotent_definitionsBytewisePreserved() throws Exception {
        String first = utf8(mvc.perform(get("/api/books").param("screen", "ledger")
                .header("Authorization", auth())).andExpect(status().isOk()).andReturn());
        // 再跑一次归并(幂等):结果必须逐字节一致
        books.migrateToGlobalLineage();
        String second = utf8(mvc.perform(get("/api/books").param("screen", "ledger")
                .header("Authorization", auth())).andExpect(status().isOk()).andReturn());
        assertThat(second).isEqualTo(first);
    }
```

在类字段区补上注入（若尚未存在）：

```java
    @Autowired com.park.demo3.service.BookService books;
```

- [ ] **Step 4: 跑测试确认失败**

Run: `cd backend && ./mvnw -o test -Dtest=BookApiIT#lineage_allLedgerCompaniesShareOneChain_hostHidden+lineage_migrationIsIdempotent_definitionsBytewisePreserved`
Expected: FAIL —— `latestVer` 字段不存在（JsonPath 读不到）/ `migrateToGlobalLineage` 未定义

- [ ] **Step 5: 加 mapper 方法**

`LedgerBookMapper.java` 追加：

```java
    /** 全局链宿主行(screen='ledger' 且 company_id IS NULL);未迁移时返回 null。 */
    default LedgerBook lineageHost() {
        return selectOne(new QueryWrapper<LedgerBook>()
            .eq("screen", "ledger").isNull("company_id").last("LIMIT 1"));
    }
    /** 台账各公司册(不含宿主行)。 */
    default List<LedgerBook> ledgerCompanyBooks() {
        return selectList(new QueryWrapper<LedgerBook>()
            .eq("screen", "ledger").isNotNull("company_id").orderByAsc("id"));
    }
```

- [ ] **Step 6: 实现归并**

`BookService.java` 新增（放在 `seedMissing` 之后）：

```java
    // ── 全局链归并(2026-08-25;幂等,BookSeeder 启动调用) ──
    // 台账屏的所有模板版本收进一条链,每司只留 current_version_id 作指针。
    // 遇到互不包含的变体 fail-fast 报名 —— 强行排成线性链会丢掉某些公司的定制。
    @Transactional
    public void migrateToGlobalLineage() {
        if (books.lineageHost() != null) return;                 // 已迁移
        List<LedgerBook> comps = books.ledgerCompanyBooks();

        LedgerBook host = new LedgerBook();
        host.setScreen("ledger"); host.setCompanyId(null); host.setName("台账通用模板");
        books.insert(host);

        if (comps.isEmpty()) {                                    // 空库:直接建出厂 v1
            initVersion(host, BookTemplates.ledgerStandard(), "建链(标准 21 列模板)", "系统");
            return;
        }

        TemplateDef.Def base = TemplateDef.parse(BookTemplates.ledgerStandard());
        // 去重:同一份定义只落一个版本(键=定义原文)
        Map<String, List<LedgerBook>> byDef = new LinkedHashMap<>();
        for (LedgerBook b : comps)
            byDef.computeIfAbsent(currentVersion(b).getDefinition(), k -> new ArrayList<>()).add(b);

        List<String> defs = new ArrayList<>(byDef.keySet());
        if (!TemplateDef.chainOrdered(defs.stream().map(TemplateDef::parse).toList(), base)) {
            String who = byDef.values().stream()
                .map(l -> l.stream().map(LedgerBook::getName).collect(Collectors.joining("/")))
                .collect(Collectors.joining(" | "));
            throw new IllegalStateException(
                "账册模板存在互不包含的变体,无法归并成一条链,请先人工归并后再启动。分组:" + who);
        }
        defs.sort(java.util.Comparator.comparingInt(d -> TemplateDef.changeSet(base, TemplateDef.parse(d)).size()));

        BookTemplateVersion tip = null;
        for (int i = 0; i < defs.size(); i++) {
            String def = defs.get(i);
            BookTemplateVersion v = new BookTemplateVersion();
            v.setBookId(host.getId()); v.setVer(i + 1); v.setDefinition(def);
            v.setNote("迁移自「" + byDef.get(def).stream().map(LedgerBook::getName)
                .collect(Collectors.joining("、")) + "」的现行版");
            v.setCreatedBy("系统");
            versions.insert(v);
            for (LedgerBook b : byDef.get(def)) {                 // 各司指针指向自己那一版
                Integer oldChain = b.getId();
                b.setCurrentVersionId(v.getId());
                books.updateById(b);
                versions.delete(new QueryWrapper<BookTemplateVersion>().eq("book_id", oldChain));
            }
            tip = v;
        }
        host.setCurrentVersionId(tip.getId());                    // 宿主停在链尾
        books.updateById(host);
    }

    /** 版本链宿主:台账屏一律走全局宿主行;s10 屏一册一链,宿主就是自己。 */
    Integer chainBookId(LedgerBook b) {
        if (!"ledger".equals(b.getScreen())) return b.getId();
        LedgerBook host = books.lineageHost();
        if (host == null) throw new IllegalStateException("台账全局模板链未初始化");
        return host.getId();
    }
```

补 import：`java.util.LinkedHashMap`、`java.util.stream.Collectors`。

- [ ] **Step 7: `list` 过滤宿主行 + `toDTO` 带 latestVer**

`BookService.list` 改为：

```java
    public List<BookDTO> list(String screen) {
        List<BookDTO> out = new ArrayList<>();
        for (LedgerBook b : books.byScreen(screen)) {
            if ("ledger".equals(screen) && b.getCompanyId() == null) continue;   // 宿主行不是账册,不进清单
            out.add(toDTO(b));
        }
        return out;
    }
```

`toDTO` 改为：

```java
    private BookDTO toDTO(LedgerBook b) {
        BookTemplateVersion v = currentVersion(b);
        return new BookDTO(b.getId(), b.getScreen(), b.getCompanyId(), b.getPhase(),
            b.getName(), v.getVer(), versions.maxVer(chainBookId(b)), readTree(v.getDefinition()));
    }
```

`BookDtos.BookDTO` 加字段（**注意 latestVer 排在 definition 之前**，与上面构造顺序一致）：

```java
    public record BookDTO(Integer id, String screen, Integer companyId, Integer phase,
                          String name, int ver, int latestVer, JsonNode definition) {}
```

- [ ] **Step 8: 挂到启动种子**

`BookSeeder.run` 改为：

```java
    @Override public void run(ApplicationArguments args) {
        books.seedMissing();
        books.migrateToGlobalLineage();
    }
```

- [ ] **Step 9: 跑测试**

Run: `cd backend && ./mvnw -o test -Dtest=BookApiIT`
Expected: 新增两条 PASS。既有 `saveTemplate_lightChange_...` / `customColWithData_...` 可能因 rollback 语义未改而 FAIL —— **这是预期的**，Task 4 会处理；此处只需确认失败原因是 rollback 相关，不是迁移相关。

- [ ] **Step 10: 提交**

```bash
git add backend/src/main/resources/db/migration/V110__book_global_lineage.sql docs/data-fix/book_template_before_global_20260825.sql backend/src/main/java/com/park/demo3/service/BookService.java backend/src/main/java/com/park/demo3/mapper/LedgerBookMapper.java backend/src/main/java/com/park/demo3/dto/BookDtos.java backend/src/main/java/com/park/demo3/config/BookSeeder.java backend/src/test/java/com/park/demo3/api/BookApiIT.java
git commit -m "feat(book): 台账模板归并成全局一条链,每司退化为版本指针(V110)"
```

---

### Task 3: 链尾编辑规则（R3/R4）与跨公司归档守卫

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/service/BookService.java`
- Test: `backend/src/test/java/com/park/demo3/api/BookApiIT.java`

**Interfaces:**
- Consumes: `chainBookId`（Task 2）
- Produces: `saveTemplate` 新行为——非链尾 409；升版后只移动原本在链尾的公司指针

- [ ] **Step 1: 写失败测试**

追加到 `BookApiIT.java`：

```java
> ⚠️ **测试环境事实（决定了下面每个用例的写法）**：IT 走 `AbstractMysqlIT` 的 **testcontainers 全新库**，
> 种子把 6 个台账册建成**完全相同**的标准模板 → 归并后链上只有 v1，**没有落后册**。
> 而且从统一状态出发**永远造不出落后册**：R4 规定每次结构改动会带走所有在链尾的册。
> 所以想测 R3/R4，必须先 `adopt` 把某一册切回旧版。**禁止用 `Assumptions.assumeTrue` 跳过**——
> 那会让这些用例在 CI 里静默不跑，等于没写。

```java
    private static final com.fasterxml.jackson.databind.ObjectMapper OM =
            new com.fasterxml.jackson.databind.ObjectMapper();

    private String ledgerBooks() throws Exception {
        return utf8(mvc.perform(get("/api/books").param("screen", "ledger")
                .header("Authorization", auth())).andExpect(status().isOk()).andReturn());
    }

    /** 在指定册上加一个自定义列并保存(结构改动 → 升版)。 */
    private void addCustomColAtTip(int bookId, String colId, String label) throws Exception {
        String body = ledgerBooks();
        int idx = ((List<Integer>) JsonPath.read(body, "$.data[*].id")).indexOf(bookId);
        com.fasterxml.jackson.databind.JsonNode d =
                OM.readTree(OM.writeValueAsString(JsonPath.read(body, "$.data[" + idx + "].definition")));
        var col = ((com.fasterxml.jackson.databind.node.ArrayNode) d.get("groups").get(0).get("cols")).addObject();
        col.put("id", colId); col.put("std", false); col.put("label", label);
        col.put("slot", "other"); col.put("hidden", false); col.putNull("w"); col.putArray("aliases");
        mvc.perform(put("/api/books/" + bookId + "/template").header("Authorization", auth())
                .contentType("application/json").content("{\"definition\":" + d + ",\"note\":\"" + label + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.structural").value(true));
    }

    /** 造出「有落后册」的状态:链尾升到 v2(所有册跟进)→ 把首册切回 v1。
     *  返回 {落后册 id, 链尾册 id, 链尾版本号}。 */
    private int[] makeLaggingState(String probeColId) throws Exception {
        List<Integer> ids = JsonPath.read(ledgerBooks(), "$.data[*].id");
        int lagging = ids.get(0), tip = ids.get(1);
        addCustomColAtTip(tip, probeColId, "计划探针");
        int latest = ((List<Integer>) JsonPath.read(ledgerBooks(), "$.data[*].latestVer")).get(0);
        mvc.perform(post("/api/books/" + lagging + "/template/adopt").header("Authorization", auth())
                .contentType("application/json").content("{\"ver\":1}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
        return new int[]{ lagging, tip, latest };
    }

    @Test
    void saveTemplate_fromNonTipVersion_isRejected() throws Exception {
        int[] s = makeLaggingState("c_probe_r3");
        int lagging = s[0];
        String body = ledgerBooks();
        int idx = ((List<Integer>) JsonPath.read(body, "$.data[*].id")).indexOf(lagging);
        Object d = JsonPath.read(body, "$.data[" + idx + "].definition");
        assertThat((int) JsonPath.read(body, "$.data[" + idx + "].ver")).isEqualTo(1);   // 确认真的落后了
        mvc.perform(put("/api/books/" + lagging + "/template").header("Authorization", auth())
                .contentType("application/json").content("{\"definition\":" + OM.writeValueAsString(d) + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("先升")));
    }

    @Test
    void saveTemplate_structural_movesOnlyTipPinnedCompanies() throws Exception {
        int[] s = makeLaggingState("c_probe_r4a");
        int lagging = s[0], tip = s[1];

        String before = ledgerBooks();
        List<Integer> ids = JsonPath.read(before, "$.data[*].id");
        List<Integer> vers = JsonPath.read(before, "$.data[*].ver");
        int latest = ((List<Integer>) JsonPath.read(before, "$.data[*].latestVer")).get(0);
        assertThat(vers.get(ids.indexOf(lagging))).as("前置:落后册在 v1").isEqualTo(1);

        addCustomColAtTip(tip, "c_probe_r4b", "计划探针二");

        String after = ledgerBooks();
        List<Integer> vers2 = JsonPath.read(after, "$.data[*].ver");
        int latest2 = ((List<Integer>) JsonPath.read(after, "$.data[*].latestVer")).get(0);
        assertThat(latest2).isEqualTo(latest + 1);
        for (int i = 0; i < ids.size(); i++) {
            if (vers.get(i) == latest) assertThat(vers2.get(i)).as("链尾册跟进").isEqualTo(latest2);
            else assertThat(vers2.get(i)).as("落后册原地不动").isEqualTo(vers.get(i));
        }
        assertThat(vers2.get(ids.indexOf(lagging))).as("落后册仍在 v1").isEqualTo(1);
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && ./mvnw -o test -Dtest=BookApiIT#saveTemplate_fromNonTipVersion_isRejected+saveTemplate_structural_movesOnlyTipPinnedCompanies`
Expected: FAIL —— 非链尾编辑没被拦（返回 code 0），落后册被一起带走

- [ ] **Step 3: 实现**

`BookService.saveTemplate` 整体替换为：

```java
    @Transactional
    public TemplateSaveResultDTO saveTemplate(Integer bookId, TemplateSaveReq req) {
        LedgerBook b = books.selectById(bookId);
        if (b == null) throw new BizException(ResultCode.NOT_FOUND, "账册不存在");
        Integer chainId = chainBookId(b);
        BookTemplateVersion cur = currentVersion(b);
        int tipVer = versions.maxVer(chainId);
        // R3 只能在链尾编辑:允许从非链尾分叉,链就不再是一条线,"全局唯一模板"当场失效
        if (cur.getVer() != tipVer)
            throw new BizException(ResultCode.CONFLICT,
                "本册在 v" + cur.getVer() + ",最新是 v" + tipVer + " —— 请先升到 v" + tipVer + " 再改");

        String newJson = req.definition().toString();
        TemplateDef.Def oldDef = TemplateDef.parse(cur.getDefinition());
        TemplateDef.Def newDef = TemplateDef.parse(newJson);
        TemplateDef.assertStdKept(oldDef, newDef);
        assertNoDataLossOnCustomRemoval(b, oldDef, newDef);

        boolean structural = TemplateDef.structuralChange(oldDef, newDef);
        String summary = TemplateDef.diffSummary(oldDef, newDef);
        if (structural) {
            BookTemplateVersion nv = new BookTemplateVersion();
            nv.setBookId(chainId); nv.setVer(tipVer + 1);
            nv.setDefinition(newJson);
            nv.setNote(req.note() == null || req.note().isBlank() ? summary : req.note());
            nv.setCreatedBy(actor());
            versions.insert(nv);
            movePinsAtTip(b, cur.getId(), nv.getId());
            audit.log("模板修改", bookLabel(b),
                "v" + cur.getVer() + "→v" + nv.getVer() + "(结构): " + summary);
        } else {
            cur.setDefinition(newJson);          // 轻改动就地更新:只影响指向该版的册
            versions.updateById(cur);
            audit.log("模板修改", bookLabel(b), "v" + cur.getVer() + "(轻改动): " + summary);
        }
        return new TemplateSaveResultDTO(toDTO(books.selectById(bookId)), structural, summary);
    }

    // R4 编辑只带走链尾上的册:原本就指着旧链尾的(含宿主)跟进新版,落后的原地不动 —— 这是"不强制升级"的落点
    private void movePinsAtTip(LedgerBook edited, Long oldTipId, Long newTipId) {
        if (!"ledger".equals(edited.getScreen())) {          // s10:一册一链,只动自己
            edited.setCurrentVersionId(newTipId);
            books.updateById(edited);
            return;
        }
        List<LedgerBook> all = new ArrayList<>(books.ledgerCompanyBooks());
        LedgerBook host = books.lineageHost();
        if (host != null) all.add(host);
        for (LedgerBook x : all)
            if (oldTipId.equals(x.getCurrentVersionId())) {
                x.setCurrentVersionId(newTipId);
                books.updateById(x);
            }
    }
```

- [ ] **Step 4: 守卫改成跨公司（§7）**

把 `assertNoDataLossOnCustomRemoval` 与 `customColHasData` 替换为：

```java
    // ── 归档守卫(SPEC §3 + 全局化 §7):自定义列名下有历史数据 → 只许隐藏(归档),不许从模板移除 ──
    // 否则:行保存的 extraFees 整包替换会抹值,或口袋残值变成合计里看不见的钱。
    // 全局化后台账模板是所有公司共用的 —— 删列要查**所有公司**,任一家有数据就拒绝。
    private void assertNoDataLossOnCustomRemoval(LedgerBook b, TemplateDef.Def oldDef, TemplateDef.Def newDef) {
        Set<String> keep = TemplateDef.customIds(newDef);
        for (String id : TemplateDef.customIds(oldDef)) {
            if (keep.contains(id)) continue;
            long n = customColRowCount(b, id);
            if (n > 0)
                throw new BizException(ResultCode.CONFLICT,
                    "自定义列「" + id + "」名下已有 " + n + " 行数据,不能删除——请改用隐藏(归档);确需清列先清数据");
        }
    }

    /** 该列名下的数据行数。台账屏:companyId 为 null(宿主/全局编辑)时查所有公司。 */
    private long customColRowCount(LedgerBook b, String colId) {
        String jsonPath = "$.\"" + colId + "\"";
        // JSON_TYPE 而非 IS NOT NULL:{"c_x":null} 的 JSON null 不是 SQL NULL,
        // IS NOT NULL 会把空值键误判成"有数据"拦住删除;键缺席时 JSON_TYPE(SQL NULL)=NULL 不计
        String cond = "JSON_TYPE(JSON_EXTRACT(extra_fees, {0})) NOT IN ('NULL')";
        if ("ledger".equals(b.getScreen())) {
            QueryWrapper<MonthlyLedger> q = new QueryWrapper<MonthlyLedger>().apply(cond, jsonPath);
            if (b.getCompanyId() != null) q.eq("company_id", b.getCompanyId());
            return ledgerRows.selectCount(q);
        }
        return s10Rows.selectCount(new QueryWrapper<S10Record>()
            .eq("phase", b.getPhase()).apply(cond, jsonPath));
    }
```

⚠️ **注意**：`saveTemplate` 传进来的 `b` 是**公司册**（有 companyId），所以按上面的实现，链尾编辑删列只查该公司。这不符合 §7。修正：在 `saveTemplate` 里调用守卫时，台账屏传宿主行：

```java
        assertNoDataLossOnCustomRemoval(
            "ledger".equals(b.getScreen()) ? books.lineageHost() : b, oldDef, newDef);
```

- [ ] **Step 5: 加跨公司守卫测试**

```java
> 这条要测的是**跨公司**：模板全局共用，A 公司在某列有数据时，**从 B 公司的册**发起删列也必须被拦。
> 全新库里没有现成数据，前提得自己造。

```java
    @Test
    void tipEdit_removingCustomCol_blockedByAnotherCompanysData() throws Exception {
        // ① 链尾加一列(所有在链尾的册跟进,含 company 1 与 company 2)
        String body0 = ledgerBooks();
        List<Integer> ids = JsonPath.read(body0, "$.data[*].id");
        List<Integer> cids = JsonPath.read(body0, "$.data[*].companyId");
        int bookOfC1 = ids.get(cids.indexOf(1));
        int otherBook = ids.get(cids.indexOf(1) == 0 ? 1 : 0);      // 另一家公司的册
        addCustomColAtTip(bookOfC1, "c_xcheck", "跨司探针");

        // ② 只给 company 1 的台账写这列的数据
        mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "11")
                .header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"跨司探针户\",\"extraFees\":{\"c_xcheck\":50}}]}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.imported").value(1));

        // ③ 从**另一家公司**的册发起删列 → 必须被 company 1 的数据拦下(§7 跨公司检查)
        String body = ledgerBooks();
        int oIdx = ((List<Integer>) JsonPath.read(body, "$.data[*].id")).indexOf(otherBook);
        com.fasterxml.jackson.databind.JsonNode d =
                OM.readTree(OM.writeValueAsString(JsonPath.read(body, "$.data[" + oIdx + "].definition")));
        for (com.fasterxml.jackson.databind.JsonNode g : d.get("groups")) {
            var cols = (com.fasterxml.jackson.databind.node.ArrayNode) g.get("cols");
            for (int i = cols.size() - 1; i >= 0; i--)
                if ("c_xcheck".equals(cols.get(i).get("id").asText())) cols.remove(i);
        }
        mvc.perform(put("/api/books/" + otherBook + "/template").header("Authorization", auth())
                .contentType("application/json").content("{\"definition\":" + d + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("不能删除")));

        // 清理:删掉那行,免得污染同库里的其他用例
        String nov = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/11")
                .header("Authorization", auth())).andReturn());
        Number rowId = JsonPath.read(nov, "$.data.rows[0].id");
        mvc.perform(put("/api/ledger/companies/1/months/2026/11").header("Authorization", auth())
                .contentType("application/json").content("{\"rows\":[{\"id\":" + rowId + "}]}"))
                .andExpect(status().isOk());
    }
```

> `ledgerBooks()` / `addCustomColAtTip` / `OM` 是本任务 Step 1 建的辅助方法，直接复用。
```

- [ ] **Step 6: 跑测试**

Run: `cd backend && ./mvnw -o test -Dtest=BookApiIT`
Expected: 本任务三条 PASS；rollback 相关的既有两条仍 FAIL（Task 4 处理）

- [ ] **Step 7: 提交**

```bash
git add backend/src/main/java/com/park/demo3/service/BookService.java backend/src/test/java/com/park/demo3/api/BookApiIT.java
git commit -m "feat(book): 只能在链尾编辑,升版只带走链尾上的公司;删列改为跨公司查数据"
```

---

### Task 4: `adopt` 取代 `rollback`（R2/R6/R7/R8）

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/service/BookService.java`
- Modify: `backend/src/main/java/com/park/demo3/controller/BookController.java`
- Modify: `backend/src/main/java/com/park/demo3/dto/BookDtos.java`
- Test: `backend/src/test/java/com/park/demo3/api/BookApiIT.java`

**Interfaces:**
- Produces: `POST /api/books/{id}/template/adopt`，body `{"ver": N}` → `BookDTO`
- 移除：`POST /api/books/{id}/template/rollback` 与 `BookService.rollback`

- [ ] **Step 1: 改既有测试到新语义**

`BookApiIT` 里两条既有用例改名并换断言。

`saveTemplate_lightChange_keepsVersion_structuralBumps_rollbackForwards`
→ 改名 `saveTemplate_lightChange_keepsVersion_structuralBumps_adoptSwitchesPin`。
把结尾「回滚 → 版本号前进」那段（调用 `/template/rollback` 并断言 `ver` 变大）整段替换为：

```java
        // adopt 切指针:本册 ver 变成目标版,链尾 latestVer 不变(R7:切指针不造版本)
        int tipBefore = JsonPath.read(utf8(mvc.perform(get("/api/books").param("screen", "ledger")
                .header("Authorization", auth())).andReturn()), "$.data[0].latestVer");
        mvc.perform(post("/api/books/" + bookId + "/template/adopt").header("Authorization", auth())
                .contentType("application/json").content("{\"ver\":1}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.ver").value(1));
        int tipAfter = JsonPath.read(utf8(mvc.perform(get("/api/books").param("screen", "ledger")
                .header("Authorization", auth())).andReturn()), "$.data[0].latestVer");
        assertThat(tipAfter).isEqualTo(tipBefore);
```

`customColWithData_cannotBeRemoved_hideAllowed_rollbackGuardedToo`
→ 改名 `customColWithData_cannotBeRemoved_hideAllowed_adoptGuardedToo`。
把其中调用 `/template/rollback` 的那一处改为 `/template/adopt`，请求体与 409 断言不变。

- [ ] **Step 2: 写新失败测试**

```java
> 同样的环境事实：全新库里没有任何自定义列数据，R6 的「有数据」前提**必须自己造**——
> 先在链尾加列升版，再往那列导一行钱进去，然后才谈得上"降级会藏钱"。

```java
    @Test
    void adopt_crossVersionJumpToTip_doesNotCreateVersion() throws Exception {
        // 造出三版链:v1(种子) → v2 → v3
        List<Integer> ids0 = JsonPath.read(ledgerBooks(), "$.data[*].id");
        int book = ids0.get(0), other = ids0.get(1);
        addCustomColAtTip(other, "c_jump_a", "跳版探针A");
        addCustomColAtTip(other, "c_jump_b", "跳版探针B");
        int latest = ((List<Integer>) JsonPath.read(ledgerBooks(), "$.data[*].latestVer")).get(0);
        assertThat(latest).isEqualTo(3);

        // 先退到 v1,再一步跳到链尾(R8:不必逐版爬)
        mvc.perform(post("/api/books/" + book + "/template/adopt").header("Authorization", auth())
                .contentType("application/json").content("{\"ver\":1}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.ver").value(1));
        mvc.perform(post("/api/books/" + book + "/template/adopt").header("Authorization", auth())
                .contentType("application/json").content("{\"ver\":" + latest + "}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.ver").value(latest));

        // R7:切指针不造新版本 —— 链尾纹丝不动
        assertThat(((List<Integer>) JsonPath.read(ledgerBooks(), "$.data[*].latestVer")).get(0))
                .isEqualTo(latest);
    }

    @Test
    void adopt_downgradeBlockedWhenCustomColumnHasData() throws Exception {
        // ① 链尾加一列并升版(所有在链尾的册跟进)
        String body0 = ledgerBooks();
        List<Integer> ids = JsonPath.read(body0, "$.data[*].id");
        List<Integer> cids = JsonPath.read(body0, "$.data[*].companyId");
        int cIdx = cids.indexOf(1);                       // 用 companyId=1 的册,种子必有
        int bookId = ids.get(cIdx);
        addCustomColAtTip(bookId, "c_guard_probe", "守卫探针");

        // ② 往该列导一行钱进去 —— 有数据才谈得上"降级会藏钱"
        mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "12")
                .header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"守卫探针户\",\"extraFees\":{\"c_guard_probe\":100}}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1));

        // ③ 降到不含该列的 v1 → 被守卫拦下(R6)
        mvc.perform(post("/api/books/" + bookId + "/template/adopt").header("Authorization", auth())
                .contentType("application/json").content("{\"ver\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("已有")));

        // 清理:删掉这行,免得污染同库里的其他用例
        String dec = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/12")
                .header("Authorization", auth())).andReturn());
        Number rowId = JsonPath.read(dec, "$.data.rows[0].id");
        mvc.perform(put("/api/ledger/companies/1/months/2026/12").header("Authorization", auth())
                .contentType("application/json").content("{\"rows\":[{\"id\":" + rowId + "}]}"))
                .andExpect(status().isOk());
    }
```

> 用例之间共用同一个 testcontainers 库且**链只追加**，所以 `c_jump_a` / `c_probe_r3` 这些探针列
> 会累积在链尾版本上。这不影响断言（每条用例只看自己关心的版本号增量与拦截行为），
> 但**探针列 id 必须各不相同**，否则重复 id 会撞 `TemplateDef.validate` 的「列 id 重复」。
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd backend && ./mvnw -o test -Dtest=BookApiIT#adopt_upgradeToTip_thenDowngradeBlockedWhenColumnHasData`
Expected: FAIL —— 404，`/adopt` 路由不存在

- [ ] **Step 4: 实现 service**

把 `BookService.rollback` 整体替换为：

```java
    /** 切本公司的版本指针(R7:取代旧「回滚=复制历史版为新版本」)。链只追加,切指针不造版本。 */
    @Transactional
    public BookDTO adopt(Integer bookId, int ver) {
        LedgerBook b = books.selectById(bookId);
        if (b == null) throw new BizException(ResultCode.NOT_FOUND, "账册不存在");
        BookTemplateVersion target = versions.byBook(chainBookId(b)).stream()
            .filter(v -> v.getVer() == ver).findFirst()
            .orElseThrow(() -> new BizException(ResultCode.NOT_FOUND, "版本不存在"));
        BookTemplateVersion cur = currentVersion(b);
        if (target.getId().equals(cur.getId())) return toDTO(b);          // 已在该版:幂等
        // R6 切到缺列的版本同样受归档守卫:名下有数据的自定义列不许因切版蒸发
        // (口袋残值仍进 recalc 应收合计,列却不显示 → 合计永远对不上明细)
        assertNoDataLossOnCustomRemoval(b, TemplateDef.parse(cur.getDefinition()),
                                           TemplateDef.parse(target.getDefinition()));
        b.setCurrentVersionId(target.getId());
        books.updateById(b);
        audit.log("模板切版", bookLabel(b), "v" + cur.getVer() + "→v" + ver);
        return toDTO(books.selectById(bookId));
    }
```

- [ ] **Step 5: 改 controller 与 DTO**

`BookController`：把 `rollback` 方法替换为

```java
    @Operation(summary = "切本册的模板版本指针(不造新版本;缺列且有数据 409)")
    @PostMapping("/{id}/template/adopt")
    public BookDTO adopt(@PathVariable Integer id, @Valid @RequestBody AdoptReq req) {
        return svc.adopt(id, req.ver());
    }
```

`BookDtos`：`RollbackReq` 改名

```java
    public record AdoptReq(@NotNull Integer ver) {}
```

- [ ] **Step 6: 挪权限门（漏了它新端点就是裸奔的）**

`PermissionRegistry.java:119` 现在按路径挂门：`add(HttpMethod.POST, "/api/books/*/template/rollback", Perm.BOOK_TEMPLATE_EDIT);`
路径改名后这条规则**匹配不上任何端点**，`/adopt` 会变成任何登录用户都能调。改为：

```java
        add(HttpMethod.POST, "/api/books/*/template/adopt",    Perm.BOOK_TEMPLATE_EDIT);
```

补一条守门测试到 `BookApiIT`（`viewer` 账号只读，见 `application-dev.yml` 的 `VIEWER_PASSWORD:viewer123`）：

```java
    @Test
    void adopt_requiresBookTemplateEditPerm() throws Exception {
        String vt = JsonPath.read(mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"viewer\",\"password\":\"viewer123\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(),
                "$.data.token");
        String body = utf8(mvc.perform(get("/api/books").param("screen", "ledger")
                .header("Authorization", auth())).andReturn());
        int id = ((List<Integer>) JsonPath.read(body, "$.data[*].id")).get(0);
        mvc.perform(post("/api/books/" + id + "/template/adopt").header("Authorization", "Bearer " + vt)
                .contentType("application/json").content("{\"ver\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(403));
    }
```

若 `viewer` 账号在测试环境未创建，改用 `PermissionRegistryTest` 风格的注册表断言：断言 `/api/books/*/template/adopt` 在注册表里映射到 `Perm.BOOK_TEMPLATE_EDIT`，且不存在 `.../rollback` 的残留条目。

- [ ] **Step 7: 跑全套后端测试**

Run: `cd backend && ./mvnw -o test`
Expected: 全绿。s10 相关用例**未改一字**仍通过（Global Constraints 第一条）

- [ ] **Step 8: 提交**

```bash
git add backend/src/main/java/com/park/demo3/service/BookService.java backend/src/main/java/com/park/demo3/controller/BookController.java backend/src/main/java/com/park/demo3/dto/BookDtos.java backend/src/main/java/com/park/demo3/security/PermissionRegistry.java backend/src/test/java/com/park/demo3/api/BookApiIT.java
git commit -m "feat(book): rollback 改名 adopt 并改语义——切本册指针,不造新版本;权限门同步挪路径"
```

---

### Task 5: 前端升级态与 SPEC 同步

**Files:**
- Modify: `frontend/src/types/book.ts`
- Modify: `frontend/src/api/books.ts`
- Modify: `frontend/src/components/fp/TemplateEditorPanel.vue`
- Modify: `frontend/src/views/ledger/LedgerView.vue`
- Modify: `frontend/src/views/ledger/LedgerWideTable.vue`
- Modify: `docs/design/BOOK-WORKBENCH-SPEC.md`
- Test: `frontend/src/components/fp/templateEditor.spec.ts`

**Interfaces:**
- Consumes: `Book.latestVer`（Task 2）、`POST /template/adopt`（Task 4）
- Produces: `TemplateEditorPanel` 新 emit `(e: 'adopt', ver: number)`，取代 `'rollback'`

- [ ] **Step 1: 写失败测试**

追加到 `templateEditor.spec.ts`：

```ts
  it('落后版:显示当前/最新与升级按钮,编辑门关闭', async () => {
    const w = mountPanel({ book: { ...baseBook, ver: 2, latestVer: 4 } })
    expect(w.text()).toContain('当前 v2')
    expect(w.text()).toContain('最新 v4')
    expect(w.find('.te-upgrade').exists()).toBe(true)
    expect(w.find('.te-editbtn').attributes('disabled')).toBeDefined()
  })

  it('链尾:显示已是最新,无升级按钮,编辑门开着', async () => {
    const w = mountPanel({ book: { ...baseBook, ver: 4, latestVer: 4 } })
    expect(w.text()).toContain('已是最新')
    expect(w.find('.te-upgrade').exists()).toBe(false)
    expect(w.find('.te-editbtn').attributes('disabled')).toBeUndefined()
  })

  it('点升级按钮 emit adopt(链尾版本号)', async () => {
    const w = mountPanel({ book: { ...baseBook, ver: 2, latestVer: 4 } })
    await w.find('.te-upgrade').trigger('click')
    expect(w.emitted('adopt')?.[0]).toEqual([4])
  })
```

`mountPanel` 与 `baseBook` 沿用该 spec 文件里既有的挂载辅助；若 `baseBook` 尚无 `latestVer`，给它补上 `latestVer: 1`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/components/fp/templateEditor.spec.ts`
Expected: FAIL —— 找不到 `.te-upgrade`

- [ ] **Step 3: 改类型与 API**

`types/book.ts` 的 `Book` 接口，在 `ver` 之后加：

```ts
  latestVer: number          // 全局链链尾版本号(§R5:ver < latestVer 即有新版可升)
```

`api/books.ts`：把 `rollback` 换成

```ts
  // 切本册的模板版本指针(不造新版本;缺列且该册有数据 → 409)
  adopt: (bookId: number, ver: number): Promise<Book> =>
    http.post(`/books/${bookId}/template/adopt`, { ver }),
```

- [ ] **Step 4: 改面板**

`TemplateEditorPanel.vue`：

emit 声明里 `(e: 'rollback', ver: number): void` 改为 `(e: 'adopt', ver: number): void`。

新增 computed（放在 `props` 之后）：

```ts
// R5 升级提示:落后于链尾时给一条状态 + 一个按钮,链尾时只给一句"已是最新"(同高,不塌陷)
const behind = computed(() => !!props.book && props.book.ver < props.book.latestVer)
```

`enterEdit` 开头补一道门（R3：不在链尾不许改）：

```ts
  if (behind.value) return
```

模板里 `te-editbtn` 那个按钮加 `:disabled="behind"`，并在它前面插入状态行：

```html
          <div class="te-lineage">
            <span v-if="behind">当前 v{{ book.ver }} · 最新 v{{ book.latestVer }}</span>
            <span v-else>当前 v{{ book.ver }} · 已是最新</span>
            <button v-if="behind" class="te-upgrade" type="button" :disabled="!canEdit"
                    @click="emit('adopt', book.latestVer)">升到 v{{ book.latestVer }}</button>
          </div>
```

版本列表里那个「回滚为新版本」按钮改成切版：

```html
              <button v-if="mode === 'edit' && !v.current" class="te-adopt" @click.stop="emit('adopt', v.ver)">切到此版</button>
```

样式：把既有的 `.te-rollback` 规则名改成 `.te-adopt`，另加

```css
/* 升级提示:两态同高,有没有新版都不挪版(LAYOUT-STABILITY §2 优先级 1) */
.te-lineage { display:flex; align-items:center; gap:8px; min-height:26px; font-size:var(--fs-label); color:var(--text-muted); }
.te-upgrade {
  padding:2px 10px; border:1px solid var(--status-warning); border-radius:var(--radius-full);
  background:transparent; color:var(--status-warning); cursor:pointer; font-size:var(--fs-micro);
}
.te-upgrade:disabled { border-color:var(--border-subtle); color:var(--text-disabled); cursor:not-allowed; }
```

- [ ] **Step 5: 改宿主与工具条角标**

`LedgerView.vue`：`@rollback="onTplRollback"` 改为 `@adopt="onTplAdopt"`；把 `onTplRollback` 改名 `onTplAdopt`，内部 `booksApi.rollback` 改 `booksApi.adopt`。

`LedgerWideTable.vue` 已经收 `book: Book | null` 作 prop（第 27 行），角标直接用它，**不新增参数**。

在 `<script setup>` 里加：

```ts
// R5 角标:落后于链尾时在「账册模板」按钮上点一个点(不改按钮尺寸,有无新版都不挪版)
const tplBehind = computed(() => !!props.book && props.book.ver < props.book.latestVer)
```

浏览态那个按钮（第 240 行附近）改成：

```html
          <Button variant="outline" size="sm" @click="emit('edit-template')">
            <template #leading><component :is="iconFor('table-2')" :size="14" /></template>
            账册模板<span v-if="tplBehind" class="lg-tpldot" title="有新版模板可升级"></span>
          </Button>
```

```css
/* 角标:不改变按钮尺寸,只在文字后加一个点 —— 有无新版都不挪版 */
.lg-tpldot { display:inline-block; width:6px; height:6px; margin-left:5px; border-radius:50%; background:var(--status-warning); }
```

- [ ] **Step 6: 跑前端测试**

Run: `cd frontend && npx vitest run`
Expected: 全绿（含 `noInteractionLayoutShift.spec.ts` 的挪版门禁）

- [ ] **Step 7: 同步 SPEC**

`docs/design/BOOK-WORKBENCH-SPEC.md` 里「账册模板入口与第16权限点」那段之后，追加：

```markdown
**模板全局化(2026-08-25 拍板,取代 §2「每司一册一链」)**:台账屏所有模板版本挂在**一条全局链**上,
每家公司只持有一个版本指针(`current_version_id`)。规则:只能在链尾编辑;保存升版后**只带走原本
就在链尾的公司**,落后的原地不动;升级入口是模板面板顶部的「升到 vN」,不强制;切到缺列的版本时,
该公司在那些自定义列名下有数据则拒绝(口袋残值仍进 recalc 应收合计,列却不显示 → 合计对不上明细)。
「回滚」退化为切指针,链只追加不改写。完整规则见 docs/superpowers/specs/2026-08-25-global-book-template-design.md。
附表10 屏不在此列:它按期区分册,维持一册一链。
```

- [ ] **Step 8: 全量回归**

Run: `cd backend && ./mvnw -o test` 与 `cd frontend && npx vitest run`
Expected: 两边全绿

- [ ] **Step 9: 提交**

```bash
git add frontend/src/types/book.ts frontend/src/api/books.ts frontend/src/components/fp/TemplateEditorPanel.vue frontend/src/components/fp/templateEditor.spec.ts frontend/src/views/ledger/LedgerView.vue frontend/src/views/ledger/LedgerWideTable.vue docs/design/BOOK-WORKBENCH-SPEC.md
git commit -m "feat(book): 模板面板升级态与工具条角标;SPEC 同步全局链规则"
```
