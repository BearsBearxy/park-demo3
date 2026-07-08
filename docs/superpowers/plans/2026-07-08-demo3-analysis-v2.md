# Plan:分析层 v2 重构(2026-07-08)

依据 spec:[2026-07-08-demo3-analysis-v2-redesign.md](../specs/2026-07-08-demo3-analysis-v2-redesign.md)(§一全局系统/§二逐页/§三验收)。数据层 anaData 不动,纯视图重构,数值锚点必须与 v1 一致。

## 阶段 1 · 地基(单 agent)
- npm i echarts(唯一新依赖);`components/ana/AnaEChart.vue` 薄封装(init/dispose/ResizeObserver/click 透传/option 响应式 setOption);`fpAnaTheme` 主题注册(spec §一配色)。
- AnaShell v2:工具条集成 **对比开关**(useCompare composable:无/环比/同比/预算,localStorage,屏声明支持集,不支持项禁用+tooltip);新增 #kpis 槽;ana.css 追加 v2 布局类(.av2-kpis/.av2-grid 12栅格/.av2-card/span 工具类)。**保持向后兼容**(现 15 屏不改仍全绿)。
- AnaKpiTile.vue(值+delta 副行)。单测:AnaEChart(mock echarts)/useCompare;全量门禁绿(jsdom 无 canvas,组件测试一律 mock echarts)。

## 阶段 2 · 屏组重构(6 agent 并行,严格按 spec §二 + 两张示意图结构)
- G1 cockpit + anomaly→租户异常监控中心(最重);G2 park(TreeMap)+park-energy(Sankey);G3 tenant-energy(工作台)+tenant-portfolio;G4 fin 三屏;G5 churn+expiry+breakeven;G6 pnl-analysis+pv-roi+budget。
- 铁律:只动自己 view(+屏内组件);不改 ana.css/anaData 既有函数(缺聚合器可追加);ECharts 全走 AnaEChart;spec 指定的下钻/联动/对比开关逐处落实;深链复用 openFresh+query 协议;数值与 v1 锚点一致(dataChecks 自证);数据变换抽纯函数单测;全量门禁。

## 阶段 3 · 复审(2 agent)
- R1 数值+交互:逐屏锚点回算(930.2万/81.3%/94.6% 等);下钻/联动/对比开关逐处 code-walk;监控中心全流程;覆盖度标注不丢。
- R2 布局+回归:对照 spec §二/示意图结构;AnaEChart dispose 泄漏;echarts 懒加载分割;全量 test+typecheck;非分析层零改动。

## 主会话收尾
复审确认项修复 → 复测 → 用户人工验收(vite 热更即见,无后端改动)。
