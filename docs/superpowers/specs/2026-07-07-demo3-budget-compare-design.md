# 预算对比(P3-P1 增量)规范(2026-07-07)

## 目标

把年度预算数据引入系统,新增「预算对比」分析屏 + 驾驶舱预算达成卡,激活 2022→2026 五年年度同比。数据源=用户预算工作簿的「全面预算总表」sheet(年度粒度;收入预算等明细 sheet 本期不导)。

## 数据源(已实测结构)

目录 C:/financial_dashboard/2025全年发生额、预算对比/:
- `2025年年度预算（初稿）.xlsx` → sheet「2024年全面预算」(标题实为「2025年财务预算总表」,~30行):列 = 项目 | 2022年发生额 | 2023年发生额 | 2024年发生额 | 2025年预算 | 备注
- `2026年年度预算（2026.02.07）.xlsx` → sheet「2026年全面预算」(「2026年财务预算总表」):… 2025年发生额 | 2026年预算 | 备注。**其 2025 发生额 87,722,075.46 与系统 pnl 推算 87,722,075.54 仅差 0.08 元,交叉验证通过。**
- 行形态:「收入总计」「    其中：租金收入」(前导空格=子行)等科目层级;金额千分位字符串。

## 数据模型(后端)

Flyway V30 `budget_row`:id PK, year SMALLINT, label VARCHAR(64)(trim 后), sub TINYINT(1)(「其中：」子行), amount_budget DECIMAL(18,2) NULL, amount_actual DECIMAL(18,2) NULL, note VARCHAR(255), sort_order INT, **UNIQUE uk_budget(year, sort_order)**——复审 high:真实总表每年两个「其中：其他」子行(收入侧/成本侧)撞 label,uk(year,label) 会让真实文件整包 1062 回滚;行序在整年替换语义下天然唯一。前端解析同步做同年重名消歧(重名子行 label 追加「（父级主行）」标注,明细表可分辨)。
- 语义:一行=某年某科目;预算与发生额可只有其一(2026 只有预算,2022~2024 只有发生额)。**2025 发生额不落库为准**(以 pnl 实时推算为单一事实源;文件值仅导入时校验提示)。

API(只读+导入,BudgetController):
- `POST /api/budget/import` body {rows:[{year,label,sub,budget?,actual?,note?,sortOrder}]} → 按 payload 内出现的 year **整年替换**(delete+insert,同 pnl 惯例);返回 ImportResultDTO。
- `GET /api/budget/all` → BudgetRowDTO[](表小,一次拉全)。
- IT:导入回读/整年替换/双年 payload。

## 导入(前端 registry 新类型 'budget')

- 导入中心新磁贴「年度预算」(tag 预算,context 'none');parseWorkbook + sheetMatch /全面预算|财务预算总表/。
- 列识别:表头行内匹配 /^(\d{4})年(发生额|预算)$/ 的列 → (year,type);「项目」列=label(trim,记录前导空格为 sub);「备注」列→note(挂预算年行)。逐数据行产 rows:每个年列一条 {year,label,budget|actual}(空值跳过);sortOrder=行序。
- 确认屏按年分段展示(label=「YYYY 预算 N 条 / 发生额 N 条」);同文件多年一次导入。
- 2025 发生额列**跳过不导**(单一事实源规则),解析时若与 pnl 推算差异>1 元在确认屏提示(拉不到 pnl 则跳过校验)。

## 分析屏「预算对比」(value='budget')

- fpNav 专题分析节新增 { value:'budget', label:'预算对比', icon:'target' };路由 → views/analysis/BudgetView.vue(AnaShell 包裹;期间控件仅年粒度有意义,月粒度时提示年度口径)。
- 卡片:
  1. **五年带**:收入/成本/利润 三组 2022→2026 年度柱(实际)+ 预算标记线(AnaStackedCols group 模式或 GroupBars + 预算刻度),2025 实际=pnl 实时,2026 只有预算(前瞻样式)。
  2. **当年达成率 bullets**(AnaBullet):收入/成本/利润,实际(pnl 2025 累计)vs 预算;成本类超预算=红(invert)。
  3. **总表明细**:项目|预算|实际|达成率|差异,子行缩进;关键行匹配规则(复审修订:费用侧必须组级细分,整体 s5 口径会把管理费用达成率算成假超支 103.3%,同口径实为 91.2%):「收入总计」→pnl revenue、「成本」总计→cost、「管理费」→s5 管理费用总计行、「销售费/中介费」→s5 销售费用合计行、「财务费」→s5 财务费用合计行、「修缮/工程费」→s5 修缮改造行、其余「费用总计」→s5 大合计、「利润/损益」→profit;匹配不到只显示文件值。
  5. **缓存失效**:runImport 任何类型导入成功(imported>0)后调 invalidateAnaCache() 清分析层全部缓存——空态→导入→回屏即见新数据(复审 medium)。
  4. **2026 前瞻卡**:2026 预算 vs 2025 实际增减。
- anaData 追加 fetchBudgetAll()(缓存;契约注释同步);无预算数据 → 全屏空态卡引导去导入中心。
- 驾驶舱:新增「预算达成」卡(当年收入达成率 bullet + 距预算缺口),无预算数据时空态引导(深链 /import)。

## 测试与验收

- 后端 IT 3 例;前端:导入解析器单测(用实测表头/行样例,含 2025发生额跳过、多年拆分、sub 识别)、BudgetView 关键行匹配纯函数单测、全量门禁。
- 验收锚点(SQL/文件):2025 预算收入总计 92,705,202.87;2026 预算收入 103,620,434.53;2024 发生额收入 82,867,520.26;达成率卡 2025 收入 = 87,722,075.54/92,705,202.87 ≈ 94.6%。
