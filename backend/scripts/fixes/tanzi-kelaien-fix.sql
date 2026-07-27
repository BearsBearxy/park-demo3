-- 碳紫/可莱恩 多场地合同拆分修复(用户提供纸约 2026-07-27)。
-- 碳紫=一份纸约两场地(A614/615/622+E104,2023-03~2026-02 递增至 2029-02)+宿舍一座322/323(门禁备注合同期 2024.02-2029.02);
-- 可莱恩=两份纸约(A602含空地 2020-08起 / B201含空地 2022-01起,各自递增,第三段"按市场价商议"非价格段)+宿舍四座6间。
-- 修正要点:空地租金行补回(导入时丢失)、6507"电梯312.5"实为变压器、E104变压器327(通知单含税)按纸约300、
--          C2024M-008(商议段空壳)删除、S10-0013(碳紫冗余空壳)删除、车位类杂费行删除(非签约费项,留待账单杂费类)。
START TRANSACTION;

-- ════════ 可莱恩 ════════
SET @tk = (SELECT id FROM tenant WHERE company_name='可莱恩');
SET @bA = (SELECT id FROM building WHERE name='一期 A座');
SET @bB = (SELECT id FROM building WHERE name='一期 B座');

-- 0. 删"商议段"空壳续签 C2024M-008(2026-08-07~2029-08-06 未签价,不是合同期)
DELETE FROM contract WHERE contract_no='C2024M-008' AND tenant_id=@tk;

-- 1. A602 递增链: S10-0095 = 期2头(2023-08-07~2026-08-06 已有),造期1祖先
INSERT INTO contract (contract_no, tenant_id, building_id, rent_area, monthly_rent, deposit, building_area,
  unit_price, elevator_fee, start_date, end_date, term_text, term_type, status, parent_contract_id, link_type, kind, created_at, updated_at)
VALUES ('S10-0095#1', @tk, @bA, 1528, 33766.00, 0, 1222.40, 17.5, 150,
  '2020-08-07', '2023-08-06', '2020年8月7日至2023年8月6日', 'explicit', 'renewed', NULL, 'new', 'normal', NOW(), NOW());
SET @ka1 = LAST_INSERT_ID();
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, amount_override, seq, source) VALUES
(@ka1, 'A座602室', 'office', 'rent_office', '办公室租金',     'per_sqm_month', 17.5, 1528, 1, NULL,    0, 'manual'),
(@ka1, 'A座602室', 'land',   'rent_land',   '空地租金',       'per_sqm_month', 9,    458,  1, NULL,    1, 'manual'),
(@ka1, 'A座602室', 'office', 'infra',       '基础设施维护费', 'per_month',     0,    1528, 1, 2754,    2, 'manual'),
(@ka1, 'A座602室', 'office', 'elevator',    '电梯维护费',     'per_month',     0,    NULL, 1, 150,     3, 'manual');

-- 头 S10-0095: 只留 A602 行,补空地租金,状态回 active,挂链
UPDATE contract SET status='active', parent_contract_id=@ka1, link_type='escalation', building_id=@bA,
  term_text='2023年8月7日至2026年8月6日', term_type='explicit',
  rent_area=1528, building_area=1222.40, unit_price=19.25, elevator_fee=150, monthly_rent=37127.60
WHERE id=95;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, amount_override, seq, source) VALUES
(95, 'A座602室', 'land', 'rent_land', '空地租金', 'per_sqm_month', 9.9, 458, 1, NULL, 9, 'manual');

-- 2. B201 递增链落到空壳 S10-0005: 期1行(6504-6507)移入祖先,头新建期2行
INSERT INTO contract (contract_no, tenant_id, building_id, rent_area, monthly_rent, deposit, building_area,
  unit_price, elevator_fee, transformer_fee, kva, start_date, end_date, term_text, term_type, status, parent_contract_id, link_type, kind, created_at, updated_at)
VALUES ('S10-0005#1', @tk, @bB, 2700, 65112.50, 0, 2160.00, 16.64, 300, 312.5, 312.5,
  '2022-01-01', '2024-12-31', '2022-01-01 至 2024-12-31', 'explicit', 'renewed', NULL, 'new', 'normal', NOW(), NOW());
SET @kb1 = LAST_INSERT_ID();
UPDATE contract_billing_term SET contract_id=@kb1, source='manual' WHERE id IN (6504,6505,6506,6507);
-- 6504 租金 16.64×2700=44928,纸约明细表=44925 → 直填月额对齐纸约;6507 电梯312.5 实为变压器
UPDATE contract_billing_term SET bill_mode='per_month', amount_override=44925, unit_price=16.64 WHERE id=6504;
UPDATE contract_billing_term SET fee_key='transformer', fee_name='变压器维护费' WHERE id=6507;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, amount_override, seq, source) VALUES
(@kb1, 'B座201室', 'land', 'rent_land', '空地租金', 'per_sqm_month', 10, 1350, 1, NULL, 8, 'manual');

UPDATE contract SET start_date='2025-01-01', end_date='2027-12-31', term_text='2025-01-01 至 2027-12-31', term_type='explicit',
  parent_contract_id=@kb1, link_type='escalation', rent_area=2700, building_area=2160.00,
  unit_price=18.30, elevator_fee=300, transformer_fee=312.5, kva=312.5, monthly_rent=71562.50
WHERE id=5;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, amount_override, seq, source) VALUES
(5, 'B座201室', 'factory', 'rent_factory', '厂房租金',       'per_month',     18.30, 2700, 1, 49417.5, 0, 'manual'),
(5, 'B座201室', 'land',    'rent_land',    '空地租金',       'per_sqm_month', 11,    1350, 1, NULL,    1, 'manual'),
(5, 'B座201室', 'factory', 'infra',        '基础设施维护费', 'per_month',     0,     2700, 1, 6682.5,  2, 'manual'),
(5, 'B座201室', 'factory', 'elevator',     '电梯维护费',     'per_month',     0,     NULL, 1, 300,     3, 'manual'),
(5, 'B座201室', 'factory', 'transformer',  '变压器维护费',   'per_month',     0,     NULL, 1, 312.5,   4, 'manual');

-- 3. 宿舍四座 6 间 → 空壳 S10-0057
UPDATE contract_billing_term SET contract_id=57, source='manual' WHERE id BETWEEN 6508 AND 6519;
UPDATE contract SET rent_area=257.54, building_area=206.03, unit_price=19, monthly_rent=5725.00,
  remark='宿舍期限待人工(门禁备注:430-434室 2024.02.01-2024.07.31;436/438室按年收8.33/间)'
WHERE id=57;

-- 4. 车位变更手续费(一次性杂费,非签约费项)删除
DELETE FROM contract_billing_term WHERE id=6520;

-- ════════ 碳紫 ════════
SET @tt = (SELECT id FROM tenant WHERE company_name='碳紫');
SET @bE = (SELECT id FROM building WHERE name='一期 E座');

-- 5. 删冗余空壳 S10-0013(E104 已在 S10-0107;其 33828.27 为附表10含税口径遗留标量)
DELETE FROM contract WHERE contract_no='S10-0013' AND tenant_id=@tt;

-- 6. 主链(一份纸约两场地): 期1行(6636-6642)移入祖先,变压器 327(通知单含税)按纸约改 300
INSERT INTO contract (contract_no, tenant_id, building_id, rent_area, monthly_rent, deposit, building_area,
  unit_price, mgmt_fee_price, infra_fee_price, elevator_fee, transformer_fee, kva,
  start_date, end_date, term_text, term_type, status, parent_contract_id, link_type, kind, created_at, updated_at)
VALUES ('S10-0107#1', @tt, @bE, 2185.68, 50245.40, 0, 1748.54, 20, 10, 1.8, 159, 300, 300,
  '2023-03-01', '2026-02-28', '2023年03月01日至2026年02月28日', 'explicit', 'renewed', NULL, 'new', 'normal', NOW(), NOW());
SET @tz1 = LAST_INSERT_ID();
UPDATE contract_billing_term SET contract_id=@tz1, source='manual' WHERE id BETWEEN 6636 AND 6642;
UPDATE contract_billing_term SET amount_override=300 WHERE id=6642;

UPDATE contract SET start_date='2026-03-01', end_date='2029-02-28',
  term_text='2026年03月01日至2029年02月28日', term_type='explicit',
  parent_contract_id=@tz1, link_type='escalation', building_id=@bE,
  rent_area=2185.68, building_area=1748.54, unit_price=22, mgmt_fee_price=11, infra_fee_price=1.98,
  elevator_fee=159, transformer_fee=300, kva=300, monthly_rent=55224.04
WHERE id=107;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, amount_override, seq, source) VALUES
(107, 'A座孵化器六楼A614、A615、A622室', 'office',  'rent_office',  '办公室租金',     'per_sqm_month', 22,    212.68, 1, NULL, 0, 'manual'),
(107, 'A座孵化器六楼A614、A615、A622室', 'office',  'mgmt',         '企业管理服务费', 'per_sqm_month', 11,    212.68, 1, NULL, 1, 'manual'),
(107, 'A座孵化器六楼A614、A615、A622室', 'office',  'elevator',     '电梯维护费',     'per_month',     0,     NULL,   1, 159,  2, 'manual'),
(107, '一期E座104室',                    'factory', 'rent_factory', '厂房租金',       'per_sqm_month', 16.72, 1973,   1, NULL, 3, 'manual'),
(107, '一期E座104室',                    'factory', 'mgmt',         '企业管理服务费', 'per_sqm_month', 5.5,   1973,   1, NULL, 4, 'manual'),
(107, '一期E座104室',                    'factory', 'infra',        '基础设施维护费', 'per_sqm_month', 1.98,  1973,   1, NULL, 5, 'manual'),
(107, '一期E座104室',                    'factory', 'transformer',  '变压器维护费',   'per_month',     0,     NULL,   1, 300,  6, 'manual');

-- 7. 宿舍一座322/323 → 空壳 S10-0063,合同期取门禁备注(2024.02.01-2029.02.28)
UPDATE contract_billing_term SET contract_id=63, source='manual' WHERE id BETWEEN 6643 AND 6646;
UPDATE contract SET start_date='2024-02-01', end_date='2029-02-28',
  term_text='合同期:2024.02.01-2029.02.28(门禁设施维护费备注)', term_type='explicit',
  rent_area=72.94, building_area=58.35, unit_price=19, monthly_rent=1648.41
WHERE id=63;

-- 8. 车位租赁400/手续费20(月度杂费,非签约费项)删除
DELETE FROM contract_billing_term WHERE id IN (6647, 6648);

-- 9. 清两户全部陈旧附加单元关联,重跑 reclass 按新行分布重建
DELETE cu FROM contract_unit cu WHERE cu.contract_id IN (5, 57, 95, 107, 63);

COMMIT;

SELECT c.contract_no, c.start_date, c.end_date, c.status, c.link_type, c.kva, c.monthly_rent,
  (SELECT COUNT(*) FROM contract_billing_term b WHERE b.contract_id=c.id) n_lines
FROM contract c JOIN tenant t ON t.id=c.tenant_id WHERE t.company_name IN ('碳紫','可莱恩') ORDER BY t.company_name, c.contract_no;
