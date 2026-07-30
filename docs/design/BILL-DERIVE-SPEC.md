# 催缴单派生规格（BILL-DERIVE-SPEC）

> 2026-07-28 定稿。用户拍板计价规则 → 用 2024-02 两册真实数据全量复刻验证 → 本文。
> 验证脚本：`demo3/scripts/verify_tariff_rule_202402.py`（可重跑，价目全部读自 Excel，脚本内不硬编码价格）。
> 上游已完成资产：PRICE-CFG-SPEC（价目簿 V60-V62）、METER-SPEC/S2-BIND-SPEC（表档案+绑定 V63）、
> POOL-ENGINE-SPEC（池核算 V64-V67，已 2024-02 逐池验证）。本文是把这三样合成「一户一单」的规格。
> **本刀不建表、不写代码**，DDL 是草案。

---

## 0. 验证结论（先说结论，数字见 §2.4）

用户口述的计价规则**能复刻历史，但需要一处修正**：判定优先级要把「有没有尖峰平谷」放在「是不是宿舍表」**之前**。

| 判定树 | 电费明细行命中率 | 全部明细行命中率 |
|---|---|---|
| A 字面树（宿舍册优先 → 分时 → 商业） | 682/739 = **92.29%** | 2034/2164 = **93.99%** |
| B 修正树（分时优先 → 宿舍房间 → 商业） | 710/739 = **96.08%** | 2097/2164 = **96.90%** |

B 树剩余 67 行不命中，**全部是已建档的户级例外或已定性的数据质量问题，零无法解释项**（清单见 §2.5）。
把这 24 户例外按价目簿 `tenant:{id}` scope 录进去以后，2024-02 可 100% 复刻。

---

## 1. 单据模型：一户一单

**用户拍板：不用电表分合同，缴费单出到租户；一个租户一张单，单内逐表列明细。**

```
bill_notice（户 × 月 × 收款主体）
└── bill_notice_line（明细行）
     ├── 电费段  电表① 用量 3055 度 × 计价规则 → 金额        ← 一表一段，多时段则一段多行
     │            └ 峰 739×1.20606875 / 尖峰 673×1.20606875 / 平 1396×0.72076875 / 谷 247×0.29116875
     ├── 电费段  电表② …
     ├── 电力管理费  总用量 × 0.16（或商业 0.32）
     ├── 装机容量费  合同 kVA × 22.6                          ← 与用电量无关
     ├── 公摊类    楼层公共/电梯/消防/路灯/线路损耗            ← 取自 alloc_pool_result（S3-B1 已完成）
     ├── 水费段  水表① 吨 × 3.95
     ├── 水管网维护费 吨 × 0.5
     └── 绿化水公摊 面积 × 单价
```

### 1.1 表序号（「电表①电表②」）定义

**结论：直接用 `meter.sub_name`，不新造编号。** 抄表册原本就按租户/位置给表编了 ①②③，导入时已落库：

| sub_name | 电表数 |
|---|---|
| 电表① | 546 | 电表② | 19 | 电表③ | 5 | 电表④ | 3 | 电表⑤ | 1 | 总电表 | 22 | NULL | 54 |

- **排序**：`ORDER BY meter.sub_name`（①②③ 是 Unicode 序，天然正确）→ 同名并列时用 `sort_no, id` 兜底。
- **NULL 的 54 块**：按 `sort_no, id` 顺位补号，展示为「电表①/②…」，但**不回写 meter 表**（原册没编号就是没编号，回写等于伪造源数据）。
- **不按场地分组重新编号**。多场地租户（可莱恩 A602+B201+C402+宿舍）的表序号仍全户连续，
  场地信息进明细行的 `premise` 字段（如「A座602室」），单内按场地分段小计——这与 Excel 原单的排布一致。

### 1.2 拆单（收款主体）

一户可能出**多张**单（一期拆票 / 二期双票）：水电费单收一泽、维护费单收帮管好、宿舍段单收创显。
`bill_notice.pay_company_id` 是单据级字段；费项→收款公司映射沿用既有 `bill_pay_company`（tenant × fee_key）。
**一户一单是「一个租户一套账」的意思，不是物理上只能有一张纸。**

---

## 2. 计价判定树（验证后定稿）

### 2.1 电费单价

```
对每块租户电表（ownership='tenant'）的每个计费段：
  ① 该表当月有尖峰平谷分时读数        → 四时段价：
        峰 elec_peak 1.20606875
        尖 elec_sharp 1.50076875（名义）× sharp_as_peak_ratio=0 ⇒ 实收 elec_peak
        平 elec_flat 0.72076875
        谷 elec_valley 0.29116875
     附加：电力管理费 mgmt_fee 0.16 元/度 × 总用量
  ② 否则该表是宿舍房间表（宿舍段按房号计费的分间明细）→ elec_resident 0.63586875 + mgmt_fee 0.16
  ③ 否则                                → elec_commercial 0.79416875 + mgmt_fee_commercial 0.32
  ④ 户级例外（价目簿 tenant:{id} scope）覆盖上述任一档
```

**为什么必须是这个顺序**（用户原话是「宿舍表格的就算按照宿舍的电费计价方式」＝先看宿舍）：
宿舍册里有三类表不按居民价收——

- **分时表**：彭健宜/彭周荣/彭小兰/蔡高育/陈昌辉/雷少康/广联饭堂 等，宿舍册里**一个时段建一行表标识**
  （彭健宜峰/彭健宜尖/彭健宜平/彭健宜谷），实收四时段价。字面树会误判成居民价 → 这是 A/B 两树 28 行差距的主因。
- **商铺**：章肖艳/李李商铺 1.5 包干；可盈餐厅按**商业价 0.79416875 + 0.32**。
- **宿舍整栋转租**：开利暖通（二栋/三栋宿舍）按居民价——与②一致。

「宿舍房间表」的判据 = **VLOOKUP 键是房号（430/431/2112…）而不是表标识**，落到本系统 =
`meter.zone='dorm' AND meter.spot 是房号 AND 归在租户的宿舍段`。工程实现建议：
`meter.meter_type='户内用电' AND zone='dorm' AND sub_name IS NULL AND 名称为纯数字房号`，
或更稳的做法——**建档时打一个 `is_dorm_room` 标记**，别在派生时猜。

### 2.2 管理费/维护费

| 电表档 | 每度附加 | cfg_key |
|---|---|---|
| 分时 | 0.16 | `mgmt_fee` |
| 居民（宿舍房间） | 0.16 | `mgmt_fee`（dorm scope 同值） |
| 商业单一价 | 0.32 | `mgmt_fee_commercial` |

命中率 531/550 = 96.55%，19 行不命中全是户级例外（林锐辉 0.1、朱漫钳 0.1、星州 0.15、永龙 0.15、可盈 0.32）。

### 2.3 水费

```
① 宿舍房间表 → water 3.85，water_pipe 0（无管网费）
② 否则       → water 3.95 + water_pipe 0.5
③ 户级例外 4.45（水+管网合并价）：禹晨/公交车站/幸悦/詹凯乔/朱漫钳/南一/火炬园
```

**判据必须是「宿舍房间」而不是「宿舍水册」**——验证实证：

| 判据 | 行数 | 单价分布 |
|---|---|---|
| a. 表在宿舍水册 | 267 | 3.85×247、**3.95×19**、4.45×1 |
| b. 宿舍房间表（房号为键） | 244 | **3.85×244（100% 干净）** |
| 园区册（非宿舍） | 208 | 3.95×193、4.45×15 |

判据 b 零杂质。宿舍册里按 3.95 收的 19 行＝宿舍区独立户（章肖艳/彭健宜/张勤军等）；
反向 3 行例外（可盈、开利暖通二栋/三栋）按 3.85 收，进户级例外清单。
管网费命中率 400/400 = **100.00%**。

### 2.4 验证命中率（脚本输出原文）

```
通知单 sheet: 一期 95 张 / 二期 55 张; 明细行 2164 条;识别为分时表的表组 111 个
价目(读自 一期!创显承担电费 K3:O9): commercial=0.79416875, commercial_mgmt=0.32, 峰=1.20606875,
  尖峰_nominal=1.50076875, 平=0.72076875, 谷=0.29116875, resident=0.63586875, tou_mgmt=0.16, resident_mgmt=0.16
跨册价目交叉校验(二期园区电!AA14/AC10:AC13): 峰 ✓; 尖峰_nominal ✓; 平 ✓; 谷 ✓; resident ✓

── 命中率 · A 字面树(宿舍册优先 → 分时 → 商业) ──
  电费明细行              总  739 行,命中  682,不命中  57,命中率  92.29%
  电力管理费/维护费行         总  550 行,命中  531,不命中  19,命中率  96.55%
  水费明细行              总  475 行,命中  440,不命中  35,命中率  92.63%
  水管网维护费行            总  400 行,命中  381,不命中  19,命中率  95.25%
  合计                 总 2164 行,命中 2034,不命中 130,命中率  93.99%

── 命中率 · B 修正树(分时优先 → 宿舍房间 → 商业) ──
  电费明细行              总  739 行,命中  710,不命中  29,命中率  96.08%
  电力管理费/维护费行         总  550 行,命中  531,不命中  19,命中率  96.55%
  水费明细行              总  475 行,命中  456,不命中  19,命中率  96.00%
  水管网维护费行            总  400 行,命中  400,不命中   0,命中率 100.00%
  合计                 总 2164 行,命中 2097,不命中  67,命中率  96.90%

── 边界核查(B 修正树口径) ──
  ① 单一价电表(无分时→商业价 0.79416875): 41/62 (66.1%)
  ② 分时电表(四时段价+0.16):        430/432 (99.5%)
  ③ 宿舍房间表(居民价 0.63586875+0.16): 239/245 (97.6%)
     宿舍册但非房间表(商铺/宿舍区独立户): 33/46 (71.7%)  ← 字面树认定为居民价的口子
  ⑥⑦ 抄表册分时可用性 × 出账方式(逐表交叉,不依赖通知单排版):
      [ 56 表] 无分时读数 且 按单一价出账 ✓
      [  2 表] 抄表册查无此表标识(按单一价出账)   一期·尧萍、一期·屋达玛
      [  1 表] 抄表册查无此表标识(按分时出账)     一期·翔海 表=G翔海自建电
      [  4 表] ⑥ 有分时读数 却按单一价出账 ⚠     一期·芷泉、二期·欧伟杰(临电)、二期·火炬园(广告字)、二期·陈书谨
      [107 表] 有分时读数 且 按分时出账 ✓
```

**①的 66.1% 不是规则失败**：62 块单一价表里 21 块是 1.5 商铺 / 1.0 包干 / 1.3 特价的户级例外表，
扣掉例外后 41/41 全中。**⑦「无分时读数却按分时价」= 0 例**（历史上零反例）；
**⑥「有分时读数却按单一价」= 4 表**，全部是包干/特价户（见 §2.5），即例外价压过了分时读数，不是口径错。

### 2.5 不命中清单（67 行 / 24 户，全部可归因）

| 行数 | 归因 | 户 |
|---|---|---|
| 13 | 户级水价 4.45（水+管网合并价） | 幸悦、詹凯乔、火炬园、禹晨、公交车站、朱漫钳、南一 |
| 12 | 户级商铺包干 1.5 元/度 | SENAN、周兴、威奈斯、张丽莉、张勤军、沙力海、芷泉、袁华圣、章肖艳、李李商铺、火炬园广告字 |
| 16 | 户级管理费例外 0.10/0.15 | 林锐辉 0.1、朱漫钳 0.1、星州 0.15、永龙 0.15 |
| 6 | 宿舍册按 0.79586875 收 | 工程队宿舍 ×3（**2 月数据套 2023-08 旧模板旧价**，P1 §2.8 已定性） |
| 5 | 户级包干 1.0 元/度（含维护） | 禹晨、粤海华创、联塑精铟（A座孵化器）、广联临电、欧伟杰临电 |
| 3 | 宿舍册按商业价 0.79416875 + 0.32 | 可盈餐厅（宿舍区一楼商铺） |
| 3 | 宿舍册水按 3.85 而判定 3.95 | 可盈、开利暖通二栋/三栋 |
| 2 | 尖段按**名义尖价** 1.50076875 实收 | 火炬园（全册唯一，专用补差公式） |
| 2 | 翔海 E 座楼层公共专用实测表 0.99516875 | 翔海（独立结算轨道，P1 §2.7） |
| 1 | 1.2 元/度 | 张誉腾 |
| 1 | 1.3 元/度 | 陈书谨（钢构户） |

→ **落地动作**：这 24 户写进 `tenant_price_cfg` 的 `tenant:{id}` scope（PRICE-CFG-SPEC §5「9 项待录」应扩到 24 项）。

---

## 3. 户内费项全集

| # | 费项 | 计算 | 数据来源 |
|---|---|---|---|
| ① | 装机容量费 | 合同 kVA × `capacity_fee` 22.6（可莱恩 B201 = 23） | `contract.kva`；月中起租按天折 |
| ② | 电费 | Σ 段用量 × 段价（§2.1） | `meter_reading`（本月−上月）× `factor_snap` |
| ③ | 电力管理费 | 总用量 × 0.16 / 0.32 | §2.2 |
| ④ | 楼层公共、消防照明 | 池标准 × 份额 | `alloc_pool_result`（S3-B1 已完成） |
| ⑤ | 电梯用电 | 池标准 × 层数/面积/协议额（5 种模式） | 同上；模式是池级字段 |
| ⑥ | 消防用电（仅二期） | 楼栋基数 + 0.015×面积÷层数 | 同上 |
| ⑦ | 线路损耗 | (②+④+⑤+⑥) × 楼栋损耗率 | `alloc_loss_result.tenant_rate`；宿舍固定 0.012 |
| ⑧ | 路灯公摊 | 面积 × 月推单价（一期 0.04 / 二期 0.005 / 宿舍 0.06） | `alloc_pool_result.std_value` |
| ⑨ | 水费 | 吨 × 3.95 / 3.85 / 4.45 | `meter_reading`（水表） |
| ⑩ | 水管网维护费 | 吨 × 0.5（宿舍 0） | §2.3 |
| ⑪ | 绿化水公摊 | 面积 × 月推单价（一期 0.009 / 二期 0.008\|0.01 / 宿舍 0.02） | `alloc_pool_result` |

**边界**：④⑤⑥⑦⑧⑪ 的**池核算与损耗率是上游（S3-B1，已验收）**，本刀只负责「取标准 × 份额 → 落到户」。
池的**已分摊回填与盈亏对账（allocated_amount/gap_amount）是本刀的下游**，在户级明细落库后回写。

---

## 4. `bill_notice` DDL 草案

```sql
-- 单头:户 × 月 × 收款主体(拆单则多行)
CREATE TABLE bill_notice (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ym             CHAR(7)     NOT NULL,
  tenant_id      INT UNSIGNED NOT NULL,
  pay_company_id INT UNSIGNED NULL COMMENT '收款主体;拆单键',
  notice_kind    VARCHAR(12) NOT NULL DEFAULT 'combined' COMMENT 'combined合一单/fee水电费单/maint维护费单/dorm宿舍单',
  premise_text   VARCHAR(255) NULL COMMENT '位置原文,多场地逗号连接',
  total_amount   DECIMAL(14,2) NOT NULL DEFAULT 0,
  prev_due       DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT '上期欠费',
  status         VARCHAR(12) NOT NULL DEFAULT 'draft' COMMENT 'draft/issued/void',
  gen_batch      VARCHAR(32)  NULL COMMENT '派生批次;重跑幂等键',
  generated_at   DATETIME    NOT NULL,
  UNIQUE KEY uk_notice (ym, tenant_id, pay_company_id, notice_kind),
  KEY idx_notice_ym (ym),
  CONSTRAINT fk_notice_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id)
) COMMENT='催缴单单头,一户一单(拆票则一户多单)';

-- 明细行:一表一段;分时表一段四行
CREATE TABLE bill_notice_line (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  notice_id    INT UNSIGNED NOT NULL,
  line_no      SMALLINT UNSIGNED NOT NULL,
  fee_key      VARCHAR(32) NOT NULL COMMENT 'elec/mgmt_fee/capacity/water/water_pipe/share_elec_*/loss/green_water',
  premise      VARCHAR(64)  NULL COMMENT '场地段(A座602室);多场地租户分段小计用',
  meter_id     INT UNSIGNED NULL COMMENT '来源表;公摊/容量费行为 NULL',
  meter_label  VARCHAR(16)  NULL COMMENT '展示用「电表①」= meter.sub_name 或顺位补号',
  seg          VARCHAR(8)   NULL COMMENT 'sharp/peak/flat/valley;单一价表 NULL',
  prev_read    DECIMAL(14,2) NULL,
  curr_read    DECIMAL(14,2) NULL,
  factor_snap  DECIMAL(10,2) NULL,
  qty          DECIMAL(14,2) NULL COMMENT '实际用量/吨/㎡',
  price_snap   DECIMAL(14,8) NULL COMMENT '实收单价快照(尖段按峰价时存峰价)',
  price_key    VARCHAR(32)   NULL COMMENT '取价用的 cfg_key',
  price_scope  VARCHAR(32)   NULL COMMENT '命中的 scope: tenant:{id}/p1/p2/dorm/'''' ← 事后审计「为什么按商业价」',
  price_month  CHAR(7)       NULL COMMENT '命中的价目版本生效月(常数键可能早于本月)',
  rule_branch  VARCHAR(16)   NULL COMMENT '判定分支: tou/resident/commercial/tenant_override/pool/fixed',
  pool_rule_id INT UNSIGNED  NULL COMMENT '公摊行来源池(alloc_rule.id)',
  base_snap    DECIMAL(14,2) NULL COMMENT '公摊份额基数(层数/面积)',
  amount       DECIMAL(14,2) NOT NULL,
  note         VARCHAR(255)  NULL,
  UNIQUE KEY uk_line (notice_id, line_no),
  CONSTRAINT fk_line_notice FOREIGN KEY (notice_id) REFERENCES bill_notice(id) ON DELETE CASCADE,
  CONSTRAINT fk_line_meter  FOREIGN KEY (meter_id)  REFERENCES meter(id)
) COMMENT='催缴单明细行;price_scope+price_month+rule_branch 三列构成取价审计链';
```

**审计链设计要点**：`rule_branch` 记「走了判定树哪一支」，`price_scope`/`price_month` 记「价从哪条版本行来」。
两者合起来回答「这行为什么按商业价 0.79416875」——不用回溯代码，查一行就够。
（这也是 PriceCfgService.resolve 里那条 `ponytail:` 注释预告的扩展点：返回值要从 `BigDecimal` 扩成
带 scope/month 的 record，否则 `price_scope` 填不出来。）

**幂等**：`gen_batch` + `uk_notice`，重跑先删后插（同 meter_reading 口径）。
读数/池结果都已快照落库，重跑不漂移。

---

## 5. 与既有资产的接线

| 需要的东西 | 从哪来 | 备注 |
|---|---|---|
| 单价 | `PriceCfgService.resolve(key, ym, tenantId, zone)` | 已有 v2 版本链：`tenant:{id}` → `zone` → `''`；月变键仅命中当月，常数键沿链前滚 |
| 用量 | `meter_reading`（`prev_*`/`curr_*` × `factor_snap`） | 分时判定 = `curr_peak/flat/valley` 是否非空（`meter.device_type='multi'` 是辅助信号，不做唯一判据） |
| 表 → 租户 | `MeterBindingService.resolveBinding(ym)` 五级归属 + `meter.contract_id` 人工覆盖 | S2-BIND-SPEC |
| 表序号 | `meter.sub_name`（电表①②③），NULL 按 `sort_no,id` 顺位补 | §1.1 |
| 公摊标准 | `alloc_pool_result`（`std_value`/`base_snap`/`price_snap`） | S3-B1 已 2024-02 全池验证 |
| 损耗率 | `alloc_loss_result.tenant_rate`；宿舍 `dorm.loss_rate=0.012` | 基数不含容量费与管理费 |
| kVA | `contract.kva` | 月中起租按天折；`power_type` 语义=两部制/单一制 |
| 收款主体拆单 | `bill_pay_company`（tenant × fee_key） | P2 §4 五公司分账块 |

**新增需要的两处**（本刀落地时补，不在本刀做）：
1. `PriceCfgService.resolve` 扩成返回 `(value, scope, acctMonth)` 的 record —— 否则审计链缺列。
2. 宿舍房间表标记（`meter.is_dorm_room` 或等价判据）—— 否则 §2.1 的②分支只能靠名称猜。

---

## 6. 未决问题

1. **宿舍房间表怎么标**：加 `meter.is_dorm_room` 列，还是用「zone=dorm 且名称是纯数字房号」推？
   推的方案对可盈/开利暖通这种宿舍区非房间户会误判——建议加列，建档时一次定死。
2. **24 户例外何时录入**：验证已给出全清单（§2.5）。录之前派生结果对这 24 户必然错，
   要不要先做「例外未录 → 该户单据打警告标」的门禁？
3. **尖段名义价**：全园 `sharp_as_peak_ratio=0`，唯独火炬园两行按 1.50076875 实收。
   是火炬园补差公式的特例（不入普通派生），还是要支持户级 ratio 覆盖？建议前者。
4. **工程队宿舍旧价 0.79586875**：历史册套了 2023-08 模板。重算成当月价会与历史账不符——
   派生新单用当月价，历史对账允许「旧价残留」类差异（同 P2 §8.7 结论），需用户确认。
5. **一户多单的合并展示**：拆单后前端是展示 N 张单，还是一张「合并视图 + 收款主体分列」？
   Excel 原册是纵向堆叠多张完整通知单。
6. **上期欠费 prev_due 的来源**：接 `bill`/收款流水，还是本刀先留 0 由人工填？
   （催缴闭环断链是第二次全面审计的最大产品缺口，这里是接口点。）
7. **负数行**：读数回退（-169.1 度）、水表倒走、跨户转供冲减（翔海−张执盛−博浩镜像）在历史册里
   直接开负数单。`bill_notice_line.amount` 允许负值，但要不要在单头做「本期为负」的显式标记？
8. **账外户**：翔海/工程队宿舍/个人宿舍/幸悦/詹凯乔/顺心鸿等 10 个 sheet 出单但不入应收总表。
   派生要不要出这些单？建议出单 + `notice_kind='offbook'` 标记，不进应收。
