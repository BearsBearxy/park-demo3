# demo3 阶段性验收报告（2026-09-22）

审查对象：`C:\financial_dashboard\demo3`，分支 `jfen/mobile-patterns`（领先 `master` 23 个提交）。
工作树里 5 个已改文件 + 3 个未跟踪文件一并计入（见 §未跟踪的三道门禁）。

本轮走查以 `admin` 身份在浏览器里实际点击完成（前端 `:5173` / 后端 `:8481` / MySQL 容器 `demo3-mysql`）。
增删改查四类各走了一遍真操作，并在走查后把测试数据删回原状（386 户 → 387 → 386）。

前三轮报告：`stage-review-2026-08-30.md` / `-08-31.md` / `-09-09.md`。
上一轮 11 条风险逐条复核，结果在 §上一轮 11 条风险的去向 —— 那张表是本报告最有决策价值的部分。

---

## 结论

**能支撑后续功能开发。**

理由：分层、返回契约、权限门、测试与 CI 五样都是立住的，而且大多**已经上了机器门禁**，不是靠人自觉：
后端 975 测试 / 0 失败（119 个测试类）、前端 4,264 测试 / 0 失败（308 个文件）、
40 个 controller 零越层（`ControllerLayerTest` 锁死）、写端点默认拒绝且漏配即 403、
`selectList(null)` 存量冻结在全等断言上。死代码逐个反查是 **0**（181 个 DTO、216 个 `.vue`、全部 utils 导出）。
本轮 UI 走查跑了 7 个屏、上百个接口调用，**零 4xx / 零 5xx / 零 console 报错**。
加一屏新功能，该复用的东西（`AnaShell`、`useSchedScreen`、`ds/`、`api/<域>.ts`）都在，也都有门禁逼着你用。

要先还的账有四条，都不阻塞开发，但其中两条是**第三、第四轮点名**：

| # | 要还的账 | 为什么现在还 |
|---|---|---|
| **A1** | **主数据的增删改完全没有审计留痕** | 本轮实测：我以 admin 建了、改了、删了一个租户，`操作日志`（366 条）里**一条都没有**。`tenant`/`contract` 表也没有 `created_by`/`updated_by` 列 |
| **A2** | **审核可自交自审** | `ReviewService.approve()` 无「交审人 ≠ 审核人」判据。09-09 风险 5，十三天未动 |
| **A3** | **18 张调研临时表仍在库里（3 库 × 6 张）** | 08-30 / 08-31 / 09-09 连续三轮列为 risk 7，行数一字未变。**第四轮点名** |
| **A4** | **两道新门禁没进 git，CI 看不见** | `ControllerLayerTest.java` / `axiosBoundary.spec.ts` 都是 `??` 状态。现在的「绿」只代表这台机器绿 |

A1 是本轮新发现且最值得先动的一条 —— 理由在 §A1 展开。

---

## 功能清单与验证状态

导航单一事实源 `frontend/src/nav/fpNav.ts` 登记 **51 屏 / 4 层**；另有不进导航的 5 条路由
（`/home`、`/newtab`、`/login`、`/change-password`、`/_gallery`）与 2 条历史重定向
（`/price-cfg`→`/params`、`/bank-flow`→`/data-home`）。
后端 **40 个 controller / 271 个端点**（GET 113、POST 73、DELETE 42、PUT 33、PATCH 10）。

| 功能 / 页面 | 验证状态 | 证据 | 风险 |
|---|---|---|---|
| 登录 → 首页 | ✅通过 | 走查实测：登录后落 `/home`，搜索框 + 「本月出账 · 2026-09 · 5 道工序」入口 + 收藏区 | 无 |
| 租户管理 · 增 | ✅通过 | 点「新增租户」→ 填企业名称/业务类型 → 创建。`POST /api/tenants` 200；列表 386→387、在租 385→386，弹窗自动关 | 无 |
| 租户管理 · 查（列表 + 搜索 + 分页） | ✅通过 | 搜「ZZ审查」→ 1 条命中，「第 1/1 页 · 共 1 条」；KPI 卡不随筛选变（全局口径，正确） | 无 |
| 租户管理 · 查（详情抽屉） | ✅通过 | 点行 → 抽屉出 `FP-T-1401`、月租金/在租面积/当前合同三卡、「暂无合同记录」空态 | 无 |
| 租户管理 · 改 | ✅通过 | 抽屉「编辑」→ 表单预填正确 → 改联系人 → 保存。`PUT /api/tenants/401` 200，抽屉刷新出「审查走查员」 | 无 |
| 租户管理 · 删 | ✅通过 | 「删除」→ 二次确认弹窗带记录名与后果（「此操作不可撤销。若该租户存在合同或台账记录,将无法删除」）→ 确认。`DELETE /api/tenants/401` 200，列表回 386 | **A1**（全程零审计） |
| 本月出账（data-home） | ✅通过 | 2023–2026 年×月网格、出账链 5 道工序各带状态（已审核/待审核/未交审）、附表录入 2/11；顶部警示「219 份合同无租金计费行,会让公摊/催缴单算不准」+「去补码」按钮 | 无 |
| 园区抄表 / 催缴单（月门） | ✅通过 | 四步顺序图例（抄表·公摊·损耗·催缴）、月网格、「补更早年份」 | 见 #6 |
| 报表中心 | ✅通过 | 2025-12 三大报表均显「待生成」（诚实空态，不编 0）；附表1 显「2025年已录 32 行」 | 无 |
| 科目余额表 | ✅通过 | 换期日历只有 2024-10 / 2025-10 非空，与库内实测完全一致；2025-10 出 52 项、期末借贷各 ¥338,47x,xxx、**试算平衡 −¥0.04 带警示图标** | 见 #5 |
| 经营驾驶舱 | ✅通过 | 6 张 KPI + 结论条 + 预测护栏图 + 收入构成环；「同比」按钮禁用并写明理由「本屏不支持同比(2024 无月度数据)」 | 见 #8 |
| 光伏分栋分析（最重的分析屏） | ✅通过 | 13 栋数据、自绘 SVG 折线 + 柱图、「数据到 12-31 / 日达标 31/31 天 / 日粒 483/483 · 100%」；KPI 全是测量不是定性 | 无 |
| 系统管理 · 用户 | ✅通过 | 10 账号 / 启用 8 / 已停用 2 / 角色 7；文案「账号只停用不删除,历史记录中的操作有据可查」 | 无 |
| 系统管理 · 操作日志 | ✅通过 | 366 条 / 37 页 / 每页 10，服务端分页真的翻；四源 union（账号与角色 / 审核 / 计费参数 / 导入） | **A1**（只覆盖这四源） |
| 页签栏 / 面包屑 / 收藏 | ✅通过 | 走查中开到 5 个页签，面包屑「数据中心 › 催缴单」、☆ 收藏、「只有你在线」并存 | 无 |
| 导入中心 | ➖未验证 | 需要样本工作簿，未跑（与前两轮同） | 未知 |

**缺失 UI 入口的功能：未发现。** 走查覆盖到的每个后端能力都在页面上找得到入口；
`router/index.ts:79-84` 还有一道 DEV 双向差集护栏，导航与路由表任一侧多配少配都会在控制台点名。

---

## 后端

### 目录责任表

| 包 | 职责（一句话） | 规模 | 代表文件 | 判定 |
|---|---|---|---|---|
| `common/` | 返回信封、异常→状态码映射、traceId 与慢请求两个 filter | 8 文件 / 289 行 | `Result.java:3`、`ResponseWrapAdvice.java:12`、`GlobalExceptionHandler.java:21` | 清晰 |
| `config/` | 启动期装配：管理员初始化、账簿种子、CORS、MyBatis-Plus、OpenAPI | 5 / 186 | `AdminInitializer.java` | 清晰 |
| `controller/` | HTTP 入口，方法体单句委派 service | 40 / 2,116 | `TenantController.java:15-28` | 清晰（2 处破例见下） |
| `service/` | 业务、事务、查询 | 46 / **16,454** | `AllocService.java`（2,438 行） | 清晰，但**占后端 64% 的代码**，巨型文件都在这里 |
| `mapper/` | 数据访问，63/64 继承 `BaseMapper`，零 XML | 64 / 1,266 | `AuditQueryMapper.java`（全仓唯一 `@Select`） | 清晰 |
| `entity/` | 表映射，全部 `@Data` + `@TableName` | 63 / 1,202 | — | 清晰 |
| `dto/` | 请求/响应 record，181 个文件**平铺无子包** | 181 / 2,636 | — | 见 #10 |
| `security/` | JWT、RBAC 写门、提权、审核守卫、在线态 | 16 / 1,535 | `SecurityConfig.java`、`WriteAccessManager.java` | 见下 |

**职责边界上唯一一处没写下来的约定**：三对「内存态 store 在 `security/`、对应 service 在 `service/`」——
`PresenceStore.java`(228) ↔ `PresenceService.java`(149)、`ElevationStore.java`(85) ↔ `ElevationService.java`(197)、
`ApprovalStore.java`(101) ↔ `ApprovalService.java`(191)。同一件事跨两个包，而 `SCAFFOLD.md §2.1`
对 `security/` 只写了「权限、锁、审核」。不是错，是**下一个人加第四对时无从照抄**。建议在 SCAFFOLD §2.1 补一句。

**分层反向引用 = 0，且已上机器门禁**：
`backend/src/test/java/com/park/demo3/arch/ControllerLayerTest.java` 静态扫 controller 包源码，
连全限定名一起拦（`com.park.demo3.mapper.`），并断言「扫到 ≥30 个文件」防止路径改名后门禁静默失效。
本次实测 40/40 零命中。

### 接口统一性：**统一**

信封是全局的，不是每个 controller 各写各的：

```java
// common/Result.java:3
public record Result<T>(int code, String message, T data, String traceId) {
    public static <T> Result<T> ok(T data) { return new Result<>(0, "ok", data, MDC.get("traceId")); }
```

`common/ResponseWrapAdvice.java:11-12` 用 `@RestControllerAdvice(basePackages="com.park.demo3.controller")`
+ `supports()` 恒 true 把**所有** controller 返回值裹进去，所以 controller 方法签名里看不到 `Result<>`。
（`String` 返回类型特判在 `:24-32`：Spring 已选中 `StringHttpMessageConverter`，直接返 `Result` 会
`ClassCastException`，故手动 `writeValueAsString`。）

五类场景各取一个真实例子，全在 `controller/TenantController.java`，且本轮**都真点过**：

| 场景 | 代码 | 实测 |
|---|---|---|
| 列表 | `:15-16` `List<TenantDTO> list()` | `GET /api/tenants` 200，`{"code":0,"message":"ok","data":[…],"traceId":"…"}` |
| 详情 | `:27-28` `TenantDetailDTO detail(@PathVariable Integer id)` | `GET /api/tenants/401` 200，同一层信封 |
| 增 | `:19-20` `TenantDTO create(@Valid @RequestBody …)` | `POST /api/tenants` 200，`data` 回新建对象 |
| 改 | `:21-24` `TenantDTO update(…)`（全量 PUT） | `PUT /api/tenants/401` 200 |
| 删 | `:25-26` `void delete(…)` | `DELETE /api/tenants/401` 200，`data: null` |

未认证实测：

```
$ curl http://localhost:8481/api/tenants
HTTP/1.1 401
{"code":401,"message":"未认证或令牌无效","data":null,"traceId":"75ccf40a93554503"}
```

**HTTP 状态码 vs 业务码的口径是明写的**，不是碰巧一致 —— `common/GlobalExceptionHandler.java:15-19`
头注释写死四条轨：业务错误 → HTTP 200 + `body.code`；入参校验 → HTTP 400 + `code=400`；
未认证 401；未捕获 500。前端 `api/index.ts:100-101` 对非 2xx 也解包信封，两轨用户提示一致。
`ResultCode.java` 里 423（审核锁定）与 409（上游未审完）分开的理由写在枚举旁边：合成一个码
前端就分不出「去催上游」和「去找审核员撤销」两种下一步。

**唯一的不统一：分页只有一处。** 全后端 `IPage`/`Page<`/`selectPage` **零命中**，
只有操作日志 `SystemController.java:51-63` 返回 `AuditPageDTO(rows,total,page,size,…)`
（`dto/SystemDtos.java:56`），其余 112 个 GET 全返回裸 `List`。
这不是两处互相矛盾的实例，是**契约根本没立**（09-09 风险 6 至今未动）。
不过本轮实测下来，它今天**还不疼**（见 §性能），所以排在 A1–A4 之后。

`controller` 直接返回 entity 的 2 处破例（`SCAFFOLD.md §6` 自己记着，本轮复核仍在）：
- `BillController.java:37-38` `List<BillPayCompany> paymap()` → `BillsService.java:117-118` 的
  `payMap.selectList(null)`，**全表**。今天 2,445 行，天花板 ≈ 租户 386 × 附表10 的 25 个费用列 = 9,650。
  **走查实测它在「催缴单」进屏时就被调用**，是热路径，不是冷接口。
- `BillNoticeController.java:66-67` `List<BillNoteOverride> notes(@RequestParam String ym, …)`（按月收敛，量小）。

### 封装边界盘点（四问）

| 封装 | ① 复用了框架什么 | ② 自定义了什么 | ③ 解决什么真问题 | ④ 去掉会怎样 | 判定 |
|---|---|---|---|---|---|
| `Result` + `ResponseWrapAdvice` | Spring 的 `ResponseBodyAdvice` | 4 字段 record + String 特判 | 271 个端点零样板拿到统一信封 + traceId | 每个 controller 手写包裹，必漏 | 保留 |
| `GlobalExceptionHandler` | `@RestControllerAdvice` + `@ExceptionHandler` | 8 个具体 handler + 1 个 fallback | 每个 handler 头上写着它**防的是哪次误报 500**（类型转换、缺参、唯一键、字段溢出…） | 全落 fallback，用户看到「服务器内部错误」 | 保留 |
| `WriteAccessManager` | Spring Security 的 `AuthorizationManager` | 查 `PermissionRegistry` + 默认拒绝 + 提权挂载点 | 126 个写端点的提权一行不用改；漏配权限当场 403 而非裸奔 | 提权散到几十处业务代码，且必漏 | 保留 |
| `PermissionGuard` | `SecurityContextHolder` | 业务层按请求体判权限 | 只服务 1 处（`PUT /api/params` 按 `cfg_key` 分两档） | 那处退回「前端藏按钮、后端门开着」 | 保留（见下） |
| `@NoReviewGuard` 注解 | Java 注解 | `reason` 必填，由 `ReviewGuardCoverageTest` 断言非空 | 让「故意豁免」和「忘了挂」长得不一样 | 白名单写进测试常量数组，改代码的人看不见 | 保留（注释自写「全仓第一个自定义注解，别顺手再造第二个」） |
| `UserPermissionCache` | — | 全量装内存，每请求零 DB 查询 | RBAC-SPEC §5.5：权限改完立刻生效 | 每请求 N+1 次查询 | 保留（边界写在 `QueryHygieneTest` 的 `BOUNDED` 注释里，并注明前提失效时该推翻重做而非把数字调大） |
| 前端 `api/index.ts` | axios 拦截器 + `declare module` 改签名 | 信封解包 + 401 清理 + 跨标签页身份漂移拒发 | 屏里 `await api.get<T>()` 直接拿业务数据 | 每个调用点手解信封；身份漂移无人管 | 保留 |
| `AnaShell.vue`（338 行） | — | 分析屏统一外壳 | **21 屏零例外**复用 | 21 份外壳拷贝 | 保留 |
| `useSchedScreen.ts` | Vue composable | 年度台账屏共享逻辑 | 4 屏复用 | 回到 4 份 30+ 行样板 | 保留（上一轮 S8 的账，已还） |

**简洁性阶梯检查 —— 以下四类一个都没发现**：单一实现的自造 interface、只有一个取值的配置项、
「为将来」预留的空架子、重新造框架已有的轮子。分页是**没做**而不是自造；
缓存虽是自建，但目标（权限改完立刻生效 + 每请求零查询）Spring Cache 给不了，理由写在代码里。

**唯一可以质疑的**：`PermissionGuard` 只服务 1 个端点（55 行）。按「不为单处抽象」该内联。
**不建议动** —— 它的类注释记着 2026-08-22 那个洞（「只写在注释里没有实现」，导致只有
`param-monthly:edit` 的人能绕开前端改任何计费口径键），内联会把这段理由冲掉；
且第二处一定会来（按请求体判权限的场景不会只有一个）。

---

## 代码质量

### 屎山信号（逐项）

| 信号 | 结果 | 证据 |
|---|---|---|
| **重复代码（逻辑）** | ⚠️ 发现，都在同族屏模板层 | 剥掉 `<style>`/`<template>` 后 8 行滑窗跨文件重复 **83 处**。抽样核对：`ChargingView.vue:183` / `ElecView.vue:184` / `PvView.vue:160` 三屏壳挂载段逐字相同（连「fp-fluid 条件挂」整段注释都一样，只换两个名词）。脚本层已并入 `useSchedScreen`，剩的是模板层 |
| **重复代码（CSS）** | ⚠️ 发现 | `.fin-mask` / `.fin-dlg` 弹窗样式在 **8 个 `.vue`** 各写一份逐字拷贝：`components/fin/FinDialogs.vue:137`、`views/reports/trial-balance/TrialBalanceView.vue:650`、`balance-sheet`、`income-statement`、`analysis/FinCashflowView`、`system/SystemUsersView`、`tenants/TenantDrawer`、`tenants/TenantNewDialog`。scoped CSS ⇒ 改一次要改八处 |
| **巨型文件** | ⚠️ 发现，且在长 | 后端 >800 行 4 个：`AllocService` 2,438 / `BillNoticeService` 1,330 / `ContractService` 1,102 / `LedgerService` 844。前端 >800 行 13 个，最大 `pvMeterAna.logic.ts` 1,875、`BillNoticesView.vue` 1,614、`PoolLedgerView.vue` 1,574。**`BillNoticesView.vue` 从 SCAFFOLD 立档（09-17）的 1,391 行涨到 1,614（+223 行 / 5 天）** —— §7 ⚖4「文件行数没有门禁」的代价已经看得见 |
| **死代码** | ✅ 未发现 | 后端 181 个 DTO 逐个反查引用 → **0 个孤儿**；前端 216 个 `.vue` 逐个反查 → **0**；`utils/` + `composables/` 导出函数逐个反查 → **0**。注释掉的代码 3 行。`TODO/FIXME/HACK` 5 处命中**全部**是常量名 `LOC_TODO`（`views/meters/MeterLedgerGrid.vue:225`），没有一个真 TODO |
| **命名混乱** | ✅ 未发现 | DTO 一律 `*DTO`/`*Req`/`*Request`；entity 与表名一一对应 |
| **魔法值散落** | ✅ 未发现 | 抽查阈值类常量均具名并带理由，如本轮工作树新增的 `MARGIN_DISTORT_PCT = 300`（`cockpit.logic.ts`，注释写明「改这个数 = 改屏上什么时候不给百分比」） |
| **分层穿透（后端）** | ✅ 未发现 | controller 零 SQL、零 `QueryWrapper`、零 mapper 引用（机器门禁锁死） |
| **分层穿透（前端）** | ⚠️ 轻度 | 组件/屏里硬编码 `/api/` **零命中**；`from 'axios'` 在 `api/index.ts` 之外**零命中**（已上门禁）。但 4 个文件绕过 `api/<域>.ts` 直接用默认 http 实例：`stores/auth.ts:3`、`stores/presence.ts:3`、`views/ChangePasswordView.vue:8`、`utils/importRegistry.ts`。SCAFFOLD §6 自己记着 |

### 性能

**先说结论：本轮实测下来，容量问题是「以后」的，不是「现在」的。** 这一条纠正了我起草时的判断。

库内行数（`demo3-mysql` / `park_demo3` 实测）与它们**实际被怎么查**：

| 表 | 总行数 | 单次查询最大收敛量 | 接口实际返回 |
|---|---|---|---|
| `report_amount` | 14,072 | 6,907（tb / 2025-10） | **10 KB / 52 项** —— 服务端已合并到一级科目，不是把 6,907 行吐给前端 |
| `bill_notice_line` | 6,976 | 3,570（单月） | 逐月累积 |
| `report_account` | 3,868 | 2,117（单期） | — |
| `monthly_ledger` | 3,883 | — | 逐月累积 |
| `bill_pay_company` | **2,445** | **2,445（全表）** | `GET /api/bills/paymap` 无收敛参数，且在催缴单屏进屏即调 |
| `meter_reading` | 1,952 | 1,090（单 ym） | `QueryHygieneTest` 注释里记的是 2026-08-18 的 1,135 —— 一个多月涨了 72% |
| `meter` / `contract` / `tenant` | 1,137 / 431 / 386 | 全量 | 有界维度表，全量是设计意图 |

浏览器实测耗时（`performance.getEntriesByType('resource')`）：

- `GET /api/reports/tb/all/2025/10`（背后 6,907 行）→ **177 ms**，10 KB
- `GET /api/reports/tb/all/2024/10`（背后 5,828 行）→ **453 ms**，9 KB
- 年历视图一次并发 **6 个** `GET /api/reports/tb/{companyId}/2025`，每个 **650–700 ms**，各 1 KB

所以 `API-CONTRACT-SPEC.md:40` 那条「单接口返回行数 > 5000 必须改造」的红线**没有被越过** ——
越线的是**内部扫描量**，不是返回行数。真实代价是每次请求的服务端计算：单期 0.2–0.5 s，
年历一屏 6 个并发各 0.7 s。今天可接受，但它只会涨，而且没有任何东西会为此报警。

其余实测：

- **`selectList(null)` 存量 98 处**，已有机器门禁 `arch/QueryHygieneTest` 锁死增量。
  断言用**全等**不是「不超过」——清理了也红一次，逼人回来改基线表，防止数字烂成没人信的假账。
  表里把「逐月累积表」（LEGACY，要治）和「有界配置表」（BOUNDED，天然全量）分开，
  并把前提写出来供人质疑：「哪天接了几千个租户自助账号，这一段就该推翻重做，而不是把数字调大」。
  这套设计比多数项目狠，应当保留。
- **真 N+1：10 处**，全是「循环体里按 id 单查」，形如
  `PvService.java:208-214` 的 `for (Long id : ids) { records.selectById(id); … records.deleteById(id); }`
  —— 每个 id 两次往返，**且 `ids` 没有 `@Size` 上限**。同型另 5 处：`ChargingService:228`、
  `ElecService:240`、`OfficeService:192`、`S10Service:395`、`SalaryService:185`。
  今天由屏上可选行数天然封顶，但批量删 500 行 = 一个事务里 1,000 次往返。
  （另 86 处「循环旁的 mapper 调用」经核对是 `for (X x : mapper.selectList(null))` 的**预取建索引**写法 ——
  一次查询后在内存 groupBy，是 N+1 的反面，不计入。）
- **闭月性能（上一轮风险 4）已部分收敛**：`ReviewService.closedMonths()` 现在先按
  `status='approved'` 聚合候选期，只对候选期跑 `dataHome.overview(period)`，注释写明「年份条一屏最多 4 年 48 个月」的上界。
- **年历类屏普遍一年一请求**：走查实测催缴单进屏发了 4 个 `GET /api/review/states?year=2023..2026`。量小，记一笔。
- **前端无虚拟滚动**（`v-memo` 零命中）。`FPPager` 只在 7 个屏用。
  抄表屏 `MeterLedgerGrid` 单月渲染 1,090 行 × 多列，走查没报慢，但没有机制拦住它变大。
- **静态资源**：`npm run build` 带 `scripts/precompress.mjs`；CI 有重型库静态 import 门禁
  （`exceljs` 917KB / `echarts` 678KB 只许 `await import`，匹配 `from` 那一侧以避开跨行写法）。
  包体预算（size-check）已按用户要求于 2026-09-18 整个删除。

---

## 前端审查

**总体评价：良好。** 216 个 `.vue` / 527 个 `.ts` / 90,516 行。未发现会崩溃、出错数或造成安全漏洞的问题。

### Critical

**无。** 逐项核对：

- **XSS**：`v-html` **零命中**，`innerHTML` **零命中**。没有可注入面。
- **TS 逃逸**：`@ts-ignore` / `@ts-nocheck` / `@ts-expect-error` **零命中**；`npm run build` 里 `vue-tsc --noEmit` 是真门禁。
- **内存泄漏**：`addEventListener` 不配对的 5 个文件（`router/index.ts`、`stores/appearance.ts`、
  `stores/auth.ts`、`stores/presence.ts`、`stores/ui.ts`）全是**模块级、随应用同生命周期**，不是泄漏。
  唯一的组件级定时器 `components/fp/FPElevateDialog.vue:126` 有 `onUnmounted(stopTick)`（`:174`）兜住。
  未 `disconnect` 的 Observer：无。
- **Vue3 响应式解构**：6 处 `const { … } = props.x` 全部在 `computed()` **内部**
  （`DatePicker.vue:343`、`PvChips.vue:67`、`PvControlChart.vue:54`、`PvDayChart.vue:67`、
  `PvLedgerScatter.vue:70`、`PvYieldBand.vue:94`），每次求值重新解构，响应式不丢。
  `const { … } = useXxxStore()`（丢响应式的经典写法）**零命中**。
- **异步竞态**：分析屏普遍带请求序号/失效标记（15 个文件命中 `reqId`/`stale`/`abort`）。
- **敏感信息硬编码**：`.env.example` 刻意不给 `JWT_SECRET` 示例值，注释写明「任何写进仓库的密钥都等同公开」；
  除 `VIEWER_PASSWORD` 外全部必填、留空则 `docker compose up` 直接退出（fail-closed）。
- **走查期间零 console 报错、零 4xx/5xx**（7 个屏、上百个接口调用）。

### Suggestion

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| S1 | `any` 60 处（非测试） | `components/fp/FPSortableTable.vue`、`fpSort.ts`、`FPLedgerTable.vue`、`ds/SidebarNav.vue` | 都是「按 key 取任意行字段」的泛型表格场景，不是随手 `any`。可用 `Record<string, unknown>` + 类型守卫收窄，收益中等、改动面大 |
| S2 | 三个明细屏未并入共享层 | `PvMeterView.vue`(935) / `CpMeterView.vue`(910) / `ElecCostView.vue`(951) | SCAFFOLD §1.5 自己写着「下次动这三屏时并入，别照它们写第四个」。09-09 S8 也是这条 |
| S3 | 弹窗 CSS 八份逐字拷贝 | 见上表 | 抽到 `ds/` 或全局层 |
| S4 | 三个年度台账屏模板层仍是拷贝 | `ChargingView.vue:183` / `ElecView.vue:184` / `PvView.vue:160` | 脚本层已复用；壳挂载那段连注释都逐字相同 |
| S5 | 利润率失真门只挡正向 | `views/analysis/cockpit.logic.ts` 的 `marginNote()` | **代码自己记着这个洞**：「负向失真 —— 利润负、收入正 —— 现在仍会印出来，这是改动前就有的洞，另记。」 |
| S6 | 文件行数无门禁 | SCAFFOLD §7 ⚖4 | `BillNoticesView.vue` 5 天涨 223 行 |
| S7 | 期别回退横幅贴在结论条上方，易被读成结论条的口径 | `CockpitView.vue:524-525` | 走查实测：屏上横幅写「所选 2025-12 无**台账**数据,当前显示 2025-10」，紧接着结论条写「**2025年12月**收入 −¥53万」。**查过代码，不是 bug** —— 横幅属于「收缴率」卡（`source="台账"`，判据 `cp.ym !== period.ym.value`），结论条走损益口径，各自正确。但两句话上下相邻、横幅没说它只管哪张卡，读起来像自相矛盾。建议把横幅挪到收缴率卡旁，或在横幅里点名它管的是哪个数 |

**本轮工作树改动已在屏上验到**：`marginNote()` 把 KPI 卡与结论条统一到一份判据。
实测经营驾驶舱：KPI 卡「园区利润 −¥548.5万 / 利润率 — 基数过小」，
结论条「2025年12月收入 −¥53万,园区利润 −¥549万(利润率 — 基数过小)」——**两处口径一致**。
（改动前同屏一句拒答、一句直答 1030.3%。）

---

## 用户流程走查

以 `admin` 身份在浏览器里实际点击完成。本轮**两档宽度都覆盖到了**：
先在 567px（手机档，底栏五格：首页/数据/报表/分析/系统）走完增删改查，
后因面板加宽转到 ~800px 桌面档（左侧四层图标栏 + 二级目录 + Chrome 式页签 + 面包屑）继续走查 ——
**桌面档是前两轮都没覆盖过的一档**。

| # | 操作路径 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| 1 | 登录 → 落地 | 落首页 | 落 `/home`，搜索框 + 本月出账入口 + 收藏区 | ✅ |
| 2 | 数据 → 租户管理 → 新增租户 → 填两个必填 → 创建 | 弹窗关、列表 +1、KPI +1 | `POST` 200；386→387、在租 385→386；弹窗自动关 | ✅ |
| 3 | 搜索框输「ZZ审查」 | 只剩 1 条，KPI 不变 | 「第 1/1 页 · 共 1 条」；KPI 仍 387/386（全局口径，正确） | ✅ |
| 4 | 点行 → 详情抽屉 | 出编号、三张卡、空态 | `FP-T-1401`、月租金 ¥0 / 在租面积 0 / 当前合同 0、「暂无合同记录」 | ✅ |
| 5 | 抽屉 → 编辑 → 改联系人 → 保存 | 弹窗关、抽屉刷新 | `PUT /api/tenants/401` 200；抽屉联系人变「审查走查员」 | ✅ |
| 6 | 抽屉 → 删除 → 二次确认 | 带名字与后果的确认、删后列表 −1 | 确认文案含记录名 + 「此操作不可撤销」+ 「若存在合同或台账记录,将无法删除」；`DELETE` 200；回 386 | ✅ |
| 7 | 底栏「报表」→ 报表中心 → 科目余额表 → 换期 → 2025年10月 | 空月不可选、有数月出数 | 换期日历只有 2024-10 / 2025-10 非空（与库内完全一致）；2025-10 出 52 项、试算平衡 **−¥0.04 带警示** | ✅ |
| 8 | 侧栏「分析」→ 经营驾驶舱 | KPI + 结论条 + 图 | 全部渲染；「同比」禁用并写明「本屏不支持同比(2024 无月度数据)」 | ✅ |
| 9 | 侧栏「系统」→ 用户管理 → 操作日志 → 翻页 | 服务端分页真翻 | 366 条 / 37 页 / 每页 10，翻页正常 | ✅ |
| 10 | 数据 → 本月出账 / 园区抄表 / 催缴单 | 月门 + 工序状态 | 年×月网格、5 道工序各带状态；警示「219 份合同无租金计费行」+「去补码」 | ✅ |
| 11 | 分析 → 光伏分栋分析（最重的屏） | 13 栋图表全出 | 自绘 SVG 折线 + 柱图 + 覆盖率读数（日粒 483/483 · 100%） | ✅ |
| 12 | 全程页签 / 面包屑 / 收藏 | 开多页签不串 | 开到 5 个页签，面包屑随屏变，☆ 收藏与「只有你在线」并存 | ✅ |

**缺失 UI 入口的功能：未发现。**

**走查中发现的两件事**：
1. **A1（下节展开）**：第 2/5/6 步这一整轮增删改，在第 9 步的操作日志里**一条都查不到**。
2. 走查环境的一个坑（不是产品问题）：浏览器面板一旦开视口模拟（`resize_window` 指定宽高），
   合成点击就不落地 —— 上一轮报告也记过同一条。必须用面板自身宽度才点得动。

---

## A1：主数据的增删改完全没有审计留痕

**这是本轮新发现的一条，也是最值得先动的一条。**

实测链路：我以 `admin` 新建租户 → 改联系人 → 删除（`POST` / `PUT` / `DELETE` 全 200），
随后打开 `系统管理 › 操作日志`（366 条），**这三次操作一条都没有**。日志最新两条是 21:03 的改密/重置密码。

根因：操作日志是**四张表 union**（`mapper/AuditQueryMapper.java:39,54,65,76`）——
`param_change_log`（计费参数）、`import_log`（导入）、`auth_audit_log`（账号与角色）、`review_log`（审核）。
主数据的写路径不在其中：`TenantService` / `ContractService` / `BuildingService` 里
`AuditLogService` **零命中**。库里也兜不住 —— `tenant` 与 `contract` 两张表只有
`created_at` / `updated_at`，**没有 `created_by` / `updated_by`**。

于是：386 户租户档案、431 份合同、全部楼栋单元的任何一次改动，事后**无法知道是谁做的**。

这跟项目自己的立场是冲突的。`frontend/src/api/index.ts:31` 为了防跨标签页身份漂移写了一整套拒发逻辑，
理由原话是「**这正好把审计体系作废：它的全部意义就是「谁做的」**」。
那套防护守的是「别把甲做的事记到乙头上」——而主数据这条路径上，根本没有「记」这个动作。

建议二选一，都不大：
- 给 `TenantService` / `ContractService` / `BuildingService` 的写方法接上 `AuditLogService`，
  并在 `AuditQueryMapper` 的 union 里加第五个分支（现有四个分支是现成范本）；
- 或者给这几张表加 `updated_by` 列 + `MyBatisPlusConfig` 的 `updateFill`
  （注意：#4 那 5 处 `update(null, UpdateWrapper)` 会绕过 `updateFill`，要一起改）。

**顺带说明它为什么不是「阻塞项」**：它不挡任何新功能落地。但它是四条账里唯一
「越晚补越查不回来」的 —— 补审计只能从补上那天开始生效，之前的改动永远无主。

---

## 上一轮 11 条风险的去向

| 上轮 # | 风险 | 本轮判定 | 证据 |
|---|---|---|---|
| 1 | 前端全量测试不稳定绿 | ✅ **已解决** | `vite.config.ts:88` 加了 `testTimeout: 15_000`。本轮全量 **308 文件 / 4,264 测试 / 0 失败**（73.74s） |
| 2 | 前端体积预算只剩 0.29% | ✅ **已作废** | size-check 于 2026-09-18 按用户要求整个删除；`frontend/scripts/` 只剩 `token-check.mjs` + `precompress.mjs` |
| 3 | `updated_at` 走两个时钟 | ❌ **未动** | 5 处 `update(null, new UpdateWrapper…)` 原样在：`TenantService.java:86,159,161`、`S10Service.java:272`、`CompanyService.java:220`；`docker-compose.yml` 仍无 `TZ` |
| 4 | 闭月一多年份条会变慢 | ⚠️ **部分收敛** | `closedMonths()` 现按 `status='approved'` 先聚合候选期，只对候选期跑 `overview()`，并写明 48 月上界 |
| 5 | admin 可自交自审 | ❌ **未动** | `ReviewService.approve():284-298` 仍无 submitter≠reviewer 判据。对照同文件 `recall():361` 的 `!me().equals(s.getSubmittedBy())` —— 撤回拦了，通过没拦 → **A2** |
| 6 | 分页契约未立 | ❌ **未动**（但实测今天不疼） | 全后端 `IPage`/`selectPage` 零命中。红线本身**没被越过**：`report_amount` 单期 6,907 行是内部扫描量，接口实际只返回 10 KB / 52 项 |
| 7 | 库里 6 张调研临时表 | ❌ **未动，且扩散** | 六张 × `park_demo3`/`park_verify`/`park_demo3_demo` = 18 张，行数一字未变（1135/294/22），代码与迁移里零引用。**第四轮点名** → **A3** |
| 8 | 三个台账屏样板未收编 | ✅ **已还清** | Pv/Charging/Elec 三屏已并入 `composables/useSchedScreen.ts`（各命中 5–6 次），行数降到 278/305/307 |
| 9 | 抽屉默认月硬编码 `ref('1')` | ✅ **已解决** | 三个 `*RecordDrawer.vue` 现用 `<DatePicker v-model mode="month" :min="ymMin" :max="ymMax">`（如 `PvRecordDrawer.vue:84,88`） |
| 10 | 响应式欠账两头落空 | ⚠️ **改为已记账** | `PvMeterView`/`CpMeterView` 的 `fp-fluid` 仍是 0，但 `PvView.vue:163-165` / `ChargingView.vue:186-188` 已把「这本账保 800px 地板、迁移完再拆条件」写成注释。上轮给的是「补挂或记一笔」二选一 —— 选了记一笔 |
| 11 | 仓库根 6 个 `*.tsv` 杂物 | ✅ **已清** | 根目录现只剩 `restructure-plan.csv` |

**账面：5 条还清、2 条部分收敛、4 条未动。** 未动的 4 条全是「改动很小但没人动」那一类，
其中 #6、#7 已是第三、第四轮点名。

---

## 未跟踪的三道门禁

工作树里有 3 个**未进 git** 的文件，全是 2026-09-17 新立的门禁与规范：

| 文件 | 作用 | 本机 | CI |
|---|---|---|---|
| `backend/src/test/java/com/park/demo3/arch/ControllerLayerTest.java` | controller 不许碰 mapper | ✅ 跑了，绿 | ❌ 看不见 |
| `frontend/src/api/__tests__/axiosBoundary.spec.ts` | `axios` 只许在 `api/index.ts` 出现 | ✅ 跑了，绿 | ❌ 看不见 |
| `docs/design/SCAFFOLD.md`（155 行，标「待用户审」） | 新功能代码放哪、用什么、写成什么形状；§6 已知债、§7 六条待拍板 | — | — |

CI 检出的是 git 里的内容，未跟踪文件在 CI 里根本不存在 —— **这两道门禁现在只在这台机器上生效**。
（`arch/QueryHygieneTest.java` 已在库里，正常受 CI 保护。）

SCAFFOLD.md 本身质量很高，且已是本报告 §目录责任表 / §封装边界 的事实依据。
它标着「待用户审」，建议连同两个测试一起提交并拍板 §7 那六条。

---

## 风险识别汇总（按严重度）

| # | 风险 | 证据 | 建议动作 |
|---|---|---|---|
| **1** | **主数据增删改零审计留痕** | 走查实测：建/改/删租户全 200，`操作日志` 366 条里零命中；`AuditQueryMapper` 只 union 四表；`TenantService`/`ContractService`/`BuildingService` 里 `AuditLogService` 零命中；`tenant`/`contract` 无 `created_by`/`updated_by` | 接 `AuditLogService` + union 加第五分支（四个现成范本）；或加 `updated_by` 列 + `updateFill`（注意 #4 那 5 处会绕过它）。**越晚补越查不回来** |
| **2** | **审核可自交自审，职责分离形同虚设** | `ReviewService.java:284-298` 无 submitter≠reviewer；同文件 `:361` 撤回有自查 | 二选一并写进 RBAC-SPEC：`approve()` 加一行判据；或明写「admin 不受职责分离约束」。别默默放着 |
| **3** | **18 张调研临时表（3 库 × 6 张），第四轮点名** | `information_schema` 实测；`.java`/`.sql` 零引用 | 池修复回归比对若已完成 → `DROP`；否则改名加 `zz_` 前缀。**一句 SQL 的事** |
| **4** | **两道新门禁没进 git，CI 看不见** | `ControllerLayerTest.java`、`axiosBoundary.spec.ts` 均 `??` 状态 | 提交它们。现在的「绿」只代表这台机器绿 |
| **5** | `updated_at` 两个时钟，同一行能差 10 小时 | 5 处 `update(null, UpdateWrapper)` 绕过 `updateFill`；`docker-compose.yml` mysql 无 `TZ` | 给 mysql 服务加 `TZ`（一行，顺带修掉本机全部 DB 生成时间戳）。与 #1 的第二方案同一处代码 |
| **6** | 报表接口服务端计算已到 0.2–0.7 s，且只会涨 | 实测 `tb/all/2024/10` 453 ms、`tb/all/2025/10` 177 ms；年历一屏并发 6 个 `tb/{co}/2025` 各 650–700 ms；背后 `report_amount` 单期最大 6,907 行 | 现在不用改。**记一笔判据**：单个报表期请求超 1 s 就把合并结果落成物化表 |
| **7** | `GET /api/bills/paymap` 全表返回且直接吐 entity，在热路径上 | `BillController.java:37-38` → `BillsService.java:117-118`；今天 2,445 行，天花板 ≈9,650；走查实测催缴单**进屏即调** | 加 `tenantId`/`ym` 收敛参数；顺手换 DTO（`SCAFFOLD §6` 已记为债） |
| **8** | 批量删是 N+1 且 `ids` 无上限 | `PvService.java:208-214` 等 6 处同型；DTO 层无 `@Size` | 给 `ids` 加 `@Size(max=…)`；循环改 `selectBatchIds` + `deleteBatchIds` |
| **9** | 文件行数无门禁，巨型文件在长 | `BillNoticesView.vue` 09-17 的 1,391 → 今天 1,614（+223 / 5 天） | 照删掉的 size-check 那套记基线：老文件不许再变长。SCAFFOLD §7 ⚖4 已提出，待拍板 |
| **10** | 分页契约仍未立 | 全后端 `IPage`/`selectPage` 零命中，112 个 GET 返裸 `List` | 与上一轮同：现在不用做，**先约定**超过 N 行走哪套分页，写进 `API-CONTRACT-SPEC` |
| 11 | 弹窗 CSS 八份逐字拷贝 | `.fin-mask`/`.fin-dlg` 在 8 个 `.vue` 各一份 | 抽到 `ds/` 或全局层 |
| 12 | 利润率失真门只挡正向 | `cockpit.logic.ts` 的 `marginNote()`，代码注释自己记着 | 判据改用 `Math.abs`，或明确「负向不挡」的理由 |
| 13 | 期别回退横幅易被读成结论条口径 | 走查实测；`CockpitView.vue:524-525` | 横幅挪到收缴率卡旁，或在横幅里点名它管哪个数 |
| 14 | 三个明细屏未收编，第三轮点名 | `PvMeterView`/`CpMeterView`/`ElecCostView` 共 2,796 行 | 下次动这三屏时并入，别写第四份 |
| 15 | `dto/` 181 文件平铺，与 spec 冲突 | `API-CONTRACT-SPEC §7` 要求建子包，实际 0 个子包 | SCAFFOLD §7 ⚖1 已列，二选一拍板 |

---

## 附：本轮未覆盖

1. **导入中心的真实导入** —— 需要样本工作簿，未跑（三轮均未跑）。
2. **≥1280px 宽屏** —— 本轮覆盖到 567px（手机档）与 ~800px（桌面档），比前两轮多一档；
   更宽的一档仍未覆盖，原因是浏览器面板一开视口模拟合成点击就不落地。
3. **单函数行数** —— 只统计到文件级。
4. **`AllocService` 计算内核的数值复核** —— 不掌握各页签纳入口径，按错误口径复算本来就对不上，
   不做等于不报假结论（与前三轮同一理由）。
5. **后端全量 `mvn verify`（含 Testcontainers 起真 MySQL 的那批 IT）** —— 本轮跑的是 `mvn test`，
   实测 **975 测试 / 0 失败 / 0 错误 / 119 个测试类**。IT 那批由 CI 覆盖（`.github/workflows/ci.yml` 的 `./mvnw -B verify`）。
6. **审核机制在真实用量下的表现** —— 库里 `approved` 仍是个位数，风险 #6 的性能判据仍无压力数据。

---

**本轮成本**：只读审查，未改任何项目代码；走查建的测试租户已删回，库状态与开始时一致（386 户）。
跑了两套测试：后端 **975 条 / 0 失败**（119 个测试类，977 个 `@Test`、2,635 条断言），
前端 **4,264 条 / 0 失败**（308 个文件，73.74s）。DB 侧只读查询 8 次。
浏览器走查 7 个屏、12 条流程，零 4xx/5xx、零 console 报错。
