# 三期公摊池开放 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户不改代码就能把三期(以及以后任何新期区)的公共电核算从零建起来——建表、建池、算钱、出催缴单。

**Architecture:** 期区从「遍历电表反推」改成 `building.zone` 显式字段；值域从写死的 `p1|p2|dorm` 放宽成 `p\d+|dorm`；候选清单由 `GET /api/zones` 数据驱动；**计费口径**从按期区名字硬分叉改成期级参数 `zone_calc_kind`(flat/tou)。

**Tech Stack:** Spring Boot 3 + MyBatis-Plus + Flyway + MySQL 8 / Vue 3 + Pinia + Vitest / Testcontainers

**Spec:** `docs/superpowers/specs/2026-08-29-phase3-pool-opening-design.md`

## Global Constraints

- **不要接管道跑测试。** `mvnw.cmd test | tail` 的退出码取自 `tail`(恒 0),会把失败报成成功。见 `docs/design/IMPORT-GUIDE.md:59`。直接跑，或读输出 grep `Tests run` / `ERROR`。
- **后端测试命令**(PowerShell，cwd = `C:\financial_dashboard\demo3\backend`)：`.\mvnw.cmd -q test "-Dtest=X"`。`-Dtest=` 必须加引号，否则逗号被 PowerShell 当数组分隔符。单方法用 `"-Dtest=类#方法"`，多方法用 `+` 连。
- **纯 JVM 测试秒级，IT 要 Docker。** `ParamRegistryTest` / `AllocServiceTest` / `QueryHygieneTest` 不起 Spring 不连库，先跑它们拿反馈。`*IT` 需要 Docker Desktop 在跑；本机 `~/.testcontainers.properties` 已设 `testcontainers.reuse.enable=true`，热启动十几秒，冷启动 8–15 分钟。
- **前端测试**：cwd = `frontend`，`npx vitest run <路径>`。类型闸 `npm run typecheck` —— 放宽 zone 联合类型后**必跑**。
- **两种 400 要选对**：`@Pattern`/`@NotBlank` 校验失败 = HTTP 400 → `status().isBadRequest()`；业务异常(`BizException`，如 `ParamRegistry.allowed` 不通过) = HTTP 200 + 包体 `code=400` → `status().isOk()` + `jsonPath("$.code").value(400)`。
- **IT 写数据一律用 2099 远期账期槽**(`2099-05`/`2099-11`…)，避开种子数据；类上 `@Transactional` 自动回滚。
- **`p\d+` 会收下 `p0`/`p10`/`p007`。** 需要「非法期区」夹具时只能用**非数字**后缀(`px`/`p`/`zzz`)。
- **纯函数 spec 的写法不能推倒**：`meterExcel.ts` / `poolLedgerLogic.ts` 的期区字典必须以**参数注入**，不能改成组件内异步拉取，否则 45 例 `meterExcel.spec.ts` 全部要重写。
- 最新迁移是 `V112`，本计划新增 `V113`、`V114`。

---

## 文件结构

**新建**

| 文件 | 职责 |
|---|---|
| `backend/.../db/migration/V113__building_zone.sql` | `building.zone` 列 + 众数回填 |
| `backend/.../db/migration/V114__zone_calc_kind.sql` | `zone_calc_kind` 参数行(p1→flat / p2→tou) |
| `backend/.../dto/ZoneDTO.java` | `{code, name, sortNo}` |
| `backend/.../service/ZoneService.java` | 候选清单派生 + label 生成(纯逻辑，可单测) |
| `backend/.../controller/ZoneController.java` | `GET /api/zones` |
| `backend/.../service/ZoneServiceTest.java` | 纯单测 |
| `frontend/src/api/zones.ts` | `zonesApi.list()` |
| `frontend/src/stores/zones.ts` | pinia 缓存(全站共用一份，避免每屏各拉) |
| `frontend/src/utils/zoneLabel.ts` | `p{n}` → 中文数字+期；**纯函数**，供 meterExcel 等纯函数模块注入 |
| `frontend/src/utils/zoneLabel.spec.ts` | 纯单测 |

**改动**：见 spec §7 的 A–G 七组。

---

## 任务依赖

```
T1 (building.zone 迁移)
 ├─→ T2 (GET /api/zones) ─→ T7 (前端接口化) ─┬─→ T6  (楼栋管理字段)
 │                                          ├─→ T8  (抄表 Excel)
 │                                          └─→ T10 (楼层/方位)
 ├─→ T4 (zoneOfBuilding 读列)
 └─→ T3 (值域放宽 + 夹具) ─→ T5 (P7 计费口径)

T9 (meter-diff) ← 与以上全部无依赖，任何时候可做

⚠ T6 排在 T7 之后（编号顺序 ≠ 执行顺序）：楼栋管理的期区下拉要用
   T7 Step 7 建的 `api/zones.ts` + `stores/zones.ts`。
```

---

### Task 1: `building.zone` 列 + 众数回填

**Files:**
- Create: `backend/src/main/resources/db/migration/V113__building_zone.sql`
- Modify: `backend/src/main/java/com/park/demo3/entity/Building.java:8`

**Interfaces:**
- Consumes: 无
- Produces: `building.zone` 列(`VARCHAR(8) NULL`)；`Building.getZone()` / `setZone(String)`

- [ ] **Step 1: 写迁移**

`backend/src/main/resources/db/migration/V113__building_zone.sql`:

```sql
-- V113__building_zone.sql — 期区从「遍历电表反推」改成楼栋上的显式字段。
-- 背景:AllocService.loadCtx 一直靠 meter.zone 的首块表推楼栋期区(putIfAbsent),
-- 三期 0 块表 → 推不出期区 → 建不了三期的表。鸡生蛋。
-- 注意 zone ≠ phase:一期宿舍一~四栋 phase=1 但 zone=dorm;phase=4 那三栋是宿舍类不是四期。

ALTER TABLE building
  ADD COLUMN zone VARCHAR(8) NULL COMMENT '期区(p1/p2/p3…/dorm);唯一事实来源。NULL=未标注,引擎回退按该栋首块表的 zone 猜';

-- 回填:按该栋电表的**众数** zone(不是第一块 —— 二期二车间挂着 p2:20/p1:1/dorm:1 三种表,
-- 取首块的结果取决于遍历顺序)。平局按 zone 字典序取最小,保证同一份数据跑两次结果相同。
UPDATE building b
JOIN (
  SELECT building_id, zone FROM (
    SELECT building_id, zone,
           ROW_NUMBER() OVER (PARTITION BY building_id ORDER BY COUNT(*) DESC, zone ASC) AS rn
    FROM meter
    WHERE building_id IS NOT NULL AND zone IS NOT NULL
    GROUP BY building_id, zone
  ) t WHERE rn = 1
) m ON m.building_id = b.id
SET b.zone = m.zone;

-- 无表的 9 栋留 NULL,由用户在楼栋管理里选:
--   三期 创业大厦 / 三期 工业大厦 / 三期(待清空旧桶) / 散租宿舍 / 保障房 / 饭堂
--   / 二期 一至四车间 / 二期 五、六车间 / 一期 空地
```

- [ ] **Step 2: 实体加字段**

`backend/src/main/java/com/park/demo3/entity/Building.java:8` 现在是：

```java
    private String name; private Integer phase; private Integer floorCount;
```

改成：

```java
    private String name; private Integer phase; private String zone; private Integer floorCount;
```

- [ ] **Step 3: 跑迁移并核对回填结果**

```bash
cd backend && ./mvnw -q test "-Dtest=SeedIT"
```

Expected: PASS(迁移能跑通)。

然后直接查库核对众数回填：

```bash
docker exec demo3-mysql mysql --default-character-set=utf8mb4 -uroot -proot park_demo3 -N -e "SELECT id,name,phase,IFNULL(zone,'(NULL)') FROM building ORDER BY id;"
```

Expected:
- 楼 31「二期 二车间」→ `p2`(**关键**：它挂着 p2:20 / p1:1 / dorm:1 三种表，取众数才是 p2)
- 一期宿舍一~四栋(26/27/28/12) → `dorm`(不是 p1 —— 证明没用 phase)
- 三期三条(17/36/37) → `(NULL)`
- 恰好 9 栋是 NULL

- [ ] **Step 4: 提交**

```bash
git add backend/src/main/resources/db/migration/V113__building_zone.sql backend/src/main/java/com/park/demo3/entity/Building.java
git commit -m "feat(zone): building 加 zone 列,按电表众数回填"
```

---

### Task 2: `GET /api/zones`

**Files:**
- Create: `backend/src/main/java/com/park/demo3/dto/ZoneDTO.java`
- Create: `backend/src/main/java/com/park/demo3/service/ZoneService.java`
- Create: `backend/src/main/java/com/park/demo3/controller/ZoneController.java`
- Test: `backend/src/test/java/com/park/demo3/service/ZoneServiceTest.java`

**Interfaces:**
- Consumes: `Building.getZone()` (T1)
- Produces:
  - `record ZoneDTO(String code, String name, int sortNo)`
  - `static String ZoneService.label(String code)` — `"p3"` → `"三期"`，`"dorm"` → `"宿舍"`，未知 → 原样返回 code
  - `static List<ZoneDTO> ZoneService.candidates(List<String> stored)` — 已存期区 ∪ 基础清单，`dorm` 恒排尾
  - `GET /api/zones` → `ZoneDTO[]`

- [ ] **Step 1: 先写失败的纯单测**

`backend/src/test/java/com/park/demo3/service/ZoneServiceTest.java`:

```java
package com.park.demo3.service;

import com.park.demo3.dto.ZoneDTO;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

// 期区候选清单 = 库里已标注的 building.zone ∪ 基础清单{p1,p2,p3,dorm}。
// 基础清单必须在:三期一栋楼都还没标之前,下拉里也得有「三期」可选,否则鸡生蛋破不了。
class ZoneServiceTest {

    @Test
    void label_generatesChineseNumeral() {
        assertEquals("一期", ZoneService.label("p1"));
        assertEquals("二期", ZoneService.label("p2"));
        assertEquals("三期", ZoneService.label("p3"));
        assertEquals("十期", ZoneService.label("p10"));
        assertEquals("十一期", ZoneService.label("p11"));
        assertEquals("宿舍", ZoneService.label("dorm"));
    }

    @Test
    void label_unknownFallsBackToCode() {
        // 兜底存在的意义:前端字典下标读没有编译期护栏(tsconfig 没开 noUncheckedIndexedAccess),
        // 后端这里也别返回 null,否则导出文件名会印出 "null"
        assertEquals("px", ZoneService.label("px"));
    }

    @Test
    void candidates_unionsBaseListAndSortsDormLast() {
        var out = ZoneService.candidates(List.of("p2", "dorm"));
        assertEquals(List.of("p1", "p2", "p3", "dorm"), out.stream().map(ZoneDTO::code).toList());
    }

    @Test
    void candidates_keepsStoredZonesBeyondBaseList() {
        // 用户建了四期楼 → p4 必须出现在清单里(这正是「加期不改码」的验收点)
        var codes = ZoneService.candidates(List.of("p4")).stream().map(ZoneDTO::code).toList();
        assertEquals(List.of("p1", "p2", "p3", "p4", "dorm"), codes);
    }

    @Test
    void candidates_dedupesAndIgnoresBlanks() {
        var codes = ZoneService.candidates(java.util.Arrays.asList("p1", "p1", null, "", "  "))
                .stream().map(ZoneDTO::code).toList();
        assertEquals(List.of("p1", "p2", "p3", "dorm"), codes);
    }

    @Test
    void candidates_numericOrderNotLexical() {
        // 字典序会把 p10 排在 p2 前面 —— 必须按数字排
        var codes = ZoneService.candidates(List.of("p10")).stream().map(ZoneDTO::code).toList();
        assertEquals(List.of("p1", "p2", "p3", "p10", "dorm"), codes);
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd backend && ./mvnw -q test "-Dtest=ZoneServiceTest"
```

Expected: FAIL —— 编译错误 `cannot find symbol: class ZoneService`。

- [ ] **Step 3: 写 DTO**

`backend/src/main/java/com/park/demo3/dto/ZoneDTO.java`:

```java
package com.park.demo3.dto;

/** 期区候选一项:code=p1/p2/p3…/dorm;name=显示名;sortNo=展示序(dorm 恒最后)。 */
public record ZoneDTO(String code, String name, int sortNo) {}
```

- [ ] **Step 4: 写 ZoneService**

`backend/src/main/java/com/park/demo3/service/ZoneService.java`:

```java
package com.park.demo3.service;

import com.park.demo3.dto.ZoneDTO;
import com.park.demo3.mapper.BuildingMapper;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 期区候选清单。唯一事实来源是 building.zone;基础清单只保证「还没有任何楼标注时也选得出来」。
 * 加四期 = 建栋楼选 p4,不改这里的代码。
 */
@Service
public class ZoneService {

    /** 期区码形态。与后端各处 @Pattern 同一口径,改这里必须同步改那 7 处。 */
    public static final String ZONE_REGEX = "p\\d+|dorm";
    private static final Pattern P_ZONE = Pattern.compile("p(\\d+)");
    /** 基础清单:破鸡生蛋用。dorm 不在这里排序,统一由 sortNo 兜到最后。 */
    private static final List<String> BASE = List.of("p1", "p2", "p3", "dorm");
    private static final String[] DIGITS = {"", "一", "二", "三", "四", "五", "六", "七", "八", "九"};

    private final BuildingMapper buildings;

    public ZoneService(BuildingMapper buildings) { this.buildings = buildings; }

    /** p3→「三期」;dorm→「宿舍」;认不出的原样返回(不返回 null,下游字典下标读没有护栏)。 */
    public static String label(String code) {
        if ("dorm".equals(code)) return "宿舍";
        if (code == null) return "";
        Matcher m = P_ZONE.matcher(code);
        if (!m.matches()) return code;
        return numeral(Integer.parseInt(m.group(1))) + "期";
    }

    /** 1→一 10→十 11→十一 20→二十 21→二十一。期区不会上百,只做到两位。 */
    private static String numeral(int n) {
        if (n <= 0 || n >= 100) return String.valueOf(n);
        if (n < 10) return DIGITS[n];
        if (n == 10) return "十";
        if (n < 20) return "十" + DIGITS[n % 10];
        return DIGITS[n / 10] + "十" + DIGITS[n % 10];
    }

    /** 排序键:p{n}→n;dorm→Integer.MAX_VALUE(恒最后)。 */
    private static int order(String code) {
        if ("dorm".equals(code)) return Integer.MAX_VALUE;
        Matcher m = P_ZONE.matcher(code);
        return m.matches() ? Integer.parseInt(m.group(1)) : Integer.MAX_VALUE - 1;
    }

    /** 已存期区 ∪ 基础清单,去重去空白,按 order 升序。 */
    public static List<ZoneDTO> candidates(List<String> stored) {
        Set<String> codes = new TreeSet<>(Comparator.comparingInt(ZoneService::order).thenComparing(c -> c));
        codes.addAll(BASE);
        for (String s : stored)
            if (s != null && !s.isBlank() && s.trim().matches(ZONE_REGEX)) codes.add(s.trim());
        List<ZoneDTO> out = new ArrayList<>();
        int i = 0;
        for (String c : codes) out.add(new ZoneDTO(c, label(c), i++));
        return out;
    }

    public List<ZoneDTO> list() {
        return candidates(buildings.selectList(null).stream()
                .map(com.park.demo3.entity.Building::getZone).toList());
    }
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd backend && ./mvnw -q test "-Dtest=ZoneServiceTest"
```

Expected: PASS，6 个用例全绿。

- [ ] **Step 6: 写 Controller**

`backend/src/main/java/com/park/demo3/controller/ZoneController.java`:

```java
package com.park.demo3.controller;

import com.park.demo3.dto.ZoneDTO;
import com.park.demo3.service.ZoneService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

// ⚠ 必须是 GET。SecurityConfig 的「读全开」只覆盖 GET;换成 POST 会掉进
// PermissionRegistry 的 catch-all,拿到一个语义不对的写权限。
@Tag(name = "期区")
@RestController
@RequestMapping("/api/zones")
public class ZoneController {

    private final ZoneService svc;

    public ZoneController(ZoneService svc) { this.svc = svc; }

    @Operation(summary = "期区候选(building.zone 去重 ∪ 基础清单;dorm 恒排尾)")
    @GetMapping
    public List<ZoneDTO> list() { return svc.list(); }
}
```

- [ ] **Step 7: 加端点 IT**

追加到 `backend/src/test/java/com/park/demo3/api/MeterApiIT.java`(该类已有 `mvc` / `auth()`，零新增 import)：

```java
    // ── 期区候选接口:三期即使一栋楼都没标注,也必须选得出来(破鸡生蛋) ──
    @Test
    void zones_listIncludesP3AndDormLast() throws Exception {
        mvc.perform(get("/api/zones").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data[?(@.code=='p3')].name").value("三期"))
                .andExpect(jsonPath("$.data[?(@.code=='p1')].name").value("一期"))
                .andExpect(jsonPath("$.data[-1:].code").value("dorm"));
    }
```

- [ ] **Step 8: 跑 IT**

```bash
cd backend && ./mvnw -q test "-Dtest=MeterApiIT#zones_listIncludesP3AndDormLast"
```

Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add backend/src/main/java/com/park/demo3/dto/ZoneDTO.java backend/src/main/java/com/park/demo3/service/ZoneService.java backend/src/main/java/com/park/demo3/controller/ZoneController.java backend/src/test/java/com/park/demo3/service/ZoneServiceTest.java backend/src/test/java/com/park/demo3/api/MeterApiIT.java
git commit -m "feat(zone): GET /api/zones 期区候选清单"
```

---

### Task 3: 后端值域放宽(9 处正则 + 5 处非正则)+ 测试夹具

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/dto/MeterReq.java:8`
- Modify: `backend/src/main/java/com/park/demo3/dto/AllocRuleReq.java:9`
- Modify: `backend/src/main/java/com/park/demo3/controller/MeterController.java:24,71,82`
- Modify: `backend/src/main/java/com/park/demo3/controller/AllocController.java:33`
- Modify: `backend/src/main/java/com/park/demo3/controller/ParamController.java:24,28`
- Modify: `backend/src/main/java/com/park/demo3/dto/ParamPutReq.java:11`
- Modify: `backend/src/main/java/com/park/demo3/dto/PriceCfgReq.java:8`
- Modify: `backend/src/main/java/com/park/demo3/service/MeterService.java:73,305`
- Modify: `backend/src/main/java/com/park/demo3/service/ParamRegistry.java:175,200,203`
- Modify: `backend/src/main/java/com/park/demo3/service/ParamService.java:173,293,326`
- Modify: `backend/src/main/java/com/park/demo3/service/AllocService.java:82`
- Test: `backend/src/test/java/com/park/demo3/service/ParamRegistryTest.java:71,74`
- Test: `backend/src/test/java/com/park/demo3/api/MeterApiIT.java:151`
- Test: `backend/src/test/java/com/park/demo3/api/ParamApiIT.java:222,318`
- Test: `backend/src/test/java/com/park/demo3/api/PriceCfgApiIT.java:208`

**Interfaces:**
- Consumes: `ZoneService.ZONE_REGEX` (T2)
- Produces: 所有 zone 入口接受 `p\d+|dorm`

> **⚠ 这个任务的核心风险**：正则只是**第一道**关。侦察自报 3 处非正则硬编码，对抗复查纠正为 **5 处**。只放宽正则会产生三种故障，两种是**静默**的：
> 1. `ParamService:173/293` 不改 → **HTTP 500**(`idOf("p3")` → `Integer.parseInt("p3")` → NumberFormatException)
> 2. `ParamRegistry:203` 不改 → 值写进库但 `ParamService:91` 静默 `continue` 跳过，页面永不显示
> 3. `ParamService:326` 不改 → p3 楼栋进得了损耗组算钱，参数中心里一行损耗参数都不出现

- [ ] **Step 1: 先改测试夹具的 `p9`(它们现在是绿的，改完值域会变红)**

`ParamRegistryTest.java:71` 与 `:74`：

```java
        assertFalse(ParamRegistry.allowed("elec_peak", "p9"));          // 非法 scope
```
→
```java
        assertFalse(ParamRegistry.allowed("elec_peak", "px"));          // 非法 scope(p\d+ 会收下 p9,只能用非数字后缀)
        assertTrue(ParamRegistry.allowed("elec_peak", "p3"));           // 三期:放宽后必须通过
```

```java
        assertNull(ParamRegistry.scopeKind("p9"));
```
→
```java
        assertNull(ParamRegistry.scopeKind("px"));
        assertEquals(ParamRegistry.ScopeKind.ZONE, ParamRegistry.scopeKind("p3"));
```

同样把 `p9` → `px`：
- `MeterApiIT.java:151`(⚠ 同方法 `157/158` 有 `imported=2` / `skipped=3` 断言，换成非数字后缀数字才不变)
- `ParamApiIT.java:222`、`ParamApiIT.java:318`
- `PriceCfgApiIT.java:208`

**不要动** `ElecImportApiIT.java:149` 与 `PvImportApiIT.java:139` 的 `p9` —— 那是 `phaseId` 另一套值域(`ElecService:139` / `PvService:130` 的 `Set.of("p1","p2","p3")`)，与 zone 无关。

- [ ] **Step 2: 跑纯单测确认现在是红的**

```bash
cd backend && ./mvnw -q test "-Dtest=ParamRegistryTest"
```

Expected: FAIL —— `assertTrue(ParamRegistry.allowed("elec_peak", "p3"))` 不通过(值域还没放宽)。

- [ ] **Step 3: 放宽 9 处正则**

```java
// MeterReq.java:8 / AllocRuleReq.java:9
@NotBlank @Pattern(regexp = "p1|p2|dorm") String zone,
→
@NotBlank @Pattern(regexp = "p\\d+|dorm") String zone,
```

```java
// MeterController.java:24,71,82  ⚠ 71 与 82 两行逐字相同,Edit 必须带上下文或 replace_all
// AllocController.java:33
@RequestParam(required = false) @Pattern(regexp = "p1|p2|dorm") String zone
→
@RequestParam(required = false) @Pattern(regexp = "p\\d+|dorm") String zone
```

```java
// ParamController.java:28  ⚠ 别漏 all,漏了 defaultValue="all" 自己 400
@RequestParam(defaultValue = "all") @Pattern(regexp = "all|p1|p2|dorm") String zone
→
@RequestParam(defaultValue = "all") @Pattern(regexp = "all|p\\d+|dorm") String zone
```

```java
// ParamPutReq.java:11
@Pattern(regexp = "^(|p1|p2|dorm|(building|meter|rule|tenant):\\d+)$") String scope,
→
@Pattern(regexp = "^(|p\\d+|dorm|(building|meter|rule|tenant):\\d+)$") String scope,

// PriceCfgReq.java:8  ⚠ 形态与上面不同,只有 tenant 一种带 id
@Pattern(regexp = "^(|p1|p2|dorm|tenant:\\d+)$") String scope,
→
@Pattern(regexp = "^(|p\\d+|dorm|tenant:\\d+)$") String scope,
```

- [ ] **Step 4: 改 5 处非正则硬编码**

**(a) `MeterService.java:73`** —— 导入路径唯一的把关(`MeterImportRequest.Row` 一个 `@Pattern` 都没有)：

```java
    private static boolean validZone(String s) { return "p1".equals(s) || "p2".equals(s) || "dorm".equals(s); }
```
→
```java
    private static final java.util.regex.Pattern ZONE_RE =
        java.util.regex.Pattern.compile(com.park.demo3.service.ZoneService.ZONE_REGEX);
    private static boolean validZone(String s) { return s != null && ZONE_RE.matcher(s).matches(); }
```

**(b) `ParamRegistry.java:203`**：

```java
        if (scope.equals("p1") || scope.equals("p2") || scope.equals("dorm")) return ScopeKind.ZONE;
```
→
```java
        if (scope.matches(ZoneService.ZONE_REGEX)) return ScopeKind.ZONE;
```

**(c) `ParamService.java:173` `scopeLabel`** —— 不改直接 500：

```java
        switch (scope) {
            case "p1": return "一期";
            case "p2": return "二期";
            case "dorm": return "宿舍";
            default: break;
        }
```
→
```java
        if (scope.matches(ZoneService.ZONE_REGEX)) return ZoneService.label(scope);
```

**(d) `ParamService.java:293` `scopeId`** —— 不改直接 500；且 dorm 现在写死 3，正好被 p3 撞上：

```java
    private static long scopeId(String scope) {
        return switch (scope) {
            case "", "p1" -> 1; case "p2" -> 2; case "dorm" -> 3;
            default -> idOf(scope);
        };
    }
```
→
```java
    private static long scopeId(String scope) {
        if (scope.isEmpty()) return 1;
        if ("dorm".equals(scope)) return Integer.MAX_VALUE;          // 恒排最后,不再与 p3 撞
        if (scope.matches("p\\d+")) return Integer.parseInt(scope.substring(1));
        return idOf(scope);
    }
```

**(e) `ParamService.java:326` `lossBuildings`** —— 与 `AllocService:1361` 对齐(只排 dorm)：

```java
            if (m.getBuildingId() != null && "elec".equals(m.getKind()) && ("p1".equals(m.getZone()) || "p2".equals(m.getZone())))
```
→
```java
            // 与 AllocService.lossGroups(:1361) 同口径:只排 dorm。写死 p1/p2 会造出不对称 ——
            // p3 楼栋进得了损耗组算钱,参数中心里却一行损耗参数都不出现,用户改不了也不报错。
            if (m.getBuildingId() != null && "elec".equals(m.getKind()) && !"dorm".equals(m.getZone()))
```

- [ ] **Step 5: 改 `AllocService.java:82` 池名前缀(不改会撞名)**

```java
    private static final Map<String, String> ZONE_POOL_PREFIX =
        Map.of("p1", "一期园区", "p2", "二期园区", "dorm", "宿舍区");
```
→
```java
    // 按期区码生成,不再写死三元组。p3 园区级池若塌成统一的「园区级」,
    // 会与 p4 的同费项池撞成同一个名字 —— 正是 :78-79 注释里 V70 加期别前缀要防的事故。
    private static String zonePoolPrefix(String zone) {
        return "dorm".equals(zone) ? "宿舍区"
             : zone != null && zone.matches("p\\d+") ? ZoneService.label(zone) + "园区"
             : "园区级";
    }
```

同步改 `:85` 的调用点：

```java
            ? ZONE_POOL_PREFIX.getOrDefault(zone, "园区级") : buildingName.trim());
```
→
```java
            ? zonePoolPrefix(zone) : buildingName.trim());
```

- [ ] **Step 6: 改 4 处文案/注释(改完就成假话)**

- `MeterService.java:305`：`"分区/类别非法(kind=elec|water,zone=p1|p2|dorm)"` → `"分区/类别非法(kind=elec|water,zone=p1/p2/p3…或 dorm)"`
- `ParamController.java:24` Swagger summary：`zone=all|p1|p2|dorm` → `zone=all|p{n}|dorm`，并去掉「四区」(区数不再固定)
- `ParamRegistry.java:175` javadoc：`p1|p2|dorm 期` → `p{n}|dorm 期`
- `ParamRegistry.java:200` 注释：`非法(如 'p9'、'building:x')` → `非法(如 'px'、'building:x')` —— `p9` 改完是**合法**的

- [ ] **Step 7: 加正向用例**

追加到 `MeterApiIT.java`：

```java
    // ── 三期:zone=p3 建档/过滤/导入全通(值域 p1|p2|dorm → p\d+|dorm) ──
    @Test
    void zone_p3_createListImport() throws Exception {
        String res = mvc.perform(post("/api/meters").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p3\",\"name\":\"IT三期总电\",\"factor\":1}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.zone").value("p3"))
                .andReturn().getResponse().getContentAsString();
        int id = JsonPath.read(res, "$.data.id");
        // 列表 zone 过滤参数不再 400
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p3").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data[?(@.name=='IT三期总电')].zone").value("p3"));
        // 导入:p3 行进(MeterService.validZone 也放宽了),形态非法行仍跳
        mvc.perform(post("/api/meters/import").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"kind\":\"elec\",\"zone\":\"p3\",\"name\":\"IT三期总电\",\"ym\":\"2099-05\",\"prevTotal\":10,\"currTotal\":20},"
                        + "{\"kind\":\"elec\",\"zone\":\"px\",\"name\":\"IT坏分区\",\"ym\":\"2099-05\"}]}"))
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.skipped").value(1));
        org.junit.jupiter.api.Assertions.assertEquals("p3", meterMapper.selectById(id).getZone());
    }
```

追加到 `ParamApiIT.java` —— 这条专门抓「只放宽 `@Pattern` 却漏改 `ParamRegistry:203`」：

```java
    // p3 期级参数:@Pattern 放行只是第一关,ParamRegistry.allowed 是第二关。
    // 漏改 ParamRegistry:203 时,这里会拿到 body code=400「参数键不在注册表:water@p3」
    @Test
    void put_p3ZoneScope_accepted() throws Exception {
        mvc.perform(put("/api/params").header("Authorization", auth()).contentType("application/json")
                .content("{\"key\":\"water\",\"scope\":\"p3\",\"acctMonth\":\"2099-05\",\"value\":3.5}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
        // 且能读回来 —— 漏改 ParamService:173/293 时这一句会 HTTP 500
        mvc.perform(get("/api/params").param("ym", "2099-05").param("zone", "p3").header("Authorization", auth()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
    }
```

- [ ] **Step 8: 跑纯单测**

```bash
cd backend && ./mvnw -q test "-Dtest=ParamRegistryTest,ZoneServiceTest"
```

Expected: PASS。

- [ ] **Step 9: 跑全部相关 IT**

```bash
cd backend && ./mvnw -q test "-Dtest=MeterApiIT,ParamApiIT,PriceCfgApiIT,AllocApiIT"
```

Expected: PASS。若 `ParamApiIT#put_p3ZoneScope_accepted` 拿到 HTTP 500 → Step 4(c)/(d) 没改；若拿到 body `code=400` → Step 4(b) 没改。

- [ ] **Step 10: 提交**

```bash
git add -A backend/src
git commit -m "feat(zone): 值域放宽 p1|p2|dorm → p\\d+|dorm(9 处正则 + 5 处非正则)"
```

---

### Task 4: `zoneOfBuilding` 改读列

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/service/AllocService.java:971-973`
- Test: `backend/src/test/java/com/park/demo3/AllocServiceTest.java`
- Check: `backend/src/test/java/com/park/demo3/arch/QueryHygieneTest.java:37`

**Interfaces:**
- Consumes: `Building.getZone()` (T1)
- Produces: `static Map<Integer,String> AllocService.zoneOfBuilding(List<Building> buildings, List<Meter> meters)`

> **⚠ 门禁陷阱**：`QueryHygieneTest.java:37` 写死 `entry("AllocService.java", 27)` —— 它静态扫源码数 `selectList(null)` 出现次数并做**全等**断言。新写一句 `buildings.selectList(null)` 会变 28 直接打红。
> 现状 `:971` 是 `for (Meter m : meters.selectList(null))` **内联在 for 头里**。抽静态函数需要 hoist 成局部变量，**同时** hoist buildings —— 净增 1。所以必须复用 `loadCtx` 里已有的 building 加载(见 Step 1 先确认)，否则要动门禁数字。

- [ ] **Step 1: 先确认 loadCtx 里有没有已经加载 building**

```bash
grep -n "buildings\.\|BuildingMapper\|buildingById" backend/src/main/java/com/park/demo3/service/AllocService.java | head -20
```

- **若已有** `buildings.selectList(null)`：把它 hoist 成局部变量复用，`selectList(null)` 总数不变，门禁保持 27。
- **若没有**：新增一句 → 28，必须同步把 `QueryHygieneTest.java:37` 改成 `entry("AllocService.java", 28)`，并在该行注释里写明「V113 期区读列新增 building 加载」。

- [ ] **Step 2: 写失败的纯单测**

追加到 `backend/src/test/java/com/park/demo3/AllocServiceTest.java`(照该文件既有范式：无 Spring、`java.util.Map.of` 字面量内联、全限定名)：

```java
    private static com.park.demo3.entity.Building building(int id, String zone) {
        var b = new com.park.demo3.entity.Building(); b.setId(id); b.setZone(zone); return b;
    }

    private static com.park.demo3.entity.Meter meterOn(int buildingId, String zone) {
        var m = new com.park.demo3.entity.Meter();
        m.setBuildingId(buildingId); m.setZone(zone); m.setKind("elec"); return m;
    }

    // building.zone 是唯一事实来源;列为 NULL 才回退「该栋首块表的 zone」。
    // 三期 0 块表 —— 靠列才有期区,这正是本次改动的目的。
    @Test
    void zoneOfBuilding_columnWinsOverMeterFallback() {
        var bs = java.util.List.of(building(30, "p2"), building(40, null), building(50, "p3"));
        var ms = java.util.List.of(meterOn(30, "dorm"), meterOn(40, "p1"));
        var z = AllocService.zoneOfBuilding(bs, ms);
        assertEquals("p2", z.get(30));    // 读列优先:30 号栋挂着 dorm 表也不许翻案
        assertEquals("p1", z.get(40));    // 列 NULL → 回退首块表
        assertEquals("p3", z.get(50));    // 无表,靠列才有期区
    }

    // 二期二车间实测挂着 p2:20 / p1:1 / dorm:1 三种表。回填后列是 p2,
    // 读列就不再依赖遍历顺序 —— 这是顺手修掉的那个不确定性。
    @Test
    void zoneOfBuilding_mixedMeterBuildingIsDeterministic() {
        var bs = java.util.List.of(building(31, "p2"));
        var ms = java.util.List.of(meterOn(31, "dorm"), meterOn(31, "p1"), meterOn(31, "p2"));
        assertEquals("p2", AllocService.zoneOfBuilding(bs, ms).get(31));
        // 表顺序反过来,结果必须一样
        var ms2 = java.util.List.of(meterOn(31, "p2"), meterOn(31, "p1"), meterOn(31, "dorm"));
        assertEquals("p2", AllocService.zoneOfBuilding(bs, ms2).get(31));
    }
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd backend && ./mvnw -q test "-Dtest=AllocServiceTest#zoneOfBuilding_columnWinsOverMeterFallback"
```

Expected: FAIL —— `cannot find symbol: method zoneOfBuilding(List,List)`。

- [ ] **Step 4: 抽静态函数**

在 `AllocService` 里新增(放在 `inForceByZone` 附近，同为 static 包级纯函数)：

```java
    // 楼栋期区:building.zone 是唯一事实来源;列为 NULL 才回退「该栋首块表的 zone」。
    // 回退分支保留是给「新建楼栋忘了填期区但已经录了表」兜底 —— 不能因此整月算不出来。
    static Map<Integer, String> zoneOfBuilding(List<Building> buildings, List<Meter> meters) {
        Map<Integer, String> out = new HashMap<>();
        for (Building b : buildings)
            if (b.getZone() != null && !b.getZone().isBlank()) out.put(b.getId(), b.getZone().trim());
        for (Meter m : meters)
            if (m.getBuildingId() != null && m.getZone() != null) out.putIfAbsent(m.getBuildingId(), m.getZone());
        return out;
    }
```

- [ ] **Step 5: 改 loadCtx 调用点**

`AllocService.java:971-973` 现在是：

```java
        for (Meter m : meters.selectList(null)) {
            if (m.getBuildingId() != null && m.getZone() != null) zoneOfBuilding.putIfAbsent(m.getBuildingId(), m.getZone());
            if (!MeterService.outOfService(m, ym)) meterById.put(m.getId(), m);
        }
```

改成(hoist 成局部变量，`selectList(null)` 次数不变)：

```java
        List<Meter> allMeters = meters.selectList(null);
        Map<Integer, String> zoneOfBuilding = zoneOfBuilding(buildingList, allMeters);
        for (Meter m : allMeters)
            if (!MeterService.outOfService(m, ym)) meterById.put(m.getId(), m);
```

其中 `buildingList` 用 Step 1 查到的既有 building 加载结果；若原本没有，新增 `List<Building> buildingList = buildings.selectList(null);` 并按 Step 1 同步门禁数字。

- [ ] **Step 6: 跑纯单测 + 门禁**

```bash
cd backend && ./mvnw -q test "-Dtest=AllocServiceTest,QueryHygieneTest"
```

Expected: PASS。若 `QueryHygieneTest` 红且信息是 `AllocService.java: was 27, now 28` → 回到 Step 1 决定是 hoist 还是改门禁数字。

- [ ] **Step 7: 跑回退分支的现成回归护栏**

```bash
cd backend && ./mvnw -q test "-Dtest=AllocPoolContributionsIT"
```

Expected: PASS。该 IT 的 `areaPool_dormRowsSplitOutOfBuildingAndZoneBase` 用 `jdbc.update("INSERT INTO building(name,phase,floor_count,…)")` 显式列清单建栋(**不含 zone → 新列为 NULL**)，再挂一块 `zone=p1` 的水表定期区 —— 它正好走回退分支，是现成的护栏。

- [ ] **Step 8: 提交**

```bash
git add -A backend/src
git commit -m "feat(zone): zoneOfBuilding 改读 building.zone 列,NULL 回退首块表"
```

---

### Task 5: 计费口径改成期级参数(P7)

**Files:**
- Create: `backend/src/main/resources/db/migration/V114__zone_calc_kind.sql`(表是 **`alloc_cfg`**,数值编码 0=flat/1=tou)
- Modify: `frontend/src/utils/paramRegistry.ts`(注册表加键)
- Modify: `backend/src/main/java/com/park/demo3/service/ParamRegistry.java`(注册表加键)
- Modify: `backend/src/main/java/com/park/demo3/service/AllocService.java:913,920,1109,1112,1248,1702,1748,1801,1861`
- Test: `backend/src/test/java/com/park/demo3/AllocServiceTest.java`

**Interfaces:**
- Consumes: `ZoneService.label` (T2)、值域已放宽 (T3)
- Produces: 参数键 `zone_calc_kind`(scope=期区，值 `flat`|`tou`)；`AllocService` 内部 `String calcKind(String zone, Ctx ctx)`

> **⚠ 这是整个计划里最容易做错的一块。** 放开正则只让 p3 的池**建得出来**：
> ```java
> // AllocService.java:1109
> if (!"p1".equals(zone) && !"p2".equals(zone)) return null;   // ← p3 的应分摊恒 null
> ```
> 池会安静地算出 0 元并照常出催缴单。**没有任何报错。**

- [ ] **Step 1: 写迁移**

`backend/src/main/resources/db/migration/V114__zone_calc_kind.sql`:

```sql
-- V114__zone_calc_kind.sql — 计费口径从「按期区名字硬分叉」改成期级参数。
-- 背景:AllocService 里 7 处 `"p2".equals(zone) ? 分时 : 平价`,新期区一律静默落平价分支,
-- 而 ruleCostAmount(:1109) 干脆 `if (!p1 && !p2) return null` —— p3 池的应分摊恒 null,
-- 池建得出来、算不出钱、不报任何错。
--
-- ⚠ 参数表是 alloc_cfg,且**只有 DECIMAL 值列**(cfg_value DECIMAL(14,8),无文本列),
--   故用数值编码 —— 与 loss_variant(0=net/1=share_only/2=陈列不出率)完全同款。
--     0 = flat 单一商业价 ×(用量 + 加减度数)
--     1 = tou  尖/峰/平/谷分时四段 + 管理费
-- acct_month='' + mode='from' = 初始版本、向后前滚(同 alloc_cfg 既有约定)。

INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, mode, note) VALUES
  ('p1', 'zone_calc_kind', 0, '', 'from', '一期:0=平价制(单一商业价=供电局月均+0.16)'),
  ('p2', 'zone_calc_kind', 1, '', 'from', '二期:1=分时制(尖峰平谷四段 + 管理费)');
-- dorm 不写:它本来就不出对账行(ruleCostAmount 旧实现读不到 p2.price_norm 即跳过),
--            写了反而会让宿舍开始出对账行,是行为变更。
-- 三期不预设:猜错等于三期整年电费收错,必须由用户在计费参数页显式选。
```

同时在参数注册表两侧注册这个键(否则 `ParamRegistry.allowed` 不通过、计费参数页也看不到它)：

- 后端 `ParamRegistry.java` —— 照 `loss_variant` 那条加一行，`ScopeKind.ZONE`
- 前端 `frontend/src/utils/paramRegistry.ts` —— 照 `loss_variant` 那条加：

```ts
  { key: 'zone_calc_kind', label: '计费口径', unit: '', group: 'rule', defaultMode: 'from',
    monthlyCheck: false, valueKind: 'enum',
    enumLabels: { 0: '平价制(单一商业价 × 用量)', 1: '分时制(尖峰平谷四段 + 管理费)' },
    hint: '决定该期区的公摊池怎么算钱。没配的期区,池建得出来但应分摊是空的' },
```

> ⚠ `enumLabels` 的字段名照抄 `loss_variant` 那条的实际写法，不要凭这里的示例发明字段名。

- [ ] **Step 2: 写失败的纯单测**

追加到 `AllocServiceTest.java`：

```java
    // 口径按参数取,不按期区名字。p1→0(flat) / p2→1(tou) 是回填值;p3 由用户配。
    // 取不到 = 该期区还没配 → 必须返回 null,让 ruleCostAmount return null,
    // 而不是默认成 flat 静默算出一个数来(那正是「算错了还不报错」)。
    @Test
    void calcKind_resolvesFromParamNotZoneName() {
        var flat = java.util.Map.of("p1|zone_calc_kind", new java.math.BigDecimal("0"));
        var tou  = java.util.Map.of("p2|zone_calc_kind", new java.math.BigDecimal("1"));
        var p3tou = java.util.Map.of("p3|zone_calc_kind", new java.math.BigDecimal("1"));
        assertEquals(AllocService.KIND_FLAT, AllocService.calcKind("p1", flat));
        assertEquals(AllocService.KIND_TOU,  AllocService.calcKind("p2", tou));
        assertEquals(AllocService.KIND_TOU,  AllocService.calcKind("p3", p3tou));
        assertNull(AllocService.calcKind("p3", java.util.Map.of()));   // 没配 → null,不猜
        assertNull(AllocService.calcKind("dorm", flat));               // 别的期区的配置不串味
    }
```

- [ ] **Step 3: 跑确认失败**

```bash
cd backend && ./mvnw -q test "-Dtest=AllocServiceTest#calcKind_resolvesFromParamNotZoneName"
```

Expected: FAIL —— `cannot find symbol: method calcKind`。

- [ ] **Step 4: 加 calcKind 并改 7 处分叉**

```java
    static final String KIND_FLAT = "flat", KIND_TOU = "tou";

    /**
     * 期区计费口径。alloc_cfg 只有 DECIMAL 值列,故 0=flat / 1=tou(同 loss_variant 的编码方式)。
     * null = 该期区还没配 —— 不猜,让 ruleCostAmount return null。
     * 默认成 flat 会让没配口径的期区静默算出一个数来,那正是「算错了还不报错」。
     */
    static String calcKind(String zone, Map<String, BigDecimal> cfg) {
        BigDecimal v = cfg.get(zone + "|zone_calc_kind");
        return v == null ? null : (v.signum() == 0 ? KIND_FLAT : KIND_TOU);
    }
```

`:1109` 与 `:1112`：

```java
        String zone = rule.getZone();
        if (!"p1".equals(zone) && !"p2".equals(zone)) return null;
        BigDecimal price = lossPrice(zone, ctx);
        if (price == null) return null;
        if ("p1".equals(zone)) return r2(u.qty().add(poolExtra(rule, ctx)).multiply(price));
```
→
```java
        String zone = rule.getZone();
        String kind = calcKind(zone, ctx.cfg());
        if (kind == null) return null;                    // 该期区未配口径 → 不算(而不是算成 0)
        BigDecimal price = lossPrice(zone, ctx);
        if (price == null) return null;
        if (KIND_FLAT.equals(kind)) return r2(u.qty().add(poolExtra(rule, ctx)).multiply(price));
```

其余 5 处把 `"p2".equals(zone)` / `"p2".equals(rule.getZone())` 换成 `KIND_TOU.equals(calcKind(zone, ctx.cfg()))`：
`:1248`、`:1702`(`perMeterCost = !p2` → `= !KIND_TOU.equals(kind)`)、`:1748`、`:1801`、`:1861`。

**不要动**这些 —— 它们是**机制**不是口径，三期没有就是没有：
`:1410` `:1411` `:1423` `:2276` `:2278`(一期园区公摊池均摊栋数)、`:1440` `:1554` `:2282`(一期损耗 G 列)、`:1482` `:1484`(二期专属)、`:179` `:195` `:1015` `:1361`(dorm)。

`:913` 与 `:920` 的 `for (String zone : List.of("p1","p2"))` 是**损耗对账行**的期区循环，改成遍历「有 `zone_calc_kind` 配置的期区」，否则三期不出对账行。

- [ ] **Step 5: 跑纯单测**

```bash
cd backend && ./mvnw -q test "-Dtest=AllocServiceTest"
```

Expected: PASS，55 + 3 个用例全绿。

- [ ] **Step 6: 跑金额回归(最重要的一道)**

```bash
cd backend && ./mvnw -q test "-Dtest=AllocApiIT,AllocPoolContributionsIT"
```

Expected: PASS。**一分钱都不能变** —— p1 回填 flat、p2 回填 tou，与改动前的分支结果必须逐字等价。任何金额断言变红都说明口径映射写反了，**立刻回滚，不要调断言**。

- [ ] **Step 7: 提交**

```bash
git add -A backend/src
git commit -m "feat(alloc): 计费口径改成期级参数 zone_calc_kind,不再按期区名字硬分叉"
```

---

### Task 6: 楼栋管理加期区字段

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/dto/BuildingDTO.java`
- Modify: `backend/src/main/java/com/park/demo3/dto/BuildingCreateReq.java`
- Modify: `backend/src/main/java/com/park/demo3/dto/BuildingUpdateReq.java`
- Modify: `backend/src/main/java/com/park/demo3/service/BuildingService.java:165`(唯一构造点)
- Modify: `frontend/src/types/building.ts:2,21,28`
- Modify: 楼栋新建/编辑弹窗(`frontend/src/views/buildings/`)
- Test: `backend/src/test/java/com/park/demo3/api/BuildingWriteApiIT.java`

**Interfaces:**
- Consumes: `Building.getZone()` (T1)、`useZonesStore()` (**T7 Step 7** —— 本任务必须排在 T7 之后)
- Produces: `BuildingDTO.zone`；`BuildingCreateReq.zone` / `BuildingUpdateReq.zone`(可空)

> **尾追加零风险**(已核)：`new BuildingDTO` 全仓只有 `BuildingService.java:165` 一个构造点；`BuildingServiceTest` / `MetricConsistencyIT` 只消费不构造；`BuildingWriteApiIT` / `BuildingTenantApiIT` 全是逐字段 `jsonPath` 断言、不数字段个数；`BuildingSummaryDTO` 不含逐栋字段所以 KPI 汇总一行不用改；`detail()` 经 `toDTO(:209)` 自动跟上。

- [ ] **Step 1: 写失败的 IT**

追加到 `BuildingWriteApiIT.java`(照该类 `createBuilding(name)` helper 与 `update_renameAndStop_readsBack` 的**回读**范式)：

```java
    // 期区:PUT 之后必须再 GET 回读 —— 只断响应体测不出 FieldStrategy 那个坑
    @Test
    void update_setZone_readsBack() throws Exception {
        int id = createBuilding("IT三期创业大厦");
        mvc.perform(put("/api/buildings/" + id).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"IT三期创业大厦\",\"phase\":3,\"zone\":\"p3\",\"floorCount\":12,"
                        + "\"totalArea\":1000,\"rentableArea\":900,\"status\":1}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(get("/api/buildings/" + id).header("Authorization", auth()))
                .andExpect(jsonPath("$.data.building.zone").value("p3"))
                .andExpect(jsonPath("$.data.building.floorCount").value(12));
    }

    // 期区可空:老数据与没标注的楼栋照常读写
    @Test
    void create_withoutZone_isAllowed() throws Exception {
        int id = createBuilding("IT无期区栋");
        mvc.perform(get("/api/buildings/" + id).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.building.zone").doesNotExist());
    }
```

- [ ] **Step 2: 跑确认失败**

```bash
cd backend && ./mvnw -q test "-Dtest=BuildingWriteApiIT#update_setZone_readsBack"
```

Expected: FAIL —— `$.data.building.zone` 不存在。

- [ ] **Step 3: 后端加字段**

`BuildingDTO.java` 第一行 record 参数里 `Integer phase, String phaseName,` 之后加 `String zone,`；
`BuildingCreateReq` / `BuildingUpdateReq` 各加 `@Pattern(regexp = "p\\d+|dorm") String zone`(**不加 `@NotBlank`** —— 可空)；
`BuildingService.java:165` 的 `new BuildingDTO(...)` 补上 `b.getZone()`；写入路径(create/update)补 `e.setZone(req.zone())`。

> ⚠ MyBatis-Plus 默认 `FieldStrategy.NOT_NULL` 会让「把 zone 清空」的更新静默失效。若产品要求「能改回未标注」，在实体字段上加 `@TableField(updateStrategy = FieldStrategy.IGNORED)`，并补一条清空后回读为 null 的用例。

- [ ] **Step 4: 跑后端确认通过**

```bash
cd backend && ./mvnw -q test "-Dtest=BuildingWriteApiIT,BuildingServiceTest,BuildingTenantApiIT"
```

Expected: PASS。

- [ ] **Step 5: 前端类型 + 弹窗字段**

`frontend/src/types/building.ts`：

```ts
  id: number; name: string; phase: number; phaseName: string; kind: string
```
→
```ts
  id: number; name: string; phase: number; phaseName: string; zone: string | null; kind: string
```

`BuildingCreateReq` / `BuildingUpdateReq` 各加 `zone?: string | null`。

楼栋新建/编辑弹窗里，在「期数」字段**旁边**加一个「期区」下拉，选项来自 `zonesApi`(T7 的 store)，并允许空值：

```vue
<Select v-model="form.zone" label="期区" :options="zoneOpts" size="sm"
        title="期区决定这栋楼的电表、公摊池、损耗归到哪一期。与「期数」不是一回事——宿舍楼期数是 1 但期区是宿舍" />
```

```ts
const zoneOpts = computed(() => [{ value: '', label: '(未标注)' },
  ...zones.list.map(z => ({ value: z.code, label: z.name }))])
```

- [ ] **Step 6: 类型闸**

```bash
cd frontend && npm run typecheck
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add -A backend/src frontend/src
git commit -m "feat(zone): 楼栋管理可编辑期区"
```

---

### Task 7: 前端期区接口化

**Files:**
- Create: `frontend/src/api/zones.ts`、`frontend/src/stores/zones.ts`、`frontend/src/utils/zoneLabel.ts`、`frontend/src/utils/zoneLabel.spec.ts`
- Modify: `frontend/src/api/alloc.ts:6`、`api/meters.ts:9`、`api/params.ts:9`
- Modify: `frontend/src/utils/poolLedgerLogic.ts:10`、`utils/meterExcel.ts:30`
- Modify: `frontend/src/views/alloc/PoolLedgerView.vue:100,301,302`
- Modify: `frontend/src/views/alloc/LossLedgerView.vue:43`
- Modify: `frontend/src/views/meters/MeterView.vue:254,504`
- Modify: `frontend/src/views/params/ParamCenterView.vue:81,218-220`
- Modify: `frontend/src/views/bills/CoefBookWindow.vue:172`
- Test: `frontend/src/utils/zoneLabel.spec.ts`、`frontend/src/utils/poolLedgerLogic.spec.ts`

**Interfaces:**
- Consumes: `GET /api/zones` (T2)
- Produces: `zoneLabel(code: string): string`(纯函数)；`useZonesStore().list: ZoneDTO[]`

> **⚠ 两条硬约束**
> 1. **字典必须参数注入，不能改成组件内异步拉取。** `meterExcel.spec.ts`(45 例) / `poolLedgerLogic.spec.ts`(82 例) 是零 mock 的纯函数 spec，改成异步会让整档写法推倒重来。
> 2. **必须加 `?? code` 兜底。** `tsconfig.app.json` 只开了 `strict`，**没开** `noUncheckedIndexedAccess` —— 把 `AllocZone` 放宽成 `string` 等于拆掉这批字典**唯一的**编译期护栏。不加兜底则 `PoolLedgerView:301,302` 的导出文件名会变成「公共电核算-2024-02-**undefined**.xlsx」，且编译器一声不吭。

- [ ] **Step 1: 写失败的纯单测**

`frontend/src/utils/zoneLabel.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { zoneLabel } from './zoneLabel'

// 与后端 ZoneService.label 同口径。前端这份是纯函数,给 meterExcel/poolLedgerLogic 注入用 ——
// 那两档 spec 零 mock,字典一旦改成异步拉取,127 个用例的写法要全部推倒。
describe('zoneLabel', () => {
  it('p{n} → 中文数字 + 期', () => {
    expect(zoneLabel('p1')).toBe('一期')
    expect(zoneLabel('p3')).toBe('三期')
    expect(zoneLabel('p10')).toBe('十期')
    expect(zoneLabel('p11')).toBe('十一期')
  })

  it('dorm → 宿舍', () => expect(zoneLabel('dorm')).toBe('宿舍'))

  // 兜底不是可选项:tsconfig 没开 noUncheckedIndexedAccess,
  // 放宽类型后字典下标读返回 undefined 编译器不报,会印进导出文件名
  it('认不出的原样返回,绝不返回 undefined', () => {
    expect(zoneLabel('px')).toBe('px')
    expect(zoneLabel('')).toBe('')
  })
})
```

- [ ] **Step 2: 跑确认失败**

```bash
cd frontend && npx vitest run src/utils/zoneLabel.spec.ts
```

Expected: FAIL —— `Failed to resolve import "./zoneLabel"`。

- [ ] **Step 3: 写 zoneLabel**

`frontend/src/utils/zoneLabel.ts`:

```ts
// 期区显示名。与后端 ZoneService.label 同口径,两边都必须「认不出就原样返回」——
// 返回 undefined 会静默印进导出文件名(tsconfig 没开 noUncheckedIndexedAccess,编译器不报)。
const DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

const numeral = (n: number): string => {
  if (n <= 0 || n >= 100) return String(n)
  if (n < 10) return DIGITS[n]
  if (n === 10) return '十'
  if (n < 20) return '十' + DIGITS[n % 10]
  return DIGITS[Math.floor(n / 10)] + '十' + DIGITS[n % 10]
}

export const zoneLabel = (code: string): string => {
  if (code === 'dorm') return '宿舍'
  const m = /^p(\d+)$/.exec(code ?? '')
  return m ? numeral(+m[1]) + '期' : (code ?? '')
}
```

- [ ] **Step 4: 跑确认通过**

```bash
cd frontend && npx vitest run src/utils/zoneLabel.spec.ts
```

Expected: PASS。

- [ ] **Step 5: 两处 `*_ZONE_LABEL` 改成调 zoneLabel**

`utils/meterExcel.ts:30` 与 `utils/poolLedgerLogic.ts:10` 的 `Record<string,string>` 字典删掉，所有下标读改成 `zoneLabel(zone)`。重点核这几处下标读(它们现在没兜底)：
`meterExcel.ts:176,191,223`、`MeterDetailDrawer.vue:82,374`、`PoolLedgerView.vue:301,302`。

- [ ] **Step 6: 三个类型联合放宽**

`api/alloc.ts:6`、`api/meters.ts:9`、`api/params.ts:9`：

```ts
export type AllocZone = 'p1' | 'p2' | 'dorm'
```
→
```ts
// 值域由后端 /api/zones 数据驱动(p\d+|dorm),不再写死。放宽后编译器不再帮忙查
// 字典下标 —— 所有 label 取值必须走 zoneLabel() 的兜底。
export type AllocZone = string
```

`ParamZone` 保留 `'all'` 语义：`export type ParamZone = 'all' | string`。

- [ ] **Step 7: api + store**

`frontend/src/api/zones.ts`:

```ts
import http from './index'

export interface ZoneDTO { code: string; name: string; sortNo: number }

export const zonesApi = {
  list: (): Promise<ZoneDTO[]> => http.get('/zones'),
}
```

`frontend/src/stores/zones.ts` —— 全站一份，避免每屏各拉一次：

```ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { zonesApi, type ZoneDTO } from '@/api/zones'

export const useZonesStore = defineStore('zones', () => {
  const list = ref<ZoneDTO[]>([])
  let inflight: Promise<void> | null = null

  // 拉不到就留空数组 —— 各屏自己回落到「本屏已有数据里出现过的期区」,
  // 不能让整屏卡在骨架上(P1-6 那条教训:主数据没兜底,接口一挂整页停在转圈)
  async function ensure() {
    if (list.value.length) return
    inflight ??= zonesApi.list().then(z => { list.value = z }).catch(() => {}).finally(() => { inflight = null })
    return inflight
  }
  return { list, ensure }
})
```

- [ ] **Step 8: 四屏 ZONE_OPTS 改成拉 store**

`PoolLedgerView.vue:100` / `MeterView.vue:254,504` / `ParamCenterView.vue:81`：

```ts
const ZONE_OPTS = [
  { value: 'p1', label: '一期' }, { value: 'p2', label: '二期' }, { value: 'dorm', label: '宿舍' },
]
```
→
```ts
const zones = useZonesStore()
onMounted(() => zones.ensure())
const ZONE_OPTS = computed(() => zones.list.map(z => ({ value: z.code, label: z.name })))
```

`LossLedgerView.vue:43` —— **显式排掉 dorm**：

```ts
// 宿舍无损耗单元(AllocService.lossGroups:1361 第一道过滤就排 dorm)。
// 期区清单接口化之后必须在这里主动排掉,否则会多出一个恒空的宿舍 tab,
// 把一个刻意的设计读成一个 bug。
const ZONE_OPTS = computed(() => zones.list.filter(z => z.code !== 'dorm')
  .map(z => ({ value: z.code, label: z.name })))
```

- [ ] **Step 9: 修两处会静默错的 phase/zone 混用**

`ParamCenterView.vue:218` 守卫是**黑名单**，p3 会掉进一期分支、在三期页签上挂出「一期公摊分摊度数=…」：

```ts
  if (zone.value === 'p2' || zone.value === 'dorm') return ''
```
→
```ts
  if (zone.value !== 'p1') return ''      // 白名单:园区公摊分母是一期独有机制
```

`CoefBookWindow.vue:172` 是全仓最赤裸的 phase→zone 混用，三期拿到 `zone=null` 后 `coefBookLogic.ts:100` 的级联**整条期级作用域被跳过**，系数簿静默按全园价显示：

```ts
const zone = computed(() => phase.value === '1' ? 'p1' : phase.value === '2' ? 'p2' : null)
```
→
```ts
// 期区取楼栋上的字段,不由 phase 猜 —— phase 3 以前落 null,
// 会让 resolveCoefPrice 的级联跳过整条期级作用域,静默按全园价显示。
const zone = computed(() => buildings.value.find(b => String(b.phase) === phase.value)?.zone ?? null)
```

> `CoefBookWindow.vue:123` 的 `allocApi.rules('p2')`、`:97` 的 `floorLocked`、`coefBookLogic.ts:126` 的 `p.zone === 'p2'` 是「层份仅二期」同一条规则的**三份拷贝**。本任务**不改它们的行为**，只在每处补一行注释交叉引用另外两处，防止后人改一处就漂移。

- [ ] **Step 10: 跑前端**

```bash
cd frontend && npx vitest run src/utils/zoneLabel.spec.ts src/utils/poolLedgerLogic.spec.ts src/utils/meterGroup.spec.ts src/views/params/__tests__/paramCenterView.spec.ts
```

Expected: PASS。`paramCenterView.spec.ts` 需要补一个 `vi.mock('@/api/zones', …)`：

```ts
vi.mock('@/api/zones', () => ({ zonesApi: { list: () => Promise.resolve([
  { code: 'p1', name: '一期', sortNo: 0 },
  { code: 'p2', name: '二期', sortNo: 1 },
  { code: 'p3', name: '三期', sortNo: 2 },
  { code: 'dorm', name: '宿舍', sortNo: 3 },
]) } }))
```

- [ ] **Step 11: 类型闸**

```bash
cd frontend && npm run typecheck
```

Expected: PASS。三处 `as XxxZone` 断言放宽后会变成多余，删掉即可。

- [ ] **Step 12: 提交**

```bash
git add -A frontend/src
git commit -m "feat(zone): 前端期区改接口驱动;修 ParamCenter/CoefBook 两处 phase-zone 混用"
```

---

### Task 8: 抄表 Excel 期区驱动

**Files:**
- Modify: `frontend/src/utils/meterExcel.ts:68,223,239,247,283`
- Test: `frontend/src/utils/meterExcel.spec.ts`

**Interfaces:**
- Consumes: `zoneLabel` (T7)、`useZonesStore().list` (T7)
- Produces: `detectSheet` 认得任意期区；`buildMeterTemplate` / `exportMeterMonth` 的 sheet 数随期区数变

> `TEMPLATE_SHEETS`(`:239`)是**导入模板下载(`:247`)与月度导出(`:283`)的共同唯一来源**。不改则 p3 表能建能导入，却永远不出现在模板和导出里 —— 新期区的导入回路断掉一半。

- [ ] **Step 1: 写失败的测试**

追加到 `meterExcel.spec.ts`(照该文件手写 AOA 夹具的范式)：

```ts
// 期区清单驱动:sheet 名带清单里的 label 就能认出期区
const T3_ELEC: string[][] = [
  ['', '2026年3月三期园区电表抄表记录'],
  ['', '区域', '', '企业名称', '表类', '电表名称', '电表编码', '电表倍率', '上月行至', '', '', '', '', '本月行至', '', '', '', '', '备注'],
  ['', '', '', '', '', '', '', '', '总', '尖', '峰', '平', '谷', '总', '尖', '峰', '平', '谷', ''],
  ['三期总电', '三车间', '', '', '总电表', '总电表', '230828010021', '80', '10', '', '', '', '', '12', '', '', '', '', ''],
]

const ZONES = [
  { code: 'p1', name: '一期', sortNo: 0 }, { code: 'p2', name: '二期', sortNo: 1 },
  { code: 'p3', name: '三期', sortNo: 2 }, { code: 'dorm', name: '宿舍', sortNo: 3 },
]

it('三期园区电:sheet 名带期区清单标签即识别', () => {
  const sec = parseMeterSheet('三期园区电', T3_ELEC, undefined, undefined, ZONES)!
  expect(sec.records[0]).toMatchObject({ zone: 'p3', kind: 'elec', ym: '2026-03', name: '三期总电', factor: 80 })
  expect(sec.label).toBe('三期电表 · 2026年3月 · 1块表')
})

it('模板 sheet 数随期区数变,且新期区模板能被解析器读回(互认回路)', () => {
  expect(templateSheets(ZONES)).toHaveLength(8)                    // 4 期区 × 2 类别
  const sec = parseMeterSheet('三期园区电',
    buildMeterTemplateAoa('p3', 'elec', '2026-07').map(r => r.map(String)), undefined, undefined, ZONES)!
  expect(sec.records[0]).toMatchObject({ zone: 'p3', kind: 'elec', ym: '2026-07' })
})
```

- [ ] **Step 2: 跑确认失败**

```bash
cd frontend && npx vitest run src/utils/meterExcel.spec.ts
```

Expected: FAIL —— `templateSheets is not defined`，且三期 sheet 的 `zone` 是 `undefined`。

- [ ] **Step 3: 改 sheet 名嗅探(`:68`)**

```ts
const zone = /一期/.test(src) ? 'p1' : /二期/.test(src) ? 'p2' : /宿舍/.test(src) ? 'dorm' : fb.zone
```
→
```ts
// 期区清单驱动:按 label 反查。清单为空(接口没拉到)时回落写死的三期区,
// 保证接口挂掉时老流程照常可用 —— 参数注入而不是模块内拉取,纯函数 spec 才写得下去。
const zone = (zones ?? DEFAULT_ZONES).find(z => src.includes(z.name))?.code ?? fb.zone
```

`DEFAULT_ZONES` 定义为 `[{code:'p1',name:'一期'},{code:'p2',name:'二期'},{code:'dorm',name:'宿舍'}]`。

> ⚠ 反查要**按 label 长度降序**匹配，否则「三期」和「期」这类子串会误命中。清单里 label 互不为前缀时无所谓，但排序一行成本很低，加上。

- [ ] **Step 4: `TEMPLATE_SHEETS` 改成函数(`:239`)**

```ts
const TEMPLATE_SHEETS: [string, string, string][] = [
  ['一期园区电', 'p1', 'elec'], /* …6 个… */
]
```
→
```ts
/** sheet 清单随期区清单生成。:247 模板下载与 :283 月度导出共用这一个来源。 */
export const templateSheets = (zones: { code: string; name: string }[] = DEFAULT_ZONES)
  : [string, string, string][] =>
  zones.flatMap(z => (['elec', 'water'] as const).map(k =>
    [`${z.name}${z.code === 'dorm' ? '' : '园区'}${k === 'elec' ? '电' : '水'}`, z.code, k] as [string, string, string]))
```

`:247` `buildMeterTemplate` 与 `:283` `exportMeterMonth` 的签名各加一个可选 `zones` 参数并透传。

- [ ] **Step 5: `:223` dorm 标题特判保持不变**

```ts
const title = `${y}年${+mo}月${METER_ZONE_LABEL[zone]}${zone === 'dorm' ? '' : '园区'}${METER_KIND_LABEL[kind]}抄表记录`
```
→ 只把字典换成 `zoneLabel(zone)`，`zone === 'dorm'` 的特判**保留**(宿舍标题不拼「园区」二字，与 Step 4 同规则)。

- [ ] **Step 6: 跑确认通过**

```bash
cd frontend && npx vitest run src/utils/meterExcel.spec.ts src/utils/importRegistry.spec.ts src/components/import/FpImportModal.spec.ts
```

Expected: PASS。`importRegistry.spec.ts:430-440` 断的是 `props.fallbackPicker` 形状、`FpImportModal.spec.ts:113-127` 的 zones 是写死假数据 —— 两者都不受清单影响，若变红说明签名改漏了透传。

- [ ] **Step 7: 提交**

```bash
git add -A frontend/src
git commit -m "feat(zone): 抄表 sheet 识别与模板/导出改成期区清单驱动"
```

---

### Task 9: 新表未入池提醒条(与前八个任务无依赖)

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/service/AllocService.java`
- Modify: `backend/src/main/java/com/park/demo3/controller/AllocController.java`
- Modify: `backend/src/main/java/com/park/demo3/dto/AllocPoolDTOs.java`
- Modify: `frontend/src/api/alloc.ts`
- Modify: `frontend/src/utils/poolLedgerLogic.ts`
- Modify: `frontend/src/views/alloc/PoolLedgerView.vue`
- Test: `backend/src/test/java/com/park/demo3/AllocServiceTest.java`、`api/AllocApiIT.java`、`frontend/src/utils/poolLedgerLogic.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `static boolean AllocService.needsPool(String ownership, boolean hasReading, boolean bound)`
  - `record AllocPoolDTOs.MeterDiff(int meterId, String label, Integer buildingId, String buildingName, String zone)`
  - `GET /api/alloc/meter-diff?ym=` → `MeterDiff[]`
  - `meterDiffGroup(diffs, zone)`(前端纯函数)

> **照抄 `member-diff` 整条链**：后端 `AllocController.java:57` 的 `GET /member-diff`、`AllocApiIT.java:1106-1168` 的测试、前端 `PoolLedgerView` 的 `zoneDiffs` + 告警抽屉 `gs.push`。
> **端点必须 GET** —— `SecurityConfig:44` 的「读全开」只覆盖 GET。

- [ ] **Step 1: 写失败的纯单测**

判定逻辑抽成 static 纯函数才能不起容器测(侦察强烈建议这么切)。追加到 `AllocServiceTest.java`：

```java
    // 「该摊没摊」只有 share 一种:tenant 户表自己付、park 园区自担本就不摊、
    // infra 是总表、ops/register 不计费。报错了会天天弹,弹到没人看。
    @Test
    void needsPool_onlyUnboundShareMetersWithReading() {
        assertTrue(AllocService.needsPool("share", true, false));    // 公摊表 + 有读数 + 没入池 → 报
        assertFalse(AllocService.needsPool("share", true, true));    // 已入池 → 不报
        assertFalse(AllocService.needsPool("share", false, false));  // 当月没读数 → 不报(还没抄到)
        for (String o : java.util.List.of("tenant", "park", "infra", "ops", "register"))
            assertFalse(AllocService.needsPool(o, true, false), o + " 不该进提醒条");
    }
```

- [ ] **Step 2: 跑确认失败**

```bash
cd backend && ./mvnw -q test "-Dtest=AllocServiceTest#needsPool_onlyUnboundShareMetersWithReading"
```

Expected: FAIL —— `cannot find symbol: method needsPool`。

- [ ] **Step 3: 实现 needsPool + 端点**

```java
    /** 公摊表该进池却没进 = 这笔电费没人摊,且屏上不会有任何提示。只判 share。 */
    static boolean needsPool(String ownership, boolean hasReading, boolean bound) {
        return "share".equals(ownership) && hasReading && !bound;
    }

    public List<AllocPoolDTOs.MeterDiff> meterDiff(String ym) {
        requireYm(ym);
        Ctx ctx = loadCtx(ym);                                 // 已按 outOfService(m, ym) 过滤停用表
        Set<Integer> bound = new HashSet<>();
        for (List<AllocRuleMeter> bs : ctx.bindsByRule().values())
            for (AllocRuleMeter b : bs) bound.add(b.getMeterId());
        List<AllocPoolDTOs.MeterDiff> out = new ArrayList<>();
        for (Meter m : ctx.meterById().values())
            if (needsPool(m.getOwnership(), ctx.readingByMeter().containsKey(m.getId()), bound.contains(m.getId())))
                out.add(new AllocPoolDTOs.MeterDiff(m.getId(), meterLabel(m), m.getBuildingId(),
                        ctx.buildingById().containsKey(m.getBuildingId())
                            ? ctx.buildingById().get(m.getBuildingId()).getName() : null,
                        m.getZone()));
        return out;
    }
```

`AllocController` 照 `:57` 的 `member-diff` 加：

```java
    @Operation(summary = "未入池的公摊表(ownership=share + 当月有读数 + 未被任何池绑定)")
    @GetMapping("/meter-diff")
    public List<AllocPoolDTOs.MeterDiff> meterDiff(
            @RequestParam @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String ym) {
        return svc.meterDiff(ym);
    }
```

- [ ] **Step 4: 加端点 IT**

追加到 `AllocApiIT.java`(照 `memberDiff_addedRemoved` 范式：2099 账期槽、`locMeter` helper、**JSONPath 过滤器存局部变量、不断言数组长度**)：

```java
    // 未入池的公摊表:只报 share 且当月有读数且没被任何池绑定的
    @Test
    void meterDiff_reportsUnboundShareMeterOnly() throws Exception {
        int bid = building("IT三期创业大厦");
        int lonely = locMeter("IT孤儿公摊表", bid, "四楼", "电表①");   // kind=elec zone=p1 ownership=share
        reading(lonely, "2099-11", 0, 100);
        String my = "$.data[?(@.meterId==" + lonely + ")]";
        mvc.perform(get("/api/alloc/meter-diff").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath(my).isNotEmpty());
        // 绑进一个池之后就不再报
        int rule = postId("/api/alloc/rules", "{\"zone\":\"p1\",\"name\":\"IT池\",\"buildingId\":" + bid
                + ",\"method\":\"floor\",\"feeKey\":\"share_elec_floor\",\"feeName\":\"走廊灯\","
                + "\"meterIds\":[" + lonely + "],\"members\":[]}");
        assertTrue(rule > 0);
        mvc.perform(get("/api/alloc/meter-diff").param("ym", "2099-11").header("Authorization", auth()))
                .andExpect(jsonPath(my).isEmpty());
    }
```

- [ ] **Step 5: 跑后端**

```bash
cd backend && ./mvnw -q test "-Dtest=AllocServiceTest#needsPool_onlyUnboundShareMetersWithReading"
cd backend && ./mvnw -q test "-Dtest=AllocApiIT#meterDiff_reportsUnboundShareMeterOnly"
```

Expected: 两条都 PASS。

- [ ] **Step 6: 前端纯函数 + spec**

`member-diff` **没有任何前端测试**(分组拼装写在 `PoolLedgerView.vue` 的 `<script setup>` 里，不可导入)。`meter-diff` 要有测试就必须先把分组抽到 `poolLedgerLogic.ts`：

```ts
// 未入池的公摊表 → 告警抽屉一组。zone 过滤与 zoneDiffs 同口径(只提示本期区的)。
export function meterDiffGroup(diffs: AllocMeterDiffDTO[], zone: string) {
  const mine = diffs.filter(d => d.zone === zone)
  if (!mine.length) return null
  return {
    key: 'meter-unpooled',
    title: `${mine.length} 块公摊表没进任何池`,
    hint: '这些表本月有读数,但没被任何池绑定 —— 它们的电费不会摊给任何人,也不会出现在催缴单上',
    items: mine.map(d => ({ id: d.meterId, text: `${d.buildingName ?? '(未挂楼栋)'} ${d.label}` })),
  }
}
```

`poolLedgerLogic.spec.ts` 追加(照该文件的工厂函数范式)：

```ts
const md = (p: Partial<AllocMeterDiffDTO>): AllocMeterDiffDTO =>
  ({ meterId: 1, label: '电表①', buildingId: 13, buildingName: '一期 A座', zone: 'p1', ...p })

describe('meterDiffGroup 未入池的公摊表', () => {
  it('空表返回 null —— 没有事就不占抽屉一格', () => {
    expect(meterDiffGroup([], 'p1')).toBeNull()
  })
  it('只提示本期区的(与 zoneDiffs 同口径)', () => {
    expect(meterDiffGroup([md({ zone: 'p2' })], 'p1')).toBeNull()
    expect(meterDiffGroup([md({ zone: 'p1' })], 'p1')!.items).toHaveLength(1)
  })
  it('没挂楼栋的表也要显示,不能整条吞掉', () => {
    const g = meterDiffGroup([md({ buildingId: null, buildingName: null })], 'p1')!
    expect(g.items[0].text).toContain('(未挂楼栋)')
  })
})
```

- [ ] **Step 7: 接进告警抽屉**

`PoolLedgerView.vue` 里，在现有 `if (zoneDiffs.value.length) gs.push({...})` **之后**加：

```ts
const mg = meterDiffGroup(meterDiffs.value, zone.value)
if (mg) gs.push(mg)
```

并在加载数据处补 `allocApi.meterDiff(ym.value)`(与 `memberDiff` 并列，同一个竞态守卫下)。

- [ ] **Step 8: 跑前端**

```bash
cd frontend && npx vitest run src/utils/poolLedgerLogic.spec.ts && npm run typecheck
```

Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add -A backend/src frontend/src
git commit -m "feat(alloc): 未入池的公摊表提醒条"
```

---

### Task 10: 楼层按层数派生、方位改自由输入(P5)

**Files:**
- Modify: `frontend/src/utils/zoneLabel.ts`(导出 `cnNumeral`)
- Create: `frontend/src/utils/floorLabels.ts`
- Create: `frontend/src/utils/floorLabels.spec.ts`
- Modify: `frontend/src/views/alloc/PoolLedgerView.vue:454,455,1001,1002`

**Interfaces:**
- Consumes: `cnNumeral(n: number): string`(T7 的 `zoneLabel.ts`，抽出来共用)
- Produces: `floorLabels(floorCount: number, existing: (string|null)[]): string[]`

> **⚠ 楼层不能跟方位一样改自由输入。** `floor_label` 会被 `poolCandidates`(按定位过滤候选表与租户)和楼层分桶逻辑(`rentAreaByBuildingFloorTenant` 按 `poolFloor` 取桶)拿去做**字符串匹配**。「四楼」写成「4楼」或带个尾空格，池会静默摊不到任何人，且**不报错**。方位不参与这些匹配，放开无风险。

- [ ] **Step 1: 写失败的纯单测**

`frontend/src/utils/floorLabels.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { floorLabels } from './floorLabels'

// 楼层候选按该楼栋的 floorCount 派生 —— 三期两栋大厦现在 floor_count=1,
// 用户去楼栋管理改成真实层数,这里就自动出那么多个选项。
describe('floorLabels', () => {
  it('按层数生成,十二层就出十二个', () => {
    const f = floorLabels(12, [])
    expect(f).toContain('一楼')
    expect(f).toContain('十楼')
    expect(f).toContain('十一楼')
    expect(f).toContain('十二楼')
    expect(f.filter(x => x.endsWith('楼'))).toHaveLength(12)
  })

  it('天面与负一层恒在(不属于 floorCount 的计数)', () => {
    const f = floorLabels(1, [])
    expect(f).toEqual(expect.arrayContaining(['一楼', '负一层', '天面']))
  })

  it('库里已有的楼层并进来,不丢存量池的定位', () => {
    // 存量池写着「夹层」这类非常规楼层 —— 派生清单里没有,但不能让它选不回来
    expect(floorLabels(3, ['夹层', '一楼', null, ''])).toContain('夹层')
  })

  it('去重:已有值与派生值重合时只出一个', () => {
    expect(floorLabels(3, ['二楼']).filter(x => x === '二楼')).toHaveLength(1)
  })

  it('floorCount 缺失或为 0 时只出特殊层,不炸', () => {
    expect(floorLabels(0, [])).toEqual(['负一层', '天面'])
  })
})
```

- [ ] **Step 2: 跑确认失败**

```bash
cd frontend && npx vitest run src/utils/floorLabels.spec.ts
```

Expected: FAIL —— `Failed to resolve import "./floorLabels"`。

- [ ] **Step 3: 从 zoneLabel.ts 抽出 cnNumeral**

`frontend/src/utils/zoneLabel.ts` 里把 `numeral` 改成导出并改名(期区与楼层共用同一套中文数字)：

```ts
const numeral = (n: number): string => {
```
→
```ts
/** 1→一 10→十 11→十一 20→二十 21→二十一。期区名与楼层名共用。 */
export const cnNumeral = (n: number): string => {
```

同文件内 `zoneLabel` 里的 `numeral(+m[1])` 改成 `cnNumeral(+m[1])`。

- [ ] **Step 4: 写 floorLabels**

`frontend/src/utils/floorLabels.ts`:

```ts
import { cnNumeral } from './zoneLabel'

// 天面与负一层不在 floorCount 的计数里(floor_count 数的是地上标准层),恒列出来。
const SPECIAL = ['负一层', '天面']

/**
 * 池定位的楼层候选 = 该楼栋 1..floorCount 生成中文 ∪ 特殊层 ∪ 库里已有值。
 * 用 floorCount 而不是 unit 表:三期两栋大厦现在 0 单元,但可以先设层数。
 * 保持 Select(而非自由输入):floor_label 参与 poolCandidates 与楼层分桶的字符串匹配。
 */
export function floorLabels(floorCount: number, existing: (string | null | undefined)[]): string[] {
  const derived = Array.from({ length: Math.max(0, floorCount | 0) }, (_, i) => cnNumeral(i + 1) + '楼')
  const extra = existing.map(s => (s ?? '').trim()).filter(s => s !== '')
  return [...new Set([...derived, ...SPECIAL, ...extra])]
}
```

- [ ] **Step 5: 跑确认通过**

```bash
cd frontend && npx vitest run src/utils/floorLabels.spec.ts src/utils/zoneLabel.spec.ts
```

Expected: PASS。

- [ ] **Step 6: 接进 PoolLedgerView**

`:454-455` 现在是：

```ts
const FLOOR_BASE = ['负一层', '一楼', '二楼', '三楼', '四楼', '五楼', '六楼', '七楼', '八楼', '九楼', '十楼', '天面']
const SIDE_BASE = ['东侧', '西侧', '南侧', '北侧', '中间']
```

删掉 `FLOOR_BASE`，`floorOpts` 改成按所选楼栋的层数派生：

```ts
// 楼层候选跟着**当前选中的楼栋**走 —— 换楼栋要重算(十二层的楼选完再换回三层的,
// 不重算会留着十二个选项)
const floorOpts = computed(() => {
  const fc = buildings.value.find(b => b.id === form.value.buildingId)?.floorCount ?? 0
  return [{ value: '', label: '(整栋,不分层)' },
    ...floorLabels(fc, (pools.value?.rows ?? []).map(r => r.floorLabel)).map(f => ({ value: f, label: f }))]
})
```

`:1002` 的方位 `Select` 改成 `<input list=>`(照 `:1008` 费项名的现成写法)：

```vue
<Select v-model="form.side" label="侧向" :options="sideOpts" size="sm" />
```
→
```vue
<label class="pl-lbl" for="pl-side">侧向</label>
<input id="pl-side" v-model="form.side" class="pl-txti" type="text" list="pl-sides"
       placeholder="(整层,不分侧)" />
<datalist id="pl-sides"><option v-for="s in sideOpts" :key="s" :value="s" /></datalist>
```

`sideOpts` 从 `{value,label}[]` 简化成 `string[]`(与 `feeNameOpts` 一致)：

```ts
const sideOpts = computed(() => uniq(SIDE_BASE, (pools.value?.rows ?? []).map(r => r.side)))
```

- [ ] **Step 7: 类型闸 + 前端全量**

```bash
cd frontend && npm run typecheck && npx vitest run
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add -A frontend/src
git commit -m "feat(alloc): 楼层候选按楼栋层数派生;方位改自由输入"
```

---

## 合并前全量门

三道门，缺一不可(基线 ~625 后端用例 / 139 前端 spec，0 失败)：

```bash
cd frontend && npm run typecheck
```

```bash
cd frontend && npx vitest run
```

```bash
cd backend && ./mvnw -q test
```

**⚠ 三条都不要接管道。** `mvnw test | tail` 的退出码取自 `tail`(恒 0)，会把失败报成成功。

---

## 验收(代码之外)

本计划让三期**建得起来**。要让它**摊得到人**，还需要 spec §5 的三件数据活——与代码改动互不阻塞，可并行，但**三件全做完之前，三期的池即使建得出来也摊不到任何人**：

1. **楼栋重建收尾**(硬前置)：16 份合同从旧桶「三期」(id 17)迁到创业/工业两栋、单元按真实楼层与面积重建、旧桶 `status=0` 停用
2. 两栋真楼设真实 `floor_count`(现在都是 1，楼层下拉按它派生)
3. 补 14 份缺 `start_date`/`end_date` 的合同(判不了在租 → 自动名册与提醒条全哑)

**端到端验收脚本**(三件数据活做完后)：

1. 楼栋管理：给创业大厦设期区=三期、层数=真实值 → 抄表屏出现「三期」tab
2. 抄表：下载模板 → 应有 8 个 sheet(4 期区 × 2 类别)，含「三期园区电」
3. 抄表：导入三期读数 → 表建档成功，`zone=p3`
4. 计费参数：给 p3 配 `zone_calc_kind` 与电价 → **不配则第 6 步的应分摊是空的**
5. 公共电核算：切到三期 tab → 建池(楼层下拉出真实层数、方位可自由输入)
6. 生成本月 → 池有应分摊、有分摊标准、摊到户
7. 催缴单：生成 → 三期租户的单子上出现公摊行，来源名 = 池名
8. 楼栋损耗：切到三期 tab → 出损耗组;去计费参数页能看到该栋的损耗参数行(**验 `ParamService:326`**)
9. 新装一块 `ownership=share` 的表、录读数、不入池 → 公共电核算屏出现提醒条
