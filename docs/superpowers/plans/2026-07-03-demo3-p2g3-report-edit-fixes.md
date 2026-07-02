# P2-G3 派生行只读 + 三大报表编辑修补 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`)。本计划由 Workflow 编排实现，编排者亲跑测试把关。

**Goal:** ①附表派生映射行只读不可删（其余行照旧）；②三大报表新增子类 500 修复（契约对齐 body）；③is/bs/tb 编辑态补导入入口；④is/bs/tb 批量删除（固定行清空、自定义/科目行删除）。

**Architecture:** 四个互不相交的文件域并行：后端契约（T1）‖ 附表只读（T2）‖ is/bs 编辑修补（T3）‖ tb 编辑修补（T4）。零新后端能力（仅 T1 契约修正）。

**Tech Stack:** 同 P2 各刀。

**Spec:** `docs/superpowers/specs/2026-07-03-demo3-p2g3-report-edit-fixes-design.md`（J1–J6 以此为准）

## Global Constraints

- 继承既往全部 Global Constraints（§6 加载门/§7 居中弹窗/编排者亲跑全量测试）。
- G3 特有：映射行判定=**静态** (schedule,group,label)∈DERIVE_MAP（不依赖派生数据加载）；批量删除中自定义/科目行沿**既有删除语义**（is/bs 立即级联 DELETE、tb 草稿树移除随保存）、固定行清空**进 draft**；公式/小计行不可选；导入成功=退出编辑+重拉。

---

## Task 1: 后端 custom-row 契约改 @RequestBody

**Files:** Modify `controller/ReportController.java`、`test/.../api/ReportApiIT.java`

**Interfaces — Produces:** `POST /api/reports/{statement}/{companyId}/custom-row` 收 JSON body `{parentKey,label,level}`（record CustomRowReq，level 可空缺省 1）。前端 `api/report.ts` 现有调用**零改动**即恢复工作。

- [ ] Step 1: Controller 改 `@RequestBody CustomRowReq`（record 内联或 dto 包,循现有风格）;Service 判空逻辑不动(BAD_REQUEST 语义保留)。
- [ ] Step 2: ReportApiIT 内所有 custom-row POST 用例改 `contentType(json).content({...})` 调用;补一条 body 缺 parentKey → code 400 用例。
- [ ] Step 3: `mvnw -q test-compile` 过 → commit `fix(reports): custom-row 契约对齐前端(JSON body),修复新增子类 500`。

---

## Task 2: 附表派生映射行只读+不可删

**Files:** Modify `reports/pnlDerive.ts`+`.spec.ts`、`views/reports/pnl/PnlTable.vue`、`views/reports/pnl/PnlScheduleView.vue`

**Interfaces — Produces:** `isMappedRow(schedule: string, groupLabel: string, label: string): boolean`（双 normalize 匹配 DERIVE_MAP）。

- [ ] Step 1: pnlDerive.spec 先失败（命中/未命中/双分组同标签/normalize 剥标点命中）→ 实现 isMappedRow → 绿。
- [ ] Step 2: PnlScheduleView 算 `mappedKeys: Set<rowKey>`（displayRows × isMappedRow）传 PnlTable 新 prop；PnlTable 编辑态映射行：月格渲染只读文本（同读态格式,不渲 input）、行尾删除钮不渲染；「填入」钮/备注编辑保留；非映射行行为不变。
- [ ] Step 3: `npm run build` 绿 + `npx vitest run` 全量绿 → commit `feat(pnl): 派生映射行只读+不可删(值仅来自数据层)`。

---

## Task 3: is/bs 编辑态导入 + 批量删除

**Files:** Modify `views/reports/income-statement/IncomeStatementView.vue`、`views/reports/balance-sheet/BalanceSheetView.vue` + 各自表组件（先 Read 确认:IncomeStatementTable/FinReportTable 谁渲染行,复选列落最少改动点;两屏若共享基座则基座一处改）

**要点：**
- 编辑态按钮组补「导入」（同只读态按钮,复用现有 importing 弹窗）；onImported 成功路径在编辑态时**先退出编辑（不保存草稿）再 loadPeriod**。
- 编辑态行首复选列：普通固定行+自定义行可选；公式/小计/父项深色行不渲复选框。工具栏「删除所选 (N)」钮（有选中才显）→ §7 居中确认弹窗（列明:自定义行 X 行将删除、固定行 Y 行将清空本期数值,保存后生效）→ 确认后:自定义行循环既有 `deleteCustomRow`（立即,级联）→ loadPeriod;固定行各列值写 draft null（界面立现空,随「保存」落库）。
- 复选状态退出编辑/切期清空。

- [ ] Step 1: is 屏 + 表组件复选列。
- [ ] Step 2: bs 屏（两栏各自表格,选集合并计数）。
- [ ] Step 3: `npm run build` 绿 + `npx vitest run` 全量绿 → commit `feat(reports): is/bs 编辑态导入入口+批量删除(自定义删/固定清空)`。

---

## Task 4: tb 编辑态导入 + 科目批量删除

**Files:** Modify `views/reports/trial-balance/TrialBalanceView.vue`、`views/reports/trial-balance/TbTable.vue`（先 Read 现删科目实现,批量沿同语义）

**要点：**
- 编辑态按钮组补「导入」（同 T3 语义:成功→退出编辑→重拉）。
- 编辑态科目行复选（合计尾行不可选）+「删除所选 (N)」→ §7 确认（写明连同子科目与金额,保存后生效）→ 所选科目**连子树**从草稿树+金额移除（沿既有单删语义,若既有单删是立即落库则批量同其语义——以 Read 到的现状为准,勿造第二套）。

- [ ] Step 1: 改造 + `npm run build` 绿 + `npx vitest run` 全量绿。
- [ ] Step 2: commit `feat(reports): tb 编辑态导入入口+科目批量删除(连子树)`。

---

## Task 5: 端到端真跑（编排者亲验）

- [ ] 全量 `./mvnw test` 绿（含改后 ReportApiIT）→ jar（`$env:DB_PORT='13306'`;**8080 若被 spring-boot:run 占用是用户在跑,先确认再处理**）+ preview。
- [ ] curl:custom-row JSON body → code 0（500 消失）;缺 parentKey → code 400。
- [ ] preview:is 编辑态 新增子类成功+导入钮在;勾 固定行+自定义行 批量删除 → 自定义行消失、固定行清空、保存后库中金额删除;bs 同验一遍;tb 勾科目删除随保存生效;附表1 二期租金收入(映射)编辑态无 input 无删除钮、一期租金收入(非映射)可编辑可删。
- [ ] 0 console error;清理测试产生的行;杀自己起的 jar;提交遗留;更新记忆。

---

## Self-Review

**Spec coverage：** J1→T2;J2→T1;J3→T3/T4 导入;J4→T3;J5→T4;J6 零新后端→T3/T4 全走既有端点;§3 测试→T1 IT/T2 spec/T5 E2E。全覆盖。
**Placeholder scan：** 无 TBD;表组件落点与 tb 批量语义均「先 Read 现状再沿用」定死处理方式;确认弹窗内容已给文案要点。
**Type consistency：** isMappedRow 签名 T2 定义消费;CustomRowReq 字段=前端现发 body 字段;mappedKeys prop 由 View 算 Table 消费。
