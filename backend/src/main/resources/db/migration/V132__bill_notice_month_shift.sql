-- 催缴单月份改为「收费月」(2026-09-28 用户定,同源册:《2023年9月租金》里放的是「2023年8月水电费」和 9 月的租金通知单)。
-- 改后:ym 月的单 = 上月水电(读数/公摊/损耗/容量费/水电价)+ 本月租金(BillNoticeService 类头「月份口径」)。
-- 改前:ym 月的单 = 本月水电 + 本月租金。
--
-- 现有的单整体往后挪一个月,让「单上的水电 ↔ 读数月」在挪完后仍是新口径的对应关系 ——
-- 已确认单冻结表档案、批删读数的守卫、需重算判据、公摊池回填都靠这条对应。
-- 挪完后单上的租金是上个月的:草稿重新生成即按新口径改好;已确认/已导出的单 generate 不碰,
-- 要作废后重新生成(已导出的撤不回确认,作废是唯一出口)。
--
-- 一起挪的还有按单月记的两样:
--   · 备注人工覆盖(bill_note_override.ym)—— **只挪水电行的**。租金行的备注写的是那个月的租金,
--     租金那半张单的月份没变(N 月的单仍收 N 月租金),挪了就挂到下个月的租金上去了。
--     租金行的费项键 = 合同计费行的费项(ContractService.FEE_KEYS 那 13 个),与水电的键不重叠。
--   · 催缴单审核键(bill-notices:YYYY-MM:review_state 的主键和 period、review_log 的键)。
-- 其余按读数月记的(param_change_log / data_change_log / alloc_pool_result / alloc_loss_*)本来就是水电月,不动。
--
-- 从大月往小月挪(ORDER BY ... DESC):逐行 UPDATE 时 uk 按行检查,先挪小月会撞上还没挪走的下一个月。
-- 只挪格式合法的月份(不合法的 STR_TO_DATE 回 NULL,严格模式下撞 NOT NULL 会让整次部署失败)。
-- ⚠ 单表 UPDATE 的 SET 从左往右算,后面的表达式读到的是前面已经改过的值:
--   review_state 那条先由旧 period 拼 review_key,再改 period,顺序不能换。

UPDATE bill_notice
   SET ym = DATE_FORMAT(DATE_ADD(STR_TO_DATE(CONCAT(ym, '-01'), '%Y-%m-%d'), INTERVAL 1 MONTH), '%Y-%m')
 WHERE ym REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])$'
 ORDER BY ym DESC;

UPDATE bill_note_override
   SET ym = DATE_FORMAT(DATE_ADD(STR_TO_DATE(CONCAT(ym, '-01'), '%Y-%m-%d'), INTERVAL 1 MONTH), '%Y-%m')
 WHERE ym REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])$'
   AND fee_key NOT IN ('rent_factory', 'rent_office', 'rent_dorm', 'rent_shop', 'rent_land',
                       'mgmt', 'infra', 'elevator', 'transformer', 'access', 'network', 'land_tax', 'other')
 ORDER BY ym DESC;

UPDATE review_state
   SET review_key = CONCAT('bill-notices:',
         DATE_FORMAT(DATE_ADD(STR_TO_DATE(CONCAT(period, '-01'), '%Y-%m-%d'), INTERVAL 1 MONTH), '%Y-%m')),
       period = DATE_FORMAT(DATE_ADD(STR_TO_DATE(CONCAT(period, '-01'), '%Y-%m-%d'), INTERVAL 1 MONTH), '%Y-%m')
 WHERE kind = 'bill-notices' AND period REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])$'
 ORDER BY period DESC;

UPDATE review_log
   SET review_key = CONCAT('bill-notices:',
         DATE_FORMAT(DATE_ADD(STR_TO_DATE(CONCAT(SUBSTRING(review_key, 14), '-01'), '%Y-%m-%d'), INTERVAL 1 MONTH), '%Y-%m'))
 WHERE review_key REGEXP '^bill-notices:[0-9]{4}-(0[1-9]|1[0-2])$';
