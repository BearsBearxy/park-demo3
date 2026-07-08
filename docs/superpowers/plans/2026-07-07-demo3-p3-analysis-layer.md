# Plan:P3 经营分析层(2026-07-07)

依据 spec:[2026-07-07-demo3-p3-analysis-layer-design.md](../specs/2026-07-07-demo3-p3-analysis-layer-design.md)。

## 阶段 1 · 地基(单 agent,其余全部依赖它)
- F1 图表原语:untitled/project/analysis/ana-charts.jsx + ana-kit.jsx + app/fig-line-chart.jsx → `src/components/ana/`(每图一 .vue + useWidth/fmt/tag 工具);Gallery 加一屏冒烟展示(仓库惯例)。
- F2 期间与外壳:`src/analysis/usePeriod.ts`(可用月份由数据派生)+ `src/views/analysis/AnaShell.vue`(期间/设置弹层,localStorage 阈值)。
- F3 数据适配:`src/analysis/anaData.ts` 按 spec 每屏映射表定义聚合器;先盘点既有 api/**,确缺才新增只读 AnalysisController 聚合端点(带 IT)。
- F4 路由/骨架:14 条分析路由从 PlaceholderView 切到 `src/views/analysis/<屏>.vue` 骨架(AnaShell+空态),**一次建全**,屏 agent 只填自己的文件(避免 router 冲突)。
- 测试:聚合器/usePeriod 单测、图表冒烟、全量绿。

## 阶段 2 · 屏(6 agent 并行,各自只动自己的 view 文件)
- G1 cockpit + anomaly;G2 park + park-energy;G3 tenant-energy + tenant-portfolio;
- G4 fin-pnl + fin-balance + fin-cashflow(降级/改造重);G5 churn + expiry + breakeven;G6 pnl-analysis + pv-roi(各有独立原型)。
- 每屏:1:1 移植原型视觉 → anaData 真数据绑定 → spec 指定空态卡 → 抽 2 值和库对(agent 自查 SQL)。

## 阶段 3 · 复审(2 agent)
- R1 数据正确性:每屏抽图表值 SQL 回算;空态卡覆盖点核对;mock 残留扫描(禁止 ana-data.js 语义泄入)。
- R2 视觉/回归:与原型逐屏对照(布局/图表类型/令牌);全量 vitest+typecheck;KeepAlive/Tab/深链等既有机制不回归。

## 主会话收尾
复审确认项修复 → 复测 → preview 起真后端人工验收清单。
