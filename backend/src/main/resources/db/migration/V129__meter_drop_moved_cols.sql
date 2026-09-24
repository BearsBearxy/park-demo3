-- V129__meter_drop_moved_cols.sql — 表档案按月记录(METER-TIMELINE-SPEC §7.5):删 meter 上被 V128 搬走的列。
--
-- 归属 / 位置 / 人工标记 / 合同钉 → meter_assign(按月分段);启用 / 停用 / 退场三个账期 → meter_status。
-- 读写同一刀换到 MeterTimelineService(带月份的读一律 metersAt(ym)),meter 上只剩资产列(SPEC §1.1)。
--
-- 先拆两样挂在这些列上的东西,MySQL 才让删列:
--   · fk_meter_contract(V63)—— 合同外键由 meter_assign.fk_meter_assign_contract(V128,同款 ON DELETE SET NULL)接班;
--     它自动建的同名索引随 contract_id 一起消失;
--   · idx_meter_loc(V74,building_id+floor_label+side)—— 三列都搬走了。
ALTER TABLE meter DROP FOREIGN KEY fk_meter_contract;
ALTER TABLE meter DROP INDEX idx_meter_loc;

ALTER TABLE meter
  DROP COLUMN area,
  DROP COLUMN spot,
  DROP COLUMN tenant_name,
  DROP COLUMN tenant_id,
  DROP COLUMN contract_id,
  DROP COLUMN building_id,
  DROP COLUMN ownership,
  DROP COLUMN sub_name,
  DROP COLUMN floor_label,
  DROP COLUMN side,
  DROP COLUMN room_no,
  DROP COLUMN loc_manual,
  DROP COLUMN owner_manual,
  DROP COLUMN retired_ym,
  DROP COLUMN active_from_ym,
  DROP COLUMN removed_ym;
