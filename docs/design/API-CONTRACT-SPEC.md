# 后端接口契约规范（API-CONTRACT-SPEC）

2026-08-11 立档。来源：全面审计——31 个 controller / 202 个端点，信封层已 100% 统一，语义层约 95%。
本规范的作用是**把既成的 95% 钉成规则**，并列出剩下 5% 的破例清单，避免继续漂移。
docs/design 下此前全部是业务/UI spec，后端无成文契约；本文是第一份。

## 1. 响应信封（已 100% 统一，不得破例）

```java
public record Result<T>(int code, String message, T data, String traceId) {}
```

- **controller 一律返回裸业务类型**，不手写 `Result.ok(...)`。`ResponseWrapAdvice`（32 行）对 `com.park.demo3.controller` 包全量自动包裹。
  - 现状证据：controller 层 `Result<` 命中数 = **0**，1484 行里一处信封样板都没有。
  - `void` 也被包成 `{code:0,message:"ok",data:null,traceId}`（`ChargingApiIT:118` 有断言）。
- ⚠ **两个 advice 都用 `basePackages` 锁死在 controller 包**——在别的包放 `@RestController` 会静默不套信封、不走异常映射。新增 controller 必须放进这个包。
- 绕过 MVC 的 401/403 在 `SecurityConfig` 里手写了同一信封（`RoleApiIT:56` 为证），保持一致。
- **禁止** `ResponseEntity`、禁止裸 `throw new RuntimeException`（当前 main 树两者均 0 命中，保持）。

## 2. HTTP 状态双轨（口径已成文于 `GlobalExceptionHandler` 头注释）

| 情形 | HTTP | body.code |
|---|---|---|
| 业务错误（`BizException` / 重复 / 查无） | **200** | 404 / 409 / … |
| 入参校验失败（`@Valid` / `@Validated` / 缺参 / 类型不符） | **400** | 400 |
| 未认证 | 401 | 401 |
| 无权限（viewer 触发写） | 403 | 403 |
| 未捕获 | 500 | 500 |

业务错走 HTTP 200 是**知情的取舍**（前端按 `body.code` 分支），校验错保留 4xx 供监控统计。前端 `api/index.ts` 对非 2xx 也解信封，两轨的用户提示一致。

> 已知代价：网关/CDN/监控只看 HTTP 状态时，404/409 会被统计成成功。接受。

## 3. 列表（Collection）

- 形态二选一，不得再有第三种：
  1. `List<XxxDTO>` —— 默认；
  2. 「`rows` + 合计/元信息」的整期包装 DTO —— 仅当合计必须与行同源计算时。
- **当前全站零分页**（`IPage`/`PageResult`/`pageNo`/`pageSize` 全仓 0 命中），前端 `useFitRows` 本地分页。这是有意取舍，**但不是永久的**：
  - 🚧 **容量红线**：单接口返回行数 > **5000** 时必须改造。`meter_reading` / `alloc_result` / `monthly_ledger` 是逐月累积表，先撞线。
  - 🚧 **必填收敛参数**：凡按年月累积的数据接口，**必须**有 `year`（或 `ym`）参数，禁止无参全量返回。
    - 已修：`/api/analysis/ledger-tenant-months`、`/api/analysis/s10-tenant-months` 原本无任何时间参数，一次推 ~19000 行 / 3~5MB。
- 参数校验写在 controller 方法参数上（`@Pattern(regexp="\\d{4}-(0[1-9]|1[0-2])")` 管 ym、`@Min(2000) @Max(2100)` 管 year），不下沉到 service。

## 4. 详情（GET /xxx/{id}）

- **必须返回专用 `XxxDetailDTO`，禁止返回 entity、禁止返回 null data、禁止用 HTTP 404。**
- 查无一律 `throw new BizException(ResultCode.NOT_FOUND, "<中文实体名>不存在")`。
  - ❌ **禁止 `NoSuchElementException`**：`GlobalExceptionHandler` 会丢弃它的 message，用户只能看到泛化的「资源不存在」。
  - 破例清单（待收敛）：`TenantService:132`、`ContractService:99`、`ContractService:101`。
- 破例清单 · entity 直出（**改表即改契约**，待包 DTO）：`BillController:38` 返 `BillPayCompany`、`BillNoticeController:49` 返 `BillNoteOverride`。

## 5. 写操作（已统一的保持，破例的收敛到这张表）

| 动词 | 规则 | 现状 |
|---|---|---|
| `POST` 建档 | **返回完整 DTO**（不返 id、不返受影响行数） | ✅ 22/22 已统一 |
| `PATCH` 局部改 | 返回完整 DTO | ✅ 6/6 已统一 |
| `PUT` 全量改 | **返回完整 DTO** | ⚠ 24 个里 18 合规、**6 个返 `void`** |
| `PUT` kv/config upsert | 返回 `void` | ⚠ 与上一行同类却分两派，需按业务语义二选一并写进本表 |
| `DELETE` | **返回 `DeleteResultDTO(int deleted, int skipped)`**；确无可跳过语义时才 `void` | ⚠ 37 个里 24 `void` / 12 合规 / 1 个自定义 9 字段 `MeterDeleteDTO`（批量删预览，允许保留） |
| 导入 | **返回 `ImportResultDTO(int imported, int skipped, List<ImportError> errors)`** | ⚠ 16 个里 14 合规 / 2 自定义 |
| 行级错误 | **跳过不整批拦**，收进 `errors`（`ImportError(int row, String key, String msg)`） | ✅ 已统一 |

### 5.1 同构 record 必须收敛到 dto 包

- ❌ `PriceCfgService.CopyResult(int copied, int skipped)`（定义在 **service 类里**）与 `dto/DeleteResultDTO(int deleted, int skipped)` 完全同构却各活各的。
- ❌ `ReportController:60` 内联定义 `CustomRowReq` —— 全项目唯一不在 dto 包的请求 record。
- ❌ `ContractFullImportRequest.Result` —— 响应体嵌在请求类里，导致签名出现 `public ContractFullImportRequest.Result importFull(@RequestBody ContractFullImportRequest req)`。
- 规则：**所有请求/响应 record 一律落在 `dto` 包**，一个形状只有一份定义。

## 6. URL 与动词

- 基址 `/api/<资源>`，**复数名词优先**（`/api/tenants`）；领域聚合端点可用领域名（`/api/alloc`、`/api/analysis`）。
- ❌ 禁止 `/list` 后缀（当前全站 0 个，保持）。
- ❌ 禁止 POST 做纯查询、GET 做写入（当前 0 个，保持）。
  - 唯一形似的 `GET /readings/delete-preview` 在 `MeterService:245` 有 `if (!apply) return dto;` 硬护栏，属合规只读分支。
- ❌ **一个基址只能被一个 controller 占用**。破例：`/api/meters` 被 `MeterController` 与 `MeterBindingController` 共用——Spring 不报错，路径冲突到运行期才炸。
- ⚠ `DELETE` 带 body（6 处）依赖 axios `config.data`。过代理网关时 body 可能被丢弃；新端点优先用 path/query 传身份。

## 7. DTO 组织

- 全部 `public record`（当前 164/164，**0 个 class**）。不用 Lombok 造 DTO。
- 校验注解写在 DTO 字段上，不写进 service。
- 命名：读出 `*DTO` / 单条写入 `*Req` / 批量导入·整期保存 `*Request`。
- 🚧 **164 个文件平铺在单一 dto 包是已知结构债**。新增按域建子包（`dto/alloc/`、`dto/bill/`、`dto/meter/`…），存量分批迁。
  - `AllocPoolDTOs.java`（一个 final class 塞 14 个嵌套 record）就是"需要子包却只在一域顶了一下"的证据。

## 8. 可观测

- 每个响应体带 `traceId`（`TraceIdFilter` 从 MDC 注入），响应头带 `X-Trace-Id`。
- **`logging.pattern` 必须输出 `%X{traceId}`** —— 否则用户报上来的 traceId 在日志里搜不到，整条链路白建（2026-08-11 前即为此状态）。

## 9. 新增端点自检清单

- [ ] controller 在 `com.park.demo3.controller` 包内，方法体是单表达式委派，无 `if`/`for`/`stream`
- [ ] 返回裸业务类型，没手写 `Result.ok`
- [ ] 挂了 `@Tag` + `@Operation`（中文摘要写清权限/幂等/错误码语义）
- [ ] 年月/ID 类参数有 `@Pattern`/`@Min`/`@Max`，请求体有 `@Valid`
- [ ] 累积型数据接口有 `year`/`ym` 收敛参数，预估返回行数 < 5000
- [ ] 查无抛 `BizException(NOT_FOUND, "…不存在")`，不抛 `NoSuchElementException`
- [ ] 返回的是 DTO 不是 entity
- [ ] 写操作的返回形态符合 §5 那张表
- [ ] 请求/响应 record 落在 `dto` 包，没有和既有形状重复
