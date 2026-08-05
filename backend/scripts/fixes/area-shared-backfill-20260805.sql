-- =====================================================================
-- S5 刀1 Task3 公摊面积 area_shared 补录（起草 2026-08-05，未执行）
-- 目的：分摊表面积＞合同建筑面积的户,差额=公摊面积回填 contract_billing_term.area_shared
--       ——S5-PREMISE-BILL-SPEC §1/§5②；分摊公式 area+IFNULL(area_shared,0) 立即受益
-- 前置：V90__premise_bill.sql 已应用(area_shared 列存在,Flyway 89→90)
-- 依据：一期2024年2月水电费.xlsx『一期租户分摊公共用电金额』sheet 逐户逐场地 租赁面积列
--       vs 库内该户该场地 建筑类租金行(BUILDING_RENT_KEYS,rent_land 不计入) area；
--       差>0.5㎡=补录对象。二期分摊按层数(元/层)无面积列,不在本批范围。
--       七户全部呈同一铁证模式：差额 == 同场地 rent_land(空地租金)行面积,
--       即纸面把公摊面积按空地价另行计租(建筑租金仍按建筑面积)——租金不因补录而变(S5 §1)。
--       同批 review.tsv(area-shared-rent-review.tsv)已列 该户月租金(库) vs 单价×册面面积,
--       须用户逐户过目后才应用(S5 §5②:租金不静默变动)。
-- 锚点：可莱恩 A座602室 册1986−库1528=458；可莱恩 B座201室 册4050−库2700=1350。
-- 范围：6户7场地10行(续约版本链逐版都补,保证任意月份分摊口径一致)；
--       差>0.5 但模式不清的 6 条(旭化成/炳记/戎合/碧沃丰/飞度/翔海E座)只进清单不补,
--       库内无租金计费行的 10 户亦只进清单——见 review.tsv 状态列。
-- 应用：先备份 mysqldump park_demo3 > backup-before-s5-刀1-20260805.sql
--   docker exec -i demo3-mysql mysql -uroot -proot --default-character-set=utf8mb4 park_demo3 < 本文件
--   (文件UTF-8;禁 PowerShell 管道喂中文,用 Git Bash / cmd 重定向 —— charset坑)
-- 验证段(执行后)：
--   ① 可莱恩两行: SELECT location, area, area_shared FROM contract_billing_term
--        WHERE id IN (6501,6504);
--      → A座602室 1528/458、B座201室 2700/1350（分摊面积 1528+458=1986、2700+1350=4050 与册全等）
--   ② SELECT COUNT(*) FROM contract_billing_term WHERE area_shared IS NOT NULL; → 10
--      (=review.tsv AUTO 段 6户7场地的版本链行数:可莱恩2场地×2版=4 + 鑫皇1场地×2版=2
--       + 雷莱/思汗/次生代/一元兰欣各1=4)
--   ③ 每行 UPDATE 影响行数=1(guard: area=期望值 AND area_shared IS NULL)
-- 回滚：UPDATE contract_billing_term SET area_shared=NULL
--       WHERE id IN (6501,7442,7448,6504,7761,7767,7371,7541,6529,6539);
-- =====================================================================

START TRANSACTION;

-- ── 可莱恩 A座602室 rent_office 1528 + 公摊458 = 册1986（锚点①） ──
UPDATE contract_billing_term SET area_shared=458.00
 WHERE id=6501 AND contract_id=95  AND fee_key='rent_office' AND area=1528.00 AND area_shared IS NULL;  -- S10-0095(2023-08~2026-08,覆盖2024-02)
UPDATE contract_billing_term SET area_shared=458.00
 WHERE id=7442 AND contract_id=405 AND fee_key='rent_office' AND area=1528.00 AND area_shared IS NULL;  -- S10-0095#1(2020~2023 旧版)

-- ── 可莱恩 B座201室 rent_factory 2700 + 公摊1350 = 册4050（锚点②） ──
UPDATE contract_billing_term SET area_shared=1350.00
 WHERE id=6504 AND contract_id=406 AND fee_key='rent_factory' AND area=2700.00 AND area_shared IS NULL; -- S10-0005#1(2022~2024,覆盖2024-02)
UPDATE contract_billing_term SET area_shared=1350.00
 WHERE id=7448 AND contract_id=5   AND fee_key='rent_factory' AND area=2700.00 AND area_shared IS NULL; -- S10-0005(2025~2027 现行版)

-- ── 鑫皇 A座502室 rent_office 1640 + 公摊820 = 册2460 ──
UPDATE contract_billing_term SET area_shared=820.00
 WHERE id=7767 AND contract_id=431 AND fee_key='rent_office' AND area=1640.00 AND area_shared IS NULL;  -- C2024M-024#2(2023-12~2026-12,覆盖2024-02)
UPDATE contract_billing_term SET area_shared=820.00
 WHERE id=7761 AND contract_id=384 AND fee_key='rent_office' AND area=1640.00 AND area_shared IS NULL;  -- C2024M-024#1(2020~2023 旧版)

-- ── 雷莱 B座301室 rent_factory 2700 + 公摊675 = 册3375 ──
UPDATE contract_billing_term SET area_shared=675.00
 WHERE id=7371 AND contract_id=386 AND fee_key='rent_factory' AND area=2700.00 AND area_shared IS NULL; -- C2024M-026(2022~2026)

-- ── 思汗 F座首层101室 rent_factory 2700 + 公摊810 = 册3510 ──
UPDATE contract_billing_term SET area_shared=810.00
 WHERE id=7541 AND contract_id=3   AND fee_key='rent_factory' AND area=2700.00 AND area_shared IS NULL; -- S10-0003(2022-10~2024-10)

-- ── 次生代 A座616、618室 rent_office 526.50 + 公摊263.30 = 册789.8 ──
UPDATE contract_billing_term SET area_shared=263.30
 WHERE id=6529 AND contract_id=132 AND fee_key='rent_office' AND area=526.50 AND area_shared IS NULL;   -- S10-0132(2021~2024)

-- ── 一元兰欣 D座403室 rent_factory 1445 + 公摊722.50 = 册2167.5(册面写D402/库写D403,面积链吻合,见清单备注) ──
UPDATE contract_billing_term SET area_shared=722.50
 WHERE id=6539 AND contract_id=7   AND fee_key='rent_factory' AND area=1445.00 AND area_shared IS NULL; -- S10-0007(2021~2024)

COMMIT;
