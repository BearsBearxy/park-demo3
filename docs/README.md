# docs/ 文件索引

docs/ 下每一份文件一行：是什么、现在还算不算数、被谁取代。2026-10-16 按 master `6a78bbbc` 整理；同日分支 `jfen/docs-refresh` 把标「有过期处」的一批正文按代码改了，对应行已改成现状。

## 怎么用

- 要动手：先看「现行规则」和「功能规格」两组。按要做的事该读哪几份，见 [../AGENTS.md §1](../AGENTS.md#1-动手前必读)。
- 「计划」「历史留档」是做完的工作记录，用来查来历，**别照着它们改代码**。
- `superpowers/plans/` 和 `research/` 刻意不改，它们是历史记录（PAGE-BEHAVIOR-SPEC:45 的规定）。
- 新写的规格放 `docs/design/`，并在本表加一行；某份被取代了，就在它那行写「被谁取代」，再在原文文首加一句指过去。
- 规格里写的 `../运维文档/…` 是按**仓根**算的路径（从 `docs/design/` 打开要再往上两层：`../../../运维文档/…`）。
- 设计稿和画布不在本仓，见 [../../运维文档/设计稿/README.md](../../运维文档/设计稿/README.md)。

**状态怎么读**

| 状态 | 意思 |
|---|---|
| 现行 | 现在就按它做 |
| 现行·有过期处 | 规则还对，但文中某几句已经过时（过时的是哪句写在同一格） |
| 已实现·留档 | 做完了，留着查来历 |
| 已被取代 | 看「被谁取代」那一列 |
| 一次性 | 某次核对、审查或修数的产物 |

---

## 1. 现行规则（跨屏、跨模块都要守的）

| 文件 | 是什么 | 状态 | 被谁取代 |
|---|---|---|---|
| [design/PAGE-BEHAVIOR-SPEC.md](design/PAGE-BEHAVIOR-SPEC.md) | 加载门、居中弹卡、z-index 七级、铃铛通知 | 现行：界面六份必读之一。§4 引的原型 `.jsx` 10-15 已删，文内留作对照、行号已按 10-16 代码改 | — |
| [design/LIST-PAGE-SPEC.md](design/LIST-PAGE-SPEC.md) | 列表页骨架、56px 行、列宽、分页、固定列 | 现行：六份必读之一；:69「数字不省略」只落了 7 张宽表 | — |
| [design/UI-CONSISTENCY-SPEC.md](design/UI-CONSISTENCY-SPEC.md) | 禁原生 select、字号阶梯、语义色、令牌门禁 | 现行：六份必读之一 | — |
| [design/LAYOUT-STABILITY-SPEC.md](design/LAYOUT-STABILITY-SPEC.md) | 交互不许挪动已渲染内容、加载三档、新信息放哪 | 现行：六份必读之一 | — |
| [design/UI-OVERLAY-SPEC.md](design/UI-OVERLAY-SPEC.md) | 浮层点外关、Esc 只关自己、不用浏览器弹框 | 现行：六份必读之一 | — |
| [design/EDIT-MODE-SPEC.md](design/EDIT-MODE-SPEC.md) | 浏览态只读、进得了编辑模式就说明权限齐、工具条 | 现行：六份必读之一 | — |
| [design/RESPONSIVE-LAYOUT-SPEC.md](design/RESPONSIVE-LAYOUT-SPEC.md) | 四档响应式与手机布局 v1.3 | 现行 | — |
| [design/WRITE-KEEP-CONTEXT-SPEC.md](design/WRITE-KEEP-CONTEXT-SPEC.md) | 写操作后不丢用户的滚动位置 | 现行 | — |
| [design/DARK-MODE-SPEC.md](design/DARK-MODE-SPEC.md) | 暗色令牌与外观开关 | 现行：「首帧不闪」那条线上不生效（CSP 挡掉内联脚本，读代码判断、未实测），文内已注；要修是改代码 | — |
| [design/KPI-CARD-SPEC.md](design/KPI-CARD-SPEC.md) | KPI 卡方向 A 的配色与字号 | 现行：:40「放不下换万」标着定稿·待实现 | — |
| [design/DATE-PICKER-SPEC.md](design/DATE-PICKER-SPEC.md) | 统一的日期/月份选择器 | 现行 | — |
| [design/TAB-BAR-SPEC.md](design/TAB-BAR-SPEC.md) | Chrome 式页签与顶栏 | 现行 | — |
| [design/RELEASE-NOTES-SPEC.md](design/RELEASE-NOTES-SPEC.md) | 版本号规则与更新公告写法 | 现行：发版必读 | — |
| [design/VERSION-UPDATE-SPEC.md](design/VERSION-UPDATE-SPEC.md) | 版本更新入口、本次更新弹窗、更新记录 | 现行 | — |
| [design/API-CONTRACT-SPEC.md](design/API-CONTRACT-SPEC.md) | 后端接口返回格式、列表形态、5000 行上限 | 现行：改后端前必读 | — |
| [design/METRIC-SOURCE-SPEC.md](design/METRIC-SOURCE-SPEC.md) | 同一个业务判定只许有一个实现 | 现行 | — |
| [design/CONCURRENCY-SPEC.md](design/CONCURRENCY-SPEC.md) | 编辑锁、在场、远程授权 | 现行：:9 乐观锁未实现 | — |
| [design/IMPORT-GUIDE.md](design/IMPORT-GUIDE.md) | Excel 导入的实现标准与避坑 | 现行：改导入必读；:34 稿路径用「…」省略了 | — |
| [design/SCAFFOLD.md](design/SCAFFOLD.md) | 新功能代码放哪、复用规则 | 草案，待用户审（§7 有六条待定） | — |
| [superpowers/specs/2026-09-05-demo3-motion-design.md](superpowers/specs/2026-09-05-demo3-motion-design.md) | 全站动效规范 | 现行：已实现（PR #39），代码按仓外 v2 做，文首已注；细节以 v2 为准 | v2（仓外 `运维文档/设计稿/未实现/全站动效-2026-09-05/`） |
| [OPS-SLOW-QUERY.md](OPS-SLOW-QUERY.md) | MySQL 慢查询日志怎么开（阈值 0.2 秒） | 现行 | — |

## 2. 功能规格（某个模块怎么算、怎么排）

### 计费与账单

| 文件 | 是什么 | 状态 | 被谁取代 |
|---|---|---|---|
| [design/BILL-DERIVE-SPEC.md](design/BILL-DERIVE-SPEC.md) | 催缴单计价判定、一户一单 | 现行：文中建表语句是草案，实表以 S4 和 V89 为准 | — |
| [design/S4-BILL-NOTICE-SPEC.md](design/S4-BILL-NOTICE-SPEC.md) | 催缴单派生实现 | 现行：月份规则在 §1.1（N 月的单 = N−1 月水电 + N 月租金） | — |
| [design/BILL-NOTICE-WARN-SPEC.md](design/BILL-NOTICE-WARN-SPEC.md) | 催缴单告警分类与文案门禁 | 现行：:500 提到的后继画布「催缴单租户抽屉 · 整屏重设计」在仓外找不到 | — |
| [design/S20-BILL-DELIVERY-SPEC.md](design/S20-BILL-DELIVERY-SPEC.md) | 催缴单收款账户、确认、导出 | 现行 | — |
| [design/S21-PARAM-CENTER-SPEC.md](design/S21-PARAM-CENTER-SPEC.md) | 计费参数中心、损耗公摊度数公式 | 现行 | — |
| [design/S2-BIND-SPEC.md](design/S2-BIND-SPEC.md) | 表和合同绑定、出单门禁 | 现行：绑定 09-24 已挪进 `meter_assign`（文内有注） | — |
| [design/S5-PREMISE-BILL-SPEC.md](design/S5-PREMISE-BILL-SPEC.md) | 按地块出租金和水电 | 现行 | — |
| [design/S14-COEF-BOOK-SPEC.md](design/S14-COEF-BOOK-SPEC.md) | 系数簿：催缴单批量改管理费、层份 | 现行：已上线（`CoefBookWindow.vue`） | — |
| [design/BILLS-SPEC.md](design/BILLS-SPEC.md) | `/bills` 账单屏口径与工资条版式 | 已被取代：这一屏 08-13 已撤（文首已注）；只剩 §5 的 `bill_pay_company` 映射表有效 | 页面职能 → [S20-BILL-DELIVERY-SPEC](design/S20-BILL-DELIVERY-SPEC.md) |
| [design/POOL-ENGINE-SPEC.md](design/POOL-ENGINE-SPEC.md) | 公共电核算引擎、楼栋损耗表 | 现行：公式权威是 BOOK-STRUCTURE-2024-02 | — |
| [design/BOOK-STRUCTURE-2024-02.md](design/BOOK-STRUCTURE-2024-02.md) | 2024-02 两本水电原册逐格结构 | 现行：原册的唯一事实源；:1190 附录引用的测绘数据已丢 | — |
| [design/BOOK-WORKBENCH-SPEC.md](design/BOOK-WORKBENCH-SPEC.md) | 台账、附表10 账册工作台；录入页动线准则 | 现行：新增录入页必读 §7 | — |
| [design/CONTRACT-BILLING-REWORK-SPEC.md](design/CONTRACT-BILLING-REWORK-SPEC.md) | 合同统一模型：每个价格时段是链上一份合同 | 现行：:102 说好的删 `contract_rent_tier` 表还没做 | — |
| [design/CONTRACT-CARD-SPEC.md](design/CONTRACT-CARD-SPEC.md) | 合同卡 v1：类型、状态、续签链 | 现行：§5.3、§6.1 已被 V2 覆盖（文首已注）；:3 引用的拍板原文只在本机记忆里 | §5.3、§6.1 → CONTRACT-CARD-V2 |
| [design/CONTRACT-ESCALATION-SPLIT-SPEC.md](design/CONTRACT-ESCALATION-SPLIT-SPEC.md) | 合同内递增段拆成链上的段 | 已实现·有过期处：:18-20 写 8 份未起租的中间档「待用户定是否改回」，线上 09-27 已全部改回生效中（记录在仓外 `../../运维文档/对账/2026-09/`），文内没补 | — |

### 抄表、光伏、电费

| 文件 | 是什么 | 状态 | 被谁取代 |
|---|---|---|---|
| [design/METER-SPEC.md](design/METER-SPEC.md) | 抄表表档案与月度读数模型 | 现行：页面章节 §6 §7 已被 V4/V5 取代（:112 有注） | 页面部分 → METER-V5 |
| [design/METER-TIMELINE-SPEC.md](design/METER-TIMELINE-SPEC.md) | 表档案按月分段（只记起始月） | 现行 | — |
| [design/METER-V5-SPEC.md](design/METER-V5-SPEC.md) | 抄表页单表格工作台 | 现行：数据模型以 METER-TIMELINE 为准 | — |
| [design/METER-IMPORT-SPEC.md](design/METER-IMPORT-SPEC.md) | 抄表导入模板列与表身份 | 现行 | — |
| [design/CP-METER-SPEC.md](design/CP-METER-SPEC.md) | 充电桩分桩数据模型与页面流 | 现行 | — |
| [design/PV-METER-SPEC.md](design/PV-METER-SPEC.md) | 光伏分栋抄表数据模型与页面流 | 现行 | — |
| [design/ELEC-COST-SPEC.md](design/ELEC-COST-SPEC.md) | 园区电费成本模型（总表 × 费项 × 月） | 现行 | — |

### 分析屏

| 文件 | 是什么 | 状态 | 被谁取代 |
|---|---|---|---|
| [design/PV-ANALYSIS-SPEC.md](design/PV-ANALYSIS-SPEC.md) | 光伏分栋分析的数据口径、判据线、护栏 | 现行：版式以 V4 和仓外画布为准（:550 有注） | 版式 → PV-ANALYSIS-SCREEN-V4 |
| [design/PV-ANALYSIS-SCREEN-V4.md](design/PV-ANALYSIS-SCREEN-V4.md) | 光伏分栋分析屏 v4 版式与配色 | 现行·有过期处：10-06 PR #69 按仓外画布又改了一轮，没回写到正文（文首已注，以代码和画布为准） | 部分 → 仓外「分析屏现状画布-2026-10-03」 |
| [design/ENERGY-ANALYSIS-SPEC.md](design/ENERGY-ANALYSIS-SPEC.md) | 电费成本、充电桩分析屏 | 现行：§2 已被取代（文内已注，光伏分栋独立成屏）；§1 §3 §4 仍有效 | §2 → PV-ANALYSIS-SPEC |

### 权限、导航、账册模板、导入界面

| 文件 | 是什么 | 状态 | 被谁取代 |
|---|---|---|---|
| [design/RBAC-SPEC.md](design/RBAC-SPEC.md) | 账号权限 v4（细到菜单单项） | 现行：§15 是现行设计，前文多为历史 | — |
| [design/ELEVATION-SPEC.md](design/ELEVATION-SPEC.md) | 主管当场授权 30 分钟、双人审计 | 现行：§4.3 原来的全局横幅已推翻，改成顶栏钥匙按钮（PR #65；文内 :167 有注） | — |
| [superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md](superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md) | 侧栏动线与审核机制总规范 D1–D20 | 现行：P0–P5、R1–R4 已合（PR #22–#29）；§9 的 P6（命令面板「本月」组）标可选、没做。docs/design 里 10 份规格按名字「SIDEBAR-UX-REDESIGN」引用的就是它 | — |
| [superpowers/specs/2026-08-26-per-month-template-pin-design.md](superpowers/specs/2026-08-26-per-month-template-pin-design.md) | 账册模板按册 × 月选版 | 现行（PR #9、V111） | — |
| [superpowers/specs/2026-10-10-import-center-modal-impl-design.md](superpowers/specs/2026-10-10-import-center-modal-impl-design.md) | 导入中心、导入弹窗、动效的实现规范 | 已实现（PR #74，0.34.0）；导入界面目前最新的口径，改导入要读 | — |

## 3. 计划（已执行的实施计划）

| 文件 | 是什么 | 状态 | 被谁取代 |
|---|---|---|---|
| [design/RESPONSIVE-V2-PLAN-2026-09-20.md](design/RESPONSIVE-V2-PLAN-2026-09-20.md) | 响应式 v2：稿到任务的覆盖表与分期 | 已实现（PR #51、#54）；P5 用户定不做，实现只留在未合分支 | — |
| [design/AUDIT-FIX-PLAN-2026-08-11.md](design/AUDIT-FIX-PLAN-2026-08-11.md) | 08-11 全面审计的整改分批计划 | 已实现·留档 | — |
| [superpowers/2026-09-24-meter-timeline-plan.md](superpowers/2026-09-24-meter-timeline-plan.md) | 表档案按月记录 | 已实现（PR #56，0.20.0）；放在 superpowers 根目录 | — |
| [superpowers/2026-09-26-pool-monthly-config-plan.md](superpowers/2026-09-26-pool-monthly-config-plan.md) | 公摊池按月配置 + G1 | 已实现（PR #58，0.22.0）；文中引的 `docs/research/pool-book-recon-2026-09-25.md` 不在仓，在仓外 `运维文档/对账/2026-09/报告/` | — |
| [superpowers/specs/2026-08-29-pool-entry-fix-plan.md](superpowers/specs/2026-08-29-pool-entry-fix-plan.md) | 公摊池入口修复方案 | 已实现（PR #16） | — |
| [superpowers/plans/2026-06-28-demo3-p0a-backend-foundation.md](superpowers/plans/2026-06-28-demo3-p0a-backend-foundation.md) | 后端地基、楼栋/租户只读接口 | 已实现·留档 | — |
| [superpowers/plans/2026-06-28-demo3-p0c-shell.md](superpowers/plans/2026-06-28-demo3-p0c-shell.md) | 应用外壳与登录 | 已实现·留档；事实源指仓外的 `_handoff_extracted` 原型 | — |
| [superpowers/plans/2026-07-02-demo3-import-center-hub.md](superpowers/plans/2026-07-02-demo3-import-center-hub.md) | 导入中心与导入日志 | 已实现（V20）；界面已被 PR #74 重做 | 界面 → specs/2026-10-10-import-center-modal-impl-design.md |
| [superpowers/plans/2026-07-02-demo3-p2a-reports-income-statement.md](superpowers/plans/2026-07-02-demo3-p2a-reports-income-statement.md) | 报表基建与利润表 | 已实现·留档 | — |
| [superpowers/plans/2026-07-02-demo3-p2b-balance-sheet.md](superpowers/plans/2026-07-02-demo3-p2b-balance-sheet.md) | 资产负债表 | 已实现（V23） | — |
| [superpowers/plans/2026-07-02-demo3-p2c-trial-balance.md](superpowers/plans/2026-07-02-demo3-p2c-trial-balance.md) | 科目余额表 | 已实现（V24） | — |
| [superpowers/plans/2026-07-02-demo3-p2d-pnl-schedules.md](superpowers/plans/2026-07-02-demo3-p2d-pnl-schedules.md) | 损益附表 1–5 | 已实现（V26） | — |
| [superpowers/plans/2026-07-02-demo3-p2e-reconciliation.md](superpowers/plans/2026-07-02-demo3-p2e-reconciliation.md) | 收入核对 | 已实现（V28） | — |
| [superpowers/plans/2026-07-02-demo3-p2f-reports-home.md](superpowers/plans/2026-07-02-demo3-p2f-reports-home.md) | 报表中心 | 已实现·留档 | — |
| [superpowers/plans/2026-07-02-demo3-p2g-pnl-derive.md](superpowers/plans/2026-07-02-demo3-p2g-pnl-derive.md) | 损益附表派生链接 | 已实现·留档 | — |
| [superpowers/plans/2026-07-03-demo3-p2g2-derive-generate.md](superpowers/plans/2026-07-03-demo3-p2g2-derive-generate.md) | 派生生成账目结构 | 已实现·留档 | — |
| [superpowers/plans/2026-07-03-demo3-p2g3-report-edit-fixes.md](superpowers/plans/2026-07-03-demo3-p2g3-report-edit-fixes.md) | 派生行只读、报表编辑修补 | 已实现·留档 | — |
| [superpowers/plans/2026-07-07-demo3-budget-compare.md](superpowers/plans/2026-07-07-demo3-budget-compare.md) | 预算对比 | 已实现（V30） | — |
| [superpowers/plans/2026-07-07-demo3-import-v4-recon-jump-tab-state.md](superpowers/plans/2026-07-07-demo3-import-v4-recon-jump-tab-state.md) | 台账导入 v4、核对深链、页签保持 | 已实现·留档 | — |
| [superpowers/plans/2026-07-07-demo3-p3-analysis-layer.md](superpowers/plans/2026-07-07-demo3-p3-analysis-layer.md) | 经营分析层 15 屏 | 已实现·留档；分析屏后来经 PR #31、#69 多轮重做 | — |
| [superpowers/plans/2026-07-08-demo3-analysis-v2.md](superpowers/plans/2026-07-08-demo3-analysis-v2.md) | 分析层 v2（改用 ECharts） | 已实现·留档 | — |
| [superpowers/plans/2026-07-09-demo3-import-500-hardening.md](superpowers/plans/2026-07-09-demo3-import-500-hardening.md) | 导入报 500 改成 400 | 已实现·留档 | — |
| [superpowers/plans/2026-07-09-demo3-s10-mgmtfee-alias.md](superpowers/plans/2026-07-09-demo3-s10-mgmtfee-alias.md) | 附表10 三期管理费丢列修复 | 已实现·留档 | — |
| [superpowers/plans/2026-07-10-demo3-p3-audit-fixes.md](superpowers/plans/2026-07-10-demo3-p3-audit-fixes.md) | 分析层审计修复（标题是 spec，放在 plans/） | 已实现·留档 | — |
| [superpowers/plans/2026-07-11-demo3-collection-export-readonly-role.md](superpowers/plans/2026-07-11-demo3-collection-export-readonly-role.md) | 催缴清单导出、只读角色 | 已实现·留档 | — |
| [superpowers/plans/2026-07-11-demo3-dashboard-design-adoption.md](superpowers/plans/2026-07-11-demo3-dashboard-design-adoption.md) | 外部 dashboard 稿的采纳 | 已实现·留档；引用的《园区经营分析Dashboard排版设计.md》不在仓 | — |
| [superpowers/plans/2026-07-11-demo3-kpi-rail-v2-family-plain-language.md](superpowers/plans/2026-07-11-demo3-kpi-rail-v2-family-plain-language.md) | KPI 左栏、家族汇总、说人话 | 已实现·留档 | — |
| [superpowers/plans/2026-07-11-demo3-table-overflow-kpi-rail.md](superpowers/plans/2026-07-11-demo3-table-overflow-kpi-rail.md) | 表格溢出治理、KPI 左栏化 | 已实现·留档 | — |
| [superpowers/plans/2026-07-11-demo3-tenant-ux-import-flow.md](superpowers/plans/2026-07-11-demo3-tenant-ux-import-flow.md) | 租户关联、选择器、导入流程统一 | 已实现·留档 | — |
| [superpowers/plans/2026-07-12-demo3-chart-clarity.md](superpowers/plans/2026-07-12-demo3-chart-clarity.md) | 分析层图表清晰化 | 已实现·留档 | — |
| [superpowers/plans/2026-07-12-demo3-expense-screen-log-axis.md](superpowers/plans/2026-07-12-demo3-expense-screen-log-axis.md) | 费用与报销屏、对数轴 | 已实现·留档 | — |
| [superpowers/plans/2026-07-12-demo3-expiry-wall.md](superpowers/plans/2026-07-12-demo3-expiry-wall.md) | 到期墙 | 已实现·留档 | — |
| [superpowers/plans/2026-07-12-demo3-responsive-shrink.md](superpowers/plans/2026-07-12-demo3-responsive-shrink.md) | 窗口缩小时的响应式方案 | 已被取代（PR #14 四档响应式重做） | [design/RESPONSIVE-LAYOUT-SPEC.md](design/RESPONSIVE-LAYOUT-SPEC.md) |
| [superpowers/plans/2026-07-15-area-rentfree-bills.md](superpowers/plans/2026-07-15-area-rentfree-bills.md) | 面积模型、免租期、账单启用 | 已实现（V33） | — |
| [superpowers/plans/2026-07-15-list-page-spec-flicker-fix.md](superpowers/plans/2026-07-15-list-page-spec-flicker-fix.md) | 列表页规范、深页码闪烁修复 | 已实现·留档 | — |
| [superpowers/plans/2026-07-16-bills-s10-payslip.md](superpowers/plans/2026-07-16-bills-s10-payslip.md) | 账单明细改成附表10 工资条式 | 已实现·留档 | — |
| [superpowers/plans/2026-07-18-pv-meter.md](superpowers/plans/2026-07-18-pv-meter.md) | 光伏分栋抄表 | 已实现（V36、V37） | — |
| [superpowers/plans/2026-07-25-contract-billing-rework-phase-a.md](superpowers/plans/2026-07-25-contract-billing-rework-phase-a.md) | 合同管理重做 Phase A | 已实现·留档 | — |
| [superpowers/plans/2026-07-25-contract-card-v2.md](superpowers/plans/2026-07-25-contract-card-v2.md) | 合同卡阶梯价可视化 | 已被取代（阶梯模型 07-27 删掉） | [design/CONTRACT-ESCALATION-SPLIT-SPEC.md](design/CONTRACT-ESCALATION-SPLIT-SPEC.md) |
| [superpowers/plans/2026-08-05-s5-premise-bill.md](superpowers/plans/2026-08-05-s5-premise-bill.md) | 场地化账单 | 已实现（V90） | — |
| [superpowers/plans/2026-08-08-s6-premise-by-meter.md](superpowers/plans/2026-08-08-s6-premise-by-meter.md) | 场地标签按表位置取 | 已实现·留档 | — |
| [superpowers/plans/2026-08-16-s21-param-center.md](superpowers/plans/2026-08-16-s21-param-center.md) | 计费参数中心 | 已实现（PR #2） | — |
| [superpowers/plans/2026-08-18-data-home-redesign.md](superpowers/plans/2026-08-18-data-home-redesign.md) | 数据中心首页重设计 | 已被取代（PR #22 把首页改成「本月出账」） | [specs/2026-09-03-sidebar-ux-redesign-design.md](superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md) §5 |
| [superpowers/plans/2026-08-25-global-book-template.md](superpowers/plans/2026-08-25-global-book-template.md) | 账册模板全局化 | 已被取代（第二天改成按月选版） | [plans/2026-08-26-per-month-template-pin.md](superpowers/plans/2026-08-26-per-month-template-pin.md) |
| [superpowers/plans/2026-08-26-per-month-template-pin.md](superpowers/plans/2026-08-26-per-month-template-pin.md) | 账册模板按册 × 月选版 | 已实现（PR #9，V111） | — |
| [superpowers/plans/2026-08-29-phase3-pool-opening.md](superpowers/plans/2026-08-29-phase3-pool-opening.md) | 三期公摊池开放 | 已实现（PR #16） | — |
| [superpowers/plans/2026-08-30-lock-dialogs-coverage.md](superpowers/plans/2026-08-30-lock-dialogs-coverage.md) | 失锁、接管弹窗覆盖 7 屏 | 已实现（PR #20） | — |
| [superpowers/plans/2026-08-31-pv-meter-analysis.md](superpowers/plans/2026-08-31-pv-meter-analysis.md) | 光伏分栋分析 v1（含天气） | 已被取代（气象通道已删，后有 v3、v4） | [plans/2026-09-13-pv-ana-v4.md](superpowers/plans/2026-09-13-pv-ana-v4.md) |
| [superpowers/plans/2026-09-03-p0a-period-deeplink.md](superpowers/plans/2026-09-03-p0a-period-deeplink.md) | 期间深链协议 | 已实现（PR #22） | — |
| [superpowers/plans/2026-09-03-p0b-schedule-deeplink.md](superpowers/plans/2026-09-03-p0b-schedule-deeplink.md) | 附表族接期间深链 | 已实现（PR #22） | — |
| [superpowers/plans/2026-09-03-p1-month-close-home.md](superpowers/plans/2026-09-03-p1-month-close-home.md) | 首页改名「本月出账」、出账链 5 步 | 已实现（PR #22） | — |
| [superpowers/plans/2026-09-03-p4-nav-regroup-fold.md](superpowers/plans/2026-09-03-p4-nav-regroup-fold.md) | 侧栏分组、手风琴 | 已实现（PR #22） | — |
| [superpowers/plans/2026-09-04-p0c-report-analysis-deeplink.md](superpowers/plans/2026-09-04-p0c-report-analysis-deeplink.md) | 报表、分析层接深链 | 已实现（PR #22） | — |
| [superpowers/plans/2026-09-06-p2-month-close-board.md](superpowers/plans/2026-09-06-p2-month-close-board.md) | 本月出账屏第二阶段 | 已实现（PR #22） | — |
| [superpowers/plans/2026-09-06-p3-tab-model-nav-semantics.md](superpowers/plans/2026-09-06-p3-tab-model-nav-semantics.md) | 页签模型、入口语义 | 已实现（PR #22）；页签模型后被 TAB-BAR-SPEC 改写 | 页签部分 → [design/TAB-BAR-SPEC.md](design/TAB-BAR-SPEC.md) |
| [superpowers/plans/2026-09-07-r1-review-backend.md](superpowers/plans/2026-09-07-r1-review-backend.md) | 审核机制后端 | 已实现（PR #24，V124） | — |
| [superpowers/plans/2026-09-07-r2-review-frontend.md](superpowers/plans/2026-09-07-r2-review-frontend.md) | 审核机制前端 | 已实现（PR #25） | — |
| [superpowers/plans/2026-09-10-forecast-band-and-plain-sentence.md](superpowers/plans/2026-09-10-forecast-band-and-plain-sentence.md) | 预测带、一句话结论 | 已实现（PR #31） | — |
| [superpowers/plans/2026-09-11-design-boards.md](superpowers/plans/2026-09-11-design-boards.md) | 预测带三块板落地 | 已实现（PR #31） | — |
| [superpowers/plans/2026-09-13-pv-ana-v4.md](superpowers/plans/2026-09-13-pv-ana-v4.md) | 光伏分栋分析屏 v4 | 已实现（PR #36）；10-06 PR #69 又改过一轮 | — |
| [superpowers/plans/2026-09-18-tab-bar.md](superpowers/plans/2026-09-18-tab-bar.md) | 页签栏与顶栏 | 已实现（PR #43） | — |
| [superpowers/plans/2026-09-18-version-update.md](superpowers/plans/2026-09-18-version-update.md) | 版本更新板块 | 已实现（PR #41）；文中稿路径写「未实现/」，稿已挪到「已实现/」 | — |
| [superpowers/plans/2026-09-19-picker-kpi-dark.md](superpowers/plans/2026-09-19-picker-kpi-dark.md) | 日期选择器、KPI 卡、暗色 | 已实现（PR #47，0.15.0） | — |
| [superpowers/plans/2026-10-01-hint-widetable-bell-impl.md](superpowers/plans/2026-10-01-hint-widetable-bell-impl.md) | 提示、宽表、铃铛、三屏 | 已实现（PR #63、#65） | — |

## 4. 调研

| 文件 | 是什么 | 状态 | 被谁取代 |
|---|---|---|---|
| [research/2026-08-16-param-research/](research/2026-08-16-param-research/)（19 份：`acceptance_2023-08`、`code_engine_params`、`code_price_params`、`p1_2023-08`…`p1_2023-12`、`p1_synthesis`、`p2_2023-08`…`p2_2023-12`、`p2_synthesis`、`review_backend`、`review_frontend`、`review_wording`、`ux_research`） | S21 计费参数的逐月对账、代码盘点、评审 | 已实现·留档：S21 的证据 | — |
| [research/2026-09-03-sidebar-ux-research/](research/2026-09-03-sidebar-ux-research/)（4 份：`01-现状动线审计`、`02-同类产品调研`、`03-综合结论与机会`、`04-设计方案与待拍板`） | 侧栏动线审计、同类产品调研、拍板过程 | 已实现·留档：侧栏规范的上游 | — |
| [design/FORECAST-BAND-AND-PLAIN-SENTENCE-2026-09-06.md](design/FORECAST-BAND-AND-PLAIN-SENTENCE-2026-09-06.md) | 预测带能不能做、一句话结论 | 一次性：推荐的 ⓘ 浮层和未闭月护栏已被用户推翻（09-12），文首和每一处都已标「已推翻」；「月度外推不许写百分比」仍成立；附录的回测脚本已丢 | 推翻部分 → [DECISIONS.md](DECISIONS.md#分析屏) |
| [design/P1-UTILITY-FEE-STRUCTURE.md](design/P1-UTILITY-FEE-STRUCTURE.md) | 一期水电费真实组成逆向 | 已被取代（文首已注）：公摊部分以 BOOK-STRUCTURE 为准；价表数字仍可参考 | [design/BOOK-STRUCTURE-2024-02.md](design/BOOK-STRUCTURE-2024-02.md) |
| [design/P2-UTILITY-FEE-STRUCTURE.md](design/P2-UTILITY-FEE-STRUCTURE.md) | 二期水电费真实组成逆向 | 已被取代（文首已注）：价表数字仍可参考 | BOOK-STRUCTURE-2024-02 + P2-SHARE-LAYER-SPEC |
| [superpowers/specs/2026-08-29-pool-entry-coverage-audit.md](superpowers/specs/2026-08-29-pool-entry-coverage-audit.md) | 公摊池入口覆盖度调研 | 一次性：修复随 PR #16 | — |
| [superpowers/specs/2026-08-29-schedules-6-12-flow-redesign.md](superpowers/specs/2026-08-29-schedules-6-12-flow-redesign.md) | 附表 6–12 动线重设计调研 | 头注写「未实施，待拍板」，但 PR #15 合进了相关提交；实际落了哪几屏不确定 | — |

## 5. 审计与复盘

| 文件 | 是什么 | 状态 | 被谁取代 |
|---|---|---|---|
| [design/ANALYSIS-SCREEN-REVIEW-2026-09-05.md](design/ANALYSIS-SCREEN-REVIEW-2026-09-05.md) | 分析层 19 屏可视化审查（09-05 快照） | 一次性：推荐的「未闭月门」「ⓘ 口径浮层」已被用户推翻（09-12），文首和每一处都已标「已推翻」；类目色板一条仍成立、没做 | 后续 → 仓外「分析屏现状画布-2026-10-03」 |
| [design/MOBILE-390-AUDIT-2026-09-21.md](design/MOBILE-390-AUDIT-2026-09-21.md) | 390 宽全站体检 48 条 | 一次性：结论已并入 RESPONSIVE-LAYOUT v1.2（文首已注） | [design/RESPONSIVE-LAYOUT-SPEC.md](design/RESPONSIVE-LAYOUT-SPEC.md) |
| [design/POOL-FORMULA-AUDIT-2024-02.md](design/POOL-FORMULA-AUDIT-2024-02.md) | 2024-02 公共电核算公式审计 | 已被取代（文首已注）：BOOK-STRUCTURE §6.22–6.24 列了它的错；迁移 V61、V62、V97 和 `AllocServiceTest` 引着它，所以留在原处 | [design/BOOK-STRUCTURE-2024-02.md](design/BOOK-STRUCTURE-2024-02.md) |
| [../stage-review-2026-08-30.md](../stage-review-2026-08-30.md)（仓根） | 第一轮阶段验收报告（基线 5a29c06） | 已实现·留档 | — |
| [../stage-review-2026-08-31.md](../stage-review-2026-08-31.md)（仓根） | 第二轮阶段验收报告（基线 e943180） | 已实现·留档 | — |
| [../stage-review-2026-09-09.md](../stage-review-2026-09-09.md)（仓根） | 第三轮阶段验收报告（基线 6196c39） | 已实现·留档 | — |
| [../stage-review-2026-09-22.md](../stage-review-2026-09-22.md)（仓根） | 最新一轮验收报告 | 留档：A1 修改记录后来由 PR #68 做了；其余风险项全修没全修不确定 | — |

## 6. 历史留档

### docs/design 里做完或被取代的

| 文件 | 是什么 | 状态 | 被谁取代 |
|---|---|---|---|
| [design/BILL-FORWARD-SPEC.md](design/BILL-FORWARD-SPEC.md) | 合同定价正向派生催缴单的五步总纲 | 已实现·留档：数据底座 `contract_billing_term` 仍有效 | 第一步的页面呈现 → CONTRACT-CARD-SPEC（:62 有注） |
| [design/BOOK-REBUILD-SPEC.md](design/BOOK-REBUILD-SPEC.md) | 按原册重建一期公共电、倍率订正、批删 | 已实现（V79） | — |
| [design/BUILDING-RESTRUCTURE-SPEC.md](design/BUILDING-RESTRUCTURE-SPEC.md) | 8 个粗分楼栋拆成真实楼栋 | 已实现成一次性脚本（`frontend/src/tools/buildingRestructure.ts`）；各环境跑没跑过 apply 仓里没记录 | — |
| [design/IMPORT-IDENTITY-FIX-SPEC.md](design/IMPORT-IDENTITY-FIX-SPEC.md) | 位置有歧义时按企业名称认表 | 已实现（`MeterService.java`） | — |
| [design/LOC-MEMBER-FIXUP-SPEC.md](design/LOC-MEMBER-FIXUP-SPEC.md) | 抄表和受益人复核修正 10 条 | 已实现：E2（:48）「待复核」没见到结论 | — |
| [design/METER-LOC-MEMBER-SPEC.md](design/METER-LOC-MEMBER-SPEC.md) | 表位置结构化、受益人按楼层 | 已实现：归属列后来挪到 `meter_assign` | — |
| [design/P2-SHARE-LAYER-SPEC.md](design/P2-SHARE-LAYER-SPEC.md) | 二期公摊层对齐源册口径 | 已实现：:4 的依据数据已丢 | — |
| [design/PB-ALLOCATION-SPEC.md](design/PB-ALLOCATION-SPEC.md) | 公摊分摊与损耗（alloc 一族） | 已实现·留档：`AllocView` 已退役（文首已注） | 页面部分 → POOL-ENGINE-SPEC |
| [design/PERIOD-CONTEXT-HANDOFF.md](design/PERIOD-CONTEXT-HANDOFF.md) | 出账链分支和响应式分支的合并冲突交接 | 已实现（PR #15）：§2.2 的约定仍被 `PoolLedgerView` 引用 | — |
| [design/ROW-IDENTITY-SPEC.md](design/ROW-IDENTITY-SPEC.md) | 行身份回归原册 | 已实现·留档 | — |
| [design/S6-PREMISE-BY-METER-SPEC.md](design/S6-PREMISE-BY-METER-SPEC.md) | 表行的场地标签按表位置取 | 已实现·留档 | — |
| [design/ZS-IMPORT-LOC-SPEC.md](design/ZS-IMPORT-LOC-SPEC.md) | 招商中心归属、导入回写护栏 | 已实现（V77、V78） | — |
| [design/CONTRACT-CARD-V2-SPEC.md](design/CONTRACT-CARD-V2-SPEC.md) | 合同卡 v2：租金阶梯表 | 已被取代（文首已注）：阶梯模型被推翻；续签链显示部分仍有效；代码注释 7 个文件引它，所以留在原处 | CONTRACT-BILLING-REWORK-SPEC + CONTRACT-ESCALATION-SPLIT-SPEC |
| [design/METER-V4-SPEC.md](design/METER-V4-SPEC.md) | 抄表页 v4 三段式 | 已被取代（文首已注） | [design/METER-V5-SPEC.md](design/METER-V5-SPEC.md) |
| [design/PRICE-CFG-SPEC.md](design/PRICE-CFG-SPEC.md) | 价目簿与取价级联 | 已被取代：`/price-cfg` 已跳到 `/params`（文首有注） | [design/S21-PARAM-CENTER-SPEC.md](design/S21-PARAM-CENTER-SPEC.md) |
| [design/UTILITY-BILLING-SPEC.md](design/UTILITY-BILLING-SPEC.md) | 水电费自动派生的总纲草案 | 已被取代（文首已注）：各部分已分别落地 | S21（原 PRICE-CFG）、S2-BIND、POOL-ENGINE、S4-BILL-NOTICE |

### superpowers/specs 里做完或被取代的

| 文件 | 是什么 | 状态 | 被谁取代 |
|---|---|---|---|
| [superpowers/specs/2026-06-27-demo3-p0-design.md](superpowers/specs/2026-06-27-demo3-p0-design.md) | P0 地基、设计系统、外壳、试点 | 已实现·留档；头注还写「待用户复审」 | — |
| [superpowers/specs/2026-06-29-demo3-p1-ledger-design.md](superpowers/specs/2026-06-29-demo3-p1-ledger-design.md) | 月度台账子系统 | 已实现·留档；头注还写「草案」 | — |
| [superpowers/specs/2026-06-29-demo3-p1-pv-schedule6-design.md](superpowers/specs/2026-06-29-demo3-p1-pv-schedule6-design.md) | 附表6 光伏子系统 | 已实现·留档 | — |
| [superpowers/specs/2026-06-30-demo3-p1-data-home-design.md](superpowers/specs/2026-06-30-demo3-p1-data-home-design.md) | 数据中心首页 v1 | 已被取代（文首已注） | specs/2026-08-18-data-home-redesign-design.md（它后来也被取代） |
| [superpowers/specs/2026-06-30-demo3-p1-excel-import-pilot-design.md](superpowers/specs/2026-06-30-demo3-p1-excel-import-pilot-design.md) | 统一 Excel 导入引擎 | 已实现·留档 | — |
| [superpowers/specs/2026-06-30-demo3-p1-import-header-match-design.md](superpowers/specs/2026-06-30-demo3-p1-import-header-match-design.md) | 附表10 按表头匹配导入 | 已实现·留档 | — |
| [superpowers/specs/2026-06-30-demo3-p1-schedule10-sales-income-design.md](superpowers/specs/2026-06-30-demo3-p1-schedule10-sales-income-design.md) | 附表10 销售收入 | 已实现·留档 | — |
| [superpowers/specs/2026-07-01-demo3-import-rollout-pv-charging-elec-design.md](superpowers/specs/2026-07-01-demo3-import-rollout-pv-charging-elec-design.md) | 光伏、充电桩、电费导入 | 已实现·留档 | — |
| [superpowers/specs/2026-07-01-demo3-p1-import-center-hub-design.md](superpowers/specs/2026-07-01-demo3-p1-import-center-hub-design.md) | 导入中心 hub | 已实现·留档；界面已被 PR #74 重做（文首已注） | 界面 → specs/2026-10-10-import-center-modal-impl-design.md |
| [superpowers/specs/2026-07-01-demo3-p1-import-rollout-salary-utilities-design.md](superpowers/specs/2026-07-01-demo3-p1-import-rollout-salary-utilities-design.md) | 工资、办公水电导入 | 已实现·留档 | — |
| [superpowers/specs/2026-07-01-demo3-p1-import-smart-batch-saveconfirm-design.md](superpowers/specs/2026-07-01-demo3-p1-import-smart-batch-saveconfirm-design.md) | 附表10 智能导入、批删、保存确认 | 已实现·留档 | — |
| [superpowers/specs/2026-07-01-demo3-real-template-import-fix-design.md](superpowers/specs/2026-07-01-demo3-real-template-import-fix-design.md) | 真实模板导入修复 | 已实现·留档 | — |
| [superpowers/specs/2026-07-02-demo3-p2a-reports-foundation-income-statement-design.md](superpowers/specs/2026-07-02-demo3-p2a-reports-foundation-income-statement-design.md) | 报表基建、利润表 | 已实现·留档 | — |
| [superpowers/specs/2026-07-02-demo3-p2b-balance-sheet-design.md](superpowers/specs/2026-07-02-demo3-p2b-balance-sheet-design.md) | 资产负债表 | 已实现·留档 | — |
| [superpowers/specs/2026-07-02-demo3-p2c-trial-balance-design.md](superpowers/specs/2026-07-02-demo3-p2c-trial-balance-design.md) | 科目余额表 | 已实现·留档 | — |
| [superpowers/specs/2026-07-02-demo3-p2d-pnl-schedules-design.md](superpowers/specs/2026-07-02-demo3-p2d-pnl-schedules-design.md) | 损益附表 1–5 | 已实现·留档 | — |
| [superpowers/specs/2026-07-02-demo3-p2e-reconciliation-design.md](superpowers/specs/2026-07-02-demo3-p2e-reconciliation-design.md) | 收入核对 | 已实现·留档 | — |
| [superpowers/specs/2026-07-02-demo3-p2f-reports-home-design.md](superpowers/specs/2026-07-02-demo3-p2f-reports-home-design.md) | 报表中心 | 已实现·留档 | — |
| [superpowers/specs/2026-07-02-demo3-p2g-pnl-derive-design.md](superpowers/specs/2026-07-02-demo3-p2g-pnl-derive-design.md) | 损益附表派生链接 | 已实现·留档 | — |
| [superpowers/specs/2026-07-03-demo3-p2g2-derive-generate-design.md](superpowers/specs/2026-07-03-demo3-p2g2-derive-generate-design.md) | 派生生成账目结构 | 已实现·留档；头注还写「设计中」 | — |
| [superpowers/specs/2026-07-03-demo3-p2g3-report-edit-fixes-design.md](superpowers/specs/2026-07-03-demo3-p2g3-report-edit-fixes-design.md) | 派生行只读、报表编辑修补 | 已实现·留档 | — |
| [superpowers/specs/2026-07-06-demo3-ledger-import-v2-design.md](superpowers/specs/2026-07-06-demo3-ledger-import-v2-design.md) | 台账导入 v2/v3 | 已实现·留档 | — |
| [superpowers/specs/2026-07-07-demo3-budget-compare-design.md](superpowers/specs/2026-07-07-demo3-budget-compare-design.md) | 预算对比 | 已实现·留档 | — |
| [superpowers/specs/2026-07-07-demo3-p3-analysis-layer-design.md](superpowers/specs/2026-07-07-demo3-p3-analysis-layer-design.md) | 经营分析层 | 已实现·留档 | — |
| [superpowers/specs/2026-07-07-demo3-recon-jump-tab-state-design.md](superpowers/specs/2026-07-07-demo3-recon-jump-tab-state-design.md) | 核对深链、页签保持 | 已实现·留档 | — |
| [superpowers/specs/2026-07-08-demo3-analysis-v2-redesign.md](superpowers/specs/2026-07-08-demo3-analysis-v2-redesign.md) | 分析层 v2 重设计 | 已实现·留档 | — |
| [superpowers/specs/2026-07-09-demo3-import-500-hardening-design.md](superpowers/specs/2026-07-09-demo3-import-500-hardening-design.md) | 导入报 500 改成 400 | 已实现·留档 | — |
| [superpowers/specs/2026-07-09-demo3-s10-mgmtfee-alias-design.md](superpowers/specs/2026-07-09-demo3-s10-mgmtfee-alias-design.md) | 附表10 丢列修复 | 已实现·留档 | — |
| [superpowers/specs/2026-08-18-data-home-redesign-design.md](superpowers/specs/2026-08-18-data-home-redesign-design.md) | 数据中心首页重设计 | 已被取代（PR #22 首页改成「本月出账」；文首已注） | [specs/2026-09-03-sidebar-ux-redesign-design.md](superpowers/specs/2026-09-03-sidebar-ux-redesign-design.md) §5 |
| [superpowers/specs/2026-08-25-global-book-template-design.md](superpowers/specs/2026-08-25-global-book-template-design.md) | 账册模板全局一条链 | 已被取代（文首已注） | [specs/2026-08-26-per-month-template-pin-design.md](superpowers/specs/2026-08-26-per-month-template-pin-design.md) |
| [superpowers/specs/2026-08-28-period-context-redesign.md](superpowers/specs/2026-08-28-period-context-redesign.md) | 账期组级上下文动线 | 已实现（PR #15） | — |
| [superpowers/specs/2026-08-29-phase3-pool-opening-design.md](superpowers/specs/2026-08-29-phase3-pool-opening-design.md) | 三期公摊池开放规则 | 已实现（PR #16） | — |
| [superpowers/specs/2026-08-30-lock-dialogs-coverage-design.md](superpowers/specs/2026-08-30-lock-dialogs-coverage-design.md) | 失锁、接管弹窗 | 已实现（PR #20） | — |
| [superpowers/specs/2026-09-05-showcase-site-design.md](superpowers/specs/2026-09-05-showcase-site-design.md) | 产品展示站设计 v1.3 | 已被取代（文首已注）：站点已独立成仓（PR #52） | 宣传页仓的 `docs/DESIGN.md`（v1.4，在 `../../产品宣传页/`） |
| [superpowers/specs/2026-10-01-hint-widetable-bell-impl-design.md](superpowers/specs/2026-10-01-hint-widetable-bell-impl-design.md) | 提示、宽表、铃铛的实现规范 | 已实现（PR #63、#65） | — |
| [superpowers/specs/2026-10-03-elev-reports-params-import-impl-design.md](superpowers/specs/2026-10-03-elev-reports-params-import-impl-design.md) | 授权按钮、三大报表、计费参数、导入进度的实现规范 | 已实现（PR #64 → #65，0.26.0） | — |

### 品牌和修数备份

| 文件 | 是什么 | 状态 | 被谁取代 |
|---|---|---|---|
| [brand/DESIGN-PHILOSOPHY.md](brand/DESIGN-PHILOSOPHY.md) | logo 概念稿的美术说明 | 留档：不是界面规则，名字容易误会 | 正式标志在 `frontend/src/assets/brand/logo.svg` |
| [brand/linksight-logo-concepts.png](brand/linksight-logo-concepts.png) | logo 概念稿第一版（图） | 留档 | 同上 |
| [brand/linksight-logo-concepts.src.html](brand/linksight-logo-concepts.src.html) | logo 概念稿第一版（源） | 留档 | 同上 |
| [brand/linksight-logo-concepts-v2.png](brand/linksight-logo-concepts-v2.png) | logo 概念稿第二版（图） | 留档 | 同上 |
| [brand/linksight-logo-concepts-v2.src.html](brand/linksight-logo-concepts-v2.src.html) | logo 概念稿第二版（源） | 留档 | 同上 |
| [data-fix/book_template_before_global_20260825.sql](data-fix/book_template_before_global_20260825.sql) | 08-25 一次性修数的留档 | 一次性；去留待用户定（见 [../../README.md](../../README.md)） | — |
| [data-fix/monthly_ledger_before_prevfix_20260825.sql](data-fix/monthly_ledger_before_prevfix_20260825.sql) | 08-25 一次性修数的留档 | 一次性；去留待用户定 | — |
| [data-fix/prevfix_20260825.sql](data-fix/prevfix_20260825.sql) | 订正上期余额的一次性 UPDATE | 一次性；别重跑 | — |

---

## 规格引用了、但不在本仓的东西

| 东西 | 在哪 |
|---|---|
| 设计稿、画布 | [../../运维文档/设计稿/README.md](../../运维文档/设计稿/README.md) |
| 分析屏版式与文字规范 45 条（10-05 定稿） | [../../运维文档/设计稿/未实现/分析屏现状画布-2026-10-03/版式与文字规范/](../../运维文档/设计稿/未实现/分析屏现状画布-2026-10-03/版式与文字规范/分析屏版式与文字规范-2026-10-04.md) |
| 动效规范 v2 工作副本 | `../../运维文档/设计稿/未实现/全站动效-2026-09-05/MOTION-DESIGN-SPEC-v2工作副本.md` |
| 设计系统 skill | `../../.claude/skills/factory-park-design/`（见 [../AGENTS.md §8](../AGENTS.md#8-设计系统在哪)） |
| 对账报告、线上修数记录 | `../../运维文档/对账/` |
