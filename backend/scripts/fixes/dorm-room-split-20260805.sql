-- =====================================================================
-- S5 刀1 Task2 宿舍计费行逐间拆分（起草 2026-08-05，未执行）
-- 目的：宿舍合并计费行(如「宿舍楼四座430、431、432、434室」一行)拆成一间一行
--       (location=单间房号原文, area=册面单间面积)——S5-PREMISE-BILL-SPEC §0#3/§5①
-- 依据：一期2024年2月水电费.xlsx『宿舍电』sheet 逐间面积(一栋/四栋全图谱,
--       『宿舍水』sheet 同值互证) + 2024-03 合同册佐证；
--       22 组合并行中 21 组 Σ(单间面积)==库面积 精确吻合(差=0) → 自动拆;
--       广联 S10-0081A#1(c439, 30间) Σ=1087.20 vs 库 1086.20 差+1.00>0.5㎡
--       触发护栏 → 不拆,进 review.tsv MANUAL(须对纸质合同定夺)
-- 范围：property_type='dorm' 且 location 含顿号的 88 行中 84 行(21组×4费项) → 392 行
--       商铺合并行(2101、2102 等 shop 12行)不在范围
-- 拆分规则：
--   rent_dorm/infra per_sqm_month → area=单间面积,单价继承
--   access/network per_month 打包 override → 逐间均分,分尾差挂首间(组Σ逐分不变)
--     (标准价 access 8.33/间/月、network 50/间/月;邓宇峰3合同费额=7间口径见 review.tsv)
--   银纳 infra override 976.66=面积×2 → 逐间=单间面积×2(Σ精确)
--   可莱恩 per_room_year/per_room_month → room_count 4→1
-- 前置断言(执行前先查,不符停手)：
--   SELECT COUNT(*) FROM contract_billing_term WHERE property_type='dorm' AND location LIKE '%、%';  -- =88
--   SELECT COUNT(*), SUM(area) FROM contract_billing_term WHERE property_type='dorm';                 -- =251 / 79168.61
--   SELECT COUNT(*) FROM contract_billing_term WHERE property_type='dorm'
--     AND location LIKE '%、%' AND params IS NOT NULL;                                              -- =0
-- 应用：先备份 mysqldump park_demo3 > backup-before-s5-刀1-20260805.sql
--   docker exec -i demo3-mysql mysql -uroot -proot --default-character-set=utf8mb4 park_demo3 < 本文件
--   (文件UTF-8;禁 PowerShell 管道喂中文,用 Git Bash / cmd 重定向 —— charset坑)
-- 验证段(执行后)：
--   ① 可莱恩 S10-0057: SELECT location,area FROM contract_billing_term WHERE contract_id=57
--        AND fee_key='rent_dorm' ORDER BY location;
--      → 6行: 430室=74.52 / 431室=31.93 / 432室=46.02 / 434室=32.01 / 436室=36.53 / 438室=36.53, Σ=257.54
--   ② SELECT COUNT(*), SUM(area) FROM contract_billing_term WHERE property_type='dorm';
--      → 559 行 / 79168.61（Σ面积前后差=0;436/438 修正 +10.36/-10.36 相抵,dev 现库已=36.53 故影响0行）
--   ③ SELECT COUNT(*) FROM contract_billing_term WHERE property_type='dorm' AND location LIKE '%、%';
--      → 4（仅剩广联 c439 一组 MANUAL,人工定夺后另拆）
-- 回滚：本手术 DELETE+INSERT 交织,回滚=恢复备份
--   docker exec -i demo3-mysql mysql -uroot -proot park_demo3 < backup-before-s5-刀1-20260805.sql
-- =====================================================================

START TRANSACTION;

-- ① 可莱恩 436/438 面积修正(计划口径 26.17/46.89→36.53/36.53;
--    dev 库已=36.53,条件款幂等保险,0 行受影响亦为通过) —— S5 §5① 锚点
UPDATE contract_billing_term SET area=36.53 WHERE id IN (7914,7915) AND contract_id=57 AND area=26.17;
UPDATE contract_billing_term SET area=36.53 WHERE id IN (7918,7919) AND contract_id=57 AND area=46.89;

-- ② 22 组合并行逐间拆分（先 INSERT 后 DELETE,组内以 term_id 锚定）
-- ── 力美 S10-0055#A(c55) 宿舍四栋444、446室 area=73.06 → 2间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍四栋444室' loc, 36.53 a, NULL rc, NULL ov UNION ALL SELECT '宿舍四栋446室', 36.53, NULL, NULL) r
WHERE t.id=7820 AND t.contract_id=55;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍四栋444室' loc, 36.53 a, NULL rc, NULL ov UNION ALL SELECT '宿舍四栋446室', 36.53, NULL, NULL) r
WHERE t.id=7821 AND t.contract_id=55;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍四栋444室' loc, NULL a, NULL rc, 8.33 ov UNION ALL SELECT '宿舍四栋446室', NULL, NULL, 8.34) r
WHERE t.id=7822 AND t.contract_id=55;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍四栋444室' loc, NULL a, NULL rc, 50.00 ov UNION ALL SELECT '宿舍四栋446室', NULL, NULL, 50.00) r
WHERE t.id=7823 AND t.contract_id=55;
DELETE FROM contract_billing_term WHERE id IN (7820,7821,7822,7823) AND contract_id=55 AND location LIKE '%、%';

-- ── 可莱恩 S10-0057(c57) 宿舍楼四座430、431、432、434室 area=184.48 → 4间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座430室' loc, 74.52 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座431室', 31.93, NULL, NULL UNION ALL SELECT '宿舍楼四座432室', 46.02, NULL, NULL UNION ALL SELECT '宿舍楼四座434室', 32.01, NULL, NULL) r
WHERE t.id=7910 AND t.contract_id=57;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座430室' loc, 74.52 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座431室', 31.93, NULL, NULL UNION ALL SELECT '宿舍楼四座432室', 46.02, NULL, NULL UNION ALL SELECT '宿舍楼四座434室', 32.01, NULL, NULL) r
WHERE t.id=7911 AND t.contract_id=57;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座430室' loc, NULL a, 1 rc, 0.00 ov UNION ALL SELECT '宿舍楼四座431室', NULL, 1, 0.00 UNION ALL SELECT '宿舍楼四座432室', NULL, 1, 0.00 UNION ALL SELECT '宿舍楼四座434室', NULL, 1, 0.00) r
WHERE t.id=7913 AND t.contract_id=57;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座430室' loc, NULL a, 1 rc, 50.00 ov UNION ALL SELECT '宿舍楼四座431室', NULL, 1, 50.00 UNION ALL SELECT '宿舍楼四座432室', NULL, 1, 50.00 UNION ALL SELECT '宿舍楼四座434室', NULL, 1, 50.00) r
WHERE t.id=7912 AND t.contract_id=57;
DELETE FROM contract_billing_term WHERE id IN (7910,7911,7913,7912) AND contract_id=57 AND location LIKE '%、%';

-- ── 广东曼克维通信科技有限公司佛山分公司 C2024M-006(c301) 宿舍楼一座206、210、214、406、408室 area=167.09 → 5间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼一座206室' loc, 31.05 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼一座210室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼一座214室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼一座406室', 31.05, NULL, NULL UNION ALL SELECT '宿舍楼一座408室', 31.93, NULL, NULL) r
WHERE t.id=6737 AND t.contract_id=301;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼一座206室' loc, 31.05 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼一座210室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼一座214室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼一座406室', 31.05, NULL, NULL UNION ALL SELECT '宿舍楼一座408室', 31.93, NULL, NULL) r
WHERE t.id=6738 AND t.contract_id=301;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼一座206室' loc, NULL a, NULL rc, 8.35 ov UNION ALL SELECT '宿舍楼一座210室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍楼一座214室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍楼一座406室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍楼一座408室', NULL, NULL, 8.33) r
WHERE t.id=6740 AND t.contract_id=301;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼一座206室' loc, NULL a, NULL rc, 50.00 ov UNION ALL SELECT '宿舍楼一座210室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍楼一座214室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍楼一座406室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍楼一座408室', NULL, NULL, 50.00) r
WHERE t.id=6739 AND t.contract_id=301;
DELETE FROM contract_billing_term WHERE id IN (6737,6738,6740,6739) AND contract_id=301 AND location LIKE '%、%';

-- ── 广联 S10-0081D#1(c442) 宿舍楼四座339、340、341、342、343、344、345、346、347、349室 area=364.42 → 10间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座339室' loc, 36.53 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座340室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座341室', 36.96, NULL, NULL UNION ALL SELECT '宿舍楼四座342室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座343室', 36.09, NULL, NULL UNION ALL SELECT '宿舍楼四座344室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座345室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座346室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座347室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座349室', 35.66, NULL, NULL) r
WHERE t.id=7800 AND t.contract_id=442;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座339室' loc, 36.53 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座340室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座341室', 36.96, NULL, NULL UNION ALL SELECT '宿舍楼四座342室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座343室', 36.09, NULL, NULL UNION ALL SELECT '宿舍楼四座344室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座345室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座346室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座347室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座349室', 35.66, NULL, NULL) r
WHERE t.id=7801 AND t.contract_id=442;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座339室' loc, NULL a, NULL rc, 8.36 ov UNION ALL SELECT '宿舍楼四座340室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍楼四座341室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍楼四座342室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍楼四座343室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍楼四座344室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍楼四座345室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍楼四座346室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍楼四座347室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍楼四座349室', NULL, NULL, 8.33) r
WHERE t.id=7803 AND t.contract_id=442;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座339室' loc, NULL a, NULL rc, 50.00 ov UNION ALL SELECT '宿舍楼四座340室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍楼四座341室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍楼四座342室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍楼四座343室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍楼四座344室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍楼四座345室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍楼四座346室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍楼四座347室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍楼四座349室', NULL, NULL, 50.00) r
WHERE t.id=7802 AND t.contract_id=442;
DELETE FROM contract_billing_term WHERE id IN (7800,7801,7803,7802) AND contract_id=442 AND location LIKE '%、%';

-- ── 广联 S10-0081E#1(c443) 宿舍楼四座333、335、336、338室 area=146.12 → 4间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座333室' loc, 36.53 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座335室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座336室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座338室', 36.53, NULL, NULL) r
WHERE t.id=7804 AND t.contract_id=443;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座333室' loc, 36.53 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座335室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座336室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座338室', 36.53, NULL, NULL) r
WHERE t.id=7805 AND t.contract_id=443;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座333室' loc, NULL a, NULL rc, 8.34 ov UNION ALL SELECT '宿舍楼四座335室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍楼四座336室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍楼四座338室', NULL, NULL, 8.33) r
WHERE t.id=7807 AND t.contract_id=443;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座333室' loc, NULL a, NULL rc, 50.00 ov UNION ALL SELECT '宿舍楼四座335室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍楼四座336室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍楼四座338室', NULL, NULL, 50.00) r
WHERE t.id=7806 AND t.contract_id=443;
DELETE FROM contract_billing_term WHERE id IN (7804,7805,7807,7806) AND contract_id=443 AND location LIKE '%、%';

-- ── 广联 S10-0081F#1(c444) 宿舍楼四座629、634、635室 area=99.59 → 3间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座629室' loc, 31.05 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座634室', 32.01, NULL, NULL UNION ALL SELECT '宿舍楼四座635室', 36.53, NULL, NULL) r
WHERE t.id=7808 AND t.contract_id=444;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座629室' loc, 31.05 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座634室', 32.01, NULL, NULL UNION ALL SELECT '宿舍楼四座635室', 36.53, NULL, NULL) r
WHERE t.id=7809 AND t.contract_id=444;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座629室' loc, NULL a, NULL rc, 8.34 ov UNION ALL SELECT '宿舍楼四座634室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍楼四座635室', NULL, NULL, 8.33) r
WHERE t.id=7811 AND t.contract_id=444;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座629室' loc, NULL a, NULL rc, 50.00 ov UNION ALL SELECT '宿舍楼四座634室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍楼四座635室', NULL, NULL, 50.00) r
WHERE t.id=7810 AND t.contract_id=444;
DELETE FROM contract_billing_term WHERE id IN (7808,7809,7811,7810) AND contract_id=444 AND location LIKE '%、%';

-- ── 张勤军 S10-0066(c66) 宿舍楼四座532、536、632室 area=128.57 → 3间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座532室' loc, 46.02 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座536室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座632室', 46.02, NULL, NULL) r
WHERE t.id=6685 AND t.contract_id=66;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座532室' loc, 46.02 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座536室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座632室', 46.02, NULL, NULL) r
WHERE t.id=6686 AND t.contract_id=66;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座532室' loc, NULL a, NULL rc, 8.34 ov UNION ALL SELECT '宿舍楼四座536室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍楼四座632室', NULL, NULL, 8.33) r
WHERE t.id=6688 AND t.contract_id=66;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座532室' loc, NULL a, NULL rc, 50.00 ov UNION ALL SELECT '宿舍楼四座536室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍楼四座632室', NULL, NULL, 50.00) r
WHERE t.id=6687 AND t.contract_id=66;
DELETE FROM contract_billing_term WHERE id IN (6685,6686,6688,6687) AND contract_id=66 AND location LIKE '%、%';

-- ── 思汗 S10-0053(c53) 宿舍新俊楼一座216、218、220、222室 area=146.12 → 4间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍新俊楼一座216室' loc, 36.53 a, NULL rc, NULL ov UNION ALL SELECT '宿舍新俊楼一座218室', 36.53, NULL, NULL UNION ALL SELECT '宿舍新俊楼一座220室', 36.53, NULL, NULL UNION ALL SELECT '宿舍新俊楼一座222室', 36.53, NULL, NULL) r
WHERE t.id=3394 AND t.contract_id=53;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍新俊楼一座216室' loc, 36.53 a, NULL rc, NULL ov UNION ALL SELECT '宿舍新俊楼一座218室', 36.53, NULL, NULL UNION ALL SELECT '宿舍新俊楼一座220室', 36.53, NULL, NULL UNION ALL SELECT '宿舍新俊楼一座222室', 36.53, NULL, NULL) r
WHERE t.id=7545 AND t.contract_id=53;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍新俊楼一座216室' loc, NULL a, NULL rc, 8.34 ov UNION ALL SELECT '宿舍新俊楼一座218室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍新俊楼一座220室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍新俊楼一座222室', NULL, NULL, 8.33) r
WHERE t.id=7546 AND t.contract_id=53;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍新俊楼一座216室' loc, NULL a, NULL rc, 50.00 ov UNION ALL SELECT '宿舍新俊楼一座218室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍新俊楼一座220室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍新俊楼一座222室', NULL, NULL, 50.00) r
WHERE t.id=7547 AND t.contract_id=53;
DELETE FROM contract_billing_term WHERE id IN (3394,7545,7546,7547) AND contract_id=53 AND location LIKE '%、%';

-- ── 次生代 S10-0058(c58) 宿舍一座307、314室 area=73.06 → 2间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍一座307室' loc, 36.53 a, NULL rc, NULL ov UNION ALL SELECT '宿舍一座314室', 36.53, NULL, NULL) r
WHERE t.id=6535 AND t.contract_id=58;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍一座307室' loc, 36.53 a, NULL rc, NULL ov UNION ALL SELECT '宿舍一座314室', 36.53, NULL, NULL) r
WHERE t.id=6536 AND t.contract_id=58;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍一座307室' loc, NULL a, NULL rc, 8.33 ov UNION ALL SELECT '宿舍一座314室', NULL, NULL, 8.34) r
WHERE t.id=6537 AND t.contract_id=58;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍一座307室' loc, NULL a, NULL rc, 50.00 ov UNION ALL SELECT '宿舍一座314室', NULL, NULL, 50.00) r
WHERE t.id=6538 AND t.contract_id=58;
DELETE FROM contract_billing_term WHERE id IN (6535,6536,6537,6538) AND contract_id=58 AND location LIKE '%、%';

-- ── 欧培敬 S10-0203(c203) 宿舍楼四座232、530室 area=120.54 → 2间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座232室' loc, 46.02 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座530室', 74.52, NULL, NULL) r
WHERE t.id=6839 AND t.contract_id=203;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座232室' loc, 46.02 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座530室', 74.52, NULL, NULL) r
WHERE t.id=6840 AND t.contract_id=203;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座232室' loc, NULL a, NULL rc, 8.33 ov UNION ALL SELECT '宿舍楼四座530室', NULL, NULL, 8.34) r
WHERE t.id=6842 AND t.contract_id=203;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座232室' loc, NULL a, NULL rc, 50.00 ov UNION ALL SELECT '宿舍楼四座530室', NULL, NULL, 50.00) r
WHERE t.id=6841 AND t.contract_id=203;
DELETE FROM contract_billing_term WHERE id IN (6839,6840,6842,6841) AND contract_id=203 AND location LIKE '%、%';

-- ── 欧培敬 S10-0203#1(c358) 宿舍楼四座232、530室 area=120.54 → 2间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座232室' loc, 46.02 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座530室', 74.52, NULL, NULL) r
WHERE t.id=7179 AND t.contract_id=358;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座232室' loc, 46.02 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座530室', 74.52, NULL, NULL) r
WHERE t.id=7180 AND t.contract_id=358;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座232室' loc, NULL a, NULL rc, 8.33 ov UNION ALL SELECT '宿舍楼四座530室', NULL, NULL, 8.34) r
WHERE t.id=7182 AND t.contract_id=358;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座232室' loc, NULL a, NULL rc, 50.00 ov UNION ALL SELECT '宿舍楼四座530室', NULL, NULL, 50.00) r
WHERE t.id=7181 AND t.contract_id=358;
DELETE FROM contract_billing_term WHERE id IN (7179,7180,7182,7181) AND contract_id=358 AND location LIKE '%、%';

-- ── 碳紫 S10-0063(c63) 宿舍楼一座322、323室 area=72.94 → 2间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼一座322室' loc, 36.53 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼一座323室', 36.41, NULL, NULL) r
WHERE t.id=6643 AND t.contract_id=63;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼一座322室' loc, 36.53 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼一座323室', 36.41, NULL, NULL) r
WHERE t.id=6644 AND t.contract_id=63;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼一座322室' loc, NULL a, NULL rc, 8.33 ov UNION ALL SELECT '宿舍楼一座323室', NULL, NULL, 8.34) r
WHERE t.id=6646 AND t.contract_id=63;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼一座322室' loc, NULL a, NULL rc, 50.00 ov UNION ALL SELECT '宿舍楼一座323室', NULL, NULL, 50.00) r
WHERE t.id=6645 AND t.contract_id=63;
DELETE FROM contract_billing_term WHERE id IN (6643,6644,6646,6645) AND contract_id=63 AND location LIKE '%、%';

-- ── 邓宇峰 S10-0204(c204) 宿舍楼四座644、641、646、647、649、650室 area=217.74 → 6间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座644室' loc, 36.53 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座641室', 36.96, NULL, NULL UNION ALL SELECT '宿舍楼四座646室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座647室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座649室', 35.66, NULL, NULL UNION ALL SELECT '宿舍楼四座650室', 35.53, NULL, NULL) r
WHERE t.id=6853 AND t.contract_id=204;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座644室' loc, 36.53 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座641室', 36.96, NULL, NULL UNION ALL SELECT '宿舍楼四座646室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座647室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座649室', 35.66, NULL, NULL UNION ALL SELECT '宿舍楼四座650室', 35.53, NULL, NULL) r
WHERE t.id=6854 AND t.contract_id=204;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座644室' loc, NULL a, NULL rc, 9.73 ov UNION ALL SELECT '宿舍楼四座641室', NULL, NULL, 9.72 UNION ALL SELECT '宿舍楼四座646室', NULL, NULL, 9.72 UNION ALL SELECT '宿舍楼四座647室', NULL, NULL, 9.72 UNION ALL SELECT '宿舍楼四座649室', NULL, NULL, 9.72 UNION ALL SELECT '宿舍楼四座650室', NULL, NULL, 9.72) r
WHERE t.id=6856 AND t.contract_id=204;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座644室' loc, NULL a, NULL rc, 58.35 ov UNION ALL SELECT '宿舍楼四座641室', NULL, NULL, 58.33 UNION ALL SELECT '宿舍楼四座646室', NULL, NULL, 58.33 UNION ALL SELECT '宿舍楼四座647室', NULL, NULL, 58.33 UNION ALL SELECT '宿舍楼四座649室', NULL, NULL, 58.33 UNION ALL SELECT '宿舍楼四座650室', NULL, NULL, 58.33) r
WHERE t.id=6855 AND t.contract_id=204;
DELETE FROM contract_billing_term WHERE id IN (6853,6854,6856,6855) AND contract_id=204 AND location LIKE '%、%';

-- ── 邓宇峰 S10-0204#1(c359) 宿舍楼四座644、641、646、647、649、650室 area=217.74 → 6间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座644室' loc, 36.53 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座641室', 36.96, NULL, NULL UNION ALL SELECT '宿舍楼四座646室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座647室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座649室', 35.66, NULL, NULL UNION ALL SELECT '宿舍楼四座650室', 35.53, NULL, NULL) r
WHERE t.id=7193 AND t.contract_id=359;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座644室' loc, 36.53 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座641室', 36.96, NULL, NULL UNION ALL SELECT '宿舍楼四座646室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座647室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座649室', 35.66, NULL, NULL UNION ALL SELECT '宿舍楼四座650室', 35.53, NULL, NULL) r
WHERE t.id=7194 AND t.contract_id=359;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座644室' loc, NULL a, NULL rc, 9.73 ov UNION ALL SELECT '宿舍楼四座641室', NULL, NULL, 9.72 UNION ALL SELECT '宿舍楼四座646室', NULL, NULL, 9.72 UNION ALL SELECT '宿舍楼四座647室', NULL, NULL, 9.72 UNION ALL SELECT '宿舍楼四座649室', NULL, NULL, 9.72 UNION ALL SELECT '宿舍楼四座650室', NULL, NULL, 9.72) r
WHERE t.id=7196 AND t.contract_id=359;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座644室' loc, NULL a, NULL rc, 58.35 ov UNION ALL SELECT '宿舍楼四座641室', NULL, NULL, 58.33 UNION ALL SELECT '宿舍楼四座646室', NULL, NULL, 58.33 UNION ALL SELECT '宿舍楼四座647室', NULL, NULL, 58.33 UNION ALL SELECT '宿舍楼四座649室', NULL, NULL, 58.33 UNION ALL SELECT '宿舍楼四座650室', NULL, NULL, 58.33) r
WHERE t.id=7195 AND t.contract_id=359;
DELETE FROM contract_billing_term WHERE id IN (7193,7194,7196,7195) AND contract_id=359 AND location LIKE '%、%';

-- ── 邓宇峰 S10-0204#2(c360) 宿舍楼四座644、641、646、647、649、650室 area=217.74 → 6间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座644室' loc, 36.53 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座641室', 36.96, NULL, NULL UNION ALL SELECT '宿舍楼四座646室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座647室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座649室', 35.66, NULL, NULL UNION ALL SELECT '宿舍楼四座650室', 35.53, NULL, NULL) r
WHERE t.id=7208 AND t.contract_id=360;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座644室' loc, 36.53 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座641室', 36.96, NULL, NULL UNION ALL SELECT '宿舍楼四座646室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座647室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座649室', 35.66, NULL, NULL UNION ALL SELECT '宿舍楼四座650室', 35.53, NULL, NULL) r
WHERE t.id=7209 AND t.contract_id=360;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座644室' loc, NULL a, NULL rc, 9.73 ov UNION ALL SELECT '宿舍楼四座641室', NULL, NULL, 9.72 UNION ALL SELECT '宿舍楼四座646室', NULL, NULL, 9.72 UNION ALL SELECT '宿舍楼四座647室', NULL, NULL, 9.72 UNION ALL SELECT '宿舍楼四座649室', NULL, NULL, 9.72 UNION ALL SELECT '宿舍楼四座650室', NULL, NULL, 9.72) r
WHERE t.id=7211 AND t.contract_id=360;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座644室' loc, NULL a, NULL rc, 58.35 ov UNION ALL SELECT '宿舍楼四座641室', NULL, NULL, 58.33 UNION ALL SELECT '宿舍楼四座646室', NULL, NULL, 58.33 UNION ALL SELECT '宿舍楼四座647室', NULL, NULL, 58.33 UNION ALL SELECT '宿舍楼四座649室', NULL, NULL, 58.33 UNION ALL SELECT '宿舍楼四座650室', NULL, NULL, 58.33) r
WHERE t.id=7210 AND t.contract_id=360;
DELETE FROM contract_billing_term WHERE id IN (7208,7209,7211,7210) AND contract_id=360 AND location LIKE '%、%';

-- ── 鑫皇 C2024M-024B#1(c433) 宿舍四座529、531、533、535、537、539、541、543室 area=282.15 → 8间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍四座529室' loc, 31.05 a, NULL rc, NULL ov UNION ALL SELECT '宿舍四座531室', 31.93, NULL, NULL UNION ALL SELECT '宿舍四座533室', 36.53, NULL, NULL UNION ALL SELECT '宿舍四座535室', 36.53, NULL, NULL UNION ALL SELECT '宿舍四座537室', 36.53, NULL, NULL UNION ALL SELECT '宿舍四座539室', 36.53, NULL, NULL UNION ALL SELECT '宿舍四座541室', 36.96, NULL, NULL UNION ALL SELECT '宿舍四座543室', 36.09, NULL, NULL) r
WHERE t.id=7345 AND t.contract_id=433;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍四座529室' loc, 31.05 a, NULL rc, NULL ov UNION ALL SELECT '宿舍四座531室', 31.93, NULL, NULL UNION ALL SELECT '宿舍四座533室', 36.53, NULL, NULL UNION ALL SELECT '宿舍四座535室', 36.53, NULL, NULL UNION ALL SELECT '宿舍四座537室', 36.53, NULL, NULL UNION ALL SELECT '宿舍四座539室', 36.53, NULL, NULL UNION ALL SELECT '宿舍四座541室', 36.96, NULL, NULL UNION ALL SELECT '宿舍四座543室', 36.09, NULL, NULL) r
WHERE t.id=7346 AND t.contract_id=433;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍四座529室' loc, NULL a, NULL rc, 8.36 ov UNION ALL SELECT '宿舍四座531室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍四座533室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍四座535室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍四座537室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍四座539室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍四座541室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍四座543室', NULL, NULL, 8.33) r
WHERE t.id=7347 AND t.contract_id=433;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍四座529室' loc, NULL a, NULL rc, 50.00 ov UNION ALL SELECT '宿舍四座531室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍四座533室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍四座535室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍四座537室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍四座539室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍四座541室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍四座543室', NULL, NULL, 50.00) r
WHERE t.id=7348 AND t.contract_id=433;
DELETE FROM contract_billing_term WHERE id IN (7345,7346,7347,7348) AND contract_id=433 AND location LIKE '%、%';

-- ── 鑫皇 C2024M-024C#1(c434) 宿舍新俊楼一座306、308、312、505、507、509室 area=204.58 → 6间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍新俊楼一座306室' loc, 31.05 a, NULL rc, NULL ov UNION ALL SELECT '宿舍新俊楼一座308室', 31.93, NULL, NULL UNION ALL SELECT '宿舍新俊楼一座312室', 36.53, NULL, NULL UNION ALL SELECT '宿舍新俊楼一座505室', 32.01, NULL, NULL UNION ALL SELECT '宿舍新俊楼一座507室', 36.53, NULL, NULL UNION ALL SELECT '宿舍新俊楼一座509室', 36.53, NULL, NULL) r
WHERE t.id=7349 AND t.contract_id=434;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍新俊楼一座306室' loc, 31.05 a, NULL rc, NULL ov UNION ALL SELECT '宿舍新俊楼一座308室', 31.93, NULL, NULL UNION ALL SELECT '宿舍新俊楼一座312室', 36.53, NULL, NULL UNION ALL SELECT '宿舍新俊楼一座505室', 32.01, NULL, NULL UNION ALL SELECT '宿舍新俊楼一座507室', 36.53, NULL, NULL UNION ALL SELECT '宿舍新俊楼一座509室', 36.53, NULL, NULL) r
WHERE t.id=7350 AND t.contract_id=434;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍新俊楼一座306室' loc, NULL a, NULL rc, 8.35 ov UNION ALL SELECT '宿舍新俊楼一座308室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍新俊楼一座312室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍新俊楼一座505室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍新俊楼一座507室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍新俊楼一座509室', NULL, NULL, 8.33) r
WHERE t.id=7351 AND t.contract_id=434;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍新俊楼一座306室' loc, NULL a, NULL rc, 50.00 ov UNION ALL SELECT '宿舍新俊楼一座308室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍新俊楼一座312室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍新俊楼一座505室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍新俊楼一座507室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍新俊楼一座509室', NULL, NULL, 50.00) r
WHERE t.id=7352 AND t.contract_id=434;
DELETE FROM contract_billing_term WHERE id IN (7349,7350,7351,7352) AND contract_id=434 AND location LIKE '%、%';

-- ── 鑫皇 C2024M-024E#1(c436) 宿舍楼一座419、519室 area=88.50 → 2间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼一座419室' loc, 44.25 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼一座519室', 44.25, NULL, NULL) r
WHERE t.id=7357 AND t.contract_id=436;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼一座419室' loc, 44.25 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼一座519室', 44.25, NULL, NULL) r
WHERE t.id=7358 AND t.contract_id=436;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼一座419室' loc, NULL a, NULL rc, 8.33 ov UNION ALL SELECT '宿舍楼一座519室', NULL, NULL, 8.34) r
WHERE t.id=7359 AND t.contract_id=436;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼一座419室' loc, NULL a, NULL rc, 50.00 ov UNION ALL SELECT '宿舍楼一座519室', NULL, NULL, 50.00) r
WHERE t.id=7360 AND t.contract_id=436;
DELETE FROM contract_billing_term WHERE id IN (7357,7358,7359,7360) AND contract_id=436 AND location LIKE '%、%';

-- ── 鑫皇 C2024M-024F#1(c437) 宿舍楼四座234、245、331、445、447室 area=173.53 → 5间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座234室' loc, 32.01 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座245室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座331室', 31.93, NULL, NULL UNION ALL SELECT '宿舍楼四座445室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座447室', 36.53, NULL, NULL) r
WHERE t.id=7361 AND t.contract_id=437;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座234室' loc, 32.01 a, NULL rc, NULL ov UNION ALL SELECT '宿舍楼四座245室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座331室', 31.93, NULL, NULL UNION ALL SELECT '宿舍楼四座445室', 36.53, NULL, NULL UNION ALL SELECT '宿舍楼四座447室', 36.53, NULL, NULL) r
WHERE t.id=7362 AND t.contract_id=437;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座234室' loc, NULL a, NULL rc, 8.35 ov UNION ALL SELECT '宿舍楼四座245室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍楼四座331室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍楼四座445室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍楼四座447室', NULL, NULL, 8.33) r
WHERE t.id=7363 AND t.contract_id=437;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍楼四座234室' loc, NULL a, NULL rc, 50.00 ov UNION ALL SELECT '宿舍楼四座245室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍楼四座331室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍楼四座445室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍楼四座447室', NULL, NULL, 50.00) r
WHERE t.id=7364 AND t.contract_id=437;
DELETE FROM contract_billing_term WHERE id IN (7361,7362,7363,7364) AND contract_id=437 AND location LIKE '%、%';

-- ── 银纳 S10-0052(c52) 保障房404、410、412、418、420、414、416、422、508、510、512、514、303室 area=488.33 → 13间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '保障房404室' loc, 45.08 a, NULL rc, NULL ov UNION ALL SELECT '保障房410室', 36.53, NULL, NULL UNION ALL SELECT '保障房412室', 36.53, NULL, NULL UNION ALL SELECT '保障房418室', 36.53, NULL, NULL UNION ALL SELECT '保障房420室', 36.53, NULL, NULL UNION ALL SELECT '保障房414室', 36.53, NULL, NULL UNION ALL SELECT '保障房416室', 36.53, NULL, NULL UNION ALL SELECT '保障房422室', 36.53, NULL, NULL UNION ALL SELECT '保障房508室', 31.93, NULL, NULL UNION ALL SELECT '保障房510室', 36.53, NULL, NULL UNION ALL SELECT '保障房512室', 36.53, NULL, NULL UNION ALL SELECT '保障房514室', 36.53, NULL, NULL UNION ALL SELECT '保障房303室', 46.02, NULL, NULL) r
WHERE t.id=6463 AND t.contract_id=52;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '保障房404室' loc, 45.08 a, NULL rc, 90.16 ov UNION ALL SELECT '保障房410室', 36.53, NULL, 73.06 UNION ALL SELECT '保障房412室', 36.53, NULL, 73.06 UNION ALL SELECT '保障房418室', 36.53, NULL, 73.06 UNION ALL SELECT '保障房420室', 36.53, NULL, 73.06 UNION ALL SELECT '保障房414室', 36.53, NULL, 73.06 UNION ALL SELECT '保障房416室', 36.53, NULL, 73.06 UNION ALL SELECT '保障房422室', 36.53, NULL, 73.06 UNION ALL SELECT '保障房508室', 31.93, NULL, 63.86 UNION ALL SELECT '保障房510室', 36.53, NULL, 73.06 UNION ALL SELECT '保障房512室', 36.53, NULL, 73.06 UNION ALL SELECT '保障房514室', 36.53, NULL, 73.06 UNION ALL SELECT '保障房303室', 46.02, NULL, 92.04) r
WHERE t.id=6464 AND t.contract_id=52;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '保障房404室' loc, NULL a, NULL rc, 8.37 ov UNION ALL SELECT '保障房410室', NULL, NULL, 8.33 UNION ALL SELECT '保障房412室', NULL, NULL, 8.33 UNION ALL SELECT '保障房418室', NULL, NULL, 8.33 UNION ALL SELECT '保障房420室', NULL, NULL, 8.33 UNION ALL SELECT '保障房414室', NULL, NULL, 8.33 UNION ALL SELECT '保障房416室', NULL, NULL, 8.33 UNION ALL SELECT '保障房422室', NULL, NULL, 8.33 UNION ALL SELECT '保障房508室', NULL, NULL, 8.33 UNION ALL SELECT '保障房510室', NULL, NULL, 8.33 UNION ALL SELECT '保障房512室', NULL, NULL, 8.33 UNION ALL SELECT '保障房514室', NULL, NULL, 8.33 UNION ALL SELECT '保障房303室', NULL, NULL, 8.33) r
WHERE t.id=6465 AND t.contract_id=52;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '保障房404室' loc, NULL a, NULL rc, 50.00 ov UNION ALL SELECT '保障房410室', NULL, NULL, 50.00 UNION ALL SELECT '保障房412室', NULL, NULL, 50.00 UNION ALL SELECT '保障房418室', NULL, NULL, 50.00 UNION ALL SELECT '保障房420室', NULL, NULL, 50.00 UNION ALL SELECT '保障房414室', NULL, NULL, 50.00 UNION ALL SELECT '保障房416室', NULL, NULL, 50.00 UNION ALL SELECT '保障房422室', NULL, NULL, 50.00 UNION ALL SELECT '保障房508室', NULL, NULL, 50.00 UNION ALL SELECT '保障房510室', NULL, NULL, 50.00 UNION ALL SELECT '保障房512室', NULL, NULL, 50.00 UNION ALL SELECT '保障房514室', NULL, NULL, 50.00 UNION ALL SELECT '保障房303室', NULL, NULL, 50.00) r
WHERE t.id=6466 AND t.contract_id=52;
DELETE FROM contract_billing_term WHERE id IN (6463,6464,6465,6466) AND contract_id=52 AND location LIKE '%、%';

-- ── 龙为宿舍 S10-0253#A(c253) 宿舍一栋501、504室；四栋435室 area=156.13 → 3间 ──
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍一栋501室' loc, 74.52 a, NULL rc, NULL ov UNION ALL SELECT '宿舍一栋504室', 45.08, NULL, NULL UNION ALL SELECT '宿舍四栋435室', 36.53, NULL, NULL) r
WHERE t.id=7828 AND t.contract_id=253;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍一栋501室' loc, 74.52 a, NULL rc, NULL ov UNION ALL SELECT '宿舍一栋504室', 45.08, NULL, NULL UNION ALL SELECT '宿舍四栋435室', 36.53, NULL, NULL) r
WHERE t.id=7829 AND t.contract_id=253;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍一栋501室' loc, NULL a, NULL rc, 8.34 ov UNION ALL SELECT '宿舍一栋504室', NULL, NULL, 8.33 UNION ALL SELECT '宿舍四栋435室', NULL, NULL, 8.33) r
WHERE t.id=7830 AND t.contract_id=253;
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, tax_rate, params, note, source, room_count, amount_override, seq)
SELECT t.contract_id, r.loc, t.property_type, t.fee_key, t.fee_name, t.bill_mode, t.unit_price, r.a, t.coeff, t.tax_rate, t.params, t.note, t.source, r.rc, r.ov, t.seq
FROM contract_billing_term t
JOIN (SELECT '宿舍一栋501室' loc, NULL a, NULL rc, 50.00 ov UNION ALL SELECT '宿舍一栋504室', NULL, NULL, 50.00 UNION ALL SELECT '宿舍四栋435室', NULL, NULL, 50.00) r
WHERE t.id=7831 AND t.contract_id=253;
DELETE FROM contract_billing_term WHERE id IN (7828,7829,7830,7831) AND contract_id=253 AND location LIKE '%、%';

COMMIT;
