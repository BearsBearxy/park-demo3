-- =====================================================================
-- S7 刀A+刀B：C座货梯表双挂纠正 + 电梯加度改「规则×月份」参数（起草，未执行）2026-08-08
--
-- 【刀A】rule 59「一期 C座·天面东侧·货梯」错绑 meter 322(C西侧货梯)，
--        真正的 meter 319(C东侧货梯电表1) 反而是孤儿(不属于任何 alloc_rule_meter)。
--        结果：322 被 rule 59 与 rule 60 双重计入，319 的 110.78 度整月漏计。
--        目标：rule 59 = {319,320,321}，rule 60 = {322}。
--
-- 【刀B】alloc_rule.extra_qty 是「财务逐月手工旋钮」，挂在规则上会让**没配月参的月份**
--        凭空多收。引擎已支持月参优先(AllocService:1285 poolExtra →
--        cfgVal(ctx,"rule:"+id,"extra_qty") 命中则用，未命中才回退 rule.extra_qty)。
--        目标：5 条电梯加度(50/59/69/70/89)只留在 alloc_cfg 的 2024-02 月行上，
--        alloc_rule.extra_qty 清零。
--
-- ─────────────── 源册佐证（决定性）───────────────
-- C:\financial_dashboard\2025全年发生额、预算对比\2023年\一期\水电费\一期2023年10月水电费.xlsx
-- 『公共电分摊明细』sheet（列19=本月用量，列27=层数，列29=分摊标准 元/层，列30=应分摊）：
--   r58 C东侧货梯电表1 电表① 东侧货梯  用量 0     层数3  标准 45.97
--   r59 C东侧货梯电表2 电表② 东侧货梯  用量 92.5         应分摊 102.04
--   r60 C东侧货梯电表3 电表③ 东侧货梯  用量 32.5         应分摊  35.85
--   r61 C西侧货梯      电表④ 西侧货梯  用量 242.1  层数3  标准 89.03  应分摊 267.08
--   ① 分栏：r58/59/60 三行标「东侧货梯」折成一池(rule 59 book_row=58)，
--      r61 单独标「西侧货梯」自成一池(rule 60 book_row=61) —— 与刀A目标逐字一致。
--   ② 加度：东侧池 std 45.97 = (0+92.5+32.5)×1.10316875/3 = 45.9653…（无加度）；
--      若真挂 100 度加度，std 应为 82.74。西侧池 89.03 = 242.1×1.10316875/3 同样无加度。
--      B座货梯(rule 50)同验：(160+737.8)×1.10316875/3 = 330.14 = 册面 r43 列29，亦无 170 度。
--      → 加度确系 2024-02 单月旋钮，不是规则常量。刀B 成立。
--
-- ─────────────── 影响面（dev 库实测，2026-08-08）───────────────
-- 受影响月份：全库 meter_reading / alloc_pool_result 只有 2023-10 与 2024-02 两个账期。
-- ● 刀A 只动 2024-02（2023-10 这 4 块表零读数，池结果本就 NULL）：
--     rule 59  qty 341.44 → 288.92   cost 380.42 → 321.91   std 163.95 → 144.44
--     rule 60  完全不变（qty 163.30 / cost 181.94 / std 60.65）
--   **零租户金额变化**：rule 59 与 rule 60 的 alloc_rule_member 均为 0 行，
--   且两池 building_id=21(非 NULL) → autoMembers()=false，不走全园名册回退；
--   引擎当前对两池落的是「无受益人，应分摊 X 元未摊到户」warning，allocated_amount=0.00。
--   → 变的只有公共电核算屏的池行与 C 座块合计(应分摊 −58.51)，不进任何户账单。
--   楼栋损耗不受影响：lossGroups() 走 meter 表全量(inSubSigma 含 ownership='share')，
--   四块表本来就都在 building 21 的 D 组里，改绑池不改 C/D 任何一格。
-- ● 刀B **对租户账单零影响，但会改公共电核算「对账屏」上的成本数字**（起草稿曾误写「零影响」，
--   独立复核推翻，此处更正）。根因：两条路径读的不是同一个源——
--     池引擎 computePool() 走月参感知的 poolExtra(rule, ctx)  → cost **不含**加度（=源册 AD 列口径）
--     对账屏 ruleCostAmount() (AllocService:915) 直接读 rule.getExtraQty() → cost **含**加度
--   即两侧今天就不一致；清零 rule.extra_qty 会让对账屏掉到与池台账/源册一致的值：
--     rule 50 B座货梯   907.49 → 718.08  (−189.41)
--     rule 59 C东侧货梯 491.84 → 321.91  (−169.93，含刀A 叠加)
--     rule 69 D东侧货梯 515.97 → 404.56  (−111.41)
--     rule 70 D西侧货梯 725.44 → 614.02  (−111.42)
--     rule 89 F西侧货梯 419.67 → 196.84  (−222.83)
--     合计约 −805 元；差额列同步翻转(如 rule 50 从 ≈+0.01 变 +189.42，与池侧 gap 一致)
--   判据：源册 AD(应分摊金额)=ROUND(度数×单价,2) 逐表算，**不含加度**；加度只进 AC(分摊标准/租户单价)。
--   所以这是把对账屏拉回源册口径的**修正**，不是回退。但它是可见的口径变更，已如实告知用户。
--   2024-02 户级金额一分不动（月参已存在且同值 ⇒ std 不变）；2023-10 这 5 池 qty/cost 本就 NULL。
--
-- ─────────────── ⚠ 两条待人工核对（本脚本不猜、不改）───────────────
-- ① rule 69「D座·天面东侧·货梯」note 写「电梯用电加200度」但 extra_qty=100(cfg 月参也是 100)；
--    rule 89「F座·天面西侧·货梯」note 为空但 extra_qty=200。疑似 note 与值在 69/89 间错位，
--    也可能 note 本身是旧值残留。**需比对 2024-02 源册 D/F 座货梯段落**后再定，本脚本一律按现值搬。
-- ② rule 23「招商中心·净电」extra_qty=-670 **刻意不动**：
--    它不是月度旋钮，而是招商中心自用扣减的**结构性口径**（note：两块80倍总表−5子表−670度自用，
--    S8=X50−670；method=direct、含 sign=-1 的净额池，AllocService:1302 明确「净额池 extra_qty
--    直接并入净量」）。清零会让净电口径整体失真，且它已同时存在于 rule 与 cfg 两处、值一致。
--
-- ─────────────── 应用步骤 ───────────────
-- 1) 备份：docker exec demo3-mysql mysqldump -uroot -proot --default-character-set=utf8mb4 \
--          park_demo3 > backup-before-s7-alloc-20260808.sql
--    （⚠ 勿经 PowerShell 管道转码，中文会 GBK 损坏；本文件 UTF-8 无 BOM）
-- 2) 执行：docker exec -i demo3-mysql mysql -uroot -proot --default-character-set=utf8mb4 \
--          park_demo3 < backend/scripts/fixes/s7-alloc-fixes-20260808.sql
-- 3) 重生成两个账期：POST /api/alloc/generate?ym=2023-10 与 ?ym=2024-02
-- 4) 跑本文件末尾「验证段」，逐条对期望值。
-- 幂等：全部按 id + 旧值 WHERE / ON DUPLICATE 无操作，重跑影响 0 行。
-- =====================================================================


-- ═══════════════ 刀A：C座货梯表双挂 ═══════════════
-- 前置断言（不满足则**停手**，本脚本预期三行全 0/1）：
--   SELECT COUNT(*) FROM alloc_rule_member WHERE rule_id IN (59,60);          -- 期望 0
--   SELECT COUNT(*) FROM alloc_rule_meter  WHERE rule_id=59 AND meter_id=322; -- 期望 1
--   SELECT COUNT(*) FROM alloc_rule_meter  WHERE meter_id=319;                -- 期望 0

-- A1 摘掉 rule 59 上的 322（322 归 rule 60，rule 60 已有该绑定 arm id=77，不动）
DELETE FROM alloc_rule_meter
 WHERE rule_id = 59 AND meter_id = 322;

-- A2 把孤儿 319（C东侧货梯电表1，源册 r58）补进 rule 59
INSERT INTO alloc_rule_meter (rule_id, meter_id, sign)
     VALUES (59, 319, 1)
ON DUPLICATE KEY UPDATE sign = VALUES(sign);


-- ═══════════════ 刀B：电梯加度 → 规则×月份参数 ═══════════════
-- B1 月参落位。dev 库实测这 5 行(alloc_cfg id 36/41/45/47/54)**已存在且值相同**，
--    此处 ON DUPLICATE 保持 no-op；写出来是为了让脚本在云端/新库上同样自洽。
--    唯一键 uk_alloc_cfg(scope, cfg_key, acct_month)。
INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, note) VALUES
  ('rule:50', 'extra_qty', 170.00, '2024-02', '池月参(B东侧货梯)'),
  ('rule:59', 'extra_qty', 100.00, '2024-02', '池月参(C东侧货梯电表1)'),
  ('rule:69', 'extra_qty', 100.00, '2024-02', '池月参(D东侧货梯)'),
  ('rule:70', 'extra_qty', 100.00, '2024-02', '池月参(D西侧货梯)'),
  ('rule:89', 'extra_qty', 200.00, '2024-02', '池月参(F西侧货梯)')
ON DUPLICATE KEY UPDATE id = id;   -- 已存在则一字不改（不覆盖人工调过的值）

-- B2 规则上的常量加度清零（rule 23 的 -670 结构性扣减不在名单内，见头注 ⚠②）
UPDATE alloc_rule SET extra_qty = 0.00
 WHERE id IN (50, 59, 69, 70, 89) AND extra_qty <> 0.00;


-- ═══════════════ 验证段（执行 + 重生成后逐条对）═══════════════

-- V1 绑定：期望恰好 4 行 —— rule 59 挂 319/320/321，rule 60 挂 322
SELECT arm.rule_id, arm.meter_id, m.name, arm.sign
  FROM alloc_rule_meter arm JOIN meter m ON m.id = arm.meter_id
 WHERE arm.rule_id IN (59, 60) ORDER BY arm.rule_id, arm.meter_id;
-- 期望：
--   59 | 319 | C东侧货梯电表1 | 1
--   59 | 320 | C东侧货梯电表2 | 1
--   59 | 321 | C东侧货梯电表3 | 1
--   60 | 322 | C西侧货梯      | 1

-- V2 无表落单：期望 0 行（319 不再是孤儿；322 不再双挂）
SELECT m.id, m.name, COUNT(arm.id) AS rule_cnt
  FROM meter m LEFT JOIN alloc_rule_meter arm ON arm.meter_id = m.id
 WHERE m.id IN (319, 320, 321, 322)
 GROUP BY m.id, m.name HAVING rule_cnt <> 1;

-- V3 规则常量：期望只剩 rule 23 一行（-670.00）
SELECT id, name, extra_qty FROM alloc_rule WHERE extra_qty <> 0 ORDER BY id;
-- 期望：23 | 一期 招商中心·净电 | -670.00

-- V4 月参：期望 6 行（5 条电梯 + rule 23 的 -670，均 acct_month='2024-02'）
SELECT scope, cfg_key, cfg_value, acct_month FROM alloc_cfg
 WHERE cfg_key = 'extra_qty' ORDER BY CAST(SUBSTRING(scope, 6) AS UNSIGNED);
-- 期望：rule:23 -670.00 / rule:50 170.00 / rule:59 100.00 /
--       rule:69 100.00 / rule:70 100.00 / rule:89 200.00，全部 2024-02

-- V5 池结果 2024-02（须先 POST /api/alloc/generate?ym=2024-02）
SELECT rule_id, qty_total, extra_qty_snap, cost_amount, base_snap, std_value, warn
  FROM alloc_pool_result WHERE ym = '2024-02' AND rule_id IN (59, 60);
-- 期望（price_snap=1.11416875，round_scale=2）：
--   59 | 288.92 | 100.00 | 321.91 | 3.00 | 144.44000000 | NULL
--        qty  = 110.78 + 126.06 + 52.08 = 288.92
--        cost = ROUND(288.92 × 1.11416875, 2) = ROUND(321.90563525, 2) = 321.91
--        std  = ROUND((288.92 + 100) × 1.11416875 / 3, 2) = ROUND(144.44083675, 2) = 144.44
--   60 | 163.30 |   0.00 | 181.94 | 3.00 |  60.65000000 | NULL   ← 与修复前逐格全等
-- 修复前对照（勿再出现）：59 | 341.44 | 100.00 | 380.42 | 3.00 | 163.95000000

-- V6 池结果 2023-10：5 条电梯池的 extra_qty_snap 期望全部 0.00（原 170/100/100/100/200）
--    qty_total/cost_amount 仍为 NULL（这 4+ 块表 2023-10 无读数），warn 保持「缺读数…」
SELECT rule_id, qty_total, extra_qty_snap, cost_amount
  FROM alloc_pool_result WHERE ym = '2023-10' AND rule_id IN (50, 59, 60, 69, 70, 89)
 ORDER BY rule_id;

-- V7 零户账影响自证：期望 0 行（两池仍无受益人，改绑不进任何租户账单）
SELECT rule_id, COUNT(*) FROM alloc_rule_member WHERE rule_id IN (59, 60) GROUP BY rule_id;
