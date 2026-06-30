# demo3 真实模板导入修复（工资 + 办公水电）+ 假数据可删 — 设计规范

- 状态：直接实现（用户 2026-07-01 提供真实文件 `工资测试.xlsx` / `办公室水电测试.xlsx` 并要求「发现问题直接写 spec，写完直接开始实现」）。
- 标准：遵 `docs/design/IMPORT-GUIDE.md`（**不按猜的结构定 → 已按真实文件定**）。复用现有导入引擎，最小化新增。
- 事实源：真实文件 dump（见下）。前序试点列映射是**按猜的简化标签**定的，与真实表头对不上 → 本次按真实表头重定。

## 0. 真实文件结构（事实，非猜测）

### 工资测试.xlsx（附表12）
- **一张 sheet 多月堆叠**：`2025年1月工资表(总表）`（r1 标题）+ 空行 + `2025年2月工资表(总表）`（r42 标题）。每月一张完整表。
- **三行表头**：r1 标题 `(\d{4})年(\d{1,2})月工资表`；r2 分组行（序号|姓名|职种/职务|月工资…|补助…|招商提成|出勤…|应发工资（元）|代缴代扣（元）…|实发金额（元）|签收|备注）；r3 叶子行。
- **叶子标签（真实）**：`基本工资·岗位工资·绩效奖金·全勤奖·岗位技能津贴·学历津贴·其它津贴·合计工资·午餐补助·高温及其他补贴·招商提成(落 r2)·应出勤（天）·请假（天）·实出勤（天）·全勤考核·社保·上月个税·其他`。
- **前置序号列**（colB=1,2,3…）；**职种/职务文本列**（总经理/保洁/见习经理（03）…）。
- **分组小计行穿插**：`办公室人员合计 / 保洁人员合计 / 保安人员合计 / 创显总计`（姓名列空 → 现有 blank-name 跳过即可，且含 合计/总计 命中 isSubtotal）。
- **请假（天）含小数**：0.5 / 2.125 / 0.31（见 §3 已知限制）。

### 办公室水电测试.xlsx（附表13）
- **一张 sheet 多年堆叠**：2024 块（r2-r13）+ `2024年合计`（r14 小计）+ 2025 块（r15-r26）+ `2025年合计`（r27）。
- **单行表头**（r1）：`月份 | 所属月份 | 用电量(千瓦） | 基准用电单价（千瓦/元） | 电费金额（元） | 备注`。
- **只有电、没有水**（办公区只计电；`电费金额` 是派生，不导）。
- **月份/所属月份是日期**（openpyxl 存 datetime `2024-01-01`）。月份=记账月，所属月份=上一月。
- **xlsx 读取**：现 `XLSX.read` 无 cellDates → 日期单元格出**序列号**(45292)；粘贴路径出 Excel **显示文本**（格式未知，须容错）。

## 1. 问题清单（根因）

| # | 问题 | 根因 |
|---|---|---|
| P1 | 工资导入识别不出列 | `SALARY_COLUMN_MAP` 用简化标签（基本/岗位/技能津贴/高温及其他/应出勤/请假），真实是 基本工资/岗位工资/岗位技能津贴/高温及其他补贴/应出勤（天）/请假（天）→ normalize 后不等 |
| P2 | 工资整表多月无法一次导 | 现工资导入是单段 columnMap，只入当前月；真实文件多月堆叠（标题行分隔） |
| P3 | 职种/职务导不进 | matchByHeader 对所有映射列 cleanNum → 文本变 0；现已把 role 移出映射 |
| P4 | 办公水电识别不出列 | `UTILITIES_COLUMN_MAP` 用 用电量/基准单价(元/千瓦)，真实是 用电量(千瓦)/基准用电单价（千瓦/元）→ normalize 后不等 |
| P5 | 办公水电年份/月份错乱 | 月份是日期且跨年(2024+2025)；现 parseMonth 取首个 1-12 → "2024-01-01" 误判，且导入按「卡片年」单年定位，跨年行落错年 |
| P6 | **假数据删不掉** | 现有数据 100% `source='seed'`；single delete→409、batch→skipped、前端 checkbox/全选/删除按钮对 seed 全禁。seed 被设计为「官方台账不可删」 |

## 2. 设计

### WI-1 matchByHeader 增强（`utils/importHeaderMatch.ts` + spec）
1. **前缀匹配**：列头命中标签的判定从「normalize 后相等」改为「normalize(header) === 或 startsWith normalize(label)」。扛单位后缀：`用电量(千瓦)`→用电量千瓦 前缀命中 `用电量`；`基准用电单价（千瓦/元）`→基准用电单价千瓦元 前缀命中 `基准用电单价`；`应出勤（天）`→应出勤天 前缀命中 `应出勤`；`请假（天）`前缀命中 `请假`。
   - 改两处 labelToKey 查询为遍历 columnMap 前缀测试（小表，O(列×标签) 可接受）。
   - 防误命中：标签用**够长够独特**的真实前缀（用 `基本工资` 不用 `基本`），避免短标签被无关长列头前缀吞掉。
2. **文本列**：`ColumnMapEntry` 加可选 `text?: boolean`。matchByHeader 对 `text` 列存**原始 trim 字符串**（不 cleanNum）。用于 职种/职务(role) 与 所属月份(belongMonth)。
   - 费用标签计数（定 headerEnd 的 ≥2 命中）与列定位逻辑不变（text 列也算命中）。
3. **回归**：现有 9 个用例 + 附表10 二期结构必须仍绿；新增前缀匹配 + 文本列用例。

### WI-2 工资导入（真实标签 + role 文本 + 多月分段）
- **`SALARY_COLUMN_MAP`（SalaryView.vue）改为真实标签**：
  `职种/职务`→role(**text**)、`基本工资`→base、`岗位工资`→post、`绩效奖金`→perf、`全勤奖`→attend、`岗位技能津贴`→skill、`学历津贴`→edu、`其它津贴`→other、`午餐补助`→lunch、`高温及其他补贴`→heat、`招商提成`→commission、`应出勤`→shouldDays、`请假`→leaveDays、`社保`→social、`上月个税`→tax、`其他`→otherDeduct。nameLabels=`['姓名']`。
  - 不导：合计工资/实出勤/全勤考核/应发/实发/代缴代扣（派生或未建模）。`其他` 与 `其它津贴` 注意区分（其它津贴=other 津贴项；其他=otherDeduct 扣项），靠前缀+完整标签消歧。
- **多月分段**：新增 `utils/importSalarySections.ts`（仿 importSections 但**单版面无期**）：按标题正则 `/(\d{4})\s*年\s*(\d{1,2})\s*月.*工资表/` 切段 → 每段 matchByHeader(columnMap) → `{year, month, records}`。0 标题 → 整表 1 段（year/month 用当前选中槽）。
- **FpImportModal 加 `salarySections` 通路**：传 `sectionTitleRe` + columnMap（非 phaseLayouts）时，用 importSalarySections 拆 → 复用 ImportSummary 汇总确认（**ImportSummary 让「期」选择 + layout 列可选隐藏**，仅显示 年/月/N 人/✓）→ emit `importSections`（沿用 `{year,month,phase?,records}`，phase 缺省）。
- **SalaryView onSmartImport**：循环各段 `salaryApi.importRows(year, month, {rows})` 逐月导入 + 跳到首段月。
- **后端**：`SalaryService.importRows` 已收 role → 直接透传（matchByHeader 现给 role 文本）。`shouldDays/leaveDays` 仍 Integer，导入时**四舍五入取整**（见 §3 限制）。其余字段不变。
- **IT**：扩 `SalaryImportApiIT` 覆盖 role 文本入库、真实标签命中。

### WI-3 办公水电导入（真实标签 + 日期跨年路由）
- **`UTILITIES_COLUMN_MAP`（UtilitiesView.vue）改真实标签 + 前缀友好**：
  `用电量`→elecQty、`基准用电单价`→elecPrice、`用水量`→waterQty、`基准用水单价`→waterPrice、`所属月份`→belongMonth(**text**)。nameLabels=`['月份']`（记账月=行身份）。办公文件无水列 → waterQty/waterPrice 缺省 0（无碍）。
- **日期解析 `utils/parseYearMonth.ts`**：输入单元格（Excel 序列号 / Date / `YYYY-MM-DD` / `YYYY/M/D` / `YYYY年M月` / `YYYY-MM` / 裸 `M月`/`M`），输出 `{year, month}|null`。序列号按 Excel epoch 换算；裸月无年 → 用回退年（卡片年）。
- **xlsx 读取增强（FpImportModal）**：`XLSX.read(data,{type:'array',cellDates:true})` + `sheet_to_json(ws,{header:1,blankrows:false,defval:'',raw:false,dateNF:'yyyy-mm-dd'})` → 日期单元格出 `2024-01-01` 字符串，parseYearMonth 直接解析。
- **跨年路由**：UtilitiesView onImport 对每行 parseYearMonth(月份) → acctMonth=`YYYY-MM`、parseYearMonth(所属月份|fallback acct) → belongMonth。按 acct 年分组，逐年 `importRows`。
- **后端 OfficeService.importRows 重构**：行改携 `acctMonth`(必填 `YYYY-MM`)、`belongMonth`(选填，缺省=acct)、四值。删 parseMonth+year 拼接逻辑。**clear+insert 语义按行内出现的年集合**：先删这些 (scheduleNo, year) 的 import 行，再插。端点签名 `POST /api/utilities/{no}/import`（body 行自带 acctMonth；保留 `?year` 仅作清空兜底或弃用——取**弃用 year 参数，全由行驱动**）。格式校验 `YYYY-MM` + 年 2000-2100 + 月 1-12，非法 → errors 跳过。
- **IT**：扩 `OfficeImportApiIT` 覆盖跨年（2024+2025 同次导入各落各年）、日期文本/序列号、所属月份。

### WI-4 假数据（seed）可删
- **后端去 seed 保护**：`SalaryService.delete/batchDelete`、`OfficeService.delete/batchDelete` 删除 `"seed".equals(source)` 判分支 → seed 与 manual 同等可删。`clearImported` 保持仅删 import（重导不动 manual/seed，语义正确）。
- **前端去锁**：`toggleSelect`/`selectAll`（两 View）去掉 `source==='seed'` 跳过；`SalaryTable.vue`/`UtilitiesTable.vue` 去 checkbox `:disabled="r.source==='seed'"`、去 `selectableRows` 滤 seed、去「官方台账,不可删除」禁用删除按钮（seed 行也给可点删除按钮）。保留 manual/import/seed 角标（仅展示，不锁）。
- **IT 改判**：`SalaryDeleteApiIT`/`OfficeDeleteApiIT` 把「批删跳种子 skipped=1」改为「seed 也删 deleted 含种子、skipped=0」；single delete seed 由 409 改 204/成功。
- 全选 + 删除选中即可清空整年/整月（含 seed），无需新端点。

## 3. 已知限制（实现时落注释 + 完工向用户说明）
- **考勤天数取整**：`shouldDays/leaveDays` 实体为 int，真实「请假（天）」含小数（2.125/0.5/0.31）→ 导入四舍五入。如需精确小数，后续改 BigDecimal（实体+迁移+DTO+合计+导出，独立一刀）。本次不做。
- **粘贴日期格式**：parseYearMonth 覆盖常见格式；若用户 Excel 月份列是异形格式（如 `Jan-24`）解析失败 → 该行 errors 跳过并提示，用真实粘贴实测再补格式。

## 4. 验证（IMPORT-GUIDE §四铁律 — 编排者亲验）
- 后端**全量 `./mvnw test`**（不接管道；含改后 IT）。
- 前端 build + vitest（含 matchByHeader 前缀/文本、parseYearMonth、salary 分段）。
- **起真后端 + preview 用真实两个 xlsx 实测**：
  - 工资：上传 `工资测试.xlsx` → 识别 2 个月段（2025-01 / 2025-02）→ 汇总确认 → 逐月导入 → 抽查 冯谨/符 的 role+各列金额、分组小计未入、人数对。
  - 办公水电：上传 `办公室水电测试.xlsx` → 24 行跨 2024/2025 → 各落各年（用电量/单价/所属月份）、年度小计未入。
  - 假数据：进任一年 → 全选 → 删除选中 → seed 清空成功（含 single delete seed 不再 409）。
  - 0 console error。导入后清理回种子态（或按需保留）。
- opus 对抗复审发现项 → 修复再验。

## 5. 明确不做（OUT）
- 光伏/充电桩/电费导入（下一刀）；考勤小数化（独立一刀）；save-confirm 退出确认；import_log 历史。

## 6. 实现/验证中发现的设计调整（实测真实文件后定稿）
1. **办公水电日期格式 M/D/YY**：真实 xlsx 月份/所属月份单元格自带 `m/d/yy` 数字格式，经 SheetJS `raw:false` 渲染成如 `1/1/24`/`12/1/23`（**非** `2024-01-01`）。parseYearMonth 增「M/D/YY(年末位)」解析分支（日占位忽略；首字段>12 视为日改用次字段为月；2 位年补 2000）——确定性解析，不靠 `new Date` 的 locale。
2. **办公水电导入 = 按(附表,月)upsert**：`office_record` 有唯一约束 `uk_office(schedule_no, acct_month)`（**每月一行**模型）。原「clear+insert 仅删 source=import」在导入有种子的月份时撞唯一键 → 500。改为**先删被导入月份的行(任意来源:种子/手动/导入)再插**——「导入即覆盖这些月」，自动取代假种子，**不波及未导入的月**（实测：导入 2024+2025 各 12 月，替换 2025 的 12 条种子，2026 种子原样保留）。`clearImported`(清空本期导入)仍只删 import，语义不变。工资多行/月无此约束，保持 clear-import-only。
3. **IT 隔离**：去 seed 保护后，删/改共享种子的 IT 用例（两 ServiceTest 的 delete_seedRow、两 ApiIT 的 delete_seedRow、两 DeleteApiIT、OfficeImportApiIT）加 `@Transactional` 回滚还原；跨年导入用例改用无种子年份(2096/2097)。避免污染同库读测试的确定性计数。
