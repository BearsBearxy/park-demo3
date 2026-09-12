# demo3 · P0 设计 — 地基 + 设计系统 + 应用外壳 + 楼栋/租户试点

- **状态**：已批准（待用户复审 spec）
- **日期**：2026-06-27
- **作者**：Claude（brainstorming）
- **项目**：厂房园区管理系统 demo3（全新从零搭，**不复用 Demo2**）

---

## 0. 背景与目标

厂房园区管理系统：工业园区（一期/二期/三期厂房 + 宿舍）日常运营数据管理。Spring Boot + Vue 3 前后端分离 Web 应用，浏览器全屏运行。前端**完全按设计稿还原**（事实源 = `园区管理系统 (单文件离线版).html` 及其分散文件 `_handoff_extracted/.../app/*.jsx`，设计系统 = `Factory Park Design System/`，经营分析层规范 = `design_handoff_analysis_shell/`）。后端达工程化水平。

**核心域**：楼栋 / 租户 / 合同 / 账单的增删改查，月度台账、利润表、资产负债表的批量录入与 Excel 导入。多管理公司收费模型——**每家管理公司各自维护一份结构相同、互相独立的台账与三大报表；公司与费用类别无固定绑定，按实际收款录入；「全部汇总」= 跨公司求和**（证据：`app/screen-ledger.jsx`、`app/fin-common.jsx`）。

整个系统按**地基优先**分 5 期（P0→P4），每期独立 spec→plan→实现。本 spec 仅覆盖 **P0**。

### 分期路线（上下文）

| 期 | 内容 |
|---|---|
| **P0（本 spec）** | 工程化地基 + 设计系统核心组件移植 + 应用外壳 + 楼栋/租户全栈试点 |
| P1 | 数据中心：合同/单元/总览 + 附表数据子系统（充电桩/水电/公用/销售）CRUD + Excel 导入 + 聚合 KPI |
| P2 | 账簿与报表：多公司月度台账 + 利润表/资产负债表/科目余额表/试算（公司实例 + 公式引擎）+ 损益附表 + 勾稽 + 导入中心 |
| P3 | 经营分析：14 分析屏 + `design_handoff_analysis_shell` 共享工具条（期间/筛选/对比/阈值/口径/导出 + provide/inject）+ 聚合分析接口 |
| P4 | 安全/监控/部署收尾：安全响应头/登录防爆破/完整可观测/CI-CD/部署文档 |

---

## 1. 锁定决策（Decision Log）

| # | 决策 | 取舍 |
|---|---|---|
| D1 | demo3 全新从零搭，**不复用 Demo2**；Demo2 仅作业务参考 | 用户明确 |
| D2 | 前端 UI 层 = **手搭原生 Vue 3 DS 组件**（1:1 移植 Factory Park DS），Reka UI 仅作 popover/dialog headless 底座，**不引重型组件库** | 杜绝 Demo2 的 Element Plus 叠加式漂移 |
| D3 | 数据库 = **MySQL 8**；迁移 = Flyway | 生态成熟、贴近既有数据 |
| D4 | 前端语言 = **TypeScript** | 工程化标配，DS 已带 .d.ts |
| D5 | 分期 = **地基优先 P0→P4** | `design_handoff_analysis_shell` 依赖底层，落在 P3 |
| D6 | P0 试点纵切 = **楼栋 + 租户** | 中等复杂度，充分压测 DS，不碰财务公式 |
| D7 | **contract 表纳入 P0**（只读派生聚合），合同管理屏 → P1 | 楼栋/租户的租金/占用/在租面积全部由合同派生，无合同表则试点不真实 |
| D8 | 后端 ORM = **MyBatis-Plus** | 数据密集/财务宽表/批量导入/聚合 SQL 比 JPA 更顺 |
| D9 | 鉴权 = **Spring Security + JWT 单用户基线，无 RBAC** | 设计稿无登录页，登录为工程增项 |

---

## 2. 技术栈

**前端**：Vue 3 `<script setup>` · TypeScript · Vite · Vue Router（三层导航）· Pinia（公司/期间/筛选/会话共享态）· axios（JWT 拦截 + 统一返回解包）· **手搭 Factory Park DS 组件** · Reka UI（headless）· 纯 SVG 图表（P1 起，不引 ECharts）· SheetJS + Web Worker（Excel 导入，P1 起）· lucide-vue-next · 自托管 Inter + Roboto Mono · Vitest + Vue Test Utils + Playwright · ESLint + Prettier。

**后端**：Java 17 · Spring Boot 3 · Spring MVC REST · MyBatis-Plus · Flyway · Spring Security + JWT · Jakarta Validation · MapStruct · springdoc-openapi · Actuator + Micrometer · logback-JSON + TraceId(MDC) · JUnit5 + Mockito + Testcontainers · Maven。

**工程化/部署**：Docker Compose（nginx 前端 + 后端 + MySQL）· GitHub Actions CI · 分环境配置 + 密钥外置 · CLAUDE.md · spec 规范 · ponytail 代码优化。

---

## 3. 仓库结构

demo3 为**独立 git 仓库**（`C:\financial_dashboard\demo3\`，避开外层壳仓库）。

```
demo3/
├─ backend/
│  ├─ src/main/java/com/park/demo3/
│  │  ├─ common/         Result, ResultCode, 异常, ResponseBodyAdvice, TraceIdFilter
│  │  ├─ config/         MyBatisPlus, OpenAPI, Cors, Security 配置
│  │  ├─ security/       JWT 过滤器/工具, UserDetails
│  │  ├─ controller/     building/unit/tenant/contract/auth
│  │  ├─ service/        @Service 单实现（不抽接口）
│  │  ├─ mapper/         MyBatis-Plus Mapper + XML（复杂聚合）
│  │  ├─ entity/         表映射
│  │  └─ dto/            请求/响应 DTO（MapStruct 映射）
│  │  └─ src/main/resources/
│  │     ├─ application.yml + application-{dev,prod}.yml
│  │     ├─ db/migration/ V1__schema.sql, V2__seed.sql
│  │     └─ mapper/*.xml
│  └─ src/test/java/...  单测 + Testcontainers IT
│  └─ pom.xml
├─ frontend/
│  ├─ src/
│  │  ├─ main.ts, App.vue
│  │  ├─ router/         三层路由 + 守卫
│  │  ├─ stores/         Pinia: auth, ui(tabs/sidebar), 共享态
│  │  ├─ api/            axios 实例 + 拦截器 + 各模块 api
│  │  ├─ nav/            fpNav.ts（39 屏单一事实源）
│  │  ├─ styles/         tokens.css, base.css, scrollbar.css
│  │  ├─ components/ds/  手搭 DS 组件（见 §6）
│  │  ├─ components/shell/  IconRail, SidebarPanel, TabStrip, Toolbar, CommandPalette
│  │  └─ views/          LoginView, buildings/, tenants/, PlaceholderView
│  ├─ index.html, vite.config.ts, tsconfig.json
│  └─ package.json
├─ docs/superpowers/specs/   本 spec
├─ docker-compose.yml, .env.example, CLAUDE.md, .gitignore
└─ .github/workflows/ci.yml
```

---

## 4. 后端工程化骨架

分层：`controller → service → mapper(MyBatis-Plus) → entity`，外加 `dto / common / config / security`。横切关注点一次到位：

| 关注点 | 落地 | 对应工程要求 |
|---|---|---|
| 统一返回 | `Result<T>{code,message,data,traceId}` + `ResultCode` 枚举 + `ResponseBodyAdvice` 自动包裹（白名单排除 actuator/openapi） | 错误统一 |
| 全局异常 | `@RestControllerAdvice`：`BizException`→业务码；`MethodArgumentNotValidException`/`ConstraintViolation`→400；兜底→500，统一日志带 traceId | 错误统一 |
| 输入校验 | Jakarta Validation：DTO `@Valid` + `@NotNull/@Size/@Pattern`；`@RequestParam` 用 `@Validated` 类级 | 输入校验 |
| 安全 | Spring Security 过滤链：`/api/auth/login` 放行，`/api/**` 需 Bearer JWT；BCrypt 口令；JWT 密钥从环境读、缺失 fail-fast；CORS 独立配置 | 安全可靠 |
| 日志 | logback JSON encoder；`TraceIdFilter` 注入 MDC `traceId`；访问日志 + 慢请求(>Nms)日志；**敏感字段（password/token）不落日志** | 日志完整 |
| DTO 映射 | MapStruct 编译期映射 entity↔DTO，**杜绝裸 Map 返回** | 命名规范/类型化契约 |
| 配置 | `application-{dev,prod}.yml`，密钥/连接串走环境变量 + `.env`（gitignore），`.env.example` 留样例 | 配置独立 |
| API 文档 | springdoc-openapi，controller `@Tag`、方法 `@Operation`，Swagger UI `/swagger-ui.html` | 文档清楚 |
| 监控 | Actuator `health/info/metrics/prometheus`；Micrometer；health `show-details: always`（无 RBAC 时 when-authorized 永判未授权——Demo2 教训） | 可监控 |
| 迁移 | Flyway：`V1__schema.sql`（建表）、`V2__seed.sql`（确定性种子）；全新库干净，无 baseline 坑 | 可部署 |
| 测试 | JUnit5 + Mockito 单测；Testcontainers(MySQL) 集成测试；service 层覆盖派生口径 | 测试覆盖 |

试点全栈纵切：`building / unit / tenant / tenant_category / contract / auth_user` 各自 entity→mapper→service→DTO→controller→OpenAPI 注解→测试。

### 端点（P0）

```
POST /api/auth/login                 → {token, displayName}
GET  /api/buildings                  → 楼栋列表（含派生聚合：occRate/unitCount/occupiedCount/monthlyRent/tenantIds…）
GET  /api/buildings/{id}             → 楼栋详情（含 units + 在租租户派生）
GET  /api/buildings/summary          → 4 KPI（buildingCount/rentableArea/occRate/vacantCount）
GET  /api/tenants                    → 租户列表（含派生：_monthly/_area/_primary/_ccount/status）
GET  /api/tenants/{id}               → 租户详情（含合同历史派生）
GET  /api/tenants/summary            → 4 KPI（tenantActive/occRate/monthlyRent/expiringTenants）
GET  /api/tenant-categories          → 分类下拉
```

派生聚合在 **service 层 / Mapper XML 的 JOIN+GROUP BY** 实现，**绝不落计算列**。

---

## 5. 数据库 Schema（P0，6 表 + 1 分类表 = 7 表）

事实源 = `app/master-data.js`（`window.FP_MD`，注释声明"字段严格对齐真实后端 BuildingView/TenantView/ContractView"）。`datacenter-data.js` 是较松的演示变体，冲突以 master-data.js 为准。

**铁律：派生值绝不落列**（出租率/在租面积/月租金/占用状态/单元数全部 JOIN+GROUP BY 实时算）。

所有表 `ENGINE=InnoDB CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`，含 `created_at/updated_at`。

### `building` 楼栋
`id` PK · `name` VARCHAR(64) UNIQUE · `phase` TINYINT(1一期 2二期 3三期 4宿舍) · `floor_count` TINYINT · `total_area` DECIMAL(10,2) · `rentable_area` DECIMAL(10,2)（出租率分母）· `status` TINYINT(1正常 0停用) · `perFloor` TINYINT（单元生成输入）· `remark` VARCHAR(255) NULL。索引：UNIQUE(name)/INDEX(phase)/INDEX(status)。
> `kind`(厂房/宿舍) 由 phase 派生不存列。

### `unit` 单元
`id` PK · `building_id` FK→building ON DELETE CASCADE · `floor` TINYINT · `unit_no` VARCHAR(16) · `area` DECIMAL(10,2)。索引：UNIQUE(building_id, unit_no)/INDEX(building_id, floor)。
> **不存** `status`/`tenant_id`/`contract_id`——占用状态(occupied/expiring/reserved/vacant)由合同派生，避免第二事实源。

### `tenant` 租户
`id` PK · `company_name` VARCHAR(128) · `contact_name` VARCHAR(32) NULL · `contact_phone` VARCHAR(32) NULL · `business_type` VARCHAR(32)（行业枚举）· `status` TINYINT(1在租 2退租 0黑名单) · `category_id` FK→tenant_category ON DELETE SET NULL · `phase` TINYINT NULL（主期数，供 Tab 筛选）· `since` CHAR(7)（"2020-05"）· `remark` VARCHAR(255) NULL。索引：INDEX(status)/INDEX(category_id)/INDEX(business_type)/INDEX(company_name)。
> 行业枚举：智能制造/精密机械/电子信息/生物医药/新材料/仓储物流/包装印刷/光电/纺织/食品/配套服务。`industryTone`(徽标色) 为前端配置，不存。
> **area/rent/building/contractNo 不是租户列**，由合同派生。

### `tenant_category` 租户分类/资管方
`id` PK · `name` VARCHAR(32) UNIQUE。种子：园区直管/华盛资管/三期招商公司。

### `contract` 合同（P0 有表+种子+只读派生，无 CRUD 屏）
`id` PK · `contract_no` VARCHAR(32) UNIQUE · `tenant_id` FK · `building_id` FK · `unit_id` FK NULL（或 floor_info 关联）· `rent_area` DECIMAL(10,2) · `monthly_rent` DECIMAL(12,2) · `deposit` DECIMAL(12,2) · `start_date` DATE · `end_date` DATE · `sign_date` DATE NULL · `status` VARCHAR(16)(active|expiring|draft|expired|terminated) · `remark` VARCHAR(255) NULL。索引：INDEX(tenant_id)/INDEX(building_id)/INDEX(status)。
> `monthly_rent` 种子按 `area * UNIT_PRICE[phase]`，`UNIT_PRICE={1:32,2:35,3:30,4:18}` 元/㎡/月。

### `auth_user` 认证用户
`id` PK · `username` VARCHAR(64) UNIQUE · `password_hash` VARCHAR(255)（BCrypt）· `display_name` VARCHAR(64) · `status` TINYINT(1启用 0禁用)。
> 跳过 roles/email/last_login——RBAC 等真需要再加（ponytail）。

### 关系
`building 1—* unit`（硬 FK）· `tenant *—1 tenant_category` · `contract *—1 tenant` / `*—1 building` / `*—0..1 unit`。租户↔楼栋/期数**经合同**派生，非直接 FK。

### STORED vs DERIVED
**派生（绝不落列，service/SQL 实时算）**：occRate、leasedArea、occupiedCount/vacantCount/expiringCount/reservedCount、unitCount、monthlyRent（楼栋/租户/园区）、tenantIds/avatars、tenant 所在楼栋/合同数、unit 占用状态、kind/phaseName、`FP-T-{1000+id}` 编码、各 KPI 汇总。

### 种子（V2）
按 master-data.js 生成口径写**确定性种子**（无 `Math.random`，用稳定算法），诚实标 `source=seed`。真数据后续经导入替换。auth_user 种子：`admin` / BCrypt(`admin123`)（dev）。

---

## 6. 前端骨架 + 设计系统移植

### 6.1 令牌
`styles/tokens.css` 落**全套设计令牌**（事实源 `Factory Park Design System/tokens/*.css` + `styles.css`，已抽取）：

- 墨阶 `--ink-900..050`（`rgb(28,28,28)` + 透明度档）；面 `--surface-{page,card,sunken,overlay,white}`；蓝族 accent `--accent-{slate,sky,blue,cyan}`
- 语义 hue（oklch，降饱和）`--hue-{blue,cyan,orange,red}`；图表填充 `--fill-{slate,blue,cyan,sky}`；delta up=blue / down=red
- 语义别名 `--text-*/--bg-*/--border-*/--status-*/--control-*`
- 圆角 `--radius-{xs4,sm8,md12,lg16,xl20,2xl24,full999}`；阴影 `--shadow-{xs,sm,md,pop,pill}`；间距 8pt（`--space-1..16`，跳号）
- 字体 `--font-sans`(Inter+苹方回退)/`--font-mono`(Roboto Mono)；字号 `--fs-{display28,h1-24,h2-20,h3-16,body14,label12,micro11}`；字重/行高/字距；type 角色简写
- 动效 `--ease-standard/out`、`--dur-{fast120,base200,slow320}`；滚动条令牌

**禁紫禁绿**：lint 规则禁止引入 purple/green 色值。

### 6.2 P0 移植组件（~16 个 DS 原语，叶子优先序）
1:1 还原 props/变体/尺寸/token（事实源 `Factory Park Design System/components/**` 的 `.jsx` + `.d.ts`）。最终精确集在 plan 阶段对照源码定稿（按"试点两屏 + 外壳实际用到"为准，不多搭）。

**叶子**：FitText（DOM 测量自适应缩放）· Badge · Checkbox · Avatar（名→charCode%6 取色）· IconButton · SearchField · Popover（outside-click+Esc）· Button（4变体×3尺寸，hover 色硬编码保留）· Card · Select（自定义下拉，两屏状态筛选用）。
**组合**：KpiCard（依赖 FitText）· StatusBadge（依赖 Badge，12 态中文映射）· DataTable（分隔线无单元格框，选择三态，自定义单元）· Pagination · Segmented（楼栋卡片墙/台账列表切换）· SidebarNav（分组+无限级目录+展开/折叠两态+活动 accent bar）。

**P0 app 级复合组件**（建在 DS 原语之上，随试点两屏一并落，置于 `views/components/`）：FPDrawer（右滑抽屉，Teleport body）· FPUnitMap（楼层单元堆叠图）· FPStat（抽屉统计小块）· FPPhaseTabs（期数药丸 Tab+计数）· FPSortableTable（包 DataTable，表头 Popover 三态排序）· FPPager（包 Pagination，客户端 pageSize 8）· FPSectionLabel · FPContractStatus / FPTenantStatus（状态徽标）。

**移植要点**：JS hover→保留或 CSS:hover（Button 硬编码色保留）；outside-click/Esc→`onMounted/onUnmounted`；DOM 测量(FitText)→`onMounted/nextTick`+`ResizeObserver`；controlled/uncontrolled 契约 1:1。

**延后 P1**：BarChart/LineChart/DonutChart/ChartTooltip（图表）、Tabs（明细页下划线 Tab）、Input（表单录入）、FilterBar（台账批量操作工具栏，两屏用自定义搜索行）、AvatarGroup、Tooltip、DataGrid（分组表头+合计，台账用）。

---

## 7. 应用外壳（全屏两浮卡）

事实源 `app/shell.jsx` + `app/app.jsx`。

### 7.1 导航单一事实源 `fpNav.ts`
`FP_NAV` 3 层 × 共 **39 项**，驱动外壳渲染 + 路由 + 命令面板。**全部路由**，非 P0 屏 → `PlaceholderView`。结构（节选关键）：
- **L1 数据中心**（icon database，home `data-home`）：data-home · [主数据] buildings/tenants/contracts · [业务流水] ledger/bills/bank-flow · [成本收入录入] 附表6-8/10-12/utilities · import
- **L2 账簿与报表**（icon book-marked，home `reports-home`）：reports-home · [三大报表] income-statement/balance-sheet/trial-balance · [损益附表] 附表1-5 · reconciliation
- **L3 经营分析**（icon pie-chart，home `cockpit`）：cockpit · [园区维度] park/park-energy · [租户维度] tenant-energy/tenant-portfolio · [管理公司维度] fin-pnl/fin-balance/fin-cashflow · [专题] churn/expiry/breakeven/pnl-analysis/pv-roi · [监控] anomaly

`kind:"ana"` 项统一路由到 AnalysisShell（P3）；其余按 kind 分派。

### 7.2 布局（像素谱）
viewport 撑满 `padding:12 gap:12`，两张 `radius-2xl(24)` 发丝边浮卡：
- **导航卡**（flex row）：IconRail（**66px**，`surface-sunken`，logo 40×40/r13 + 每层 rail-btn 48px，active=ink-900 底白字）+ 竖分隔（仅 panelOpen）+ SidebarPanel（**234px**，层标题 16 + SidebarNav）。
- **主卡**（column）：TabStrip（**44px**，浏览器风页签：单击预览/双击或钉住/可关闭 + 溢出下拉 + 新建）→ Toolbar（**48px**，`surface-overlay`+blur8：折叠侧栏/收藏 + 面包屑 + 搜索按钮 Ctrl-K + 主题/历史/通知）→ content（`flex:1 overflow-auto scrollbar-gutter:stable padding:24`）。
- **命令面板**（Ctrl-K/Cmd-K）：CommandPalette，backdrop blur，`min(620,92vw)`，空查询显最近+分层，输入过滤，↑↓/Enter/Esc。
- 状态持久化 localStorage：`fp-app-nav/tabs/preview/recent/sb`。

### 7.3 登录（工程增项）
设计无登录页。LoginView 包在外壳外，路由守卫拦截未登录→`/login`，axios 请求注入 Bearer，401→跳登录。

---

## 8. 试点两屏（完全按设计）

事实源 `app/screen-buildings.jsx`、`app/screen-tenants.jsx`、`app/fp-master-ui.jsx`、`app/fp-table-sort.jsx`、`app/fp-pager.jsx`、`app/master-data.js`。容器 `flex column gap:20 max-width:1200 居中`。

### 8.1 楼栋管理
- **页头**：h2 楼栋管理 + 副标题`园区楼栋资产与空间台账 · 主数据 · 共 N 栋 / M 单元` + 导入(outline)/新增楼栋(filled)。
- **4 KPI**（auto-fit minmax(204,1fr) gap16）：楼栋总数（停用数 delta）· 可租面积（万㎡）· 园区出租率（%）· 空置单元。
- **期数 Tab + 视图切换**：FPPhaseTabs[全部/一期/二期/三期/宿舍带计数] + Segmented[卡片墙/台账列表]（持久化 `fp-bd-layout`）。
- **工具条**：搜索(name includes) + 状态 Select[全部/正常/停用] + 右`共 N 栋`。
- **卡片墙**（auto-fill minmax(296,1fr)）：BuildingCard——可租面积/在租·空置/月租金 fpWan/头像栈(tenantIds max4+溢出)/即将到期徽标；整卡可点 hover 抬升。
- **台账列表**：Card(white,pad0) 包 FPSortableTable 9 列（name/期/层数/单元 occ-cnt/总面积/可租面积/出租率 BdOccBar/月租金/状态），默认排序 occRate desc。
- **分页**：FPPager pageSize 8，筛选/排序/视图变更复位第 1 页。
- **抽屉**（FPDrawer 640）：6 FPStat（出租率含 leasedArea/rentableArea、在租单元 occ/total、月租金、总面积、可租面积、即将到期）+ FPUnitMap（楼层降序堆叠，占用色：occupied slate/expiring orange+钟/reserved cyan 虚边/vacant 透明虚边，选中 ink 描边）+ 选中单元详情（租户头像/企业/行业/合同号/月租/状态 或 空置引导）+ 在租租户 list + 备注。
- **出租率口径**：面积制 leasedArea(occupied+expiring+reserved 面积)/rentableArea，封顶 100，停用记 0。

### 8.2 租户管理
- **页头**：h2 租户管理 + 副标题`在租租户档案 · 主数据 · 共 N 户` + 导入/新增租户。
- **4 聚合 KPI**：在租租户(status=1 计数,slate) · 园区出租率(sky) · 月租金合计(fpWan,blue) · 合同将到期(expiring 合同 distinct 租户数,cyan,trend down)。
- **筛选**：FPPhaseTabs[全部/一期/二期/三期/宿舍计数] + 搜索(企业/联系人/电话 includes) + 状态 Select[全部/在租/已退租/黑名单]。
- **表格**：Card(white,pad0) 包 FPSortableTable 8 列：企业名称(Avatar 30+名+FP-T 子号)/联系人/联系电话(mono)/经营类型(Badge industryTone subtle)/所在楼栋(派生 primaryUnit)/月租金(派生 fpMoney 右 mono)/合同(派生 contractCount)/状态(FPTenantStatus)。表头 Popover **三态排序**（升序/降序/取消，活动列蓝指示）；客户端 pageSize 8（filter→sort 全集→slice），phase/q/status/sort 变更复位第 1 页。
- **抽屉**（FPDrawer 620）：联系网格 2×2（联系人/电话 mono/所属分类/主要单元）+ 3 FPStat（月租金/在租面积/当前合同 累计份数）+ 合同历史（按 startDate desc，合同号 mono + FPContractStatus + 楼栋楼层 + 起止 + 月租）+ 备注。
- **头像色板**：`[fill-blue,fill-slate,hue-cyan,brand-accent,brand-deep,fill-cyan]`，index=`name.charCodeAt(0)%6`（**禁紫禁绿**）。

> 复现注意：tenants 默认排序 key 在源里是 `monthly`（与列 key `_monthly` 不匹配，初次实为未排序）——按设计原样复现，或修正为 `_monthly`（实现时确认，倾向修正并注释）。

---

## 9. 工程规范

### CLAUDE.md（demo3 根，内容要点）
- 分层/命名/统一返回 `Result<T>`/全局异常/输入校验/安全(JWT,密钥外置)/日志(traceId,敏感字段不落)/配置分环境/测试(Testcontainers)/文档(OpenAPI)/部署(compose)/监控(actuator) 逐条约束。
- 前端：**禁紫禁绿**（lint）；**字号自适应**（变长内容用 FitText/fitFontSize，禁折行/挤压）；DS 组件 1:1 还原 token，不叠加库默认外观。
- **ponytail 代码纪律**：派生值不落列、不造无源表、单实现不抽接口、stdlib/原生优先、最短可用 diff、非平凡逻辑留一个可跑自检、`ponytail:` 注释标简化与升级路径。
- commit 规范：feature 分支、信息结尾署名 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

### spec 规范
设计落 `docs/superpowers/specs/`，实现计划落 `docs/superpowers/plans/`，每期 spec→plan→实现。

---

## 10. 测试与验证 / DoD

- 后端 `mvn test`：service 派生口径单测 + Testcontainers(MySQL) IT 冒烟。
- 前端 `vitest`（FitText/排序/分页/派生计算）+ `playwright`（外壳交互/两屏渲染）。
- **像素核对**：`docker compose up` 后用 Claude_Preview `preview_eval` 读 `getComputedStyle` 逐项核对（截图对本类应用易超时——Demo2 教训）；测量前 `preview_resize` 到桌面宽（如 1440×900）。

**Definition of Done（P0）**：
- [ ] `docker compose up` 起 nginx+后端+mysql，Flyway 建表+种子成功。
- [ ] 登录 admin/admin123 进入外壳；39 屏可导航，非 P0 屏显占位。
- [ ] 外壳两浮卡布局与离线 HTML 像素一致（rail66/sidebar234/tabstrip44/toolbar48/r24/padding12gap12）；Ctrl-K 命令面板可用。
- [ ] 楼栋屏：4 KPI 真值、卡片墙/台账双视图、期数 Tab、抽屉单元图与在租租户、出租率面积口径正确。
- [ ] 租户屏：4 聚合 KPI、三态排序、客户端分页、抽屉合同历史，派生列(月租/所在楼栋/合同数)由合同算出。
- [ ] 0 console error；DS 令牌禁紫禁绿；`mvn test` + `npm run build` 绿。

---

## 11. 部署 / CI

- `docker-compose.yml`：mysql(健康检查) + backend(依赖 db 健康) + frontend(nginx 静态 + `/api` 反代)。环境变量注入，`.env.example` 留样例。
- `.github/workflows/ci.yml`：后端 `mvn -B verify`、前端 `npm ci && npm run build && npm run test`。

---

## 12. 采用的默认口径（先亮假设，可改）

1. 采用 master-data.js（FP_MD）模型与数字枚举状态，弃 datacenter-data.js 字符串态。
2. 出租率 = leasedArea(occupied+expiring+reserved 面积)/rentable_area，封顶 100，停用楼栋 0。
3. `building.kind` 由 phase 派生不存列。
4. `tenant.phase` 存"主期数"供 Tab 筛选（合同可跨期）。
5. `since` 存 CHAR(7) 年月。
6. contract 表纳入 P0（只读派生），合同 CRUD 屏 → P1。
7. P0 用确定性种子充数据，诚实标 source，真数据后续导入替换。

### 待用户后续拍板（不阻塞 P0，用上述默认推进）
- 出租率是否计入"待入驻/reserved"面积（当前默认计入）。
- 出租率分母 rentable_area vs total_area（当前默认 rentable）。
- `building.kind` 是否恒为 phase 的严格函数（若某期混厂房+宿舍则需存列）。
- 空置单元是否会以"伪租户行"出现（当前默认否，空置属 unit）。

---

## 13. 设计源参照（持久路径）

- ~~像素事实源（打包态）：`C:\financial_dashboard\园区管理系统 (单文件离线版).html`~~ —— **2026-09-13 判为废案并删除。** 那批像素里今天仍然管用的几条见 `demo3/docs/design/PAGE-BEHAVIOR-SPEC.md` §4；其余以现网 `.vue` 实现为准（skill `SKILL.md:15-16`「实现即标准」）。
- 分散源（React 原型）：`C:\financial_dashboard\_handoff_extracted\untitled\project\app\*.jsx`（shell/app/screen-buildings/screen-tenants/fp-master-ui/fp-table-sort/fp-pager/master-data.js）
- 设计系统：**改以 skill 形态存在**，名字 `factory-park-design`，真身在 `.claude/skills/factory-park-design/`（全局 `~/.claude/skills/` 下同名软链指向它）。原先那个同名目录与 `Factory Park Design System.zip` 均已于 2026-09-13 删除 —— **按 skill 名引用，不要写路径。**
- ~~经营分析层规范（P3）：`C:\financial_dashboard\design_handoff_analysis_shell\`~~ —— **2026-09-13 删除。** 那份 README 是已执行完的施工单，落地物是 `frontend/src/views/analysis/AnaShell.vue` 的 `anx-*` 工具条；`reference/screen-analysis.jsx` 与 `_handoff_extracted` 里那份逐字节重复。
