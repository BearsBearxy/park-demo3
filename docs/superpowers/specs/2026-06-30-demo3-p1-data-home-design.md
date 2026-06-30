# demo3 P1 数据中心首页 data-home 工作台 — 设计规范

- 状态：已批准（2026-06-30 brainstorming），待用户复审
- 事实源：`_handoff_extracted/untitled/project/app/screen-data-home.jsx` + `datacenter-data.js`（`FP_DC.home`）
- 复用：DS `Card`/`KpiCard`/`Button`/`Avatar`、§6 加载门、`router.push`+`tabs.open` 导航
- 镜像后端范式：只读聚合 service（参照 `ContractService.summary` 之类无 CRUD 取数）

## 1. 目标与范围

数据中心首页 = 任务驱动工作台。核心问题：**本期还差哪些数据没录，一眼看到、一键直达**。
**纯只读聚合屏**：无 CRUD、无迁移、无种子、零新表。所有数字从已建子系统的真实数据派生。

**本期范围 = data-home 全栈**（净新增 1 个聚合端点 + 1 个前端屏）。镜像 `screen-data-home.jsx` 的三栏布局。

## 2. 全局约束 + 取舍

- JWT 保护、`Result<T>` 封装、`com.park.demo3` 包。
- **零新表、零迁移、零种子**：只读派生。
- **确定性、不耦合系统时钟**：本期由数据派生（各子系统 currentYear/currentMonth 已是 max-data 口径），不读 `new Date()`。
- **无源不造假（用户锁定"轻量降级"）**：核心两栏（数据完整度+本期待办）全真派生；最近动态降级为 `updated_at` 派生的"最近录入/修改"（真时间戳、无"谁"、无审计表）；对账/复核类待办无源 → 不列；KPI 无历史基线的同比 delta → 不显。

## 3. 数据派生口径

### 3.1 本期（year, month）
`本期 = max(year,month)` 跨 5 个**月度类**子系统中有数据的最新 (年,月)：月度台账、销售收入(附10)、工资(附12)、办公水电(附13)、三期水电(附14)。数据驱动、确定性。
> 注：若某月度子系统落后于本期（如台账只录到 5 月、本期=6 月），它在 §3.2 即判 `missing` → §3.3 自然生成待办。这正是工作台目的。

### 3.2 数据源状态（数据完整度，全真派生）
追踪 **9 个录入子系统**，逐个判本期是否已录：

| 数据源 | tag | 判定粒度 | 取数 | go |
|---|---|---|---|---|
| 月度台账 | 凭证 | 本月 | ledger 本期月有行 | ledger |
| 销售收入 | 附10 | 本月 | s10 本期月任一期有行 | sales-income |
| 工资明细 | 附12 | 本月 | salary 本期月有行 | salary |
| 办公水电 | 附13 | 本月 | office(no13) 本期月有行 | utilities |
| 三期水电 | 附14 | 本月 | office(no14) 本期月有行 | utilities |
| 光伏发电 | 附6 | 本年 | pv 本期年有行 | pv-income |
| 汽车充电桩 | 附7 | 本年 | charging(no7) 本期年有行 | car-charging |
| 电动车充电桩 | 附8 | 本年 | charging(no8) 本期年有行 | ebike-charging |
| 电费成本 | 附11 | 本年 | elec 本期年有行 | elec-cost |

- `status`：`done`（本期有数据）/ `missing`（无）。**仅二态**（不做 partial，无清晰"完整"定义；honest binary）。
- `updated`：本期行的 `max(updated_at)`，格式 `M/d`（无则 `—`）。
- 进度：`progressTotal=9`，`progressDone=done 数`，`pct=round(done/9*100)`。

### 3.3 本期待办（全真派生，只列可派生项）
- 每个 `missing` 子系统 → 一条「{名称} 本期未录入」，`sev=warning`，`go`→该屏，`meta`="本期 {year}年{month}月 暂无数据"。
- 合同即将到期 → 取 `ContractService.summary().contractExpiring`，>0 则一条「{n} 份合同即将到期待续签」，`sev=warning`，`go`→contracts。
- **不列**：对账、复核（demo3 无 bank-flow/复核流程，无源）。
- `tasks` 按 sev 再按名稳定排序（确定性）。

### 3.4 最近动态（轻量降级）
跨 9 子系统**本期行**取 `updated_at` 最新的 **6 条**记录 → 每条 `{ source(子系统名), period(acct_month/年月), time(updated_at, 'M/d HH:mm') }`。**无"谁"字段**（单管理员、无审计）。前端文案：「{source} · {period} 更新」。
> 口径=本期内最新（非全量历史）：整屏是"本期工作台"，最近动态同 §1 本期框架——只反映本期数据的最近录入/修改。这是有意选择（与 KPI#4 一致）。
> 种子数据初期 `updated_at` 多为种子载入时间（诚实，非造假）；真实录入后自然刷新。

### 3.5 KPI（4 枚，真派生）
1. 数据完整度 — `pct%`，副 `{done} / 9 项`
2. 待处理事项 — `tasks.length`
3. 本期记录数 — Σ 各源本期行数（月度类计本月行、年度类计本年行）
4. 最近更新 — **本期行** `max(updated_at)` 的 `HH:mm`，副 `{M/d} · {该记录子系统}`（同 §3.4 本期口径）

（**无 trend/delta**：无历史基线，不造假同比。）

## 4. 后端 API（JWT，`Result<T>`，镜像只读聚合 service）

- `GET /api/data-home/overview` → `DataHomeOverviewDTO`：
  ```
  DataHomeOverviewDTO {
    period: { year:int, month:int, label:String "YYYY年M月" }
    progressDone:int, progressTotal:int, pct:int
    kpis: DataHomeKpiDTO[] { label, value, sub, tint, icon }
    sources: DataHomeSourceDTO[] { name, tag, status('done'|'missing'), updated, go }
    tasks: DataHomeTaskDTO[] { label, meta, cta, go, sev('warning'|'info'|'danger') }
    recent: DataHomeRecentDTO[] { source, period, time }
  }
  ```
- `DataHomeService`（`@Service`，只读，**零新表**）：注入各子系统 mapper / 复用其按期查询（`selectBySlot`/`selectByYear`/`selectMonth`/`selectList`）+ `ContractService`；计算本期、9 源状态、待办、最近动态、KPI。本期口径见 §3.1。
- DTO 5 件（上列）。`DataHomeController`（1 端点）。
- **测试**：`DataHomeServiceTest`（Mockito：本期 max 月派生、源 done/missing、缺源生成待办、合同 expiring 待办、最近动态 top6 排序、KPI）；`DataHomeApiIT`（Testcontainers：真种子下 overview 形状 + 关键字段，如 progressTotal=9、sources 含 9 项、本期非空）。

## 5. 前端（复用 DS + sched 既有，路由 data-home 换屏）

- `views/data-home/DataHomeView.vue`：1:1 移植 `screen-data-home.jsx` 三栏布局：
  - 头部：标题 + 本期徽标 + 动作（导入 Excel→import 占位 / 录入台账→ledger）
  - 4 KPI（DS `KpiCard`）
  - 三栏：本期待办（点击行 `go` 直达）/ 本期数据完整度（pct 进度条 + 源状态行，点击 `go`）/ 最近动态（无头像或灰底首字，文案「{source} · {period} 更新 · {time}」）
  - **§6 加载门**：overview 未到显转圈，不假空态。
  - 导航：行点击 `router.push('/'+go)`（`router.afterEach` 已自动 `tabs.open`，无需手动）。
  - CSS 自带 `<style scoped>`（移植 `DhStyles`，不复用别组件 scoped 类）。
- 路由 `data-home` 从 `PlaceholderView` 换 `DataHomeView`。
- 导入 Excel 按钮占位（同其他屏，落地延后）。

## 6. 明确不做（OUT）

审计日志表、对账/复核类待办、导入历史（无导入中心）、partial 状态、KPI 同比 delta、最近动态的"谁"（无用户体系）。

## 7. 验证 / DoD（三类验证缺口铁律）

- 后端**编排者亲跑全量 `./mvnw test`**（不接管道掩盖退出码；DataHomeServiceTest + DataHomeApiIT 绿）。
- 前端 `vue-tsc` build + vitest 绿。
- 起真后端 + demo3-mysql:13306 + preview **肉眼扫整屏**：本期徽标真值 / 完整度% + 9 源 done|missing / 待办点击直达对应屏 / 最近动态真时间戳 / KPI 真值 / 0 console error。
- opus 对抗复审（派生口径正确性 + 契约形状 + 导航事件链 + scoped 样式真渲染），verify 逐条核实防幻觉。
