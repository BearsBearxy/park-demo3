# 功能实现脚手架（SCAFFOLD）v0 草案

> 2026-09-17 立档草案，**待用户审**。内容从现有代码归纳（实现即标准），括号里的数是当天实测。
>
> 本文件只管一件事：**新功能的代码放哪、用什么、写成什么形状。** 下面这些已有专册，这里只指路、不重复：
> HTTP 契约 → `API-CONTRACT-SPEC`；视觉 → skill `factory-park-design`；加载门 / 弹卡 / 层级 → `PAGE-BEHAVIOR-SPEC`；
> 列表页 → `LIST-PAGE-SPEC`；编辑态 → `EDIT-MODE-SPEC`；并发锁 → `CONCURRENCY-SPEC`；权限 → `RBAC-SPEC`。

## 0. 怎么用

- **写 plan 时**：每个任务标明落在 §2 / §3 的哪一层、复用 §4 的哪个模块；§4 里没有的，写明为什么要新建、放哪。
- **复查时**：逐条对 §5 打勾。
- 标记：🔒 = 有测试自动拦，违反就红；👁 = 只能靠人或复查 agent 看；⚖ = 现状两种写法并存，见 §7，拍板前按「建议」写。

## 1. 复用规则（最重要的一节）

1. **同样的逻辑出现第二份，就必须复用或抽取。** 抽成共享模块后，两处都改用它；不许留第二份拷贝。👁
2. **只有一处用到的，不许预先抽象。** 不写只有一个实现的接口，不加「以后可能用」的参数。👁
3. **抽取的前提是行为零变化。** 各处的差异留成参数，不为了「统一」把某处改成别处的样子（原话见 `useSchedScreen.ts` 头注释）。👁
4. **改了共享层，就顺着同族扫一遍。** 2026-08-30 给附表12 修的一整套问题，在同族另外 4 屏原样敞着，直到收口复查才发现。👁
5. **已知的重复不许再加一份。** `PvMeterView` / `CpMeterView` / `ElecCostView` 三个明细屏没走共享层（stage-review-2026-09-09 S2），下次动这三屏时并入，别照它们写第四个。

## 2. 后端（Spring Boot 3 + MyBatis-Plus + Flyway）

### 2.1 分层

依赖方向只有一条：**controller → service → mapper / entity**。反向引用现状为 0（service 引 controller 0 个；mapper、entity 引 service 0 个）。

| 包 | 放什么 | 现状 | 约束 |
|---|---|---|---|
| `controller/` | HTTP 入口 | 40 个 | 方法体只有一句 service 调用 👁；**不碰 mapper** 🔒 `arch/ControllerLayerTest`（0/40）；返回 DTO 不返回 entity 👁（例外 2 处，见 §6）；挂 `@Tag` + `@Operation` 👁（39/40） |
| `service/` | 业务、事务、查询 | 46 个文件（40 个 `@Service` + 6 个同包辅助类） | 查询用 `QueryWrapper`（25 个文件在用）；**不许新增 `selectList(null)`** 🔒 `arch/QueryHygieneTest`；写方法挂审核守卫 🔒（§2.3） |
| `mapper/` | 数据访问 | 64 个，63 个 `extends BaseMapper` | 自写 SQL 用 `@Select`（仅 `AuditQueryMapper`）；没有 XML（0） |
| `entity/` | 表映射 | 63 个，全部 `@Data` + `@TableName` | 只在 service / mapper 里用 |
| `dto/` | 请求 / 响应 | 181 个文件，平铺 | `public record`；命名 `*DTO` / `*Req` / `*Request`（API-CONTRACT-SPEC §7）；子包问题见 ⚖1 |
| `security/` | 权限、锁、审核 | 16 个 | 新写端点必须登记，见 §2.3 |
| `common/` `config/` | 信封、异常、过滤器、配置 | 8 / 5 个 | 新功能一般不动 |

### 2.2 写法

- **依赖注入**：手写构造函数注入。Lombok 主要用在 entity 上（63/63 `@Data`），service / controller 里只有 1 个文件用。
- **报错**：`throw new BizException(ResultCode.X, "中文说明")`。不抛 `RuntimeException`，也不抛 `NoSuchElementException`（原因见 API-CONTRACT-SPEC §4）。
- **事务**：多表写入在 service 方法上挂 `@Transactional`（28 个 service 文件有）。
- **端点形状**：列表、详情、各种写操作的返回形态见 API-CONTRACT-SPEC §3–§6，新端点照它 §9 的自检清单过一遍。

### 2.3 新写端点的两道登记

1. **`PermissionRegistry` 加一行**「方法 + 路径 → 权限点」。默认拒绝：不登记就 403。🔒 `PermissionCoverageTest`
2. **端点调到的 service 方法**：方法体里调 `reviewGuard.assertEditable(...)`；不需要审核守卫的，在方法上挂 `@NoReviewGuard(reason = "…")` 并写明原因。🔒 `ReviewGuardCoverageTest`
   - 这条测试靠解析 controller 方法体里的 `xxxService.yyy(` 找到 service 方法。**controller 方法体不是单句委派，它就解析不出来并直接红**，这也是 §2.1「单句委派」的机器理由。

### 2.4 数据库迁移

- Flyway，文件放 `src/main/resources/db/migration/V<n>__<snake_case>.sql`。当前最大 V125，下一个是 **V126**。
- 已经跑过的迁移不改；要改结构就加新版本。
- Java 迁移只有 1 个（`src/main/java/db/migration/V35__Bill_pay_company_seed.java`），新迁移写 SQL。👁

### 2.5 测试

| 类型 | 数量 | 写法 |
|---|---|---|
| `*IT.java` | 82 | 继承 `AbstractMysqlIT`（Testcontainers MySQL 8.0）；端点测试放 `api/` |
| `*Test.java` | 36 | 不起 Spring：纯逻辑，或源码扫描门禁（放 `arch/`、`security/`） |

源码扫描门禁照 `QueryHygieneTest` / `ReviewGuardCoverageTest` 的四条骨架写：
- 不起 Spring；
- 先断言扫描面非空，防止目录改名后门禁静默失效；
- 豁免名单来自产品代码，或者用全等快照；
- 失败消息写明怎么修。

## 3. 前端（Vue 3 + TS + Pinia + vue-router + Vitest）

### 3.1 目录

| 位置 | 放什么 | 现状 | 约束 |
|---|---|---|---|
| `api/<域>.ts` | 每个域一个文件，导出 `xxxApi` 对象 | 35 个 | **只有 `api/index.ts` 能 import axios** 🔒 `api/__tests__/axiosBoundary.spec.ts`。令牌注入、信封解包、会话漂移检测都挂在那个 http 实例上 |
| `views/<域>/` | 屏 | 114 个 `.vue`，全部 `<script setup lang="ts">` | |
| `components/ds/` | 基础件：Button / Select / Card / KpiCard / Pagination… | views 里 92 个文件在用 | 下拉一律用 `ds/Select`，全站没有原生 `<select>`（UI-CONSISTENCY-SPEC） |
| `components/fp/` | 产品级件：FPLoadError / FPPager / FPDrawer / FPEditModeButton / FPLockDialogs… | views 里 72 个文件在用 | |
| `components/sched/` `ana/` `shell/` `import/` `fin/` | 附表族页头 / 分析图元 / 外壳 / 导入 / 报表 | | |
| `composables/` | 跨屏状态机 | | 见 §4 |
| `stores/` | 全局状态 | 8 个，全部是 setup 写法 `defineStore('x', () => …)` | |
| `views/analysis/*.logic.ts`、`utils/*Logic.ts` | 纯函数层 | 25 个 `.logic.ts`（24 个在分析屏）+ 7 个 `*Logic.ts` | 拆不拆见 ⚖6 |
| `utils/` | 其余纯函数：`*Excel.ts` 导出、`import*.ts` 导入解析、`money.ts`（台账金额）、`finFmt.ts`（报表金额） | | 两种金额格式口径不同，故意分开 |
| `nav/fpNav.ts` | 导航的单一事实源 | | |
| `router/index.ts` | `VIEWS` 表：导航 value → 屏组件 | | |
| `styles/tokens.css` | 设计令牌 | | |

### 3.2 加一个新屏要做的事

1. `nav/fpNav.ts` 加条目，`router/index.ts` 的 `VIEWS` 加一行。🔒 `router/routeMap.spec.ts`（漏配就红）
2. 接口写进 `api/<域>.ts`，屏里只 import `xxxApi`。🔒（axios 那条）
3. 状态机先查 §4 有没有现成的。
4. 视觉和行为照专册：skill `factory-park-design`、`LIST-PAGE-SPEC`、`PAGE-BEHAVIOR-SPEC`、`LAYOUT-STABILITY-SPEC`（交互不许挪动已渲染的内容）、`UI-OVERLAY-SPEC`、`WRITE-KEEP-CONTEXT-SPEC`（写完不丢用户位置）。🔒 `token-check`（引用了未定义的 CSS 令牌就红）
5. 编辑屏照 `EDIT-MODE-SPEC` + `CONCURRENCY-SPEC`，编辑态经 `useEditMode` 接入。
6. 包体有预算。🔒 `size-check`，超了要用户拍板才能抬线。

### 3.3 测试

- 放哪：纯函数的 spec 和源文件放同一目录；挂载组件或屏的 spec 放 `__tests__/`。现状基本就是这样分的：同目录 128 个里有 96 个测的是 `.ts`，`__tests__/` 125 个里有 87 个做 `mount(`。
- DTO 夹具先按真实类型声明，再 `as never`；字面量直接 `as never` 会漏字段，渲染时崩。
- 断言下拉框找 `button.ds-sel-trigger`；`findAll('select')` 恒为空，写了就是假断言。

## 4. 现成模块（写新的之前先查这张表）

| 需求 | 用这个 | 在用 |
|---|---|---|
| 附表族年度台账：年份 / 编辑 / 抽屉 / 导入 / 勾选 / 批删 / 清空本期导入 | `composables/useSchedScreen.ts` + `components/sched/SchedHeader.vue` | 6 屏 |
| 编辑态：进出、权限门、上锁 | `composables/useEditMode.ts` | 17 个 `.vue` |
| 编辑锁：占 / 续 / 还 / 被接管 | `composables/useEditLock.ts`（一般经 `useEditMode` 或 `SchedHeader` 间接用） | 8 |
| 选期门：月矩阵 + 年份行，各屏各记各的期 | `composables/useMonthGate.ts` | 4 |
| 出账链五屏共用同一个期 | `components/fp/ChainMonthGate.vue` + `stores/billingPeriod` | |
| 带期深链进屏 | `composables/useDeepPeriod.ts` | 24 |
| KeepAlive 切回时重拉主数据 | `composables/onReactivated.ts` | 33 |
| 加载指示防闪（请求在途超过阈值才亮） | `composables/useDeferredFlag.ts` | 22 |
| 视口档位 / 触屏判定 | `composables/useViewport.ts` | 10 |
| 列表分页、每页行数 | `components/fp/FPPager.vue` + `components/fp/useFitRows.ts`（LIST-PAGE-SPEC §5–§6） | 6 / 7 |
| 加载失败态 / 加载条 | `components/fp/FPLoadError.vue` / `FPLoadBar.vue` | 9 / 10 |
| 导入 | `utils/importRegistry.ts` + `utils/import*.ts` | |
| 金额显示 | `utils/money.ts`（台账）/ `utils/finFmt.ts`（报表，两位小数） | |

## 5. 复查清单

workflow 里「照没照脚手架」那个复查角度就逐条打这张表。

- [ ] 每段新逻辑都先查过 §4：有现成的就用了，没有的写明了为什么新建
- [ ] 没有第二份同样的逻辑，也没有只有一处在用的抽象（§1）
- [ ] controller 是单句委派、没碰 mapper 🔒、返回 DTO、挂了 `@Tag` / `@Operation`
- [ ] 新写端点登记了 `PermissionRegistry` 🔒；service 写方法有审核守卫或 `@NoReviewGuard` 🔒
- [ ] 请求 / 响应 record 在 `dto` 包里，形状没和已有的重复
- [ ] 数据库改动是新版本迁移，没改已有迁移
- [ ] 前端请求走 `api/<域>.ts` 🔒；新屏注册了 nav 和 router 🔒
- [ ] 用的是 ds / fp 组件，没自写同功能的件；没引用未定义令牌 🔒
- [ ] 有分支或计算的逻辑有单测；新断言逐条做过破坏验证
- [ ] 没把 §6 的已知债当范本抄

## 6. 已知债（不许当范本抄）

- **巨型文件**：`AllocService.java` 2438 行、`BillNoticeService.java` 1330、`ContractService.java` 1102；`pvMeterAna.logic.ts` 1875、`PoolLedgerView.vue` 1573、`BillNoticesView.vue` 1391。
- **三个明细屏没走共享层**：见 §1 第 5 条。
- **controller 直接返回 entity**：`BillController`、`BillNoticeController`（API-CONTRACT-SPEC §4）。
- **`api/` 之外直接用 http 实例**（4 处）：`stores/auth.ts`、`stores/presence.ts`、`views/ChangePasswordView.vue`、`utils/importRegistry.ts`。
- **写操作返回形态的破例**：见 API-CONTRACT-SPEC §5 那张表。

## 7. ⚖ 待拍板（现状两种写法并存）

| # | 问题 | 现状 | 建议 |
|---|---|---|---|
| 1 | 后端 DTO 要不要按域建子包 | API-CONTRACT-SPEC §7 要求新增的建子包；实际 **0 个子包**，181 个文件平铺 | 二选一：跟实现继续平铺，把 §7 那句改掉；或者从下一个新域开始建子包 |
| 2 | 前端 DTO 类型写在哪 | 16/35 个 api 文件就地定义；`types/` 有 21 个文件，7 个 api 文件从那里引 | 就地写在 `api/<域>.ts`；多个 api 共用的才放进 `types/` |
| 3 | api 文件怎么引 http | `api/` 里 `'./index'` 25 个、`'@/api'` 6 个；`api/` 外的 `utils/importRegistry.ts` 用 `'@/api/index'` | `api/` 里统一用 `'./index'`（多数写法） |
| 4 | 文件行数上限 | 没有门禁 | 照 size-check 的做法记基线：老文件不许再变长，新文件超过 N 行就红；N 待定 |
| 5 | 要不要加重复代码检测 | 没有门禁，只靠阶段审查人工 grep | jscpd（要新增一个开发依赖）；或者先用 grep 计数锁住已知那组 |
| 6 | 新屏的纯逻辑是否必须拆出 `.vue` | 分析屏 38 个 `.vue` 配了 24 个 `.logic.ts`；台账类屏大多写在 `.vue` 里 | 必须拆，单测只盯纯函数 |
