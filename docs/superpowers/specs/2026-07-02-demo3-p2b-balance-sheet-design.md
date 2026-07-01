# demo3 · P2-B 设计 — 资产负债表（手录 + 导入，复用 A 基建）

- **状态**：待用户复审
- **日期**：2026-07-02
- **作者**：Claude（brainstorming）
- **项目**：demo3 · P2 账簿与报表 第二刀（承接 [[P2-A]]）
- **事实源**：真实文件 `2025年10月文件（拼）.xls` 的「资产负债表」sheet（6 公司横向合并，每公司单列期末余额，两栏 资产‖负债权益）；原型 `app/screen-balance-sheet.jsx`、`app/fin-data.js`（BS_ROWS）。
- **前置**：P2-A（报表基础设施 + 利润表）已完成，A 建的 fin 外壳 + 通用后端 B 直接复用。

---

## 0. 背景与复用

B 是 P2 第二刀，**高度复用 A**：
- **后端通用**（`report_amount`/`report_custom_row`/`ReportService`/`ReportController` 7 端点）已 statement 参数化——B **仅需把 `bs` 加入 statement 白名单**，其余零改。
- **fin 外壳**（`FinCompanyPicker`/`FinMonthGrid`/`FinReportTable`/`FinDialogs`）直接复用。
- **导入引擎**（`FpImportModal`/`runImport`/`import_log`/registry）复用，新增 `report_bs` 条目 + `importBalanceSheet` 解析器。

**继承 A 的决策**（不再重议）：手录 + 导入并存；列口径文件忠实；按公司拆表；全部汇总跨公司只读求和；未匹配公司导入时自动新建；弹窗居中（§7）；§6 加载门 + v-else 紧邻链。

---

## 1. B 特有决策（Decision Log）

| # | 决策 | 取舍 |
|---|---|---|
| B1 | 列 = 单列 **期末余额**（`field='end'`），非 cur/ytd | 文件忠实 |
| B2 | **两栏布局**：资产（side L）‖ 负债和所有者权益（side R），各一个 `FinReportTable`（1 列），并排（原型 `.fin-two`） | 文件忠实 |
| B3 | 行模板用**文件真实行次 1–53**（非原型 BS_ROWS 的 100–270），逐行取自真实文件 | 文件忠实 + 导入按行次匹配 |
| B4 | 合计行**客户端按 sum 集重算、不落库**（编辑叶子即时更新；导入的文件合计值丢弃重算） | 用户拍板；同 A 小计不落库 |
| B5 | 后端仅加 `statement='bs'` 白名单；数据模型/端点零改（通用） | A 已通用化 |

---

## 2. 资产负债表行模板（`reports/balanceSheet.ts`，1:1 文件行次 1–53）

`BS_ROWS`（`{no, side:'L'|'R', label, level, type:'normal'|'label'|'subtotal'}`）：

**资产（side L）**：
- `流动资产：`(label) · 1 货币资金 · 2 短期投资 · 3 应收票据 · 4 应收账款 · 5 预付账款 · 6 应收股利 · 7 应收利息 · 8 其他应收款 · 9 存货 · 10 其中：原材料 · 11 在产品 · 12 库存商品 · 13 周转材料 · 14 其他流动资产 · **15 流动资产合计** · `非流动资产：`(label) · 16 长期债券投资 · 17 长期股权投资 · 18 固定资产原价 · 19 减：累计折旧 · **20 固定资产账面价值** · 21 在建工程 · 22 工程物资 · 23 固定资产清理 · 24 生产性生物资产 · 25 无形资产 · 26 开发支出 · 27 长期待摊费用 · 28 其他非流动资产 · **29 非流动资产合计** · **30 资产总计**
- 其中明细（10/11/12/13 = 存货 9 的其中）：level-1，**信息行，不汇总**。

**负债和所有者权益（side R）**：
- `流动负债：`(label) · 31 短期借款 · 32 应付票据 · 33 应付账款 · 34 预收账款 · 35 应付职工薪酬 · 36 应交税费 · 37 应付利息 · 38 应付利润 · 39 其他应付款 · 40 其他流动负债 · **41 流动负债合计** · `非流动负债：`(label) · 42 长期借款 · 43 长期应付款 · 44 递延收益 · 45 其他非流动负债 · **46 非流动负债合计** · **47 负债合计** · `所有者权益（或股东权益）：`(label) · 48 实收资本（或股本） · 49 资本公积 · 50 盈余公积 · 51 未分配利润 · **52 所有者权益（或股东权益）合计** · **53 负债和所有者权益（或股东权益）总计**
- （文件 `其中：航泽借款` 无行次 → 视为其他应付款 39 的信息注记，不建独立常驻行；如需可后续做自定义子类。）

**合计/公式规则**（`BS_SUBTOTAL`，客户端算不落库）：
- `20 固定资产账面价值 = g(18) − g(19)`（差额公式）
- `15 流动资产合计 = Σ(1,2,3,4,5,6,7,8,9,14)`（顶层项;其中 10-13 不计）
- `29 非流动资产合计 = Σ(16,17,20,21,22,23,24,25,26,27,28)`（用 20 账面价值,不重复 18/19）
- `30 资产总计 = g(15) + g(29)`
- `41 流动负债合计 = Σ(31..40)`
- `46 非流动负债合计 = Σ(42,43,44,45)`
- `47 负债合计 = g(41) + g(46)`
- `52 所有者权益合计 = Σ(48,49,50,51)`
- `53 总计 = g(47) + g(52)`
- 有自定义子类的父项 = 子类求和（同 A）。

`computeRow` 复用 A 的思路（sum 集 / 差额公式 / 父项子类求和）。

---

## 3. 后端（仅一处改动）

- `ReportService` statement 白名单：`Set.of("is")` → `Set.of("is", "bs")`。
- 其余零改：`report_amount(field='end')`、`report_custom_row`、7 端点、导入（公司名匹配/自动新建/clear+insert）、全部汇总跨公司求和——全部通用，`bs` 自动可用。
- **迁移 V23**：资产负债表骨架种子（公司1 2025-09，取真实①几行期末余额，演示两栏 + 合计重算）。

---

## 4. 前端

- `reports/balanceSheet.ts`：`BS_ROWS`（行次 1–53，side L/R）+ `BS_SUBTOTAL`（§2 规则）+ `computeBsRow`（复用 A computeRow 模式）。
- `views/reports/balance-sheet/BalanceSheetView.vue`：三级动线（L1 `FinCompanyPicker` → L2 `FinMonthGrid` → L3 两栏正文）+ §6 加载门；L3 用 **两个 `FinReportTable`**（side L 资产行 ‖ side R 负债权益行），列 `[{key:'end',label:'期末余额'}]`，包在 `.fin-two`（原型两栏 grid）。编辑 draft→`reportApi.save('bs',...)`；`companyId==='all'` 读 `allPeriod('bs',...)` 只读；退出编辑 `SaveConfirmDialog`；导出 xlsx 懒加载。**v-else 紧邻状态链、overlay 放最后（§6.2）。**
- `BalanceSheetTable.vue`（可选）：包两个 `FinReportTable` + `.fin-two`；或直接在 View 内。
- `utils/importBalanceSheet.ts`：解析真实资产负债表 sheet——表头行 `资产|行次|①期末余额|…|⑥|期末余额合计|负债和所有者权益|行次|①期末余额|…|合计`（2 行表头,公司名 + 期末余额子表头）→ 左块(资产名/行次/公司列)按行次匹配 side-L 行、右块(负债名/行次/公司列)匹配 side-R 行 → 每公司一段（资产+负债权益全 normal 行 rowKey→期末余额）；忽略「期末余额合计」列、跳合计/label/其中/空行。
- registry 加 `report_bs`（`context:'ledger'` 需 year/month；`label:'资产负债表'`,`tag:'报表'`,`icon:'scale'`,`customParse:importBalanceSheet`；`run`:逐公司段公司名匹配/自动建 → `reportApi.import('bs',year,month,{sections})`）。import_log `data_type='report_bs'`（`ImportLogService.KNOWN_TYPES` 加 `report_bs`）。
- 路由 `balance-sheet` → `BalanceSheetView`（换占位屏）。

---

## 5. 测试

- **后端**（编排者亲跑全量 `./mvnw test`）：`ReportApiIT` 补 `bs` 用例（save/read `field='end'`、allPeriod 跨公司、import 自动建公司 for bs、`statement='bs'` 合法不再 400）；或复用现有通用性 + 加 1-2 条 bs 冒烟。
- **前端**（vitest）：`balanceSheet` 小计（15/29/30/41/46/47/52/53 sum + 20 差额）；`importBalanceSheet` 解析（两栏拆分、按行次匹配 side-L/R、合计列忽略、其中跳过）。
- **真跑**（真后端 + preview）：三级动线、两栏渲染、编辑重算合计、全部汇总只读、**真实 .xls 资产负债表 sheet 导入 6 公司自动建 + 落值 + import_log**、0 console error。

---

## 6. 完成定义（DoD）

- [ ] V23 种子迁移干净 apply；`ReportService` 白名单加 `bs`；`ImportLogService` 加 `report_bs`；后端全量 `./mvnw test` 绿。
- [ ] `balanceSheet.ts`（行次 1–53 + 合计规则 + computeBsRow）；`BalanceSheetView` 两栏三级动线 + 编辑 + 全部汇总只读。
- [ ] `importBalanceSheet` 解析器 + registry `report_bs` + 路由换真屏。
- [ ] 前端 build + vitest 绿；真后端 + 真实 .xls preview 肉眼验全过（两栏 + 合计重算 + 导入 6 公司 + import_log）。

---

## 7. 显式延后（backlog）

- C 科目余额表（科目层级 + 期初/发生/累计/期末 借贷，statement `tb`，TB_ACCOUNTS 模板；余额表每公司一 sheet）。
- D 损益附表 1–5、E 勾稽/收入核对、F 报表中心 hub。
- `其中：航泽借款` 等文件散注 → 自定义子类（现不建常驻行）。
- 报表导入接入「导入中心」卡片。
