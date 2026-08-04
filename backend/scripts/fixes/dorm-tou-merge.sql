-- dorm-tou-merge.sql — 宿舍分时 7 户手术:删「一段一行」28 块空档案 + 2024-02 分时读数回填基础档案
-- 日期:2026-08-05  依据:BILL-DERIVE-SPEC / S4-BILL-NOTICE-SPEC(分时优先判定树需要八列读数在同一块表上)
--
-- 背景:宿舍册把分时表按 尖/峰/平/谷 一段一行建表标识(彭健宜尖/彭健宜峰/…),导入后产生 28 块
--   零读数空档案(kind='elec' zone='dorm' suspect='incomplete'),涉及 7 户:
--   彭健宜/彭周荣/彭小兰/蔡高育/陈昌辉/雷少康/广联饭堂 —— 均为宿舍区一楼商铺独立户,非宿舍房间表。
--   总量读数挂在同名「总」后缀基础档案上:
--     陈昌辉总=510 彭健宜总=515 蔡高育总=521 雷少康总=526 广联饭堂总=534 彭周荣总=542 彭小兰总=547
--   ※与任务书原判「仅4/7户有总量、3户需补INSERT」不符:dev 现查(2026-08-05)7/7 户均已有
--     2024-02 总量行(meter_reading id 9651/9652/9654/9655/9659/9663/9664,source='import')。
--     第 2 步仍保留守卫式 INSERT 兜底,现况下为 0 行 no-op。
--
-- 源册:C:/financial_dashboard/2025全年发生额、预算对比/2024年/2024年3月费用数据/2024年3月费用数据/
--       一期/一期2024年2月水电费.xlsx!宿舍电(K列=上月行至,L列=本月行至,M列=本月用电量)。
--   广联饭堂也在此册(R36~R40),无需查二期册;二期册的宿舍电 sheet 是一期副本,行号数值全等,引用一律以一期为准。
--
-- is_dorm_room 口径(V89 新列,默认 0):7 户基础档案保持 is_dorm_room=0 —— 它们有尖峰平谷四段读数,
--   判定树走分时价+管理费0.16,不走居民价;不是「房号计费分间」的宿舍房间表。
--   dev 库现查尚无该列(V89 未/部分应用),本脚本不触碰,依赖默认值 0 即为正确态。
--
-- 【待核清单】(本脚本一律不动,仅记录)
-- 1. 广联饭堂总(meter 534) 档案 factor=1.00,但源册电表编码注明「230828010101（120倍）」且
--    M36=1951.2=(72.82-56.56)×120 → 档案倍率疑漏 120(电费差 120 倍!),待拍板后另行修正
--    (需同改 meter.factor 与 meter_reading 9659 的 factor_snap 两处)。
-- 2. 彭周荣 四段用量合计 587.66 vs 总量用量 587.57,差 0.09(源册即如此,分时表盘精度漂移);
--    陈昌辉/雷少康/彭小兰 各差 0.01,同性质。验证锚点以「各段用量」为准,不强求四段Σ=总量。
--
-- 执行(勿在 PowerShell 内联中文,整文件管道执行):
--   docker exec -i demo3-mysql mysql -uroot -proot --default-character-set=utf8mb4 park_demo3 < dorm-tou-merge.sql

SET NAMES utf8mb4;
START TRANSACTION;

-- ── 1. 删 28 块「一段一行」空档案 ──
-- 护栏:必须 kind/zone/suspect 三对齐,且该表 0 读数、0 条 alloc_rule_meter 绑定,缺一不删(静默跳过,末尾 V1 兜底)。
-- 已核 2026-08-05:28 块全部 0 读数 0 绑定;bill_notice_line / elec_cost_entry / alloc_pool_meter_result 亦 0 引用
-- (带 FK 的表若有残留引用会硬报错回滚,本身即是护栏)。
-- id 对照:陈昌辉511-514 彭健宜516-519 蔡高育522-525 雷少康527-530 广联饭堂535-538 彭周荣543-546 彭小兰548-551
DELETE m FROM meter m
WHERE m.kind = 'elec' AND m.zone = 'dorm' AND m.suspect = 'incomplete'
  AND m.name IN (
    '彭健宜尖','彭健宜峰','彭健宜平','彭健宜谷',
    '彭周荣尖','彭周荣峰','彭周荣平','彭周荣谷',
    '彭小兰尖','彭小兰峰','彭小兰平','彭小兰谷',
    '蔡高育尖','蔡高育峰','蔡高育平','蔡高育谷',
    '陈昌辉尖','陈昌辉峰','陈昌辉平','陈昌辉谷',
    '雷少康尖','雷少康峰','雷少康平','雷少康谷',
    '广联饭堂尖','广联饭堂峰','广联饭堂平','广联饭堂谷')
  AND NOT EXISTS (SELECT 1 FROM meter_reading r WHERE r.meter_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM alloc_rule_meter a WHERE a.meter_id = m.id);
SELECT ROW_COUNT() AS step1_deleted_expect_28;

-- ── 2. 兜底 INSERT:基础档案缺 2024-02 行才补(现况 7/7 已有 → 预期 0 行) ──
-- factor_snap 取档案 factor;总量抄自源册「总」行 K/L(单元格标在行尾注释)。
INSERT INTO meter_reading (meter_id, ym, prev_total, curr_total, factor_snap, source, note)
SELECT m.id, '2024-02', v.pt, v.ct, m.factor, 'manual', '宿舍分时回填补行(dorm-tou-merge)'
FROM (
        SELECT '陈昌辉总'   AS n, 13353.13 AS pt, 13496.18 AS ct  -- 宿舍电!K12/L12(K12 源册为文本'13353.13')
  UNION ALL SELECT '彭健宜总',    1125.45,        1443.92         -- 宿舍电!K17/L17
  UNION ALL SELECT '蔡高育总',    7354.27,        7717.03         -- 宿舍电!K23/L23
  UNION ALL SELECT '雷少康总',   12965.76,       13280.85         -- 宿舍电!K28/L28
  UNION ALL SELECT '广联饭堂总',    56.56,          72.82         -- 宿舍电!K36/L36
  UNION ALL SELECT '彭周荣总',    7742.84,        8330.41         -- 宿舍电!K44/L44
  UNION ALL SELECT '彭小兰总',    1666.33,        2206.67         -- 宿舍电!K49/L49
) v
JOIN meter m ON m.kind = 'elec' AND m.zone = 'dorm' AND m.name = v.n
WHERE NOT EXISTS (SELECT 1 FROM meter_reading r WHERE r.meter_id = m.id AND r.ym = '2024-02');
SELECT ROW_COUNT() AS step2_inserted_expect_0;

-- ── 3. 分时八列回填(uk_meter(kind,zone,name) 唯一 → 每条 UPDATE 至多单命中) ──
-- 数值逐格抄自 一期2024年2月水电费.xlsx!宿舍电 K/L 列(尖/峰/平/谷 行)。
-- note 直接覆盖:7 行现值均为 NULL(2026-08-05 已核),幂等重跑写同值。

-- 陈昌辉总(510):尖 K13/L13,峰 K14/L14,平 K15/L15,谷 K16/L16
UPDATE meter_reading r
JOIN meter m ON m.id = r.meter_id AND m.kind = 'elec' AND m.zone = 'dorm' AND m.name = '陈昌辉总'
SET r.prev_sharp  = 2177.65, r.curr_sharp  = 2203.66,
    r.prev_peak   = 3402.63, r.curr_peak   = 3433.64,
    r.prev_flat   = 5542.95, r.curr_flat   = 5604.73,
    r.prev_valley = 2229.90, r.curr_valley = 2254.14,
    r.note = '2024-02分时八列回填自宿舍册(dorm-tou-merge)'
WHERE r.ym = '2024-02';

-- 彭健宜总(515):尖 K18/L18,峰 K19/L19,平 K20/L20,谷 K21/L21
UPDATE meter_reading r
JOIN meter m ON m.id = r.meter_id AND m.kind = 'elec' AND m.zone = 'dorm' AND m.name = '彭健宜总'
SET r.prev_sharp  =  383.32, r.curr_sharp  =  507.95,
    r.prev_peak   =  425.21, r.curr_peak   =  565.98,
    r.prev_flat   =  218.54, r.curr_flat   =  259.67,
    r.prev_valley =   98.37, r.curr_valley =  110.31,
    r.note = '2024-02分时八列回填自宿舍册(dorm-tou-merge)'
WHERE r.ym = '2024-02';

-- 蔡高育总(521):尖 K24/L24,峰 K25/L25,平 K26/L26,谷 K27/L27
UPDATE meter_reading r
JOIN meter m ON m.id = r.meter_id AND m.kind = 'elec' AND m.zone = 'dorm' AND m.name = '蔡高育总'
SET r.prev_sharp  = 1114.76, r.curr_sharp  = 1172.28,
    r.prev_peak   = 1977.27, r.curr_peak   = 2080.71,
    r.prev_flat   = 2892.27, r.curr_flat   = 3059.72,
    r.prev_valley = 1369.96, r.curr_valley = 1404.31,
    r.note = '2024-02分时八列回填自宿舍册(dorm-tou-merge)'
WHERE r.ym = '2024-02';

-- 雷少康总(526):尖 K29/L29,峰 K30/L30,平 K31/L31,谷 K32/L32
UPDATE meter_reading r
JOIN meter m ON m.id = r.meter_id AND m.kind = 'elec' AND m.zone = 'dorm' AND m.name = '雷少康总'
SET r.prev_sharp  = 1885.10, r.curr_sharp  = 1933.05,
    r.prev_peak   = 2777.03, r.curr_peak   = 2838.65,
    r.prev_flat   = 5977.37, r.curr_flat   = 6141.32,
    r.prev_valley = 2326.25, r.curr_valley = 2367.83,
    r.note = '2024-02分时八列回填自宿舍册(dorm-tou-merge)'
WHERE r.ym = '2024-02';

-- 广联饭堂总(534):尖 K37/L37,峰 K38/L38,平 K39/L39,谷 K40/L40(盘面读数,未乘 120 倍;倍率疑云见头部待核1)
UPDATE meter_reading r
JOIN meter m ON m.id = r.meter_id AND m.kind = 'elec' AND m.zone = 'dorm' AND m.name = '广联饭堂总'
SET r.prev_sharp  =   23.45, r.curr_sharp  =   29.59,
    r.prev_peak   =   14.14, r.curr_peak   =   18.91,
    r.prev_flat   =   15.13, r.curr_flat   =   19.50,
    r.prev_valley =    3.82, r.curr_valley =    4.80,
    r.note = '2024-02分时八列回填自宿舍册(dorm-tou-merge)'
WHERE r.ym = '2024-02';

-- 彭周荣总(542):尖 K45/L45,峰 K46/L46,平 K47/L47,谷 K48/L48
UPDATE meter_reading r
JOIN meter m ON m.id = r.meter_id AND m.kind = 'elec' AND m.zone = 'dorm' AND m.name = '彭周荣总'
SET r.prev_sharp  = 1165.63, r.curr_sharp  = 1243.16,
    r.prev_peak   = 1745.44, r.curr_peak   = 1873.55,
    r.prev_flat   = 3684.97, r.curr_flat   = 3985.11,
    r.prev_valley = 1146.70, r.curr_valley = 1228.58,
    r.note = '2024-02分时八列回填自宿舍册(dorm-tou-merge)'
WHERE r.ym = '2024-02';

-- 彭小兰总(547):尖 K50/L50,峰 K51/L51,平 K52/L52,谷 K53/L53
UPDATE meter_reading r
JOIN meter m ON m.id = r.meter_id AND m.kind = 'elec' AND m.zone = 'dorm' AND m.name = '彭小兰总'
SET r.prev_sharp  =  436.27, r.curr_sharp  =  545.06,
    r.prev_peak   =  560.59, r.curr_peak   =  725.01,
    r.prev_flat   =  586.79, r.curr_flat   =  813.99,
    r.prev_valley =   82.67, r.curr_valley =  122.59,
    r.note = '2024-02分时八列回填自宿舍册(dorm-tou-merge)'
WHERE r.ym = '2024-02';

-- 【3】广联饭堂总(534)倍率修正:档案 factor=1.00,源册编码注明「230828010101（120倍）」,
--     且 M36=1951.2=(72.82−56.56)×120 铁证(头部待核1,2026-08-05 定案照改)。
--     档案 factor 供此后新录读数快照;既有 2024-02 行的 factor_snap 一并对齐。
UPDATE meter SET factor = 120.00
WHERE id = 534 AND kind = 'elec' AND zone = 'dorm' AND name = '广联饭堂总' AND factor = 1.00;
UPDATE meter_reading r
JOIN meter m ON m.id = r.meter_id AND m.id = 534
SET r.factor_snap = 120.00
WHERE r.ym = '2024-02' AND r.factor_snap = 1.00;

COMMIT;

-- ══════════ 验证 ══════════
-- V1. 28 块空档案全清:预期 0
SELECT COUNT(*) AS v1_leftover_expect_0
FROM meter
WHERE kind = 'elec' AND zone = 'dorm'
  AND name IN (
    '彭健宜尖','彭健宜峰','彭健宜平','彭健宜谷',
    '彭周荣尖','彭周荣峰','彭周荣平','彭周荣谷',
    '彭小兰尖','彭小兰峰','彭小兰平','彭小兰谷',
    '蔡高育尖','蔡高育峰','蔡高育平','蔡高育谷',
    '陈昌辉尖','陈昌辉峰','陈昌辉平','陈昌辉谷',
    '雷少康尖','雷少康峰','雷少康平','雷少康谷',
    '广联饭堂尖','广联饭堂峰','广联饭堂平','广联饭堂谷');

-- V2. 7 户基础档案 2024-02 分时八列全非 NULL:预期 7
SELECT COUNT(*) AS v2_tou_complete_expect_7
FROM meter_reading r
JOIN meter m ON m.id = r.meter_id
WHERE m.kind = 'elec' AND m.zone = 'dorm' AND r.ym = '2024-02'
  AND m.name IN ('彭健宜总','彭周荣总','彭小兰总','蔡高育总','陈昌辉总','雷少康总','广联饭堂总')
  AND r.prev_sharp  IS NOT NULL AND r.curr_sharp  IS NOT NULL
  AND r.prev_peak   IS NOT NULL AND r.curr_peak   IS NOT NULL
  AND r.prev_flat   IS NOT NULL AND r.curr_flat   IS NOT NULL
  AND r.prev_valley IS NOT NULL AND r.curr_valley IS NOT NULL;

-- V3. 锚点:各段用量(本月-上月,盘面差,未乘倍率)与 Excel M 列逐格对照
-- 预期(按 m.id 排序;Excel 一期!宿舍电 M 列,广联饭堂 M 列已×120 → 盘面差=M÷120):
--   510 陈昌辉总    26.01   31.01   61.78   24.24   (M13~M16)
--   515 彭健宜总   124.63  140.77   41.13   11.94   (M18~M21)
--   521 蔡高育总    57.52  103.44  167.45   34.35   (M24~M27)
--   526 雷少康总    47.95   61.62  163.95   41.58   (M29~M32)
--   534 广联饭堂总   6.14    4.77    4.37    0.98   (M37~M40: 736.8/572.4/524.4/117.6 ÷120)
--   542 彭周荣总    77.53  128.11  300.14   81.88   (M45~M48)
--   547 彭小兰总   108.79  164.42  227.20   39.92   (M50~M53)
SELECT m.id, m.name,
       CAST(r.curr_sharp  - r.prev_sharp  AS DECIMAL(14,2)) AS u_sharp,
       CAST(r.curr_peak   - r.prev_peak   AS DECIMAL(14,2)) AS u_peak,
       CAST(r.curr_flat   - r.prev_flat   AS DECIMAL(14,2)) AS u_flat,
       CAST(r.curr_valley - r.prev_valley AS DECIMAL(14,2)) AS u_valley,
       CAST(r.curr_total  - r.prev_total  AS DECIMAL(14,2)) AS u_total
FROM meter_reading r
JOIN meter m ON m.id = r.meter_id
WHERE m.kind = 'elec' AND m.zone = 'dorm' AND r.ym = '2024-02'
  AND m.name IN ('彭健宜总','彭周荣总','彭小兰总','蔡高育总','陈昌辉总','雷少康总','广联饭堂总')
ORDER BY m.id;

-- V4. 广联饭堂倍率修正落地:预期 factor=120.00 / snap_120=1(2024-02 行) 且 M36 复算 1951.20
SELECT m.factor, SUM(r.factor_snap = 120.00) AS snap_120,
       CAST((r.curr_total - r.prev_total) * r.factor_snap AS DECIMAL(14,2)) AS m36_expect_1951_20
FROM meter m JOIN meter_reading r ON r.meter_id = m.id AND r.ym = '2024-02'
WHERE m.id = 534 GROUP BY m.factor, r.curr_total, r.prev_total, r.factor_snap;
