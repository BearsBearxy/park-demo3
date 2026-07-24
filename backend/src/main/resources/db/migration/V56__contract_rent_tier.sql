-- V56__contract_rent_tier.sql — 租金阶梯期(CONTRACT-CARD-V2-SPEC §2)。
-- 运行模型(§1):阶梯表=参考排程,人工据此换档改合同现行单价;催缴单仍按合同派生,本表不参与计费。
--   fee_key 空=整份合同合计口径;非空=该费项阶梯(力灏式各费项各自分档)
--   start/end 可空=相对期限(如「竣工验收次日起计九年」),此时靠 label 表达且不判定当前段
-- 注:contract.id 是 INT UNSIGNED,contract_id 必须同类型,否则 FK 报 incompatible(V54 踩过)。
CREATE TABLE contract_rent_tier (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  contract_id    INT UNSIGNED NOT NULL,
  fee_key        VARCHAR(24)   NULL,
  seq            INT NOT NULL,
  label          VARCHAR(64)   NULL,
  start_date     DATE          NULL,
  end_date       DATE          NULL,
  unit_price     DECIMAL(10,4) NULL,
  monthly_amount DECIMAL(12,2) NULL,
  note           VARCHAR(255)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tier (contract_id, fee_key, seq),
  CONSTRAINT fk_tier_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='合同租金阶梯期(参考排程,不参与计费)';
