# 三期公摊池开放：期区从「猜」变成「记」

> 2026-08-29 拍板。交付标准：**用户自己能把三期的公共电核算从零建起来，不用再找开发改代码。**
> 本次不做实现，只定规则。实现计划另出。

## 1. 为什么改

三期不是「没数据」，是**系统里根本没有 `p3` 这个值**。

库里实测：

```
building  phase=3   2 栋真楼 + 1 个待清空旧桶（见 §5）
contract  三期 16 份   unit  15 个（占位）   bill_notice  9 张（租金侧已在跑）
meter     zone=p3   0 块
alloc_rule zone=p3  0 个
```

`zone` 被钉死成 `p1|p2|dorm`——后端 **9 处** `@Pattern` 正则（7 处期区值 + 2 处 scope 形态）、
前端 **11 处**常量数组。
用户在三期建一块电表，后端 400；建一个池，后端 400；看损耗屏，`ZONE_OPTS` 里压根没有三期。

**所以「开放窗口后期靠用户自己手动添加」这个方案，窗口本身现在不存在。**

### 更深一层：期区从来没有被记录过

`AllocService.loadCtx` 的 `zoneOfBuilding` 是**遍历电表、取碰到的第一块表的 zone**
（`AllocService.java:972`，`putIfAbsent`）。也就是说「这栋楼属于哪个期区」这件事，
系统一直在从电表反推。

三期没有电表 → 三期没有期区 → 建不了三期的表。**鸡生蛋。**

这个反推还有两处已经在冒烟的地方：

| 楼栋 | `building.phase` | 表的 zone | 说明 |
|---|---|---|---|
| 一期 宿舍一~四栋 | 1 | `dorm` | 期数 ≠ 期区，`phase→zone` 派生不成立 |
| 散租宿舍 / 保障房 / 饭堂 | 4 | 0 块表 | 按 phase 派生会造出不存在的「四期」 |
| 二期 二车间 | 2 | `dorm, p1, p2` | 该栋 zone 取决于遍历顺序 |

**所以本次不是「加一个枚举值」，是把期区落成一个显式字段。**

---

## 2. 核心规则

### P1 期区存在楼栋上

`building` 加一列 `zone VARCHAR(8) NULL`。它是「这栋楼属于哪个期区」的**唯一事实来源**。

**回填**：按该栋电表的**众数** zone——不是第一块。全库只有一栋是混的：
二期二车间 `p2:20 / p1:1 / dorm:1` → `p2`，无平局。平局时按 `p1 < p2 < … < dorm` 取最小，
保证回填可复现（同一份数据跑两次结果相同）。这顺手修掉那个「取决于遍历顺序」的不确定性。

无表的 **9 栋**留 NULL，由用户在楼栋管理里选：
三期两栋真楼 + 旧桶「三期」、phase=4 三栋（散租宿舍/保障房/饭堂）、二期两栋旧合并栋、一期空地。

**读取**：`zoneOfBuilding` 改成读这一列。列为空时**回退**现有的「取该栋首块表」逻辑——
新建楼栋忘了填期区但已经录了表，不能因此整月算不出来。

**为什么不是 `building.phase`**：上表已证明两者是不同的东西。phase 是产权/建设批次，
zone 是**计费与抄表的分区**，宿舍横跨 phase 1 和 4。强行合并会同时弄错宿舍和四期。

### P2 期区候选来自数据，不来自代码

新端点 **`GET /api/zones`**，返回：

```
候选 = distinct(building.zone) ∪ 基础清单 {p1, p2, p3, dorm}
```

- label 由 `p{n}` → 中文数字 + 「期」生成；`dorm` → 「宿舍」
- 排序：`p1, p2, p3, …` 升序，`dorm` 恒排最后
- 基础清单保证**鸡生蛋能破**：三期一栋楼都没标之前，下拉里也得有「三期」可选

后端 7 处期区值正则 `p1|p2|dorm` → **`p\d+|dorm`**；前端 11 处写死常量 → 一律拉这个接口。

**以后加四期 = 建栋楼选个期区，不改代码。** 这是本 spec 的交付标准本身。

⚠ `ParamPutReq` / `PriceCfgReq` 的 scope 正则是 `^(|p1|p2|dorm|(building|meter|rule|tenant):\d+)$`，
同步放宽成 `^(|p\d+|dorm|(building|meter|rule|tenant):\d+)$`——否则三期的期级参数（电价、
`loss_supply_meter`）填不进去，池能建但算不出钱。

### P3 抄表 Excel 认得三期

`meterExcel.ts:68` 现在是 `/一期/→p1 : /二期/→p2 : /宿舍/→dorm : fallback`。
改成**按 `/api/zones` 返回的 label 反查**——「2026年9月三期园区电表抄表记录」匹配到「三期」得 p3。

`TEMPLATE_SHEETS` 那 6 个写死的 sheet 改成按 `zones × {elec, water}` 生成，
导入模板与导出自动带上三期。

### P4 损耗屏加三期，但**不加宿舍**

`LossLedgerView.vue:43` 的 `ZONE_OPTS` 改成拉接口，**并显式排掉 `dorm`**。

宿舍无损耗单元是**故意**的，前后端两处都写明了：

- `AllocService.java:1361`——`lossGroups()` 第一道过滤就 `|| "dorm".equals(m.getZone()) continue`
- `LossLedgerView.vue:32`——注释原文「只有一期/二期；宿舍无损耗单元」

前端从接口拉 zone 之后，**必须主动排掉 dorm**，否则会多出一个恒空的宿舍 tab，
把一个刻意的设计读成一个 bug。

后端 `lossGroups` **一行不动**：它排的是 dorm，p3 天然走进来。

### P5 楼层派生、方位自由

**楼层仍是下拉**，候选改成：

```
1..building.floorCount 生成中文（一楼/二楼/…） ∪ {天面, 负一层} ∪ 库里已有 floorLabel
```

用 `floorCount` 而不是 `unit` 表：创业/工业两栋现在 0 单元，但可以先设层数；
且 `BuildingDTO.floorCount` 已经在 `PoolLedgerView` 的 `buildings` 里，**不用新接口**。

**楼层不能改成自由输入**：`floor_label` 会被 `poolCandidates` 和楼层分桶逻辑
拿去做**字符串匹配**（`rentAreaByBuildingFloorTenant` 按 `poolFloor` 取桶）。
「四楼」写成「4楼」或带个尾空格，池会静默摊不到任何人，且不报错。

**方位改成自由输入 + 建议列表**，跟「费项名」现成的写法一致（`<input list=>`）。
方位没有任何数据源可派生（`unit` 表无侧向字段），且它不参与上述字符串匹配，
放开没有静默失败的风险。

### P6 新表未入池提醒条

新端点 **`GET /api/alloc/meter-diff?ym=`**，口径：

> `ownership='share'` + 当月未停用（`MeterService.outOfService`）+ 当月有读数
> + 不在任何 `alloc_rule_meter` 里

**只报 `share`**。其余四种 ownership 都不是「该摊没摊」：
`tenant` 户表自己付、`park` 园区自担本就不摊、`infra` 是总表、`ops`/`register` 不计费。

屏上复用现有告警抽屉（`zoneDiffs` 那套分组），加一组「未入池的公摊表」，点条目定位到配置面板。
**不自动勾人，只告诉。**

**为什么要有它**：租户变动有 `member-diff` 提醒条（新进/退租都会弹），**电表变动没有对应物**。
新装一块走廊灯表，抄表照录、一切正常，但它没进任何池 → 这笔电费没人摊，屏上一个字都不会说。
三期从零建池、没人有肌肉记忆，这是唯一的安全网。一期二期同样生效。

### P7 计费口径改成期级参数（**放开正则之后才发现的硬前提**）

放开 `AllocRuleReq` 的正则只让 p3 的池**建得出来**，算不出钱：

```java
// AllocService.java:1109  ruleCostAmount
if (!"p1".equals(zone) && !"p2".equals(zone)) return null;   // ← p3 的应分摊恒 null
```

根子是**电费口径按期区分叉**，而三期没有口径：一期 = 单一商业价 × 用量；
二期 = 尖/峰/平/谷分时四段 + 管理费。引擎里 7 处 `p2 ? A : B` 全靠期区名字判断。

**改法**：新增期级参数 `zone_calc_kind`，值域 `flat` | `tou`。

- `flat` = 单一商业价 ×（用量 + 加减度数）
- `tou`  = 分时四段 + 管理费

回填 `p1 → flat`、`p2 → tou`；三期由用户在计费参数页选。以下 7 处改成看这个参数，
不再看期区名字：

| 行 | 现在 | 改成 |
|---|---|---|
| `1109` | `if (!p1 && !p2) return null` | 取不到 `zone_calc_kind` → `return null` |
| `1112` / `1248` / `1801` | `if ("p2".equals(zone))` 分时分支 | `kind == tou` |
| `1702` | `perMeterCost = !"p2".equals(zone)` | `kind != tou` |
| `1748` | `keys = p2 ? … : …` 价目键选择 | 按 `kind` 选 |
| `1861` | `stdKind` 默认 `p2 ? amount_over_base : qty_price_over_base` | 按 `kind` 选 |
| `lossPrice` | `boolean p2 = "p2".equals(zone)` 选价目键组 | 按 `kind` 选。**初稿漏了这一处**（2026-08-29 实现期由 T5 实现者发现）：它被 `ruleCostAmount` 调用，漏改会让 p3 配成 `tou` 时走分时分支、却用平价制的键取价——模式与价目互相矛盾且不报错。⚠ 未配 `zone_calc_kind` 的期区（`dorm`）在此必须保持现状，不能跟着 `ruleCostAmount` 返回 null |

**明确不改**的 zone 字面量——它们是**机制**不是**口径**，三期没有就是没有：

- 一期园区公摊池均摊栋数：`1410` / `1411` / `1423` / `2276` / `2278`
- 一期损耗 G 列：`1440` / `1554` / `2282`
- 二期专属：`1482` / `1484`
- dorm 相关：`179` / `195` / `1015` / `1361`

`913`/`920` 的 `for (String zone : List.of("p1","p2"))` 是**损耗对账行**的期区循环，
要跟着期区清单走，否则三期不出对账行。


---

## 3. 不改代码就自动跑通的部分

设计成立的证据——三期建好池、**且 P7 的口径参数配好之后**，下面这些**零改动**：

> ⚠ 初稿把这一节写成「放开正则即自动跑通」，是错的。P7 是硬前提，不是可选项。

| 环节 | 为什么自动 |
|---|---|
| **楼栋损耗组** | `lossGroups()` 按 `building_id` + `ownership` 每月现算，加一块表下月自动进组 |
| **损耗口径** | `loss_variant` / `loss_head` / `loss_c_meter` / `loss_exclude` / `loss_denom_cable` / `loss_adj_qty` / `loss_adj_rate` / `loss_rate_manual` 全在参数注册表里，带正确 `valueKind`，计费参数页可改 |
| **池受益人** | `poolCandidates` 按 (楼栋, 楼层, 方位) 预勾在租租户；`member-diff` 每月提醒进出 |
| **份额** | floor 法留空 = 所在层各 1 份、层内按面积拆；填数 = 显式覆盖（1 / 0.5）。整层一户与多户共层都覆盖 |
| **催缴单** | `poolContributions` 读池快照 → 落公摊行 → `BillFeeMap` 那 6 个费项键都已映射到附表10 收款列。**前提是池算得出成本——见 P7** |

### 新费种不用开口子

催缴单公摊行印的**来源名就是池名**（`billNoticeLogic.ts:313`，`l.poolName ?? …`），
而池名末段的「费项名」是**自由文本**。

所以「三期中央空调冷却塔电费」这类新费种，建一个费项名叫「中央空调冷却塔」的池、
出口费项选一个现有电类键当载体即可——催缴单上原样显示池名。

`fee_key` 只决定两件事：催缴单板块分组（elec / water），以及附表10 的收款列。
**只有「需要单独一列收款」的新费种才真的装不下**，那时再单开。

---

## 4. 明确不做

| 条目 | 理由 |
|---|---|
| **ref / carrier 可新建** | 二期那 3 个 `ref` + 1 个 `carrier` 是复刻旧 Excel 账册的产物（广告字档 / 冲减载体）。三期从零起，不复刻旧册。存量池照常显示与编辑，只是新建时不给选 |
| **自定义出口费项 + 收款列** | 见上，池名已经能承载费种名称。真需要独立收款列时另开 spec，改动会牵到催缴单拆单与对账 |
| **area 法按户加权** | 要给某户打折，改用 floor 法填 0.5 份即可绕过 |
| **后端 `lossGroups` 支持 dorm** | 宿舍无损耗单元是刻意设计，不是缺口 |

---

## 5. 前置数据活（不是代码，但不做则本 spec 全部失效）

三期真正的楼是**两栋**：创业大厦、工业大厦。第三条 `phase=3` 记录 id 17「三期」
**不是一栋楼**，是楼栋重建时没拆完、留着装人的旧桶：

```
三期 创业大厦 (36)    0 合同   0 单元
三期 工业大厦 (37)    0 合同   0 单元
三期        (17)   16 合同  15 单元   ← 全在这儿
```

`buildingRestructure.ts:9` 写明了原因：「三期无任何信号 → 全量 MANUAL 留在旧「三期」栋」；
`:12`：「旧栋（11/12/15/16/17）不删不改名不停用，等 MANUAL 人工清零后再处置」。
那 15 个单元还是占位的：全部 `floor=1`、编号 101–115、面积 14 个是 `0.00`。

### ① 先把三期的楼栋重建收尾（**最重的一件，也是唯一的硬前置**）

池的受益人是按 **(楼栋, 楼层, 方位)** 派生的。16 户全挂在旧桶 17 上，
创业大厦与工业大厦是空的——**就算 p3 打通、池建在创业大厦上，`poolCandidates` 返回空名单**。

旧桶的期区怎么设都是坑：

- 不设 → 那 16 户不属于任何期区，`inForceByZone` 取不到，园区级池的自动名册也空
- 设成 `p3` → 损耗组按 `building_id` 分组，会多出一个不对应任何实体的假组

**唯一出路是把桶倒空**：16 份合同按真实归属迁到创业/工业两栋、单元按真实楼层与面积重建、
旧桶 17 处置（`status=0` 停用）。做完之后期区只需要设在**两栋真楼**上。

### ② 两栋真楼要设真实层数

`floor_count` 现在都是 1。楼层下拉按 `floorCount` 派生（P5），不改就只有「一楼」一个选项。

### ③ 三期 16 份合同里 14 份缺 `start_date`/`end_date`

判不了在租 → `inForce='unknown'` → 不进自动名册、不进 `member-diff` 的 `removed`。
**不补这个，P6 的提醒条和 §3 的受益人自动派生一条都不会生效**，池建出来是空壳。

> ⚠ ①②③ 与本 spec 的代码改动**互不阻塞，可并行**。但三件全做完之前，
> 三期的池即使建得出来也摊不到任何人。验收要连着数据一起验，不能只验接口通。

---

## 6. 测试

**后端**

- `GET /api/zones`：回填后 distinct 正确；基础清单并入；`dorm` 恒排尾；label 生成（p3→三期）
- `p\d+|dorm` 正则边界：`p3` 过、`p10` 过、`p` 不过、`px` 不过、`dorm` 过
- 众数回填：二期二车间（`dorm,p1,p2` 三种表）落到 `p2`，且不再依赖遍历顺序
- `zoneOfBuilding`：读列优先；列为 NULL 时回退首块表逻辑
- `meter-diff`：`share` 未绑 → 出；`share` 已绑 → 不出；`tenant`/`park`/`infra`/`ops` → 一律不出；
  当月停用 → 不出；当月无读数 → 不出
- 参数 scope 正则放宽后 `p3` 期级参数可写入
- **端到端**：建三期楼（设 zone/层数/单元）→ 建三期电表 → 录读数 → 建池 → `generate` → 催缴单出公摊行

**前端**

- zone 下拉来自接口（mock `/api/zones`），三处屏（抄表 / 公共电核算 / 计费参数）一致
- 损耗屏 zone **不含 dorm**（回归护栏：这条被改错过一次）
- 楼层候选随 `floorCount` 变；`floorCount=12` 出十二个选项
- 方位自由输入落库并回显
- `parseMeterSheet('三期园区电', …)` 识别出 `zone: 'p3'`
- 导入模板 sheet 数随 zones 数量变

---

## 7. 改动清单

> 行号经并行侦察 + 两轮对抗式复查逐条核对。侦察自报的 3 处非正则硬编码，复查纠正为 **5 处**；
> 另有 5 条断言被证伪（最典型的是「phase=4 会被猜成 p4」——`ParamService:330` 的守卫写死
> `phase==1||phase==2`，造不出 p4，按它去修会修一个不存在的洞）。

### A. 期区落成字段

| # | 位置 | 改什么 |
|---|---|---|
| A1 | 新迁移 | `building` 加 `zone`；按众数回填，平局取 `p1<p2<…<dorm` 最小 |
| A2 | `BuildingDTO` / `BuildingCreateReq` / `BuildingUpdateReq` / `BuildingService:165` 唯一构造点 / 楼栋管理屏 | 期区字段。**尾追加零风险**：`new BuildingDTO` 全仓仅 1 处构造，现有 IT 全是逐字段 `jsonPath` 断言 |
| A3 | 新 `ZoneController` | `GET /api/zones`（**必须 GET**：非 GET 会被权限 catch-all 吞成错的权限点） |
| A4 | `AllocService.loadCtx:971` | `zoneOfBuilding` 读列，NULL 回退。⚠ `QueryHygieneTest` 门禁写死 `AllocService.java = 27` 个 `selectList(null)`，新增一句就红——必须 hoist 复用现有加载，不新写 |

### B. 值域放宽（**9 处正则 + 5 处非正则**）

| # | 位置 | 改什么 |
|---|---|---|
| B1 | `MeterReq:8` / `AllocRuleReq:9` / `MeterController:24,71,82` / `AllocController:33` | `p1\|p2\|dorm` → `p\d+\|dorm`。⚠ MeterController 71/82 两行**逐字相同**，Edit 必须带上下文或 `replace_all` |
| B2 | `ParamController:28` | `all\|p1\|p2\|dorm` → `all\|p\d+\|dorm`。**别漏 `all`**，漏了默认值自己 400 |
| B3 | `ParamPutReq:11` / `PriceCfgReq:8` | scope 形态正则同步放宽（两者形态不同，`PriceCfgReq` 只有 `tenant:` 一种） |
| B4 | **`MeterService:73` `validZone`** | 非正则的第二道关。**必改**——导入路径 `MeterImportRequest.Row` 一个 `@Pattern` 都没有，zone 唯一把关就是它。不改则 p3 表能建不能导 |
| B5 | **`ParamRegistry:203` `scopeKind`** | `scope.equals("p1")\|\|…` → 认 `p\d+`。不改则 B3 白放：`ParamService:91` 静默 `continue` 跳过 p3 参数行，值写进库了但页面永不显示 |
| B6 | **`ParamService:173` `scopeLabel` / `:293` `scopeId`** | 两个 switch 认 `p\d+`。**不改直接 500**：p3 落 default → `idOf("p3")` → `indexOf(':')==-1` → `Integer.parseInt("p3")` → `NumberFormatException`。`scopeId` 还要让 dorm 恒排最后（现在写死 3，正好被 p3 撞上） |
| B7 | **`ParamService:326` `lossBuildings`** | `("p1".equals(z)\|\|"p2".equals(z))` → 跟 `AllocService:1361` 对齐（只排 dorm）。**不改会静默错**：p3 楼栋进得了损耗组算钱，参数中心里却一行损耗参数都不出现，用户改不了口径也不报错 |
| B8 | **`AllocService:82` `ZONE_POOL_PREFIX`** | `Map.of` 三元组 → 按 `p{n}` 生成「{中文数字}期园区」。**不改会撞名**：p3 园区级池全部塌成「园区级·{费项}」，与 p4 同费项池撞成同一个名字——正是 `:78-79` 注释里 V70 加期别前缀要防的事故 |
| B9 | `MeterService:305` 错误文案 / `ParamController:24` Swagger / `ParamRegistry:175,200` 注释 | 写死值域的文案。`:200` 举的反例 `'p9'` 改完后变**合法**，注释直接错 |

### C. 计费口径可配（P7）

| # | 位置 | 改什么 |
|---|---|---|
| C1 | 参数注册表 + 迁移 | 新键 `zone_calc_kind`（scope=期区，enum `flat`/`tou`）；回填 p1→flat、p2→tou |
| C2 | `AllocService:1109,1112,1248,1702,1748,1801,1861` | 7 处改成看 `zone_calc_kind`，不看期区名字 |
| C3 | `AllocService:913,920` | 损耗对账行的 `List.of("p1","p2")` 跟着期区清单走 |

### D. 前端期区接口化

| # | 位置 | 改什么 |
|---|---|---|
| D1 | `api/alloc.ts:6` / `api/meters.ts:9` / `api/params.ts:9` | 字面量联合 → `string`。⚠ tsconfig **没开** `noUncheckedIndexedAccess`，放宽等于拆掉这批字典唯一的编译期护栏 |
| D2 | `utils/meterExcel.ts:30` / `poolLedgerLogic.ts:10` 两份 `*_ZONE_LABEL` | 改成按 `p{n}` 生成 + **必须加 `?? zone` 兜底**。不加则 `PoolLedgerView:301,302` 导出文件名变成「公共电核算-2024-02-**undefined**.xlsx」，且编译器一声不吭 |
| D3 | `PoolLedgerView:100` / `MeterView:254,504` / `ParamCenterView:81` | ZONE_OPTS → 拉 `/api/zones` |
| D4 | `LossLedgerView:43` | 拉接口 **并显式排掉 dorm**（P4）|
| D5 | **`ParamCenterView:218-220`** | 守卫是**黑名单** `if (zone==='p2'\|\|zone==='dorm') return ''`，p3 会掉进一期分支，三期页签上挂出「一期公摊分摊度数=…」。改成白名单 `zone==='p1'` |
| D6 | **`CoefBookWindow.vue:172`** | `phase==='1'?'p1':phase==='2'?'p2':null` —— 全仓最赤裸的 phase/zone 混用。三期拿到 `zone=null`，`coefBookLogic:100` 的级联**整条期级作用域被跳过**，系数簿静默按全园价显示。改成读 `building.zone` |
| D7 | `CoefBookWindow.vue:123` `allocApi.rules('p2')` / `:97` / `coefBookLogic.ts:126` | 「层份仅二期」规则的**三份拷贝**。本次不改行为，但必须一起点名，否则改一处就漂移 |

### E. 抄表 Excel

| # | 位置 | 改什么 |
|---|---|---|
| E1 | `meterExcel.ts:68` | sheet 名嗅探改成按 `/api/zones` 的 label 反查 |
| E2 | **`meterExcel.ts:239` `TEMPLATE_SHEETS`** | 写死的 6 个 sheet → 按 `zones × {elec,water}` 生成。`:247` 模板下载与 `:283` 月度导出**都**只遍历它——不改则 p3 表能建能导入，却永远不出现在模板和导出里 |
| E3 | `meterExcel.ts:223` | dorm 标题特判（`zone==='dorm'` 时不拼「园区」二字） |

### F. 新表未入池提醒条

| # | 位置 | 改什么 |
|---|---|---|
| F1 | `AllocService` + `AllocController` + `api/alloc.ts` + `PoolLedgerView` 告警抽屉 | 照抄 `member-diff` 整条链。**端点必须 GET** |

### H. 楼层派生 / 方位自由（P5）

| # | 位置 | 改什么 |
|---|---|---|
| H1 | `PoolLedgerView.vue:454` `FLOOR_BASE` | 写死「负一层…十楼+天面」→ 按 `building.floorCount` 生成 ∪ `{天面, 负一层}` ∪ 库里已有。⚠ **不能改自由输入**：`floor_label` 参与 `poolCandidates` 与楼层分桶的**字符串匹配**，「四楼」写成「4楼」会静默摊不到人 |
| H2 | `PoolLedgerView.vue:455` `SIDE_BASE` | 五个方位的 `Select` → `<input list=>`（同「费项名」现成写法）。方位无数据源可派生，且不参与上述匹配，放开无静默失败风险 |


### G. 测试夹具连带（**不改就变红**）

| # | 位置 | 改什么 |
|---|---|---|
| G1 | `MeterApiIT:151` / `ParamApiIT:222,318` / `PriceCfgApiIT:208` / `ParamRegistryTest:71,74` | 这 6 处拿 **`p9`** 当「非法期区」夹具，放宽后 p9 **合法**，断言全红。换成 `px`（不能换 `p10`/`p0`，`p\d+` 全收）。`MeterApiIT:151` 还连着同方法 `157/158` 的 `imported=2 / skipped=3` |
| G2 | `ElecImportApiIT:149` / `PvImportApiIT:139` 的 `p9` | **不要动**。那是 `phaseId` 另一套值域（`ElecService:139` / `PvService:130` 的 `Set.of("p1","p2","p3")`），与 zone 无关 |
| G3 | `QueryHygieneTest:37` | 若 A4 无法靠 hoist 解决，需同步门禁数字并在注释里写明原因 |
