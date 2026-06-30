-- V19__charging_cat_operators.sql — 充电桩类别重做为「运营商」口径（规范 §2.3）。
-- 清旧充电类别(dc/ac/shed/smart)与全部记录种子，重建运营商字典：
--   no=7 汽车桩：wancheng 万城万 / xiaoju 小桔
--   no=8 电动车桩：dingding 叮叮充 / dianxin 电信
-- 记录留空待导入（屏空 by design），tint 取已定义色 slate/blue/cyan（同附表内两类别取不同色）。

DELETE FROM charging_record;
DELETE FROM charging_cat;

INSERT INTO charging_cat (schedule_no, cat_id, name, `short`, tint, sort_no) VALUES
(7,'wancheng','万城万','万城万','slate',1),
(7,'xiaoju','小桔','小桔','blue',2),
(8,'dingding','叮叮充','叮叮充','cyan',1),
(8,'dianxin','电信','电信','slate',2);
