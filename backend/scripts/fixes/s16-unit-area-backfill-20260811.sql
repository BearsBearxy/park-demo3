-- ============================================================================
-- S16 单元面积一次性反填 (unit.area ← 合同计费行面积)
-- 文件: s16-unit-area-backfill-20260811.sql   [草稿,未执行]
-- 背景: 楼栋重建时无面积源,全库 373 个单元 area 均为 0。
--       合同计费行(contract_billing_term)的租金行带真实计租面积,反填回 unit。
-- 原则: 宁缺勿错——只填无歧义的;冲突跳过;已有 area>0 不覆盖;幂等可重跑。
--
-- 口径注记:
--  ① 在租过滤: SQL 用 status IN ('active','expiring') 简化。
--     与 ContractService.effectiveStatus(§5.1, 日期派生)的差异:
--     - DB 现仅存人工态 active(387)/renewed(44),'expiring' 为派生态从不落库,
--       故本过滤实际 = status='active';
--     - 其中含少量按日期应派生为 future/expired 的合同也会被计入。
--       面积不随到期变化 + 规则③冲突守卫兜底,风险可接受。
--  ② 宿舍栋判定: 任务口径"phase=4"与库实际不符——一期宿舍一~四栋/宿舍区
--     phase=1,仅 保障房/散租宿舍/饭堂 是 phase=4。
--     本脚本改用 (phase=4 OR name LIKE '%宿舍%') 判宿舍栋,防止一期宿舍单元
--     被错配到厂房租金行。(重跑统计: 结果仅 rule2 +1 户,fillable 不变=217)
--  ③ updated_at 为 ON UPDATE CURRENT_TIMESTAMP,本 UPDATE 会触发时间戳变更。
--
-- 只读统计快照 (2026-08-11 dev 库):
--   规则①覆盖 216 单元 / 规则②覆盖 75 单元(重叠 73+冲突相关) →
--   可填 217 / 冲突 1 / 未覆盖 155 (其中 4 无在租合同挂靠, 151 歧义多单元共摊)
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- §0 执行前基线 (应为 total=373, zero=373, filled=0)
-- ────────────────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS total_units, SUM(area = 0) AS zero_area, SUM(area > 0) AS filled
FROM unit;

-- ────────────────────────────────────────────────────────────────────────────
-- §1 候选集定义 (与 §2 UPDATE 内联子查询逐字一致,供先行审阅)
--
-- 规则① 绑定单填: billing_term_unit 该行恰好绑 1 个单元
--        且 行 fee_key ∈ (rent_factory,rent_office,rent_shop,rent_dorm)
--        且 合同 status IN ('active','expiring')  → area = 行 area
-- 规则② 无绑定单填: 合同只有 1 个单元(contract.unit_id 非空且无 contract_unit
--        附加行) 且 同类型租金行经 (location|fee_key|area) 三元去重后只剩 1 行
--        类型匹配: 宿舍栋(phase=4 OR name LIKE '%宿舍%')单元配 rent_dorm 行,
--                  非宿舍单元配 rent_factory/rent_office/rent_shop 行
-- 规则③ 冲突跳过: 同一单元多来源给出不同面积 → 不填(HAVING 去重守卫)
--        area 必须 >0 且非 NULL 才是有效候选
-- ────────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────────
-- §2 UPDATE (幂等: 守卫 u.area = 0,二次执行 0 行命中;不覆盖已有面积)
-- ────────────────────────────────────────────────────────────────────────────
UPDATE unit u
JOIN (
    SELECT cand.unit_id, MIN(cand.area) AS area
    FROM (
        -- 规则① 行级绑定恰好 1 单元
        SELECT btu.unit_id, t.area
        FROM billing_term_unit btu
        JOIN contract_billing_term t ON t.id = btu.term_id
        JOIN contract c ON c.id = t.contract_id
        WHERE t.fee_key IN ('rent_factory', 'rent_office', 'rent_shop', 'rent_dorm')
          AND t.area IS NOT NULL AND t.area > 0
          AND c.status IN ('active', 'expiring')   -- 简化口径,差异见头注①
          AND 1 = (SELECT COUNT(*) FROM billing_term_unit b2 WHERE b2.term_id = btu.term_id)
        UNION ALL
        -- 规则② 单单元合同 + 同类型租金行三元去重唯一
        SELECT c.unit_id, MIN(t.area) AS area
        FROM contract c
        JOIN unit u2 ON u2.id = c.unit_id
        JOIN building b ON b.id = u2.building_id
        JOIN contract_billing_term t ON t.contract_id = c.id
            AND t.area IS NOT NULL AND t.area > 0
            AND ( ((b.phase = 4 OR b.name LIKE '%宿舍%') AND t.fee_key = 'rent_dorm')
               OR (NOT (b.phase = 4 OR b.name LIKE '%宿舍%')
                   AND t.fee_key IN ('rent_factory', 'rent_office', 'rent_shop')) )
        WHERE c.status IN ('active', 'expiring')
          AND c.unit_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM contract_unit cu WHERE cu.contract_id = c.id)
        GROUP BY c.id, c.unit_id
        HAVING COUNT(DISTINCT CONCAT_WS('|', COALESCE(t.location, ''), t.fee_key, t.area)) = 1
    ) cand
    GROUP BY cand.unit_id
    HAVING COUNT(DISTINCT cand.area) = 1        -- 规则③ 冲突守卫: 多面积不填
) v ON v.unit_id = u.id
SET u.area = v.area
WHERE u.area = 0;                                -- 守卫: 只填空白,幂等,不覆盖
-- 预期命中: 217 行

-- ────────────────────────────────────────────────────────────────────────────
-- §3 TODO 清单 (本脚本不处理,留人工)
--
-- 冲突 1 例 (规则③跳过):
--   二期 六车间「天面」伪单元 —— 3 份合同 4 行租金给出 4 种面积,天面为多户
--   共用屋顶,不应有单一面积:
--     罗立剑  S10-0198   term 6805 area=40.00 / term 6804 area=56.00
--     邓宇峰  S10-0204   term 6848 area=93.10
--     邓宇峰  S10-0204#2 term 7203 area=93.10
--
-- 未覆盖 155 单元 (仍 area=0):
--   - 4 户无任何在租合同挂靠(A座1/宿舍四栋1/二车间1/三期1) → 空置或历史户
--   - 151 户有在租合同但歧义: 绝大多数是"一行租金面积绑多个单元"(整层/连铺
--     共用一行,面积无法按单元拆分),按宁缺勿错跳过。
--   分楼栋: A座26 C座8 E座2 G座2 宿舍一栋30 宿舍二栋7 宿舍区2 宿舍四栋3
--           空地2 一车间16 二车间11 三车间13 四车间13 五车间3 六车间2(含天面)
--           三期14 保障房1
-- 未覆盖明细随时可查:
SELECT b.name AS building, u.id AS unit_id, u.unit_no
FROM unit u JOIN building b ON b.id = u.building_id
WHERE u.area = 0
ORDER BY b.phase, b.name, u.unit_no;

-- ────────────────────────────────────────────────────────────────────────────
-- §4 验证 (执行 §2 后跑)
-- ────────────────────────────────────────────────────────────────────────────
-- 4.1 计数: 预期 filled = 217, zero_area = 156 (155 未覆盖 + 1 冲突)
SELECT COUNT(*) AS total_units, SUM(area > 0) AS filled, SUM(area = 0) AS zero_area
FROM unit;

-- 4.2 抽样 10 行: 单元号 / 新面积 / 来源合同行 (面积必须与来源行全等)
SELECT b.name AS building, u.unit_no, u.area AS new_area,
       t.id AS src_term_id, t.fee_key, t.area AS src_area, c.contract_no
FROM unit u
JOIN building b ON b.id = u.building_id
JOIN billing_term_unit btu ON btu.unit_id = u.id
JOIN contract_billing_term t ON t.id = btu.term_id
    AND t.fee_key IN ('rent_factory', 'rent_office', 'rent_shop', 'rent_dorm')
JOIN contract c ON c.id = t.contract_id AND c.status IN ('active', 'expiring')
WHERE u.area > 0 AND u.area = t.area
ORDER BY RAND(20260811)
LIMIT 10;

-- 4.3 幂等性: 重跑 §2 应命中 0 行 (所有候选单元 area 已非 0)
-- 4.4 无越界: 不应有单元面积与全部来源候选都不等 (期望 0 行)
SELECT u.id, u.unit_no, u.area
FROM unit u
WHERE u.area > 0
  AND NOT EXISTS (
    SELECT 1 FROM billing_term_unit btu
    JOIN contract_billing_term t ON t.id = btu.term_id
    WHERE btu.unit_id = u.id AND t.area = u.area
  )
  AND NOT EXISTS (
    SELECT 1 FROM contract c
    JOIN contract_billing_term t ON t.contract_id = c.id
    WHERE c.unit_id = u.id AND t.area = u.area
  );

-- ────────────────────────────────────────────────────────────────────────────
-- §5 一期D座·天面·楼梯间池(rule 68)补成员(主会话审核补,2026-08-11)
--    S8 记档「0成员池待补名单」闭环:源册=两楼梯间消防照明表(14.8+11.2度)÷4户
--    ×1.11416875,每户 7.24(汤周杰通知单"楼层公共、消防照明"行铁证)。
--    四户=D座除首层的在租户(与两部货梯池成员并集一致):汤周杰131/金纳99/飞度357/
--    一元兰欣112。显式 weight=1.000(std=池额÷4,户=std×1),不走楼层桶。
--    影响:重生成后四户各 +7.24 楼层公共行;汤周杰损耗 base 随之 83.22→约83.36。
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO alloc_rule_member (rule_id, tenant_id, weight, acct_month)
SELECT 68, t.id, 1.000, '' FROM tenant t WHERE t.id IN (131, 99, 357, 112)
  AND NOT EXISTS (SELECT 1 FROM alloc_rule_member m WHERE m.rule_id=68 AND m.tenant_id=t.id);
-- 验证: SELECT COUNT(*)=4 FROM alloc_rule_member WHERE rule_id=68;
