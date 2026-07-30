-- meter_merge_shadow.sql — 影子档案清单与合并(METER-IMPORT-SPEC §5)
-- ⚠ 默认只跑清单查询。合并语句全部注释,人工核对清单后再逐段放开。
-- ⚠ 执行前 mysqldump 备份。
--
-- 成因:旧导入用 (kind,zone,name) 当身份,name 是会变的文本 →
--   A 类:Excel 房号 101(文本)vs 101.00(数值)被当成两块表,261 对,历史读数被切成两段;
--   B 类:尖峰平谷四栏被当成 4 块独立表(name 以 尖/峰/平/谷 结尾),28 条,还落进了公摊池虚增用量。
-- 解析器已在源头堵住(去尾零 + 分层身份键),本脚本只处理存量。

-- ── ① A 类清单:影子(name)与正档(name.00),含各自读数区间 ──
SELECT a.id  AS shadow_id, a.name AS shadow_name, ra.mn AS shadow_min_ym, ra.mx AS shadow_max_ym, ra.cnt AS shadow_readings,
       b.id  AS keep_id,   b.name AS keep_name,   rb.mn AS keep_min_ym,   rb.mx AS keep_max_ym,   rb.cnt AS keep_readings,
       b.area, b.spot, b.tenant_name
FROM meter a
JOIN meter b ON a.kind = b.kind AND a.zone = b.zone AND b.name = CONCAT(a.name, '.00')
LEFT JOIN (SELECT meter_id, MIN(ym) mn, MAX(ym) mx, COUNT(*) cnt FROM meter_reading GROUP BY meter_id) ra ON ra.meter_id = a.id
LEFT JOIN (SELECT meter_id, MIN(ym) mn, MAX(ym) mx, COUNT(*) cnt FROM meter_reading GROUP BY meter_id) rb ON rb.meter_id = b.id
ORDER BY b.zone, b.name;

-- ── ② B 类清单:被当成表的尖峰平谷四栏(宿舍电,name 以 尖/峰/平/谷 结尾,且存在同前缀的「总」表)──
SELECT s.id AS fake_id, s.name AS fake_name, s.ownership, t.id AS total_id, t.name AS total_name
FROM meter s
JOIN meter t ON t.kind = s.kind AND t.zone = s.zone
            AND t.name = CONCAT(LEFT(s.name, CHAR_LENGTH(s.name) - 1), '总')
WHERE s.kind = 'elec' AND s.zone = 'dorm' AND s.name REGEXP '(尖|峰|平|谷)$'
ORDER BY t.name;

-- ── ③ 合并前的冲突体检:两档在同一 ym 都有读数(需人工裁定留哪条),A 类 ──
SELECT a.id shadow_id, b.id keep_id, r1.ym, r1.curr_total shadow_curr, r2.curr_total keep_curr
FROM meter a
JOIN meter b ON a.kind = b.kind AND a.zone = b.zone AND b.name = CONCAT(a.name, '.00')
JOIN meter_reading r1 ON r1.meter_id = a.id
JOIN meter_reading r2 ON r2.meter_id = b.id AND r2.ym = r1.ym;

-- ── ④ 被引用体检:影子档若已挂进分摊规则/合同,合并前要先改引用 ──
SELECT 'alloc_rule_meter' src, arm.rule_id ref_id, arm.meter_id
FROM alloc_rule_meter arm JOIN meter a ON a.id = arm.meter_id
JOIN meter b ON a.kind = b.kind AND a.zone = b.zone AND b.name = CONCAT(a.name, '.00')
UNION ALL
SELECT 'meter.contract_id', a.contract_id, a.id
FROM meter a JOIN meter b ON a.kind = b.kind AND a.zone = b.zone AND b.name = CONCAT(a.name, '.00')
WHERE a.contract_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- 以下为合并语句,**默认不执行**。清单核对无误、③④ 均为空后,逐段取消注释。
-- ═══════════════════════════════════════════════════════════════════════

-- A 类:影子档读数改挂正档 → 删影子档。正档名保留带 .00 的那个(它是主档,读数更新)。
-- CREATE TEMPORARY TABLE _pair AS
--   SELECT a.id shadow_id, b.id keep_id FROM meter a
--   JOIN meter b ON a.kind=b.kind AND a.zone=b.zone AND b.name=CONCAT(a.name,'.00');
-- UPDATE meter_reading r JOIN _pair p ON r.meter_id = p.shadow_id SET r.meter_id = p.keep_id;
-- DELETE m FROM meter m JOIN _pair p ON m.id = p.shadow_id;
-- 顺带把 .00 名归一(去尾零),与解析器口径一致:
-- UPDATE meter SET name = TRIM(TRAILING '.00' FROM name) WHERE name REGEXP '^[0-9]+\\.00$';

-- B 类:四栏假表本就不该存在(读数是总表的分时明细,总表已有 sharp/peak/flat/valley 列)。
--       先确认总表该月 prev_sharp/curr_sharp… 已有值,再删假表连带读数。
-- DELETE r FROM meter_reading r JOIN meter s ON s.id = r.meter_id
--   WHERE s.kind='elec' AND s.zone='dorm' AND s.name REGEXP '(尖|峰|平|谷)$';
-- DELETE FROM meter WHERE kind='elec' AND zone='dorm' AND name REGEXP '(尖|峰|平|谷)$';
