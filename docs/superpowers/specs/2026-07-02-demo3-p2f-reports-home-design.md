# demo3 · P2-F 设计 — 报表中心（reports-home，P2 收官）

- **状态**：待用户复审
- **日期**：2026-07-02
- **作者**：Claude（brainstorming）
- **项目**：demo3 · P2 第六刀（收官）
- **事实源**：原型 `app/screen-reports-home.jsx`（目录/期间两视图：目录=报表卡网格+本期勾稽瓦片条；期间=期间 hero+勾稽检查表+本期报表列表；工具栏=期间 Select+视图 Segmented）。

---

## 0. 定性

报表中心 = **纯前端聚合 hub（零后端改动）**：卡片与勾稽全部走 A–E 已有端点客端聚合；勾稽公式复用前端既有 `computeRow/computeBsRow/tbTotals`（公式归前端原则）。仿 data-home/import-center 的 hub 先例。

## 1. 决策（Decision Log）

| # | 决策 | 取舍 |
|---|---|---|
| F1 | **零后端**：数据源=`reportApi.allPeriod('is'/'bs'/'tb')`+`reportApi.year`、`pnlApi.overview/year`、`reconApi.overview/month`、`s10Api`（营业收入交叉） | 端点全备；公式归前端 |
| F2 | 公司维度**固定全部汇总**（三大报表卡与勾稽用 allPeriod 口径）；按公司钻取去各报表屏 L1 | 用户拍板 |
| F3 | 期间选择 = **年胶囊 + 月下拉**（默认=各源有数据的最大月，确定性派生不读时钟——取 is/bs/tb/recon 各 overview 的 max 数据期） | 原型 period Select 的 demo3 化 |
| F4 | 两视图都做（目录/期间 Segmented，tieout 同源共享） | 原型忠实；期间视图边际成本小 |
| F5 | **勾稽集 4 项（客端算，容差 0.005）**：① 资产负债表平衡（computeBsRow 30 ⇄ 53，全部汇总）② 科目余额表试算平衡（tbTotals endDr ⇄ endCr，全部汇总一级合并口径）③ 营业收入交叉（利润表全部汇总 行1 cur ⇄ 附表10 当月 4 期总额 Σ）④ 收入核对（recon 该月 diff+miss=0 即平，值=差异+缺记户数） | 可算且有真值的最小诚实集 |
| F6 | 报表卡 9 张：三大报表 3（净利润本月/资产总计/期末借合计+科目数）+ 损益附表 5（该年已录行数+最近数据年）+ 收入核对 1（该月差异/缺记户数）；无数据显「待生成」灰 | 原型卡结构 |
| F7 | 打印/导出按钮**禁用占位**（import-center 下载模板先例） | YAGNI |
| F8 | 卡片点击直达各屏（简单 push，同 E7） | 深链 backlog |

## 2. 前端结构

- `reports/reportsHome.ts` 纯函数/聚合：`TIE_CHECKS` 定义（label/来源A/来源B/算法引用）+ `tieStatus(value, ok)`；`loadHomeData(year, month)` composable 风格聚合器（并行拉 allPeriod×3 + pnl overview×5 + recon overview + s10 月度 4 期 → 产出 cards[] + tieout[]；任一源失败该卡显「待生成」不阻塞整页）。
- `views/reports/home/ReportsHomeView.vue`：1:1 原型——页头（标题/副标题/打印+导出禁用占位）；工具栏（年胶囊+月下拉 ‖ 目录/期间 Segmented）；**目录视图**=三大报表区 `.rh-grid`（ReportCard：icon/name/desc/metric+value/数据截止/已勾稽·待生成 tie 徽标）+ 损益附表区 + 收入核对卡 + 本期勾稽 `.rh-tie-strip` 瓦片（label/value/来源A↔B/已平·待查）；**期间视图**=期间 hero（N/4 项已平 Badge）+ 勾稽检查表 `.rh-tie-table`（勾稽项|来源A|=|来源B|金额|结果）+ 本期报表列表（行=名+值+已平/待生成+chevron，点击直达）。样式 1:1 `RhStyles`。§6 加载门 + v-else 紧邻链；切期间不清 data。
- 路由 `reports-home` → 真屏。
- 卡片 tie 徽标口径：is 卡 tie=勾稽③、bs 卡=勾稽①、tb 卡=勾稽②、recon 卡=勾稽④、pnl 卡无勾稽显「—」。

## 3. 测试

- vitest：`reportsHome` 纯函数（tieout 4 项判定各 ok/待查场景、值格式、任一源缺数据→待生成不抛）。
- 真跑：种子下 目录视图 9 卡（is/bs/tb 2025-09 有种子→有值；pnl s1 2025→行数；recon 2026 月），勾稽条 4 瓦（bs 平衡差非 0→待查、tb 已平、recon 差异 13→待查——种子真值），期间视图表格同源一致；切年月不闪；0 console error。后端零改仍跑一次全量 `./mvnw test` 确认无意外（快速安全网）。

## 4. DoD

- [ ] reportsHome.ts 聚合/勾稽纯函数 + spec；ReportsHomeView 两视图 1:1 + 路由换真屏。
- [ ] build + vitest 绿；真跑 preview 目录/期间/勾稽真值/直达跳转/0 error；全量后端测试仍绿（零改动安全网）。

## 5. 显式延后

- 打印/真导出；深链带期间跳转；公司维度切换（F2）；总项/分项损益卷积视图（P3 或独立小刀）；勾稽项扩展（净利润↔未分配利润等会计深口径）。
