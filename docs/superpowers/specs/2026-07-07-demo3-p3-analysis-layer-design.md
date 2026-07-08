# P3 经营分析层 规范(2026-07-07)

## 目标与原则

把导航预留的 14 个分析屏(经营驾驶舱/园区2/租户2/管理公司3/专题5/监控1)从 PlaceholderView 变成真实可视化,**全部绑定真实库数据,绝不保留原型 mock**。设计稿 1:1 移植为基线(仓库既有惯例),数据不支撑处按本 spec 的降级策略改造。图表纯 SVG 自绘,零新依赖,DS 令牌(墨蓝+蓝族填充+橙/红语义,无紫无绿无渐变——原型 ana-charts 头注释)。

## 设计稿(唯一视觉事实源,位于 C:/financial_dashboard/untitled/project/)

- `analysis/ana-charts.jsx`(410行):图表原语 BoxPlot/Waterfall/Radar/Scatter/DeviationBars/SparkGrid/Bullet/StackedCols/RatioArc/GroupBars + StatBar/Tag/tooltip/legend + 动态标签(峰值/趋势由数据算出)。
- `analysis/ana-kit.jsx`(455行)、`app/fig-line-chart.jsx`(288行):卡片布局套件与折线图。
- `analysis/ana-period.js`(493行):期间上下文(按月/按年/环比步进);`ana-shell.jsx`:工具条(期间/对比/阈值设置弹层,见 app/screen-analysis.jsx 桥接)。
- 12 屏:`analysis/screen-{cockpit,park,park-energy,tenant-energy,tenant-portfolio,fin-pnl,fin-balance,fin-cashflow,churn,expiry,breakeven,anomaly}.jsx`(各64~123行,图表组合式)+ `app/screen-pnl-analysis.jsx`(169行)+ `app/screen-pv-roi.jsx`。
- `ana-data.js/ana-data2.js` = **mock 引擎 ANAP,只作字段语义参考,一律不移植**。

## 真实数据地基(2026-07-07 盘点)

| 数据源 | 覆盖 | 分析可用度 |
|---|---|---|
| pnl_row s1~s5 | 2025 全年 12 个月 | ★★★ 趋势主力 |
| s10_record | 2025-01/02/06/07/10,4期×25金额列,按租户 | ★★★ 租户/期收入主力 |
| pv_record | 2024-09~2025,p1/p2/p3 逐月 | ★★★ |
| elec_record 72 / charging 30 / office_record 24 | 2025 逐月 | ★★★ 能耗 |
| monthly_ledger | 6公司 × 2025-01/10,按租户 21费+结余+收款 | ★★ 收缴率两期 |
| report_amount is/bs/tb | 仅 2025-10 快照 | ★★ 单期结构 |
| tenant 352在租/3类目 · contract 282(月租/面积有值) · building 8 | 快照 | ★★ |
| **contract.start/end/sign_date** | **全部 NULL** | ✗ 到期/续约不可用 |
| **unit.area** | **全部 0** | ✗ 面积口径不可用 |
| 现金流量 | 无任何数据源 | ✗ |

**通用降级规则**:①期间范围一律由真实数据动态派生(各源 distinct 月份的并集),不硬编码;②缺数据的图表卡渲染统一「数据待录入」空态卡(说明缺什么、去哪录,深链到对应录入屏),**不画假图**;③稀疏月份(台账仅2期)的趋势图只画有数据的点并标注覆盖度。

## 每屏 × 数据映射 × 降级

| 屏 | 主数据 | 降级/改造 |
|---|---|---|
| cockpit 驾驶舱 | pnl(收入/成本/利润12月趋势)+s10(分期收入)+ledger(收缴率1/10月)+tenant/contract 计数 | 出租率改「在租租户数/合同数」口径(面积无);现金类 KPI 砍掉 |
| park 出租与楼栋 | building×contract(rent_area/monthly_rent 聚合)+tenant 分布 | 出租率=按合同 rent_area 合计展示绝对值,总面积未知→不做百分比;单元层空态引导补录 unit.area |
| park-energy 园区能耗 | elec(购电)+s10(售电/各期)+pv(自发消纳/上网)+office+charging → 能量/金额平衡瀑布、月度趋势 | 数据全,1:1 移植 |
| tenant-energy 用能与缴费 | s10 按租户电/水 5个月 + ledger 应收/收款(2期) | 缴费评分仅2期→标注口径;Top榜/散点按5月数据 |
| tenant-portfolio 结构与续约 | tenant 类目/期区分布 + contract 月租/面积分布(Box/Pareto) | 「续约」半屏(依赖日期)→空态引导补录合同日期 |
| fin-pnl 利润表分析 | pnl s1~s5 12月(结构/趋势/瀑布)+ is 2025-10 快照(科目占比) | is 仅单期→同比/环比卡隐藏 |
| fin-balance 资产负债分析 | bs 2025-10(资产/负债结构、比率 RatioArc) | 单期快照口径,趋势卡空态 |
| fin-cashflow 现金流量分析 | **无现金流数据** | 改造:上=「收款实现」视图(ledger 应收vs收款两期+s10 现收);下=现金流量表空态引导(未来录入) |
| churn 流失预警 | 台账1月在租∩10月缺席 + s10 各月出现/消失 → 活跃度流失清单+评分 | 原型合同口径改「业务活跃度」口径(合同日期无) |
| expiry 到期墙 | contract(月租/面积/状态) | 到期时间轴→空态引导补录日期;保留合同金额分布与清单 |
| breakeven 盈亏平衡 | pnl 固定/变动成本拆分 12月+s10 收入 | 1:1,拆分系数进「目标与阈值」设置 |
| pnl-analysis 损益附表分析 | pnl s1~s5(app/screen-pnl-analysis.jsx 原型) | 数据全,1:1 |
| pv-roi 光伏投资回收 | pv_record 全月份+投资额参数(设置弹层,localStorage) | 1:1 |
| anomaly 异常提醒 | 规则引擎跑真数据:收缴率低于阈值/能耗环比突变/s10 租户消失/负值行 | 规则清单进 spec 附录,可解释(每条给出依据数字) |

## 架构

- `src/components/ana/`:图表原语组件(每图一 .vue,共享 useWidth composable、fmt/tag 工具 ts)。纯 SVG + ResizeObserver 自适应,tooltip 用绝对定位 div(原型 .cz-tip)。
- `src/analysis/anaData.ts`:数据适配层(替代 ANAP)——拉真实 API 聚合出各屏所需形状;可用月份/年份从数据派生。**优先复用既有前端 api/**;确因缺"一次拉全"端点(如 s10 需 月×期 20 次)才允许新增只读 `AnalysisController` 聚合端点(带 IT,不改任何写路径)。
- `src/analysis/usePeriod.ts`:期间上下文(按月/按年、步进、可用范围),移植 ana-period 语义。
- `src/views/analysis/`:14 屏各一 .vue + 共享 `AnaShell.vue` 工具条(期间/阈值设置);router 14 条路由从 PlaceholderView 切到各屏。
- 阈值/目标(出租率目标/收缴率目标/流失线/盈亏系数/光伏投资额)存 localStorage(原型 SettingsPop 语义),不落库。

## 测试与验收

- anaData 聚合器纯函数单测(给定 mock API 返回 → 断言聚合形状与数字);usePeriod 单测;图表组件冒烟(mount 不炸+关键 SVG 元素存在)。
- 每屏人工验收:与原型对照视觉;抽 2 个图表值 SQL 对库。
- 全量 vitest + typecheck 门禁;后端若新增聚合端点须带 IT。
- 空态卡必须出现在:expiry 时间轴、tenant-portfolio 续约、fin-balance 趋势、fin-cashflow 下半屏、park 单元层。
