# 按月独立的账册模板 pin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 模板版本指针从「每册一个」改为「每册每月一个」；已录入的月份定稿冻结；归档列在有钱的月份仍然显示。

**Architecture:** 新表 `book_month_pin` 持有 (screen, owner, 年, 月) → version_id。读某月的模板按「本月 pin → 最近更早月份 pin → 链尾」解析。版本变为完全不可变（任何保存都升版），月份一旦落库数据就固化 pin 并冻结。归档列的显示由后端在月度 DTO 里回传 `archivedCols`，前端追加为只读列。

**Tech Stack:** Spring Boot 3.3.5 / JDK 17 / MyBatis-Plus / Flyway / MySQL 8 / Vue 3 + TypeScript / Vitest

**Spec:** `docs/superpowers/specs/2026-08-26-per-month-template-pin-design.md`

## Global Constraints

- **`LedgerService.recalc` 与 `ExtraFees.sum` 一行不许动。** 让 recalc 跳过隐藏列会使历史月应收变小 → `balanceEnd` 变 → 结余链被改坏。hidden 只往显示侧修（spec §2）。
- **台账与附表10 两屏同做。** 每个后端规则、每条前端渲染改动都要覆盖 `ledger` 与 `s10`；上一轮 s10 被 R3 误伤已经演示过语义分叉的代价。
- **`s10_record.acct_month` 是 `CHAR(7)` 的 `'YYYY-MM'`**；`monthly_ledger` 是 `period_year`/`period_month` 两个整数列。`book_month_pin` 统一用整数列，s10 侧要拆/拼。
- **自定义列 id 白名单** `c_[a-z0-9_]+`（`TemplateDef.validate`）——它拼进 SQL 的 JSON path，不许放宽。
- **标准列不可删**（`TemplateDef.assertStdKept`）——不动。
- 集成测试走 `AbstractMysqlIT` 的 **testcontainers 全新库**，种子里各册模板相同、链上只有 v1。任何需要「多版本 / 落后月份 / 有数据的月份」的用例，**前置状态必须自己造**，禁止用 `Assumptions.assumeTrue` 跳过。
- 后端：`cd backend && ./mvnw -o test -Dtest=<类名>`（全量约 14 分钟）。前端：`cd frontend && npx vitest run <路径>`。
- 提交信息用中文、句末不加句号，末尾加 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。只提交不 push。

## 文件结构

| 文件 | 职责 |
|---|---|
| `entity/BookMonthPin.java`（新） | pin 行实体 |
| `mapper/BookMonthPinMapper.java`（新） | `at()` 精确取、`latestBefore()` 往前找、`existsAny()` 幂等键 |
| `service/BookPinService.java`（新） | **解析 / 固化 / 冻结判定**——独立成类，不塞进已有 380 行的 `BookService` |
| `service/BookService.java` | 版本链与模板保存；改为不可变升版，删掉删列守卫 |
| `service/LedgerService.java` / `S10Service.java` | 写路径末尾调固化；月度 DTO 带 `archivedCols` |
| `dto/BookDtos.java` | `AdoptReq`→`PinReq`，新增 `ArchivedColDTO` |
| `security/Perm.java` / `PermissionRegistry.java` | 第 17 点 |
| `utils/bookTemplate.ts` | 列构建接受 archived 列 |
| `components/fp/TemplateEditorPanel.vue` | 版本选择器、冻结态 |

---

### Task 1: pin 表、解析与迁移

**Files:**
- Create: `backend/src/main/resources/db/migration/V111__book_month_pin.sql`
- Create: `backend/src/main/java/com/park/demo3/entity/BookMonthPin.java`
- Create: `backend/src/main/java/com/park/demo3/mapper/BookMonthPinMapper.java`
- Create: `backend/src/main/java/com/park/demo3/service/BookPinService.java`
- Modify: `backend/src/main/java/com/park/demo3/config/BookSeeder.java`
- Test: `backend/src/test/java/com/park/demo3/service/BookPinResolveTest.java`（新，纯单测 + mock）

**Interfaces:**
- Produces:
  - `BookPinService.resolve(String screen, Integer ownerId, int year, int month, Integer chainBookId)` → `Long versionId`
  - `BookPinService.materialize(String screen, Integer ownerId, int year, int month, Long versionId)` → void（已有 pin 则 no-op）
  - `BookPinService.migrateExisting()` → void（幂等）
  - `BookMonthPinMapper.at / latestBefore / existsAny`

- [ ] **Step 1: 建表迁移**

```sql
-- 账册模板 pin 按月独立(2026-08-26 拍板,spec: docs/superpowers/specs/2026-08-26-per-month-template-pin-design.md):
-- 版本指针从「每册一个」改为「每册每月一个」。台账 owner=company_id,附表10 owner=phase。
-- 建表在这里,回填放 BookPinService.migrateExisting()(启动幂等)——它要按册解析当前版本,SQL 表达不便。
CREATE TABLE book_month_pin (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  screen       VARCHAR(12)     NOT NULL COMMENT 'ledger | s10',
  owner_id     INT UNSIGNED    NOT NULL COMMENT 'ledger=company_id; s10=phase(1..4)',
  period_year  SMALLINT        NOT NULL,
  period_month TINYINT         NOT NULL,
  version_id   BIGINT UNSIGNED NOT NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_pin (screen, owner_id, period_year, period_month),
  -- 往前找最近一条(解析规则第 2 步)走这个索引
  KEY idx_pin_lookup (screen, owner_id, period_year, period_month),
  CONSTRAINT fk_pin_ver FOREIGN KEY (version_id) REFERENCES book_template_version(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 2: 实体与 mapper**

`BookMonthPin.java`：

```java
package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDateTime;

/** 某册某月生效的模板版本(2026-08-26)。owner_id:ledger=company_id, s10=phase。 */
@Data
@TableName("book_month_pin")
public class BookMonthPin {
    @TableId(type = IdType.AUTO) private Long id;
    private String screen;
    private Integer ownerId;
    private Integer periodYear;
    private Integer periodMonth;
    private Long versionId;
    private LocalDateTime createdAt;
}
```

`BookMonthPinMapper.java`：

```java
package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.BookMonthPin;

public interface BookMonthPinMapper extends BaseMapper<BookMonthPin> {
    default BookMonthPin at(String screen, Integer ownerId, int year, int month) {
        return selectOne(new QueryWrapper<BookMonthPin>().eq("screen", screen)
            .eq("owner_id", ownerId).eq("period_year", year).eq("period_month", month));
    }
    /** 严格早于 (year,month) 的最近一条(解析规则第 2 步:沿用上月,跨空月继续往前找)。 */
    default BookMonthPin latestBefore(String screen, Integer ownerId, int year, int month) {
        return selectOne(new QueryWrapper<BookMonthPin>().eq("screen", screen).eq("owner_id", ownerId)
            .apply("(period_year * 12 + period_month) < {0}", year * 12 + month)
            .orderByDesc("period_year").orderByDesc("period_month").last("LIMIT 1"));
    }
    default boolean existsAny() { return selectCount(new QueryWrapper<>()) > 0; }
}
```

- [ ] **Step 3: 写失败测试**

`BookPinResolveTest.java`：

```java
package com.park.demo3.service;
import com.park.demo3.entity.BookMonthPin;
import com.park.demo3.mapper.BookMonthPinMapper;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import static org.assertj.core.api.Assertions.assertThat;

// 解析顺序(spec P3):本月 pin → 最近一个更早月份的 pin(跨空月) → 链尾。
class BookPinResolveTest {
    BookMonthPinMapper pins = Mockito.mock(BookMonthPinMapper.class);
    BookService bookSvc = Mockito.mock(BookService.class);
    BookPinService svc = new BookPinService(pins, bookSvc);

    static BookMonthPin pin(long verId) { BookMonthPin p = new BookMonthPin(); p.setVersionId(verId); return p; }

    @Test
    void resolve_prefersExplicitPinOfThatMonth() {
        Mockito.when(pins.at("ledger", 1, 2026, 3)).thenReturn(pin(77L));
        assertThat(svc.resolve("ledger", 1, 2026, 3, 9)).isEqualTo(77L);
        Mockito.verify(pins, Mockito.never()).latestBefore(Mockito.any(), Mockito.any(), Mockito.anyInt(), Mockito.anyInt());
    }

    @Test
    void resolve_fallsBackToNearestEarlierPin_acrossEmptyMonths() {
        Mockito.when(pins.at("ledger", 1, 2026, 5)).thenReturn(null);
        Mockito.when(pins.latestBefore("ledger", 1, 2026, 5)).thenReturn(pin(42L));   // 可能是 2026-01
        assertThat(svc.resolve("ledger", 1, 2026, 5, 9)).isEqualTo(42L);
    }

    @Test
    void resolve_fallsBackToChainTip_whenBookHasNoPinAtAll() {
        Mockito.when(pins.at("ledger", 1, 2026, 5)).thenReturn(null);
        Mockito.when(pins.latestBefore("ledger", 1, 2026, 5)).thenReturn(null);
        Mockito.when(bookSvc.tipVersionId(9)).thenReturn(5L);
        assertThat(svc.resolve("ledger", 1, 2026, 5, 9)).isEqualTo(5L);
    }

    @Test
    void materialize_isNoOpWhenPinAlreadyExists() {
        Mockito.when(pins.at("ledger", 1, 2026, 3)).thenReturn(pin(77L));
        svc.materialize("ledger", 1, 2026, 3, 99L);
        Mockito.verify(pins, Mockito.never()).insert(Mockito.any());
    }

    @Test
    void materialize_insertsWhenAbsent() {
        Mockito.when(pins.at("ledger", 1, 2026, 3)).thenReturn(null);
        svc.materialize("ledger", 1, 2026, 3, 99L);
        Mockito.verify(pins, Mockito.times(1)).insert(Mockito.any(BookMonthPin.class));
    }
}
```

- [ ] **Step 4: 跑测试确认失败**

Run: `cd backend && ./mvnw -o test -Dtest=BookPinResolveTest`
Expected: 编译失败，`BookPinService` / `BookService.tipVersionId` 不存在

- [ ] **Step 5: 实现 BookPinService**

```java
package com.park.demo3.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.BookMonthPin;
import com.park.demo3.mapper.BookMonthPinMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 模板 pin 的解析 / 固化 / 冻结判定(spec 2026-08-26 §3)。
 * 独立成类:BookService 已经在管版本链与模板保存,再把按月语义塞进去会变成什么都管的大类。
 */
@Service
public class BookPinService {
    private final BookMonthPinMapper pins;
    private final BookService books;

    public BookPinService(BookMonthPinMapper pins, BookService books) {
        this.pins = pins; this.books = books;
    }

    /** P3 解析:本月 pin → 最近一个更早月份的 pin(跨空月) → 该册链尾。 */
    public Long resolve(String screen, Integer ownerId, int year, int month, Integer chainBookId) {
        BookMonthPin here = pins.at(screen, ownerId, year, month);
        if (here != null) return here.getVersionId();
        BookMonthPin earlier = pins.latestBefore(screen, ownerId, year, month);
        if (earlier != null) return earlier.getVersionId();
        return books.tipVersionId(chainBookId);
    }

    /** P6 固化:该月第一次落库数据时把当时解析出的版本钉死。已有 pin 则不动。 */
    @Transactional
    public void materialize(String screen, Integer ownerId, int year, int month, Long versionId) {
        if (pins.at(screen, ownerId, year, month) != null) return;
        BookMonthPin p = new BookMonthPin();
        p.setScreen(screen); p.setOwnerId(ownerId);
        p.setPeriodYear(year); p.setPeriodMonth(month); p.setVersionId(versionId);
        pins.insert(p);
    }

    /** 显式钉版(选择器)。与 materialize 不同:已有 pin 时覆盖。 */
    @Transactional
    public void pin(String screen, Integer ownerId, int year, int month, Long versionId) {
        BookMonthPin ex = pins.at(screen, ownerId, year, month);
        if (ex == null) { materialize(screen, ownerId, year, month, versionId); return; }
        ex.setVersionId(versionId);
        pins.updateById(ex);
    }
}
```

`BookService` 补一个公开方法（`chainBookId` 已存在，包内可见）：

```java
    /** 某条链的链尾版本 id。 */
    public Long tipVersionId(Integer chainBookId) {
        BookTemplateVersion top = versions.selectOne(new QueryWrapper<BookTemplateVersion>()
            .eq("book_id", chainBookId).orderByDesc("ver").last("LIMIT 1"));
        if (top == null) throw new IllegalStateException("账册链没有任何版本:" + chainBookId);
        return top.getId();
    }
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd backend && ./mvnw -o test -Dtest=BookPinResolveTest`
Expected: PASS（5 条）

- [ ] **Step 7: 回填迁移**

`BookPinService` 追加：

```java
    /** 回填(幂等,BookSeeder 启动调用):已有数据的每个月钉上该册当时的现行版。
     *  没数据的月份不建行 —— 靠 resolve 兜,少一堆没人看的行。 */
    @Transactional
    public void migrateExisting() {
        if (pins.existsAny()) return;                       // 幂等键
        for (Object[] row : books.existingLedgerMonths())   // {companyId, year, month, versionId}
            materialize("ledger", (Integer) row[0], (Integer) row[1], (Integer) row[2], (Long) row[3]);
        for (Object[] row : books.existingS10Months())      // {phase, year, month, versionId}
            materialize("s10", (Integer) row[0], (Integer) row[1], (Integer) row[2], (Long) row[3]);
        books.clearLedgerCompanyPointers();                 // 见下:作废的字段要真的作废
    }
```

`BookService` 追加（**必须在上面两个 `existing*Months()` 读完之后才调**，它们依赖这个字段）：

```java
    /** 迁移收尾(spec §5):台账公司册的 current_version_id 就此作废 —— 版本改由 book_month_pin 持有。
     *  留一个半死不活的字段,迟早有人拿它当"当前版"用。宿主行与 s10 期区册的那一列仍是链尾标记,不动。 */
    @Transactional
    public void clearLedgerCompanyPointers() {
        for (LedgerBook b : books.ledgerCompanyBooks())
            books.update(null, new com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper<LedgerBook>()
                .eq("id", b.getId()).set("current_version_id", null));
    }
```

⚠ 用 `UpdateWrapper.set(...)` 显式置 NULL：MyBatis-Plus 的 `updateById` **跳过 null 字段**，
`b.setCurrentVersionId(null); books.updateById(b)` 不会把它写成 NULL
（本仓已有同款坑，见 `LedgerService.bindRow` 的解绑注释）。

`BookService` 追加两个取数方法（`acct_month` 是 `'YYYY-MM'`，在这里拆）：

```java
    /** 已有台账数据的 (公司, 年, 月) 及该公司册当时的现行版 id。 */
    public List<Object[]> existingLedgerMonths() {
        List<Object[]> out = new ArrayList<>();
        for (LedgerBook b : books.ledgerCompanyBooks()) {
            Long ver = b.getCurrentVersionId() != null ? b.getCurrentVersionId()
                     : tipVersionId(chainBookId(b));
            for (Map<String, Object> m : ledgerRows.selectMaps(new QueryWrapper<MonthlyLedger>()
                    .select("DISTINCT period_year, period_month").eq("company_id", b.getCompanyId())))
                out.add(new Object[]{ b.getCompanyId(),
                    ((Number) m.get("period_year")).intValue(),
                    ((Number) m.get("period_month")).intValue(), ver });
        }
        return out;
    }

    /** 已有附表10 数据的 (期区, 年, 月) 及该期区册当时的现行版 id。acct_month 是 'YYYY-MM',这里拆。 */
    public List<Object[]> existingS10Months() {
        List<Object[]> out = new ArrayList<>();
        for (int phase = 1; phase <= 4; phase++) {
            LedgerBook b = books.byPhase(phase);
            if (b == null) continue;
            Long ver = b.getCurrentVersionId() != null ? b.getCurrentVersionId() : tipVersionId(b.getId());
            for (Map<String, Object> m : s10Rows.selectMaps(new QueryWrapper<S10Record>()
                    .select("DISTINCT acct_month").eq("phase", phase))) {
                String ym = String.valueOf(m.get("acct_month"));          // 'YYYY-MM'
                out.add(new Object[]{ phase, Integer.parseInt(ym.substring(0, 4)),
                                      Integer.parseInt(ym.substring(5, 7)), ver });
            }
        }
        return out;
    }
```

`BookSeeder.run` 末尾追加 `pins.migrateExisting();`（注入 `BookPinService`）。

- [ ] **Step 8: 回填的集成测试**

新增 `backend/src/test/java/com/park/demo3/api/BookPinApiIT.java`：

```java
package com.park.demo3.api;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.mapper.BookMonthPinMapper;
import com.park.demo3.service.BookPinService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import static org.assertj.core.api.Assertions.assertThat;

@AutoConfigureMockMvc
@org.springframework.transaction.annotation.Transactional
class BookPinApiIT extends AbstractMysqlIT {
    @Autowired BookMonthPinMapper pins;
    @Autowired BookPinService pinSvc;

    @Test
    void migrate_preservesEveryExistingMonthBytewise() throws Exception {
        // 迁移后每个已有月份看到的 definition,必须与该册迁移前的现行版逐字节相同(spec §7)
        for (var e : pins.selectList(new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<>())) {
            String screen = e.getScreen();
            var book = "ledger".equals(screen) ? booksMapper.byCompany(e.getOwnerId())
                                               : booksMapper.byPhase(e.getOwnerId());
            assertThat(book).as("pin 指向的册必须存在").isNotNull();
            String viaPin = versionsMapper.selectById(e.getVersionId()).getDefinition();
            String viaApi = bookSvc.templateAt(book.getId(), e.getPeriodYear(), e.getPeriodMonth())
                    .definition().toString();
            assertThat(viaApi).isEqualTo(new com.fasterxml.jackson.databind.ObjectMapper()
                    .readTree(viaPin).toString());
        }
    }

    @Test
    void migrate_isIdempotent_secondRunAddsNothing() {
        long before = pins.selectCount(new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<>());
        pinSvc.migrateExisting();
        long after = pins.selectCount(new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<>());
        assertThat(after).as("重跑不产生第二批 pin").isEqualTo(before);
    }
}
```

- [ ] **Step 9: 跑测试**

Run: `cd backend && ./mvnw -o test -Dtest=BookPinResolveTest,BookPinApiIT`
Expected: 全通过

- [ ] **Step 10: 提交**

```bash
git add backend/src/main/resources/db/migration/V111__book_month_pin.sql backend/src/main/java/com/park/demo3/entity/BookMonthPin.java backend/src/main/java/com/park/demo3/mapper/BookMonthPinMapper.java backend/src/main/java/com/park/demo3/service/BookPinService.java backend/src/main/java/com/park/demo3/service/BookService.java backend/src/main/java/com/park/demo3/config/BookSeeder.java backend/src/test/java/com/park/demo3/service/BookPinResolveTest.java backend/src/test/java/com/park/demo3/api/BookPinApiIT.java
git commit -m "feat(book): 模板 pin 按月独立——建表、解析规则与回填(V111)"
```

---

### Task 2: 版本不可变 + 按月编辑

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/service/BookService.java`
- Modify: `backend/src/main/java/com/park/demo3/controller/BookController.java`
- Modify: `backend/src/main/java/com/park/demo3/dto/BookDtos.java`
- Test: `backend/src/test/java/com/park/demo3/api/BookApiIT.java`

**Interfaces:**
- Consumes: `BookPinService.resolve/pin`（Task 1）
- Produces:
  - `GET /api/books/{id}/template/at/{year}/{month}` → `BookDTO`（`ver`/`definition` 是该月生效的）
  - `PUT /api/books/{id}/template` body 增 `year`/`month`
  - `TemplateSaveReq(JsonNode definition, String note, Integer year, Integer month)`

- [ ] **Step 1: 写失败测试**

追加到 `BookApiIT`：

```java
    @Test
    void saveTemplate_isAlwaysImmutable_lightChangeAlsoBumpsVersion() throws Exception {
        Object[] cb = createCompanyWithBook();
        int companyId = (int) cb[0];
        int bookId = ((JsonNode) cb[1]).path("id").asInt();

        String v1Def = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/3"))
                .path("definition").toString();

        // 只改一个列名 —— 旧口径的"轻改动",现在也必须升版
        ObjectNode def = M.readTree(v1Def).deepCopy();
        ObjectNode first = (ObjectNode) def.path("groups").path(0).path("cols").path(0);
        first.put("label", first.path("label").asText() + "·改");
        String res = putOk("/api/books/" + bookId + "/template",
                "{\"definition\":" + M.writeValueAsString(def) + ",\"year\":2026,\"month\":3}");
        assertThat((Integer) JsonPath.read(res, "$.data.book.ver")).isEqualTo(2);

        // 旧版本逐字节不变(永不改写)
        String v1After = M.readTree(getOk("/api/books/" + bookId + "/template/versions/1")).toString();
        assertThat(v1After).contains(M.readTree(v1Def).path("groups").path(0).path("cols").path(0)
                .path("label").asText());
    }

    @Test
    void saveTemplate_movesOnlyThatMonth() throws Exception {
        Object[] cb = createCompanyWithBook();
        int bookId = ((JsonNode) cb[1]).path("id").asInt();

        ObjectNode def = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/3"))
                .path("definition").deepCopy();
        ObjectNode col = ((ArrayNode) def.path("groups").path(0).path("cols")).addObject();
        col.put("id", "c_m3only").put("std", false).put("label", "只给3月")
           .put("slot", "other").put("hidden", false).putNull("w").set("aliases", def.arrayNode());
        putOk("/api/books/" + bookId + "/template",
                "{\"definition\":" + M.writeValueAsString(def) + ",\"year\":2026,\"month\":3}");

        // 3 月用新版
        assertThat(M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/3"))
                .path("definition").toString()).contains("c_m3only");
        // 4 月(空月,沿用最近更早的 pin = 3 月那条)也会看到 —— 这是 P3 的规定行为
        // 但 2 月(更早)必须不受影响
        assertThat(M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/2"))
                .path("definition").toString()).doesNotContain("c_m3only");
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && ./mvnw -o test -Dtest=BookApiIT#saveTemplate_isAlwaysImmutable_lightChangeAlsoBumpsVersion+saveTemplate_movesOnlyThatMonth`
Expected: FAIL —— `/template/at/...` 404

- [ ] **Step 3: DTO 改造**

`BookDtos`：

```java
    public record TemplateSaveReq(@NotNull JsonNode definition, String note,
                                  @NotNull Integer year, @NotNull Integer month) {}

    public record PinReq(@NotNull Integer ver, @NotNull Integer year, @NotNull Integer month) {}

    /** 归档列:该月有非零值、但生效模板不渲染的自定义列(spec §2)。 */
    public record ArchivedColDTO(String id, String label) {}
```

删掉 `AdoptReq`。

- [ ] **Step 4: `saveTemplate` 重写为不可变 + 按月**

```java
    // 版本不可变(spec P5):任何保存都产出新版本,不再区分轻/重改动。
    // 按月独立之后,原地改写会把所有钉在该版的月份一起改掉 ——「只带走当前月」当场沦为谎话。
    @Transactional
    public TemplateSaveResultDTO saveTemplate(Integer bookId, TemplateSaveReq req) {
        LedgerBook b = books.selectById(bookId);
        if (b == null) throw new BizException(ResultCode.NOT_FOUND, "账册不存在");
        int year = req.year(), month = req.month();
        Integer chainId = chainBookId(b);
        Integer owner = ownerIdOf(b);
        assertMonthEditable(b, owner, year, month);         // P6 冻结,Task 3 实现;本任务先留空实现

        Long curVerId = pinSvc.resolve(b.getScreen(), owner, year, month, chainId);
        BookTemplateVersion cur = versions.selectById(curVerId);
        String newJson = req.definition().toString();
        TemplateDef.Def oldDef = TemplateDef.parse(cur.getDefinition());
        TemplateDef.Def newDef = TemplateDef.parse(newJson);
        TemplateDef.assertStdKept(oldDef, newDef);
        // 删列守卫已删除(spec §4):P6 之后编辑只可能发生在空月,守卫恒为真 ——
        // 一个永远为真的守卫比没有守卫更糟,它让人以为有保护。

        String summary = TemplateDef.diffSummary(oldDef, newDef);
        BookTemplateVersion nv = new BookTemplateVersion();
        nv.setBookId(chainId);
        nv.setVer(versions.maxVer(chainId) + 1);
        nv.setDefinition(newJson);
        nv.setNote(req.note() == null || req.note().isBlank() ? summary : req.note());
        nv.setCreatedBy(actor());
        versions.insert(nv);
        pinSvc.pin(b.getScreen(), owner, year, month, nv.getId());   // 只带走当前月
        if ("s10".equals(b.getScreen()) || b.getCompanyId() == null) {   // 链尾指针跟进(latestVer 来源)
            b.setCurrentVersionId(nv.getId()); books.updateById(b);
        }
        audit.log("模板修改", bookLabel(b), year + "-" + month + " v" + cur.getVer() + "→v" + nv.getVer() + ": " + summary);
        return new TemplateSaveResultDTO(toDTOAt(b, year, month), true, summary);
    }

    /** 册 → owner_id:台账取 company_id,附表10 取 phase。 */
    Integer ownerIdOf(LedgerBook b) {
        return "ledger".equals(b.getScreen()) ? b.getCompanyId() : b.getPhase();
    }

    /** 某月生效的 BookDTO。 */
    public BookDTO toDTOAt(LedgerBook b, int year, int month) {
        Integer chainId = chainBookId(b);
        Long verId = pinSvc.resolve(b.getScreen(), ownerIdOf(b), year, month, chainId);
        BookTemplateVersion v = versions.selectById(verId);
        return new BookDTO(b.getId(), b.getScreen(), b.getCompanyId(), b.getPhase(),
            b.getName(), v.getVer(), versions.maxVer(chainId), readTree(v.getDefinition()));
    }

    public BookDTO templateAt(Integer bookId, int year, int month) {
        LedgerBook b = books.selectById(bookId);
        if (b == null) throw new BizException(ResultCode.NOT_FOUND, "账册不存在");
        return toDTOAt(b, year, month);
    }
```

⚠ **同时必须改 `toDTO`,否则 `GET /api/books?screen=` 会 NPE。**
Task 1 迁移后台账公司册的 `current_version_id` 置 NULL（spec §5），而现行 `toDTO` 走
`currentVersion(b)`，拿 NULL 去 `selectById` 直接抛「账册缺少模板版本」。
按 spec §6，不带月份的清单接口 `definition` 语义改为**链尾版**：

```java
    // 不带月份的清单:definition 给链尾版(编辑器与导入中心的兜底用)。
    // 不能再走 currentVersion(b) —— 台账公司册的那一列已在迁移中置 NULL(spec §5)
    private BookDTO toDTO(LedgerBook b) {
        Integer chainId = chainBookId(b);
        BookTemplateVersion v = versions.selectById(tipVersionId(chainId));
        return new BookDTO(b.getId(), b.getScreen(), b.getCompanyId(), b.getPhase(),
            b.getName(), v.getVer(), v.getVer(), readTree(v.getDefinition()));
    }
```

并**删掉 `assertNoDataLossOnCustomRemoval` 与 `customColRowCount` 两个方法本体**
（spec §4：P6 之后编辑只可能发生在空月，守卫恒为真；留着比删掉更糟，它让人以为有保护）。

`assertMonthEditable` 本任务先写成空方法（Task 3 填实现），并加注释说明：

```java
    /** P6 录入即冻结 —— Task 3 填实现。此处留桩,避免 Task 2 的测试依赖尚未存在的行为。 */
    void assertMonthEditable(LedgerBook b, Integer owner, int year, int month) { }
```

`BookService` 构造器注入 `BookPinService pinSvc`。
⚠ `BookPinService` 也注入 `BookService` → **循环依赖**。解法：`BookPinService` 里对 `BookService` 加 `@Lazy`：

```java
    public BookPinService(BookMonthPinMapper pins, @org.springframework.context.annotation.Lazy BookService books) {
```

- [ ] **Step 5: Controller**

```java
    @Operation(summary = "某月生效的模板(按 pin 解析:本月→最近更早月→链尾)")
    @GetMapping("/{id}/template/at/{year}/{month}")
    public BookDTO templateAt(@PathVariable Integer id, @PathVariable int year, @PathVariable int month) {
        return svc.templateAt(id, year, month);
    }
```

- [ ] **Step 6: 跑测试**

Run: `cd backend && ./mvnw -o test -Dtest=BookApiIT`
Expected: 本任务两条 PASS。既有用例中断言 `structural=false` 的会 FAIL —— 预期，按新口径改成恒 `true`。

- [ ] **Step 7: 提交**

```bash
git add backend/src/main/java/com/park/demo3/service/BookService.java backend/src/main/java/com/park/demo3/controller/BookController.java backend/src/main/java/com/park/demo3/dto/BookDtos.java backend/src/test/java/com/park/demo3/api/BookApiIT.java
git commit -m "feat(book): 版本不可变、模板按月编辑——保存只带走当前月"
```

---

### Task 3: 录入即冻结

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/service/BookPinService.java`
- Modify: `backend/src/main/java/com/park/demo3/service/BookService.java`
- Modify: `backend/src/main/java/com/park/demo3/service/LedgerService.java`
- Modify: `backend/src/main/java/com/park/demo3/service/S10Service.java`
- Test: `backend/src/test/java/com/park/demo3/api/BookPinApiIT.java`

**Interfaces:**
- Produces: `BookPinService.hasData(String screen, Integer ownerId, int year, int month)` → boolean

- [ ] **Step 1: 写失败测试**

追加到 `BookPinApiIT`（需要 `MockMvc` 与登录，照 `BookApiIT` 的 `@BeforeEach login` 抄一份）：

```java
    @Test
    void firstDataWrite_materializesPin_andEarlierMonthChangesNoLongerLeak() throws Exception {
        Object[] cb = createCompanyWithBook();
        int companyId = (int) cb[0], bookId = ((JsonNode) cb[1]).path("id").asInt();

        // 2026-05 落一行数据 → pin 被固化
        putOk("/api/ledger/companies/" + companyId + "/months/2026/5",
              "{\"rows\":[{\"tenantName\":\"冻结测试户\",\"factoryRent\":100}]}");
        assertThat(pins.at("ledger", companyId, 2026, 5)).as("首次落库必须固化 pin").isNotNull();
        int verAt5 = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/5")).path("ver").asInt();

        // 改更早月份(2026-02,空月)的模板 → 5 月不受影响(本次的核心诉求)
        ObjectNode def = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/2"))
                .path("definition").deepCopy();
        ObjectNode col = ((ArrayNode) def.path("groups").path(0).path("cols")).addObject();
        col.put("id", "c_leakprobe").put("std", false).put("label", "泄漏探针")
           .put("slot", "other").put("hidden", false).putNull("w").set("aliases", def.arrayNode());
        putOk("/api/books/" + bookId + "/template",
              "{\"definition\":" + M.writeValueAsString(def) + ",\"year\":2026,\"month\":2}");

        String at5 = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/5")).toString();
        assertThat(at5).as("已录入月份不受更早月份改动影响").doesNotContain("c_leakprobe");
        assertThat(M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/5")).path("ver").asInt())
                .isEqualTo(verAt5);
    }

    @Test
    void recordedMonth_isFrozen_forBothPinAndEdit_thawsWhenDataCleared() throws Exception {
        Object[] cb = createCompanyWithBook();
        int companyId = (int) cb[0], bookId = ((JsonNode) cb[1]).path("id").asInt();
        putOk("/api/ledger/companies/" + companyId + "/months/2026/6",
              "{\"rows\":[{\"tenantName\":\"冻结户\",\"factoryRent\":100}]}");

        // 切版本 → 409
        mvc.perform(post("/api/books/" + bookId + "/template/pin").header("Authorization", auth())
                .contentType("application/json").content("{\"ver\":1,\"year\":2026,\"month\":6}"))
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("已录入")));

        // 编辑模板 → 409
        String def = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/6")).path("definition").toString();
        mvc.perform(put("/api/books/" + bookId + "/template").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"definition\":" + def + ",\"year\":2026,\"month\":6}"))
                .andExpect(jsonPath("$.code").value(409));

        // 删光数据 → 解冻
        putOk("/api/ledger/companies/" + companyId + "/months/2026/6", "{\"rows\":[]}");
        mvc.perform(put("/api/books/" + bookId + "/template").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"definition\":" + def + ",\"year\":2026,\"month\":6}"))
                .andExpect(jsonPath("$.code").value(0));
    }
```

追加两条走**导入**路径的（spec §8「导入」；导入与手工保存是两条独立的写路径，
只测手工保存会漏掉固化钩子只挂了一半的情况）：

```java
    @Test
    void import_alsoMaterializesPin() throws Exception {
        Object[] cb = createCompanyWithBook();
        int companyId = (int) cb[0];
        mvc.perform(post("/api/ledger/companies/" + companyId + "/import")
                .param("year", "2026").param("month", "10")
                .header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"导入固化户\",\"factoryRent\":100}]}"))
                .andExpect(jsonPath("$.data.imported").value(1));
        assertThat(pins.at("ledger", companyId, 2026, 10)).as("导入落库同样要固化 pin").isNotNull();
    }

    @Test
    void importDictionary_followsTheMonthsPin_notTheCompanys() throws Exception {
        Object[] cb = createCompanyWithBook();
        int companyId = (int) cb[0], bookId = ((JsonNode) cb[1]).path("id").asInt();

        // 11 月(空月)加一个自定义列 → 只有 11 月及其之后的空月认得它
        ObjectNode def = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/11"))
                .path("definition").deepCopy();
        ObjectNode col = ((ArrayNode) def.path("groups").path(0).path("cols")).addObject();
        col.put("id", "c_dictprobe").put("std", false).put("label", "词典探针")
           .put("slot", "other").put("hidden", false).putNull("w").set("aliases", def.arrayNode());
        putOk("/api/books/" + bookId + "/template",
              "{\"definition\":" + M.writeValueAsString(def) + ",\"year\":2026,\"month\":11}");

        // 往 1 月(更早,解析不到这个新版)导该列 → 未知 id,记名跳过
        mvc.perform(post("/api/ledger/companies/" + companyId + "/import")
                .param("year", "2026").param("month", "1")
                .header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"词典户\",\"extraFees\":{\"c_dictprobe\":10}}]}"))
                .andExpect(jsonPath("$.data.imported").value(0))
                .andExpect(jsonPath("$.data.errors[0].reason")
                        .value(org.hamcrest.Matchers.containsString("未知自定义列")));
    }
```

⚠ 实现时注意：`LedgerService.importRows` 现在取白名单用的是
`bookService.customIdsByCompany(companyId)`，**必须改成按月取**
`customIdsAt("ledger", companyId, year, month)`，否则这条测试过不了。
`S10Service.importRows` 同理（owner=phase）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && ./mvnw -o test -Dtest=BookPinApiIT`
Expected: FAIL —— pin 没被固化；冻结没生效（返回 0 而非 409）；导入白名单还按公司取

- [ ] **Step 3: `hasData` 与冻结判定**

`BookPinService` 追加（注入 `MonthlyLedgerMapper` / `S10RecordMapper`）：

```java
    /** 该月是否已录入(看当前有无数据行,不看 pin 在不在 —— 删光数据即自动解冻)。 */
    public boolean hasData(String screen, Integer ownerId, int year, int month) {
        if ("ledger".equals(screen))
            return ledgerRows.selectCount(new QueryWrapper<MonthlyLedger>()
                .eq("company_id", ownerId).eq("period_year", year).eq("period_month", month)) > 0;
        String ym = String.format("%04d-%02d", year, month);
        return s10Rows.selectCount(new QueryWrapper<S10Record>()
            .eq("phase", ownerId).eq("acct_month", ym)) > 0;
    }
```

`BookService.assertMonthEditable` 填实现：

```java
    /** P6 录入即冻结:已录入的月份既不许切版本,也不许从它编辑模板 —— 两条路都会改变该月的列。 */
    void assertMonthEditable(LedgerBook b, Integer owner, int year, int month) {
        if (pinSvc.hasData(b.getScreen(), owner, year, month))
            throw new BizException(ResultCode.CONFLICT,
                year + "-" + month + " 已录入数据,模板已定稿;清空本月数据后可改");
    }
```

- [ ] **Step 4: 写路径挂固化**

`LedgerService`：`save` 与 `importRows` 在 `rechain(companyId)` 之后、`copyFromPrev` 在返回前，各加一行：

```java
        materializePin(companyId, year, month);
```

并新增私有方法（`LedgerService` 注入 `BookService` 已有，追加 `BookPinService`）：

```java
    // P6:该月第一次落库数据时固化 pin。不固化的话,日后改更早月份的 pin 会顺着解析规则把本月一起改掉。
    private void materializePin(Integer companyId, int year, int month) {
        LedgerBook b = bookService.bookOfCompany(companyId);
        if (b == null) return;
        pinService.materialize("ledger", companyId, year, month,
            pinService.resolve("ledger", companyId, year, month, bookService.chainBookId(b)));
    }
```

`BookService` 暴露 `public LedgerBook bookOfCompany(Integer companyId) { return books.byCompany(companyId); }`
并把 `chainBookId` 从包内可见改为 `public`。

`S10Service`：`save` / `importRows` 落库之后各加一行 `materializePin(phase, acctMonth);`，并新增：

```java
    // P6:与台账同一条规则。owner=phase;acctMonth 是 'YYYY-MM',在这里拆成年月两个整数
    private void materializePin(int phase, String acctMonth) {
        LedgerBook b = bookService.bookOfPhase(phase);
        if (b == null) return;
        int y = Integer.parseInt(acctMonth.substring(0, 4)), m = Integer.parseInt(acctMonth.substring(5, 7));
        pinService.materialize("s10", phase, y, m,
            pinService.resolve("s10", phase, y, m, bookService.chainBookId(b)));
    }
```

`BookService` 暴露 `public LedgerBook bookOfPhase(int phase) { return books.byPhase(phase); }`。

- [ ] **Step 5: pin 端点接冻结**

`BookService` 新增：

```java
    /** 显式钉版(选择器)。已录入的月份拒绝(P6)。 */
    @Transactional
    public BookDTO pinVersion(Integer bookId, PinReq req) {
        LedgerBook b = books.selectById(bookId);
        if (b == null) throw new BizException(ResultCode.NOT_FOUND, "账册不存在");
        Integer owner = ownerIdOf(b);
        assertMonthEditable(b, owner, req.year(), req.month());
        BookTemplateVersion target = versions.byBook(chainBookId(b)).stream()
            .filter(v -> v.getVer() == req.ver()).findFirst()
            .orElseThrow(() -> new BizException(ResultCode.NOT_FOUND, "版本不存在"));
        pinSvc.pin(b.getScreen(), owner, req.year(), req.month(), target.getId());
        audit.log("模板切版", bookLabel(b), req.year() + "-" + req.month() + " → v" + req.ver());
        return toDTOAt(b, req.year(), req.month());
    }
```

`BookController`：把 `adopt` 换成

```java
    @Operation(summary = "钉本月的模板版本(不造版本;该月已录入 409)")
    @PostMapping("/{id}/template/pin")
    public BookDTO pin(@PathVariable Integer id, @Valid @RequestBody PinReq req) {
        return svc.pinVersion(id, req);
    }
```

- [ ] **Step 6: 跑测试**

Run: `cd backend && ./mvnw -o test -Dtest=BookPinApiIT,BookApiIT`
Expected: 全通过

- [ ] **Step 7: 提交**

```bash
git add backend/src/main/java/com/park/demo3/service/ backend/src/main/java/com/park/demo3/controller/BookController.java backend/src/test/java/com/park/demo3/api/BookPinApiIT.java
git commit -m "feat(book): 录入即冻结——首次落库固化 pin,已录入月份不许切版与改模板"
```

---

### Task 4: 第 17 权限点

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/security/Perm.java`
- Modify: `backend/src/main/java/com/park/demo3/security/PermissionRegistry.java`
- Create: `backend/src/main/resources/db/migration/V112__book_template_switch_perm.sql`
- Test: `backend/src/test/java/com/park/demo3/api/BookPinApiIT.java`

- [ ] **Step 1: 写失败测试**

```java
    @Test
    void pin_requiresSwitchPerm_notEditPerm() throws Exception {
        // viewer 只读 → 403(口令在 application-dev.yml 钉死 viewer123)
        String vt = JsonPath.read(mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"viewer\",\"password\":\"viewer123\"}"))
                .andReturn().getResponse().getContentAsString(), "$.data.token");
        Object[] cb = createCompanyWithBook();
        int bookId = ((JsonNode) cb[1]).path("id").asInt();
        mvc.perform(post("/api/books/" + bookId + "/template/pin").header("Authorization", "Bearer " + vt)
                .contentType("application/json").content("{\"ver\":1,\"year\":2026,\"month\":7}"))
                .andExpect(jsonPath("$.code").value(403));
    }

    @Test
    void perm17_isRegisteredAndRenderedInMatrix() {
        assertThat(com.park.demo3.security.Perm.ALL).hasSize(17)
            .contains(com.park.demo3.security.Perm.BOOK_TEMPLATE_SWITCH);
        assertThat(com.park.demo3.security.Perm.META.stream()
            .map(com.park.demo3.security.Perm.Meta::perm))
            .contains(com.park.demo3.security.Perm.BOOK_TEMPLATE_SWITCH);
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && ./mvnw -o test -Dtest=BookPinApiIT#perm17_isRegisteredAndRenderedInMatrix`
Expected: 编译失败，`BOOK_TEMPLATE_SWITCH` 不存在

- [ ] **Step 3: 加权限点**

`Perm.java`，在 `BOOK_TEMPLATE_EDIT` 之后：

```java
    // 第 17 点(2026-08-26 用户拍板):更换账册版本 —— 换一套别人的列,与第 16 点「在本月微调列名」
    // 是两种风险,故分权。已录入的月份两者都拒(录入即冻结),这个点只对空月有意义
    public static final String BOOK_TEMPLATE_SWITCH = "book-template:switch";
```

`ALL` 里加在 `BOOK_TEMPLATE_EDIT` 之后，注释「全部 16 个」改「全部 17 个」。
`META` 里对应位置加：

```java
        new Meta(BOOK_TEMPLATE_SWITCH, "更换账册版本", "为某个月份切换使用哪一版账册模板;已录入数据的月份不可切"),
```

`PermissionRegistry`：

```java
        add(HttpMethod.POST, "/api/books/*/template/pin",   Perm.BOOK_TEMPLATE_SWITCH);
```

并删掉 `/api/books/*/template/adopt` 那条（路径已不存在，留着是死规则）。

V112：

```sql
-- 第 17 权限点 book-template:switch(2026-08-26 拍板):更换账册版本。
-- 与第 16 点 book-template:edit 分开:换一套别人的列、和在本月微调列名,是两种风险。
-- 只授内建 admin;其他角色由主管在角色屏勾选(矩阵按 Perm.META 自动渲染第 17 行)。
INSERT INTO auth_role_perm (role_id, perm)
SELECT id, 'book-template:switch' FROM auth_role WHERE code = 'admin'
  AND NOT EXISTS (SELECT 1 FROM auth_role_perm p WHERE p.role_id = auth_role.id AND p.perm = 'book-template:switch');
```

- [ ] **Step 4: 跑测试**

Run: `cd backend && ./mvnw -o test -Dtest=BookPinApiIT,PermissionRegistryTest,RoleApiIT`
Expected: 全通过（权限覆盖率测试会校验 META 与 ALL 一致）

- [ ] **Step 5: 提交**

```bash
git add backend/src/main/java/com/park/demo3/security/ backend/src/main/resources/db/migration/V112__book_template_switch_perm.sql backend/src/test/java/com/park/demo3/api/BookPinApiIT.java
git commit -m "feat(rbac): 第 17 权限点 book-template:switch——更换账册版本(V112)"
```

---

### Task 5: 归档列显示（hidden 裂缝）

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/service/BookService.java`
- Modify: `backend/src/main/java/com/park/demo3/service/LedgerService.java`
- Modify: `backend/src/main/java/com/park/demo3/service/S10Service.java`
- Modify: `backend/src/main/java/com/park/demo3/dto/LedgerMonthDTO.java`
- Modify: `frontend/src/utils/bookTemplate.ts`
- Test: `backend/src/test/java/com/park/demo3/api/BookPinApiIT.java`、`frontend/src/utils/bookTemplate.spec.ts`

**Interfaces:**
- Produces:
  - `BookService.archivedColsAt(LedgerBook b, int year, int month, Set<String> keysWithData)` → `List<ArchivedColDTO>`
  - `LedgerMonthDTO` 增字段 `List<ArchivedColDTO> archivedCols`
  - `toLedgerColumns(def, prev, archived)` 第三参数

- [ ] **Step 1: 写后端失败测试**

```java
    @Test
    void archivedColumn_stillListedWhenThatMonthHasMoney() throws Exception {
        Object[] cb = createCompanyWithBook();
        int companyId = (int) cb[0], bookId = ((JsonNode) cb[1]).path("id").asInt();

        // 空月加一个自定义列 → v2
        ObjectNode def = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/8"))
                .path("definition").deepCopy();
        ObjectNode col = ((ArrayNode) def.path("groups").path(0).path("cols")).addObject();
        col.put("id", "c_arch").put("std", false).put("label", "待归档费")
           .put("slot", "other").put("hidden", false).putNull("w").set("aliases", def.arrayNode());
        putOk("/api/books/" + bookId + "/template",
              "{\"definition\":" + M.writeValueAsString(def) + ",\"year\":2026,\"month\":8}");

        // 往这列写钱(此举同时冻结 8 月)
        putOk("/api/ledger/companies/" + companyId + "/months/2026/8",
              "{\"rows\":[{\"tenantName\":\"归档户\",\"extraFees\":{\"c_arch\":250}}]}");

        String body = getOk("/api/ledger/companies/" + companyId + "/months/2026/8");
        // 应收合计含这笔(recalc 一行没动)
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].totalReceivable")).doubleValue())
                .isEqualTo(250.0);
        // 归档列清单为空:此刻该列还在模板里、正常渲染
        assertThat((List<?>) JsonPath.read(body, "$.data.archivedCols")).isEmpty();

        // 9 月(空月,沿用 8 月 pin)把该列隐藏 → v3,只影响 9 月
        ObjectNode d9 = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/9"))
                .path("definition").deepCopy();
        for (JsonNode g : d9.path("groups"))
            for (JsonNode c : g.path("cols"))
                if ("c_arch".equals(c.path("id").asText())) ((ObjectNode) c).put("hidden", true);
        putOk("/api/books/" + bookId + "/template",
              "{\"definition\":" + M.writeValueAsString(d9) + ",\"year\":2026,\"month\":9}");

        // 9 月写一笔到这个已隐藏的列(模拟历史遗留),它必须出现在 archivedCols 里
        putOk("/api/ledger/companies/" + companyId + "/months/2026/9",
              "{\"rows\":[{\"tenantName\":\"归档户9\",\"extraFees\":{\"c_arch\":30}}]}");
        String b9 = getOk("/api/ledger/companies/" + companyId + "/months/2026/9");
        assertThat((String) JsonPath.read(b9, "$.data.archivedCols[0].id")).isEqualTo("c_arch");
        assertThat((String) JsonPath.read(b9, "$.data.archivedCols[0].label")).isEqualTo("待归档费");
        assertThat(((Number) JsonPath.read(b9, "$.data.rows[0].totalReceivable")).doubleValue())
                .as("recalc 口径不变:隐藏列的钱照样进合计").isEqualTo(30.0);
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && ./mvnw -o test -Dtest=BookPinApiIT#archivedColumn_stillListedWhenThatMonthHasMoney`
Expected: FAIL —— `$.data.archivedCols` 读不到

- [ ] **Step 3: 后端实现**

`BookService`：

```java
    /** 该月有钱、但生效模板不渲染(缺席或 hidden)的自定义列。label 取链上最近一版对它的命名。 */
    public List<ArchivedColDTO> archivedColsAt(LedgerBook b, int year, int month, Set<String> keysWithData) {
        if (keysWithData.isEmpty()) return List.of();
        TemplateDef.Def def = TemplateDef.parse(versions.selectById(
            pinSvc.resolve(b.getScreen(), ownerIdOf(b), year, month, chainBookId(b))).getDefinition());
        Set<String> rendered = new LinkedHashSet<>();
        for (TemplateDef.Col c : TemplateDef.flatten(def)) if (!c.hidden()) rendered.add(c.id());
        List<ArchivedColDTO> out = new ArrayList<>();
        for (String id : keysWithData) {
            if (rendered.contains(id)) continue;
            out.add(new ArchivedColDTO(id, labelOf(chainBookId(b), id)));
        }
        return out;
    }

    /** 链上最近一版对该列的命名;全链都没有则退回 id(不臆造名字)。 */
    private String labelOf(Integer chainId, String colId) {
        for (BookTemplateVersion v : versions.byBook(chainId))       // byBook 已按 ver 倒序
            for (TemplateDef.Col c : TemplateDef.flatten(TemplateDef.parse(v.getDefinition())))
                if (c.id().equals(colId)) return c.label();
        return colId;
    }
```

`LedgerMonthDTO` 末尾加字段 `List<BookDtos.ArchivedColDTO> archivedCols`。

`LedgerService.month()` 在 `return new LedgerMonthDTO(...)` 之前收集并传入：

```java
        // 归档列(spec §2):本月有非零值、但生效模板不渲染的自定义列。
        // hidden 只该表示"不再接受新录入",不该表示"藏起已经发生的钱" —— 藏了合计就对不上明细
        Set<String> keysWithData = new LinkedHashSet<>();
        for (MonthlyLedger l : all)
            for (Map.Entry<String, BigDecimal> e : ExtraFees.parse(l.getExtraFees()).entrySet())
                if (e.getValue() != null && e.getValue().signum() != 0) keysWithData.add(e.getKey());
        List<ArchivedColDTO> archived = bookService.archivedColsAt(
            bookService.bookOfCompany(companyId), year, month, keysWithData);
```

`S10Service.month(phase, year, month)` 同样收集 `S10Record.extraFees` 的非零键，
调 `bookService.archivedColsAt(bookService.bookOfPhase(phase), year, month, keys)`，
填进 `S10MonthDTO` 的同名新字段。

**两屏都要测**（Global Constraints 第二条）。除上面台账那条外，追加 s10 一条：

```java
    @Test
    void archivedColumn_alsoSurfacesOnS10() throws Exception {
        JsonNode s10 = M.readTree(getOk("/api/books?screen=s10")).path("data").get(0);
        int bookId = s10.path("id").asInt(), phase = s10.path("phase").asInt();

        ObjectNode def = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/8"))
                .path("definition").deepCopy();
        ObjectNode col = ((ArrayNode) def.path("groups").path(0).path("cols")).addObject();
        col.put("id", "c_s10arch").put("std", false).put("label", "附10归档费")
           .put("slot", "other").put("hidden", false).putNull("w").set("aliases", def.arrayNode());
        putOk("/api/books/" + bookId + "/template",
              "{\"definition\":" + M.writeValueAsString(def) + ",\"year\":2026,\"month\":8}");

        mvc.perform(post("/api/s10/records").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"phase\":" + phase + ",\"acctMonth\":\"2026-08\",\"tenantName\":\"附10归档户\","
                       + "\"extraFees\":{\"c_s10arch\":88}}"))
                .andExpect(jsonPath("$.code").value(0));

        // 9 月把它隐藏,再看 9 月的 archivedCols
        ObjectNode d9 = M.readTree(getOk("/api/books/" + bookId + "/template/at/2026/9"))
                .path("definition").deepCopy();
        for (JsonNode g : d9.path("groups"))
            for (JsonNode c : g.path("cols"))
                if ("c_s10arch".equals(c.path("id").asText())) ((ObjectNode) c).put("hidden", true);
        putOk("/api/books/" + bookId + "/template",
              "{\"definition\":" + M.writeValueAsString(d9) + ",\"year\":2026,\"month\":9}");
        mvc.perform(post("/api/s10/records").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"phase\":" + phase + ",\"acctMonth\":\"2026-09\",\"tenantName\":\"附10归档户9\","
                       + "\"extraFees\":{\"c_s10arch\":9}}"))
                .andExpect(jsonPath("$.code").value(0));

        String b9 = getOk("/api/s10/months/" + phase + "/2026/9");
        assertThat((String) JsonPath.read(b9, "$.data.archivedCols[0].id")).isEqualTo("c_s10arch");
    }
```

⚠ 上面 s10 的两个端点路径（`POST /api/s10/records`、`GET /api/s10/months/{phase}/{y}/{m}`）
**以 `S10Controller` 的实际路由为准**，实现前先 `grep -n "Mapping" S10Controller.java` 核对，
对不上就改测试里的路径，不要改 controller。

- [ ] **Step 4: 前端列构建**

`bookTemplate.ts`：

```ts
/** 归档列:该月有钱但模板不渲染的自定义列(spec §2)。只读,不接受录入。 */
export interface ArchivedCol { id: string; label: string }

export function toLedgerColumns(def: BookDef, prev: number, archived: ArchivedCol[] = []): ColumnModel {
```

在 `groups` 组装完之后、`return` 之前追加：

```ts
  // hidden 的语义是「不再接受新录入」,不是「藏起已经发生的钱」——
  // 藏起来会让屏上的应收合计永远对不上明细(recalc 全口袋照加,见 spec §2)
  if (archived.length) {
    groups.push({
      name: '已归档',
      cols: archived.map(a => ({ key: a.id as ColumnKey, label: a.label, w: DEFAULT_W, readonly: true })),
    })
  }
```

`LeafColumn` 若无 `readonly` 字段则加上（可选布尔），`FPLedgerTable.vue` 渲染时 `readonly` 的列走只读分支（与 `balancePrevDerived` 同一套写法）。

- [ ] **Step 5: 前端测试**

追加到 `bookTemplate.spec.ts`：

```ts
  it('归档列追加成只读的「已归档」组', () => {
    const m = toLedgerColumns(defWithOneGroup, 12, [{ id: 'c_arch', label: '待归档费' }])
    const g = m.groups.find(x => x.name === '已归档')
    expect(g).toBeTruthy()
    expect(g!.cols[0]).toMatchObject({ key: 'c_arch', label: '待归档费', readonly: true })
  })

  it('没有归档列时不出现「已归档」组', () => {
    const m = toLedgerColumns(defWithOneGroup, 12, [])
    expect(m.groups.find(x => x.name === '已归档')).toBeUndefined()
  })
```

`defWithOneGroup` 沿用该 spec 文件里已有的模板夹具。

- [ ] **Step 6: 跑测试**

Run: `cd backend && ./mvnw -o test -Dtest=BookPinApiIT` 与 `cd frontend && npx vitest run src/utils/bookTemplate.spec.ts`
Expected: 全通过

- [ ] **Step 7: 提交**

```bash
git add backend/src/main/java/com/park/demo3/ backend/src/test/java/com/park/demo3/api/BookPinApiIT.java frontend/src/utils/bookTemplate.ts frontend/src/utils/bookTemplate.spec.ts frontend/src/components/fp/FPLedgerTable.vue
git commit -m "fix(book): 归档列在有钱的月份仍显示——合计不再对不上明细"
```

---

### Task 6: 前端版本选择器与按月取列

**Files:**
- Modify: `frontend/src/types/book.ts`、`frontend/src/api/books.ts`
- Modify: `frontend/src/components/fp/TemplateEditorPanel.vue`
- Modify: `frontend/src/views/ledger/LedgerView.vue`、`LedgerWideTable.vue`
- Modify: `frontend/src/views/sales-income/S10View.vue`
- Modify: `docs/design/BOOK-WORKBENCH-SPEC.md`
- Test: `frontend/src/components/fp/templateEditor.spec.ts`

- [ ] **Step 1: API 与类型**

`api/books.ts`：把 `adopt` 换成

```ts
  // 某月生效的模板(按 pin 解析:本月 → 最近更早月 → 链尾)
  templateAt: (bookId: number, year: number, month: number): Promise<Book> =>
    http.get(`/books/${bookId}/template/at/${year}/${month}`),
  // 钉本月的版本(不造版本;该月已录入 → 409)
  pin: (bookId: number, ver: number, year: number, month: number): Promise<Book> =>
    http.post(`/books/${bookId}/template/pin`, { ver, year, month }),
```

`saveTemplate` 增 `year`/`month` 两个参数并放进 body。

- [ ] **Step 2: 写失败测试**

追加到 `templateEditor.spec.ts`：

```ts
  it('版本选择器列出全链,最新那版带「最新」标记', async () => {
    const w = mountPanel({ book: { ...baseBook, ver: 2, latestVer: 4 }, versions: chain })
    const opts = w.findAll('.te-verpick option')
    expect(opts.length).toBe(chain.length)
    expect(opts.map(o => o.text()).join(' ')).toContain('最新')
    expect((w.find('.te-verpick').element as HTMLSelectElement).value).toBe('2')
  })

  it('选一个版本 emit pin(该版本号)', async () => {
    const w = mountPanel({ book: { ...baseBook, ver: 2, latestVer: 4 }, versions: chain })
    await w.find('.te-verpick').setValue('3')
    expect(w.emitted('pin')?.[0]).toEqual([3])
  })

  it('已录入月份:选择器与编辑门都置灰,并说明为什么', async () => {
    const w = mountPanel({ book: { ...baseBook, ver: 2, latestVer: 4 }, versions: chain, monthHasData: true })
    expect(w.find('.te-verpick').attributes('disabled')).toBeDefined()
    expect(w.find('.te-editbtn').attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('已录入')
  })
```

- [ ] **Step 3: 面板改造**

`TemplateEditorPanel.vue`：
- props 增 `monthHasData: boolean`
- emit `'rollback'`/`'adopt'` 换成 `(e: 'pin', ver: number): void`
- 删掉 `behind` / `pending` / `.te-lineage` / `.te-upgrade` 整块（升级态不再存在）
- 编辑按钮旁插入：

```html
          <select class="te-verpick" :disabled="monthHasData || !canSwitch"
                  :value="String(book.ver)"
                  :title="monthHasData ? '本月已录入,模板已定稿;清空本月数据后可改' : '选择本月使用的账册版本'"
                  @change="emit('pin', Number(($event.target as HTMLSelectElement).value))">
            <option v-for="v in versions" :key="v.id" :value="String(v.ver)">
              v{{ v.ver }}{{ v.ver === book.latestVer ? ' · 最新' : '' }}{{ v.note ? ' — ' + v.note : '' }}
            </option>
          </select>
          <span v-if="monthHasData" class="te-frozen">本月已录入,模板已定稿</span>
```

- `enterEdit` 开头加 `if (props.monthHasData) return`
- 编辑按钮 `:disabled="monthHasData"`
- props 增 `canSwitch: boolean`（宿主传 `auth.can('book-template:switch')`）

- [ ] **Step 4: 宿主接线**

`LedgerView.vue`：
- `book` 改为按当前年月取：`book.value = await booksApi.templateAt(bookId, year.value, month.value!)`，
  并在 `watch([year, month])` 里重取
- `@pin="onTplPin"`，`onTplPin(ver)` 调 `booksApi.pin(bookId, ver, year, month)` 后刷新 `book` 与月度数据
- `:month-has-data="(month.value?.rows ?? []).some(r => !r.carried)"`
- `:can-switch="auth.can('book-template:switch')"`
- `saveTemplate` 调用处补 `year`/`month`

`S10View.vue` 同理（owner 是 phase，月份取当前 `acctMonth`）。
`LedgerWideTable.vue`：删掉 `tplBehind` 与 `.lg-tpldot` 角标（红点取消）。

- [ ] **Step 5: 跑前端全量**

Run: `cd frontend && npx vitest run`
Expected: 全绿（含 `noInteractionLayoutShift.spec.ts`）

- [ ] **Step 6: 同步 SPEC**

`docs/design/BOOK-WORKBENCH-SPEC.md` 里 2026-08-25 那段「模板全局化」之后追加：

```markdown
**模板 pin 按月独立(2026-08-26 拍板,修订上一条)**:版本指针从「每册一个」改为
**每册每月一个**(`book_month_pin`)。读某月的模板按「本月 pin → 最近一个更早月份的 pin → 链尾」解析。
版本**完全不可变**(任何保存都升版,不再有「轻改动就地更新」);月份**一旦落库数据就固化 pin 并冻结**
——已录入的月份既不许切版本也不许从它编辑模板,清空该月数据即自动解冻。
归档(hidden)列在**该月有非零值**时仍以只读列显示:hidden 的语义是「不再接受新录入」,
不是「藏起已经发生的钱」——藏起来会让应收合计永远对不上明细(recalc 全口袋照加)。
更换版本走第 17 权限点 `book-template:switch`。完整规则见
docs/superpowers/specs/2026-08-26-per-month-template-pin-design.md。
```

- [ ] **Step 7: 全量回归**

Run: `cd backend && ./mvnw -o test` 与 `cd frontend && npx vitest run`
Expected: 两边全绿

- [ ] **Step 8: 提交**

```bash
git add frontend/src docs/design/BOOK-WORKBENCH-SPEC.md
git commit -m "feat(book): 版本选择器替代升级提示;列按 (册,月) 取,红点取消"
```
