-- 宏玥(tenant 117)一合同拆三链 × 两周期 = 6 份合同
-- 依据:用户 2026-08-02 提供的纸质合同扫描件(A619/A203/A216 三块场地,各自租期与递增日不同)
--   A203「A座孵化器二楼203号室」257.3㎡  ①2023-05-01~2025-02-28 租20/管10  ②2025-03-01~2028-02-28 租22/管11
--   A619「A座孵化器六楼619号室」 88.0㎡  ①2022-07-25~2025-07-24 租20/管10  ②2025-07-25~2028-02-28 租22/管11
--   A216「A座孵化器二楼216号室」129.7㎡  ①2022-10-10~2025-10-09 租20/管10  ②2025-10-10~2028-02-28 租22/管11
--   三场地共有:电梯维护费 159/月(非首层)、土地使用税 0.24元/㎡月;A203 独有:变压器维护费 159/月、用电 10KVA(23元/KVA 表外,存 kva 标量)
--   原合同 101 的 13 行计费行(面积/单价/电梯/变压器/土地税)与图纸逐项吻合,只缺日期与 2025 递增段;
--   因三场地租期、递增日互不相同,单合同装不下三套日期 → 按场地拆链(旭化成 asahi-split 同款手术)。
--
-- 验收锚点:期1三链月租合计 8098.75+2820.12+4081.13 = 15000.00(=原 101 的 monthly_rent,分毫不差);
--          期2三链合计 8870.65+3084.12+4470.23 = 16425.00。
--   月租口径=Σ计费行月额(syncScalarCache 单一事实源):租+管+电梯159(+A203 变压器159)+土地税0.24×面积。
--
-- 命名(asahi 惯例:链内统一 #1/#2,链间字母后缀):主链(A203,承 101 就地改造)=S10-0101#1/#2;
--   A619=S10-0101A#1/#2;A216=S10-0101B#1/#2。status 全段 active(人工态;时序由日期派生,asahi 同款)。
-- 单元:A203=unit 390(原主单元不动);A216=unit 393(由 101 的附加单元升为 B 链主单元);
--   A619 无单元 → 补建 unit(13,6F,'619');101 旧附加单元 555(二期31栋6楼61,楼栋重分类误配)一并清除。
-- fee_src 全 manual(图纸核对录入,V51 覆盖律挡导入拍回;且 importFull 对 escalation 链户整行跳过,双保险)。
--
-- 幂等:重跑先删本脚本产物(#2 与 A/B 链全部)并清 101 计费行后整体重建。
-- 前置备份:demo3/backup-before-hongyue-split-20260802.sql

SET NAMES utf8mb4;
START TRANSACTION;

-- ── 1. 清理:本脚本历史产物 + 101 旧计费行 + 101 旧附加单元 ──────────────
DELETE FROM contract WHERE contract_no IN
  ('S10-0101#2','S10-0101A#1','S10-0101A#2','S10-0101B#1','S10-0101B#2');
DELETE FROM contract_billing_term WHERE contract_id = 101;
DELETE FROM contract_unit WHERE contract_id = 101;   -- 393 升为 B 链主单元;555 系误配(二期31栋)

-- ── 2. 补建 A座 6F 619 单元(幂等) ──────────────
INSERT INTO unit (building_id, floor, unit_no, area)
SELECT 13, 6, '619', 0.00 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM unit WHERE building_id = 13 AND unit_no = '619');
SET @u619 = (SELECT id FROM unit WHERE building_id = 13 AND unit_no = '619');

-- ── 3. 主链 A203:101 就地改造为 S10-0101#1(期1) ──────────────
UPDATE contract SET
  contract_no = 'S10-0101#1', unit_id = 390,
  rent_area = 257.30, building_area = 205.84, monthly_rent = 8098.75,
  start_date = '2023-05-01', end_date = '2025-02-28',
  term_type = 'explicit', term_text = '2023年05月01日至2025年02月28日',
  unit_price = 20.0000, mgmt_fee_price = 10.0000,
  elevator_fee = 159.00, transformer_fee = 159.00, kva = 10.00,
  status = 'active', link_type = 'new', parent_contract_id = NULL,
  remark = '宏玥拆链(2026-08-02 图纸核对):原一行三场地拆三链,本行=A203 期1;见 hongyue-split.sql',
  fee_src = '{"area": "manual", "mgmt": "manual", "rent": "manual", "elevator": "manual", "transformer": "manual"}'
WHERE id = 101;

INSERT INTO contract_billing_term
  (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (101, 'A座孵化器二楼203号室', 'office', 'rent_office', '办公室租金',           'per_sqm_month', 20.0000, 257.30, 1.0000, 'manual', NULL,   0),
  (101, 'A座孵化器二楼203号室', 'office', 'mgmt',        '办公室企业管理服务费', 'per_sqm_month', 10.0000, 257.30, 1.0000, 'manual', NULL,   1),
  (101, 'A座孵化器二楼203号室', 'office', 'elevator',    '电梯维护费',           'per_month',      0.0000, NULL,   1.0000, 'manual', 159.00, 2),
  (101, 'A座孵化器二楼203号室', 'office', 'transformer', '变压器维护费',         'per_month',      0.0000, NULL,   1.0000, 'manual', 159.00, 3),
  (101, 'A座孵化器二楼203号室', 'office', 'land_tax',    '土地使用税',           'per_sqm_month',  0.2400, 257.30, 1.0000, 'manual', NULL,   4);

-- A203 期2(递增段,承原号)
INSERT INTO contract
  (contract_no, tenant_id, building_id, unit_id, rent_area, monthly_rent, deposit, start_date, end_date,
   term_type, term_text, status, remark, building_area, unit_price, mgmt_fee_price, elevator_fee, transformer_fee,
   kva, fee_src, parent_contract_id, link_type, kind) VALUES
  ('S10-0101#2', 117, 13, 390, 257.30, 8870.65, 0.00, '2025-03-01', '2028-02-28',
   'explicit', '2023年05月01日至2025年02月28日；2025年03月01日至2028年02月28日', 'active',
   '宏玥拆链:A203 期2 递增段(租22/管11)', 205.84, 22.0000, 11.0000, 159.00, 159.00,
   10.00, '{"area": "manual", "mgmt": "manual", "rent": "manual", "elevator": "manual", "transformer": "manual"}',
   101, 'escalation', 'normal');
SET @a203_2 = LAST_INSERT_ID();
INSERT INTO contract_billing_term
  (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (@a203_2, 'A座孵化器二楼203号室', 'office', 'rent_office', '办公室租金',           'per_sqm_month', 22.0000, 257.30, 1.0000, 'manual', NULL,   0),
  (@a203_2, 'A座孵化器二楼203号室', 'office', 'mgmt',        '办公室企业管理服务费', 'per_sqm_month', 11.0000, 257.30, 1.0000, 'manual', NULL,   1),
  (@a203_2, 'A座孵化器二楼203号室', 'office', 'elevator',    '电梯维护费',           'per_month',      0.0000, NULL,   1.0000, 'manual', 159.00, 2),
  (@a203_2, 'A座孵化器二楼203号室', 'office', 'transformer', '变压器维护费',         'per_month',      0.0000, NULL,   1.0000, 'manual', 159.00, 3),
  (@a203_2, 'A座孵化器二楼203号室', 'office', 'land_tax',    '土地使用税',           'per_sqm_month',  0.2400, 257.30, 1.0000, 'manual', NULL,   4);

-- ── 4. A 链 A619:S10-0101A#1(期1) + #2(递增段) ──────────────
INSERT INTO contract
  (contract_no, tenant_id, building_id, unit_id, rent_area, monthly_rent, deposit, start_date, end_date,
   term_type, term_text, status, remark, building_area, unit_price, mgmt_fee_price, elevator_fee, transformer_fee,
   kva, fee_src, parent_contract_id, link_type, kind) VALUES
  ('S10-0101A#1', 117, 13, @u619, 88.00, 2820.12, 0.00, '2022-07-25', '2025-07-24',
   'explicit', '2022年07月25日至2025年07月24日', 'active',
   '宏玥拆链:A619 期1(单元 619 本次补建)', 70.40, 20.0000, 10.0000, 159.00, NULL,
   NULL, '{"area": "manual", "mgmt": "manual", "rent": "manual", "elevator": "manual"}',
   NULL, 'new', 'normal');
SET @a619_1 = LAST_INSERT_ID();
INSERT INTO contract_billing_term
  (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (@a619_1, 'A座孵化器六楼619号室', 'office', 'rent_office', '办公室租金',           'per_sqm_month', 20.0000, 88.00, 1.0000, 'manual', NULL,   0),
  (@a619_1, 'A座孵化器六楼619号室', 'office', 'mgmt',        '办公室企业管理服务费', 'per_sqm_month', 10.0000, 88.00, 1.0000, 'manual', NULL,   1),
  (@a619_1, 'A座孵化器六楼619号室', 'office', 'elevator',    '电梯维护费',           'per_month',      0.0000, NULL,  1.0000, 'manual', 159.00, 2),
  (@a619_1, 'A座孵化器六楼619号室', 'office', 'land_tax',    '土地使用税',           'per_sqm_month',  0.2400, 88.00, 1.0000, 'manual', NULL,   3);

INSERT INTO contract
  (contract_no, tenant_id, building_id, unit_id, rent_area, monthly_rent, deposit, start_date, end_date,
   term_type, term_text, status, remark, building_area, unit_price, mgmt_fee_price, elevator_fee, transformer_fee,
   kva, fee_src, parent_contract_id, link_type, kind) VALUES
  ('S10-0101A#2', 117, 13, @u619, 88.00, 3084.12, 0.00, '2025-07-25', '2028-02-28',
   'explicit', '2022年07月25日至2025年07月24日；2025年07月25日至2028年02月28日', 'active',
   '宏玥拆链:A619 期2 递增段(租22/管11)', 70.40, 22.0000, 11.0000, 159.00, NULL,
   NULL, '{"area": "manual", "mgmt": "manual", "rent": "manual", "elevator": "manual"}',
   @a619_1, 'escalation', 'normal');
SET @a619_2 = LAST_INSERT_ID();
INSERT INTO contract_billing_term
  (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (@a619_2, 'A座孵化器六楼619号室', 'office', 'rent_office', '办公室租金',           'per_sqm_month', 22.0000, 88.00, 1.0000, 'manual', NULL,   0),
  (@a619_2, 'A座孵化器六楼619号室', 'office', 'mgmt',        '办公室企业管理服务费', 'per_sqm_month', 11.0000, 88.00, 1.0000, 'manual', NULL,   1),
  (@a619_2, 'A座孵化器六楼619号室', 'office', 'elevator',    '电梯维护费',           'per_month',      0.0000, NULL,  1.0000, 'manual', 159.00, 2),
  (@a619_2, 'A座孵化器六楼619号室', 'office', 'land_tax',    '土地使用税',           'per_sqm_month',  0.2400, 88.00, 1.0000, 'manual', NULL,   3);

-- ── 5. B 链 A216:S10-0101B#1(期1) + #2(递增段);unit 393 升主单元 ──────────────
INSERT INTO contract
  (contract_no, tenant_id, building_id, unit_id, rent_area, monthly_rent, deposit, start_date, end_date,
   term_type, term_text, status, remark, building_area, unit_price, mgmt_fee_price, elevator_fee, transformer_fee,
   kva, fee_src, parent_contract_id, link_type, kind) VALUES
  ('S10-0101B#1', 117, 13, 393, 129.70, 4081.13, 0.00, '2022-10-10', '2025-10-09',
   'explicit', '2022年10月10日至2025年10月09日', 'active',
   '宏玥拆链:A216 期1', 103.76, 20.0000, 10.0000, 159.00, NULL,
   NULL, '{"area": "manual", "mgmt": "manual", "rent": "manual", "elevator": "manual"}',
   NULL, 'new', 'normal');
SET @a216_1 = LAST_INSERT_ID();
INSERT INTO contract_billing_term
  (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (@a216_1, 'A座孵化器二楼216号室', 'office', 'rent_office', '办公室租金',           'per_sqm_month', 20.0000, 129.70, 1.0000, 'manual', NULL,   0),
  (@a216_1, 'A座孵化器二楼216号室', 'office', 'mgmt',        '办公室企业管理服务费', 'per_sqm_month', 10.0000, 129.70, 1.0000, 'manual', NULL,   1),
  (@a216_1, 'A座孵化器二楼216号室', 'office', 'elevator',    '电梯维护费',           'per_month',      0.0000, NULL,   1.0000, 'manual', 159.00, 2),
  (@a216_1, 'A座孵化器二楼216号室', 'office', 'land_tax',    '土地使用税',           'per_sqm_month',  0.2400, 129.70, 1.0000, 'manual', NULL,   3);

INSERT INTO contract
  (contract_no, tenant_id, building_id, unit_id, rent_area, monthly_rent, deposit, start_date, end_date,
   term_type, term_text, status, remark, building_area, unit_price, mgmt_fee_price, elevator_fee, transformer_fee,
   kva, fee_src, parent_contract_id, link_type, kind) VALUES
  ('S10-0101B#2', 117, 13, 393, 129.70, 4470.23, 0.00, '2025-10-10', '2028-02-28',
   'explicit', '2022年10月10日至2025年10月09日；2025年10月10日至2028年02月28日', 'active',
   '宏玥拆链:A216 期2 递增段(租22/管11)', 103.76, 22.0000, 11.0000, 159.00, NULL,
   NULL, '{"area": "manual", "mgmt": "manual", "rent": "manual", "elevator": "manual"}',
   @a216_1, 'escalation', 'normal');
SET @a216_2 = LAST_INSERT_ID();
INSERT INTO contract_billing_term
  (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (@a216_2, 'A座孵化器二楼216号室', 'office', 'rent_office', '办公室租金',           'per_sqm_month', 22.0000, 129.70, 1.0000, 'manual', NULL,   0),
  (@a216_2, 'A座孵化器二楼216号室', 'office', 'mgmt',        '办公室企业管理服务费', 'per_sqm_month', 11.0000, 129.70, 1.0000, 'manual', NULL,   1),
  (@a216_2, 'A座孵化器二楼216号室', 'office', 'elevator',    '电梯维护费',           'per_month',      0.0000, NULL,   1.0000, 'manual', 159.00, 2),
  (@a216_2, 'A座孵化器二楼216号室', 'office', 'land_tax',    '土地使用税',           'per_sqm_month',  0.2400, 129.70, 1.0000, 'manual', NULL,   3);

COMMIT;

-- ── 验收 ──────────────
SELECT c.id, c.contract_no, c.link_type, c.status, c.start_date, c.end_date,
       c.rent_area, c.monthly_rent, c.unit_id, c.parent_contract_id,
       (SELECT COUNT(*) FROM contract_billing_term t WHERE t.contract_id = c.id) AS term_rows
FROM contract c WHERE c.tenant_id = 117 ORDER BY c.contract_no;
SELECT SUM(CASE WHEN contract_no LIKE '%#1' THEN monthly_rent END) AS 期1合计_应为15000,
       SUM(CASE WHEN contract_no LIKE '%#2' THEN monthly_rent END) AS 期2合计_应为16425
FROM contract WHERE tenant_id = 117;
