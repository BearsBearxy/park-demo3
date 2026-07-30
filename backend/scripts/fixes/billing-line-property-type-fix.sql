-- billing-line-property-type-fix.sql — 回填 infra 计费行的 property_type(2026-07-29)
--
-- 背景:用户 2026-07-29 出示旭化成合同卡截图,反映「标的段与费用」里租金行看不见,开头连着 5 个「厂房…基础设施维护费」。
-- 根因两层:
--   ① 数据:infra 行 property_type 为空(全库 28 条),前端 inferPropertyType 对非租金费项兜底成 'factory' → 误标「厂房」,
--      且与同场地的租金行(office/land)被拆进两个段带;
--   ② 排序:ContractService.loadLines 曾按 property_type 首排,MySQL NULL 靠前 → infra 行顶到卡片最上、租金行沉底(已改为按 seq)。
-- 另:ALLOWED_FEES 原先 office/land 不允许 infra 费项,与旭化成纸约「办公室基础设施维护费」1373.11、
--    消防通道(land)基础设施费 323.46 冲突 → 白名单已按纸约更正(同批代码改动)。
--
-- 口径:仅回填「同一(合同,场地)下租金行性质唯一」的 infra 行,取该租金行的 property_type。
--      fee_key='other'(人才港使用费/车位变更手续费等杂费)不属任何标的性质,**保持 NULL 不回填**。
-- 幂等:仅 UPDATE property_type IS NULL 的行,重跑 0 行受影响。

UPDATE contract_billing_term b
JOIN (
  SELECT r.contract_id, r.location, MIN(r.property_type) AS pt
  FROM contract_billing_term r
  WHERE r.fee_key LIKE 'rent%' AND r.property_type IS NOT NULL
  GROUP BY r.contract_id, r.location
  HAVING COUNT(DISTINCT r.property_type) = 1
) s ON s.contract_id = b.contract_id AND s.location = b.location
SET b.property_type = s.pt
WHERE b.property_type IS NULL AND b.fee_key = 'infra';

-- 第二刀:同场地既有建筑租金又有空地租金(如「A座602室」office+land)时,基础设施维护费归**建筑**性质
-- (基础设施维护费是楼宇的,不是空地的;旭化成消防通道那种空地自带 infra 的情形是独立 location,不受本刀影响)。
UPDATE contract_billing_term b
JOIN (
  SELECT r.contract_id, r.location, MIN(r.property_type) AS pt
  FROM contract_billing_term r
  WHERE r.fee_key IN ('rent_factory','rent_office','rent_dorm','rent_shop') AND r.property_type IS NOT NULL
  GROUP BY r.contract_id, r.location
  HAVING COUNT(DISTINCT r.property_type) = 1
) s ON s.contract_id = b.contract_id AND s.location = b.location
SET b.property_type = s.pt
WHERE b.property_type IS NULL AND b.fee_key = 'infra';
