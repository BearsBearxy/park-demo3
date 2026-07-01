# P2-A 报表基础设施 + 利润表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`). 本计划由 Workflow 编排实现，编排者在每阶段边界亲跑测试把关。

**Goal:** 打通 P2 报表纵切——通用报表存储后端（statement 参数化）+ fin 共享外壳 + 利润表屏（手录 + 导入，按公司拆、全部汇总只读、小计公式），B/C/D 复用。

**Architecture:** 后端通用 `report_amount`/`report_custom_row`（statement 参数化，小计不落库）+ `/api/reports/{statement}` 7 端点；前端报表行模板/公式为前端 config（`incomeStatement.ts`），fin 外壳组件（L1 公司选择/L2 月历/报表表基座/居中弹窗）1:1 移植 `fin-common.jsx`；利润表两列（本月/本年累计）；导入复用 P1 引擎（`FpImportModal`+`runImport`+`import_log`），解析合并 6 公司 sheet、未匹配公司自动新建。

**Tech Stack:** 后端 Java 17 + Spring Boot 3.3 + MyBatis-Plus + Flyway + Testcontainers；前端 Vue 3 `<script setup>` + TS + Pinia + Vitest + SheetJS。

**Spec:** `docs/superpowers/specs/2026-07-02-demo3-p2a-reports-foundation-income-statement-design.md`

## Global Constraints

- 统一信封 `Result<T>`（controller 返裸类型，`ResponseWrapAdvice` 裹）；错误抛 `BizException(ResultCode.XXX)`，**禁 `NoSuchElementException`**。
- MyBatis-Plus Mapper 裸 `BaseMapper<T>` 或 `default`+`QueryWrapper`，**零手写 XML**；审计字段 `@TableField(fill=INSERT/INSERT_UPDATE)` 复用既有 `MetaObjectHandler`。
- Flyway 递增（现到 V20 → 新增 **V21 表 / V22 种子**）。
- 小计**不落库**：`report_amount` 只存 normal 叶子行（含自定义行）；小计前端算。全部汇总 = 跨公司同 rowKey 同 field 求和（只读）。
- 列口径**文件忠实**：利润表 = 每公司 `cur`(本月)+`ytd`(本年累计) 两列。
- 公司**复用 `management_company`**（`companyApi.list()`/`companyApi.create(name)` 已存在，见 `api/ledger.ts`）；导入未匹配公司**自动新建**。
- 弹窗遵 **DESIGN-FIDELITY §7 居中弹窗**（Teleport + backdrop 居中 + 卡片 max-height 体内滚动）；列表/数据屏遵 §6 加载门；§6.2 **兜底 `v-else` 紧邻状态链、`ImportResultToast` 放最后**。
- 导入遵 IMPORT-GUIDE：`FpImportModal` + `runImport` 落 `import_log`；后端导入 clear+insert `@Transactional`；含中文验证走浏览器不用 curl；**编排者亲跑全量 `./mvnw test`（不接管道）**，不信 agent test-compile；JsonPath 过滤器断言用 `.isNotEmpty()`。
- 工具链：`./mvnw`（JDK17，Testcontainers 需 Docker，首跑冷启~3min）；前端 `npm run build`(vue-tsc) + `npm test`(vitest run)。

---

## 文件结构

**后端（新增 `com/park/demo3/`）：**
- `entity/ReportAmount.java`、`entity/ReportCustomRow.java`
- `mapper/ReportAmountMapper.java`、`mapper/ReportCustomRowMapper.java`
- `dto/ReportPeriodDTO.java`、`ReportYearDTO.java`、`ReportMonthCellDTO.java`、`ReportCustomRowDTO.java`、`ReportSaveReq.java`、`ReportImportRequest.java`
- `service/ReportService.java`、`controller/ReportController.java`
- `resources/db/migration/V21__report.sql`、`V22__report_seed.sql`
- 测试 `test/.../api/ReportApiIT.java`

**前端（`frontend/src/`）：**
- `reports/incomeStatement.ts`（IS_ROWS + IS_FORMULA）、`reports/incomeStatement.spec.ts`
- `types/report.ts`、`api/report.ts`
- `components/fin/FinCompanyPicker.vue`、`FinMonthGrid.vue`、`FinReportTable.vue`、`FinDialogs.vue`（公司增删/确认/加子类，居中）
- `views/reports/income-statement/IncomeStatementView.vue`、`IncomeStatementTable.vue`
- `utils/importIncomeStatement.ts`、`utils/importIncomeStatement.spec.ts`
- 改 `utils/importRegistry.ts`（加 `report_is`）、`router/index.ts`（`income-statement` → 真屏）
- 后端白名单 `ImportLogService.KNOWN_TYPES` 加 `report_is`

---

## Task 1: 后端报表持久层（V21 + 实体 + Mapper）

**Files:** Create `V21__report.sql`, `entity/ReportAmount.java`, `entity/ReportCustomRow.java`, `mapper/ReportAmountMapper.java`, `mapper/ReportCustomRowMapper.java`

**Interfaces — Produces:**
- `ReportAmount{ Long id; Integer companyId; String statement; Integer year; Integer month; String rowKey; String field; BigDecimal amount; LocalDateTime createdAt/updatedAt }`
- `ReportCustomRow{ Long id; Integer companyId; String statement; String rowKey; String parentKey; String label; Integer level; LocalDateTime createdAt }`
- `ReportAmountMapper extends BaseMapper<ReportAmount>` + `default List<ReportAmount> period(int companyId,String stmt,int year,int month)` + `default List<ReportAmount> allPeriod(String stmt,int year,int month)`（全公司）
- `ReportCustomRowMapper extends BaseMapper<ReportCustomRow>` + `default List<ReportCustomRow> forCompany(int companyId,String stmt)`

- [ ] **Step 1: V21 迁移**（表 DDL 见 spec §3，两表 + uk + 审计列 + FK company_id→management_company(id)）。
- [ ] **Step 2: 实体**（`@TableName`、`@TableId(AUTO)`、`@TableField(fill=INSERT)` createdAt / `INSERT_UPDATE` updatedAt；`report_custom_row` 无 updatedAt）。
- [ ] **Step 3: Mapper**（`default` 方法用 `QueryWrapper.eq(...)`；`allPeriod` 不加 companyId 过滤）。
- [ ] **Step 4:** `./mvnw -q -f backend/pom.xml -o test-compile` → BUILD SUCCESS。
- [ ] **Step 5:** commit `feat(reports): report_amount/report_custom_row 表+实体+Mapper(V21)`。

---

## Task 2: 后端 Report Service + Controller + DTO + IT

**Files:** Create 6 DTO, `service/ReportService.java`, `controller/ReportController.java`, `test/.../api/ReportApiIT.java`; Modify `service/ImportLogService.java`(KNOWN_TYPES 加 `report_is`)

**Interfaces — Consumes:** Task 1 实体/Mapper；`ManagementCompanyMapper`（既有，公司 CRUD + 自动新建）；`Result/BizException/ResultCode`。
**Produces:**
- `ReportPeriodDTO(Map<String,ReportMonthCellDTO> amounts, List<ReportCustomRowDTO> customRows)`；`ReportMonthCellDTO(BigDecimal cur, BigDecimal ytd)`
- `ReportYearDTO(int year, List<MonthMeta> months)`；`MonthMeta(int month, boolean hasData, BigDecimal netPreview)`
- `ReportCustomRowDTO(Long id, String rowKey, String parentKey, String label, int level)`
- `ReportSaveReq(List<Cell> cells)`；`Cell(String rowKey, String field, BigDecimal amount)`
- `ReportImportRequest(List<CompanySection> sections)`；`CompanySection(String companyName, List<Cell> cells)`
- `ReportService`: `period(stmt,companyId,year,month)`、`allPeriod(stmt,year,month)`、`year(stmt,companyId,year)`、`save(stmt,companyId,year,month,ReportSaveReq)`、`addCustomRow(stmt,companyId,...)`、`deleteCustomRow(id)`、`importRows(stmt,year,month,ReportImportRequest)→ImportResultDTO`（公司名匹配 management_company，未匹配 insert 新公司；per company clear+insert 本期）
- `ReportController` 7 端点（spec §4）。

**关键实现要点：**
- statement 白名单 `Set.of("is")`（越界 `BizException(BAD_REQUEST)`）。
- `save`：删本期该公司该 stmt 全部 amount 后按 cells insert（clear+insert，与 ledger/import 一致）。
- `allPeriod`：`allPeriod` mapper 取全公司行 → Java 按 (rowKey,field) 求和；customRows = 各公司并集（按 rowKey 去重）。
- `importRows`：遍历 sections，公司名 `management_company` 按 name 查，无则 `insert`（自动建）；对每公司 clear+insert 本期 cells；返回 `ImportResultDTO{imported=Σcells, skipped, errors}`。
- `netPreview`（月历）：按 IS 公式服务端算 net(32) 便于 L2 展示——**或**返回原始 amounts 让前端算；本刀取**服务端只返 hasData + 本月营业收入(row1 cur) 预览**（避免后端嵌入公式，公式归前端）。month grid 预览用 row1 cur。

- [ ] **Step 1:** 写 DTO（record）。
- [ ] **Step 2:** 写 `ReportApiIT`（先失败）：登录取 token；PUT 保存 is/{co}/2025/10 三行 → GET 读回 amounts 对；GET all/2025/10 跨公司求和；POST custom-row → GET 见该行 → DELETE 级联；POST import 两公司(一新公司名) → GET 见新公司 + 本期落值 + import_log(需另查或信 runImport 前端)；非法 statement `bs` → code 400（`$.code`==400）；无 token 401。断言用 `.isNotEmpty()` 不用 `.value(标量)`。
- [ ] **Step 3:** 写 Service + Controller + KNOWN_TYPES 补 `report_is`。
- [ ] **Step 4:** 编排者**亲跑全量 `./mvnw -q -f backend/pom.xml test`**，读 surefire 报告确认全绿（既有 210 + 新 ReportApiIT）。
- [ ] **Step 5:** commit `feat(reports): Report Service/Controller/DTO + IT`。

---

## Task 3: 前端 利润表模板 + api + types

**Files:** Create `reports/incomeStatement.ts`, `reports/incomeStatement.spec.ts`, `types/report.ts`, `api/report.ts`

**Interfaces — Produces:**
- `IS_ROWS: {no:number,label:string,level:number,type:'normal'|'label'|'subtotal'}[]`（行次 1–32，spec §2 逐行）
- `IS_FORMULA: Record<number,(g:(no:number)=>number)=>number>`：`21:g=>g(1)-g(2)-g(3)-g(11)-g(14)-g(18)+g(20)`、`30:g=>g(21)+g(22)-g(24)`、`32:g=>g(30)-g(31)`
- `computeRow(no, field, getLeaf, customChildrenSum): number`（小计走 IS_FORMULA，父项含自定义子类则求和，否则 getLeaf）
- TS `ReportPeriodDTO/ReportYearDTO/ReportCustomRowDTO/ReportCell`（镜像后端）
- `reportApi`: `year(stmt,co,y)`、`period(stmt,co,y,m)`、`allPeriod(stmt,y,m)`、`save(stmt,co,y,m,{cells})`、`addCustomRow`、`deleteCustomRow`、`import(stmt,y,m,{sections})`（走 `http`）

- [ ] **Step 1:** 写 `incomeStatement.ts`（IS_ROWS 全 32 行 + IS_FORMULA + `computeRow` 纯函数）。
- [ ] **Step 2:** 写 `incomeStatement.spec.ts`（先失败）：给定叶子值 map，断言 `computeRow(21)=1-2-3-11-14-18+20`、`computeRow(30)`、`computeRow(32)`；父项含自定义子类时=子类和。
- [ ] **Step 3:** `types/report.ts` + `api/report.ts`。
- [ ] **Step 4:** `cd frontend && npm test -- incomeStatement`（vitest 绿）+ `npm run typecheck`。
- [ ] **Step 5:** commit `feat(reports): 利润表行模板/公式 + report api/types`。

---

## Task 4: fin 共享外壳组件（1:1 移植 fin-common.jsx，居中弹窗）

**Files:** Create `components/fin/FinCompanyPicker.vue`, `FinMonthGrid.vue`, `FinReportTable.vue`, `FinDialogs.vue`

**Interfaces — Produces（props/emits）:**
- `FinCompanyPicker{ props:{title,sub,companies,summaryOf?}, emits:{pickAll,pick(id),new,edit(c),delete(c)} }`（全部汇总卡 + 各公司卡 + 新增卡；样式 1:1 `fin-common.jsx` `.fin-pick*`）
- `FinMonthGrid{ props:{companyName|null,year,months(hasData/preview),maxYear}, emits:{pick(m),back,year(y)} }`（`.fin-mgrid`；当前月由 months 数据判定，不用 `new Date()`）
- `FinReportTable{ props:{rows(模板+自定义),columns:{key,label}[],valueOf(rowKey,field),editable,onInput,onAddChild,onRemoveChild}, }`（`.fin-table`；固定行+自定义子类递归+小计行样式 lbl/sub/strong；列数由 columns 定）
- `FinDialogs`（`FinCompanyDialog`/`FinConfirm`/`FinAddRowDialog` 合一文件，**居中弹窗**用 `Teleport`+backdrop 居中，参考 CommandPalette/更新后的 FPDrawer）

- [ ] **Step 1:** 移植 4 组件（HTML 结构 + `<style scoped>` 1:1 从 `fin-common.jsx` `FinStyles`；弹窗 backdrop 改居中；图标用 `iconFor`）。
- [ ] **Step 2:** `npm run build`（vue-tsc 绿）+ 一个 `FinReportTable` 渲染 vitest（固定行 + 一条自定义子类 + 小计行渲染）。
- [ ] **Step 3:** commit `feat(reports): fin 共享外壳(公司选择/月历/报表表/居中弹窗)`。

---

## Task 5: 利润表屏 + 路由

**Files:** Create `views/reports/income-statement/IncomeStatementView.vue`, `IncomeStatementTable.vue`; Modify `router/index.ts`（`income-statement` → 真屏）

**Interfaces — Consumes:** Task 3（模板/公式/api）、Task 4（外壳）。

**要点：** L1/L2/L3 状态机（`companyId: number|'all'|null` / year / month|null / edit）+ §6 加载门；L3 用 `FinReportTable` 传 2 列 `[{key:'cur',label:'本月金额'},{key:'ytd',label:'本年累计金额'}]`；叶子录入→draft→`reportApi.save`；小计/父项汇总走 `computeRow`；`companyId==='all'` 读 `allPeriod` 只读（无编辑/导入按钮）；4 KPI（营业收入/营业利润/利润总额/净利润 本月）；退出编辑 `SaveConfirmDialog`；导出 xlsx 懒加载。§6.2：兜底 `v-else` 紧邻状态链、`ImportResultToast` 放最后。

- [ ] **Step 1:** 写 View + Table，router 接线。
- [ ] **Step 2:** `npm run build` 绿。
- [ ] **Step 3:** commit `feat(reports): 利润表屏(三级动线+编辑+全部汇总只读) + 路由`。

---

## Task 6: 利润表导入（解析器 + registry report_is + 屏接入）

**Files:** Create `utils/importIncomeStatement.ts`, `utils/importIncomeStatement.spec.ts`; Modify `utils/importRegistry.ts`, `views/reports/income-statement/IncomeStatementView.vue`

**Interfaces — Produces:**
- `importIncomeStatement(matrix): { sections: {label:companyName, records:{rowKey,cur,ytd}[]}[]; error?:string }`——定位公司名表头行 + 本月/本年累计子表头 → 每公司 (curCol,ytdCol) → 逐数据行按行次匹配 IS_ROWS normal 行 → 每公司一段；忽略「合计」列、跳小计/空/label 行。
- registry 加 `report_is`：`{key:'report_is',label:'利润表',tag:'报表',icon:'trending-up',context:'ledger'式(需 year/month), modalProps: customParse=importIncomeStatement(labelMode 多公司段), run(picks,ctx): 逐 pick 解析公司名→reportApi 公司匹配/自动新建→reportApi.import('is',ctx.year,ctx.month,{sections})聚合}`。
- import_log `data_type='report_is'`（Task 2 已加白名单）。

- [ ] **Step 1:** 写解析器（复用 `matchByHeader` 思路但多公司列对；单测覆盖：多公司拆分、按行次匹配、合计列忽略、小计/label 跳过）。
- [ ] **Step 2:** 单测先失败 → 实现 → `npm test -- importIncomeStatement` 绿。
- [ ] **Step 3:** registry 加 `report_is` + View 接 `FpImportModal`（导入前用当前 year/month 作 ctx；`companyId==='all'` 或未选期时禁导入）。
- [ ] **Step 4:** `npm run build` + 全量 `npm test` 绿。
- [ ] **Step 5:** commit `feat(reports): 利润表导入(合并多公司解析+自动建公司) + registry report_is`。

---

## Task 7: 种子 + 端到端真跑验证

**Files:** Create `V22__report_seed.sql`; 验证

- [ ] **Step 1:** V22 种子：给现有公司 × 2025 若干月建利润表骨架（少量代表 amount 行，够演示编辑/汇总/公式）。
- [ ] **Step 2:** 编排者亲跑全量 `./mvnw test` 绿（V21+V22 迁移 + ReportApiIT）。
- [ ] **Step 3:** 起真后端(V22 jar)+13306+preview：L1 选公司→L2 月历→L3 利润表（KPI/小计公式/编辑重算/保存/全部汇总只读）；**用真实 `2025年10月文件（拼）.xls` 导入利润表 sheet** → 6 公司自动建 + 各公司 2025-10 落值 + `/import` 记录出 `利润表` 行；0 console error。
- [ ] **Step 4:** 收尾杀 :8080；记 head commit。

---

## Self-Review

**Spec coverage：** R1 第一刀=A→全计划；R2 手录+导入→T5(手录)+T6(导入)；R3 两列→T3/T5；R4 拆公司+汇总只读→T5；R5 公司复用+自动建→T2/T6；R6 前端模板+后端通用→T3/T1-2；R7 小计不落库→T1-3;R8 cur+ytd 手录→T5;R9 自定义行按公司→T1 uk_row;R10 居中弹窗→T4;§2 行模板→T3;§3 数据模型→T1;§4 端点→T2;§6 导入→T6;§7 种子→T7。**全覆盖。**

**Placeholder scan：** 无 TBD；每任务给了接口签名 + 关键实现要点 + 明确测试判据 + 复用的既有文件（LedgerService/S10 import/fin-common.jsx/matchByHeader）。移植类任务（T4 外壳）以 `fin-common.jsx` 为 1:1 事实源。

**Type consistency：** `statement='is'`、`field∈{cur,ytd}`、`row_key`、`ReportPeriodDTO.amounts:Map<rowKey,{cur,ytd}>`、`sections:{label,records}`、registry key `report_is` 在 T1-T6 一致；`computeRow` 签名 T3 定义、T5 用一致；`reportApi.import(stmt,y,m,{sections})` T3 定义、T6 用一致。
