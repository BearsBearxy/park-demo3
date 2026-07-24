# 合同卡二次重设计规范（CONTRACT-CARD-V2-SPEC）

> 2026-07-25 用户拍板。本规范**增补并覆盖** `CONTRACT-CARD-SPEC` 的 §5.3（续签链）与 §6.1（合同卡结构），
> 其余章节（§1 钉死费用组、§2 铁律、§6.2 单一编辑、§7 契约）继续有效。
> 代码注释引用本规范请写 `CONTRACT-CARD-V2-SPEC §x.y`。

---

## 0. 为什么再改（用户原话 → 根因）

| 用户原话 | 根因（不是随手做的） |
|---|---|
| 「分年阶梯价做成这么一大坨」 | `V55__contract_term_text.sql` 把它存成 `VARCHAR(500)` 且注释写明「原样存原样显」。**文本进文本出，无结构 ⇒ 无法可视化**。 |
| 「为什么没有可视化」 | 同上。阶梯期从未被建模成数据，只有一句话。 |
| 「完全不能编辑」 | **后端 `ContractCreateReq` 早已接收** `termText/termType/tierPriceNote`（见 `ContractCreateReq.java`），但前端同名 interface 与 `ContractNewDialog` 从未加这三个字段。纯前端漏口子。 |
| 「和后续续签的合同没有联动 / 没显示前后合同」 | `chain.ts` **只有 `ancestorsOf()`（沿 `parentContractId` 上溯），没有找后代的函数**。卡片「续签历史」只渲染祖先、只读、不可点；首份合同祖先为空 ⇒ 整段隐藏 ⇒ 什么都看不到。 |
| 「期限原文应该是备注」 | 原设计把它钉死在合同信息区当常驻字段。 |

**关键洞察**：`期限原文`（多段）与 `分年阶梯价`（多段）是**同一份数据的两种文字写法**，本质是「租金阶梯期」`{起, 止, 单价, 月额}` 列表。

---

## 1. 运行模型裁定（2026-07-25，唯一事实源）

> **阶梯价按人工更新合同，催缴单按合同派生。**

- 阶梯期表是**参考/排程数据**：告诉运营「这份合同什么时候该换档、换成多少」。
- **实际计费口径不变**：催缴单仍按合同上的**现行**五费项单价（`unitPrice/mgmtFeePrice/infraFeePrice/...`）派生。
- 换档时**由人工编辑合同**把现行单价改成新档 → 催缴单自然跟着变。
- ⇒ 本轮**不动 BILL-FORWARD 那条链**，阶梯表不参与任何计费计算。

---

## 2. 数据模型（迁移 `V56__contract_rent_tier.sql`）

```sql
CREATE TABLE contract_rent_tier (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  contract_id    INT NOT NULL,
  fee_key        VARCHAR(24)   NULL,  -- 空=整份合同(合计口径);非空=该费项阶梯(rent_factory/mgmt/infra…)
  seq            INT NOT NULL,        -- 段序 1,2,3…
  label          VARCHAR(64)   NULL,  -- 原文标签「首年」「第四年至第六年」
  start_date     DATE          NULL,  -- 相对期限时为空
  end_date       DATE          NULL,
  unit_price     DECIMAL(10,4) NULL,  -- 元/㎡·月
  monthly_amount DECIMAL(12,2) NULL,  -- 月额
  note           VARCHAR(255)  NULL,
  CONSTRAINT fk_tier_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE,
  UNIQUE KEY uk_tier (contract_id, fee_key, seq)
);
```

三个刻意设计（改前先读）：

1. **`fee_key` 可空** — 周兴那种只有厂房租金分档 ⇒ 一组 `fee_key=NULL`（合计口径）；力灏那种「厂房租金 / 企管费 / 基础设施维护费」各自分档 ⇒ 按费项各一组。
2. **`start_date`/`end_date` 可空** — 撑住力灏、罗立剑那类「自竣工验收次日起计九年」的**相对期限**，此时靠 `label` 表达，且**不做当前段判定**（§5.2）。
3. **`term_text` / `tier_price_note` 保留不删** — 白纸黑字原文是审计凭据。只**降级**：从常驻字段移入折叠的「原始留档」区（§3）。`term_type` 保留，驱动渲染分支。

---

## 3. 合同卡结构（**覆盖 CONTRACT-CARD-SPEC §6.1**）

自上而下：

| # | 区块 | 说明 |
|---|---|---|
| 1 | 租户卡 | 不变 |
| 2 | **合同链条** 🆕 | 横向 chip：`1 · 2 · 3`，当前期高亮，其余**可点跳转**；chip 主号用**阿拉伯数字期号**（用户拍板：用 1,2,3，非 ①②③），副行小字 = 合同号 + 起止。**链只有 1 期时整条不渲染**。 |
| 3 | 合同信息 | **瘦身**：删除 `期限原文`、`分年阶梯价` 两行（移至第 7 块） |
| 4 | **租金阶梯** 🆕 | 替代那一坨：分段时间轴（按段着色 + 当前段高亮 + 今天竖线）+ 小表（段/起止/单价/月额），当前段加粗。**无阶梯（≤1 段）时整块不渲染** |
| 5 | 合同生命周期 | 保留，但**状态只讲自己**（§4.2） |
| 6 | 标的段与费用 | 不变（沿 §6.1 原规则） |
| 7 | **原始留档** 🆕 | 折叠，**默认收起**：`期限原文`、`分年阶梯价` 原文照登 |
| 8 | 备注 | 不变 |

---

## 4. 续签链（**覆盖 CONTRACT-CARD-SPEC §5.3**）

### 4.1 全链导航（用户拍板）

- `chain.ts` 增两个纯函数：
  - `descendantsOf(list, id)` — 沿 `parentContractId` **向下**找后代（远→近）。
  - `chainOf(list, id)` — 返回**整条链**（祖先 + 自身 + 后代），按时间序，附 `seq`（期号 1,2,3…）。
- **旧合同也能看到后续期**，chip 可双向跳转；旧合同上标注「已由 HT-xxx 续签」。
  - 依据：运营查历史合同时需要一键跳到现行合同，严格时序会把人憋死；审计追溯也要求看得见全链。
- `ponytail:` 链仍在**前端本地算**（列表已全量），**不新增 `/chain` 端点**（沿用 §5.3 既有约定）。
- 点 chip ⇒ **同一抽屉换内容**，不新开窗。

### 4.2 时序正确性（各期状态互不污染）

用户顾虑「前一份合同不该知道后续合同的签订信息」，裁定为：

- **导航可见全链**（上条），但**每期自己的生命周期/状态只描述自己**。
- 具体：已到期/已续签的合同**不得**再显示「剩余 N 天 · 建议尽快续签」这类**面向未来的行动号召**——它只属于现行期。
- `ctTimeline()` 已按 `status` 分支（`renewed` ⇒「已续签 · 被新一期取代」），本条即把该原则写死为规范，**新增区块不得违反**。

---

## 5. 租金阶梯渲染规则

### 5.1 分组

按 `fee_key` 分组：全为 `NULL` ⇒ 单轨（合计口径）；有非空 ⇒ 按费项分组，每组一条轨。段边界通常各费项一致，时间轴取并集。

### 5.2 当前段判定

- 当且仅当 `start_date`/`end_date` 均非空时判定：`start_date <= today <= end_date` ⇒ 当前段。
- **边界日闭区间**（含首尾当天）。
- **相对期限（日期为空）不判定当前段**，只按 `label` 顺序列出，时间轴退化为等分示意并标注「具体日期以交付后书面确定」。

### 5.3 换档告警（**可砍，标记 `ponytail:`**）

既然运行模型是「人工换档」（§1），唯一漏点就是**人忘了改**。故：

- 当**当前段**的 `unit_price` 与合同现行 `unitPrice` 不一致（差值 > 0.001）时，阶梯块顶部显示一条橙色提示：
  「今天已进入第 N 档（X 元/㎡·月），但合同现行单价为 Y 元/㎡·月，请更新合同」。
- 纯前端比对，**不自动改数**（改数必须人工，§1）。
- 若认为多余可整条删除，不影响其余功能。

---

## 6. 可编辑（补前端漏的口子）

- 前端 `ContractCreateReq` interface **补** `termText` / `termType` / `tierPriceNote`（后端已支持，只是没传）。
- `ContractNewDialog` 合同信息区**补**这三个输入（`termType` 为下拉 `explicit|multiple|relative|none`）。
- **阶梯段增删改**：随合同 PUT **整组替换**，与 `billingLines` 完全同构（沿 §6.2 单一编辑模式，**不做独立「编辑阶梯」按钮**）。

---

## 7. DTO / API 契约（增补 §7）

```ts
// 读
export interface RentTierDTO {
  id: number; contractId: number
  feeKey?: FeeKey | null; seq: number; label?: string | null
  startDate?: string | null; endDate?: string | null
  unitPrice?: number | null; monthlyAmount?: number | null; note?: string | null
}
export interface ContractDetailDTO {
  contract: ContractDTO
  tenant: { /* 不变 */ }
  billingLines: BillingLineDTO[]
  rentTiers: RentTierDTO[]        // 🆕 后端按 fee_key, seq 排序
}
// 写(内嵌 ContractCreateReq,整组替换;null=不动,空列表=清空)
export interface RentTierReq {
  id?: number | null; feeKey?: FeeKey | null; seq?: number | null; label?: string | null
  startDate?: string | null; endDate?: string | null
  unitPrice?: number | null; monthlyAmount?: number | null; note?: string | null
}
```

端点无新增：`GET /api/contracts/{id}` 多带 `rentTiers`；`PUT /api/contracts/{id}` 多收 `rentTiers`。

---

## 8. 组件拆分

`ContractDrawer.vue` 现 382 行，加三个区块会失控，故抽出：

- `FPContractChain.vue` — 链 chip 条（props `chain: {c, seq}[]`, `currentId`；emit `jump`）
- `FPRentTierBar.vue` — 阶梯时间轴 + 小表（props `tiers`, `today`, `contractUnitPrice`；含 §5.3 告警）
- `chain.ts` — 增 `descendantsOf` / `chainOf`

---

## 9. 回填（用户拍板：回源合同图片重提）

- 复用已验证的 workflow（137 户合同附图），**schema 改为强制输出** `tiers: [{label, start, end, unitPrice, monthly, feeKey}]`。
- 回到原始合同表格取数（如力灏「首年至第三年 / 第四年至第六年」那种表），比二次解析机器散文准，且能顺手修正上轮误差。
- 落 `contract_rent_tier`，按合同号/租户匹配；**匹配不上的进「待核对」清单**交人工，不猜。

---

## 10. 锚点验收

| # | 项 | 期望 |
|---|---|---|
| ① | 周兴 S10-0074 | 阶梯块显示 2 段；当前段（2024-08-10~2026-08-09，14.282 元/㎡·月，5570 元/月）高亮 |
| ② | 力灏（相对期限） | 阶梯按 `label` 列出，不判定当前段，标注「具体日期以交付后书面确定」 |
| ③ | 单期合同 | 合同链条整条不渲染 |
| ④ | 已续签的旧合同 | 链上可点到现行期；自身生命周期显「已续签」，**不显示**「建议尽快续签」 |
| ⑤ | 编辑 | 期限原文/类型/阶梯价可改可存；阶梯段可增删，PUT 后整组替换生效 |
| ⑥ | 无阶梯合同 | 阶梯块不渲染，卡片不留空洞 |

---

## 11. 测试

- `chain.spec.ts`：`descendantsOf` / `chainOf` — 含**环**、**悬空 parentId**、**分叉**（一份被续签两次 ⇒ 取最新并告警）。
- `rentTier.spec.ts`：当前段判定 — 边界日（起当天/止当天）、无日期（相对期限）不判定、多 `fee_key` 分组。
- 渲染分支：单段不渲染、单期不渲染链、已到期不出现续签号召。

---

## 12. 非目标（本轮不做）

- **阶梯价接入实际计费**（§1 裁定：人工换档，催缴单按合同派生）。BILL-FORWARD 链**一行不动**。
- 合同链**分叉**的完整 UI（现实不存在；`chainOf` 取最新一条并 `console.warn`）。
- 阶梯价自动换档提醒的**推送/待办**（本轮只在卡片内提示，§5.3）。
