# 合同卡重设计规范（CONTRACT-CARD-SPEC）

2026-07-24 起草。本规范定义**合同卡（合同管理页详情/录入/列表）的整体重设计**，落地用户第 5 次返工裁定（`demo3_bill_forward_logic.md` 末段「合同卡根本返工裁定」+「合同卡重设计方案确认」两条拍板原文）。

> **范围界定（本轮）**：**只做页面重设计——类型钉死费用组 + 计费与旧字段合一 + 列表日期/状态派生 + 续签链**。**不含导入**（新汇总 Excel `园区租户租金合同明细汇总(2024年3月).xlsx` 的批量导入放下一轮，页面验收后再做）。BILL-FORWARD-SPEC 第 1 刀「扁平计费行」的**数据底座（`contract_billing_term` 多行 + 13 费项枚举 + `bill_mode` + `syncScalarCache` 缓存）继续复用**，本规范在其上加**段类型（property_type）钉死约束层**，并否决其「自由增删费项行/自由位置段」的呈现方式。

---

## 0. 为什么重做（裁定溯源）

前 5 次返工反复在「五固定字段 ↔ 自由计费行」之间摇摆，都没击中用户真实模型。第 5 次裁定给出终局四条：

1. **计费与合同旧字段必须合一**——不是另起一套割裂的计费行体系，要与既有合同字段（编号/租户/楼栋房号/期限/押金/免租/状态）融为一体。
2. **按租赁类型钉死费用组，禁止自由增删费用名 / 自由加位置段**——选类型→该组费用自动钉死出现，用户只填单价/面积/间数。
3. **列表页加日期/到期状态**——能看谁过期谁没过期，按「某时间段内还在执行中」筛选；续签表现形式作者自定。
4. **数据源换**——新汇总 Excel（含收费条目 + 合同时间范围），**页面实现验收后再导入**。

2026-07-24 用户拍板补两决策：①最终类型→钉死费用组见 §1；②**电梯/变压器 = 条件项**（该标的有就勾选填月额，首层无梯不勾不出现），非钉死必填。

---

## 1. 类型 → 钉死费用组（2026-07-24 用户拍板，唯一事实源）

**标的段选一个物业类型 → 该类型的费用项自动钉死出现**。用户只填单价/面积/间数，**无「添加/删除费用名」入口**（禁自由 `fee_key`）。

| 物业类型 `property_type` | 钉死费用项（必现，不可删） | 条件项（勾选才出现，填月额） | 可选（全类型） |
|---|---|---|---|
| **厂房** `factory` | 厂房租金 · 厂房企业管理服务费 · 厂房基础设施维护费 | 电梯维护费 · 变压器维护费 | 土地使用税 |
| **办公室** `office` | 办公室租金 · 办公室企业管理服务费 **（不含基础设施维护费）** | 电梯维护费 · 变压器维护费 | 土地使用税 |
| **宿舍** `dorm` | 宿舍租金 · 宿舍基础设施维护费 · 门禁设施维护费 · 网络通讯费 | （无） | 土地使用税 |
| **商铺** `shop` | 商铺租金 · 商铺基础设施维护费 · 商铺企业管理服务费 | 变压器维护费 | 土地使用税 |
| **空地** `land`（附加段） | 空地租金 | （无） | 土地使用税 |

**费项与既有 13 枚举 `fee_key` 的映射（枚举不变，`property_type` 决定显示名 + 哪些行钉死）**：

| 显示费项 | `fee_key` | `bill_mode` | 月额公式 | 备注 |
|---|---|---|---|---|
| ×× 租金 | `rent_factory`/`rent_office`/`rent_dorm`/`rent_shop`/`rent_land` | `per_sqm_month` | 面积×单价×系数 | 系数默认 1（翔海/旭化成 1.56） |
| ×× 企业管理服务费 | `mgmt` | `per_sqm_month` | 面积×单价×系数 | 显示名随段类型加前缀 |
| ×× 基础设施维护费 | `infra` | `per_sqm_month` | 面积×单价×系数 | office 无此行 |
| 电梯维护费 | `elevator` | `per_month` | 规则 N×150×L 或 `amount_override` | **条件项**；N/L 规则参数存本行 |
| 变压器维护费 | `transformer` | `per_month` | KVA<150(含空)=159；≥150→1×KVA | **条件项**；消费 `contract.kva` |
| 门禁设施维护费 | `access` | `per_room_year` | 单价×房数÷12 | 单价默认 100，宿舍填间数 |
| 网络通讯费 | `network` | `per_room_month` | 单价×房数 | 单价默认 50，宿舍填间数 |
| 土地使用税 | `land_tax` | `per_month` | `amount_override` | 全类型可选 |

**显示名 = `property_type` × `fee_key` 上下文映射**（`fee_key` 保持通用，标签由段类型加前缀；前后端共享常量 §7）：

```
factory: rent_factory=厂房租金  mgmt=厂房企业管理服务费  infra=厂房基础设施维护费  elevator=电梯维护费  transformer=变压器维护费
office : rent_office =办公室租金 mgmt=办公室企业管理服务费  elevator=电梯维护费  transformer=变压器维护费
dorm   : rent_dorm  =宿舍租金   infra=宿舍基础设施维护费  access=门禁设施维护费  network=网络通讯费
shop   : rent_shop  =商铺租金   infra=商铺基础设施维护费  mgmt=商铺企业管理服务费  transformer=变压器维护费
land   : rent_land  =空地租金
any    : land_tax   =土地使用税
```

**钉死行预置默认**（新增段选类型即插入，行序固定）：`per_sqm_month` 类 area/unitPrice 待填、coeff=1；`access` 预置 unitPrice=100、`network` 预置 unitPrice=50（宿舍只填间数）。

---

## 2. 铁律（数据完整性 + 交互约束）

- **合同 = 多标的段（property segment）**。每段 = 一个 `property_type` + 一个位置文本 `location`。段内费用项由 §1 该类型钉死组决定。
- **选类型 → 钉死行自动出现**，用户只改单价/面积/系数/间数；**无自由加删费用名入口**（`fee_key` 白名单锁死在该类型允许集内，后端拒绝越界枚举）。
- **多标的段 = 同类型可重复**（翔海多厂房段各自面积单价），亦可跨类型（银纳厂房段 + 宿舍段）。**空地段是附加段**，可 0..N 个，与建筑段并列。
- **条件项电梯/变压器**：段级勾选才落一条 `elevator`/`transformer` 行；不勾则该行不存在（首层无梯 = 不勾 = 不出现），非钉死必填。
- **锚点样本（结构约束验收）**：
  - **金纳** = 单厂房段（厂房租金/企管费/基础设施维护 + 条件电梯 318 + 变压器 159）= 5 项。
  - **银纳** = 厂房段（厂房租金 5788.37 + 企管费 + 基础设施维护 + 变压器）+ 宿舍段（宿舍租金 9278.27 + 基础设施维护 + 门禁 108.33 + 网络 650）。
  - **翔海** = 多厂房段（E 座 3-4 层 / G 座各层，各面积单价，系数 1.56）+ 空地段（空地一 / 空地二）。

---

## 3. 计费与旧字段合一（废重复渲染 + 双录入）

现状割裂点（第 5 次裁定要消灭的）：
- 顶部 `3×FPStat`（月租金/租赁面积/押金）与底部「合同明细」字段区 + 计费明细段**三处重复渲染同一批数字**；
- 录入弹窗顶部有独立「月租金」输入，底部计费行又各自算月额——**双录入**，两者不一致时无人知道谁对。

**合一规则**：

1. **`contract_billing_term`（计费行子表）= 唯一真值**。所有费用金额只从计费行来，卡片不再有第二处可录金额的地方。
2. **宽表五标量**（`contract.unit_price / mgmt_fee_price / infra_fee_price / elevator_fee / transformer_fee`）+ `monthly_rent` + `rent_area` + `building_area` **全部降级为 `syncScalarCache` 单向派生缓存**——落库计费行后由后端反算写入，**供分析层/列表/KPI 读，前端录入不再围它转、不重复渲染、不双录入**。
   - `monthly_rent` 缓存 = **各计费行月额之和**（`syncScalarCache` 扩展；口径见 §6 说明，真正的应收账单在账单管理派生，含免租/抄表）。
   - `rent_area` 缓存 = 建筑类租金行面积之和（沿 2026-07-24 面积裁定，空地不计）；`building_area` = `rent_area × 0.8`。
3. **电梯/变压器「规则参数 + 月额」统一进计费行条件项**——不再劈「宽表 `elevator_count/elevator_floors` + 子表金额行」两地。规则参数（货梯 N × 计费层 L）存该 `elevator` 行的 `params` JSON；月额 = `amount_override`（或按 N×150×L 规则派生）。变压器规则消费合同级 `contract.kva`，月额落 `amount_override`。宽表 `elevator_count/elevator_floors` **退役为 `syncScalarCache` 镜像缓存**（不删列、不再由前端写，供分析层兼容读，`ponytail:` 留列免迁移）。
4. **`power_type` / `kva` 仍在合同级**（厂房大工业签约要素，非计费行；变压器行的 `per_kva_month` 规则引用它）。

---

## 4. 数据模型（迁移 `V54__contract_card_redesign.sql`）

**先备份 `contract` + `contract_billing_term`。**

```sql
-- 1) 标的段类型标记(段内所有行同值,由段的 property_type 冗余落每行,便于分组/校验/索引)
ALTER TABLE contract_billing_term ADD COLUMN property_type VARCHAR(16) NULL;  -- factory|office|dorm|shop|land

-- 2) 续签链:新合同指向被续签的旧合同
ALTER TABLE contract ADD COLUMN parent_contract_id INT NULL;
ALTER TABLE contract ADD CONSTRAINT fk_contract_parent
    FOREIGN KEY (parent_contract_id) REFERENCES contract(id) ON DELETE SET NULL;

-- 3) 状态值域放开 'renewed'(已续签,区别 terminated 主动终止);status 为 VARCHAR 无 CHECK,仅后端枚举校验放开。
--    派生状态改由 endDate 计算,存量派生桶 'expiring'/'expired' 归一回存储态 'active'(派生桶接管,见 §5)
UPDATE contract SET status='active' WHERE status IN ('expiring','expired');

-- 4) 回填 property_type:同 (contract_id, location) 组内以租金行 fee_key 反推段类型,
--    非租金行(mgmt/infra/elevator/... )继承同组租金行类型;整组无租金行 → factory 兜底。
-- (实现按组 UPDATE ... JOIN;此处仅记口径)
```

**`contract_billing_term` 语义（V54 增量）**：`property_type` = 段类型（factory/office/dorm/shop/land），段内每行冗余同值；`fee_key` 受该 `property_type` 的钉死集约束（后端白名单）；`elevator`/`transformer` 行 `params` JSON 存规则参数（电梯 `{n,l}`）。其余字段沿 BILL-FORWARD §1.1。

**`contract` 语义（V54 增量）**：
- `parent_contract_id` FK → 续签链上一期（renew 时由后端写，指向被续签的旧合同）。
- `status` 存储态收敛为 `{draft, active, terminated, renewed}`——`expiring`/`expired` 不再入库，改由 `endDate` 派生（§5）。
- `power_type`/`kva` 保持合同级；`elevator_count`/`elevator_floors`/五标量/`monthly_rent`/`rent_area`/`building_area` 均为 `syncScalarCache` 派生缓存。

**存储态 vs 派生态**（关键约定）：**入库只存 4 个存储态**；列表/详情/KPI 展示的 6 桶（draft/active/expiring/expired/terminated/renewed）由后端 `toDTO` 从「存储态 + endDate + 今天」派生（§5）。

---

## 5. 列表页：日期、状态派生、时段筛选、续签链

### 5.1 状态按 endDate 自动派生（后端 `toDTO` / `summary` 统一算）

```
派生桶(status_display):
  存储 draft      → 'draft'      (草稿, 灰)         人工态,不看日期
  存储 terminated → 'terminated' (已终止, 灰)       人工态,主动解约
  存储 renewed    → 'renewed'    (已续签, 蓝灰)     人工态,被续签取代(区别 terminated)
  存储 active     → 看 endDate & 今天(Asia/Shanghai):
      endDate == null           → 'active'   (在租, 绿)   无到期日视为在租
      今天 > endDate            → 'expired'  (已到期, 红)
      0 ≤ endDate−今天 ≤ 90 天  → 'expiring' (即将到期, 黄)
      else                      → 'active'   (在租, 绿)
```

`FPContractStatus` 组件加 `renewed` 态（label「已续签」，蓝灰）。`summary()` 的 active/expiring 计数改用派生桶。

### 5.2「某日期在租」时段筛选

列表工具栏加一个日期选择器；选定日期 D → 列出 **`status ≠ draft` 且 `startDate ≤ D ≤ endDate`** 的合同（即该日在执行中的租约，含当日仍在期内的 renewed/terminated 历史期）。

`ponytail:` 列表接口已一次性返回全量合同（前端分页），**时段筛选在前端本地过滤**，不新增服务端 query 参数——契约以 `activeOn: string | null` 前端筛选态记录（§7）。

### 5.3 续签链

- **renew 行为改**：旧合同 `status = 'renewed'`（非 `terminated`）；新合同 `parent_contract_id = 旧合同 id`。
- **列表默认每链只显最新一期**：链 = 沿 `parentContractId` 上溯的合同序列；最新期 = 不被任何其他合同当作 `parentContractId` 的那一期。前端构建 `parent→child` 映射，只渲染叶子（最新期），**可展开看历史各期**（展开行内联渲染祖先期，只读）。
- `ponytail:` 链聚合在前端做（列表已全量），不新增 `/chain` 端点；DTO 带 `parentContractId` 足够前端还原链。

---

## 6. 前端呈现与录入（单一编辑模式）

### 6.1 合同卡（详情，只读）

结构自上而下，**去掉重复的 `3×FPStat` 与底部重复字段**：

1. **合同信息块**（一次性，不重复）：编号 · 租户（头像+联系人）· 楼栋/房号 · 租赁期限（起→止 + 时间轴）· 押金 · 免租期 · 状态徽标。
2. **标的段列表**：每段一张分组卡：
   - 段头：**类型徽标**（厂房/办公室/宿舍/商铺/空地）+ 位置文本 + 段面积。
   - 段体：该类型**钉死费用行**（费项名 + 面积 + 单价 + 系数 + 房数 + 月单价只读派生）；条件项电梯/变压器仅在勾选存在时出现。
3. **不显示月应收合计**（合计属账单管理，账单页派生含免租/抄表）。押金/免租只在合同信息块出现一次。

### 6.2 录入 / 编辑（`ContractNewDialog`，单一编辑模式）

- **合同信息区**：编号/状态/租户/楼栋/单元/建筑面积/押金/日期/免租/用电分类/KVA/备注。**移除独立「月租金」输入**（月租金由计费行汇总缓存，不双录入）。租赁面积只读（计费行汇总）。
- **标的段编辑区**：
  - 「**添加标的段**」→ 弹出/内联选 `property_type`（厂房/办公室/宿舍/商铺/空地）→ 该类型**钉死行自动出现**（不可删费用名，可改数值）。
  - 条件项**电梯/变压器**：段内 checkbox，勾选出现该行（电梯填货梯 N×计费层 L → 月额；变压器填月额或走 KVA 规则），不勾无行。
  - **土地使用税** checkbox（全类型可选）。
  - 宿舍段：门禁/网络行**只填间数**（单价预置 100/50 可改）。
  - 每行月单价只读实时派生；**无月应收合计**。
- **单一编辑模式**（沿 EDIT-MODE-SPEC）：基本信息 + 面积 + 免租 + 标的段增删 + 行内数值 + 用电分类/KVA 一个编辑态同入同出；**无独立「编辑计费行/编辑条款」按钮**。段可增删，段内钉死行不可删（只能删整段），条件项/可选项靠 checkbox 增删。

---

## 7. DTO / API 契约（写死供下游并行）

### 7.1 枚举 / 常量（前后端共享）

```
PropertyType = factory | office | dorm | shop | land
FeeKey       = rent_factory | rent_office | rent_dorm | rent_shop | rent_land
             | mgmt | infra | elevator | transformer | access | network | land_tax | other   (13, 不变)
BillMode     = per_sqm_month | per_month | per_room_year | per_room_month | per_kva_month   (不变)
StatusStored = draft | active | terminated | renewed         (入库仅此 4)
StatusDisplay= draft | active | expiring | expired | terminated | renewed   (派生, DTO 出)

// 类型 → 钉死/条件/可选费项集(后端白名单校验 + 前端预置)
PINNED[factory] = [rent_factory, mgmt, infra]      COND[factory] = [elevator, transformer]
PINNED[office]  = [rent_office, mgmt]              COND[office]  = [elevator, transformer]
PINNED[dorm]    = [rent_dorm, infra, access, network]  COND[dorm] = []
PINNED[shop]    = [rent_shop, infra, mgmt]         COND[shop]    = [transformer]
PINNED[land]    = [rent_land]                       COND[land]   = []
OPTIONAL[*]     = [land_tax]                        // 全类型可选
// 越界校验: 段内 fee_key ∈ PINNED[pt] ∪ COND[pt] ∪ OPTIONAL[*]; 否则后端 400

// 显示名: LABEL[propertyType][feeKey] (§1 上下文映射表)
```

### 7.2 读 DTO：`BillingLineDTO` + `propertyType`

```
BillingLineDTO(
  Integer id, Integer contractId,
  String propertyType,        // NEW: factory|office|dorm|shop|land (段类型)
  String location,
  String feeKey, String feeName,   // feeName = LABEL[propertyType][feeKey] 上下文回显
  BigDecimal area, BigDecimal unitPrice, BigDecimal coeff,
  Integer roomCount, String billMode,
  BigDecimal amountOverride, Integer seq, String source
)
```

`ContractDetailDTO.billingLines` 按 `(propertyType, location, seq)` 排序，供前端**段分组**（分组键 = `location` + `propertyType`）。

`ContractDTO` 增：`Integer parentContractId`（续签链，read-only）；`status` 字段值改为 **StatusDisplay 派生桶**（§5.1）。

### 7.3 写 Req：`BillingLineReq` + `propertyType`

```
BillingLineReq(
  Integer id,                 // null=新增
  String propertyType,        // NEW: @NotNull ∈ PropertyType
  String location,
  String feeKey,              // @NotNull, 且 ∈ PINNED∪COND∪OPTIONAL[propertyType] (后端白名单)
  BigDecimal area, BigDecimal unitPrice, BigDecimal coeff,   // coeff null→1
  Integer roomCount,
  String billMode,            // null→按 feeKey 默认
  BigDecimal amountOverride,
  Integer seq
)
```

内嵌 `ContractCreateReq.billingLines`，单一编辑随合同整体 PUT，**整组替换**（null=不动，空列表=清空）。落库后 `syncScalarCache` 反算五标量 + `monthly_rent` + `rent_area` + `building_area` + 电梯 N/L 缓存。

### 7.4 API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/contracts` | 全量列表；`ContractDTO.status` = 派生桶，含 `parentContractId`。时段筛选/链聚合前端本地做（`ponytail:` 无新参数） |
| GET | `/api/contracts/{id}` | `ContractDetailDTO` 含 `billingLines`（带 `propertyType`，按 `propertyType,location,seq` 排序） |
| PUT | `/api/contracts/{id}` | `ContractCreateReq` 含 `billingLines`（带 `propertyType`）；整组替换，`fee_key` 越界该段钉死集 → 400；落库后反算缓存 |
| POST | `/api/contracts/{id}/renew` | renew：旧合同 `status='renewed'`、新合同 `parentContractId=旧 id`（`ContractRenewReq` 不变） |

**前端筛选态（非服务端参数，契约记此）**：`activeOn: string | null`（某日在租）；链聚合按 `parentContractId` 前端还原、默认显叶子可展开。

`ponytail:` 计费行无独立 CRUD 端点（随合同 PUT 进出）；`property_type` 冗余落每行免建段表——段 = 同 `(location, propertyType)` 的行集合。

---

## 8. 锚点验收（页面，无导入）

手工在页面录入以下三户，验证钉死组 + 合一 + 列表派生：

| # | 锚点 | 期望 |
|---|---|---|
| ① | 金纳 · 单厂房段 | 选厂房→钉死 3 行(厂房租金/企管费/基础设施维护)自动现；勾电梯填 318、变压器 159；租金 3200×9.6785 |
| ② | 银纳 · 厂房段 + 宿舍段 | 两段两类型；厂房 5788.37、宿舍租金 9278.27、门禁 100×13÷12=108.33、网络 50×13=650 |
| ③ | 翔海 · 多厂房段 + 空地段 | 多个厂房段各面积单价 coeff=1.56；空地段独立(空地租金,无企管/维护) |
| ④ | 合一 | 卡片顶部无 `3×FPStat` 重复；录入无独立月租金输入；月租金/租赁面积/建筑面积均由计费行汇总缓存 |
| ⑤ | 条件项 | 首层无梯的段不勾电梯→无电梯行(读卡不出现)；勾选后现行填月额 |
| ⑥ | 列表状态派生 | 存 active 且今天>endDate→红「已到期」；≤90 天→黄「即将到期」；否则绿「在租」；draft/terminated/renewed 人工态照显 |
| ⑦ | 时段筛选 | 选某日期→只列 `startDate≤日≤endDate` 且非草稿的执行中户 |
| ⑧ | 续签链 | renew 后旧合同显「已续签」、新合同 `parentContractId` 指旧；列表默认只显最新期，展开见历史期 |

双端测试全绿（后端 IT：billingLines 带 propertyType 往返 + 白名单越界 400 + 派生状态 + renew 链 + 缓存反算；前端 vitest：段分组/钉死预置/条件项/链聚合/时段筛选）。

---

## 9. 非目标（本轮不做）

- **新汇总 Excel 批量导入**（下一轮；提取器需按 `property_type` 拆段 + 钉死组归一 + 时间范围解析）。
- **月度催缴单派生**（BILL-FORWARD 第 2 刀，本规范只到「计费行是唯一真值」，不派生账单）。
- **`monthly_rent` 精确应收**（本轮缓存 = 计费行月额之和，粗口径；含免租/抄表的精确应收在账单管理刀 2/3）。
</content>
</invoke>
