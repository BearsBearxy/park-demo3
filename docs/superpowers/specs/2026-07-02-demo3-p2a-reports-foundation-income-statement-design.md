# demo3 · P2-A 设计 — 报表基础设施 + 利润表（手录 + 导入）

- **状态**：待用户复审
- **日期**：2026-07-02
- **作者**：Claude（brainstorming）
- **项目**：厂房园区管理系统 demo3 · P2 账簿与报表 第一刀
- **事实源**：真实文件 `2025全年发生额、预算对比/2025年10月文件/2025年10月文件（拼）.xls`（8 sheet：利润表 / 资产负债表 / ①②余额表 / 余额表×4）；原型 `app/fin-common.jsx`、`app/screen-income-statement.jsx`、`app/fin-data.js`。

---

## 0. 背景 — P2 分解与本刀定位

P2「账簿与报表」过大，拆为 6 子项目（依赖序）：**A 报表基础设施 + 利润表**（本 spec，打样底座）→ B 资产负债表 → C 科目余额表 → D 损益附表 1–5 → E 勾稽/收入核对 → F 报表中心 hub。三大报表共用 L1 公司选择 + L2 月历 + 报表表基座 + 弹窗（fin 外壳），A 建立外壳与后端范式，B/C/D 复用。

**领域定性（据原型 + 真实文件）**：三大报表是**手工录入的可编辑表**（非从台账自动推导的会计引擎）——固定常驻行模板 + 用户自定义子类（父项自动汇总）+ 小计行按行次引用公式算 + 全部汇总跨公司只读求和。"勾稽"（E）之所以有意义，正因报表与台账/附表**分别维护**、需交叉核对差异。

---

## 1. 锁定决策（Decision Log）

| # | 决策 | 取舍 |
|---|---|---|
| R1 | 第一刀 = **报表基础设施 + 利润表**（纵切打样，B/C/D 复用外壳+后端范式） | 用户明确 |
| R2 | 叶子金额**手工录入**（存库、可编辑），**同时支持 Excel 导入**（同 P1） | 用户明确；原型忠实 |
| R3 | **列口径文件忠实**：利润表 = 每公司 **本月金额 + 本年累计金额**（2 列）；资产负债表(B)=期末余额(1 列)；科目余额表(C)=期初/本期发生/本年累计/期末(借贷) | 用户明确 |
| R4 | 利润表**按公司拆表**（文件是 6 公司横向合并 → demo3 一公司一表）；「全部汇总」= 跨公司只读求和 | 用户明确 |
| R5 | 公司**复用 P1 `management_company`**（P0 spec 定的共享实体）；导入时按表头公司名匹配，**未匹配自动新建公司** | 用户明确（自动建） |
| R6 | 报表**行模板 + 公式放前端 config**（像 s10 `layout.ts`）；后端**通用存金额 + 自定义行**（statement 参数化），B/C 复用同一后端 | 减重、B/C 零后端重复 |
| R7 | 小计行**客户端按行次公式算，不落库**（同台账派生不落列） | 一致 |
| R8 | 本月(cur) + 本年累计(ytd) **均手工录入**（文件两列都是数据源）；ytd 自动=Σ本月 列为 backlog | 文件忠实 |
| R9 | 自定义子类**按 (公司, statement) 独立**（各公司报表结构互不影响） | 贴"独立报表" |
| R10 | 弹窗（公司增删/确认/加子类）用**居中弹窗**（遵 DESIGN-FIDELITY §7），不自建右滑 | 遵新规范 |

---

## 2. 利润表行模板（`reports/incomeStatement.ts`，1:1 文件行次 1–32）

`IS_ROWS`（`{no, label, level, type}`，type ∈ normal|label|subtotal）：

| 行次 | 标签 | level | type |
|---|---|---|---|
| 1 | 一、营业收入 | 0 | normal |
| 2 | 减：营业成本 | 0 | normal |
| 3 | 营业税金及附加 | 0 | normal |
| 4 | 其中： | 1 | label |
| 5 | 营业税 | 1 | normal |
| 6 | 城市维护建设税 | 1 | normal |
| 7 | 资源税 | 1 | normal |
| 8 | 土地增值税 | 1 | normal |
| 9 | 城镇土地使用税、房产税、车船税、印花税 | 1 | normal |
| 10 | 教育费附加、矿产资源补偿费、排污费 | 1 | normal |
| 11 | 销售费用 | 0 | normal |
| 12 | 其中：中介费 | 1 | normal |
| 13 | 广告费和业务宣传费 | 1 | normal |
| 14 | 管理费用 | 0 | normal |
| 15 | 其中：开办费 | 1 | normal |
| 16 | 业务招待费 | 1 | normal |
| 17 | 研究费用 | 1 | normal |
| 18 | 财务费用 | 0 | normal |
| 19 | 其中：利息费用（收入以"-"号填列） | 1 | normal |
| 20 | 加：投资收益（损失以"-"号填列） | 0 | normal |
| **21** | **二、营业利润（亏损以"-"号填列）** | 0 | **subtotal** |
| 22 | 加：营业外收入 | 0 | normal |
| 23 | 其中：政府补助 | 1 | normal |
| 24 | 减：营业外支出 | 0 | normal |
| 25 | 其中：坏账损失 | 1 | normal |
| 26 | 无法收回的长期债券投资损失 | 1 | normal |
| 27 | 无法收回的长期股权投资损失 | 1 | normal |
| 28 | 自然灾害等不可抗力因素造成的损失 | 1 | normal |
| 29 | 税收滞纳金 | 1 | normal |
| **30** | **三、利润总额（亏损总额以"-"号填列）** | 0 | **subtotal** |
| 31 | 减：所得税费用 | 0 | normal |
| **32** | **四、净利润（净亏损以"-"号填列）** | 0 | **subtotal** |

`IS_FORMULA`（行次引用，g=取该行值）：
- `21 = g(1) - g(2) - g(3) - g(11) - g(14) - g(18) + g(20)`
- `30 = g(21) + g(22) - g(24)`
- `32 = g(30) - g(31)`

> **注**：行 5–10 是行 3「营业税金及附加」的「其中」明细，12–13 是行 11，15–17 是行 14，19 是行 18，23 是行 22，25–29 是行 24 —— 均为**信息性明细行，不自动汇总进父项**（父项 3/11/14/18/22/24 直接录入；公式只用顶层行次）。这与文件一致。自定义子类（R9）则**会**汇总进其父项。

---

## 3. 后端数据模型（通用，statement 参数化）

**迁移 V21**（纯新增，无改现有表）：

```sql
CREATE TABLE report_amount (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  company_id  INT          NOT NULL,               -- FK management_company.id
  statement   VARCHAR(8)   NOT NULL,               -- 'is'(利润表) | 'bs' | 'tb'
  year        INT          NOT NULL,
  month       INT          NOT NULL,
  row_key     VARCHAR(32)  NOT NULL,               -- 行次(常驻)或自定义行 id
  field       VARCHAR(8)   NOT NULL,               -- 'cur'(本月) | 'ytd'(本年累计)
  amount      DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL,
  updated_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_amt (company_id, statement, year, month, row_key, field),
  KEY idx_period (company_id, statement, year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE report_custom_row (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  company_id  INT          NOT NULL,
  statement   VARCHAR(8)   NOT NULL,
  row_key     VARCHAR(40)  NOT NULL,               -- 自定义行稳定 id(如 'isc-<n>')
  parent_key  VARCHAR(32)  NOT NULL,               -- 父行次或父自定义行 id
  label       VARCHAR(128) NOT NULL,
  level       INT          NOT NULL DEFAULT 1,
  created_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_row (company_id, statement, row_key),
  KEY idx_cr (company_id, statement)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

实体 `ReportAmount` / `ReportCustomRow`（`@TableField(fill)` 审计字段复用 `MetaObjectHandler`）；Mapper 裸 `BaseMapper` + `default` 组合 `QueryWrapper`（零 XML）。`company_id` 走 V16 式外键到 `management_company`。

---

## 4. 后端端点（`ReportController`，`/api/reports/{statement}`，统一 `Result<T>`）

statement 白名单本刀仅 `is`（B/C 增 `bs`/`tb`）。

| 动词 | 路径 | 返回（裸类型） | 说明 |
|---|---|---|---|
| GET | `/{statement}/{companyId}/{year}` | `ReportYearDTO`（各月 hasData + 净利润预览） | L2 月历 |
| GET | `/{statement}/{companyId}/{year}/{month}` | `ReportPeriodDTO{ amounts: {rowKey: {cur,ytd}}, customRows: [...] }` | L3 单公司读 |
| GET | `/{statement}/all/{year}/{month}` | `ReportPeriodDTO`（跨公司 amounts 求和，customRows 并集，只读） | 全部汇总 |
| PUT | `/{statement}/{companyId}/{year}/{month}` | `ReportPeriodDTO` | 保存本期金额（upsert，覆盖该期该公司该 statement 全部 field） |
| POST | `/{statement}/{companyId}/custom-row` | `ReportCustomRowDTO` | 加自定义子类 |
| DELETE | `/{statement}/custom-row/{id}` | `void` | 删自定义子类（级联删其子 + 其金额） |
| POST | `/{statement}/{companyId}/import` | `ImportResultDTO` | 导入本期（见 §6） |

- 非法 statement → `BizException(BAD_REQUEST)`；公司/期不存在 → `BizException(NOT_FOUND)`。
- **小计不落库**：`amounts` 只含 normal 叶子行（含自定义行）；前端算小计。全部汇总的 amounts = 各公司同 rowKey 同 field 求和。

---

## 5. 前端 — 利润表屏 + fin 外壳

**共享外壳 `components/fin/`（B/C/D 复用，1:1 移植 fin-common.jsx）**：
- `FinCompanyPicker.vue` — L1：全部汇总卡 + 各公司卡（增删改）+ 新增公司卡；公司来自 `companyApi.list()`。
- `FinMonthGrid.vue` — L2：年切换 + 12 月卡（hasData 来自 `GET /{year}`；当前月高亮，用 §6 加载门确定性判定不耦合时钟）。
- `FinReportTable.vue` — 报表表基座（固定行 + 自定义子类递归 + 可配置金额列）；利润表传 2 列（cur/ytd）。
- 弹窗 `FinCompanyDialog` / `FinConfirm` / `FinAddRowDialog` — **居中弹窗**（遵 §7）。

**利润表屏 `views/reports/income-statement/`**：
- `IncomeStatementView.vue` — L1/L2/L3 状态机 + §6 加载门；行模板 `reports/incomeStatement.ts`。
- `IncomeStatementTable.vue` — 用 `FinReportTable`，两列 本月/本年累计。
- **计算（客户端）**：叶子行=录入值；有自定义子类的父项=子类求和；小计行=`IS_FORMULA`；全部汇总=跨公司求和（`companyId='all'` 只读，不可编辑、不可导入）。
- 编辑：draft → 保存（PUT upsert）；退出编辑 `SaveConfirmDialog`（已有）。KPI 4 枚（营业收入/营业利润/利润总额/净利润 本月）。
- 导出 xlsx 懒加载（同既有屏）。

---

## 6. 导入（复用 P1 引擎 + importRegistry）

文件利润表 sheet = **6 公司横向合并**：表头行 `项目 | 行次 | ①[本月,本年累计] | ②[本月,本年累计] | ③物业(火炬园)[..] | ④水电[..] | ⑤物业(宿舍+二期56)[..] | ⑥物业(一期B-G)[..] | 合计[本月,本年累计]`（公司名行 + 本月/本年累计 子表头行，2 行表头）。

**解析器 `utils/importIncomeStatement.ts`**：
1. 定位公司名表头行（含"本月金额/本年累计金额"子表头的上一行）→ 得各公司名 + 其 (本月列, 本年累计列) 下标；忽略「合计」列。
2. 逐数据行按**行次**（第 2 列）匹配 `IS_ROWS` 常驻行；非行次行/小计行/空行跳过。
3. 每公司产一组 `{ companyName, rows: [{rowKey, cur, ytd}] }`（只收 normal 行，小计不导）。
4. **公司匹配**：`companyName` → `management_company` 按名匹配；**未匹配自动新建**（R5，`companyApi.create`）。
5. 走 `FpImportModal`（`customParse` → 多公司段，复用 `ImportSummary` 每公司一段可勾选）→ `runImport('report_is', picks, ctx, fileName)` → 落 `import_log`（新 registry 类型 `report_is`）。
6. 后端 `POST /is/{companyId}/import`：**clear+insert** 本期该公司该 statement 的 amounts（重导干净，手动行不动——本刀无手动/导入 source 之分，直接覆盖本期）。`@Transactional`。

> 期间（year/month）：文件单表是某一期（如 2025-10，见"期间：2025年10月"），从标题/单元格解析或让用户在导入前选目标年月（ledger 式上下文）。**默认**：导入前在利润表当前所选年月导入（hub 外从屏内导入已有年月上下文；导入中心入口则先选年月，同 ledger）。

registry 新增 `report_is` 类型（context: 需公司→由解析产出、需年月→当前槽），import_log `data_type='report_is'` / `type_label='利润表'`。

---

## 7. 种子 + 测试

- **种子 V22**：给 P1 现有公司 × 2025 年若干月建**利润表骨架**（行模板 + 少量代表值，够演示编辑/汇总/小计公式）；**完整真实数据由用户导入真实 .xls 获得**（不把整份文件转成 seed 迁移）。
- **后端**（Testcontainers 真库，编排者亲跑全量 `./mvnw test`）：`ReportApiIT`——保存/读回、全部汇总跨公司求和、自定义行增删级联、非法 statement 400、无 token 401、导入 clear+insert + 公司自动新建。
- **前端**（vitest）：`incomeStatement` 公式（21/30/32）+ 父项汇总 + 全部汇总只读；`importIncomeStatement` 解析（多公司列拆分、按行次匹配、小计跳过、合计列忽略）。
- **真跑**（真后端 + preview）：三级动线、编辑即时重算、全部汇总只读、**用真实 `2025年10月文件（拼）.xls` 导入利润表 sheet** → 6 公司自动建 + 各公司本期落值 + import_log 出记录，0 console error（含中文走浏览器不用 curl）。

---

## 8. 完成定义（DoD）

- [ ] V21（report_amount + report_custom_row）+ V22 种子迁移干净 apply。
- [ ] 后端通用 Report 实体/Mapper/DTO/Service/Controller（7 端点，statement 参数化）+ ReportApiIT 全量 `./mvnw test` 绿。
- [ ] fin 外壳组件（FinCompanyPicker/FinMonthGrid/FinReportTable + 3 弹窗，居中）；`incomeStatement.ts` 模板（行次 1–32 + 3 公式）。
- [ ] IncomeStatementView/Table 三级动线 + 编辑保存 + 全部汇总只读；`import` 解析器 + registry `report_is` + FpImportModal 接入。
- [ ] 前端 build + vitest 绿；真后端 + 真实 .xls preview 肉眼验全过（含导入 6 公司自动建 + import_log）。

---

## 9. 显式延后（backlog）

- B 资产负债表（期末余额，两栏，复用外壳+后端）、C 科目余额表（科目层级 + 期初/发生/累计/期末 借贷）、D 损益附表 1–5、E 勾稽/收入核对、F 报表中心 hub。
- ytd 自动 = Σ本月到当月（现手录）。
- 报表导入接入「导入中心」卡片（现从屏内导入；报表类 tile 待 F 或本刀完成后补）。
- 资产负债表/余额表的 sheet 解析器（各自 §6 式，B/C 期实现）。
