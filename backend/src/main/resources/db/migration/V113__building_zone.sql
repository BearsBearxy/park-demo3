-- V113__building_zone.sql — 期区从「遍历电表反推」改成楼栋上的显式字段。
-- 背景:AllocService.loadCtx 一直靠 meter.zone 的首块表推楼栋期区(putIfAbsent),
-- 三期 0 块表 → 推不出期区 → 建不了三期的表。鸡生蛋。
-- 注意 zone ≠ phase:一期宿舍一~四栋 phase=1 但 zone=dorm;phase=4 那三栋是宿舍类不是四期。

ALTER TABLE building
  ADD COLUMN zone VARCHAR(8) NULL COMMENT '期区(p1/p2/p3…/dorm);唯一事实来源。NULL=未标注,引擎回退按该栋首块表的 zone 猜';

-- 回填:按该栋电表的**众数** zone(不是第一块 —— 二期二车间挂着 p2:20/p1:1/dorm:1 三种表,
-- 取首块的结果取决于遍历顺序)。平局按 zone 字典序取最小,保证同一份数据跑两次结果相同。
UPDATE building b
JOIN (
  SELECT building_id, zone FROM (
    SELECT building_id, zone,
           ROW_NUMBER() OVER (PARTITION BY building_id ORDER BY COUNT(*) DESC, zone ASC) AS rn
    FROM meter
    WHERE building_id IS NOT NULL AND zone IS NOT NULL
    GROUP BY building_id, zone
  ) t WHERE rn = 1
) m ON m.building_id = b.id
SET b.zone = m.zone;

-- 无表的 9 栋留 NULL,由用户在楼栋管理里选:
--   三期 创业大厦 / 三期 工业大厦 / 三期(待清空旧桶) / 散租宿舍 / 保障房 / 饭堂
--   / 二期 一至四车间 / 二期 五、六车间 / 一期 空地
