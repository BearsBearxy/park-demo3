# 导入中心 hub + import_log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建 import_log 历史表 + 导入中心屏，把分散在 8 个录入屏的导入统一归集、留痕，并在中心内就地重用各屏导入器。

**Architecture:** 后端新增只读审计表 import_log（1 迁移 + 实体/Mapper/DTO/Service/Controller，两端点），不改现有 8 个导入端点。前端抽共享 `importRegistry`（8 屏与 hub 单一事实源）+ `runImport` 单一记录链（导入后前端上报一条 log）；`FpImportModal` emit 附带 fileName；导入中心屏 1:1 还原 `screen-import.jsx`。

**Tech Stack:** 后端 Java 17 + Spring Boot 3.3 + MyBatis-Plus + Flyway + Testcontainers；前端 Vue 3 `<script setup>` + TS + Pinia + axios + Vitest。

**Spec:** `docs/superpowers/specs/2026-07-01-demo3-p1-import-center-hub-design.md`

## Global Constraints

- 统一返回信封 `Result<T>`：controller 返裸类型，`ResponseWrapAdvice` 自动裹；错误经 `GlobalExceptionHandler`。
- not-found/业务错抛 `BizException(ResultCode.XXX)`（**禁用 `NoSuchElementException`**）。
- MyBatis-Plus：Mapper 裸 `extends BaseMapper<T>` 或 `default` 方法组合 `QueryWrapper`，**零手写 XML/SQL**；审计字段 `@TableField(fill = FieldFill.INSERT)` 复用既有 `MetaObjectHandler`。
- Flyway 迁移递增编号（现有到 V19 → 新增 **V20**），确定性、无种子改动。
- 测试铁律（IMPORT-GUIDE §四）：**编排者亲跑全量 `./mvnw test`（不接管道）**，不信 agent 的 `test-compile`；JsonPath 过滤器断言用 `.isNotEmpty()` 不用 `.value(标量)`；含中文的 POST 验证走浏览器不用 curl；DELETE 带 body 的 IT 要覆盖。
- 前端：所有 API 走共享 `http`（`api/index.ts` 解包 Result）；用 SheetJS 的屏懒加载 xlsx；列表/数据屏遵 DESIGN-FIDELITY §6 加载门。
- 工具链：本机仅 JDK 17，一律 `./mvnw`（`export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-17.0.18.8-hotspot"`）；Testcontainers 需 Docker（首跑 MySQL 冷启 ~3min）；后端跑测试在 `backend/`（或 `./mvnw -f backend/pom.xml`）。

---

## 文件结构

**后端（新增，`backend/src/main/java/com/park/demo3/`）：**
- `entity/ImportLog.java` — 表映射。
- `mapper/ImportLogMapper.java` — `BaseMapper<ImportLog>` + `default latestByType()` / `recent(days,limit)`。
- `dto/ImportLogDTO.java`、`dto/ImportLogReq.java`、`dto/ImportLogOverviewDTO.java` — record。
- `service/ImportLogService.java` — 记录（填 operator/createdAt）、overview 归约、白名单校验。
- `controller/ImportLogController.java` — `POST /api/import-log`、`GET /api/import-log/overview`。
- `resources/db/migration/V20__import_log.sql` — 建表。
- 测试：`test/.../service/ImportLogServiceTest.java`（Mockito）、`test/.../api/ImportLogApiIT.java`（Testcontainers）。

**前端（`frontend/src/`）：**
- `utils/importRegistry.ts`（新）— 9 条类型 + `runImport`。
- `api/importLog.ts`（新）— `record` / `overview`。
- `types/importLog.ts`（新）— DTO/Req TS 类型。
- `components/import/FpImportModal.vue`（改）— emit 附带 fileName。
- 8 个 View（改）— 消费 registry：`LedgerView`/`S10View`/`PvView`/`ChargingView`/`ElecView`/`SalaryView`/`UtilitiesView`。
- `views/import-center/ImportCenterView.vue`（新）+ 子件（tiles/context selector）。
- `router/index.ts`（改）— `import` 路由换真屏。

---

## Task 1: 后端 import_log 持久层（迁移 + 实体 + Mapper）

**Files:**
- Create: `backend/src/main/resources/db/migration/V20__import_log.sql`
- Create: `backend/src/main/java/com/park/demo3/entity/ImportLog.java`
- Create: `backend/src/main/java/com/park/demo3/mapper/ImportLogMapper.java`

**Interfaces:**
- Produces: `ImportLog` 实体（字段 id/dataType/typeLabel/fileName/target/rows/ok/warn/status/operator/createdAt）；`ImportLogMapper extends BaseMapper<ImportLog>` + `List<ImportLog> latestByType()` + `List<ImportLog> recent(int days, int limit)`。

- [ ] **Step 1: 写迁移 V20**

```sql
-- V20__import_log.sql — 导入历史(只读审计)。纯新增,不改现有表,无种子。
CREATE TABLE import_log (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  data_type   VARCHAR(32)  NOT NULL,
  type_label  VARCHAR(64)  NOT NULL,
  file_name   VARCHAR(255) NOT NULL,
  target      VARCHAR(64)  NULL,
  `rows`      INT          NOT NULL DEFAULT 0,
  ok          INT          NOT NULL DEFAULT 0,
  warn        INT          NOT NULL DEFAULT 0,
  status      VARCHAR(16)  NOT NULL,
  operator    VARCHAR(64)  NULL,
  created_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_type_time (data_type, created_at),
  KEY idx_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> 注：`rows` 是 MySQL 保留字，列名加反引号；实体字段名 `rows` 映射列 `rows`（map-underscore 不影响，无下划线）。

- [ ] **Step 2: 写实体 ImportLog**

```java
package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
@Data @TableName("import_log")
public class ImportLog {
    @TableId(type = IdType.AUTO) private Long id;
    private String dataType;
    private String typeLabel;
    private String fileName;
    private String target;
    @TableField("`rows`") private Integer rows;   // rows 是保留字,列名反引号
    private Integer ok;
    private Integer warn;
    private String status;
    private String operator;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
}
```

- [ ] **Step 3: 写 Mapper**

```java
package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.ImportLog;
import org.apache.ibatis.annotations.Mapper;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;
@Mapper
public interface ImportLogMapper extends BaseMapper<ImportLog> {
    // 每 data_type 最新一条(数据量小:全量按时间倒序后 Java 端按 type 取首条)
    default List<ImportLog> latestByType() {
        List<ImportLog> all = selectList(new QueryWrapper<ImportLog>().orderByDesc("created_at", "id"));
        Map<String, ImportLog> firstByType = new LinkedHashMap<>();
        for (ImportLog r : all) firstByType.putIfAbsent(r.getDataType(), r);
        return new ArrayList<>(firstByType.values());
    }
    // 近 days 天倒序,截断 limit
    default List<ImportLog> recent(int days, int limit) {
        LocalDateTime since = LocalDateTime.now().minusDays(days);
        return selectList(new QueryWrapper<ImportLog>()
            .ge("created_at", since).orderByDesc("created_at", "id").last("limit " + limit));
    }
}
```

- [ ] **Step 4: 编译验证**

Run: `./mvnw -q -f backend/pom.xml -o test-compile`
Expected: BUILD SUCCESS（无编译错）

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/resources/db/migration/V20__import_log.sql backend/src/main/java/com/park/demo3/entity/ImportLog.java backend/src/main/java/com/park/demo3/mapper/ImportLogMapper.java
git commit -m "feat(import-center): import_log 表 + 实体 + Mapper(V20)"
```

---

## Task 2: 后端 import_log Service + Controller + DTO（含 ImportLogApiIT）

**Files:**
- Create: `backend/src/main/java/com/park/demo3/dto/ImportLogDTO.java`
- Create: `backend/src/main/java/com/park/demo3/dto/ImportLogReq.java`
- Create: `backend/src/main/java/com/park/demo3/dto/ImportLogOverviewDTO.java`
- Create: `backend/src/main/java/com/park/demo3/service/ImportLogService.java`
- Create: `backend/src/main/java/com/park/demo3/controller/ImportLogController.java`
- Create: `backend/src/test/java/com/park/demo3/service/ImportLogServiceTest.java`
- Create: `backend/src/test/java/com/park/demo3/api/ImportLogApiIT.java`

**Interfaces:**
- Consumes: `ImportLog`, `ImportLogMapper`（Task 1）；`AuthUserMapper`（既有，取 displayName）；`Result`/`BizException`/`ResultCode`（既有）。
- Produces:
  - `ImportLogDTO(Long id, String dataType, String typeLabel, String fileName, String target, int rows, int ok, int warn, String status, String operator, LocalDateTime createdAt)`
  - `ImportLogReq(String dataType, String typeLabel, String fileName, String target, int rows, int ok, int warn, String status)`
  - `ImportLogOverviewDTO(List<ImportLogDTO> latestByType, List<ImportLogDTO> history)`
  - `ImportLogService.record(ImportLogReq) → ImportLogDTO`、`ImportLogService.overview(int days, int historyLimit) → ImportLogOverviewDTO`
  - `POST /api/import-log`、`GET /api/import-log/overview`

- [ ] **Step 1: 写 DTO/Req（record）**

```java
// ImportLogDTO.java
package com.park.demo3.dto;
import java.time.LocalDateTime;
public record ImportLogDTO(Long id, String dataType, String typeLabel, String fileName, String target,
                           int rows, int ok, int warn, String status, String operator, LocalDateTime createdAt) {}
```
```java
// ImportLogReq.java
package com.park.demo3.dto;
import jakarta.validation.constraints.*;
public record ImportLogReq(
    @NotBlank String dataType,
    @NotBlank String typeLabel,
    @NotBlank String fileName,
    String target,
    @Min(0) int rows,
    @Min(0) int ok,
    @Min(0) int warn,
    @Pattern(regexp = "complete|partial|rejected", message = "status 非法") String status) {}
```
```java
// ImportLogOverviewDTO.java
package com.park.demo3.dto;
import java.util.List;
public record ImportLogOverviewDTO(List<ImportLogDTO> latestByType, List<ImportLogDTO> history) {}
```

- [ ] **Step 2: 写 ImportLogServiceTest（先失败）— 白名单校验 + toDTO 映射**

```java
package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.dto.ImportLogReq;
import com.park.demo3.mapper.*;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class ImportLogServiceTest {
    private final ImportLogMapper mapper = mock(ImportLogMapper.class);
    private final AuthUserMapper users = mock(AuthUserMapper.class);
    private final ImportLogService svc = new ImportLogService(mapper, users);

    @Test void record_rejectsUnknownDataType() {
        ImportLogReq req = new ImportLogReq("bogus", "X", "f.xlsx", null, 1, 1, 0, "complete");
        assertThatThrownBy(() -> svc.record(req)).isInstanceOf(BizException.class);
    }
    @Test void record_insertsWithResolvedOperator() {
        when(users.selectOne(any())).thenReturn(null); // operator 回退 username
        ImportLogReq req = new ImportLogReq("salary", "工资明细", "工资.xlsx", "2026-05", 10, 9, 1, "partial");
        // insert 回填 id 模拟(见实现:record 后 selectById);此处仅验不抛 + mapper.insert 被调用
        svc.record(req);
        verify(mapper).insert(argThat(l -> "salary".equals(l.getDataType()) && "partial".equals(l.getStatus())));
    }
}
```

> `KNOWN_TYPES` 白名单 = `ledger,s10,pv,charging_7,charging_8,elec,salary,office_13,office_14`。

- [ ] **Step 3: 运行确认失败**

Run: `./mvnw -q -f backend/pom.xml -o test -Dtest=ImportLogServiceTest`
Expected: FAIL（ImportLogService 不存在 / 编译失败）

- [ ] **Step 4: 写 ImportLogService**

```java
package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.common.*;
import com.park.demo3.dto.*;
import com.park.demo3.entity.*;
import com.park.demo3.mapper.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import java.util.*;

@Service
public class ImportLogService {
    private static final Set<String> KNOWN_TYPES = Set.of(
        "ledger","s10","pv","charging_7","charging_8","elec","salary","office_13","office_14");
    private final ImportLogMapper mapper; private final AuthUserMapper users;
    public ImportLogService(ImportLogMapper mapper, AuthUserMapper users) { this.mapper = mapper; this.users = users; }

    public ImportLogDTO record(ImportLogReq req) {
        if (!KNOWN_TYPES.contains(req.dataType())) throw new BizException(ResultCode.BAD_REQUEST, "未知数据类型");
        ImportLog l = new ImportLog();
        l.setDataType(req.dataType()); l.setTypeLabel(req.typeLabel()); l.setFileName(req.fileName());
        l.setTarget(req.target()); l.setRows(req.rows()); l.setOk(req.ok()); l.setWarn(req.warn());
        l.setStatus(req.status()); l.setOperator(resolveOperator());
        mapper.insert(l);           // createdAt 由 MetaObjectHandler 填, id 回填
        return toDTO(mapper.selectById(l.getId()));
    }

    public ImportLogOverviewDTO overview(int days, int historyLimit) {
        return new ImportLogOverviewDTO(
            mapper.latestByType().stream().map(this::toDTO).toList(),
            mapper.recent(days, historyLimit).stream().map(this::toDTO).toList());
    }

    private String resolveOperator() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        String username = auth == null ? null : String.valueOf(auth.getName());
        if (username == null) return null;
        AuthUser u = users.selectOne(new QueryWrapper<AuthUser>().eq("username", username));
        return u != null && u.getDisplayName() != null ? u.getDisplayName() : username;
    }

    private ImportLogDTO toDTO(ImportLog l) {
        return new ImportLogDTO(l.getId(), l.getDataType(), l.getTypeLabel(), l.getFileName(), l.getTarget(),
            l.getRows(), l.getOk(), l.getWarn(), l.getStatus(), l.getOperator(), l.getCreatedAt());
    }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `./mvnw -q -f backend/pom.xml -o test -Dtest=ImportLogServiceTest`
Expected: PASS（2 tests）

- [ ] **Step 6: 写 Controller**

```java
package com.park.demo3.controller;
import com.park.demo3.dto.*;
import com.park.demo3.service.ImportLogService;
import io.swagger.v3.oas.annotations.*;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@Tag(name = "导入中心")
@Validated
@RestController
@RequestMapping("/api/import-log")
public class ImportLogController {
    private final ImportLogService svc;
    public ImportLogController(ImportLogService svc) { this.svc = svc; }

    @Operation(summary = "记录一次导入") @PostMapping
    public ImportLogDTO record(@Valid @RequestBody ImportLogReq req) { return svc.record(req); }

    @Operation(summary = "导入中心概览(每类最新 + 近N天历史)") @GetMapping("/overview")
    public ImportLogOverviewDTO overview(
        @RequestParam(defaultValue = "30") @Min(1) @Max(365) int days,
        @RequestParam(defaultValue = "100") @Min(1) @Max(500) int historyLimit) {
        return svc.overview(days, historyLimit);
    }
}
```

- [ ] **Step 7: 写 ImportLogApiIT（Testcontainers 真库）**

```java
package com.park.demo3.api;
import com.park.demo3.AbstractMysqlIT;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@AutoConfigureMockMvc
class ImportLogApiIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    private String auth() throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
            .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
            .andReturn().getResponse().getContentAsString();
        return "Bearer " + JsonPath.read(body, "$.data.token");
    }

    @Test void post_thenOverview_recordsAndLists() throws Exception {
        String tok = auth();
        mvc.perform(post("/api/import-log").header("Authorization", tok).contentType("application/json")
            .content("{\"dataType\":\"salary\",\"typeLabel\":\"工资明细\",\"fileName\":\"s.xlsx\",\"rows\":10,\"ok\":9,\"warn\":1,\"status\":\"partial\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(0))
            .andExpect(jsonPath("$.data.status").value("partial"))
            .andExpect(jsonPath("$.data.operator").isNotEmpty())   // resolveOperator 填了 admin displayName
            .andExpect(jsonPath("$.data.createdAt").isNotEmpty());
        mvc.perform(get("/api/import-log/overview").header("Authorization", tok))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.latestByType[?(@.dataType=='salary')]").isNotEmpty())
            .andExpect(jsonPath("$.data.history[?(@.fileName=='s.xlsx')]").isNotEmpty());
    }

    @Test void post_unknownType_returns400InBody() throws Exception {
        // dataType 白名单外 → BizException(BAD_REQUEST) → 码在体内 400(HTTP 200)
        mvc.perform(post("/api/import-log").header("Authorization", auth()).contentType("application/json")
            .content("{\"dataType\":\"bogus\",\"typeLabel\":\"X\",\"fileName\":\"f.xlsx\",\"rows\":1,\"ok\":1,\"warn\":0,\"status\":\"complete\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(400));
    }

    @Test void post_badStatus_returns400() throws Exception {
        // @Pattern 校验失败 → HTTP 400
        mvc.perform(post("/api/import-log").header("Authorization", auth()).contentType("application/json")
            .content("{\"dataType\":\"salary\",\"typeLabel\":\"X\",\"fileName\":\"f.xlsx\",\"rows\":1,\"ok\":1,\"warn\":0,\"status\":\"weird\"}"))
            .andExpect(status().isBadRequest());
    }

    @Test void overview_withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/import-log/overview")).andExpect(status().isUnauthorized());
    }
}
```

- [ ] **Step 8: 编排者亲跑全量 `./mvnw test`（不接管道）**

Run: `./mvnw -q -f backend/pom.xml test`（后读 `backend/target/surefire-reports/*.txt` 的 `Tests run` 汇总）
Expected: 全绿（既有 204 + 新 ImportLogApiIT 4 + ImportLogServiceTest 2 ≈ 210），failures=0 errors=0

- [ ] **Step 9: Commit**

```bash
git add backend/src/main/java/com/park/demo3/dto/ImportLog*.java backend/src/main/java/com/park/demo3/service/ImportLogService.java backend/src/main/java/com/park/demo3/controller/ImportLogController.java backend/src/test/java/com/park/demo3/service/ImportLogServiceTest.java backend/src/test/java/com/park/demo3/api/ImportLogApiIT.java
git commit -m "feat(import-center): import_log Service/Controller/DTO + IT"
```

---

## Task 3: 前端 importLog API + types + FpImportModal emit fileName

**Files:**
- Create: `frontend/src/types/importLog.ts`
- Create: `frontend/src/api/importLog.ts`
- Modify: `frontend/src/components/import/FpImportModal.vue`（emits + confirm/onSectionsConfirm/onLabelConfirm 附带 fileName）
- Modify: `frontend/src/components/import/FpImportModal.spec.ts`（补 fileName 断言）

**Interfaces:**
- Produces:
  - TS `ImportLogDTO`/`ImportLogReq`/`ImportLogOverviewDTO`（字段镜像后端）。
  - `importLogApi.record(req): Promise<ImportLogDTO>`、`importLogApi.overview(days?, historyLimit?): Promise<ImportLogOverviewDTO>`。
  - `FpImportModal` emits：`import: [recs: ImportRec[], fileName: string]`、`importSections: [picks, fileName: string]`。

- [ ] **Step 1: types/importLog.ts**

```ts
export interface ImportLogDTO {
  id: number; dataType: string; typeLabel: string; fileName: string; target: string | null
  rows: number; ok: number; warn: number; status: 'complete' | 'partial' | 'rejected'
  operator: string | null; createdAt: string
}
export interface ImportLogReq {
  dataType: string; typeLabel: string; fileName: string; target?: string | null
  rows: number; ok: number; warn: number; status: 'complete' | 'partial' | 'rejected'
}
export interface ImportLogOverviewDTO { latestByType: ImportLogDTO[]; history: ImportLogDTO[] }
```

- [ ] **Step 2: api/importLog.ts**

```ts
import http from './index'
import type { ImportLogReq, ImportLogDTO, ImportLogOverviewDTO } from '../types/importLog'
export const importLogApi = {
  record: (req: ImportLogReq): Promise<ImportLogDTO> => http.post('/import-log', req),
  overview: (days = 30, historyLimit = 100): Promise<ImportLogOverviewDTO> =>
    http.get('/import-log/overview', { params: { days, historyLimit } }),
}
```

- [ ] **Step 3: 改 FpImportModal emits + 三个 confirm 函数带 fileName**

在 `defineEmits` 改签名：
```ts
const emit = defineEmits<{
  close: []
  import: [recs: ImportRec[], fileName: string]
  importSections: [picks: { label?: string; year?: number; month?: number; phase?: number; records: ImportRec[] }[], fileName: string]
}>()
```
在 `confirm()`、`onSectionsConfirm()`、`onLabelConfirm()` 每个 `emit(...)` 末尾追加 `fileName.value || '（粘贴）'`：
```ts
function confirm() {
  if (!records.value) return
  emit('import', records.value.map(r => { const { __preview, ...rest } = r; void __preview; return rest }), fileName.value || '（粘贴）')
}
// onSectionsConfirm / onLabelConfirm 同理,emit 第二实参传 fileName.value || '（粘贴）'
```

- [ ] **Step 4: 补 spec — emit 附带 fileName**

在 `FpImportModal.spec.ts` 加：上传/粘贴后触发 confirm，断言 `wrapper.emitted('import')![0][1]` 为文件名或 `'（粘贴）'`。（沿用该 spec 既有的挂载与触发方式。）

- [ ] **Step 5: 跑前端单测 + build**

Run: `cd frontend && npm run test:unit -- FpImportModal && npm run build`
Expected: vitest 绿 + `vue-tsc` build 绿

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/importLog.ts frontend/src/api/importLog.ts frontend/src/components/import/FpImportModal.vue frontend/src/components/import/FpImportModal.spec.ts
git commit -m "feat(import-center): importLog api/types + FpImportModal emit fileName"
```

---

## Task 4: 共享 importRegistry + runImport 记录链

**Files:**
- Create: `frontend/src/utils/importRegistry.ts`
- Create: `frontend/src/utils/importRegistry.spec.ts`

**Interfaces:**
- Consumes: `importLogApi`（Task 3）；各 `xxxApi.importRows/import`（既有）；各屏现有解析常量（columnMap/customParse/phaseLayouts/nameLabels/templateCols）。
- Produces:
  - `ImportTypeEntry { key, label, tag, icon, context: 'none'|'ledger', modalProps(ctx), run(payload, ctx): Promise<ImportResultDTO>, target(ctx): string|null }`
  - `IMPORT_TYPES: ImportTypeEntry[]`（9 条，key 同后端白名单）。
  - `runImport(key: string, payload, ctx, fileName: string): Promise<ImportResultDTO>` — 调 `entry.run` → 算 status → `importLogApi.record`（best-effort，失败仅 console.warn，不吞 result）→ 返回 result。
  - `deriveStatus(res): 'complete'|'partial'|'rejected'`（`ok=res.imported`；`warn=res.skipped + res.errors.length`；ok==0→rejected，warn>0→partial，else complete）。

- [ ] **Step 1: 写 importRegistry.spec.ts（先失败）— deriveStatus + runImport 记录链**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/api/importLog', () => ({ importLogApi: { record: vi.fn().mockResolvedValue({}) } }))
import { deriveStatus, runImport, IMPORT_TYPES } from './importRegistry'
import { importLogApi } from '@/api/importLog'

describe('deriveStatus', () => {
  it('rejected when nothing imported', () => expect(deriveStatus({ imported: 0, skipped: 0, errors: [] })).toBe('rejected'))
  it('partial when some skipped', () => expect(deriveStatus({ imported: 5, skipped: 1, errors: [] })).toBe('partial'))
  it('complete when clean', () => expect(deriveStatus({ imported: 5, skipped: 0, errors: [] })).toBe('complete'))
})
describe('runImport', () => {
  beforeEach(() => vi.clearAllMocks())
  it('runs entry then records log with resolved status, returns result', async () => {
    const entry = { key: 'salary', label: '工资明细', tag: '附表12', run: vi.fn().mockResolvedValue({ imported: 9, skipped: 1, errors: [] }), target: () => '2026-05' } as any
    // 临时注册或从 IMPORT_TYPES 取真实条目并 stub 其 run — 用真实条目：
    const real = IMPORT_TYPES.find(t => t.key === 'salary')!
    const spy = vi.spyOn(real, 'run').mockResolvedValue({ imported: 9, skipped: 1, errors: [] } as any)
    const res = await runImport('salary', { rows: [] }, {}, 's.xlsx')
    expect(res).toEqual({ imported: 9, skipped: 1, errors: [] })
    expect(importLogApi.record).toHaveBeenCalledWith(expect.objectContaining({ dataType: 'salary', fileName: 's.xlsx', ok: 9, warn: 1, status: 'partial' }))
    spy.mockRestore()
  })
  it('does not throw when log record fails', async () => {
    vi.mocked(importLogApi.record).mockRejectedValueOnce(new Error('net'))
    const real = IMPORT_TYPES.find(t => t.key === 'pv')!
    vi.spyOn(real, 'run').mockResolvedValue({ imported: 3, skipped: 0, errors: [] } as any)
    await expect(runImport('pv', {}, {}, 'p.xlsx')).resolves.toMatchObject({ imported: 3 })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npm run test:unit -- importRegistry`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写 importRegistry.ts（骨架 + deriveStatus + runImport + 9 条）**

结构（每条 `run` **搬对应 View 现有 onImport/onSmartImport 体**，保持行为不变）：
```ts
import type { ImportResultDTO } from '@/types/import'
import { importLogApi } from '@/api/importLog'
// 各屏 api + 解析常量按需 import（ledgerApi/s10Api/pvApi/chargingApi/elecApi/salaryApi/utilitiesApi;
// lgColumns/FEE_KEYS、s10 layout、importChargingRows、importElecRows、importPvSections、salary columnMap 等）

export type ImportStatus = 'complete' | 'partial' | 'rejected'
export function deriveStatus(res: ImportResultDTO): ImportStatus {
  const warn = res.skipped + res.errors.length
  if (res.imported === 0) return 'rejected'
  return warn > 0 ? 'partial' : 'complete'
}

export interface ImportTypeEntry {
  key: string; label: string; tag: string; icon: string
  context: 'none' | 'ledger'
  modalProps: (ctx: any) => Record<string, unknown>
  run: (payload: any, ctx: any) => Promise<ImportResultDTO>
  target: (ctx: any) => string | null
}

export const IMPORT_TYPES: ImportTypeEntry[] = [ /* 见下 9 条 */ ]

export async function runImport(key: string, payload: any, ctx: any, fileName: string): Promise<ImportResultDTO> {
  const entry = IMPORT_TYPES.find(t => t.key === key)
  if (!entry) throw new Error('unknown import type: ' + key)
  const res = await entry.run(payload, ctx)
  try {
    await importLogApi.record({
      dataType: entry.key, typeLabel: entry.label, fileName: fileName || '（粘贴）',
      target: entry.target(ctx), rows: res.imported + res.skipped + res.errors.length,
      ok: res.imported, warn: res.skipped + res.errors.length, status: deriveStatus(res),
    })
  } catch (e) { console.warn('[import-log] 记录失败(不影响导入):', e) }
  return res
}
```
9 条 key/label/tag/icon/context（run 体从对应 View 迁入）：
| key | label | tag | icon | context | run 来源 |
|---|---|---|---|---|---|
| `ledger` | 月度台账 | 凭证 | book-open | ledger | LedgerView onImport（`ledgerApi.import(ctx.companyId, ctx.year, ctx.month, {rows})`） |
| `s10` | 销售收入 | 附表10 | coins | none | S10View onSmartImport（逐段 `s10Api.importRows`） |
| `pv` | 光伏发电 | 附表6 | sun | none | PvView onImport（importPvSections → `pvApi.importRows`） |
| `charging_7` | 汽车充电桩 | 附表7 | car | none | ChargingView onImport（`chargingApi.importRows(7, {rows})`，cats 内部取） |
| `charging_8` | 电动车充电桩 | 附表8 | bike | none | ChargingView onImport（no=8） |
| `elec` | 电费成本 | 附表11 | zap | none | ElecView onImport（`elecApi.importRows(rows)`） |
| `salary` | 工资明细 | 附表12 | wallet | none | SalaryView 多月分段（逐段 `salaryApi.importRows`） |
| `office_13` | 办公水电 | 附表13 | plug | none | UtilitiesView onImport（no=13，按 acct 年分组 `utilitiesApi.importRows`） |
| `office_14` | 三期水电 | 附表14 | plug | none | UtilitiesView onImport（no=14） |

> `target(ctx)`：ledger → `` `${ctx.year}-${String(ctx.month).padStart(2,'0')} · ${ctx.companyName}` ``；其余 → `null`（文件自足，期/月在结果里）。`modalProps` 返回该屏原 `<FpImportModal>` 的 props（templateCols/columnMap/customParse/phaseLayouts/nameLabels/defaults）。

- [ ] **Step 4: 运行确认通过**

Run: `cd frontend && npm run test:unit -- importRegistry`
Expected: PASS（deriveStatus 3 + runImport 2）

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/importRegistry.ts frontend/src/utils/importRegistry.spec.ts
git commit -m "feat(import-center): 共享 importRegistry + runImport 记录链"
```

---

## Task 5: 8 屏改造为消费 registry（行为不变回归）

**Files:**
- Modify: `frontend/src/views/ledger/LedgerView.vue`、`sales-income/S10View.vue`、`pv/PvView.vue`、`charging/ChargingView.vue`、`elec/ElecView.vue`、`salary/SalaryView.vue`、`utilities/UtilitiesView.vue`

**Interfaces:**
- Consumes: `IMPORT_TYPES` / `runImport`（Task 4）；`FpImportModal` 新 emit（Task 3）。

**做法（每屏一致）：** 该屏 `<FpImportModal>` 的解析 props 改从 `IMPORT_TYPES.find(t=>t.key===...).modalProps(ctx)` 取（`v-bind`）；`@import`/`@importSections` 处理器改为 `(recs, fileName) => runImport(key, recs, ctx, fileName).then(res => { importResult.value = res; refresh… })`。原 `onImport` 体已迁入 registry（Task 4），此处删除本地重复。ChargingView 两实例分别用 `charging_7`/`charging_8`；UtilitiesView 按当前 `no` 选 `office_13`/`office_14`。**行为、UI、toast 不变。**

- [ ] **Step 1: 逐屏改造（7 个文件，按上面做法）**

（每屏：import `IMPORT_TYPES,runImport`；模板 `<FpImportModal v-bind="modalPropsFor(...)" @import="..." @importSections="...">`；删本地 onImport 体。ledger 的 ctx 含 `companyId/companyName/year/month`。）

- [ ] **Step 2: build + 全量前端单测**

Run: `cd frontend && npm run build && npm run test:unit`
Expected: `vue-tsc` build 绿 + 全部 vitest 绿（含既有各屏测试无回归）

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views
git commit -m "refactor(import-center): 8 屏导入改为消费共享 importRegistry"
```

---

## Task 6: 导入中心屏 ImportCenterView + 路由换真屏

**Files:**
- Create: `frontend/src/views/import-center/ImportCenterView.vue`
- Create: `frontend/src/views/import-center/ImportTypeTile.vue`（卡片）
- Modify: `frontend/src/router/index.ts`（`import` value → 动态 import ImportCenterView）

**Interfaces:**
- Consumes: `importLogApi.overview`、`IMPORT_TYPES`、`runImport`（就地导入）、`FpImportModal`、`FPSortableTable`、`Card`/`Button`/`StatusBadge`。

- [ ] **Step 1: 写 ImportCenterView（1:1 screen-import.jsx 三块）**

结构：页头（标题/副标题/动作，「下载模板」禁用占位）→ 顶部「选择数据类型上传」区 → 数据类型卡片网格（`IMPORT_TYPES` map 成 `ImportTypeTile`，状态由 overview.latestByType[key] 派生：complete→done/partial→partial/warn>0→warn/无→missing；显最近导入时间+行数）→ 导入记录表（`FPSortableTable`，列 文件/类型/行数/结果/操作人/时间/状态，`overview.history`，时间倒序，「近30天」）。§6 加载门：overview 未就绪显转圈。点卡片「上传」：`context==='ledger'` 先显 公司(下拉,`companyApi.list()`)+年+月 → 开 `FpImportModal`；`'none'` 直接开。导入完 `runImport` → 重拉 overview + toast。样式 1:1 移植 `screen-import.jsx` 的 `ImStyles`（`.im/.im-drop/.im-tile/.im-pill…`，scoped）。

- [ ] **Step 2: 路由换真屏**

在 `router/index.ts` 的视图映射链加 `import` → `() => import('@/views/import-center/ImportCenterView.vue')`（替换落到 PlaceholderView 的分支）。

- [ ] **Step 3: build + 加载态/渲染 vitest（overview mock）**

Run: `cd frontend && npm run build && npm run test:unit -- ImportCenter`
Expected: build 绿；渲染测试（mock overview → 9 卡 + 历史行 + 状态药丸）绿。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/import-center frontend/src/router/index.ts
git commit -m "feat(import-center): ImportCenterView(卡片+历史+就地导入) + 路由换真屏"
```

---

## Task 7: 端到端真跑验证（编排者亲验）

**做法：** 起真后端 + MySQL + preview，用真实 xlsx 端到端验证（IMPORT-GUIDE §四；含中文走浏览器不用 curl）。

- [ ] **Step 1: 起后端 + 前端**

```bash
cd backend && export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-17.0.18.8-hotspot" && DB_PORT=13306 java -jar target/demo3-backend-0.0.1.jar   # 另窗
cd frontend && npm run dev
```

- [ ] **Step 2: preview 肉眼验（导入中心）**
  - 打开 `/import`：9 张卡渲染、状态药丸对真值（无记录=未导入）、导入记录表空/有数据。
  - 点「工资明细」卡上传 → 就地开抽屉 → 真实 `工资测试.xlsx` 导入 → 记录表出现新行（文件名/类型/行数/结果/时间/操作人/状态全对）、卡片翻新 done/partial。
  - 点「月度台账」卡上传 → 先选公司+年+月 → 导入 → target 显 `2026-05 · 公司名`。
  - `office_13`/`office_14` 两卡各导对子表。
- [ ] **Step 3: preview 验原屏也落 log**
  - 开 `/salary` 原屏导入一次 → 回 `/import` 记录表出现该条（验证单一记录链）。
  - 全程 0 console error。
- [ ] **Step 4: 收尾**：验证后杀 :8080（用户要求不留占用）；记录 head commit。

---

## Self-Review

**Spec coverage：** import_log 表(§2)→Task1；两端点+operator+白名单(§3)→Task2；registry+runImport+fileName(§4)→Task3/4；8 屏改造(§4.3)→Task5；hub 屏三块+就地导入+路由(§5)→Task6；错误处理(§6)→Task2(400/401)+Task4(best-effort)；测试(§7)→Task2/4/6/7；延后项(§9)未建任务(正确)。**全覆盖。**

**Placeholder scan：** 无 TBD/TODO；backend 代码完整给出；registry 9 条与 8 屏改造给了「搬现有 onImport 体」的确切来源与做法（实现者读对应 View）——非占位，是「迁移既有逻辑」的明确指令。

**Type consistency：** `data_type`/`key` 白名单 9 值在 后端 KNOWN_TYPES(Task2) / registry IMPORT_TYPES(Task4) / hub 卡片(Task6) 三处一致；`ImportLogReq`/`ImportLogDTO` 字段后端(Task2)与前端 types(Task3)镜像一致；`deriveStatus` 的 warn=`skipped+errors.length`、ok=`imported` 与 §2 status 派生一致；`runImport(key,payload,ctx,fileName)` 签名 Task4 定义、Task5/6 调用一致；`FpImportModal` emit 附带 fileName 在 Task3 定义、Task5/6 消费一致。
