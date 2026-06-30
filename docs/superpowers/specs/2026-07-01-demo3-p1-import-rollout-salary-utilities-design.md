# demo3 P-Import-2 导入推广（试点：工资 + 办公水电）— 设计规范

- 状态：已批准（2026-07-01 brainstorming），待用户复审
- 标准：遵 `docs/design/IMPORT-GUIDE.md`（导入架构 + 真实 Excel 解析规则 + 验证铁律 + 新屏接入清单）。
- 复用（全已建，零新增解析工具）：`FpImportModal`(columnMap 单段模式) · `utils/importHeaderMatch.matchByHeader` · `ImportResultToast` · 后端 clear+insert / clearImported / batchDelete 范式（见附表10）。

## 1. 目标与范围

把附表10 已验证的导入范式推广到**工资(附表12)**、**办公水电(附表13/14)** 两个试点屏。**本期不做**：光伏(6)/充电桩(7/8)/电费(11)（下一刀）、save-confirm 退出确认（属编辑 UX，非导入，可后续补这两屏）、多段智能导入（附表10 专有，记录型屏单段即可）。

**关键复用洞察**：`matchByHeader` 的「关键列」泛化为「行身份列」——工资=**姓名**、办公水电=**月份**。返回的 `tenantName` 字段装该身份值，后端各自解读。故**两屏直接走 FpImportModal 的 columnMap 模式**，无需新解析工具。

## 2. 工资（附表12）导入 — 员工型，行身份=姓名

### 2.1 后端
`POST /api/salary/import?year=&month=`，body `SalaryImportRequest { rows: List<Row> }`，`Row{ tenantName(=姓名), role?, base,post,perf,attend,skill,edu,other,lunch,heat,commission,shouldDays,leaveDays,social,tax,otherDeduct }`（应发/实发等派生不传）。
- 语义=clear+insert：先删本 `acctMonth(=year-month)` 的 `source='import'` 行，再逐行 insert：`name=tenantName.trim()`（空→errors 跳过）、`empIdx`=导入行序(1,2,…)、`acctMonth`=槽、`source='import'`、`fullAttend` 由 shouldDays/leaveDays 派生或随既有 SalaryService 口径。`@Transactional`。复用 SalaryService 既有字段 set / 派生。
- `clearImported(year,month)` → DeleteResultDTO；`batchDelete(ids)`（source='seed' 跳过）。
- 端点：`DELETE /api/salary/imported?year=&month=`（year/month 范围校验）+ `DELETE /api/salary/batch`(body{ids})。
- 测试 `SalaryImportApiIT` / `SalaryDeleteApiIT`：重导替换(手动/种子保留)、清空导入、批删跳种子、非法参数 400。

### 2.2 前端（SalaryView）
- 现「导入 Excel」占位 → FpImportModal：`columnMap`=SalaryTable 两级表头叶子标签 → SalaryRecord 字段 key（姓名除外，姓名走 nameLabels；序号/应发/实发/全勤 等派生或身份列不入 columnMap）、`nameLabels=['姓名']`、scope=当前(year,month)。`onImport` → `POST .../salary/import` → ImportResultToast → 重载本月+overview。
- 「清空本期导入(N)」按钮（编辑态，N=本月 source='import' 行数）+ 确认 → clearImported → 重载。
- SalaryTable 编辑态加复选框列（种子行 disabled）；SalaryView selectedIds + 「删除选中(N)」→ batchDelete → 重载。

## 3. 办公水电（附表13/14）导入 — 记录型，行身份=月份

### 3.1 后端
`POST /api/office/{scheduleNo}/import?year=`，body `OfficeImportRequest { rows: List<Row> }`，`Row{ tenantName(=月份字符串,如"1月"/"01"/"2025-01"), elecQty, elecPrice, waterQty, waterPrice }`（电费/水费/合计派生不传）。
- 语义=clear+insert：先删本 `(scheduleNo, year)`（acct_month LIKE 'year-%'）的 `source='import'` 行，再逐行 insert：**解析 tenantName→月号**（取其中数字 1-12，否则 errors 跳过）→ `acctMonth=belongMonth=`${year}-${MM}``、`scheduleNo`、四值、`source='import'`。`@Transactional`。复用 OfficeService 字段 set。`scheduleNo∈{13,14}` 白名单。
- `clearImported(scheduleNo,year)`、`batchDelete(ids)`；`DELETE /api/office/{scheduleNo}/imported?year=` + `DELETE /api/office/batch`。
- 测试 `OfficeImportApiIT`/`OfficeDeleteApiIT`：重导替换、月份解析、清空、批删跳种子、scheduleNo/参数非法 400。

### 3.2 前端（UtilitiesView）
- 现「导入 Excel」占位 → FpImportModal：`columnMap`=UtilitiesTable 列（用电量/基准单价(电)/用水量/基准单价(水) → elecQty/elecPrice/waterQty/waterPrice）、`nameLabels=['月份','所属月','月']`、scope=当前(scheduleNo,year)。`onImport` → `POST .../office/{no}/import?year=` → 结果 → 重载本年。
- 「清空本期导入(N)」+ 编辑态复选框批删（种子禁选）。

## 4. 列映射事实源 + 容差

- columnMap 取自各屏自己的列定义（SalaryTable/UtilitiesTable 表头标签 → 实体字段 key），像附表10 取自 layout.ts。
- `matchByHeader` 的 normalize 兜小标点/空格差异；多行表头跨行扫；前置/尾部多余列忽略；小计行跳过（IMPORT-GUIDE §三）。
- **用户拿真实文件实测再报偏差**（IMPORT-GUIDE 铁律：不按猜的结构定）。

## 5. 验证（IMPORT-GUIDE §四铁律）

- 后端**编排者亲跑全量 `./mvnw test`**（不接管道；含 4 个新 IT；JsonPath 断言用 isNotEmpty 等）。
- 前端 build + vitest。
- 起真后端 + preview：工资屏（某年某月）粘贴员工表 → 按姓名识别 → 导入 → 清空本期导入 → 勾选批删；办公水电屏（某年）粘贴逐月表 → 按月份识别 → 导入到各月 → 清空 → 批删；**含中文走浏览器不用 curl**；0 console error。opus 对抗复审 + verify。

## 6. 明确不做（OUT）

光伏/充电桩/电费导入（下一刀，电费 energy/basic 双类型最杂）；save-confirm 退出确认（这两屏可后续同附表10 补）；台账导入升级名字匹配；import_log 历史（P-Import-3）。
