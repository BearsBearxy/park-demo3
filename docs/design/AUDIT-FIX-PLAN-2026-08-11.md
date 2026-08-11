# 审计整改实现计划（2026-08-11）

来源：2026-08-11 全面审计（21 agent / 88 条存活 / 6 条证伪）。
配套规范：`API-CONTRACT-SPEC.md`（新建）、`DESIGN-FIDELITY.md` §6.4/§6.5/§八（新增）、`LIST-PAGE-SPEC.md` §8（新增）。

## 执行原则

1. **分批串行，批内并行**。同一批里的任务必须**文件不相交**（并行 agent 同改一文件会互相覆盖）。
2. **每批门禁**：`npm run typecheck` + `npx vitest run`（基线 1148 绿）+ `mvnw test`（基线 599 绿）。不绿不进下一批。
3. **不碰 Flyway 已应用的 migration**。`baseline-on-migrate:false` + 默认 `validate-on-migrate:true`，改 `V2__seed.sql` 会让 dev 库和云端库校验失败起不来。需要改数据一律新开 `V93+`。
4. **不动被证伪的 6 条**（见审计报告第十一节）。

## 已知约束（动手前必读）

| 约束 | 影响 |
|---|---|
| `V2__seed.sql` 的 admin/admin123 被 **20+ 个 IT 硬编码依赖**，且是 Flyway 已应用迁移 | 种子**不能删**。安全修法只能从「部署配置 fail-closed」入手 |
| 测试不设 profile，默认走 `dev` | 默认 profile **不能**改成 prod，否则 599 个测试全炸。改 `docker-compose` 的默认值即可覆盖真实攻击面 |
| `AbstractMysqlIT` 用 `@DynamicPropertySource` 覆盖 `app.jwt.secret` / `app.viewer.password` | 这两项挪到 `application-dev.yml` 不影响测试 |
| `application-dev.yml` 当前是空的 `{}` | 正好用来装 dev 弱默认 |
| `tokens.css` 在 P2（字体）和 P4（z-index）都要改 | 必须分批，不可并行 |

---

## P1 · 安全配置 + 数据丢失闸门

> 最高优先级：P1-4 是唯一会造成**真实数据丢失**的缺陷。

| # | 任务 | 文件（互不相交） |
|---|---|---|
| P1-1 | dev 弱默认下沉：`jwt.secret`/`viewer.password`/`datasource.password`/`cors` 的字面量从 `application.yml` 移到 `application-dev.yml`；base 改无兜底 `${JWT_SECRET}`；补 `logging.pattern` 输出 `%X{traceId}` | `application.yml`、`application-dev.yml` |
| P1-2 | 部署 fail-closed：compose 三项改 `${VAR:?提示}`、`SPRING_PROFILES_ACTIVE` 默认 `prod`；`.env.example` 去掉可用密钥字面量改成 `gen-env.sh` 指引；nginx 加 `X-Frame-Options`/`X-Content-Type-Options`/`Referrer-Policy`/CSP | `docker-compose.yml`、`.env.example`、`frontend/nginx.conf`、`deploy/README-部署指南.md` |
| P1-3 | 登录限流：IP+username 滑动窗口，5 次失败锁 15 分钟返 429；用户名不存在时补一次 dummy BCrypt 拉平耗时（消除枚举） | `AuthService.java` + 新增 `LoginRateLimiter.java` + 新增 IT |
| P1-4 | 🔴 **合同计费行清空闸门**：`detail` 请求失败时不得允许提交整组替换 | `ContractNewDialog.vue` |
| P1-5 | 4 处加载 Promise 无 catch → 打回「加载失败」态，绝不留旧月数据 | `MeterView.vue`、`MeterDetailDrawer.vue` |
| P1-6 | 同上（池账册） | `PoolLedgerView.vue` |
| P1-7 | 工具脚本口令改读环境变量 | `tools/realDataMigrate.ts`、`tools/buildingRestructure.ts` |
| P1-8 | 首页导入按钮从 `alert('即将上线')` 改成跳导入中心 | `DataHomeView.vue` |

## P2 · 前端性能

| # | 任务 | 文件 |
|---|---|---|
| P2-1 | ECharts 改 `echarts/core` 按需注册（bar/line/pie/scatter/treemap/sankey/gauge + 用到的 components/renderers），并在文件头写清「新增图表类型要同步注册」 | `AnaEChart.vue`、`anaTheme.ts` |
| P2-2 | 删 `tokens.css` 远程字体 `@import`，改系统字体栈；`index.html` 去掉失效 preconnect | `tokens.css`、`index.html` |
| P2-3 | 导航进度条 + 空闲期 chunk 预取 | `router/index.ts`、`stores/ui.ts`、`AppShell.vue` |
| P2-4 | `cellStyle`/`isFixed` 改按列 computed；`sum()` 改一次遍历 computed | `FPLedgerTable.vue` |
| P2-5 | `rowTotal`/`colTotal` 改 computed | `S10Table.vue` |
| P2-6 | 正则提模块级；分组排序与 draft 解耦成两个 computed | `useMeterWorkbench.ts`、`MeterLedgerGrid.vue` |
| P2-7 | 批量导出每户之间让出宏任务 | `billExcel.ts` |

## P3 · 后端性能

| # | 任务 | 文件 |
|---|---|---|
| P3-1 | 催缴单明细行批量 INSERT（`<foreach>` 每 500 行）+ JDBC URL 加 `rewriteBatchedStatements=true`；池结果回填改批量 | `BillNoticeService.java`、`BillNoticeLineMapper.java`、`application.yml` |
| ~~P3-2~~ | ~~分析层两接口加必填 `year`~~ → **2026-08-11 动手前撤销，理由见下** | — |
| P3-3 | data-home 5 张表 `selectList(null)` 改 `selectObjs(MAX(...))`（照抄 `ReconService:232`） | `DataHomeService.java` |
| P3-4 | `importFull` 循环外预载 contract Map；消除同方法内重复全表查 | `ContractService.java` |
| P3-5 | 抄表导入改 upsert + 批量；`Index.remove` 改按键定点删；**并入**`alloc_result` 补 `rule_id` 索引（新 migration V93，本轮唯一获准新建的 migration） | `MeterService.java`、`MeterReadingMapper.java`、`V93__perf_indexes.sql` |
| P3-6 | 分摊生成四张结果表逐条 insert 改批量；`loadRoster`/`loadCtx` 同方法内 contract/unit 各查两遍合并 —— **风险最高，禁止碰任何分摊算法** | `AllocService.java` + 对应 Mapper |

### P3-2 撤销记录（审计建议被现场推翻）

审计（第九节 be-perf）建议给 `/api/analysis/ledger-tenant-months` 与 `/s10-tenant-months` 加必填 `year`。
**动手前核查消费方，发现这条建议在本代码库里是错的：**

- `anaData.ts` 文件头第 11/14 行自注这两个 fetch 返回「**全月份**」，且缓存键是静态的 `'s10rows'`/`'ledgerRows'`。
- 实际消费方全是**跨年趋势**：`fetchCollectRates()`（逐月收缴率曲线）、`ChurnView`（流失史）、`BreakevenView`、`CockpitView`（驾驶舱趋势）、`fetchS10PhaseMonthly()`（期别×月）。加年份门会**打断多年对比图表**——而多年对比正是 2026-07-11 刚验收的功能。

**替代方案也一并否掉：** 把 21 项费用求和下推到 SQL 以削堆（19000 行 × 25 字段 → 7 字段）确实能省 ~3.5 倍堆，但要把 `recalc` 的 21 项加法**复制一份进 SQL**。本项目的数值是逐格对过账的（多份 spec 记录了到分的锚点），双份求和逻辑迟早漂移，**代价大于收益**。

**结论：本轮不动这两个接口。** 现状可接受：module 级缓存 → 一个会话只拉一次；nginx 已对 `application/json` 开 gzip，3~5MB 原文上线约 300~400KB。
真正的隐患是 2C4G 机器上约 40MB 的瞬时堆。**触发条件写进 `API-CONTRACT-SPEC.md` §3 的 5000 行红线**：等行数越线（约再攒 1 年数据）时，正确做法是给 anaData 的缓存键带上年份并让跨年消费方并发拉多年，而不是加必填门。

> P3-1 改 `application.yml`（JDBC URL），与其余任务不相交。

## P4 · CLS 与样式令牌

| # | 任务 | 文件 |
|---|---|---|
| P4-1 | 楼栋抽屉 `:fixed-height="true"` + 楼层单元图块 `v-else` 骨架占位 | `BuildingsView.vue`、`BuildingDrawer.vue` |
| P4-2 | KPI 条容器常驻 + `min-height`，只挡数值不挡容器 | `AnaShell.vue` |
| P4-3 | z-index 七级令牌落 `tokens.css`；**只修 3 处真问题**（`CockpitView`/`FinCashflowView` 模态错挂 popover 档、`BuildingNewDialog` 内联三元），**不做全站 ~28 个文件的机械替换** | `tokens.css` + 那 3 个文件 |
| P4-4 | 补 `--fs-h4`、`--surface-subtle` 两个未定义变量（真实渲染缺陷） | `tokens.css`（与 P4-3 同 agent） |

> **P4-3 为什么不全站替换**：规范里的令牌**取值刻意等于现状数值**（`--z-modal:300` 就是现在写的 300），所以"一半用令牌一半用字面量"在数值上完全等价、不会错层——混合态是正确的，只是不够整齐。
> 而机械改 28 个文件的收益只有"整齐"，风险却是每处都可能手滑改错层级。**令牌定义 + 3 处真 bug + 规范约束新代码**已经拿到全部实质收益；存量按域改动时顺手迁移即可。
> P4-3/P4-4 与 P4-1/P4-2 有文件重叠（`BuildingDrawer` 有 `z-index:320`、`AnaShell` 有 `z-index:20`），故 P4 分两波：先 [P4-1, P4-2] 并行，再 [P4-3+P4-4]。

## P5 · ponytail 还债

| # | 任务 | 文件 | 净减 |
|---|---|---|---|
| P5-1 | 删 23 个生产零消费的自绘图表组件 + Gallery 对应段 + 2 个 spec | `components/ana/*`、`Gallery.vue` | −1406 行 |
| P5-2 | `router/index.ts:67` 24 分支三元链改 map（照抄同文件 `ANA_VIEWS` 写法） | `router/index.ts` | 结构 |
| P5-3 | 6 个附表屏抽 `useSchedScreen` composable | `composables/useSchedScreen.ts` + 6 个 View | −475 行 |
| P5-4 | 报表三胞胎抽 `useFinStatementScreen` composable | `components/fin/` + 3 个 View | −550 行 |
| P5-5 | 类型：`importRegistry` 11 处 `as never` 改显式类型；`AllocMethod` 补 `'manual'`；`TenantDTO` 三字段改可空 | `importRegistry.ts`、`api/alloc.ts`、`types/tenant.ts` | 类型安全 |

> P5-4（报表三胞胎）风险最高——三大报表是核心功能。放最后，单独一批，改完必须人工过一遍三个屏。

---

## 不做（本轮明确排除）

| 项 | 理由 |
|---|---|
| HTTPS/TLS 落地 | 需域名 + 证书，是运维动作不是代码动作。本轮只把 nginx 安全头和文档准备好 |
| `noUncheckedIndexedAccess` | 打开后全站 `Record`/数组下标解引用会级联报错，改造面远超本轮 |
| 数据归属校验（多租户隔离） | 当前是单组织内部系统，6 家公司同属一个主体。要做是产品决策不是修 bug |
| JWT 改 httpOnly cookie | 架构级改动，本轮只降 expire + 留 token_version 位置 |
| 后端分页骨架 | 313 户量级用不上；已在 API-CONTRACT-SPEC §3 定下 5000 行红线和触发条件 |
| dto 164 文件分子包 | 纯搬运，收益低风险中，等有域改动时顺手做 |
