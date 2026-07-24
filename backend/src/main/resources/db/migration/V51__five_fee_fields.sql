-- V51__five_fee_fields.sql — 五费项固定字段(BILL-FORWARD-SPEC 刀1 二次返工裁定③④,存储定案方案A)。
-- 五费项+电费签约要素并入 contract 宽表;contract_billing_term 降级为「其他费项留档」表(非五费项行保留,产品概念退役)。
-- fee_src=字段级来源映射 JSON({"rent":"import","mgmt":"manual",...}):导入覆盖 import 值、保留 manual 值(§1.2-5)。
ALTER TABLE contract
  ADD COLUMN mgmt_fee_price  DECIMAL(12,4) NULL COMMENT '企业管理服务费单价 元/㎡/月(含税)',
  ADD COLUMN infra_fee_price DECIMAL(12,4) NULL COMMENT '基础设施维护费单价 元/㎡/月(含税)',
  ADD COLUMN elevator_count  INT NULL COMMENT '货梯数N(电梯维护费规则 N×150×L)',
  ADD COLUMN elevator_floors INT NULL COMMENT '计费层数L(已扣首层)',
  ADD COLUMN elevator_fee    DECIMAL(12,2) NULL COMMENT '电梯维护费覆盖月额(优先于规则派生)',
  ADD COLUMN transformer_fee DECIMAL(12,2) NULL COMMENT '变压器维护费覆盖月额(规则:KVA<150含未填=159,≥150=1元/KVA/月)',
  ADD COLUMN power_type      VARCHAR(16) NULL COMMENT '用电分类 industrial|commercial|resident',
  ADD COLUMN kva             DECIMAL(10,2) NULL COMMENT '配电容量KVA(仅大工业,人工补录)',
  ADD COLUMN fee_src         JSON NULL COMMENT '字段级来源 {rent|mgmt|infra|elevator|transformer|area: import|manual}';

-- ── 477 行存量条款按费项名映射迁移(§1.1,零静默丢弃) ──
-- MAX(source):'manual' > 'import' 字典序,任一行手录即记 manual(导入不覆盖)。

-- 租金单价:仅四类标准租金行(厂房/办公室/商铺/宿舍),组内单一价才回填(多价并存不猜不动,留档待人工)
UPDATE contract c JOIN (
  SELECT contract_id, MIN(unit_price) AS p, MAX(source) AS s
  FROM contract_billing_term
  WHERE bill_mode = 'per_sqm_month' AND fee_name IN ('厂房租金','办公室租金','商铺租金','宿舍租金')
  GROUP BY contract_id HAVING COUNT(DISTINCT unit_price) = 1
) t ON t.contract_id = c.id
SET c.unit_price = t.p,
    c.fee_src = JSON_SET(COALESCE(c.fee_src, '{}'), '$.rent', t.s);

-- 管理费单价
UPDATE contract c JOIN (
  SELECT contract_id, MIN(unit_price) AS p, MAX(source) AS s
  FROM contract_billing_term
  WHERE bill_mode = 'per_sqm_month' AND fee_name LIKE '%企业管理服务费%'
  GROUP BY contract_id HAVING COUNT(DISTINCT unit_price) = 1
) t ON t.contract_id = c.id
SET c.mgmt_fee_price = t.p,
    c.fee_src = JSON_SET(COALESCE(c.fee_src, '{}'), '$.mgmt', t.s);

-- 基础维护单价
UPDATE contract c JOIN (
  SELECT contract_id, MIN(unit_price) AS p, MAX(source) AS s
  FROM contract_billing_term
  WHERE bill_mode = 'per_sqm_month' AND fee_name LIKE '%基础设施维护费%'
  GROUP BY contract_id HAVING COUNT(DISTINCT unit_price) = 1
) t ON t.contract_id = c.id
SET c.infra_fee_price = t.p,
    c.fee_src = JSON_SET(COALESCE(c.fee_src, '{}'), '$.infra', t.s);

-- 电梯/变压器维护费固定月额 → 覆盖月额(多通知单块行按合同求和=该户月总额)
UPDATE contract c JOIN (
  SELECT contract_id, SUM(unit_price) AS p, MAX(source) AS s
  FROM contract_billing_term
  WHERE bill_mode = 'per_month' AND fee_name = '电梯维护费'
  GROUP BY contract_id
) t ON t.contract_id = c.id
SET c.elevator_fee = t.p,
    c.fee_src = JSON_SET(COALESCE(c.fee_src, '{}'), '$.elevator', t.s);

UPDATE contract c JOIN (
  SELECT contract_id, SUM(unit_price) AS p, MAX(source) AS s
  FROM contract_billing_term
  WHERE bill_mode = 'per_month' AND fee_name = '变压器维护费'
  GROUP BY contract_id
) t ON t.contract_id = c.id
SET c.transformer_fee = t.p,
    c.fee_src = JSON_SET(COALESCE(c.fee_src, '{}'), '$.transformer', t.s);

-- 已成功映射进宽表的五费项行删除(数据已迁,避免双份事实);
-- 映射不上的(多价并存/空地租金/门禁/网络/税费/文本单价…)全部保留 = 「其他费项」留档,待人工处置。
DELETE t FROM contract_billing_term t JOIN contract c ON c.id = t.contract_id
WHERE (t.bill_mode = 'per_sqm_month' AND t.fee_name IN ('厂房租金','办公室租金','商铺租金','宿舍租金')
       AND c.unit_price IS NOT NULL AND t.unit_price = c.unit_price)
   OR (t.bill_mode = 'per_sqm_month' AND t.fee_name LIKE '%企业管理服务费%'
       AND c.mgmt_fee_price IS NOT NULL AND t.unit_price = c.mgmt_fee_price)
   OR (t.bill_mode = 'per_sqm_month' AND t.fee_name LIKE '%基础设施维护费%'
       AND c.infra_fee_price IS NOT NULL AND t.unit_price = c.infra_fee_price)
   OR (t.bill_mode = 'per_month' AND t.fee_name = '电梯维护费' AND c.elevator_fee IS NOT NULL)
   OR (t.bill_mode = 'per_month' AND t.fee_name = '变压器维护费' AND c.transformer_fee IS NOT NULL);
