-- 回滚两块被「编码命中」顶掉档案的表(用户 2026-09-23 报障:「为什么1期的抄表里面会出现二车间」)
--
-- 病根:MeterService 的导入身份链 L1=编码。某份二期文件里「广聚运通 二车间一楼102室」那一行
-- 的编码栏填的是 220605000144 —— 一期A座四楼428室 南盛物流 的码。L1 命中后 applyDesc 无条件
-- 回写 area/spot/tenant_name/building_id,而 zone 与 name 只在**新建**时写,于是这一行成了
-- 两块表拼起来的:期区/表名/租户id/编码还是一期的,位置/原册企业名称/楼栋成了二期的。
-- owner_manual=0 那一支当时不落任何 warn(本次已补,见 MeterService.applyDesc)。
--
-- 事实源:202405水电表数据表.xlsx(建档种子,import_log #96「企业名称/位置原文为 2024-05 版快照」)
--   一期园区电 r69: 南盛物流电 | A座 | 四楼428室 | 南盛物流 | 户内用电 | 电表① | 220605000144
--   宿舍电    r337: 宿舍路灯  | 宿舍区路灯 | (楼层/房号/企业名称/表号 全空)   | 220605000139
-- 旁证:编码段 2206050001xx 共 37 块表全部在一期(楼栋 13/20/21/22/41);
--       全库搜「广聚运通」在该种子里 0 处;南盛物流的水表 430 至今仍挂 A座四楼428室。

START TRANSACTION;

-- ① 243 南盛物流电 → 回一期 A座 四楼428室。
--    zone/name/tenant_id/code 本来就是对的,不动。
UPDATE meter SET
  area         = 'A座',
  spot         = '四楼428室',
  floor_label  = '四楼',
  side         = NULL,
  room_no      = '428室',
  tenant_name  = '南盛物流',
  building_id  = 13
WHERE id = 243 AND code = '220605000144';

-- ② 834 宿舍路灯 → 回「一期 宿舍区」(楼栋 12)。
--    种子里这一行区域之后全空,楼栋是导入按位置文本猜的,猜成了二期二车间。
--    定楼栋的依据是同类兄弟:835 一二路灯2 / 836 三四路灯 / 837 宿舍路灯公摊 /
--    1133 宿舍绿化水 / 1134 宿舍绿化水公摊 —— 五块「宿舍区」级公用表全挂楼栋 12。
--    spot/tenant_name 也是那次拼进来的(佳亿兴是二期二车间的户,且全库无此租户档案),一并清回空。
UPDATE meter SET
  area         = '宿舍区路灯',
  spot         = NULL,
  floor_label  = NULL,
  side         = NULL,
  room_no      = NULL,
  tenant_name  = NULL,
  building_id  = 12
WHERE id = 834 AND code = '220605000139';

COMMIT;

-- 校验(两条都应回 0 行):
--   SELECT m.id FROM meter m JOIN building b ON b.id=m.building_id WHERE m.zone <> b.zone;
--   SELECT id FROM meter WHERE id IN (243,834) AND building_id = 31;
--
-- ⚠ 未在本脚本内处理、需人工决定的:
--   243 在 2023-08 出过账 —— 那 1,284.49 度按**二期**损耗率收了,单据合计 ¥1,398.44,
--   明细里损耗行原文写着「链[二期 二车间+二期 三车间+二期 四车间]损耗…×率 0.00150000」。
--   本脚本只改档案,不动已出的 bill_notice。要改那张单子须重出 2023-08。
--   834 无此问题:zone=dorm 本就被 lossGroups 第一道过滤排除,且它进公摊池走的是
--   alloc_rule_meter 显式绑定(池 90 宿舍区·路灯),与 building_id 无关 —— 回滚不动任何金额。
