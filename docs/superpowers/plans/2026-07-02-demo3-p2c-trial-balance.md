# P2-C 科目余额表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`). 本计划由 Workflow 编排实现，编排者在阶段边界亲跑测试把关。

**Goal:** 科目余额表全栈——科目树按期存储（数据非模板）、8 金额列（期初/本期/本年/期末 × 借贷）、折叠+搜索大表、两版式多 sheet 导入，并修 FpImportModal 只读 sheet 0 的缺口。

**Architecture:** 后端 V24 `report_account`（按 company+statement+year+month 存科目树）+ V25 种子；`ReportService` 白名单加 `tb`、`period/save/import` 对 tb 附带/双写科目树。前端 `trialBalance.ts`（8 列 + totals/平衡差 + visibleRows 折叠搜索纯函数）、`TrialBalanceView`+`TbTable`（自带 scoped 样式）、`importTrialBalance`（两版式 + 多 sheet 分段）、`FpImportModal` 加 `sheetMatch`/`parseWorkbook`（含 is/bs sheetMatch 修复）、registry `report_tb`。

**Tech Stack:** 同 P2-A/B。

**Spec:** `docs/superpowers/specs/2026-07-02-demo3-p2c-trial-balance-design.md`（版式/字段/口径以 spec 为准）

## Global Constraints

- 继承 P2-A/B plan 全部 Global Constraints（信封/BizException/零 XML/审计填充/§6 加载门+v-else 紧邻链/§7 居中弹窗/导入铁律/编排者亲跑全量 `./mvnw test`）。
- C 特有：金额 field ∈ `{openDr,openCr,periodDr,periodCr,ytdDr,ytdCr,endDr,endCr}`；科目树整期 clear+insert（保存与导入同语义）；合计/平衡差客端算不落库；`row_key`=科目代码或合成 `r<n>`；`sort_order` 保文件行序。
- Flyway 现到 V23 → **V24 表 / V25 种子**。
- 既有 IT `illegalStatement` 用例的非法值随 tb 合法化改为 `'xx'`。

---

## 文件结构

**后端：**
- Create: `entity/ReportAccount.java`、`mapper/ReportAccountMapper.java`、`dto/ReportAccountDTO.java`、`V24__report_account.sql`、`V25__report_tb_seed.sql`
- Modify: `service/ReportService.java`（白名单+accounts 读写）、`service/ImportLogService.java`（+`report_tb`）、`dto/ReportPeriodDTO.java`（+accounts）、`dto/ReportSaveReq.java`（+accounts）、`dto/ReportImportRequest.java`（CompanySection +accounts）、`test/.../api/ReportApiIT.java`（tb 用例 + illegal 改 'xx'）

**前端：**
- Create: `reports/trialBalance.ts`+`.spec.ts`、`views/reports/trial-balance/TrialBalanceView.vue`、`views/reports/trial-balance/TbTable.vue`、`utils/importTrialBalance.ts`+`.spec.ts`
- Modify: `components/import/FpImportModal.vue`+`.spec.ts`（sheetMatch/parseWorkbook）、`utils/importRegistry.ts`（+report_tb；report_is/report_bs 的 modalProps 加 sheetMatch）、`utils/importRegistry.spec.ts`（11→12 键；context 断言 +report_tb）、`types/report.ts`（+ReportAccount/accounts 字段）、`api/report.ts`（period/save/import 载荷放宽）、`router/index.ts`（trial-balance → 真屏）

---

## Task 1: 后端 tb 全套（V24/V25 + 实体/Mapper + Service 扩展 + IT）

**Interfaces — Produces:**
- `ReportAccount{Long id; Integer companyId; String statement; Integer year,month; String rowKey,parentKey,code,label; Integer level,sortOrder; LocalDateTime createdAt}`；`ReportAccountMapper extends BaseMapper` + `default List<ReportAccount> period(companyId,stmt,year,month)`（orderBy sort_order）。
- `ReportAccountDTO(String rowKey, String parentKey, String code, String label, int level, int sortOrder)`。
- `ReportPeriodDTO(Map<String,Map<String,BigDecimal>> amounts, List<ReportCustomRowDTO> customRows, List<ReportAccountDTO> accounts)`（is/bs 时 accounts=List.of()）。
- `ReportSaveReq(List<Cell> cells, List<AccountReq> accounts)`；`AccountReq(rowKey,parentKey,code,label,level,sortOrder)`（is/bs 传 null 忽略）。
- `ReportImportRequest.CompanySection(companyName, cells, accounts)`（accounts 可 null）。

**要点：** 白名单 `Set.of("is","bs","tb")`；`period()` 对 tb 附 accounts；`save/importRows` 对 tb（accounts!=null 时）先 clear `report_account` 本期再 insert（与金额同事务）；`year()` hasData 对 tb 以 `report_account` 存在为准（is/bs 逻辑不变）。V24 DDL 按 spec §2 原样；V25 种子：公司1 tb 2025-09——科目 1001 库存现金(level0)/1002 银行存款(level0)/100201 农商行(level1,parent 1002)/1122 应收账款(level0)/r5 某租户明细(level1,parent 1122,code NULL) 5 行 + 每科目 endDr 或 endCr 等代表金额（借贷两侧合计相等以演示「已平」：如 endDr 合计=endCr 合计=100000）。

**IT 用例（沿既有风格）：** `tb_saveTreeAndAmounts_readBack`（PUT accounts+cells → GET 读回 accounts 树序+amounts.8 字段；重存覆盖）、`tb_import_writesAccountsAndAmounts_autoCreatesCompany`、`tb_allPeriod_levelZeroMerge`（两公司同 code 一级科目求和）、`illegalStatement` 改 `'xx'`、`tb_seed_readable`（V25）。

- [ ] Step 1: V24+V25 SQL、实体、Mapper、DTO 改造。
- [ ] Step 2: Service 扩展 + IT（先写用例再实现）。
- [ ] Step 3: `test-compile` 过（全量编排者跑）。
- [ ] Step 4: commit `feat(reports): 后端 tb(科目树按期存储 V24/V25 + save/import 双写 + IT)`。

---

## Task 2: 前端 trialBalance 模板/纯函数

**Interfaces — Produces:**
- `TB_FIELDS: {key:'openDr'|...|'endCr', label:string, group:'期初余额'|'本期发生额'|'本年累计发生额'|'期末余额', side:'借方'|'贷方'}[]`（8 项）。
- `TbAccount = {rowKey,parentKey,code,label,level,sortOrder}`（镜像 DTO）。
- `tbTotals(accounts, amounts): Record<fieldKey, number>`（Σ level-0 行）。
- `tbBalanceDiff(totals): number`（endDr − endCr）。
- `visibleRows(accounts, expanded:Set<string>, query:string): TbAccount[]`——默认 level 0 可见；父在 expanded 内其直接子可见（递归）；query 非空时命中（code/label 含 query）行 + 其全部祖先可见（无视 expanded）。保持 sortOrder 序。

- [ ] Step 1: spec 先失败（totals 只加 level0/平衡差/折叠默认 level0/展开父显子/搜索命中带祖先/序稳定）→ 实现 → `npx vitest run trialBalance` 绿 + typecheck。
- [ ] Step 2: commit `feat(reports): 科目余额表模板(8列+totals/平衡差+visibleRows折叠搜索)`。

---

## Task 3: FpImportModal 扩展（sheetMatch + parseWorkbook）

**Files:** Modify `components/import/FpImportModal.vue`、`components/import/FpImportModal.spec.ts`

**Interfaces — Produces（新 props，全部可选、向后兼容）:**
- `sheetMatch?: RegExp`——handleFile 的 xlsx 分支不再固定 `SheetNames[0]`：取 `SheetNames.find(n=>sheetMatch.test(n)) ?? SheetNames[0]`。
- `parseWorkbook?: (sheets: {name:string; matrix:string[][]}[]) => {records?:ImportRec[]; sections?:{label:string;records:ImportRec[]}[]; error?:string}`——优先级最高（先于 customParse）；给了即：文件路径解析**全部** sheet 传入；粘贴路径包装 `[{name:'', matrix}]`。返回 sections 走既有 labelMode 汇总屏、records 走既有预览，复用现通路。

- [ ] Step 1: spec 先失败（parseWorkbook 粘贴包装单 sheet / sections 走 labelMode；sheetMatch 逻辑用单测桩验 pick 函数——可导出小工具函数 `pickSheet(names, re)` 便测）→ 实现 → `npx vitest run FpImportModal` 绿 + build。
- [ ] Step 2: commit `feat(import): FpImportModal 支持 sheetMatch 按名选表 + parseWorkbook 多sheet解析`。

---

## Task 4: 科目余额表屏 + 路由

**Interfaces — Consumes:** Task 2 纯函数、Task 1 后端（`reportApi` 载荷放宽：`types/report.ts` 加 `ReportAccount`、`ReportPeriodDTO.accounts?`、save/import 请求体加 accounts——本任务顺带改这两个文件）。范式先 Read `BalanceSheetView.vue`。

**要点：** 三级动线（fin 外壳）；L3 = `TbTable.vue`（自带 scoped 样式遵 fin-table 视觉：sticky 表头两行「期初余额/本期发生额/本年累计/期末余额」×「借/贷」、科目代码列、名称列缩进+展开箭头(有子级才显)、行点击箭头 toggle expanded）；顶部搜索框（`SearchField` DS 组件）；合计尾行（tbTotals）+ KPI 4（期末借合计/期末贷合计/平衡差(非0红,「已平」绿)/科目数）；编辑态：金额单元格 draft（key=`${rowKey}|${field}`）、新增科目居中弹窗（code?/名称/父级下拉=现有科目）、删科目（级联收集子树）、保存=`reportApi.save('tb',co,y,m,{cells,accounts})`；`companyId==='all'` 只读平铺一级（后端已合并）；退出编辑 SaveConfirmDialog；导出懒加载（平铺全部行 10 列）。**§6.2 v-else 紧邻链；弹窗/toast 放最后。**

- [ ] Step 1: types/api 放宽 + TbTable + View + 路由（`trial-balance` 分支）。
- [ ] Step 2: `npm run build` 绿。
- [ ] Step 3: commit `feat(reports): 科目余额表屏(折叠+搜索+8列+平衡差) + 路由`。

---

## Task 5: 导入（两版式解析器 + registry report_tb + is/bs sheetMatch 修复 + 屏接入）

**Interfaces — Produces:**
- `importTrialBalance(sheets: {name,matrix}[]): {sections:{label, records:{account:TbAccount, amounts:Record<fieldKey,number>}[]}[], error?}`——只处理名字含「余额表」的 sheet，每 sheet 一段；段 label：`余额表（X）`→X、`①余额表`→①、fallback 标题行。单 sheet：定位表头行（含「科目名称」且行内含「期初余额」，或次行为「借方/贷方」子表头→两行合并映射 8 列；代码型 `期初余额(借方)` 单行直接映射）；列映射按表头文字→8 field + 科目代码列 + 科目名称列；数据行：code=代码列(可空)，label=名称去前导空格，level=code?(code.length−4)/2:Math.floor(前导空格数/2)，parent=向上最近 level−1 行的 rowKey，rowKey=code||`r${行号}`；跳「合计」行/名称空行；金额 cleanNum(`" - "`→0)。
- registry `report_tb`：`{label:'科目余额表', tag:'报表', icon:'table-2', context:'ledger', modalProps: parseWorkbook=importTrialBalance + title/sub, run: 逐段公司匹配/create → sections=[{companyName, accounts, cells(8字段展开)}] → reportApi.import('tb',y,m,{sections}) 聚合, target: ()=>\`\${y}-\${pad2(m)} · 科目余额表\`}`。
- **is/bs sheetMatch 修复**：registry `report_is`.modalProps 加 `sheetMatch:/利润表|损益表/`、`report_bs` 加 `sheetMatch:/资产负债表/`（一行each）。
- `importRegistry.spec.ts`：键 11→12；context 断言 `['ledger','report_bs','report_is','report_tb']`。
- View 接 FpImportModal（同 bs 屏；`@import-sections`→`runImport('report_tb',...)`）。

- [ ] Step 1: 解析器 spec 先失败（两版式合成矩阵：缩进型无代码层级/代码型 4+2n 层级/两行表头合并/合计行跳过/多 sheet 分段/非余额表 sheet 忽略）→ 实现 → `npx vitest run importTrialBalance` 绿。
- [ ] Step 2: registry + is/bs sheetMatch + View 接入 → `npm run build && npx vitest run` 全量绿。
- [ ] Step 3: commit `feat(reports): 科目余额表导入(两版式+多sheet+自动建公司) + registry report_tb + is/bs sheetMatch 修复`。

---

## Task 6: 端到端真跑（编排者亲验）

- [ ] 全量 `./mvnw test` 绿（V24/V25 + tb IT）→ 打 jar → 起后端+preview。
- [ ] preview：/trial-balance L1→L2(2025-09 种子)→L3（默认折叠一级/展开箭头/搜索/合计尾行/平衡差「已平」/编辑保存）；全部汇总只读。
- [ ] 真实 .xls **全 6 张余额表 sheet** 喂 `importTrialBalance` 实测（临时 spec）：6 段、①缩进型层级正确（短期借款→大沥农商行）、帮管好代码型（1002→100201）、合计行跳过、金额抽查（帮管好 期末借合计 3,290,041.02）。
- [ ] 0 console error；杀 :8080；提交；更新记忆。

---

## Self-Review

**Spec coverage：** C1 期界科目树→T1(V24/save/import 双写)；C2 8 字段→T1/T2/T5；C3 两版式→T5；C4 row_key/sort_order→T1/T5；C5 多 sheet+sheetMatch 修复→T3/T5；C6 折叠+搜索→T2(visibleRows)/T4；C7 合计+平衡差→T2/T4；C8 手录（金额+增删科目）→T4；C9 段 label→T5；§5 汇总一级合并→T1(allPeriod)/T4；§6 测试→各任务+T6。全覆盖。
**Placeholder scan：** 无 TBD；每任务给签名+判据；解析器规则逐条（层级公式/rowKey/跳行）；V25 种子给了具体科目与平衡约束。
**Type consistency：** `TbAccount`/`ReportAccountDTO` 字段一致；8 field key 全计划统一；`visibleRows(accounts,expanded,query)` T2 定义 T4 用；`parseWorkbook` 签名 T3 定义 T5 用；`sections:{companyName,accounts,cells}` T1 后端 ↔ T5 前端一致。
