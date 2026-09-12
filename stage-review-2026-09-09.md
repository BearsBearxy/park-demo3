# demo3 阶段性验收报告

> 2026-09-09。审查基线 `master` @ `6196c39`（PR #30 合并后）。只读审查，未修改任何项目代码。
> 距上一轮（[stage-review-2026-08-30.md](stage-review-2026-08-30.md)，基线 `5a29c06`）**213 个提交、340 个文件、+45957/−1511 行**。
> 环境：后端 `localhost:8481`（spring-boot:run）、前端 `localhost:5173`（vite dev）、
> MySQL `demo3-mysql` 容器（`park_demo3`，80 张表）。
> 已核实运行中的前后端与本基线**同一棵树**：跑 dev server 的 worktree 在 `fecbea4`，
> `git rev-parse fecbea4^{tree}` 与 `HEAD^{tree}` 同为 `6325834…`，工作区干净。

---

## 结论

**能否支撑后续功能开发：能。没有阻塞项。**

理由：上一轮点名的两条 Critical（编辑锁死按钮 / 被接管静默丢草稿）**都修了，而且留了回归门禁**
（[lockDialogsCoverage.spec.ts](frontend/src/views/__tests__/lockDialogsCoverage.spec.ts)，7 屏 × 2 条断言，
且先剥注释再断言）。这一轮新增的审核机制是全项目最大的一次结构性改动，
后端 966 条测试全绿、门禁把分母换成了**全部 157 个写端点**，UI 走查也把交审→撤回的完整写路径跑通了。

**本轮没有 Critical。** 但有一条会持续咬人、建议先修：

| 建议先修 | 一句话 |
|---|---|
| **前端全量测试不是稳定绿** | 本次全量 2665 条里红 1 条（`pvMeterAnaScreen.spec.ts` 撞 5000ms 默认超时），单跑该文件 53/53 绿。同文件另有 5 条跑在 3993–7703ms，全部贴着默认线。CI 的 `npm run test` 会因此随机红。 |

---

## 功能清单与验证状态

阶段 0 盘点（全部自己数过，不引用上一轮的数）：
**50 个屏**（`nav/fpNav.ts` 的 `FP_NAV` 四层共 50 项：数据 18 / 报表 10 / 分析 19 / 系统 3，
与 `router/index.ts` 的 `VIEWS` 表 50 个键一一对应）、
**40 个 controller / 270 个端点**（GET 113 / POST 72 / DELETE 42 / PUT 33 / PATCH 10，
其中**非 GET = 157**）、**120 个迁移文件**（最新 `V124__…`）、
前端 **185 个 .vue / 211 个 spec 文件**。

> 顺带坐实一件事：`ReviewGuardCoverageTest` 的头注释说分母是「实测 157 条」。
> 我从 `@(Post|Put|Patch|Delete)Mapping` 独立数了一遍，**也是 157**。这个数不是抄的，是对的。

| 功能/页面 | 验证状态 | 证据 | 风险 |
|---|---|---|---|
| 后端全量测试 | ✅通过 | `./mvnw -B verify` → **966 tests / 0 failures / 0 errors / 0 skipped**，5 分 32 秒。判据取自产物：`target/surefire-reports/` 117 个 XML 的 tests/failures/errors 求和，不是控制台尾巴。其中 80 个 `*IT` 类跑真 MySQL（Testcontainers） | — |
| 前端构建与类型闸 | ✅通过 | `npm run build` exit 0：`vue-tsc --noEmit` + token-check + vite build + precompress + size-check 全过 | 体积余量见下 |
| 前端全量测试 | ⚠️部分通过 | **2664 passed / 1 failed（2665）**，判据取自 `--reporter=json` 产物 | 见风险 1 |
| 未登录访问后端 | ✅通过 | `curl /api/probe/ping` → **401** | — |
| 登录页渲染 | ✅通过 | 冷开 `localhost:5173` 渲染完整登录页，无 console 错误 | — |
| **查** · 租户列表 | ✅通过 | 386 户 / 在租 385 / 月租金 ¥307万 / 21 户将到期；分期 一期129 二期83 三期13 宿舍62；前端分页 39 页 | — |
| **增** · 新建租户 | ✅通过 | UI 建 →「阶段审查临时租户ZZ」；库里 `tenant` 386→387，新行 `id=400`，中文正确落库 | — |
| **增** · 必填校验 | ✅通过 | 漏填业务类型点「创建」→ 屏上「请输入业务类型」+ 两个必填框描红，**没有发出请求** | — |
| **改** · 编辑租户 | ✅通过 | 改联系人「审查员」→「已改名张三」、备注写入；库里 `id=400` 两列都变了 | 见风险 3 |
| **删** · 删除租户 | ✅通过 | 确认框写明「不可撤销 / 有合同或台账将无法删除」→ 确认后库里 `tenant` 387→386，`id=400` 零行；列表与 KPI 同步回落 | — |
| **审核闸** · 已审月不给编辑 | ✅通过 | 园区抄表 2024-02（库里 `meters:2024-02 = approved`）屏上编辑按钮位换成药丸「已审核 · p5_reviewer 09-08」+「撤销审核」，`编辑模式` 按钮不存在 | — |
| **审核** · 交审 → 撤回 | ✅通过 | 计费参数 2024-02 点「交审」→ 二次确认写明后果 → 屏上变「待审核 · 已交审」且编辑按钮消失；库里生成 `params:2024-02 = submitted / admin`、`review_log` 第 6 行。再点「撤回」→ 状态行删除、屏回到「交审 + 编辑模式」，`review_log` 第 7 行留痕 | 见风险 5 |
| **交审前置** · 空月不给交 | ✅通过 | 2023-02（无数据月）首页 5 个交审键全部是禁用态「还没录完,做完才能交审」 | — |
| 移动端外壳（474px） | ✅通过 | 视口 474px 自动切 `MobileTopBar`/`MobileBottomNav`（`AppShell.vue:309` 的 S 档 600px 断点），`document.scrollWidth == clientWidth == 474`（**无横向溢出**）；抽屉导航 50 屏齐全；租户屏 KPI 转横滑、列表转卡片 | 上一轮未覆盖，本轮补上 |
| 桌面宽度走查（≥1280px） | ➖未执行 | 工具侧限制，见「用户流程走查」章末 | 非应用缺陷 |

---

## 后端

### 目录责任表

| 目录 | 文件数 | 职责 | 代表文件 | 判定 |
|---|---|---|---|---|
| `common/` | 8 | 返回信封、异常收口、链路追踪、慢请求埋点 | `Result.java`、`GlobalExceptionHandler.java` | 职责清晰 |
| `config/` | 5 | 启动期装配与种子 | `AdminInitializer.java`、`MyBatisPlusConfig.java` | 职责清晰 |
| `controller/` | 40 | HTTP 入口，只做绑定与转发 | `ReviewController.java` | 职责清晰，`QueryWrapper`/`@Select`/`jdbcTemplate` **零命中** |
| `dto/` | 181 | 请求/响应契约 | `ReviewDtos.java` | 数量大但单一职责 |
| `entity/` / `mapper/` | 62 / 63 | 表映射 / MyBatis 接口 | `ReviewStateMapper.java` | 一表一件，对得上 |
| `security/` | 16 | 认证、权限注册表、提权、在场、锁、**审核闸** | `ReviewGuard.java`、`ReviewKey.java`、`NoReviewGuard.java`、`PermissionRegistry.java` | 职责清晰（本轮 12→16，四个新件全属审核） |
| `service/` | 45 | 业务与算账 | `AllocService.java`（2438 行） | **一个巨型件，见下** |

**唯一职责不清处仍是 `service/AllocService.java`**，2438 行（上一轮 2412，十天涨 26 行），
仍是全后端最大文件与 `selectList(null)` 最密集处（28 次 / 全后端 114 次）。
结论与上一轮一致：**现在不拆**，它有 `AllocServiceTest` + `AllocApiIT` 兜着，
等下次动计算内核时顺手切 `AllocCalcEngine`。

### 接口统一性（附实例）

**结论：统一。** 全站一个信封，由 `ResponseWrapAdvice` 自动套，controller 只返回裸 DTO。

```java
// common/Result.java:3
public record Result<T>(int code, String message, T data, String traceId)
```

```java
// common/ResponseWrapAdvice.java:11,22-23
@RestControllerAdvice(basePackages = "com.park.demo3.controller")
if (body instanceof Result<?>) return body;
if (body instanceof String s) { … return objectMapper.writeValueAsString(Result.ok(s)); }
```

四类场景同一套写法，本轮取**新写的 `ReviewController`** 与旧的 `TenantController` 对照，
新代码没有另起炉灶：

```java
// controller/TenantController.java:16,28,20,22,26  —— 列表/详情/增/改/删
public List<TenantDTO>  list()                                       { return svc.list(); }
public TenantDetailDTO  detail(@PathVariable Integer id)             { return svc.detail(id); }
public TenantDTO        create(@Valid @RequestBody TenantCreateReq r) { return svc.create(r); }
public TenantDTO        update(@PathVariable Integer id, @Valid @RequestBody TenantUpdateReq r) { … }
public void             delete(@PathVariable Integer id)             { svc.delete(id); }

// controller/ReviewController.java:36,52,56  —— 十天前刚加的一批，逐行同形
public List<ReviewRowDTO> list(@RequestParam String period) { return svc.list(period); }
public void submit (@PathVariable String key) { svc.submit(key); }
public void approve(@PathVariable String key) { svc.approve(key); }
```

**没找到互相矛盾的两处实例。**

**一处刻意的不一致（已知、已文档化、本轮复核仍成立）**：HTTP 状态码与业务码分两轨——

| 失败类型 | HTTP | body.code | 证据 |
|---|---|---|---|
| 业务异常 `BizException`（含审核闸 423） | **200** | 400/403/409/423/429 | `GlobalExceptionHandler.java:24-28` `@ResponseStatus(HttpStatus.OK)` |
| Bean Validation 失败 | **400** | 400 | `GlobalExceptionHandler.java:31-36` |
| 未认证 / 无权限 | 401 / 403 | — / 403 | `SecurityConfig` |

口径写在 `GlobalExceptionHandler.java:15-19` 的头注释里，前端由 `api/index.ts` 响应拦截器统一解包吸收。
**保持现状**，新写 IT 时必须知道，否则断言写反。

**分页：后端仍然零分页，前端客户端分页。** `PageResult`/`IPage`/`selectPage` 全后端零命中。
实测租户屏「第 1 / 39 页 · 共 386 条」，接口一次返回全部 386 条。
当前数据量下是对的（最大表 `report_amount` 14072 行），但**分页契约仍然没立**——见风险 6。

### 封装边界盘点（四问表）

| 封装 | ①复用框架什么 | ②自定义什么 | ③解决什么真问题 | ④去掉会怎样 |
|---|---|---|---|---|
| `ResponseWrapAdvice` | Spring `ResponseBodyAdvice` | 信封自动套 + String 返回绕过 converter | 270 个端点不用各写 `Result.ok()` | 270 处样板，漏套即前端解包炸 → **留** |
| `GlobalExceptionHandler` | `@RestControllerAdvice` | 8 类异常 → 中文可读文案 | 异常不泄栈、文案统一 | 用户看到 500 裸栈 → **留** |
| **`security/ReviewGuard`（新）** | 无框架对应物 | 三个 `assertXxx` 入口：单月 / 一批月 / 拿不到被写月 | 提权与 service 互调绕过权限表，只有 service 层的闸拦得住（`ReviewGuard.java:16-19` 写明了这个理由） | 已审月的数据可以被静默改掉 → **留** |
| **`security/@NoReviewGuard`（新）** | 无 | 白名单注解，`reason` 必填 | 89 处豁免从「没人看过」变成「看过了，理由写在代码里」，且门禁从产品代码读这份名单而不是测试里另抄一份 | 覆盖率门禁失去可信分母 → **留** |
| `api/index.ts`（101 行） | axios 拦截器 | 跨标签页身份漂移守卫（:31-56） | 同机换账号后老标签页把操作记到别人头上 | 审计失真 → **留** |
| `security/PermissionRegistry` | Spring Security | URL→权限键注册表 | 改权限不用翻 40 个 controller | 权限散落 → **留** |
| `composables/useEditMode` + `useEditLock` + `presence` | Vue composable | 多屏多锁、逐把续期、代次守卫 | 同标签页两屏同时编辑时锁互顶 | 静默丢锁 → **留** |
| **`components/fp/FPLockDialogs.vue`（新）** | — | 接管抽屉 + 失锁弹窗打包成一件 | 上一轮 C1/C2 的病根是「每屏各接一遍，漏了没人发现」，现在一件管七屏 | 回到上一轮的两条 Critical → **留** |
| `common/SlowRequestFilter` | Servlet Filter | >500ms 请求埋点 | 配 `docs/OPS-SLOW-QUERY.md` 定位慢查询 | 少一个观测点 → 留 |

**过度设计检查：未发现。**
- 单实现 interface：**0 个**（`grep -rl "^public interface"` 排除 `mapper/` 后零命中）
- 只有一个取值的配置项：**0 个**。7 处 `@Value` 全部带 env 可覆盖默认值；
  `application-prod.yml` 刻意去掉全部危险默认（DB 口令、JWT 密钥、CORS 白名单、admin 口令缺一即 fail-fast），
  且 prod 关掉 swagger/api-docs
- 「为将来」预留的空架子：**0 个**。全库 `TODO`/`FIXME` 零命中（前后端都是）

---

## 代码质量

### 屎山信号

| 信号 | 结果 | 证据 |
|---|---|---|
| 重复代码 | **发现 1 处（结构性，未修且略有增长）** | 三个明细屏 `PvMeterView`/`CpMeterView`/`ElecCostView` 仍各自重复同一套失败态+编辑态样板，`readErr\|seq\|fp-stale\|FPLoadError\|editMode` 命中 **32/35/40**（上一轮 32/35/39）；对照走共享脚手架的 `SalaryView` 只有 15。`useSchedScreen` 本轮已被 6 个**外壳**屏用上（Pv/Charging/Elec/Salary/S10/Utilities），但这三个**内层**明细屏仍在外面 |
| 巨型文件 | **发现 5 个** | 后端 `AllocService.java` 2438、`BillNoticeService.java` 1330、`ContractService.java` 1102；前端 `PoolLedgerView.vue` 1573、`PvMeterAnaView.vue` 1516（本轮新进榜） |
| 巨型函数 | 未单独统计 | 同上一轮，只统计到文件级 |
| 死代码 | **未发现** | 前端「被注释掉的代码」正则命中仅 **2 处**；全库 `TODO`/`FIXME` 零命中 |
| 命名混乱 | **未发现** | 抽查前后端同概念同名 |
| 魔法值散落 | **轻微** | 期区字面量 `"p1"` 后端 4 个文件、`"dorm"` 7 个文件，与上一轮持平，已被 `ZoneService`/`ParamRegistry` 收编大部分 |
| 分层穿透 | **未发现** | `controller/` 目录 `QueryWrapper`/`@Select`/`jdbcTemplate` **零命中** |
| 内存泄漏（前端） | **未发现** | 5 个「有 addEventListener 无 removeEventListener」的文件逐个看过：3 个是 pinia store 单例（`auth.ts:61,204`、`presence.ts:316`、`ui.ts:28`，一个应用生命周期只装一次），2 个用了 `{ once: true }`（`LedgerWideTable.vue:151`、`S10Table.vue:52`）。`setInterval` 命中的文件**全部**有配对 `clearInterval` |

### 性能

| 项 | 结果 | 证据 |
|---|---|---|
| N+1 查询 | **未发现，反而是正解** | `AllocService` 多处是批量预载进 Map + 内存 join |
| 全表载入 | **114 处 `selectList(null)`** | `AllocService` 28、`BuildingService` 11、`BillNoticeService` 11…… |
| 当前风险量级 | **可接受** | 实测最大表 `report_amount` 14072 行，`bill_notice_line` 6976、`monthly_ledger` 3883；80 张表都是小表 |
| 索引 | **覆盖到新表** | `review_state` 主键 `review_key` + `idx_review_period(period)`；`review_log` 有 `idx_rl_key(review_key,at)` + `idx_rl_at(at)` |
| 铃铛轮询开销 | **便宜** | 前端 3 秒 ping 一次（`presence.ts:50` `PING_MS = 3_000`），带的 `pendingCount()` 是一条 `selectCount(status='submitted')`（`ReviewService.java:195-198`） |
| **闭月列表开销** | **随闭月数线性增长（当前无感，将来会咬）** | `ReviewService.closedMonths():168-189` 对每个「approved 键数 ≥ 12」的月份跑一次 `dataHome.overview(period)`；而 `overview()` 里包含 `contractService.list(null)` 全量合同 + 计费行（`DataHomeService.java:98-103` 注释自陈「多读一遍合同+计费行」）。今天库里只有 1 条 approved，这段一次都没跑过；等园区真的闭了 24 个月，每次开年份条就是 24 次首页聚合。见风险 4 |
| 无分页全量列表 | **全站如此** | 契约仍未立，见风险 6 |
| 大列表未虚拟化 | **未使用，但已分页兜住** | 租户 386 条切成 39 页每页 10 条 |
| 静态资源 | **已做且有闸，但余量快没了** | CI 有 heavy-lib 静态 import 门禁（拦 exceljs/echarts）；`size-check` 实测 **3938.7KB / 3950KB 预算**，只剩 **11.3KB（0.29%）**。见风险 2 |
| 慢查询观测 | **已建** | compose 配 `long_query_time=0.2`，配 `docs/OPS-SLOW-QUERY.md` |

---

## 前端审查

**总体评价：优秀。** `strict: true`、零 `v-html`、零硬编码密钥、零定时器泄漏、
`@ts-ignore`/`eslint-disable` 全站 2 处、`any`（排除 spec）32 处且集中在排序表泛型。
上一轮的两条 Critical **都修了并上了门禁**，这一轮**没有 Critical**。

### 上一轮 Critical 的复核（这是本轮最重要的一段）

| 上一轮 | 现在 | 证据 |
|---|---|---|
| **C1 死按钮**：别人占锁时「编辑模式」可点但无反应，无接管路径 | **已修** | 七屏（Pv/Cp/ElecCost/Meter/PoolLedger/BillNotices/ParamCenter）全部挂上 `FPLockDialogs`，如 `PvMeterView.vue:20,828`、`CpMeterView.vue:20,800`、`ElecCostView.vue:22,821` |
| **C2 静默踢出**：编辑中被接管，编辑态就地消失且无提示 | **已修** | 同上七屏的 `useEditMode` 解构现在都取了 `lockedBy / evictedBy / lockScope / onTaken`（`PvMeterView.vue:47-49`） |
| —— 且**不会回潮** | 新增门禁 | `views/__tests__/lockDialogsCoverage.spec.ts`：7 屏 × 2 条，断言挂件 + 四个绑定 + 四项解构；**先 `stripComments` 再断言**（注释掉整行也拦得住，这是上一轮做破坏验证时实测撞到的假绿） |

### Suggestion

| # | 问题 | 证据 | 与上一轮 |
|---|---|---|---|
| S1 | **抽屉默认月仍硬编码** | `PvRecordDrawer.vue:24` `const acctM = ref('1')`，`ChargingRecordDrawer.vue:30`、`ElecRecordDrawer.vue:29` 逐字相同；`initMonth` 零命中 | 未修（上一轮 S3） |
| S2 | **三个明细屏未并入共享脚手架** | 见「重复代码」行，命中 32/35/40 | 未修且 +1（上一轮 risk 3） |
| S3 | **响应式欠账既没补也没记账** | `FPMonthGate.vue`、`PvMeterView.vue`、`CpMeterView.vue`、`ElecCostView.vue` 的 `fp-fluid` 命中仍为 **0**；`RESPONSIVE-LAYOUT-SPEC.md` 里也仍无欠账记录。项目自定的规矩是「要么挂，要么记账」，现在两样都没有 | 未修（上一轮 S7） |
| S4 | **重屏测试贴着默认超时线** | `pvMeterAnaScreen.spec.ts` 单文件占全套 73.6 秒，6 条测试落在 3993–7703ms，`vite.config.ts:60-63` 的 `test` 段没有 `testTimeout` | 新增，见风险 1 |

### 上一轮 Suggestion 的复核

- **S1 深链落空 → 已修**：`PvView.vue:49`、`ChargingView.vue:64`、`ElecView.vue:49` 现在都读 `route.query.mode`，
  `CpMeterView.vue:114` 读 `route.query.station`；`views/__tests__/` 下有 8 个 `*DeepLink.spec.ts` 守着。
- **S2 门栈不进 URL → 不是欠账，是已裁定**：`stores/billingPeriod.ts:13` 明文写「只记会话内：不写 localStorage、
  不同步进 URL。刷新／重开浏览器过一次矩阵是**有意**的」。实测 `/params` 地址栏确无 query。
  **上一轮把它列成风险 5 是判错了**，本轮撤销该条。
- **S8 测试 flake → 修了一半**：`billNoticeExcel.spec.ts:258` 已单独 `timeout: 30_000`（本次全量跑 25542ms 通过，
  用掉自己上限的 85%）；但没有立成通则，新的重屏又踩了同一个坑（S4）。

---

## 用户流程走查

已登录（用户手动登入，我不被允许输入口令）。**视口 474×917 —— 触发 S 档移动端外壳**，
原因见本章末。所有写入都在库里对过账。

| 流程 | 操作路径 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| 冷启动进站 | → `localhost:5173` | 渲染登录页 | 完整登录页，console 零错误 | ✅ |
| 未带令牌调接口 | `curl /api/probe/ping` | 401 | **401** | ✅ |
| 落地页 | 登录后自动落点 | 按角色落地 | admin 落「本月出账」，顶部两枚待办药丸 + 「本月已审 1/16」 | ✅ |
| **查** · 首页出账链 | 首页 | 出真实数据 | 2024年2月 · 出账 5/6 · 附表 2/11；催缴单 295 张 ¥4107856.17（183 张有警告）；顶部「219 份合同无租金计费行」主动预警 | ✅ |
| **查** · 租户列表 | 抽屉导航 → 租户管理 | 列表 + KPI | 386 户 / 在租 385 / ¥307万 / 21 户将到期；分期页签四档；「第 1 / 39 页 · 共 386 条」 | ✅ |
| **增** · 新建租户（校验） | 新增租户 → 只填企业名与联系人 → 创建 | 拦下 | 「请输入业务类型」+ 必填框描红，**零请求发出** | ✅ |
| **增** · 新建租户（落库） | 补业务类型 → 创建 | 建成且列表刷新 | 库里 `tenant` 386→387，`id=400 / 阶段审查临时租户ZZ / 审查员 / 审查测试`；屏上共 387 户、在租 386；搜索能搜到 | ✅ |
| **改** · 编辑租户 | 点行 → 抽屉 → 编辑 → 改联系人+备注 → 保存 | 抽屉即时反映 + 落库 | 抽屉显示「已改名张三」与备注；库里 `id=400` 两列都变了 | ✅ |
| **删** · 删除租户 | 抽屉 → 删除 → 确认 | 二次确认 + 落库 | 确认框写明「不可撤销」与「有合同/台账将无法删除」；确认后库里 387→386，`id=400` 零行；列表回到「没有匹配的租户」，KPI 回落 385 | ✅ |
| **审核闸** · 已审月 | 抄表屏 → 2024-02 | 编辑入口应消失 | 头部是「撤销审核」+ 禁用药丸「已审核 · p5_reviewer 09-08」，`编辑模式` 按钮**不存在**（库里该键确为 `approved`） | ✅ |
| **审核** · 交审 | 计费参数 2024-02 → 交审 → 确认 | 落状态 + 锁屏 | 确认框写明「交出去之后这张表这个月就锁了」；确认后屏上出现「待审核 · 已交审」与 撤回/通过/退回，编辑按钮消失；库里新增 `params:2024-02 = submitted / admin`，`review_log` 第 6 行 | ✅ |
| **审核** · 撤回 | 同屏 → 撤回 | 回到录入中 | 屏回到「交审 + 编辑模式」；库里 `params:2024-02` 状态行删除，`review_log` 第 7 行留痕（**痕迹不可抹**，正确） | ✅ |
| **前置** · 空月不给交审 | 首页切 2023-02 | 交审键禁用 | 5 个交审键全是禁用态「还没录完,做完才能交审」 | ✅ |
| 移动端外壳 | 视口 474px | 切 S 档 | `MobileTopBar` + `MobileBottomNav`（数据/报表/分析/系统）；抽屉导航列全 50 屏；`scrollWidth == clientWidth == 474`，**无横向溢出**；租户屏 KPI 横滑、列表转卡片 | ✅ |

**走查结束后库已复原**：`tenant` 386 行、`review_state` 只剩原有的 `meters:2024-02`。
`review_log` 多出第 6、7 两行——那是审计痕迹，按设计**就该留下**，不是残留。

### 找不到 UI 入口的功能

**未发现。** 抽屉导航的 50 项与 `fpBuildRoutes()` 一一对应，`router/index.ts:78-81` 还有 DEV 护栏
对两侧差集都报警（少配 = 静默变占位页，多配 = 死代码）。

### 本轮走查的工具侧限制（不是应用缺陷）

上一轮因「Browser 面板隐藏」完全跑不了写路径。本轮面板显示出来了，写路径**全部跑通**，
但发现两条工具侧约束，记下来免得下次误判成应用 bug：

1. **开了视口模拟（`resize_window` 到 1440×900 / 1280×800）之后，合成点击不落地。**
   坐实过程：在 `document` 上挂捕获监听 → 模拟态下点「打开导航」，`elementFromPoint(28,26)` 确认按钮就在落点、
   无遮挡，但监听器一条事件都收不到。**关掉视口模拟后同一颗按钮立刻可点**，监听器收到
   `pointerdown/mousedown/click @28,26` 且 `isTrusted=true`。
   所以桌面宽度（≥1280px）的走查这一轮**没做**，本轮全部走查在面板原生的 474px 下完成。
2. **面板只在被要求截图时出一帧**，平时不跑 `requestAnimationFrame`。
   坐实：在页面里跑一段 500ms 的 rAF 计数，**45 秒超时都没返回**；抽屉因此卡在
   `mnav-backdrop mnav-enter-from mnav-enter-active`、`transform: translateX(-320px)` 不动，
   连着截几张图之后才一格格走到位（`x` 从 −320 → −83 → 12）。
   截图返回的也常是**上一帧**（删完租户后截到的还是那条已删记录的抽屉）。
   → 本报告的界面结论一律取自 DOM 读取与库里对账，**不取自截图**。

---

## 风险识别汇总

| # | 风险 | 证据 | 建议动作 |
|---|---|---|---|
| **1** | **前端全量测试不是稳定绿，CI 会随机红** | 本次全量 **2664 passed / 1 failed**：`pvMeterAnaScreen.spec.ts >「回看已经过去的月…」` 报 `Test timed out in 5000ms`（该条实测 7703ms）；**单跑该文件 53/53 全绿**（57.5 秒）。同文件另有 5 条落在 3993–7703ms，`vite.config.ts:60-63` 无 `testTimeout` | 给这个文件（或整个 `test` 段）单独放宽 timeout，口径照 `billNoticeExcel.spec.ts:258` 的 `{ timeout: 30_000 }`。**顺手立成通则**：单条 >3s 就得显式声明超时，否则下一个重屏还会踩 |
| **2** | **前端体积预算只剩 0.29%** | `npm run build` → `size-check: 合计 3938.7KB / 3950KB`，余 **11.3KB**；预算上一轮刚从 3900 上调到 3950（提交 `026431d`，有署名理由） | 下一个功能屏大概率再撞。**现在决定**：是继续上调（每次署名），还是把 `exceljs`(917KB)/`echarts`(698KB) 排除在预算之外单独计——它们已被 heavy-lib 门禁保证只走动态 import，混在总量里让预算失去指示意义 |
| **3** | **`updated_at` 走两个时钟，同一行能差 10 小时** | 实测 `tenant.id=400`：`created_at = 2026-09-09 16:43:40`（应用时钟），一分钟后 UI 改一次 → `updated_at = 2026-09-09 06:44:48`（**容器 UTC 时钟**）。根因两条：① `TenantService.update:86` 走 `tenants.update(null, new UpdateWrapper…)`，实体为 null，MyBatis-Plus 的 `updateFill`（`MyBatisPlusConfig.java:15`）**不触发**，只能落到 MySQL 的 `ON UPDATE CURRENT_TIMESTAMP`；② `docker-compose.yml` 的 mysql 服务**没设 TZ**。全站 5 个这种写法（`TenantService` 3 / `S10Service` 1 / `CompanyService` 1），库里 32 张表带 `ON UPDATE CURRENT_TIMESTAMP` 兜底 | 二选一，**都很便宜**：给 mysql 服务加 `TZ` / `--default-time-zone`（一行，且顺带修掉本机所有 DB 生成时间戳），或在这 5 个 `UpdateWrapper` 里显式 `.set("updated_at", LocalDateTime.now())`。前者更根治 |
| **4** | **闭月一多，年份条会变慢** | `ReviewService.closedMonths():168-189` 每个候选闭月跑一次 `dataHome.overview(period)`，而 `overview()` 含全量合同 + 计费行读取（`DataHomeService.java:98-103`）。今天只有 1 条 approved，这段一次没跑过——**没有实测数字，是读代码推的** | 现在不用改。**记一笔判据**：闭月数到 12 个时量一次 `GET /api/review/closed-months` 的耗时，超 300ms 就把「整月是否全审」落成一列，别每次现算 |
| **5** | **admin 可以自交自审** | `ReviewService.approve():284-298` 只判「状态是 submitted」与「上游已通过」，**没有 submitter ≠ reviewer 的判据**。职责分离是靠角色设计做的：`V124__…sql:47` 的 `reviewer` 角色「只审不录:只有 review:approve,零 :edit」，但 `:52-55` 把 `review:approve` **同时给了 admin**，而 admin 有全部 `:edit`。实测本次走查就是用 admin 一个人交的审（屏上同时出现 撤回/通过/退回 三颗键） | 确认这是不是有意的。若是，在 RBAC-SPEC 里写明「admin 不受职责分离约束」一句；若不是，`approve()` 里加一条 `submittedBy != me()`。**不建议默默放着**——审核机制的全部价值就是两个人签字 |
| 6 | 分页契约仍未立 | 全后端 `PageResult`/`selectPage` 零命中；实测 `/api/tenants` 一次回 386 条 | 与上一轮同：现在不用做，**先约定**超过 N 行走哪套分页，写进 `API-CONTRACT-SPEC.md` |
| 7 | 生产库里仍躺着 6 张调研临时表 | `park_demo3` 80 张表里有 `_fx_alloc_result`/`_fx_loss_result`/`_fx_pool_result`/`_pre_alloc_result`/`_pre_loss_result`/`_pre_pool_result`。**上一轮已列为 risk 7，十天未动** | 池修复回归比对若已完成就 drop；否则改名加 `zz_` 前缀标明非业务表 |
| 8 | 三个明细屏样板未收编，且又长了一点 | 命中 32/35/40（上一轮 32/35/39）；对照 `SalaryView` 15 | 下次动这三屏时并入 `useSchedScreen`，别再新增第四份 |
| 9 | 抽屉默认月硬编码 | `PvRecordDrawer.vue:24` / `ChargingRecordDrawer.vue:30` / `ElecRecordDrawer.vue:29` 全是 `ref('1')`；`initMonth` 零命中 | 从 `FPMonthGate` 的当前月接过去 |
| 10 | 响应式欠账两头落空 | 4 个文件 `fp-fluid` 命中 0；`RESPONSIVE-LAYOUT-SPEC.md` 无欠账记录 | 二选一：补挂，或在 spec 里记一笔。项目自己的规矩不该只对别人生效 |
| 11 | 仓库根目录仍有 6 个 `*.tsv` 杂物 | `building-reclass-plan.tsv` 等 5 个 plan + `缺日期合同清单-20260805.tsv` | 低优先。归到 `backend/scripts/fixes/`（那里已有同类）。**上一轮的另两条已清**：野生空 `node_modules/` 和 27 个 `backup-*.sql` 都不在了 |

---

## 附：本次审查未覆盖

- **桌面宽度（≥1280px）UI 走查**：视口模拟一开合成点击就不落地，见「用户流程走查」章末第 1 条。
  本轮全部走查在 474px 移动端外壳下完成——这一档上一轮完全没覆盖，算是补上了另一块。
- **导入中心的真实导入**：需要样本工作簿，未跑。
- **单函数行数统计**：只统计到文件级。
- **`AllocService` 计算内核的数值复核**：不掌握各页签的纳入口径，按错误口径复算本来就对不上，
  不做等于不报假结论（与上一轮同一理由）。
- **审核机制在真实数据上的压力**：库里只有 1 条 `approved`、7 条 `review_log`。
  机制本身有 966 条后端测试与 8 个 `Review*IT` 兜着，但**真实使用量还没上来**，
  风险 4 的那条性能推断也因此没有实测数字。
