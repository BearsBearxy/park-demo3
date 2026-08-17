# 价目簿 + 催缴单派生 · 参数全盘点（代码考古，只读）

> 调研日期 2026-08-16。范围：`tenant_price_cfg`(价目簿) + `alloc_cfg`(池/损耗参数) + `alloc_rule`/`alloc_rule_member` 列级参数 + 合同/表档案里被引擎当参数读的字段。
> 依据文件：`backend/.../service/PriceCfgService.java`（176 行）、`PriceCfgController.java`、`dto/PriceCfgReq|DTO|CopyReq.java`、`BillNoticeService.java`（1291 行）、`AllocService.java`（取价/参数段）、`mapper/AllocCfgMapper.java`、`docs/design/PRICE-CFG-SPEC.md`、`S14-COEF-BOOK-SPEC.md`、`BILL-DERIVE-SPEC.md`、`S4-BILL-NOTICE-SPEC.md`；前端 `utils/priceCfgLogic.ts`、`views/price-cfg/PriceCfgView.vue`、`utils/coefBookLogic.ts`、`views/bills/CoefBookWindow.vue`、`views/alloc/PoolLedgerView.vue`、`views/alloc/LossLedgerView.vue`、`nav/fpNav.ts`。DB 现值来自 `docker exec demo3-mysql … SELECT`（只读）。
> 忠实提取，不评价对错；「手输常数」= 库里 note 自称硬编码/冻结/照抄的值。

---

## 0. 先给全景：参数住在四个地方，三种版本语义

| 存储 | 表/列 | 作用域形制 | 版本语义（读侧） | 写入口 | 白名单 |
|---|---|---|---|---|---|
| **A. 价目簿** | `tenant_price_cfg(scope,cfg_key,acct_month,cfg_value,note)` | `''`(全园) / `p1`/`p2`/`dorm` / `tenant:{id}` | **级联** `tenant:{id}→zone→''` 首中即返；级内：**月变键**(电价 6 键)仅命中 `acct_month==ym`；**常数键**取 `acct_month<=ym` 最大者（`''`最小 ⇒ 版本前滚）——`PriceCfgService.resolveHit` L123-141 | `PUT /api/price-cfg`（价目管理页 / 系数簿）；SQL fixes 脚本 | `PriceCfgService.CFG_KEYS` 21 键（L32-38）；PriceCfgReq scope 正则 `^(|p1|p2|dorm|tenant:\d+)$` |
| **B. 池/损耗参数** | `alloc_cfg(scope,cfg_key,acct_month,cfg_value,note)` | `p1`/`p2` / `building:{id}` / `meter:{id}` / `rule:{id}` | **无级联**；`selectEffective(ym)` = 默认行 `''` ∪ **恰好当月**行；`loadCtx` 默认先落、月行覆盖（AllocService L929-933）⇒ **月行=仅当月生效，不前滚** | `PUT /api/alloc/cfg`（公共电核算月参两列 / 楼栋损耗行内三格+本月口径面板）；SQL/迁移 | **无白名单**（AllocCfgReq 只校验非空+月格式） |
| **C. 池规则列级** | `alloc_rule.coefficient / extra_qty / base_key / round_scale / std_kind / method / fee_key` | 池 | 常数（所有月），被 B 的 `rule:{id}.coefficient/extra_qty` 月行覆盖（L1519-1527） | 公共电核算池配置抽屉 `PUT /alloc/rules/{id}` | — |
| **D. 受益人层份** | `alloc_rule_member(rule_id,tenant_id,weight,acct_month)` | 池×户 | **版本组前滚**：`pickMembers` 取 `acct_month<=ym` 最大版本组整组替换（L115-120，S14 改的） | 池抽屉成员表(勾「只改本月」→ `memberMonth=ym`) / 系数簿层份键 | — |
| E. 合同/表档案 | `contract.kva/start/end/rent_free/kind/status`、`contract_billing_term.*`、`meter.is_dorm_room/zone/ownership/suspect/building_id/factor`、`meter_reading.*` | — | 主数据 | 合同页 / 抄表页 / 导入 | — |
| （旁支）`elec_price_cfg` | 附表11 电费成本模型（grid_posted_price/third_party_price/pv_grid_price/pf_reward_rate） | 月 | ElecCostService 自有 resolveCfg | ElecCostView | 不进催缴单派生，本文不展开 |

⚠ 三套版本语义并存：A 常数键前滚 / A 月变键精确 / B 月行仅当月 / D 版本组前滚。详见 §4。

---

## 1. 参数注册表

### 1.1 价目簿 `tenant_price_cfg`（含白名单外、引擎在读的键）

「消费点」列：`BN`=BillNoticeService，`AS`=AllocService；行号=当前文件行号。「UI 入口」：**价目页**=`/price-cfg` 左栏；**系数簿**=催缴单页→系数簿窗口；**无**=只能 SQL。

| 键 | 作用域(库内现有) | 版本语义 | 消费点 + 公式片段 | 影响费项行 | 现有 UI 入口 | 白名单 | 备注 / 库现值 |
|---|---|---|---|---|---|---|---|
| `elec_peak` | `''` 月行 2023-08 / 2023-10 / 2024-02 | 月变：仅当月；级联 tenant→zone→'' | BN L584/L592 `hit=resolveHit("elec_"+seg,ym,tid,zone)`；`amount=r2(u×p)` L599；尖段合成 L588-589；AS L1715 `pPeak=elec_peak+mgmt_fee`(p2 池价，zone 级、tenantId=null) | `elec` 行(seg=peak) ；p2 池 cost | 价目页(月变，输入=录当月版本；「复制上月电价」6 键) | 内 | 1.20606875(2024-02) |
| `elec_sharp` | 同上 | 同上 | BN L583 名义价；实收 `p = r×sharp + (1−r)×peak`，`r=sharp_as_peak_ratio` L586-589，note「尖按峰比率r=」；AS L1714/L1722 `p2Unrounded` | `elec`(seg=sharp) | 价目页 | 内 | 1.50076875 |
| `elec_flat` | 同上 | 同上 | BN L592；G 形 park 表回退 L401 `price.resolve("elec_flat",ym,null,pkm.getZone())`（tenantId=null，仅 zone 级）；AS L1716 & L1723 无分时回退 `q.total×pFlat` | `elec`(flat)；损耗 base(G 形) | 价目页 | 内 | 0.72076875 |
| `elec_valley` | 同上 | 同上 | BN L592；AS L1717 | `elec`(valley) | 价目页 | 内 | 0.29116875 |
| `elec_resident` | 同上 | 同上 | BN L604-605 `singlePrice(...,"elec_resident",zone=dorm)`(is_dorm_room=1 分支) | `elec`(宿舍房间表) | 价目页 | 内 | 0.63586875 三个月同值 |
| `elec_commercial` | 同上 | 同上 | BN L608-609 `singlePrice(...,"elec_commercial")`；AS L1728 p1/dorm 池价 `elec_commercial+mgmt_fee_commercial`；AS priceGate L1659-1663 p1/dorm 缺当月 ⇒ 池生成拒绝 | `elec`(商业单一价) ；p1/dorm 池 cost | 价目页 | 内 | 0.79416875 |
| `mgmt_fee` | `''`=0.16；`tenant:` 17 户(0/0.10/0.15) | 常数前滚；级联 | BN L573/L603 分时或宿舍房间 → `mgmtKey="mgmt_fee"`；L614-618 `mg=resolveHit(mgmtKey)`，`amount=r2(mgmtBase×mg)`，`mgmtBase=Σ段用量`(E3)否则总量；**值 0 或查无 ⇒ 不出行** L615；AS L1713 p2 池价叠加(zone 级) | `mgmt_fee` 行；p2 池 cost | 价目页(全园行)；系数簿「电力管理费单价」(与 `mgmt_fee_commercial` 双键同值成对写) | 内 | 户级 0=13 户(包干户配套)、0.10×2、0.15×2 |
| `mgmt_fee_commercial` | `''`=0.32；`tenant:` 17 户 | 常数前滚 | BN L607 商业单一价 → `mgmtKey`；L614-618 同上；AS L1729 p1/dorm 池价叠加 | `mgmt_fee` 行(price_key=mgmt_fee_commercial)；p1/dorm 池 cost | 价目页；系数簿(仅作 mgmt_fee 的配套键，前端 `overridable:false` 不单独可选) | 内 | 与 mgmt_fee 户级行成对 |
| `sharp_as_peak_ratio` | `''`=0 | 常数前滚；BN 带 tenantId 级联(户级可覆盖)，AS L1718 zone 级 | BN L586 `ratio=nz(resolve(...))`；AS L1718 → `p2Unrounded` L281-288 | `elec`(sharp) 实收价；p2 池 | 价目页(全园行) | 内 | 0=尖按峰收 |
| `capacity_fee` | `''`=22.6；`tenant:107`=23 | 常数前滚；级联(zone=合同楼栋 zone) | BN L269-290：`kva>0 ∧ covers(c,first,last) ∧ kind≠master_lease`；`hit=resolveHit("capacity_fee",ym,tid,zone)` L276；`amount=r2(kva×hit×frac)`，`frac=在租天数/当月天数` L279-283 | `capacity` 行 | 价目页；系数簿「装机容量费单价」 | 内 | 22.6「55 户实证」 |
| `water` | `''`=3.95；`dorm`=3.85；`tenant:` 8 户(4.45×6, 3.85×2) | 常数前滚；级联(zone=dorm 当 is_dorm_room) | BN L632-633 `singlePrice(...,"water",zone,total)`，`amount=r2(吨×价)` L652 | `water` 行 | 价目页；系数簿「水价」(配套 `water_pipe=0` 强制同写) | 内 | 4.45=水+管网合并价 |
| `water_pipe` | `''`=0.5；`dorm`=0；`tenant:` 7 户=0 | 常数前滚 | BN L634-638 `pipe=resolveHit`，**查无或 0 ⇒ 不出行**；`amount=r2(吨×pipe)` | `water_pipe` 行 | 价目页(全园/宿舍行)；系数簿仅作水价配套(固定写 0) | 内 | |
| `lamp_area_base` | `p1`=80000；`dorm`=15510 | 常数前滚；AS **zone 级**(tenantId=null) | AS L1766-1767 `base = rule.base_key!=null ? priceCfg.resolve(base_key,ym,null,zone) : coefficientOf(rule)`；进 `stdQtyPriceOverBase`/`stdAmountOverBase` L291-302 分母 | 池 std（rule 25 一期路灯 / 90 宿舍路灯 / **91 宿舍绿化水也挂 lamp_area_base**）→ `share_elec_light`/`share_green_water` 行 | 价目页(仅显示已有 scope 行) | 内 | 池抽屉「基数键」文本框可把任意键名写进 rule.base_key，无校验 |
| `green_area_base` | `p1`=80000 | 同上 | AS L1767（rule 100 一期绿化水） | `share_green_water` p1 | 价目页 | 内 | note：原 15510 系误拷，0.009 反推=80000 |
| `area_base` | `p2`=148918.01 | 同上 | AS L1767（rule 4/9/13/15/17/18/21 二期园区级池） | p2 消防/绿化水/路灯/广告字 std | 价目页 | 内 | 手输常数(POOL-FORMULA-AUDIT) |
| `elevator_area_base` | `p1`=12487.04 | 同上 | AS L1767（rule 40 A座电梯） | `share_elec_elevator` p1 | 价目页 | 内 | 「历史计费面积,原表硬编码」 |
| `loss_rate` | `dorm`=0.012 | 常数前滚 | **无消费点**（BN L337 注释：宿舍段损耗行已删，「保留配置暂不消费」；grep 全后端无 resolve("loss_rate")） | 无 | 价目页(显示/可改，无效) | 内 | 死键 |
| `elec_package` | `tenant:` 15 户(1.0×3/1.2/1.3/1.5×10) | 常数前滚；**只认 tenant: 命中** L562 | BN L561-568：命中 ⇒ 该户**全部电表**单行 `amount=r2(total×pkg)`，不出 mgmt 行、不分时 | `elec` 行(price_key=elec_package, rule_branch=tenant_override) | 系数簿「包干电价」(配套 mgmt 双键=0)；价目页显示 `''` 空行可录(录了引擎不认) | 内 | |
| `share_elec_fixed` | `tenant:` 5 户(47.2~232) | 常数前滚；只认 tenant: L864 | BN `applyPackages` L841-843 → `packageLine` L859-894：吞掉该户非 dorm 的 `share_elec_floor/fire/elevator/light` 池行，落一条 `share_elec_floor` 固定额行(pool_rule_id=该户 floor 池锚点 L830-840)；值 0 ⇒ 只吞不落 L876 | `share_elec_floor`(固定) ；进 E2 损耗基数 | 系数簿「公共用电包干额」 | 内 | 原名 elevator_package |
| `share_water_fixed` | `tenant:` 5 户 | 同上 | BN L844-845，吞 `share_green_water` 落固定行 | `share_green_water`(固定) | 系数簿「公共用水包干额」 | 内 | |
| `green_rate` | `p2`=0.01(退役行)；`tenant:` 37 户=0.01 | 常数前滚；**只认 tenant:** L801 | BN `collectPrice` L788-812：绿化水池行 `collect = tenant 命中 ? hit : c.rate()(当月池核算率)`；`amount=r2(collect×base)`；note「收取价例外;核算率 x 备查」 | `share_green_water` p2 行的 price_snap/amount | 系数簿「绿化水收取价」；价目页显示 p2 行 | 内(S14 补) | 0.01=死模板 公共电分摊!M109 |
| **`lamp_rate`** | `p2`=0.005(退役行)；tenant: 0 行 | 同上，只认 tenant: | BN L799-804 同 collectPrice 路灯分支 | `share_elec_light` p2 | **无**（不在白名单，系数簿也无此键） | **外** | 引擎支持户级例外但无路可写 |
| `green_rate_live` / `lamp_rate_live` | `tenant:` 16 / 10 户 =1 | — | **无消费点**（BN L798 注释「旧机制退役…行留档备查」） | 无 | 无 | 外 | 死行 26 条 |
| **`fire_amount_fixed`** | `tenant:` 3 户(0 / 72.59 / 175.48) | 常数前滚；只认 tenant: | BN L850-851 `packageLine(...,"fire_amount_fixed","share_elec_fire",Set.of("share_elec_fire"))`：整户 `share_elec_fire` 池行替换为一条固定额；0=免收 | `share_elec_fire`(固定)；进 E2 base | **无** | **外** | S13 拍板③ 手输 |
| **`loss_base_form`** / **`loss_base_form_b{bid}`** | `tenant:` 36 户(1×34,3,7) / `tenant:60.loss_base_form_b32`=6 | 常数前滚；只认 tenant: | BN `lossBaseForm` L976-983：链内楼栋 `_b{bid}` 优先→整户；值 1=A(+管理费) 3=C(仅户电+容量) 6=F(去电梯+管理费) 7=G(+park表电费)，其余=B；进 E2 圈行判据 L363-379 | `share_elec_loss` 行 base_snap/amount | **无** | **外** | 值域是代码魔数 FORM_A=1… L974 |
| **`loss_base_park_amount`** | `tenant:23` **2024-02 月行**=11435.07 | 常数前滚(⚠会滚到 2024-03+) | BN L391-392 G 形：`add=r2(amtHit)` 直接并入首桶电费侧 L404-411 | 损耗 base(永龙) | **无** | 外 | 「逐月照抄册面金额」 |
| **`loss_base_park_meter`** | `tenant:23`=1468 | 常数前滚 | BN L394-402：无金额覆盖时 `u=usage(park表)`，`add=r2(u×elec_flat(zone))` | 同上 | 无 | 外 | 表 id 存成 DECIMAL |

**级联细节（BN 侧 zone 参数）**：电/水表行 `zone = is_dorm_room==1 ? "dorm" : meter.zone`（L557/L629）；容量费 `zone=zoneOfBuilding(contract.building_id)`（L275）；包干/消防/损耗形态类 `zone=null`（只 tenant→''）；p2 收取价 `zone="p2"` 硬写（L800）。AS 侧全部 `tenantId=null`（zone→''）。

### 1.2 池/损耗参数 `alloc_cfg`（引擎 `cfgVal(ctx,scope,key)`，AS L1023）

| scope.键 | 库现值 | 消费点 + 公式 | 影响 | UI 入口 | 备注 |
|---|---|---|---|---|---|
| `p1.price_flat` | 1.11417(默认行) | AS `lossPrice` L1387-1390：`price_loss ?? price_flat` → `lossContributions` L1396 `lossFee=r2(用电×I×price)` L312；`ruleCostAmount` L1059(仅 recon 端点) | 损耗屏度数口径金额；`rate==null∨price==null ⇒ 该 zone 不出损耗行` L1397 | **无** | note「=供电局月均+0.16(创显承担电费!O3,2024-02 锚)」手输常数；BN E2 最终按 `chainBase×率` 覆写金额 L435，price 只当门槛 |
| `p2.price_loss` | 1.25312 | 同上 | 同上 | **无** | note「=1.09312+0.16(分摊分析 K27 硬编码常数收编)」 |
| `p2.price_norm/price_sharp/price_peak/price_valley` | **无行** | AS `ruleCostAmount` L1065-1072（recon 端点，前端未调用） | 死路径 | 无 | 早期口径，已被 tenant_price_cfg 电价替代 |
| `p1.park_share_div` | 6 | AS `shareQtyOf` L1359-1371：`G=ROUND(Σ(p1 park_loss_pool 池净量)/div,2)` | 一期损耗率 G 列 | 无（楼栋损耗屏 G_TITLE 悬浮只**说明**它=6） | 手输常数 |
| `p1/p2.loss_supply_meter` | 266 / 1 | AS L1313-1314 供电侧总表不入损耗组；L2186 对账 | 损耗对账 | 无 | |
| `building:{id}.loss_head` | 31→32, 33→32 | AS L1320 分组头栋 | 损耗链归组 | 楼栋损耗「本月口径」面板只读展示 | |
| `building:{id}.loss_c_meter` | 13→179 | AS L1338 组 C 只取该总表 | 损耗 C | 面板只读 | |
| `building:{id}.loss_variant` | 20/21=1, 25=2 | AS `lossVariant` L1374-1379：0/缺=net, 1=share_only, 2=不出率 | 收取率 I 公式 `tenantLossRate` L267-275 | 面板下拉(写月行) | |
| `building:{id}.loss_recon` | 13=0 | AS L2193 排除对账 | 对账 | 面板只读 | |
| `building:{id}.loss_adj_rate` | 2024-02 月行 0.002~0.018 ×10 栋 | AS `groupRate` L1447 `I=base+adjRate` | 收取率 | 楼栋损耗行内「调整损耗」格(月行) | **仅当月**生效，2024-03 起自动归 0 |
| `building:{id}.loss_adj_qty` | 2024-02 月行 300/−2500/1000/98.3 | AS `groupAdjQty` L1437-1441 → `tenantLossRate` 分子扣减 | 同上 | 行内「调整度数」格 | 同上 |
| `building:13.loss_g_adj` | 2024-02 −1500 | AS `groupG` L1384 | 一期 G | 行内「G调整」格 | 同上 |
| `meter:{id}.loss_exclude` | 57/58/76/268/307 =1(默认行) | AS L1316-1317 不入 C/D | 损耗残差 | 面板 checkbox「本月计入Σ」(写 0 月行压过默认) | |
| `rule:{id}.coefficient` | 2024-02 月行 ×~40 池 | AS `coefficientOf` L1524-1527 覆盖 rule.coefficient → base(层数/面积Σ) | 池 std | 公共电核算编辑态「系数(月)」列 | 仅当月 |
| `rule:{id}.extra_qty` | 2024-02 月行(−670/170/100/200) | AS `poolExtra` L1519-1522 → 净量/std | 池 qty/std；park 池加度进 G | 「加度(月)」列；楼栋损耗面板「池加度」 | 仅当月；`alloc_rule.extra_qty` 默认列不限月 |
| `rule:{id}.std_add` | rule:12 2024-02 =100 | AS L1770 → std 末端叠加 | 广联池 std | **无** | |
| `rule:{id}.price_override` | rule:100=4.45(默认) ；rule:90=1.13156875 / rule:91=4.45(2024-02) | AS L1726-1727 p1/dorm 池单价覆盖 | 池 cost | **无** | 手输常数(4.45=3.95+0.5；1.13156875 宿舍路灯化石价) |
| `rule:{id}.manual_qty` | rule:91 2024-02 =84 | AS L1547-1548 整体替代表用量；L1730 手输量池 cost 净量一次 ROUND | 宿舍绿化水池 | **无** | |
| `rule:{id}.frozen_2023` | rule:4=0.01, 13=0.01, 18=0.005, 20=205.39 | **不参与计算**；前端 `poolLedgerLogic.FROZEN_CFG_KEY` 只在「分摊标准」列 title 披露 | 展示 | 公共电核算 ❄ 悬浮只读 | 2023 冻结事实 |

### 1.3 池规则列 / 层份 / 主数据里的「参数」

| 载体 | 字段 | 消费点 | UI 入口 |
|---|---|---|---|
| `alloc_rule` | `method(area/floor/direct/none/ref/carrier/manual/loss)`、`coefficient`(默认基数)、`extra_qty`(默认加度)、`base_key`(价目簿键名字符串)、`round_scale`(默认 2)、`std_kind`(amount_over_base/qty_over_base/qty_price_over_base；空 ⇒ p2=amount、其余=qty_price L1771-1772)、`fee_key`、`building_id/zone/floor_label/side` | AS `computePool` L1682-1795、`memberAmounts` L1115-1278 | 公共电核算池配置抽屉 ③「怎么摊」(基数/基数键/默认加度/出口费项/分摊标准算式/ROUND 位数) |
| `alloc_rule_meter.sign` | ±1 净额池 | AS L1529-1533/L1744 | 抽屉 ② 表勾选 +1/−1 |
| `alloc_rule_link(link_type=fold_price/fold_qty)` | 折入链 | AS L1700-1708/L1746-1749 | 抽屉 |
| `alloc_rule_member.weight` (+`acct_month`) | 层份；null=按楼层分桶 L1210-1238；电梯池首层桶不摊(`skip1F` L1227 硬规则) | AS floor/ref 池 | 抽屉 ④ 成员表 + 「只改本月」checkbox；系数簿「电梯层份/消防层份」(仅二期) |
| `contract.kva` | 容量费 qty (BN L271/L287)；`lineMonthly per_kva_month=kva×1`(ContractService L755，变压器 1 元/kVA 隐含) | BN | 合同页 |
| `contract.start/end/kind/status/rent_free/building_id` | 在租判定 `covers`、按天折 `prorate` L746-753、免租扣 `rentFreeCut` L757-780、损耗链归属 L332-334 | BN | 合同页 |
| `contract_billing_term(fee_key,bill_mode,unit_price,area,area_shared,coeff,room_count,amount_override,location,property_type)` | 租金行 `lineMonthly`(BN L711)；`rentAreaByContract`(share 拆场地/池面积基数) L187-190；宿舍间面积 L195-197 | BN/AS | 合同页 |
| `meter.is_dorm_room` | 判定树②(居民价 + dorm 水价) L556/L628 | BN | 表档案(建档定死) |
| `meter.zone/building_id/ownership/suspect/sub_name/sort_no/factor_snap` | zone 级联 / 损耗组 / 表序 | BN/AS | 表档案/导入 |
| `bill_pay_company(tenant,fee_key→company)` | 拆单 L459-476 | BN | 催缴单页「指定收款公司」 |
| `tenant.offbook` | notice_kind=offbook L458 | BN | 租户页 |

---

## 2. BillNoticeService 硬编码常数清单

**结论先行**：`BillNoticeService.java` 里**没有任何单价/费率数字字面量参与金额计算**——所有单价都经 `price.resolveHit/resolve` 取自 `tenant_price_cfg`，公摊金额取 `alloc.poolContributions`。文件里出现的 0.16/0.32/3.85/3.95/0.5/0.005/0.01/0.012/0.0616 全在**注释**里（L337、L389、L550-551、L623、L785-797、L819-823），描述的是库值/源册值。参与计算的字面量只有下面这些「结构常数」：

| 行号 | 字面量 | 用途 | 本该属于哪个参数 |
|---|---|---|---|
| L974 | `FORM_A=1, FORM_B=2, FORM_C=3, FORM_F=6, FORM_G=7` | `loss_base_form` 值域魔数（库里存 1/3/6/7） | 应是枚举/字典表（形态含义 A/B/C/F/G 只在注释 L349-350、L985-990） |
| L363-379 | 白名单 `share_elec_floor / share_elec_elevator / share_elec_fire`（+A/F/G 并 `mgmt_fee`，C 并 `capacity`） | E2 损耗基数圈行规则 | 「损耗基数构成」应是可配置的费项集合而非 if 链 |
| L282-283 / L751-752 | `days/total`，scale 10 / 8 | 容量费、租金按天折 | 折算口径(闭区间、当月天数)是政策，可保留代码 |
| L389-401 | `"elec_flat"` + `zone=pkm.getZone()` | G 形 park 表回退价=当地平段价，「其 0.16 管理费仍不收」 | 回退价键选择是硬编码决策 |
| L505 | `5` | premise_text 超 5 项收敛 | 展示常数 |
| L533 | `500` | 明细批量 INSERT 分片 | I/O 常数 |
| L436/L505/L733/L938 | `255` / `64` | note/premise 截断长度 | 列宽 |
| L1010/L1117 | `3~4` 位数字 = 房号 token | 场地定位 | 启发式规则 |
| L1227(AS) | `FEE_ELEVATOR` 首层桶不摊 | 电梯池政策(纸约「首层不承担电梯费」) | 应是池级开关 |
| L475(AS) | `0.01` | Σweight 偏离系数 T 容差 warn | 容差 |
| L798(AS) | `0.005` | 快照 stale 判定 | 容差 |
| ContractService L755 | `per_kva_month → kva×1` | 变压器维护费 1 元/kVA/月（BILL-FORWARD-SPEC L121：<150kVA=159 元/月走 per_month，值在计费行里） | 1 元/kVA 应是价目键 |
| ContractService L774/L930 | `0.8` | 建筑面积=租赁面积×0.8 | 面积换算系数 |

**库里的「代码常数搬家」**（值本身是硬编码/推导得来，藏在 note 里，无 UI）：`alloc_cfg p1.price_flat=1.11417「供电局月均+0.16」`、`p2.price_loss=1.25312「1.09312+0.16」`、`p1.park_share_div=6`、`rule:100.price_override=4.45「3.95+0.50」`、`rule:90.price_override=1.13156875`、`rule:91.manual_qty=84`、`rule:12.std_add=100`、四条 `frozen_2023`(0.005/0.01/0.01/205.39)、`tenant_price_cfg p2.lamp_rate=0.005/green_rate=0.01`(死模板 M99/M109)、`p1.elevator_area_base=12487.04`、`p2.area_base=148918.01`。

---

## 3. UI 入口地图

### 3.1 价目管理页 `/price-cfg`（sidebar 数据中心 → 出账链·应收派生 → 合同管理 之后，`fpNav.ts` L15）

- **结构**：标题 → 工具栏(年/月 Select + 「电价 n/6」徽标 + 编辑态「复制上月电价」+ 「编辑模式/完成」) → 双栏。
- **左栏价目表**（`buildPriceGrid`）：按 `PRICE_KEYS` 5 组(电价·月变 6 / 附加与开关 3 / 容量与水 3 / 月推参数 4 / 特殊轨道 5)分组；**每键一行×库里已出现过的非户级 scope**（'' / p1 / p2 / dorm；全无则给 '' 空行）。列：费项(label+unit, hint 作 title) | 范围 Badge | 生效价(resolvePrice) | 生效自('' ⇒「长期」) | 更新时间 | 编辑态「新价(N月起)」input。
- **写语义**：input `@change` 即时 `PUT {scope,cfgKey,acctMonth=选定月,value}`；清空=删该月版本行(value=null)。粒度=**(全园|期)×键×选定月版本**。不能：改 note；新增库里没有的 zone 行（如 p1 级 capacity_fee）；写户级行；写非选定月。
- **复制上月电价**：`POST /copy {fromYm=上月,toYm=选定月}` 仅 6 月变键，目标已有跳过。
- **右栏上卡「版本状态」**：电价当月版本 n/6 + 缺哪几个；各组生效键计数；全簿最近更新。
- **右栏下卡「户级例外」**：只读表(租户|费项|值|生效自，title=note)；编辑态末列删除(`PUT value=null`)；提示「批量新增/修改请到 催缴单→系数簿」。**无新增**（S14 §3.1 删掉了 FPDrawer）。
- **生效**：`PriceCfgService.upsert/copy` 写后 `evict()`（进程内 volatile 索引置 null）→ 下一次 alloc/bill generate 即取新值；**不触发**任何重生成，页面无「去重生成」引导。

### 3.2 系数簿窗口（催缴单页 `/bill-notices` 标题行「系数簿」按钮 → `CoefBookWindow`）

- **结构**：FPDrawer 居中卡片；控制行 = 期页签(一期/二期/三期，`resolvePhase` 归期) + 搜租户名 | 系数下拉(一次一个) + 生效年/月(默认=催缴单页 ym) | 编辑模式；统一修改条(输入一个值 → 「应用到选中」写暂存；「清除模式」=应用空值)；表 = ☑ | 租户 | 楼栋(按楼栋分组) | 当前生效值·生效自(户级例外徽标；层份显各池 weight/自动) | 暂存新值(×撤销)；底部「保存(n)」顺序提交，失败中断并刷新。
- **9 个系数键**（`COEF_KEYS`）与写计划：`mgmt_fee`(→ 写 `mgmt_fee`+`mgmt_fee_commercial` 同值) / `elevator_share`、`fire_share`(层份，仅二期；→ `PUT /alloc/rules/{id}` 整名单 `memberMonth=生效月` 版本组) / `water`(→ `water` + `water_pipe=0` **强制**) / `capacity_fee` / `green_rate` / `elec_package`(→ + `mgmt_fee=0` + `mgmt_fee_commercial=0`) / `share_elec_fixed` / `share_water_fixed`。
- **粒度**：`tenant:{id}` × 键 × 生效月版本(常数键前滚)；清除=删该月版本行。只列**当月有在租合同**的租户(props.contracts)。
- **生效**：价目键走 `PUT /price-cfg` ⇒ evict；层份键写 member 月版本 ⇒ 无缓存。仍需用户手动「重新生成」催缴单；层份/收取价类不需要重生成池，但 mgmt_fee 改动**会改 p2 池 cost**（AS L1713 zone 级 mgmt_fee 叠加，户级不影响池）——只有全园行才影响池。

### 3.3 公共电核算 `/alloc`（PoolLedgerView）

- 编辑态表内两列 **系数(月)/加度(月)** → `PUT /alloc/cfg {scope=rule:{id}, cfgKey=coefficient|extra_qty, acctMonth=ym}`（月行=仅当月）；置 `cfgDirty` 橙条「配置已变,请重新生成」。
- **池配置抽屉**（点池名/新建）：① 定位(zone/楼栋/楼层/侧向/费名) ② 表勾选+sign ③ 分摊方式 radio + 基数(默认 coefficient) + **基数键**(自由文本 `如 area_base`，无下拉无校验) + 默认加度 + 出口费项 + 分摊标准算式 + ROUND 位数 + 备注 ④ 受益人勾选/层份 weight/「只改本月」checkbox(实际语义已是「自本月起版本组」，文案未改 L1057) ⑤ 折入链。保存 `PUT /alloc/rules/{id}`。
- 「生成本月/重新生成」按钮(编辑态)：`POST /alloc/generate` → priceGate(电价当月版本) → 池/损耗快照先删后插 → warnings 面板。
- 「分摊标准」列 ❄ title 披露 `frozen_2023`（只读）。
- **不可改**：`rule:{id}.price_override/manual_qty/std_add`、`p1/p2.*`、`frozen_2023`。

### 3.4 楼栋损耗 `/alloc-loss`（LossLedgerView）

- 编辑态行内三格：调整度数 `loss_adj_qty` / 调整损耗 `loss_adj_rate` / G调整 `loss_g_adj` → `building:{head}` **月行**。
- 「本月口径」面板(`calibRows`)：`meter:*.loss_exclude`(checkbox「本月计入Σ」→ 写 0 月行) / `building:*.loss_variant`(下拉，写月行) / 池 `extra_qty`(输入，写 rule 月行) 可改；`loss_c_meter/loss_head/loss_recon` 只读；默认行(所有月份)标红。
- 「去公共电核算重新生成」→ `router.push('/alloc?ym=&generate=1')` 带账期进编辑态。
- **不可改**：`p1.park_share_div`(悬浮文字说明=6)、`price_flat/price_loss`、`loss_supply_meter`。

### 3.5 其他能改「参数」的页面

| 页面 | 能改 | 粒度 | 生效 |
|---|---|---|---|
| 合同管理 | kva / 起止 / 免租期 / 计费行(单价/面积/公摊面积/系数/位置/宿舍间) / 单元绑定 | 合同 | 催缴单重生成即读(租金行、容量费、拆场地比例、层定位面积)；池 `base`/`std` 是快照，面积基数类需重生成池 |
| 园区抄表/表档案 | is_dorm_room / zone / building / ownership / suspect / factor / sub_name | 表 | 重生成池+催缴单 |
| 催缴单页 | 收款公司指定(bill_pay_company)、备注覆盖(bill_note_override)、确认/导出状态 | 户×费项 | 拆单在下次重生成；备注覆盖跨重生成保留 |
| 租户页 | offbook、别名 | 户 | 重生成 |
| SQL only | `fire_amount_fixed`、`loss_base_form(_b{id})`、`loss_base_park_*`、`lamp_rate` 户级、`alloc_cfg` 的 `price_override/manual_qty/std_add/p1|p2.*` | — | 价目簿类须**重启后端**(索引不 evict)；alloc_cfg 类下次 generate 即读 |

---

## 4. 缺口清单

### 4.1 引擎读、界面改不了
1. `fire_amount_fixed`（3 户，S13 拍板③）——白名单外，价目页例外卡能看能删、不能增改；系数簿无此键。
2. `loss_base_form` / `loss_base_form_b{bid}`（37 行）——白名单外；值域 1/3/6/7 是代码魔数，无字典。
3. `loss_base_park_amount`（月行）/ `loss_base_park_meter`（表 id 存 DECIMAL）——白名单外。
4. `lamp_rate` 户级例外——BN L799 支持，白名单外、系数簿无键 ⇒ 无路可写（`green_rate` 有）。
5. `alloc_cfg`：`rule:{id}.price_override / manual_qty / std_add`、`p1.price_flat`、`p2.price_loss`、`p1.park_share_div`、`p1|p2.loss_supply_meter`、`building:*.loss_head/loss_c_meter/loss_recon`（后三个面板只读）。
6. `alloc_rule.base_key` 只能手打字符串（无下拉/校验），键名错了引擎 warn「基数键 x 未取到值」才知道。
7. 价目页无法为已存在的键**新增 zone 行**（如给 p2 单独 capacity_fee / 给 dorm 单独 mgmt_fee）：`buildPriceGrid` 只按库里已有 scope 出行。
8. 户级例外新增只能经系数簿，且系数簿只列**当月有在租合同**的户；`sharp_as_peak_ratio` 户级、`water_pipe` 户级非零、`mgmt_fee_commercial` 单独户级 均无入口。
9. `note`（数值来源锚点）任何 UI 都不能编辑；系数簿写死 `'系数簿批量'`。
10. 催缴单「作废」端点存在(`POST /{id}/void`)但按钮撤下 ⇒ 已确认/已导出户改参数后无法从 UI 重派（generate 整户跳过并计入 skippedConfirmed）。

### 4.2 有入口但语义混乱/重复
1. `mgmt_fee` vs `mgmt_fee_commercial`：引擎按表分支二选一(分时/居民→前者，商业单一价→后者)，但户级例外靠「双键同值成对写」惯例(系数簿/SQL 17 户 ×2 行)来保证压过；PRICE_KEYS 里后者 `overridable:false`，价目页例外卡却列着 17 条它的户级行。
2. `green_rate`：p2 zone 行 0.01 与户级 37 行 0.01 并存，引擎只认 tenant:（L801）——p2 行是退役死行但价目页照显「二期 0.01 生效」；`lamp_rate` 同形且不在白名单。
3. `green_rate_live` / `lamp_rate_live` 26 行死行留库（注释「行留档备查」），价目页例外卡照列。
4. `loss_rate`(dorm 0.012) 在白名单、价目页可改、引擎不消费。
5. `elec_package` / `share_*_fixed` / `green_rate` 引擎只认 tenant:，价目页却给出 `''` 空行可录全园值（录了静默无效）。
6. `water` 户级 4.45 是「水+管网合并价」，系数簿强制配套 `water_pipe=0`；若某户只是水价不同而管网照收，UI 做不到。
7. `elec_package` 系数簿配套写 mgmt 双键=0 属冗余（引擎命中包干直接 `return`，L567 不走 mgmt）；13 户 mgmt=0 行意义模糊（既像包干配套又像免收）。
8. 池抽屉「只改本月」checkbox / AS L1180 warn 文案仍说「只改本月」，实际 `pickMembers` 已是「自本月起版本组前滚」(S14)；系数簿文案已改。
9. `alloc_cfg` 与 `tenant_price_cfg` 都有 `price_*` 概念：`p1.price_flat` 是损耗计费价兼 recon 单价（含 0.16），与价目簿 `elec_commercial+mgmt_fee_commercial` 重复表达同一件事，且不随月变。
10. `capacity_fee` 22.6 全园常数，与合同侧变压器 `per_kva_month=kva×1` / 159 元月额是两套 kVA 计费并存(不同费项，但同源 kva)。

### 4.3 月版本语义不一致
| 载体 | 语义 | 例 |
|---|---|---|
| 价目簿电价 6 键 | 月行=**仅当月**；缺=null → 池 priceGate 拒绝 / 催缴单 warn「缺价」 | 2023-08/2023-10/2024-02 各一套，2023-09 无价 |
| 价目簿常数键 | 月行=**自该月起前滚** | `tenant:23.loss_base_park_amount 2024-02=11435.07`（本意「逐月照抄册面」）会滚进 2024-03+ 所有月份 |
| `alloc_cfg` 全部键 | 月行=**仅当月**，默认行=所有月份 | `building:*.loss_adj_rate 2024-02` 只对 2 月生效，3 月归 0；`rule:*.coefficient 2024-02` 只对 2 月生效，3 月回落 `alloc_rule.coefficient` 默认列 |
| `alloc_rule` 列 / `alloc_cfg` 默认行 | 常数(所有月份) | 招商中心 `extra_qty=−670`（规则默认列）对每个月生效（楼栋损耗面板标红的病根） |
| `alloc_rule_member` | 版本组前滚(S14) | 现库 251 行全 `''`，零月行 |
| `frozen_2023` | 常数、不参与计算 | — |

前端 `LossLedgerView` 注释(L100-107)与「本月口径」面板已把「默认行=所有月份」当风险披露；价目页/公共电核算页无同类披露。

---

## 5. 生效链（改参数 → 生效）

```
[改价目簿] 价目页 / 系数簿 ──PUT /price-cfg──▶ PriceCfgService.upsert → evict()(进程内索引)
   │  (SQL 直改 ⇒ 不 evict ⇒ 须重启后端才生效)
   ▼
[改池参数] 公共电核算月参 / 楼栋损耗面板 ──PUT /alloc/cfg──▶ alloc_cfg(无缓存) ；池抽屉 ──PUT /alloc/rules──▶ alloc_rule(+member)
   ▼
[重新生成池] 公共电核算 编辑模式 →「生成本月/重新生成」──POST /alloc/generate──▶
   priceGate(电价当月版本齐否) → computePools(取 tenant_price_cfg zone 级 + alloc_cfg + rule 列)
   → alloc_pool_result / alloc_pool_meter_result / alloc_loss_result 先删后插 → warnings
   ▼
[重新生成催缴单] 催缴单页 →「重新生成」──POST /bill-notices/generate──▶ BillNoticeService.generate:
   户级取价 resolveHit(实时索引) + poolContributions(ym)=池快照 cost/std/base × 实时成员/面积/层份 + lossContributions(实时 alloc_cfg)
   → 删 draft/void 重插；confirmed/exported 户整户跳过 → §5.9 回填 alloc_pool_result.allocated/gap
```

**哪一步依赖哪一步（现状）**：
- 价目簿电价/管理费全园行 → 影响池 cost ⇒ 必须**先重生成池**再重生成催缴单；户级例外只影响催缴单 ⇒ 只重生成催缴单即可。
- 面积基数键(`*_area_base`)、rule 系数/加度/std_add/price_override/manual_qty、表绑定 → 池 std/cost 快照 ⇒ 必须重生成池。
- 层份 weight、`green_rate` 户级、包干/消防固定额、`loss_base_form`、`building:*.loss_adj_*`、`loss_exclude/variant` → `poolContributions` 现算(members/loss 走 ctx) ⇒ 只重生成催缴单即可**算对户级金额**，但公共电核算/楼栋损耗屏上的池行/率仍是旧快照（屏与单不一致）直到重生成池。
- 合同 kva/面积/起止 → 催缴单侧即时；area 池 `base`(面积Σ) 是快照 ⇒ 池 std 不变。

**用户容易漏的步骤**：
1. 改了参数没先重生成池就重生成催缴单（价目页/系数簿保存后**没有任何**「去重生成」提示；只有公共电核算/楼栋损耗屏有 cfgDirty 橙条）。
2. 新账期没「复制上月电价」⇒ 池 generate 直接 400「缺 ym 电价」，催缴单 generate 不拦只在户 warn「缺价 elec_x」→ 少行不少单。
3. `alloc_cfg` 月行只管当月：为 2024-02 填的调整率/系数到 2024-03 自动失效，用户以为「上次改过」。
4. 已确认/已导出户被 generate 静默跳过（摘要计数 skippedConfirmed），UI 无作废按钮 ⇒ 参数改了单不变。
5. SQL 直落价目簿后忘重启（进程内索引不失效，S13 已踩坑）。
6. 池抽屉「只改本月」实为「自本月起」：勾了改历史月名单会滚到之后所有月。
7. 楼栋损耗屏 G 列/公摊度数只在重生成池后刷新；面板改 `extra_qty` 月行不刷新屏上数字（铁律二只 patch 那一格）。
8. 该月池从未生成 ⇒ `poolContributions` 返回空表(AS L1104)，催缴单 generate **不报错**、公摊/损耗行整批缺失，单头无 warn。

---

## 附：CFG_KEYS 21 键 vs 库内键 对照

- 白名单 21：elec_peak/sharp/flat/valley/resident/commercial · mgmt_fee · mgmt_fee_commercial · sharp_as_peak_ratio · capacity_fee · water · water_pipe · lamp_area_base · green_area_base · area_base · elevator_area_base · loss_rate · elec_package · share_elec_fixed · share_water_fixed · green_rate（PriceCfgService L32-38；PRICE-CFG-SPEC 仍写「19/20 键」，文档落后一键）。
- 库内白名单外(SQL 直落)：lamp_rate(p2 行) · green_rate_live ×16 · lamp_rate_live ×10 · fire_amount_fixed ×3 · loss_base_form ×36 · loss_base_form_b32 ×1 · loss_base_park_amount ×1(月行) · loss_base_park_meter ×1。
- 库统计：tenant_price_cfg 214 行(19 行带月份=18 电价月行 + 1 永龙)；alloc_rule_member 251 行全 `''`；bill_notice 291 draft / 7 exported。
