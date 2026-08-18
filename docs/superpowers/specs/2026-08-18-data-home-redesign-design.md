# 数据中心首页重设计（DATA-HOME-REDESIGN）

2026-08-18 立档。触发：用户反馈「打开首页无从下手，信息量过多，没有主次」。

## 0. 诊断（根因，非排版问题）

现有 `DataHomeView.vue`（203 行）把**同一批信息说了三遍**：

| 位置 | 内容 | 与谁重复 |
|---|---|---|
| KPI「数据完整度 22%」 | 2/9 | 下方「本期数据完整度」栏 |
| KPI「待处理事项 8」 | 未录数 | 下方「本期待办」栏 |
| KPI「最近更新 11:25」 | 最后一条 | 下方「最近动态」栏 |
| KPI「本期记录数 4」 | — | 不重复，但也最无用 |
| 「本期待办」栏 | 7 条未录 + 1 条合同到期 | **是「完整度」栏的子集** |

最后一条有代码为证 —— `DataHomeService.java:96-104` 直接遍历 `sources` 生成 tasks：

```java
// ── 本期待办：missing 源 + 合同 expiring ──
for (SourceData s : sources) {
    if (!s.done()) tasks.add(new DataHomeTaskDTO(s.name() + " 本期未录入", …));
}
```

**第二个根因：首页只覆盖了一半的活儿。** 数据中心导航分三组，首页那 9 个源全部来自「实际数·事后录入」；而「出账链·应收派生」6 屏（合同→参数→抄表→公摊→损耗→催缴单）**一个都没上首页**。偏偏出账链才是有先后依赖、真正会让人无从下手的部分：抄表没抄完算不了公摊，公摊没生成出不了催缴单。

结论：显示出来的那半边重复了三遍，真正需要引导的那半边压根没显示。

## 1. 定位（已拍板）

- 首页 = **录入工作台**，服务对象是做录入的人（当前唯一 admin 账号）。
- 经营概览留在「经营驾驶舱」，导航留给侧边栏 + Ctrl+K，首页不重复承担。
- **不把驾驶舱搬上首页**：它信息密度更高（6 KPI + 4 图表 + 92 条异常），用它替换会加重症状；且它是全站最慢首屏（ECharts 693KB + ~15 请求）。

## 2. 信息架构

```
┌──────────────────────────────────────────────────────────┐
│ 本月工作 · 2024年2月 ▾                出账 3/4 · 附表 2/9  │  ← 唯一总览行
├──────────────────────────────────────────────────────────┤
│ ⚠ 219 份合同无租金计费行,会让公摊/催缴单算不准  [去补档]  │  ← blockers,可 0 条
│                                                          │
│ 出账链                                                   │
│  ✓ 抄表 92/94 ── ✓ 公摊已生成 ── ✓ 损耗 ── ● 催缴单       │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 催缴单 · 102 户 · ¥2,474,138.88 · 66 户带警告       │  │
│  │                                       [去处理 →]   │  │  ← 全页唯一主 CTA
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│ 附表录入                                        2/9 ▾    │
│  ○ 月度台账  ○ 销售收入  ○ 工资明细  ○ 三期水电           │
│  ○ 汽车充电桩  ○ 电动车充电桩  ○ 电费成本                 │
│  ✓ 办公水电  ✓ 光伏发电                       (淡化)     │
└──────────────────────────────────────────────────────────┘
```

三级主次：① 顶部一行总览 → ② 出账链流水线 → ③ 当前步大卡 + 唯一主按钮。

**删除**：4 个 KPI 卡、「本期待办」栏、「最近动态」栏。
信息不丢——待办 = 出账链非 ✓ 步 + 附表 ○ 项，本就是同一批数据的另一种画法；
「最近动态」回答的是"发生过什么"而非"现在该做什么"，导入历史在导入中心有更完整的记录。

### 2.1 出账链画 4 步，不是 6 步

各步「本月完成」的判据现状决定了这个取舍：

| 步骤 | 本月完成态 | 判据 |
|---|---|---|
| 园区抄表 | 有 | `meter_reading` by ym；detail = 已抄/应抄 |
| 公共电核算 | 有 | `AllocPoolDTOs.Pools.generated` |
| 楼栋损耗 | 有 | `AllocPoolDTOs.Loss.generated` |
| 催缴单 | 有 | `bill_notice` by ym；detail = 户数/合计/警告户数 |

各 step 的 `detail` 取数（不得另造口径）：
- 抄表：`已抄/应抄`，分母 = 该 ym 下参与计费的表数（与抄表屏「租户表总数」卡同源）；
- 公摊 / 损耗：done 时 detail 为空串，todo 时「未生成」；
- 催缴单：户数、本期合计、警告户数，三者与催缴单屏顶部三张卡同源。

`blockers` 判据来源：
- `contract-gap`：合同缺口，口径 = 合同屏 `noDate / noLine / noUnitBind` 三个谓词，**必须与之同源**；
- `param-stale`：`ParamStatusDTO.stale`（参数改动晚于本月池快照或催缴单批次）。
| 计费参数 | **半个** | `ParamStatusDTO` 有 `priceOk/priceTotal`、`stale`，但参数是版本簿、不按月「完成」 |
| 合同管理 | **没有** | 「待补档案」是全局档案缺口（缺起止日期/无计费行/未绑单元），不按月 |

合同与参数**降级为前置条件**，不进流水线——强行塞进去会得到两个永远不知道该不该打勾的格子。
它们改成 `blockers`：**只在有问题时渲染，没问题时整条不出现**。这是"有主次"的关键：没问题的东西不占版面。

**当前步** = 4 步中第一个非 done 的。全部 done → `currentIndex = -1`，大卡换成「本月出账已完成 · 去对账核对 →」，`go = "reconciliation"`（账簿与报表层的对账屏）。

### 2.2 月份锚

**锚 = 出账链最新有数据的月**（取抄表/公摊/损耗/催缴单四源 ym 的 max；现为 2024-02）。

选它的理由（覆盖矩阵实测）：

```
              2023-08  2023-10  2024-02 │ 2024-10  2025-01..10  2026-01
抄表            993      80      1088   │    —         —           —
公摊池           98      98        98   │    —         —           —
催缴单          245       —       295   │    —         —           —
月度台账          —       —         —   │   83      329..416       —
```

- **不能用「最早未完工月」**：没有任何一个月是全做完的，最早未完工月恒为 2023-08，首页会永远停在两年前指着一堆不打算补的历史缺口。
- **不能用「最新有数据月」**（现口径 2026-01）：那是 5 个月度源取 max，出账链在该月完全为空，且完整度永远停在 20% 上下。
- 出账链最新月 = 用户接着往下补的位置；补到 2024-03 锚自动前移，**零新增状态、零配置、自动推进**。

用户已确认「出账链要补齐，往后每月都跑」，故该锚随工作推进。

**锚的回退链**（三级，避免 period 轻易为 null）：
1. 出账链四源 ym 的 max；
2. 链上一条数据都没有 → 退到 9 个附表源的 max（已导附表、尚未跑链的库）；
3. 两边都空 → `period = null`（全新库）。

**`months` 全集** = 出账链四源 ∪ 9 个附表源 的全部 ym，升序去重。
不能只给链的月份——用户要能切到 2025-06 补台账，而那个月链上无数据。

顶部 ▾ 可手动切月；**切换不持久化**——下次打开仍按锚重算，避免看过一次历史月后天天落在那儿。

未来若进入稳定月度生产，可加显式「关账」状态推进（属产品审计 P0 清单里的独立项，不在本次范围）。

## 3. 数据契约

单接口，可选月份参数：

- `GET /api/data-home/overview` → 锚定月
- `GET /api/data-home/overview?ym=2024-03` → 指定月（`@Pattern(regexp = "\d{4}-(0[1-9]|1[0-2])")`）

```java
public record DataHomeOverviewDTO(
    Period period,              // null = 库里出账链一条数据都没有
    List<String> months,        // 可切月份全集('YYYY-MM' 升序)
    List<Blocker> blockers,     // 空 = 前端整条不渲染
    Chain chain,
    Schedules schedules
) {
    public record Period(int year, int month, String label) {}
    public record Blocker(String kind, String text, String cta, String go) {}   // kind: contract-gap | param-stale
    public record Chain(int currentIndex, List<Step> steps) {}                  // currentIndex=-1 → 全部完成
    public record Step(String key, String label, String status,                 // done | current | todo
                       String detail, String go) {}
    public record Schedules(int done, int total, List<Item> items) {}
    public record Item(String name, String tag, boolean done, String go) {}
}
```

**从旧 DTO 删除**：`kpis`、`tasks`、`recent`、`progressDone/progressTotal/pct`（后者并入 `Schedules.done/total`）。
连带删除不再被引用的 `DataHomeKpiDTO`、`DataHomeTaskDTO`、`DataHomeRecentDTO`、`DataHomeSourceDTO`（`Item` 取代之）——删前 grep 确认无其它引用。

`go` 字段沿用现有语义：导航 value（如 `"meters"`、`"bill-notices"`），前端交给 tabs store 打开。

## 4. 实现要点

### 后端 `DataHomeService`
- 保留：9 个附表源的取数逻辑（映射到 `Schedules.items`），**含现有的月/年粒度差异，不要统一**：
  月度类按 `acctMonth` 判定 —— 月度台账、销售收入(附10)、工资明细(附12)、办公水电(附13)、三期水电(附14)；
  年度类按 `year` 判定 —— 光伏(附6)、汽车充电桩(附7)、电动车充电桩(附8)、电费成本(附11)。
  即页面月切到 2024-02 时，年度类查的是 2024 全年有无数据。这是既有口径，改了会让附表完成度失真。
- 保留：`currentPeriod()` 的 4 条聚合查询优化**不要退化**（原注释记着：曾把 5 张月度表整表读成实体只为取 MAX 两列）。但锚口径改为出账链四源，需新写对应聚合。
- 新增：4 步链状态判定。走现成索引（`meter_reading.idx_meter_reading_ym`、`alloc_result.idx_alloc_result_ym`），实测该类查询亚毫秒级。
- 新增：blockers 判定。合同缺口需在后端算（现在是前端 `ContractsView` 用 `noDate/noLine/noUnitBind` 三个谓词算的），口径必须与合同屏那三个筛选完全一致——否则又是一处「同一判定两份实现」（违反 METRIC-SOURCE-SPEC §1）。
- **禁止 `selectList(null)`**（CI 有 `QueryHygieneTest` 门禁）。

### 前端 `DataHomeView.vue`
- 重写，预计 ~160 行（删得比加的多）。
- **不抽新组件**：流水线、前置条、附表清单都只此一处用，抽出去是给单一实现造接口。
- 复用 `ds/Card`、`ds/Button`、`iconFor`；月份 ▾ 复用催缴单屏的 popover 选择器写法。
- 视觉沿用既有 `ds`/`fp` token，**不引入新设计语言**——与其余 46 屏保持一致。
- `types/dataHome.ts` 同步新契约；`api/dataHome.ts` 的 `overview()` 加可选 `ym` 参数。

## 5. 边界情况

| 情况 | 处理 |
|---|---|
| 出账链一条数据都没有 | `period=null` → 页面显示「还没开始出账 · 从园区抄表开始 →」 |
| 手动切到完全空的月 | 4 步全 todo，`currentIndex=0`，附表 0/9。不报错 |
| 4 步全 done | `currentIndex=-1`，大卡 →「本月出账已完成 · 去对账核对 →」 |
| viewer 只读角色 | 主 CTA 文案「去处理」→「查看」；blockers 的「去补档/去重算」隐藏（写操作）。**不做路由分流**，只改文案——最小代价堵住「整屏按钮都点不动」 |
| 附表某项 `go` 指向占位屏 | 不会发生：9 源不含 `bank-flow`（唯一死链） |

## 6. 测试

- `DataHomeView.spec.ts`（现 93 行）全部重写：4 步状态机渲染、`blockers` 为空时该条不渲染、`currentIndex=-1` 的完成态、viewer 文案。
- `DataHomeApiIT` 新增/改写：锚定月正确、`?ym=` 生效、空月不炸、`months` 升序且格式 `\d{4}-\d{2}`。
- 门禁不变：前端 typecheck + vitest 全绿；后端 `mvnw test` 0 失败。

## 7. 明确不做

- 不做角色路由分流（viewer 落地页仍是数据中心，只调文案）。
- 不做「关账/期间推进」状态机。
- 不动驾驶舱、报表中心两个 home。
- 不改导航结构。
- 不引入新组件库或设计语言。
