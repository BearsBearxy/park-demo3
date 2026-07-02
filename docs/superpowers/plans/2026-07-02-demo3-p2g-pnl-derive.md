# P2-G 损益附表派生链接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`)。本计划由 Workflow 编排实现，编排者亲跑测试把关。

**Goal:** 附表1–5 行级派生链接——36 条实证映射把数据层聚合值链接进损益附表：对照验证（已证√/差异）+ 只填空格的填入 + 扫描工具转正。

**Architecture:** 后端加 `GET /api/s10/year-summary?year=`（唯一缺年聚合的源）。前端 `reports/pnlDerive.ts`（DERIVE_MAP 36 条 + loadDeriveData 并行管道 + deriveRow/compareRow）+ PnlTable/PnlScheduleView 对照徽标/差异月橙底/填入动作 + `tools/deriveSweep.spec.ts`（扫描工具转正，真实文件缺失 skip）。

**Tech Stack:** 同 P2 各刀。

**Spec:** `docs/superpowers/specs/2026-07-02-demo3-p2g-pnl-derive-design.md`（G1–G6 + §2 映射全表以此为准）

## Global Constraints

- 继承既往全部 Global Constraints。
- G 特有：容差 0.005（compareRow）；填入**只填空单元格**不覆盖已录、进 draft 走现有保存；派生数据按年懒加载 `Promise.allSettled` 容错（失败源相关行不显派生不阻塞）；映射匹配 = normalizeHeader(行标签) 相等（分组无关，同标签多组各自命中）；**不猜新映射**——只落 spec §2 的 36 条。

---

## 文件结构

**后端：** Modify `service/S10Service.java`+`controller/S10Controller.java`；Create `dto/S10YearSummaryDTO.java`；Modify `test/.../api/S10ApiIT.java`（+year-summary 用例）
**前端：** Create `reports/pnlDerive.ts`+`.spec.ts`、`src/tools/deriveSweep.spec.ts`（由本轮已验证的临时脚本定稿）；Modify `views/reports/pnl/PnlTable.vue`、`views/reports/pnl/PnlScheduleView.vue`、`api/s10.ts`+`types/s10.ts`（+yearSummary）

---

## Task 1: 后端 s10 year-summary

**Interfaces — Produces:**
- `S10YearSummaryDTO(int year, Map<Integer, Map<String, List<BigDecimal>>> phases)`——phase(1–4) → colId → 长度 12 列表（月 Σ，该月无行=null；全零列不输出）。
- `GET /api/s10/year-summary?year=`（`@Min(2000)@Max(2100)`）。

**要点：** S10Service 新方法 `yearSummary(int year)`：selectList 该年（`acct_month like 'YYYY-%'`）全部行，Java 按 (phase, colId, month) 聚合（colId 集 = S10Service 既有 COLS 单点定义，反射或既有 getter 映射——沿用该类中 COLS 的现有访问方式，先 Read）。IT 用例：种子年（2025）聚合某已知列非空、无数据年（2023）phases 空、401。

- [ ] Step 1: DTO + Service 方法 + Controller 端点 + IT 用例（先写）。
- [ ] Step 2: `test-compile` 过（全量编排者跑）。
- [ ] Step 3: commit `feat(s10): year-summary 年聚合端点(供损益附表派生)`。

---

## Task 2: pnlDerive 管道 + 映射 + 工具转正

**Interfaces — Produces:**
- `DeriveData = Record<string /*seriesKey*/, (number|null)[12]>`。
- `loadDeriveData(year): Promise<DeriveData>`——`allSettled` 并行：`s10Api.yearSummary(year)`（api/s10.ts+types 顺带加）、`pvApi.records(year)`、`chargingApi.records(7,year)`+`records(8,year)`、`elecApi.records(year,'energy')`+`records(year,'basic')`、`utilitiesApi.records(13,year)`、`salaryApi.records(year,m)×12`。产出序列键（spec §2 语法）：s10 基础 `s10|p{n}|{colId}` + 组合列 Σ（仅 MAP 用到的组合：officeMgmtFee+factoryMgmtFee、infraOffice+infraFactory）+ `p1+p4` scope（MAP 用到时）；pv 按 phaseId 聚合 selfAmt/gridAmt/self+grid；chg fee/cost/profit(=fee−cost)；elec 按 phase/type amt=(qty??demand)×price Σ；office elecAmt=elecQty×elecPrice、waterAmt、elec+water；sal 各字段月 Σ（MAP 只用 lunch）。
- `DERIVE_MAP: { schedule, label /*normalize 后*/, series: string }[]`——**逐条落 spec §2 的 36 条**（同标签多组自然命中：按 label 匹配即可）。
- `deriveRow(schedule, label, data): (number|null)[12] | null`；`compareRow(rowM, derived): { state:'ok'|'diff'|'none', diffMonths:number[] }`（仅比两侧非空月；重叠 0 月且行全空 → state 'none'?——**定死**：无重叠月但派生存在 → 'ok' 空对照（显示徽标但无差异）改为 `state:'fill'`？简化：重叠 0 月 → `state:'empty'`（显示「可填入」暗示）；有重叠全等 → 'ok'；有差 → 'diff'）。
- `fillRow(rowM, derived): (number|null)[12]`（空格取派生，非空保留）。
- `src/tools/deriveSweep.spec.ts`：由本轮验证过的扫描脚本定稿（含 slot 去重 + hit≥2 规则 + 前导段 2025-01-p2 锚定），首行检查母册文件存在否则 `it.skip`；末尾断言匹配行数 ≥ 30（回归护栏，允许真实数据增长后变多）。

- [ ] Step 1: pnlDerive.spec 先失败（MAP 36 条计数、normalize 命中、组合键 Σ、compareRow ok/diff/empty、fillRow 只填空、loadDeriveData 某源 reject 相关键缺失不抛——mock 各 api）→ 实现 → `npx vitest run pnlDerive` 绿。
- [ ] Step 2: deriveSweep.spec 定稿 → 本机运行断言 ≥30 匹配绿（真实文件在）。
- [ ] Step 3: `npx vue-tsc --noEmit` 无本任务文件错 → commit `feat(pnl): 派生管道+36条实证映射+扫描工具转正`。

---

## Task 3: PnlTable/PnlScheduleView 对照与填入

**Interfaces — Consumes:** Task 1/2（先 Read pnlDerive.ts 真实签名与 PnlTable.vue 现结构）。

**要点：**
- PnlScheduleView：进入某年明细时 `loadDeriveData(year)`（懒加载缓存 per year；切年重拉；失败静默）；把每行 `compareRow` 结果与 derived 传给 PnlTable。
- PnlTable：行首徽标（ok=已证√ `--hue-blue`；diff=`差异N月` `--hue-orange`，hover title 逐月「M月 录入 x ⇄ 派生 y」；empty=灰「可填入」仅编辑态示意；无映射不显）；diff 月单元格橙底（`rgb(255,243,230)` 同 fin-tag.edit 先例）；编辑态行尾「填入」按钮（emit fill(rowKey)→View 用 fillRow 写 draft）+ SchedHeader 工具栏「全部填入派生值」（遍历命中行填空格）。读态显对照不显填入。
- 一期、宿舍组合（p1+p4）已在序列键层处理，UI 无特判。

- [ ] Step 1: 两组件改造。
- [ ] Step 2: `npm run build` 绿 + `npx vitest run` 全量绿。
- [ ] Step 3: commit `feat(pnl): 附表派生对照(已证√/差异橙/hover差额)+填入(只填空格)`。

---

## Task 4: 端到端真跑（编排者亲验）

- [ ] 全量 `./mvnw test` 绿（year-summary IT）→ jar → 后端+preview。
- [ ] curl year-summary 冒烟（2025 有种子聚合）。
- [ ] preview /rent-pnl 2025：命中行徽标渲染（s10 种子与 pnl 种子不同源→预期 diff 橙；机制验证）、hover 差额、编辑态填入动作、全部填入；**顺带验 ① 空月修复**：/income-statement 空月（如 2026-01）点击→进空 L3→可编辑/可导入。
- [ ] deriveSweep 工具跑一遍（真实文件 36 点回归）。0 console error；杀 :8080；提交；更新记忆。

---

## Self-Review

**Spec coverage：** G1 36 条 MAP→T2（逐条落表,不猜）;G2 三态徽标+橙底+hover→T3;G3 填入只填空格进 draft→T2 fillRow/T3;G4 year-summary→T1;G5 工具转正+skip 守卫+回归断言→T2;G6 按年懒加载 allSettled→T2/T3;§4 测试→各任务+T4（含 ① 空月运行时验证）。全覆盖。
**Placeholder scan：** 无 TBD;compareRow 的 0 重叠月语义已定死（'empty'）;序列键生成范围定死（仅 MAP 用到的组合,不全量生成）。
**Type consistency：** DeriveData/DERIVE_MAP/deriveRow/compareRow/fillRow T2 定义 T3 消费;S10YearSummaryDTO 后端 T1 ↔ 前端 types/s10 镜像;序列键语法与 spec §2 一致。
