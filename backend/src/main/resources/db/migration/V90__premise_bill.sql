-- V90__premise_bill.sql — S5 §1:公摊面积单列 + 明细行费用组
ALTER TABLE contract_billing_term
  ADD COLUMN area_shared DECIMAL(12,2) NULL
  COMMENT '公摊面积;非空=area为建筑面积(分摊按area+area_shared,账单显示拆解),空=area已含公摊;宿舍留空(S5 §1)';
ALTER TABLE bill_notice_line
  ADD COLUMN fee_group VARCHAR(8) NULL COMMENT 'rent/elec/water;板块分组与paymap首路由(S5 §1)';
UPDATE bill_notice_line SET fee_group = CASE
  WHEN fee_key IN ('water','water_pipe','share_green_water') THEN 'water' ELSE 'elec' END;
