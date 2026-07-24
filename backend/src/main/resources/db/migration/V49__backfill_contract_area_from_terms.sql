-- V49__backfill_contract_area_from_terms.sql — BILL-FORWARD 刀1 返工:面积链路接通(用户裁定 2026-07-22)。
-- 裁定:租金工作簿提取的 term.area 即「租赁面积」→ 回填 contract.rent_area(已有非零值不覆盖);
--      建筑面积走既有 0.8 换算模型(V33 / types/contract.ts:租赁面积=建筑面积÷0.8 ⟺ 建筑面积=租赁面积×0.8)。
-- 取值规则:同费项多行(一户多房间)先组内求和,再取各费项中的最大值(租金/管理费/维护费面积通常相同)。
-- ponytail: 一次性回填存量;此后导入条款的新合同不自动回填,需要时在导入确认链路补。
UPDATE contract c
JOIN (
  SELECT contract_id, MAX(s) AS area FROM (
    SELECT contract_id, fee_name, SUM(area) AS s
    FROM contract_billing_term
    WHERE bill_mode = 'per_sqm_month' AND area IS NOT NULL AND area > 0
    GROUP BY contract_id, fee_name
  ) g GROUP BY contract_id
) t ON t.contract_id = c.id
SET c.rent_area = t.area
WHERE c.rent_area IS NULL OR c.rent_area = 0;

-- 建筑面积=租赁面积×0.8,仅对「有 per_sqm 条款且建筑面积空/0」的合同派生(V33 存量留空原则仅对无条款链路合同继续生效)
UPDATE contract c
JOIN (
  SELECT DISTINCT contract_id FROM contract_billing_term
  WHERE bill_mode = 'per_sqm_month' AND area IS NOT NULL AND area > 0
) t ON t.contract_id = c.id
SET c.building_area = ROUND(c.rent_area * 0.8, 2)
WHERE (c.building_area IS NULL OR c.building_area = 0) AND c.rent_area > 0;
