-- V98__loss_result_formula_rate.sql — S21 损耗率公式定稿(S21-PARAM-CENTER-SPEC §4.2/§4.3):
-- ① alloc_loss_result 快照加三列:formula_rate=三式公式算出的率(手工率覆盖时并排备查)、manual_rate=手工收取率
--    (building:{head}.loss_rate_manual 命中值,无=NULL)、denom_qty=率的分母(loss_denom_cable=1 时 C+铝缆,否则 C)。
--    tenant_rate 语义不变:manual 非空取 manual,否则= formula_rate。历史快照三列留 NULL(重生成后回填)。
-- ② 损耗费单价/对账价改走价目簿月价(一期=elec_commercial+mgmt_fee_commercial;二期=elec_flat+mgmt_fee),
--    V47 种子的 alloc_cfg p1.price_flat(1.11417 截断值)/p2.price_loss 两行退役删除(V97 文件头预告在此批删)。
ALTER TABLE alloc_loss_result
  ADD COLUMN formula_rate DECIMAL(10,6) NULL COMMENT '公式率(net/share_only 三式算出;手工率覆盖时备查)' AFTER tenant_rate,
  ADD COLUMN manual_rate  DECIMAL(10,6) NULL COMMENT '手工收取率 loss_rate_manual(命中即覆盖 tenant_rate)' AFTER formula_rate,
  ADD COLUMN denom_qty    DECIMAL(14,2) NULL COMMENT '率分母:C 或 C+铝缆(loss_denom_cable)' AFTER manual_rate;

DELETE FROM alloc_cfg WHERE (scope = 'p1' AND cfg_key = 'price_flat') OR (scope = 'p2' AND cfg_key = 'price_loss');
INSERT INTO param_change_log (actor, tbl, scope, cfg_key, acct_month, mode, note, action)
  VALUES ('migrate', 'alloc', '', '', '', 'from', 'V98 退役 p1.price_flat/p2.price_loss:损耗价与对账价改走价目簿月价', 'migrate');
