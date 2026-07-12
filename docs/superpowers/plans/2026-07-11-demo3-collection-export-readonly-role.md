# 催缴清单一键导出 + 第二账号只读角色（审计建议 #1 与 #8）

日期：2026-07-11 ｜ 来源：demo3 第二次全面审计的产品建议清单

## A. 欠费催缴清单一键导出（纯前端）

**目标**：账龄卡上一键导出「租户/家族 × 各账龄桶金额 × 欠费合计 × 最早欠费月 × 联系方式」的 xlsx，
财务每月催缴前不再回 Excel 手工整理。

**口径**：与账龄卡完全同源——famSrc（按户|按家族开关）+ cid（公司过滤）走同一 FIFO 冲抵；
金额导出为**元**（屏上显示折万，Excel 供催缴行动用精确值）；联系方式按租户名在 TenantDTO
（contactName/contactPhone）中查（家族根名即主租户名，两种口径都可查到）。

**改动**：
1. `finCashflow.logic.ts`：把 agingBuckets 内的「分组+FIFO 队列」核心抽为 `arrearQueues()`，
   agingBuckets 改为消费它（行为不变，existing spec 锁定）；新增 `collectionRows()`
   返回逐户明细（4 桶金额/合计/最早欠费月，'期初旧账' 表示早于覆盖窗口），欠费合计降序。
2. 新增 `utils/collectionExcel.ts`：exportCollectionList（懒加载 SheetJS，对齐 pvExcel 模式），
   文件名 `催缴清单-<末期>-<按户|按家族>.xlsx`，含合计尾行。
3. `FinCashflowView.vue`：账龄卡头加「导出催缴清单」按钮；onMounted 里保留 tenants 引用。

**验证**：collectionRows 单测（进 finCashflow.logic.spec.ts）+ collectionExcel 单测（aoaSpy 模式）；
agingBuckets 既有 spec 必须保持全绿。

## B. 第二账号 + 只读角色（全栈）

**目标**：给管理者一个只读账号看全部屏（分析层为主），财务保留唯一可写的 admin。

**权限模型（一条规则，不做按钮级门禁）**：GET = 读（两种角色都行），非 GET = 写（仅 admin）。
经核查全部 POST/PUT/PATCH/DELETE 端点语义均为写（导入/标记/复制/保存都是 POST 写），
GET-only 即只读成立。viewer 触发写 → HTTP 403 + Result 信封（前端既有 catch→alert 直接可用，
不改 99 个调用点）。

**改动**：
1. `V32__auth_role.sql`：auth_user 加 `role VARCHAR(16) NOT NULL DEFAULT 'admin'`（不新增种子行）。
2. AuthUser 实体加 role；ResultCode 加 FORBIDDEN(403)。
3. JwtUtil：token 加 role claim；JwtAuthFilter 读 claim 设 ROLE_* 权限，
   **缺 claim 按 viewer 处理**（最小权限；旧 token 重新登录一次即可）。
4. SecurityConfig：GET /api/** 已认证即可，非 GET /api/** 需 ROLE_ADMIN；
   accessDeniedHandler 输出 403 信封（对齐 401 EntryPoint 写法）。
5. AuthService/LoginResp：登录响应带 role。
6. AdminInitializer：新增 viewer 块——`app.viewer.password` 非空则创建/重置 `viewer` 账号
   （display_name=只读账号，role=viewer）。dev 默认 viewer123（同 admin/admin123 惯例）；
   prod `${VIEWER_PASSWORD:}` 留空=不创建（安全默认，不引入新的弱口令种子）。
7. 前端 auth store：role 持久化 + isReadonly；api/index.ts 401 清理时同步清 role。

**验证**：新增 RoleApiIT（viewer 登录返 role；viewer GET 200/code0；viewer POST/DELETE → HTTP 403
+ code 403；admin 同 POST 过角色门抵达校验层返 400——用无效体断言过门且零数据污染）；
auth.spec.ts 扩 role 断言；vue-tsc + vitest 全绿。

## 明确不做（ponytail）

- 不做按钮级/路由级前端权限隐藏——后端是安全边界，viewer 点写按钮得到清晰中文报错即可，UI 打磨等真实使用反馈。
- 不做角色管理页/多角色矩阵——两级（admin/viewer）写死，审计已论证单园区不需要 RBAC。
- 不做催缴函 docx——先交付 Excel 清单，模板函等用户提需求。
