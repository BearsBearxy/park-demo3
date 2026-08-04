-- 仁恒纸面数落定(2026-08-04 用户拍板"以纸面数为准用"):
-- ①S10-0103 新段企业管理服务费:纸约 4527.1,派生 411.55×11=4527.05 → 直填月额 4527.10
-- ②A315 土地使用税(两段):通知单 37.80,派生 157.56×0.24=37.8144→37.81 → 直填月额 37.80
-- 手法:bill_mode 改 per_month(amount_override 优先),unit_price/area 原值保留作出处,note 记依据。
UPDATE contract_billing_term SET bill_mode='per_month', amount_override=4527.10,
  note='纸约价4527.1(411.55×11=4527.05,以纸面数为准,2026-08-04拍板)'
WHERE id=7421;
UPDATE contract_billing_term SET bill_mode='per_month', amount_override=37.80,
  note='通知单37.80(157.56×0.24=37.81,以纸面数为准,2026-08-04拍板)'
WHERE id IN (6590, 7428);

-- 标量缓存同步(镜像 syncScalarCache:monthly_rent=Σ行月额;其余缓存不受影响)
UPDATE contract SET monthly_rent=13997.97 WHERE id=103;   -- 9054.1+4527.10+159+159+98.77
UPDATE contract SET monthly_rent=5337.28  WHERE id=404;   -- 3466.32+1733.16+100+37.80
UPDATE contract SET monthly_rent=4864.60  WHERE id=403;   -- 3151.2+1575.6+100+37.80

SELECT id, bill_mode, unit_price, area, amount_override, note FROM contract_billing_term WHERE id IN (7421,6590,7428);
SELECT id, contract_no, monthly_rent FROM contract WHERE id IN (103,404,403);
