-- 鑫皇(tenant 113)/李富全(tenant 362) 档案合并 + 合同 384 一行糊七场地拆七链
-- 依据:用户 2026-08-03 提供的纸质合同扫描件与收费 worksheet(sheet 名"李富全")。
--   李富全=鑫皇老板,2024-03 合同导入按 worksheet 名建了重复档案 362(台账/附表10 走"鑫皇"=113)。
--   用户拍板:统一使用「鑫皇」。362 在台账/附表10/池受益人零引用,仅合同 384 + 电表 248/249 挂着,可安全合并后删除。
--
-- 拆链(异期场地拆合同,宏玥/旭化成同款;各链期限来自纸约与 worksheet 备注):
--   A502 主链 C2024M-024#1 (2020-12-20~2023-12-19 租18.5/空地10/基础1.8) + #2 递增(2023-12-20~2026-12-19 20.35/11/1.98)
--     电梯150/变压器100/土地税205/68.75kVA(期1费项要素纸约未单列,沿用期2条款);月租 #1=41947 / #2=46096
--   A503 链 C2024M-024A#1 (2023-12-16~2026-12-19 租20/基础10+电梯159/变压器159/50kVA) 月租=19025.10
--     装修期口径入 remark:2024-01-06 移交,装修期至 2024-03-25 租金管理费按 50% 计收,3-26 起全价
--   宿舍五链(单价 19/2+门禁100元间年+网络50元间月,期限各异):
--     B=四栋529~543 8间(2024-02-01~2025-01-31)6391.82  C=一栋306,308,312,505,507,509 6间(同期)4646.18
--     D=四栋538 1间(2023-11-20~2025-01-31)825.46      E=一栋419,519 2间(同期)1975.17
--     F=四栋234,245,331,445,447 5间(2024-02-01~2024-03-31,已到期)3935.80
--   计费行整行搬移(UPDATE contract_id,按 location 前缀),bill_mode/room_count/override 原样保留零丢失;
--   A503 的装修期 50% 重复段(rent+infra 双份)不再保留——原 384 月租 101602.83 = 干净七链Σ82895.53 + 重复段18707.1(差0.2为间数均摊舍入),锚点自洽。
--   糊合同 S10-0060/0098/0133(台账导入占位,无日期无面积)删除:内容已被纸约链覆盖,并存会双计月租 KPI。
--   contract_unit 23 行按房号重新分配到各链(每链首间为主单元,余为附加)。
--
-- 幂等:重跑先删本脚本产物并把 terms/units 归还 384 假想态——实现为:按 contract_no 删新链,384 terms 不还原(直接整体重建 A502 两期行)。
-- 前置备份:demo3/backup-before-xinhuang-merge-20260803.sql

SET NAMES utf8mb4;
START TRANSACTION;

-- ── 0. 幂等清理 ──────────────
DELETE FROM contract_billing_term WHERE contract_id IN
  (SELECT id FROM (SELECT id FROM contract WHERE contract_no IN
    ('C2024M-024#2','C2024M-024A#1','C2024M-024B#1','C2024M-024C#1','C2024M-024D#1','C2024M-024E#1','C2024M-024F#1')) x);
DELETE FROM contract_unit WHERE contract_id IN
  (SELECT id FROM (SELECT id FROM contract WHERE contract_no IN
    ('C2024M-024#2','C2024M-024A#1','C2024M-024B#1','C2024M-024C#1','C2024M-024D#1','C2024M-024E#1','C2024M-024F#1')) x);
DELETE FROM contract WHERE contract_no IN
  ('C2024M-024#2','C2024M-024A#1','C2024M-024B#1','C2024M-024C#1','C2024M-024D#1','C2024M-024E#1','C2024M-024F#1');

-- ── 1. 电表归户:李富全名下两块电表 → 鑫皇 ──────────────
UPDATE meter SET tenant_id = 113 WHERE id IN (248, 249) AND tenant_id = 362;

-- ── 2. A502 主链:384 就地改造为 #1(期1),tenant 改 113 ──────────────
UPDATE contract SET
  contract_no = 'C2024M-024#1', tenant_id = 113, building_id = 13, unit_id = 622,
  rent_area = 1640.00, building_area = 1312.00, monthly_rent = 41947.00, kva = 68.75,
  start_date = '2020-12-20', end_date = '2023-12-19',
  term_type = 'explicit', term_text = '2020年12月20日至2023年12月19日',
  unit_price = 18.5000, mgmt_fee_price = NULL, infra_fee_price = 1.8000,
  elevator_fee = 150.00, transformer_fee = 100.00,
  status = 'active', link_type = 'new', parent_contract_id = NULL,
  remark = '鑫皇合并拆链(2026-08-03 图纸核对):原李富全档案一行糊七场地拆七链,本行=A502 期1;直接税金9%另收不入计费行;见 xinhuang-merge.sql',
  fee_src = '{"area": "manual", "rent": "manual", "infra": "manual", "elevator": "manual", "transformer": "manual"}'
WHERE id = 384;

-- 384 旧计费行整体清掉重建 A502 期1(其余 location 的行在下方各链搬移前仍挂 384,先搬再删避免误伤)
DELETE FROM contract_billing_term WHERE contract_id = 384 AND location = 'A座502室';
INSERT INTO contract_billing_term
  (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (384, 'A座502室', 'office', 'rent_office', '办公室租金',             'per_sqm_month', 18.5000, 1640.00, 1.0000, 'manual', NULL,   0),
  (384, 'A座502室', 'office', 'rent_land',   '空地租金',               'per_sqm_month', 10.0000,  820.00, 1.0000, 'manual', NULL,   1),
  (384, 'A座502室', 'office', 'infra',       '办公室基础设施维护费',   'per_sqm_month',  1.8000, 1640.00, 1.0000, 'manual', NULL,   2),
  (384, 'A座502室', 'office', 'elevator',    '电梯维护费',             'per_month',      0.0000, NULL,    1.0000, 'manual', 150.00, 3),
  (384, 'A座502室', 'office', 'transformer', '变压器维护费',           'per_month',      0.0000, NULL,    1.0000, 'manual', 100.00, 4),
  (384, 'A座502室', 'office', 'land_tax',    '土地使用税',             'per_month',      0.0000, NULL,    1.0000, 'manual', 205.00, 5);

-- A502 #2 递增段(2023-12-20 起,现行价)
INSERT INTO contract
  (contract_no, tenant_id, building_id, unit_id, rent_area, monthly_rent, deposit, start_date, end_date,
   term_type, term_text, status, remark, building_area, unit_price, infra_fee_price, elevator_fee, transformer_fee,
   kva, fee_src, parent_contract_id, link_type, kind) VALUES
  ('C2024M-024#2', 113, 13, 622, 1640.00, 46096.00, 0.00, '2023-12-20', '2026-12-19',
   'explicit', '2020年12月20日至2023年12月19日；2023年12月20日至2026年12月19日', 'active',
   '鑫皇拆链:A502 期2 递增段(租20.35/空地11/基础1.98)', 1312.00, 20.3500, 1.9800, 150.00, 100.00,
   68.75, '{"area": "manual", "rent": "manual", "infra": "manual", "elevator": "manual", "transformer": "manual"}',
   384, 'escalation', 'normal');
SET @a502_2 = LAST_INSERT_ID();
INSERT INTO contract_billing_term
  (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (@a502_2, 'A座502室', 'office', 'rent_office', '办公室租金',             'per_sqm_month', 20.3500, 1640.00, 1.0000, 'manual', NULL,   0),
  (@a502_2, 'A座502室', 'office', 'rent_land',   '空地租金',               'per_sqm_month', 11.0000,  820.00, 1.0000, 'manual', NULL,   1),
  (@a502_2, 'A座502室', 'office', 'infra',       '办公室基础设施维护费',   'per_sqm_month',  1.9800, 1640.00, 1.0000, 'manual', NULL,   2),
  (@a502_2, 'A座502室', 'office', 'elevator',    '电梯维护费',             'per_month',      0.0000, NULL,    1.0000, 'manual', 150.00, 3),
  (@a502_2, 'A座502室', 'office', 'transformer', '变压器维护费',           'per_month',      0.0000, NULL,    1.0000, 'manual', 100.00, 4),
  (@a502_2, 'A座502室', 'office', 'land_tax',    '土地使用税',             'per_month',      0.0000, NULL,    1.0000, 'manual', 205.00, 5);

-- ── 3. A503 链(单段;装修期 50% 口径入 remark;旧 terms 含 50% 重复段整删重建) ──────────────
INSERT INTO contract
  (contract_no, tenant_id, building_id, unit_id, rent_area, monthly_rent, deposit, start_date, end_date,
   term_type, term_text, status, remark, building_area, unit_price, infra_fee_price, elevator_fee, transformer_fee,
   kva, fee_src, parent_contract_id, link_type, kind) VALUES
  ('C2024M-024A#1', 113, 13, 623, 623.57, 19025.10, 0.00, '2023-12-16', '2026-12-19',
   'explicit', '2023年12月16日至2026年12月19日', 'active',
   '鑫皇拆链:A503(孵化)。2024-01-06 移交,装修期至 2024-03-25 租金管理费按 50% 计收,3-26 起全价;水电押金5000/孵化保证金56121(已付定金18707.01)不入计费行', 498.86, 20.0000, 10.0000, 159.00, 159.00,
   50.00, '{"area": "manual", "rent": "manual", "infra": "manual", "elevator": "manual", "transformer": "manual"}',
   NULL, 'new', 'normal');
SET @a503 = LAST_INSERT_ID();
DELETE FROM contract_billing_term WHERE contract_id = 384 AND location = 'A座503室';
INSERT INTO contract_billing_term
  (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, amount_override, seq) VALUES
  (@a503, 'A座503室', 'office', 'rent_office', '办公室租金',             'per_sqm_month', 20.0000, 623.57, 1.0000, 'manual', NULL,   0),
  (@a503, 'A座503室', 'office', 'infra',       '办公室基础设施维护费',   'per_sqm_month', 10.0000, 623.57, 1.0000, 'manual', NULL,   1),
  (@a503, 'A座503室', 'office', 'elevator',    '电梯维护费',             'per_month',      0.0000, NULL,   1.0000, 'manual', 159.00, 2),
  (@a503, 'A座503室', 'office', 'transformer', '变压器维护费',           'per_month',      0.0000, NULL,   1.0000, 'manual', 159.00, 3);

-- ── 4. 宿舍五链:建链后计费行按 location 前缀整行搬移(bill_mode/room_count 原样保留) ──────────────
INSERT INTO contract
  (contract_no, tenant_id, building_id, unit_id, rent_area, monthly_rent, deposit, start_date, end_date,
   term_type, term_text, status, remark, building_area, unit_price, infra_fee_price,
   fee_src, parent_contract_id, link_type, kind) VALUES
  ('C2024M-024B#1', 113, 29, 644, 282.15, 6391.82, 0.00, '2024-02-01', '2025-01-31',
   'explicit', '2024年02月01日至2025年01月31日', 'active', '鑫皇拆链:宿舍四栋529~543 共8间', 225.72, 19.0000, 2.0000,
   '{"area": "manual", "rent": "manual", "infra": "manual"}', NULL, 'new', 'normal'),
  ('C2024M-024C#1', 113, 26, 631, 204.58, 4646.18, 0.00, '2024-02-01', '2025-01-31',
   'explicit', '2024年02月01日至2025年01月31日', 'active', '鑫皇拆链:宿舍一栋(新俊楼)306、308、312、505、507、509 共6间', 163.66, 19.0000, 2.0000,
   '{"area": "manual", "rent": "manual", "infra": "manual"}', NULL, 'new', 'normal'),
  ('C2024M-024D#1', 113, 29, 649, 36.53, 825.46, 0.00, '2023-11-20', '2025-01-31',
   'explicit', '2023年11月20日至2025年01月31日', 'active', '鑫皇拆链:宿舍四栋538 1间', 29.22, 19.0000, 2.0000,
   '{"area": "manual", "rent": "manual", "infra": "manual"}', NULL, 'new', 'normal'),
  ('C2024M-024E#1', 113, 26, 634, 88.50, 1975.17, 0.00, '2023-11-20', '2025-01-31',
   'explicit', '2023年11月20日至2025年01月31日', 'active', '鑫皇拆链:宿舍一栋419、519 共2间', 70.80, 19.0000, 2.0000,
   '{"area": "manual", "rent": "manual", "infra": "manual"}', NULL, 'new', 'normal'),
  ('C2024M-024F#1', 113, 29, 639, 173.53, 3935.80, 0.00, '2024-02-01', '2024-03-31',
   'explicit', '2024年02月01日至2024年03月31日', 'active', '鑫皇拆链:宿舍四栋234、245、331、445、447 共5间(短租,已到期)', 138.82, 19.0000, 2.0000,
   '{"area": "manual", "rent": "manual", "infra": "manual"}', NULL, 'new', 'normal');

SET @b = (SELECT id FROM contract WHERE contract_no='C2024M-024B#1');
SET @c = (SELECT id FROM contract WHERE contract_no='C2024M-024C#1');
SET @d = (SELECT id FROM contract WHERE contract_no='C2024M-024D#1');
SET @e = (SELECT id FROM contract WHERE contract_no='C2024M-024E#1');
SET @f = (SELECT id FROM contract WHERE contract_no='C2024M-024F#1');

UPDATE contract_billing_term SET contract_id=@b, source='manual' WHERE contract_id=384 AND location LIKE '宿舍四座529%';
UPDATE contract_billing_term SET contract_id=@c, source='manual' WHERE contract_id=384 AND location LIKE '宿舍新俊楼一座%';
UPDATE contract_billing_term SET contract_id=@d, source='manual' WHERE contract_id=384 AND location LIKE '宿舍楼四座538%';
UPDATE contract_billing_term SET contract_id=@e, source='manual' WHERE contract_id=384 AND location LIKE '宿舍楼一座419%';
UPDATE contract_billing_term SET contract_id=@f, source='manual' WHERE contract_id=384 AND location LIKE '宿舍楼四座234%';

-- ── 5. 单元挂载重分配(384 的 23 行附加单元 → 各链;每链首间已做主单元) ──────────────
DELETE FROM contract_unit WHERE contract_id = 384;
INSERT INTO contract_unit (contract_id, unit_id) VALUES
  (@b, 645),(@b, 646),(@b, 647),(@b, 648),(@b, 650),(@b, 651),(@b, 652),   -- 531/533/535/537/539/541/543
  (@c, 632),(@c, 633),(@c, 635),(@c, 636),(@c, 637),                        -- 308/312/505/507/509
  (@e, 638),                                                                 -- 519
  (@f, 640),(@f, 641),(@f, 642),(@f, 643);                                   -- 245/331/445/447

-- ── 6. 删台账导入糊合同(内容已被纸约链覆盖,并存双计月租) ──────────────
DELETE FROM contract_billing_term WHERE contract_id IN (60, 98, 133);
DELETE FROM contract_unit WHERE contract_id IN (60, 98, 133);
DELETE FROM contract WHERE id IN (60, 98, 133) AND tenant_id = 113;

-- ── 7. 删李富全空壳档案(合同/表已迁走,台账/附表10/池零引用已核) ──────────────
DELETE FROM tenant WHERE id = 362
  AND NOT EXISTS (SELECT 1 FROM contract WHERE tenant_id = 362)
  AND NOT EXISTS (SELECT 1 FROM meter WHERE tenant_id = 362);

COMMIT;

-- ── 验收 ──────────────
SELECT c.id, c.contract_no, c.link_type, c.status, c.start_date, c.end_date, c.rent_area, c.monthly_rent,
       c.unit_id, (SELECT COUNT(*) FROM contract_unit u WHERE u.contract_id=c.id) extra_units,
       (SELECT COUNT(*) FROM contract_billing_term t WHERE t.contract_id=c.id) term_rows
FROM contract c WHERE c.tenant_id = 113 ORDER BY c.contract_no;
SELECT SUM(monthly_rent) AS 七链合计_应为82895_53 FROM contract WHERE tenant_id = 113 AND contract_no LIKE 'C2024M-024%'
  AND contract_no <> 'C2024M-024#1';
SELECT id, name, tenant_id FROM meter WHERE id IN (248, 249, 433, 434);
SELECT COUNT(*) AS 李富全残留_应为0 FROM tenant WHERE id = 362;
