-- 广联(tenant 28)宿舍合同批量建链 + 挂表(2026-08-03,依据:2024-03 通知单扫描件 + 收费 worksheet)
-- 商铺链沿用现有 #81(S10-0081,宿舍二栋首层2115/2104/2105,单元490主+608/609附加已挂):
--   本脚本补齐 终止日期/物业费三行(服务费5/基础2/变压器159)。kva 档案值46.25(水电册实证回填)
--   与纸约25千伏安不一致 → 不覆盖,记 remark 供核对。月租=计费行精确Σ 12172.44
--   (通知单 8509.50+3662.90=12172.40 是逐项四舍五入,17×500.56=8509.52/2×500.56=1001.12 为准)。
-- 宿舍八链(各自租期,fee行照鑫皇款:租19/基础2 per_sqm,网络50/间/月、门禁100/年/间 → per_month override):
--   A=一栋30间长约(2023-11-10~2026-11-09)24560.20  B=四栋627(2023-11-20~2024-11-19)1005.01
--   C=一栋424(2024-01-09~2024-07-08)825.46          D=四栋339~349十间(2023-12-03~2024-06-30)8236.15
--   E=四栋333/335/336/338(2023-12-15~2024-06-30)3301.85  F=四栋629/634/635(2023-12-23~2024-06-30)2266.39
--   G=四栋250(2024-01-04~2024-06-30)804.46          H=四栋631(2024-01-09~2024-06-30)728.86
--   锚点:八链Σ=41728.38(=worksheet 合计,分毫不差)。短租链已到期,状态由日期派生(asahi 惯例全 active)。
-- 单元:51 间宿舍 unit 全库不存在 → 补建(一栋31含424/四栋20,面积0与楼栋现状一致待P2补)。
-- 挂表:102 只宿舍电水表(现 tenant_id=28、contract_id 全 NULL)按房号绑各链 contract_id;
--   商铺总电534+水849/850 绑#81(849/850 spot 原文"2103"疑笔误 2105,原文快照不改)。
-- 幂等:按 contract_no 删八链重建;unit NOT EXISTS 补;meter/contract_unit 全量重设。
-- 前置备份:demo3/backup-before-guanglian-dorm-20260803.sql

SET NAMES utf8mb4;
START TRANSACTION;

-- ── 0. 幂等清理 ──
DELETE FROM contract_billing_term WHERE contract_id IN (SELECT id FROM (SELECT id FROM contract WHERE contract_no LIKE 'S10-0081_#1') x);
DELETE FROM contract_unit WHERE contract_id IN (SELECT id FROM (SELECT id FROM contract WHERE contract_no LIKE 'S10-0081_#1') x);
UPDATE meter SET contract_id = NULL WHERE contract_id IN (SELECT id FROM (SELECT id FROM contract WHERE contract_no LIKE 'S10-0081_#1') x);
DELETE FROM contract WHERE contract_no LIKE 'S10-0081_#1';

-- ── 1. 补 51 间宿舍单元(幂等) ──
INSERT INTO unit (building_id, floor, unit_no, area)
SELECT * FROM (
  SELECT 26 b, 3 f, '309' u, 0.00 a UNION ALL SELECT 26,3,'310',0 UNION ALL SELECT 26,3,'311',0 UNION ALL
  SELECT 26,3,'313',0 UNION ALL SELECT 26,3,'315',0 UNION ALL SELECT 26,3,'316',0 UNION ALL
  SELECT 26,3,'318',0 UNION ALL SELECT 26,3,'320',0 UNION ALL SELECT 26,3,'326',0 UNION ALL SELECT 26,3,'328',0 UNION ALL
  SELECT 26,4,'407',0 UNION ALL SELECT 26,4,'411',0 UNION ALL SELECT 26,4,'413',0 UNION ALL SELECT 26,4,'415',0 UNION ALL
  SELECT 26,4,'417',0 UNION ALL SELECT 26,4,'421',0 UNION ALL SELECT 26,4,'423',0 UNION ALL SELECT 26,4,'424',0 UNION ALL
  SELECT 26,5,'506',0 UNION ALL SELECT 26,5,'511',0 UNION ALL SELECT 26,5,'513',0 UNION ALL SELECT 26,5,'515',0 UNION ALL
  SELECT 26,5,'516',0 UNION ALL SELECT 26,5,'517',0 UNION ALL SELECT 26,5,'520',0 UNION ALL SELECT 26,5,'521',0 UNION ALL
  SELECT 26,5,'522',0 UNION ALL SELECT 26,5,'523',0 UNION ALL SELECT 26,5,'524',0 UNION ALL SELECT 26,5,'526',0 UNION ALL
  SELECT 26,5,'528',0 UNION ALL
  SELECT 29,2,'250',0 UNION ALL SELECT 29,3,'333',0 UNION ALL SELECT 29,3,'335',0 UNION ALL SELECT 29,3,'336',0 UNION ALL
  SELECT 29,3,'338',0 UNION ALL SELECT 29,3,'339',0 UNION ALL SELECT 29,3,'340',0 UNION ALL SELECT 29,3,'341',0 UNION ALL
  SELECT 29,3,'342',0 UNION ALL SELECT 29,3,'343',0 UNION ALL SELECT 29,3,'344',0 UNION ALL SELECT 29,3,'345',0 UNION ALL
  SELECT 29,3,'346',0 UNION ALL SELECT 29,3,'347',0 UNION ALL SELECT 29,3,'349',0 UNION ALL
  SELECT 29,6,'627',0 UNION ALL SELECT 29,6,'629',0 UNION ALL SELECT 29,6,'631',0 UNION ALL
  SELECT 29,6,'634',0 UNION ALL SELECT 29,6,'635',0
) v WHERE NOT EXISTS (SELECT 1 FROM unit u2 WHERE u2.building_id = v.b AND u2.unit_no = v.u);

-- ── 2. 商铺 #81 补齐(日期/物业费行/备注;租金行已在) ──
UPDATE contract SET
  end_date = '2026-11-09', term_type = 'explicit', term_text = '2023年11月10日至2026年11月09日',
  monthly_rent = 12172.44, mgmt_fee_price = 5.0000, infra_fee_price = 2.0000, transformer_fee = 159.00,
  remark = CONCAT(COALESCE(remark, ''), ' | 2026-08-03 图纸补齐:物业费三行;纸约用电25kVA与档案46.25(水电册实证)不一致待核;税金12.8%应收租金/履约保证金25529不入计费行'),
  fee_src = '{"rent": "manual", "mgmt": "manual", "infra": "manual", "transformer": "manual"}'
WHERE id = 81;
DELETE FROM contract_billing_term WHERE contract_id = 81 AND fee_key IN ('mgmt', 'infra', 'transformer');
INSERT INTO contract_billing_term
  (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (81, '宿舍区二号楼首层2115、2104、2105室', 'shop', 'mgmt',        '商铺企业管理服务费',   'per_sqm_month', 5.0000, 500.56, 1.0000, 'manual', NULL,   1),
  (81, '宿舍区二号楼首层2115、2104、2105室', 'shop', 'infra',       '商铺基础设施维护费',   'per_sqm_month', 2.0000, 500.56, 1.0000, 'manual', NULL,   2),
  (81, '宿舍区二号楼首层2115、2104、2105室', 'shop', 'transformer', '变压器维护费',         'per_month',     0.0000, NULL,   1.0000, 'manual', 159.00, 3);

-- ── 3. 宿舍八链 ──
INSERT INTO contract (contract_no, tenant_id, building_id, unit_id, rent_area, monthly_rent, deposit, start_date, end_date,
  term_type, term_text, status, remark, building_area, unit_price, infra_fee_price, fee_src, link_type, kind) VALUES
  ('S10-0081A#1', 28, 26, (SELECT id FROM unit WHERE building_id=26 AND unit_no='309'), 1086.20, 24560.20, 0.00,
   '2023-11-10', '2026-11-09', 'explicit', '2023年11月10日至2026年11月09日', 'active',
   '广联宿舍:一栋30间长约(网络30间/门禁30间;纸约整数20640+2173系四舍五入,以精确行为准)', 868.96, 19.0000, 2.0000,
   '{"area": "manual", "rent": "manual", "infra": "manual"}', 'new', 'normal'),
  ('S10-0081B#1', 28, 29, (SELECT id FROM unit WHERE building_id=29 AND unit_no='627'), 45.08, 1005.01, 0.00,
   '2023-11-20', '2024-11-19', 'explicit', '2023年11月20日至2024年11月19日', 'active',
   '广联宿舍:四栋627', 36.06, 19.0000, 2.0000, '{"area": "manual", "rent": "manual", "infra": "manual"}', 'new', 'normal'),
  ('S10-0081C#1', 28, 26, (SELECT id FROM unit WHERE building_id=26 AND unit_no='424'), 36.53, 825.46, 0.00,
   '2024-01-09', '2024-07-08', 'explicit', '2024年01月09日至2024年07月08日', 'active',
   '广联宿舍:一栋424', 29.22, 19.0000, 2.0000, '{"area": "manual", "rent": "manual", "infra": "manual"}', 'new', 'normal'),
  ('S10-0081D#1', 28, 29, (SELECT id FROM unit WHERE building_id=29 AND unit_no='339'), 364.42, 8236.15, 0.00,
   '2023-12-03', '2024-06-30', 'explicit', '2023年12月03日至2024年06月30日', 'active',
   '广联宿舍:四栋339~347、349 共10间', 291.54, 19.0000, 2.0000, '{"area": "manual", "rent": "manual", "infra": "manual"}', 'new', 'normal'),
  ('S10-0081E#1', 28, 29, (SELECT id FROM unit WHERE building_id=29 AND unit_no='333'), 146.12, 3301.85, 0.00,
   '2023-12-15', '2024-06-30', 'explicit', '2023年12月15日至2024年06月30日', 'active',
   '广联宿舍:四栋333、335、336、338 共4间', 116.90, 19.0000, 2.0000, '{"area": "manual", "rent": "manual", "infra": "manual"}', 'new', 'normal'),
  ('S10-0081F#1', 28, 29, (SELECT id FROM unit WHERE building_id=29 AND unit_no='629'), 99.59, 2266.39, 0.00,
   '2023-12-23', '2024-06-30', 'explicit', '2023年12月23日至2024年06月30日', 'active',
   '广联宿舍:四栋629、634、635 共3间', 79.67, 19.0000, 2.0000, '{"area": "manual", "rent": "manual", "infra": "manual"}', 'new', 'normal'),
  ('S10-0081G#1', 28, 29, (SELECT id FROM unit WHERE building_id=29 AND unit_no='250'), 35.53, 804.46, 0.00,
   '2024-01-04', '2024-06-30', 'explicit', '2024年01月04日至2024年06月30日', 'active',
   '广联宿舍:四栋250', 28.42, 19.0000, 2.0000, '{"area": "manual", "rent": "manual", "infra": "manual"}', 'new', 'normal'),
  ('S10-0081H#1', 28, 29, (SELECT id FROM unit WHERE building_id=29 AND unit_no='631'), 31.93, 728.86, 0.00,
   '2024-01-09', '2024-06-30', 'explicit', '2024年01月09日至2024年06月30日', 'active',
   '广联宿舍:四栋631', 25.54, 19.0000, 2.0000, '{"area": "manual", "rent": "manual", "infra": "manual"}', 'new', 'normal');

SET @ca = (SELECT id FROM contract WHERE contract_no='S10-0081A#1');
SET @cb = (SELECT id FROM contract WHERE contract_no='S10-0081B#1');
SET @cc = (SELECT id FROM contract WHERE contract_no='S10-0081C#1');
SET @cd = (SELECT id FROM contract WHERE contract_no='S10-0081D#1');
SET @ce = (SELECT id FROM contract WHERE contract_no='S10-0081E#1');
SET @cf = (SELECT id FROM contract WHERE contract_no='S10-0081F#1');
SET @cg = (SELECT id FROM contract WHERE contract_no='S10-0081G#1');
SET @ch = (SELECT id FROM contract WHERE contract_no='S10-0081H#1');

INSERT INTO contract_billing_term
  (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (@ca, '宿舍一栋309、310、311、313、315、316、318、320、326、328、407、411、413、415、417、421、423、506、511、513、515、516、517、520、521、522、523、524、526、528室', 'dorm', 'rent_dorm', '宿舍租金', 'per_sqm_month', 19.0000, 1086.20, 1.0000, 'manual', NULL, 0),
  (@ca, '宿舍一栋309、310、311、313、315、316、318、320、326、328、407、411、413、415、417、421、423、506、511、513、515、516、517、520、521、522、523、524、526、528室', 'dorm', 'infra', '宿舍基础设施维护费', 'per_sqm_month', 2.0000, 1086.20, 1.0000, 'manual', NULL, 1),
  (@ca, '宿舍一栋309、310、311、313、315、316、318、320、326、328、407、411、413、415、417、421、423、506、511、513、515、516、517、520、521、522、523、524、526、528室', 'dorm', 'network', '网络通讯费', 'per_month', 0.0000, NULL, 1.0000, 'manual', 1500.00, 2),
  (@ca, '宿舍一栋309、310、311、313、315、316、318、320、326、328、407、411、413、415、417、421、423、506、511、513、515、516、517、520、521、522、523、524、526、528室', 'dorm', 'access', '门禁设施维护费', 'per_month', 0.0000, NULL, 1.0000, 'manual', 250.00, 3),
  (@cb, '宿舍楼四座627室', 'dorm', 'rent_dorm', '宿舍租金', 'per_sqm_month', 19.0000, 45.08, 1.0000, 'manual', NULL, 0),
  (@cb, '宿舍楼四座627室', 'dorm', 'infra', '宿舍基础设施维护费', 'per_sqm_month', 2.0000, 45.08, 1.0000, 'manual', NULL, 1),
  (@cb, '宿舍楼四座627室', 'dorm', 'network', '网络通讯费', 'per_month', 0.0000, NULL, 1.0000, 'manual', 50.00, 2),
  (@cb, '宿舍楼四座627室', 'dorm', 'access', '门禁设施维护费', 'per_month', 0.0000, NULL, 1.0000, 'manual', 8.33, 3),
  (@cc, '宿舍楼一座424室', 'dorm', 'rent_dorm', '宿舍租金', 'per_sqm_month', 19.0000, 36.53, 1.0000, 'manual', NULL, 0),
  (@cc, '宿舍楼一座424室', 'dorm', 'infra', '宿舍基础设施维护费', 'per_sqm_month', 2.0000, 36.53, 1.0000, 'manual', NULL, 1),
  (@cc, '宿舍楼一座424室', 'dorm', 'network', '网络通讯费', 'per_month', 0.0000, NULL, 1.0000, 'manual', 50.00, 2),
  (@cc, '宿舍楼一座424室', 'dorm', 'access', '门禁设施维护费', 'per_month', 0.0000, NULL, 1.0000, 'manual', 8.33, 3),
  (@cd, '宿舍楼四座339、340、341、342、343、344、345、346、347、349室', 'dorm', 'rent_dorm', '宿舍租金', 'per_sqm_month', 19.0000, 364.42, 1.0000, 'manual', NULL, 0),
  (@cd, '宿舍楼四座339、340、341、342、343、344、345、346、347、349室', 'dorm', 'infra', '宿舍基础设施维护费', 'per_sqm_month', 2.0000, 364.42, 1.0000, 'manual', NULL, 1),
  (@cd, '宿舍楼四座339、340、341、342、343、344、345、346、347、349室', 'dorm', 'network', '网络通讯费', 'per_month', 0.0000, NULL, 1.0000, 'manual', 500.00, 2),
  (@cd, '宿舍楼四座339、340、341、342、343、344、345、346、347、349室', 'dorm', 'access', '门禁设施维护费', 'per_month', 0.0000, NULL, 1.0000, 'manual', 83.33, 3),
  (@ce, '宿舍楼四座333、335、336、338室', 'dorm', 'rent_dorm', '宿舍租金', 'per_sqm_month', 19.0000, 146.12, 1.0000, 'manual', NULL, 0),
  (@ce, '宿舍楼四座333、335、336、338室', 'dorm', 'infra', '宿舍基础设施维护费', 'per_sqm_month', 2.0000, 146.12, 1.0000, 'manual', NULL, 1),
  (@ce, '宿舍楼四座333、335、336、338室', 'dorm', 'network', '网络通讯费', 'per_month', 0.0000, NULL, 1.0000, 'manual', 200.00, 2),
  (@ce, '宿舍楼四座333、335、336、338室', 'dorm', 'access', '门禁设施维护费', 'per_month', 0.0000, NULL, 1.0000, 'manual', 33.33, 3),
  (@cf, '宿舍楼四座629、634、635室', 'dorm', 'rent_dorm', '宿舍租金', 'per_sqm_month', 19.0000, 99.59, 1.0000, 'manual', NULL, 0),
  (@cf, '宿舍楼四座629、634、635室', 'dorm', 'infra', '宿舍基础设施维护费', 'per_sqm_month', 2.0000, 99.59, 1.0000, 'manual', NULL, 1),
  (@cf, '宿舍楼四座629、634、635室', 'dorm', 'network', '网络通讯费', 'per_month', 0.0000, NULL, 1.0000, 'manual', 150.00, 2),
  (@cf, '宿舍楼四座629、634、635室', 'dorm', 'access', '门禁设施维护费', 'per_month', 0.0000, NULL, 1.0000, 'manual', 25.00, 3),
  (@cg, '宿舍楼四座250室', 'dorm', 'rent_dorm', '宿舍租金', 'per_sqm_month', 19.0000, 35.53, 1.0000, 'manual', NULL, 0),
  (@cg, '宿舍楼四座250室', 'dorm', 'infra', '宿舍基础设施维护费', 'per_sqm_month', 2.0000, 35.53, 1.0000, 'manual', NULL, 1),
  (@cg, '宿舍楼四座250室', 'dorm', 'network', '网络通讯费', 'per_month', 0.0000, NULL, 1.0000, 'manual', 50.00, 2),
  (@cg, '宿舍楼四座250室', 'dorm', 'access', '门禁设施维护费', 'per_month', 0.0000, NULL, 1.0000, 'manual', 8.33, 3),
  (@ch, '宿舍楼四座631室', 'dorm', 'rent_dorm', '宿舍租金', 'per_sqm_month', 19.0000, 31.93, 1.0000, 'manual', NULL, 0),
  (@ch, '宿舍楼四座631室', 'dorm', 'infra', '宿舍基础设施维护费', 'per_sqm_month', 2.0000, 31.93, 1.0000, 'manual', NULL, 1),
  (@ch, '宿舍楼四座631室', 'dorm', 'network', '网络通讯费', 'per_month', 0.0000, NULL, 1.0000, 'manual', 50.00, 2),
  (@ch, '宿舍楼四座631室', 'dorm', 'access', '门禁设施维护费', 'per_month', 0.0000, NULL, 1.0000, 'manual', 8.33, 3);

-- ── 4. 附加单元(主单元已在链上;链A 29 间/链D 9 间/链E 3 间/链F 2 间) ──
INSERT INTO contract_unit (contract_id, unit_id)
SELECT @ca, id FROM unit WHERE building_id=26 AND unit_no IN
  ('310','311','313','315','316','318','320','326','328','407','411','413','415','417','421','423','506','511','513','515','516','517','520','521','522','523','524','526','528');
INSERT INTO contract_unit (contract_id, unit_id)
SELECT @cd, id FROM unit WHERE building_id=29 AND unit_no IN ('340','341','342','343','344','345','346','347','349');
INSERT INTO contract_unit (contract_id, unit_id)
SELECT @ce, id FROM unit WHERE building_id=29 AND unit_no IN ('335','336','338');
INSERT INTO contract_unit (contract_id, unit_id)
SELECT @cf, id FROM unit WHERE building_id=29 AND unit_no IN ('634','635');

-- ── 5. 挂表(电+水按房号绑链;商铺总电/水绑 #81) ──
UPDATE meter SET contract_id = @ca WHERE id IN
  (594,595,596,598,600,601,603,605,610,611,619,623,625,627,629,633,635,645,650,652,654,655,656,659,660,661,662,663,664,665,
   901,902,903,905,907,908,910,912,917,918,925,929,931,933,935,939,941,950,955,957,959,960,961,964,965,966,967,968,969,970);
UPDATE meter SET contract_id = @cb WHERE id IN (809, 1107);
UPDATE meter SET contract_id = @cc WHERE id IN (636, 942);
UPDATE meter SET contract_id = @cd WHERE id IN (739,740,741,742,743,744,745,746,747,749, 1040,1041,1042,1043,1044,1045,1046,1047,1048,1050);
UPDATE meter SET contract_id = @ce WHERE id IN (733,735,736,738, 1034,1036,1037,1039);
UPDATE meter SET contract_id = @cf WHERE id IN (810,815,816, 1108,1113,1114);
UPDATE meter SET contract_id = @cg WHERE id IN (723, 1025);
UPDATE meter SET contract_id = @ch WHERE id IN (812, 1110);
UPDATE meter SET contract_id = 81 WHERE id IN (534, 849, 850);

COMMIT;

-- ── 验收 ──
SELECT c.contract_no, c.start_date, c.end_date, c.rent_area, c.monthly_rent, c.unit_id,
  (SELECT COUNT(*) FROM contract_unit u WHERE u.contract_id=c.id) extra_units,
  (SELECT COUNT(*) FROM contract_billing_term t WHERE t.contract_id=c.id) term_rows,
  (SELECT COUNT(*) FROM meter m WHERE m.contract_id=c.id) meters
FROM contract c WHERE c.tenant_id=28 AND (c.contract_no LIKE 'S10-0081%') ORDER BY c.contract_no;
SELECT SUM(monthly_rent) AS 宿舍八链合计_应为41728_38 FROM contract WHERE contract_no LIKE 'S10-0081_#1';
