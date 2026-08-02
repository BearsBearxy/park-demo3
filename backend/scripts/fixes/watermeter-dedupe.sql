-- 水表重复编码去重(2026-08-03 考古定案):三对重复码全部诞生于原册 2024年1月版批量补码的拖填/复制错,
-- 六块都是位置不同的活表(各有独立读数),不存在重复建档 → 不退役不合并,只给「复制方」清码。
-- 判据:920620036/920620062 在 2023-10 册即分别登在 1-310/1-411 名下(2111 与 1-516 当时无码);
--       920620043 三行拖填中 5-551 已被原册 2024-05 版自行改正为 923110113,5-548 有连续真实用量,4-652 恒零。
-- 999/1000/1001(四栋总水/原二期工地水/电梯,addr 三无同键)刻意不动:
--   给它们分流 spot 会让无标识名文件的行从「歧义报错(安全拦截)」变成「自动建新档(静默污染)」;
--   正解=导宿舍水用带原册首列(标识名)的模板,标识名与档案 name 精确相等即可唯一命中。
-- 397-400 假码顺手清理:描述文字(生活水分表DN20/绿化水分表DN40)被当编码存,挪去 meter_type。
-- 配套代码护栏:MeterService.applyDesc 写回编码前查占用,占用只 warn 不写回(同批提交)。
-- ⚠ 源文件侧待用户改(我不动原册):一期2024年2月水电费.xlsx『宿舍水』
--   行19(2111)/行124(1-516)/行295(4-652) 编码清空;行268(5-551) 改为 923110113。
-- 前置备份:demo3/backup-before-guanglian-dorm-20260803.sql(与广联脚本共用)

SET NAMES utf8mb4;
START TRANSACTION;
UPDATE meter SET code = NULL WHERE id = 855  AND code = '920620036';   -- 二栋2111周兴水:码归 1-310(902)
UPDATE meter SET code = NULL WHERE id = 960  AND code = '920620062';   -- 一栋1-516:码归 1-411(929)
UPDATE meter SET code = NULL WHERE id = 1131 AND code = '920620043';   -- 四栋4-652:码归 5-548(1101)
UPDATE meter SET meter_type = COALESCE(meter_type, code), code = NULL
WHERE id IN (397, 398, 399, 400) AND code LIKE '%DN%';                 -- 假码→管径型号
COMMIT;

SELECT id, name, code, meter_type FROM meter WHERE id IN (855,902,929,960,999,1000,1001,1101,1131,397,398,399,400);
SELECT code, COUNT(*) c FROM meter WHERE code IS NOT NULL GROUP BY code HAVING c > 1;
