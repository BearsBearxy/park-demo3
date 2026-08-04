-- dorm-room-backfill-review.sql — dorm-room-backfill.sql 的人工核对清单(只读)。2026-08-05。
-- 用法:docker exec demo3-mysql mysql -uroot -proot --default-character-set=utf8mb4 park_demo3 \
--        < backend/scripts/fixes/dorm-room-backfill-review.sql > dorm-room-review.tsv
-- 输出全部宿舍区租户表:verdict = SET_1(拟置1) / SET_1_KAILI(开利显式置1) / EXCLUDE(拟排除)。
SELECT m.id, m.kind, m.name, m.tenant_name, m.spot,
  CASE
    WHEN m.tenant_name = '开利暖通' THEN 'SET_1_KAILI'
    WHEN (m.name REGEXP '^[0-9]+(\\.[0-9]+)?室?$' OR m.spot REGEXP '^[0-9]+(\\.[0-9]+)?室?$')
     AND IFNULL(m.tenant_name,'') NOT REGEXP '彭健宜|彭周荣|彭小兰|蔡高育|陈昌辉|雷少康|可盈|章肖艳|张勤军|张丽莉|张誉腾|威奈斯|袁华圣|沙力海|李李|周兴|SENAN|SEAN'
     AND m.name NOT LIKE '%饭堂%'
    THEN 'SET_1'
    ELSE 'EXCLUDE'
  END AS verdict
FROM meter m
WHERE m.zone = 'dorm' AND m.ownership = 'tenant'
ORDER BY verdict, m.kind, m.name;
