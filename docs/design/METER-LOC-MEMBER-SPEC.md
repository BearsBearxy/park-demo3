# 位置主数据与受益人楼层化（METER-LOC-MEMBER-SPEC）— 刀A + 刀D

> 定稿 2026-07-31。承接 2026-07-30 三屏审计与用户报障。前置：V72（天面回填）/ V73（逐表行+carrier）/ V74（meter 位置结构化，**已全部落库**）。
> 本 spec 覆盖 **刀A 抄表屏位置字段（UI 部分）** 与 **刀D 受益人楼层化**。刀B（电表标签）与刀C（逐表行）已完成，不在本 spec 内。

## 0. 病根与总纲

用户 2026-07-30 报障原文：

> 「园区抄表的表格也没有按照用户 excel 表格里面一样使用楼栋/车间+楼层+方位的多字段来配合公共电核算选择电表来计算公摊，**租户名字随时可以修改，楼栋楼层和单元应该是不会变动的字段**」
> 「分摊给谁的依旧是一堆新在租，根本就不是这一栋这一层这一单元的租户」

**病根**：位置在系统里是自由文本 `meter.spot`，同时承担显示、分组、导入身份匹配、池选表过滤四种用途；而**易变的租户名被放在第一列当主标识**。受益人侧更彻底——`alloc_rule_member` 完全没有楼层维度，`weight` 是在手工补一个本该由楼层主数据推出来的东西，18 个按层份的池因此每月只摊出 1 份（2024-02 少摊 **7,992.32 元**）。

**总纲**：稳定标识 = 楼栋 → 楼层 → 方位 → 房号；租户降为普通属性。V74 已把这四级落成 `meter.building_id / floor_label / side / room_no` 结构化列。本刀把**消费侧**（抄表屏、档案编辑、受益人分摊）全部切到结构化字段上。

**不动的边界**（防止连坐炸掉已验收口径）：
- `meter.spot` 原文**保留不删**；导入身份键 `MeterService.Idx.addrKey` **仍走 spot**，匹配行为一字不改（V74 注释已锁）。
- 池引擎的 ROUND 时机、std 算式、损耗链公式**一律不碰**。刀D 只改「摊出」（`allocated_amount`）的算法，不改「应分摊」（`cost_amount`）。
- `alloc_rule_member.weight` 语义**保留**为显式份额覆盖，账册已核对过的池（49/77）数字必须一位不变。

---

# 刀 A：抄表屏位置字段（UI）

## A.1 列模型（MeterLedgerGrid）

原册「一期园区电」的列是 `区域 | 楼层 | 企业名称 | 表类 | 电表名称 | 电表编码 | 电表倍率 | 上月行至 | 本月行至 | 备注`，其中「区域」是纵向合并的段（A座/B座…），「楼层」单元格本身就写成 `四楼西侧`。系统对齐这个形状：

| 位置 | 列 | 来源 | 宽 |
|---|---|---|---|
| **区块带头** | 楼栋/车间 | `meterGroup` 按 `area` 分块（现状不变） | — |
| **sticky 左 1** | 楼层·方位 | `floorLabel + side`，两者皆空显 `–` | 96 |
| **sticky 左 2** | 用途 | `tenantName ?? name`（=账册「企业名称」列原文） | 160 |
| 普通列 | 房号 | `roomNo` | 72 |
| 普通列 | 租户 | 现 sticky 首列降级至此，保留点击开抽屉与「待核」徽标 | 130 |
| 普通列 | 表号 | `subName` | 70 |
| 普通列 | 编码 | `code`，mono | 118 |
| 普通列 | 倍率 | `factor` | 56 |
| 普通列 | 上月行至 / 本月行至 | 现状不变（分时 5 段） | — |
| **sticky 右** | 用量 / 状态 | 现状不变 | — |

**为什么「楼层·方位」合成一列而不是拆两列**：原册那一格本身就是 `四楼西侧`；用户要的「多字段」实质是**数据层要有独立可匹配的字段**（V74 已给），而不是屏上必须占两格。合成一列与公共电核算屏的「楼层·方位」列同形，两屏读法一致。房号单独成列（原册没有，但用户点名「单元」，且 266 块表有值）。

**汇总行**：`colspan` 跨 楼层·方位 ~ 倍率，其余不变。

## A.2 分组与排序改走结构化字段

- `useMeterWorkbench.floorRank(spot)` 现在靠正则解析自由文本。**新增** `floorRankOf(m)`：优先 `m.floorLabel`（`天面`→99、`负一层`→−1、`N楼`→N），`floorLabel` 为空再回退旧的 `floorRank(m.spot)`（跨层/非楼层表仍要有个稳定位次）。
- `compareRowInBuilding`：`infra 优先 → floorRankOf → side（东<西<南<北<空）→ roomNo 自然序 → sortNo → id`。
- `meterGroup.ts` 的 `spotKey` 同步改走 `floorLabel/side/roomNo`；`GroupableMeter` 接口加这三个可选字段。
- **保留**旧 `floorRank(spot)` 导出不删——`poolLedgerLogic.floorSort` 在用它排池带内序。

## A.3 档案抽屉：把只读的身份字段改成可编辑

现状（`MeterDetailDrawer.vue` §表档案）只读：`标识名(name)` / `表编码(code)` / `方位(spot)` / `企业名称原文(tenantName)`。这正是**导入歧义报错死路**的成因——报错文案叫用户「补表编码或细化位置」，而这两样在 UI 上都改不了。

改为编辑态可改（行内提交，沿用既有 `commitXxx` 乐观更新失败回滚范式）：

| 字段 | 控件 | 约束 |
|---|---|---|
| 表编码 `code` | text | 留空=清除；重复不拦（库内本就允许），但**保存后若同 (kind,zone) 内出现重码，返回提示** |
| 区域 `area` | text + datalist（取库内既有值） | 影响导入 L2 位置键，title 注明 |
| 楼层 `floorLabel` | select（`负一层/一楼…十楼/天面` ∪ 库内既有值 ∪ 空=跨层） | 空=跨层或不适用 |
| 方位 `side` | select（东/西/南/北侧 ∪ 空） | |
| 房号 `roomNo` | text | |
| 位置原文 `spot` | text | **保留可改**：它是导入身份键；title 注明「改它会改变下次导入的匹配键」 |
| 企业名称原文 `tenantName` | text | 公摊表存的是用途描述 |
| 标识名 `name` | text | 唯一键 (kind,zone,name)；冲突时后端 409，前端回滚并提示 |

**联动规则（前后端一致）**：`MeterService.applyLoc` 已实现「显式给值=人工覆盖，留空=按 spot 解析」。抽屉改 `spot` 时，若 `floorLabel/side/roomNo` 未被人工改过则跟着重解析；**已人工改过的不被覆盖**——由前端在提交时显式带上当前三值实现（后端不做「是否人工改过」的状态记录，避免再造一个隐藏状态）。

## A.4 新增表弹窗补字段

`MeterView` 的新增表弹窗现在没有 `area`，手工建的表因此永久缺席导入位置索引（库内已有 324 块 area 为空）。补齐：`区域 / 楼层 / 方位 / 房号 / 表编码`。

## A.5 A 的验收线

1. 抄表屏一期 A座区块：天面 4 块表相邻且排在该栋末尾；`四楼西侧` 与 `四楼东侧` 分列不同 side。
2. 档案抽屉能改 code/area/floor/side/room/spot/tenantName/name，改完刷新仍在。
3. 导入歧义报错的两条自救指引（补编码 / 细化位置）现在都能真的执行。
4. `npm run build` 通过（**改过 .vue 必须跑，typecheck+vitest 不覆盖 SFC 编译**）。

---

# 刀 D：受益人楼层化

## D.1 楼层来源：两级回退，generate 时解析，不落库

**实测数据（2024-02）决定了这个设计**：

| 来源 | 覆盖率 |
|---|---|
| 合同 → `contract_unit` → `unit.floor` | 差：有效合同 121 挂单元 / 87 没挂；rule 2 的 15 户只解析出 1 户 |
| 该户在本栋的**户内电表** `meter.floor_label`（V74） | 好：rule 2 → 12/15；rule 20/22/49/50/69/70/79/87 全覆盖 |

```
memberFloor(tenantId, buildingId, ym):
  1. 合同(覆盖 ym) → contract_unit → unit(building_id = 池楼栋).floor  → 取最小楼层?  ✗
     → **取全部**:一户跨多层就在每层各占一份(电梯/楼梯间按层收，跨层户本就多用)
  2. 若 (1) 空 → meter(tenant_id=户, building_id=池楼栋, ownership='tenant', 未停用).floor_label
     → 同样取全部去重
  3. 仍为空 → 归入「未定层」桶
```

**不落库**：楼层是主数据的派生，落到 `alloc_rule_member` 上就又多一份会漂的副本。每次 generate 现算。

## D.2 floor 池分摊算法

```
perFloor = pool.std          // 元/层
显式份额户: weight != null  → amt = ROUND(perFloor × weight, 2)        // 账册口径，一字不改
其余户:     按 memberFloor 分桶(一户占多层 → 该户进多个桶，每桶按其在该桶的面积计)
每个桶(含「未定层」桶)独立分 1 份 = perFloor:
    桶内 Σ面积 > 0 → amt_i = ROUND(perFloor × area_i / Σarea, 2)
    桶内 Σ面积 = 0 → amt_i = ROUND(perFloor / 桶内户数, 2)
```

- **「未定层」桶照样算 1 份**并落 warn（`池「X」有 N 户定不出楼层,已按 1 层合摊,请补合同单元或该户户内表楼层`）。不摊=白丢钱，比摊错更糟。
- 摊出总额可能 < 应分摊：`coefficient`（如 7 层）是账册固定分母，实际有人的层数少于它时差额就是空置损失——这是真实结果，不做补偿。
- **反向同理**：实际有人的层数**多于**分母时摊出会 > 应分摊，同样**不封顶**（rule 50 的超收就是账册用加度故意造的正当盈余），
  只按 §E5 落 warn。2024-02 按 L1 优先口径重算：超分母池 3 个（rule 3/11/22），超收合计 627.06 元（清单见 LOC-MEMBER-FIXUP-SPEC §E5，重算于 2026-07-31）。
- `area` 沿用现有 `areaOf`（合同面积），口径不变。

**现状对照**：现实现是「weight=NULL 的成员**合摊一份**，层内按面积二拆」（`AllocService.java:788-795`）——所以 18 个池全都只摊出 1 份。新算法只在「分桶」这一层不同：桶从「全池一个」变成「一层一个」。

## D.3 锚点（必须逐个对上，否则算法不对）

| 池 | 成员 | 期望摊出 | 依据 |
|---|---|---|---|
| 50 一期 B座·天面·货梯 | 碧沃丰/可莱恩/雷莱（2F/3F/4F 各一整份） | `302.50 × 3 = 907.50` | **账册已分摊 AE = 907.5** |
| 49 一期 B座·天面·楼梯间 | 5 户带显式 weight（0.5/0.5/1/1/1） | `330.69`（现值不变） | weight 分支不走新逻辑 |
| 77 一期 E座·天面·楼梯间 | 5 户带显式 weight | 现值不变 | 同上 |
| 22 二期 六车间·电梯 | 11 户，**7 个楼层桶**（一楼2/二楼1/三楼3/四楼2/五楼3/六楼1/七楼1） | `1161.73`（`165.96 × 7` + 三楼桶按面积拆多出 1 分） | 见下「按 L1 优先口径重算」 |

> **rule 22 数字按 L1 优先口径重算于 2026-07-31**（LOC-MEMBER-FIXUP-SPEC §F9）。本表初稿写「全部可从户内表定层、
> 摊出 ≈ 165.96 × 实际层数」，是按 **L2-only（只看户内表）** 估的 **5 桶 = 829.80**；而实现按 §D.1
> **合同单元优先**，9 户能从 L1 定层（50/51/52=五楼、57=四楼、58=三楼、59=三楼、60 邓宇峰=一楼+二楼、67=一楼、68=四楼），
> 只有 2 户回退 L2（54 罗立剑=六楼+七楼，其合同起止日期为空 → `covers()=false` 不进 L1；55 刘彪=三楼，
> 其合同单元在 17 栋、非本池楼栋被滤掉）→ **实测 7 桶**。
> 摊出 1161.73 **超**应分摊 995.74 共 165.99（分母 `coefficient=6.00` < 7 桶）→ 按 §E5 落 warn，**不封顶**。
> 同口径重算下 2024-02 的超分母池共 **3 个**（rule 3 / 11 / 22），超收合计 **627.06 元**，清单见
> LOC-MEMBER-FIXUP-SPEC §E5。锚点由 `AllocServiceTest.floorBuckets_rule22_sevenFloorBuckets` 锁住。

**回归红线**：`alloc_pool_result.cost_amount / std_value / base_snap / qty_*` 与 `alloc_loss_result` 全列**必须与本刀前逐格相同**。刀D 只允许 `allocated_amount / gap_amount` 变化。

## D.4 direct 池不出候选、不进 member-diff

`method='direct'`（户对户，41 个池）的受益人就是那一户，「该定位本月在租租户」对它毫无意义。用户截图里 C座一个 direct 池推了 13 户「新在租」，就是这个。

- `pool-candidates`：`method='direct'` 时 `tenants` 返回空数组 + 一句说明（不是静默空）。
- `member-diff`：跳过 `direct`/`ref`/`carrier`/`none` 四类池。
- 前端受益人段：direct 池显示「户对户：整笔归 X」，只允许选一户。

## D.5 weight 可编辑 + 取消勾选不清零

- 受益人行加「份额」输入框：空 = 按楼层自动分（D.2），填值 = 显式份额覆盖。
- `toggleMember` 取消再勾回时**保留原 weight**（现实现恒写 `null`，rule 49/77 的 0.5 份会被静默冲掉）。实现：取消时把该户的 weight 暂存在组件内 `Map`，勾回时取回。
- 列头 title 说明两种模式。

## D.6 屏上披露

「摊出」列 title 由现在的「受益人 N 户」改为分桶明细：`按 X 层拆：一楼 2 户 / 二楼 1 户 / 未定层 3 户`。让「为什么摊出少于应分摊」在页面上看得见。

## D.7 D 的验收线

1. D.3 四个锚点全中。
2. 回归红线：2024-02 重新生成后 `cost_amount/std_value/base_snap/qty_*` 与刀前完全一致（用 SQL 前后快照比对）。
3. 18 个 floor 池的 `gap_amount` 绝对值总和从 **7,992.32** 显著下降；逐池列出变化。
4. direct 池的 `pool-candidates.tenants` 为空；member-diff 不再产出 direct 池的行。
5. 后端 `AllocApiIT` / `AllocServiceTest` / `PoolSeedIT` 全绿；前端 `npm run typecheck` + `npx vitest run` + **`npm run build`** 全绿。

---

---

# 实现计划（工序与文件边界）

**串行五步**（按文件所有权切开，后一步依赖前一步的产出；同一工作树不并发写同一文件）：

| # | 步骤 | 独占文件 | 交付 | 自检 |
|---|---|---|---|---|
| 1 | **A1 分组排序结构化** | `composables/useMeterWorkbench.ts`(+spec)、`utils/meterGroup.ts`(+spec) | `floorRankOf(m)` 双来源；`compareRowInBuilding` 改 floor→side→room；`GroupableMeter` 加三字段 | 新增单测锁「天面排末尾/东先于西/房号自然序/floorLabel 空回退 spot」；`vitest run` 这两个 spec |
| 2 | **A2 抄表屏列模型** | `views/meters/MeterLedgerGrid.vue` | §A.1 列表；sticky 左两列改 楼层·方位 + 用途；租户降普通列；汇总行 colspan 跟改 | `npm run build` |
| 3 | **A3 档案可编辑** | `views/meters/MeterDetailDrawer.vue`、`views/meters/MeterView.vue` | §A.3 八个字段行内可改（含 §A.3 联动规则）；§A.4 新增弹窗补 5 字段 | `npm run build` |
| 4 | **D1 楼层化分摊（核心）** | `service/AllocService.java`、`dto/AllocPoolDTOs.java`、`api/AllocApiIT.java`、`service/AllocServiceTest.java` | `memberFloor` 两级回退；`floorBuckets` **纯静态函数**；direct 池候选/diff 跳过；`PoolMember` 加 `floorLabel`，`PoolRow` 加 `allocNote`(分桶明细串) | `floorBuckets` 单测锁 §D.3 四锚点（用真实数值喂纯函数，不依赖起服务）；`AllocApiIT` 加分桶端到端用例 |
| 5 | **D2 受益人 UI** | `views/alloc/PoolLedgerView.vue`、`api/alloc.ts` | §D.5 份额输入 + 取消勾选保留 weight；§D.6 摊出 title 用 `allocNote`；direct 池受益人段改单选 | `npm run typecheck` + `npm run build` |

**并行三验**（只读，实现全部落地后跑）：

| # | 验证 | 手段 |
|---|---|---|
| V1 | 回归红线 | 对 `alloc_pool_result` 的 `cost_amount/std_value/base_snap/qty_*` 与 `alloc_loss_result` 全列做刀前/刀后 SQL 快照比对，必须零差异 |
| V2 | 锚点与规范符合性 | 逐条核 §D.3 四锚点、§A.5 / §D.7 验收线；抽查代码是否真按 spec 而非近似实现 |
| V3 | 对抗复核 | 默认怀疑前两者的结论，独立重跑关键断言；专找「测试写得能过但实现不对」 |

**红线**：任何一步不得改动 `cost_amount / std_value / base_snap / qty_* / alloc_loss_result` 的算法。刀D 只许改 `allocated_amount / gap_amount`。

**验证纪律**（本轮踩过两次的坑，写进工序）：
- 改过 `.vue` **必须**跑 `npm run build`——`npm run typecheck` 与 `vitest` 都不编译 SFC，`<script setup>` 里的非法 `export` 两者全绿也会让页面白屏。
- **不许**手工 `docker exec mysql < V7x.sql` 预跑迁移——DDL 重跑会让 Flyway 记 `success=0` 并拒绝启动后端。写完迁移直接重启后端。

## 附：本刀不做的事（明确留给后续）

- 不建 `meter.unit_id` FK（1420 块表对 313 个单元的模糊匹配风险大于收益，`room_no` 先顶着）。
- 不动导入身份键三层匹配。
- 不修「快照过期无信号」「导入回写 ownership 冲掉人工修正」「池删不掉」等审计 P0——那是另一刀。
- 「实收/盈亏」两列仍恒 `–`，等 bill_notice。
