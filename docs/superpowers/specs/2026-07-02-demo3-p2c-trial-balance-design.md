# demo3 · P2-C 设计 — 科目余额表（手录 + 导入，科目树按期存储）

- **状态**：待用户复审
- **日期**：2026-07-02
- **作者**：Claude（brainstorming）
- **项目**：demo3 · P2 账簿与报表 第三刀（承接 A 利润表 / B 资产负债表）
- **事实源**：真实文件 `2025年10月文件（拼）.xls` 的 6 张余额表 sheet（`①余额表`/`②余额表`/`余额表（帮管好）`/`余额表（一泽）`/`余额表（积前）`/`余额表（创燊高）`，每 sheet 一公司；①835 行）；原型 `app/screen-trial-balance.jsx`、`fin-data.js` TB_ACCOUNTS（仅作 UI 参考，**科目清单不用原型模板**）。

---

## 0. 与 A/B 的本质区别

is/bs 的行是**固定模板**（前端 config）；科目余额表的**科目表是数据**——每公司每期不同（一级科目下挂租户/供应商/银行账户明细，随月增减，①表 835 行）。故：
- **科目树按 (公司, 期) 存库**（新表 `report_account`，V24），不是前端模板；
- 金额复用 `report_amount` 的**泛型 field map**（B 已把 amounts 改为按实际 field 键化，正好铺路）——每科目 8 个金额字段。

**继承 A/B 的决策**（不再重议）：手录 + 导入并存；列口径文件忠实（期初/本期发生/本年累计/期末 × 借/贷 = 8 列）；按公司拆表；全部汇总跨公司只读求和；导入未匹配公司自动新建（每报表按各自列头/表名建名，不强求跨表同名）；合计客端重算不落库；居中弹窗 §7；加载门 §6 + v-else 紧邻链。

---

## 1. C 特有决策（Decision Log）

| # | 决策 | 取舍 |
|---|---|---|
| C1 | 科目树 = **按 (company, statement='tb', year, month) 存储的数据**（V24 `report_account`），非前端模板；导入/保存均整期 clear+insert | 科目随期演化；期间自洽，无孤儿金额 |
| C2 | 金额 8 字段：`openDr/openCr/periodDr/periodCr/ytdDr/ytdCr/endDr/endCr`，存 `report_amount`（row_key=科目 key） | 复用 B 的泛型 field map，零结构改动 |
| C3 | 解析器扛**两种真实版式**：缩进型（①/②：一级有代码、下级无代码靠名称前导空格分层，2 空格/级）与代码型（其余 4 张：全有代码，层级=(代码位数−4)/2） | 文件忠实（实测） |
| C4 | `row_key`：有代码用代码；无代码合成 `r<序号>`（期内唯一即可，整期 clear+insert 故无跨期匹配需求）；`sort_order` 保文件行序 | 简单可靠 |
| C5 | **多 sheet 导入**：`FpImportModal` 扩展 `parseWorkbook`（文件路径解析全部 sheet，tb 用：每张 `余额表*` sheet = 一公司段）+ `sheetMatch`（单 sheet 按名挑选）；**顺手修 is/bs 的文件上传只读 sheet 0 的缺口**（is→/利润表|损益表/，bs→/资产负债表/；粘贴路径不变） | 真缺口，一并修 |
| C6 | 展示：**默认折叠到一级科目 + 搜索框**（点科目展开下级；搜索命中自动展开到命中行） | 用户拍板 |
| C7 | 合计尾行客端算（Σ 一级科目 per 列）；KPI：期末借合计/期末贷合计/**试算平衡差**(借−贷,非 0 显红)/科目数 | 同 B 平衡差模式 |
| C8 | 手录范围：单元格金额编辑（draft→保存）+ 新增/删除科目（挂任意父级，删除级联子树）；保存 = 整期树+金额 clear+insert | R2 手录+导入对等 |
| C9 | 公司段 label：sheet 名 `余额表（X）`→X、`①余额表`→①；fallback 标题行 | 同 B 各报表自建名策略 |

---

## 2. 数据模型（V24 + 复用 report_amount）

```sql
CREATE TABLE report_account (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  company_id  INT UNSIGNED NOT NULL,               -- FK management_company.id（同 V21 口径 INT UNSIGNED）
  statement   VARCHAR(8)   NOT NULL,               -- 'tb'
  year        INT          NOT NULL,
  month       INT          NOT NULL,
  row_key     VARCHAR(40)  NOT NULL,               -- 科目代码 或 合成 r<n>
  parent_key  VARCHAR(40)  NULL,                    -- 父科目 row_key(一级科目为 NULL)
  code        VARCHAR(20)  NULL,                    -- 科目代码(缩进型下级无代码为 NULL)
  label       VARCHAR(160) NOT NULL,               -- 科目名称(去前导空格)
  level       INT          NOT NULL DEFAULT 0,
  sort_order  INT          NOT NULL DEFAULT 0,      -- 文件行序
  created_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_acct (company_id, statement, year, month, row_key),
  KEY idx_acct_period (company_id, statement, year, month),
  CONSTRAINT fk_racct_company FOREIGN KEY (company_id) REFERENCES management_company(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

金额：`report_amount`，`statement='tb'`，`field ∈ {openDr,openCr,periodDr,periodCr,ytdDr,ytdCr,endDr,endCr}`（无迁移，泛型 map 已支持）。
**V25** 种子：公司1 tb 2025-09 小骨架（库存现金/银行存款+一个子账户/应收账款+一个租户子科目，各带 8 字段代表值，够演示折叠/展开/合计/平衡）。

---

## 3. 后端（`tb` 白名单 + 科目树读写，通用 Controller 扩展）

- 白名单 `Set.of("is","bs")` → `Set.of("is","bs","tb")`；`ImportLogService.KNOWN_TYPES` 加 `report_tb`。
- `ReportPeriodDTO` 加可选 `accounts: List<ReportAccountDTO>`（`{rowKey,parentKey,code,label,level,sortOrder}`；is/bs 返回 null/空）。`GET /{stmt}/{co}/{y}/{m}` 对 tb 附带科目树；`GET all` 汇总（**科目并集按 code∪label 合并、金额求和**——不同公司科目不同，合并按 `code 优先、无 code 按 label 路径` 对齐；仅做一级科目层合并展示，明细不合并——见 §5 全部汇总）。
- `ReportSaveReq` 加可选 `accounts`（tb 保存=整期 `report_account`+`report_amount` 双 clear+insert，`@Transactional`）。
- `ReportImportRequest.CompanySection` 加可选 `accounts`（同上双写）。
- `year()` 月历 hasData 对 tb 查 `report_account`（或 amount 任一非空）。

## 4. 前端

- `reports/trialBalance.ts`：8 列定义（期初借/贷…期末借/贷）+ `tbTotals`（Σ 一级科目 per 列）+ 平衡差 + 折叠/搜索的行过滤纯函数（`visibleRows(accounts, expandedSet, query)`：默认 level 0；展开集内的父其子可见；query 命中行及其祖先可见）。
- `views/reports/trial-balance/TrialBalanceView.vue`：三级动线（复用 fin 外壳）；L3 单表：`科目代码|科目名称(缩进+展开箭头)|8 金额列` + 合计尾行 + KPI 4 + 搜索框；编辑态改金额/新增科目（FinAddRowDialog 扩展收 code+名称+父级）/删科目（级联）；`companyId==='all'` 只读；导出懒加载。**FinReportTable 若不适配展开箭头/8 列宽表，本屏自带表格组件 `TbTable.vue`（自带 scoped 样式，遵 fin-table 视觉基底）**——不硬塞共享件（scoped 复用教训）。
- `utils/importTrialBalance.ts`：输入 `sheets: {name, matrix}[]`（仅 /余额表/ 命名的 sheet）→ 每 sheet 一公司段。单 sheet 解析：定位表头（含 `科目名称` 且含 `期初余额`；两行表头「借方/贷方」合并映射 8 列；代码型单行表头 `期初余额(借方)` 直接映射）→ 逐行：code=科目代码列（可空），label=科目名称去前导空格，level=code?(len−4)/2:前导空格/2，parent=最近的 level−1 行，跳 `合计` 行/空行；金额 cleanNum(" - "→0)。
- `FpImportModal` 扩展（**向后兼容**）：`sheetMatch?: RegExp`（文件路径按名挑单 sheet，未命中 fallback sheet 0；is 屏传 /利润表|损益表/、bs 屏传 /资产负债表/——**修 latent bug**）；`parseWorkbook?: (sheets)=>{sections|records|error}`（给了即多 sheet 通路；粘贴路径包装为 `[{name:'', matrix}]`）。
- registry `report_tb`：`{label:'科目余额表', tag:'报表', icon:'table-2', context:'ledger'(年/月), modalProps: parseWorkbook=importTrialBalance, run: 逐段公司匹配/自动建 → reportApi.import('tb',y,m,{sections 含 accounts+cells}) 聚合, target: 年-月 · 科目余额表}`；`ImportLogService` 已加白名单。
- 路由 `trial-balance` → 真屏。

## 5. 全部汇总（tb 的简化口径）

不同公司科目树不同，明细级合并无意义。「全部汇总」只合并**一级科目**：按 `code`（无 code 按 label）对齐求和 8 字段，只读、无树展开（平铺一级）。spec 明示此为口径简化，非缺陷。

## 6. 测试

- 后端（亲跑全量）：ReportApiIT 补 tb 用例——save(树+金额)读回、重存覆盖、import 双写+自动建公司、all 一级合并、非法 statement（改用 `'xx'`）400。
- 前端 vitest：`trialBalance`（totals/平衡差/visibleRows 折叠+搜索+祖先展开）；`importTrialBalance`（两版式各一合成矩阵：表头定位/两行表头合并/code 与缩进层级/合计行跳过/多 sheet 分段）；`FpImportModal` sheetMatch/parseWorkbook 通路。
- 真跑：L1→L2→L3 折叠默认/展开/搜索/编辑保存/合计+平衡差；**真实 .xls 全 6 张余额表 sheet 喂解析器实测**（①835 行缩进型 + 帮管好代码型，段/层级/金额抽查）；上传整本工作簿到 tb 导入走 parseWorkbook；0 console error。

## 7. DoD

- [ ] V24+V25 迁移干净；白名单 tb + report_tb；后端全量 `./mvnw test` 绿。
- [ ] trialBalance.ts + TrialBalanceView(折叠+搜索+编辑+合计/平衡差) + TbTable；路由换真屏。
- [ ] importTrialBalance 两版式 + FpImportModal sheetMatch/parseWorkbook（含 is/bs sheetMatch 修复）+ registry report_tb。
- [ ] 前端 build+vitest 绿；真实 .xls 6 sheet 解析实测 + preview 肉眼验 + 0 error。

## 8. 显式延后

- 明细级跨公司汇总；科目跨期复制（「从上月复制科目表」）；试算不平的定位辅助；D 损益附表 1–5；E 勾稽；F 报表中心；报表 3 类接入导入中心卡片。
