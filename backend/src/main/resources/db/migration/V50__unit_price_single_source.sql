-- V50__unit_price_single_source.sql — 租金单价单一事实源（2026-07-23 裁定，BILL-FORWARD 刀1 收尾）。
-- 裁定：租金类条款（厂房/办公室/商铺/宿舍租金等 per_sqm_month 行）的 unit_price 即租金单价的唯一事实源；
--      contract.unit_price（V33 宽表字段）保留为同步副本（月租金联动/续签继承仍消费），写入口双向同步见 ContractService。
-- ① 精度放宽到 4 位小数（条款价如 9.6785，原 DECIMAL(10,2) 同步必失真）。
ALTER TABLE contract MODIFY COLUMN unit_price DECIMAL(12,4) NULL;

-- ② 存量对齐：租金类 per_sqm 条款组内单一价的合同，以条款为准回填/纠正宽表字段；
--    多价并存（一户多房间不同价）不猜不动，无租金条款的合同保持 V33 存量值。
UPDATE contract c
JOIN (
  SELECT contract_id, MIN(unit_price) AS p
  FROM contract_billing_term
  WHERE bill_mode = 'per_sqm_month' AND (fee_key LIKE '%Rent' OR fee_name LIKE '%租金%')
  GROUP BY contract_id
  HAVING COUNT(DISTINCT unit_price) = 1
) t ON t.contract_id = c.id
SET c.unit_price = t.p
WHERE c.unit_price IS NULL OR c.unit_price <> t.p;
