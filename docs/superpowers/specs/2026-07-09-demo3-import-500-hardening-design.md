# 导入健壮性:裸 500 → 友好 400 规范(2026-07-09)

## 背景(2026-07-09 批量导入暴露)

两类畸形导入让后端抛裸 500（GlobalExceptionHandler fallback），前端只见"服务器内部错误"无从判断：

1. **路径参数类型不匹配**：前端解析失败时 companyId/id 传成 `undefined`（如台账 2024"应收明细表"无公司标记列 → `/ledger/companies/undefined/import`）→ Spring `MethodArgumentTypeMismatchException`（"undefined"→int 转换失败）→ 未处理 → fallback 500。
2. **数据超字段范围**：母册工资列错位使 `请假` 取到大数 → `leave_days`(SMALLINT) 插入溢出 → `MysqlDataTruncation`（被 Spring 包成 `DataIntegrityViolationException`）→ 未处理 → fallback 500。

现有 handler 已覆盖 BizException/@Valid/ConstraintViolation/DuplicateKey/NoSuchElement,唯这两类漏网。

## 修复(GlobalExceptionHandler 补两个处理器,最小改动)

1. `MethodArgumentTypeMismatchException` → HTTP 400 + code 400，message「请求参数格式错误：{参数名}」(取 e.getName())。
2. `DataIntegrityViolationException` → HTTP 400 + code 400，message「数据超出字段允许范围或违反完整性约束」。
   - **顺序/特化性**：`DuplicateKeyException` 是 `DataIntegrityViolationException` 子类,已有独立 handler(409);Spring 选最具体 handler,故新增父类 handler 不夺重复键路径。保留现有 DuplicateKey handler。
   - 语义:超范围/截断是客户端数据问题 → 400(非 409/500)。

**不做**(避免掩盖问题)：不 clamp leave_days（截断会静默存错值,应报错让用户查源）；不改导入器逐行容错（本次仅健壮化异常出口,批量失败语义不变）。

## 验收

- BackendApiIT/新 IT 两例：
  1. POST 一个非数字 path id 的导入端点(如 `/ledger/companies/abc/import?year=2025&month=1` body `{"rows":[]}`) → HTTP 400 且 body.code=400（非 500）。
  2. POST `/salary/2025/1/import`(或对应路由)body 含 leaveDays 超 SMALLINT 范围(如 99999)一行 → HTTP 400 且 body.code=400（非 500）。
- 既有 IT 全绿(DuplicateKey 仍 409、@Valid 仍 400 不回归)。
- 前端零改动(拦截器已按 code 解包,友好 message 直显)。
