# demo3 阶段性验收报告

> 2026-08-30。审查基线 `master` @ `5a29c06`（PR #16 合并后）。只读审查，未修改任何项目代码。
> 环境：后端 `localhost:8481`（spring-boot:run）、前端 `localhost:5173`（vite dev）、
> MySQL `demo3-mysql` 容器（`park_demo3`，78 张表）。

---

## 结论

**能否支撑后续功能开发：能。**

理由：分层没有穿透、返回体全站一套信封、无单实现 interface、无死代码、无 XSS 面、
索引覆盖到高频表、CI 跑真 MySQL 的 240+ IT，前端 1891 条断言 1890 条绿。
这不是一个"能跑就行"的原型，是有护栏的工程。

**没有阻塞项。** 但有 2 条 Critical 会让用户丢工作，建议在下一个功能之前先修——
它们不阻塞开发，只是每多做一个屏就多复制一份同样的洞。

---

## 功能清单与验证状态

阶段 0 盘点结果：**50 个屏**（`router/index.ts` VIEWS 表 50 项，与 `nav/fpNav.ts` 50 个导航项一一对应）、
**39 个 controller / 261 个端点**（GET 109 / POST 67 / DELETE 42 / PUT 33 / PATCH 10）、
**115 个 Flyway 迁移**（最新 `V116__pool_fee_name_backfill.sql`）。

| 功能/页面 | 验证状态 | 证据 | 风险 |
|---|---|---|---|
| 登录页渲染 | ✅通过 | `read_page` 拿到完整表单（账号/密码/记住登录/忘记密码/登录），无 console 错误 | — |
| 未登录路由守卫 | ✅通过 | 直接访问 `http://localhost:5173/tenants` → 落回登录页，[router/index.ts:87+](frontend/src/router/index.ts) 的 `beforeEach` 生效 | — |
| 后端鉴权 | ✅通过 | `curl /api/probe/ping` → **401**（未带令牌被拒，不是 200 裸奔） | — |
| 前端构建与类型闸 | ✅通过 | `npm ci` 干净装完；`tsconfig.app.json:7` `strict: true` | — |
| 前端测试套件 | ⚠️部分通过 | **1890 passed / 1 failed（1891）**，见下 | 冷启动 flake |
| UI 走查（读路径） | ✅通过 | 首页/租户/公共电核算/池抽屉，见「用户流程走查」章 | — |
| UI 走查（写路径：增删改） | ➖未完成 | 工具侧阻塞（Browser 面板隐藏，合成点击不落地），非应用缺陷 | — |

**测试那条 failed 的真相**：`src/utils/billNoticeExcel.spec.ts > 通知单 workbook 写得出且回读锚点格对得上`
在全量跑里 30s 超时；**单独重跑 551ms 通过**（35/35 绿）。
是 170 个文件并行 + 刚 `npm ci` 的冷 transform 造成的竞争，不是功能缺陷。
但它是一条**在负载下会翻的 flake**——0.55s 的测试撞 30s 上限，说明冷跑时它被饿了两个数量级。

> ⚠ 顺带坐实项目自己写的那条铁律：我这次 `npx vitest run 2>&1 | tail` **退出码是 0，而实际有 1 条红**。
> 与 [plans/2026-08-29-phase3-pool-opening.md](docs/superpowers/plans/2026-08-29-phase3-pool-opening.md)
> Global Constraints 第一条「不要接管道跑测试，退出码取自 tail」完全一致。这条约定是对的，别删。

---

## 后端

### 目录责任表

| 目录 | 职责 | 代表文件 | 判定 |
|---|---|---|---|
| `common/` (8) | 返回信封、异常收口、链路追踪、慢请求埋点 | `Result.java`、`GlobalExceptionHandler.java`、`TraceIdFilter.java` | 职责清晰 |
| `config/` (5) | 启动期装配与种子 | `AdminInitializer.java`、`BookSeeder.java`、`MyBatisPlusConfig.java` | 职责清晰 |
| `controller/` (39) | HTTP 入口，只做参数绑定与转发 | `AllocController.java`(20 端点) | 职责清晰，**无一处 SQL/QueryWrapper** |
| `dto/` (180) | 请求/响应契约 | `AllocRuleReq.java` | 数量大但单一职责 |
| `entity/` (60) / `mapper/` (61) | 表映射 / MyBatis 接口 | — | 一表一件，对得上 |
| `security/` (12) | 认证、权限注册表、提权、在场、锁 | `PermissionRegistry.java`、`WriteAccessManager.java`、`PresenceStore.java` | 职责清晰 |
| `service/` (44) | 业务与算账 | `AllocService.java`(2412 行) | **一个巨型件，见下** |

**唯一职责不清处**：`service/AllocService.java` 2412 行，同时干四件事——
池规则 CRUD（`apply()` 一带撞名校验）、公摊计算内核（`poolSegQty` :1660）、
账册字段派生、损耗池结算。它是全后端最大的文件，也是 `selectList(null)` 最密集处（28 次）。
**不建议现在拆**：它有 `AllocServiceTest`(936 行) + `AllocApiIT`(1424 行) 兜着，
拆的风险大于收益。等下次要动计算内核时顺手切出 `AllocCalcEngine` 即可。

### 接口统一性

**结论：统一。** 全站一个信封，由 `ResponseWrapAdvice` 自动套：

```java
// common/Result.java:3
public record Result<T>(int code, String message, T data, String traceId)
```

```java
// common/ResponseWrapAdvice.java:11,20-31 —— controller 包全体自动包裹，controller 自己返回裸 DTO
@RestControllerAdvice(basePackages = "com.park.demo3.controller")
if (body instanceof Result<?>) return body;
return Result.ok(body);
```

规范例子（列表 / 详情 / 增 / 改 四类同一套写法）：

```java
// controller/TenantController.java:16,18,20,28
public List<TenantDTO>       list()                 { return svc.list(); }
public TenantSummaryDTO      summary()              { return svc.summary(); }
public TenantDTO             create(@Valid @RequestBody TenantCreateReq req) { return svc.create(req); }
public TenantDetailDTO       detail(@PathVariable Integer id) { return svc.detail(id); }
```

`ContractController.java:18,21,23,27` 逐行同形。**没找到互相矛盾的两处实例。**

**一处刻意的不一致（已知、已文档化，不是缺陷）**：HTTP 状态码与业务码分两套用法——

| 失败类型 | HTTP | body.code | 证据 |
|---|---|---|---|
| 业务异常 `BizException` | **200** | 400/403/409/429 | `GlobalExceptionHandler.java:24-28` `@ResponseStatus(HttpStatus.OK)` |
| Bean Validation 失败 | **400** | 400 | `GlobalExceptionHandler.java:31-36` |

调用方要按两套判。这条已经写进了 plan 的 Global Constraints（「两种 400 要选对」），
前端由 `api/index.ts` 响应拦截器统一解包吸收掉，所以业务代码不受影响。
**保持现状**，但新写 IT 时必须知道这件事，否则断言写错方向。

**分页：后端零分页，前端客户端分页。** `PageResult`/`IPage`/`selectPage`/`pageSize` 全后端零命中，
所有列表端点返回完整 `List<T>`。

**实测坐实**：租户屏显示「第 1 / 39 页 · 共 386 条」，但 `GET /api/tenants` **一次返回全部 386 条**
（抓包读回响应体，`data` 数组从 id=1 连到 386），翻页全在前端 `FPPager` 里做。
当前数据量下是对的（最大表 14072 行），但**分页契约没有立**——第一个撑不住的屏会临时发明一套。

### 封装边界盘点（四问）

| 封装 | ①复用框架什么 | ②自定义什么 | ③解决什么真问题 | ④去掉会怎样 |
|---|---|---|---|---|
| `ResponseWrapAdvice` | Spring `ResponseBodyAdvice` | 信封自动套 + String 返回的 converter 绕过（:21-29） | 261 个端点不用各写一遍 `Result.ok()` | 261 处样板 + 漏套即前端解包炸 → **留** |
| `GlobalExceptionHandler` | `@RestControllerAdvice` | 8 类异常 → 中文可读文案 | 异常不泄栈、文案统一 | 用户看到 500 裸栈 → **留** |
| `api/index.ts` (101 行) | axios 拦截器 | **跨标签页身份漂移守卫**（:31-56） | 同机换账号后老标签页把操作记到别人头上，直接作废审计 | 审计失真 → **留**，且这是全项目最值的 101 行 |
| `security/PermissionRegistry` (213 行) | Spring Security | URL→权限键注册表 | 权限点集中一处，改权限不用翻 39 个 controller | 权限散落 → **留** |
| `composables/useEditMode`+`useEditLock`+`presence` | Vue composable | 多屏多锁、逐把续期、代次守卫 | 同标签页两个屏同时编辑时锁互顶（`presence.ts:110-125` 详述） | 静默丢锁 → **留** |
| `components/fp/*` (35 个) | — | 项目专用件（月门/两本账/接管/失锁…） | 50 屏共用形状 | 每屏重写 → **留** |
| `common/SlowRequestFilter` | Servlet Filter | >500ms 请求埋点 | 配 `docs/OPS-SLOW-QUERY.md` 定位慢查询 | 少一个观测点 → 留 |

**过度设计检查：未发现。**
- 单实现 interface：**0 个**（排除 MyBatis mapper——那是框架用法）
- 只有一个取值的配置项：**0 个**。7 处 `@Value` 全部带 env 可覆盖默认值，
  且 prod profile 刻意去掉了危险默认（`application-prod.yml:3,11` — DB/admin 口令必须由环境提供）
- 「为将来」预留的空架子：**0 个**。全库 `TODO`/`FIXME` 零命中
  （`AllocService.java:2095` 的 `LOC_TODO` 是 UI 占位文案常量，不是代码待办）

---

## 代码质量

### 屎山信号

| 信号 | 结果 | 证据 |
|---|---|---|
| 重复代码 | **发现 1 处（结构性）** | 三个明细屏 `PvMeterView`/`CpMeterView`/`ElecCostView` 各自重复同一套失败态+编辑态样板（`readErr`/`seq`/`fp-stale`/`FPLoadError`/`editMode` 命中 32/35/39 次），**且三屏 `useSchedScreen` 命中全为 0**——共享脚手架只有 `SalaryView` 在用（4 次）。项目文档自己称其为「四屏同形」 |
| 巨型文件 | **发现 5 个** | 后端：`AllocService.java` 2412、`BillNoticeService.java` 1314、`ContractService.java` 1082；前端：`PoolLedgerView.vue` 1558、`BillNoticesView.vue` 1364 |
| 巨型函数 | 未单独统计 | 上述文件内部有分段注释与小函数，未见单函数失控 |
| 死代码 | **未发现** | 「注释掉的代码」87 处命中经抽样**全是假阳**——是以 `;`/`)` 结尾的中文说明注释（如 `AllocService.java:27,283,334`）。全库无 `TODO`/`FIXME` |
| 命名混乱 | **未发现** | 前后端同概念同名（`LOC_TODO` 前后端刻意对齐，见 `MeterLedgerGrid.vue:222` 注释） |
| 魔法值散落 | **轻微** | 期区字面量 `"p1"` 后端 4 个文件、`"dorm"` 7 个文件。已被 `ZoneService`/`ParamRegistry` 收编大部分（V113/V114 就是干这个的），残留量可接受 |
| 分层穿透 | **未发现** | `controller/` 目录 `QueryWrapper`/`@Select`/`jdbcTemplate` **零命中**；`@Select` 全后端只在 `mapper/AuditQueryMapper.java`（3 处，正确位置） |

### 性能

| 项 | 结果 | 证据 |
|---|---|---|
| N+1 查询 | **未发现，反而是正解** | `AllocService.java:525-529,846-876,1008-1027` 等处是**批量预载进 Map**（`selectList` 一次 + 内存 join），这正是 N+1 的修法 |
| 全表载入 | **111 处 `selectList(null)`** | `AllocService` 28、`BuildingService` 11、`BillNoticeService` 11…… 无 WHERE 全表进内存 |
| 当前风险量级 | **可接受** | 实测最大表 `report_amount` 14072 行；`meter` 1137、`contract` 431、`tenant` 386、`meter_reading` 2163。全库 78 张表都是小表 |
| 索引缺失 | **未发现** | 高频表全部覆盖：`meter_reading` 有 `uk(meter_id,ym)`+`idx(ym)`；`alloc_result` 有 `uk(ym,tenant_id,fee_key)`+`idx(ym)`+`idx(rule_id)`；`monthly_ledger` 有 `uk(company_id,tenant_id,period_year,period_month)`+两条查询索引；`report_amount` 有 6 列联合 uk + `idx_period` |
| 无分页全量列表 | **全站如此** | 见接口统一性章。当前数据量下 OK，**没有立分页契约**是欠账不是缺陷 |
| 昂贵计算未缓存 | 未发现 | `UserPermissionCache` 已缓权限；算账本来就要现算 |
| 大列表未虚拟化 | **未使用，但已分页兜住** | 租户 386 条在前端切成 39 页每页 10 条渲染，没有长列表一次铺开 |
| 静态资源未压缩 | **已做且有闸** | CI 有 `heavy-lib static import gate`（拦 exceljs 917KB / echarts 678KB 的静态 import）+ `scripts/size-check.mjs` 体积预算（首屏块 189KB，每次上调都有署名理由） |
| 慢查询观测 | **已建** | compose 配慢查询日志阈值 0.2s（不是默认 10s），配 `docs/OPS-SLOW-QUERY.md` |

---

## 前端审查

**总体评价：优秀。** `strict: true`、零 `v-html`、零硬编码密钥、零 reactive 解构陷阱、
零未清理定时器、`any` 全站仅 29 处（170 个 spec 除外）且集中在排序表泛型处。
问题不在工程质量，在**并发编辑这条线上有三个屏没跟上共享件**。

### Critical

**C1 · 死按钮：别人占锁时「编辑模式」可点，点了什么都不发生，且无接管路径**

- [`FPEditModeButton.vue:42`](frontend/src/components/fp/FPEditModeButton.vue:42) `:disabled="disabled"` —— 组件的禁用**不看 `held`**
- [`PvMeterView.vue:515-516`](frontend/src/views/pv/PvMeterView.vue:515) 传的是 `:disabled="!editMode && !!loadErr"`，`heldByOther` **不在禁用条件里**
- 点击 → `toggleEdit()` → `useEditLock.acquire()` → [`useEditLock.ts:87`](frontend/src/composables/useEditLock.ts:87) `if (!r.granted) { lockedBy.value = r.holder; return false }` —— 静默返回 false
- 屏内**没有 `FPTakeoverDrawer`**（三屏命中全 0），用户看到「张三 编辑中」，点不动，也无处申请接管

`CpMeterView.vue:518-519`、`ElecCostView.vue:571-572` 逐行同形。

**修改方案**：这三屏改走 `SchedHeader`（它已托管三件套），或直接补挂 `FPTakeoverDrawer` +
把 `heldByOther` 并进 `:disabled`。前者是正解——`SchedHeader` 就是为这个建的。

---

**C2 · 静默踢出：编辑中被接管，编辑态就地消失，一个字的提示都没有**

- 失锁通知按 scope 正确派发到屏（[`presence.ts:195-199`](frontend/src/stores/presence.ts:195)）
- 回调里 [`useEditLock.ts:130`](frontend/src/composables/useEditLock.ts:130) `evictedBy.value = e` 被赋值
- 但 [`PvMeterView.vue:42`](frontend/src/views/pv/PvMeterView.vue:42) 的解构里**没有 `evictedBy`**：
  `const { editMode, canEnter, asking, toggle: toggleEdit, cancelAsk, onElevated, heldByOther } = useEditMode(...)`
  （`CpMeterView.vue:51`、`ElecCostView.vue:45` 逐字相同）
- 屏内无 `FPEvictedDialog`；`AppShell`/`App.vue` 也**没有全局失锁兜底**（`FPEvictedDialog` 在 shell 层零命中）
- 结果：`editMode` 就地转假 → [`PvMeterView.vue:301`](frontend/src/views/pv/PvMeterView.vue:301) 的 `watch(editMode)` 关掉弹窗 → 用户的草稿没了，屏幕上什么也没说

**影响面比设计稿说的大**。稿里点名 3 个屏，实测**8 个屏**只有 `FPElevateDialog`、
无 Takeover 无 Evicted：`PvMeterView`、`CpMeterView`、`ElecCostView`、`MeterView`、
`PoolLedgerView`、`BillNoticesView`、`ParamCenterView`、`PayBookWindow`。
做对了的是走 `SchedHeader` 的那批 + `CoefBookWindow`、`LedgerWideTable`、三张报表屏
（它们连「复制我的改动」都接上了）。

**修改方案**：`FPEvictedDialog` 的正确用法在 [`CoefBookWindow.vue:71,522-524`](frontend/src/views/bills/CoefBookWindow.vue:522)——
解构 `evictedBy` + 挂弹窗 + `@close="evictedBy = null"`。8 个屏照抄，或统一收进 `SchedHeader`/shell 层。

### Suggestion

| # | 问题 | 证据 |
|---|---|---|
| S1 | **深链落空**：`/elec-cost?view=cost&y&m` 推得出、没人读 | [`ElecAnalysisView.vue:112`](frontend/src/views/analysis/ElecAnalysisView.vue:112) `router.push({path:'/elec-cost',query:{...}})`；`views/elec/` 目录 `route.query` **零命中** |
| S2 | **门栈不进 URL**：后退=整屏离开，不可分享/收藏/刷新 | Pv/Cp/Elec/Salary + 三个外壳共 7 个文件，`route.query` 与 `router.push` **全为 0** |
| S3 | **抽屉默认月硬编码**，月门已补但没接过去 | `PvRecordDrawer.vue:24,26` `acctM=ref('1')`/`occM=ref('12')`；`ChargingRecordDrawer.vue:30`、`ElecRecordDrawer.vue:29` 同；三屏 `FPMonthGate` 已在用，`initMonth` 零命中 |
| S4 | **在场头像三套口径** | `SchedYearGate.vue:63` 不排除自己；`BookMonthMatrix.vue:56` `.find(e=>!e.self)` 排除；新的 `FPMonthGate.vue` 干脆零 presence |
| S5 | **`onReactivated` 只补了一屏** | 命中：alloc×2/bills/contracts/ledger/meters/**CpMeterView**；缺：Pv/Elec/Salary |
| S6 | **受管年不回流** | `PvRecordDrawer.vue:33`、`ChargingRecordDrawer.vue:37`、`ElecRecordDrawer.vue:39` 的 `yearOpts` 只吃 `props.years`（overview 年份范围），自建年开抽屉下拉显示「请选择」 |
| S7 | **响应式欠账既没补也没记账** | 交接说明 §3 写明「要么挂 `fp-fluid`，要么在 spec 记欠账，别默默不管」。已挂：`ChainMonthGate.vue:91`、`SalaryView.vue:254,373`、`MeterView.vue:577`。**未挂**：`BookRailShell.vue`(0)、`FPMonthGate.vue`(0)、`PvMeterView.vue:443`、`CpMeterView.vue:459`、`ElecCostView.vue:522`。`RESPONSIVE-LAYOUT-SPEC.md` 中欠账记录零命中 |
| S8 | **测试 flake** | `billNoticeExcel.spec.ts` 全量跑 30s 超时、单跑 551ms 通过。建议给 exceljs 那条单独提 timeout |

---

## 用户流程走查

已登录（用户手动登入，我不被允许输入口令）。视口 1440×900。

| 流程 | 操作路径 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| 冷启动进站 | → `localhost:5173` | 渲染登录页 | 完整表单，console 零错误 | ✅ |
| 未登录访问受保护屏 | 地址栏 → `/tenants` | 弹回登录 | 落回登录页，未泄露业务数据 | ✅ |
| 未带令牌调接口 | `curl /api/probe/ping` | 401 | **401** | ✅ |
| **查** · 数据中心首页 | 登录后落地页 | 出真实数据 | 2024年2月 · 出账 4/4 · 附表 4/9 · 催缴单 295 张 ¥4,107,856.17（183 张有警告）；顶部有「219 份合同无租金计费行」的主动预警 | ✅ |
| **查** · 租户列表 | 侧栏 → 租户管理 | 列表 + KPI | 386 户、在租 385、月租金 ¥308万、25 户将到期；分期筛选 一期129/二期83/三期13/宿舍62 | ✅ |
| **查** · 公共电核算选期 | 侧栏 → 公共电核算 | 出选期矩阵 | 2023–2026 四年 × 12 月矩阵，有数据的月不标「空」，2025 标「手工年」、2026 标「当前年」，末尾「添加 2027 年」 | ✅ |
| **查** · 进 2024-02 工作面 | 点 2024年2月格 | 进公摊表 | 进屏，链路条（计费参数/园区抄表/公共电核算/楼栋损耗/催缴单）+ 期区页签 + 「待处理 42」+ 完整宽表（17 列，含分摊语义/分摊基数/加减度数/盈亏/备注） | ✅ |
| **改**（入口） · 进编辑态 | 点「编辑模式」 | 按钮变「完成」并出写入口 | 按钮变「完成」，新出现「新增池」「重新生成」 | ✅ |
| **改**（入口） · 开池抽屉 | 点池名「东侧货梯」 | 抽屉滑出 | 抽屉打开 = 池 88`一期 F座·天面东侧·货梯`，设计稿要点全部在位（见下） | ✅ |
| **改**（落库） · 一字不改点保存 | 点「保存并重算本月」 | PUT 200 且字段不变 | **未能执行**，见下「阻塞」 | ➖ |
| **增 / 删** | 新增池 / 删除池 | — | **未能执行**，同一阻塞 | ➖ |

### 池抽屉：设计稿逐条对现场

`_design/{Main,States,Flow}.dc.html` 的要点在真实抽屉里**全部可见**：

| 设计稿要求 | 现场 |
|---|---|
| 名字条常驻、不可手写 | ✅ 顶部「这个池叫 / 一期 F座·天面东侧·货梯」 |
| 四级定位 + 「改这里会改名」 | ✅ 期区/楼栋(空=园区级)/楼层(空=整栋)/侧向(空=整层)/费项(池名末段) |
| 电表搜索合并 + 其他位置 | ✅ 「算哪些电表 · 已选 1 块」+「其他位置 +1」 |
| 四档分段控件，每档带说明 | ✅ 按面积/按层份/户对户/园区自担，各带一行口径说明 |
| 按摊法分支渲染（份额列只在按层份） | ✅ 当前 floor 档，受益人表带「份额」列 + 「楼层(自动解析)」 |
| 高级收纳 | ✅ 「高级:分摊标准算式 · 四舍五入位数 · 折入链」折叠 |
| 按钮说清后果 | ✅ 「保存并重算本月」（不再是旧的「保存并重新生成」） |

**「已选 0 户」不是 bug**：库里 `alloc_rule_member` 中 rule_id=88 **确实零行**，抽屉说的是实话。

### 数据层顺带坐实：V115/V116 回填成功

```
id  name                     method  side
88  一期 F座·天面东侧·货梯    floor   东侧      ← 方位进了 side 列
89  一期 F座·天面·货梯        floor   NULL      ← 两者不再逐字同名
17  二期 五车间·广告字灯…     carrier NULL      ← F1 值域目标存在
92  一期 A座·一楼·联塑精铟    manual  NULL      ← F1 值域目标存在
23  一期 招商中心·四楼·净电   direct  NULL      ← F3 例外目标(park_loss_pool)
```

修复方案 F1–F4 在库里有对应痕迹，`V115`/`V116` 都已落到 `flyway_schema_history`。

### 阻塞：写路径没跑成

**原因是我的工具，不是应用的缺陷。** Browser 面板处于隐藏状态 → 页面不合成帧 →
合成鼠标点击不落地（`computer` 工具自己报过 `the Browser pane is not displayed, so the page is not compositing frames`）。

坐实过程，避免误判成应用 bug：
1. 点「保存并重算本月」（`computer left_click ref_1495` → 落点 1042,801），
2. 等 6 秒后查库：`alloc_result` 585 行 / Σ29269.53 / md5 `54bbea51…` 与保存前**完全一致**，
   **连 `alloc_rule.updated_at` 都还是 `2026-08-29 17:28:30`**，
3. 抓包：本次只有 GET，**零 PUT / 零 POST**。

→ 请求根本没发出。**这不能算「存回去没变」的通过**，只能算没跑。
（对照：同一颗按钮之外，我用 JS 直接 `.click()` 触发月格时应用**正常响应并进屏** ——
说明应用的事件绑定是好的，是合成点击这条路不通。而用 JS 驱动 UI 被工具策略拦下了，那条拦得对。）

**要继续需要**：把 Claude Code 的 Browser 面板**显示出来**（不是隐藏/后台）。
之后我按顺序补完：一字不改保存（验 F1–F4 验收）→ 新增池 → 删除池 → 催缴单生成 → 台账查看。

### 一条现场抓到的小问题

`GET /api/alloc/pool-candidates?ym=2024-02&buildingId=24&floor=天面&side=东侧&method=floor`
**同参数连发两次**（请求 id `44772.2729` 与 `44772.2730`）。开一次抽屉打两回同样的候选查询。
不影响正确性，属浪费。

### 未能独立复核的一项

一期页签底部「合　计 7,710.2 度 / 9,100.82 元」，我按 `alloc_pool_result ⋈ alloc_rule ⋈ building`
重新聚合（排除 `ref`、carrier 只计度）得不到同一个数。
**这不构成"对不上"的结论**——我不掌握该页签到底纳入哪些池（园区级怎么归属、小计分组规则），
按错误的口径复算本来就对不上。列在这里是标明**这一项没验**，不是报缺陷。

## 风险识别汇总

| # | 风险 | 证据 | 建议动作 |
|---|---|---|---|
| **1** | 编辑中被接管 → 草稿静默消失，**8 个屏**中招 | `PvMeterView.vue:42` 等三屏解构无 `evictedBy`；shell 层无兜底 | 照 `CoefBookWindow.vue:522` 补 `FPEvictedDialog`，或收进 `SchedHeader` |
| **2** | 别人占锁时按钮可点但无反应，**无接管路径** | `FPEditModeButton.vue:42` + `PvMeterView.vue:516` | 三屏改走 `SchedHeader`，或补 `FPTakeoverDrawer` + `heldByOther` 进 `:disabled` |
| 3 | 三个明细屏没用共享脚手架，每加一屏多复制一份洞 | 三屏 `useSchedScreen` 命中 0，样板各 32/35/39 处 | 下次动这三屏时并入 `useSchedScreen`，别再新增第四份 |
| 4 | 分页契约没立，第一个撑不住的屏会现发明一套 | 全后端 `PageResult`/`selectPage` 零命中 | 现在不用做。**先约定**：超过 N 行的列表走哪套分页，写进 API-CONTRACT-SPEC |
| 5 | 门栈不进 URL，后退/分享/刷新全丢 | 7 个文件 `route.query` 零命中；`ElecAnalysisView.vue:112` 的深链落空 | 与 S1 一起做——深链落点和门栈是同一件事 |
| 6 | 响应式欠账无人记账（违反自定规矩） | 5 处新屏根/失败面缺 `fp-fluid`；spec 无记录 | 二选一：补挂 + 390 抽查，或在 `RESPONSIVE-LAYOUT-SPEC` 记一笔 |
| 7 | 生产库里躺着 6 张调研临时表 | `park_demo3` 78 张表中有 `_fx_alloc_result`(1135)、`_fx_loss_result`(22)、`_fx_pool_result`(294)、`_pre_alloc_result`(1135)、`_pre_loss_result`(22)、`_pre_pool_result`(294) | 确认池修复回归比对已完成后 drop；或改名加 `zz_` 前缀标明非业务表 |
| 8 | 源册跨表引用错行**未修**（数据问题，非代码） | `pool-entry-coverage-audit.md` 附录：`创显承担电费!C4:D11` 到 2024-02 一次没修对，5 个月差额 +1170.62/+349.53/+195.58/+213.64/−233.71；`公共电分摊明细!S8` 少计 1886.02 度 | 引擎不读工作簿（`AllocService.poolSegQty:1660` 现算），**计算不受影响**。但源册本身没修，也没有修复计划文件——要么立项，要么写明不修的理由 |
| 9 | 测试 flake（冷跑超时） | `billNoticeExcel.spec.ts` 30s 超时 / 单跑 0.55s | 给该条 `testTimeout` 单独放宽 |
| 10 | 同一抽屉打开时 `pool-candidates` 同参数连发两次 | 抓包 `44772.2729`/`44772.2730` 参数逐字相同 | 低优先。查一下抽屉里是不是有两个 watch 都在触发候选查询 |
| 11 | 仓库根目录杂物 | 入库的 5 个 `*-plan.tsv`（`building-reclass-plan.tsv` 等）；未入库但躺着的 27 个 `backup-*.sql`（gitignore 已挡）；一个**空的野生 `node_modules/`**（无 `package.json`） | 低优先。`*-plan.tsv` 归到 `backend/scripts/fixes/`（那里已有同类）；空 `node_modules` 删掉 |

---

## 附：本次审查未覆盖

- **写路径 UI 走查（增/删/改落库）**：Browser 面板隐藏导致合成点击不落地，见该章「阻塞」。
  面板显示出来后可立即补完，其余读路径已走。
- **后端测试实跑**：`mvn verify` 需 Docker Testcontainers，耗时长，未在本次跑。
  CI 每次 push 都跑（`.github/workflows/ci.yml:20-22` `./mvnw -B verify`），以 CI 为准。
- **单函数行数统计**：只统计了文件级，未逐函数量。
- **移动端适配**：`components/shell/mobile/` 存在但未走查。
