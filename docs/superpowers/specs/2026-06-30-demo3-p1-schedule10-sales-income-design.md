# demo3 P1 附表10 销售收入 子系统 — 设计规范

- 状态：已批准（2026-06-30 brainstorming），待用户复审
- 事实源：`_handoff_extracted/untitled/project/app/screen-schedule10.jsx` + `schedule10-data.js`
- 复用脚手架：`frontend/src/components/sched/`（SchedYearGate/SchedHeader/SchedMonthPills/SchedNoteCell/tints）
- 镜像范式：附表13/14 办公水电（OfficeService/OfficeController/UtilitiesView 同构）

## 1. 目标与范围

附表10「销售收入」= 独立录入类附表，与月度台账**并行**。同一笔租户交款，**月度台账按管理公司**聚合、**附表10 按期区（1/2/3 期 + 宿舍）**聚合。两套各自人手录入，作用是在报表层**逐租户配平（对账）**——做账错（多记/漏记一户、金额不符）就配不平。

**本期范围 = 附表10 录入屏全栈**（迁移+种子+service+controller+View/Table/Drawer），与已建的附表 6/7/8/11/12/13/14 同构。

**本期明确不做（OUT）**：
- 配平/对账页（属报表层 P2；且需先有附表10 数据才能比）
- Excel 导入落地（前端留占位入口，同其他附表）
- 附表10 ↔ 台账任何自动同步/派生（二者数据上无关联，是独立两本账）

## 2. 全局约束 + 取舍

- 仅 JWT 保护、`Result<T>` 封装、`com.park.demo3` 包。
- **行不强绑 FK**：`s10_record` 存 `tenant_name`（自由文本）+ `tenant_id`（可空软引用）。理由：两本账人手分记、可能"一本多一户/一本漏一户/名字对不上"，硬 FK 会让这种差异无法表达、配平无从抓起。种子按真实租户填基线（`tenant_id` 已填→可配平），手动新增/导入的行允许 `tenant_id` 空。
- **派生绝不落库**：行合计、列合计、总计均后端/前端按列即时算。
- **确定性、不耦合系统时钟**：`currentYear/Month = 最大数据月`，年份范围 `[BASE_YEAR .. maxDataYear+1]`（沿用 pv/charging/elec 口径，规避台账踩过的 `new Date()` 坑）。
- **路径参数白名单**：`phase ∈ {1,2,3,4}`，`acct_month` `@Pattern(\d{4}-(0[1-9]|1[0-2]))`（沿用安全加固批次铁律，堵越界脏数据 + overview substring 解析 500）。
- 视觉：墨蓝+蓝族，无紫无绿无渐变，等宽数字 `var(--font-mono)`；遵循 `DESIGN-FIDELITY.md`（§6 加载门必遵循）。

## 3. 数据模型

### 3.1 迁移 V17 建表 `s10_record`

稀疏宽表，对齐 `monthly_ledger` 范式。

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | BIGINT PK AUTO | |
| `tenant_id` | INT NULL | 软引用真实租户，无 FK 约束 |
| `tenant_name` | VARCHAR(64) NOT NULL | 显示与配平按名匹配的兜底 |
| `phase` | TINYINT NOT NULL | 1 一期 / 2 二期 / 3 三期 / 4 宿舍 |
| `acct_month` | CHAR(7) NOT NULL | 'YYYY-MM' |
| `profile` | VARCHAR(16) NOT NULL | office/factory/shop/dorm/land/guarantee，列门控（决定哪些列通常有值，仅 UI 提示；金额一律可手填） |
| `note` | VARCHAR(255) NULL | 逐行备注 |
| `source` | VARCHAR(16) NOT NULL | seed / manual / import |
| **25 个费用列** | DECIMAL(14,2) NOT NULL DEFAULT 0 | 见下 |
| `created_at`/`updated_at` | DATETIME | 自动填充 |

**25 个费用列**（office ∪ factory 叶子并集，列名取 snake_case）：
```
office_rent, office_mgmt_fee,            -- 办公室租金/管理服务费
factory_rent, factory_mgmt_fee,         -- 厂房租金/管理服务费
land_rent,                              -- 空地租金
shop_rent, shop_mgmt_fee,               -- 商铺租金/管理服务费
dorm_rent, dorm_facility_fee,           -- 宿舍租金/配套设施费
infra_office, infra_factory, infra_shop, infra_dorm,   -- 各基础设施维护费
elevator_maint, transformer_maint, land_use_tax,       -- 电梯/变压器/土地使用税
network_fee, access_maint, other_fee,                  -- 网络通讯/门禁/其他
elec_basic, elec_std, elec_maint,       -- 基本用电费/基准电费/电维护费
water_std, water_maint,                 -- 基准水费/水维护费
guarantee_rent                          -- 保障房租金
```

**唯一键** `uk_s10 (phase, acct_month, tenant_name)`（一户每期每月一行；含 `tenant_name` 以容纳 `tenant_id` 为空的手动/导入行）。索引 `idx_s10_slot (phase, acct_month)`。

### 3.2 列版面（移植 `schedule10-data.js` LAYOUTS）

- **office 版面**（phase 1 一期、phase 4 宿舍）：含办公室/保障房列，**25 个费用叶子**（=全部 25 列并集；连 租户/备注/合计 共 28 列），分组：A座租金 / B-G座租金 / 空地租金 / 宿舍区租金 / 基础设施维护费 / 办公室·厂房费用 / 宿舍费用 / 其他费用 / MON电费 / MON水费 / 保障房。
- **factory 版面**（phase 2 二期、phase 3 三期）：无办公室/保障房/空地列、租金合并，**20 个费用叶子**（连 租户/备注/合计 共 23 列），分组：租金 / 基础设施维护费 / 厂房费用 / 宿舍费用 / 其他费用 / MON电费 / MON水费。
- `phase → layout`：`{1:office, 2:factory, 3:factory, 4:office}`（=原型映射，仅去掉原型把宿舍当 office 之外无变化）。
- 叶子→列名映射、分组结构 1:1 移植原型，落在前端 `views/sales-income/layout.ts` 与后端列定义共用一套 id↔snake_case 对照。

### 3.3 派生（不落库）

- 行合计 = 该行 25 列之和；列合计 = 该列所有行之和；总计 = 全表之和。
- 后端 month DTO 同时回每行 `total` 与列合计，便于前端 KPI/tfoot（也可前端纯算；以前端算为准，后端 total 仅便利）。

## 4. 后端 API（均 JWT 保护，`Result<T>`，镜像 OfficeService/OfficeController）

- `GET /api/s10/overview` → `S10OverviewDTO`：`years[]`（确定性范围）、`currentYear`、`currentMonth`、每年摘要（该年已录入月数/户数）。
- `GET /api/s10/{phase}/{year}/{month}` → `S10MonthDTO`：`rows[]`（含 `id,tenantId,tenantName,phase,profile,note,source,<25列>`，含派生 `total`）、列合计、`recorded` 标志。`phase` 白名单 1-4。
- `POST /api/s10` ← `S10RecordReq`：新增/upsert 一行（按 `(phase,acct_month,tenant_name)`）。
- `PUT /api/s10/{id}/note` ← `S10NoteReq`：更新备注。
- `DELETE /api/s10/{id}`：删除；`source='seed'` → 409（守卫，沿用各附表）。

`S10Service`：overview 年份范围 `[BASE_YEAR .. maxDataYear+1]`、`currentYear=maxDataYear`、`currentMonth=该年最大数据月`；月读稀疏（无行回空，不补零，因租户行集不固定）；save upsert；delete seed 守卫。`acct_month @Pattern`、`year/month` 范围、`phase` 白名单全部 `@Validated`。

DTO 五件：`S10RecordDTO`、`S10RecordReq`、`S10MonthDTO`、`S10OverviewDTO`、`S10YearDTO`、`S10NoteReq`（镜像 Office 命名）。

## 5. 前端（复用 `components/sched/`，路由 `sales-income` 换 S10View）

### 5.1 动线（4 级，沿用台账/原型）
⓪ `SchedYearGate`（store-key `s10`，年份网格+摘要）→ ① 月份 `SchedMonthPills`/`LedgerMonthPills`（已录月高亮）→ ② 期 `Segmented`（一期/二期/三期/宿舍）→ ③ 宽表。

### 5.2 组件 `views/sales-income/`
- `S10View.vue`：状态机 + **§6 加载门**（`overview` 未就绪转圈、不假空态）；头部用 `SchedHeader`（返回/标题/年徽标/编辑切换/导入·新增·导出动作槽）；KPI 4 枚（本月总收款/户数/户均/已修改处）。
- `S10Table.vue`：双版面两级表头（组/叶子）、左 `租户` sticky + 右 `合计` sticky、tfoot 列合计+总计、编辑态单元格 input 即时重算、撑高行把合计顶到卡底；**CSS 全在自身 `<style scoped>`**（复用 scoped 类零样式的教训）。
- `S10RecordDrawer.vue`：新增租户（名 + profile chips → POST，`tenant_id` 空、`source=manual`）。

### 5.3 Excel
- `utils/s10Excel.ts` 导出当前 期×年×月 宽表，**`await import('xlsx')` 懒加载**（沿用 pvExcel）。
- 导入：编辑态「导入 Excel」按钮留**占位**（ElMessage/弹窗引导），落地延后（同其他附表）。

## 6. 种子（迁移 V18，确定性，离线生成器移植 `schedule10-data.js`）

- 1/2/3 期用 **demo3 真实在租租户**按 `building.phase`/`tenant.phase` 分组（phase1=5、2=4、3=4 户），`tenant_id` 已填、`tenant_name`=真名、`source='seed'`。
- **宿舍（phase 4）留空待录**（demo3 无宿舍在租租户，诚实空态）。
- 真实租户 profile 由确定性规则赋（厂房类→factory、商贸/便利→shop）；office 专属列（office_rent/guarantee_rent/land_rent 等）诚实留空（园区无此类真实租户）。
- 金额按原型 `deriveCell`（hash + 季节因子 + 年因子）确定性派生；**离线生成器**（一次性脚本，移植 JS 公式）发 `INSERT` 语句进 `V18__s10_seed.sql`，使 Flyway 为单一种子源、值确定可复现。
- 月份范围 2024–2025 全年 + 2026 年 1–6 月（≈390 行）；`currentYear=2026`、`currentMonth=6`（由数据派生，不耦合时钟）。

## 7. 测试

- 后端 `S10ServiceTest`（overview 范围/currentMonth 派生、月读、upsert、delete seed→409、phase 白名单）+ `S10ApiIT`（Testcontainers：四级取数、POST/PUT/DELETE、@Pattern 非法→400、越界 phase→404/400）。**编排者亲跑全量 `./mvnw test`，不信 agent 的 test-compile。**
- 前端 `s10Excel.spec.ts`（导出形状）+ `S10Table` 渲染测试（两级表头/双版面/合计）。

## 8. 验收口径（对齐设计稿 + 三类验证缺口铁律）

- `vue-tsc` build + vitest 全绿；后端全量测试绿（含新 V17/V18）。
- 起真后端 + demo3-mysql:13306 + preview，**真跑四级动线、肉眼扫整屏**（不只 computed-style 抽查）：⓪年份层→月→期切换→双版面宽表→编辑即时重算→新增租户→导出懒加载；宿舍页空态优雅；**0 console error**。
- opus 对抗复审（DOM 结构/事件流 + 契约形状 + scoped 样式真渲染），verify 逐条核实（防复审幻觉）。

## 9. 与台账/配平的衔接（备忘，非本期实现）

配平（P2 报表层）将：按 `tenant_id`（否则按 `tenant_name`）软匹配，逐租户比「台账跨公司汇总」vs「附表10 该行」，标出：附表10 多出的行、台账有而附表10 漏的行、金额不符的行。本期 schema 的软引用 + 自由文本租户名正是为此预留。
