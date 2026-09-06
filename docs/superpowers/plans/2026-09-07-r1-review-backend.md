# R1 审核机制后端 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「一张表 × 一个月」的审核态在后端落库并成为写路径的硬闸 —— 审过的表，任何入口都改不了。

**Architecture:** 一张 `review_state` 表按 `kind[:scope]:period` 存三态（submitted / approved / returned），一张 `review_log` 存留痕；`ReviewGuard.assertEditable(kind, period, scope)` 挂进 12 个 service 的每个写期间数据的方法，抛 `BizException(LOCKED)`；四个端点管状态迁移；一个从源码推导的覆盖率测试保证没人漏挂。前端一行不写（那是 R2）。

**Tech Stack:** Java 17 / Spring Boot / MyBatis-Plus（零 XML，`@Select` + `<script>`）/ Flyway / JUnit5 + Testcontainers MySQL 8。

**Spec:** `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md` §7.1–§7.4、§8.2、§9 的 R1 行、§10 测试面、§12 已知边界。执行者必须同时读 spec 与本计划。

---

## Global Constraints

- **迁移号只许往后取。** 当前最大 `V123`；`V35 / V117 / V119 / V120` 是烧掉的号（文件删了但 dev 库 `flyway_schema_history` 留了行），**一个都不许填**。本期用 `V124`，落地前再 `ls backend/src/main/resources/db/migration | sort -V | tail -3` 确认没被并行分支抢走。
- **BizException 一律 HTTP 200 + body.code。** 集成测试断言写 `jsonPath("$.code").value(423)`，**不是** `status().isLocked()`。参照 `BookPinApiIT` 里 403 那条的写法。
- **默认拒绝。** 新写端点不在 `PermissionRegistry` 登记 = 当场 403。四条审核端点必须显式登记。
- **守卫落 service 层，不落 PermissionRegistry。** 提权是在 `WriteAccessManager.check()` 里放行的，权限表拦不住它 —— spec §7.3「主管接管锁、当场提权都过不去」只有在 service 层才成立。
- **守卫按被写数据的月判，不按 URL**（spec §7.4 原文）。
- **`ReviewGuard` 必须自己校验 period 格式。** 全仓 8 个 service 没有 `requireYm`，`MeterService` 那份正则是 `\d{4}-\d{2}`，放行 `2024-00` / `2024-13`。不能信调用方洗过。
- **命名三坑**（实施者必然接错，每次动到都回来看一眼）：
  - spec 写的 `UtilitiesService` **不存在**，真名 `OfficeService`（URL 前缀 `/api/utilities`）。
  - `elec-cost` 一名三义：spec §7.1 的 `elec-cost` 键 = **附表11 = `ElecService`（`/api/elec`）**；`/api/elec-cost` = `ElecCostService` = 园区电费模型，本期新起 `elec-model` 键；`DataHomeService` 里 `yearly("电费成本","附11","elec-cost",…)` 的 `elec-cost` 是**前端路由名**。
  - `charging-car` / `charging-ebike` 是**两个 kind**，不是一个 kind 的两个 scope（对比 `utilities:office` / `utilities:phase3` 才是一个 kind 两个 scope）。
- **DTO 一律 `record`**（`backend/src/main/java/com/park/demo3/dto/` 下 180 个文件 180 个 record，零 class）。同屏出入参聚合成 `public final class XxxDtos { private XxxDtos() {} … }`。请求叫 `XxxReq`，响应叫 `XxxDTO`。
- **实体一律 `@Data` + `@TableName`**，主键 `@TableId(type = IdType.AUTO) private Long id;`，其余字段零注解（下划线转驼峰由 `application.yml` 的 `map-underscore-to-camel-case: true` 全局兜住）。
- **注释体例**：说清「为什么存在 + 踩过什么坑」，中文，半角逗号「,」与全角「，」仓库里混用 —— 新写的按本文件示例走，**不许顺手统一既有行**。
- **门禁**：后端 `cd backend && ./mvnw -B verify`（无 failsafe，surefire 直接跑 `**/*IT.java`；跑单类 `./mvnw test -Dtest=ReviewApiIT`）。本期不动前端，但收尾要跑一次 `cd frontend && npm run typecheck` 确认没被误伤。
- **本期不做**（spec §9 划给 R2/P5）：任何 `frontend/src/**` 的改动、`LoginResp.roleNames`、落地页、审核态进页签标题。唯一的例外见 Task 11 的边界说明。

---

## 本计划替你定的 6 条实施级裁定

执行前先扫一眼；不同意就先改计划，别在实施中途改主意。

| # | 事 | 裁定 | 代价 |
|---|---|---|---|
| R-1 | 错误码 | 新增 `ResultCode.LOCKED(423, …)`，仍走 **HTTP 200 + body.code=423**（与 `TOO_MANY_REQUESTS(429)` 同先例）。**不复用 409** —— §7.2 的前置阻断本来就是 409，两者混在一起前端分不出「被审核锁了」和「上游没审」 | 枚举多一位 |
| R-2 | `LedgerService.rechain(companyId)` | **逐行守在真正要写的那一行上**：循环里 `ledger.updateById(l)` 之前判 `ledger:{co}:{该行的月}`，被锁就抛 423 并点名那个月（连带把触发它的 save/import/bind 一起回滚，都在同一个 `@Transactional` 里）。**不是**「该公司有任一已审月就整体拒」—— 那会让审掉 1 月之后连 5 月都录不进去 | 只有「这次改动真的会挪动已审月的期初」时才拒；文案必须说清「你改的是 2024-01，被拒是因为 2024-03 审过」 |
| R-2b | `LedgerService.bindTenant(req)` | 循环里逐行判（`l.getCompanyId()` + `getPeriodYear/Month` 第 2 行就拿得到），命中已审核行**整体 423** 点名那一行的公司与月份。**不并进 `conflicts++`** —— `BindResultDTO(bound, conflicts)` 只有两个数，并进去用户看到的原因是错的 | 批量绑定是低频管理动作，失败要响；不改 DTO、不动前端 |
| R-3 | `S10Service.bindTenant` | 改成「先 select 命中行、再逐行 update」（照 `LedgerService.bindTenant` 现成形状），逐行判月 | R1 唯一一处必须改既有实现结构的地方 |
| R-4 | `ParamService.write` 的 `from` 行 | 守 `[acctMonth, 下一版本前)` 区间内**每一个月**，区间上界用现成的 `VersionResolver.nextFrom`。`acctMonth=''` 的长期默认行：要求该 kind **没有任何** submitted/approved 月，否则 423 点名最早那个月 | 默认行一旦有月被审过就锁死；符合「默认行是所有未覆盖月的取值来源」这个事实 |
| R-5 | 交审前置的「清单行 done」 | 复用 `DataHomeService` 的现成聚合，按 key 取对应行，**不另写一份判据**（METRIC-SOURCE-SPEC §1 红线：同一件事不许有第二份实现） | 每次交审跑一遍首页聚合。交审是低频动作，加 `ponytail:` 注释标明这个上限 |
| R-6 | 第二本账（`PvMeterService` / `CpMeterService` / `BookService`） | **本轮不进审核**，用 `@NoReviewGuard(reason)` 标注，理由写「第二本账，§7.1 无键」。`BookService` 已有自己的 `assertMonthEditable`（P6 录入即冻结） | 光伏分栋抄表 / 充电桩分桩抄表在审核月仍可改；它们是附表6/7/8 的**下游**派生账，不回写附表 |

## 执行中的偏离（边做边记，2026-09-07）

| # | 偏离 | 为什么 |
|---|---|---|
| E-1 | **T10 `ReviewApiIT` 并入 T5** | 否则 T5 交付 350 行没有任何检查的状态机。Task 10 整节作废，用例已在 T5 落地（12 条） |
| E-2 | T1 的 DDL 用 `CREATE TABLE IF NOT EXISTS` | Flyway 在容器启动时已跑过 V124，「重放同一份文件」的幂等断言必然炸在建表上；`continueOnError` 会把重复键错误一起吞掉、幂等断言变永久假绿。先例 `V91` |
| E-3 | `ReviewMigrationIT` 加 `@AfterEach` 重放种子 | 开头两条 `DELETE` 会被随后 `CREATE TABLE` 的隐式提交带着落库，`@Transactional` 挡不住；中途失败就把复用容器里的 `reviewer` 种子永久删了 |
| E-4 | 计划里「去掉 `setSqlScriptEncoding` → INSERT 静默失效」的机理**写错了** | 实测 `file.encoding=GBK` 下语句边界没被打乱，两条 INSERT 照常执行，只是中文串落库成乱码。原断言只验 ASCII 列 = 假绿，已补 `name` 断言 |
| E-5 | 删掉 `ReviewService.requireReviewer()` | URL 层挂的就是 `review:approve`，每条路径都过得了那道闸且无内部调用方 —— 恒为真的守卫比没有守卫更糟。改测真正承重的 `submit` kind→perm 收窄 |
| E-6 | 状态写入一律走 `UpdateWrapper` 显式 `set(col, null)` | MyBatis-Plus 默认 `updateStrategy = NOT_NULL`，`setXxx(null)` 压根不进 UPDATE —— 重新交审清不掉上一轮的退回理由（ReviewApiIT 抓到） |
| E-7 | T6/T7/T8 各自新建 IT 文件 | `ReviewGuardChainIT` / `ReviewGuardBookingIT` / `ReviewGuardElecIT`。不往 `ReviewGuardIT` 里塞 —— 那个是非 HTTP 的守卫单元测试，混进 HTTP 用例会让两种失败模式纠缠 |
| E-8 | `ReviewGuard` 的 `assertNoLockedMonth` 只用于**参数/规则的长期默认行** | 计划原写「rechain 也用它」，T7 的裁定 R-2 已改成逐行守在真正要 `updateById` 的那一行 |
| E-9 | **R-4 的一个副作用，等用户裁定** | `AllocService.createRule` 带初始分母时会 `saveCfg(scope="rule:<新id>", key="coefficient", acctMonth="")` → `ParamService.write` → `assertNoLockedMonth(PARAMS, null)`。于是 **params 只要有任一月 submitted/approved，「新建公摊池（带初始分母）」就永久 423**，文案还说的是「计费参数已审核」。试过按「这个键没有历史行就放行」收窄——**不成立**：key 是 `coefficient`，它在别的池下有大量行；改按 (key, scope) 判又会在 `scope="p1"` 这类情况下放行真正的口径修改。已撤回，保持 R-4 原样 |
| E-10 | T8:`ElecCostService` 的守卫落在私有 `writeEntry` 一处,但**只有两个** public 转调它 | 计划猜的是「三个 public 共用 `writeEntry`」。实际 `upsertEntry` / `importRows` 走 `writeEntry`,`simulate` 走另一条私有路径(`upsertSim` + `insertCfgIfAbsent`)—— 所以 simulate 单独挂整年批量闸,两个转调的 public 各挂 `@NoReviewGuard` 指过去 |
| E-11 | T8:`ElecCostService` 的电表档案 CRUD(`createMeter`/`updateMeter`/`deleteMeter`)进白名单 | 计划没点到这三个,但它们是 controller 可达的写方法,T9 的覆盖率推导会扫到。`elec_meter` 不带期间,照 `MeterService` 表档案那三条的先例写理由 |
| E-12 | T8:白名单注解比计划多 —— `PvMeterService` 8 个(计划写 5)、`CpMeterService` 9 个(计划写 6) | 计划只数了抄表读数那几个,漏了电站档案 CRUD 与 `CpMeterService.upsertPowerUsage`。按 controller 可达的写方法逐个标,数字以代码为准 |

**两个自查踩到的坑，写给后面的 Task：**
- 块注释里不许出现 `*/` —— `/api/review/*/submit` 会提前闭合 javadoc，编译炸在莫名其妙的行上。用 `{key}`。
- **编译失败时 `target/surefire-reports/*.txt` 是上一轮的旧文件**，会显示上次的绿。每次先 grep `COMPILATION ERROR` 再看报告。

---

## 附表11 拆两把键（2026-09-07 用户拍板）

spec §7.1 原表只有一把 `elec-cost:YYYY-MM`，但附表11 的数据躺在两张表里：

| 键 | 表 | service | 屏 | 上不上清单 |
|---|---|---|---|---|
| `elec-cost:YYYY-MM` | `elec_record` | `ElecService`（`/api/elec`） | ElecView 左栏「报送台账」 | **上**（记账列第 7 行，`go='elec-cost'`） |
| `elec-model:YYYY-MM` | `elec_cost_entry` | `ElecCostService`（`/api/elec-cost`） | ElecView 左栏「园区电费模型」 | **不上** |

`elec-model` 没有清单行，两条随之而来的裁定：

- **交审前置**改成「该月 `elec_cost_entry` 有行」，不走 R-5 的清单行 done。
- **不进整月锁账的键集合** —— §7.2 的「其余 7 张」保持 7，P2 刚落地的六项计数一个数都不用改（§12：计数与审核键集合必须与屏内同源，假绿栽过三次）。

---

## File Structure

**新建（16 个）**

| 文件 | 职责 |
|---|---|
| `backend/src/main/resources/db/migration/V124__review.sql` | 两张表 + `reviewer` 角色 + `review:approve` 授给 admin/reviewer |
| `backend/src/main/java/com/park/demo3/entity/ReviewState.java` | `review_state` 行 |
| `backend/src/main/java/com/park/demo3/entity/ReviewLog.java` | `review_log` 行 |
| `backend/src/main/java/com/park/demo3/mapper/ReviewStateMapper.java` | `BaseMapper` + 按 period / 按 kind 查 |
| `backend/src/main/java/com/park/demo3/mapper/ReviewLogMapper.java` | 只写不查，四行 |
| `backend/src/main/java/com/park/demo3/security/ReviewKind.java` | kind 白名单枚举 + kind→perm 表 + scope 形状 |
| `backend/src/main/java/com/park/demo3/security/ReviewKey.java` | 键的解析与构造（`kind[:scope]:period`） |
| `backend/src/main/java/com/park/demo3/security/ReviewGuard.java` | `assertEditable`，写路径唯一的闸 |
| `backend/src/main/java/com/park/demo3/security/NoReviewGuard.java` | 白名单注解（全仓第一个自定义注解） |
| `backend/src/main/java/com/park/demo3/service/ReviewService.java` | 读侧聚合 + 四个状态迁移 + 前置图 + 落 `review_log` |
| `backend/src/main/java/com/park/demo3/controller/ReviewController.java` | 五个端点 |
| `backend/src/main/java/com/park/demo3/dto/ReviewDtos.java` | 出入参 record 容器 |
| `backend/src/test/java/com/park/demo3/security/ReviewKeyTest.java` | 键解析的纯单元测试 |
| `backend/src/test/java/com/park/demo3/security/ReviewGuardCoverageTest.java` | 从源码推导的覆盖率门禁 |
| `backend/src/test/java/com/park/demo3/api/ReviewApiIT.java` | 端到端 |
| `backend/src/test/java/com/park/demo3/api/ReviewMigrationIT.java` | V124 重放 |

**修改（后端 9 + 测试 1 + 规范 8）**

| 文件 | 改什么 |
|---|---|
| `security/Perm.java` | 第 18 点，四处（常量 / ALL + javadoc 计数 / NOT_ELEVATABLE / META） |
| `common/ResultCode.java` | 加 `LOCKED(423, …)` |
| `security/PermissionRegistry.java` | 构造器里加四条审核端点规则 |
| `mapper/AuditQueryMapper.java` | `BRANCHES` 加第 4 路 + `actors()` 加一行 UNION |
| `service/SystemService.java` | 来源白名单加 `"review"` |
| `controller/SystemController.java` | 日志端点 summary 文案 |
| `dto/PresenceDtos.java` | `PingResp` 加一个字段 + 改「一条通道四件事」注释 |
| `service/PresenceService.java` | 唯一那处 `new PingResp(...)` 填上新字段 |
| 12 个业务 service | 挂 `ReviewGuard.assertEditable`（Task 5 / 6 / 7） |
| `backend/src/test/java/com/park/demo3/api/BookPinApiIT.java` | `hasSize(17)` → `18` |
| 规范 8 份 | 见 Task 12 |

**不建的**：不建 `ReviewLogService`（`ReviewService` 自己写日志，照 `AuditLogService` 的旁路写入形状）；不给 `review_state` 建 XML mapper（全仓零 XML）；不改 `WriteAccessManager`（新端点只要登记进 `PermissionRegistry` 就自动生效）；不改 `DataHomeOverviewDTO`（审核态由 `GET /api/review` 单独发，前端 R2 自己 join）。

---

### Task 1: V124 迁移 + 实体 + Mapper + 迁移测试

**Files:**
- Create: `backend/src/main/resources/db/migration/V124__review.sql`
- Create: `backend/src/main/java/com/park/demo3/entity/ReviewState.java`
- Create: `backend/src/main/java/com/park/demo3/entity/ReviewLog.java`
- Create: `backend/src/main/java/com/park/demo3/mapper/ReviewStateMapper.java`
- Create: `backend/src/main/java/com/park/demo3/mapper/ReviewLogMapper.java`
- Test: `backend/src/test/java/com/park/demo3/api/ReviewMigrationIT.java`

**Interfaces:**
- Consumes: 无（本期第一个任务）。
- Produces: `ReviewState`（`@Data` 生成 `getReviewKey/getKind/getPeriod/getScope/getStatus/getSubmittedBy/getSubmittedAt/getReviewedBy/getReviewedAt/getReason` 与对应 setter）、`ReviewLog`、`ReviewStateMapper.byPeriod(String period) -> List<ReviewState>`、`ReviewStateMapper.byKindAndScope(String kind, String scope) -> List<ReviewState>`（按 period 升序）、`ReviewLogMapper`（裸 `BaseMapper<ReviewLog>`）。

- [ ] **Step 1: 先确认迁移号还空着**

```bash
cd backend && ls src/main/resources/db/migration | sort -V | tail -3
```

预期看到 `V121 / V122 / V123`。若已出现 V124，停下来问，**不要**自己往后挪号（V124 是 spec §7.4 写死的）。

- [ ] **Step 2: 核对种子迁移要用到的真实列名**

```bash
cd backend && sed -n '1,50p' src/main/resources/db/migration/V101__rbac.sql
```

看清 `auth_role` 有没有 `remark` 列、`auth_role_perm` 的权限列叫 `perm` 还是别的。Step 3 的两条 INSERT 按**真实列名**写，对不上就改，别照抄。

- [ ] **Step 3: 写迁移**

新建 `backend/src/main/resources/db/migration/V124__review.sql`。体例照 `V102__audit_log.sql`（同域、行内 `--` 注释 + 表级 `COMMENT`）：

```sql
-- 审核机制（SIDEBAR-UX-REDESIGN spec §7）。一张表 × 一个月 = 一把审核键。
--
-- 为什么不复用 auth_audit_log:那张表是「谁做了什么」的事后流水,没有状态;
-- 审核要的是「这把键现在处于哪一态」——可查询、可加锁的当前态。留痕另存 review_log。
--
-- 为什么没有 period_close 表:整月锁账 = 该月全部审核键 approved,派生(D20),不落库。
--
-- review_key 格式 kind[:scope]:period。最长 `ledger:{10 位 companyId}:YYYY-MM` = 25 字符,
-- VARCHAR(64) 留 2.5 倍余量;utf8mb4 下主键 256 字节,远低于 InnoDB 3072 上限。

CREATE TABLE review_state (
  review_key   VARCHAR(64)  NOT NULL,              -- kind[:scope]:period
  kind         VARCHAR(24)  NOT NULL,              -- ReviewKind 枚举,最长 charging-ebike(14)
  period       CHAR(7)      NOT NULL,              -- YYYY-MM
  scope        VARCHAR(16)  NULL,                  -- ledger=companyId / s10=phase / utilities=office|phase3
  status       VARCHAR(12)  NOT NULL,              -- submitted / approved / returned
  submitted_by VARCHAR(64)  NULL,
  submitted_at DATETIME     NULL,
  reviewed_by  VARCHAR(64)  NULL,
  reviewed_at  DATETIME     NULL,
  reason       VARCHAR(255) NULL,                  -- 退回 / 撤销的必填理由
  PRIMARY KEY (review_key),
  KEY idx_review_period (period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='审核态:一张表 × 一个月';

-- 留痕。状态机每走一步落一行,进「操作日志」屏作第 4 张来源表(RBAC-SPEC §7)。
-- 不设 authorizer 列:审核不走提权(review:approve 进 Perm.NOT_ELEVATABLE),
-- 没有「代他人执行」这回事。AuditQueryMapper 的第 4 路写 NULL AS authorizer。
CREATE TABLE review_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  review_key VARCHAR(64)  NOT NULL,
  action     VARCHAR(12)  NOT NULL,                -- submit / approve / return / withdraw
  actor      VARCHAR(64)  NOT NULL DEFAULT '',
  at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason     VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_rl_key (review_key, at),
  KEY idx_rl_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='审核动作留痕';

-- 第 7 个预置角色(D16 录审分离:六个既有角色权限不变,财务主管默认不带审核权)。
-- nav_layers 三层与其余五个业务角色一致;system 层不进这个字段,跟 system:view 走。
INSERT INTO auth_role (code, name, builtin, nav_layers, remark)
SELECT 'reviewer', '审核员', 1, 'data,reports,analysis', '只审不录:只有 review:approve,零 :edit'
WHERE NOT EXISTS (SELECT 1 FROM auth_role WHERE code = 'reviewer');

-- admin 是「全部权限」角色(V101 起每个新权限点都给它),reviewer 是本权限点的正主。
-- 幂等 NOT EXISTS 子查询,照 V108 / V109 / V112 的形状。
INSERT INTO auth_role_perm (role_id, perm)
SELECT r.id, 'review:approve' FROM auth_role r
WHERE r.code IN ('admin', 'reviewer')
  AND NOT EXISTS (SELECT 1 FROM auth_role_perm p WHERE p.role_id = r.id AND p.perm = 'review:approve');
```

- [ ] **Step 4: 写实体两个**

`backend/src/main/java/com/park/demo3/entity/ReviewState.java`：

```java
package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDateTime;

/** 一把审核键的当前态(spec §7.2)。「录入中」是派生态 —— 没有行就是录入中,不落库。 */
@Data
@TableName("review_state")
public class ReviewState {
    @TableId(type = IdType.INPUT) private String reviewKey;
    private String kind;
    private String period;
    private String scope;
    private String status;
    private String submittedBy;
    private LocalDateTime submittedAt;
    private String reviewedBy;
    private LocalDateTime reviewedAt;
    private String reason;
}
```

⚠ 主键是**业务串不是自增**,所以是 `IdType.INPUT`,不是全仓惯用的 `AUTO`。用 `AUTO` 会让 MyBatis-Plus 在 insert 后往 `reviewKey` 回写自增值,当场把键冲掉。

`backend/src/main/java/com/park/demo3/entity/ReviewLog.java`：

```java
package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import java.time.LocalDateTime;

/** 审核动作留痕。at 由 service 显式赋值(照 AuditLogService 的 setTs),DB 默认只是兜底。 */
@Data
@TableName("review_log")
public class ReviewLog {
    @TableId(type = IdType.AUTO) private Long id;
    private String reviewKey;
    private String action;
    private String actor;
    private LocalDateTime at;
    private String reason;
}
```

- [ ] **Step 5: 写 Mapper 两个**

`backend/src/main/java/com/park/demo3/mapper/ReviewLogMapper.java` 四行，照 `AuthAuditLogMapper`：

```java
package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.ReviewLog;
public interface ReviewLogMapper extends BaseMapper<ReviewLog> {}
```

`backend/src/main/java/com/park/demo3/mapper/ReviewStateMapper.java` —— `BaseMapper` + 两个 `default` 方法（照 `BookMonthPinMapper` 的 QueryWrapper 形状，不写 `@Select`）：

```java
package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.ReviewState;
import java.util.List;

public interface ReviewStateMapper extends BaseMapper<ReviewState> {

    /** 某月全部审核键的落库行。没有行 = 该键处于派生态「录入中」。 */
    default List<ReviewState> byPeriod(String period) {
        return selectList(new QueryWrapper<ReviewState>().eq("period", period));
    }

    /**
     * 某个 kind(+scope) 的全部月份,按期升序。
     * 跨月写(rechain、参数默认行)要靠它反查「有没有已审月」—— 见计划裁定 R-2 / R-4。
     */
    default List<ReviewState> byKindAndScope(String kind, String scope) {
        QueryWrapper<ReviewState> q = new QueryWrapper<ReviewState>().eq("kind", kind);
        if (scope == null) q.isNull("scope"); else q.eq("scope", scope);
        return selectList(q.orderByAsc("period"));
    }
}
```

⚠ `selectList(null)` 有门禁（`QueryHygieneTest`），两个方法都必须带 QueryWrapper。

- [ ] **Step 6: 写迁移测试**

`backend/src/test/java/com/park/demo3/api/ReviewMigrationIT.java`，照 `PoolSideBackfillIT` 全套形状（`extends AbstractMysqlIT` + 类上 `@Transactional` + `ResourceDatabasePopulator` 从 classpath 原样重放 `.sql`，**不许把 SQL 抄成 Java 字符串**）。

```java
ResourceDatabasePopulator populator = new ResourceDatabasePopulator();
populator.addScript(new ClassPathResource("db/migration/V124__review.sql"));
populator.setSqlScriptEncoding("UTF-8");   // ⚠ 不写这行,Windows 默认字符集读错中文注释,
                                           //   按 ';' 切语句的边界被打乱,INSERT 静默失效
```

四条断言：

1. `review_state` / `review_log` 两张表存在且列齐 —— 查 `information_schema.columns` 断言列名集合恰好等于上面 DDL 里那 10 列 / 6 列。
2. `auth_role` 里恰有一行 `code='reviewer'`，且 `builtin=1`、`nav_layers='data,reports,analysis'`。
3. `auth_role_perm` 里 `perm='review:approve'` 恰有 2 行，对应 admin 与 reviewer。
4. **幂等**：把同一份 `V124__review.sql` 再重放一遍，断言 2 与断言 3 的行数不变（1 行 / 2 行）。

- [ ] **Step 7: 破坏验证（逐条，本人做，不许委托子代理）**

| 改坏什么 | 哪条断言必须红 |
|---|---|
| 从 DDL 删掉 `reason VARCHAR(255) NULL` | 断言 1 红 |
| 把 reviewer 的 `builtin` 改成 0 | 断言 2 红 |
| 把 `r.code IN ('admin','reviewer')` 改成只 `'reviewer'` | 断言 3 红（2 行变 1 行） |
| 去掉两条 INSERT 的 `NOT EXISTS` 子查询 | 断言 4 红 |
| 去掉 `setSqlScriptEncoding("UTF-8")` | 断言 2 或 3 红（中文注释后的 INSERT 静默失效） |

五条逐条改坏、跑、看红、改回。**任何一条改坏后仍绿 = 那条断言是假绿，当场补。**

- [ ] **Step 8: 跑**

```bash
cd backend && ./mvnw test -Dtest=ReviewMigrationIT
```

- [ ] **Step 9: 提交**

```bash
git add backend/src/main/resources/db/migration/V124__review.sql backend/src/main/java/com/park/demo3/entity/ReviewState.java backend/src/main/java/com/park/demo3/entity/ReviewLog.java backend/src/main/java/com/park/demo3/mapper/ReviewStateMapper.java backend/src/main/java/com/park/demo3/mapper/ReviewLogMapper.java backend/src/test/java/com/park/demo3/api/ReviewMigrationIT.java
git commit -m "feat(review): R1 T1 V124 迁移 —— review_state/review_log 两表 + reviewer 角色 + review:approve 种子"
```

---

### Task 2: 第 18 个权限点 + `ResultCode.LOCKED`

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/security/Perm.java`（四处）
- Modify: `backend/src/main/java/com/park/demo3/common/ResultCode.java`（一处）
- Modify: `backend/src/test/java/com/park/demo3/api/BookPinApiIT.java`（`hasSize(17)` → `18`）
- Test: `backend/src/test/java/com/park/demo3/security/RoleApiIT.java`（新增一个 `@Test`）

**Interfaces:**
- Consumes: Task 1 的 V124 种子（`RoleApiIT.adminRoleHoldsEveryPermission` 靠它才绿）。
- Produces: `Perm.REVIEW_APPROVE`（值 `"review:approve"`）、`ResultCode.LOCKED`（`.code == 423`）。

- [ ] **Step 1: 先写会红的断言**

在 `backend/src/test/java/com/park/demo3/security/RoleApiIT.java` 里新增（照同文件既有 `@Test` 的风格）：

```java
    /**
     * 第 18 个权限点 review:approve(spec §7.3)。四处齐了才算加完:
     * 常量 / ALL(决定矩阵行序) / META(矩阵渲染读的是它,只加 ALL 永远勾不上) / NOT_ELEVATABLE。
     * 少任一处这条就红。
     */
    @Test
    void perm18_reviewApprove_isRegisteredEverywhere() {
        assertThat(Perm.ALL).hasSize(18).contains(Perm.REVIEW_APPROVE);
        assertThat(Perm.META.stream().map(Perm.Meta::key)).contains(Perm.REVIEW_APPROVE);
        assertThat(Perm.elevatable(Perm.REVIEW_APPROVE))
            .as("审核不是能当场借的权限(spec §7.3),必须进 NOT_ELEVATABLE").isFalse();
    }
```

- [ ] **Step 2: 跑，确认它红**

```bash
cd backend && ./mvnw test -Dtest=RoleApiIT
```

预期：编译失败（`Perm.REVIEW_APPROVE` 不存在）。这就是「红」。

- [ ] **Step 3: 改 `Perm.java` 四处**

**① 常量区** —— 锚点：`public static final String BOOK_TEMPLATE_SWITCH = "book-template:switch";` **这一行之后**。照第 15/16/17 点的两行拍板注释体例：

```java
    // 第 18 点(2026-09-03 用户拍板):审核通过/退回/撤销 —— 与「录」彻底分开的一档。
    // 录审分离靠角色分配保证:六个既有角色权限不变,财务主管默认不带审核权(D16);
    // 不给这项的账号在清单行上看不到「通过/退回/撤销」,已审核的表谁也改不了。
    public static final String REVIEW_APPROVE      = "review:approve";
```

**② `ALL` 列表 + 它 javadoc 的计数** —— 两处都要改：

- javadoc 那行 `/** 全部 17 个。…… */` 的 `17` 改成 `18`。
- `List.of(...)` 里追加。**位置就是角色屏矩阵的行序**（`SystemService` 按 `Perm.ALL::indexOf` 排序），审核放最后一档，即把结尾那行改成：

```java
        ENTRY_EDIT, REPORT_EDIT, SYSTEM_VIEW, SYSTEM_EDIT, LOCK_TAKEOVER, ELEVATE_REQUEST,
        REVIEW_APPROVE);
```

**③ `NOT_ELEVATABLE`** —— 把那个 `Set.of(...)` 改成：

```java
    private static final Set<String> NOT_ELEVATABLE = Set.of(
        SYSTEM_VIEW, SYSTEM_EDIT, ELEVATE_REQUEST, LOCK_TAKEOVER, REVIEW_APPROVE);
```

并在它上方 javadoc 的末尾补一句（照既有段落的语气）：

```java
     * review:approve 同理(spec §7.3):审核能当场借 30 分钟的话,「录审分离」当场作废 ——
     * 录入方可以请主管借一次审核权,把自己刚录的东西审掉。
```

**④ `META` 列表** —— 末条 `new Meta(ELEVATE_REQUEST, …));` 的 `));` 改成 `),`，然后追加新的末条：

```java
        new Meta(REVIEW_APPROVE,     "审核",            "通过 / 退回 / 撤销某张表某个月的审核;已审核的表任何人都改不了,只有审核员能撤销"));
```

⚠ 三条不许顺手做的事：不要去修 `label()` 方法夹在常量中间那个「不整齐」；不要把 META 里混用的全角「；」半角「;」统一；不要重排 `=` 的列对齐。

- [ ] **Step 4: 改 `ResultCode.java`，加 `LOCKED`**

锚点：`CONFLICT(409, "资源冲突"),` **这一行之后**：

```java
    // 审核锁定(spec §7.4)。与 409 分开:409 是「上游没审完」的前置冲突,423 是「这张表本月已审/待审」——
    // 合成一个码前端就分不出「去催上游」和「去找审核员撤销」两种下一步。
    // 仍走 BizException → HTTP 200 + body.code=423,与 TOO_MANY_REQUESTS(429) 同先例。
    LOCKED(423, "该表本月已审核或待审核，不能修改"),
```

- [ ] **Step 5: 改 `BookPinApiIT.java:432` 的硬编码总数**

`assertThat(com.park.demo3.security.Perm.ALL).hasSize(17)` → `hasSize(18)`。**只改这个数字**，同一个 `@Test` 里那两条 `BOOK_TEMPLATE_SWITCH` 断言原样不动（方法名 `perm17_isRegisteredAndRenderedInMatrix` 也不改 —— 它说的是「第 17 点」这件事，不是总数）。

- [ ] **Step 6: 跑，确认全绿**

```bash
cd backend && ./mvnw test -Dtest=RoleApiIT+BookPinApiIT+SystemApiIT+PermissionCoverageTest
```

`SystemApiIT` 的 `containsExactlyElementsOf(Perm.ALL)` 与 `PermissionCoverageTest` 是自适应的，不用改；它们绿说明 META 与 ALL 没漏。

- [ ] **Step 7: 破坏验证（逐条）**

| 改坏什么 | 必须红 |
|---|---|
| 把 `REVIEW_APPROVE` 从 `META` 里删掉（`ALL` 保留） | `perm18` 第 2 条 + `SystemApiIT` |
| 把 `REVIEW_APPROVE` 从 `NOT_ELEVATABLE` 里删掉 | `perm18` 第 3 条 |
| 把 V124 的 admin 那条种子删掉 | `RoleApiIT.adminRoleHoldsEveryPermission` |
| `ResultCode.LOCKED` 的 code 写成 409 | 暂无断言 —— **本步必须补**：在 `perm18` 同文件加一行 `assertThat(ResultCode.LOCKED.code).isEqualTo(423);` 再验一次 |

最后一行不是可选项：**没有断言的常量就是没有护栏**。

- [ ] **Step 8: 提交**

```bash
git add backend/src/main/java/com/park/demo3/security/Perm.java backend/src/main/java/com/park/demo3/common/ResultCode.java backend/src/test/java/com/park/demo3/security/RoleApiIT.java backend/src/test/java/com/park/demo3/api/BookPinApiIT.java
git commit -m "feat(review): R1 T2 第 18 个权限点 review:approve + ResultCode.LOCKED(423) —— 四处齐(常量/ALL/META/不可提权)"
```

---

### Task 3: `ReviewKind` 枚举 + 审核键 + kind→perm 表

**Files:**
- Create: `backend/src/main/java/com/park/demo3/security/ReviewKind.java`
- Test: `backend/src/test/java/com/park/demo3/security/ReviewKeyTest.java`

**Interfaces:**
- Consumes: `Perm.*`（Task 2）。
- Produces:
  - `enum ReviewKind`，常量 14 个：`PARAMS, METERS, ALLOC, ALLOC_LOSS, BILL_NOTICES, LEDGER, S10, SALARY, UTILITIES, PV, CHARGING_CAR, CHARGING_EBIKE, ELEC_COST, ELEC_MODEL`
  - `ReviewKind.code() -> String`（`"params"` / `"alloc-loss"` / `"charging-ebike"` / `"elec-model"` …）
  - `ReviewKind.label() -> String`（人话名，进错误文案）
  - `ReviewKind.perms() -> List<String>`（交审要的权限点，满足其一即可）
  - `ReviewKind.scopeShape() -> ScopeShape`（`NONE / COMPANY / PHASE / FIXED`）
  - `ReviewKind.of(String code) -> ReviewKind`（未知 code 抛 `BizException(BAD_REQUEST)`）
  - `record ReviewKey(ReviewKind kind, String scope, String period)`，静态 `ReviewKey.parse(String raw)` 与实例 `raw()`；`ReviewKey.of(ReviewKind, String scope, String period)`
  - `ReviewKind.countsTowardMonthClose() -> boolean`（`ELEC_MODEL` 返回 false，其余 true —— 整月锁账键集合用它筛）

- [ ] **Step 1: 写失败的测试**

新建 `backend/src/test/java/com/park/demo3/security/ReviewKeyTest.java`（纯单元，**不起 Spring 上下文**，类名以 `Test` 结尾即可被 surefire 捡到）：

```java
package com.park.demo3.security;

import com.park.demo3.common.BizException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.*;

class ReviewKeyTest {

    @Test
    void parse_roundTrips_allThreeShapes() {
        assertThat(ReviewKey.parse("salary:2024-02").raw()).isEqualTo("salary:2024-02");
        assertThat(ReviewKey.parse("ledger:7:2024-02").scope()).isEqualTo("7");
        assertThat(ReviewKey.parse("utilities:phase3:2024-02").kind()).isEqualTo(ReviewKind.UTILITIES);
        // 带连字符的 kind 不能被 ':' 切错
        assertThat(ReviewKey.parse("charging-ebike:2024-02").kind()).isEqualTo(ReviewKind.CHARGING_EBIKE);
        assertThat(ReviewKey.parse("alloc-loss:2024-02").kind()).isEqualTo(ReviewKind.ALLOC_LOSS);
    }

    @Test
    void parse_rejects_badPeriod() {
        // MeterService 那份 \d{4}-\d{2} 会放行 2024-00 / 2024-13,这里不能跟着松
        assertThatThrownBy(() -> ReviewKey.parse("salary:2024-13")).isInstanceOf(BizException.class);
        assertThatThrownBy(() -> ReviewKey.parse("salary:2024-00")).isInstanceOf(BizException.class);
        assertThatThrownBy(() -> ReviewKey.parse("salary:24-02")).isInstanceOf(BizException.class);
        assertThatThrownBy(() -> ReviewKey.parse("salary")).isInstanceOf(BizException.class);
    }

    @Test
    void parse_rejects_unknownKind_and_wrongScopeShape() {
        assertThatThrownBy(() -> ReviewKey.parse("recon:2024-02")).isInstanceOf(BizException.class);
        // salary 是园区级表,不许带 scope
        assertThatThrownBy(() -> ReviewKey.parse("salary:office:2024-02")).isInstanceOf(BizException.class);
        // ledger 必须带 scope,且必须是数字 companyId
        assertThatThrownBy(() -> ReviewKey.parse("ledger:2024-02")).isInstanceOf(BizException.class);
        assertThatThrownBy(() -> ReviewKey.parse("ledger:abc:2024-02")).isInstanceOf(BizException.class);
        // s10 的期区只有 1..4
        assertThatThrownBy(() -> ReviewKey.parse("s10:5:2024-02")).isInstanceOf(BizException.class);
        // utilities 只有两个固定 scope
        assertThatThrownBy(() -> ReviewKey.parse("utilities:dorm:2024-02")).isInstanceOf(BizException.class);
    }

    @Test
    void params_takesEitherParamPerm_othersTakeOne() {
        assertThat(ReviewKind.PARAMS.perms())
            .containsExactlyInAnyOrder(Perm.PARAM_POLICY_EDIT, Perm.PARAM_MONTHLY_EDIT);
        assertThat(ReviewKind.METERS.perms()).containsExactly(Perm.METER_READING_EDIT);
        assertThat(ReviewKind.ALLOC.perms()).containsExactly(Perm.BILLING_RUN_EDIT);
        assertThat(ReviewKind.LEDGER.perms()).containsExactly(Perm.ENTRY_EDIT);
    }

    @Test
    void everyKindHasPermsAndLabel_andOnlyElecModelIsOutOfMonthClose() {
        for (ReviewKind k : ReviewKind.values()) {
            assertThat(k.perms()).as(k.code() + " 缺 kind→perm 映射").isNotEmpty();
            assertThat(k.perms()).allMatch(Perm::exists);
            assertThat(k.label()).as(k.code() + " 缺人话名").isNotBlank();
        }
        assertThat(java.util.Arrays.stream(ReviewKind.values())
                .filter(k -> !k.countsTowardMonthClose()).map(ReviewKind::code))
            .as("只有 elec-model 不进整月锁账(它没有清单行)")
            .containsExactly("elec-model");
    }
}
```

- [ ] **Step 2: 跑，确认它红**

```bash
cd backend && ./mvnw test -Dtest=ReviewKeyTest
```

预期：编译失败（`ReviewKind` / `ReviewKey` 不存在）。

- [ ] **Step 3: 写 `ReviewKind.java`（枚举 + `ReviewKey` record 同文件）**

```java
package com.park.demo3.security;

import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;

import java.util.List;
import java.util.regex.Pattern;

/**
 * 审核键的 kind 白名单(spec §7.1)。键格式 `kind[:scope]:period`。
 *
 * **kind→perm 这张表是新写的,不是「复用 RBAC-SPEC §5.2」** —— §5.2 是 126 条
 * URL 路径前缀 → 权限点的有序表,不是以 kind 为主键的表,而且那个映射对 params
 * (policy / monthly 两档)与 elec-cost 根本不是函数。交审要的是「这张表的 edit 权」,
 * 只能按屏(= 清单行)重新列一张。改这张表前先读 spec §7.1 与 RBAC-SPEC §5.2。
 *
 * 三个命名坑(spec 与代码对不上,别照 spec 的字面找类):
 *  · UTILITIES 的 service 叫 OfficeService(URL /api/utilities),spec 写的 UtilitiesService 不存在。
 *  · ELEC_COST(附表11 报送台账)= ElecService(/api/elec);ELEC_MODEL(园区电费模型)= ElecCostService
 *    (/api/elec-cost)。两把键 2026-09-07 用户拍板拆开 —— 数据分别在 elec_record 与 elec_cost_entry。
 *  · CHARGING_CAR / CHARGING_EBIKE 是两个 kind,不是一个 kind 的两个 scope
 *    (对比 UTILITIES 的 office / phase3 才是一个 kind 两个 scope)。
 */
public enum ReviewKind {

    PARAMS       ("params",         "计费参数",     ScopeShape.NONE,  List.of(Perm.PARAM_POLICY_EDIT, Perm.PARAM_MONTHLY_EDIT), true),
    METERS       ("meters",         "园区抄表",     ScopeShape.NONE,  List.of(Perm.METER_READING_EDIT), true),
    ALLOC        ("alloc",          "公共电核算",   ScopeShape.NONE,  List.of(Perm.BILLING_RUN_EDIT),   true),
    ALLOC_LOSS   ("alloc-loss",     "楼栋损耗",     ScopeShape.NONE,  List.of(Perm.BILLING_RUN_EDIT),   true),
    BILL_NOTICES ("bill-notices",   "催缴单",       ScopeShape.NONE,  List.of(Perm.BILLING_RUN_EDIT),   true),
    LEDGER       ("ledger",         "月度台账",     ScopeShape.COMPANY, List.of(Perm.ENTRY_EDIT),       true),
    S10          ("s10",            "附表10",       ScopeShape.PHASE, List.of(Perm.ENTRY_EDIT),         true),
    SALARY       ("salary",         "附表12",       ScopeShape.NONE,  List.of(Perm.ENTRY_EDIT),         true),
    UTILITIES    ("utilities",      "办公·三期水电", ScopeShape.FIXED, List.of(Perm.ENTRY_EDIT),        true),
    PV           ("pv",             "附表6",        ScopeShape.NONE,  List.of(Perm.ENTRY_EDIT),         true),
    CHARGING_CAR ("charging-car",   "附表7",        ScopeShape.NONE,  List.of(Perm.ENTRY_EDIT),         true),
    CHARGING_EBIKE("charging-ebike","附表8",        ScopeShape.NONE,  List.of(Perm.ENTRY_EDIT),         true),
    ELEC_COST    ("elec-cost",      "附表11",       ScopeShape.NONE,  List.of(Perm.ENTRY_EDIT),         true),
    // 园区电费模型没有清单行(本月出账屏记账列 8 行里没有它),所以:
    //   ① 交审前置不走「清单行 done」,改判「该月 elec_cost_entry 有行」(见 ReviewService);
    //   ② 不进整月锁账的键集合 —— 否则锁账永远达不成,且 P2 的六项计数要跟着改(§12 假绿栽过三次)。
    ELEC_MODEL   ("elec-model",     "园区电费模型", ScopeShape.NONE,  List.of(Perm.ENTRY_EDIT),         false);

    /** scope 这一维长什么样。COMPANY=数字 companyId;PHASE=1..4;FIXED=office|phase3;NONE=不许带。 */
    public enum ScopeShape { NONE, COMPANY, PHASE, FIXED }

    private final String code, label;
    private final ScopeShape shape;
    private final List<String> perms;
    private final boolean monthClose;

    ReviewKind(String code, String label, ScopeShape shape, List<String> perms, boolean monthClose) {
        this.code = code; this.label = label; this.shape = shape; this.perms = perms; this.monthClose = monthClose;
    }

    public String code() { return code; }
    public String label() { return label; }
    public ScopeShape scopeShape() { return shape; }
    /** 交审要的权限点,满足其一即可(照 PermissionRegistry 的 anyOf 语义)。 */
    public List<String> perms() { return perms; }
    /** 进不进整月锁账的键集合(D20)。 */
    public boolean countsTowardMonthClose() { return monthClose; }

    public static ReviewKind of(String code) {
        for (ReviewKind k : values()) if (k.code.equals(code)) return k;
        throw new BizException(ResultCode.BAD_REQUEST, "未知的审核类型:" + code);
    }

    static final List<String> FIXED_SCOPES = List.of("office", "phase3");
    static final Pattern PERIOD = Pattern.compile("^\\d{4}-(0[1-9]|1[0-2])$");
}
```

⚠ `PERIOD` 正则用 `(0[1-9]|1[0-2])` **不是** `\d{2}` —— `MeterService` 那份 `\d{4}-\d{2}` 会放行 `2024-00` / `2024-13`，审核键不能跟着松（`ReviewGuard` 是最后一道闸，前面 8 个 service 一个 `requireYm` 都没有）。

- [ ] **Step 4: 写 `ReviewKey.java`**

```java
package com.park.demo3.security;

import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;

/**
 * 一把审核键:`kind[:scope]:period`。解析从**右边**切 —— kind 里有连字符没有冒号,
 * 而 `charging-ebike:2024-02` 从左切会把 kind 切成 `charging-ebike` 之外的东西。
 * period 恒在末段,scope 恒在中段(有就两段,没有就一段)。
 */
public record ReviewKey(ReviewKind kind, String scope, String period) {

    public static ReviewKey parse(String raw) {
        if (raw == null || raw.isBlank()) throw new BizException(ResultCode.BAD_REQUEST, "审核键为空");
        int last = raw.lastIndexOf(':');
        if (last < 0) throw new BizException(ResultCode.BAD_REQUEST, "审核键格式错误:" + raw);
        String period = raw.substring(last + 1);
        String head = raw.substring(0, last);
        int mid = head.lastIndexOf(':');
        String kindCode = mid < 0 ? head : head.substring(0, mid);
        String scope    = mid < 0 ? null : head.substring(mid + 1);
        return of(ReviewKind.of(kindCode), scope, period);
    }

    /** 构造 + 全部校验。任何拼键的地方都走它,不要自己拼字符串。 */
    public static ReviewKey of(ReviewKind kind, String scope, String period) {
        if (!ReviewKind.PERIOD.matcher(period == null ? "" : period).matches())
            throw new BizException(ResultCode.BAD_REQUEST, "账期必须是 YYYY-MM(01-12):" + period);
        switch (kind.scopeShape()) {
            case NONE -> {
                if (scope != null) throw new BizException(ResultCode.BAD_REQUEST,
                    kind.label() + " 是园区级表,不该带 scope:" + scope);
            }
            case COMPANY -> requireDigits(kind, scope);
            case PHASE -> {
                requireDigits(kind, scope);
                int n = Integer.parseInt(scope);
                if (n < 1 || n > 4) throw new BizException(ResultCode.BAD_REQUEST, "附表10 只有 1..4 期区:" + scope);
            }
            case FIXED -> {
                if (!ReviewKind.FIXED_SCOPES.contains(scope))
                    throw new BizException(ResultCode.BAD_REQUEST,
                        kind.label() + " 的 scope 只能是 office / phase3:" + scope);
            }
        }
        return new ReviewKey(kind, scope, period);
    }

    private static void requireDigits(ReviewKind kind, String scope) {
        if (scope == null || scope.isEmpty() || !scope.chars().allMatch(Character::isDigit))
            throw new BizException(ResultCode.BAD_REQUEST, kind.label() + " 必须带数字 scope:" + scope);
    }

    /** 落库主键与对外键串。 */
    public String raw() {
        return scope == null ? kind.code() + ":" + period
                             : kind.code() + ":" + scope + ":" + period;
    }

    /** 错误文案用:「2024-02 A 公司月度台账」里的中间那段由调用方补,这里只出「2024-02 月度台账」。 */
    public String human() { return period + " " + kind.label(); }
}
```

- [ ] **Step 5: 跑，确认全绿**

```bash
cd backend && ./mvnw test -Dtest=ReviewKeyTest
```

- [ ] **Step 6: 破坏验证（逐条）**

| 改坏什么 | 必须红 |
|---|---|
| `parse` 改成从**左**边切（`indexOf` 代替 `lastIndexOf`） | `parse_roundTrips` 的 `charging-ebike` / `alloc-loss` 两条 |
| `PERIOD` 换成 `^\d{4}-\d{2}$` | `parse_rejects_badPeriod` 的 `2024-13` / `2024-00` |
| `ScopeShape.NONE` 那个分支删掉 | `salary:office:2024-02` 那条 |
| `PARAMS` 的 perms 只留 `PARAM_POLICY_EDIT` | `params_takesEitherParamPerm` |
| `ELEC_MODEL` 的 `monthClose` 改成 `true` | 最后那条 `containsExactly("elec-model")` |

- [ ] **Step 7: 提交**

```bash
git add backend/src/main/java/com/park/demo3/security/ReviewKind.java backend/src/main/java/com/park/demo3/security/ReviewKey.java backend/src/test/java/com/park/demo3/security/ReviewKeyTest.java
git commit -m "feat(review): R1 T3 ReviewKind 白名单 + ReviewKey 解析 —— kind→perm 是新写的一张表不是复用 §5.2;附表11 拆 elec-cost/elec-model 两把键"
```

---

### Task 4: `ReviewGuard` + `@NoReviewGuard`

**Files:**
- Create: `backend/src/main/java/com/park/demo3/security/ReviewGuard.java`
- Create: `backend/src/main/java/com/park/demo3/security/NoReviewGuard.java`
- Test: `backend/src/test/java/com/park/demo3/api/ReviewGuardIT.java`

**Interfaces:**
- Consumes: `ReviewKey` / `ReviewKind`（Task 3）、`ReviewStateMapper`（Task 1）、`ResultCode.LOCKED`（Task 2）。
- Produces:
  - `ReviewGuard.assertEditable(ReviewKind kind, String period, String scope)` —— 单月闸，被写月处于 `submitted`/`approved` 就抛 `BizException(LOCKED, …)`
  - `ReviewGuard.assertEditable(ReviewKind kind, java.util.Collection<String> periods, String scope)` —— 批量闸（导入/整年清空用），任一月被锁即抛，文案点名**最早**那个月
  - `ReviewGuard.assertNoLockedMonth(ReviewKind kind, String scope)` —— 跨月闸（裁定 R-2 的 `rechain`、R-4 的参数默认行用），该 kind+scope 下存在任一 `submitted`/`approved` 月就抛
  - `@NoReviewGuard(String reason())` —— 方法级白名单注解，`RUNTIME` 保留（覆盖率测试要读到）

- [ ] **Step 1: 写失败的测试**

`backend/src/test/java/com/park/demo3/api/ReviewGuardIT.java`（`extends AbstractMysqlIT` + 类上 `@Transactional`，直接 `@Autowired ReviewGuard` 与 `ReviewStateMapper`，不走 HTTP）：

```java
    private void seed(String key, String kind, String period, String scope, String status) {
        ReviewState s = new ReviewState();
        s.setReviewKey(key); s.setKind(kind); s.setPeriod(period); s.setScope(scope); s.setStatus(status);
        states.insert(s);
    }

    @Test
    void enteredMonth_passes_submittedAndApproved_throw423() {
        assertThatCode(() -> guard.assertEditable(ReviewKind.SALARY, "2024-02", null)).doesNotThrowAnyException();

        seed("salary:2024-02", "salary", "2024-02", null, "submitted");
        assertThatThrownBy(() -> guard.assertEditable(ReviewKind.SALARY, "2024-02", null))
            .isInstanceOf(BizException.class)
            .hasFieldOrPropertyWithValue("code", 423)
            .hasMessageContaining("2024-02").hasMessageContaining("附表12");
    }

    @Test
    void returned_isEditableAgain() {
        seed("salary:2024-03", "salary", "2024-03", null, "returned");
        assertThatCode(() -> guard.assertEditable(ReviewKind.SALARY, "2024-03", null)).doesNotThrowAnyException();
    }

    @Test
    void scopeIsPartOfTheKey_otherCompanyUnaffected() {
        seed("ledger:7:2024-02", "ledger", "2024-02", "7", "approved");
        assertThatThrownBy(() -> guard.assertEditable(ReviewKind.LEDGER, "2024-02", "7"))
            .isInstanceOf(BizException.class);
        assertThatCode(() -> guard.assertEditable(ReviewKind.LEDGER, "2024-02", "8")).doesNotThrowAnyException();
    }

    @Test
    void batch_namesTheEarliestLockedMonth() {
        seed("pv:2024-05", "pv", "2024-05", null, "approved");
        seed("pv:2024-09", "pv", "2024-09", null, "approved");
        assertThatThrownBy(() -> guard.assertEditable(ReviewKind.PV,
                java.util.List.of("2024-09", "2024-03", "2024-05"), null))
            .isInstanceOf(BizException.class)
            .hasMessageContaining("2024-05")           // 最早那个
            .as("批量文案要点名最早的锁月,不是集合里碰巧第一个");
    }

    @Test
    void crossMonth_anyLockedMonthBlocks() {
        seed("ledger:9:2024-01", "ledger", "2024-01", "9", "approved");
        assertThatThrownBy(() -> guard.assertNoLockedMonth(ReviewKind.LEDGER, "9"))
            .isInstanceOf(BizException.class).hasMessageContaining("2024-01");
        assertThatCode(() -> guard.assertNoLockedMonth(ReviewKind.LEDGER, "10")).doesNotThrowAnyException();
    }

    @Test
    void badPeriod_isRejectedByTheGuardItself() {
        // 前面 8 个 service 一个 requireYm 都没有,MeterService 那份正则还放行 2024-13。
        // 守卫是最后一道闸,不能信调用方洗过。
        assertThatThrownBy(() -> guard.assertEditable(ReviewKind.SALARY, "2024-13", null))
            .isInstanceOf(BizException.class).hasFieldOrPropertyWithValue("code", 400);
    }
```

- [ ] **Step 2: 跑，确认它红**

```bash
cd backend && ./mvnw test -Dtest=ReviewGuardIT
```

- [ ] **Step 3: 写 `NoReviewGuard.java`**

```java
package com.park.demo3.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 「这个写方法**故意**不挂审核守卫」的白名单(spec §7.4)。
 *
 * 为什么白名单是产品代码里的注解而不是测试里的常量数组:照抄 PermissionCoverageTest 复用
 * SecurityPaths.PERMIT_ALL 的理由 —— 豁免必须是**显眼、可 review、跟着代码走**的动作。
 * 写在测试里的名单,改代码的人看不见,漏挂和豁免长得一模一样。
 *
 * reason 必填且不许空串,ReviewGuardCoverageTest 会断言这一点。
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface NoReviewGuard {
    String reason();
}
```

⚠ 这是**全仓第一个自定义注解**（`backend/src` 全树 `@interface` 原本零命中）。不要顺手再造第二个。

- [ ] **Step 4: 写 `ReviewGuard.java`**

形状照 `BookService.assertMonthEditable`（`assertXxx` 动词开头 / 只判一次 / 不满足抛 `BizException` / **不返回布尔** / 文案把期次拼进去），组件形状照 `PermissionGuard`（`@Component` + 构造注入 mapper）：

```java
package com.park.demo3.security;

import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.entity.ReviewState;
import com.park.demo3.mapper.ReviewStateMapper;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;

/**
 * 审核态的写路径闸(spec §7.4)。**已审核 / 待审核的表,任何写入口一律拒。**
 *
 * 为什么落在 service 层而不是 PermissionRegistry:提权是在 WriteAccessManager.check() 里
 * 放行的,权限表拦不住它。spec §7.3「主管接管锁、当场提权都过不去」只有在 service 层才成立。
 *
 * 三个入口对应三种写形状(不要给第四种):
 *  · assertEditable(kind, period, scope)        —— 单月写。绝大多数方法用它。
 *  · assertEditable(kind, periods, scope)       —— 一批跨多月(导入 / 整年清空)。
 *  · assertNoLockedMonth(kind, scope)           —— 拿不到月的跨月写(rechain / 参数默认行)。
 */
@Component
public class ReviewGuard {

    /** 落库三态里这两个锁写;returned 只是留痕,可编辑性等同「录入中」(spec §7.2)。 */
    private static final Set<String> LOCKING = Set.of("submitted", "approved");

    private final ReviewStateMapper states;

    public ReviewGuard(ReviewStateMapper states) { this.states = states; }

    public void assertEditable(ReviewKind kind, String period, String scope) {
        ReviewKey key = ReviewKey.of(kind, scope, period);   // 顺手把 period/scope 校验了
        ReviewState s = states.selectById(key.raw());
        if (s != null && LOCKING.contains(s.getStatus())) throw locked(key, s);
    }

    /** 一批写落在多个月上时,**每个月都要判**;文案点名最早的锁月,让用户先去处理它。 */
    public void assertEditable(ReviewKind kind, Collection<String> periods, String scope) {
        for (String p : new TreeSet<>(periods)) assertEditable(kind, p, scope);
    }

    /**
     * 拿不到被写月时的兜底闸:该 kind(+scope)下存在任一被锁月就整体拒。
     *
     * ponytail: 比「只拒被影响的那些月」粗。用在 LedgerService.rechain(顺链改写该公司全部月的
     *   balance_prev)与计费参数默认行(影响所有未被月度行覆盖的月)上 —— 这两处都拿不到
     *   「被写月」这个概念,而放它过去等于给已审月开后门。代价:该公司一旦有一个月审过,
     *   rechain 就永久不可用。升级路径:等 rechain 改成按月增量重算后换成批量闸。
     */
    public void assertNoLockedMonth(ReviewKind kind, String scope) {
        Optional<ReviewState> first = states.byKindAndScope(kind.code(), scope).stream()
            .filter(s -> LOCKING.contains(s.getStatus())).findFirst();   // byKindAndScope 已按 period 升序
        first.ifPresent(s -> { throw locked(ReviewKey.of(kind, scope, s.getPeriod()), s); });
    }

    private BizException locked(ReviewKey key, ReviewState s) {
        boolean approved = "approved".equals(s.getStatus());
        String who = approved ? s.getReviewedBy() : s.getSubmittedBy();
        String when = approved
            ? (s.getReviewedAt() == null ? "" : s.getReviewedAt().toLocalDate().toString())
            : (s.getSubmittedAt() == null ? "" : s.getSubmittedAt().toLocalDate().toString());
        String state = approved ? "已审核" : "待审核";
        String tail = approved ? ",撤销审核后才能修改" : ",审核员处理后才能修改";
        return new BizException(ResultCode.LOCKED,
            key.human() + " " + state
            + (who == null || who.isBlank() ? "" : "(" + who + (when.isEmpty() ? "" : " " + when) + ")")
            + tail);
    }
}
```

⚠ `assertEditable(kind, periods, scope)` 用 `TreeSet` 排序 —— 字典序对 `YYYY-MM` 就是时间序，靠它保证「点名最早那个月」。别改成 `HashSet`。

- [ ] **Step 5: 跑，全绿**

- [ ] **Step 6: 破坏验证（逐条）**

| 改坏什么 | 必须红 |
|---|---|
| `LOCKING` 去掉 `"submitted"`（只锁 approved） | `enteredMonth_passes_submittedAndApproved_throw423` |
| `LOCKING` 加上 `"returned"` | `returned_isEditableAgain` |
| `assertEditable(单月)` 里不传 scope 给 `ReviewKey.of` | `scopeIsPartOfTheKey_otherCompanyUnaffected` |
| 批量闸的 `TreeSet` 换成 `ArrayList`（不排序） | `batch_namesTheEarliestLockedMonth` |
| `byKindAndScope` 去掉 `orderByAsc("period")` | `crossMonth_anyLockedMonthBlocks` 的月份断言 |
| `ReviewKey.of` 从 `assertEditable` 里删掉（直接拼串） | `badPeriod_isRejectedByTheGuardItself` |

- [ ] **Step 7: 提交**

```bash
git add backend/src/main/java/com/park/demo3/security/ReviewGuard.java backend/src/main/java/com/park/demo3/security/NoReviewGuard.java backend/src/test/java/com/park/demo3/api/ReviewGuardIT.java
git commit -m "feat(review): R1 T4 ReviewGuard 三个闸 + @NoReviewGuard 白名单注解 —— 守卫落 service 层,提权绕不过"
```

---

### Task 5: `ReviewService` + 五个端点 + `PermissionRegistry` 登记

**Files:**
- Create: `backend/src/main/java/com/park/demo3/dto/ReviewDtos.java`
- Create: `backend/src/main/java/com/park/demo3/service/ReviewService.java`
- Create: `backend/src/main/java/com/park/demo3/controller/ReviewController.java`
- Modify: `backend/src/main/java/com/park/demo3/security/PermissionRegistry.java`

**Interfaces:**
- Consumes: `ReviewKey` / `ReviewKind`（T3）、`ReviewStateMapper` / `ReviewLogMapper`（T1）、`DataHomeService.overview(String ym)`（既有）、`Perm.REVIEW_APPROVE`（T2）。
- Produces:
  - `ReviewDtos.ReviewRowDTO(String key, String kind, String scope, String status, String submittedBy, LocalDateTime submittedAt, String reviewedBy, LocalDateTime reviewedAt, String reason, List<String> blockedBy)`
  - `ReviewDtos.ReasonReq(@NotBlank @Size(max = 255) String reason)`
  - `ReviewService.list(String period) -> List<ReviewRowDTO>`（含派生 `"entered"` 行与前置缺项）
  - `ReviewService.submit(String rawKey)` / `approve(String rawKey)` / `returnBack(String rawKey, String reason)` / `withdraw(String rawKey, String reason)`
  - `ReviewService.pendingCount() -> int`（`review_state` 里 `status='submitted'` 的行数，给 T12 的 ping 用）
- 后续任务依赖：`ReviewApiIT`（T10）打这五个端点；`AuditQueryMapper` 第 4 路（T11）读 `review_log`；`PresenceService`（T12）调 `ReviewService.pendingCount()`。

- [ ] **Step 1: 写 DTO**

`backend/src/main/java/com/park/demo3/dto/ReviewDtos.java`，照 `SystemDtos` 的容器形状（`final class` + 私有构造器 + 内部 record）：

```java
package com.park.demo3.dto;

import jakarta.validation.constraints.*;
import java.time.LocalDateTime;
import java.util.List;

/** 审核机制(spec §7.4)的全部出入参。 */
public final class ReviewDtos {
    private ReviewDtos() {}

    /**
     * 一把键的当前态。status 取值 entered(派生,库里没行) / submitted / approved / returned。
     * blockedBy:通过前置未满足时列出缺的上游键人话名;满足或不适用时为空 list(不是 null)。
     */
    public record ReviewRowDTO(String key, String kind, String scope, String status,
                               String submittedBy, LocalDateTime submittedAt,
                               String reviewedBy, LocalDateTime reviewedAt,
                               String reason, List<String> blockedBy) {}

    /** 退回 / 撤销的理由,必填(spec §7.4:空则 400)。 */
    public record ReasonReq(@NotBlank(message = "必须写明理由") @Size(max = 255) String reason) {}
}
```

- [ ] **Step 2: 写 `ReviewService`**

关键设计（照抄这几条，别自由发挥）：

1. **`list(period)` 枚举当月全部键**：出账 5 个（`ReviewKind` 的前五个）+ 台账每公司一个 + 附10 每期区一个 + 其余 7 个 + `elec-model`。公司全集与期区全集**从 `DataHomeService.overview(period)` 拿**（`items` 里 `go=="ledger"` 的 `companies` 与 `go=="sales-income"` 的 `phases`），不另查一遍 `management_company` —— §12「六项计数与审核键集合必须与屏内 / 后端同源」。
2. **`status` 派生**：`review_state` 里有行就用行的 status，没行就是 `"entered"`。
3. **`blockedBy`**：只对 `ALLOC`（需 `PARAMS` + `METERS` 已 approved）与 `BILL_NOTICES`（需 `ALLOC` + `ALLOC_LOSS` 已 approved）非空。
4. **交审前置（裁定 R-5）**：`submit` 时调 `DataHomeService.overview(period)`，按下表取该键的 done：

| kind | done 从哪来 |
|---|---|
| `params` / `meters` / `alloc` / `alloc-loss` / `bill-notices` | `chain.steps` 里 `key` 等于 kind code 那一步的 `status == "done"`（step key 就是这五个串，`DataHomeService.buildChain` 里写死的） |
| `ledger`（scope=companyId） | `items` 里 `go=="ledger"` 那项的 `companies` 中 `id == scope` 的 `done` |
| `s10`（scope=phase） | `items` 里 `go=="sales-income"` 那项的 `phases` 中 `no == scope` 的 `done` |
| `salary` | `go=="salary"` 那项的 `done` |
| `utilities`（scope=office / phase3） | `go=="utilities"` 的**两项**里 `tag` 为 `附13`（office）/ `附14`（phase3）那一项的 `done` |
| `pv` / `charging-car` / `charging-ebike` / `elec-cost` | `go` 分别为 `pv-income` / `car-charging` / `ebike-charging` / `elec-cost` 那项的 `done` |
| `elec-model` | **不走 overview**：该月 `elec_cost_entry` 有行即 done（它没有清单行，见计划开头的拆键说明） |

   注意 `utilities` 两项 `go` 相同，只能按 `tag` 分。这是 `DataHomeService.scheduleSources` 的既有形状。

   方法上加注释：

```java
    // ponytail: 交审前置调一遍首页聚合(overview 一次约十几条 count 查询),换「done 判据与屏上同源」。
    //   不另写一份判据 —— METRIC-SOURCE-SPEC §1:同一件事不许有第二份实现,首页和交审报的数
    //   一旦差一份,用户不知道该信谁。交审是低频动作(一个月十几次),这个代价可接受。
    //   升级路径:等 DataHomeService 拆出单键 done 查询后换过去。
```

5. **状态迁移的合法性**：`submit` 只能从 `entered` / `returned` 出发；`approve` / `returnBack` 只能从 `submitted` 出发；`withdraw` 只能从 `approved` 出发。非法转移抛 `BizException(CONFLICT, …)`。
6. **撤销前置（D19，补全依赖图）**：`withdraw` 时检查下游。依赖图**必须包含 `alloc-loss` 的上游**（spec §7.2 只写了通过前置，漏了这条边）：

```java
    /**
     * 上游 → 下游。撤销上游前,下游不许还挂着 approved。
     *
     * ⚠ 比 spec §7.2 多两条边:meters → alloc-loss 与 params → alloc-loss。
     * 理由:楼栋损耗与公共电核算是 AllocService.generate(ym) 同一次算出来的,同样吃 meters 的
     * 读数与 params 的电价。只照 spec 字面连 alloc 的话,「meters 已审 → alloc-loss 已审 →
     * 撤 meters」这条路会放行,抄表员改完读数,已审核的损耗结果就和读数对不上了。
     */
    private static final Map<ReviewKind, List<ReviewKind>> DOWNSTREAM = Map.of(
        ReviewKind.PARAMS,     List.of(ReviewKind.ALLOC, ReviewKind.ALLOC_LOSS),
        ReviewKind.METERS,     List.of(ReviewKind.ALLOC, ReviewKind.ALLOC_LOSS),
        ReviewKind.ALLOC,      List.of(ReviewKind.BILL_NOTICES),
        ReviewKind.ALLOC_LOSS, List.of(ReviewKind.BILL_NOTICES));
```

7. **每一步落 `review_log`**：`action` ∈ `submit / approve / return / withdraw`，`actor` 用与 `LockService` 同款的 `private static String me()`（`SecurityContextHolder` 三行，照抄），`at` 显式 `LocalDateTime.now()`。
8. **权限**：`approve` / `returnBack` / `withdraw` 三个方法开头再查一次 `review:approve`（`UserPermissionCache.get(me()).perms().contains(Perm.REVIEW_APPROVE)`，不满足抛 `BizException(FORBIDDEN, …)`）。URL 层已经挡了一道，这是第二道 —— 与 `LockService.requireSomeEditPerm` 同款的「service 自守」写法。
9. **`submit` 的权限**：按 `kind.perms()` 判「满足其一即可」。这就是 kind→perm 表的唯一消费点。
10. `pendingCount()`：`review_state` 里 `status='submitted'` 的行数，给 T12 的 ping 用。

- [ ] **Step 3: 写 `ReviewController`**

照 `SystemController` 的形状（`@RestController` + `@RequestMapping("/api/review")` + 返回裸 DTO，信封由全局包）：

```java
    @GetMapping                                  List<ReviewRowDTO> list(@RequestParam String period)
    @PostMapping("/{key}/submit")                void submit(@PathVariable String key)
    @PostMapping("/{key}/approve")               void approve(@PathVariable String key)
    @PostMapping("/{key}/return")                void returnBack(@PathVariable String key, @Valid @RequestBody ReasonReq req)
    @PostMapping("/{key}/withdraw")              void withdraw(@PathVariable String key, @Valid @RequestBody ReasonReq req)
```

⚠ 审核键里有冒号（`ledger:7:2024-02`）。冒号在 URL path segment 里是合法字符，但**必须确认 Spring 的 `PathPattern` 不会把它当分隔符**，且前端将来发链时不会被编码成 `%3A` 后解不回来。Step 5 的测试里第一条就打 `ledger:7:2024-02` 这个带两个冒号的键，红了就改成 `@RequestParam String key`（**不要**改键的格式，键格式是 spec §7.1 定的）。

- [ ] **Step 4: 登记 `PermissionRegistry`**

在构造器里加一段，**位置在「账册模板写端点」那一段之后**（与它同为「方法级分权」形状）：

```java
        // ═══ 审核(spec §7.3):交审看 kind,通过/退回/撤销一律 review:approve ═══
        // submit 要的权限点得看 key 里的 kind(params 是 policy|monthly 两档、其余多为 entry),
        // URL 层判不出来 —— 照 PUT /api/params 那条既有例外:URL 层放行「任一 edit 权」,
        // 真正的 kind→perm 判定下沉到 ReviewService.submit。
        add(HttpMethod.POST, "/api/review/*/submit",
            Perm.PARAM_POLICY_EDIT, Perm.PARAM_MONTHLY_EDIT, Perm.METER_READING_EDIT,
            Perm.BILLING_RUN_EDIT, Perm.ENTRY_EDIT);
        add(HttpMethod.POST, "/api/review/*/approve",  Perm.REVIEW_APPROVE);
        add(HttpMethod.POST, "/api/review/*/return",   Perm.REVIEW_APPROVE);
        add(HttpMethod.POST, "/api/review/*/withdraw", Perm.REVIEW_APPROVE);
```

`GET /api/review` **不用登记** —— `PermissionRegistry` 只管非 GET，读全开。

- [ ] **Step 5: 端到端断言留给 T10**，本任务只跑编译与 `PermissionCoverageTest`：

```bash
cd backend && ./mvnw test -Dtest=PermissionCoverageTest+ReviewKeyTest+ReviewGuardIT
```

`PermissionCoverageTest` 会扫到四个新写端点；漏登记任一条它当场红，这就是本任务的门。

- [ ] **Step 6: 提交**

```bash
git add backend/src/main/java/com/park/demo3/dto/ReviewDtos.java backend/src/main/java/com/park/demo3/service/ReviewService.java backend/src/main/java/com/park/demo3/controller/ReviewController.java backend/src/main/java/com/park/demo3/security/PermissionRegistry.java
git commit -m "feat(review): R1 T5 ReviewService + 五端点 —— 键集合与 done 判据同源 overview;撤销依赖图补 alloc-loss 两条上游边"
```

---

### Task 6: 出账链五键挂点（Param / Meter / Alloc / BillNotice）

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/service/ParamService.java`
- Modify: `backend/src/main/java/com/park/demo3/service/MeterService.java`
- Modify: `backend/src/main/java/com/park/demo3/service/AllocService.java`
- Modify: `backend/src/main/java/com/park/demo3/service/BillNoticeService.java`
- Test: `backend/src/test/java/com/park/demo3/api/ReviewGuardIT.java`（追加一组）

**Interfaces:**
- Consumes: `ReviewGuard`（T4）。四个 service 各加一个 `private final ReviewGuard reviewGuard;` 字段 + 构造参数（追加在参数表末尾，别插中间 —— 会改动所有 `new XxxService(...)` 的测试）。
- Produces: 无新签名。唯一的结构性改动是 `MeterService.deleteReading`（见下）。

- [ ] **Step 1: `ParamService`（kind = `params`；`recalc` 兼 `alloc` / `alloc-loss` / `bill-notices`）**

| 方法 | 被写月从哪来 | 挂什么 |
|---|---|---|
| `write(ParamPutReq req, String ym)` | **`req.acctMonth()`，不是形参 `ym`**（`ym` 是「站在哪个月看」= URL 月，spec §7.4 明说不按 URL 判）。`mode='from'` 时该行前滚生效到下一版本 | `acctMonth` 非空：对 `[acctMonth, VersionResolver.nextFrom(rows, acctMonth))` 区间内每个月调 `assertEditable(PARAMS, 月, null)`（用批量重载）。`acctMonth` 为空串（长期默认行）：调 `assertNoLockedMonth(PARAMS, null)` —— 裁定 R-4 |
| `copyElec(String fromYm, String toYm)` | `toYm` | `assertEditable(PARAMS, toYm, null)`。**不守 `fromYm`** —— 从已审月复制出来是读，读不受限 |
| `recalc(String ym)` | `ym` | 不用自己挂：内部调 `alloc.generate(ym)` 与 `billNotice.generate(ym)`，两处各自有守卫。但要加 `@NoReviewGuard(reason = "转调 AllocService.generate 与 BillNoticeService.generate,两处各自守;这里再守一次会把错误文案说成计费参数")` |
| `logRuleChange` / `logUnitAreaChange` | 不写计费数据，只落 `param_change_log` | `@NoReviewGuard(reason = "只写 param_change_log 审计流水,不碰期间数据")` |

⚠ `PUT /api/price-cfg` 也走 `ParamService.write`，且 `ym` 硬传 `null`（`PriceCfgController`）—— 这正是「守 `req.acctMonth()` 不守形参 `ym`」在这条路径上唯一正确的理由。

- [ ] **Step 2: `MeterService`（kind = `meters`）**

| 方法 | 被写月 | 挂什么 |
|---|---|---|
| `createReading(MeterReadingReq req)` | `req.ym()` | 单月闸 |
| `updateReading(Integer id, MeterReadingReq req)` | **两个月**：旧月 `readings.selectById(id).getYm()` 与新月 `req.ym()`（方法注释原话「PUT:改月份/读数/备注」，改月是支持的） | 批量闸传 `List.of(旧月, 新月)`。**漏判旧月 = 可以把已审月的读数「挪」进未审月改完再挪回去** |
| `deleteReading(Integer id)` | 实体的 `ym` | ⚠ 现在只判存在性就删，**必须改结构**：先 `MeterReading r = readings.selectById(id);`，`null` 就 `NOT_FOUND`，然后守 `r.getYm()` |
| `batchDelete(String ym, …, boolean apply)` | `ym` | 守卫**只在 `apply == true` 时调** —— `apply=false` 是预览，预览不该被拒 |
| `importRows(MeterImportRequest req)` | **每行自带 `ym`，一批可跨月** | 在写库之前取 `req.rows()` 的 `ym` 去重集合，批量闸一次 |
| 表档案 `create/update/delete` | 不带期间（perm 是 `meter-master`） | `@NoReviewGuard(reason = "表档案不带期间;倍率改动只影响之后新录的读数,不改已审月的行")` |

- [ ] **Step 3: `AllocService`（kind = `alloc` + `alloc-loss`）**

| 方法 | 被写月 | 挂什么 |
|---|---|---|
| `generate(String ym)` | `ym` | **两把键都守**：`assertEditable(ALLOC, ym, null)` 与 `assertEditable(ALLOC_LOSS, ym, null)`。池结果与损耗结果是同一次算出来的，只守一把等于给另一把开后门 |
| `saveManual(AllocManualReq req)` | `req.ym()` | `ALLOC` 单月闸 |
| `deleteResult(Integer id)` | 实体 `getYm()`（`selectById` 已在方法体里） | `ALLOC` 单月闸 |
| `createRule` / `updateRule(id, req)` | `req.memberMonth()`；**为 null/空串时写的是长期默认行** | 非空：`ALLOC` 单月闸。空：`assertNoLockedMonth(ALLOC, null)`（同 R-4 的理由） |
| `saveCfg(AllocCfgReq req)` | 转调 `params.write(..., null)` | `@NoReviewGuard(reason = "转调 ParamService.write,被写月由那边按 req.acctMonth 判")` |
| `deleteRule(Integer id)` | 有分摊结果时已经 409 | `@NoReviewGuard(reason = "有结果的池删不掉(既有 409),能删的池从没生成过任何期间数据")` |

- [ ] **Step 4: `BillNoticeService`（kind = `bill-notices`）**

| 方法 | 被写月 | 挂什么 |
|---|---|---|
| `generate(String ym)` | `ym` | 单月闸 |
| `saveNote(BillNoteReq req)` | `req.ym()` | 单月闸（全类唯一漏 `requireYm` 的方法，守卫自己会校验格式） |
| `deleteNote(String ym, …)` | `ym` | 单月闸 |
| `confirm(String ym, …)` / `markExported(String ym, …)` | `ym` | 单月闸。⚠ 这两个是既有的 `draft→confirmed→exported` 业务轴（V94），spec §7.1 明说**两条轴并存都保留** —— 它们照样要守（已审核后不许再改交付态），别误判成「审核的一部分」 |
| `issue(Integer id)` / `voidNotice(Integer id)` | 委派 `transition(id, …)`，实体有 `ym`（`selectById` 已在 `transition` 里） | 守在 `transition` 一处即可；两个 public 各加 `@NoReviewGuard(reason = "转调 transition(id,action),守卫在那里按实体的 ym 判")` |

- [ ] **Step 5: 追加断言（每个 service 至少一条真实路径）**

在 `ReviewGuardIT` 里追加一组 HTTP 级用例（改用 `@AutoConfigureMockMvc` + token，取法照 `LockApiIT` 的 helper）：审掉 `2024-02` 的对应键，然后打该 service 的一个真实写端点，断言 `jsonPath("$.code").value(423)`。至少覆盖：

1. `params:2024-02` 审掉 → `PUT /api/params`（body 的 `acctMonth` 写 `2024-02`）→ 423。
2. `params:2024-02` 审掉 → `PUT /api/params`（body 的 `acctMonth` 写 `2024-03`）→ **不是 423**（证明守的是 `req.acctMonth` 不是别的）。
3. `meters:2024-02` 审掉 → `PUT /api/meters/readings/{id}`（把一条 `2024-03` 的读数改成 `ym=2024-02`）→ 423（证明**新月**被守）。
4. `meters:2024-02` 审掉 → `PUT /api/meters/readings/{id}`（把一条 `2024-02` 的读数改成 `ym=2024-03`）→ 423（证明**旧月**被守 —— 这条是「挪月绕过」的正面用例）。
5. `alloc-loss:2024-02` 审掉、`alloc:2024-02` 未审 → `POST /api/alloc/generate?ym=2024-02` → 423（证明 `generate` 守了两把键）。
6. `bill-notices:2024-02` 审掉 → `POST /api/bill-notices/confirm` → 423。

- [ ] **Step 6: 破坏验证（逐条）**

对上面 6 条，逐条把对应的守卫调用删掉、跑、看红、加回。另加两条反向：

- 把 `batchDelete` 的守卫从 `apply==true` 分支挪到方法开头 → 补一条「`apply=false` 预览仍应 200」的用例并确认它红。
- 把 `updateReading` 的批量闸改成只守新月 → 用例 4 必须红。

- [ ] **Step 7: 提交**

```bash
git add backend/src/main/java/com/park/demo3/service/ParamService.java backend/src/main/java/com/park/demo3/service/MeterService.java backend/src/main/java/com/park/demo3/service/AllocService.java backend/src/main/java/com/park/demo3/service/BillNoticeService.java backend/src/test/java/com/park/demo3/api/ReviewGuardIT.java
git commit -m "feat(review): R1 T6 出账链五键挂守卫 —— 参数守 req.acctMonth 不守 URL ym;改月的读数两个月都判;generate 一次守两把键"
```

---

### Task 7: 记账七键挂点（Ledger / S10 / Salary / Office / Pv / Charging）

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/service/LedgerService.java`
- Modify: `backend/src/main/java/com/park/demo3/service/S10Service.java`
- Modify: `backend/src/main/java/com/park/demo3/service/SalaryService.java`
- Modify: `backend/src/main/java/com/park/demo3/service/OfficeService.java`（= spec 里的 `UtilitiesService`）
- Modify: `backend/src/main/java/com/park/demo3/service/PvService.java`
- Modify: `backend/src/main/java/com/park/demo3/service/ChargingService.java`
- Test: `backend/src/test/java/com/park/demo3/api/ReviewGuardIT.java`（再追加一组）

**Interfaces:**
- Consumes: `ReviewGuard`（T4）。
- Produces: `S10Service.bindTenant` 由「一条 `UpdateWrapper` 打穿」改成「先 select 命中行、再逐行 update」（裁定 R-3）—— 对外签名与返回 DTO 不变。

- [ ] **Step 1: `LedgerService`（kind = `ledger`，scope = `companyId` 字符串）**

scope 一律 `String.valueOf(companyId)`，period 一律 `String.format("%04d-%02d", year, month)`。**把这两句抽成本类一个 `private static String ym(int y, int m)` 助手**，别在六处各拼一遍。

| 方法 | 挂什么 |
|---|---|
| `save(companyId, year, month, req)` | 单月闸，放在 `if (company == null) throw …;` **之后** |
| `importRows(companyId, year, month, req)` | 同上 |
| `copyFromPrev(companyId, year, month)` | 只守写目标 `(year, month)`；**不守上月**（读不受限） |
| `bindRow(rowId, tenantId, addAlias)`（三参版） | 守在三参版，`MonthlyLedger l = ledger.selectById(rowId);` 之后，用 `l` 的公司与年月。单参重载加 `@NoReviewGuard(reason = "转调三参重载,守卫在那里")` |
| `renameRow(rowId, tenantName)` | 同 `bindRow`，用实体的公司与年月 |
| `bindTenant(TenantBindReq req)` | **裁定 R-2b**：`for (MonthlyLedger l : unbound)` 循环里、`occupied.contains(slot)` 那个 `continue` **之后**、`ledger.updateById(l)` **之前**调单月闸。被锁就抛（不并进 `conflicts`） |
| `rechain(Integer companyId)` | **裁定 R-2**：循环里 `ledger.updateById(l)` **那一行之前**调单月闸（用该行的年月）。只有真的要改这一行时才判 —— `else` 分支那个「仅 scale 差:内存对齐不落库」不写库，不判 |

⚠ `rechain` 的错误文案必须能自解释，例如：

```java
    // 触发者可能在改 2024-01,而被拒的原因是 2024-03 已审核 —— 文案不说清楚,用户会以为
    // 系统坏了。ReviewGuard 的文案只知道被锁月,所以这里在守卫外面再包一句上下文。
```

具体做法：`rechain` 里 catch 住 `BizException` 并用 `new BizException(ResultCode.LOCKED, e.getMessage() + "。结余链会顺着改到那个月,请先撤销它的审核")` 重抛。

- [ ] **Step 2: `S10Service`（kind = `s10`，scope = `phase` 的字符串 `"1".."4"`）**

`save` / `importRows` / `clearImported` 从形参或 `req` 取月与期区，直接单月闸。`bindRow` / `renameRow` / `updateNote` / `delete` 从 `selectById` 的实体取。

**`bindTenant(req)` 是本期唯一必须改实现结构的地方（裁定 R-3）**：

- 现状：一条 `UpdateWrapper` 打穿全期区全月份，拿不到任何月。
- 改成：先 `List<S10Record> hit = s10.selectList(new QueryWrapper<S10Record>()...)` 捞出命中行，再 `for` 循环里逐行守 + `updateById`。形状照 `LedgerService.bindTenant`（同一个动作在两个 service 的两种写法，本来就该收敛）。
- 对外返回的计数口径不变：改完要断言「绑定条数与改前一致」，用例见 Step 5。

- [ ] **Step 3: `SalaryService`（`salary`）/ `PvService`（`pv`）/ `ChargingService`（`charging-car` + `charging-ebike`）/ `OfficeService`（`utilities:office` + `utilities:phase3`）**

这四个是同构的：`create`（`req` 带 `acctMonth`）、`updateNote` / `delete`（`selectById` 取实体的 `acctMonth`）、`importRows`（逐行带月，一批可跨月）、`clearImported(int year)`（整年一条 SQL）。

- `importRows`：这四个 service **在写库之前已经算出了月份集合** —— `PvService` 的 `monthsByPhase`、`OfficeService` 的 `Set<String> months`、`ChargingService` 的 `tuples`。守卫就塞进这个现成集合的循环里，**别自己再遍历一遍 rows**。
- `clearImported(int year)`：只有年，没有月。挂法：取该年 12 个月组成集合，批量闸一次（`assertEditable(kind, List.of("YYYY-01"…"YYYY-12"), scope)`）。理由写在注释里：整年清空会碰到该年任何一个已审月。
- **`ChargingService` 的 kind 由 `scheduleNo` 决定**：7 → `CHARGING_CAR`，8 → `CHARGING_EBIKE`。抽一个 `private static ReviewKind kindOf(int scheduleNo)`，别在每个方法里写 `if`。
- **`OfficeService` 的 scope 由 `scheduleNo` 决定**：13 → `"office"`，14 → `"phase3"`。同样抽一个助手。这两条映射在 spec §7.1 的备注列里（「附13 / 附14」）。

- [ ] **Step 4: 覆盖率兜底**

这一批里凡是「public 方法转调私有/重载方法、守卫落在被调方」的，public 那个必须加 `@NoReviewGuard(reason = "转调 XXX,守卫在那里按实体的 acctMonth 判")`。已知四处：`LedgerService.bindRow` 单参版、`BillNoticeService.issue/voidNotice`（T6 已处理）、`ElecCostService` 的三个 public → 私有 `writeEntry`（T8 处理）、`AllocService.saveCfg`（T6 已处理）。

- [ ] **Step 5: 追加断言**

至少 7 条（每键一条）：

1. `ledger:7:2024-02` 审掉 → `PUT /api/ledger/7/2024/2` → 423；同时 `PUT /api/ledger/8/2024/2`（另一家公司）→ 200。
2. `ledger:7:2024-01` 审掉，且 2024-01 与 2024-02 相邻有据 → `PUT /api/ledger/7/2024/2`（会触发 rechain 改 2024-01？**不会** —— rechain 改的是后一个月的期初）→ 反过来构造：审掉 `ledger:7:2024-03`，改 2024-02 使 2024-03 的期初需要变 → 423 且文案含 `2024-03`。
3. `s10:2:2024-02` 审掉 → `POST /api/s10/tenant-bind`（命中该期区该月的行）→ 423；且**改造前后绑定条数一致**（用一条不涉及已审月的绑定跑一遍，断言 `bound` 数与改造前相同）。
4. `salary:2024-02` 审掉 → `POST /api/salary/import`（一批里含 2024-02 与 2024-03 两行）→ 423，且**整批不落库**（断言 2024-03 那行也没进去 —— `@Transactional` 回滚）。
5. `utilities:office:2024-02` 审掉 → 附13 的写端点 423；附14 的同月写端点 200（证明 scope 分得开）。
6. `pv:2024-02` 审掉 → `POST /api/pv/clear-imported?year=2024` → 423。
7. `charging-ebike:2024-02` 审掉 → 附8 写端点 423；附7 同月 200（证明是两个 kind 不是两个 scope）。

- [ ] **Step 6: 破坏验证（逐条）**

七条逐条删守卫看红。另加两条：

- `OfficeService` 的 scope 助手把 13/14 映射对调 → 用例 5 必须红。
- `ChargingService` 的 kind 助手把 7/8 对调 → 用例 7 必须红。

- [ ] **Step 7: 提交**

```bash
git add backend/src/main/java/com/park/demo3/service/LedgerService.java backend/src/main/java/com/park/demo3/service/S10Service.java backend/src/main/java/com/park/demo3/service/SalaryService.java backend/src/main/java/com/park/demo3/service/OfficeService.java backend/src/main/java/com/park/demo3/service/PvService.java backend/src/main/java/com/park/demo3/service/ChargingService.java backend/src/test/java/com/park/demo3/api/ReviewGuardIT.java
git commit -m "feat(review): R1 T7 记账七键挂守卫 —— S10.bindTenant 改成先 select 再逐行守;rechain 守在真正要改的那一行并解释被拒原因"
```

---

### Task 8: 电费两键 + 第二本账白名单

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/service/ElecService.java`（kind = `elec-cost`，附表11 报送台账）
- Modify: `backend/src/main/java/com/park/demo3/service/ElecCostService.java`（kind = `elec-model`，园区电费模型）
- Modify: `backend/src/main/java/com/park/demo3/service/PvMeterService.java`（白名单）
- Modify: `backend/src/main/java/com/park/demo3/service/CpMeterService.java`（白名单）
- Modify: `backend/src/main/java/com/park/demo3/service/BookService.java`（白名单）
- Test: `backend/src/test/java/com/park/demo3/api/ReviewGuardIT.java`（再追加一组）

**Interfaces:** 无新签名。

- [ ] **Step 1: `ElecService` → `elec-cost`**

六个方法：`create`（`req` 带 `acctMonth`）、`updateNote` / `delete`（实体取月）、`importRows`（逐行带月，用现成月份集合）、`clearImported(int year)`（整年 12 个月批量闸）、`batchDelete(ids)`（**先把 ids 对应的行 select 出来，取 distinct 月集合**，再批量闸）。

⚠ 这就是「§7.4 点名 `ElecCostService`、但清单上那行的数据在 `ElecService`」这处点反了的修正。清单行 `go='elec-cost'` 的 done 判据读的是 `ElecRecordMapper`（`DataHomeService`），所以 `elec-cost` 这把键必须守 `ElecService`。

- [ ] **Step 2: `ElecCostService` → `elec-model`**

五个方法：`upsertEntry`（`req` 带 `acctMonth`）、`deleteEntry(id)`（⚠ 现在只判存在性，**必须改结构**先取实体再守）、`savePriceCfg`（`acctMonth`；空串 = 长期默认行 → `assertNoLockedMonth(ELEC_MODEL, null)`，同 R-4）、`simulate(int year)`（整年 12 个月批量闸）、`importRows`（逐行带月）。

三个 public 若共用私有 `writeEntry`，守卫落在 `writeEntry` 一处，三个 public 各加 `@NoReviewGuard(reason = "转调 writeEntry,守卫在那里按 acctMonth 判")`。

- [ ] **Step 3: 三处白名单（裁定 R-6）**

`PvMeterService`（5 个写方法）、`CpMeterService`（6 个）、`BookService`（`saveTemplate` / `pinVersion`）逐个加：

```java
    @NoReviewGuard(reason = "光伏分栋抄表是附表6 的下游派生第二本账,不回写 pv_record;spec §7.1 无键,本轮不进审核")
```

```java
    @NoReviewGuard(reason = "充电桩分桩抄表是附表7/8 的下游派生第二本账,不回写 charging_record;spec §7.1 无键,本轮不进审核")
```

```java
    @NoReviewGuard(reason = "账册模板已有同型守卫 assertMonthEditable(P6 录入即冻结);模板不是期间数据,spec §7.1 无键")
```

**理由必须写实**（覆盖率测试会断言 `reason` 非空，但写得对不对靠 review）。三条理由的事实依据：`PvService`（附表6）只注入 `PvPhaseMapper` + `PvRecordMapper`，全类不碰 `pv_reading`；`CpMeterService` 类注释原话「与附表7/8(ChargingService) 完全独立,零共享零改动」；依赖方向是**附表 → 抄表**，不是反过来。

- [ ] **Step 4: 追加断言**

1. `elec-cost:2024-02` 审掉 → `POST /api/elec/records`（`acctMonth=2024-02`）→ 423。
2. **同月** `POST /api/elec-cost/entries`（电费模型）→ **200** —— 证明两把键真的拆开了。
3. 反过来：`elec-model:2024-02` 审掉 → 电费模型写端点 423，`POST /api/elec/records` 200。
4. `elec-model:2024-02` 审掉 → `POST /api/elec-cost/simulate?year=2024` → 423。
5. `PvMeterService` 的写端点在 `pv:2024-02` 审掉后仍 200（白名单生效的正面用例 —— 白名单如果哪天被误删，这条会红并提醒人「这是故意的还是漏的」）。

- [ ] **Step 5: 破坏验证**

- 把 `elec-cost` 挂到 `ElecCostService`（照 spec 字面）→ 用例 1 与 2 同时红。这条最值得做一遍，它就是那处规范笔误的证据。
- 删掉 `PvMeterService` 的 `@NoReviewGuard` → `ReviewGuardCoverageTest`（T9）红。本步先记下，T9 落地后回来验。

- [ ] **Step 6: 提交**

```bash
git add backend/src/main/java/com/park/demo3/service/ElecService.java backend/src/main/java/com/park/demo3/service/ElecCostService.java backend/src/main/java/com/park/demo3/service/PvMeterService.java backend/src/main/java/com/park/demo3/service/CpMeterService.java backend/src/main/java/com/park/demo3/service/BookService.java backend/src/test/java/com/park/demo3/api/ReviewGuardIT.java
git commit -m "feat(review): R1 T8 附表11 拆两把键 —— elec-cost 守 ElecService(报送台账)、elec-model 守 ElecCostService(电费模型);三处第二本账进白名单"
```

---

### Task 9: `ReviewGuardCoverageTest`（从源码推导，不写手工清单）

**Files:**
- Create: `backend/src/test/java/com/park/demo3/security/ReviewGuardCoverageTest.java`

**Interfaces:**
- Consumes: T6/T7/T8 挂完的守卫与 `@NoReviewGuard` 标注。
- Produces: 一道 CI 门 —— 新加写端点忘挂守卫时当场红。

这是 R1 的**验收判据**（spec §9 R1 行：「删掉某 service 的守卫调用 → 覆盖率测试红」）。模板是既有的 `backend/src/test/java/com/park/demo3/security/PermissionCoverageTest.java`，**先整份读一遍再动手**。

- [ ] **Step 1: 照抄模板的四条骨架**

从 `PermissionCoverageTest` 抄这四样，一样都不能少：

1. **不起 Spring 上下文**：`Paths.get("src/main/java/com/park/demo3/...")` + `Files.readString` 直接扫源码文本。
2. **防空扫的自证断言**：`PermissionCoverageTest` 那条是
   `assertThat(all).as("controller 扫描结果为空 —— 说明正则或路径失效了,这个测试等于没跑").hasSizeGreaterThan(150)`。
   本测试对应写成 `hasSizeGreaterThan(60)`（实测写方法 67 个；留一点余量，但**必须远大于 0**）。**没有这条，正则一坏就是永久假绿。**
3. **豁免名单来自产品代码**：读 `@NoReviewGuard` 这个注解在源码里的出现，不在测试里另写一份常量数组（理由同 `PermissionCoverageTest` 复用 `SecurityPaths.PERMIT_ALL`）。
4. **失败消息带修复指路**：照它那句「新加接口请去 PermissionRegistry 补一条规则,并对照 RBAC-SPEC §5.2」，本测试写「新加写方法请挂 ReviewGuard.assertEditable,或用 @NoReviewGuard(reason) 说明为什么不挂;对照 spec §7.4」。

- [ ] **Step 2: 推导链（四步，每步失败都要响，不许静默跳过）**

```
① 读 PermissionRegistry.java 源码 → 正则抓出全部 add(...) 的 URL pattern
② 扫 controller 目录 → @RequestMapping("/api/xxx") 与 ① 的 pattern 段匹配 → 命中的 controller 文件集合
③ 每个命中的 controller 里找非 GET 的 @PostMapping/@PutMapping/@PatchMapping/@DeleteMapping 方法
   → 方法体里 `xxxService.yyy(` 的调用 → (service 类名, 方法名)
④ 打开该 service 源码,定位那个方法 → 断言方法体含 `reviewGuard.assert` 或方法上有 @NoReviewGuard
```

⚠ 第 ③ / ④ 步解析不出来时（找不到 service 调用、找不到同名方法、方法有重载分不清），**必须 `fail()` 并打印是哪个 controller 的哪个方法**，不许 `continue`。「解析不了就跳过」是这类测试最常见的假绿来源 —— 一个正则失配就能悄悄放掉半张表。

- [ ] **Step 3: 五条回归断言（照 `PermissionCoverageTest` 末尾那一节的做法，每条都是查证过会踩的坑）**

```java
    @Test
    void everyNoReviewGuardHasNonBlankReason() { /* 空理由 = 悄悄开的洞 */ }

    @Test
    void guardIsCalledOnServiceLayer_notOnlyInControllers() {
        // 守卫写在 controller 里等于没写:提权在 WriteAccessManager 放行,
        // 而内部 service 互调(ParamService.recalc → AllocService.generate)根本不过 controller。
    }

    @Test
    void whitelistIsSmall() {
        // 白名单超过 25 条就该重新想想 —— 它是例外不是常态。数字随实际调,但必须有个上限。
    }

    @Test
    void everyReviewKindIsGuardedSomewhere() {
        // 14 个 kind,每个至少要在某个 service 源码里出现一次 ReviewKind.XXX。
        // 少一个 = 那把键能审但审了不锁,是最坏的一种假绿(屏上显示已审核,数据照改)。
    }

    @Test
    void scanFoundEnoughWriteMethods() { /* Step 1 的第 2 条,单独成一个用例更醒目 */ }
```

`everyReviewKindIsGuardedSomewhere` 是这一组里最值钱的一条 —— 它才是「审了就真锁得住」的门。

- [ ] **Step 4: 跑**

```bash
cd backend && ./mvnw test -Dtest=ReviewGuardCoverageTest
```

- [ ] **Step 5: 破坏验证（这一步就是 spec §9 给 R1 的验收动作，逐条做完再往下）**

| 改坏什么 | 必须红 |
|---|---|
| 删掉 `SalaryService.create` 里的守卫调用 | 主用例，且失败消息要点名 `SalaryService.create` |
| 删掉 `PvMeterService` 某个方法的 `@NoReviewGuard` | 主用例 |
| 把某条 `@NoReviewGuard` 的 `reason` 改成 `""` | `everyNoReviewGuardHasNonBlankReason` |
| 把 `ChargingService` 里 `ReviewKind.CHARGING_EBIKE` 全部换成 `CHARGING_CAR` | `everyReviewKindIsGuardedSomewhere` |
| 把第 ② 步的正则改成永不匹配 | `scanFoundEnoughWriteMethods` |
| 把第 ③ 步「解析不出就 `fail()`」改成 `continue` | 上一条之后仍绿 → **说明这条改动本身就是漏洞**，改回 |

- [ ] **Step 6: 提交**

```bash
git add backend/src/test/java/com/park/demo3/security/ReviewGuardCoverageTest.java
git commit -m "test(review): R1 T9 ReviewGuardCoverageTest —— 从 PermissionRegistry 推导写方法,漏挂守卫当场红;解析不出一律 fail 不 continue"
```

---

### Task 10: `ReviewApiIT` —— ~~独立任务~~ **已并入 T5 落地（见 E-1）**

> 本节保留作检查表:下面八组用例在 `ReviewApiIT` 里都要有。T5 实际落了 12 条(多出 kind→perm 收窄、键里两个冒号、list 枚举三条)。执行 T7/T8 时不必再回来做这一节。

**Files:**
- Create: `backend/src/test/java/com/park/demo3/api/ReviewApiIT.java`

**Interfaces:** Consumes T5 的五个端点、T1 的两张表、T2 的角色种子。

形状照 `LockApiIT`：`extends AbstractMysqlIT` + `@AutoConfigureMockMvc` + `POST /api/auth/login` 取 `$.data.token` + `try/finally` 建号清号。

- [ ] **Step 1: 八组用例**

1. **全链路**：`entered` → `submit` → `approved`（先 approve）→ 每一步 `GET /api/review?period=2024-02` 里那把键的 `status` 跟着变。
2. **退回**：`submitted` → `return`（带理由）→ `returned`，且 `returned` 状态下写端点**放行**（可编辑性等同录入中）。
3. **撤销**：`approved` → `withdraw`（带理由）→ 回 `entered`（库里删行或置 `returned`，按 T5 的实现断言，二选一定死）。
4. **理由必填**：`return` / `withdraw` 传 `{"reason":""}` → `$.code == 400`（`@NotBlank` 走 `MethodArgumentNotValidException` 分支）。
5. **通过前置 409**：`params` 未审 → `approve alloc:2024-02` → `$.code == 409`，且 message 含「计费参数」。
6. **撤销前置 409**：`alloc-loss:2024-02` 已 approved → `withdraw meters:2024-02` → `$.code == 409` 且 message 含「楼栋损耗」。**这条是 spec §7.2 依赖图漏掉的那条边**（见 T5 Step 2 第 6 点），它红说明补边没生效。
7. **已审核后写端点 423**：`salary:2024-02` approved → `POST /api/salary/records` → `$.code == 423`。
8. **`reviewer` 角色调写端点 403**：用 `reviewer` 账号打任一业务写端点 → HTTP 403（**真 403，不是 body.code** —— 那是 `SecurityConfig` 的 accessDeniedHandler 出的，与 `BizException` 两轨）。同一个账号打 `approve` → 200。

- [ ] **Step 2: `review_log` 逐条落**

每走一步查一次 `review_log`，断言 `action` / `actor` / `reason` 三列。四个动作跑完 = 4 行，且 `review_key` 都对得上。

- [ ] **Step 3: 非法状态迁移**

`entered` 直接 `approve` → 409；`approved` 再 `submit` → 409；`entered` `withdraw` → 409。

- [ ] **Step 4: 交审前置**

该月台账一行没有 → `submit ledger:7:2024-02` → 409，message 含「未做」。录一行再 submit → 200。这条钉住裁定 R-5（done 判据与首页同源）。

- [ ] **Step 5: 破坏验证**

逐条：把 `DOWNSTREAM` 里 `METERS → ALLOC_LOSS` 那条边删掉 → 用例 6 红；把 `submit` 的前置检查删掉 → 用例 Step 4 红；把 `return` 的 `@Valid` 去掉 → 用例 4 红；把 `approve` 的权限检查删掉 → 用例 8 后半红。

- [ ] **Step 6: 跑 + 提交**

```bash
cd backend && ./mvnw test -Dtest=ReviewApiIT
git add backend/src/test/java/com/park/demo3/api/ReviewApiIT.java
git commit -m "test(review): R1 T10 ReviewApiIT —— 四动作/两种前置 409/已审 423/reviewer 只能审不能录/review_log 逐条"
```

---

### Task 11: `review_log` 进操作日志（第 4 张来源表）

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/mapper/AuditQueryMapper.java`
- Modify: `backend/src/main/java/com/park/demo3/service/SystemService.java`
- Modify: `backend/src/main/java/com/park/demo3/controller/SystemController.java`
- Test: `backend/src/test/java/com/park/demo3/api/AuditLogApiIT.java`（追加）

**Interfaces:** 无新签名；`GET /api/system/logs?src=review` 变成合法取值。

- [ ] **Step 1: `AuditQueryMapper.BRANCHES` 加第 4 路**

锚点：`auth` 分支的 `</if>` 之后（文本块末尾）。照 `import` 分支的形状（它是**没有 authorizer 列**的那一款，写 `NULL AS authorizer`）：

```
        <if test="src == null">UNION ALL</if>
        <if test="src == null or src == 'review'">
          SELECT 'review' AS source, id AS rid, at AS ts, actor AS actor, action AS action,
                 review_key AS target, reason AS detail, NULL AS authorizer
          FROM review_log
          <where>
            <if test="actor != null and actor != ''">actor = #{actor}</if>
            <if test="from != null">AND at &gt;= #{from}</if>
            <if test="to != null">AND at &lt; #{to}</if>
          </where>
        </if>
```

⚠ 三条硬要求，全是该文件类注释里记着的坑：**每个分支写全列别名**（UNION 结果列名取自第一个 SELECT，只在 param 分支写别名的话 `src=review` 单独跑会「Unknown column」500）；`<script>` 里 `>` `<` 必须转义成 `&gt;` `&lt;`；ORDER BY 靠外层的 `u.ts DESC, u.source, u.rid DESC` 保持全序，不要在分支里自己排。

- [ ] **Step 2: `actors()` 加一行**

那段是独立的静态 SQL（不带 `<script>`，里面 `<>` 可以直接写）：追加 `UNION SELECT actor FROM review_log`。

- [ ] **Step 3: 白名单**

`SystemService.auditLogs()` 里 `List.of("param", "import", "auth")` → 加 `"review"`。**不加的话 `src=review` 直接 400**。

- [ ] **Step 4: `SystemController` 的 `@Operation summary` 文案**

`src=param|import|auth` → `src=param|import|auth|review`。纯文档，但漏了下一个人会以为不支持。

- [ ] **Step 5: 断言（追加到 `AuditLogApiIT`）**

1. 造一行 `review_log`（直接 jdbc 插，或跑一次 `submit`），`GET /api/system/logs`（不带 src）能查到它，`source == "review"`。
2. `GET /api/system/logs?src=review` 只返回 review 行，且 `target` 是审核键、`detail` 是理由。
3. `GET /api/system/logs?src=review&actor=<某人>` 能筛。
4. `actors` 下拉里含该操作人。
5. **分页全序**：同一秒插 3 行 review_log，`size=2` 翻两页，断言 3 行各出现恰好一次（这条防的是类注释里那个「ORDER BY 不是全序 → 同一行出现在两页」）。

- [ ] **Step 6: 破坏验证**

删掉第 4 路的 `NULL AS authorizer` → 用例 2 红（Unknown column）；把白名单那行改回三项 → 用例 2 红（400）；把 `at AS ts` 的别名去掉 → 用例 1 红。

- [ ] **Step 7: 提交**

```bash
git add backend/src/main/java/com/park/demo3/mapper/AuditQueryMapper.java backend/src/main/java/com/park/demo3/service/SystemService.java backend/src/main/java/com/park/demo3/controller/SystemController.java backend/src/test/java/com/park/demo3/api/AuditLogApiIT.java
git commit -m "feat(review): R1 T11 review_log 进操作日志第 4 路 —— 全列别名/白名单/actors 三处齐"
```

> **前端那 4 处（`SystemLogsView.vue` 的 SRC 色表、ACTION 字典、SRC_OPTS 下拉，以及 `types/system.ts` 的 `AuditSource` 联合类型）留给 R2。** 不改也不炸：`SRC` 有 `OTHER` 兜底，动作码查不到就原样显示英文。R2 开工时第一件事就是补它们 —— 记在 Task 13 的规范修订里。

---

### Task 12: 轮询通道发「待审核 N」（后端半边）

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/dto/PresenceDtos.java`
- Modify: `backend/src/main/java/com/park/demo3/service/PresenceService.java`
- Test: `backend/src/test/java/com/park/demo3/api/PresenceApiIT.java`（追加一条）

**Interfaces:**
- Produces: `PingResp` 多一个组件 `int pendingReviews`。

**R1/R2 边界画在这个字段上**：后端发它 = R1 完；前端读它、进 store、并进铃铛计数 = R2。

- [ ] **Step 1: `PingResp` 加字段**

锚点：`ApprovalDtos.OutcomeDTO outcome) {}` 这一行的 `outcome` **之后**追加 `, int pendingReviews`。同时把它 javadoc 里「**一条通道四件事**」那句连同下面四行清单一起改成**五件事**并补第五行 —— 注释是这份代码的契约文档，加字段不改它就是留假文档。

```java
     *  5. pendingReviews —— 我该审的键有几把(spec §7.4「交审 → 有 review:approve 的在线用户铃铛 +1」)。
     *     只发个数不发清单:ping 是 3 秒一拍(PING_MS = 3_000,后端 javadoc 那句「20 秒」是旧文案),
     *     发清单等于每 3 秒把全月审核态推一遍。要清单去 GET /api/review。
```

- [ ] **Step 2: `PresenceService.ping()` 填上**

全仓 `new PingResp(...)` **只有一处**（`PresenceService` 里那句）。取值：

```java
        // 没有 review:approve 的人恒 0 —— 不查库。受众判定复用 UserPermissionCache(ping 路径上
        // 唯一零 DB 的权限查询),照 ApprovalService.candidates 的做法。
        int pendingReviews = cache.get(me()) != null
            && cache.get(me()).perms().contains(Perm.REVIEW_APPROVE)
            ? reviewService.pendingCount() : 0;
```

⚠ `pendingCount()` 是一次 `selectCount`，但 ping 是 **3 秒一拍**。若压测显示这条 count 吃不消，改法是在 `ReviewService` 里加一个「写操作后失效」的内存计数，**不要**改 ping 频率。这条写进注释。

- [ ] **Step 3: 断言**

1. 持 `review:approve` 的账号 ping → `pendingReviews` 等于当前 `submitted` 行数。
2. 不持该权限的账号 ping → 恒 `0`（即使库里有 submitted 行）。
3. 交审一把键后再 ping → 数字 +1。

- [ ] **Step 4: 破坏验证**

去掉权限判断（人人都发真实数）→ 用例 2 红；把 `pendingCount` 改成数 `approved` → 用例 1 红。

- [ ] **Step 5: 提交**

```bash
git add backend/src/main/java/com/park/demo3/dto/PresenceDtos.java backend/src/main/java/com/park/demo3/service/PresenceService.java backend/src/test/java/com/park/demo3/api/PresenceApiIT.java
git commit -m "feat(review): R1 T12 ping 加 pendingReviews —— 复用轮询通道,无权限者恒 0;前端读它是 R2"
```

---

### Task 13: 规范同步修订

**Files:**（全部 Modify）
- `docs/superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md`
- `docs/design/RBAC-SPEC.md`
- `docs/design/BOOK-WORKBENCH-SPEC.md`
- `docs/design/EDIT-MODE-SPEC.md`
- `docs/design/CONCURRENCY-SPEC.md`
- `docs/design/ELEC-COST-SPEC.md`

spec §8.2 已经列了要改哪些；本任务只做**与 R1 实际落地不一致**的那些，剩下的（`RESPONSIVE-LAYOUT-SPEC` / `DESIGN-FIDELITY` / `PV-ANALYSIS-SPEC` / `LAYOUT-STABILITY-SPEC` 那几条）是 P4/P5 的，不动。

- [ ] **Step 1: 本期 spec §7 随裁定修订**

| 改哪 | 改什么 |
|---|---|
| §7.1 键表 | 附表11 那行拆成两行：`elec-cost:YYYY-MM`（报送台账 / `elec_record` / `ElecService`）与新增 `elec-model:YYYY-MM`（园区电费模型 / `elec_cost_entry` / `ElecCostService`）；备注写明 `elec-model` **无清单行**、交审前置改判「该月 `elec_cost_entry` 有行」、**不进整月锁账键集合** |
| §7.2 | 「键集合 = 出账 5 + 台账公司数 + 附10 期区数 + 其余 7 张」保持 **7**，加一句「`elec-model` 不计入」；撤销前置那条补上 `params → alloc-loss` 与 `meters → alloc-loss` 两条边并写明理由（池与损耗同一次 `generate` 算出） |
| §7.4 守卫行 | `UtilitiesService` → `OfficeService`；补 `ElecService`；`ElecCostService` 归到 `elec-model`；「423 LOCKED,body 统一信封」改成「`ResultCode.LOCKED(423)`,仍走 HTTP 200 + body.code=423（项目口径，见 `GlobalExceptionHandler` 头注释）」 |
| §7.4 覆盖率测试行 | 补一句推导链的四步与「解析不出一律 `fail()` 不 `continue`」 |
| §7.4 通知行 | 补字段名 `PingResp.pendingReviews`，写明只发个数不发清单及理由 |
| §12 已知边界 | 补四条：R-2 `rechain` 的上限与升级路径；R-4 参数默认行整表锁；R-5 交审前置跑一遍 overview 的代价；第二本账（光伏/充电桩分栋抄表）本轮不进审核 |

- [ ] **Step 2: `RBAC-SPEC.md`**

- §2 权限点表补第 18 行 `review:approve`（并把标题里那个过期的「（14 个）」一并订正成 18）。
- §3 角色表补 `reviewer` 行。
- §5.2 映射表补四条审核端点。
- §7 操作日志来源表补第 4 行 `review_log`。
- 新增一小节：**kind → perm 表**（就是 `ReviewKind` 里那张），并写明「它不是 §5.2 的复用，§5.2 是 path→perm 且对 params / elec-cost 不是函数」——避免下一个人照 spec §7.3 的原话去找一张不存在的表。

- [ ] **Step 3: `BOOK-WORKBENCH-SPEC.md` §7 补第 8 条**

「已审核 / 待审核的表，任何写入口一律拒」——spec §8.2 已经点名要补这条。

- [ ] **Step 4: `EDIT-MODE-SPEC.md`**

补「编辑模式三道闸：权限 → 审核态 → 锁」。**标注前端那道闸是 R2**，R1 只有后端守卫；这一节现在写的是最终形态，加一行「R1 已落后端守卫；前端闸见 R2」。

- [ ] **Step 5: `CONCURRENCY-SPEC.md`**

补一段「审核态与编辑锁正交」：审核态不占锁、不发在场点；已审核屏没人能进编辑，在场点自然消失。

- [ ] **Step 6: `ELEC-COST-SPEC.md`**

在头部那句「现有附表11（ElecView 月度电费进项）保持原样不动」之后补一句：两本账现在各有一把审核键（`elec-cost` / `elec-model`），并指向本 spec §7.1。这条最容易漏 —— 拆键的事实只写在审核 spec 里的话，下次动电费模型的人不会去读它。

- [ ] **Step 7: 提交**

```bash
git add docs/
git commit -m "docs(spec): R1 规范随裁定 —— §7.1 附表11 拆两把键,§7.2 撤销依赖图补 alloc-loss 两条上游边,§7.4 三处服务名订正与 423 口径,RBAC-SPEC 补第 18 权限点/reviewer/kind→perm 表/日志第 4 源"
```

---

## 整期收尾

- [ ] **全量门禁**

```bash
cd backend && ./mvnw -B verify
```

```bash
cd frontend && npm run typecheck && npm run test
```

前端本期一行没改，两条都必须与开工前的基线**一模一样**（测试文件数与用例数记在 P2 的计划里：198 files / 2415 tests）。数字变了说明误伤，回去查。

- [ ] **整期对抗复查**（memory 的节奏：单人 opus 评审，评审自己动手做破坏验证，不跑计划复查工作流）

复查这四条最容易假绿的：

1. `ReviewGuardCoverageTest` 的推导链有没有「解析不出就跳过」的分支。
2. 每一处 `@NoReviewGuard` 的 `reason` 是不是真话（尤其三处第二本账 —— 依赖方向是附表 → 抄表，不是反过来）。
3. `ReviewGuardIT` 里那些「另一家公司 / 另一个 scope / 另一个 kind 仍 200」的**反向**用例是不是真的在跑（正向用例好写，反向用例漏了就等于 scope 维度形同虚设）。
4. `rechain` 那条：构造一个「改 2024-02 导致 2024-03 期初要变」的真实数据，确认 423 且文案点名 2024-03。这条是全期最难写对的用例。

- [ ] **合并**（照 P2/P3 的做法）

master 没在任何 worktree 检出，用临时 worktree `--no-ff` 合，合完 `git diff master <分支>` 为空再删临时 worktree。

---

## Self-Review

**1. spec 覆盖**

| spec 章节 | 落在哪个 Task |
|---|---|
| §7.1 审核键表（含拆键） | T3（`ReviewKind`）、T8（两把电费键）、T13（规范补行） |
| §7.2 状态机 / 通过前置 / 撤销前置 / 交审前置 | T5 |
| §7.2 整月锁账派生 | T3 的 `countsTowardMonthClose()` + T5 的 `list()`。**注意：R1 只提供键集合与状态，「整月锁账」这一行的渲染是 R2 的事** |
| §7.3 权限与角色 | T2（第 18 点）、T1（`reviewer` 种子）、T5（service 层二次校验） |
| §7.4 迁移 | T1 |
| §7.4 端点 | T5 |
| §7.4 守卫 | T4（本体）、T6/T7/T8（挂点） |
| §7.4 覆盖率测试 | T9 |
| §7.4 集成测试 | T10 |
| §7.4 日志 | T11 |
| §7.4 通知 | T12（后端半边） |
| §7.5 前端全部 | **不做，R2** |
| §8.2 规范修订 | T13 |

**2. 已知缺口（明说，不装作覆盖了）**

- `GET /api/review` 返回的 `blockedBy` 只对 `alloc` / `bill-notices` 非空。其余键没有前置，这是 spec §7.2「依赖图只在出账链五键内」的直接结果，不是漏。
- 「整月锁账」在 R1 没有任何端点或字段 —— 它是 R2 在前端对 `list()` 的结果做一次 `every()`。若 R2 发现需要后端派生，那是 R2 的改动，不是 R1 的欠债。
- 前端 4 处日志展示（T11 末尾那段）明确留给 R2。

**3. 类型一致性**

`ReviewKind.code()` 的取值（`params` / `meters` / `alloc` / `alloc-loss` / `bill-notices` / `ledger` / `s10` / `salary` / `utilities` / `pv` / `charging-car` / `charging-ebike` / `elec-cost` / `elec-model`）在 T3 定义、T5 的 done 映射表、T6–T8 的挂点、T9 的 `everyReviewKindIsGuardedSomewhere`、T13 的 spec 表里保持同一套串。`review_state.status` 的四个值（派生 `entered` + 落库 `submitted` / `approved` / `returned`）在 T1 的 DDL 注释、T4 的 `LOCKING` 集合、T5 的迁移校验、T10 的断言里保持一致。`ReviewGuard` 的三个重载签名在 T4 定义，T6–T8 只调不加。
