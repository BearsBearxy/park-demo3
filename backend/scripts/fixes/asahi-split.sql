-- 旭化成(tenant 361)一合同拆两链 × 四周期 = 8 份合同
-- 依据:用户 2026-07-29 提供的两份纸质合同扫描件 + 周期三收费单(合计 31004.99)
--   纸约A「A座首层101室」   全价计租面积 489㎡      租金 13.0→14.3→15.7→17.3  基础设施 1.5→1.7→1.8→2.0
--   纸约B「A座二层201、202室」全价计租面积 476.9+64+98=638.9㎡ 租金 11.0→12.1→13.3→14.6  基础设施 1.5→1.7→1.8→2.0
--                          半价「消防通道」135.1+44.6=179.7㎡ 租金 5.5→6.1→6.7→7.3     基础设施同上
--   周期界 ①2017-10-27~2020-10-26 ②2020-10-27~2023-10-26 ③2023-10-27~2026-10-26 ④2026-10-27~2027-10-26
--   计租系数 1.56 只作用于全价面积(租金与基础设施两项);消防通道半价面积 coeff=1.0
--   表外:基本用电费 23元/KVA×400KVA 不入计费行(合同存 kva=400);变压器维护费 350;人才港使用费 550;
--        车位变更手续费 20(此前被"垃圾行"策略误删,本脚本补回);补充协议空地 14㎡×11.28=157.92(2023-07-01起,仅段3/段4)
--
-- 验收锚点(周期三,与收费单逐格全等):链1=13349.70,链2=17655.29,合计=31004.99
--   ⚠ 链2 全价面积必须按 476.9/64/98 三行分录:收费单逐间四舍五入,单行 638.9 会得 13255.90(差 0.01)
--
-- 命名:链1=C2024M-022A#1..#4(新号,A=纸约A) 链2=C2024M-022#1..#4(382→#3、383→#4 就地改造)
--   ⚠ 偏离翔海"末档留裸号"惯例:此处两份存量行(382 周期三 / 383 周期四空壳)分属同一链的两段,
--     统一 #1..#4 才能让两条链在合同链卡片上并排可读;contract_no 全库无外键引用(仅 contract 表 + esc_* 临时表)
-- 383 处置:改造复用而非删除(保留 id 与已有父指针,空壳无内容可失)
-- 段1/段2 无收费单实收佐证,按纸约单价×系数直接算
--
-- 幂等:重跑先删本脚本产物(#1/#2 及链1全部)并清空 382/383 计费行后整体重建
-- 前置备份:demo3/backup-before-asahi-split-20260729.sql

SET NAMES utf8mb4;
START TRANSACTION;

-- ── 1. 清理:本脚本历史产物 + 382/383 旧内容 + 伪单元 614 ──────────────
DELETE FROM contract_unit WHERE contract_id IN (382, 383);
DELETE FROM contract WHERE contract_no IN
  ('C2024M-022A#1','C2024M-022A#2','C2024M-022A#3','C2024M-022A#4','C2024M-022#1','C2024M-022#2');
DELETE FROM contract_billing_term WHERE contract_id IN (382, 383);
DELETE FROM unit WHERE id = 614 AND building_id = 13 AND unit_no = '1F整层';

-- ── 2. 期限原文 / 价格阶梯原文(每链一份,同链四段共用) ────────────────
SET @ttA = '纸质合同A「A座首层101室」分四个周期:一 2017-10-27~2020-10-26;二 2020-10-27~2023-10-26;三 2023-10-27~2026-10-26;四 2026-10-27~2027-10-26。';
SET @tpA = '101室(全价计租面积 489㎡)租金单价 13.0→14.3→15.7→17.3 元/㎡/月;基础设施维护费单价 1.5→1.7→1.8→2.0。计租系数 1.56(面积×单价×1.56)。';
SET @ttB = '纸质合同B「A座二层201、202室」分四个周期:一 2017-10-27~2020-10-26;二 2020-10-27~2023-10-26;三 2023-10-27~2026-10-26;四 2026-10-27~2027-10-26。补充协议(A座首层东侧绿化带空地14㎡)自2023-07-01起至2027-10-26止。';
SET @tpB = '201、202室(全价计租面积 476.9+64+98=638.9㎡)租金单价 11.0→12.1→13.3→14.6;消防通道(半价计租面积 135.1+44.6=179.7㎡)单价 5.5→6.1→6.7→7.3(不乘计租系数);基础设施维护费单价 1.5→1.7→1.8→2.0。全价面积计租系数 1.56。表外:基本用电费 23元/KVA×400KVA=9200元/月(不入计费行)。';

-- ── 3. 改造存量两行为链2的段3、段4;新建其余 6 段 ──────────────────────
UPDATE contract SET
  contract_no = 'C2024M-022#3', unit_id = 615, kva = 400.00, deposit = 0.00,
  start_date = '2023-10-27', end_date = '2026-10-26', status = 'active',
  term_type = 'multiple', term_text = @ttB, tier_price_note = @tpB,
  remark = '周期三:与收费单逐格核对全等(本链 17655.29,两链合计 31004.99)'
WHERE id = 382;

UPDATE contract SET
  contract_no = 'C2024M-022#4', unit_id = 615, kva = 400.00, deposit = 0.00,
  start_date = '2026-10-27', end_date = '2027-10-26', status = 'active',
  term_type = 'multiple', term_text = @ttB, tier_price_note = @tpB,
  remark = '周期四:按纸约单价×计租系数推算,无收费单实收佐证'
WHERE id = 383;

INSERT INTO contract
  (contract_no, tenant_id, building_id, unit_id, status, deposit, kva,
   start_date, end_date, term_type, term_text, tier_price_note, remark, link_type, kind)
VALUES
  ('C2024M-022A#1', 361, 13, 613, 'active', 0.00, NULL, '2017-10-27', '2020-10-26', 'multiple', @ttA, @tpA, '周期一:按纸约单价×计租系数推算,无收费单实收佐证', 'new', 'normal'),
  ('C2024M-022A#2', 361, 13, 613, 'active', 0.00, NULL, '2020-10-27', '2023-10-26', 'multiple', @ttA, @tpA, '周期二:按纸约单价×计租系数推算,无收费单实收佐证', 'new', 'normal'),
  ('C2024M-022A#3', 361, 13, 613, 'active', 0.00, NULL, '2023-10-27', '2026-10-26', 'multiple', @ttA, @tpA, '周期三:与纸约「合计」栏 13349.7 全等', 'new', 'normal'),
  ('C2024M-022A#4', 361, 13, 613, 'active', 0.00, NULL, '2026-10-27', '2027-10-26', 'multiple', @ttA, @tpA, '周期四:按纸约单价×计租系数推算,无收费单实收佐证', 'new', 'normal'),
  ('C2024M-022#1',  361, 13, 615, 'active', 0.00, 400.00, '2017-10-27', '2020-10-26', 'multiple', @ttB, @tpB, '周期一:按纸约单价×计租系数推算,无收费单实收佐证', 'new', 'normal'),
  ('C2024M-022#2',  361, 13, 615, 'active', 0.00, 400.00, '2020-10-27', '2023-10-26', 'multiple', @ttB, @tpB, '周期二:按纸约单价×计租系数推算,无收费单实收佐证', 'new', 'normal');

SET @a1 = (SELECT id FROM contract WHERE contract_no = 'C2024M-022A#1');
SET @a2 = (SELECT id FROM contract WHERE contract_no = 'C2024M-022A#2');
SET @a3 = (SELECT id FROM contract WHERE contract_no = 'C2024M-022A#3');
SET @a4 = (SELECT id FROM contract WHERE contract_no = 'C2024M-022A#4');
SET @b1 = (SELECT id FROM contract WHERE contract_no = 'C2024M-022#1');
SET @b2 = (SELECT id FROM contract WHERE contract_no = 'C2024M-022#2');
SET @b3 = 382;
SET @b4 = 383;

-- ── 4. 链1 计费行(2 行/段):489㎡ × 周期单价 × 1.56 ────────────────────
-- infra 的 property_type 留 NULL:ALLOWED_FEES['office'] 不含 infra,填了会被写路径校验拒
INSERT INTO contract_billing_term
  (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, seq, source)
SELECT v.cid, 'A座首层101室', v.pt, v.fk, v.fn, 'per_sqm_month', v.up, 489.00, 1.5600, v.seq, 'manual'
FROM (
  SELECT @a1 cid, 'office' pt, 'rent_office' fk, '办公室租金' fn, 13.0000 up, 0 seq
  UNION ALL SELECT @a1, NULL, 'infra', '基础设施维护费',  1.5000, 1
  UNION ALL SELECT @a2, 'office', 'rent_office', '办公室租金', 14.3000, 0
  UNION ALL SELECT @a2, NULL, 'infra', '基础设施维护费',  1.7000, 1
  UNION ALL SELECT @a3, 'office', 'rent_office', '办公室租金', 15.7000, 0
  UNION ALL SELECT @a3, NULL, 'infra', '基础设施维护费',  1.8000, 1
  UNION ALL SELECT @a4, 'office', 'rent_office', '办公室租金', 17.3000, 0
  UNION ALL SELECT @a4, NULL, 'infra', '基础设施维护费',  2.0000, 1
) v;

-- ── 5. 链2 计费行 ─────────────────────────────────────────────────────
-- 5a 全价面积 3 行租金 + 3 行基础设施(×1.56)。分行是硬要求:收费单逐间取整,合并 638.9 会差 0.01
INSERT INTO contract_billing_term
  (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, seq, source, note)
SELECT c.cid, 'A座二层201、202室', f.pt, f.fk, f.fn, 'per_sqm_month',
       CASE f.fk WHEN 'rent_office' THEN c.rent ELSE c.infra END,
       a.area, 1.5600, f.base + a.i, 'manual',
       '纸约全价计租面积 476.9+64+98=638.9㎡,按间分行以复现收费单逐格金额'
FROM (
  SELECT @b1 cid, 11.0000 rent, 1.5000 infra
  UNION ALL SELECT @b2, 12.1000, 1.7000
  UNION ALL SELECT @b3, 13.3000, 1.8000
  UNION ALL SELECT @b4, 14.6000, 2.0000
) c
CROSS JOIN (
  SELECT 'office' pt, 'rent_office' fk, '办公室租金' fn, 0 base
  UNION ALL SELECT NULL, 'infra', '基础设施维护费', 3
) f
CROSS JOIN (
  SELECT 476.90 area, 0 i UNION ALL SELECT 64.00, 1 UNION ALL SELECT 98.00, 2
) a;

-- 5b 消防通道(半价面积,不乘计租系数)
INSERT INTO contract_billing_term
  (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, seq, source)
SELECT c.cid, '消防通道', f.pt, f.fk, f.fn, 'per_sqm_month',
       CASE f.fk WHEN 'rent_land' THEN c.fire ELSE c.infra END, 179.70, 1.0000, f.seq, 'manual'
FROM (
  SELECT @b1 cid, 5.5000 fire, 1.5000 infra
  UNION ALL SELECT @b2, 6.1000, 1.7000
  UNION ALL SELECT @b3, 6.7000, 1.8000
  UNION ALL SELECT @b4, 7.3000, 2.0000
) c
CROSS JOIN (
  SELECT 'land' pt, 'rent_land' fk, '空地租金' fn, 6 seq
  UNION ALL SELECT NULL, 'infra', '基础设施维护费', 7
) f;

-- 5c 固定月额三项(全段) + 补充协议空地(仅段3/段4,2023-07-01 起)
INSERT INTO contract_billing_term
  (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, amount_override, seq, source)
SELECT c.cid, f.loc, f.pt, f.fk, f.fn, 'per_month', 0.0000, f.amt, f.seq, 'manual'
FROM (SELECT @b1 cid UNION ALL SELECT @b2 UNION ALL SELECT @b3 UNION ALL SELECT @b4) c
CROSS JOIN (
  SELECT 'A座101、201、202室' loc, 'office' pt, 'transformer' fk, '变压器维护费' fn, 350.00 amt, 8 seq
  UNION ALL SELECT '人才港使用费', NULL, 'other', '其他费用', 550.00, 10
  UNION ALL SELECT '车位变更手续费', NULL, 'other', '其他费用', 20.00, 11
) f;

INSERT INTO contract_billing_term
  (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, seq, source, note)
SELECT c.cid, 'A座首层东侧绿化带空地', 'land', 'rent_land', '空地租金', 'per_sqm_month',
       11.2800, 14.00, 1.0000, 9, 'manual', '补充协议 2023-07-01 起至 2027-10-26 止'
FROM (SELECT @b3 cid UNION ALL SELECT @b4) c;

-- ── 6. 单元归属:101→链1(主单元) 201→链2主单元 202→链2附加单元 ────────
INSERT INTO contract_unit (contract_id, unit_id)
SELECT cid, 616 FROM (SELECT @b1 cid UNION ALL SELECT @b2 UNION ALL SELECT @b3 UNION ALL SELECT @b4) c;

-- ── 7. 父指针与链接类型 ───────────────────────────────────────────────
UPDATE contract SET parent_contract_id = NULL, link_type = 'new'        WHERE id IN (@a1, @b1);
UPDATE contract SET parent_contract_id = @a1,  link_type = 'escalation' WHERE id = @a2;
UPDATE contract SET parent_contract_id = @a2,  link_type = 'escalation' WHERE id = @a3;
UPDATE contract SET parent_contract_id = @a3,  link_type = 'escalation' WHERE id = @a4;
UPDATE contract SET parent_contract_id = @b1,  link_type = 'escalation' WHERE id = @b2;
UPDATE contract SET parent_contract_id = @b2,  link_type = 'escalation' WHERE id = @b3;
UPDATE contract SET parent_contract_id = @b3,  link_type = 'escalation' WHERE id = @b4;

-- ── 8. 只读标量缓存回填(镜像 ContractService.syncScalarCache) ─────────
-- monthly_rent=Σ 行月额;rent_area=建筑类租金行(location,fee_key,area)去重和(rent_land 不计);
-- building_area=rent_area×0.8;unit_price/infra_fee_price/transformer_fee=各类 seq 最小行
UPDATE contract c SET
  c.monthly_rent = (
    SELECT COALESCE(SUM(CASE WHEN t.bill_mode = 'per_sqm_month'
                             THEN ROUND(t.area * t.unit_price * t.coeff, 2)
                             ELSE t.amount_override END), 0)
    FROM contract_billing_term t WHERE t.contract_id = c.id),
  c.rent_area = (
    SELECT COALESCE(SUM(d.area), 0) FROM (
      SELECT DISTINCT location, fee_key, area FROM contract_billing_term
      WHERE contract_id = c.id AND fee_key IN ('rent_factory','rent_office','rent_dorm','rent_shop')
    ) d),
  c.unit_price = (
    SELECT t.unit_price FROM contract_billing_term t
    WHERE t.contract_id = c.id AND t.bill_mode = 'per_sqm_month'
      AND t.fee_key IN ('rent_factory','rent_office','rent_dorm','rent_shop','rent_land')
    ORDER BY t.seq, t.id LIMIT 1),
  c.infra_fee_price = (
    SELECT t.unit_price FROM contract_billing_term t
    WHERE t.contract_id = c.id AND t.fee_key = 'infra' ORDER BY t.seq, t.id LIMIT 1),
  c.transformer_fee = (
    SELECT t.amount_override FROM contract_billing_term t
    WHERE t.contract_id = c.id AND t.fee_key = 'transformer' ORDER BY t.seq, t.id LIMIT 1),
  c.mgmt_fee_price = NULL, c.elevator_fee = NULL, c.elevator_count = NULL, c.elevator_floors = NULL
WHERE c.id IN (@a1, @a2, @a3, @a4, @b1, @b2, @b3, @b4);

UPDATE contract SET building_area = CASE WHEN rent_area > 0 THEN ROUND(rent_area * 0.8, 2) END
WHERE id IN (@a1, @a2, @a3, @a4, @b1, @b2, @b3, @b4);

COMMIT;
