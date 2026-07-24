-- V54__contract_card_redesign.sql — 合同卡重设计(CONTRACT-CARD-SPEC §4)。
-- 备份见 demo3/backup-before-v54.sql。三处增量:
--   ① contract_billing_term.property_type 段类型(factory|office|dorm|shop|land),段内每行冗余同值;
--   ② contract.parent_contract_id 续签链 FK(ON DELETE SET NULL);
--   ③ status 存储态收敛 4 值,expiring/expired 归一回 active(派生态由 endDate 计算,§5.1)。
-- ponytail: 段 = 同 (contract_id, location) 的行集合,不建段表,property_type 冗余落每行免迁移。

-- ① 段类型列
ALTER TABLE contract_billing_term ADD COLUMN property_type VARCHAR(16) NULL AFTER location;

-- 回填(§4):租金行 fee_key 直接定段类型
UPDATE contract_billing_term SET property_type = CASE fee_key
    WHEN 'rent_factory' THEN 'factory'
    WHEN 'rent_office'  THEN 'office'
    WHEN 'rent_dorm'    THEN 'dorm'
    WHEN 'rent_shop'    THEN 'shop'
    WHEN 'rent_land'    THEN 'land'
  END
WHERE fee_key IN ('rent_factory','rent_office','rent_dorm','rent_shop','rent_land');

-- 非租金行(mgmt/infra/电梯/变压器/土地税…)继承同 (contract_id, location) 组的租金行段类型
UPDATE contract_billing_term t
JOIN (
    SELECT contract_id, location, MAX(property_type) AS pt
    FROM contract_billing_term
    WHERE property_type IS NOT NULL
    GROUP BY contract_id, location
) g ON g.contract_id = t.contract_id AND (g.location <=> t.location)
SET t.property_type = g.pt
WHERE t.property_type IS NULL;

-- 整组无租金行 → factory 兜底
UPDATE contract_billing_term SET property_type = 'factory' WHERE property_type IS NULL;

-- ② 续签链:新合同指向被续签的旧合同(类型须与 contract.id = INT UNSIGNED 完全一致,否则 FK 报 incompatible)
ALTER TABLE contract ADD COLUMN parent_contract_id INT UNSIGNED NULL;
ALTER TABLE contract ADD CONSTRAINT fk_contract_parent
    FOREIGN KEY (parent_contract_id) REFERENCES contract(id) ON DELETE SET NULL;

-- ③ 存储态收敛:expiring/expired 归一回 active(派生桶接管,§5.1);renewed 由后端 renew 写入
UPDATE contract SET status = 'active' WHERE status IN ('expiring','expired');
