# Plan:导入健壮性 500→400(2026-07-09)

依据 spec:[2026-07-09-demo3-import-500-hardening-design.md](../specs/2026-07-09-demo3-import-500-hardening-design.md)。纯后端 GlobalExceptionHandler 增量。

## 阶段1 · 实现(单 agent)
- 改 common/GlobalExceptionHandler.java:加 @ExceptionHandler
  - MethodArgumentTypeMismatchException → 400 code400 「请求参数格式错误：{name}」
  - DataIntegrityViolationException → 400 code400 「数据超出字段允许范围或违反完整性约束」(保留 DuplicateKey 子类 handler 在前)
- IT(新建 ImportHardeningApiIT 或加入既有):①非数字 path id → 400；②salary leaveDays 超 SMALLINT → 400；③回归:DuplicateKey 仍 409。
- mvnw.cmd test -Dtest=ImportHardeningApiIT（Testcontainers,首跑慢）+ 相关既有 IT 不回归。

## 阶段2 · 复审(单 agent)
- handler 特化性:DuplicateKey(409) 不被新 DataIntegrity(400) 夺;@Valid/ConstraintViolation 路径不受扰。
- IT 真实触发对应异常类型(非同义反复);友好 message 不泄漏栈。
- 相关域 IT 抽跑不回归。

## 主会话收尾
复审确认 → 需要则复跑 → commit。
