-- V58: ①合同↔单元多对多附加关联(BUILDING-RECLASS):一份合同可占多个单元(如"西边301、401、501、601、701单元"),
--       contract.unit_id 仍为主单元,本表只存附加单元;占用状态按并集派生(BuildingService)。
--       注:contract.id/unit.id 均 INT UNSIGNED,FK 同型(V54 踩过);unit 侧 RESTRICT 由 deleteUnit 出中文 409。
CREATE TABLE contract_unit (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  contract_id INT UNSIGNED NOT NULL,
  unit_id     INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cu (contract_id, unit_id),
  KEY idx_cu_unit (unit_id),
  CONSTRAINT fk_cu_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE,
  CONSTRAINT fk_cu_unit FOREIGN KEY (unit_id) REFERENCES unit(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='合同附加单元(主单元在 contract.unit_id)';

-- ②monthly_rent 从计费行派生的一次性回填:importFull 续签子期建时写 0,Phase A 回填计费行后标量未同步,
--   列表/KPI 显示 ¥0 而卡片月合计非 0。此后由 syncScalarCache 在计费行写入时同步维护(镜像 lineMonthly §1.1)。
UPDATE contract c
JOIN (
  SELECT b.contract_id, SUM(m.monthly) monthly FROM contract_billing_term b
  JOIN contract cc ON cc.id=b.contract_id
  JOIN (SELECT id, CASE bill_mode
          WHEN 'per_sqm_month' THEN ROUND(area*unit_price*COALESCE(coeff,1),2)
          WHEN 'per_room_year' THEN ROUND(unit_price*room_count/12,2)
          WHEN 'per_room_month' THEN ROUND(unit_price*room_count,2)
          WHEN 'per_kva_month' THEN NULL
          ELSE amount_override END monthly
        FROM contract_billing_term) m ON m.id=b.id
  GROUP BY b.contract_id
) s ON s.contract_id=c.id
SET c.monthly_rent = COALESCE(s.monthly, 0)
    + COALESCE((SELECT SUM(COALESCE(c.kva,0)) FROM contract_billing_term k
                WHERE k.contract_id=c.id AND k.bill_mode='per_kva_month'), 0);
