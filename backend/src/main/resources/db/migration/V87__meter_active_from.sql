-- 启用账期(2026-08-04 用户裁定:某月导入才出现的表,只从那月起显示——与 V68 停用账期对称)。
-- 语义:active_from_ym 非空且 ym < active_from_ym 时该表不在服务中(不显示/不进待核与公摊分母);NULL=一直在册。
-- 自愈:导入时若行所在月早于 active_from_ym,自动放宽到该月(表在更早源册出现=更早就存在);新建档=首现月。
ALTER TABLE meter ADD COLUMN active_from_ym CHAR(7) NULL COMMENT '启用账期:该月前不在服务中(V87,与retired_ym对称);NULL=一直在册';
-- 回填:仅 202405 种子建档且至今零读数的表(=用户自导各月源册均无此表,如南盛物流/蚁润发/二期全区)
-- → 首现月=2024-05。被拦水表等一旦重导更早月份,导入自愈自动拉回,无需人工。
UPDATE meter m SET m.active_from_ym='2024-05'
WHERE m.retired_ym IS NULL
  AND m.created_at BETWEEN '2026-07-21 15:19:00' AND '2026-07-21 15:20:59'
  AND NOT EXISTS (SELECT 1 FROM meter_reading r WHERE r.meter_id=m.id);
