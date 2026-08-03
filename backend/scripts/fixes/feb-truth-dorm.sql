-- 宿舍档案按 2024-02 册真相重建 + 2024-05 种子读数删除(2026-08-04 用户裁定)
-- 裁定:系统状态=用户自导数据的纯函数;某月没有的名字/读数不许出现在该月,5月才有的等导5月自然回来。
-- 吉罗德 1-213 案根因:建档种子(202405数据表)把5月版租户名快照进档案,2月导入空值不覆盖 → 2月显5月名。
-- 本脚本:①删 2024-05 种子读数1134条(2026-07-21 16:42 批,用户从未导入;已生成的池快照为独立冻结表不受影响,
--   p2 读数因此清零属预期——p2 从无用户自导读数);②清空91块「2月空但档案有名」的租户名/挂号(吉罗德/思汗等);
--   ③改名5块「2月有名≠档案」(张勤军/光伏工程侯炳成)。owner_manual=1 一律跳过(实际0块)。
-- 档案删除=空集:孤儿候选7块逐一核查全部保留(闸机/被拦水表855、1104、1131/管道描述表839、840、846)。
-- 配套代码:applyDesc 增「行空但档案有名」warn(同批提交);前置备份 backup-before-feb-truth-20260804.sql
SET NAMES utf8mb4;
START TRANSACTION;
-- 1. 删 2024-05 种子读数(2026-07-21 16:42 批次,用户从未导入;裁定:系统状态=用户自导数据)
DELETE FROM meter_reading WHERE ym='2024-05' AND source='import' AND created_at BETWEEN '2026-07-21 16:42:00' AND '2026-07-21 16:43:59';
-- 2. 宿舍档案租户名按 2024-02 册重建:2月空=清空(91块,吉罗德类);2月有名≠档案=改名(5块)
UPDATE meter SET tenant_name=NULL, tenant_id=NULL WHERE id IN (565,566,567,571,573,575,604,637,638,667,671,673,675,676,677,678,682,684,685,687,688,689,730,737,750,760,764,766,871,873,874,875,877,879,881,883,885,890,893,911,913,919,921,923,943,944,971,972,973,975,977,978,979,980,981,982,983,984,985,986,987,988,989,990,991,992,993,994,995,996,1003,1008,1016,1021,1024,1026,1027,1028,1031,1038,1049,1051,1055,1060,1064,1066,1067,1080,1104,1122,1130) AND owner_manual=0;
UPDATE meter SET tenant_name='张勤军', tenant_id=(SELECT t.id FROM tenant t WHERE t.company_name='张勤军' LIMIT 1) WHERE id=732 AND owner_manual=0;
UPDATE meter SET tenant_name='光伏工程/侯炳成', tenant_id=(SELECT t.id FROM tenant t WHERE t.company_name='光伏工程/侯炳成' LIMIT 1) WHERE id=1018 AND owner_manual=0;
UPDATE meter SET tenant_name='光伏工程/侯炳成', tenant_id=(SELECT t.id FROM tenant t WHERE t.company_name='光伏工程/侯炳成' LIMIT 1) WHERE id=1022 AND owner_manual=0;
UPDATE meter SET tenant_name='光伏工程/侯炳成', tenant_id=(SELECT t.id FROM tenant t WHERE t.company_name='光伏工程/侯炳成' LIMIT 1) WHERE id=1023 AND owner_manual=0;
UPDATE meter SET tenant_name='张勤军', tenant_id=(SELECT t.id FROM tenant t WHERE t.company_name='张勤军' LIMIT 1) WHERE id=1033 AND owner_manual=0;
COMMIT;