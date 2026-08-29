-- V115__pool_side_backfill.sql
-- 一期历史池把「东侧/西侧」写在 name 里,没进 side 列(全库仅 51/52 两池真用了 side)。
-- 抽屉的侧向框读 side 列,读到空就原样回传空 → 保存时按定位重算池名,方位蒸发,
-- 且 C/D/E 座东西侧货梯各自撞成同名、F座 88 与既有 89 逐字同名。
-- 回填只认 name 里紧跟 floor_label 之后的方位词,不做模糊匹配。
UPDATE alloc_rule SET side = '东侧'
WHERE side IS NULL AND floor_label IS NOT NULL
  AND name LIKE CONCAT('%', floor_label, '东侧%');
UPDATE alloc_rule SET side = '西侧'
WHERE side IS NULL AND floor_label IS NOT NULL
  AND name LIKE CONCAT('%', floor_label, '西侧%');

-- 池 25「一期园区·路灯」不在这条修复里:building_id 为 NULL 却填了 floor_label='一楼',
-- name 里没有"floor_label+方位"这个子串,上面两条 UPDATE 天然不命中它。它的问题方向相反
-- (定位数据本身填错了,多出一截楼层),应由用户在界面上清空楼层,不该由迁移猜。
