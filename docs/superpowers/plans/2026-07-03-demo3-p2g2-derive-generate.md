# P2-G2 派生生成账目结构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`)。本计划由 Workflow 编排实现，编排者亲跑测试把关。

**Goal:** 附表1–5 进年时自动生成缺失的映射行（带母册分组+派生值）并落库；导入/数据层变化后靠既有对照显示对得上/对不上。

**Architecture:** 纯前端：`reports/pnlDerive.ts` 的 DERIVE_MAP 扩 `group` 字段 + 新纯函数 `generateMissingRows`；`PnlScheduleView` 在 loadYear+loadDerive 就绪后调用并走现有整年 PUT。零后端改动。

**Tech Stack:** Vue 3 TS + Vitest。

**Spec:** `docs/superpowers/specs/2026-07-03-demo3-p2g2-derive-generate-design.md`（H1–H6 + §2 分组全表以此为准）

## Global Constraints

- 继承既往全部前端 Global Constraints。
- G2 特有：**零后端改动**；生成条件=该行派生序列该年**至少 1 个非空月**；缺失判定=(schedule, normalizeHeader(group), normalizeHeader(label)) 无既有行；生成行 kind=`detectKind(label)`；插入位置=同分组最后一个 **detail** 行之后（无 detail 则组末行后；组不存在则按 MAP 顺序追加表尾）；PUT 失败静默不阻塞；编辑态不触发生成；**不猜新映射**——只扩 spec §2 的 35 物理行位分组。

---

## 文件结构

- Modify: `frontend/src/reports/pnlDerive.ts`（MAP 扩组 + generateMissingRows）+ `pnlDerive.spec.ts`
- Modify: `frontend/src/views/reports/pnl/PnlScheduleView.vue`（进年自动生成落库）

---

## Task 1: generateMissingRows 纯函数 + MAP 扩组

**Interfaces — Produces:**
- `DeriveMapEntry` 增 `group: string`（normalizeHeader 后；M() helper 增参）。§2 分组全表逐条落——同标签双分组（s2 一期/二期光伏发电消纳、减：办公室电费）各自成条：原 34–36 重复条目改为**扩组后的独立行位**（#12/15/18 光伏发电组与基准电费组分列），MAP 总条数不变 36、物理行位 35（#18/#36 同一物理行只留基准电费组一条?——**定死**：spec §2 表为准共 35 条 (schedule,group,label) 唯一组合，s5 办公室电费与 s2 减：办公室电费是不同 schedule 不冲突）。
- `deriveRow(schedule, label, data)` 匹配语义不变（label 级；双分组同标签同 series）。
- `generateMissingRows(schedule: string, rows: PnlRowDTO[], data: DeriveData): { rows: PnlRowSave[]; added: number } | null`——null=无可生成；`PnlRowSave` 与 PnlScheduleView 现有整年保存 payload 行型一致（实现者先 Read View 的 save 代码确认字段，锁定 groupLabel/label/kind/m/note）。生成行 `m`=派生序列原值（number|null ×12）、`note` null。
- kind 用 `detectKind`（从 `@/reports/pnlSchedules` 导入）。

- [ ] Step 1: spec 先失败——空表全量生成（s4：7 行、组序=MAP 序、电动车充电桩损益 kind='pnl'）/ 部分补齐（s1 模拟 4 行种子：新增 2 行插在「一期企业服务费收入」detail 之后、二期 4 行成新组块追加表尾）/ 同标签双分组独立判定（光伏发电组已有、基准电费组缺 → 只生成缺的）/ 全空序列不生成 / 已齐全返回 null。
- [ ] Step 2: 实现 → `npx vitest run pnlDerive` 绿（既有 12 用例不回归）。
- [ ] Step 3: `npx vue-tsc --noEmit` 无本文件错 → commit `feat(pnl): generateMissingRows+映射分组扩展(派生生成账目骨架,纯函数)`。

---

## Task 2: PnlScheduleView 进年自动生成落库

**Interfaces — Consumes:** Task 1 `generateMissingRows`（先 Read 真实签名）。

**要点：**
- 触发点：`loadDerive(y)` 成功且 `loadYear(y)` 已落位后（两侧就绪才算；`year.value===y` 竞态守卫；`edit` 态不触发）。
- 动作：`generateMissingRows(config.schedule, data.rows, deriveData)` → 有 added → 走现有整年保存 API（同「保存」按钮路径）→ `await loadYear(y)` 重拉。失败 `catch` 静默。
- 防循环：每 (year) 会话内只尝试一次（`generatedYears: Set<number>`，成功失败都记）；导入完成路径不额外触发（H6：下次进年补回）。

- [ ] Step 1: 改造 + `npm run build` 绿 + `npx vitest run` 全量绿。
- [ ] Step 2: commit `feat(pnl): 进年自动生成缺失映射行并落库(派生生成账目结构)`。

---

## Task 3: 端到端真跑（编排者亲验）

- [ ] 全量 `./mvnw test` 绿（零后端改动安全网）→ jar（`$env:DB_PORT='13306'`）+ preview。
- [ ] preview 2025：/ops-pnl（现 0 行）进年 → 7 行自动出现、徽标已证√、**刷新后仍在**（落库证明）、年份门变已录入；/rent-pnl（4 行种子）→ 补 6 行（二期租金收入 1 月=派生 s10 值）；/elec-pnl（50 行已导入）→ 只补文件缺失行位、不重复。
- [ ] 0 console error；杀 :8080；提交；更新记忆。

---

## Self-Review

**Spec coverage：** H1 自动生成落库+至少1非空月→T1/T2;H2 任何年份+缺失判定→T1;H3 直写派生值→T1 m=derived;H4 分组/kind/插位→T1;H5 零后端+幂等→T2 防循环+缺失判定天然幂等;H6 导入不变→T2 不在导入路径触发;§4 测试→T1 spec+T3 E2E。全覆盖。
**Placeholder scan：** 无 TBD;PnlRowSave 行型=实现者 Read View save 代码锁定(定死处理方式);插位规则/防循环策略已定死。
**Type consistency：** generateMissingRows 签名 T1 定义 T2 消费;group 为 normalizeHeader 后字符串与缺失判定一致;detectKind 复用 pnlSchedules 既有导出。
