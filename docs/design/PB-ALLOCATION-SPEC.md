# 公摊分摊与损耗规范（PB-ALLOCATION-SPEC）

2026-07-22 定稿。P-B 刀：把「公共电表分摊到户 + 变压器损耗率收取 + 已/未分摊对账」从手工 Excel（一期/二期水电费工作簿的 公共电分摊明细/公共电数据/园区损耗 三类 sheet + 独立的 公共用电分摊分析.xlsx）搬进系统。**用量唯一来源=P-A meter_reading 派生，本刀只做"规则结构化 + 金额化 + 快照落库 + 对账"这层薄计算**；户级缴费单与实收核销是 P-C，本刀不做。

口径逆向依据（2024年2月真实数据，逐条带 sheet+行列证据，见 §2）：
- 一期链：`一期园区电`(抄表底表) → `公共电分摊明细`(核算,A1:AG98) → `一期园区损耗`(B1:J17) + `一期租户分摊公共用电金额`(收取侧,A1:L91) → `2024年2月公共用电分摊分析.xlsx Sheet1`(对账闭环)。电价源=`创显承担电费!O3`=1.11417（商业基准 0.794169+维护费 0.32）。
- 二期链：`二期园区电` → `公共电数据`(核算,分时电价) → `本月用电数据统计`(实收) → `二期2024年2月公共用电分摊分析.xlsx Sheet1`；损耗走`二期园区损耗`(B1:L14)。`公共电分摊` sheet 是 2023.4-5 历史模板（标题证据 B1/B17），只作算法原型参考，不导入。
- 已知脏数据：`一期租户分摊公共用电金额`标题残留"2024年1月"、二期分摊分析 K27 电价 1.25312 为硬编码常数、二期`公共电数据`M:P 列含 #REF! 断链——建模不依赖标题月份与死列。

## 0. 数据映射总表（Excel → 系统落点）

| Excel 来源（sheet!列） | 系统落点 | 为什么 |
|---|---|---|
| 公共电分摊明细 I:R 行至 / S:W 用量 / H 倍率（=VLOOKUP 一期园区电） | **不落任何新表**，读 meter_reading 派生用量 | P-A 铁律：用量=(curr−prev)×factor_snap 派生绝不落库（MeterService.java:28）；Excel 的 VLOOKUP 链在系统里就是 meter_id 外键 |
| 公共电分摊明细 Z 分摊范围（自由文本 4 形态）+ AA 分摊系数 | `alloc_rule.method + coefficient` + `alloc_rule_member` 受益人清单 | 自由文本是口径最大风险源，结构化为 {类型,受益人集合,系数} 是 P-B 核心（口径结论 §九.1）|
| 公共电分摊明细 AG 备注"电梯用电加170度" 等人工加度 | `alloc_rule.extra_qty` | +170/+100/+200 是人工修正必须保留为可编辑字段，不是脏数据 |
| 创显承担电费!O3 单一价 / 二期园区电!AD10..13 分时价 / 分摊分析 K27=1.09312+0.16 | `alloc_cfg`（月行优先回退默认行，抄 elec_price_cfg 模式） | 单价=供电局月均+0.16 每月变，参数化；**不放 elec_price_cfg**——那是购电/上网侧，语义不同不共表 |
| 一期园区损耗 H 调整损耗 / G 分摊用电度数的人工项(−1500"待调整8500度") / 二期园区损耗 H·I | `alloc_cfg` scope=building 的 `loss_adj_qty`/`loss_adj_rate` 行 | 纯人工数字（0.003~0.018、±度数），是参数不是计算结果 |
| 一期园区损耗 C/D/E/F 与二期 C/E/F（总表vs分表） | **读时派生**，meterGroup 区块 head(infra) 与 sums(tenant+share) 两操作数现成（meterGroup.ts:100,:106-117） | 两个数都已算好，损耗=一行减法；不建第四套损耗框架（CP/PV/parkEnergy 已三套同范式） |
| 公共电分摊明细 AC 分摊标准 / AD 应分摊 + 一期租户分摊公共用电金额 F/H/I 户级收取 + 公共电数据 V/W | `alloc_result`（租户×月×费项，生成时快照） | 分摊金额是要变成催缴账单的钱，读数事后重导不能让已出账数字漂移——全库对钱一律快照（factor_snap/price_snap 同例） |
| 一期租户分摊公共用电金额 I 孵化协议固定收取（手填 I20=63.8） | `alloc_result` source=manual 行（人工覆盖） | 固定收取无公式，只能人工，留痕即可 |
| 分摊分析 Sheet1 E成本量/G成本额/H已分摊/I未分摊 | **损耗与对账段（读时派生屏）**，不落表 | 对账是"看"不是"钱"，recon 风格现算；实收侧(H列引电费总表)本刀没有，P-C 后补实收对账 |
| 公共电分摊 sheet（2023 历史模板，元/层原型） | 不导入 | 当月核算已由公共电数据接管，历史模板只有算法考古价值 |
| 本月用电数据统计 I/J/L73/V73（实收列） | 不做 | 实收=台账/P-C 域，P-B 永不碰收款事实（BILLS-SPEC §1 铁律） |

## 1. 数据模型（V47 迁移，meter/elec_cost/bills 现有 schema 零改动）

### alloc_rule 分摊规则表（≈30 条，人工录入，无导入）
- `id、zone VARCHAR(8)(p1/p2)、name VARCHAR(64)(规则名,如"B座电梯")、building_id INT NULL(FK 楼栋)、method VARCHAR(8)、coefficient DECIMAL(12,2) NULL、extra_qty DECIMAL(10,2) NOT NULL DEFAULT 0(人工加度)、fee_key VARCHAR(24)(出口费项)、note、sort_no、时间戳`
- `method` 四类（=Excel Z 列四形态结构化）：
  - `direct` 单租户整笔（Z14"旭化成A201室"型）——受益人=member 单行；
  - `area` 具名清单按面积（Z15"成吉、合源…"型）——coefficient=受益租赁面积合计㎡（AA15=1734.73）；
  - `floor` 按已出租层数均摊（Z43"B座除首层租户"型）——coefficient=层数，**可小数**（二期 T10=5.8）；
  - `loss` 并入损耗率向全园收取（Z5-Z9"一期园区租户"+AG"计入园区损耗分摊"型）——无 member，走损耗链路；
  - 园区路灯例外（AA10=80000㎡ 园区面积）= `area` 规则 coefficient=园区面积，不设第五类。
- **表绑定走 `alloc_rule_meter(rule_id, meter_id)` 多对多**：一规则多表合并（A座 4 部电梯 AC27、走廊灯+消防灯共系数 AC20/21），meter 表零改动（1100 块表不动刀）。

### alloc_rule_member 受益人表
- `id、rule_id FK(级联删)、tenant_id FK(不级联,409 挡)、weight DECIMAL(6,3) NULL`
- weight 语义随 method：`floor`=该户层份额（默认 1；同层两户对半=0.5，复现 F63=AC56/2；C座二楼多户共享一层填 NULL=层内按面积二次分摊，复现 H55=(AC58+AC61)/AA51×E55）；`area`=忽略（按租户租赁面积/Σ面积，面积原料=V31 面积模型）；`direct`=单行整笔。
- `loss` 规则无 member——受益人=当月有用电量的全部租户，生成时动态取。

### alloc_cfg 参数表（完全照抄 elec_price_cfg「月行优先回退默认行」模式，ElecCostService.resolveCfg 同规则）
- `id、scope VARCHAR(24)(zone 值 p1/p2 或 building:{id})、cfg_key VARCHAR(24)、value DECIMAL(12,6) NULL、acct_month CHAR(7) NULL(空=默认行)、note、时间戳`；uk(scope, cfg_key, acct_month)。
- cfg_key 首批：`price_flat`(一期单一商业价,种子 1.11417=月均+0.16)、`price_sharp/price_peak/price_norm/price_valley`(二期分时,=分时基准+0.16,尖 1.66077/一期,二期尖 1.71987 等)、`price_loss`(损耗计费价,二期 1.25312=1.09312+0.16——K27 硬编码常数收编为月参数)、`loss_adj_qty`(scope=building,人工调整度数,如二期 H4=300/H5=−2500)、`loss_adj_rate`(人工上浮率,一期 0.003~0.018/二期统一 0.002)、`park_share_div`(一期园区公共电均摊栋数=6)。新单价/新参数=加行不加列。

### alloc_result 分摊结果表（粒度=租户×月×费项，生成动作写入=快照语义）
- `id、tenant_id FK(不级联)、ym CHAR(7)、fee_key VARCHAR(24)、rule_id INT NULL(损耗行/manual 行为空)、qty DECIMAL(12,2)(分摊电量)、amount DECIMAL(12,2)、rate_snap DECIMAL(10,6) NULL(损耗率/元每层/元每㎡ 快照)、price_snap DECIMAL(12,6)(单价快照)、source VARCHAR(8)(gen/manual)、note、generated_at`；uk(tenant_id, ym, fee_key)。
- fee_key 对齐真实账单分摊列：`share_elec_fire`(消防)/`share_elec_elevator`(电梯)/`share_elec_light`(路灯公摊)/`share_elec_floor`(楼层公共照明)/`share_elec_loss`(损耗费)/`share_water`(绿化水,枚举先占位首版不生成)。新增费项=新枚举值，零 schema 改动。
- **重新生成=按 ym 先删后插覆盖**（同 meter 导入幂等口径）；source=manual 行（孵化协议固定收取等）生成时保留不覆盖。**表级明细不落库**：抽屉下钻现算（同用量派生口径），与快照不符时标"读数已变，可重新生成"。
- 损耗率不单独建表：率=读时派生（§2.4），人工项在 alloc_cfg，生成时快照进 rate_snap——遵守"派生不落库、钱才快照"全库惯例。

## 2. 计算引擎口径（公式逐条，AllocService 纯函数 + spec 锁 2024-02 锚点）

### 2.1 用量与单价
1. 规则用量 = Σ绑定表的 meter_reading 派生用量：`MeterService.usage(prev, curr, factor_snap)` 提为 public static 直接复用（MeterService.java:47，同 BillsService 复用 LedgerService.recalc 先例）；缺读数=null 跳过并在生成结果 note 标"缺抄"。倍率证据：路灯 H10=30、货梯 H27=20。
2. 一期单一价：AB 列全表=`创显承担电费!O3`=1.11417（B-F 座公共表为直读表无分时，按商业价，分摊分析 B28 注②）→ `alloc_cfg(p1, price_flat, ym)`。
3. 二期分时价：W应分摊=`ROUND(Σ各分时用量×分时价,2)`（W4=L5×U5+L7×U7+L8×U8+L9×U9+L6×U6=141.27，价=二期园区电!AD10..13=分时基准+0.16）→ 二期规则金额按 TOU 五段用量逐段乘 `price_sharp..price_valley`。尖峰行扣尖（L5=行至差×倍率−L6）P-A 读数已按五段存，无需重算。

### 2.2 四类方法金额化（户级）
- `direct`：户金额=`ROUND(用量×单价,2)` 整笔归户（AC14 型）。
- `area`：分摊标准=`ROUND(规则用量/coefficient×单价,2)` 元/㎡（AC15=0.02，AA15=1734.73）；户金额=`ROUND(标准×户租赁面积,2)`（收取侧 F8=AC15×E8）。园区路灯同式 coefficient=80000（AC10）。**A座电梯例外走 area 不走 floor**：AA27=12487㎡、4 部电梯合并（AC27=ROUND((S27+S28+S29+S30)/AA27×AB27,2)=0.08，AG27 注"未完全出租"）。
- `floor` 一期：元/层=`ROUND((规则用量+extra_qty)/层数×单价,2)`（AC43=(S43+S44+170)/3×1.11417=302.50；同型 C座+100、D座+100、F座+200、楼梯间 AC41=(S41+S42)/4）；户金额=元/层×weight（每户一份 H48=302.5；对半 weight=0.5；weight=NULL 层→层内按面积二拆：`ROUND(元/层合计/层面积Σ×户面积,2)`，层面积Σ=member 中该层 NULL 权重户面积合计，复现 AA51=1503.1）。
- `floor` 二期：**先金额后除层**——W=ROUND(Σ分时×分时价,2)，元/层=`ROUND(W/层数,2)`（V10=145.37，T10=5.8 层）；特例四车间电梯 3/4 折（V58=ROUND(W/4.5/4×3,2)）=coefficient 直接录 6（=4.5/3×4）即可复现，不建折扣字段。
- `loss`：规则用量不直接到户，进 §2.4 损耗链。

### 2.3 应分摊（成本口径）
- 每规则 应分摊金额=`ROUND(规则用量×单价,2)` 全额（AD 列口径），与户级Σ的差=舍入差+未覆盖户，进对账段。

### 2.4 损耗率链路（读时派生，负值黄警示不阻断——CP/PV/parkEnergy 三套同范式）
1. 损耗量 E=分表Σ−总表（负=有损耗）：两操作数现成=meterGroup 区块 head(infra 总表) 与 sums(tenant+share 用量合计)（meterGroup.ts:100/:106-117）。一期 C4=一期园区电!S5、D4=S92；二期二/三/四车间共用三车间总表：F5=E5+E6+E7−C6（K5"三车间供电"），铝缆直供户单算（D=S44+S45）。
2. 原损耗率 F=E/C（F4=−9.53%）。
3. 分摊用电度数 G：一期=`ROUND(园区级公共电(loss 规则用量Σ,不含路灯)/park_share_div,2)`=86.8 度/栋（G 式证据=SUM(S5:S9)/6）；A座人工减 1500（J4"待调整8500度"）与二期 H4=300/H5=−2500/H8=1000 统一收编为 `alloc_cfg loss_adj_qty`。
4. **收取租户损耗率 I=−ROUND((E−G−loss_adj_qty)/C,4)+loss_adj_rate**（I4=6.16%）；分表>总表特例（一期 B座 E6=+80.67）：I=`ROUND(G/C,4)+loss_adj_rate` 只计公共电份额；二期同栋组共率（J5=J6=J7=2.55%）。
5. 户损耗费=`ROUND(户用电量×I×price_loss,2)`，fee_key=share_elec_loss，rate_snap=I——即园区级公共电（车库/大堂/水泵/招商中心）不单独收，全部并入损耗费向全园回收（分摊分析 I11 一笔实收对 6 行成本的系统化表达）。

### 2.5 已/未分摊对账（分摊分析 Sheet1 口径，读时派生）
- 行=规则（+损耗组），列=本月用量 | 单价 | 成本金额(§2.3) | 已分摊(=alloc_result 当月该规则户级Σ) | 差额(已−成本，正盈负亏，B28 注③)。
- 损耗组行：成本量=−(总表vs分表残差)（一期 E17=−5004.04 工业损耗、E4=−3673.5 商业损耗；二期 F14=−10793.8），成本额=量×price_loss；已分摊=share_elec_loss 户级Σ。
- **Excel 的 H 列实收（电费总表 L129+V129 / 本月用电数据统计 L73+V73）本刀没有对应物**——实收归 P-C；本刀"已分摊"=生成结果Σ（应收侧），实收对账 P-C 后在此段加一列。
- 纯成本行（门岗/监控/备用电源等"未分摊"枚举）不建规则不进对账——它们在电费成本模型（ELEC-COST-SPEC）里已有位置。

### 2.6 锚点数值（spec 锁定，2024-02）
AC15=0.02 元/㎡ | AC43=302.50 元/层 | AC27=0.08 元/㎡ | V10=145.37 元/层 | H48=302.5 | 一期 I4=6.16% | 二期 J5=2.55% | E17=−5004.04 | F14=−10793.8 | 二期损耗成本额=ROUND(10793.8×1.25312,2)。

## 3. 页面流

**裁定：独立屏 `/alloc`（公摊分摊，数据中心·业务流水组，园区抄表之后），不塞进抄表屏第三段。** 理由：①抄表屏 v3 已是两段+1100 块表分组区块，再加"规则 CRUD/生成结果/对账"三种异构表格超载；②抄表=录"量"（导入覆盖幂等），分摊=生成"钱"（admin 快照动作），生命周期与心智不同；③P-C 缴费单要深链到分摊结果，独立路由干净。**但 METER-SPEC:96 许诺的"总表vs分表勾稽"就地兑现在抄表屏**：区块汇总行下加一行只读损耗行（损耗量+原损耗率，负超阈黄标）——meterGroup 两操作数现成，一行减法，不迁屏。

- 顶部 Segmented 三段（会话内记住，KeepAlive）：**分摊规则 / 月度分摊 / 损耗与对账**。共用：zone tabs(一期/二期)+年月选择（年数据驱动，同 PV 口径）。
- **分摊规则**：一行一规则：名称|楼栋|方法徽标(整笔/按面积/按层/并入损耗)|绑定表数|系数|人工加度|费项|受益人数；行点开抽屉=绑定表(多选自 meter ownership=share)+受益人(FPTenantPicker+weight)；新增/编辑弹窗；删除守卫(有结果 409)。参数小节(alloc_cfg)沿电费成本模型参数样式。
- **月度分摊**（默认段）：工具栏「生成本月」（已生成显 generated_at+「重新生成」确认弹窗）；主表一行一户：租户|楼栋|各费项列(消防/电梯/楼层照明/路灯/损耗)|合计|备注；行点开抽屉=逐费项明细（规则名/qty/rate_snap/price_snap，表级明细现算，读数已变标黄）；导出当月（催缴清单同款）。
- **损耗与对账**：上段=损耗率表（楼栋|总表量|分表Σ|损耗量|原损耗率|调整度数|上浮率|收取租户损耗率，人工两列行内改=改 alloc_cfg）；下段=对账表（§2.5 列），差额红绿。
- viewer 全只读；生成/规则/参数写=admin（SecurityConfig 统一门）。

## 4. 接口（/api/alloc，GET=viewer 写=admin）

- `GET /years`（数据驱动年下拉）
- 规则：`GET /rules`、`POST /rules`、`PUT /rules/{id}`、`DELETE /rules/{id}`（有结果 409）——rule 携带 meterIds[]+members[] 整体保存
- 参数：`GET /cfg?ym=`、`PUT /cfg`（月行 upsert）
- 生成：`POST /generate?ym=`（先删后插该月 gen 行，保留 manual 行；返回 生成户数/费项数/缺抄警告清单）
- 结果：`GET /result?ym=`（户级+费项）、`GET /result/{tenantId}?ym=`（抽屉明细现算）
- 对账：`GET /recon?ym=`（损耗率派生+已/未分摊，纯读派生）
- 手工行：`POST /result/manual`、`DELETE /result/{id}`（仅 manual 行可删）

## 5. 与既有功能联动边界

### 复用清单（原料全部就位，缺的只是薄计算层）
- 用量：meter_reading 派生，`MeterService.usage` 提 public static（一个关键字改动）；factor_snap 快照口径照旧。
- 分摊对象集合=meter `ownership='share'`（meterSplit.ts:62 关键词分类即为此刀定制）；损耗总表=`infra`；租户挂账走 meter.tenant_id/alloc_rule_member，租户匹配 P-A v2 已完成（METER-SPEC §6.2），**绝不重做名称匹配**。
- 损耗两操作数=meterGroup.ts 区块 head+sums；损耗派生范式（读时派生/负值黄警示不阻断）抄 CP-METER-SPEC:18 / pvRoi.logic.ts:128 / parkEnergy.logic.ts:5。
- 参数模式=elec_price_cfg「当月行优先回退默认行」（ElecCostService.resolveCfg）；面积原料=V31 面积模型；选择器=FPTenantPicker；列表规范=LIST-PAGE-SPEC。

### 禁重做清单
- **不动 21 列台账/附表10**：系统账单没有消防/电梯/路灯公摊列（ledgerColumns.ts FEE_KEYS 是真实台账固定版式），P-B 出口=alloc_result 独立产物，绝不给台账加列；收入侧链路（台账→附表10→分析层"售电收入"）零改动。
- **不新建园区级分摊表**：elec_cost_entry 的 `allocated` 费项就是园区级分摊额度（V42 种子 ops×5），P-B 是它的明细化不是替代品——桥接见下。
- **不建第四套损耗框架**：按既有"读时派生+负值警示"范式写纯函数（meterGroup.spec.ts 锁数值做法）。
- **不新建导入**：MeterService.importRows 已整册吃真实文件；规则≈30 条人工录入，不值一个导入面。

### 防耦合边界（AllocService + /api/alloc + AllocView 只准碰）
- 读：MeterMapper、MeterReadingMapper、TenantMapper（+BuildingMapper 楼栋名）、MeterService.usage 静态公式——跨域读一律注 mapper 不注 service（ElecCostService 6 mapper 先例），不走 HTTP。
- 写：alloc_rule/alloc_rule_member/alloc_cfg/alloc_result（自己的四张表）。
- **禁止 import**：LedgerService/MonthlyLedgerMapper 写侧（收款事实归台账）、BillsService/ElecCostService/ElecService/Pv*/Cp* 任何 service、elec_price_cfg（批发/上网侧，语义不同不共表）。
- **elec_cost「分摊额度」互认=单一所有权+单向读**：elec-cost 是 elec_cost_entry 唯一 owner，P-B 永不写它；成熟后改 elec-cost 侧取数——模拟规则 6 的"费用×50% 假设"（ElecCostService.java:329/:335）换成注 AllocResultMapper 读当月Σ（方向=elec-cost→P-B 单向），指标 6"经营性用电费用=ops 费用Σ−分摊额度Σ"公式零改动自动吃真值。P-B 对账段加一行只读提示"本月分摊合计 X vs 电费成本模型 allocated Y"黄标，不自动勾稽强拦（勾稽归对账刀，ELEC-COST-SPEC §7 裁定）。
- **两套 ops 词义陷阱**：elec_meter 种子 kind='ops'（V42:21-22 消防泵/路灯=园区成本口径 5 块聚合表）≠ meter.ownership='ops'（meterSplit 分类）；桥接对应关系=meter share 表分摊结果 ↔ elec_cost 的 allocated 费项，**绝不拿 ownership='ops' 去 join elec_meter**。
- 依赖方向总图：meter(P-A) ←读— alloc(P-B) ←读— bills/P-C 与 elec-cost(模拟规则6)。全单向、全 mapper 级、无双写。

## 6. 实现 plan（四刀）

1. **第 1 刀 模型+引擎核**：V47 四表迁移 + AllocService 计算纯函数（四类方法金额化+损耗率链）+ 规则/参数 CRUD 接口。验收：后端单测锁 §2.6 全部锚点（AC15/AC43/AC27/V10/I4=6.16%/J5=2.55%/E17/F14）；规则 CRUD IT（删除 409 守卫）。
2. **第 2 刀 生成+结果屏**：POST /generate 快照写入（幂等重生成/manual 保留/缺抄警告）+ 分摊规则段 + 月度分摊段 UI + 导出。验收：录入 2024-02 真实规则后生成，户级抽样与 Excel 收取侧全等（H48=302.5、F8=AC15×E8、F63=AC56/2、H55 层内面积二拆）；重生成幂等 IT；前端 spec 过。
3. **第 3 刀 损耗与对账段 + 抄表屏损耗行**：/recon 派生接口 + 对账 UI + meterGroup 区块损耗行（只读一行）。验收：损耗率表与 Excel 园区损耗 sheet 全等；对账合计对上分摊分析 Sheet1 成本列；抄表屏锚点（2024-05 二期一车间 35170 vs 34476.23）。
4. **第 4 刀 elec-cost 桥**：elec-cost 模拟规则 6 改读 alloc_result 当月Σ（无数据月回退 ×50% 模拟，source 标注）+ P-B 对账段互认提示行。验收：有分摊数据月指标 6 吃真值 IT；无数据月回退不变（既有 elec-cost 测试全绿）。

## 7. 边界与不做（YAGNI）

- 户级缴费单、实收核销、实收侧对账闭环（Excel H 列=电费总表实收）——P-C；alloc_result 一个 mapper 一张表就是给 P-C 的全部契约。
- 关账后禁重生成——那是 P-C 关账刀的门，现在不建。
- 表级分摊明细不落库（抽屉现算）；分摊规则 Excel 导入不做（30 条人工录）。
- 水公摊首版不生成（fee_key 占位）：真实数据水公摊仅绿化水一行且并入水泵对账，量不成刀。
- 翔海特殊块（公摊折算进"本月行至"）、广告字灯归并（V46/V65 并入消防/绿化）——manual 行 + note 留痕，不建模型。
- 二期历史模板 `公共电分摊` 不导入不建模；纯成本"未分摊"行（门岗/监控）不建规则。
- 折扣字段不建（四车间 3/4 折用等效系数复现）；分摊规则版本化/生效区间不做——规则改了重生成即可，历史月已快照不受影响。
