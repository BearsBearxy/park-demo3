# demo3 P1 统一 Excel 导入（P-Import-1：引擎 + 台账&附表10 试点）— 设计规范

- 状态：已批准（2026-06-30 brainstorming），待用户复审
- 事实源：`_handoff_extracted/untitled/project/app/import-excel.jsx`（FPImportModal）+ 各屏既有 `parseRow` 范式（如 `screen-schedule10.jsx`）
- 复用：SheetJS（`xlsx` 已装，导出在用）、各子系统既有 service/mapper、DS Button

## 1. 目标与范围

让 Excel 导入在录入屏真正可用。统一 Excel 导入是三块独立工程，本 spec 仅做**第一刀**：

**P-Import-1 = 共享导入引擎 `FpImportModal` + 台账(ledger)、附表10(s10) 两个试点端到端**（上传/粘贴 → 解析 → 预览 → 批量 upsert → 重载）。两试点覆盖最复杂的两种：台账（多公司、tenant_id FK 解析）、附表10（office/factory 双版面、软引用名字）。

**本期不做（后续期）**：其余 5 录入屏接入（P-Import-2）、导入中心 hub + `import_log` 历史表（P-Import-3）、clearFirst 整槽替换模式。

## 2. 全局约束 + 取舍

- JWT 保护、`Result<T>` 封装、`com.park.demo3` 包。
- **导入语义 = upsert 合并**：导入的行 upsert，槽内**未在本次导入里的行不动**（不删）。导入行标 `source='import'`**仅限有 source 列的表**（s10_record 有；`monthly_ledger` 无 source 列，导入即 upsert 费用值、不另标记）。
- **逐行定向 upsert**：台账**不复用整月 `save`**（其含"删空"逻辑会抹掉未导入租户），导入端点对每行做定向 insert/update。
- **坏行/未匹配诚实报告**：解析不出/不匹配模板的行在前端 `parseRow` 跳过；后端无法落库的行（如台账租户名未匹配）进 `errors`，不静默、不自动造数据。
- 视觉沿用 Factory Park DS（墨蓝+蓝族），FpImportModal 自带 scoped 样式。

## 3. 共享引擎 `frontend/src/components/import/FpImportModal.vue`

1:1 移植 `import-excel.jsx`，Vue3 `<script setup>`：

- **Props**：`title:string`、`sub?:string`、`templateCols:string[]`（模板列顺序，显示 + 预览表头）、`parseRow:(cells:string[], i:number)=>Rec|null`（各屏映射，返 null 跳过）、`skipHeader=true`、`onClose`、`onImport:(recs:Rec[])=>void`。
- **两入口**：① 上传文件（拖拽/点选 .xlsx/.xls/.csv）：`.csv` 用 `FileReader`+内置 CSV 解析；`.xlsx/.xls` **`await import('xlsx')` 懒加载** `XLSX.read` → `sheet_to_json(header:1)` 取二维数组。② 从 Excel 粘贴：textarea，TSV（有 \t）/CSV 解析。
- **流程**：二维数组 → `skipHeader` 跳首行 → 逐行 `parseRow`（坏行 try/catch 跳过）→ 记录数组（含 `__preview` 供预览）→ 预览表（前 6 行 `templateCols` 对齐）+ 条数 + 错误/成功提示。
- **确认** → `onImport(records)`（剥除 `__preview`）。
- 解析 helper（`parsePaste`/`parseCSV`）移植为本组件内或 `utils/importParse.ts`（带单测）。

## 4. 后端：统一批量导入端点

共享返回体 `ImportResultDTO { imported:int, skipped:int, errors: List<ImportError> }`，`ImportError { rowIndex:int, label:String, reason:String }`。

### 4.1 台账导入（tenant_id FK 解析）
`POST /api/ledger/companies/{id}/import?year=&month=`（沿用既有 LedgerController 基址 `/api/ledger/companies/{id}`），body `LedgerImportRequest { rows: List<Row{ tenantName:String, <21 费用 BigDecimal> }> }`。
- 逐行：`tenantName` → 在租租户（`status=1`）按 `company_name` 精确匹配 → 命中得 `tenantId`；未命中 → `errors += {rowIndex, tenantName, "未找到匹配在租租户"}`，跳过。
- 命中行：定向 upsert `monthly_ledger`（company_id+year+month+tenant_id 存在则 update 21 费用，否则 insert），复用 `LedgerService` 的 `FEE_SET`。**不触碰未导入的其他租户行**。
- `@PathVariable id`、`@RequestParam year/month` 校验（沿用既有 `@Min/@Max`）。
- 21 费用列顺序 = `LedgerSaveRequest.Row` 既有费用字段序（与前端 templateCols 一致）。

### 4.2 附表10 导入（软引用）
`POST /api/s10/import`，body `S10ImportRequest { phase:int, acctMonth:String, rows: List<Row{ tenantName:String, profile:String, <25 费用 BigDecimal> }> }`。
- `phase∈{1,2,3,4}` 白名单、`acctMonth @Pattern(\d{4}-(0[1-9]|1[0-2]))`（沿用安全批次铁律）。
- 逐行：按 `(phase, acctMonth, tenantName)` upsert（tenantName 空 → `errors`，跳过）；新行 `source='import'`、`tenant_id=null`（软引用）。复用 `S10Service` 落库逻辑，新增 `importRows` 方法显式置 `source='import'`。
- 返回 `ImportResultDTO`。

## 5. 前端：两屏接线

### 5.1 台账（LedgerMonthGrid）
- 现「导入 Excel」占位 → 打开 `FpImportModal`：
  - `templateCols = ['租户', ...21 费用列表头]`（取自 `LedgerWideTable` 表头原序，与导出列序一致）。
  - `parseRow(cells,i)`：`cells[0]`=租户名（空跳过）；`cells[1..21]`→21 费用（`s10Num` 式清洗）；返 `{ tenantName, fees{…}, __preview:[...] }`。
  - scope = 当前公司 id + 年 + 月（LedgerView 已选）。
  - `onImport(recs)` → `POST .../ledger/import` → 弹结果（imported/skipped + errors 列表）→ 重载本月。

### 5.2 附表10（S10View）
- 现「导入 Excel」占位（当前 `onImport` alert）→ 打开 `FpImportModal`：
  - `templateCols = ['租户名称', ...当前 layout 叶子 label]`（office/factory 随 phase）。
  - `parseRow`：`cells[0]`=租户名；其余→当前版面叶子 colId 值；`profile` 默认 `'factory'`（与种子真实租户口径一致；导入无抽屉不细分）；返 `{ tenantName, profile, <fees>, __preview }`。
  - scope = 当前 phase + `${year}-${month}`。
  - `onImport` → `POST /api/s10/import` → 结果 → 重载（沿用切换不闪的 loadMonth）。
- 结果提示组件：简单弹层/inline（imported N 条、skipped M、errors 可展开），复用 DS。

## 6. 明确不做（OUT）

pv/charging/elec/salary/utilities 接入（P-Import-2）、导入中心 hub + import_log 历史（P-Import-3）、clearFirst 整槽替换、导入撤销、列名模糊匹配（仅按模板列序）。

## 7. 测试

- 后端：`LedgerImportApiIT`（Testcontainers：正常导入 upsert + 未匹配租户进 errors + 不抹未导入租户）、`S10ImportApiIT`（upsert source=import + acctMonth/phase 非法→400）。
- 前端：`importParse.spec.ts`（CSV/TSV/带引号解析 + skipHeader）、`FpImportModal` 渲染/预览测试（给定 parseRow，断言预览前 6 行 + 条数 + onImport 载荷剥 __preview）。

## 8. 验证 / DoD（三类验证缺口铁律）

- 后端**编排者亲跑全量 `./mvnw test`**（不接管道掩盖退出码）。
- 前端 `vue-tsc` build + vitest 绿。
- 起真后端 + demo3-mysql:13306 + preview **真跑肉眼扫屏**：台账与附表10 各做一次 **① 粘贴导入**（TSV）+ **② 文件上传**（.xlsx/.csv），预览正确 → 导入 → 表更新；台账故意放一个**未匹配租户名**验 errors 报告 + 未导入租户未被抹；0 console error。
- opus 对抗复审（FK 解析正确性、定向 upsert 不删、source 标记、契约形状、SheetJS 懒加载、scoped 样式），verify 逐条核实防幻觉。
