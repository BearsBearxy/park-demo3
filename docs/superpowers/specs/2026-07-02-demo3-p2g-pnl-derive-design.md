# demo3 · P2-G 设计 — 损益附表派生链接（数据层 → 附表1–5 行级派生/对照/填入）

- **状态**：已获用户确认（映射表 + 交互 + 全量扫描方法均确认）
- **日期**：2026-07-02
- **作者**：Claude（brainstorming + 全量数据扫描）
- **事实源**：真实数据层测试文件 7 份（附表10/光伏/汽车桩/电动车桩/电费/办公水电/工资测试.xlsx）× 母册 `2025年收入、费用统计（2025.12.31）(1).xlsx` 附表1–5 全 224 行——**8,522 候选序列全量值匹配**（≥2 月精确相等 ±0.011 即候选，差异月如实计数），发现 **36 个实证派生点**。锚点（用户给出）已证：附表10 期2 厂房租金 2025-01 Σ=2,841,683.37 = 租金损益「二期租金收入」1月。

---

## 0. 定性（用户口径）

- 附表 1–5 的行若能在**数据层**（P1 各录入子系统的用户真实数据）找到对应聚合 → **派生链接过来**，不必全手录。
- 母册 25 年账目是**已勾稽验证的基准**：行已有值时，派生值 ⇄ 录入值对照——**匹配 → 已证√**；不符 → 差异（如实显示，如 s10 六月双倍那种真实数据形态差异）；**找不到派生来源的行照旧手录/导入**（188 行：租金支出/折旧/税/费用科目等）。
- 「一期、宿舍」合并口径：**客户端自动求和**（映射 scope `p1+p4`），不拆行。
- 配套修复（已提交 `1a697c1`）：三大报表空月开放点击（手录+导入新月入口）。

## 1. 决策（Decision Log）

| # | 决策 |
|---|---|
| G1 | 派生映射 = **实证 36 条**（下表），来自全量扫描而非手挑；`DERIVE_MAP` 按 (schedule, 行标签 normalize) 匹配 |
| G2 | 对照三态（行级徽标 + 差异月单元格橙底）：**已证√**（重叠月全等±0.005，蓝）/ **差异 N 月**（hover 显派生值与差额）/ 无映射不显 |
| G3 | **填入**：行级「从数据层填入」+ 工具栏「全部填入派生值」——**只填空单元格，不覆盖已录**；填入进 draft，保存走现有存储（存储模型零改动） |
| G4 | 后端仅加 1 个只读端点 `GET /api/s10/year-summary?year=`（s10 是唯一缺年聚合的源；pv/charging/elec/office 已有年读，salary 用 records(y,m)×12 并行） |
| G5 | **扫描脚本转正**为仓库工具 `frontend/src/tools/deriveSweep.spec.ts`（真实文件不存在时 skip）——用户导入更多真实月份后重跑即可发现新派生点、扩 MAP |
| G6 | 派生数据按年懒加载缓存（进入某年明细时并行拉一次）；任一源失败该源相关行不显派生（不阻塞） |

## 2. 派生映射表（DERIVE_MAP，36 条实证）

序列键语法：`s10|<scope p1/p2/p3/p4/p1+p4/all>|<colId(+colId…=Σ)>`；`pv|<p1/p2/p3/all>|<selfAmt/gridAmt/self+grid>`；`chg7/chg8|<fee/cost/profit>`；`elec|<phase>|<energy/basic>|amt`；`office|<elecAmt/waterAmt/elec+water>`；`sal|<字段>`。

| # | schedule | 行标签（normalize 匹配） | 序列键 | 扫描证据 |
|---|---|---|---|---|
| 1 | s1 | 一期企业服务费收入 | s10\|p1\|officeMgmtFee+factoryMgmtFee | 证3月 |
| 2 | s1 | 一期商铺租金收入 | s10\|p1\|shopRent | 证3月 |
| 3 | s1 | 一期商铺企业服务费收入 | s10\|p1\|shopMgmtFee | 证3月 |
| 4 | s1 | 二期租金收入 | s10\|p2\|factoryRent | 证2月/差2（锚点） |
| 5 | s1 | 二期企业服务收入 | s10\|p2\|factoryMgmtFee | 证2月/差2 |
| 6 | s1 | 二期商铺收入 | s10\|p2\|shopRent | 证2月/差2 |
| 7 | s1 | 二期商铺企业服务收入 | s10\|p2\|shopMgmtFee | 证2月/差2 |
| 8 | s2 | 一期基本用电收入 | s10\|p1\|elecBasic | 证3月 |
| 9 | s2 | 二期基本用电收入 | s10\|p2\|elecBasic | 证2月/差2 |
| 10 | s2 | 一、三期基本用电成本 | elec\|p1\|basic\|amt | 证12月 |
| 11 | s2 | 二期基本用电成本 | elec\|p2\|basic\|amt | 证12月 |
| 12–14 | s2 | 一期光伏发电消纳 / 上网收益 / 小计（两处组均命中消纳） | pv\|p1\|selfAmt / gridAmt / self+grid | 证12月 |
| 15–17 | s2 | 二期光伏发电消纳 / 上网收益 / 小计 | pv\|p2\|selfAmt / gridAmt / self+grid | 证7月 |
| 18 | s2 | 减：办公室电费 | office\|elecAmt | 证12月 |
| 19 | s3 | 一期基准水费收入 | s10\|p1\|waterStd | 证3月 |
| 20 | s3 | 二期基准水费收入 | s10\|p2\|waterStd | 证2月/差2 |
| 21 | s3 | 散租宿舍收入 | s10\|p4\|waterStd | 证4月 |
| 22 | s3 | 一期用水维护费 | s10\|p1\|waterMaint | 证3月 |
| 23 | s3 | 二期用水维护费 | s10\|p2\|waterMaint | 证2月/差2 |
| 24 | s4 | 基础设施维护费·其中：一期 | s10\|p1\|infraOffice+infraFactory | 证3月 |
| 25 | s4 | 基础设施维护费·二期 | s10\|p2\|infraFactory | 证2月/差2 |
| 26 | s4 | 电动车冲电桩收入 | chg8\|fee | 证12月 |
| 27 | s4 | 电动车充电桩电费成本 | chg8\|cost | 证12月 |
| 28 | s4 | 电动车充电桩损益 | chg8\|profit | 证7月/差5 |
| 29 | s4 | 汽车充电桩电费成本 | chg7\|cost | 证2月/差1 |
| 30 | s4 | 开票税费及其他税费收入 | s10\|p1\|landUseTax | 证3月 |
| 31 | s5 | 办公室电费 | office\|elecAmt | 证12月 |
| 32 | s5 | 办公室水电费合计 | office\|elecAmt（差1月；elec+water 备选） | 证11月/差1 |
| 33 | s5 | 餐补费 | sal\|lunch | 证2月 |
| 34–36 | s2 | 基准电费组「一期光伏发电消纳/二期光伏发电消纳/减：办公室电费」（与 12–18 同键复用，分组不同行独立命中） | 同上 | 证12/7/12月 |

- **匹配规则**：normalizeHeader(行标签) 相等；同一 schedule 内同标签不同分组各自命中（如 s2 光伏消纳出现在两组）。
- 行标签未命中 → 无派生（手录），**不猜**；后续用 G5 工具扩表。

## 3. 数据管道

- **后端新端点**：`GET /api/s10/year-summary?year=` → `S10YearSummaryDTO{ year, phases: Map<Integer/*phase*/, Map<String/*colId*/, BigDecimal[12]/*月Σ,无值 null*/>> }`（读该年全部 s10_record，Java 聚合；只含非零列；零 XML）。
- **前端 `reports/pnlDerive.ts`**：
  - `loadDeriveData(year)`（并行、`allSettled`）：s10 year-summary ×1、`pvApi.records(year)`、`chargingApi.records(7/8, year)`、`elecApi.records(year,'energy'/'basic')`、`utilitiesApi.records(13, year)`（办公）、`salaryApi.records(year, m)×12` → 统一成 `Record<seriesKey, (number|null)[12]>`（组合键如 `officeMgmtFee+factoryMgmtFee`、`p1+p4` scope、office 金额=qty×price、chg profit=fee−cost、elec amt=qty(或demand)×price 按 phase/type 聚合）。
  - `deriveRow(schedule, label, data): (number|null)[12] | null`；`compareRow(rowM, derived): { state:'ok'|'diff'|'none', diffMonths:number[], derived }`（容差 0.005，仅比两侧都非空的月）。
- **PnlTable/PnlScheduleView**：命中行行首徽标（已证√蓝 / 差异N月橙，hover tooltip 逐差异月「录入 x ⇄ 派生 y」）；差异月单元格橙底；编辑态行尾「填入」按钮（空格←派生值进 draft）+ 工具栏「全部填入派生值」；读态只显对照不显填入。

## 4. 测试

- 后端 `S10ApiIT` 补 year-summary 用例（种子年聚合正确、无数据年空 map、401）。
- 前端 `pnlDerive.spec`：MAP 命中（normalize/分组无关）、组合键 Σ、p1+p4、compareRow 三态、填入只填空格；`deriveSweep.spec`（工具转正，文件缺失 skip，存在时断言 36 点仍命中——回归护栏）。
- 真跑：curl year-summary 冒烟；preview /rent-pnl（种子 s10 2025 与 pnl 种子行对照徽标渲染、填入动作、0 error）+ **顺带验 ① 空月修复**（/income-statement 空月点击进空 L3 可编辑）。

## 5. DoD

- [ ] year-summary 端点 + IT；全量 `./mvnw test` 绿。
- [ ] pnlDerive.ts(36 条 MAP+管道+对照+填入) + deriveSweep 工具转正 + PnlTable/View 对照与填入；build+vitest 绿。
- [ ] 真实文件回归（deriveSweep 断言 36 点）+ preview 肉眼验（对照徽标/填入/空月修复）+ 0 console error。

## 6. 显式延后

- 一期租金收入等未匹配行的组合发现（需更多真实月份数据，用 G5 工具迭代）；派生值自动刷新提醒（数据层变更后提示附表过期）；s5 更多费用科目映射；4–5 列组合扫描。
