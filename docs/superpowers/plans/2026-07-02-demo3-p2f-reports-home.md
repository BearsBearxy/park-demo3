# P2-F 报表中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`)。本计划由 Workflow 编排实现，编排者亲跑测试把关。

**Goal:** 报表中心 hub（P2 收官）——纯前端聚合：目录/期间两视图、9 报表卡、勾稽 4 项客端算，零后端改动。

**Architecture:** `reports/reportsHome.ts`（聚合器 + 勾稽纯函数，复用 `computeRow/computeBsRow/tbTotals` 与既有 api）+ `ReportsHomeView.vue`（1:1 `screen-reports-home.jsx` 两视图）+ 路由 `reports-home` 换真屏。

**Tech Stack:** Vue 3 TS + Vitest（无后端改动）。

**Spec:** `docs/superpowers/specs/2026-07-02-demo3-p2f-reports-home-design.md`（F1–F8 以此为准）

## Global Constraints

- 继承既往全部前端 Global Constraints（§6 加载门+v-else 紧邻链+切期间不清 data/共享 http/懒加载）。
- F 特有：**零后端改动**；公司口径固定全部汇总（`allPeriod`）；勾稽容差 0.005；任一数据源失败该卡「待生成」灰、不阻塞整页（`Promise.allSettled`）；期间默认=各源最大数据期（确定性不读时钟）。

---

## 文件结构

- Create: `frontend/src/reports/reportsHome.ts` + `.spec.ts`
- Create: `frontend/src/views/reports/home/ReportsHomeView.vue`
- Modify: `frontend/src/router/index.ts`（`reports-home` → 真屏）

---

## Task 1: reportsHome 聚合器 + 勾稽纯函数

**Interfaces — Produces:**
- `HomeCard { key:'is'|'bs'|'tb'|'s1'..'s5'|'recon', name, desc, icon, go(route值), metric, value:string|'待生成', updated:string, tie:'ok'|'bad'|'none'|'pending' }`
- `TieItem { label, a, b, value:string, ok:boolean }`
- `HomeData { cards: HomeCard[], tieout: TieItem[], year:number, month:number }`
- `loadHomeData(year:number, month:number): Promise<HomeData>`——`Promise.allSettled` 并行拉：`reportApi.allPeriod('is'|'bs'|'tb', y, m)`、`PNL_SCHEDULES.map(c=>pnlApi.overview(c.schedule))`、`reconApi.overview(y)` + `reconApi.month(y,m)`（recon 卡与勾稽④）、`s10Api.getMonth(phase,y,m)×4`（勾稽③ Σ）；失败源→该卡 value='待生成' tie='pending'、相关勾稽项 ok=false value='—'。
- 勾稽 4 项算法（纯函数，输入已拉数据）：
  - `tieBs(bsAmounts)`：`computeBsRow(30) − computeBsRow(53)`（reports/balanceSheet 的 computeBsRow + amounts getLeaf；无自定义行传 ()=>null），`|d|<=0.005` ok，value=资产总计格式化。
  - `tieTb(tbData)`：`tbTotals(accounts,amounts)` 的 `endDr − endCr`，value=期末借合计。
  - `tieIncome(isAmounts, s10MonthTotals)`：`computeRow(1,'cur',...)` ⇄ `Σ s10 各期 total`（s10 getMonth 返回含列合计——实现者 Read types/s10 确认字段，如无现成合计则 Σ rows 各列），value=两值并列或差额。
  - `tieRecon(reconMonthMeta)`：`diffCount+missCount===0` ok，value=`${diff+miss} 户待处理`。
- `defaultPeriod(sources): {year,month}`——is/bs/tb 用 `reportApi.year` 太重；简化：recon overview 已返年内逐月 hasData（两本账口径），默认=recon 最大 hasData 月；recon 无数据回退 bs/is 种子期 2025-09 再回退 {2025,9}？**定死规则**：依次尝试 `reconApi.overview()`(缺省年) 取最大 hasData 月 → 无则 {2025, 9}（种子期）。
- 卡片元数据常量 `HOME_CARDS`（9 张：is 净利润(本月)=computeRow(32,'cur')/bs 资产总计=computeBsRow(30)/tb 期末借合计+科目数/s1..s5 = pnl overview 最大数据年+该年行数/recon=该月差异+缺记户数；icon/go 对齐 fpNav：trending-up/scale/table-2/home/zap/droplets/wrench/banknote/git-compare；desc 一句话）。

- [ ] Step 1: spec 先失败——tieBs 平/不平、tieTb、tieIncome 相等/不等、tieRecon 0/非0、loadHomeData 某源 reject→对应卡 待生成+整体不抛（mock 各 api）。
- [ ] Step 2: 实现 → `npx vitest run reportsHome` 绿 + `npx vue-tsc --noEmit` 无本文件错。
- [ ] Step 3: commit `feat(reports-home): 聚合器+勾稽4项纯函数(零后端,allSettled 容错)`。

---

## Task 2: ReportsHomeView 两视图 + 路由

**Interfaces — Consumes:** Task 1 全部。像素源=`C:\financial_dashboard\_handoff_extracted\untitled\project\app\screen-reports-home.jsx`（RhStyles 1:1，结构照 目录/期间 两 Fragment）。

**要点：**
- 页头：标题「报表中心」+ 副标题 + 打印/导出 Excel 按钮（`disabled` 占位）。
- 工具栏：年胶囊（fin-ypill 式自带 scoped）+ 月下拉（DS Select 或原生 select 复用 fin-in 样式）‖ 右侧 目录/期间 Segmented（DS Segmented）。
- 目录视图：`三大报表` 区 `.rh-grid`（HomeCard→ReportCard 内联子组件：icon/name/desc/metric+value（待生成灰）/数据截止 {year}年{month}月/tie 徽标 已勾稽·待查·待生成）+ `损益附表` 区（5 卡）+ `收入核对` 卡 + `本期勾稽` `.rh-tie-strip` 瓦片（label/value/a↔b/已平·待查）。
- 期间视图：`.rh-period-hero`（calendar-check + `{year}年{month}月 · 期间核算` + Badge `N/4 项已平`）+ 勾稽检查表 `.rh-tie-table`（勾稽项|来源A|=|来源B|金额|结果）+ 本期报表列表（行点击 `router.push('/'+go)`）。
- 状态：`data: HomeData|null`（§6 加载门）；切年/月/视图不清 data + seq 竞态守卫；卡点击 push。
- 路由：`reports-home` 分支 → ReportsHomeView（懒加载 const）。

- [ ] Step 1: View + 路由。
- [ ] Step 2: `npm run build` 绿 + `npx vitest run` 全量绿。
- [ ] Step 3: commit `feat(reports-home): 报表中心屏(目录/期间两视图+9卡+勾稽) + 路由`。

---

## Task 3: 端到端真跑（编排者亲验）

- [ ] 全量 `./mvnw test` 绿（零后端改动安全网）→ jar → 后端+preview。
- [ ] preview：/reports-home 目录视图 9 卡（is/bs/tb 2025-09 种子有值、pnl s1 2025 行数、recon 户数）、勾稽瓦 4（bs 平衡差非 0→待查【种子两侧不平】、tb 已平【种子借贷全平】、recon 13 户→待查——真值）；期间视图表格同源一致；切 目录/期间/年月 不闪；卡片直达跳转；0 console error。
- [ ] 杀 :8080；提交；更新记忆（P2 全收官）。

---

## Self-Review

**Spec coverage：** F1 零后端→全计划无后端任务;F2 allPeriod→T1;F3 期间默认规则→T1 defaultPeriod(已定死);F4 两视图→T2;F5 勾稽4项+容差→T1;F6 9卡→T1 HOME_CARDS/T2;F7 禁用占位→T2;F8 push 直达→T2;§3 测试→T1/T3。全覆盖。
**Placeholder scan：** 无 TBD;defaultPeriod 回退链/tieIncome 的 s10 合计来源(实现者 Read types 确认)已定死处理方式;各勾稽算法引用的既有函数具名。
**Type consistency：** HomeCard/TieItem/HomeData T1 定义 T2 消费;loadHomeData(year,month) 签名一致;go 值=fpNav 路由值。
