# P2-E 收入核对 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`)。本计划由 Workflow 编排实现，编排者亲跑测试把关。

**Goal:** 收入核对全栈——台账 ⇄ 附表10 同月逐租户双源对照（状态三色 + 配平条 + 处置标记持久化），纯派生读模型 + recon_mark 小表。

**Architecture:** 后端 V28 `recon_mark` + `ReconService`（只读注入 MonthlyLedgerMapper/S10RecordMapper/TenantMapper/ManagementCompanyMapper，服务端算好整月对照：实体并集/软引用匹配/同名科目交集逐项比/三档状态）+ `/api/recon` 4 端点。前端 `recon.ts` 纯函数 + `ReconView`（①月卡层+4 指标条 → ②工作台：左租户清单/右双源分卡+配平条+处置浮层）1:1 移植 `recon-page-v3.js`，路由 `reconciliation` 换真屏。

**Tech Stack:** 同 P2 各刀。

**Spec:** `docs/superpowers/specs/2026-07-02-demo3-p2e-reconciliation-design.md`（口径 E1–E8 以此为准）

## Global Constraints

- 继承既往全部 Global Constraints（信封/BizException/零 XML/审计填充/§6 加载门+v-else 紧邻链/§7 居中弹窗/编排者亲跑全量 `./mvnw test`/JsonPath 过滤器 `.isNotEmpty()`）。
- E 特有：容差 **0.005**；实体键=**tenant_name**（E1：s10.tenant_id 优先归并，null 按 name==tenant.company_name，未匹配以 name 为独立实体）；科目=**同名交集逐项 + 单侧科目计入该侧总额并标 onlySide**（E2）；状态 ok/diff/miss（E3）；台账跨公司 Σ/s10 跨期 Σ（E4）；派生不落库（除 recon_mark）。
- Flyway 现到 V27 → **V28**（recon_mark，无种子）。

---

## 文件结构

**后端：**
- Create: `V28__recon_mark.sql`、`entity/ReconMark.java`、`mapper/ReconMarkMapper.java`、`dto/ReconEntityDTO.java`、`dto/ReconMonthDTO.java`、`dto/ReconOverviewDTO.java`、`dto/ReconMarkDTO.java`、`dto/ReconMarkReq.java`、`service/ReconService.java`、`controller/ReconController.java`、`test/.../api/ReconApiIT.java`

**前端：**
- Create: `types/recon.ts`、`api/recon.ts`、`reports/recon.ts`+`.spec.ts`、`views/reports/recon/ReconView.vue`、`views/reports/recon/ReconWorkbench.vue`
- Modify: `router/index.ts`（`reconciliation` → 真屏）

---

## Task 1: 后端 Recon（V28 + 聚合 Service + 4 端点 + IT）

**Interfaces — Produces:**
- `ReconMark`（实体，spec §2 DDL；双审计 fill）；`ReconMarkMapper extends BaseMapper` + `default List<ReconMark> month(year,month)`。
- `ReconEntityDTO(Integer tenantId, String tenantName, String status, BigDecimal ledgerTotal, BigDecimal s10Total, BigDecimal diff, boolean marked, String markNote, List<FeeLine> fees, List<LedgerCard> ledgerCards, List<S10Card> s10Cards)`；`FeeLine(String key, String label, BigDecimal ledgerAmt, BigDecimal s10Amt, BigDecimal delta, String onlySide)`；`LedgerCard(String companyName, BigDecimal total, Map<String,BigDecimal> fees)`；`S10Card(int phase, BigDecimal total, Map<String,BigDecimal> fees)`。
- `ReconMonthDTO(int year, int month, List<ReconEntityDTO> entities)`；`ReconOverviewDTO(int year, List<MonthMeta> months)`；`MonthMeta(int month, boolean hasData, int entityCount, int okCount, int diffCount, int missCount)`。
- 端点：`GET /api/recon/overview?year=`（year 缺省=两本账有数据的最大年，确定性）、`GET /{year}/{month}`、`POST /{year}/{month}/mark`（body `ReconMarkReq{tenantName,tenantId,note}`，uk 冲突 upsert note）、`DELETE /{year}/{month}/mark?tenantName=`。

**关键实现要点：**
- **科目映射常量**：实现者先 Read `entity/MonthlyLedger.java`（21 费用字段）与 `entity/S10Record.java`（25 列字段）+ `utils/ledgerColumns.ts`/`views/sales-income/layout.ts`（中文标签），在 ReconService 内建 `RECON_FEES: List<{key, label, Function<MonthlyLedger,BigDecimal>, Function<S10Record,BigDecimal>}>`——**同名字段直接配对**；台账独有字段（不在 s10）与 s10 独有字段各入 `LEDGER_ONLY/S10_ONLY` 清单（计入该侧总额 + FeeLine.onlySide）。
- 月对照算法：取该月台账全行（groupBy tenant_id）+ s10 全行（`acct_month=YYYY-MM`，groupBy 归并键：tenant_id!=null→tenant.company_name；否则 tenant_name）→ 实体并集（键=tenantName）→ 每实体：ledgerCards 按公司、s10Cards 按期、fees 逐科目（两侧 Σ 后比，`|delta|<=0.005` 视等）→ status（E3）→ 合上 marks。
- overview：对每月跑轻量版（只算 counts，不出 fees/cards——或直接复用整月算法，实体量小,直接复用可减代码）。
- 无数据月 entities 空数组不 404；非法 month `@Min/@Max`。

**IT（真库；种子台账 2026-1..5 与 s10 2024-2026.6 天然重叠——用 2026-03 断言）：**
- `recon_month_overlap_hasEntities_andStatuses`：GET /2026/3 → entities 非空；存在 status∈{ok,diff,miss}；某实体 fees 里 delta=ledgerAmt−s10Amt。
- `recon_softRef_mergesByName`：s10 种子行 tenant_id 非空 → 该实体 tenantId 非空且名=公司名（软引用归并生效）。
- `recon_mark_upsert_delete_roundtrip`：POST mark(note A)→GET 见 marked+note；再 POST(note B)→note 更新；DELETE→marked=false。
- `recon_overview_counts`：GET overview?year=2026 → month 3 hasData=true 且 entityCount=ok+diff+miss。
- `noToken_401`。

- [ ] Step 1: V28 + 实体/Mapper/5 DTO。
- [ ] Step 2: ReconService（映射常量+月对照+overview）+ Controller + IT（先写用例）。
- [ ] Step 3: `test-compile` 过（全量编排者跑）。
- [ ] Step 4: commit `feat(recon): 后端收入核对(台账⇄附表10 逐租户对照 + recon_mark V28 + 4 端点 + IT)`。

---

## Task 2: 前端 types/api + recon 纯函数

**Interfaces — Produces:**
- `types/recon.ts` 镜像后端全部 DTO（`ReconEntity/FeeLine/LedgerCard/S10Card/ReconMonth/ReconOverview/ReconMonthMeta`）。
- `api/recon.ts`：`reconApi.overview(year?)`、`month(y,m)`、`mark(y,m,{tenantName,tenantId,note})`、`unmark(y,m,tenantName)`。
- `reports/recon.ts` 纯函数：`filterEntities(entities, seg:'all'|'diff'|'miss'|'ok', query)`（搜索名；已核实(marked)灰显排后=排序规则：未核实差异在前→缺记→已平→已核实）+ `segCounts(entities)`（四档计数徽标）+ `statusColor(status)`（ok→blue/diff→orange/miss→red token 名）。

- [ ] Step 1: spec 先失败（filterEntities 四档+搜索+marked 排后；segCounts；statusColor）→ 实现 → `npx vitest run reports/recon` 绿 + typecheck。
- [ ] Step 2: commit `feat(recon): types/api + 清单过滤排序纯函数`。

---

## Task 3: ReconView/ReconWorkbench + 路由

**Interfaces — Consumes:** Task 1/2。像素源=先 Read `app/legacy/recon-page-v3.js`（结构与样式 1:1，`--pa-*` token 换 demo3 令牌：`--pa-ink→--text-primary`、`--pa-mute→--text-muted`、`--pa-border→--border-subtle`、`--pa-success→--hue-blue(对齐用蓝,demo3 无绿)`、`--pa-warning→--hue-orange`、`--pa-danger→--hue-red`、`--pa-bg-soft→--surface-card` 等）。

**要点：**
- `ReconView.vue`：①月份层——年份胶囊（fin-ypill 样式）+ 4 指标条（`.rc-metric-strip`：台账总额/附表10总额/差额/差异+缺记户数，取 overview 聚合）+ 12 月卡 `.rc-mcard`（状态点+户数摘要；hasData=false 置灰不可点）→ 点月进 ②；§6 加载门 + v-else 紧邻链；切月不清 data。
- `ReconWorkbench.vue`：左 `.r2-master` 式租户清单（搜索框+Segmented 四档带 segCounts 徽标+行=statusColor 点+名+diff 金额；marked 灰显√）；右单户对照——上双卡（左「月度台账」ledgerCards 按公司分卡、右「附表10」s10Cards 按期分卡，卡内费用行 label+金额）+ 中部**同名科目对照行**（FeeLine：label|台账|附表10|差额，delta≠0 橙、onlySide 红标「仅台账/仅附表10」）+ 底部配平条（台账合计⇄附表10合计⇄差额，statusColor 底色）。
- 处置浮层（居中弹窗 §7）：点差异行/配平条开——两侧值+差额+备注输入+「标记已核实」（`reconApi.mark`）/已核实实体显「取消核实」（`unmark`）/「去改台账」「去改附表10」（`router.push('/ledger'|'/sales-income')`）。操作后局部更新 entities（不整页刷）。
- 路由：`reconciliation` → ReconView（懒加载 const + ternary 分支）。

- [ ] Step 1: 两组件 + 路由。
- [ ] Step 2: `npm run build` 绿 + `npx vitest run` 全量绿。
- [ ] Step 3: commit `feat(recon): 收入核对屏(月卡+双源工作台+配平条+处置浮层) + 路由`。

---

## Task 4: 端到端真跑（编排者亲验）

- [ ] 全量 `./mvnw test` 绿（V28+ReconApiIT）→ jar → 后端+preview。
- [ ] preview：/reconciliation 月层（2026 年 1-5 月有数据）→ 3 月工作台：清单四档计数、选差异户右侧分卡+科目对照+配平条橙/红、标记已核实+备注→灰显排后→取消核实；已平户配平条蓝。
- [ ] curl 抽验 GET /api/recon/2026/3 的 delta=两侧差（ASCII 断言）；0 console error；杀 :8080；提交；更新记忆。

---

## Self-Review

**Spec coverage：** E1 并集+软引用→T1 算法+IT softRef;E2 同名交集+onlySide→T1 RECON_FEES/FeeLine;E3 三档 0.005→T1;E4 跨公司/跨期分卡→T1 cards/T3 双卡;E5 recon_mark→T1 V28+mark 端点+T3 浮层;E6 服务端算好→T1;E7 简单跳转→T3;E8 总项分项不做→无任务(正确);§4 v3 1:1+token 映射→T3;§5 测试→T1/T2/T4。全覆盖。
**Placeholder scan：** 无 TBD;科目映射建法(Read 两实体同名配对)/排序规则/token 映射表/IT 判据逐条。
**Type consistency：** ReconEntityDTO 字段 T1↔types/recon.ts T2↔T3 渲染一致;reconApi 4 方法 T2 定义 T3 用;statusColor/filterEntities T2 定义 T3 用;mark 端点 body/query T1↔T2 一致。
