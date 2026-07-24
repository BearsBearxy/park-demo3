-- V52__flat_billing_lines.sql — 扁平计费行(BILL-FORWARD-SPEC 刀1 三次返工重写 §1.1/§1.5)。
-- contract_billing_term 复用(不新建 contract_billing_line 表,不改表名),+4 列即成型;
-- fee_key 语义由「附表10 colId」改为「13 受控枚举」;V51 五标量列保留=只读同步缓存(反拆已持值)。
-- ponytail: 表名保留 contract_billing_term,DTO/API 对外用 BillingLine 命名,省一次数据搬迁。

-- ① 新增计费行四列(fee_key 列已存在,语义改受控枚举)
ALTER TABLE contract_billing_term
  ADD COLUMN location        VARCHAR(64)   NULL AFTER contract_id,   -- 位置文本(E座3-4层/宿舍楼/空地/主…),从 params.prop 提升
  ADD COLUMN room_count      INT           NULL,                     -- 房数(门禁/网络按间计费)
  ADD COLUMN amount_override DECIMAL(12,2) NULL,                     -- 直填月额(电梯/变压器/税/其他),优先于 bill_mode 派生
  ADD COLUMN seq             INT           NOT NULL DEFAULT 0;       -- 位置内行序

-- ② 留档 157 行回填新列(§1.5-3):location←params.prop、room_count←params.rooms、
--    per_month 行 amount_override←unit_price、fee_key←fee_name 归一映射。
--    含 16 户 unit_price=NULL 的多价租金行(V51 DELETE 遇 NULL 未删,仍在表内)→ 回填后即成计费行。
UPDATE contract_billing_term SET
  location = COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(params, '$.prop')), 'null'), '主'),
  room_count = CASE WHEN JSON_EXTRACT(params, '$.rooms') IS NULL THEN NULL
                    ELSE JSON_EXTRACT(params, '$.rooms') END,
  amount_override = CASE WHEN bill_mode = 'per_month' THEN unit_price ELSE NULL END,
  fee_key = CASE
    WHEN fee_name LIKE '%基础设施维护费%' THEN 'infra'
    WHEN fee_name LIKE '%企业管理服务费%' THEN 'mgmt'
    WHEN fee_name LIKE '%门禁%'          THEN 'access'
    WHEN fee_name LIKE '%网络%'          THEN 'network'
    WHEN fee_name LIKE '%土地使用税%'    THEN 'land_tax'
    WHEN fee_name LIKE '%电梯%'          THEN 'elevator'
    WHEN fee_name LIKE '%变压器%'        THEN 'transformer'
    WHEN fee_name LIKE '%厂房租金%'      THEN 'rent_factory'
    WHEN fee_name LIKE '%办公室租金%'    THEN 'rent_office'
    WHEN fee_name LIKE '%宿舍租金%'      THEN 'rent_dorm'
    WHEN fee_name LIKE '%商铺租金%'      THEN 'rent_shop'
    WHEN fee_name LIKE '%空地租金%'      THEN 'rent_land'
    ELSE 'other'
  END,
  bill_mode = CASE
    WHEN fee_name LIKE '%门禁%' THEN 'per_room_year'
    WHEN fee_name LIKE '%网络%' THEN 'per_room_month'
    ELSE bill_mode
  END
WHERE 1 = 1;

-- 留档行位置内序号:同合同同位置按 id 递增编号(呈现稳定序)
UPDATE contract_billing_term t
JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY contract_id, location ORDER BY id) AS rn
  FROM contract_billing_term
) r ON r.id = t.id
SET t.seq = r.rn;

-- ③ 反拆 V51 五标量 → 计费行(§1.5-2):每个非空标量各 INSERT 一条 line(location='主')。
--    source 取 fee_src 对应键(缺省 import);租户类型无法判定(business_type 全'未分类')→ 缺省 rent_factory。
INSERT INTO contract_billing_term
  (contract_id, location, fee_key, fee_name, bill_mode, unit_price, area, coeff, amount_override, seq, source)
SELECT c.id, '主', 'rent_factory', '厂房租金', 'per_sqm_month', c.unit_price, c.rent_area, 1, NULL, 1,
       COALESCE(JSON_UNQUOTE(JSON_EXTRACT(c.fee_src, '$.rent')), 'import')
FROM contract c WHERE c.unit_price IS NOT NULL;

INSERT INTO contract_billing_term
  (contract_id, location, fee_key, fee_name, bill_mode, unit_price, area, coeff, amount_override, seq, source)
SELECT c.id, '主', 'mgmt', '企业管理服务费', 'per_sqm_month', c.mgmt_fee_price, c.rent_area, 1, NULL, 2,
       COALESCE(JSON_UNQUOTE(JSON_EXTRACT(c.fee_src, '$.mgmt')), 'import')
FROM contract c WHERE c.mgmt_fee_price IS NOT NULL;

INSERT INTO contract_billing_term
  (contract_id, location, fee_key, fee_name, bill_mode, unit_price, area, coeff, amount_override, seq, source)
SELECT c.id, '主', 'infra', '基础设施维护费', 'per_sqm_month', c.infra_fee_price, c.rent_area, 1, NULL, 3,
       COALESCE(JSON_UNQUOTE(JSON_EXTRACT(c.fee_src, '$.infra')), 'import')
FROM contract c WHERE c.infra_fee_price IS NOT NULL;

INSERT INTO contract_billing_term
  (contract_id, location, fee_key, fee_name, bill_mode, unit_price, area, coeff, amount_override, seq, source)
SELECT c.id, '主', 'elevator', '电梯维护费', 'per_month', 0, NULL, 1, c.elevator_fee, 4,
       COALESCE(JSON_UNQUOTE(JSON_EXTRACT(c.fee_src, '$.elevator')), 'import')
FROM contract c WHERE c.elevator_fee IS NOT NULL;

INSERT INTO contract_billing_term
  (contract_id, location, fee_key, fee_name, bill_mode, unit_price, area, coeff, amount_override, seq, source)
SELECT c.id, '主', 'transformer', '变压器维护费', 'per_month', 0, NULL, 1, c.transformer_fee, 5,
       COALESCE(JSON_UNQUOTE(JSON_EXTRACT(c.fee_src, '$.transformer')), 'import')
FROM contract c WHERE c.transformer_fee IS NOT NULL;

-- ④ 同步缓存:16 户多价租金行的 unit_price 从留档接回宽表(V51 未回填的正是这批)。
--    主租金行 = 每户 per_sqm_month rent_* 行中 seq 最小者(单价口径,per_month 月额行不入选)。
UPDATE contract c
JOIN (
  SELECT contract_id, unit_price
  FROM (
    SELECT contract_id, unit_price,
           ROW_NUMBER() OVER (PARTITION BY contract_id ORDER BY seq, id) AS rn
    FROM contract_billing_term
    WHERE bill_mode = 'per_sqm_month'
      AND fee_key IN ('rent_factory','rent_office','rent_dorm','rent_shop','rent_land')
  ) x WHERE x.rn = 1
) m ON m.contract_id = c.id
SET c.unit_price = m.unit_price
WHERE c.unit_price IS NULL;
