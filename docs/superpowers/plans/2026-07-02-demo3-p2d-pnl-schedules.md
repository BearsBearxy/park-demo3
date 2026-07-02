# P2-D 损益附表 1–5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`). 本计划由 Workflow 编排实现，编排者亲跑测试把关。

**Goal:** 损益附表 1–5 全栈——园区全局年度矩阵（一张宽表 + 一个参数化 View 服务 5 条路由），手录 + 从真实母册按 sheet 导入（年自动识别）。

**Architecture:** 后端新 Pnl 子系统（P1 附表范式，无公司维度）：V26 `pnl_row` 宽表（schedule×year，12 月列内联）+ V27 种子 + `/api/pnl/{schedule}` 4 端点。前端 `pnlSchedules.ts` 5 条 config + `PnlScheduleView`/`PnlTable`（SchedYearGate 年门 + 矩阵表 + 编辑/备注/增删行）+ `importPnlSchedule` 解析器（表头定位/分组向下填充/kind 识别/年识别）+ registry `pnl_s1..s5`。

**Tech Stack:** 同 P2 各刀。

**Spec:** `docs/superpowers/specs/2026-07-02-demo3-p2d-pnl-schedules-design.md`（版式/kind 规则/口径以 spec 为准）

## Global Constraints

- 继承既往全部 Global Constraints（信封/BizException/零 XML/审计填充/§6 加载门+v-else 紧邻链+**切维度不清 data 防闪**/§7 居中弹窗/导入铁律/编排者亲跑全量 `./mvnw test`）。
- D 特有：月值 **NULL=未录**（区分 0，`" - "`/空→NULL）；本年合计客端派生不落库不导入；kind 按标签识别（含 `损益`→pnl、`小计`→subtotal、`合计|总计`→total、否则 detail）存库仅作渲染；row_key 合成 `r<n>`；整 (schedule,year) clear+insert。
- Flyway 现到 V25 → **V26 表 / V27 种子**。schedule 白名单 `s1..s5`。

---

## 文件结构

**后端（全新子系统）：**
- Create: `entity/PnlRow.java`、`mapper/PnlRowMapper.java`、`dto/PnlRowDTO.java`、`dto/PnlYearDTO.java`、`dto/PnlOverviewDTO.java`、`dto/PnlSaveRequest.java`、`dto/PnlImportRequest.java`、`service/PnlService.java`、`controller/PnlController.java`、`V26__pnl_row.sql`、`V27__pnl_seed.sql`、`test/.../api/PnlApiIT.java`
- Modify: `service/ImportLogService.java`（KNOWN_TYPES + `pnl_s1..pnl_s5`）

**前端：**
- Create: `reports/pnlSchedules.ts`+`.spec.ts`、`views/reports/pnl/PnlScheduleView.vue`、`views/reports/pnl/PnlTable.vue`、`utils/importPnlSchedule.ts`+`.spec.ts`、`api/pnl.ts`、`types/pnl.ts`
- Modify: `utils/importRegistry.ts`（+5 条）、`utils/importRegistry.spec.ts`（12→17 键）、`router/index.ts`（5 路由值 → PnlScheduleView）

---

## Task 1: 后端 Pnl 子系统（V26/V27 + 实体/Mapper/DTO/Service/Controller + IT）

**Interfaces — Produces:**
- `PnlRow`（实体，字段=spec §2 DDL 逐列；m1..m12 `BigDecimal` 可空；双审计 fill）。
- `PnlRowDTO(String rowKey, String groupLabel, String label, String kind, String note, List<BigDecimal> m /*长度12,可含null*/, int sortOrder)`
- `PnlYearDTO(int year, List<PnlRowDTO> rows)`；`PnlOverviewDTO(List<YearMeta> years)`；`YearMeta(int year, boolean hasData, int rowCount)`
- `PnlSaveRequest(List<PnlRowDTO> rows)`；`PnlImportRequest(List<PnlRowDTO> rows)`
- 端点：`GET /api/pnl/{schedule}/overview`、`GET /{schedule}/{year}`、`PUT /{schedule}/{year}`（clear+insert）、`POST /{schedule}/import?year=`（clear+insert，返 `ImportResultDTO{imported=rows.size,...}`）。
- overview 年范围：确定性 `[min(BASE=2024,最小数据年) .. max(数据年)+1]`（同 P1 sched 惯例，不耦合时钟）。

**IT（沿 AbstractMysqlIT 风格）：** `pnl_saveYear_readBack_thenOverwrite`（PUT 2 行含 null 月/备注/kind → GET 读回序+值；重存 1 行覆盖）、`pnl_import_clearInsert`、`pnl_overview_deterministicYears`（V27 种子年出现 hasData）、`pnl_seed_readable`（s1 2025 首行 一期租金收入 m1=1141774.45）、`illegalSchedule_s9_400`、`noToken_401`。

- [ ] Step 1: V26（spec §2 DDL 原样）+ V27 种子（s1 2025：一期租金收入/一期企业服务费收入 detail + 收入小计 subtotal + 租金损益 pnl，4 行各带真实 12 月值取自 spec 事实源附表1 前几行；created_at/updated_at 显式）。
- [ ] Step 2: 实体/Mapper（default `year(schedule,year)` orderBy sort_order、`years(schedule)` 聚合）/DTO/Service（白名单+clear+insert+overview）/Controller/KNOWN_TYPES。
- [ ] Step 3: PnlApiIT 先写用例再实现细节；`test-compile` 过（全量编排者跑）。
- [ ] Step 4: commit `feat(pnl): 后端损益附表子系统(pnl_row 宽表 V26/V27 + 4 端点 + IT)`。

---

## Task 2: 前端 config + api/types + 解析器

**Interfaces — Produces:**
- `types/pnl.ts`：`PnlRowDTO{rowKey,groupLabel,label,kind,note,m:(number|null)[],sortOrder}`、`PnlYearDTO`、`PnlOverviewDTO`（镜像后端）。
- `api/pnl.ts`：`pnlApi.overview(schedule)`、`year(schedule,y)`、`save(schedule,y,{rows})`、`import(schedule,y,{rows})`（走共享 http）。
- `reports/pnlSchedules.ts`：`PNL_SCHEDULES: {schedule:'s1'|'s2'|'s3'|'s4'|'s5', route:'rent-pnl'|'elec-pnl'|'water-pnl'|'ops-pnl'|'expense-pnl', title, groupCol:'区域'|'科目名称'|'项目'|'科目', sheetRe:RegExp, storeKey:'pnl-s1'..}[]`（5 条，sheetRe=/附表1租金损益/等）+ `rowYearTotal(m:(number|null)[]): number|null`（全 null→null,否则 Σ非空）+ `detectKind(label): kind`（spec D2 规则）。
- `utils/importPnlSchedule.ts`：`importPnlSchedule(matrix): {year:number|null, rows:PnlRowDTO[](rowKey 留空由后端/或前端合成 r<n>), error?}`——表头定位（行含「科目细分」且含「1月」）；分组列=科目细分左侧首个非月列（向下填充空值）；12 月列按表头「N月」定位；本年合计列忽略；备注列（表头「备注」）收 note；数据行跳空 label；`" - "`/空→null、数字 cleanNum；kind=detectKind(label)；年=标题 `/(\d{4})年/`。

- [ ] Step 1: 解析器+config spec 先失败（表头定位/分组向下填充/kind 识别/年识别/`- `→null 真 0 保留/合计列忽略/rowYearTotal 空值）→ 实现 → `npx vitest run pnlSchedules importPnlSchedule` 绿 + typecheck。
- [ ] Step 2: commit `feat(pnl): 5附表 config + api/types + 母册解析器(年自动识/kind/分组填充)`。

---

## Task 3: PnlScheduleView/PnlTable（一 View 五路由）+ 路由

**Interfaces — Consumes:** Task 1/2。范式先 Read `views/pv/PvView.vue`（SchedYearGate 用法/编辑态/防闪切换）与 `views/salary/SalaryTable.vue`（sticky 宽表分带）。

**要点：** 路由 meta.value → `PNL_SCHEDULES.find(c=>c.route===value)` 取 config（一个 View 服务 5 值）；① `SchedYearGate`（`pnlApi.overview`，store-key=config.storeKey）→ ② `PnlTable`（自带 scoped：sticky 首列 分组(同值向下省略)+科目细分、12 月列、本年合计尾列 sticky(rowYearTotal 派生)、编辑态备注列；kind 分带：subtotal 底色 accent-slate、pnl 底色 accent-blue 加粗、total 加粗 上边框——参照原型 s2 带样式）；编辑态：单元格金额（draft，null↔数值）、备注、新增行（居中弹窗：分组/科目细分，kind=detectKind 自动）、删行、保存 PUT 整年、退出 SaveConfirmDialog；**切年不清 data（防闪）**；导入按钮 → FpImportModal（`sheetMatch=config.sheetRe`+`customParse=importPnlSchedule` 包装为 records/labelMode——见 Task 4 的 registry 接线，本任务先接屏内直连版）；导出懒加载（分组|科目细分|12月|本年合计|备注）。

- [ ] Step 1: View+Table+路由（5 值分支 → 同一懒加载 View）。
- [ ] Step 2: `npm run build` 绿。
- [ ] Step 3: commit `feat(pnl): 损益附表屏(一View五路由,矩阵+分带+编辑+备注) + 路由`。

---

## Task 4: registry 5 条 + 屏导入接线收口

**Interfaces — Produces:** registry `pnl_s1..pnl_s5`：`{key, label:'附表N ·标题', tag:'报表', icon:'trending-up'/'zap'/'droplets'/'wrench'/'banknote'(对应 fpNav 5 图标), context:'none', modalProps:(ctx)=>({title,sub,templateCols:['分组','科目细分','1月'..'12月','备注'], sheetMatch:config.sheetRe, customParse:(matrix)=>{const r=importPnlSchedule(matrix); return r.error?{error:r.error}:{records:r.rows.map(row=>({...row,__yearDetected:r.year}))}}}), run:(payload,ctx)=>{const rows=payload as PnlRowDTO[]; const y=(rows[0]?.__yearDetected as number)??ctx.year!; return pnlApi.import(schedule,y,{rows:strip(__yearDetected)})}, target:(ctx)=>...}`——**年优先取解析识别年，识别失败回退屏当前年槽（ctx.year）**。
- `importRegistry.spec.ts`：键 12→17；context 断言不变（5 条均 'none'）。
- View 的 `@import` → `runImport('pnl_'+config.schedule, recs, {year}, fileName)` → 成功后若识别年≠当前年则跳转该年 + reload。

- [ ] Step 1: registry+spec 更新+View 收口 → `npm run build && npx vitest run` 全量绿。
- [ ] Step 2: commit `feat(pnl): registry pnl_s1..s5(年自动识,失败回退当前槽) + 屏导入收口`。

---

## Task 5: 端到端真跑（编排者亲验）

- [ ] 全量 `./mvnw test` 绿（V26/V27+PnlApiIT）→ jar → 后端+preview。
- [ ] preview：/rent-pnl 年门(2025 种子)→矩阵（分带/本年合计派生/编辑/备注/新增行/保存）→ /elec-pnl 等其余 4 路由同 View 渲染。
- [ ] 真实母册 5 张 sheet 全喂 `importPnlSchedule` 实测（临时 spec）：行数量级 45/61/19/40/85、年=2025、抽查 一期租金收入 m1=1,141,774.45、kind 分带、分组填充。
- [ ] 0 console error；杀 :8080；提交；更新记忆。

---

## Self-Review

**Spec coverage：** D1 宽表→T1；D2 kind 存值+标记→T1(kind列)/T2(detectKind)/T3(分带渲染);D3 本年合计派生→T2(rowYearTotal)/T3;D4 一 View 五路由→T3;D5 SchedYearGate→T3;D6 sheetMatch+年识别+clear insert→T2/T4/T1;D7 registry 5 条+KNOWN_TYPES→T4/T1;D8 手录(金额/备注/增删行/整年保存)→T3;§5 测试→各任务+T5。全覆盖。
**Placeholder scan：** 无 TBD;解析器规则/kind 规则/年回退策略/IT 判据逐条给出。
**Type consistency：** `PnlRowDTO` 前后端镜像（m 12 元素可空数组）;`importPnlSchedule` 返回 {year,rows,error} T2 定义 T4 用;config 字段 T2 定义 T3/T4 用;端点 4 个 T1↔api/pnl.ts 一致。
