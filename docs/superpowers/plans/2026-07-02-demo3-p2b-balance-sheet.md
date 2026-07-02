# P2-B 资产负债表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`). 本计划由 Workflow 编排实现，编排者在阶段边界亲跑测试把关。

**Goal:** 资产负债表全栈（手录 + 导入，期末余额单列、两栏、合计客端重算），最大化复用 P2-A 基建。

**Architecture:** 后端零新表——`ReportService` statement 白名单加 `bs` + `ImportLogService` 加 `report_bs` + V23 种子 + ReportApiIT 补 bs 用例。前端新增 `balanceSheet.ts` 行模板（文件行次 1–53，side L/R + sum 集/差额公式）、`BalanceSheetView`（三级动线，L3 两栏 = 两个 `FinReportTable` 各 1 列 `end`）、`importBalanceSheet` 解析器（两栏 6 公司横向）+ registry `report_bs` + 路由换真屏。

**Tech Stack:** 同 P2-A（Spring Boot 3.3 + MyBatis-Plus + Flyway + Testcontainers / Vue 3 TS + Vitest + SheetJS）。

**Spec:** `docs/superpowers/specs/2026-07-02-demo3-p2b-balance-sheet-design.md`（行模板/合计规则以 spec §2 为准）

## Global Constraints

- 继承 P2-A plan 的全部 Global Constraints（统一信封/BizException/零 XML/审计填充/居中弹窗 §7/加载门 §6 + v-else 紧邻链/导入铁律/编排者亲跑全量 `./mvnw test`）。
- B 特有：`field='end'` 单列；合计行**客端按 BS_SUBTOTAL 重算、不落库**（导入的文件合计值丢弃）；行模板 = **文件真实行次 1–53**（spec §2 逐行）；`其中` 明细行(资产 10–13)为信息行不汇总。
- Flyway 现到 V22 → 新增 **V23**（bs 种子）。

---

## 文件结构

**后端（改 2 + 增 2）：**
- Modify: `service/ReportService.java`（白名单 `Set.of("is")` → `Set.of("is","bs")`）
- Modify: `service/ImportLogService.java`（KNOWN_TYPES 加 `report_bs`）
- Create: `resources/db/migration/V23__report_bs_seed.sql`
- Modify: `test/.../api/ReportApiIT.java`（补 bs 用例）

**前端：**
- Create: `reports/balanceSheet.ts` + `reports/balanceSheet.spec.ts`
- Create: `views/reports/balance-sheet/BalanceSheetView.vue`
- Create: `utils/importBalanceSheet.ts` + `utils/importBalanceSheet.spec.ts`
- Modify: `utils/importRegistry.ts`（加 `report_bs`）+ `utils/importRegistry.spec.ts`（10→11 键；context 断言加 report_bs）
- Modify: `router/index.ts`（`balance-sheet` → 真屏）

---

## Task 1: 后端 bs 启用（白名单 + V23 种子 + IT）

**Files:** Modify `ReportService.java`, `ImportLogService.java`, `ReportApiIT.java`; Create `V23__report_bs_seed.sql`

**Interfaces — Consumes:** A 的通用后端全部（端点/导入/汇总对 `bs` 自动可用）。

- [ ] **Step 1:** `ReportService` 白名单：`private static final Set<String> STATEMENTS = Set.of("is", "bs");`（找到现有 `Set.of("is")` 处改之）。`ImportLogService.KNOWN_TYPES` 加 `"report_bs"`。
- [ ] **Step 2:** V23 种子（公司1 bs 2025-09，`field='end'`，取真实①值，同 V22 风格显式 created_at/updated_at）：

```sql
-- V23__report_bs_seed.sql — 资产负债表(bs)骨架种子:公司1 2025-09,期末余额单列,演示两栏+合计客端重算。
INSERT INTO report_amount (company_id, statement, year, month, row_key, field, amount, created_at, updated_at) VALUES
  (1, 'bs', 2025, 9, '1',  'end', 292259.39,   '2025-09-30 00:00:00', '2025-09-30 00:00:00'),  -- 货币资金
  (1, 'bs', 2025, 9, '4',  'end', 27482403.53, '2025-09-30 00:00:00', '2025-09-30 00:00:00'),  -- 应收账款
  (1, 'bs', 2025, 9, '31', 'end', 43520000.00, '2025-09-30 00:00:00', '2025-09-30 00:00:00'),  -- 短期借款
  (1, 'bs', 2025, 9, '33', 'end', 167183.99,   '2025-09-30 00:00:00', '2025-09-30 00:00:00'),  -- 应付账款
  (1, 'bs', 2025, 9, '48', 'end', 20000000.00, '2025-09-30 00:00:00', '2025-09-30 00:00:00');  -- 实收资本
```

- [ ] **Step 3:** `ReportApiIT` 补 2 用例（沿用既有 helper/风格；JsonPath 过滤器用 `.isNotEmpty()`）：
  - `bs_saveAndRead_endField`：PUT `/api/reports/bs/1/2025/10` cells=[{rowKey:"1",field:"end",amount:1000}] → GET 读回 `$.data.amounts.1.end==1000`；再 PUT 覆盖验证 clear+insert。
  - `bs_seed_readable`：GET `/api/reports/bs/1/2025/9` → `$.data.amounts.1.end==292259.39`、`$.data.amounts.48.end==20000000.00`。
  - （`statement='bs'` 不再 400 由上述用例自证；`tb` 仍 400 可选加一行断言。）
- [ ] **Step 4:** 编排者亲跑全量 `./mvnw -q -f backend/pom.xml test`（不接管道），读 surefire 确认全绿。
- [ ] **Step 5:** commit `feat(reports): 后端启用 bs(白名单+V23种子+IT)`。

---

## Task 2: 前端 资产负债表模板（行次 1–53 + 合计规则）

**Files:** Create `reports/balanceSheet.ts`, `reports/balanceSheet.spec.ts`

**Interfaces — Produces:**
- `BS_ROWS: {no:number|null, side:'L'|'R', label:string, level:number, type:'normal'|'label'|'subtotal'}[]`（spec §2 逐行；label 行 no=null，如 `流动资产：`/`非流动资产：`/`流动负债：`/`非流动负债：`/`所有者权益（或股东权益）：`）
- `BS_SUBTOTAL: Record<number,(g:(no:number)=>number)=>number>`：
  - `20: g => g(18) - g(19)`（固定资产账面价值=原价−累计折旧）
  - `15: g => [1,2,3,4,5,6,7,8,9,14].reduce((s,n)=>s+g(n),0)`（其中 10–13 不计）
  - `29: g => [16,17,20,21,22,23,24,25,26,27,28].reduce(...)`（用 20，不重复 18/19）
  - `30: g => g(15) + g(29)`；`41: Σ(31..40)`；`46: Σ(42,43,44,45)`；`47: g(41)+g(46)`；`52: Σ(48,49,50,51)`；`53: g(47)+g(52)`
- `computeBsRow(no, getLeaf, customChildrenSum): number`（subtotal 走 BS_SUBTOTAL 递归；normal 行 customChildrenSum 非 null 取子类和否则 getLeaf——同 A computeRow 约定）

- [ ] **Step 1:** 写 spec（先失败）：给叶子 map 断言 `computeBsRow(20)=18−19`、`15` 不含 10–13、`29` 用 20 不含 18/19、`30=15+29`、`53=47+52`、资产负债平衡场景（构造两侧相等）；父项含自定义子类=子类和。
- [ ] **Step 2:** 实现 `balanceSheet.ts` → `npx vitest run balanceSheet` 绿 + `npx vue-tsc --noEmit` 无本文件错。
- [ ] **Step 3:** commit `feat(reports): 资产负债表行模板(1-53)+合计规则+computeBsRow`。

---

## Task 3: 资产负债表屏（两栏三级动线）+ 路由

**Files:** Create `views/reports/balance-sheet/BalanceSheetView.vue`; Modify `router/index.ts`

**Interfaces — Consumes:** Task 2（BS_ROWS/BS_SUBTOTAL/computeBsRow）；A 的 `reportApi`（statement 传 `'bs'`）、`components/fin/*`、`SaveConfirmDialog`。先 Read `views/reports/income-statement/IncomeStatementView.vue` 为范式（三级状态机/draft/保存/全部汇总只读/加载门/v-else 位置），差异仅：
- L3 **两栏**：`.fin-two` grid（样式 1:1 自 `fin-common.jsx` `.fin-two/.fin-side/.fin-side-h`）包两个 `FinReportTable`——左=side L 行（表头「资产」），右=side R 行（表头「负债和所有者权益」），columns 均 `[{key:'end',label:'期末余额'}]`。
- KPI 4 枚：资产总计(30) / 负债合计(47) / 所有者权益合计(52) / **平衡差**（30 − 53，配平提示，非 0 显红）。
- 编辑/保存/自定义行/导出/全部汇总只读逻辑同 IS 屏（statement `'bs'`）。
- 路由：`meta.value === 'balance-sheet' ? BalanceSheetView : ...`（现有 ternary 链加分支 + 顶部懒加载 const）。

- [ ] **Step 1:** 写 View + 路由接线（**§6.2：兜底 v-else 紧邻状态链，FinDialogs/ImportResultToast 放最后**）。
- [ ] **Step 2:** `npm run build` 绿。
- [ ] **Step 3:** commit `feat(reports): 资产负债表屏(两栏三级动线+编辑+汇总只读) + 路由`。

---

## Task 4: 导入（解析器 + registry report_bs + 屏接入）

**Files:** Create `utils/importBalanceSheet.ts`, `utils/importBalanceSheet.spec.ts`; Modify `utils/importRegistry.ts`, `utils/importRegistry.spec.ts`, `views/reports/balance-sheet/BalanceSheetView.vue`

**Interfaces — Produces:**
- `importBalanceSheet(matrix): { sections: {label:string, records:{rowKey:string, end:number}[]}[]; error?:string }`。真实 sheet 布局（先 Read spec §4 + 参考 `importIncomeStatement.ts`）：表头行 `资产|行次|①期末余额|②…|⑥期末余额（创燊高）|期末余额合计|负债和所有者权益…|行次|①期末余额|…|期末余额合计`——**左右两块各自** (名称列, 行次列, 每公司 1 列)；公司名取自列头（`①`/`③期末余额（帮管好）`→ 去「期末余额」壳取公司名，与利润表列头公司名对齐——**注意利润表列头是 `③物业（火炬园）` 而资产负债表是 `③期末余额（帮管好）`，公司名提取规则：去前缀序号外壳后取括号内名或序号本身**，与 importIncomeStatement 的公司名规则保持一致产物（①/②/③…开头即同公司）——实现为：列头 normalize 后提取 `①②③④⑤⑥` 序号 + 括号内名，段 label = 序号+括号名（如 `③帮管好`），两报表导入各自建各自名下公司即可，不强求跨表同名）；忽略「期末余额合计」列；数据行按左右块**各自行次**匹配 BS_ROWS normal 行（label/subtotal/无行次「其中」行跳过）；每公司一段（左右块 records 合并）。
- registry `report_bs`：`{key:'report_bs', label:'资产负债表', tag:'报表', icon:'scale', context:'ledger'(需 year/month), modalProps: customParse=importBalanceSheet(labelMode 多公司段), run: 逐段公司名匹配 companyApi.list/未匹配 companyApi.create → cells=[{rowKey,field:'end',amount:end}] → reportApi.import('bs',ctx.year,ctx.month,{sections}) 聚合, target: ()=>\`\${year}-\${month} · 资产负债表\`}`（参照既有 `report_is` 条目实现）。
- `importRegistry.spec.ts`：键数 10→11 含 `report_bs`；context 断言 `['ledger','report_bs','report_is']`。
- View 接 `FpImportModal`（同 IS 屏：编辑按钮旁「导入」，`companyId==='all'`/未选月禁导入，`@import-sections` → `runImport('report_bs', picks, {year,month}, fileName)`）。

- [ ] **Step 1:** 写解析器 spec（先失败）：合成两栏 6 公司矩阵——左右块拆分、按行次匹配 side、合计列忽略、「其中」/label/subtotal 行跳过、公司段 label 正确。
- [ ] **Step 2:** 实现 → `npx vitest run importBalanceSheet` 绿。
- [ ] **Step 3:** registry + spec 更新 + View 接入 → `npm run build && npx vitest run` 全量绿。
- [ ] **Step 4:** commit `feat(reports): 资产负债表导入(两栏6公司解析+自动建公司) + registry report_bs`。

---

## Task 5: 端到端真跑验证（编排者亲验）

- [ ] **Step 1:** 全量 `./mvnw test` 绿（V23 迁移 + bs 用例）→ 打 jar → 起真后端(13306) + preview。
- [ ] **Step 2:** preview：/balance-sheet L1→L2(2025-09 有种子)→L3 两栏渲染 + 种子值 + 合计客端重算（资产总计=货币资金+应收账款=27,774,662.92；负债权益总计=短期借款+应付账款+实收资本=63,687,183.99；平衡差非 0 显红提示）→ 编辑重算 → 全部汇总只读。
- [ ] **Step 3:** 真实 `.xls` 资产负债表 sheet 喂解析器实测（临时 spec 方式，同 A）：拆出 6 公司、行次匹配正确、合计列忽略。0 console error。
- [ ] **Step 4:** 收尾杀 :8080；提交；更新记忆。

---

## Self-Review

**Spec coverage：** B1 单列 end→T2/T3；B2 两栏→T3；B3 行次 1–53→T2；B4 合计客端重算→T2(BS_SUBTOTAL)+T4(导入丢合计,解析只收 normal 行)；B5 白名单一行→T1；§3 V23→T1；§4 前端四件→T2-4；§5 测试→T1-5。全覆盖。
**Placeholder scan：** 无 TBD；V23 SQL 完整；合计公式逐条列出；解析器给了公司名提取规则决策（两报表各自建名，不强求跨表同名——spec §4 未明说处在此定死）。
**Type consistency：** `field='end'`、`computeBsRow` 签名同 A `computeRow` 约定、registry 条目形状同 `report_is`、`reportApi.import('bs',...)` 复用 A 签名，一致。
