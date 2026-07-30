-- 张文意(tenant 369)段2空壳修复(用户出示纸质合同扫描件 2026-07-29)。
-- 现状:391 C2024M-031(2023-06-13~2026-06-12)5 条计费行齐全 monthly_rent=10109;
--       392 C2024M-032(2026-06-13~2029-06-12)计费行 0 条、rent_area=0、monthly_rent=0 = 空壳。
--       今天已跨进段2 → 该户当期应收为 0,是实打实的账错。
-- 依据(纸约「表内费用」段2 + 表外条款(3)电梯/(B)变压器,标的=一期E座二楼203室 560㎡):
--       厂房租金 6591.20 / 560 = 11.77 元/㎡·月
--       企业管理服务费 3080.00 / 560 = 5.50 元/㎡·月
--       基础设施维护费 1108.80 / 560 = 1.98 元/㎡·月   (表内合计 10780,与纸约全等)
--       电梯维护费 150(该户二楼,承担)+ 变压器维护费 159(表外 B 条,元/月)
--       月额合计 = 10780 + 150 + 159 = 11089.00
-- 另:392 原 link_type='renew' 改 'escalation' —— 它是同一份纸约的第二个价格周期,
--     按递增段拆链范式(翔海 408→409→410→284)应为 escalation。
-- 幂等:先按 contract_id 删 392 既有计费行再插。
START TRANSACTION;

DELETE FROM contract_billing_term WHERE contract_id = 392;

INSERT INTO contract_billing_term
  (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, amount_override, seq, source) VALUES
(392, '一期E座二楼203室', 'factory', 'rent_factory', '厂房租金',         'per_sqm_month', 11.7700, 560.00, 1.0000, NULL,   0, 'manual'),
(392, '一期E座二楼203室', 'factory', 'mgmt',         '厂房企业管理服务费', 'per_sqm_month',  5.5000, 560.00, 1.0000, NULL,   1, 'manual'),
(392, '一期E座二楼203室', 'factory', 'infra',        '厂房基础设施维护费', 'per_sqm_month',  1.9800, 560.00, 1.0000, NULL,   2, 'manual'),
(392, '一期E座二楼203室', 'factory', 'elevator',     '电梯维护费',        'per_month',      0.0000, NULL,   1.0000, 150.00, 3, 'manual'),
(392, '一期E座二楼203室', 'factory', 'transformer',  '变压器维护费',      'per_month',      0.0000, NULL,   1.0000, 159.00, 4, 'manual');

-- 头部只读缓存(照 ContractService.syncScalarCache 口径手工补齐;building_id/unit_id 照 391,kva 保持 50)
UPDATE contract SET
  building_id     = (SELECT building_id FROM (SELECT building_id FROM contract WHERE id=391) t),
  unit_id         = (SELECT unit_id     FROM (SELECT unit_id     FROM contract WHERE id=391) t),
  rent_area       = 560.00,
  building_area   = 448.00,          -- = 560 × 0.8
  unit_price      = 11.7700,
  mgmt_fee_price  = 5.5000,
  infra_fee_price = 1.9800,
  elevator_fee    = 150.00,
  transformer_fee = 159.00,
  monthly_rent    = 11089.00,
  link_type       = 'escalation'
WHERE id = 392;

COMMIT;
