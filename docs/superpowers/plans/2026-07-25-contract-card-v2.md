# 合同卡二次重设计 实施计划（CONTRACT-CARD-V2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把合同卡的「分年阶梯价一大坨」变成结构化可视化＋可编辑，并让续签链前后合同可导航跳转。

**Architecture:** 新增 `contract_rent_tier` 表存阶梯期（参考排程，不参与计费）；后端沿用 `billingLines` 的「详情带出 + PUT 整组替换」同构模式；前端把 `ContractDrawer.vue` 里新增的三块抽成 `FPContractChain.vue` / `FPRentTierBar.vue` 两个组件 + `rentTier.ts` 纯函数，链聚合仍在前端本地算（不新增端点）。

**Tech Stack:** Spring Boot 3 + MyBatis-Plus + Flyway（后端）；Vue 3 `<script setup>` + TS + Vitest（前端）。

## Global Constraints

- 规范源：`docs/design/CONTRACT-CARD-V2-SPEC.md`；代码注释引用写 `CONTRACT-CARD-V2-SPEC §x.y`。
- **阶梯表不参与任何计费**（§1）。催缴单仍按合同现行单价派生，BILL-FORWARD 链一行不动。
- 迁移号 **V56**（V55 是当前最高）。
- 前端类型检查**必须** `npm run typecheck`（裸跑 `vue-tsc --noEmit` 是无效检查，曾漏报）。
- 前端测试 `npm run test`（vitest run）；后端 `mvn -q test`。
- 可空语义：MyBatis-Plus 默认忽略 null，凡「清空须落库」的列必须 `@TableField(updateStrategy = FieldStrategy.ALWAYS)`（V33 踩过）。
- 新组件放 `frontend/src/views/contracts/`（与 `FPContractTimeline.vue` 同级），纯函数放同目录 `.ts`，测试同目录 `.spec.ts`。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `backend/.../db/migration/V56__contract_rent_tier.sql` | 建表 |
| `backend/.../entity/ContractRentTier.java` | 实体 |
| `backend/.../mapper/ContractRentTierMapper.java` | Mapper |
| `backend/.../dto/RentTierDTO.java` / `RentTierReq.java` | 读/写 DTO |
| `backend/.../dto/ContractDetailDTO.java` | 增 `rentTiers` |
| `backend/.../dto/ContractCreateReq.java` | 增 `rentTiers` |
| `backend/.../service/ContractService.java` | `loadTiers` / `replaceTiersFromReq` + 接线 |
| `frontend/src/types/contract.ts` | `RentTierDTO/Req`；`ContractCreateReq` 补 4 字段 |
| `frontend/src/views/contracts/chain.ts` | 增 `descendantsOf` / `chainOf` |
| `frontend/src/views/contracts/rentTier.ts` | 当前段判定 / 分组（纯函数） |
| `frontend/src/views/contracts/FPContractChain.vue` | 链 chip 条 |
| `frontend/src/views/contracts/FPRentTierBar.vue` | 阶梯时间轴＋小表 |
| `frontend/src/views/contracts/ContractDrawer.vue` | 接线三块＋原文降级 |
| `frontend/src/views/contracts/ContractsView.vue` | 传整条链＋处理跳转 |
| `frontend/src/views/contracts/ContractNewDialog.vue` | 补可编辑字段＋阶梯段增删 |

**并行安全性**：Task 1-2（后端）与 Task 3-5（前端新文件）互不碰文件，可并行。**Task 6/7/8 都改 `ContractDrawer.vue`/`ContractsView.vue`/`ContractNewDialog.vue`，必须串行且由同一执行者做完**。

---

## Task 1: 后端建表 + 实体 + Mapper

**Files:**
- Create: `backend/src/main/resources/db/migration/V56__contract_rent_tier.sql`
- Create: `backend/src/main/java/com/park/demo3/entity/ContractRentTier.java`
- Create: `backend/src/main/java/com/park/demo3/mapper/ContractRentTierMapper.java`

**Interfaces:**
- Produces: 表 `contract_rent_tier`；实体 `ContractRentTier`（字段见下）；`ContractRentTierMapper extends BaseMapper<ContractRentTier>`。

- [ ] **Step 1: 建迁移**

`V56__contract_rent_tier.sql`：

```sql
-- V56__contract_rent_tier.sql — 租金阶梯期(CONTRACT-CARD-V2-SPEC §2)。
-- 运行模型(§1):阶梯表=参考排程,人工据此换档改合同现行单价;催缴单仍按合同派生,本表不参与计费。
--   fee_key 空=整份合同合计口径;非空=该费项阶梯(力灏式各费项各自分档)
--   start/end 可空=相对期限(如「竣工验收次日起计九年」),此时靠 label 表达且不判定当前段
CREATE TABLE contract_rent_tier (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  contract_id    INT NOT NULL,
  fee_key        VARCHAR(24)   NULL,
  seq            INT NOT NULL,
  label          VARCHAR(64)   NULL,
  start_date     DATE          NULL,
  end_date       DATE          NULL,
  unit_price     DECIMAL(10,4) NULL,
  monthly_amount DECIMAL(12,2) NULL,
  note           VARCHAR(255)  NULL,
  CONSTRAINT fk_tier_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE,
  UNIQUE KEY uk_tier (contract_id, fee_key, seq)
) COMMENT='合同租金阶梯期(参考排程,不参与计费)';
```

- [ ] **Step 2: 建实体**

`ContractRentTier.java`：

```java
package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDate;
/** 租金阶梯期(CONTRACT-CARD-V2-SPEC §2)。参考排程,不参与计费(§1)。 */
@Data @TableName("contract_rent_tier")
public class ContractRentTier {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer contractId;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String feeKey;   // 空=整份合同合计口径
    private Integer seq;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String label;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private LocalDate startDate;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private LocalDate endDate;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal unitPrice;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private BigDecimal monthlyAmount;
    @TableField(updateStrategy = FieldStrategy.ALWAYS) private String note;
}
```

- [ ] **Step 3: 建 Mapper**

```java
package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.ContractRentTier;
import org.apache.ibatis.annotations.Mapper;
@Mapper public interface ContractRentTierMapper extends BaseMapper<ContractRentTier> {}
```

- [ ] **Step 4: 跑起来验证迁移可用**

Run: `cd backend && mvn -q test -Dtest=ContractApiIT`
Expected: PASS（Flyway 应用 V56 无报错）。若无 `ContractApiIT`，改跑 `mvn -q test` 全量，期望 BUILD SUCCESS。

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/resources/db/migration/V56__contract_rent_tier.sql \
        backend/src/main/java/com/park/demo3/entity/ContractRentTier.java \
        backend/src/main/java/com/park/demo3/mapper/ContractRentTierMapper.java
git commit -m "feat(contract): V56 租金阶梯期表+实体+Mapper (CONTRACT-CARD-V2-SPEC §2)"
```

---

## Task 2: 后端 DTO + 详情带出 + PUT 整组替换

**Files:**
- Create: `backend/src/main/java/com/park/demo3/dto/RentTierDTO.java`
- Create: `backend/src/main/java/com/park/demo3/dto/RentTierReq.java`
- Modify: `backend/src/main/java/com/park/demo3/dto/ContractDetailDTO.java`
- Modify: `backend/src/main/java/com/park/demo3/dto/ContractCreateReq.java`（末尾追加字段）
- Modify: `backend/src/main/java/com/park/demo3/service/ContractService.java`（`detail` 第 108 行附近；`create` ~126；`update` ~153）
- Test: `backend/src/test/java/com/park/demo3/api/ContractRentTierApiIT.java`

**Interfaces:**
- Consumes: Task 1 的 `ContractRentTier` / `ContractRentTierMapper`。
- Produces: `GET /api/contracts/{id}` 响应含 `rentTiers: RentTierDTO[]`；`PUT /api/contracts/{id}` 接收 `rentTiers: RentTierReq[]`（null=不动，空列表=清空）。

- [ ] **Step 1: 写失败的 IT**

`ContractRentTierApiIT.java`。**基类固定为 `com.park.demo3.AbstractMysqlIT`**（照抄 `BillsApiIT` 的注解组合：`@AutoConfigureMockMvc` + `@Transactional` + `@Autowired MockMvc mvc`）。遵守**共享容器 2099 槽约定，禁顺序依赖断言**（自己建自己的数据，不依赖别的测试留下的行）：

```java
package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 阶梯期读写(CONTRACT-CARD-V2-SPEC §7)。 */
@AutoConfigureMockMvc
@Transactional
class ContractRentTierApiIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;

    @Test void 详情带出阶梯期且PUT整组替换() throws Exception {
        int cid = createContractWithTiers();      // helper: 建合同并带 2 段阶梯

        // 详情带出 2 段，按 seq 升序
        mvc.perform(get("/api/contracts/" + cid))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.rentTiers", hasSize(2)))
           .andExpect(jsonPath("$.rentTiers[0].seq", is(1)))
           .andExpect(jsonPath("$.rentTiers[0].unitPrice", is(12.2310)))
           .andExpect(jsonPath("$.rentTiers[1].seq", is(2)));

        // PUT 传 1 段 → 整组替换为 1 段
        mvc.perform(put("/api/contracts/" + cid).contentType("application/json")
               .content(putBodyWithTiers(cid, 1)))
           .andExpect(status().isOk());
        mvc.perform(get("/api/contracts/" + cid))
           .andExpect(jsonPath("$.rentTiers", hasSize(1)));

        // PUT 传空列表 → 清空
        mvc.perform(put("/api/contracts/" + cid).contentType("application/json")
               .content(putBodyWithTiers(cid, 0)))
           .andExpect(status().isOk());
        mvc.perform(get("/api/contracts/" + cid))
           .andExpect(jsonPath("$.rentTiers", hasSize(0)));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && mvn -q test -Dtest=ContractRentTierApiIT`
Expected: FAIL（`rentTiers` 字段不存在 / 编译不过）。

- [ ] **Step 3: 建两个 DTO**

```java
// RentTierDTO.java
package com.park.demo3.dto;
import java.math.BigDecimal;
/** 租金阶梯期读 DTO(CONTRACT-CARD-V2-SPEC §7)。 */
public record RentTierDTO(
    Integer id, Integer contractId, String feeKey, Integer seq, String label,
    String startDate, String endDate,          // ISO yyyy-MM-dd,可空(相对期限)
    BigDecimal unitPrice, BigDecimal monthlyAmount, String note
) {}
```

```java
// RentTierReq.java
package com.park.demo3.dto;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
/** 租金阶梯期写 Req(内嵌 ContractCreateReq,整组替换)。 */
public record RentTierReq(
    Integer id, @Size(max = 24) String feeKey, Integer seq, @Size(max = 64) String label,
    String startDate, String endDate,
    BigDecimal unitPrice, BigDecimal monthlyAmount, @Size(max = 255) String note
) {}
```

- [ ] **Step 4: 两个容器 record 加字段**

`ContractDetailDTO.java` — 在 `billingLines` 后追加一个组件：

```java
public record ContractDetailDTO(
    ContractDTO contract,
    TenantSnap  tenant,
    List<BillingLineDTO> billingLines,   // 按 location, seq 排序(刀1 §1.7)
    List<RentTierDTO> rentTiers          // 阶梯期,按 fee_key, seq 排序(V2-SPEC §7)
) {
```

`ContractCreateReq.java` — 在末尾 `tierPriceNote` 之后追加（注意补逗号）：

```java
    @Size(max = 500) String tierPriceNote,
    java.util.List<RentTierReq> rentTiers   // null=不动;空列表=清空(与 billingLines 同构)
```

- [ ] **Step 5: Service 接线**

`ContractService.java` 注入 Mapper（在既有 `terms` 字段旁）：

```java
private final ContractRentTierMapper tiers;
```
并在构造器参数与赋值处补 `tiers`（照抄 `terms` 的写法）。

新增两个私有方法（放在 `loadLines` 附近）：

```java
/** 阶梯期读出(按 fee_key, seq 排序,§7)。 */
private List<RentTierDTO> loadTiers(Integer contractId) {
    return tiers.selectList(new QueryWrapper<ContractRentTier>()
            .eq("contract_id", contractId).orderByAsc("fee_key", "seq", "id")).stream()
        .map(t -> new RentTierDTO(t.getId(), t.getContractId(), t.getFeeKey(), t.getSeq(), t.getLabel(),
            t.getStartDate() == null ? null : t.getStartDate().toString(),
            t.getEndDate()   == null ? null : t.getEndDate().toString(),
            t.getUnitPrice(), t.getMonthlyAmount(), t.getNote()))
        .toList();
}

/** 阶梯期整组替换(单一编辑 PUT):删旧全组、插新组。seq 缺省按下标补。 */
private void replaceTiersFromReq(Integer contractId, List<RentTierReq> list) {
    tiers.delete(new QueryWrapper<ContractRentTier>().eq("contract_id", contractId));
    int idx = 1;
    for (RentTierReq r : list) {
        ContractRentTier t = new ContractRentTier();
        t.setContractId(contractId);
        t.setFeeKey(blankToNull(r.feeKey()));
        t.setSeq(r.seq() != null ? r.seq() : idx);
        t.setLabel(blankToNull(r.label()));
        t.setStartDate(parseDateOrNull(r.startDate()));
        t.setEndDate(parseDateOrNull(r.endDate()));
        t.setUnitPrice(r.unitPrice());
        t.setMonthlyAmount(r.monthlyAmount());
        t.setNote(blankToNull(r.note()));
        tiers.insert(t);
        idx++;
    }
}
```

若仓内没有 `parseDateOrNull`，加一个私有静态方法：

```java
private static java.time.LocalDate parseDateOrNull(String s) {
    return (s == null || s.isBlank()) ? null : java.time.LocalDate.parse(s);
}
```

接线三处：
1. `detail(...)` 末行改为 `return new ContractDetailDTO(dto, snap, loadLines(id), loadTiers(id));`
2. `create(...)` 在 `if (req.billingLines() != null) {...}` 之后加：
   `if (req.rentTiers() != null) replaceTiersFromReq(c.getId(), req.rentTiers());`
3. `update(...)` 在对应 billingLines 分支之后加：
   `if (req.rentTiers() != null) replaceTiersFromReq(id, req.rentTiers());`

- [ ] **Step 6: 跑测试确认通过**

Run: `cd backend && mvn -q test -Dtest=ContractRentTierApiIT`
Expected: PASS。再跑全量 `mvn -q test`，期望 BUILD SUCCESS（`ContractDetailDTO` 增字段可能触碰既有 IT 的构造调用，一并修）。

- [ ] **Step 7: Commit**

```bash
git add backend/src/main/java/com/park/demo3/dto backend/src/main/java/com/park/demo3/service/ContractService.java backend/src/test/java/com/park/demo3/api/ContractRentTierApiIT.java
git commit -m "feat(contract): 阶梯期 DTO+详情带出+PUT 整组替换 (V2-SPEC §7)"
```

---

## Task 3: 前端类型 + chain.ts 增 descendantsOf/chainOf

**Files:**
- Modify: `frontend/src/types/contract.ts`
- Modify: `frontend/src/views/contracts/chain.ts`
- Test: `frontend/src/views/contracts/contractCard.spec.ts`（在既有「续签链聚合」describe 内追加）

**Interfaces:**
- Produces:
  - `RentTierDTO { id, contractId, feeKey?, seq, label?, startDate?, endDate?, unitPrice?, monthlyAmount?, note? }`
  - `RentTierReq`（同字段，`id?` 可空）
  - `ContractDetailDTO.rentTiers: RentTierDTO[]`
  - `ContractCreateReq` 增 `termText? / termType? / tierPriceNote? / rentTiers?`
  - `descendantsOf(list, id): ContractDTO[]`（远→近，不含自身）
  - `chainOf(list, id): { c: ContractDTO; seq: number }[]`（整条链，按期序，`seq` 从 1 起）

- [ ] **Step 1: 写失败的测试**

在 `contractCard.spec.ts` 的 `describe('续签链聚合(§5.3)', ...)` 内追加（`c`/`list` 沿用该 describe 已有定义）：

```ts
  it('descendantsOf 沿 parent 向下找后代(远→近)', () => {
    expect(descendantsOf(list, 1).map(x => x.id)).toEqual([2, 3])
    expect(descendantsOf(list, 3)).toEqual([])
  })

  it('chainOf 返回整条链并标期号(1,2,3)', () => {
    expect(chainOf(list, 2).map(x => [x.seq, x.c.id])).toEqual([[1, 1], [2, 2], [3, 3]])
    expect(chainOf(list, 9).map(x => [x.seq, x.c.id])).toEqual([[1, 9]])
  })

  it('chainOf 遇环/悬空不死循环', () => {
    const bad = [c(1, 2), c(2, 1)]
    expect(chainOf(bad, 1).length).toBeLessThanOrEqual(2)
    expect(chainOf([c(5, 999)], 5).map(x => x.c.id)).toEqual([5])
  })

  it('chainOf 遇分叉取最新一条(id 大者)并告警', () => {
    const forked = [c(1, null), c(2, 1), c(3, 1)]   // 1 被续签两次
    const ids = chainOf(forked, 1).map(x => x.c.id)
    expect(ids).toEqual([1, 3])
  })
```

并把顶部 import 改为：

```ts
import { leafIds, ancestorsOf, descendantsOf, chainOf } from './chain'
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npm run test -- contractCard`
Expected: FAIL（`descendantsOf is not a function`）。

- [ ] **Step 3: 实现 chain.ts 两个函数**

在 `chain.ts` 末尾追加：

```ts
/** 沿 parentContractId 向下找后代(远→近,不含自身);分叉取 id 最大者并告警;环/悬空自动止步。 */
export function descendantsOf(list: ContractDTO[], id: number): ContractDTO[] {
  const childrenOf = new Map<number, ContractDTO[]>()
  for (const c of list) {
    if (c.parentContractId == null) continue
    const arr = childrenOf.get(c.parentContractId) ?? []
    arr.push(c); childrenOf.set(c.parentContractId, arr)
  }
  const out: ContractDTO[] = []
  const guard = new Set<number>([id])
  let cur = id
  for (;;) {
    const kids = childrenOf.get(cur)
    if (!kids || kids.length === 0) break
    if (kids.length > 1)
      console.warn(`[chain] 合同 ${cur} 存在 ${kids.length} 份续签分叉,取最新一条(V2-SPEC §12)`)
    const next = kids.reduce((a, b) => (b.id > a.id ? b : a))
    if (guard.has(next.id)) break
    guard.add(next.id); out.push(next); cur = next.id
  }
  return out
}

/** 整条续签链(祖先+自身+后代),按期序返回并标期号 seq(从 1 起,用户拍板用 1,2,3)。 */
export function chainOf(list: ContractDTO[], id: number): { c: ContractDTO; seq: number }[] {
  const self = list.find(x => x.id === id)
  if (!self) return []
  const ordered = [...ancestorsOf(list, id).slice().reverse(), self, ...descendantsOf(list, id)]
  return ordered.map((c, i) => ({ c, seq: i + 1 }))
}
```

- [ ] **Step 4: 类型补字段**

`types/contract.ts`：`ContractDetailDTO` 增 `rentTiers`；`ContractCreateReq` 末尾增 4 字段；并新增两个 interface：

```ts
// 租金阶梯期(CONTRACT-CARD-V2-SPEC §7):参考排程,不参与计费(§1)
export interface RentTierDTO {
  id: number; contractId: number
  feeKey?: FeeKey | null; seq: number; label?: string | null
  startDate?: string | null; endDate?: string | null     // 空=相对期限,不判定当前段
  unitPrice?: number | null; monthlyAmount?: number | null; note?: string | null
}
export interface RentTierReq {
  id?: number | null
  feeKey?: FeeKey | null; seq?: number | null; label?: string | null
  startDate?: string | null; endDate?: string | null
  unitPrice?: number | null; monthlyAmount?: number | null; note?: string | null
}
```

`ContractDetailDTO` 改为：

```ts
export interface ContractDetailDTO {
  contract: ContractDTO
  tenant: { companyName: string; contactName: string; contactPhone: string; businessType: string; status: number }
  billingLines: BillingLineDTO[]
  rentTiers: RentTierDTO[]         // 按 feeKey, seq 排序(V2-SPEC §7)
}
```

`ContractCreateReq` 末尾（`billingLines` 之后）追加：

```ts
  // V55 期限原文三件套:后端早已支持,前端此前漏传(V2-SPEC §6)
  termText?: string | null
  termType?: string | null         // explicit|multiple|relative|none
  tierPriceNote?: string | null
  rentTiers?: RentTierReq[] | null // null=不动,空列表=清空(与 billingLines 同构)
```

- [ ] **Step 5: 跑测试 + 型检**

Run: `cd frontend && npm run test -- contractCard && npm run typecheck`
Expected: 测试 PASS；typecheck 无错。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/contract.ts frontend/src/views/contracts/chain.ts frontend/src/views/contracts/contractCard.spec.ts
git commit -m "feat(contract): 前端阶梯期类型 + chainOf/descendantsOf 全链聚合 (V2-SPEC §4)"
```

---

## Task 4: rentTier.ts 纯函数（当前段判定 / 分组）

**Files:**
- Create: `frontend/src/views/contracts/rentTier.ts`
- Test: `frontend/src/views/contracts/rentTier.spec.ts`

**Interfaces:**
- Consumes: Task 3 的 `RentTierDTO`。
- Produces:
  - `groupTiers(tiers): { feeKey: string | null; rows: RentTierDTO[] }[]`（按 feeKey 分组，组内按 seq）
  - `currentTierIndex(rows, today): number`（返回组内下标，-1=无法判定）
  - `tierMismatch(rows, today, contractUnitPrice): { tier: RentTierDTO; expected: number; actual: number } | null`

- [ ] **Step 1: 写失败的测试**

`rentTier.spec.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { groupTiers, currentTierIndex, tierMismatch } from './rentTier'
import type { RentTierDTO } from '@/types/contract'

const t = (o: Partial<RentTierDTO>): RentTierDTO =>
  ({ id: 1, contractId: 1, seq: 1, ...o } as RentTierDTO)

// 锚点=周兴 S10-0074:2 段,第 2 段 2024-08-10~2026-08-09 单价 14.282
const zx = [
  t({ id: 1, seq: 1, startDate: '2023-08-10', endDate: '2024-08-09', unitPrice: 12.231, monthlyAmount: 4770 }),
  t({ id: 2, seq: 2, startDate: '2024-08-10', endDate: '2026-08-09', unitPrice: 14.282, monthlyAmount: 5570 }),
]

describe('当前段判定(V2-SPEC §5.2)', () => {
  it('今天落在第 2 段', () => {
    expect(currentTierIndex(zx, '2025-03-01')).toBe(1)
  })
  it('边界日闭区间:起当天/止当天都算', () => {
    expect(currentTierIndex(zx, '2023-08-10')).toBe(0)
    expect(currentTierIndex(zx, '2024-08-09')).toBe(0)
    expect(currentTierIndex(zx, '2024-08-10')).toBe(1)
    expect(currentTierIndex(zx, '2026-08-09')).toBe(1)
  })
  it('区间外返回 -1', () => {
    expect(currentTierIndex(zx, '2020-01-01')).toBe(-1)
    expect(currentTierIndex(zx, '2030-01-01')).toBe(-1)
  })
  it('相对期限(无日期)不判定', () => {
    const rel = [t({ seq: 1, label: '首年至第三年', unitPrice: 16.92 })]
    expect(currentTierIndex(rel, '2025-03-01')).toBe(-1)
  })
})

describe('分组(V2-SPEC §5.1)', () => {
  it('全 null feeKey ⇒ 单轨', () => {
    expect(groupTiers(zx)).toHaveLength(1)
    expect(groupTiers(zx)[0].feeKey).toBeNull()
  })
  it('多 feeKey ⇒ 按费项分组,组内按 seq', () => {
    const multi = [
      t({ id: 1, feeKey: 'rent_factory', seq: 2 }), t({ id: 2, feeKey: 'rent_factory', seq: 1 }),
      t({ id: 3, feeKey: 'mgmt', seq: 1 }),
    ]
    const g = groupTiers(multi)
    expect(g).toHaveLength(2)
    expect(g.find(x => x.feeKey === 'rent_factory')!.rows.map(r => r.seq)).toEqual([1, 2])
  })
})

describe('换档告警(V2-SPEC §5.3)', () => {
  it('当前段单价与合同现行单价不一致 ⇒ 报错档', () => {
    const m = tierMismatch(zx, '2025-03-01', 12.231)
    expect(m).not.toBeNull()
    expect(m!.expected).toBe(14.282)
    expect(m!.actual).toBe(12.231)
  })
  it('一致 ⇒ null', () => {
    expect(tierMismatch(zx, '2025-03-01', 14.282)).toBeNull()
  })
  it('无法判定当前段 ⇒ null', () => {
    expect(tierMismatch(zx, '2030-01-01', 1)).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npm run test -- rentTier`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 rentTier.ts**

```ts
import type { RentTierDTO } from '@/types/contract'

// 租金阶梯期纯函数(CONTRACT-CARD-V2-SPEC §5)。阶梯=参考排程,不参与计费(§1)。

/** 按 feeKey 分组(null 归一组),组内按 seq 升序。 */
export function groupTiers(tiers: RentTierDTO[]): { feeKey: string | null; rows: RentTierDTO[] }[] {
  const map = new Map<string, { feeKey: string | null; rows: RentTierDTO[] }>()
  for (const t of tiers) {
    const k = t.feeKey ?? ' '
    let g = map.get(k)
    if (!g) { g = { feeKey: t.feeKey ?? null, rows: [] }; map.set(k, g) }
    g.rows.push(t)
  }
  for (const g of map.values()) g.rows.sort((a, b) => a.seq - b.seq)
  return [...map.values()]
}

/** 当前段下标;仅当起止都非空时判定,闭区间。无法判定返回 -1(相对期限/区间外)。 */
export function currentTierIndex(rows: RentTierDTO[], today: string): number {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r.startDate || !r.endDate) continue
    if (r.startDate <= today && today <= r.endDate) return i
  }
  return -1
}

/** 换档告警(§5.3,可砍):当前段单价 ≠ 合同现行单价(差 > 0.001)时返回详情,否则 null。仅提示,不改数。 */
export function tierMismatch(
  rows: RentTierDTO[], today: string, contractUnitPrice: number | null | undefined,
): { tier: RentTierDTO; expected: number; actual: number } | null {
  const i = currentTierIndex(rows, today)
  if (i < 0) return null
  const expected = rows[i].unitPrice
  if (expected == null || contractUnitPrice == null) return null
  if (Math.abs(expected - contractUnitPrice) <= 0.001) return null
  return { tier: rows[i], expected, actual: contractUnitPrice }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend && npm run test -- rentTier && npm run typecheck`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/contracts/rentTier.ts frontend/src/views/contracts/rentTier.spec.ts
git commit -m "feat(contract): 阶梯期纯函数(分组/当前段/换档告警) (V2-SPEC §5)"
```

---

## Task 5: 两个展示组件（FPContractChain / FPRentTierBar）

**Files:**
- Create: `frontend/src/views/contracts/FPContractChain.vue`
- Create: `frontend/src/views/contracts/FPRentTierBar.vue`

**Interfaces:**
- Consumes: Task 3 `chainOf` 结果类型 `{c, seq}[]`、`RentTierDTO`；Task 4 `groupTiers/currentTierIndex/tierMismatch`。
- Produces:
  - `FPContractChain` props `{ chain: {c: ContractDTO; seq: number}[]; currentId: number }`，emit `jump: [ContractDTO]`；**chain.length <= 1 时渲染空**。
  - `FPRentTierBar` props `{ tiers: RentTierDTO[]; today: string; contractUnitPrice?: number | null }`；**tiers.length <= 1 时渲染空**。

- [ ] **Step 1: FPContractChain.vue**

```vue
<script setup lang="ts">
// 续签链 chip 条(CONTRACT-CARD-V2-SPEC §3/§4.1)。期号用阿拉伯数字 1,2,3(用户拍板)。
// 单期合同整条不渲染;旧合同亦可见后续期并可跳转(§4.1),但各期状态互不污染由卡片自身保证(§4.2)。
import type { ContractDTO } from '@/types/contract'
import FPContractStatus from '@/components/fp/FPContractStatus.vue'
const props = defineProps<{ chain: { c: ContractDTO; seq: number }[]; currentId: number }>()
const emit = defineEmits<{ jump: [ContractDTO] }>()
</script>

<template>
  <div v-if="props.chain.length > 1" class="cc-wrap">
    <button
      v-for="it in props.chain" :key="it.c.id" type="button" class="cc-chip"
      :class="{ cur: it.c.id === props.currentId }"
      :disabled="it.c.id === props.currentId"
      :title="it.c.contractNo"
      @click="emit('jump', it.c)"
    >
      <span class="cc-seq">{{ it.seq }}</span>
      <span class="cc-body">
        <span class="cc-no">{{ it.c.contractNo }}</span>
        <span class="cc-range">{{ it.c.startDate ? it.c.startDate + ' → ' + it.c.endDate : '—' }}</span>
      </span>
      <FPContractStatus :status="it.c.status" />
    </button>
  </div>
</template>

<style scoped>
.cc-wrap { display:flex; gap:8px; overflow-x:auto; padding:2px 0 6px; }
.cc-chip { display:flex; align-items:center; gap:8px; flex:0 0 auto; cursor:pointer;
  padding:6px 10px; border:1px solid var(--border-subtle); border-radius:var(--radius-md);
  background:var(--surface-white); font:inherit; text-align:left; }
.cc-chip:hover:not(:disabled) { background:var(--surface-card); }
.cc-chip.cur { border-color:var(--hue-blue); background:var(--surface-card); cursor:default; }
.cc-seq { width:20px; height:20px; flex:0 0 auto; border-radius:50%; display:grid; place-items:center;
  background:var(--border-strong); color:#fff; font-size:11.5px; font-weight:var(--fw-semibold); }
.cc-chip.cur .cc-seq { background:var(--hue-blue); }
.cc-body { display:flex; flex-direction:column; min-width:0; }
.cc-no { font-size:12.5px; font-weight:var(--fw-medium); color:var(--text-primary); }
.cc-range { font-size:11px; color:var(--text-muted); font-family:var(--font-mono); }
</style>
```

- [ ] **Step 2: FPRentTierBar.vue**

```vue
<script setup lang="ts">
// 租金阶梯期可视化(CONTRACT-CARD-V2-SPEC §5)。替代原「分年阶梯价」纯文本一坨。
// 阶梯=参考排程,不参与计费(§1);换档靠人工改合同现行单价,故有 §5.3 错档提示。
import { computed } from 'vue'
import type { RentTierDTO } from '@/types/contract'
import { groupTiers, currentTierIndex, tierMismatch } from './rentTier'
const props = defineProps<{ tiers: RentTierDTO[]; today: string; contractUnitPrice?: number | null }>()

const groups = computed(() => groupTiers(props.tiers))
const idxOf   = (rows: RentTierDTO[]) => currentTierIndex(rows, props.today)
const dated   = (rows: RentTierDTO[]) => rows.every(r => r.startDate && r.endDate)
const mism    = computed(() => {
  const g = groups.value.find(x => x.feeKey == null) ?? groups.value[0]
  return g ? tierMismatch(g.rows, props.today, props.contractUnitPrice) : null
})
const n = (v: number | null | undefined) => (v != null ? v.toLocaleString('en-US') : '—')
</script>

<template>
  <div v-if="props.tiers.length > 1" class="rt">
    <!-- §5.3 换档告警(可砍):人工换档流程唯一漏点=忘了改合同 -->
    <div v-if="mism" class="rt-warn">
      今天已进入第 {{ groups[0] ? idxOf(groups[0].rows) + 1 : '?' }} 档（{{ n(mism.expected) }} 元/㎡·月），
      但合同现行单价为 {{ n(mism.actual) }} 元/㎡·月，请更新合同。
    </div>

    <div v-for="(g, gi) in groups" :key="gi" class="rt-grp">
      <div v-if="g.feeKey" class="rt-fee">{{ g.feeKey }}</div>

      <!-- 分段条:有完整日期才按当前段高亮;相对期限退化为等分示意 -->
      <div class="rt-bar">
        <div v-for="(r, i) in g.rows" :key="r.id" class="rt-seg"
             :class="{ cur: dated(g.rows) && i === idxOf(g.rows) }">
          {{ r.label || ('第' + r.seq + '档') }}
        </div>
      </div>
      <div v-if="!dated(g.rows)" class="rt-rel">相对期限：具体日期以交付后书面确定</div>

      <div class="rt-head"><span class="fx">档</span><span>起止</span><span>单价</span><span>月额</span></div>
      <div v-for="(r, i) in g.rows" :key="'r' + r.id" class="rt-row"
           :class="{ cur: dated(g.rows) && i === idxOf(g.rows) }">
        <span class="fx">{{ r.label || ('第' + r.seq + '档') }}</span>
        <span class="mono">{{ r.startDate ? r.startDate + ' → ' + r.endDate : '—' }}</span>
        <span class="mono">{{ n(r.unitPrice) }}</span>
        <span class="mono">{{ n(r.monthlyAmount) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rt { display:flex; flex-direction:column; gap:10px; }
.rt-warn { padding:7px 10px; border-radius:var(--radius-md); font-size:12px; line-height:1.5;
  background:rgba(255,149,0,.10); border:1px solid rgba(255,149,0,.35); color:var(--text-primary); }
.rt-grp { display:flex; flex-direction:column; gap:4px; }
.rt-fee { font-size:11.5px; color:var(--text-muted); }
.rt-bar { display:flex; gap:3px; }
.rt-seg { flex:1; padding:5px 4px; text-align:center; font-size:11px; border-radius:var(--radius-sm);
  background:var(--surface-card); color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.rt-seg.cur { background:var(--hue-blue); color:#fff; font-weight:var(--fw-semibold); }
.rt-rel { font-size:11px; color:var(--text-muted); }
.rt-head, .rt-row { display:grid; grid-template-columns:1.1fr 1.6fr .8fr .9fr; gap:6px; padding:4px 2px; align-items:baseline; }
.rt-head { font-size:11px; color:var(--text-muted); border-bottom:1px dashed var(--divider); }
.rt-head span:not(.fx), .rt-row span:not(.fx) { text-align:right; }
.rt-row { font-size:12.5px; border-top:1px dashed var(--divider); }
.rt-row.cur { font-weight:var(--fw-semibold); }
.rt-row .mono { font-family:var(--font-mono); }
</style>
```

- [ ] **Step 3: 型检**

Run: `cd frontend && npm run typecheck`
Expected: 无错（组件尚未被引用，只验证自身类型）。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/contracts/FPContractChain.vue frontend/src/views/contracts/FPRentTierBar.vue
git commit -m "feat(contract): 合同链 chip 条 + 阶梯期可视化组件 (V2-SPEC §3/§5)"
```

---

## Task 6: 卡片接线（**串行**：改 ContractDrawer.vue + ContractsView.vue）

**Files:**
- Modify: `frontend/src/views/contracts/ContractDrawer.vue`
- Modify: `frontend/src/views/contracts/ContractsView.vue:350`

**Interfaces:**
- Consumes: Task 3 `chainOf`、Task 5 两组件、Task 2 的 `detail.rentTiers`。

- [ ] **Step 1: Drawer 换 props 并引组件**

`ContractDrawer.vue` `<script setup>`：
- import 增：
  ```ts
  import FPContractChain from './FPContractChain.vue'
  import FPRentTierBar from './FPRentTierBar.vue'
  ```
- props 把 `history?: ContractDTO[]` 换成：
  ```ts
  chain?: { c: ContractDTO; seq: number }[]   // 整条续签链(V2-SPEC §4.1),由父级 chainOf 传入
  ```
- emits 增 `jump: [ContractDTO]`。
- 增今天：
  ```ts
  const today = new Date().toISOString().slice(0, 10)
  ```

- [ ] **Step 2: 模板三处改动**

1. 在「租户卡」之后、「合同信息」之前插入链条：

```html
      <FPContractChain
        v-if="chain && chain.length > 1 && contract"
        :chain="chain" :current-id="contract.id" @jump="emit('jump', $event)" />
```

2. **删除**合同信息块里这两行（V2-SPEC §3 降级）：

```html
        <div v-if="contract.termText" class="fp-field">…期限原文…</div>
        <div v-if="contract.tierPriceNote" class="fp-field">…分年阶梯价…</div>
```

3. 在「合同信息」块之后插入阶梯块：

```html
      <div v-if="detail && detail.rentTiers.length > 1">
        <FPSectionLabel icon="trending-up">租金阶梯</FPSectionLabel>
        <FPRentTierBar :tiers="detail.rentTiers" :today="today" :contract-unit-price="contract.unitPrice" />
      </div>
```

4. 把原「续签历史」整块（`v-if="history && history.length"`）**替换**为折叠的「原始留档」块，放在「标的段与费用」之后、「备注」之前：

```html
      <details v-if="contract.termText || contract.tierPriceNote" class="cd-raw">
        <summary>原始留档（合同白纸黑字原文）</summary>
        <div v-if="contract.termText" class="fp-field"><span class="k">期限原文</span><span class="v cd-wrap">{{ contract.termText }}</span></div>
        <div v-if="contract.tierPriceNote" class="fp-field"><span class="k">分年阶梯价</span><span class="v cd-wrap">{{ contract.tierPriceNote }}</span></div>
      </details>
```

样式追加：

```css
.cd-raw { border:1px dashed var(--divider); border-radius:var(--radius-md); padding:6px 10px; }
.cd-raw > summary { cursor:pointer; font-size:var(--fs-label); color:var(--text-muted); }
```

5. **删除**不再使用的 `.cd-hist*` 样式与 `FPContractStatus` 的历史用法（若 import 变成未使用则一并删，避免 typecheck 报 unused）。

- [ ] **Step 3: 时序正确性自检（§4.2）**

确认 `ctTimeline()` 中：`expired` / `terminated` / `renewed` 分支**不含**任何「建议尽快续签」文案（现状已满足，仅需确认不要在新代码里引入）。

- [ ] **Step 4: ContractsView 传链 + 处理跳转**

`ContractsView.vue`：
- import 改 `import { leafIds, chainOf } from './chain'`（若 `ancestorsOf` 不再用则去掉）。
- 第 350 行附近把 `:history="…ancestorsOf(...)"` 换成：
  ```html
      :chain="openContract ? chainOf(contracts, openContract.id) : []"
      @jump="openContract = $event"
  ```

- [ ] **Step 5: 型检 + 全量测试**

Run: `cd frontend && npm run typecheck && npm run test`
Expected: 全 PASS。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/contracts/ContractDrawer.vue frontend/src/views/contracts/ContractsView.vue
git commit -m "feat(contract): 卡片接线-合同链导航/阶梯可视化/原文降级留档 (V2-SPEC §3/§4)"
```

---

## Task 7: 可编辑（**串行**：改 ContractNewDialog.vue）

**Files:**
- Modify: `frontend/src/views/contracts/ContractNewDialog.vue`

**Interfaces:**
- Consumes: Task 3 的 `ContractCreateReq` 新增 4 字段、`RentTierReq`。

- [ ] **Step 1: 加三个期限字段的 state 与回填**

在既有 ref 区加：

```ts
const termText = ref<string>('')
const termType = ref<string>('')          // ''|explicit|multiple|relative|none
const tierPriceNote = ref<string>('')
const rentTiers = ref<RentTierReq[]>([])
```

在 `props.initial` 回填分支（编辑态）里加：

```ts
  termText.value = props.initial.termText ?? ''
  termType.value = props.initial.termType ?? ''
  tierPriceNote.value = props.initial.tierPriceNote ?? ''
```

阶梯段回填需要详情：编辑态打开时调 `contractApi.detail(props.initial.id)` 取 `rentTiers` 填入 `rentTiers.value`（若组件已在别处取过 detail 则复用，不重复请求）。

- [ ] **Step 2: 提交时带上四字段**

在构造提交对象处（`create`/`update` 的 payload）追加：

```ts
  termText: termText.value.trim() || null,
  termType: termType.value || null,
  tierPriceNote: tierPriceNote.value.trim() || null,
  rentTiers: rentTiers.value,
```

- [ ] **Step 3: 模板加输入**

合同信息区追加（沿用该文件既有 `.ct-in` / 字段行写法）：

```html
        <label class="ct-f"><span>期限原文</span>
          <textarea v-model="termText" class="ct-in" rows="2" placeholder="如:2023年7月14日起至2026年7月13日"></textarea></label>
        <label class="ct-f"><span>期限类型</span>
          <select v-model="termType" class="ct-in">
            <option value="">—</option><option value="explicit">明确起止</option>
            <option value="multiple">多段</option><option value="relative">相对表述</option><option value="none">无</option>
          </select></label>
        <label class="ct-f"><span>分年阶梯价(原文留档)</span>
          <textarea v-model="tierPriceNote" class="ct-in" rows="2"></textarea></label>
```

阶梯段增删（放在标的段编辑区之后，**同一编辑态**，不加独立按钮，沿 §6.2）：

```html
        <div class="ct-sec">
          <div class="ct-sec-h"><span>租金阶梯期</span>
            <button type="button" class="ct-add" @click="rentTiers.push({ seq: rentTiers.length + 1 })">+ 添加档</button></div>
          <div v-for="(r, i) in rentTiers" :key="i" class="ct-tier">
            <input v-model="r.label" class="ct-in" placeholder="档名(如 首年)" />
            <input v-model="r.startDate" class="ct-in" type="date" />
            <input v-model="r.endDate" class="ct-in" type="date" />
            <input v-model.number="r.unitPrice" class="ct-in" type="number" step="0.0001" placeholder="单价" />
            <input v-model.number="r.monthlyAmount" class="ct-in" type="number" step="0.01" placeholder="月额" />
            <button type="button" class="ct-del" @click="rentTiers.splice(i, 1)">删</button>
          </div>
        </div>
```

- [ ] **Step 4: 型检 + 测试**

Run: `cd frontend && npm run typecheck && npm run test`
Expected: 全 PASS。

- [ ] **Step 5: 手工验收**

启动 dev（用 preview 工具，非 Bash），打开任一合同 → 编辑 → 改期限原文与阶梯段 → 保存 → 重开卡片确认落库回显。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/contracts/ContractNewDialog.vue
git commit -m "feat(contract): 期限原文/类型/阶梯价可编辑 + 阶梯段增删 (V2-SPEC §6)"
```

---

## Task 8: 回填（workflow 重提 tiers[]）

**Files:**
- Create: 提取脚本与工作流（scratchpad），产出 `tiers.json`
- Create: `backend` 一次性导入端点或 SQL 脚本（择一，见 Step 3）

**Interfaces:**
- Consumes: Task 1 的表结构。

- [ ] **Step 1: 重跑合同附图提取，schema 强制 tiers[]**

复用已验证的 137 户合同附图工作流，structured output schema 改为：

```json
{ "tiers": [ { "label": "首年至第三年", "start": "2022-07-21", "end": "2025-07-20",
              "unitPrice": 16.92, "monthly": 238667.26, "feeKey": "rent_factory" } ] }
```

要求：回到原始合同表格取数（如力灏「首年至第三年/第四年至第六年」那种表）；无明确日期的段 `start/end` 置 null 并保留 `label`。

- [ ] **Step 2: 按合同号/租户匹配**

产出两份：`tiers_matched.json`（可入库）与 `tiers_unmatched.json`（待核对，交人工，**不猜**）。

- [ ] **Step 3: 入库**

生成 `INSERT` 脚本落 `contract_rent_tier`（一次性数据回填，不进 Flyway 迁移目录——迁移只放结构变更）。执行前先 `SELECT COUNT(*) FROM contract_rent_tier`（应为 0）。

- [ ] **Step 4: 锚点验收（V2-SPEC §10）**

| # | 期望 |
|---|---|
| ① | 周兴 S10-0074 阶梯 2 段，当前段 = 2024-08-10~2026-08-09 / 14.282 / 5570 |
| ② | 力灏 相对期限，不判定当前段，显「具体日期以交付后书面确定」 |
| ③ | 单期合同 链条不渲染 |
| ④ | 已续签旧合同 可点跳到现行期；自身不显「建议尽快续签」 |
| ⑤ | 编辑保存后回显正确 |
| ⑥ | 无阶梯合同 阶梯块不渲染 |

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-07-25-contract-card-v2.md
git commit -m "chore(contract): 阶梯期回填与锚点验收记录"
```

---

## 执行编排（workflow 用）

```
Phase A(并行,不同文件):  Task 1→2 (后端串行)   ‖   Task 3→4 (前端基础串行)
Phase B(并行,新文件):    Task 5 (两个组件)
Phase C(必须串行,同文件): Task 6 → Task 7
Phase D:                 全量 typecheck + test + 后端 mvn test,修红
Phase E:                 Task 8 回填(数据,独立)
```

**并行安全铁律**：Task 6/7 都改 `views/contracts/` 下既有大文件，**绝不可与其它任务并行**，否则同文件互相覆盖。
