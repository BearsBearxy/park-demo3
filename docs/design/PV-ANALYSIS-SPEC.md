# 光伏分栋分析规范（PV-ANALYSIS-SPEC）

v2 定稿 2026-09-01。审计与布局定稿：Artifact `2478cb46-910d-4769-82ef-a7d1b8554418`「光伏分栋分析屏定稿」。
**本文件是仓内权威版**——migration 与源码注释一律引 `PV-ANALYSIS-SPEC §NN`，不引 artifact URL。

上游：`PV-METER-SPEC.md`（抄表数据模型）、`ENERGY-ANALYSIS-SPEC.md`、`RBAC-SPEC.md` §4、
`S21-PARAM-CENTER-SPEC.md`、`METRIC-SOURCE-SPEC.md`。

---

## §00 相对 2026-08-31 初版的五处结构性改动

初版（本文件的前一个版本，与 `pv-analysis-screen-design-a8dc8b` 工作区里那份未提交实现对应）
有五处被推翻。**以本文件为准，那份实现要按下表回退。**

| # | 初版 | 本版 | 为什么 |
|---|---|---|---|
| 1 | 接入外部逐小时天气/辐照（V117 表 + weather 后端域 + 导入类型 + 三个断闸参数 + ¥18/月付费源） | **整条删除** | 用户明确不做天气归因。实测关掉日筛只差 0.21pp |
| 2 | 板数 / 单块 W **不排期** | **本刀就做**（V119 两列） | 它是唯一独立于发电量的输入，破「容量倒推 → 效率恒等」死循环 |
| 3 | 三重门槛 `alertLevel` 红黄灯 + `gapMoney` 缺口金额 + `classifyShape` 五标签 + 建议动作文案 | **整条链删除**，换成 **§04 五条明示判据线 + 命中清单** | 屏只做可视化，不替用户下结论。判定不消失，但要摊开、可复算、可反对 |
| 4 | 第一层 = 可排序表 + 四盏灯 + 「情况 / 建议」列 | **无表格**。第一层 = 13×12 网格三张 + 命中清单 | 排序键、状态灯、话术模板三样都是替用户下结论；话术模板覆盖不到的情况就是误导 |
| 5 | 效率分母 = 从发电量倒推的容量 | **分母 = 理论装机（板数 × 单块标称 W）** | 倒推容量让 `gen ÷ cap` 按构造趋近常数，实测极差只有 2.2% |

**已确认无需改动的**：屏的拆分本身（`pv-roi` 保留附表 6 口径、抄表分析独立成 `pv-meter-analysis`）、
模拟器的共享天气因子与种入故障改造（§08 前置，已落地）、`PvRoiView` 卸掉抄表区。

---

## §01 决策清单

下面每一条都是拍过板的。不要重新讨论，不要「优化」成别的。

### 做

| 决策 | 理由 |
|---|---|
| **新屏 `pv-meter-analysis`「光伏分栋分析」**，落 fpNav 分析层「专题分析」组（`pv-roi` 同组，排它后面） | 两套数据源、两套时间维、两套期间语义挤一屏 |
| **`PvRoiView` 保留附表 6 口径的投资回收，卸掉抄表区**（468 行 → ~230 行） | 两屏各自单一口径 |
| **零剔除**：所有数据进模型，所有异常进图 | 剔低辐照日 / `minStations=8` / 整月排除，是把该报的东西扔掉再拿剩下的装作正常。不确定性反映在**区间宽度**上，不反映在样本被删掉 |
| **14 块全部是图**（11 块在屏上，3 块在单栋抽屉） | 见 §06 |
| **绝对基准通道**：板数 × 单块标称 W → 理论装机 kWp | 见 §00 #2 / §03.5 |
| **五条明示判据线 + 命中清单**，全部进参数中心 | 见 §04 |
| **屏上只说明可视化在做什么**，不输出解释性结论 | 见 §05 |
| **`pv_station.metered` 字段** | 「没装表」与「装了表但漏抄」必须分开：前者永久不用管，后者要催人 |
| **模拟器改造与本刀同一刀做**（已落地） | 不改的话新屏永远显示「全部正常」，而你分不清是真没事还是算错了 |

### 不做

| 不做 | 为什么 |
|---|---|
| **任何气象 / 辐照通道** | 用户明确不做天气归因。日筛实测只值 0.21pp；PVsyst / Meteonorm 那套 TMY 数据集要买，买回来等于把外部气象依赖请回来 |
| **告警等级 / 红黄灯 / 金额缺口** | 把三个量压成一盏灯，压缩过程不可见、不可复算、不可反对。红 ¥5,000 / 黄 ¥2,000 这两个旧阈值随之失去落点 |
| **`classifyShape` 五标签 + 建议动作文案表** | BIC 逼着数据挑一个标签，形状不在这五种里就被硬塞；建议文案是话术模板，覆盖不到就是误导。形状交给 §06 S2 样条画出来 |
| **`impliedCapacity` 容量倒推** | 唯一用途是给没铭牌的站占位，但正解是板数 × 标称 W。留着它只会让人忍不住用，然后 `gen ÷ cap` 又变成常数。板数未录的站在 T1 上**不画点**，图注报「n 栋未录」 |
| **12 个月度气候基准常数** | 查过：公开资料只有「佛山年平均日照时数 1629.1h」这类统计，**没有可直接用的逐月水平面总辐射分布**。不编。改用 §03.5 的两级基准 |
| 组串 / 单板级归因 | 楼栋级表计到不了这个粒度 |
| Carpet plot / IEC 61724 产额堆叠柱 / 物理版损失瀑布 / 裸 PR 时序 / 桑基 / I-V 曲线 | 无小时级、无直流侧电量、无组件温度；或行业已收敛到更好形式 |
| 「简易 / 专业」双模式 | 做成模式必然两条计算路径、迟早数字对不上 |
| p / q / 置信区间上第一层 | BH-FDR 必须做，但只当命中清单的假阳性闸门 |

### 开工前的阻塞项

1. **各栋板数与单块标称 W**——13 站现在全空。这两个值是 §03.5 整条绝对通道的输入。
2. 二期/三期**哪些栋有光伏表**——决定第一版覆盖 5 栋还是 13 栋。

> 第 2 项没到位可以先做代码骨架。**第 1 项不影响其余 13 块**：
> 板数未录时 T1 不画点、A1 分母退回 `capacity_kwp` 并在标题写明口径，其余相对通道完全不受影响。

---

## §02 数据模型

三个 migration。仓库当前最大版本 **V116**（`ls backend/src/main/resources/db/migration/`）。

> **初版留下的两个天气 migration 已删**（`V117__weather_hour.sql` / `V119__weather_switch_params.sql`，见 f1eb293）。
>
> **`V118__pv_station_metered.sql` 保持原号不动，新的往后加。** 本文件早先写的是「把 metered 前移到 V117」——
> **那条改掉了**：`application.yml` 里 `baseline-on-migrate: false` 且没开 `ignore-missing-migrations`，
> 只要 V118 在任何一个库里跑过，改号就会同时踩两个坑 —— 那个库既报「V118 已应用但本地找不到」，
> 又会把 V117 当成新的待应用迁移去重跑 `ADD COLUMN metered`。
> V117 空号完全无害：Flyway 不要求连号。

> **迁移目录的两条硬规矩**：`baseline-on-migrate=false`，**历史迁移不可改，只能往后加**。
> 版本号在 SQL 和 Java 两处共用（`backend/src/main/java/db/migration/V35__Bill_pay_company_seed.java` 占了 V35），
> 起号前先 `ls` 确认最大值没变。

### V118 · pv_station.metered（已在 checkpoint 里，本节仅存档口径）

```sql
-- V118__pv_station_metered.sql — 该栋有没有装光伏计量表(PV-ANALYSIS-SPEC §02)。
-- 与「装了表但这个月漏抄」是两回事：前者永久、无需催；后者是数据缺口、要催录入。
-- 只靠「有没有抄表记录」判定会把两者显示成同一种灰，该催的和不用催的混在一起。
ALTER TABLE pv_station ADD COLUMN metered TINYINT UNSIGNED NOT NULL DEFAULT 1
  COMMENT '1=已装光伏计量表 0=未安装(不入任何分析，护栏分母排除)' AFTER phase;

-- 一期确认：B座 / C、D座 / E座 / F座 / G座 五站有表(电网后台设备树实证)。
-- 二期 8~13栋、三期 创业/工业大厦：现场核实前保持默认 1，核实后单独 UPDATE。
```

### V119 · pv_station 板数与单块标称 W

```sql
-- V119__pv_station_panel.sql — 组件台账两列(PV-ANALYSIS-SPEC §02/§03.5)。
-- 理论装机 kWp = panel_count × panel_watt ÷ 1000，是**唯一不从发电量倒推**的容量口径。
-- 没有它，效率 = 发电 ÷ 倒推容量 按构造趋近常数(实测 13 站极差仅 2.2%)，横比整个是假的。
-- 一栋一个 panel_watt：分布式屋顶一个屋面一种型号是常态，分期扩建才混装。
-- 混装的栋填主力规格 —— 它会在 T1 上超 ±3% 线显示成偏离，那正是要人去看的信号，
-- 不是要建模的复杂度。真出现三栋以上混装再开子表。
ALTER TABLE pv_station
  ADD COLUMN panel_count INT UNSIGNED NULL COMMENT '光伏板数量(块)；空=未录' AFTER capacity_kwp,
  ADD COLUMN panel_watt  DECIMAL(7,1) NULL COMMENT '单块标称功率 W(出厂铭牌)；空=未录' AFTER panel_count;
```

`PvStation.java` / `PvStationDTO.java` / `PvStationReq`（请求 record）同步加两个字段
（实体里裸写，靠 `map-underscore-to-camel-case`）。

写端点已有：`PvMeterController` 的 `PUT /pv-meter/stations/{id}`。
`PvMeterService.updateStation`（:77-89）是**逐行显式 setter**，不是字段白名单 —— 在
`setPriceYuan` 之后补两行 `s.setPanelCount(req.panelCount())` / `s.setPanelWatt(req.panelWatt())` 即可。
**不新增端点，所以 `PermissionRegistry` 不用动。**

### V120 · 年锚点 + 五条判据线

```sql
-- V120__pv_analysis_params.sql — 分栋分析的年锚点与五条判据线(PV-ANALYSIS-SPEC §04)。
-- 全部进参数中心的理由：判据线是**人定的**，只有让用户看得见、改得动，
-- 「越线了」才退回成一句可复算的事实，而不是屏替他下的结论。
INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, mode, note) VALUES
  ('', 'pv_yield_anchor_h',   950,  '', 'from', '年等效利用小时锚点(佛山高明实测≈944h)'),
  ('', 'pv_crit_resid',       0.10, '', 'from', '月残差中位数判据线 ±'),
  ('', 'pv_crit_disp_ratio',  1.5,  '', 'from', '月离散度判据线=园区同月中位σ的倍数'),
  ('', 'pv_crit_cover_month', 0.90, '', 'from', '月抄表覆盖率下限'),
  ('', 'pv_crit_ledger',      0.03, '', 'from', '台账与理论装机差判据线 ±'),
  ('', 'pv_crit_yield_ratio', 0.85, '', 'from', '年等效小时/锚点 下限');
```

`backend/src/main/java/com/park/demo3/service/ParamRegistry.java` 的 `static{}` 里六行相邻登记：

```java
// S_GLOBAL_ONLY 全仓尚无(现有 S_GLOBAL_ZONE / S_ZONE 等 8 个，:30-37)，本刀新建，
// 与它们同处、在 static{} 之前。
private static final Set<ScopeKind> S_GLOBAL_ONLY = EnumSet.of(ScopeKind.GLOBAL);

alloc("pv_yield_anchor_h",   "光伏年等效利用小时锚点", "小时", Group.CONSTANT, S_GLOBAL_ONLY, "from", false,
    ValueKind.NUMBER, null, null, "本地实测值，已含组串损耗、逆变器效率、线损、温度与积灰", null);
alloc("pv_crit_resid",       "分栋 月偏离判据线",      "",    Group.CONSTANT, S_GLOBAL_ONLY, "from", false,
    ValueKind.RATE,   null, null, "该栋该月比全园当日基准低或高超过这个比例，就在清单里记一行", null);
alloc("pv_crit_disp_ratio",  "分栋 月波动判据线",      "倍",  Group.CONSTANT, S_GLOBAL_ONLY, "from", false,
    ValueKind.NUMBER, null, "园区同月中位波动 × 本倍数", "不设固定百分比：波动的量纲跟园区自身规模走", null);
alloc("pv_crit_cover_month", "分栋 月抄表覆盖下限",    "",    Group.CONSTANT, S_GLOBAL_ONLY, "from", false,
    ValueKind.RATE,   null, null, "低于这个比例，该月的统计不再进判据，只在清单里记一行", null);
alloc("pv_crit_ledger",      "分栋 台账差判据线",      "",    Group.CONSTANT, S_GLOBAL_ONLY, "from", false,
    ValueKind.RATE,   null, "台账容量 与 板数×单块标称功率 的相对差", "组件功率公差本身只有 0~+3%", null);
alloc("pv_crit_yield_ratio", "分栋 年等效小时下限",    "",    Group.CONSTANT, S_GLOBAL_ONLY, "from", false,
    ValueKind.RATE,   null, "年等效小时 ÷ 年锚点", "低于这条线，连最坏的组件质保衰减都解释不了", null);
```

> **四个会让 CI 变红的坑**
> ① `ParamPermissionSplitTest` 钉死 `group==MONTHLY ⟺ monthlyCheck==true`。
> 这六个键是长期常量 → `Group.CONSTANT` + `monthlyCheck=false`，写 `true` 会红。
> ② `DEFS` 是 `LinkedHashMap`，登记顺序 = 前端 `frontend/src/utils/paramRegistry.ts` 的 `PARAM_DEFS` 数组顺序，
> **前端 spec 逐位比对**。两边必须在同一位置插入这六行。
> ③ **`ParamRegistryTest.SPEC_KEYS` 是白名单，且有反向断言**
> （`for (Def d : ParamRegistry.all()) assertTrue(spec.contains(d.key()), ...)`，:54）。
> 只加注册表不加 SPEC_KEYS → `allSpecKeysRegistered` 红。
> ④ **前端 spec 比的是后端导出的 fixture**：`ParamRegistryTest.exportJson` 写 `backend/target/param-registry.json`，
> 要手工拷成 `frontend/src/utils/__fixtures__/param-registry.json`；`paramRegistry.spec.ts:24` 还写死了
> `PARAM_DEFS.length`（**45 → 51**）。
>
> **文案铁律**：`ParamRegistryTest.FORBIDDEN = /(building:|rule:|meter:|tenant:|默认·所有月份|_)/`
> 作用于 label / formula / hint / 枚举文案。上面六行的 formula / hint 都写成人话，不带字段名。

---

## §03 公式层

全部统计在前端纯函数里算。13 站 × 365 日 ≈ 4700 个点，中位数抛光 + 检验在浏览器里是毫秒级，
**没有理由为它加后端接口**。取数走既有的 `GET /api/pv-meter/readings?year=`（month 可空 = 全年），零改动。

- `frontend/src/views/analysis/pvMeterAna.logic.ts` —— 全部纯函数。无 Vue 依赖、无 IO、可单测
- `frontend/src/views/analysis/pvMeterAna.logic.spec.ts` —— 每个函数配已知答案的夹具

房内惯例（照 `pvRoi.logic.ts`）：文件头一行注释写「屏名 + 口径 + 单测文件名」，
每个导出函数上方一段中文注释写清**口径与边界**（缺数怎么办、除零怎么办），类型与函数交替排列。

```ts
export interface DayRow { stationId: number; date: string; gen: number }
export interface StationCfg {
  id: number; name: string; phase: number; metered: boolean
  capKwp: number | null          // 台账 capacity_kwp
  panelCount: number | null      // 板数
  panelWatt: number | null       // 单块标称 W
}
```

### 3.1 中位数抛光（保留，改门槛）

模型 `eff(s,d) = α(s)·β(d)·ε`，取对数变可加。**用中位数不用最小二乘**：某站表坏报 0 时，
均值基准会被整体拉塌，于是所有站看起来都「高于基准」，真正的故障站反而不报警。

```ts
export interface PolishResult {
  mu: number
  alpha: Map<number, number>              // log 域，站固有水平
  beta: Map<string, number>               // log 域，当日全园因子
  resid: Map<number, Map<string, number>> // 残差
  iterations: number
  converged: boolean
}

/** Tukey 中位数抛光。迭代到收敛，**显式重锚** —— 不要依赖迭代的隐式性质。
 *  可辨识性：(mu, α+c, β−c) 同解，靠 median(α)=0 / median(β)=0 锚定。 */
export function medianPolish(rows: DayRow[], stations: StationCfg[]): PolishResult
// 1. 建 log(eff) 矩阵，跳过 !metered / 分母为空 / gen<=0（**不补齐**）
// 2. while (iter < 20 && maxDelta > 1e-8) { 扫行中位数 → 扫列中位数 }
// 3. 显式重锚：mu += median(alpha); alpha -= median(alpha); 同理 beta
// 4. converged = (iter < 20)
```

> **`okDays` 入参取消（本版改动）。**初版有 `minStations = 8`、不足则整日剔除，
> 实测把 1–5 月的 151 天整段剔光了 —— 那五个月园区只有一期 5 栋，5 栋照样能互比，只是区间更宽。
> 改成**用当天实际在网的栋数**；**在网栋数 < 3 时该日不出 β**（中位数无意义），
> 但那天的原始值照常进 §06 L3 的所有账面图。
>
> **`gen = 0` 有两种相反含义，必须物理分开**：表离线 → NaN（**绝不能用拟合值补齐**，补了残差恒为 0，
> 离线 10 天的楼会算出「正常」）；有太阳却发 0 → 停机事件，进 D2 覆盖矩阵，不进 log 域连续模型。

> **这套方法结构性看不见的两件事**
> ① **全园同时变差**会被完全吸收进 β(d)，残差纹丝不动。
> ② **一直就差的楼**只看变化不看水平，会被 α(s) 吸收，残差居中。
> **这两条正是 §03.5 绝对基准通道存在的理由** —— 补上它之后这两个盲区都消失，
> 剩下的唯一盲区是遮挡 / 朝向 / 倾角造成的先天差异，而那条本来就该用户去查。

### 3.2 稳健尺度与显著性（保留）

> **√N 是这套方法最大的数学错误。** 光伏日残差自相关 ρ≈0.3–0.6，方差膨胀 (1+ρ)/(1−ρ)。
> ρ=0.5 时你以为 p=0.05，**实际 p=0.25**。`z = r̄·√N/σ` 会让 p 值乐观 1–3 个数量级。

```ts
/** 稳健尺度：用**一阶差分**估噪声，对阶跃和慢漂移几乎免疫。
 *  直接对 r 取 MAD 的话，基线若含故障期 → 分子被拉小、分母被撑大 → 双杀，
 *  结果是**越坏的楼越不报警**。 */
export function robustSigma(r: number[]): number

/** 跨栋收缩 + 下限。13 栋是免费信息；下限防电表读数取整导致 MAD=0 → z=∞。 */
export function shrinkSigma(sigmaS: number, sigmaPool: number, floor: number): number

/** 循环分块自助：块长 = 去相关时间的 2~3 倍(光伏取 14~21 天)。**单侧**。
 *  p = (1 + #{null <= obsMean}) / (B + 1) —— 两处 +1 不是洁癖：省掉会得到 p=0。 */
export function blockBootstrapP(
  baseline: number[], obsMean: number, winLen: number,
  opts?: { block?: number; B?: number; seed?: number },
): { p: number; nullDist: number[] }

/** Benjamini–Hochberg。**本版角色已换**：不再服务于金额门槛，改成防 §04 命中清单的假阳性洪水。
 *  族的大小 = 13 栋 × 5 条判据 = 65 次判定。 */
export function bhFdr(pvals: number[], q?: number): boolean[]
```

### 3.3 变点（保留）

```ts
/** 单变点扫描。max|t| **不服从 t 分布**(布朗桥型极值分布)，直接查 t 表虚警率从 5% 飙到 40%+。
 *  零分布用**循环分块置换**——逐日置换会摧毁自相关，零分布被压得过窄。
 *  两端修剪 15%，用**合并方差**不用 Welch。 */
export function changePoint(r: number[], opts?: { block?: number; B?: number; trim?: number }): {
  index: number
  ciLo: number; ciHi: number    // ← **必须给区间**。argmax 有赢家诅咒，中等效应下 95% CI 常有 ±3~4 周
  p: number
  dropPct: number               // 去偏：奇数日找变点、偶数日估落差(样本分割)
}
```

> **主统计量 = 变点检验，不是「最后 N 天窗口 vs 整条基线」。**
> 故障一旦占掉大半观测期，抛光把那个水平吸进 α，基线里也全是故障期 —— 观测窗口一点都不「极端」。
> 变点检验对它免疫：一次扫遍所有切分点，且 max|t| 的零分布本来就用循环分块置换算过。
> 参数：`block=14, B=999, seed=20260831`，提前终止 `earlyGe=30`，CI 取 `|t| ≥ max−2` 的连续段。

### 3.4 逐月量（新增三个）

```ts
/** 逐栋逐月响应斜率：log gen = α + β·f(d) + ε，f = 全园当日 log 因子。
 *  Huber 稳健拟合防单点主导。返回 β、标准误、R²、样本数 —— 后三者决定图上误差带画多宽。 */
export function responseSlopes(
  rows: DayRow[], polish: PolishResult, by: 'year' | 'month'
): Map<number, { key: string; beta: number; se: number; r2: number; n: number }[]>

/** 逐栋逐月稳健离散度，给 §06 M2 方差热力矩阵。一阶差分 MAD，防基线含故障期双杀。 */
export function monthlyDispersion(polish: PolishResult): Map<number, Map<string, number>>

/** 限制性立方样条：对单栋残差拟合平滑趋势 + 95% 置信带，节点取时间分位数(默认 4)。
 *  **它是 classifyShape 五标签的替代品**：不预设 flat/step/ramp，曲线自己长出来，形状由看的人自己判。
 *  节点数固定，不给用户调 —— 让他调节点等于让他调出想要的结论。 */
export function rcsTrend(
  resid: { date: string; v: number }[], knots?: number
): { date: string; fit: number; lo: number; hi: number }[]
```

### 3.5 绝对基准通道（新增，本版核心）

```ts
/** 理论装机 kWp = 板数 × 单块标称 W ÷ 1000。
 *  **唯一不从发电量倒推的容量口径** —— 它一进来，效率横比才是绝对量。
 *  两列任一为空返回 null：这栋在 T1 上不画点，在 A1 上分母退回 capKwp 并在标题写明口径。 */
export function theoreticalKwp(st: StationCfg): number | null {
  return st.panelCount && st.panelWatt ? (st.panelCount * st.panelWatt) / 1000 : null
}

/** 年等效小时 = Σ全年发电 ÷ 分母。分母优先理论装机，退回台账容量。
 *  与年锚点(参数 pv_yield_anchor_h，默认 950h)的比值就是 §04 第五条判据。 */
export function annualYieldHours(rows: DayRow[], denomKwp: number): number
```

> **月度基准分两级，本版最重要的一处诚实。**
>
> 「日效率低于 X 连续 N 天」这类判据**在日粒度上不成立**——阴天 0.5 kWh/kWp、晴天 5.0，都正常，
> 日阈值就是个天气报警器。月粒度才稳定，但那需要 12 个月度基准数，而**这 12 个数今天拿不到**（§01 不做）。
>
> 所以：
> - **年粒度，今天就能用** —— `annualYieldHours ÷ pv_yield_anchor_h`。锚点仓里已有：
>   `PvMeterService.HOURS = 950`，注释「佛山高明区分布式实测年等效利用小时 ≈ 944h」。
>   它是**实测值**，已经含了组串损耗、逆变器效率、线损、温度、积灰 ——
>   **不要**拿「辐照 × 组件效率」自己推，那要再引入一个系统效率假设。
> - **月粒度，第二年起自动出现** —— 基准 = 本园区自己的历史月度实际（附表 6 是真账）。
>   第一年 A1 只画形状不画基准线，屏上明写「本年无月度绝对判据」。
>
> **逐年 kWh/kWp 现在就要落表**。组件线性质保通常首年 1–2%、之后每年 0.4–0.55%，
> 而年辐照的年际波动是 ±3–5% —— 单年比完全淹没，要 3–5 年斜率才分得出来（衰减单调，辐照波动零均值）。
> 衰减包络今天产出为零，但**别等三年后再回来改数据结构**。
>
> **T1 一天都不用等**：「台账 kWp vs 板数 × 标称 W」是纯台账算术，不要气候常数也不要历史数据。

### 3.6 删除清单

```
okDaySet()  hoursContiguous()  clearSkyCheck()  parkHealth()      // 气象通道
gapMoney()  rectifyFloorKwh()  alertLevel()                       // 缺口金额与告警等级链
RISK_ANNUAL_GAP  WATCH_ANNUAL_GAP                                 // 两个金额门槛
classifyShape()  + 形状→建议动作 文案表                            // 话术模板
impliedCapacity()                                                 // 容量倒推，见 §01
cohortSlopeTest()                                                 // M3 共用 y 轴 + β=1 参考线已答同一问题
```

---

## §04 判据线与命中清单

### 4.1 为什么是「摊开」而不是「取消」

`alertLevel` 把「显著性 × 持续天数 × 年化金额」**压成一盏灯**——压缩过程不可见、不可复算、不可反对。
「F座 8–12 月残差中位数 −25%，判据线 ±10%」是**摊开的**：数在这、线在这，用户不同意可以直接说线画错了。

**这没有消灭判定，只是把判定变透明了。** 好处是线画在屏上、可以被反对；代价是线还在。
五条线全部落参数中心（§02 V120），屏上写明当前值。

### 4.2 五条线的定值与依据

| 判据 | 参数键 | 定值 | 依据 |
|---|---|---|---|
| 月残差中位数 | `pv_crit_resid` | **±10%** | 借国内组串离散率的分档惯例（0–5% 稳定 / 5–10% 良好 / **10–20% 有待提高** / >20% 较差）。10% 是运维平台开始上心的那条线 |
| 月离散度 | `pv_crit_disp_ratio` | **1.5 × 园区同月中位 σ** | 不设固定百分比：这里的 σ 是**日间残差波动**，与组串电流离散率不是一个量纲，借那个数会错标度。相对园区自身取值是尺度无关的 |
| 月抄表覆盖 | `pv_crit_cover_month` | **≥ 90%** | 「这个月的统计还算不算数」的常见闸门 |
| 年在网天数 | 常量 90 | **≥ 90 天，否则判「读不出」** | 实测三期 31 天外推会偏 13 倍 |
| 台账差 | `pv_crit_ledger` | **±3%** | 组件功率公差本身只有 0 ~ +3%。超过 3% 公差解释不了 —— 录入错、规格记错，或混装 |
| 年等效小时 | `pv_crit_yield_ratio` | **≥ 锚点 × 85%**（950 × 0.85 = 807h） | 两个独立来源都指向 85%：设计 PR 0.80 掉到 0.68 约是 85%；组件 25 年线性质保末端也在 ≥84.8% 附近。**掉到这条线以下，连最坏的质保衰减都解释不了** |

> **残差那条要按实际分布回校。** 上线后一次命中超过 3 栋，说明线画太紧，不是园区一起坏了。
> 回校写进 §08 验收。

### 4.3 命中清单的三条硬规矩

```ts
export type Hit = {
  stationId: number
  criterion: 'resid' | 'disp' | 'cover' | 'ledger' | 'yield'
  value: string      // 实测值，已格式化
  line: string       // 判据线，已格式化
  readable: boolean  // false = 样本不足，读不出，既不是命中也不是未命中
}
export function criteriaHits(...): Hit[]
```

1. **只列命中的，不列「正常」的。** 屏做不到「正常」这个保证 —— 它看不见遮挡 / 朝向 / 倾角造成的先天差异。
   清单底部固定一句：**未列出 ≠ 没问题**。
2. **按楼栋固定顺序（`sort_no`），不按严重度排。** 一排序就要选排序键，选了排序键就是在说
   「这个比那个严重」—— 残差 −25% 和覆盖率 31/365 哪个更严重，屏答不了，那是业务判断。
   一栋命中多条就多几行，那是事实不是排名。
3. **必须有第三档「读不出」。** 31/365 天既不是命中也不是未命中。措辞用
   **「未低于你设的线」**不用「正常」——阈值是用户设的，后者更准，也让人随时想起那条线可以改。

**第一年只有前四条能命中**，第五条要满一年才算得出来，那一行显示「读不出」。

---

## §05 说明文案规范

**屏只说明可视化在做什么，不输出解释性结论。** 这一条约束整屏所有图注、标题、悬停与空态。

| 屏上能写 | 屏上不能写 |
|---|---|
| 图种（热力矩阵 / 横向条形 / 散点） | 诊断结论（「阶跃下降」「一直偏低」） |
| 坐标轴含义与单位 | 成因归因（「不是天气」「灰尘积累」） |
| 色阶、留白、断线的含义 | 建议动作（「现场检查」「可安排清洗」） |
| 数据来源与条数、样本天数 | 严重度判词（正常 / 异常 / 需关注） |
| 区间／误差带代表什么、为什么这里宽 | 反事实金额（「比应得少 ¥」） |
| 判据线画在哪、当前值是多少 | 话术模板拼出来的「情况」说明 |

**一句话边界：数据里直接读得出来的是事实，可以写；要过一个模型才得出的是结论，不写。**
「该月中位数是 −25%」是事实；「这栋坏了」是结论。屏出前者。
判据线是唯一的例外 —— 它是人定的，但只要**线本身画在屏上**，「越线了」就退回成一句可复算的事实。

| ✓ | ✗ |
|---|---|
| 该格 = 该栋该月残差中位数；红 = 低于全园当日基准 | F座 7/18 起阶跃下降 |
| 该月 12 / 30 天有抄表记录 | 漏抄严重，需催录入 |
| 留白 = 该月尚无抄表记录；灰 = 该栋未装计量表 | 该栋无需关注 |
| 对角线 = 台账与铭牌相等；点离对角线越远，两者差得越多 | 台账疑似写错，建议核对 |

命中行统一**三段式**：`哪个数 · 多少 · 跟什么比`。三段齐了就没有解释空间。

```
F座        月残差中位数   8–12 月 −25%              判据线 ±10%
13栋       台账差         340 vs 理论 675（−50%）    判据线 ±3%
13栋       月离散度       6 月 σ 41%                园区同月中位 × 1.5 = 33%
工业大厦   抄表覆盖       31 / 365 天               判据线 ≥ 90 天 · 读不出
```

---

## §06 页面

`<AnaShell period-mode="year" :compare="CMP">`，`CMP = ['yoy']`（**模块级常量**，与传给 AnaShell 的必须同一份）。

> **AnaShell 的四条硬约束（实测，不是猜的）**
> ① `periodMode='year'` 不写穿粒度单例。屏只能读 `period.sel.value.year`，
> 读 `gran`/`month` 会拿到与界面无关的值，`AnaShell.spec.ts:35` 有断言守着。
> ② `#kpis` 槽的 `v-if` 必须写在 `<template #kpis>` 的**内层**——挂在 template 标签上条件为假会让
> `$slots.kpis` 不存在，容器整条消失、下方内容整体上移。
> ③ `AnaEChart` 的 `height` **只许取 170 / 200 / 250 / 300 / 440** 五个值（`AnaEChart.vue:77`）。
> ④ ECharts option 是纯 JSON，**不能引用 CSS 变量**，颜色只能写字面值。

> **ECharts 是裁剪打包的。** `frontend/src/components/ana/echartsBundle.ts` 的 `use([...])` 里
> **没有 `HeatmapChart`，也没有 `VisualMapComponent`**（文件注释写着「全站无 visualMap」），
> `custom` series 同样未注册。用了会得到空白图加一句控制台警告，而 **jsdom 里测不出来**。
> **156 格矩阵用 CSS Grid 手写**，比进 ECharts 划算（也省掉色阶截断的 visualMap）。
> 误差带用 `markArea` / `markLine`，并**手动设 `xAxis.min/max`**——markLine 不参与轴范围计算。
> 小倍数（M3）用 13 个独立 `grid` 而非 13 个实例，共用一套坐标配置才能保证轴范围一致。

### 6.0 屏头

工具条：年份 · 期 · 同比开关 · `导入抄表`。
下方一条状态横幅，**只陈述事实**：`抄表 N 条 · source 分布 · 13 栋中 n 栋已录板数与单块标称 W`。

### 6.1 L1 · 相对偏离（栋跟栋比）

同一张 13×12 网格，三层叠看 —— **共用行标签、共用网格几何**是这一层唯一的设计要点。

| # | 块 | 图种与编码 | 实现注意（不上屏） |
|---|---|---|---|
| M1 | **月度偏离** | 13×12 热力矩阵 · 发散配色零居中 · 红=低于基准 蓝=高于 白=贴基准 · 留白=当月无抄表 | 色阶按 ±P95 截断，越界格加对角纹；悬停给真值；点格下钻 L5。**残差符号按期分裂时打「基准可能被拽偏」横幅**——多数派把基准拽偏是中位数崩溃点现象，不能只靠图注让用户自己推 |
| M2 | **月度离散度** | 同一网格 · 顺序配色单向深浅（离散度没有方向）· 深=该栋该月日间波动大 | 一阶差分 MAD 对**缓慢漂移不敏感**，那类形状归 L5 的 S2 / M4 |
| D2 | **数据覆盖** | 同一网格 · 深浅=该月有抄表天数 ÷ 当月天数 · **留白（未投产）与灰（漏抄）两种视觉** | 月聚合会把「连续缺 10 天」和「零散缺 10 天」显示成同一深浅，悬停给该月最长连续缺失段 |
| F1 | **判据命中清单** | 列表（非表格）· 三段式 · 按 `sort_no` 排 · 点行高亮网格对应格 | 见 §04.3。位置在三张网格**下面**——先看图，再看索引；放上面就变回先给结论 |

### 6.2 L2 · 绝对水平（跟标称比）

| # | 块 | 图种与编码 | 实现注意（不上屏） |
|---|---|---|---|
| A1 | **绝对效率轨迹** | 折线 · x=月，y=月等效小时 kWh/kWp（**分母 = 理论装机**）· 细线=各站 粗线=全园加权 · 右上角标年累计等效小时与锚点的比值 · 虚线阶梯=月度基准（**第二年起才有**）· 灰带=逐年衰减包络 | 基准分两级见 §03.5。第一年只画形状，图上明写「本年无月度绝对判据」 |
| T1 | **台账 vs 理论装机** | 散点 13 站 · x=理论装机 kWp（板数 × 标称 W）· y=台账 `capacity_kwp` · 对角线=两者相等 · 灰带=±3% | 点到对角线的距离就是台账与铭牌差多少。**未录板数或标称 W 的站不画点**，图注报「n 栋未录」。录入 UI 已存在（`PvMeterView` 编辑模式行内 input），加两格即可。**不标黄、不排序、不判定**，越线的进 F1 |

### 6.3 L3 · 账面量（从 PvRoiView 迁回）

| # | 块 | 图种与编码 | 实现注意（不上屏） |
|---|---|---|---|
| R1 | **消纳结构** | 三段堆叠柱 + 损耗率折线（副轴**固定 0–3%**）· 柱高=万 kWh，三段=自消纳/上网/损耗 | 中间那段（上网）没有公共基线，比上网量切到 R2。副轴范围固定不自适应：两个 y 轴的刻度能造出任意视觉相关性 |
| R2 | **各站消纳收益** | 分组柱（并排，非堆叠）· 深=消纳收益（录入时单价快照）浅=上网收益（参数价）· 万元 | 两种单价口径不同，并排能让人看出这一点，堆叠会糊掉。标题旁写明这是**绝对额不是效率** |
| R3 | **各站发电效率** | 横向条形 · 13 站 · 按期分色 · 期内基准竖线 · x=kWh/kWp | **分母换成 A1 的理论装机**后这些条才是绝对量（用倒推容量时按构造几乎等长）。标题写明分母口径。改横向：13 个中文楼栋名纵向柱标签要斜排 |
| R4 | **效率月度趋势** | 折线 + 面积 · 全园加权一条，可叠加单站 · x 轴标各期投产月竖线 | 与 A1 的区别：R4 是**相对形状**（看季节合不合理），A1 是**绝对水平**（跟基准线比）。两块都要，别合并。投产月竖线是台账事实不是解释 |

`self_use` / `grid_feed` / `price_snap` 在 `V37__pv_reading.sql` 里都有，**R1 / R2 零容量依赖**——
在板数与铭牌录进来之前，这两块是唯一能出真数的图。

### 6.4 L4 · 逐栋曲线

| # | 块 | 图种与编码 | 实现注意（不上屏） |
|---|---|---|---|
| M3 | **响应斜率小倍数** | 13 个迷你折线排成网格 · x=月，y=该月 β · 虚线=β 等于 1 · 淡带=±1SE · **共用同一 y 轴范围** | 共用轴是小倍数的命门，各自缩放就没法比。样本少的月 SE 带要宽到肉眼可见，**把「读不出东西」也画出来** |

### 6.5 L5 · 单栋抽屉

点 F1 的行、网格的格，或 M3 的迷你图打开。**同一个 URL 加锚点，不是另一套页面**；未选中站时整区不渲染（不是渲染空态）。

| # | 块 | 图种与编码 | 实现注意（不上屏） |
|---|---|---|---|
| S2 | **样条趋势** | 残差散点（淡）+ RCS 拟合曲线 + 95% 置信带 · 4 节点取时间分位数 · 零线加重 | `classifyShape` 的替代品：不预设形状，曲线自己长出来。节点数固定，不给用户调 |
| S3 | **变点与置信区间** | 残差折线 + 变点竖线 + CI **阴影带** + 前后两段水平中位线 | 阴影带不用误差棒——它是一段区间，误差棒会被读成「精确到某天再加减几天」。缺数日**断开不连线**（二期 1–5 月尚未投产）。两个变点时带子变宽，**不强行判一个** |
| M4 | **残差控制图** | 残差时序 + 中心线 + ±2σ / ±3σ 控制限 · 越限点加大加深 · 连续 7 点同侧另标 · 画出控制限的估计窗口 | 控制限用**变点前段**估（全期估会被故障撑宽，什么都不越限）。σ 用差分 MAD 不用样本标准差。越限只是**标记点**，不出文案 |

---

## §07 护栏

每一条都必须显式暴露，不许静默处理。这是本产品既有的文化。

| 情形 | 处理 | 为什么不能静默 |
|---|---|---|
| 该栋没装光伏表 `metered=0` | 抄表屏显灰「未装表」+ 容量单价禁用 + 不开抽屉；分析屏整站不出现 | 与「漏抄」是两回事 |
| 站未录板数或单块标称 W | T1 不画点，图注报「n 栋未录」；A1 / R3 分母退回 `capacity_kwp` 并在标题写明口径 | 用倒推容量当分母而不说明，横比整个是假的 |
| 当日在网栋数 < 3 | 该日不出 β，但原始值照常进 L3 所有账面图 | 中位数在 n<3 时无意义；但那天的发电量是真数据，不该消失 |
| 某站在网 < 90 天 | F1 里显「读不出」，不出任何判据结论 | 显「未低于线」就是假绿，**这里最容易出** |
| 某站某月覆盖 < 90% | F1 记一行；D2 该格变浅 | 覆盖不足的月份统计不可信，但它本身是要报的事实 |
| 只有月抄的站 | 标注「月频口径」，**不与日频站混排** | N=12 与 N=247 的置信区间差一个量级 |
| 上一年无抄表 | 同比位显 `—`，不显 `0%` | 0% 意味着「持平」，—— 意味着「没得比」 |
| 同比跨年月份不齐 | 按**两年都有抄表的月**对齐后再比，报出参与月数 | 2025 全年 vs 2024 的 5 个月，整年求和虚高 100%+ |
| 整年无抄表 | 整屏 `AnaEmpty` 深链 `/pv-income` | 既有护栏范式，不画假图 |
| 第一年（无历史月度基准） | A1 只画形状不画基准线，图上明写「本年无月度绝对判据」；F1 第五条显「读不出」 | 画一条编出来的基准线，比不画更坏 |

---

## §08 验收

### 前置：模拟器改造（已落地，不要回退）

`PvMeterService.simulate` 原有两处结构性质正好把要检测的信号全部抹平：日权重种子含站 id
（每站各晒各的太阳，没有共享 β(d)）、月量严格按容量占比拆（`eff(s)` 同期内恒等）。
后果是**残差退化成纯独立噪声，新屏永远显示「全部正常」**。

改造后：日权重 = **全园共享天气因子**（`new Random(year*100 + month)`，**不含站 id**）× 站内小扰动 ×
种入故障逐日系数；站间拆分权重 = 容量 × 种入故障**月系数**（= 逐日系数的月内均值）。
**两处都要打**，只打日权重的话整月同乘一个数分子分母对消，故障出了当月就完全看不见。
`simulateDays` 的「末日补差保 Σ日 = 月真实值分毫不差」必须保留 —— 月度恒等是既有断言。

种入的靶子：`FAULT_STATION = "F座"`，7/18 起，`FAULT_FACTOR = 0.72`（阶跃 −28%）。

### 阳性对照 —— 初版验收缺的那一条

初版验收只有阴性对照（「健康站不误报」）。**必须补阳性对照**，而且这是本刀第一步就要跑的：

按上面的口径算，8 月 F 座权重 `0.15 × 0.72 = 0.108`，一期五站权重和 `0.958`，
F 座实得 `0.1127` / 应得 `0.15` = **−24.9%**，其余四栋各 **+4.4%**。
α 取全年中位（199 个正常日 > 166 个故障日）落在正常段，所以：

> **F 座 8–12 月的月残差中位数必须稳定在 −25% 左右，在 M1 上是连续 5 格暖色，并在 F1 里有一行。**

初版设计稿里那张实测热力矩阵 F 座整行是 `+0 / +0 / +2 / +0 / +1 / +4` ——**靶子一格都没亮**。
原因要么是测的库在加故障之前（simulate 没重跑），要么是管线抓不到这个阶跃。
**哪一种都得先查清**：一个连自带阳性对照都不亮的检测屏，「命中数为 0」说明不了任何事。

### 验收标准

1. **阳性对照** —— 上面那条。变点日期落在种入日 **±3 周**内即算通过（不是 ±3 天，argmax 的 CI 本来就那么宽）。
2. **阴性对照** —— 零故障合成园区上，五条判据的命中数必须为 0。
3. **验收数字钉在提交进仓的夹具上，不是「当前库」。** simulate 一重跑，钉着实测值的断言就全变。
4. **零剔除** —— 进模型天数必须是 365 不是 214；1–5 月的 β 必须存在。恢复 `minStations` 门槛必须让这条红。
5. **判据线可改** —— 参数中心改 `pv_crit_resid` 后，F1 的行数必须跟着变；屏上显示的判据线数值必须同步。
6. **回校闸门** —— 默认线下一次命中超过 3 栋，测试输出一条告警提示「线可能画太紧」（§04.2）。
7. **绝对通道降级** —— 板数置空后：T1 该点消失且图注计数 +1；A1 / R3 分母退回台账并在标题写明口径；
   **其余 11 块完全不受影响**。
8. **逐条破坏验证** —— 每个断言逐条注掉/改反，确认它真的会红。**前置不足 = 假绿**——
   尤其是「在网 < 90 天不出结论」和「在网栋数 < 3 不出 β」这两条。
9. **热力矩阵真的渲染** —— jsdom 测不出 ECharts 漏注册，所以 M1/M2/D2 走 CSS Grid，
   单测直接断言 156 个格子节点存在、`c-na` 格数等于未投产月数。
10. **权限** —— `PermissionCoverageTest` 绿。本刀**不新增写端点**（板数/标称 W 走既有
    `PUT /pv-meter/stations/{id}`），`PermissionRegistry` 无需新增行。
11. **参数一致** —— `ParamRegistryTest` 绿；`param-registry.json` fixture 已同步；
    `paramRegistry.spec.ts:24` 的 `PARAM_DEFS.length` 45 → **51**。
12. **导航与路由计数** —— `fpNav.spec.ts` 的屏数断言 50 → 51（:5 文案 + :7 + :11）；`routeMap.spec.ts` 绿。

---

## §09 文件清单

### 先删（初版留下的未提交改动）

```
backend/.../db/migration/V117__weather_hour.sql
backend/.../db/migration/V119__weather_switch_params.sql
backend/.../entity/WeatherHour.java          backend/.../mapper/WeatherHourMapper.java
backend/.../dto/WeatherDayDTO.java           backend/.../dto/WeatherImportRequest.java
backend/.../service/WeatherService.java      backend/.../controller/WeatherController.java
backend/.../test/api/WeatherApiIT.java
frontend/src/api/weather.ts                  frontend/src/utils/weatherExcel.ts(+spec)
```

四处联动回退：`ParamRegistry`（三个天气键 + `WEATHER_SOURCE_OPTS`）、
`frontend/src/utils/paramRegistry.ts` 的 `PARAM_DEFS`、`param-registry.json` fixture、
`PermissionRegistry` 的 `/api/weather/**` 一行、`importRegistry.ts` 的 `key='weather'` 条目
与 `importRegistry.spec.ts:28` 的 24 → 25（**改回 24**）。

### 新建

| 文件 | 内容 |
|---|---|
| `resources/db/migration/V119__pv_station_panel.sql` | §02 |
| `resources/db/migration/V120__pv_analysis_params.sql` | §02 |
| `src/views/analysis/PvMeterAnaView.vue` | §06 五层 14 块 |
| `src/views/analysis/pvMeterAna.logic.ts` | §03 全部公式 |
| `src/views/analysis/pvMeterAna.logic.spec.ts` | 每个函数配已知答案夹具 |
| `src/views/__tests__/pvMeterAnaScreen.spec.ts` | §08 验收 |
| `src/views/analysis/__fixtures__/pvMeterAna-2025.json` | §08.3 钉验收数字用 |

### 修改

| 文件 | 改什么 |
|---|---|
| `java/.../entity/PvStation.java` · `dto/PvStationDTO.java` · `PvStationReq` | 加 `metered` / `panelCount` / `panelWatt` |
| `java/.../service/PvMeterService.java` | `updateStation`(:77-89) 补两行 setter；simulate 改造保留 |
| `java/.../service/ParamRegistry.java` | `static{}` 六行 + 新建 `S_GLOBAL_ONLY` |
| `java/.../test/service/ParamRegistryTest.java` | `SPEC_KEYS` 加六个键 |
| `frontend/src/utils/paramRegistry.ts` | `PARAM_DEFS` 同位插六项 |
| `frontend/src/utils/__fixtures__/param-registry.json` | 从 `backend/target/param-registry.json` 拷 |
| `frontend/src/utils/paramRegistry.spec.ts` | :24 的 `PARAM_DEFS.length` 45 → 51 |
| `src/views/pv/PvMeterView.vue` | 未装表行灰徽标 + 禁用 + 不开抽屉；编辑模式加板数 / 标称 W 两格 |
| `src/views/analysis/PvRoiView.vue` | 删抄表区（468 → ~230 行）+ 删 import |
| `src/views/analysis/pvRoi.logic.ts` | 删迁走的 4 个函数与类型（:76-163） |
| `src/views/analysis/pvRoi.logic.spec.ts` | 对应断言迁到新 spec |
| `src/nav/fpNav.ts` | 「专题分析」组加 `pv-meter-analysis`；:1 头注释 49 → 51 |
| `src/nav/__tests__/fpNav.spec.ts` | 屏数 50 → 51（:5 文案 + :7 + :11） |
| **`src/router/index.ts`** | **`VIEWS` 表加一行** `'pv-meter-analysis': () => import('@/views/analysis/PvMeterAnaView.vue')` |

**零改动**：`GET /api/pv-meter/readings?year=`、`importRegistry`（本版不加导入类型）、`PermissionRegistry`。

---

## §10 与初版设计稿的出入（仍然成立的四条）

1. **路由不是自动派生的。** `frontend/src/router/index.ts` 有一张显式的 `VIEWS` 表，
   `fpBuildRoutes()`（`fpNav.ts:86-90`）只产 meta 不产组件。漏配这一行，该屏
   **静默降级成 `PlaceholderView`**，且 `router/routeMap.spec.ts:11` 会红。
2. **fpNav 没有「能源专题」组。** 分析层第 3 组叫**「专题分析」**（`fpNav.ts:60`），`pv-roi` 就在里面（:66）。
3. **`fpNav.ts:1` 的头注释写「49屏×4层」已过时**（实际 50）。加屏时一并改成 51。
4. **`S_GLOBAL_ONLY` 在 `ParamRegistry` 中尚不存在**（现有 `S_GLOBAL_ZONE` / `S_ZONE` 等 8 个，:30-37），本刀新建。
