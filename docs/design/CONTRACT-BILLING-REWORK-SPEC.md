# 合同管理重做规范（CONTRACT-BILLING-REWORK-SPEC）

> 2026-07-25 用户拍板。本规范确立**统一模型**（每个价格时段 = 链里一份完整合同，账单按覆盖月的合同派生），
> 并**增补/覆盖** `CONTRACT-CARD-V2-SPEC` 的 §3（卡片结构，删阶梯块）。
> 分两期：**Phase A**（合同侧补完整 + master-detail 页面）本轮做；**Phase B**（账单按合同派生）下一轮独立 spec。
> 代码注释引用写 `CONTRACT-BILLING-REWORK-SPEC §x.y`。

---

## 0. 为什么再改（用户诉求 → 探底事实）

| 用户不满 | 探底事实（源码/DB 证据） |
|---|---|
| 详情卡太小塞不下 | 现是**居中模态**(`FPDrawer.vue` `width:min(600px,94vw)` 居中盖屏)，非抽屉非整页 |
| 续签链切第2份是空的、切换无意义 | DB 实测 **14 份续签合同标的段全空**；根因是 `importFull` 导入把续签链**后续期挂空**(`replaceImportLines(n,null)`，`ContractService.java:406`)——**不是 renew() 的锅**，renew() API 其实会复制标的段(`ContractService.java:217-230`，有 IT 佐证) |
| 租金阶梯表没用、单价没联动标的段 | 阶梯块 `FPRentTierBar` 仅 `ContractDrawer` 用；它与标的段单价是两套数，确实不联动 |
| 账单没按合同派生 | 账单管理租金 **100% 读附表10**(`s10_record`)历史数字，合同侧只在卡上 `lineMonthly` 算只读预览，**不进账单不落库**；「合同→账单」链未建（BILL-FORWARD 第2/4刀未动） |

**关键洞察**：涨价（续签换约 / 同约三年递增）在数据上是「不同时段不同价」；只要把**每个时段都落成链里一份自带完整价的合同**，账单派生就只有一套逻辑，且能彻底删掉阶梯表。

---

## 1. 统一模型裁定（北极星，2026-07-25）

> **账单派生的唯一规则 = 找覆盖这个月的那份合同 → 用它的 标的段单价×面积 + 其他费项 算。**

- 每个价格时段（续签换约、或同一份合同**三年一递增**）都落成**链里一份完整合同**，各自带：租期起止 + 完整标的段与费用（厂房/办公室/宿舍/商铺租金单价、面积、系数、间数、管理费/基础设施/电梯/变压器/门禁/网络/税/其他）。
- 链接类型 `link_type`：`new`(首份) | `renew`(续签换约) | `escalation`(同约递增段)。**仅供卡片显示与法务留痕；账单派生一视同仁**。（`link_type` 字段在 **Phase B** 落库，Phase A 不引入。）
- **阶梯语义全部由链表达** → 取消 `contract_rent_tier` 概念（表数据在 Phase B 消化后删）。
- 唯一价格事实源 = **标的段与费用**（billing lines）；不再有独立阶梯单价，联动问题消失。

---

## 2. 分期（A 先 · B 后）

| | Phase A（本轮） | Phase B（下一轮，独立 spec） |
|---|---|---|
| 内容 | ① master-detail 整页布局 ② 详情卡重排（标的段抬显、加「月租金合计(标准)」、**删阶梯块 UI**） ③ **回填 14 份空续签**（父合同标的段 × 阶梯次段价）④ 阶梯表数据暂留（不展示） | BILL-FORWARD 2+4 刀：按覆盖月的合同派生账单（单价×面积+费项，跨期 proration），落 `bill_notice`，接入 /bills；**把「合同内递增段」拆成链**（`link_type=escalation`）；落 `link_type`；消化并删 `contract_rent_tier` 表 |
| 解决 | ①布局 ②空续签 ③删阶梯 | ④账单派生 |
| 风险 | 中（换壳级 + 一次性数据回填） | 高（动账单核心数据源，须独立 spec + 谨慎拆分递增段） |

依赖：B 依赖 A（先有完整合同才能派生）。

---

## 3. Phase A 详细设计

### 3.1 master-detail 整页布局（覆盖「居中模态」）

```
┌ KPI 条（执行中/即将到期/草稿/月租金合计，横向收窄，可折叠）──────────┐
├ 左：合同列表（现有 FPSortableTable，收窄列）─┬ 右：整页详情面板 ─────────┤
│  选中行高亮                                  │ [工具条:合同号·状态·编辑 续签 终止 删除] │
│                                              │ 详情内容（整页高度）               │
└──────────────────────────────────────────────┴────────────────────────────────┘
```

- 点行 = **设选中 + 高亮**（不再开模态）；`ContractsView` 的 `@rowClick` 从「开 drawer」改为「设 `selectedContract`」。
- 右侧未选合同时显占位（图标 + 「从左侧选择一份合同」）。
- 操作条（终止/删除/编辑/续签）从模态 footer **移到右侧面板顶部工具条**。
- `ContractNewDialog`（新增/编辑/续签）仍以**模态叠加**在 master-detail 之上（z-index 已够，`320>300`）。
- 改动面：`ContractsView.vue`（template + 栅格）、`ContractDrawer.vue`（外层 `FPDrawer` 换普通右面板容器，内部 6 段渲染 1:1 保留）、局部布局 CSS（不污染其它两屏，新增 `.mx-md-*` 或局部覆盖）。**表格/API/`ContractNewDialog`/数据流（`chainOf`/`onEdited`/`onRenewed`…）不动。**

### 3.2 右侧详情卡片重排（参考成熟 lease abstract）

自上而下：

1. **工具条**：合同号 + 状态徽标 + [编辑][续签][终止][删除][关闭]
2. **租户 + 续签链 chips**（`FPContractChain`，保留；1,2,3 可点跳转，各显各的完整数据）
3. **合同信息**：楼栋/房号 · 建筑面积 · 租赁面积 · 空地面积 · 租期起止 · 押金 · 用电分类 · 签约日期 · 免租期 · 租期(月)
4. **标的段与费用**（**抬到显眼位**，这就是「所有签约收款条目」）：每段 = 类型徽标 + 位置 + 段面积；段内钉死费用行（费项名 · 面积 · 单价 · 系数 · 间数 · 月单价只读派生）
5. **合同月租金合计(标准)**（🆕 用户点名要）：= Σ 各计费行 `lineMonthly`。**标注「标准/参考，非账单实收」**（账单含免租/proration，属账单管理）。
6. **合同生命周期** timeline（保留，各期状态互不污染，沿 V2-SPEC §4.2）
7. **备注**（原「原始留档」折叠块保留：期限原文/分年阶梯价原文）

**删除**：`FPRentTierBar` 租金阶梯块（`ContractDrawer.vue:13` import、`:232-236` 渲染）。删后单价唯一来源 = 标的段与费用。

### 3.3 回填 14 份空续签（一次性数据脚本，非迁移）

对每份「续签合同标的段为空」且「父合同有阶梯次段」的合同（DB 实测 14 份全满足）：

1. **复制父合同全部 billing lines**（propertyType/location/feeKey/area/coeff/roomCount/billMode/amountOverride/seq/feeName）到该续签合同。
2. **套用次段涨价**：从父合同阶梯取「首段合计 s1」「次段合计 s2」：
   - 若次段有明确 rent 单价 → 该段 rent 行 `unitPrice` 直接用之；
   - 否则比例缩放：`ratio = s2/s1`，把复制来的 `per_sqm_month` 行（rent/mgmt/infra）`unitPrice ×= ratio`，`per_month` 固定费（电梯/变压器/税/other）保持不变。
3. **重算标量缓存**：该续签合同 `rentArea/buildingArea/unitPrice/五费项` 由 `syncScalarCache` 从新 billing lines 反向同步。
4. **人工复核清单**：首段/次段无法干净识别、或 ratio 异常（<1 或 >3）的，**不猜**，进「待核对」清单交人工。

回填后：14 份续签各有完整 billing lines（`rentArea>0`，标的段非空），续签链切第2份显示完整。

### 3.4 阶梯表数据去留

- **卡上阶梯块 UI：删**（§3.2）。
- **后端 `contract_rent_tier` 表数据：暂留不删**——Phase B 拆「合同内递增段」要用它当排程源；消化后（Phase B）再落 `DROP TABLE`。Phase A 里它只是不再被任何 UI 引用（`FPRentTierBar`/`rentTier.ts` 及其读出可删，表和 DTO 暂留）。

---

## 4. Phase B 提纲（下一轮独立 spec，非本轮目标）

- **账单派生引擎**：对 租户×月，选覆盖该月的合同（`start≤月≤end`），按 billing lines `单价×面积×系数 / 按间 / 直填` 算各费项 → 落 `bill_notice`（户×月×费项快照）；跨合同月/入住退租月按天 proration（日额=月额÷当月天数）。
- **接入 /bills**：派生应收与附表10 并列，账单条标来源徽标；附表10 从「唯一事实源」降为「勾稽对手方」。
- **拆「合同内递增段」成链**：用 `contract_rent_tier` 数据把多档单合同拆成 `link_type=escalation` 的链段（人工复核，账单派生结果做验证），落 `link_type`，拆完 `DROP TABLE contract_rent_tier`。
- 草稿/定稿状态机、三方勾稽：沿 `BILL-FORWARD-SPEC` §2/§4/§5。

---

## 5. 数据模型（Phase A）

- **无 schema 变更**：Phase A 只做一次性数据回填（14 续签的 billing lines）+ 前端布局/组件调整。
- `link_type`、`bill_notice`、`DROP contract_rent_tier` 全部属 Phase B。
- 回填走既有写路径语义：新 billing lines `source='manual'`（人工补录性质），经 `syncScalarCache` 同步标量。

---

## 6. 锚点验收（Phase A）

| # | 项 | 期望 |
|---|---|---|
| ① | 布局 | 合同管理为左列表+右整页详情；点行右侧展开，不弹居中模态 |
| ② | 采妍 S10-0104 → C2024M-009 | 切到第2份 chip（续签）显示**完整**标的段与费用 + 面积 + 月租金合计，不再空白 |
| ③ | 月租金合计 | 详情显示「合同月租金合计(标准)」= 各计费行月单价之和，标注参考/非实收 |
| ④ | 删阶梯 | 卡片无「租金阶梯」块；单价只出现在标的段与费用；typecheck 绿 |
| ⑤ | 14 份续签 | 全部 `rentArea>0` 且标的段非空；比例缩放后月合计 ≈ 阶梯次段合计（±1%） |
| ⑥ | 待核对 | 无法干净回填的续签进清单，不乱填 |

---

## 7. 测试

- 前端：master-detail 选中/切换/占位渲染；删阶梯块后 `ContractDrawer` 无残留引用；`npm run typecheck` + `npm run test` 绿。
- 后端：回填脚本产出的 billing lines 经 detail 端点带出，`rentArea` 反向同步正确（沿 `syncScalarCache`）；现有合同 IT 不回归。
- 回填校验：14 份逐份断言 `billingLines 非空`、`月合计 ≈ 次段合计`。

---

## 8. 非目标（Phase A 不做）

- 账单按合同派生 / `bill_notice` / 接入 /bills（**Phase B**）。
- 拆「合同内递增段」成链、落 `link_type`、删 `contract_rent_tier` 表（**Phase B**）。
- 9 户「demo3 无对应合同」的阶梯（[[demo3_contract_card_v2]] 待核对项）——不在本轮。
