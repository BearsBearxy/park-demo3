# demo3 · P2-G3 设计 — 派生行只读 + 三大报表编辑修补（500/导入入口/批量删除）

- **状态**：用户已下达明确修改/修复指令，按指令落地
- **日期**：2026-07-03
- **调查根因（已实证）**：
  - **新增子类 500**：前端 `api/report.ts addCustomRow` 以 **JSON body** POST `{parentKey,label,level}`；后端 `ReportController.addCustomRow` 用 **`@RequestParam`** 读 query 参数 → 参数缺失未被 GlobalExceptionHandler 归类 → 兜底 500。curl 双向复现：body→HTTP 500，query→code 0。IT 全绿假象=测试只用 query 参数调后端，前后端契约无人测。
  - **无导入按钮**：is/bs/tb 三屏 L3 的「导入」只在**只读态**按钮组渲染（`v-else-if="!edit"`）；新增子类必须在编辑态 → 编辑态无导入入口。附表屏(PnlScheduleView)编辑态有导入，为既有先例。
  - **无批量删除**：is/bs 仅自定义行有逐行删（立即 DELETE+级联），固定模板行无删/清空入口；tb 仅逐科目删。均无多选。

## 1. 决策（Decision Log）

| # | 决策 |
|---|---|
| J1 | **附表1–5 派生映射行只读**（用户指令）：行按 (schedule, normalizeHeader(group), normalizeHeader(label)) ∈ DERIVE_MAP 判定（静态判定,不依赖派生数据加载成功）。编辑态该行月格**只读展示**（同读态样式）、**无删除按钮**；「填入/全部填入」保留（值仅来自数据层,与只读定位一致）；备注仍可编辑（用户注记不碰账目值）。非映射行照旧可编辑可删除 |
| J2 | **500 修复=改后端契约**：`POST /{companyId}/custom-row` 改 `@RequestBody record CustomRowReq(String parentKey, String label, Integer level)`（level 缺省 1）；前端零改动（本就发 body）；ReportApiIT 相应用例改发 JSON body |
| J3 | **导入入口**：is/bs/tb 三屏编辑态按钮组补「导入」；导入成功=整期替换 → **退出编辑态并重拉**（未保存草稿随导入作废,导入弹窗副标题已说明整期替换语义） |
| J4 | **批量删除（is/bs）**：编辑态行首复选框（**仅普通固定行+自定义行**；公式/小计深色行不可选）+ 工具栏「删除所选」：自定义行**立即 DELETE**（循环既有级联端点,量小）；固定行**清空本期各列值进 draft**（保存后生效——值变更走草稿纪律,结构变更立即,与既有逐行删语义一致）。确认弹窗（§7 居中）写明两类行的不同处理 |
| J5 | **批量删除（tb）**：科目全是数据行无固定概念 → 所选科目**连子树**从草稿树+金额移除，随保存 clear+insert 落库（沿既有 tb 删科目语义） |
| J6 | **零新后端能力**：仅 J2 契约修正；批量删除/清空全走既有端点（DELETE custom-row 循环、save 整期） |
| J7 | **附表1–5 批量删除（用户追加指令）**：编辑态**去掉逐行删除按钮**，改行首复选多选 + 工具栏「删除所选(N)」+ §7 居中确认；**映射行不渲复选框**（J1 不可删）；删除沿附表既有单删语义（draft 移除，随整年保存落库）；选集在 退出编辑/保存/切年/导入 时清空 |

## 2. 涉及面

- 后端：ReportController（@RequestBody）+ ReportApiIT（用例改 body 调用）。
- 附表：pnlDerive.ts 增 `isMappedRow(schedule, groupLabel, label)`；PnlScheduleView 算 mappedKeys 传 PnlTable；PnlTable 映射行月格只读+隐删除钮。
- is/bs：IncomeStatementView/BalanceSheetView（编辑态导入钮+批量删除动作）+ 表组件（复选列,实现者先 Read 现结构定落点:共享基座则一处改,否则各自改）。
- tb：TrialBalanceView/TbTable（编辑态导入钮+科目多选+批量移除子树）。

## 3. 测试

- 后端：ReportApiIT 改 body 调用后全绿（含 body 缺 parentKey → 400 语义由 Bean Validation/显式判空保证,沿用现有 BizException BAD_REQUEST）。
- 前端 vitest：isMappedRow 判定（命中/未命中/双分组）；批量删除纯逻辑（选集拆分 自定义→删/固定→清空,公式行不可选）如有纯函数化则单测。
- E2E 真跑：is 编辑态新增子类成功（500 消失）+ 编辑态见导入钮；批量勾选 固定行+自定义行 → 删除所选 → 自定义行消失、固定行值清空（保存后库中无该行金额）；附表1 映射行（二期租金收入）编辑态月格不可输入、无删除钮,非映射行（一期租金收入）可编辑可删；tb 勾两科目删除随保存落库；0 console error。

## 4. 显式延后

- MissingServletRequestParameterException 全局归类 400（本刀契约修正后不再触发,通用归类另起）；is/bs 批量删除的「固定行清空」立即落库版（现走草稿,保存生效）；附表映射行的备注只读化。
