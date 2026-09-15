# demo3 阶段性验收报告

> 2026-08-31。审查基线 `master` @ `e943180`（PR #20 合并后），审查分支 `review/stage-2026-08-31`。
> 只读审查，未修改任何项目代码。
> 环境：后端 `localhost:8481`（spring-boot:run，dev profile）、前端 `localhost:5173`（vite dev）、
> MySQL `demo3-mysql` 容器（`park_demo3`，78 张表）。
>
> **这是第二轮。** 上一轮见 [stage-review-2026-08-30.md](stage-review-2026-08-30.md)，基线 `5a29c06`，
> 中间 15 个提交。本轮除全量复核外，逐条回访上一轮的 2 条 Critical + 11 条风险。

---

## 结论

**能否支撑后续功能开发：能。没有阻塞项。**

上一轮点名的两条 Critical（死按钮 C1、静默踢出 C2）**已修，且我独立验到了修复链的每一环**，
不是「提交信息说修了」。全量测试 172 文件 / 1914 断言全绿，上一轮那条 30s 超时 flake 本轮没复现。

本轮**没有新增 Critical**。工程护栏（strict TS、零 v-html、无分层穿透、CI 跑真 MySQL IT、
体积预算 + 重型库静态 import 门禁）全部在位且未退化。

一条**上一轮的误判需要撤回**：风险 6「响应式欠账无人记账」是我上一轮量错了文件，
欠账其实**逐字记在代码里**，详见「风险回访」表。

---

## 功能清单与验证状态

阶段 0 盘点（本轮实测，与上一轮逐项对比）：

| 维度 | 2026-08-30 | 2026-08-31 | 变化 |
|---|---|---|---|
| 后端 controller | 39 | **39** | — |
| 后端端点 | 261 | **261**（GET 109 / POST 67 / DELETE 42 / PUT 33 / PATCH 10） | — |
| Flyway 迁移 | 115 | **115**（库内最新 `V116__pool_fee_name_backfill.sql`） | — |
| 前端 view 文件 | — | **95** | — |
| 前端 spec 文件 | 170 | **172** | +2（锁弹窗覆盖 + 抄表期流） |
| 前端断言 | 1891（1 红） | **1914（0 红）** | +23，转全绿 |
| service / entity / mapper / dto | — | 44 / 60 / 61 / 180 | — |

| 功能/页面 | 验证状态 | 证据 | 风险 |
|---|---|---|---|
| 后端启动 | ✅通过 | `Started Demo3Application in 8.55 seconds`，Tomcat 8481，Flyway 到 V116 | — |
| 前端构建/开发服 | ✅通过 | vite dev 5173 起，页面渲染无 console 错误 | — |
| 登录页渲染 | ✅通过 | `read_page` 拿到完整表单（账号/密码/显示密码/记住登录/忘记密码/登录） | — |
| 未登录路由守卫 | ✅通过 | 地址栏直访 `/tenants` → `location.pathname === "/login"`，未泄露业务数据 | — |
| 后端鉴权 | ✅通过 | `/api/probe/ping`、`/api/tenants`、`/api/alloc/rules` 全部 **401**；错误体也走同一信封 `{"code":401,"message":"未认证或令牌无效","data":null,"traceId":"1bcc002dfa9a4c94"}` | — |
| actuator 暴露面 | ✅通过 | `/actuator/health` 200（探针需要），`/api/actuator/health` 401（不给业务前缀开后门） | — |
| CORS | ✅通过 | dev 回显任意 Origin（`application-dev.yml:14` `${CORS_ALLOWED_ORIGINS:*}` 明写「dev 全开」）；**未开 allowCredentials**（`CorsConfig.java` 全文无该调用），令牌走 `Authorization` 头不走 Cookie，故 dev 通配不可被跨站利用；prod 由 `application-prod.yml:9` 无默认值注入，缺失即 fail-fast | — |
| 前端测试套件 | ✅通过 | **172 文件 / 1914 断言全绿，EXIT=0**（不接管道，退出码取自 vitest 本身） | — |
| C1 死按钮修复 | ✅通过 | 修复链四环全验，见「前端审查」 | — |
| C2 静默踢出修复 | ✅通过 | 7 屏挂点形状逐字一致，见「前端审查」 | — |
| UI 走查（读路径） | ✅通过 | 见「用户流程走查」 | — |
| UI 走查（写路径：增删改） | ➖未完成 | **口令不能由我输入**（安全铁律：不代输密码）。工具侧阻塞已消失，见下 | — |

**上一轮的工具阻塞已解除**：合成点击现在能落地。坐实方式——读密码框 `type` = `"password"`
→ `computer left_click ref_17`（「显示密码」钮）→ 再读 `type` = `"text"`。
上一轮「Browser 面板隐藏 → 合成点击不落地」的现象本轮未复现，写路径走查**只差登录**。

---

## 后端

### 目录责任表

| 目录 | 职责 | 代表文件 | 判定 |
|---|---|---|---|
| `common/` (8) | 返回信封、异常收口、链路追踪、慢请求埋点 | `Result.java`、`GlobalExceptionHandler.java`、`ResponseWrapAdvice.java` | 职责清晰 |
| `config/` (5) | 启动期装配与种子 | `CorsConfig.java`、`AdminInitializer.java`、`MyBatisPlusConfig.java` | 职责清晰 |
| `controller/` (39) | HTTP 入口，只做参数绑定与转发 | `TenantController.java`（6 端点，14 行有效代码） | 职责清晰，**无一处 SQL/QueryWrapper**（实测 0 文件命中） |
| `dto/` (180) | 请求/响应契约 | `TenantCreateReq.java` | 数量大但单一职责 |
| `entity/` (60) / `mapper/` (61) | 表映射 / MyBatis 接口 | — | 一表一件，对得上 |
| `security/` (12) | 认证、权限注册表、提权、在场、锁 | `PermissionRegistry.java`、`WriteAccessManager.java` | 职责清晰 |
| `service/` (44) | 业务与算账 | `AllocService.java`（2412 行） | **一个巨型件，见「代码质量」** |

**唯一职责不清处仍是 `AllocService.java`**，与上一轮结论一致，行数一字未变（2412）。
本轮补上了上一轮没做的**单函数量化**（见下）。

### 接口统一性

**结论：统一。** 全站一个信封，`ResponseWrapAdvice` 自动套，controller 返回裸 DTO：

```java
// common/Result.java:3
public record Result<T>(int code, String message, T data, String traceId)
```

```java
// common/ResponseWrapAdvice.java:11,19-30
@RestControllerAdvice(basePackages = "com.park.demo3.controller")
if (body instanceof Result<?>) return body;
if (body instanceof String s) { /* StringHttpMessageConverter 绕过，手动序列化 */ }
return Result.ok(body);
```

增删查改四类同一套写法，实例（`controller/TenantController.java:15-28`）：

```java
@GetMapping             public List<TenantDTO>  list()                                    // 列表
@GetMapping("/{id}")    public TenantDetailDTO  detail(@PathVariable Integer id)          // 详情
@PostMapping            public TenantDTO        create(@Valid @RequestBody TenantCreateReq req)   // 增
@PutMapping("/{id}")    public TenantDTO        update(@PathVariable Integer id, @Valid ...)      // 改
@DeleteMapping("/{id}") public void            delete(@PathVariable Integer id)           // 删
```

**没找到互相矛盾的两处实例。** 未认证的真实响应体（curl 实测）也走同一信封，
说明连 SecurityConfig 的拒绝路径都没漏套。

**一处刻意的不一致（已文档化，不是缺陷）**：HTTP 状态码与业务码分两轨，
口径写在 `common/GlobalExceptionHandler.java:15-20` 的注释里：

| 失败类型 | HTTP | body.code | 证据 |
|---|---|---|---|
| `BizException` | **200** | 400/403/409/429 | `GlobalExceptionHandler.java:24-29` |
| `DuplicateKeyException` | **200** | 409 | `:70-75` |
| `NoSuchElementException` | **200** | 404 | `:88-93` |
| Bean Validation 失败 | **400** | 400 | `:31-37` |
| 缺必填参数 / 类型不匹配 / 完整性违反 | **400** | 400 | `:50-55`、`:59-65`、`:79-84` |
| 未认证 / 无权限 | **401 / 403** | 401 / 403 | SecurityConfig（curl 实测 401） |
| 未捕获 | **500** | 500 | `:95-100` |

调用方要按两轨判。前端 `api/index.ts` 拦截器对非 2xx 也解包信封，业务代码不受影响。
**保持现状**，但新写 IT 时必须知道，否则断言写错方向。

**分页：后端零分页，前端客户端分页。** `PageResult`/`IPage`/`selectPage`/`Pageable`
全后端**零文件命中**（本轮复测）。所有列表端点返回完整 `List<T>`。
当前数据量下正确（最大表 `report_amount` 14072 行），但**分页契约没有立**——
第一个撑不住的屏会临时发明一套。与上一轮结论相同，欠账未偿。

### 封装边界盘点（四问）

| 封装 | ①复用框架什么 | ②自定义什么 | ③解决什么真问题 | ④去掉会怎样 |
|---|---|---|---|---|
| `ResponseWrapAdvice` | Spring `ResponseBodyAdvice` | 信封自动套 + String 返回的 converter 绕过 | 261 个端点不用各写 `Result.ok()` | 261 处样板 + 漏套即前端解包炸 → **留** |
| `GlobalExceptionHandler` | `@RestControllerAdvice` | 8 类异常 → 中文可读文案 + 两轨状态码 | 异常不泄栈、文案统一、监控能按 4xx 统计 | 用户看到 500 裸栈 → **留** |
| `CorsConfig` | Spring `CorsConfigurationSource` | 逗号白名单 + 显式 PATCH | PATCH 一度缺席导致 8 个端点被 CORS 拒成 403（`CorsConfig.java:16-17` 记着事故） | 8 个写端点在浏览器里全挂 → **留** |
| `api/index.ts` | axios 拦截器 | 跨标签页身份漂移守卫 | 同机换账号后老标签页把操作记到别人头上 | 审计失真 → **留** |
| `security/PermissionRegistry` | Spring Security | URL→权限键注册表 | 权限点集中一处 | 权限散落 39 个 controller → **留** |
| `useEditMode` + `useEditLock` + `presence` | Vue composable | 多屏多锁、逐把续期、代次守卫、重入闸 | 两个人同期同改互相整片覆盖 | 静默丢工作 → **留** |
| **`FPLockDialogs`（本轮新增，34 行）** | — | 接管抽屉 + 失锁弹窗的**单一挂点** | 上一轮查出的病根「每屏各接一遍，漏了没人发现」 | 回到 7 屏 × 2 个弹窗手接 = 病根再种七回 → **留** |
| `common/SlowRequestFilter` | Servlet Filter | >500ms 请求埋点 | 配 `docs/OPS-SLOW-QUERY.md` 定位慢查询 | 少一个观测点 → 留 |

**过度设计检查：未发现。**
- 单实现 interface：**0 个**（`grep "^public interface"` 排除 `/mapper/` 后零命中）
- 只有一个取值的配置项：**0 个**
- 「为将来」预留的空架子：**0 个**。全库 `TODO`/`FIXME`/`XXX`/`HACK` **零命中**（前后端合并搜）

**`FPLockDialogs` 单独过一遍四问**（本轮唯一的新封装，34 行，纯透传无逻辑）：
它不含 `FPElevateDialog`（7 屏各自都有且工作正常，不搅动能用的代码），
不含 `dirtyCount`/`copyText`（四个有草稿态的屏序列化各不相同，另立项）。
**边界划得准，是本轮质量最高的一处改动。**

---

## 代码质量

### 屎山信号

| 信号 | 结果 | 证据 |
|---|---|---|
| 重复代码 | **发现 1 处（结构性，未偿）** | `PvMeterView` vs `CpMeterView`：**180 行非平凡完全相同**（去空行、去纯括号、长度 >25）；vs `ElecCostView`：77 行。三屏 `useSchedScreen` 命中仍**全为 0**，而 6 个外壳屏（`PvView`/`ElecView`/`ChargingView`/`SalaryView`/`S10View`/`UtilitiesView`）都在用 |
| 巨型文件 | **发现 5 个（未变）** | 后端 `AllocService.java` 2412、`BillNoticeService.java` 1314、`ContractService.java` 1082；前端 `PoolLedgerView.vue` 1563、`BillNoticesView.vue` 1369 |
| 巨型函数 | **本轮补量：4 个 >100 行，全在 `AllocService`** | `poolContributions()` **187 行**（:1202）、`computePools()` 136 行（:1812）、`pools()` 106 行（:1975）、`loadCtx()` 104 行（:1005） |
| 死代码 | **未发现** | `TODO`/`FIXME` 零命中；`@ts-ignore`/`@ts-expect-error` **0 处** |
| 命名混乱 | **未发现** | 前后端同概念同名 |
| 魔法值散落 | **轻微（未变）** | 期区字面量残留，已被 `ZoneService`/`ParamRegistry` 收编大部分 |
| 分层穿透 | **未发现** | `controller/` 目录 `QueryWrapper`/`@Select`/`jdbcTemplate` **0 文件命中**；`@Select` 全后端**只在 `/mapper/` 下**（目录外零命中） |

**关于那 180 行重复的诚实口径**：其中开头一大段是 `import` 语句和共享组件引用
（`FPEditModeButton`/`FPElevateDialog`/`FPLockDialogs`/`useEditMode`/`useMonthGate`/`FPMonthGate`…），
这类「相同」是共用同一套件的正常结果，不是 copy-paste 债。
真正的债是**加载/失败/编辑三态状态机各写一份**：`loadErr|readErr` 命中 26/19/14、
`seq` 5/6/17、`fp-stale` 3/5/5、`FPLoadError` 3/3/3、`editMode` 10/13/9。
**这次修锁弹窗时已经付过一次利息**——同一处改动在三个文件里各贴一遍。

### 性能

| 项 | 结果 | 证据 |
|---|---|---|
| N+1 查询 | **未发现** | `AllocService` 的批量预载进 Map 是 N+1 的修法，不是 N+1 |
| 全表载入 | **115 处 `selectList(null)`**（上轮 111，+4） | `AllocService` 28、`BuildingService` 11、`BillNoticeService` 11、`ContractService` 7… 全部在 `service/` 层（正确位置），但无 WHERE 全表进内存 |
| 当前风险量级 | **可接受** | 实测最大表 `report_amount` 14072、`bill_notice_line` 6976、`monthly_ledger` 3883、`report_account` 3868、`pv_reading` 3027。78 张表全是小表 |
| 索引缺失 | **未发现** | 与上轮一致，高频表 uk + 查询索引齐 |
| 无分页全量列表 | **全站如此** | 见接口统一性。当前数据量下 OK，**欠的是契约不是性能** |
| 昂贵计算未缓存 | 未发现 | `UserPermissionCache` 已缓权限（启动日志实测 `permission cache reloaded: 3 active users`） |
| 大列表未虚拟化 | 未使用，已被前端分页兜住 | — |
| 静态资源未压缩 | **已做且有闸** | CI `heavy-lib static import gate`（`ci.yml:36-48`，拦 exceljs/echarts 静态 import）+ `scripts/size-check.mjs` 体积预算 |
| 重复请求 | **发现 1 处** | 见「前端审查 S-新1」 |
| 慢查询观测 | **已建** | compose 配 `--long_query_time=0.2`（不是 MySQL 默认 10s） |

---

## 前端审查

**总体评价：优秀。** 上一轮的两条 Critical 已修且验证通过，本轮**无新增 Critical**。

护栏复测（全部保持）：`strict: true`、**零 `v-html`**、**零 `innerHTML`/`eval`**、
**零硬编码密钥**、**零 `@ts-ignore`**、`any` 仅 29 处（非 spec）、
**零 reactive 解构陷阱**（3 处 `= reactive(` 全是 `reactive(new Map/Set)` 和 `reactive(数组)`，不是对象解构）、
**定时器全部成对清理**（`presence.ts:214/245`、`auth.ts:72/73`、`FPElevateDialog.vue:126/131` + `onUnmounted(stopTick)`）。

### Critical

**无。** 上一轮的 C1/C2 已修，逐环复验如下。

#### C1（死按钮）已修 —— 修复链四环全验

1. 占锁失败时填 holder：[`useEditLock.ts:87`](frontend/src/composables/useEditLock.ts:87) `if (!r.granted) { lockedBy.value = r.holder; return false }`
2. `useEditMode` 把它导出：[`useEditMode.ts:69,235`](frontend/src/composables/useEditMode.ts:69) `const { lockedBy, evictedBy } = lock`
3. 屏透传给共享件：7 屏逐字 `:locked-by="lockedBy"`
4. 抽屉据此自动开：[`FPTakeoverDrawer.vue:31`](frontend/src/components/fp/FPTakeoverDrawer.vue:31) `const open = computed(() => !!props.holder)`

→ 别人占锁时点「编辑模式」**现在会弹接管抽屉**，不再是点了没反应。
接管成功回 `@taken="onTaken"` → [`useEditMode.ts:144-147`](frontend/src/composables/useEditMode.ts:144) 复用私有 `enter()`
（保住重入闸与「占锁往返期间换期就还锁」两道守卫）。

#### C2（静默踢出）已修 —— 7 屏挂点形状逐字一致

7 屏全部命中，且**两个 close 都接了**（覆盖度测试并没断言这两个，是实际写对了）：

```html
<!-- PvMeterView.vue:759-761，其余 6 屏逐字同形 -->
<FPLockDialogs :locked-by="lockedBy" :evicted-by="evictedBy" :scope="lockScope()"
               :what="`光伏分栋抄表 ${year} 年`"
               @taken="onTaken" @close-takeover="lockedBy = null" @close-evicted="evictedBy = null" />
```

| 屏 | 行号 | `what` 文案 |
|---|---|---|
| `PvMeterView.vue` | 759 | 光伏分栋抄表 ${year} 年 |
| `CpMeterView.vue` | 770 | 充电桩分桩明细 ${year} 年 |
| `ElecCostView.vue` | 771 | 电费成本总览 ${year}-${MM} |
| `MeterView.vue` | 855 | 园区抄表 ${year} 年 |
| `PoolLedgerView.vue` | 938 | 公共电核算 ${ym} |
| `BillNoticesView.vue` | 1186 | 催缴单 ${ym} |
| `ParamCenterView.vue` | 815 | 计费参数 ${ym} |

**第 8 屏 `PayBookWindow` 是故意排除的，不是漏网。** 我按源码独立推导了一遍覆盖度
（枚举所有 `useEditMode` 消费方，再筛「三个锁件一个都没挂」的），
唯一落单的 `PayBookWindow.vue` 里 `useEditMode` **只出现在注释里**——
它自带 `const editMode = ref(false)`（:53）和自己的 `asking`（:41），
理由写在 :60-61：「本窗口不走 useEditMode，也没有编辑锁（收款簿改的是 `bill_pay_company`，
不进出账链快照）」。**没有锁就没有失锁弹窗可挂，排除正确。**

### Suggestion

| # | 问题 | 证据 | 上轮状态 |
|---|---|---|---|
| **新1** | **覆盖度测试是白名单，挡不住第 8 屏**：`SCREENS` 是硬编码字面量数组，新加一个用 `useEditMode(perms,{scope})` 的屏若忘了挂 `FPLockDialogs`，**测试照样绿**。测试自己也承认靠人「加屏加一行」 | [`lockDialogsCoverage.spec.ts:20-28`](frontend/src/views/__tests__/lockDialogsCoverage.spec.ts:20) 的 `const SCREENS = [...]` 是 7 条字面量；全仓无任何测试枚举 `useEditMode` 调用方 | 新增 |
| **新2** | **该测试不断言两个 close 事件**：5 条断言只覆盖 `<FPLockDialogs`、`:locked-by`、`:evicted-by`、`:scope`、`@taken`。漏 `@close-evicted` 的屏会得到一个**关不掉的失锁弹窗**，而测试绿 | [`lockDialogsCoverage.spec.ts:36-40`](frontend/src/views/__tests__/lockDialogsCoverage.spec.ts:36) 五条 `expect` 逐条读过；7 屏当前**都写对了**，所以这是「护栏有缺口」不是「现在有 bug」 | 新增 |
| **新3** | **开一次池抽屉发两次同参候选查询**：根因是 `openPool()` 先同步写 `form.value = {...}`（改了 buildingId/floorLabel/side）、再 `poolDlg.value = true`（:657）、再直接 `loadCands()`（:658）；而 :688 那个 watch 是 pre-flush，下一个 tick 才跑，那时 `poolDlg.value` 已是 true，守卫放行 → 第二趟。`candSeq` 只挡住了「旧响应覆盖新响应」，挡不住多发一趟 | [`PoolLedgerView.vue:657-658`](frontend/src/views/alloc/PoolLedgerView.vue:657) 与 [`:688-689`](frontend/src/views/alloc/PoolLedgerView.vue:688)。上一轮是抓包看到的现象，本轮定位到根因 | 上轮 R10，根因已定位 |
| S1 | **深链落空**：`/elec-cost?view=cost&y&m` 推得出、没人读 | `views/elec/` 目录 `route.query` **零命中**（本轮复测） | 未偿 |
| S2 | **门栈不进 URL**：后退=整屏离开，不可分享/收藏/刷新 | 7 个门屏（Pv/Cp/Elec/Salary + 三壳）`route.query` 与 `router.push` **全为 0**（本轮逐文件复测） | 未偿 |
| S3 | 抽屉默认月硬编码 | 上轮证据，本轮未复测 | 未复核 |
| S4 | 在场头像三套口径 | 上轮证据，本轮未复测 | 未复核 |
| S5 | `onReactivated` 只补了一屏 | 上轮证据，本轮未复测 | 未复核 |
| S6 | 受管年不回流 | 上轮证据，本轮未复测 | 未复核 |
| S8 | **测试 flake 未加防护**：全仓 `testTimeout` 零配置 | `vite.config.ts` 无 `testTimeout`；`billNoticeExcel.spec.ts` 内无单条 timeout。本轮它跑了 **2634ms**（上轮撞 30s 上限），说明缺陷仍在、只是没触发 | 未偿（本轮未复现） |

---

## 用户流程走查

视口 1281×720。**未登录**（口令不能由我输入 —— 不代输密码是硬规则）。

| 流程 | 操作路径 | 预期 | 实际 | 状态 |
|---|---|---|---|---|
| 冷启动进站 | → `localhost:5173` | 渲染登录页 | 完整落地页 + 登录表单（账号/密码/记住登录/忘记密码/登录），console 零错误 | ✅ |
| 未登录访问受保护屏 | 地址栏 → `/tenants` | 弹回登录 | `location.pathname === "/login"`，页面无任何业务数据 | ✅ |
| 表单交互可用性 | 点「显示密码」钮 | 密码框 `type` 翻转 | `password` → `text`（再点回 `password`） | ✅ |
| 未带令牌调业务接口 | curl `/api/tenants`、`/api/probe/ping`、`/api/alloc/rules` | 401 | 全部 **401**，且返回体走统一信封带 traceId | ✅ |
| 探针端点 | curl `/actuator/health` | 200 | **200**（且 `/api/actuator/health` 是 401，没给业务前缀开后门） | ✅ |
| **增 / 删 / 改（写路径落库）** | 登录后走 UI | — | **未执行**，卡在登录 | ➖ |

### 阻塞：登录

**上一轮的工具阻塞（Browser 面板隐藏 → 合成点击不落地）本轮已消失**，实测点击能落地。
现在唯一卡点是**登录口令必须由你手输**——代输密码是我不能做的动作，与应用无关。

登录后我按顺序补完：数据中心首页 → 租户列表 → 公共电核算选期 → 进工作面 →
一字不改保存（验落库）→ 新增池 → 删除池 → 催缴单生成 → 台账查看，
外加一条**双标签页占锁走查**（专门验本轮 C1/C2 的修复在真页面上成立，不只在源码里成立）。

---

## 上一轮风险回访

| # | 上轮风险 | 本轮结论 | 证据 |
|---|---|---|---|
| **1** | C2 静默踢出，8 屏中招 | ✅ **已修** | 7 屏挂 `FPLockDialogs`；第 8 屏 `PayBookWindow` 无锁，排除正确（`PayBookWindow.vue:53,60-61`） |
| **2** | C1 死按钮无接管路径 | ✅ **已修** | 修复链四环全验，见前端审查 |
| 3 | 三屏没用共享脚手架 | ⚠ **未偿，且已付一次利息** | 三屏 `useSchedScreen` 仍为 0；Pv vs Cp 有 180 行非平凡完全相同；本轮修锁弹窗就是同一改动贴三遍 |
| 4 | 分页契约没立 | ⚠ **未偿** | `PageResult`/`selectPage`/`Pageable` 全后端零文件命中 |
| 5 | 门栈不进 URL / 深链落空 | ⚠ **未偿** | 7 个门屏 `route.query`+`router.push` 全 0 |
| **6** | 响应式欠账「没补也没记账」 | ❌ **上轮误判，本轮撤回** | 见下 |
| 7 | 生产库躺 6 张调研临时表 | ⚠ **未偿，行数一字未变** | `_fx_alloc_result` 1135 / `_fx_loss_result` 22 / `_fx_pool_result` 294 / `_pre_alloc_result` 1135 / `_pre_loss_result` 22 / `_pre_pool_result` 294 |
| 8 | 源册跨表引用错行未修（数据问题） | ⚪ **本轮未复核** | 引擎不读工作簿，计算不受影响 |
| 9 | 测试 flake | ⚠ **未偿，本轮未复现** | 全仓 `testTimeout` 零配置；该 spec 本轮 2634ms |
| 10 | `pool-candidates` 同参连发两次 | ⚠ **未偿，但根因已定位** | `PoolLedgerView.vue:657-658` + `:688`，见 Suggestion 新3 |
| 11 | 仓库根目录杂物 | ⚠ **基本未偿** | 6 个 `*-plan.tsv`/`*.tsv` **已入库**（`building-reclass-plan.tsv` 等 tracked）、`restructure-plan.csv` untracked；野生 `node_modules/` 现在是**空目录**（0 项，无 `package.json`），删掉即可 |

### 撤回风险 6：欠账其实记得清清楚楚

上一轮我数了 `PvMeterView.vue`/`CpMeterView.vue`/`ElecCostView.vue` 里 `fp-fluid` 的命中数（全 0），
就判「响应式欠账既没补也没记账，违反自定规矩」。**这个量法错了。**

地板规则是 [`base.css:124`](frontend/src/styles/base.css:124) 的
`.fp-content > :first-child:not(.fp-fluid) { min-width: 800px; }`——
它只作用于 `.fp-content` 的**直接首子元素**，也就是**外壳**，不是嵌在壳里的明细屏。
三个明细屏根本不是那个 `:first-child`，在它们身上数 `fp-fluid` 数不出任何东西。

外壳上的写法是**条件挂**，而且逐字写明了为什么：

```html
<!-- PvView.vue:139-142 -->
<BookRailShell ... :class="{ 'fp-fluid': mode !== 'meter' }">
<!-- fp-fluid 条件挂(RESPONSIVE-LAYOUT-SPEC §8)：…报送台账各态已迁移，摘 800px 地板；
     分栋抄表(PvMeterView) 未迁移，渲染在壳内，那本账保地板(响应式侧原话「不挂、保地板」)。
     迁移完那屏后把条件拆掉。 -->
```

`ElecView.vue:155`（`mode !== 'cost'`）、`ChargingView.vue:162`（`mode !== 'meter'`）逐行同形。
即：**哪本账迁完了、哪本还欠着、欠着的怎么办、什么时候拆掉这个条件，四件事全写在挂点上。**
全仓 29 个文件挂 `fp-fluid`。

这不是「没记账」，是**记在代码里而不是记在 spec 文件里**。风险 6 撤回。

---

## 风险识别汇总

按严重度排序。**无阻塞项**——下面每一条都可以在继续开发的同时处理。

| # | 风险 | 证据 | 建议动作 |
|---|---|---|---|
| **1** | **护栏有缺口：锁弹窗覆盖度测试是白名单 + 漏断言 close** —— 第 8 个屏漏挂不会被发现；漏 `@close-evicted` 会给出关不掉的弹窗而测试绿 | `lockDialogsCoverage.spec.ts:20-28`（硬编码 7 条）、`:36-40`（5 条断言无 close） | 把 `SCREENS` 从**源码推导**：扫 `views/` 里所有 `useEditMode(` 且传了 `scope` 的文件，再逐个断言。顺手补 `@close-takeover`/`@close-evicted` 两条。改完这条，「加屏忘接」这个病根才算真封上 |
| 2 | 三个明细屏不走共享脚手架，每加一屏多复制一份洞 | 三屏 `useSchedScreen`=0；Pv vs Cp 180 行非平凡相同；本轮修锁就贴了三遍 | 下次动这三屏时并入 `useSchedScreen`，**别再新增第四份**。现在不必专门立项 |
| 3 | 分页契约没立，第一个撑不住的屏会现发明一套 | 后端 `PageResult`/`selectPage`/`Pageable` 零命中 | 现在不用实现。**先约定**：超过 N 行的列表走哪套分页形状，写进 API-CONTRACT-SPEC |
| 4 | 门栈不进 URL + 深链落空 | 7 个门屏 `route.query`/`router.push` 全 0；`ElecAnalysisView` 推的深链没人读 | 与深链落点一起做，是同一件事 |
| 5 | 生产库躺 6 张调研临时表（2902 行） | `_fx_*` / `_pre_*` 六张，行数与上轮一字不差 | 确认池修复回归比对已完成后 drop；或加 `zz_` 前缀标明非业务表 |
| 6 | `AllocService` 有 4 个 >100 行的函数，最长 187 行 | `poolContributions()`:1202、`computePools()`:1812、`pools()`:1975、`loadCtx()`:1005 | **现在别拆**（有 `AllocServiceTest` 936 行 + `AllocApiIT` 1424 行兜着，拆的风险大于收益）。等下次要动计算内核时顺手切出 `AllocCalcEngine` |
| 7 | 测试 flake 无防护 | 全仓 `testTimeout` 零配置 | 给 `billNoticeExcel.spec.ts` 那条单独放宽 timeout。一行的事 |
| 8 | 开一次池抽屉发两次同参候选查询 | `PoolLedgerView.vue:657-658` + `:688` 的 pre-flush watch 竞态 | 低优先。`loadCands()` 那一行去掉，让 watch 单独负责；或给 watch 加一个「首次不跑」的守卫 |
| 9 | 仓库根目录杂物 | 6 个 `*.tsv` 已入库、1 个 `.csv` 未入库；空 `node_modules/` | 低优先。`*-plan.tsv` 归到 `backend/scripts/fixes/`（那里已有同类）；空 `node_modules` 删掉 |
| 10 | 源册跨表引用错行未修（数据问题，非代码） | 上一轮证据，本轮未复核 | 引擎不读工作簿，计算不受影响。要么立项修源册，要么写明不修的理由 |

---

## 附：本次审查未覆盖

- **写路径 UI 走查（增/删/改落库）**：卡在登录口令不能由我输入。工具阻塞已解除，登录后即可补完。
- **锁弹窗的真页面走查**：C1/C2 的修复我验到了源码链路四环 + 单测，但**没在双标签页真占锁下走一遍**。
  这是登录后第一件要补的事。
- **断言破坏验证**：本轮**没做**。只读审查铁律不允许我改项目代码，
  而破坏验证要求临时改源码看断言是否翻红。上一轮做过（`lockDialogsCoverage.spec.ts:38-40`
  的注释记着当时撞到的注释假阳性并已修），本轮的新断言沿用同一套 `stripComments` 前置。
  **要真做，需要你许可我在临时 worktree 里改。**
- **后端测试实跑**：`mvn verify` 需 Testcontainers，耗时长，本轮未跑。CI 每次 push 都跑（`ci.yml:22`）。
- **Suggestion S3–S6**：上轮已有证据，本轮未复测。
- **移动端适配**：`components/shell/mobile/` 存在但未走查。
