-- 博浩/翔海/次生代/黎镇源/思汗 五户修复(纸约 2026-07-27)。要点:
-- 博浩: S10-0080 链=F401 合同(挂错宿舍四栋);按纸约不含税价重定三段(11/12.1/13.915),补管理5/5.5/6.325+基础2/2.2/2.53+电梯318+变压器625,
--       kVA625 整链,#1 段免租装修期 2023-10-12~2024-03-11;删冗余空壳 S10-0029。(通知单=纸约×1.128租税/×1.03费税,合同存纸约价)
-- 翔海: VERIFY-XH-01 拆四段链(2017/2020/2023/2026 每三年+10%),单价×套内×系数1.56;基础1.45/空地10 恒定(假定);电梯/变压器豁免行删;kVA2130。
-- 次生代: 宿舍307/314 → 空壳 S10-0058(门禁备注期 2024.02-2025.01);kVA25(容量费0元/KVA 纸约明示);删冗余空壳 S10-0097。
-- 黎镇源: 701 无租金只维护费;C2024M-020=期2(基础2.156)补行,链改 escalation;宿舍648 → 新 C2024M-043;删 0 值占位行。
-- 思汗: S10-0003 补 F101 六行(2022-10-18~2024-10-17 已到期真实态);S10-0053 宿舍修价 19 + 补基础/门禁/网络,期取门禁备注 2024.02-2026.01。
START TRANSACTION;

-- ═══ A. 博浩 ═══
SET @tb = (SELECT id FROM tenant WHERE company_name='博浩');
SET @bF = (SELECT id FROM building WHERE name='一期 F座');
DELETE FROM contract WHERE contract_no='S10-0029' AND tenant_id=@tb;
UPDATE contract SET building_id=@bF, kva=625, unit_price=11,    mgmt_fee_price=5,    infra_fee_price=2,
  elevator_fee=318, transformer_fee=625, rent_area=3200, building_area=2560,
  rent_free='[{"start":"2023-10-12","end":"2024-03-11","note":"装修期免租"}]' WHERE contract_no='S10-0080#1';
UPDATE contract SET building_id=@bF, kva=625, unit_price=12.1,  mgmt_fee_price=5.5,  infra_fee_price=2.2,
  elevator_fee=318, transformer_fee=625, rent_area=3200, building_area=2560 WHERE contract_no='S10-0080#2';
UPDATE contract SET building_id=@bF, kva=625, unit_price=13.915, mgmt_fee_price=6.325, infra_fee_price=2.53,
  elevator_fee=318, transformer_fee=625, rent_area=3200, building_area=2560 WHERE contract_no='S10-0080';
UPDATE contract_billing_term SET unit_price=11     WHERE id=7097;  -- #1 租金(纸约不含税)
UPDATE contract_billing_term SET unit_price=12.1   WHERE id=7098;  -- #2
UPDATE contract_billing_term SET unit_price=13.915 WHERE id=6735;  -- 头(期3)
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, amount_override, seq, source)
SELECT c.id, '一期F座四楼401室', 'factory', f.fk, f.fn, f.bm, f.up, f.ar, 1, f.ao, f.sq, 'manual'
FROM contract c JOIN (
  SELECT 'S10-0080#1' no, 'mgmt' fk, '企业管理服务费' fn, 'per_sqm_month' bm, 5 up, 3200 ar, NULL ao, 1 sq UNION ALL
  SELECT 'S10-0080#1','infra','基础设施维护费','per_sqm_month',2,3200,NULL,2 UNION ALL
  SELECT 'S10-0080#1','elevator','电梯维护费','per_month',0,NULL,318,3 UNION ALL
  SELECT 'S10-0080#1','transformer','变压器维护费','per_month',0,NULL,625,4 UNION ALL
  SELECT 'S10-0080#2','mgmt','企业管理服务费','per_sqm_month',5.5,3200,NULL,1 UNION ALL
  SELECT 'S10-0080#2','infra','基础设施维护费','per_sqm_month',2.2,3200,NULL,2 UNION ALL
  SELECT 'S10-0080#2','elevator','电梯维护费','per_month',0,NULL,318,3 UNION ALL
  SELECT 'S10-0080#2','transformer','变压器维护费','per_month',0,NULL,625,4 UNION ALL
  SELECT 'S10-0080','mgmt','企业管理服务费','per_sqm_month',6.325,3200,NULL,1 UNION ALL
  SELECT 'S10-0080','infra','基础设施维护费','per_sqm_month',2.53,3200,NULL,2 UNION ALL
  SELECT 'S10-0080','elevator','电梯维护费','per_month',0,NULL,318,3 UNION ALL
  SELECT 'S10-0080','transformer','变压器维护费','per_month',0,NULL,625,4
) f ON f.no=c.contract_no;

-- ═══ B. 翔海 ═══
SET @tx = (SELECT id FROM tenant WHERE company_name='翔海');
SET @bG = (SELECT id FROM building WHERE name='一期 G座');
DELETE FROM contract_billing_term WHERE contract_id=284;   -- 旧 11 行(系数并入价的合并口径)整组重建
INSERT INTO contract (contract_no, tenant_id, building_id, rent_area, monthly_rent, deposit, building_area, unit_price, infra_fee_price,
  kva, start_date, end_date, term_text, term_type, status, parent_contract_id, link_type, kind, created_at, updated_at)
VALUES ('VERIFY-XH-01#1', @tx, @bG, 14124, 0, 0, 11299.20, 10, 1.45, 2130,
  '2017-08-14', '2020-08-13', '2017年8月14日至2020年8月13日(首层13/二层11/三四层10,×套内×1.56)', 'explicit', 'renewed', NULL, 'new', 'normal', NOW(), NOW());
SET @x1 = LAST_INSERT_ID();
INSERT INTO contract (contract_no, tenant_id, building_id, rent_area, monthly_rent, deposit, building_area, unit_price, infra_fee_price,
  kva, start_date, end_date, term_text, term_type, status, parent_contract_id, link_type, kind, created_at, updated_at)
VALUES ('VERIFY-XH-01#2', @tx, @bG, 14124, 0, 0, 11299.20, 11, 1.45, 2130,
  '2020-08-14', '2023-08-13', '2020年8月14日至2023年8月13日(每三年递增10%)', 'explicit', 'renewed', @x1, 'escalation', 'normal', NOW(), NOW());
SET @x2 = LAST_INSERT_ID();
INSERT INTO contract (contract_no, tenant_id, building_id, rent_area, monthly_rent, deposit, building_area, unit_price, infra_fee_price,
  kva, start_date, end_date, term_text, term_type, status, parent_contract_id, link_type, kind, created_at, updated_at)
VALUES ('VERIFY-XH-01#3', @tx, @bG, 14124, 0, 0, 11299.20, 12.1, 1.45, 2130,
  '2023-08-14', '2026-08-13', '2023年8月14日至2026年8月13日(现行段,与2024-03通知单全等)', 'explicit', 'renewed', @x2, 'escalation', 'normal', NOW(), NOW());
SET @x3 = LAST_INSERT_ID();
UPDATE contract SET start_date='2026-08-14', end_date='2027-08-13', parent_contract_id=@x3, link_type='escalation',
  term_text='2026年8月14日至2027年8月13日(末段,再+10%)', term_type='explicit',
  rent_area=14124, building_area=11299.20, unit_price=13.31, infra_fee_price=1.45, kva=2130 WHERE id=284;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, seq, source)
SELECT cid, loc, pt, fk, fn, 'per_sqm_month', up, ar, cf, sq, 'manual' FROM (
  SELECT @x1 cid,'E座3-4层' loc,'factory' pt,'rent_factory' fk,'厂房租金' fn,10 up,4708 ar,1.56 cf,0 sq UNION ALL
  SELECT @x1,'G座1层','factory','rent_factory','厂房租金',13,2354,1.56,1 UNION ALL
  SELECT @x1,'G座2层','factory','rent_factory','厂房租金',11,2354,1.56,2 UNION ALL
  SELECT @x1,'G座3-4层','factory','rent_factory','厂房租金',10,4708,1.56,3 UNION ALL
  SELECT @x1,'E座3-4层','factory','infra','基础设施维护费',1.45,4708,1.56,4 UNION ALL
  SELECT @x1,'G座1-4层','factory','infra','基础设施维护费',1.45,9416,1.56,5 UNION ALL
  SELECT @x1,'空地一','land','rent_land','空地租金',10,280,1,6 UNION ALL
  SELECT @x1,'空地二','land','rent_land','空地租金',10,208.8,1,7 UNION ALL
  SELECT @x2,'E座3-4层','factory','rent_factory','厂房租金',11,4708,1.56,0 UNION ALL
  SELECT @x2,'G座1层','factory','rent_factory','厂房租金',14.3,2354,1.56,1 UNION ALL
  SELECT @x2,'G座2层','factory','rent_factory','厂房租金',12.1,2354,1.56,2 UNION ALL
  SELECT @x2,'G座3-4层','factory','rent_factory','厂房租金',11,4708,1.56,3 UNION ALL
  SELECT @x2,'E座3-4层','factory','infra','基础设施维护费',1.45,4708,1.56,4 UNION ALL
  SELECT @x2,'G座1-4层','factory','infra','基础设施维护费',1.45,9416,1.56,5 UNION ALL
  SELECT @x2,'空地一','land','rent_land','空地租金',10,280,1,6 UNION ALL
  SELECT @x2,'空地二','land','rent_land','空地租金',10,208.8,1,7 UNION ALL
  SELECT @x3,'E座3-4层','factory','rent_factory','厂房租金',12.1,4708,1.56,0 UNION ALL
  SELECT @x3,'G座1层','factory','rent_factory','厂房租金',15.73,2354,1.56,1 UNION ALL
  SELECT @x3,'G座2层','factory','rent_factory','厂房租金',13.31,2354,1.56,2 UNION ALL
  SELECT @x3,'G座3-4层','factory','rent_factory','厂房租金',12.1,4708,1.56,3 UNION ALL
  SELECT @x3,'E座3-4层','factory','infra','基础设施维护费',1.45,4708,1.56,4 UNION ALL
  SELECT @x3,'G座1-4层','factory','infra','基础设施维护费',1.45,9416,1.56,5 UNION ALL
  SELECT @x3,'空地一','land','rent_land','空地租金',10,280,1,6 UNION ALL
  SELECT @x3,'空地二','land','rent_land','空地租金',10,208.8,1,7 UNION ALL
  SELECT 284,'E座3-4层','factory','rent_factory','厂房租金',13.31,4708,1.56,0 UNION ALL
  SELECT 284,'G座1层','factory','rent_factory','厂房租金',17.303,2354,1.56,1 UNION ALL
  SELECT 284,'G座2层','factory','rent_factory','厂房租金',14.641,2354,1.56,2 UNION ALL
  SELECT 284,'G座3-4层','factory','rent_factory','厂房租金',13.31,4708,1.56,3 UNION ALL
  SELECT 284,'E座3-4层','factory','infra','基础设施维护费',1.45,4708,1.56,4 UNION ALL
  SELECT 284,'G座1-4层','factory','infra','基础设施维护费',1.45,9416,1.56,5 UNION ALL
  SELECT 284,'空地一','land','rent_land','空地租金',10,280,1,6 UNION ALL
  SELECT 284,'空地二','land','rent_land','空地租金',10,208.8,1,7
) L;

-- ═══ C. 次生代 ═══
SET @tc = (SELECT id FROM tenant WHERE company_name='次生代');
DELETE FROM contract WHERE contract_no='S10-0097' AND tenant_id=@tc;
UPDATE contract_billing_term SET contract_id=58, source='manual' WHERE id IN (6535,6536,6537,6538);
UPDATE contract SET start_date='2024-02-01', end_date='2025-01-31',
  term_text='合同期:2024.02.01-2025.01.31(门禁设施维护费备注)', term_type='explicit',
  rent_area=73.06, building_area=58.45, unit_price=19 WHERE id=58;
UPDATE contract SET kva=25 WHERE id=132;   -- 纸约:25kVA,基本用电费0元/KVA(容量费免)

-- ═══ D. 黎镇源 ═══
SET @tl = (SELECT id FROM tenant WHERE company_name='黎镇源');
SET @bS4 = (SELECT id FROM building WHERE name='一期 宿舍四栋');
DELETE FROM contract_billing_term WHERE id IN (7062, 7063);   -- 0 值占位租金/管理行
INSERT INTO contract (contract_no, tenant_id, building_id, rent_area, monthly_rent, deposit, building_area, unit_price,
  start_date, end_date, term_text, status, parent_contract_id, link_type, kind, created_at, updated_at)
VALUES ('C2024M-043', @tl, @bS4, 44.20, 0, 0, 35.36, 19,
  NULL, NULL, '宿舍期限待人工(648室,门禁按年收8.33/间)', 'active', NULL, 'new', 'normal', NOW(), NOW());
SET @ld = LAST_INSERT_ID();
UPDATE contract_billing_term SET contract_id=@ld WHERE id IN (7064,7065,7066,7067);
UPDATE contract SET link_type='escalation' WHERE contract_no='C2024M-020';   -- 同约期2,非换约
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, amount_override, seq, source)
SELECT c.id, '二期8号楼（1车间）701单元', 'factory', f.fk, f.fn, f.bm, f.up, f.ar, 1, f.ao, f.sq, 'manual'
FROM contract c JOIN (
  SELECT 'infra' fk,'基础设施维护费' fn,'per_sqm_month' bm,2.156 up,1200 ar,NULL ao,0 sq UNION ALL
  SELECT 'transformer','变压器维护费','per_month',0,NULL,159,1 UNION ALL
  SELECT 'elevator','电梯维护费','per_month',0,NULL,477,2
) f WHERE c.contract_no='C2024M-020';
UPDATE contract SET infra_fee_price=2.156, elevator_fee=477, transformer_fee=159, rent_area=1200, building_area=960
WHERE contract_no='C2024M-020';
UPDATE contract SET infra_fee_price=1.96, elevator_fee=477, transformer_fee=159, rent_area=1200, building_area=960
WHERE contract_no='C2024M-007';

-- ═══ E. 思汗 ═══
UPDATE contract SET start_date='2022-10-18', end_date='2024-10-17',
  term_text='2022年10月18日起至2024年10月17日', term_type='explicit',
  rent_area=2700, building_area=2160, unit_price=22.32, infra_fee_price=1.59, transformer_fee=350
WHERE id=3;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, amount_override, seq, source) VALUES
(3, 'F座首层101室', 'factory', 'rent_factory', '厂房租金',       'per_sqm_month', 22.32, 2700, 1, NULL, 0, 'manual'),
(3, 'F座首层101室', 'land',    'rent_land',    '空地租金',       'per_sqm_month', 10.9,  810,  1, NULL, 1, 'manual'),
(3, 'F座首层101室', 'factory', 'infra',        '基础设施维护费', 'per_sqm_month', 1.59,  3510, 1, NULL, 2, 'manual'),
(3, 'F座首层101室', 'factory', 'transformer',  '变压器维护费',   'per_month',     0,     NULL, 1, 350,  3, 'manual');
UPDATE contract_billing_term SET unit_price=19, source='manual' WHERE id=3394;   -- 宿舍租金价 0→19
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, amount_override, seq, source) VALUES
(53, '宿舍新俊楼一座216、218、220、222室', 'dorm', 'infra',   '基础设施维护费', 'per_sqm_month', 2,   146.12, 1, NULL,  1, 'manual'),
(53, '宿舍新俊楼一座216、218、220、222室', 'dorm', 'access',  '门禁设施维护费', 'per_month',     0,   NULL,   1, 33.33, 2, 'manual'),
(53, '宿舍新俊楼一座216、218、220、222室', 'dorm', 'network', '网络通讯费',     'per_month',     0,   NULL,   1, 200,   3, 'manual');
UPDATE contract SET start_date='2024-02-01', end_date='2026-01-31',
  term_text='合同期:2024.02.01-2026.01.31(门禁设施维护费备注)', term_type='explicit',
  rent_area=146.12, building_area=116.90, unit_price=19 WHERE id=53;

-- ═══ F. 收尾:月租重算 + 陈旧单元关联清理 ═══
UPDATE contract c JOIN (
  SELECT b.contract_id, SUM(CASE b.bill_mode
      WHEN 'per_sqm_month' THEN ROUND(b.area*b.unit_price*COALESCE(b.coeff,1),2)
      WHEN 'per_room_year' THEN ROUND(b.unit_price*b.room_count/12,2)
      WHEN 'per_room_month' THEN ROUND(b.unit_price*b.room_count,2)
      WHEN 'per_kva_month' THEN NULL ELSE b.amount_override END) m
  FROM contract_billing_term b GROUP BY b.contract_id
) s ON s.contract_id=c.id SET c.monthly_rent=COALESCE(s.m,0)
WHERE c.id IN (3, 53, 58, 80, 132, 284, 302, 334, 335, @x1, @x2, @x3, @ld)
   OR c.contract_no IN ('C2024M-020');
DELETE cu FROM contract_unit cu WHERE cu.contract_id IN (3, 53, 58, 80, 132, 284, 302, 334, 335);
COMMIT;

SELECT c.contract_no, t.company_name, c.start_date, c.end_date, c.status, c.link_type, c.kva, c.monthly_rent,
  (SELECT COUNT(*) FROM contract_billing_term b WHERE b.contract_id=c.id) nl, bb.name
FROM contract c JOIN tenant t ON t.id=c.tenant_id LEFT JOIN building bb ON bb.id=c.building_id
WHERE t.company_name IN ('博浩','翔海','次生代','黎镇源','思汗') ORDER BY t.company_name, c.contract_no;
