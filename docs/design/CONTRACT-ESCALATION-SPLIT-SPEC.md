# 递增段拆链（CONTRACT-ESCALATION-SPLIT-SPEC）

> 2026-07-26。落实 `CONTRACT-BILLING-REWORK-SPEC §4` 的「拆合同内递增段成链」：
> 用 `contract_rent_tier`（163 行/68 户）把多档单合同拆成 `link_type=escalation` 的链段，落 `link_type`。
> 拆完后阶梯表成为惰性数据；**DROP 表暂缓**——须待本脚本在所有环境（dev+云）跑完后另出迁移。

## 1. 模型

- 链是严格单链（`chain.ts` 分叉告警取 id 最大），故拆链结构 = `档1 ← 档2 ← … ← 原合同行(末档) ← 续签子期`：
  **原合同行保留 id 并充当自身租期内最后一档**（续签子期 parent 指针不动），新造的行全是它的祖先。
- `uk_contract_no` 唯一约束 ⇒ 祖先段合同号 = `原号#档序`（如 `S10-0011#1`），原号留在末档行。
- `link_type`（V57 落库）：`new`(链首) | `renew`(续签换约) | `escalation`(同约递增段)。存量回填：parent 空=new、非空=renew。
  拆链后：档1=new（新链首），档2..末档=escalation。仅供卡片显示与留痕，派生一视同仁（REWORK §1）。
- 状态沿 importFull 续签链惯例：中间档 `status='renewed'`，末档保持原状态。KPI 月租金合计因此按「链上最新一期」口径
  （dev 实测 43 户中 41 户锚点不在末档 = 从未人工换档，末档放大后 KPI 略升，属修正非回归）。

## 2. 拆链算法（plan.sql 全库内确定性推导）

对每份带阶梯的合同（own period [S,E]）：

1. **期内档**：有日期档裁剪到 [S,E]；同 (cs,ce) 平行行合并求和（fee_key 全为 NULL=整合同口径，dev 实测无按费项阶梯）。
2. **全平行**：所有档 ce=E（如 S10-0104/0106 双单元并行排程）→ 合并为单档。
3. **单档** → 无动作（消化）。**≥2 档** → 校验分区：首档起点/末档终点与 [S,E] 差 ≤1 天、相邻缝隙 0..2 天，违者 MANUAL。
4. **锚定**：现行计费行是事实源，档只提供涨幅比率。两口径（rmi=租金+管理+基础设施 / rent=仅租金，镜像 lineMonthly §1.1）
   × 各档月额求相对差；best ≤1% 直接锚，或 ≤5% 且与同口径次近档差 ≥4pp（档间涨幅~10%，区分度足）。无锚 → MANUAL。
   锚定偏差 δ 均匀保留到所有档（不放大）：各档目标 = 现行口径合计 × ma_i/ma_锚。
5. **apply**：
   - 造祖先行（档 1..n-1）：复制原行全部字段（免租期/期限原文/备注/电费要素原样带；免租期窗口可能落在别档，展示留档性质，派生按期相交）；
     start/end=档界；status='renewed'；合同号=`原号#i`；标量缩放（unit_price 恒缩，mgmt/infra 仅 rmi 口径缩，×ma_i/ma_锚，ROUND 4）。
   - 计费行逐行复制：命中口径的行 unit_price(×ratio,R4)/amount_override(×ratio,R2) 缩放，其余原样；**source='manual'**（不被导入覆盖律清除）。
   - 父指针：档1.parent=NULL，档i.parent=档(i-1)；原行 start=末档起点、parent=档(n-1)、link_type='escalation'、口径行 ×ma_n/ma_锚（锚=末档时 ratio=1 恒等）。
   - 单事务；二次运行撞 uk_contract_no 自动中止（天然幂等门）。
6. **verify**：段分区无缝隙重叠、每段行数=原行数、每段口径合计=预期(原合计×ratio ±1元)、`%#%` 行数=计划数、KPI 前后对照留档。

## 3. dev 库已 apply（2026-07-26，对抗性审查两处修正后）

| 桶 | 数量 | 明细 |
|---|---|---|
| 自动拆 ✅已落库 | **39 户 → 新增 53 行** | ratio ∈ [0.909, 1.392]；37 户锚点非末档（未换档，末档放大=修正），2 户锚=末档 |
| 期内单档消化 | 13 户 | 含「次段=已回填续签子期」跳过（Phase A 已消化）+ 104/106 平行合并 |
| MANUAL | 16 户 | 见 `escalation-split-plan.tsv`；处置后可重跑本脚本消化（幂等门放行未拆户） |

verify 全绿：53=53、段分区/父链/行数/金额四查全空、δ 均匀保留 max 2.56%；
KPI 月租金合计 1,136,899.75 → 1,231,329.28（37 户末档放大，链上最新一期口径，同续签链惯例）。

**审查修正**（对抗性审查发现，已进 plan.sql）：
- `rent-scope-needs-review`：rent 口径锚定是数字巧合（S10-0056/0067/0099/C2024M-003 档注记显示 mgmt/infra 实随档递增），
  一刀切缩放会把末档 mgmt/infra 冻旧价（S10-0056 一户 36 个月差 ~7,940 元）→ 仅 rmi 口径可自动拆，rent 锚 4 户改人工。
- `child-no-billing`：消化桶前提=期外档已被续签子期消化；C2024M-020/C2024M-008 是 0 计费行空壳，档价（如 2587.20）仅存阶梯表
  → 进人工清单，DROP 表前必须把档价补成子期计费行。

MANUAL 16 户：S10-0095(档重叠+空壳子期) · C2024M-007(空壳子期 C2024M-020) · S10-0006(档缺月额) · S10-0018(现行 17% 高于任何档) ·
S10-0064/0209(锚区分度不足) · S10-0079(阶梯仅跟踪单间) · S10-0107(7.5% 偏差) · S10-0056/0067/0099/C2024M-003(rent 口径待核构成) ·
S10-0059/0145(档全在租期外) · S10-0192/0198(相对期限无日期)。阶梯原文仍在 `term_text/tier_price_note`（V55 留档），不丢凭据。

## 4. 配套代码

- `V57__contract_link_type.sql`：`contract.link_type VARCHAR(12) NOT NULL DEFAULT 'new'` + 存量回填 renew。
- 实体/DTO/前端类型带出 `linkType`；`FPContractChain` 递增段 chip 加「递增」徽标；`renew()`/`importFull` 子期显式落 'renew'。
- **importFull 防线**：**按户拦**（该户存在任一 escalation 行 → 整行跳过，error 报告「已拆递增链」）。
  拆链后原行是末档价/末档起点且带 parent，重导 2024-03 册会认领失败另建重复合同并拍回旧值——必须拦。
  按户而非按链是有意保守：链级判定需在认领后做，而认领本身（findByStart）可能撞上 `#` 祖先行造成误写。
  已知边界：3 户各有另一份未拆合同（S10-0029/S10-0061/S10-0199），重导时会一并跳过（报告可见非静默），需人工处置。
  `billing-lines/import` 按 id 定点导入不拦（模板不会引用新造行 id），记为已知边界。
- 脚本：`backend/scripts/escalation-split/{plan,apply,verify}.sql`（docker exec mysql 逐段跑）；
  plan 产出 `demo3/escalation-split-plan.tsv` 人审留档（仿 restructure-plan.csv 先例）。
- 回滚：apply 前 `mysqldump` 全量（`backup-before-esc-split-*.sql`）。

## 5. 云端 replay

云库数据同源，升级流程：先跑 V57（随发版 Flyway 自动），再手动跑 plan（重新推导，MANUAL 可能微差）→ 人审 → apply → verify。
**在云端跑完前不得出 DROP contract_rent_tier 迁移**（否则 Flyway 先毁云端排程源）。

## 6. 非目标

- 账单派生引擎/bill_notice（BILL-FORWARD 刀2，另 spec）。
- MANUAL 11 户的人工处置（清单交付，改完后它们仍可单独重跑本脚本消化——plan 含「已有 # 后缀行则跳过」幂等门）。
- DROP contract_rent_tier（§5 条件满足后另出）。
