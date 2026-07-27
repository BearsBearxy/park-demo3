-- 仁恒(智研新材料)三合同拆分修复(用户报告 2026-07-27)。根因:2024-03 汇总导入按租户归拢,
-- 三份纸合同(A311-313 / A315 / C座207)+两间宿舍全部标的段被塞进 S10-0103,且租期错挂 C座的。
-- 目标(按纸质合同+2024-03通知单):
--   S10-0103 = A311-313 递增链: #1(2022-06-01~2025-05-31,20/10) ← 头(2025-06-01~2028-05-31,22/11)+电梯159+变压器159+土地税0.24
--   C2024M-042 = A315 递增链:  #1(2022-09-14~2025-09-13,20/10) ← 头(2025-09-14~2028-05-31,22/11)+电梯100+土地税0.24
--   S10-0062 = 宿舍(新俊楼一座409/503 八行移入;期限待人工,门禁备注 503=2023.12.06-2024.12.31/409=2024.02.01-2025.01.31)
--   S10-0009 = C座207: 补租期 2023-10-17~2026-10-16 + 六行(租金14/管理5/基础2/变压器50/电梯50) + 押金3841;kva 6.25 原位正确
START TRANSACTION;

SET @tid = (SELECT id FROM tenant WHERE company_name='仁恒');
SET @a = (SELECT id FROM building WHERE name='一期 A座');

-- ── 1. A311-313 递增链祖先 S10-0103#1(期1) ──
INSERT INTO contract (contract_no, tenant_id, building_id, rent_area, monthly_rent, deposit, building_area,
  unit_price, mgmt_fee_price, elevator_fee, transformer_fee, start_date, end_date,
  term_text, term_type, status, parent_contract_id, link_type, kind, created_at, updated_at)
VALUES ('S10-0103#1', @tid, @a, 411.55, 12763.27, 0, 329.24, 20, 10, 159, 159,
  '2022-06-01', '2025-05-31', '2022年06月01日至2025年05月31日', 'explicit', 'renewed', NULL, 'new', 'normal', NOW(), NOW());
SET @p1 = LAST_INSERT_ID();

-- 期1 计费行 = 原 import 行(6582-6586,本就是期1价 20/10)整体移挂祖先,标 manual 防重导清除
UPDATE contract_billing_term SET contract_id=@p1, source='manual' WHERE id IN (6582,6583,6584,6585,6586);

-- 头 S10-0103 改为期2:租期/原文/价格
UPDATE contract SET start_date='2025-06-01', end_date='2028-05-31',
  term_text='2025年06月01日至2028年05月31日', parent_contract_id=@p1, link_type='escalation',
  unit_price=22, mgmt_fee_price=11, rent_area=411.55, building_area=329.24, monthly_rent=13997.92
WHERE id=103;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, amount_override, seq, source) VALUES
(103, 'A座孵化器三楼311、312、313室', 'office', 'rent_office', '办公室租金',       'per_sqm_month', 22,   411.55, 1, NULL,   0, 'manual'),
(103, 'A座孵化器三楼311、312、313室', 'office', 'mgmt',        '企业管理服务费',   'per_sqm_month', 11,   411.55, 1, NULL,   1, 'manual'),
(103, 'A座孵化器三楼311、312、313室', 'office', 'elevator',    '电梯维护费',       'per_month',     0,    NULL,   1, 159,    2, 'manual'),
(103, 'A座孵化器三楼311、312、313室', 'office', 'transformer', '变压器维护费',     'per_month',     0,    NULL,   1, 159,    3, 'manual'),
(103, 'A座孵化器三楼311、312、313室', 'office', 'land_tax',    '土地使用税',       'per_sqm_month', 0.24, 411.55, 1, NULL,   4, 'manual');

-- ── 2. A315 递增链(新链) ──
INSERT INTO contract (contract_no, tenant_id, building_id, rent_area, monthly_rent, deposit, building_area,
  unit_price, mgmt_fee_price, elevator_fee, start_date, end_date, term_text, term_type,
  status, parent_contract_id, link_type, kind, created_at, updated_at)
VALUES ('C2024M-042#1', @tid, @a, 157.56, 4864.61, 0, 126.05, 20, 10, 100,
  '2022-09-14', '2025-09-13', '2022年09月14日至2025年09月13日', 'explicit', 'renewed', NULL, 'new', 'normal', NOW(), NOW());
SET @p315 = LAST_INSERT_ID();
-- 期1 行 = 原 import 行(6587-6590)移挂
UPDATE contract_billing_term SET contract_id=@p315, source='manual' WHERE id IN (6587,6588,6589,6590);

INSERT INTO contract (contract_no, tenant_id, building_id, rent_area, monthly_rent, deposit, building_area,
  unit_price, mgmt_fee_price, elevator_fee, start_date, end_date, term_text, term_type,
  status, parent_contract_id, link_type, kind, created_at, updated_at)
VALUES ('C2024M-042', @tid, @a, 157.56, 5337.29, 0, 126.05, 22, 11, 100,
  '2025-09-14', '2028-05-31', '2025年09月14日至2028年05月31日', 'explicit', 'active', @p315, 'escalation', 'normal', NOW(), NOW());
SET @h315 = LAST_INSERT_ID();
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, amount_override, seq, source) VALUES
(@h315, 'A座孵化器三楼315室', 'office', 'rent_office', '办公室租金',     'per_sqm_month', 22,   157.56, 1, NULL, 0, 'manual'),
(@h315, 'A座孵化器三楼315室', 'office', 'mgmt',        '企业管理服务费', 'per_sqm_month', 11,   157.56, 1, NULL, 1, 'manual'),
(@h315, 'A座孵化器三楼315室', 'office', 'elevator',    '电梯维护费',     'per_month',     0,    NULL,   1, 100,  2, 'manual'),
(@h315, 'A座孵化器三楼315室', 'office', 'land_tax',    '土地使用税',     'per_sqm_month', 0.24, 157.56, 1, NULL, 3, 'manual');

-- ── 3. 宿舍八行移入 S10-0062 ──
UPDATE contract_billing_term SET contract_id=62, source='manual' WHERE id IN (6591,6592,6593,6594,6595,6596,6597,6598);
UPDATE contract SET rent_area=82.55, building_area=66.04, unit_price=19, monthly_rent=1850.21,
  remark='宿舍期限待人工补录(门禁备注:503室2023.12.06-2024.12.31;409室2024.02.01-2025.01.31)'
WHERE id=62;

-- ── 4. C座207 补全 S10-0009 ──
UPDATE contract SET start_date='2023-10-17', end_date='2026-10-16',
  term_text='2023年10月17日起至2026年10月16日止', term_type='explicit', deposit=3841,
  rent_area=91.43, building_area=73.14, unit_price=14, mgmt_fee_price=5, infra_fee_price=2,
  elevator_fee=50, transformer_fee=50, monthly_rent=2020.03
WHERE id=9;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, amount_override, seq, source) VALUES
(9, '一期C座二楼207室', 'factory', 'rent_factory', '厂房租金',          'per_sqm_month', 14, 91.43, 1, NULL, 0, 'manual'),
(9, '一期C座二楼207室', 'factory', 'mgmt',         '企业管理服务费',    'per_sqm_month', 5,  91.43, 1, NULL, 1, 'manual'),
(9, '一期C座二楼207室', 'factory', 'infra',        '基础设施维护费',    'per_sqm_month', 2,  91.43, 1, NULL, 2, 'manual'),
(9, '一期C座二楼207室', 'factory', 'transformer',  '变压器维护费',      'per_month',     0,  NULL,  1, 50,   3, 'manual'),
(9, '一期C座二楼207室', 'factory', 'elevator',     '电梯维护费',        'per_month',     0,  NULL,  1, 50,   4, 'manual');

-- ── 5. 清 S10-0103 的陈旧附加单元(315/409/503 已随行移走;312/313 保留),重跑 reclass 会补新关联 ──
DELETE cu FROM contract_unit cu JOIN unit u ON u.id=cu.unit_id
WHERE cu.contract_id=103 AND u.unit_no IN ('315','409','503');

COMMIT;

SELECT c.contract_no, c.start_date, c.end_date, c.status, c.link_type, c.monthly_rent,
  (SELECT COUNT(*) FROM contract_billing_term b WHERE b.contract_id=c.id) n_lines
FROM contract c JOIN tenant t ON t.id=c.tenant_id WHERE t.company_name='仁恒' ORDER BY c.contract_no;
