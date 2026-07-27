-- V61: 公摊单价改月行快照 + 补面积基数(POOL-FORMULA-AUDIT-2024-02 审计结论)
-- 审计实证:路灯0.005/消防0.015/绿化0.008·0.01/电梯0.08/宿舍绿化0.02 全部是「池金额÷面积基数」月推值,
-- 不是常数——V60 误作默认行,改为 2024-02 月行快照(该月推导输出),其余月份由 S3 引擎按池现算。
UPDATE tenant_price_cfg SET acct_month='2024-02',
  note=CONCAT(IFNULL(note,''), ' | 月推值,此行=2024-02快照(POOL-FORMULA-AUDIT)')
WHERE acct_month='' AND (
     (scope=''     AND cfg_key='green_water')
  OR (scope='dorm' AND cfg_key='green_water')
  OR (scope='p2'   AND cfg_key='green_water_hi')
  OR (scope='p2'   AND cfg_key='lamp_sqm')
  OR (scope='p2'   AND cfg_key='fire_sqm')
  OR (scope='p1'   AND cfg_key='elevator_sqm'));

-- 面积基数参数(审计新实证):二期园区总面积 148918.01㎡(消防/路灯/绿化池分母,硬编码10格);
-- A座电梯面积基数 12487.04㎡(含空置的历史计费面积,与在租面积17424.19不符系原表口径)。
INSERT INTO tenant_price_cfg (scope, cfg_key, cfg_value, note) VALUES
  ('p2', 'area_base',          148918.01, '二期园区总面积基数;消防ROUND2位+广告字档/路灯绿化ROUND3位 (POOL-FORMULA-AUDIT)'),
  ('p1', 'elevator_area_base', 12487.04,  'A座电梯面积基数(历史计费面积,原表硬编码) (POOL-FORMULA-AUDIT)');
