# 公摊池引擎 + 楼栋损耗引擎 —— 参数全盘点（代码考古，只读）

> 调研日期 2026-08-16。对象：`demo3/backend/.../service/AllocService.java`（2224 行，行号以本次读取为准）、`AllocController.java`、`AllocCfgReq/AllocCfgDTO/AllocRule*.java`、`AllocCfgMapper.java`、`PriceCfgService.java`；spec：POOL-ENGINE-SPEC / POOL-FORMULA-AUDIT-2024-02 / P1-UTILITY-FEE-STRUCTURE / P2-SHARE-LAYER-SPEC / PB-ALLOCATION-SPEC；前端 `PoolLedgerView.vue` / `LossLedgerView.vue` / `allocLogic.ts` / `poolLedgerLogic.ts` / `api/alloc.ts`；dev 库只读 SELECT（alloc_cfg / alloc_rule / tenant_price_cfg 现状快照见附录 A）。
> 纪律：忠实提取，不评价对错；「手输常数」= 库里/册上人工写死的数。

---

## 0. 参数住在四个地方（先看这张图）

| 存储位 | 版本语义 | 谁读 | 谁写 |
|---|---|---|---|
| **alloc_cfg**（scope, cfg_key, acct_month, cfg_value DECIMAL(14,8), note） | **默认行 `''` + 当月行覆盖，不前滚**：`AllocCfgMapper.selectEffective(ym)` = `acct_month IN ('', ym)`；`loadCtx` L930-933 先落默认行再用月行覆盖。2024-02 的月行对 2024-03 **无效**；默认行对**所有月份**生效 | `AllocService.cfgVal(ctx, scope, key)` L1023 | `PUT /api/alloc/cfg`（saveCfg L647-661）；迁移脚本 V47/V65/V66/V83；裸 SQL |
| **alloc_rule 列**（coefficient / extra_qty / method / std_kind / base_key / round_scale / fee_key / building_id / floor_label / side / zone） | **静态，所有月份**（无版本）；coefficient/extra_qty 可被 `rule:{id}` 月行压过 | computePool / poolSegQty / memberAmounts | `POST/PUT /api/alloc/rules`（PoolLedgerView 抽屉；CoefBookWindow 也走 updateRule） |
| **alloc_rule_member**（tenant_id, weight, acct_month） | **版本组前滚**：`pickMembers` L115-120 取 acct_month≤ym 的最大版本组整组替换（''=初始版最小） | memberAmounts / lossContributions(p2 stub) / pools 读侧 | updateRule 只覆盖目标月 `memberMonth`（L535） |
| **tenant_price_cfg**（PriceCfgService，scope 级联 tenant:{id}→zone→''） | 常数键**版本链前滚**（acct_month≤ym 最大）；月变键（elec_* 6 键）**仅当月** | `priceCfg.resolve(key, ym, null, zone)` | 价目管理页（白名单 19 键 `CFG_KEYS` L32-38）|
| **Java 字面量** | 编译期 | — | 改代码 |

⚠ 三套版本语义并存（alloc_cfg 不前滚 / member 前滚 / price 常数键前滚），是本次盘点最大的结构性发现之一。

---

## 1. 参数注册表

列义：键 | 作用域(scope 形态) | 存哪 | 版本语义 | 引擎消费点(方法+行号+公式片段) | 影响哪个数字 | 现有 UI 入口 | 备注

### 1.1 池级（rule:{id}）

| 键 | scope | 存哪 | 版本语义 | 消费点 | 影响 | UI 入口 | 备注 |
|---|---|---|---|---|---|---|---|
| `coefficient` | `rule:{id}` 月行 → 回退 `alloc_rule.coefficient` 列 | alloc_cfg + alloc_rule 列 | 月行仅当月；列=所有月 | `coefficientOf` L1524-1527；`computePool` L1766-1767 `base = rule.baseKey!=null ? priceCfg.resolve(baseKey) : coefficientOf(rule)`；`memberAmounts` floor 分支 `p.base()` 作 §E5/§7 warn 分母 L1204-1206/1235 | 池 **std**（分母 base）、`base_snap`；不影响 cost | 抽屉「基数(层数/受益面积Σ㎡)」= 列默认；编辑态表内「系数(月)」列 = 月行（PoolLedgerView L734/819-822 `commitRuleCfg`）；CoefBookWindow 不改它 | **base_key 非空时整体不读**（层定位面积池/园区面积池的「系数(月)」格是死旋钮）。dev 现状：36 条 2024-02 月行（3~2293.34） |
| `extra_qty` | `rule:{id}` 月行 → 回退 `alloc_rule.extra_qty` 列（NOT NULL DEFAULT 0） | 同上 | 同上 | `poolExtra` L1519-1522；① `poolSegQty` L1581 `if (net && any) total += poolExtra` —— **只有净额池(含 sign=-1 绑定)才并入用量**；② `computePool` L1779 `stdQtyPriceOverBase(q.total, net ? null : extra, base, price…)` —— 只有 std_kind=`qty_price_over_base`(p1/dorm 默认)时进 **std 分子**；③ `PoolCalc.extra` → `extra_qty_snap`；④ `netParts` L1984-1985「账册扣度」hover 项 | 净额池：qty_total/cost/std/G；非净额 p1/dorm：仅 std；**p2 amount_over_base / qty_over_base 完全不消费**（只落 snap） | 抽屉「默认加度」= 列；表内「加度(月)」= 月行；LossLedgerView「本月口径」面板 `onExtra` L210-216 也写 `rule:{id}.extra_qty` 月行 | dev：列默认非 0 仅 rule 23 招商中心净电 = **−670（手输常数，所有月份）**；月行 6 条 2024-02（+170/+100/+100/+100/+200/−670） |
| `manual_qty` | `rule:{id}` | alloc_cfg only | 默认行/月行 | `poolSegQty` L1547-1548 `manual!=null → total=manual, any=true`（**整体替代表用量**，且跳过绑定表循环）；`computePool` L1730-1732 manualPool → `cost=r2(total×price)`；`poolMeterLines` L1616 有 manual_qty 则逐表不出 cost | qty_total/cost/std | **无** | dev：rule:91 宿舍绿化水 = 84（2024-02 月行，手输吨数）；其他月该池 q.any=false→「缺读数」 |
| `price_override` | `rule:{id}` | alloc_cfg only | 默认行/月行 | `computePool` L1726-1729 **仅 p1/dorm 分支**：`price = override ?: elec_commercial+mgmt_fee_commercial`；p2 分支不读 | cost（净额/手输池 `r2(total×price)`；逐表池 Σr2(u×sign×price)）、std（qty_price_over_base 乘 price）、`price_snap`、逐表 cost | **无** | dev：rule:90 宿舍路灯 = 1.13156875（**2024-02 月行**，化石价）；rule:91 = 4.45（月行）；rule:100 一期绿化水 = 4.45（默认行）。⚠ rule:90 其他月回落商业综合价 1.11416875 |
| `std_add` | `rule:{id}` | alloc_cfg only | 默认行/月行 | `computePool` L1770 → 三个 std 纯函数末端 `.add(nz(stdAdd))` L294/301/308（**不再舍入**） | std | **无** | dev：rule:12 四车间电梯加价档 = 100（2024-02 月行，V64 的「+100 元」） |
| `frozen_2023` | `rule:{id}` | alloc_cfg only | 默认行（=冻结） | **引擎不读**（V83 头注红线）；前端 `poolLedgerLogic.FROZEN_CFG_KEY`，PoolLedgerView L231-238 取 note 进「分摊标准」title + ❄ | 无（纯披露） | 只显示 | dev 4 行：rule:18=0.005 / rule:13=0.01 / rule:20=205.39 / rule:4=0.01（2023 隐藏表 M99/M109/L24/L99） |
| `method` | 列 | alloc_rule | 静态 | `computePool` L1688 manual 早退；L1773-1781 std switch；L1785 ref/carrier cost=null；`memberAmounts` L1142 switch；`computeAll` L1083/1086-1091；`memberDiff` L2142 | 全部 | 抽屉「③怎么摊」单选（area/floor/direct/none，ref/loss/carrier 仅存量露出，manual 不可改） | 值域 direct/area/floor/loss/none/ref/carrier/manual；`AllocRuleReq` @Pattern 只允许 `direct|area|floor|loss|none|ref`（**carrier/manual 无法经 API 写入**） |
| `std_kind` | 列 | alloc_rule | 静态 | `computePool` L1771-1772 `kind = stdKind ?: (p2 ? amount_over_base : qty_price_over_base)` | std 算式 | 抽屉「分摊标准算式」Select（3 值+按 zone 默认） | dev：仅 rule 15/17/21 = qty_over_base（广告字档） |
| `base_key` | 列 | alloc_rule；值 → tenant_price_cfg | 静态；值本身走价目版本链前滚 | `computePool` L1766-1768 `priceCfg.resolve(baseKey, ym, null, zone)`；取不到 → warn「基数键 … 未取到值」且 base=null → std=null | std/base_snap | 抽屉「基数键(价目簿,优先于基数)」文本框（**无候选/无校验**）；值在价目管理页改 | dev 用到 4 键：`area_base`(p2 148918.01)/`lamp_area_base`(p1 80000, dorm 15510)/`green_area_base`(p1 80000)/`elevator_area_base`(p1 12487.04) |
| `round_scale` | 列（NOT NULL DEFAULT 2） | alloc_rule | 静态 | `computePool` L1769 `scale = roundScale ?: 2`；`apply` L577 默认 2 | std 舍入位 | 抽屉「标准 ROUND 位数」2/3 | dev：3 位 = rule 100/4/13/15/18/21 |
| `fee_key` | 列 | alloc_rule | 静态 | `computeAll` L1083 `share_water` 跳过；`memberAmounts`/`floorBuckets` **`FEE_ELEVATOR` 触发首层桶剔除** L1227/1885；`shareQtyOf` L1366 `PARK_POOL='park_loss_pool'` 决定进 G；`priceGate` L1657；`recon` L853 | 出口费项 + **两处行为开关** | 抽屉「出口费项」Select | 费键既是入账口径又是行为开关（首层不摊/进 G） |
| `alloc_rule_meter.sign` | 绑定行 | alloc_rule_meter | 静态 | `poolSegQty` L1551-1579（sign<0 ⇒ net；无分时的剔除表总量落平段 L1575）；`isNetPool` L1529-1533；`computePool` L1744 逐表 cost 乘 sign；`poolMeterLines` L1612 净额池不出逐表行 | qty/cost/std、净额池判定 | 抽屉「②表构成」勾选 + ±号 | 净额判定 = 任一 sign<0 |
| `alloc_rule_link`(fold_price / fold_qty) | 链行 | alloc_rule_link | 静态 | fold_qty：`poolSegQty` L1583-1591 源池整段量并入；`computePool` L1746-1749 折入行按净量单行 ROUND 计 cost。fold_price：`computePool` L1700-1708 `foldAdd = Σ src.std` → std 末端相加（L294/301/308） | qty/cost/std/fold_add | 抽屉「折入链」行编辑 | 环 → 409（L1540/L1689） |
| `alloc_rule_member.weight` | 成员行 | alloc_rule_member | **版本组前滚** | floor：`memberAmounts` L1210-1211 `amt = r2(perFloor×weight)`；weight=null → 楼层分桶 L1213-1238；ref：L1251-1254 `r2(std×weight)`；p2 loss stub L1419-1422（weight>0 才补零度受益人）；§7 warn L1198-1207 | 户级 amount、损耗受益人名单 | 抽屉「④分摊给谁」份额列；CoefBookWindow（S14 系数簿）批量改 | `weight` 语义随 method |
| `AllocRuleReq.memberMonth` | 写入版本 | — | 决定写 '' 还是 'YYYY-MM' 版本组 | `updateRule` L535 `deleteByRuleMonth(id, memberMonth)` 只覆盖目标月 | 受益人版本 | 抽屉「只改本月」勾选 | — |

### 1.2 楼栋级（building:{id}）—— 损耗引擎

| 键 | scope | 存哪 | 版本语义 | 消费点 | 影响 | UI 入口 | 备注 |
|---|---|---|---|---|---|---|---|
| `loss_head` | `building:{成员栋}` value=头栋 building_id | alloc_cfg | 默认行/月行 | `lossGroups` L1319-1322 `head = cfg ?: 自身`；`lossLabel` L2212-2214 组标签 | 分组（C/D/E 合并）、组名 | **无**（LossLedgerView「本月口径」面板只陈列 `edit:null`） | dev：building:31/33 → 32（二/三/四车间共用三车间总表） |
| `loss_c_meter` | `building:{head}` value=meter_id | alloc_cfg | 默认行/月行 | `lossGroups` L1338-1339 `cm==null || cm==m.id → headQty += u`（其余 infra 既不入 C 也不入 D） | C | **无**（面板陈列） | dev：building:13 A座 = 179（A座总电） |
| `loss_variant` | `building:{head}` 0/1/2 | alloc_cfg | 默认行/月行 | `lossVariant` L1374-1379：无分表→none；`==2`→none；`==1`→share_only；其余 net | 率公式变体、`variant` 快照 | LossLedgerView 面板 Select（**只写月行**；仅对已有 cfg 行的栋出现） | dev：building:20 B座=1、21 C座=1、25 G座=2（默认行） |
| `loss_adj_qty` | `building:{**每个成员栋**}` | alloc_cfg | 默认行/月行 | `groupAdjQty` L1437-1441 **Σ组内各成员栋**；`tenantLossRate` L272 `(E−G−adjQty)/C`（仅 net 变体用）；`lossTable`/`computeLossUnits` 落 `adj_qty` | I（net）、adj_qty | LossLedgerView 编辑态「调整度数」行内 `commitAdj`（写 **head** 栋月行） | dev：30=300、32=−2500、34=1000、35=98.30（2024-02 月行，二期 H 列手输常数） |
| `loss_adj_rate` | `building:{head}` | alloc_cfg | 默认行/月行 | `groupRate` L1447 → `tenantLossRate` L274 `base + adjRate`（两变体都加） | I、adj_rate | 「调整损耗」行内 | dev：一期 13=0.003/20=0.005/21=0.01/22=0.01/23=0.005/24=0.018；二期 30/32/34/35=0.002（全部 2024-02 月行，手输） |
| `loss_g_adj` | `building:{head}` | alloc_cfg | 默认行/月行 | `groupG` L1382-1385 `G = shareQtyOf(zone) + g_adj`（**仅 p1**） | G、I | 「公摊分摊度数」格旁「G调整」行内 | dev：building:13 A座 = −1500（2024-02 月行，手输） |
| `loss_recon` | `building:{head}` 0=排除 | alloc_cfg | 默认行/月行 | `loss()` L2193-2194 对账 ΣC/ΣD 排除该组 | 对账区（读时派生） | **无**（面板陈列） | dev：building:13 = 0（A座独立链路） |

### 1.3 表级（meter:{id}）

| 键 | scope | 存哪 | 版本语义 | 消费点 | 影响 | UI 入口 | 备注 |
|---|---|---|---|---|---|---|---|
| `loss_exclude` | `meter:{id}` ≠0=剔除 | alloc_cfg | 默认行/月行 | `lossGroups` L1316-1317 `continue`（不入 C 也不入 D，也不入组成员判定） | C/D/E | LossLedgerView 面板 checkbox「本月计入Σ」= 写月行 **0**（`onExclude`），只能对**已有行**翻转；**不能新增剔除** | dev 5 行默认：meter 268/307/57/58/76 |

### 1.4 期别级（p1 / p2 / dorm）

| 键 | scope | 存哪 | 版本语义 | 消费点 | 影响 | UI 入口 | 备注 |
|---|---|---|---|---|---|---|---|
| `park_share_div` | `p1` | alloc_cfg | 默认行/月行 | `shareQtyOf` L1361-1370 `G基 = r2(Σ park_loss_pool 池净量 / div)` | G → I（一期全部栋） | **无** | dev = 6（手输常数「六座平摊」） |
| `price_flat` | `p1` | alloc_cfg | 默认行/月行 | ① `lossPrice` L1387-1390 p1 无 `price_loss` 时回退 → **一期户损耗费单价**；② `ruleCostAmount` L1059（仅 recon 端点） | 一期 share_elec_loss 金额、recon 成本 | **无** | dev = **1.11417**（V47 种子 DECIMAL(12,6) 截断，≠1.11416875；默认行=所有月份不随电价月变） |
| `price_loss` | `p2` | alloc_cfg | 默认行/月行 | `lossPrice` L1388 → `lossContributions` L1396/`lossFee` L313 `r2(u×I×price)`；`recon` L869 | 二期损耗费金额 | **无** | dev = 1.25312（=1.09312+0.16 手输常数，所有月份） |
| `price_sharp/price_peak/price_norm/price_valley` | `p2` | alloc_cfg（**库中不存在**） | — | `ruleCostAmount` L1065-1072（仅 recon） | recon 行成本 | 无 | 遗留 V47 首批键；库无行 → recon 中 p2 分时池成本算成 0 |
| `loss_supply_meter` | `p1`/`p2` value=meter_id | alloc_cfg | 默认行/月行 | `lossGroups` L1313-1314 供电侧总表不入组；`loss()` L2186 对账供给边 | 分组、对账区 | **无**（面板不列） | dev：p1=266（B-G座总电）、p2=1（二期总电） |

### 1.5 价目簿键（tenant_price_cfg，池引擎消费的那部分）

| 键 | scope 级联 | 版本语义 | 消费点 | 影响 | UI |
|---|---|---|---|---|---|
| `elec_sharp/elec_peak/elec_flat/elec_valley` | zone→'' | 月变，仅当月 | `computePool` L1714-1717（p2，各 +mgmt_fee）；`priceGate` L1659-1660 | p2 cost/std | 价目管理页 |
| `mgmt_fee` | zone→'' | 前滚 | L1713 加进四段价 | p2 cost/std | 价目管理页（0.16） |
| `sharp_as_peak_ratio` | zone→'' | 前滚 | L1718 → `p2Unrounded` L284-285 `尖价 = r×尖 + (1−r)×峰` | p2 cost/std | 价目管理页（0） |
| `elec_commercial` + `mgmt_fee_commercial` | zone→'' | 月变 / 前滚 | L1728-1729（p1/dorm 无 override 时 price）；`priceGate` L1661 | p1/dorm cost/std/price_snap | 价目管理页 |
| `area_base / lamp_area_base / green_area_base / elevator_area_base` | zone→'' | 前滚 | 经 `alloc_rule.base_key` L1767 | std 分母 | 价目管理页「月推参数」组 |
| （下游）`lamp_rate`(p2 0.005) / `green_rate` / `loss_base_form*` / `fire_amount_fixed` / `elec_package` … | tenant:{id}/zone | 前滚 | BillNoticeService（不在本引擎） | 催缴单 | `green_rate` 在白名单；**`lamp_rate` 不在 `CFG_KEYS` 白名单**→只能 SQL |

---

## 2. Java 硬编码常数清单（AllocService + 相关类）

「本该属于哪个参数」= 若要参数化，建议归属；不代表必须改。

| 行号 | 字面量 | 上下文 | 本该属于 |
|---|---|---|---|
| L26 | `\d{4}-(0[1-9]|1[0-2])` | ym 格式 | — |
| L28 | `"share_elec_loss"` (FEE_LOSS) | 损耗费出口费键 | 费键字典 |
| L30 / L1227 / L1885 | `"share_elec_elevator"` (FEE_ELEVATOR) → `floorBucketsOf(..., skipFirstFloor)` L354 `floorNum(f)==1` 整桶剔除 | 电梯池首层不摊 | 池级开关 `skip_first_floor`（现绑死在费键上） |
| L80-81 | `Map.of("p1","一期园区","p2","二期园区","dorm","宿舍区")` | 园区级池名前缀 | zone 字典 |
| L88 | `64` | 池名截断 | DDL |
| L91 | `"零一二三四五六七八九"` | 中文层号 | — |
| L248 / L249 | `setScale(2)` / `setScale(4)` | 金额 2 位；**率 4 位**（原册 ROUND(…,4)） | 率位数可参数化（原册二期 J5 变体舍入位置不同，spec §3.4 已决定统一外置） |
| L261 / L271 / L273 / L319 / L372 / L1184 / L1243 / L1370 / L1456 / L1808 / L2199-2200 | `divide(…, 10, HALF_UP)` | 中间除法精度 10 | 无需参数 |
| L294 / L300 / L308 | `divide(…, 12, HALF_UP)` | std 中间精度 12 | 无需参数 |
| L859 / L1132 | `divide(…, 6, HALF_UP)` | effPrice 6 位 | — |
| L285 | `BigDecimal.ONE.subtract(r)` | 尖按峰比率混价 | 已参数化(sharp_as_peak_ratio) |
| L354 | `Integer.valueOf(1)` | 首层判定 | 与 skip_first_floor 同归属 |
| L372 | `bucket.size()` 均分 | 桶内Σ面积=0 按户数均分 | 算法固有 |
| L445 | `NAME_CAP = 8` | 告警点名上限 | UI 常量 |
| L475 | `new BigDecimal("0.01")` | Σweight 与 T 容差 | 告警阈值参数 |
| L577 / L1769 | `2` | round_scale 默认 | 已是列默认 |
| L1771-1772 | `"amount_over_base"` / `"qty_price_over_base"` 按 zone 默认 | std_kind 缺省 | zone 级默认表 |
| L755-756 | `500` | 批插行数 | — |
| L798 | `new BigDecimal("0.005")` | 抽屉 stale 阈值 | — |
| L853 / L1083 / L1657 / L1674 / L2143 | `"share_water"` | 占位费键整体跳过 | 费键字典 |
| L865 | `List.of("p1","p2")` | recon 损耗组只两期 | zone 字典（dorm 无损耗） |
| L1311 | `"elec"` / `"dorm"` | 损耗组只电表、**dorm 整体不进损耗组** | zone 级开关 `loss_enabled` |
| L1300 | `"tenant"/"share"/"park"` | 分表Σ D 的 ownership 白名单 | ownership 字典 |
| L1298 / L1333 / L1557 / L1624 / L1740 | `"shadow"` | 存疑表排除 | meter.suspect 字典 |
| L1330 / L1335 | `"infra"` / `name.contains("铝缆")` | 总表判定；**铝缆靠表名字符串匹配** | 应为 meter 属性（如 ownership='cable' 或 `meter:{id}.loss_cable`） |
| L1360 / L1383 | `"p1"` | G/公摊分摊度数只一期 | zone 级开关 |
| L1377-1378 | `2` / `1` | loss_variant 编码 | 枚举 |
| L1389 | `"price_flat"` 回退 | 一期损耗价=商业单一价 | 应走 priceCfg 月价 |
| L1414-1423 | `"p2"` + `floor/ref` + `weight>0` | 二期纯公摊户损耗受益人 stub | zone 级规则 |
| L1491 | `"park_loss_pool"` (PARK_POOL) | 进 G 的池费键 | 池级开关 `in_park_g` |
| L1659-1661 | `elec_sharp/peak/flat/valley` vs `elec_commercial` | 门禁键 | zone 级价键表 |
| L1713-1718 / L1728-1729 | `"mgmt_fee"` `"sharp_as_peak_ratio"` `"elec_commercial"` `"mgmt_fee_commercial"` | 取价键名 | 价键表 |
| L1851 | `1000` | 原册块排序偏移 | UI |
| L1923 | `Set.of("share","park","ops","infra")` | 池可绑表 ownership | ownership 字典 |
| L1935 | `"(位置未录)"` | 标签占位 | UI |
| L2003 | `"东侧"/"西侧"` | 一格定位剥方位 | 字典 |
| PriceCfgService L32-38 | `CFG_KEYS` 19 键白名单；L44-45 `MONTHLY_KEYS` 6 键 | 价目簿可写键 | 键注册表 |
| MeterService L97-98 | `one(factor)`（null→1） | 倍率缺省 | — |
| AllocRuleReq L12 / L16 | method 值域 `direct|area|floor|loss|none|ref`；feeKey 8 值 | 写入校验 | 与 alloc.ts `AllocMethod` 不一致（缺 carrier/manual） |

**明确不在 Java 里的数**（都在库）：6（park_share_div）、3/4/7/5.8…（coefficient）、+170/−670（extra_qty）、0.16/0.32（mgmt_fee*）、1.13156875/4.45（price_override）、1.11417/1.25312（price_flat/price_loss）、148918.01/80000/15510/12487.04（*_area_base）、0.003~0.018/0.002（loss_adj_rate）、300/−2500/1000/98.3/−1500（loss_adj_qty/g_adj）、0.015/0.005/0.007（=std 计算结果，非参数）。

---

## 3. 公式速写

记号：`u_i = MeterService.usage(prev,curr,factor_snap) = (curr−prev)×factor`（缺任一读数 → null 跳过并 warn）；`s_i = sign(±1)`；`r2/r4/rn` = HALF_UP 到 2/4/scale 位。

### 3.1 池用量 `poolSegQty`（L1537-1597）
```
if manual_qty(月行优先) 存在:  total = manual_qty  (分时四段=0, any=true, 不读绑定表)
else: total = Σ_i u_i×s_i ;  尖/峰/平/谷 各段同式(shadow 表跳过; sign=-1 且无分时 → 总量落平段)
      if 存在 s_i<0 (net) 且 any:  total += poolExtra   ← extra_qty 月行 ?: alloc_rule.extra_qty
+ fold_qty 链:  total/各段 += src.poolSegQty(...)  (拓扑递归, 环→409)
```
### 3.2 应分摊 cost `computePool`（L1710-1761）
```
p2:  段价 P_x = elec_x(ym,zone) + mgmt_fee ; 尖价 = r×尖 + (1−r)×峰, r=sharp_as_peak_ratio
     unrounded = 尖×尖价 + 峰×P_peak + 平×P_flat + 谷×P_valley   (无分时段 → total×P_flat)
     cost = r2(unrounded)                                        ← 池级一次 ROUND
p1/dorm: price = rule:{id}.price_override ?: elec_commercial + mgmt_fee_commercial
     net 或 manual_qty:  cost = r2(total × price)                ← 净量后一次 ROUND
     否则:  cost = Σ_i r2(u_i×s_i×price) + Σ_fold_qty r2(src.total×price)   ← 逐表 ROUND 再 Σ
     unrounded = total × price
method=ref / carrier:  cost = null (不入合计)
method=manual:  MANUAL_POOL 十二格全 null (L1688)
```
### 3.3 分摊标准 std（L1763-1782）
```
base = base_key!=null ? priceCfg.resolve(base_key, ym, zone) : (rule:{id}.coefficient 月行 ?: alloc_rule.coefficient)
scale = round_scale ?: 2 ;  kind = std_kind ?: (p2 ? amount_over_base : qty_price_over_base)
foldAdd = Σ fold_price 源池.std ;  stdAdd = rule:{id}.std_add
direct: std = cost
none:   std = null
其余按 kind:
  amount_over_base:    std = rn(unrounded / base, scale) + foldAdd + stdAdd
  qty_price_over_base: std = rn((total + (net?0:extra)) / base × price, scale) + foldAdd + stdAdd
  qty_over_base:       std = rn(total / base, scale) + foldAdd + stdAdd
```
### 3.4 户级摊出 allocated `memberAmounts`（L1115-1278）
```
受益人 mems = 显式版本组(pickMembers) ; 园区级 area/floor 池无显式 → 该 zone 全园在租名册(autoMembers)
面积口径 areaOf: auto→areaByZoneTenant[zone] ; 楼栋级显式→areaByBuildingTenant[bld] ; 园区级显式→areaByTenant
direct: 一户 amount = cost
area:   户面积 = (层定位池且该户在该栋有租金行绑定) ? rentAreaByBuildingFloor[bld][floor][t] : areaOf[t]
        amount = r2(std × 户面积) ; qtyShare = r2(qty×面积/base)
floor:  perFloor = std ; weight!=null → r2(perFloor×weight)
        weight==null → 楼层分桶(合同单元→户内表两级回退; 未定层单独一桶); FEE_ELEVATOR 池剔首层桶
        每桶 1 份 perFloor: 桶内Σ面积>0 → r2(perFloor/Σ面积×户面积) ; =0 → r2(perFloor/户数)
ref:    weight!=null → r2(std × weight) (无 cost, 不入合计)
allocated_amount = r2(Σ户 amount) ; gap = allocated − cost
```
### 3.5 损耗单元 `lossGroups`/`groupRate`（L1303-1449）
```
组: 每栋自成组, building:{b}.loss_head → 并入头栋 ; 只算 kind=elec 且 zone≠dorm 的挂栋表
   跳过: zone.loss_supply_meter 那块表 ; meter:{id}.loss_exclude≠0 的表
C = Σ infra 表(非 shadow, 名不含"铝缆", 且 (loss_c_meter 未设 或 == 该表)) 的 u
cable = Σ infra 且 名含"铝缆" 的 u   (仅陈列)
D = Σ ownership∈{tenant,share,park} 且非 shadow 的 u
E = D − C           raw_rate = r4(E/C)
G(仅 p1) = r2( Σ_{p1 且 fee_key='park_loss_pool' 的池} poolSegQty.total  ÷  p1.park_share_div ) + building:{head}.loss_g_adj
           (池净量含 manual_qty/sign/fold_qty/净额池的 extra_qty ; 二期 G=null)
adjQty = Σ_{组内每个成员栋} building:{b}.loss_adj_qty ;  adjRate = building:{head}.loss_adj_rate
variant: 无分表→none ; loss_variant==2→none ; ==1→share_only ; 其余 net
I(net)        = −r4((E − G − adjQty)/C) + adjRate
I(share_only) =  r4(G/C) + adjRate
I(none)       = null (不出率, 不出户级损耗)
priceLoss = zone.price_loss ?: zone.price_flat      (p1 现状=price_flat 1.11417 ; p2=1.25312)
户损耗费 = r2(户内 tenant 电表 u Σ × I × priceLoss)   受益人=组内本月 u>0 的租户 (+p2 车间池正权成员零度 stub)
对账区(读时): supply = loss_supply_meter 表 u ; ΣC/ΣD 排除 loss_recon=0 的组 ; lossVsC=ΣC−supply, rate=r4(/supply)
```
### 3.6 变体编码速查
| loss_variant | 值 | 语义 |
|---|---|---|
| net（默认/0/未设） | I=−ROUND((E−G−adj)/C,4)+adjRate | 一期 A/D/E/F、二期全部 |
| share_only（1） | I=ROUND(G/C,4)+adjRate | 一期 B/C |
| none（2 或无分表） | 不出率 | 一期 G座 |

---

## 4. 读写路径

### 4.1 后端 API（AllocController，`/api/alloc`）
| 端点 | 用途 | 请求体 / 校验 |
|---|---|---|
| `GET /cfg?ym=` | `cfgList` → `selectEffective(ym)`：**只返回 '' 行 ∪ 当月行**原值（不返回别的月） | ym 正则 |
| `PUT /cfg` | `saveCfg` 单行 upsert；`value=null` → 删该行（回退默认）；`acctMonth` 空/null → 默认行 | `AllocCfgReq{scope @NotBlank, cfgKey @NotBlank, acctMonth @Pattern("(YYYY-MM)?"), value BigDecimal, note}`。**无 scope/key 白名单、无 id 存在性校验、无值域校验**；update 分支用 `req.note` 覆盖 note（前端不传 → 清空） |
| `DELETE /cfg` | **不存在**（删除=PUT value=null） | — |
| `GET/POST/PUT/DELETE /rules` | 规则整体保存（列参数 + meters(sign) + links + members(memberMonth)） | `AllocRuleReq`：method/feeKey/zone @Pattern；`validateRule` L547-557（area/floor 无 baseKey 时 coefficient>0；direct 恰一户）；有结果的规则删除 409 |
| `POST /generate?ym=` | 池+损耗+户级快照先删后插；`priceGate` 缺月价 400 | — |
| `GET /pools` `GET /loss` `GET /recon` `GET /result*` | 读 | — |

### 4.2 前端调用点
| 页面/组件 | 写什么 | 只写月行? |
|---|---|---|
| PoolLedgerView 编辑态「系数(月)」「加度(月)」两列 `commitRuleCfg` L256-268 | `rule:{id}.coefficient` / `.extra_qty` | **是**（acctMonth=当前 ym） |
| PoolLedgerView 抽屉 `submitPool` L550-587 | alloc_rule 列（coefficient/extraQty/baseKey/stdKind/roundScale/feeKey/note/method/定位）+ meters(sign) + links + members(weight, memberMonth) | 列=永久；members 按 monthOnly |
| LossLedgerView 编辑态行内 `commitAdj` L231-236 | `building:{head}.loss_adj_qty / loss_adj_rate / loss_g_adj` | **是** |
| LossLedgerView「本月口径」面板 `commitCalib` L196-216 | `meter:{id}.loss_exclude`(0/删) / `building:{id}.loss_variant` / `rule:{id}.extra_qty` | **是**；且只对已有 cfg 行出现控件 |
| CoefBookWindow（催缴单页 S14 系数簿） | `alloc_rule_member.weight`（updateRule）+ 价目簿 mgmt_fee 等 | 版本组 |
| PriceCfgView | tenant_price_cfg 白名单 19 键（含 4 个 *_area_base） | 版本链 |

### 4.3 目前只能裸 SQL / 迁移脚本改的参数
- **默认行（''）一律不可经 UI 建/改/删**：`rule:*.coefficient/extra_qty` 默认在 alloc_rule 列（可改），但 alloc_cfg 里的默认行（`p1.park_share_div`、`p1.price_flat`、`p2.price_loss`、`p1/p2.loss_supply_meter`、`building:*.loss_head/loss_c_meter/loss_recon/loss_variant` 默认、`meter:*.loss_exclude` 默认、`rule:100.price_override`、`rule:*.frozen_2023`）全部 UI 无写入口。
- 任何月份的 `manual_qty` / `price_override` / `std_add`：**零 UI**。
- 新增一块表的 `loss_exclude`、新增一栋的 `loss_head/loss_c_meter/loss_recon`：零 UI。
- 非当前 ym 的月行：GET 不返回、UI 看不见也改不了（要看 2024-02 得把页面切到 2024-02）。
- `tenant_price_cfg` 的 `lamp_rate`（p2 0.005）不在白名单 → SQL。
- alloc_rule 的 method=`carrier`/`manual`：AllocRuleReq 正则拒绝 → SQL。

---

## 5. 已知坑（代码注释 + spec 摘录）

1. **默认行污染**（LossLedgerView L100-115、memory「alloc_cfg 默认行按 2024-02 校准却污染所有月份」）：三处已实测——①招商中心池 `alloc_rule.extra_qty=−670`（列默认，所有月）→ 2023-08 G 差 670；②`meter:307` 力美 C201 `loss_exclude` 默认行 → C座分表少 293；③`building:25` G座 `loss_variant=2` 默认 → 分表 0/−100% 污染对账。同类隐患：`p1.price_flat=1.11417`、`p2.price_loss=1.25312`、`rule:100.price_override=4.45`、`building:20/21.loss_variant=1`、`building:13.loss_c_meter/loss_recon`、5 条 `loss_exclude`、`loss_head` 全是默认行。
2. **月行不前滚**：`selectEffective` 只取 `''∪ym`。2024-02 那 36 条 coefficient、6 条 extra_qty、10 条 loss_adj_rate、4 条 loss_adj_qty、`rule:90.price_override=1.13156875`、`rule:91.manual_qty=84` 到 2024-03 全部失效回落默认（宿舍路灯回落商业综合价 1.11416875，宿舍绿化水变「缺读数」）。与 tenant_price_cfg 常数键前滚、alloc_rule_member 版本组前滚三套语义并存。
3. **改参数不生效直到重新生成**：pools/loss 屏读的是 `alloc_pool_result/alloc_loss_result` 快照；`BillNoticeService` 走 `poolContributions` 也读池快照（L1101-1112）。前端用 `cfgDirty` 提示条 + 「去公共电核算重新生成」；抽屉保存在 `generated=true` 时自动重生成，行内改参数不自动。
4. **价目缓存**：`PriceCfgService.index` volatile 快照，写路径 `evict()`（含事务后再 evict）；alloc_cfg 无缓存但也无事务后处理。memory 记「价目缓存坑」（S13）。
5. **updated_at 不能当证据**（memory pool_location）：MyBatis-Plus strictUpdateFill 冻结。
6. `saveCfg` update 分支覆盖 note（allocLogic L38-41 注释）：行内写值会把该行 note 清空。
7. **`系数(月)` 对 base_key 池是死旋钮**（validateRule L548 注释已点名 computePool 不读 coefficient）。
8. **extra_qty 只在净额池入用量、只在 qty_price_over_base 入 std**：p2 池填了加度不起作用（只落 snap）。
9. **G 的构成看不见**（LossLedgerView L94-98 `G_TITLE`）：G = Σ park_loss_pool 池净量 ÷ park_share_div，池净量含默认行加度；屏上只显一个数。
10. **recon 端点用的是遗留价键**（`p1.price_flat`、`p2.price_norm/…` L1057-1073）：库无 p2 分时键 → p2 池成本算 0；前端未消费该端点，仅 IT 用。
11. **一期损耗价 = alloc_cfg `p1.price_flat` 1.11417（默认行，不随月）**，与池 cost 用的月价 `elec_commercial+mgmt_fee_commercial`（1.11416875，2023-08=1.14626875）**两套口径**。
12. **AllocCfgReq 无白名单**：任意 scope/key/值可写入 alloc_cfg，写错键静默无效。
13. `groupAdjQty` 按**成员栋 Σ**，`loss_adj_rate/loss_g_adj/loss_variant/loss_c_meter` 按**头栋**——同一组四个键三种 scope 归属；UI `commitAdj` 一律写 head 栋。
14. spec 异常清单（POOL-FORMULA-AUDIT）：V77/V113 量纲混用（度数÷面积）、V89 ROUND 2 位不一致、面积基数与名单不符（734.02/2293.34/579.13/12487.04）、加度备注与公式错位、AA20/21 等硬编码历史面积、宿舍 1.13156875 外链化石价、二期 J5 变体 I 在 ROUND 内（引擎统一外置）、绿化水双轨 0.008/0.01。
15. 告警可操作性铁律（POOL-ENGINE-SPEC §9）：generate 每条告警必须能在界面修掉；现存「Σ层份≠T」8 条负差是刻意欠配，未降级。

---

## 附录 A：dev 库 alloc_cfg 现状快照（2026-08-16 只读）

| scope 类 | cfg_key | 行型 | 行数 | 值域 | 月份 |
|---|---|---|---|---|---|
| building | loss_adj_qty | 月 | 4 | −2500 ~ 1000 | 2024-02 |
| building | loss_adj_rate | 月 | 10 | 0.002 ~ 0.018 | 2024-02 |
| building | loss_c_meter | 默认 | 1 | 179 | |
| building | loss_g_adj | 月 | 1 | −1500 | 2024-02 |
| building | loss_head | 默认 | 2 | 32 | |
| building | loss_recon | 默认 | 1 | 0 | |
| building | loss_variant | 默认 | 3 | 1/1/2 | |
| meter | loss_exclude | 默认 | 5 | 1 | |
| p1 | loss_supply_meter | 默认 | 1 | 266 | |
| p1 | park_share_div | 默认 | 1 | 6 | |
| p1 | price_flat | 默认 | 1 | 1.11417 | |
| p2 | loss_supply_meter | 默认 | 1 | 1 | |
| p2 | price_loss | 默认 | 1 | 1.25312 | |
| rule | coefficient | 月 | 36 | 3 ~ 2293.34 | 2024-02 |
| rule | extra_qty | 月 | 6 | −670 ~ 200 | 2024-02 |
| rule | frozen_2023 | 默认 | 4 | 0.005 ~ 205.39 | |
| rule | manual_qty | 月 | 1 | 84 | 2024-02 |
| rule | price_override | 默认 | 1 | 4.45 (rule:100) | |
| rule | price_override | 月 | 2 | 1.13156875 (rule:90) / 4.45 (rule:91) | 2024-02 |
| rule | std_add | 月 | 1 | 100 (rule:12) | 2024-02 |

alloc_rule 列现状：p1 area 无 base_key 9 条(coefficient 有值)、area 有 base_key 3 条(elevator/green/lamp)、direct 44（仅 rule 23 extra_qty=−670）、floor 15、manual 4；p2 area(area_base) 4、floor 12、ref 3（rule 12 coefficient=18；15/21 qty_over_base）、carrier 1(rule 17)、none 1(rule 19)；dorm area(lamp_area_base) 2。round_scale=3：rule 100/4/13/15/18/21。

tenant_price_cfg 非租户级：`p2.area_base=148918.01`、`p1.lamp_area_base=80000`、`dorm.lamp_area_base=15510`、`p1.green_area_base=80000`、`p1.elevator_area_base=12487.04`、`mgmt_fee=0.16`、`mgmt_fee_commercial=0.32`、`sharp_as_peak_ratio=0`、`p2.green_rate=0.01`、`p2.lamp_rate=0.005`(非白名单)、`dorm.loss_rate=0.012`；电价 6 键各有 2023-08/2023-10/2024-02 三版。

## 附录 B：数据流一句话
`meter_reading` → `poolSegQty`(sign/manual_qty/extra/fold_qty) → `computePool`(price 来自 priceCfg 或 price_override；base 来自 base_key→priceCfg 或 coefficient) → `alloc_pool_result` 快照 → `memberAmounts`(受益人版本组/面积口径/楼层桶/weight) → `alloc_result`；同一 ctx 下 `lossGroups`(loss_head/c_meter/exclude/supply_meter) → G(`park_loss_pool` 池 ÷ park_share_div + g_adj) → I(variant/adj_qty/adj_rate) → `alloc_loss_result` + 户级 share_elec_loss(price_loss/price_flat)。
