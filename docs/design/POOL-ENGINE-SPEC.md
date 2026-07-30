# 公共电池核算引擎（POOL-ENGINE-SPEC）— 楼栋损耗表 + 公共电核算表

> 定稿 2026-07-28。S3-B1 切片：把两期 Excel 的「公共电数据/公共电分摊明细」与「园区损耗」两类 worksheet 复刻为系统层——池核算引擎 + 快照落库 + 两个 FPLedgerTable 范式屏。
> **公式权威 = POOL-FORMULA-AUDIT-2024-02.md**（51 池 + 17 损耗行 + 宿舍 2 项，全部逐格验算过），本 spec 只定模型与映射，不复述公式。
> **复刻策略**：引擎输出与 2024-02 原册逐格全等为验收线；Excel 的硬编码/口径怪癖一律做成参数位复刻，不"顺手修正"；修正候选进异常清单留给用户拍板。
> 边界：本切片只做**池级/楼栋级核算**（应分摊、分摊标准单价、损耗率）。户级入账（已分摊 AE/X 列回填、公摊入户、bill_notice）= S3-B2，不在本切片；屏上「实收/盈亏」两列 UI 显 '–'（「摊出/差额」是引擎试算，语义区分见 §6.1）。

## 1. 底盘决策：扩展 V47 alloc 族，不建平行 pool_* 族

调研结论（2026-07-28）：alloc_rule 就是"池"（多表绑定 alloc_rule_meter/三种分摊语义 method/月度参数 alloc_cfg/快照 alloc_result 机制齐全）。缺口仅四项：池间折入链、表构成正负号、每池 ROUND 位数、池级结果落库。旧屏 AllocView 拆分退役（§7）。

## 2. 数据模型增量（V64）

```sql
ALTER TABLE alloc_rule
  ADD COLUMN round_scale TINYINT NOT NULL DEFAULT 2 COMMENT '分摊标准ROUND位数(2或3)',
  ADD COLUMN std_kind VARCHAR(20) NULL COMMENT '分摊标准算式:NULL=按zone默认(p2=amount_over_base,p1/dorm=qty_price_over_base);qty_over_base=广告字档(度数/面积,量纲混用复刻)',
  ADD COLUMN base_key VARCHAR(32) NULL COMMENT '分摊基数取自价目簿键(area_base/lamp_area_base/elevator_area_base...),NULL=用coefficient',
  MODIFY COLUMN method VARCHAR(10) NOT NULL COMMENT 'direct/area/floor/loss/none(不分摊,全额挂亏)/ref(纯标准行:只出std不出应分摊,如广联分摊V64,不入合计)';

ALTER TABLE alloc_rule_meter
  ADD COLUMN sign TINYINT NOT NULL DEFAULT 1 COMMENT '+1计入/-1从池剔除(广告字分表/火炬园/招商子表)';

ALTER TABLE alloc_cfg MODIFY COLUMN cfg_value DECIMAL(14,8) COMMENT '价格类参数需8位小数(1.13156875)';

CREATE TABLE alloc_rule_link (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  src_rule_id INT UNSIGNED NOT NULL,
  dst_rule_id INT UNSIGNED NOT NULL,
  link_type VARCHAR(12) NOT NULL COMMENT 'fold_price=src池分摊标准叠加进dst池标准(V46=0.01+V113);fold_qty=src池净度数计入dst池度数(招商净电→园区损耗公摊池)',
  UNIQUE KEY uk_link (src_rule_id, dst_rule_id, link_type),
  CONSTRAINT fk_link_src FOREIGN KEY (src_rule_id) REFERENCES alloc_rule(id) ON DELETE CASCADE,
  CONSTRAINT fk_link_dst FOREIGN KEY (dst_rule_id) REFERENCES alloc_rule(id) ON DELETE CASCADE
) COMMENT='池间折入链,引擎按拓扑序计算,禁环';

CREATE TABLE alloc_pool_result (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ym CHAR(7) NOT NULL,
  rule_id INT UNSIGNED NOT NULL,
  qty_total DECIMAL(14,2) NULL, qty_sharp DECIMAL(14,2) NULL, qty_peak DECIMAL(14,2) NULL,
  qty_flat DECIMAL(14,2) NULL, qty_valley DECIMAL(14,2) NULL,
  extra_qty_snap DECIMAL(14,2) NULL COMMENT '当月加度/扣度(进标准分子不进应分摊)',
  cost_amount DECIMAL(14,2) NULL COMMENT '应分摊(W/AD)',
  base_snap DECIMAL(14,2) NULL COMMENT '分摊基数快照(层数T/面积AA)',
  std_value DECIMAL(14,8) NULL COMMENT '分摊标准(V/AC:元每层/元每平米/整额)',
  fold_add DECIMAL(14,8) NULL COMMENT '折入叠加档(0.005/0.007),std_value已含',
  price_snap DECIMAL(14,8) NULL COMMENT 'p1/dorm合成单价;p2分时NULL',
  allocated_amount DECIMAL(14,2) NULL COMMENT '已分摊,B2回填',   -- V71 改注释:摊出(引擎试算,非实收),见 §6.1
  gap_amount DECIMAL(14,2) NULL COMMENT '盈亏,B2回填',           -- V71 改注释:差额=摊出−应分摊,见 §6.1
  warn VARCHAR(255) NULL COMMENT '缺读数/断链等行级警告',
  generated_at DATETIME NOT NULL,
  UNIQUE KEY uk_pool_result (ym, rule_id),
  CONSTRAINT fk_pr_rule FOREIGN KEY (rule_id) REFERENCES alloc_rule(id)
) COMMENT='池核算快照,账单依据,重导读数不漂移';

CREATE TABLE alloc_loss_result (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ym CHAR(7) NOT NULL,
  zone VARCHAR(8) NOT NULL,
  head_building_id INT NOT NULL COMMENT '组头楼栋(共享总表组=供电栋)',
  c_qty DECIMAL(14,2) NULL COMMENT '总表用电量',
  cable_qty DECIMAL(14,2) NULL COMMENT '铝缆用电量(仅陈列)',
  d_qty DECIMAL(14,2) NULL COMMENT '分表用电量Σ',
  e_qty DECIMAL(14,2) NULL COMMENT '损耗量=D-C',
  raw_rate DECIMAL(10,6) NULL COMMENT '原损耗率=E/C',
  g_qty DECIMAL(14,2) NULL COMMENT '公摊分摊度数(一期:园区公共池/6+g_adj;二期NULL)',
  adj_qty DECIMAL(14,2) NULL COMMENT '调整度数(二期H列)',
  adj_rate DECIMAL(10,6) NULL COMMENT '调整损耗加点(一期H/二期I)',
  variant VARCHAR(12) NOT NULL COMMENT 'net=净额式/share_only=纯公摊式/none=不核算(G座)',
  tenant_rate DECIMAL(10,6) NULL COMMENT '收取租户损耗率(I/J列)',
  generated_at DATETIME NOT NULL,
  UNIQUE KEY uk_loss_result (ym, head_building_id)
) COMMENT='楼栋损耗快照;对账区(总电表vs合计)读时派生不落库';
```

**alloc_cfg 新增键约定**（零 DDL，沿用 scope 前缀模式）：
- `rule:{id}` 月行：`coefficient`（层数月变 7/5.8/6/4/4.5/5.7/6.5 与面积基数月变；四车间电梯普通户档用等效系数 6=÷4.5÷4×3）、`extra_qty`（加度/扣度月变：+170/+100/+200/-670/+800…）、`manual_qty`（无表池手输量：宿舍绿化水 84 吨）、`price_override`（池级单价覆盖：宿舍路灯 1.13156875、宿舍绿化水价 4.45）、`std_add`（标准末端加元：广联分摊 +100 元）
- `building:{id}` 月行：既有 `loss_adj_qty`（二期 H 调整度数）/`loss_adj_rate`（加点 H/I）/`loss_head` 不变；新增 `loss_g_adj`（一期 A座 -1500）、`loss_variant`（0=net/1=share_only，默认 net）
- `p1.park_share_div=6` 已有（一期公摊池均摊座数）

规则上的静态 coefficient/extra_qty 变为**默认值**，`rule:{id}` 月行优先——与 cfg 既有"月行优先回退默认"语义一致。

## 3. 引擎算法（AllocService 重构，generate(ym) 扩展）

1. **池用量**：池的各时段用量 = Σ(绑定表用量×sign) + fold_qty 链入 + extra_qty(仅入"标准分子"，见 4)。表用量 = MeterService.usage(prev,curr,factor_snap) 逐段（总/尖/峰/平/谷）；缺读数→null 跳过入 warn。fold 链拓扑排序（禁环，环=409）。
2. **应分摊 cost_amount**（ROUND 时机按册复刻，不可混用）：
   - p2：**池级一次 ROUND**：先各段净量（表×sign 相抵）,再 W = ROUND(Σ段量×段价, 2)。段价 = 价目簿月推(elec_* + mgmt_fee)；尖码量按 `尖×[r×尖价+(1−r)×峰价]`，r=sharp_as_peak_ratio（2024-02 r=0 → 尖按峰，复刻 AB4）。无分时段回退 平价×总量。
   - p1：**逐表行 ROUND 再求和**（复刻 AD 列逐行:A座电梯 4 行各自 ROUND 后 Σ=1011.18，池级一次 ROUND 会得 1011.19）：cost = Σ_i ROUND(u_i×AB,2)；**例外**：含 sign=-1 绑定的池（招商净电）先净量后一次 ROUND(S×AB,2)。AB = elec_commercial + mgmt_fee_commercial（=1.11416875）。
   - dorm：price_override 优先（1.13156875 化石价复刻），否则同 p1。
3. **分摊标准 std_value**（未舍入金额先除基数再 ROUND，复刻 Excel 算序）：
   - `amount_over_base`(p2 默认)：V = ROUND(Σ段量×段价 / base, round_scale) + Σfold_price(src.std_value)
   - `qty_price_over_base`(p1/dorm 默认)：AC = ROUND((S+extra_qty)/base × price, round_scale)——**extra_qty 只进这里，不进 AD**（加度抬单价不抬应分摊，复刻）
   - `qty_over_base`(广告字档)：V = ROUND(S/base, round_scale)（量纲混用原样复刻）
   - method=direct：std=cost；method=none：std=NULL（不分摊全额挂亏）
   - base = base_key→价目簿 resolve(ym)（148918.01/80000/12487.04/15510）或 coefficient(rule:{id} 月行优先)
4. **损耗单元**：分组沿用 loss_head；C=组头 infra 表Σ、D=组内 tenant+share 分表Σ、E=D−C、cable=组内 name 含"铝缆"的 infra 表Σ（仅陈列，不入 C/D）；G(仅 p1)=ROUND(park_pool_qty/park_share_div,2)+loss_g_adj，park_pool=标记 `fee_key='park_loss_pool'` 的池（含 fold_qty 的招商净电）；率：
   - net：I = −ROUND((E−G−adj_qty)/C, 4) + adj_rate
   - share_only：I = ROUND(G/C, 4) + adj_rate
   - G座类（组内无分表或 D=C）：variant=none，不出率
   - 二期 J5 的 ROUND 内置变体不实现，统一外置式（锚点月同值，差异已录异常清单）
5. **快照**：generate(ym) 按 ym 先删后插 alloc_pool_result + alloc_loss_result（幂等）；既有户级 alloc_result 流程保留不动（无 member 的池自然跳过户级）。价与基数全部落 snap 列。
6. **门禁**：电价月推键缺当月 → 该 zone 整体拒绝生成（BizException，提示先录价）；个别池缺读数 → 池行落 warn 照常生成其余。

## 4. API（AllocController 扩展）

| 端点 | 语义 |
|---|---|
| GET /api/alloc/pools?ym= | 池核算表：config(name/zone/分组楼栋/method/表构成/links) join 快照行；无快照月返回 config+空值 |
| GET /api/alloc/loss?ym= | 损耗表：单元行(快照) + 对账区(读时派生:总电表/合计/两级损耗) + 铝缆明细 |
| POST /api/alloc/generate?ym= | 扩展：池+损耗快照落库（原户级逻辑保留） |
| 既有 rules CRUD / cfg / result 系列 | 不动；AllocRuleReq 增 sign/round_scale/std_kind/base_key/links |

## 5. 种子（V65，幂等 INSERT…SELECT 按 (kind,zone,name) 关联 meter）

- 二期 20 池 + 一期 31 项（户对户单表池逐行）+ 宿舍 2 池 + 一期园区公摊池(park_loss_pool，含招商净电子池) ≈ 55 条 rule + meter 绑定(含 sign) + links(V46←V113、V65←V77、损耗公摊池 fold_qty)
- 2024-02 月度参数 cfg 行：车间层数 T、一期 AA 面积基数(1734.73/2293.34/734.02/579.13/1417.26/1503.1/…)、加度(+170/+100/+100+100/+200/+800/-670)、损耗 H/I/g_adj/variant/loss_head
- 种子内表名映射**必须逐条命中**：迁移后跑校验 IT，未命中的绑定行数>0 即 fail——不允许静默缺表
- 池配置来源 = POOL-FORMULA-AUDIT（含增补损耗节），由实现 agent 从两册 Excel 程序化抽取生成 SQL，人不手抄数字

## 6. 前端：两个新屏（FPLedgerTable 台账范式，遵 EDIT-MODE/LIST-PAGE 铁律）

**公共电核算屏**（route 承接 /alloc，nav value 'alloc' 改标「公共电核算」）：
- 壳：账期 年/月 Select + zone Segmented(一期/二期/宿舍，无"全部") + 「生成本月/重新生成」(编辑态) + 导出
- 表体按**楼栋分带**（Excel 式分隔带同 MeterLedgerGrid §7.6）；**分带口径（刀3，用户 2026-07-30 报障"一层一个截断，一节一节没法看"，推翻 V69 四级分带）**：带 = 园区级 + 每个楼栋各一条，带序 = 后端 pools 行序首现（AllocService 已按 园区级→楼栋最小 sortNo（账册序）→楼层→侧向→sortNo 排好，前端不另造楼栋序）；**楼层与侧向不再分带，合成「楼层·方位」一列**（如 `二楼东侧`；整栋池 `–`；园区级池空）；带内序 = 楼层序（整栋池排带首，负一层<一楼<…<天面，复用 useMeterWorkbench.floorRank）→ 侧向 → sortNo。**池名称列只显费项名**（`公共用电`/`走廊灯`/`电梯`/`路灯`；定位已在前两列不重复），feeName 为 NULL 的存量待人工池（rule 41/42/51）回退显 name，自动全名 autoName 保留作行内 title 悬停与导出用。池归属仍对照原册（V67，用户裁定 2026-07-28）：一期=公共电分摊明细的座分段；二期=公共电数据的 B列物理车间（消防水稳压泵挂一车间/绿化水泵挂四车间/路灯、充电桩挂五车间，"园区级"仅消防设施）。列：楼层·方位 | 池名称 | 表构成(n块,hover 明细含sign) | 用量·总/尖/峰/平/谷(p1/dorm 只显总) | 应分摊 | 分摊语义(X层/㎡/户对户/不分摊) | 分摊标准(含折入"0.01+0.005"披露) | 摊出 | 差额 | 实收('–') | 盈亏('–') | 备注；sticky 左两列（楼层·方位 + 池名称，offset 累加）；tfoot 合计(度数/应分摊，锚 L126=31986.3/W126=14333.60)；导出 AOA 表头/列序同屏，另在首列补「楼栋」并把池名称导全名 autoName
- 编辑态：池配置抽屉（rule CRUD 搬自旧屏弹窗：绑表+sign/method/基数/round_scale/links）+ 月度参数行内改（rule:{id} coefficient/extra_qty → PUT /cfg）→ 改完提示重新生成
**楼栋损耗屏**（新 nav 项「楼栋损耗」，紧随公共电核算）：
- 列：位置 | 总表用电量 | 铝缆用电量(p2) | 分表用电量 | 损耗量 | 原损耗率 | 公摊分摊度数(p1) | 调整度数 | 调整损耗 | 收取租户损耗率 | 备注；合计行 + 对账区两行(供电局/总电表 vs 各级)
- 编辑态：调整度数/调整损耗/g_adj 行内改（building:{id} 月行）→ 重新生成

### 6.1 摊出/差额 ≠ 账册 已分摊/盈亏（刀3 正名，用户 2026-07-30 报障）

用户原话："已分摊 盈亏这两个是哪来的，为什么还没到分发公摊到租户就已经有了"。**方向搞反了**：

| | 账册（POOL-FORMULA-AUDIT §150/§155 原文） | 系统当前实现 |
|---|---|---|
| AD 应分摊 | `ROUND(S×AB,2)`，恒为该电表全额成本 | 一致 = `cost_amount` |
| AE 已分摊 | **从『电费总表』按费目列拉回实收**（I/S=消防·楼层公共，J/T=电梯，K/U=路灯公摊），或手输固定额（联塑232）—— 事后对账 | 引擎按受益人配置**正向试算**摊到户的合计 |
| AF 盈/亏 | `AE − 本组全部 AD`（= 实收 − 应分摊） | `摊出 − 应分摊` |

- **列头正名**：`已分摊`→**`摊出`**（title：按受益人配置试算摊到户的合计，非实收）；`盈亏`→**`差额`**（title：摊出−应分摊；受益人名单或面积基数与账册不同批时会有差）。
- **另立 `实收` 与 `盈亏` 两列恒 `'–'`**（title 注明待账单模块回填）—— 让"实收对账还没有"在页面上看得见，而不是靠一个错名的列冒充。
- **DB 不改名**（V64 已应用），只走 `V71__pool_result_comment.sql` 改 COMMENT：`allocated_amount`='引擎按受益人试算摊出(非实收;账册AE=实收对账待账单模块)'、`gap_amount`='差额=摊出−应分摊(非账册AF盈亏)'。DTO 字段名保持 `allocatedAmount/gapAmount`（改名波及前后端与测试），语义注释落在 `AllocPoolDTOs.PoolRow` 与 `api/alloc.ts`。
- **后续接线（S3-B2 bill_notice 落地后）**：实收 = 按 `fee_key`（share_elec_floor/share_elec_lift/share_elec_lamp 对应账册 I/S、J/T、K/U 三费目列）从租户账单行反向汇总到池；盈亏 = 实收 − 应分摊（多梯/东西表合并组按组减多行，同 AF27 手法）。届时本节两列由 `'–'` 改为出数，`摊出/差额` 保留为"试算 vs 实收"的对账参照，两者并存不合并。

**AllocView 退役拆分**：api/alloc.ts 与 allocLogic 字典/resolveCfg 保留复用；规则弹窗迁入新屏；月度租户分摊段+manual 段整体退役（B2 重建）；AllocView.vue/buildMonthlyGrid 删除，spec 测试同步替换。fpNav「出账链」组：合同→价目→园区抄表→**公共电核算→楼栋损耗**。

## 7. 验证（用户要求：两期 Excel 真实数据勾稽）

1. 2024-02 读数入库：两册原文件直接走现有导入链（sheet 同构已核，约 21 块新表自动建档）
2. python 脚本从两册抽取期望值 fixture：51 池 L/S 度数 + W/AD 应分摊 + V/AC 分摊标准 + 17 损耗行全列 + 宿舍 2 项 + 合计行
3. generate(2024-02) 后 API 拉结果逐格比对：**度数/应分摊/分摊标准/损耗率 100% 全等**为过线（已分摊/盈亏列除外=B2）；差异逐条列出归因
4. 异常清单核销：审计文档异常项(断链/量纲混用/两轨绿化水…)在系统内的落点逐条标注（参数位复刻/留待拍板）

## 8. 测试

- 后端：纯函数锚点单测扩展（V46=0.015 两段拼、V58 广联 3/4 层价、AC43=302.50 加度、S8 招商净电、A座 I=0.0616、二三四合并 J=0.0255、五车间 0.0287、宿舍 0.06/0.02）；AllocApiIT 扩 pools/loss/快照幂等/门禁；种子校验 IT
- 前端：新屏纯函数单测（分组/合计/参数解析）；npm run typecheck + 全量 vitest 绿
