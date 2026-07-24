# 催缴单正向派生规范（BILL-FORWARD-SPEC）

2026-07-23 起草，同日按用户二次返工裁定修订第1刀；**同日再按用户三次返工裁定（扁平计费行）整章重写第1刀**。本规范定义「合同定价 → 月度正向派生催缴单 → 账单条 → 勾稽」的整体路线（总纲）与第1刀（合同计费字段）的详细设计；第2~5刀仅留提纲，动工前再各自补详章。

## 0. 总纲

### 0.1 从逆向记账到正向派生

现状是**逆向**的：应收事实由 Excel（附表10/台账）导入，系统只记录和核对，不知道"这笔钱是怎么算出来的"。用户新逻辑是**正向**的：

```
合同定价（计费行：位置分组 × 费项 × 计费方式 × 参数）
   ↓ 按月派生
月度催缴单（租金表 + 水电表，即现实里发给租户的"通知单"）
   ↓ 汇总
账单条（/bills 屏，工资条式明细，BILLS-SPEC 版式沿用）
   ↓ 勾稽
与台账（实收）/ 附表10（应收事实）三方对账，差异可解释
```

正向派生落地后，附表10 从"应收的唯一事实源"降级为"勾稽对手方"；短期内两者并存，账单条标注数据来源。

### 0.2 五刀分期

| 刀 | 内容 | 状态 |
|---|---|---|
| 1 | 合同计费字段：**扁平计费行（位置分组 + 受控费项枚举）** + 提取导入 + 合同页单一编辑 | 本文详章（2026-07-23 三次返工重写） |
| 2 | 月度租金催缴单派生：**计费行按 location 分组 × 月** × 合同期 × 免租期 → 每户每月租金表草稿 | 提纲 |
| 3 | 水电催缴单：租户水电抄表计费链 → 每户每月水电表 | 提纲 |
| 4 | 账单条整合：派生催缴单接入 /bills 与导出，与附表10来源并列 | 提纲 |
| 5 | 勾稽：派生应收 ⇄ 附表10 ⇄ 台账 三方对账 | 提纲 |

### 0.3 调研基础（逆向盘点结论，2026-07-23）

对象：`2025全年发生额、预算对比\2024年\2024年3月费用数据\2024年3月费用数据` 下 `一期\一期2024年3月租金.xlsx`（97 sheet）与 `二期\二期2024年03月租金.xlsx`（59 sheet）。剔除非租户 sheet 后实为 **152 个租户 sheet（一期95/二期57）**。中间产物 `scratchpad\audit.py` 与 `audit_result.json`（含每户每费项行字段+单元格坐标）可直接复用为解析器蓝本。

**版式聚类**：每 sheet = 上部"应收费用汇总+收款核销块"（B2起）+ 下部 1~11 张通知单。

- **A 通知单版式 146 sheet 可自动提取**（209 个通知单块、920 条费项行），块级表头签名细分 7 型：
  - A1 主流9列（物业名称|收费项目|空地面积|建筑面积|面积单价|月单价|应收金额|备注）：175块；
  - A2 无空地面积7字段：15块；A3 分摊面积双单价：5块；A4 系数变体（单价×系数）：6块（含旭化成表头两列标题互换，需按数据探测纠正）；A5 房号列：1块（金纳）；A6 含税/不含税+税率：1块（李李）；A7 缺单价简版/列位偏移：6块。
- **B 历史流水账式**（按月堆叠，无单价字段）：中山大学、优凯、工程队宿舍。
- **C 仅上部汇总无通知单**：保安宿舍、公交车站、二期A。
- **D 混合**：南宗（2023年4月旧通知单+流水账，含 #REF!）。

**字段出现率**（分母=146 通知单 sheet）：物业名称/应收金额 100%；面积单价/月单价 97%；建筑面积 93%；备注 26%；租期/免租文本 6%（散写在表右浮动列）；系数 2%；税率 1%。变压器维护费（114行）、电梯维护费（107行）为**固定月额无面积单价**——版式设计而非缺失。门禁/网络费行单价常为文本（"100元/年/间"）会滑列。

**变体调研（2026-07-23，三次返工前置）**：146 户通知单中**单位置 92 / 多位置 54**；**厂房+宿舍共用单 21 户**（银纳/思汗/可莱恩/仁恒/碳紫等）；**含空地 9 户**；真系数 1.56 仅**翔海+旭化成**；**按间计费（门禁元每间每年 / 网络元每间每月）23 户**，房数 3 种写法；**48 户叠单**（单 sheet 堆叠 2~5 张独立通知单）；费项名全集 24 种可归一约 **13 枚举**（见 §1.1）。

**⚠ 现状真 bug（三次返工根因）**：V51 五固定字段遇多价并存时把租金甩进 contract_billing_term 留档表且 `contract.unit_price=NULL`，前端零读路径 → **16 份合同（11 份真多段）租金在 UI 消失**（一元兰欣/高建军/欧培敬/罗立剑等）；银纳两合同全空从未 pick；翔海无合同。扁平计费行重写即为根治此 bug。

**⚠ 证伪（沿旧结论）**：用户口述的"租赁期限表、KVA容量、综合服务费加价0.16、基本用电费23元/KVA"条款文本在这两册中**不存在**（sharedStrings 全文检索 0 命中），来自合同原件或其他文件，**第1刀不指望从本两册提取，模型上预留字段由人工补录**。

**人工处理清单**：
- (a) 无法自动提取（6户）：一期/中山大学、优凯、工程队宿舍（流水账）、保安宿舍、公交车站、二期/A（无通知单）——条款全靠手录。
- (b) 可提取但需人工复核：南宗（旧账+#REF!）、翔海（金额全0且无合同→报"须先建合同"）、旭化成（表头错位）、暖通/合源/力美/新材料协会（列位偏移无月单价）、罗立剑等门禁/网络文本滑列行、私人短租宿舍（11张通知单堆叠，户名在通知单抬头而非 sheet 名）。

---

## 第1刀 · 合同计费字段（详章）

> **⚠ 呈现方式已被 CONTRACT-CARD-SPEC 取代（2026-07-24 第 5 次返工）**：本刀的**数据底座**（`contract_billing_term` 多行 + 13 费项枚举 + `bill_mode` + `syncScalarCache` 缓存 + 契约 DTO）**继续有效并复用**；但「自由增删费项行 / 自由位置段」的**页面呈现被否决**，改为**按物业类型钉死费用组**（选类型→钉死行出现，无自由 `fee_key` 入口）。合同卡的类型钉死组、计费与旧字段合一、列表状态派生、续签链见 [`CONTRACT-CARD-SPEC.md`](./CONTRACT-CARD-SPEC.md)（唯一事实源）。V54 在本刀 V52/V53 基础上加 `contract_billing_term.property_type` 段类型标记 + `contract.parent_contract_id` 续签链 + `renewed` 状态。第 2~5 刀（派生/水电/账单/勾稽）不受影响。

目标：把"每户每费项怎么收钱"结构化进库，挂在合同上；来源=月度租金工作簿提取导入+人工补录。**本刀只存计费字段，不派生催缴单**（派生是第2刀）。

> **三次返工裁定（2026-07-23，用户拍板扁平计费行）**：V51 五固定字段装不下真实合同的多位置/厂房+宿舍共用单/空地/按间计费变体（§0.3），故计费从"五固定标量字段"改为**扁平计费行（位置分组 + 受控费项名）**。**守三条红线**：
> ① **费项名受控枚举**（13 种）非自由文本——不回到 V48 的自由 `fee_name` 条款；
> ② **单一编辑模式**——合同卡片既有编辑模式统一改全部数据，无独立编辑按钮（沿二次返工裁定②）；
> ③ **单位置户默认预置 5 标准行，看起来不变**——单厂房户仍呈现"租金/管理/维护/电梯/变压器"五行，与旧五字段视觉等价，只是底层是行。
>
> V51 五标量列**不删**，降级为"从租金类主行派生的**只读同步缓存**"（renew 继承 / 月租金联动 / 分析层读 `unit_price` 均不打断，同 V50 双向同步思路）。

### 1.1 数据模型（三次返工重写 = 扁平计费行）

**逻辑模型 `contract_billing_line`**（一户多计费位置段、每段多费项行）。**物理落在改造后的 `contract_billing_term` 表**（复用 V48 表，它已是"多行 + `params.prop` 存位置"，仅 +4 列即成型；不新建表、不做表改名迁移。`ponytail:` 表名保留为实现细节，DTO/API 对外用 `BillingLine` 命名）。

改造后字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK | 自增 |
| contract_id | INT FK | → contract(id) ON DELETE CASCADE（沿 V48） |
| location | VARCHAR(64) | **位置文本**（E座3-4层 / 宿舍楼 / 空地一 / 主 …）；单位置户填"主"或空。V52 从 `params.prop` 提升为独立列，便于刀2 分组与索引 |
| fee_key | VARCHAR(32) | **受控费项枚举**（13 种，见下）非自由文本；`@NotNull` + 后端白名单校验 |
| area | DECIMAL(12,2) | 计费面积（该费项该位置）；per_sqm 类必填 |
| unit_price | DECIMAL(12,4) | 单价（含税口径=应收口径）；per_month 类可空（额走 amount_override） |
| coeff | DECIMAL(8,4) DEFAULT 1 | 系数（真值仅翔海/旭化成 1.56；余默认 1） |
| room_count | INT NULL | 房数（门禁/网络按间计费用） |
| bill_mode | VARCHAR(16) | 计费方式枚举（5 种，见下） |
| amount_override | DECIMAL(12,2) NULL | **直填月额**，优先于按 bill_mode 计算（电梯/变压器/其他费用/税常用） |
| seq | INT DEFAULT 0 | 位置内行序（呈现与稳定排序） |
| source | VARCHAR(16) | import \| manual（沿 V48 覆盖律） |
| （保留）fee_name / tax_rate / params / note / created_at / updated_at | | 沿 V48；fee_name 降为 fee_key 的可选中文显示回显，params 存不含税价/原文文本等留档 |

**费项枚举 fee_key（13 种，用户 2026-07-23 确认）**：

| fee_key | 中文名 | 默认 bill_mode | 计算 |
|---|---|---|---|
| rent_factory | 厂房租金 | per_sqm_month | 面积×单价×系数 |
| rent_office | 办公室租金 | per_sqm_month | 面积×单价×系数 |
| rent_dorm | 宿舍租金 | per_sqm_month | 面积×单价×系数 |
| rent_shop | 商铺租金 | per_sqm_month | 面积×单价×系数 |
| rent_land | 空地租金 | per_sqm_month | 面积×单价×系数 |
| mgmt | 企业管理服务费 | per_sqm_month | 面积×单价×系数 |
| infra | 基础设施维护费 | per_sqm_month | 面积×单价×系数 |
| elevator | 电梯维护费 | per_month | 规则 N×150×L 或 amount_override |
| transformer | 变压器维护费 | per_month | KVA<150(含空)=159；KVA≥150→per_kva_month |
| access | 门禁设施维护费 | per_room_year | 单价×房数÷12 |
| network | 网络通讯费 | per_room_month | 单价×房数 |
| land_tax | 土地使用税 | per_month | amount_override（固定月额） |
| other | 其他费用 | per_month | amount_override |

**计费方式枚举 bill_mode（5 种）**：

| bill_mode | 语义 | 月额公式 |
|---|---|---|
| per_sqm_month | 面积×单价×系数 | `area × unit_price × coeff`（coeff 默认 1） |
| per_month | 固定月额 | `amount_override`（无则空待录） |
| per_room_year | 门禁：按间年计 | `unit_price × room_count ÷ 12` |
| per_room_month | 网络：按间月计 | `unit_price × room_count` |
| per_kva_month | 变压器 ≥150KVA | `1 × kva`（kva 取 `contract.kva`；<150 用 per_month 159） |

- **取值优先级**：`amount_override` 直填 > 按 bill_mode 规则派生 > 皆无 = 空待录。派生计算在刀2，本刀只存字段与参数。
- 单价一律含税口径；税率/不含税价个案记 `params`/`note` 留档，不建列。
- 系数变体：`coeff` 显式存 1.56（翔海/旭化成），**不再把系数折入单价**（V51 旧做法废除）——面积×单价×系数三者独立可见可改。

**电费签约要素仍并入 contract 宽表**（power_type / kva，V51 已建，沿用；变压器 per_kva_month 消费 `contract.kva`）：`power_type` enum 大工业(industrial)|商业(commercial)|居民(resident)；`kva` 仅大工业必填、商业/居民置灰禁填（表单+后端校验）。样本册 0 命中，值靠人工补录。

**V51 五标量列 = 只读同步缓存**（不删，裁定）：`contract.unit_price / mgmt_fee_price / infra_fee_price / elevator_fee / transformer_fee` 保留，每次计费行落库后由 `ContractService` **从租金类主行（location=seq 最小的 rent_* 行，或"主"位置）反向同步**：`unit_price`←该户主租金行单价、`mgmt_fee_price`←mgmt 行单价、`infra_fee_price`←infra 行单价、`elevator_fee`←elevator 行 amount_override、`transformer_fee`←transformer 行月额。多位置户取主位置行。缓存供 renew 继承、月租金联动、分析层读数——不打断既有读路径（同 V50 思路，方向由"条款↔宽表双向"收敛为"行→缓存单向"）。

### 1.2 提取导入（三次返工重写 = 停止收敛，FeeRow 1:1）

**关键转向**：V51 解析器把多行费项**收敛**进五标量字段，导致多价并存撞车、16 户租金丢失。改为 **FeeRow 1:1 出行**——解析出的每条费项行原样成为一条 `BillingLine`，不收敛、不合并同费项。

importRegistry 类型沿用 `billingTerms`（对外文案改"合同计费行"），解析器 `utils/importBillingTerms.ts` 重写落点：

1. **整册解析**：逐 sheet，先剔除非租户 sheet（"水电费/总表/应收费用总表"名单式排除）。
2. **块探测**：扫描通知单块表头签名（A1~A7 七型）；B/C/D 型无可提取块 → 整 sheet 报"须人工"，不阻断整批。
3. **解析陷阱（调研实证，逐条落解析器）**：
   - ① **叠单合并**：48 户为单 sheet 堆叠 2~5 张独立通知单，须**合并为该户费项合集**（同 contract 多位置段并存），非各自成户。实证：碧沃丰行 32/49、张勤军行 35/55/74 为同户不同通知单块。
   - ② **表头转置 5 户**（旭化成/暖通/合源/可莱恩/中科美业）：表头写"收费项目|物业名称"但数据仍是**列B=位置、列C=费项**；**靠"位置在前列"判定，不信表头文字**。
   - ③ **数值列无固定列号**：必须**按表头文本映射**列位——`面积|单价|房数|月单价|金额` vs `面积|单价|系数|月单价|金额` vs `建筑面积|空地面积|单价|系数` vs 可莱恩`双面积双单价`；不得按固定列索引取数。
   - ④ **按间计费房数 3 写法**：整数入房数列 / "N间"文本 / 留空靠房间号列表隐含数量——三种都要能解析出 `room_count`。
   - ⑤ **系数真值仅翔海+旭化成 1.56**：思汗 2/19 是**错位**（单价空、把宿舍价填进系数列）须**忽略回填**（coeff=1），不当真系数。
   - ⑥ **multiPick 多合同户**（银纳 2 合同）：厂房 sheet → 厂房合同、宿舍 sheet → 宿舍合同，按 sheet 归属拆到不同合同。
4. **行提取（FeeRow 1:1）**：每费项行 → 一条 Line{location, fee_key, area, unit_price, coeff, room_count, bill_mode, amount_override, note}。`fee_key` 由费项原文归一到 13 枚举；`location` 取块内位置列文本（转置②修正后）；`bill_mode` 按 fee_key 默认值（§1.1）；固定月额费（电梯/变压器/税/其他）落 `amount_override`。
5. **租户→合同匹配**：sheet 名（私人短租取通知单抬头户名）→ 租户主数据按名（含别名/家族归一）匹配 → 该租户在文件所属月生效合同。唯一命中直入预览；**多合同户预览人选**（⑥）；**翔海类无合同户报"须先建合同"**（不静默丢、不猜建）。
6. **覆盖导入**：确认入库按合同**整组替换 source='import' 的计费行**，人工改过（source='manual'）的行保留。重导修正即覆盖，手录不丢。
7. 沿既有导入闭环：解析→预览（含待核区）→确认→入库→import_log→逐行错误。导入中心+合同屏双入口。
8. **全量覆盖与到户报告**：覆盖面 = **282 户在册合同全部**；导入报告按 282 户逐户列计费行状态（已导入/人工已录/空待录）+来源 sheet；6 户流水账/无通知单显式标"须手录"；翔海类标"须先建合同"；未提取户显空待录（合同页可见），不算失败但必须在报告有名。零静默丢行。

### 1.3 合同页呈现与单一编辑模式（三次返工重写）

- **按 location 分组卡片**：合同卡片内每个位置段一张分组（组标题=location），组内为费项行。
- **组内费项行**：`费项名（fee_key 下拉，13 枚举）` + `面积` + `单价` + `系数` + `房数` + `月单价（只读派生 = 按 bill_mode 实时算）`。per_month 类行隐藏面积/单价、显 `直填月额`。
- **单位置户默认预置 5 标准行**（红线③）：单 location（"主"）下预置 `厂房租金（或按租户类型 office/dorm/shop）/企业管理服务费/基础设施维护费/电梯维护费/变压器维护费` 五行——与旧五字段视觉等价，**看起来不变**。
- **单一编辑模式**（沿 EDIT-MODE-SPEC、二次返工裁定②）：合同卡片既有编辑模式统一改全部字段——基本信息/面积/免租期/**计费行增删段+增删行**/用电分类/KVA 一个编辑态同入同出；**无独立"编辑条款/编辑计费行"按钮**。编辑态可"新增位置段"、段内"新增费项行"、行内改 fee_key/面积/单价/系数/房数/直填月额、删行删段。
- **校验**：单价/面积/月额/房数 ≥0；系数 >0（默认 1）；fee_key ∈ 13 枚举；kva 随 power_type 联动（大工业必填、商业/居民置灰禁填）；电梯 N/L 正整数。
- **不显示月应收合计**（计算属账单管理，刀2）；viewer 全只读。

### 1.4 面积模型联动与建筑面积清空修复（沿旧口径）

- **面积口径**：计费行 `area` = 该费项该位置的**租赁/计费面积**（合同里的就是租赁面积）。合同级 `contract.rent_area` = 主租金行面积（单位置户即该行；多位置户取主位置租金行，或按需汇总，刀2 派生时以行 area 为准，rent_area 仅列表/缓存展示）。建筑面积走既有 0.8 换算模型派生。楼栋建筑面积 = 栋内租户建筑面积汇总（沿 V49）。
- **建筑面积清空重算（裁定①，已修）**：编辑模式中建筑面积可清空；清空保存后自动 = 租赁面积×0.8 重算（V33 方向）；显式填值尊重填值。根因=MyBatis-Plus 忽略 null 更新，`updateStrategy=ALWAYS` 已修（Contract 实体现状）。
- 免租期只认合同 rentFree 字段（第2刀派生时消费）。

### 1.5 迁移与实现文件清单（三次返工增量）

已上线存量：V48 条款表、V49 面积回填、V50 单价同步（退役为单向缓存）、V51 五标量+电费要素、`importBillingTerms.ts`、`ContractBillingTermApiIT`。三次返工增量：

**迁移 `V52__flat_billing_lines.sql`**（**先备份** contract + contract_billing_term）：
1. `ALTER TABLE contract_billing_term ADD COLUMN location VARCHAR(64) NULL, ADD room_count INT NULL, ADD amount_override DECIMAL(12,2) NULL, ADD seq INT NOT NULL DEFAULT 0;`（fee_key 列已存在，语义改为受控枚举）。
2. **反拆五标量 → 计费行**：对 `contract` 每个非空标量各 INSERT 一条 line（location='主'，source 取 `fee_src` 对应值，seq 1..5）：unit_price→rent_*(按租户类型定 fee_key，缺省 rent_factory)、mgmt_fee_price→mgmt、infra_fee_price→infra、elevator_fee→elevator(amount_override)、transformer_fee→transformer(amount_override)。
3. **留档 157 行回填新列**：既有留档行 `location`←`params->>'$.prop'`（缺省'主'）、`fee_key`←fee_name 归一映射、`room_count`←`params->>'$.rooms'`、`amount_override`←per_month 行的 unit_price、`bill_mode` 补默认。**这批含 16 户 unit_price=NULL 的多价租金行**（V51 DELETE 因 `t.unit_price=c.unit_price` 遇 NULL 不匹配而未删，仍在表内）→ 回填后即成计费行，**16 户租金恢复显示**。
4. **同步缓存**：反拆后五标量已持有值即缓存，无需重算；后续以 §1.1 单向同步维护。
5. `ponytail:` 不改表名（contract_billing_term 保留），不建 contract_billing_line 新表——省一次数据搬迁。

后端：
- `V52__flat_billing_lines.sql`（上）
- `entity/ContractBillingTerm.java` +location/roomCount/amountOverride/seq 字段
- `dto/BillingLineDTO`、`ContractCreateReq` 加 `List<BillingLineReq> billingLines`、`ContractDetailDTO` 加 `List<BillingLineDTO> billingLines`、`BillingLinesImportRequest`（见 §1.7 契约）
- `service/ContractService.java`：detail 带出计费行、update 整组替换计费行+反向同步五标量缓存、importBillingLines（1:1 落行）；`controller/ContractController.java` 端点调整（§1.7）
- IT：计费行读写往返 + 单价缓存同步 + kva 联动校验 + V52 迁移映射抽查（16 户租金恢复、反拆五行）（2099 槽约定）

前端：
- `utils/importBillingTerms.ts` 重写：停止收敛、FeeRow 1:1、叠单合并/转置修正/列文本映射/按间房数/multiPick/翔海报错
- `views/contracts/ContractDrawer.vue`：location 分组卡片、组内费项行、单位置默认 5 行、单一编辑模式增删段/行、月单价只读派生、不显月应收合计
- `api/contract.ts`/`types/contract.ts`：BillingLine 类型 + detail/update 带 billingLines

### 1.6 锚点验收（计费行 1:1，逐格全等）

导入两册真实文件后，以下锚点逐格全等（公式：`月单价 = 面积×单价×系数(默认1)`；`按间 = 单价×房数(年÷12)`）：

| # | 锚点 | 计费行 | 期望值 |
|---|---|---|---|
| ① | 金纳·主位置租金行 | rent_factory 3200×9.6785×1 | 面积3200 单价9.6785 月额30971.2 |
| ② | 金纳·管理/维护 | mgmt 3200×5.45 / infra 3200×1.91 | 17440 / 6112 |
| ③ | 金纳·电梯/变压器 | elevator/transformer amount_override | 318 / 159 |
| ④ | 银纳·厂房位置 | rent_factory 256.52×22.565 | **5788.4** |
| ⑤ | 银纳·宿舍位置 | rent_dorm 488.33×19 | **9278.27** |
| ⑥ | 银纳·门禁 | access per_room_year 100×13÷12 | **108.33** |
| ⑦ | 银纳·网络 | network per_room_month 50×13 | **650** |
| ⑧ | 翔海·E座3-4层 | rent_factory 4708×12.1×1.56 | **88868.21**（共 **7 位置**段） |
| ⑨ | 翔海·合同缺失 | — | 导入报"**须先建合同**"，不猜建 |
| ⑩ | 旭化成·系数 | coeff=1.56 独立列（不折入单价） | 单价×1.56 |
| ⑪ | 思汗·系数错位 | coeff=1（忽略回填，非 2/19） | 系数不当真 |
| ⑫ | 16 户消失租金 | 一元兰欣/高建军/欧培敬/罗立剑等 | V52 后**恢复显示** |
| ⑬ | 南宗 | — | 整 sheet 报"须手录"（D型，不导 2023 旧价） |

另加总量断言：146 sheet 自动提取、209 块、920 费项行全数 1:1 落预览（不收敛、不丢）；到户报告 282 户逐户有名；6 户流水账标"须手录"；翔海类标"须先建合同"。

### 1.7 契约（DTO / API 端点，写死供下游并行）

**枚举常量**（前后端共享，值即 §1.1 表）：
- `FeeKey` = `rent_factory | rent_office | rent_dorm | rent_shop | rent_land | mgmt | infra | elevator | transformer | access | network | land_tax | other`
- `BillMode` = `per_sqm_month | per_month | per_room_year | per_room_month | per_kva_month`
- `PowerType` = `industrial | commercial | resident`

**读 DTO `BillingLineDTO`**（record）：
```
BillingLineDTO(
  Integer id, Integer contractId, String location,
  String feeKey, String feeName,          // feeName=可选中文回显
  BigDecimal area, BigDecimal unitPrice, BigDecimal coeff,
  Integer roomCount, String billMode,
  BigDecimal amountOverride, Integer seq, String source  // import|manual
)
```

**写 Req `BillingLineReq`**（内嵌于 ContractCreateReq，单一编辑随合同整体 PUT）：
```
BillingLineReq(
  Integer id,               // null=新增
  String location,
  String feeKey,            // @NotNull ∈ FeeKey
  BigDecimal area, BigDecimal unitPrice,
  BigDecimal coeff,         // null→1
  Integer roomCount,
  String billMode,          // null→按 feeKey 默认
  BigDecimal amountOverride,
  Integer seq
)
```

**导入 Req `BillingLinesImportRequest`**（FeeRow 1:1，替换退役的 `BillingFieldsImportRequest`）：
```
BillingLinesImportRequest(List<Row> rows)
  Row(Integer contractId, List<Line> lines)     // contractId 已由前端完成匹配/multiPick
  Line(String location, String feeKey, BigDecimal area, BigDecimal unitPrice,
       BigDecimal coeff, Integer roomCount, String billMode,
       BigDecimal amountOverride, String note)
```

**API 端点**：
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/contracts/{id}` | ContractDetailDTO 现含 `List<BillingLineDTO> billingLines`（按 location, seq 排序） |
| PUT | `/api/contracts/{id}` | ContractCreateReq 现含 `List<BillingLineReq> billingLines`；**整组替换该合同计费行**（单一编辑模式最终态），落库后**反向同步五标量缓存** |
| POST | `/api/contracts/billing-lines/import` | 入参 BillingLinesImportRequest；按合同整组替换 source='import' 行、保留 manual 行；返回 ImportResultDTO（逐行错误+到户报告）。**旧 `/api/contracts/billing-fields/import` 退役** |

- 计费行不设独立 CRUD 端点（单一编辑模式：随合同 PUT 进出）。`ponytail:` 无独立行级 API，需要行内实时校验时前端本地算，落库走合同 PUT。

---

## 第2刀 · 月度租金催缴单派生（提纲，三次返工调整）

- 引擎：**合同计费行按 location 分组 × 目标月** → 每户催缴单草稿。逐计费行按 `bill_mode` 算月额（per_sqm_month=面积×单价×系数；per_month=amount_override；per_room_year=单价×房数÷12；per_room_month=单价×房数；per_kva_month=1×kva）；催缴单按 location 分段呈现，段内多费项行。合同期外不生成，免租期月（rentFree）金额置0留痕（仅租金类免租，管理/维护/电梯/变压器是否免租按合同条款，默认不免）。
- 新表 `bill_notice`（户×月×location×费项快照，含单价/面积/系数/房数快照——调价不漂移历史，同 PV price_snap 口径）。
- 草稿→定稿状态机；定稿后计费行修改不回溯。
- 验收：对样本月（2024-03）派生结果 ⇄ 原通知单应收金额**逐户逐位置**对比，差异清单可解释；银纳（厂房+宿舍+门禁+网络四段）、翔海（7 位置）为多段验收样本。

## 第3刀 · 水电催缴单（提纲）

- 缺口=租户水电抄表计费链（2024数据审计已确认为最大缺口；园区 P-A 抄表 1134 块表已入库可复用表底档）。
- 租户表 ⇄ 合同/租户绑定；抄表量 × 单价（基准电价/水价，含公摊分摊 P-B 引擎衔接边界）→ 每户水电表。
- 基本用电费（KVA×单价）待条款人工补录后并入。

## 第4刀 · 账单条整合（提纲）

- 派生催缴单（租金+水电）接入 /bills 屏：与附表10 来源并列展示，账单条标注来源徽标；导出沿 BILLS-SPEC 工资条版式+收款公司指引。
- 过渡期以附表10 为准展示，派生值作对照列；切换主源需用户拍板。

## 第5刀 · 勾稽（提纲）

- 三方对账：派生应收 ⇄ 附表10 ⇄ 台账实收，recon 深链沿既有对账屏模式扩展。
- 差异分级：金额差/缺户/多户；免租期与调价是常见可解释差异，先建白名单口径再报警。
</content>
</invoke>
