-- V100 二期「供电局综合电价（月均裸价）」elec_grid_avg 月行种子(用户 2026-08-16 拍板 M1:开统一修改入口而非写死)。
-- 数值来源 = 各月二期源册 火炬园（按实际表用量推算）「一至四车间高压用电分配」单价(度数×单价 那格的单价),
--   即供电局高压账单 总金额÷总度数(docs/research/2026-08-16-param-research/p2_synthesis.md §2.1「火炬园高压分配 度数×单价」行);
--   2024-02 取 1.09312 = 退役常数 p2.price_loss 1.25312 − 0.16(V47 注释「分摊分析 K27」;源册火炬园 L24 显示 1.093123)。
-- 消费点:AllocService.lossPrice(p2) = elec_grid_avg + mgmt_fee(缺月回退 elec_flat + mgmt_fee)——只影响公共电核算/对账屏的
--   度数口径损耗金额与 alloc_result.share_elec_loss,催缴单(金额基数×率)不读它。以后每月在「计费参数」页 ① 区填。
INSERT IGNORE INTO tenant_price_cfg (scope, cfg_key, acct_month, mode, cfg_value, note) VALUES
  ('p2', 'elec_grid_avg', '2023-08', 'month', 1.19129536, '2023-08 二期源册 火炬园 高压用电分配单价(2640 度×1.19129536)'),
  ('p2', 'elec_grid_avg', '2023-09', 'month', 1.19502904, '2023-09 二期源册 火炬园 高压用电分配单价(2922.5 度×1.19502904)'),
  ('p2', 'elec_grid_avg', '2023-10', 'month', 1.09842968, '2023-10 二期源册 火炬园 高压用电分配单价(3232.5 度×1.09842968)'),
  ('p2', 'elec_grid_avg', '2023-11', 'month', 1.03205817, '2023-11 二期源册 火炬园 高压用电分配单价(3385 度×1.03205817)'),
  ('p2', 'elec_grid_avg', '2023-12', 'month', 0.93727966, '2023-12 二期源册 火炬园 高压用电分配单价(4095 度×0.93727966)'),
  ('p2', 'elec_grid_avg', '2024-02', 'month', 1.09312000, '2024-02 二期综合月均裸价(退役常数 1.25312−0.16;源册火炬园 L24 1.093123)');
INSERT INTO param_change_log (actor, tbl, scope, cfg_key, acct_month, mode, new_value, note, action)
  SELECT 'migrate', 'price', scope, cfg_key, acct_month, mode, cfg_value, 'V100 elec_grid_avg 六月种子', 'migrate'
    FROM tenant_price_cfg WHERE cfg_key = 'elec_grid_avg';
