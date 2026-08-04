-- dorm-room-backfill.sql — V89 新列 meter.is_dorm_room 回填。2026-08-05。⚠只起草待人工核对后执行。
-- 依据:BILL-DERIVE-SPEC §2.1/§2.3(判据=VLOOKUP键是房号而非表标识;建档时打标别在派生时猜)、
--       BOOK-STRUCTURE-2024-02(宿舍册三类不按居民价:分时/商铺/整栋转租,其中开利暖通整栋转租按居民价→置1)。
-- 前置:V89__bill_notice.sql 已应用(否则本脚本报 Unknown column)。
-- 幂等:可重复执行(先全量清 0 再置 1)。
--
-- 实证摸底(2026-08-05 dev 库,zone='dorm' AND ownership='tenant' 共 571 块):
--   · 纯房号形态(name/spot ~ 纯数字|数字.00|数字室) 520 块——水表名带 Excel 浮点尾巴(如 652.00),电表纯数字(652)。
--   · 非房号形态 51 块 = 一楼商铺户表(章肖艳/张勤军/雷少康/…/SENAN 4104室电水)+可盈 4 表+广联饭堂 3 表
--     +宿舍路灯(佳亿兴)——正好就是规格里的排除集,形态判据天然把它们挡在外面。
--   · 排除名单里 5 户在楼上另租真宿舍房间(房号形态)共 14 块表:
--     雷少康239 / 张勤军332·532·536·632 / 彭小兰548 / 陈昌辉550 / 沙力海625(电水成对)
--     (meter id 712/732/786/790/802/804/808/813/1014/1085/1089/1103/1106/1111)
--     ——按任务书「排除分时7户+独立户商铺名单」口径一并排除,但按 §2.1 判据 b(房号为键)大概率是真宿舍房间,列入待核。
--   · 开利暖通 7 表(id 693-697/997/998,暖通二栋/三栋电水,非房号形态)→ 显式置 1。
--
-- ── 待核清单(人工拍板,本脚本不猜)──────────────────────────────────────────
-- ① 14 块「商铺/分时户名下的房号形态表」——2026-08-05 定案:按 §2.1/§2.3 判据 b(房号为键=100%干净实证)
--    **纯形态判定,置 1**。这些户一楼商铺/分时表(非房号形态)天然被形态挡住,楼上真宿舍房间按房间价出账。
--    S4-3 逐行复刻若发现某间实按商铺价收,再按 id 单点回 0。
-- ② SENAN「4104室电」spot 含 3105、4104 两间:名称与 spot 均非纯房号形态,天然=0;如 4104 实为宿舍房间需拆表另议。
-- ③ 宿舍路灯(佳亿兴,id 见核对清单):ownership='tenant' 存疑(路灯应是 share/park),非房号形态=0,归属另刀。
-- ──────────────────────────────────────────────────────────────────────

-- 【0】先清零(幂等基线)
UPDATE meter SET is_dorm_room = 0 WHERE is_dorm_room <> 0;

-- 【1】判据 b 纯形态:宿舍区租户表 + 纯房号形态(纯数字 / 数字.00 浮点尾巴 / 数字+室) → 1
--     不按租户名单排除——商铺/分时/可盈/饭堂的出账表全部是非房号形态,形态判据天然挡住(实证 51 块);
--     商铺户楼上另租的真宿舍房间(14 块,房号形态)按房间价出账,应置 1(待核①定案)。
UPDATE meter m
SET m.is_dorm_room = 1
WHERE m.zone = 'dorm'
  AND m.ownership = 'tenant'
  AND (m.name REGEXP '^[0-9]+(\\.[0-9]+)?室?$' OR m.spot REGEXP '^[0-9]+(\\.[0-9]+)?室?$');

-- 【2】开利暖通(二栋/三栋宿舍整栋转租,按居民价出账)→ 1
--     护栏:按 tenant_name 精确匹配,当前命中 7 块(693-697/997/998);匹配不到则 0 行生效。
UPDATE meter m
SET m.is_dorm_room = 1
WHERE m.zone = 'dorm'
  AND m.ownership = 'tenant'
  AND m.tenant_name = '开利暖通';

-- ── 验证(预期锚点,基于 2026-08-05 dev 库)────────────────────────────────
-- v1: 置1总数 = 520(房号形态,含商铺户楼上真房间14) + 7(开利,非房号形态) = 527
SELECT COUNT(*) AS dorm_room_cnt, IF(COUNT(*) = 527, 'OK', 'MISMATCH') AS verdict
FROM meter WHERE is_dorm_room = 1;

-- v2: 非房号形态零泄漏——is_dorm_room=1 且非房号形态的只允许开利暖通 7 块,预期 0 行
SELECT id, name, tenant_name FROM meter
WHERE is_dorm_room = 1
  AND NOT (name REGEXP '^[0-9]+(\\.[0-9]+)?室?$' OR spot REGEXP '^[0-9]+(\\.[0-9]+)?室?$')
  AND IFNULL(tenant_name,'') <> '开利暖通';

-- v3: 非宿舍区/非租户表零污染,预期 0 行
SELECT id, zone, ownership, name FROM meter
WHERE is_dorm_room = 1 AND NOT (zone = 'dorm' AND (ownership = 'tenant'));

-- ── 人工核对清单导出(执行前跑,落 tsv 逐行过目)───────────────────────────
-- docker exec demo3-mysql mysql -uroot -proot --default-character-set=utf8mb4 park_demo3 \
--   < backend/scripts/fixes/dorm-room-backfill-review.sql > dorm-room-review.tsv
-- (核对 SELECT 单独放 dorm-room-backfill-review.sql,与本写库脚本分离)
